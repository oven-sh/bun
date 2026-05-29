//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.
//!
//! Structs + state machines are real. JS-facing method bodies
//! (`set_timeout`/`clear_timer`/`warn_invalid_countdown`/etc.) remain
//! ``-gated on `bun_jsc` (commented out in Cargo.toml).
//! `All::insert`/`remove`/`update`/`get_timeout`/`drain_timers` — the surface
//! `EventLoop::auto_tick` blocks on — are real.
//!
//! Full earlier drafts are preserved gated under ` mod *_draft`
//! so this file can be diffed against `Timer.rs` once `bun_jsc` is green.

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Mutex;

// Low-tier timer node + tag (per §Dispatch hot-path list, the `match tag`
// dispatch lives in this crate; `bun_event_loop` only stores `(tag, ptr)`).
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;
pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

use crate::jsc::JSValue;

#[path = "Timer.rs"]
pub mod timer;

macro_rules! impl_timer_object {
    ($T:ident, $tag:ident, $js_name:literal) => {
        #[::bun_jsc::JsClass(name = $js_name)]
        pub struct $T {
            pub ref_count: ::bun_ptr::RefCount<Self>,
            pub event_loop_timer: super::EventLoopTimer,
            pub internals: super::TimerObjectInternals,
        }

        ::bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer);

        // `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive
        // single-thread refcount mixin.
        impl ::bun_ptr::RefCounted for $T {
            type DestructorCtx = ();
            #[inline]
            unsafe fn get_ref_count(this: *mut Self) -> *mut ::bun_ptr::RefCount<Self> {
                // SAFETY: caller contract — `this` points to a live `Self`.
                unsafe { &raw mut (*this).ref_count }
            }
            #[inline]
            unsafe fn destructor(this: *mut Self, _ctx: ()) {
                // SAFETY: `raw_count == 0` ⇒ unique ownership; `deinit`
                // consumes the `heap::alloc`'d allocation from `init_with()`.
                unsafe { Self::deinit(this) }
            }
        }

        impl ::core::default::Default for $T {
            fn default() -> Self {
                Self {
                    ref_count: ::bun_ptr::RefCount::init(),
                    // Zig: `.{ .next = .epoch, .tag = .$T }` — `init_paused`
                    // is exactly that (next=EPOCH, state=PENDING, heap zeroed).
                    event_loop_timer: super::EventLoopTimer::init_paused(
                        super::EventLoopTimerTag::$tag,
                    ),
                    // PORT NOTE: Zig left `internals = undefined` and assigned
                    // in `init()`; Rust default-constructs then overwrites —
                    // same observable behavior.
                    internals: super::TimerObjectInternals::default(),
                }
            }
        }

        impl $T {
            // Zig: `pub const ref = RefCount.ref; pub const deref = RefCount.deref;`
            // — re-export the mixin's ops as inherent fns so
            // `TimerObjectInternals`'s `container_of` dispatch resolves.

            /// Increment the intrusive refcount.
            ///
            /// # Safety
            /// `this` must point to a live, `heap::alloc`-allocated `Self`.
            #[inline]
            pub unsafe fn ref_(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { ::bun_ptr::RefCount::<Self>::ref_(this) }
            }

            /// Decrement the intrusive refcount; on zero runs `deinit` (drops
            /// `internals`, frees the `Box`). After this returns `this` may
            /// dangle.
            ///
            /// # Safety
            /// `this` must point to a live, `heap::alloc`-allocated `Self`.
            #[inline]
            pub unsafe fn deref(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { ::bun_ptr::RefCount::<Self>::deref(this) }
            }

            pub fn init_with(
                global: &::bun_jsc::JSGlobalObject,
                id: i32,
                kind: super::Kind,
                interval: u32,
                callback: ::bun_jsc::JSValue,
                arguments: ::bun_jsc::JSValue,
            ) -> ::bun_jsc::JSValue {
                let payload: *mut Self =
                    ::bun_core::heap::into_raw(::std::boxed::Box::new(Self::default()));
                // SAFETY: `to_js_ptr` is the `#[JsClass]`-generated `*__create`
                // shim; `payload` is a fresh heap allocation whose ownership
                // transfers to the GC wrapper.
                let js_value = unsafe { Self::to_js_ptr(payload, global) };
                // Zig codegen: `bun.assert(value__.as($T).? == this)` —
                // round-trip ABI check.
                debug_assert!(
                    <Self as ::bun_jsc::JsClass>::from_js(js_value) == Some(payload),
                    concat!($js_name, "__create ABI mismatch"),
                );
                let _keep = ::bun_jsc::EnsureStillAlive(js_value);
                // SAFETY: `payload` was just allocated above and is exclusively
                // owned here; `internals.init()` writes every field.
                unsafe {
                    (*payload).internals.init(
                        js_value, global, id, kind, interval, callback, arguments,
                    );
                }
                if global.bun_vm().as_mut().is_inspector_enabled() {
                    ::bun_jsc::Debugger::did_schedule_async_call(
                        global,
                        ::bun_jsc::Debugger::AsyncCallType::DOMTimer,
                        super::ID { id, kind: kind.big() }.async_id(),
                        kind != super::Kind::SetInterval,
                    );
                }
                js_value
            }

            /// Called via `RefCounted::destructor` when the refcount reaches
            /// zero. Not `impl Drop`: this fn frees the backing `Box` itself
            /// (Zig: `bun.destroy(self)`).
            ///
            /// # Safety
            /// `this` must be the unique owner (refcount == 0) of a
            /// `heap::alloc`'d `Self`.
            unsafe fn deinit(this: *mut Self) {
                // SAFETY: refcount has reached zero ⇒ unique reference.
                unsafe {
                    (*this).internals.deinit();
                    drop(::bun_core::heap::take(this));
                }
            }

            // C-ABI shim (`${name}Class__construct`) is emitted by
            // `#[bun_jsc::JsClass]` via `host_fn_construct_result`; do not also
            // annotate with `#[host_fn]` here.
            pub fn constructor(
                global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<*mut Self> {
                Err(global.throw(format_args!(concat!($js_name, " is not constructible"))))
            }

            #[::bun_jsc::host_fn(method)]
            pub fn to_primitive(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.to_primitive()
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_ref(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.do_ref(global, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_unref(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.do_unref(global, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn has_ref(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.has_ref()
            }

            /// `.classes.ts` `finalize: true` — runs on the mutator thread
            /// during lazy sweep. Do not touch any `JSValue`/`Strong` content.
            pub fn finalize(self: ::std::boxed::Box<Self>) {
                // Refcounted via `internals`: `internals.finalize()` derefs the
                // intrusive count; allocation may outlive this call if other
                // refs remain, so hand ownership back to the raw refcount.
                ::bun_core::heap::release(self).internals.finalize()
            }

            #[::bun_jsc::host_fn(getter)]
            pub fn get_destroyed(
                this: &Self,
                _global: &::bun_jsc::JSGlobalObject,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                Ok(::bun_jsc::JSValue::from(this.internals.get_destroyed()))
            }

            #[::bun_jsc::host_fn(method)]
            pub fn dispose(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                this.internals.cancel(global.bun_vm_ptr());
                Ok(::bun_jsc::JSValue::UNDEFINED)
            }
        }
    };
}
pub(crate) use impl_timer_object;

#[path = "TimeoutObject.rs"]
pub mod timeout_object;

#[path = "ImmediateObject.rs"]
pub mod immediate_object;

#[path = "DateHeaderTimer.rs"]
mod date_header_timer_draft;

#[path = "EventLoopDelayMonitor.rs"]
mod event_loop_delay_monitor_draft;

/// `void` context for the heap comparator — Zig passes `{}`.
#[derive(Default)]
pub(crate) struct TimerHeapCtx;

impl bun_io::heap::HeapContext<EventLoopTimer> for TimerHeapCtx {
    #[inline]
    unsafe fn less(&self, a: *mut EventLoopTimer, b: *mut EventLoopTimer) -> bool {
        // SAFETY: `Intrusive` only ever calls `less` with non-null nodes that
        // are live members of the heap (caller invariant on insert/meld).
        EventLoopTimer::less((), unsafe { &*a }, unsafe { &*b })
    }
}

#[derive(Default)]
pub struct TimerHeap(bun_io::heap::Intrusive<EventLoopTimer, TimerHeapCtx>);

impl TimerHeap {
    #[inline]
    pub(crate) fn peek(&self) -> Option<*mut EventLoopTimer> {
        let r = self.0.peek();
        if r.is_null() { None } else { Some(r) }
    }

    /// # Safety
    /// `v` is a valid, exclusively-owned node not currently in any heap
    /// (its `IntrusiveField` links are null).
    #[inline]
    pub(crate) unsafe fn insert(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.insert(v) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    pub(crate) unsafe fn remove(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.remove(v) };
    }

    #[inline]
    pub(crate) fn delete_min(&mut self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live until popped (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.delete_min() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub(crate) fn find_max(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        let r = unsafe { self.0.find_max() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub(crate) fn count(&self) -> usize {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live for the heap's lifetime (intrusive invariant maintained by `All`).
        unsafe { self.0.count() }
    }
}

/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
pub(crate) type TimeoutMap = ArrayHashMap<i32, *mut EventLoopTimer>;

#[derive(Default)]
pub struct Maps {
    pub set_timeout: TimeoutMap,
    pub set_interval: TimeoutMap,
    pub set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    pub(crate) fn get(&mut self, kind: Kind) -> &mut TimeoutMap {
        match kind {
            Kind::SetTimeout => &mut self.set_timeout,
            Kind::SetInterval => &mut self.set_interval,
            Kind::SetImmediate => &mut self.set_immediate,
        }
    }
}

pub use crate::test_runner::timers::fake_timers::FakeTimers;

pub struct DateHeaderTimer {
    pub event_loop_timer: EventLoopTimer,
}
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DateHeaderTimer),
        }
    }
}
impl DateHeaderTimer {
    #[inline]
    fn timer_all() -> *mut All {
        crate::jsc_hooks::timer_all()
    }

    /// Spec DateHeaderTimer.zig `run` — refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub(crate) fn run(&mut self, vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        // `uws_loop_mut` is the audited safe accessor (loop owned by the VM,
        // separate allocation from `RuntimeState.timer` so no aliasing with
        // `&mut self`).
        let loop_ = vm.uws_loop_mut();
        let now = Timespec::now(TimespecMockMode::AllowMockedTime);

        // Record when we last ran it.
        self.event_loop_timer.next = ElTimespec {
            sec: now.sec,
            nsec: now.nsec,
        };

        // updateDate() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count > 0 {
            // Reschedule it automatically for 1 second later.
            let next = now.add_ms(1000);
            self.event_loop_timer.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
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
    #[inline]
    fn timer_all() -> *mut All {
        crate::jsc_hooks::timer_all()
    }

    pub(crate) fn enable(
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
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: single JS thread; `All::insert` only touches `lock`/`timers`/
        // `fake_timers`, disjoint from `event_loop_delay` which `self` aliases.
        unsafe { (*Self::timer_all()).insert(elt) };
    }

    pub(crate) fn disable(&mut self, _vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        if !self.enabled {
            return;
        }
        self.enabled = false;
        self.js_histogram = JSValue::default();
        self.last_fire_ns = 0;
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).remove(elt) };
    }

    /// Spec EventLoopDelayMonitor.zig `onFire` — record `now - last_fire_ns`
    /// into the JS histogram and reschedule.
    pub(crate) fn on_fire(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        if !self.enabled || self.js_histogram.is_empty() {
            return;
        }

        let now_ns = now.ns();
        if self.last_fire_ns > 0 {
            let expected_ns = u64::try_from(self.resolution_ms)
                .expect("int cast")
                .saturating_mul(1_000_000);
            let actual_ns = now_ns - self.last_fire_ns;

            if actual_ns > expected_ns {
                let delay_ns =
                    i64::try_from(actual_ns.saturating_sub(expected_ns)).expect("int cast");
                unsafe extern "C" {
                    safe fn JSNodePerformanceHooksHistogram_recordDelay(
                        histogram: JSValue,
                        delay_ns: i64,
                    );
                }
                JSNodePerformanceHooksHistogram_recordDelay(self.js_histogram, delay_ns);
            }
        }

        self.last_fire_ns = now_ns;

        // Reschedule
        let next = Timespec {
            sec: now.sec,
            nsec: now.nsec,
        }
        .add_ms(i64::from(self.resolution_ms));
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
        // SAFETY: see `enable` — disjoint-field access on `All`.
        unsafe { (*Self::timer_all()).insert(elt) };
    }
}

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject (struct-only) ───
// `Flags` is the real packed-u32 state machine; method bodies that touch
// `bun_jsc::JsRef`/`Debugger` stay gated.

pub mod timer_object_internals;
pub use timer_object_internals::{Flags as TimerFlags, TimerObjectInternals};

pub use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub use self::immediate_object::ImmediateObject;
pub use self::timeout_object::TimeoutObject;

/// Spec EventLoopTimer.zig:145 `jsTimerInternalsFlags` — recover the
/// [`TimerFlags`] slot for the three JS-timer container tags
/// (`TimeoutObject` / `ImmediateObject` / `AbortSignalTimeout`), else `None`.
///
/// Returns a raw `NonNull` so the caller decides read vs. write:
/// [`EventLoopTimer::less`] reads `.epoch()` on the heap-compare hot path;
/// [`All::update`] writes `.set_epoch()` under the timer lock. The two
/// `internals.flags` arms store `Cell<TimerFlags>`; `Cell<T>` is
/// `#[repr(transparent)]` so the `addr_of!` → `.cast()` is layout-sound.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] whose `tag` was set at
/// construction and never re-tagged (the JS-timer-tag invariant). When the
/// tag matches, `t` is the `event_loop_timer` field of the named container
/// with whole-container provenance.
#[inline]
pub(crate) unsafe fn js_timer_flags_ptr(
    t: *const EventLoopTimer,
) -> Option<core::ptr::NonNull<TimerFlags>> {
    use core::ptr::{NonNull, addr_of};
    // SAFETY: caller contract — `t` is live; tag invariant per fn docs.
    unsafe {
        let p: *const TimerFlags = match (*t).tag {
            EventLoopTimerTag::TimeoutObject => {
                let parent = TimeoutObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            EventLoopTimerTag::ImmediateObject => {
                let parent = ImmediateObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            // Spec EventLoopTimer.zig:157-160 — `AbortSignal.Timeout` stores
            // `flags` directly (not under `.internals`, not `Cell`-wrapped).
            EventLoopTimerTag::AbortSignalTimeout => {
                let parent = AbortSignalTimeout::from_timer_ptr(t);
                addr_of!((*parent).flags)
            }
            _ => return None,
        };
        Some(NonNull::new_unchecked(p.cast_mut()))
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
            uv_timer: bun_core::ffi::zeroed(),
            warned_negative_number: false,
            warned_not_number: false,
            epoch: 0,
            immediate_ref_count: 0,
            #[cfg(windows)]
            uv_idle: bun_core::ffi::zeroed(),
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
            #[cfg(windows)]
            self.ensure_uv_timer();
        }
    }

    #[cfg(windows)]
    fn ensure_uv_timer(&mut self) {
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "ensure_uv_timer: called off the owning JS thread; TLS loop/VM would diverge from vm.event_loop_handle",
        );
        if self.uv_timer.data.is_null() {
            self.uv_timer.init(uv::Loop::get());
            self.uv_timer.data =
                bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
            self.uv_timer.unref();
        }

        if let Some(timer) = self.timers.peek() {
            // SAFETY: `uv_timer.data` is non-null past the lazy-init block, so
            // `uv_timer_init` has run and the handle's `loop` field points at
            // the owning VM's live `uv_loop_t` (== `vm.uvLoop()` per spec).
            unsafe { uv::uv_update_time(self.uv_timer.get_loop()) };
            let now = Timespec::now(TimespecMockMode::ForceRealTime);
            // SAFETY: `peek` returns a live heap node.
            let next = unsafe { &(*timer).next };
            let next_ts = Timespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            let wait = if next_ts.greater(&now) {
                next_ts.duration(&now)
            } else {
                Timespec { sec: 0, nsec: 0 }
            };

            // minimum 1ms
            // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
            let wait_ms = core::cmp::max(1, wait.ms_unsigned());

            self.uv_timer.start(wait_ms, 0, Some(Self::on_uv_timer));

            if self.active_timer_count > 0 {
                self.uv_timer.ref_();
            } else {
                self.uv_timer.unref();
            }
        }
    }

    #[cfg(windows)]
    extern "C" fn on_uv_timer(uv_timer_t: *mut uv::Timer) {
        // SAFETY: `uv_timer_t` is the address of `All.uv_timer` (libuv passes
        // back exactly the handle pointer we registered in `ensure_uv_timer`);
        // recover the containing `All` via container_of.
        let all: *mut All = unsafe { bun_core::from_field_ptr!(All, uv_timer, uv_timer_t) };
        // SAFETY: `data` was set to the VM ptr in `ensure_uv_timer` (non-null).
        let vm: *mut () = unsafe { (*uv_timer_t).data.cast() };
        // SAFETY: callback fires on the JS thread (libuv invokes on the loop's
        // thread); `all` is live for the VM lifetime. `drain_timers` may
        // re-enter `(*runtime_state()).timer` — it forms only short-lived
        // `&mut All` around heap pop/peek, so the raw-ptr deref here is sound.
        unsafe { (*all).drain_timers(vm) };
        // SAFETY: see above; re-arm for the next-soonest deadline (if any).
        unsafe { (*all).ensure_uv_timer() };
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
                // can't remove a timer that was not inserted
                // Zig: gated on `bun.Environment.ci_assert`.
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
    ///
    /// # Safety
    /// `timer` must point to a live `EventLoopTimer` with whole-container
    /// provenance for its tag (see [`js_timer_flags_ptr`]).
    // `timer` must stay `*mut`: the body forms only short-lived `&mut *timer`
    // so re-entrant `remove_lock_held` does not alias an outstanding `&mut`
    // (see PORT NOTEs below); contract is documented in `# Safety`.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        timer_ref.next.sec = time.sec;
        timer_ref.next.nsec = time.nsec;

        // Spec Timer.zig:117-120: bump the global epoch and write it back
        // into the per-timer flags so equal-deadline JS timers fire in
        // refresh order.
        // SAFETY: `timer` is live (caller contract); `timer_ref`'s last use
        // is above so the raw `(*timer).tag` read inside is SB-clean.
        if let Some(flags) = unsafe { js_timer_flags_ptr(timer) } {
            // Zig: `epoch: u25` with `+%= 1`.
            self.epoch = self.epoch.wrapping_add(1) & ((1u32 << 25) - 1);
            // SAFETY: exclusive under `self.lock`; `flags` points into the
            // live container recovered above.
            unsafe { (*flags.as_ptr()).set_epoch(self.epoch) };
        }

        self.insert_lock_held(timer);
        self.lock.unlock();
    }

    /// Called from `EventLoop::auto_tick` to compute the epoll/kqueue timeout.
    /// Returns `true` if `spec` was written.
    ///
    /// PORT NOTE (b2): `vm` is erased per §Dispatch (the caller is in
    /// `bun_jsc::event_loop` which can't name `bun_runtime`). The two reads
    /// it needs — `event_loop.immediate_tasks.len()` and the QUIC tick — are
    /// passed in pre-computed until the cycle is broken.
    ///
    /// # Safety
    /// `vm` is the erased `*mut VirtualMachine` for the calling JS thread and
    /// must remain live across any `EventLoopTimer::fire` re-entry.
    // Forwards `vm` to `__bun_fire_timer` without dereferencing it;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
            let (min_next_sec, min_next_nsec, min_tag) =
                unsafe { ((*min).next.sec, (*min).next.nsec, (*min).tag) };
            let now =
                *maybe_now.get_or_insert_with(|| Timespec::now(TimespecMockMode::AllowMockedTime));

            // bun_event_loop carries its own Timespec stub; compare field-wise.
            let min_next = Timespec {
                sec: min_next_sec,
                nsec: min_next_nsec,
            };
            match now.order(&min_next) {
                core::cmp::Ordering::Greater | core::cmp::Ordering::Equal => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if min_tag == EventLoopTimerTag::WTFTimer {
                        // SAFETY: short-lived `&mut All` scoped to
                        // `delete_min()`; dropped before `fire()`.
                        let _ = unsafe { &mut *this }.timers.delete_min();
                        let el_now = ElTimespec {
                            sec: now.sec,
                            nsec: now.nsec,
                        };
                        // SAFETY: `min` was just popped and is live; no `&mut`
                        // to `All` or to `*min` is held across `fire()`, which
                        // may re-enter `(*runtime_state()).timer`.
                        unsafe { EventLoopTimer::fire(min, &el_now, vm) };
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
            if (Timespec {
                sec: next.sec,
                nsec: next.nsec,
            })
            .greater(now)
            {
                return None;
            }
            let deleted = self.timers.delete_min().expect("peek succeeded");
            debug_assert!(core::ptr::eq(deleted, timer));
            Some(timer)
        })();
        self.lock.unlock();
        out
    }

    /// # Safety
    /// `vm` is the erased `*mut VirtualMachine` for the calling JS thread and
    /// must remain live across any `EventLoopTimer::fire` re-entry.
    // Forwards `vm` to `__bun_fire_timer` without dereferencing it;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn drain_timers(&mut self, vm: *mut () /* erased *mut VirtualMachine */) {
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
            let el_now = ElTimespec {
                sec: now.sec,
                nsec: now.nsec,
            };
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            // `fire` dispatches through the FIRE_TIMER hook (§Dispatch hot
            // path) and may re-enter `(*runtime_state()).timer` — no `&mut`
            // to `All` is live here.
            unsafe { EventLoopTimer::fire(t, &el_now, vm) };
        }
    }

    /// # Safety
    /// `uws_loop` must point to the calling VM's live uws loop.
    // `uws_loop` is an FFI handle held as `*mut` by every caller; contract is
    // documented in `# Safety` above. Cannot be `&mut` without breaking the
    // out-of-file call sites that hold raw pointers.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn increment_immediate_ref(&mut self, delta: i32, uws_loop: *mut bun_uws_sys::Loop) {
        let old = self.immediate_ref_count;
        let new = old + delta;
        self.immediate_ref_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.ref_();
            #[cfg(windows)]
            {
                // Spec Timer.zig:168-179: lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                if self.uv_idle.data.is_null() {
                    self.uv_idle.init(uv::Loop::get());
                    // PORT NOTE: Zig stashes `vm` here; only used as a
                    // non-null "initialized" sentinel — never dereferenced.
                    self.uv_idle.data = bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr()
                        .cast::<core::ffi::c_void>();
                }
                self.uv_idle.start(Some(Self::on_uv_idle_noop));
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            // SAFETY: caller passes the VM's live uws loop
            unsafe { &mut *uws_loop }.unref();
            #[cfg(windows)]
            if !self.uv_idle.data.is_null() {
                self.uv_idle.stop();
            }
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }

    #[cfg(windows)]
    extern "C" fn on_uv_idle_noop(_: *mut uv::uv_idle_t) {
        // prevent libuv from polling forever
    }

    /// # Safety
    /// `uws_loop` must point to the calling VM's live uws loop.
    // `uws_loop` is an FFI handle held as `*mut` by every caller; contract is
    // documented in `# Safety` above. Cannot be `&mut` without breaking the
    // out-of-file call sites that hold raw pointers.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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

    /// VM-teardown pass: `cancel()` every `TimeoutObject` / `ImmediateObject`
    /// still linked in `timers` / `fake_timers.timers` so the in-heap `+1` ref
    /// and the JS pin (`this_value` Strong) are released before the GC sweep.
    ///
    /// Snapshots the heap under `lock` (cross-thread `WTFTimer__update` from
    /// the GC scheduler thread can race the DFS otherwise), then cancels each
    /// node *outside* the lock — `cancel()` re-enters [`All::remove`] which
    /// re-acquires `lock` (non-recursive `bun_threading::Mutex`).
    ///
    /// # Safety
    /// JS thread only, with the TLS `RuntimeState` still installed and `vm`
    /// the live per-thread VM. Must run BEFORE JSC teardown
    /// (`Zig__GlobalObject__destructOnExit` / `WebWorker__teardownJSCVM`) and
    /// BEFORE `runtime_state` is nulled — the GC sweep frees the
    /// `TimeoutObject` boxes whose `event_loop_timer` fields the heap nodes
    /// alias.
    pub unsafe fn cancel_all_timeout_objects(
        this: *mut Self,
        vm: *mut crate::jsc::virtual_machine::VirtualMachine,
    ) {
        let mut to_cancel: Vec<*const TimerObjectInternals> = Vec::new();
        let mut signal_timeouts: Vec<*mut AbortSignalTimeout> = Vec::new();
        let mut stack: Vec<*mut EventLoopTimer> = Vec::new();

        // SAFETY: `this` is the live per-thread `All`; `lock` guards both heap
        // roots against concurrent `WTFTimer` insert/remove from off-thread
        // (GC scheduler thread). Lock/unlock is manual (non-RAII Mutex).
        unsafe { (*this).lock.lock() };
        // SAFETY: `this` live; both roots are heap roots or null.
        let roots = unsafe { [(*this).timers.0.root, (*this).fake_timers.timers.0.root] };
        for root in roots {
            if !root.is_null() {
                stack.push(root);
            }
        }
        while let Some(node) = stack.pop() {
            // SAFETY: intrusive-heap invariant — every node reachable from a
            // root is a live `EventLoopTimer` while linked. Read-only walk.
            let (tag, child, next) =
                unsafe { ((*node).tag, (*node).heap.child, (*node).heap.next) };
            if !child.is_null() {
                stack.push(child);
            }
            if !next.is_null() {
                stack.push(next);
            }
            match tag {
                EventLoopTimerTag::TimeoutObject => {
                    // SAFETY: tag invariant — `node` IS the `event_loop_timer`
                    // field of a live `TimeoutObject`.
                    let parent = unsafe { TimeoutObject::from_timer_ptr(node) };
                    // SAFETY: `parent` points at the live `TimeoutObject` recovered
                    // above; `addr_of!` projects the in-bounds `internals` field.
                    to_cancel.push(unsafe { core::ptr::addr_of!((*parent).internals) });
                }
                EventLoopTimerTag::ImmediateObject => {
                    // SAFETY: tag invariant — see above.
                    let parent = unsafe { ImmediateObject::from_timer_ptr(node) };
                    // SAFETY: `parent` points at the live `ImmediateObject` recovered
                    // above; `addr_of!` projects the in-bounds `internals` field.
                    to_cancel.push(unsafe { core::ptr::addr_of!((*parent).internals) });
                }
                EventLoopTimerTag::AbortSignalTimeout => {
                    // SAFETY: tag invariant — `node` IS the `event_loop_timer`
                    // field of a live boxed `abort_signal::Timeout`.
                    signal_timeouts.push(unsafe { AbortSignalTimeout::from_timer_ptr(node) });
                }
                _ => {}
            }
        }
        // SAFETY: paired with the `lock()` above. Must release before the
        // cancel loop — `cancel()` re-enters `All::remove` which re-locks.
        unsafe { (*this).lock.unlock() };

        for internals in to_cancel {
            // SAFETY: each pointer was collected from the live heap; the
            // parent box is still alive (the +1 ref `cancel()` releases is
            // exactly the one keeping it pinned). `cancel()` may free the
            // parent on the final deref — never touched again.
            unsafe { (*internals).cancel(vm) };
        }

        for t in signal_timeouts {
            // SAFETY: each `t` was collected from the live heap above; the
            // `+1` we release here is the one keeping the signal (and thus
            // the box, via `m_timeout`) pinned. JS thread.
            unsafe {
                if (*t).event_loop_timer.state == EventLoopTimerState::ACTIVE {
                    (*this).remove(core::ptr::addr_of_mut!((*t).event_loop_timer));
                }
                let signal = (*t).signal;
                (*t).signal = core::ptr::null_mut();
                if !signal.is_null() {
                    crate::jsc::abort_signal::AbortSignal::opaque_ref(signal).unref();
                }
            }
        }
    }
}

// TODO(port): JS-facing surface (`set_timeout`/`set_interval`/...) lives in
// `Timer.rs` and is wired via `#[cfg(feature = "jsc")]` once `bun_jsc` is
// re-enabled. The placeholder `include!` was non-compilable; removed.

// ─── enums / value types ─────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum TimeoutWarning {
    TimeoutOverflowWarning,
    TimeoutNegativeWarning,
    TimeoutNaNWarning,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum CountdownOverflowBehavior {
    /// `setTimeout` and friends.
    OneMs,
    /// `Bun.sleep`.
    Clamp,
}

pub use bun_event_loop::EventLoopTimer::{Kind, KindBig};

/// Sized to be the same as one pointer.
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct ID {
    pub id: i32,
    pub kind: KindBig,
}
impl Default for ID {
    fn default() -> Self {
        Self {
            id: 0,
            kind: KindBig::SetTimeout,
        }
    }
}
impl ID {
    #[inline]
    pub(crate) fn async_id(self) -> u64 {
        let mut bytes = [0u8; 8];
        bytes[..4].copy_from_slice(&self.id.to_ne_bytes());
        bytes[4..].copy_from_slice(&(self.kind as u32).to_ne_bytes());
        u64::from_ne_bytes(bytes)
    }
}

const US_PER_S: i64 = bun_core::time::US_PER_S as i64;
const NS_PER_US: i64 = bun_core::time::NS_PER_US as i64;

// ported from: src/runtime/timer/Timer.zig
