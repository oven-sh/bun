//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.
//!
//! B-2 un-gate (this round): structs + state machines are real. JS-facing
//! method bodies (`set_timeout`/`clear_timer`/`warn_invalid_countdown`/etc.)
//! remain ``-gated on `bun_jsc` (commented out in Cargo.toml).
//! `All::insert`/`remove`/`update`/`get_timeout`/`drain_timers` — the surface
//! `EventLoop::auto_tick` blocks on per keystone C — are real.
//!
//! Full Phase-A drafts are preserved gated under ` mod *_draft`
//! so this file can be diffed against `Timer.rs` once `bun_jsc` is green.

use core::mem::offset_of;

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
use bun_threading::Mutex;

// Low-tier timer node + tag (per §Dispatch hot-path list, the `match tag`
// dispatch lives in this crate; `bun_event_loop` only stores `(tag, ptr)`).
pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};
// TODO(b2-blocked): bun_event_loop carries a local `Timespec` stub instead of
// `bun_core::Timespec`. Same `{sec: i64, nsec: i64}` shape; alias it here so
// `fire()`/`next` accesses type-check without a transmute. Remove once the
// lower tier switches to `bun_core::Timespec`.
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;

use crate::jsc::{JSGlobalObject, JSValue, JsResult};

// ─── JS-facing surface (`impl All { set_timeout / clear_* / … }`) ────────────
// Named `timer` so codegen (`generated_js2native.rs`) resolves
// `crate::timer::timer::internal_bindings::timer_clock_ms` per the
// `$zig(Timer.zig, …)` → `crate::<dir>::<file>` path-mapping.

#[path = "Timer.rs"]
pub mod timer;

#[path = "TimeoutObject.rs"]
pub mod timeout_object;

#[path = "ImmediateObject.rs"]
pub mod immediate_object;

#[path = "TimerObjectInternals.rs"]
mod timer_object_internals_draft;

#[path = "DateHeaderTimer.rs"]
mod date_header_timer_draft;

#[path = "EventLoopDelayMonitor.rs"]
mod event_loop_delay_monitor_draft;

// ─── TimerHeap ───────────────────────────────────────────────────────────────
// Zig: `heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less)`.
//
// Real intrusive pairing-heap (meld/remove/combine_siblings) ported in
// `bun_io::heap::Intrusive`. `EventLoopTimer` now embeds the real
// `bun_io::heap::IntrusiveField` and impls `HeapNode` in its defining crate
// (`bun_event_loop`), so the orphan-rule block is gone. `TimerHeap` is a thin
// newtype that adapts `*mut T` ↔ `Option<*mut T>` for the existing call-sites
// (`All::insert/remove/next/get_timeout`).

/// `void` context for the heap comparator — Zig passes `{}`.
#[derive(Default)]
pub struct TimerHeapCtx;

impl bun_io::heap::HeapContext<EventLoopTimer> for TimerHeapCtx {
    #[inline]
    fn less(&self, a: *mut EventLoopTimer, b: *mut EventLoopTimer) -> bool {
        // SAFETY: `Intrusive` only ever calls `less` with non-null nodes that
        // are live members of the heap (caller invariant on insert/meld).
        EventLoopTimer::less((), unsafe { &*a }, unsafe { &*b })
    }
}

#[derive(Default)]
pub struct TimerHeap(bun_io::heap::Intrusive<EventLoopTimer, TimerHeapCtx>);

impl TimerHeap {
    #[inline]
    pub fn peek(&self) -> Option<*mut EventLoopTimer> {
        let r = self.0.peek();
        if r.is_null() { None } else { Some(r) }
    }

    /// # Safety
    /// `v` is a valid, exclusively-owned node not currently in any heap
    /// (its `IntrusiveField` links are null).
    #[inline]
    pub unsafe fn insert(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.insert(v) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    pub unsafe fn remove(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.remove(v) };
    }

    #[inline]
    pub fn delete_min(&mut self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live until popped (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.delete_min() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub fn find_max(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.find_max() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub fn count(&self) -> usize {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        unsafe { self.0.count() }
    }
}

/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
pub type TimeoutMap = ArrayHashMap<i32, *mut EventLoopTimer>;

#[derive(Default)]
pub struct Maps {
    pub set_timeout: TimeoutMap,
    pub set_interval: TimeoutMap,
    pub set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    pub fn get(&mut self, kind: Kind) -> &mut TimeoutMap {
        match kind {
            Kind::SetTimeout => &mut self.set_timeout,
            Kind::SetInterval => &mut self.set_interval,
            Kind::SetImmediate => &mut self.set_immediate,
        }
    }
}

// ─── FakeTimers ──────────────────────────────────────────────────────────────
// Real definition lives in `runtime/test_runner/timers/FakeTimers.rs` and
// depends on `TimerHeap` (defined above). Now that `pub mod test_runner` is
// declared in lib.rs, re-export so `All.fake_timers` and the test_runner
// host fns see the same nominal type.
pub use crate::test_runner::timers::fake_timers::FakeTimers;

// ─── DateHeaderTimer / EventLoopDelayMonitor (struct-only) ───────────────────
// Method bodies (`enable`/`run`) call `vm.timer.*` and `vm.uws_loop()` which
// need `VirtualMachine.timer: All` (currently `()` in bun_jsc). Struct shape
// is real so `All` embeds them by value with the correct layout.

pub struct DateHeaderTimer {
    pub event_loop_timer: EventLoopTimer,
}
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self { event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DateHeaderTimer) }
    }
}
impl DateHeaderTimer {
    /// PORT NOTE (b2-cycle): `vm.timer` is `()` on the low-tier
    /// `VirtualMachine`; the real `timer::All` lives in `RuntimeState`.
    /// Recover it as a raw ptr — `self` is a field of that same `All`, so
    /// callers dereference per-field under `// SAFETY:` (raw-ptr-per-field
    /// re-entry pattern, jsc_hooks.rs).
    #[inline]
    fn timer_all() -> *mut All {
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`.
        unsafe { core::ptr::addr_of_mut!((*state).timer) }
    }

    /// Spec DateHeaderTimer.zig `run` — refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub fn run(&mut self, vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        let loop_ = vm.uws_loop();
        let now = Timespec::now(TimespecMockMode::AllowMockedTime);

        // Record when we last ran it.
        self.event_loop_timer.next = ElTimespec { sec: now.sec, nsec: now.nsec };

        // updateDate() is an expensive function.
        // SAFETY: `uws_loop()` returns the live per-thread uws loop owned by the VM.
        unsafe { (*loop_).update_date() };

        // SAFETY: `loop_` is live for the duration of this call (owned by VM).
        if unsafe { (*loop_).internal_loop_data.sweep_timer_count } > 0 {
            // Reschedule it automatically for 1 second later.
            let next = now.add_ms(1000);
            self.event_loop_timer.next = ElTimespec { sec: next.sec, nsec: next.nsec };
            let elt: *mut EventLoopTimer = &mut self.event_loop_timer;
            // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
            // `fake_timers`, disjoint from `date_header_timer` which `self` aliases.
            unsafe { (*Self::timer_all()).insert(elt) };
        }
    }
}

pub struct EventLoopDelayMonitor {
    // TODO(port): bare JSValue heap field — see EventLoopDelayMonitor.rs PORT NOTE
    js_histogram: JSValue,
    pub event_loop_timer: EventLoopTimer,
    pub resolution_ms: i32,
    pub last_fire_ns: u64,
    pub enabled: bool,
}
impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            js_histogram: JSValue::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
            resolution_ms: 10,
            last_fire_ns: 0,
            enabled: false,
        }
    }
}
impl EventLoopDelayMonitor {
    /// PORT NOTE (b2-cycle): `vm.timer` is `()` on the low-tier
    /// `VirtualMachine`; the real `timer::All` lives in `RuntimeState`.
    /// Recover it as a raw ptr — `self` is a field of that same `All`, so
    /// callers dereference per-field under `// SAFETY:` (raw-ptr-per-field
    /// re-entry pattern, jsc_hooks.rs).
    #[inline]
    fn timer_all() -> *mut All {
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`.
        unsafe { core::ptr::addr_of_mut!((*state).timer) }
    }

    pub fn enable(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        histogram: JSValue,
        resolution_ms: i32,
    ) {
        if self.enabled {
            return;
        }
        self.js_histogram = histogram;
        self.resolution_ms = resolution_ms;
        self.enabled = true;

        // Schedule timer
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let next = now.add_ms(i64::from(resolution_ms));
        self.event_loop_timer.next = ElTimespec { sec: next.sec, nsec: next.nsec };
        let elt: *mut EventLoopTimer = &mut self.event_loop_timer;
        // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
        // `fake_timers`, disjoint from `event_loop_delay` which `self` aliases.
        unsafe { (*Self::timer_all()).insert(elt) };
    }

    pub fn disable(&mut self, _vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        if !self.enabled {
            return;
        }
        self.enabled = false;
        self.js_histogram = JSValue::default();
        self.last_fire_ns = 0;
        let elt: *mut EventLoopTimer = &mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).remove(elt) };
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.js_histogram.is_empty()
    }

    /// Spec EventLoopDelayMonitor.zig `onFire` — record `now - last_fire_ns`
    /// into the JS histogram and reschedule.
    pub fn on_fire(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        if !self.enabled || self.js_histogram.is_empty() {
            return;
        }

        let now_ns = now.ns();
        if self.last_fire_ns > 0 {
            let expected_ns =
                u64::try_from(self.resolution_ms).unwrap().saturating_mul(1_000_000);
            let actual_ns = now_ns - self.last_fire_ns;

            if actual_ns > expected_ns {
                let delay_ns = i64::try_from(actual_ns.saturating_sub(expected_ns)).unwrap();
                unsafe extern "C" {
                    fn JSNodePerformanceHooksHistogram_recordDelay(
                        histogram: JSValue,
                        delay_ns: i64,
                    );
                }
                // SAFETY: js_histogram is a live JSValue rooted by the JS
                // closure scope (see field doc in EventLoopDelayMonitor.rs).
                unsafe {
                    JSNodePerformanceHooksHistogram_recordDelay(self.js_histogram, delay_ns);
                }
            }
        }

        self.last_fire_ns = now_ns;

        // Reschedule
        let next =
            Timespec { sec: now.sec, nsec: now.nsec }.add_ms(i64::from(self.resolution_ms));
        self.event_loop_timer.next = ElTimespec { sec: next.sec, nsec: next.nsec };
        let elt: *mut EventLoopTimer = &mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).insert(elt) };
    }
}

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject (struct-only) ───
// `Flags` is the real packed-u32 state machine; method bodies that touch
// `bun_jsc::JsRef`/`Debugger` stay gated.

pub mod timer_object_internals;
pub use timer_object_internals::{Flags as TimerFlags, TimerObjectInternals};

/// `jsc.WebCore.AbortSignal.Timeout` — real struct lives in `bun_jsc` (which
/// this crate depends on). Re-exported here so `All::update`'s
/// `@fieldParentPtr` epoch-bump and `dispatch::fire_timer` resolve the same
/// `event_loop_timer`/`flags` offsets the low tier wrote.
pub use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub use self::timeout_object::TimeoutObject;

pub struct ImmediateObject {
    pub ref_count: core::cell::Cell<u32>,
    pub event_loop_timer: EventLoopTimer,
    pub internals: TimerObjectInternals,
}

// ─── intrusive refcount (Zig: `bun.ptr.RefCount(@This(), "ref_count", deinit)`) ──
// `TimeoutObject` now uses `bun_ptr::RefCount<Self>` + `RefCounted` directly
// (see `timeout_object::TimeoutObject`); this macro remains for
// `ImmediateObject` until its port lands the same move.
macro_rules! impl_timer_refcount {
    ($T:ident) => {
        impl $T {
            /// `RefCount.ref` — increment the intrusive refcount.
            ///
            /// # Safety
            /// `this` must point at a live, `bun.new`-allocated `$T`.
            #[inline]
            pub unsafe fn ref_(this: *mut Self) {
                // SAFETY: per fn contract — `ref_count` is a `Cell` field of a
                // live allocation; single-threaded JS heap.
                let rc = unsafe { &(*this).ref_count };
                rc.set(rc.get() + 1);
            }

            /// `RefCount.deref` — decrement; on 0, run `deinit` and free.
            ///
            /// # Safety
            /// `this` must point at a live, `bun.new`-allocated `$T`. After
            /// this returns the pointer may be dangling.
            #[inline]
            pub unsafe fn deref(this: *mut Self) {
                // SAFETY: per fn contract.
                let rc = unsafe { &(*this).ref_count };
                let n = rc.get();
                debug_assert!(n > 0, concat!(stringify!($T), " refcount underflow"));
                rc.set(n - 1);
                if n == 1 {
                    // Zig `deinit`: `self.internals.deinit(); bun.destroy(self)`.
                    //
                    // SAFETY: refcount hit 0 ⇒ unique ownership of the parent;
                    // `internals` is an embedded field of a still-live
                    // allocation. `deinit` unlinks from `All.timers` (if
                    // ACTIVE), drops the id→ptr map entry (if
                    // `has_accessed_primitive`), and releases the event-loop
                    // keep-alive — see `TimerObjectInternals::deinit` for the
                    // full obligation list. `this_value.deinit()` is handled by
                    // `JsRef: Drop` when the Box is reclaimed immediately after.
                    unsafe { (*this).internals.deinit() };
                    // SAFETY: `bun.new` ↔ `Box::into_raw`, so `Box::from_raw`
                    // is the paired free.
                    drop(unsafe { Box::from_raw(this) });
                }
            }
        }
    };
}
impl_timer_refcount!(ImmediateObject);

// `jsc.Codegen.JS{Timeout,Immediate}` — hand-expansion of what the
// `#[bun_jsc::JsClass]` derive emits. Symbol names match generate-classes.ts
// (`Timeout__fromJS` / `Immediate__fromJS` etc., per Timer.classes.ts).
macro_rules! impl_timer_js_class {
    ($ty:ident, $name:literal) => {
        const _: () = {
            use bun_jsc::{JSGlobalObject, JSValue};
            #[allow(improper_ctypes)]
            unsafe extern "C" {
                #[link_name = concat!($name, "__fromJS")]
                fn __from_js(value: JSValue) -> *mut $ty;
                #[link_name = concat!($name, "__fromJSDirect")]
                fn __from_js_direct(value: JSValue) -> *mut $ty;
                #[link_name = concat!($name, "__create")]
                fn __create(global: *mut JSGlobalObject, ptr: *mut $ty) -> JSValue;
            }
            impl bun_jsc::JsClass for $ty {
                fn from_js(value: JSValue) -> Option<*mut Self> {
                    // SAFETY: pure FFI downcast; null on type mismatch.
                    let p = unsafe { __from_js(value) };
                    if p.is_null() { None } else { Some(p) }
                }
                fn from_js_direct(value: JSValue) -> Option<*mut Self> {
                    // SAFETY: exact-structure FFI downcast; null on miss.
                    let p = unsafe { __from_js_direct(value) };
                    if p.is_null() { None } else { Some(p) }
                }
                fn to_js(self, global: &JSGlobalObject) -> JSValue {
                    let ptr = Box::into_raw(Box::new(self));
                    // SAFETY: ownership transfers to the C++ wrapper
                    // (freed via `${name}Class__finalize` → `Self::deref`).
                    unsafe { __create(global.as_ptr(), ptr) }
                }
            }
        };
    };
}
impl_timer_js_class!(ImmediateObject, "Immediate");

impl ImmediateObject {
    /// Spec ImmediateObject.zig `runImmediateTask` — thin forwarder to
    /// `internals.run_immediate_task`. Registered into
    /// `bun_jsc::event_loop::RUN_IMMEDIATE_HOOK` by
    /// [`crate::dispatch::install_dispatch_hooks`].
    ///
    /// Returns `true` if an exception was thrown.
    ///
    /// # Safety
    /// `this` was produced by `enqueue_immediate_task` from a live
    /// heap-allocated `ImmediateObject`; `vm` is the live per-thread VM.
    #[inline]
    pub unsafe fn run_immediate_task(
        this: *mut Self,
        vm: *mut crate::jsc::virtual_machine::VirtualMachine,
    ) -> bool {
        // SAFETY: per fn contract — `this` is live; `internals` is an embedded
        // field. Do NOT form `&mut *this` (the body may `deref()` and free).
        unsafe { (*this).internals.run_immediate_task(vm) }
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
#[path = "WTFTimer.rs"]
pub mod wtf_timer;
pub use wtf_timer::WTFTimer;

// ─── All ─────────────────────────────────────────────────────────────────────

pub struct All {
    pub last_id: i32,
    pub lock: Mutex,
    pub thread_id: std::thread::ThreadId,
    pub timers: TimerHeap,
    pub active_timer_count: i32,
    #[cfg(windows)]
    pub uv_timer: bun_sys::windows::libuv::Timer,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub warned_negative_number: bool,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub warned_not_number: bool,
    /// Incremented when timers are scheduled or rescheduled. See
    /// TimerObjectInternals.epoch. Zig u25 — masked on increment.
    pub epoch: u32,
    pub immediate_ref_count: i32,
    #[cfg(windows)]
    pub uv_idle: bun_sys::windows::libuv::uv_idle_t,
    pub event_loop_delay: EventLoopDelayMonitor,
    pub fake_timers: FakeTimers,
    pub maps: Maps,
    pub date_header_timer: DateHeaderTimer,
}

impl All {
    pub fn init() -> Self {
        Self {
            last_id: 1,
            lock: Mutex::default(),
            thread_id: std::thread::current().id(),
            timers: TimerHeap::default(),
            active_timer_count: 0,
            #[cfg(windows)]
            // SAFETY: all-zero is a valid uv::Timer (C struct, init'd later via uv_timer_init)
            uv_timer: unsafe { core::mem::zeroed() },
            warned_negative_number: false,
            warned_not_number: false,
            epoch: 0,
            immediate_ref_count: 0,
            #[cfg(windows)]
            // SAFETY: all-zero is a valid uv_idle_t (C struct, init'd later via uv_idle_init)
            uv_idle: unsafe { core::mem::zeroed() },
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: Maps::default(),
            date_header_timer: DateHeaderTimer::default(),
        }
    }

    pub fn insert(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        // PORT NOTE: bun_threading::Mutex is lock()/unlock(), not RAII.
        let r = self.insert_lock_held(timer);
        self.lock.unlock();
        r
    }

    fn insert_lock_held(&mut self, timer: *mut EventLoopTimer) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // PORT NOTE (§Forbidden aliased-&mut): `TimerHeap::insert` forms a
        // fresh `&mut EventLoopTimer` via `(*a).heap()` for the same
        // allocation, so we must NOT hold a `&mut *timer` across that call.
        // Read `tag` and write `state`/`in_heap` via raw deref instead.
        let allow_fake = unsafe { (*timer).tag }.allow_fake_timers();
        if self.fake_timers.is_active() && allow_fake {
            // SAFETY: see fn contract
            unsafe {
                self.fake_timers.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Fake;
            }
        } else {
            // SAFETY: see fn contract
            unsafe {
                self.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Regular;
            }
            // TODO(b2-blocked): Windows uv_timer arming needs
            // `@fieldParentPtr(VirtualMachine, timer)`; gated until
            // `bun_jsc::VirtualMachine.timer: All`.
        }
    }

    pub fn remove(&mut self, timer: *mut EventLoopTimer) {
        self.lock.lock();
        self.remove_lock_held(timer);
        self.lock.unlock();
    }

    fn remove_lock_held(&mut self, timer: *mut EventLoopTimer) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // PORT NOTE (§Forbidden aliased-&mut): `TimerHeap::remove` forms a
        // fresh `&mut EventLoopTimer` via `(*v).heap()` for the same
        // allocation, so we must NOT hold a `&mut *timer` across that call.
        // Read `in_heap` and write the post-remove bookkeeping via raw deref.
        match unsafe { (*timer).in_heap } {
            InHeap::None => {
                // PORT NOTE: `Environment.ci_assert` → `debug_assertions` (see ptr/ref_count.rs).
                // can't remove a timer that was not inserted
                debug_assert!(false);
            }
            // SAFETY: timer is in `self.timers` per `in_heap`
            InHeap::Regular => unsafe { self.timers.remove(timer) },
            // SAFETY: timer is in `self.fake_timers.timers` per `in_heap`
            InHeap::Fake => unsafe { self.fake_timers.timers.remove(timer) },
        }
        // SAFETY: `timer` is still a valid live EventLoopTimer.
        unsafe {
            (*timer).in_heap = InHeap::None;
            (*timer).state = EventLoopTimerState::CANCELLED;
        }
    }

    /// Remove the EventLoopTimer if necessary, then re-insert at `time`.
    pub fn update(&mut self, timer: *mut EventLoopTimer, time: &Timespec) {
        self.lock.lock();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // Read `state` via raw deref so we don't hold a `&mut *timer` across
        // `remove_lock_held` (which also `&mut`-derefs the same pointer);
        // overlapping `&mut` is UB under Stacked Borrows.
        if unsafe { (*timer).state } == EventLoopTimerState::ACTIVE {
            self.remove_lock_held(timer);
        }

        // SAFETY: `timer` is still a valid live EventLoopTimer; safe to derive
        // an exclusive reference now that no other borrow is outstanding.
        let timer_ref = unsafe { &mut *timer };
        // PORT NOTE: Zig asserts `&timer.next != time` (threadsafety); the
        // EventLoopTimer.Timespec and bun_core::Timespec are distinct types
        // until the lower tier unifies them, so the pointer-compare is moot
        // here. Re-add once `bun_event_loop` switches to `bun_core::Timespec`.
        timer_ref.next.sec = time.sec;
        timer_ref.next.nsec = time.nsec;

        // Spec Timer.zig:117-120: bump the global epoch and write it back into
        // the per-timer flags so equal-deadline JS timers fire in refresh
        // order. `js_timer_epoch()` is read-only (returns `Option<u32>`), so
        // do the `@fieldParentPtr` dispatch here — `TimeoutObject` /
        // `ImmediateObject` are this-crate types.
        // SAFETY: tag invariant — when `tag == TimeoutObject`/`ImmediateObject`,
        // `timer` is the `event_loop_timer` field of the named container.
        let flags_slot: Option<*mut TimerFlags> = match timer_ref.tag {
            EventLoopTimerTag::TimeoutObject => unsafe {
                let parent = (timer as *mut u8)
                    .sub(offset_of!(TimeoutObject, event_loop_timer))
                    .cast::<TimeoutObject>();
                Some(core::ptr::addr_of_mut!((*parent).internals.flags))
            },
            EventLoopTimerTag::ImmediateObject => unsafe {
                let parent = (timer as *mut u8)
                    .sub(offset_of!(ImmediateObject, event_loop_timer))
                    .cast::<ImmediateObject>();
                Some(core::ptr::addr_of_mut!((*parent).internals.flags))
            },
            // Spec EventLoopTimer.zig:157-160 — `AbortSignal.Timeout` stores
            // `flags` directly (not under `.internals`).
            EventLoopTimerTag::AbortSignalTimeout => unsafe {
                let parent = (timer as *mut u8)
                    .sub(offset_of!(AbortSignalTimeout, event_loop_timer))
                    .cast::<AbortSignalTimeout>();
                Some(core::ptr::addr_of_mut!((*parent).flags))
            },
            _ => None,
        };
        if let Some(flags) = flags_slot {
            // Zig: `epoch: u25` with `+%= 1`.
            self.epoch = self.epoch.wrapping_add(1) & ((1u32 << 25) - 1);
            // SAFETY: `flags` points into the live container computed above.
            unsafe { (*flags).set_epoch(self.epoch) };
        }

        self.insert_lock_held(timer);
        self.lock.unlock();
    }

    fn is_date_timer_active(&self) -> bool {
        self.date_header_timer.event_loop_timer.state == EventLoopTimerState::ACTIVE
    }

    /// Called from `EventLoop::auto_tick` to compute the epoll/kqueue timeout.
    /// Returns `true` if `spec` was written.
    ///
    /// PORT NOTE (b2): `vm` is erased per §Dispatch (the caller is in
    /// `bun_jsc::event_loop` which can't name `bun_runtime`). The two reads
    /// it needs — `event_loop.immediate_tasks.len()` and the QUIC tick — are
    /// passed in pre-computed until the cycle is broken.
    pub fn get_timeout(
        &mut self,
        spec: &mut Timespec,
        has_pending_immediate: bool,
        quic_next_tick_us: Option<i64>,
        vm: *mut (), /* erased *mut VirtualMachine, forwarded to fire() */
    ) -> bool {
        #[cfg(unix)]
        if has_pending_immediate {
            *spec = Timespec { sec: 0, nsec: 0 };
            return true;
        }
        #[cfg(not(unix))]
        let _ = has_pending_immediate;

        // PORT NOTE (§Forbidden aliased-&mut): the WTFTimer arm below calls
        // `(*min).fire(...)` → `WTFTimer__fire` → C++ may call back into
        // `WTFTimer__update` → `(*runtime_state()).timer.update(...)`, minting
        // a fresh `&mut All` to this same allocation while the outer
        // `&mut self` is live → aliased-`&mut` UB. Mirror `drain_timers`:
        // convert `self` to a raw pointer up-front and form *short-lived*
        // `&mut *this` borrows only around `peek()`/`delete_min()`, dropping
        // them before `fire()` so no `&mut All` is held across the re-entrant
        // call. Spec Timer.zig:247 takes `*All` (raw pointer) for the same
        // reason.
        //
        // TODO(b2): same caveat as `drain_timers` — the call-site auto-ref
        // still creates a `&mut All` for the call frame; switch the signature
        // to `this: *mut Self` (see jsc_hooks.rs:525).
        let this: *mut Self = self;
        let mut maybe_now: Option<Timespec> = None;
        loop {
            // SAFETY: `this` derived from `&mut self`; short-lived exclusive
            // borrow scoped to this `peek()` call only.
            let Some(min) = (unsafe { &mut *this }).timers.peek() else {
                break;
            };
            // SAFETY: peek returns a live heap node.
            // PORT NOTE (§Forbidden aliased-&mut): `delete_min()` writes
            // `(*min).heap` through a fresh `&mut EventLoopTimer`, so we must
            // NOT hold a `&mut *min` across it. Read `next`/`tag` via raw
            // deref and fire via raw deref (mirroring `drain_timers`).
            let (min_next_sec, min_next_nsec, min_tag) = unsafe {
                ((*min).next.sec, (*min).next.nsec, (*min).tag)
            };
            let now = *maybe_now.get_or_insert_with(|| {
                Timespec::now(TimespecMockMode::AllowMockedTime)
            });

            // bun_event_loop carries its own Timespec stub; compare field-wise.
            let min_next = Timespec { sec: min_next_sec, nsec: min_next_nsec };
            match now.order(&min_next) {
                core::cmp::Ordering::Greater | core::cmp::Ordering::Equal => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if min_tag == EventLoopTimerTag::WTFTimer {
                        // SAFETY: short-lived `&mut All` scoped to
                        // `delete_min()`; dropped before `fire()`.
                        let _ = unsafe { &mut *this }.timers.delete_min();
                        let el_now = ElTimespec { sec: now.sec, nsec: now.nsec };
                        // SAFETY: `min` was just popped and is live; no `&mut`
                        // to `All` or to `*min` is held across `fire()`, which
                        // may re-enter `(*runtime_state()).timer`.
                        unsafe { (*min).fire(&el_now, vm) };
                        continue;
                    }
                    *spec = Timespec { sec: 0, nsec: 0 };
                    return true;
                }
                core::cmp::Ordering::Less => {
                    *spec = min_next.duration(&now);
                    if let Some(us) = quic_next_tick_us {
                        if us >= 0 {
                            Self::clamp_to_quic(spec, us);
                        }
                    }
                    return true;
                }
            }
        }

        if let Some(us) = quic_next_tick_us {
            if us >= 0 {
                *spec = Timespec {
                    sec: us / US_PER_S,
                    nsec: (us % US_PER_S) * NS_PER_US,
                };
                return true;
            }
        }
        false
    }

    fn clamp_to_quic(spec: &mut Timespec, us: i64) {
        let cur_us = spec.sec * US_PER_S + spec.nsec / NS_PER_US;
        if us < cur_us {
            *spec = Timespec {
                sec: us / US_PER_S,
                nsec: (us % US_PER_S) * NS_PER_US,
            };
        }
    }

    /// Pop the next due timer (under lock). `now` is filled lazily on first
    /// call so we don't pay for `clock_gettime` when the heap is empty.
    fn next(&mut self, has_set_now: &mut bool, now: &mut Timespec) -> Option<*mut EventLoopTimer> {
        self.lock.lock();
        let out = (|| {
            let timer = self.timers.peek()?;
            if !*has_set_now {
                *now = Timespec::now(TimespecMockMode::AllowMockedTime);
                *has_set_now = true;
            }
            // SAFETY: peek returns a live heap node
            let next = unsafe { &(*timer).next };
            if (Timespec { sec: next.sec, nsec: next.nsec }).greater(now) {
                return None;
            }
            let deleted = self.timers.delete_min().expect("peek succeeded");
            debug_assert!(core::ptr::eq(deleted, timer));
            Some(timer)
        })();
        self.lock.unlock();
        out
    }

    pub fn drain_timers(&mut self, vm: *mut () /* erased *mut VirtualMachine */) {
        // PORT NOTE (§Forbidden aliased-&mut): spec Timer.zig:346-354 takes
        // `*All` (raw pointer) because fired handlers re-enter `vm.timer`
        // (e.g. setInterval reschedule → `vm.timer.update(...)`, `cancel()` →
        // `vm.timer.remove(...)`). In Rust those re-entrant calls resolve to
        // `(*runtime_state()).timer.{update,remove}()`, minting a fresh
        // `&mut All` to this same allocation while the outer `&mut self` is
        // live → UB under Stacked Borrows. Convert `self` to a raw pointer
        // up-front and form a *short-lived* `&mut` only around `next()`,
        // dropping it before `fire()` so no `&mut All` is held across the
        // re-entrant call (mirroring the raw-ptr pattern in
        // `TimerObjectInternals::run_immediate_task`).
        //
        // TODO(b2): the call-site auto-ref at jsc_hooks.rs (`(*state).timer
        // .drain_timers(...)`) still creates a `&mut All` for the call frame
        // itself; switch it to `All::drain_timers(core::ptr::addr_of_mut!(
        // (*state).timer), vm)` and change this signature to `this: *mut Self`.
        let this: *mut Self = self;
        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        loop {
            // SAFETY: `this` derived from `&mut self`; short-lived exclusive
            // borrow scoped to this `next()` call only — dropped before fire().
            let Some(t) = (unsafe { &mut *this }).next(&mut has_set_now, &mut now) else {
                break;
            };
            // PORT NOTE: re-pack into bun_event_loop's local Timespec stub
            // until the lower tier unifies on bun_core::Timespec.
            let el_now = ElTimespec { sec: now.sec, nsec: now.nsec };
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            // `fire` dispatches through the FIRE_TIMER hook (§Dispatch hot
            // path) and may re-enter `(*runtime_state()).timer` — no `&mut`
            // to `All` is live here.
            unsafe { (*t).fire(&el_now, vm) };
        }
    }

    pub fn increment_immediate_ref(&mut self, delta: i32, uws_loop: *mut bun_uws_sys::Loop) {
        let old = self.immediate_ref_count;
        let new = old + delta;
        self.immediate_ref_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.ref_();
            // TODO(b2-blocked): Windows uv_idle path — needs VirtualMachine ptr.
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.unref();
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }

    pub fn increment_timer_ref(&mut self, delta: i32, uws_loop: *mut bun_uws_sys::Loop) {
        let old = self.active_timer_count;
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.ref_();
            #[cfg(windows)]
            self.uv_timer.ref_();
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.unref();
            #[cfg(windows)]
            self.uv_timer.unref();
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }
}

// ─── JS-facing surface (gated on bun_jsc) ────────────────────────────────────
// `set_timeout`/`set_interval`/`set_immediate`/`sleep`/`clear_*` and the
// host_fn export thunks all need `JSGlobalObject::bun_vm()`,
// `JSValue::to_number()`, `bun_str::String::transfer_to_js()`, etc.
// Kept gated until `bun_jsc.workspace = true` is re-enabled.

// TODO(port): JS-facing surface (`set_timeout`/`set_interval`/...) lives in
// `Timer.rs` and is wired via `#[cfg(feature = "jsc")]` once `bun_jsc` is
// re-enabled. The placeholder `include!` was non-compilable; removed.
impl All {}

// ─── enums / value types ─────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum TimeoutWarning {
    TimeoutOverflowWarning,
    TimeoutNegativeWarning,
    TimeoutNaNWarning,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CountdownOverflowBehavior {
    /// `setTimeout` and friends.
    OneMs,
    /// `Bun.sleep`.
    Clamp,
}

// LAYERING: `Kind`/`KindBig` moved DOWN to `bun_event_loop` so `TimerFlags`
// (also moved down) can name them without a `bun_runtime` dep — needed by
// `bun_jsc::abort_signal::Timeout.flags`. `Kind::big()` lives next to the
// type so `TimeoutObject`/`TimerObjectInternals` can call it as a method.
pub use bun_event_loop::EventLoopTimer::{Kind, KindBig};

/// Sized to be the same as one pointer.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ID {
    pub id: i32,
    pub kind: KindBig,
}
impl Default for ID {
    fn default() -> Self {
        Self { id: 0, kind: KindBig::SetTimeout }
    }
}
impl ID {
    #[inline]
    pub fn async_id(self) -> u64 {
        // SAFETY: ID is #[repr(C)] {i32, u32-repr enum} = 8 bytes
        unsafe { core::mem::transmute::<ID, u64>(self) }
    }
    #[inline]
    pub fn repeats(self) -> bool {
        self.kind == KindBig::SetInterval
    }
}

const US_PER_S: i64 = 1_000_000;
const NS_PER_US: i64 = 1_000;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/Timer.zig (703 lines)
//   confidence: medium (B-2 struct/state un-gate)
//   notes:      All/Maps/Kind/ID/TimerHeap/FakeTimers real; insert/remove/
//               update/get_timeout/drain_timers real (vm erased per §Dispatch).
//               TimerHeap is the real bun_io::heap::Intrusive pairing-heap
//               (meld/remove/combine_siblings) — multi-timer setTimeout works.
//               JS host fns gated on bun_jsc.
// ──────────────────────────────────────────────────────────────────────────
