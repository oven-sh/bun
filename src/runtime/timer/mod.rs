//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Guarded;

// Low-tier timer node + tag (per §Dispatch hot-path list, the `match tag`
// dispatch lives in this crate; `bun_event_loop` only stores `(tag, ptr)`).
pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};
// bun_event_loop carries a local `Timespec` stub instead of
// `bun_core::Timespec`. Same `{sec: i64, nsec: i64}` shape; alias it here so
// `fire()`/`next` accesses type-check without a transmute.
// TODO: remove this alias once the lower tier switches to `bun_core::Timespec`.
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;

use crate::jsc::JSValue;

// ─── JS-facing surface (`impl All { set_timeout / clear_* / … }`) ────────────
// Named `timer` so codegen (`generated_js2native.rs`) resolves
// `crate::timer::timer::internal_bindings::timer_clock_ms` per the
// `$rust(Timer.rs, …)` → `crate::<dir>::<file>` path-mapping.

#[path = "Timer.rs"]
pub mod timer;

// ─── impl_timer_object! ──────────────────────────────────────────────────────
// Shared scaffold for `TimeoutObject` / `ImmediateObject`: both are a
// `#[JsClass]` payload of `{ref_count, event_loop_timer, internals}` whose
// JS-facing host-fns are pure forwarders to `TimerObjectInternals`. The macro
// emits the parts shared by both types so each `*.rs` file holds only its
// type-specific surface (`init`, `do_refresh`, cached-prop accessors,
// `run_immediate_task`).
//
// Emits, at the call-site module path (so `#[JsClass]`/`#[host_fn]` produce the
// same extern symbol names as before — `Timeout__create`, `TimeoutPrototype__*`,
// `ImmediateClass__construct`, …):
//   - `#[bun_jsc::JsClass(name = $js_name)] pub struct $T { … }`
//   - `bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer)`
//   - `impl RefCounted for $T` (intrusive `ref_count` field, `deinit` destructor)
//   - `impl Default for $T` (`EventLoopTimer::init_paused(EventLoopTimerTag::$tag)`)
//   - `impl $T`: `ref_`/`deref`/`deinit`/`init_with`/`constructor`/`finalize`
//     and the forwarder host-fns `to_primitive`/`do_ref`/`do_unref`/`has_ref`/
//     `get_destroyed`/`dispose`.
//
// Type-specific items (`init`, `do_refresh`, `close`, cached-prop get/set,
// `run_immediate_task`) go in a *second* `impl $T` block in the caller's file.
//
// Paths in the body are written `super::…` / `::crate_name::…` because the
// macro is invoked *from the child module* (`super::impl_timer_object!(…)`),
// so `super` at the expansion site resolves back here to `timer/mod.rs`.
macro_rules! impl_timer_object {
    ($T:ident, $tag:ident, $js_name:literal) => {
        #[::bun_jsc::JsClass(name = $js_name)]
        #[derive(::bun_ptr::RefCounted)]
        pub struct $T {
            pub ref_count: ::bun_ptr::RefCount<Self>,
            pub event_loop_timer: super::EventLoopTimer,
            pub internals: super::TimerObjectInternals,
        }

        ::bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer);

        impl ::core::ops::Drop for $T {
            fn drop(&mut self) {
                // SAFETY: last ref gone; JS thread with RuntimeState installed.
                unsafe { self.internals.deinit() }
            }
        }

        impl ::core::default::Default for $T {
            fn default() -> Self {
                Self {
                    ref_count: ::bun_ptr::RefCount::init(),
                    // `init_paused`: next=EPOCH, state=PENDING, heap zeroed.
                    event_loop_timer: super::EventLoopTimer::init_paused(
                        super::EventLoopTimerTag::$tag,
                    ),
                    // Default-constructed here, then overwritten in `init()`.
                    internals: super::TimerObjectInternals::default(),
                }
            }
        }

        impl $T {
            // Re-export the refcount mixin's ops as inherent fns so
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

            /// Decrement the intrusive refcount; on zero drops the `Box`.
            /// After this returns `this` may dangle.
            ///
            /// # Safety
            /// `this` must point to a live, `heap::alloc`-allocated `Self`.
            #[inline]
            pub unsafe fn deref(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { ::bun_ptr::RefCount::<Self>::deref(this) }
            }

            /// Shared body of `TimeoutObject::init` / `ImmediateObject::init`:
            /// heap-allocate → `to_js_ptr` → `internals.init` →
            /// inspector `did_schedule_async_call`. The per-type `init` fn
            /// picks `kind`/`interval` and forwards here.
            pub fn init_with(
                global: &::bun_jsc::JSGlobalObject,
                id: i32,
                kind: super::Kind,
                interval: u32,
                callback: ::bun_jsc::JSValue,
                arguments: ::bun_jsc::JSValue,
            ) -> ::bun_jsc::JSValue {
                // Heap-allocate; `*mut Self` is the
                // `m_ctx` payload of the codegen'd JSCell wrapper. Ownership
                // transfers to the wrapper via `to_js_ptr`; freed by
                // `deref → deinit → heap::take`.
                let payload: *mut Self =
                    ::bun_core::heap::into_raw(::std::boxed::Box::new(Self::default()));
                // SAFETY: `to_js_ptr` is the `#[JsClass]`-generated `*__create`
                // shim; `payload` is a fresh heap allocation whose ownership
                // transfers to the GC wrapper.
                let js_value = unsafe { Self::to_js_ptr(payload, global) };
                // Round-trip ABI check.
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

            pub fn finalize(&self) {
                self.internals.finalize()
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

// ─── TimerHeap ───────────────────────────────────────────────────────────────
// Real intrusive pairing-heap (meld/remove/combine_siblings) implemented in
// `bun_io::heap::Intrusive`. `EventLoopTimer` now embeds the real
// `bun_io::heap::IntrusiveField` and impls `HeapNode` in its defining crate
// (`bun_event_loop`), so the orphan-rule block is gone. `TimerHeap` is a thin
// newtype that adapts `*mut T` ↔ `Option<*mut T>` for the existing call-sites
// (`All::insert/remove/next/get_timeout`).

/// Stateless context for the heap comparator.
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
    unsafe fn insert(&mut self, v: *mut EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.insert(v) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    unsafe fn remove(&mut self, v: *mut EventLoopTimer) {
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
    pub(crate) set_timeout: TimeoutMap,
    pub(crate) set_interval: TimeoutMap,
    pub(crate) set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    fn get(&mut self, kind: Kind) -> &mut TimeoutMap {
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
pub(crate) use crate::test_runner::timers::fake_timers::FakeTimers;

// ─── DateHeaderTimer / EventLoopDelayMonitor (struct-only) ───────────────────
// Method bodies (`enable`/`run`) call `vm.timer.*` and `vm.uws_loop()` which
// need `VirtualMachine.timer: All` (currently `()` in bun_jsc). Struct shape
// is real so `All` embeds them by value with the correct layout.

pub struct DateHeaderTimer {
    pub(crate) event_loop_timer: EventLoopTimer,
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

    /// Refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub(crate) fn run(&mut self, vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        // `uws_loop_mut` is the audited safe accessor (loop owned by the VM,
        // separate allocation from `RuntimeState.timer` so no aliasing with
        // `&mut self`).
        let loop_ = vm.uws_loop_mut();
        let now = Timespec::now(TimespecMockMode::ForceRealTime);

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
            // SAFETY: single JS thread; nothing `All::insert` touches
            // overlaps `date_header_timer`, which `self` aliases.
            unsafe { (*Self::timer_all()).insert(elt) };
        }
    }
}

pub struct EventLoopDelayMonitor {
    /// Weak, so a leaked monitor does not pin the retired `--isolate` realm.
    /// `stop_active_handles` drops it before `~VM` (`All` outlives the heap).
    histogram: bun_jsc::Weak<()>,
    pub(crate) event_loop_timer: EventLoopTimer,
    pub(crate) resolution_ms: i32,
    pub(crate) last_fire_ns: u64,
    pub(crate) enabled: bool,
}
impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            histogram: bun_jsc::Weak::default(),
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

    fn enable(
        &mut self,
        vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        histogram: JSValue,
        resolution_ms: i32,
    ) {
        self.disable();
        self.histogram = bun_jsc::Weak::create_passive(histogram, vm.global());
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
        // SAFETY: single JS thread; nothing `All::insert` touches overlaps
        // `event_loop_delay`, which `self` aliases.
        unsafe { (*Self::timer_all()).insert(elt) };
    }

    pub(crate) fn disable(&mut self) {
        if !self.enabled {
            return;
        }
        self.enabled = false;
        self.histogram = bun_jsc::Weak::default();
        self.last_fire_ns = 0;
        // FIRED (not linked) when called from `on_fire`.
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            let elt: *mut EventLoopTimer = &raw mut self.event_loop_timer;
            // SAFETY: see `enable` — disjoint-field access on `All`.
            unsafe { (*Self::timer_all()).remove(elt) };
        }
    }

    /// Record `now - last_fire_ns`
    /// into the JS histogram and reschedule.
    pub(crate) fn on_fire(
        &mut self,
        _vm: &mut bun_jsc::virtual_machine::VirtualMachine,
        now: &bun_event_loop::EventLoopTimer::Timespec,
    ) {
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        if !self.enabled {
            return;
        }
        let Some(histogram) = self.histogram.get() else {
            self.disable();
            return;
        };

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
                JSNodePerformanceHooksHistogram_recordDelay(histogram, delay_ns);
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

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject ─────────────────

pub mod timer_object_internals;
pub use timer_object_internals::{Flags as TimerFlags, TimerObjectInternals};

/// `jsc.WebCore.AbortSignal.Timeout` — real struct lives in `bun_jsc` (which
/// this crate depends on). Re-exported here so `All::update`'s
/// field-parent-pointer epoch-bump and `dispatch::fire_timer` resolve the same
/// `event_loop_timer`/`flags` offsets the low tier wrote.
pub use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub use self::immediate_object::ImmediateObject;
pub use self::timeout_object::TimeoutObject;

/// Recover the
/// [`TimerFlags`] slot for the three JS-timer container tags
/// (`TimeoutObject` / `ImmediateObject` / `AbortSignalTimeout`), else `None`.
///
/// Returns a raw `NonNull` so the caller decides read vs. write:
/// [`EventLoopTimer::less`] reads `.epoch()` on the heap-compare hot path;
/// [`All::update`] writes `.set_epoch()` on the JS thread. The two
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
            // `AbortSignal.Timeout` stores
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
pub(crate) use wtf_timer::WTFTimer;

// ─── All ─────────────────────────────────────────────────────────────────────

pub(crate) struct All {
    pub(crate) last_id: i32,
    pub(crate) thread_id: std::thread::ThreadId,
    pub(crate) timers: TimerHeap,
    pub(crate) active_timer_count: i32,
    /// `active_timer_count` went positive on `Bun.spawnSync`'s isolated loop.
    #[cfg(not(windows))]
    timer_refd_spawn_sync_loop: bool,
    #[cfg(windows)]
    pub(crate) uv_timer: bun_sys::windows::libuv::Timer,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub(crate) warned_negative_number: bool,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub(crate) warned_not_number: bool,
    /// Incremented when timers are scheduled or rescheduled. See
    /// TimerObjectInternals.epoch. Masked to 25 bits on increment.
    pub(crate) epoch: u32,
    pub(crate) immediate_ref_count: i32,
    /// `immediate_ref_count` went positive on `Bun.spawnSync`'s isolated loop.
    #[cfg(not(windows))]
    immediate_refd_spawn_sync_loop: bool,
    #[cfg(windows)]
    pub(crate) uv_idle: bun_sys::windows::libuv::uv_idle_t,
    pub(crate) event_loop_delay: EventLoopDelayMonitor,
    pub(crate) fake_timers: FakeTimers,
    pub(crate) maps: Maps,
    pub(crate) date_header_timer: DateHeaderTimer,
    pub(crate) wtf_timers: Guarded<TimerHeap>,
}

impl All {
    pub(crate) fn init() -> Self {
        Self {
            last_id: 1,
            thread_id: std::thread::current().id(),
            timers: TimerHeap::default(),
            active_timer_count: 0,
            #[cfg(not(windows))]
            timer_refd_spawn_sync_loop: false,
            #[cfg(windows)]
            uv_timer: bun_core::ffi::zeroed(),
            warned_negative_number: false,
            warned_not_number: false,
            epoch: 0,
            immediate_ref_count: 0,
            #[cfg(not(windows))]
            immediate_refd_spawn_sync_loop: false,
            #[cfg(windows)]
            uv_idle: bun_core::ffi::zeroed(),
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: Maps::default(),
            date_header_timer: DateHeaderTimer::default(),
            wtf_timers: Guarded::init(TimerHeap::default()),
        }
    }

    #[inline]
    fn assert_js_thread(&self) {
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "timer::All: non-WTF timers may only be touched on the owning JS thread",
        );
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn insert(&mut self, timer: *mut EventLoopTimer) {
        self.assert_js_thread();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        let tag = unsafe { (*timer).tag };
        debug_assert!(tag != EventLoopTimerTag::WTFTimer, "use wtf_arm");

        // Bump the global epoch into the per-timer flags so equal-deadline JS
        // timers (setTimeout/setInterval/AbortSignal.timeout) fire in insertion
        // order. Before heap insert: `EventLoopTimer::less` reads epoch as tiebreak.
        // SAFETY: `timer` is live (caller contract).
        if let Some(flags) = unsafe { js_timer_flags_ptr(timer) } {
            self.epoch = self.epoch.wrapping_add(1) & ((1u32 << 25) - 1);
            // SAFETY: `flags` points into the live container recovered above.
            unsafe { (*flags.as_ptr()).set_epoch(self.epoch) };
        }

        if self.fake_timers.is_active() && tag.allow_fake_timers() {
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

    /// The owning thread's JSC VM is gone (nothing schedules a WTFTimer any
    /// more) and the timeout objects are drained: hand the embedded
    /// `uv_timer_t`/`uv_idle_t` to `uv_close` so their nodes leave the loop's
    /// handle queue when the teardown closes the loop — before this struct's
    /// storage is freed.
    #[cfg(windows)]
    pub(crate) fn close_loop_handles_for_vm_teardown(&mut self) {
        unsafe extern "C" fn timer_closed(_: *mut uv::Timer) {}
        unsafe extern "C" fn idle_closed(_: *mut uv::uv_idle_t) {}
        if !self.uv_timer.data.is_null() {
            self.uv_timer.stop();
            self.uv_timer.close(timer_closed);
        }
        if !self.uv_idle.data.is_null() {
            self.uv_idle.stop();
            self.uv_idle.close(idle_closed);
        }
    }

    /// Lazily `uv_timer_init` the
    /// per-`All` libuv timer, then (re)start it for the soonest deadline
    /// across both heaps. On Windows there is no epoll/kqueue fallback; this
    /// `uv_timer_t` is the ONLY thing that wakes `uv_run` for JS timers.
    #[cfg(windows)]
    fn ensure_uv_timer(&mut self) {
        // `vm` here means the OWNING VM (the one this timer is embedded in),
        // not the calling thread's. Guard the TLS fallback so a cross-thread
        // caller fails loudly instead of silently arming a fresh `uv_loop_t`
        // on the wrong thread.
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
        debug_assert!(
            !self.uv_timer.is_closing(),
            "timer scheduled after teardown closed the heap's uv timer"
        );

        let reg_next = self.timers.peek().map(|timer| {
            // SAFETY: `peek` returns a live heap node.
            let next = unsafe { &(*timer).next };
            Timespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });
        let wtf_next = self.wtf_timers.lock().peek().map(|timer| {
            // SAFETY: `peek` returns a live heap node.
            let next = unsafe { &(*timer).next };
            Timespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });
        let Some(next_ts) = Self::soonest(reg_next, wtf_next) else {
            return;
        };

        // SAFETY: `uv_timer.data` is non-null past the lazy-init block, so
        // `uv_timer_init` has run and the handle's `loop` field points at
        // the owning VM's live `uv_loop_t` (== `vm.uvLoop()` per spec).
        unsafe { uv::uv_update_time(self.uv_timer.get_loop()) };
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let wait = if next_ts.greater(&now) {
            next_ts.duration(&now)
        } else {
            Timespec { sec: 0, nsec: 0 }
        };

        // minimum 1ms
        // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
        let wait_ms = core::cmp::max(1, wait.ms_unsigned());

        // SAFETY: `uv_timer_init` ran above; the handle is live.
        let due_in = unsafe { uv::uv_timer_get_due_in(&self.uv_timer) };
        // Restarting an overdue handle shifts the wakeup out by 1ms. Done
        // on every insert, the already-due callback never runs.
        if !(self.uv_timer.is_active() && due_in <= wait_ms) {
            self.uv_timer.start(wait_ms, 0, Some(Self::on_uv_timer));
        }

        if self.active_timer_count > 0 {
            self.uv_timer.ref_();
        } else {
            self.uv_timer.unref();
        }
    }

    /// libuv timer callback; drain due
    /// timers then re-arm for the next deadline. Only ever invoked by libuv
    /// (coerces to the `uv_timer_cb` fn-pointer type at the `Timer::start`
    /// call site); body wraps its derefs explicitly.
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

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn remove(&mut self, timer: *mut EventLoopTimer) {
        self.assert_js_thread();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // Note (§Forbidden aliased-&mut): `TimerHeap::remove` forms a
        // fresh `&mut EventLoopTimer` via `(*v).heap()` for the same
        // allocation, so we must NOT hold a `&mut *timer` across that call.
        // Read `in_heap` and write the post-remove bookkeeping via raw deref.
        match unsafe { (*timer).in_heap } {
            InHeap::None => {
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
    ///
    /// # Safety
    /// `timer` must point to a live `EventLoopTimer` with whole-container
    /// provenance for its tag (see [`js_timer_flags_ptr`]).
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn update(&mut self, timer: *mut EventLoopTimer, time: &Timespec) {
        self.assert_js_thread();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        // Read `state` via raw deref so we don't hold a `&mut *timer` across
        // `remove` (which also `&mut`-derefs the same pointer); overlapping
        // `&mut` is UB under Stacked Borrows.
        if unsafe { (*timer).state } == EventLoopTimerState::ACTIVE {
            self.remove(timer);
        }

        // SAFETY: `timer` is still a valid live EventLoopTimer; safe to derive
        // an exclusive reference now that no other borrow is outstanding.
        // `time` cannot alias `timer.next`: `time` is a `&bun_core::Timespec`
        // while `next` is `ElTimespec` — distinct types, so safe code cannot
        // construct the alias. Re-add a
        // `debug_assert!(!core::ptr::eq(time as *const _ as *const u8, &raw const (*timer).next as *const u8))`
        // when the Timespec types unify (see the ElTimespec alias note at the
        // top of this file).
        let timer_ref = unsafe { &mut *timer };
        timer_ref.next.sec = time.sec;
        timer_ref.next.nsec = time.nsec;

        // `insert` bumps the global epoch and writes it into the per-timer
        // flags so equal-deadline JS timers fire in refresh order.
        self.insert(timer);
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn wtf_arm(&mut self, timer: *mut EventLoopTimer, time: &Timespec) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        debug_assert!(unsafe { (*timer).tag } == EventLoopTimerTag::WTFTimer);
        {
            let mut wtf = self.wtf_timers.lock();
            // SAFETY: `timer` is live; its state and heap links only change under this guard.
            unsafe {
                if (*timer).state == EventLoopTimerState::ACTIVE {
                    wtf.remove(timer);
                }
                (*timer).next.sec = time.sec;
                (*timer).next.nsec = time.nsec;
                wtf.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
            }
        }
        #[cfg(windows)]
        if self.thread_id == std::thread::current().id() {
            self.ensure_uv_timer();
        }
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn wtf_disarm(&mut self, timer: *mut EventLoopTimer) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        debug_assert!(unsafe { (*timer).tag } == EventLoopTimerTag::WTFTimer);
        let mut wtf = self.wtf_timers.lock();
        // SAFETY: `timer` is live; its state and heap links only change under this guard.
        unsafe {
            if (*timer).state == EventLoopTimerState::ACTIVE {
                wtf.remove(timer);
                (*timer).state = EventLoopTimerState::CANCELLED;
            }
        }
    }

    unsafe fn drain_due_wtf_timers(
        this: *mut Self,
        maybe_now: &mut Option<Timespec>,
        vm: *mut (),
    ) -> Option<Timespec> {
        loop {
            let min = {
                // SAFETY: `this` is live; the guard drops before `fire`.
                let mut wtf = unsafe { &(*this).wtf_timers }.lock();
                let min = wtf.peek()?;
                // SAFETY: `peek` returned a live heap node.
                let min_next = unsafe {
                    Timespec {
                        sec: (*min).next.sec,
                        nsec: (*min).next.nsec,
                    }
                };
                let now = *maybe_now
                    .get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
                if min_next.greater(&now) {
                    return Some(min_next);
                }
                let min = wtf.delete_min().expect("peek succeeded");
                // SAFETY: `min` is the node `peek` returned above.
                unsafe { (*min).state = EventLoopTimerState::FIRED };
                min
            };
            let now = maybe_now.expect("set before the pop");
            let el_now = ElTimespec {
                sec: now.sec,
                nsec: now.nsec,
            };
            // SAFETY: `min` is live; no guard or borrow of `All` is held here.
            let fired = unsafe { EventLoopTimer::fire(min, &el_now, vm) };
            // WTF timers run JSC-internal work, not user JS; a stop found here
            // is the loop's to act on at its next gate, and the heap's next
            // deadline is still reported to the poll.
            // SAFETY: `vm` is the erased per-thread VM per fn contract.
            let _ = unsafe { fold_timer(vm, fired) };
        }
    }

    #[inline]
    fn soonest(a: Option<Timespec>, b: Option<Timespec>) -> Option<Timespec> {
        match (a, b) {
            (Some(a), Some(b)) => Some(if a.greater(&b) { b } else { a }),
            (a, b) => a.or(b),
        }
    }

    /// Called from `EventLoop::auto_tick` to compute the epoll/kqueue timeout.
    /// Returns `true` if `spec` was written. `now_out` receives the monotonic reading this
    /// took, if any, for the caller to share with the tick (see `NOW_NS_UNKNOWN`).
    ///
    /// Note (b2): `vm` is erased per §Dispatch (the caller is in
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
    pub(crate) fn get_timeout(
        &mut self,
        spec: &mut Timespec,
        has_pending_immediate: bool,
        quic_next_tick_us: Option<i64>,
        vm: *mut (), /* erased *mut VirtualMachine, forwarded to fire() */
        now_out: &mut Option<Timespec>,
    ) -> bool {
        #[cfg(unix)]
        if has_pending_immediate {
            *spec = Timespec { sec: 0, nsec: 0 };
            return true;
        }
        #[cfg(not(unix))]
        let _ = has_pending_immediate;

        let this: *mut Self = self;
        let maybe_now: &mut Option<Timespec> = now_out;

        // SAFETY: `this` is the live per-thread `All`; `vm` per fn contract.
        let wtf_next = unsafe { Self::drain_due_wtf_timers(this, maybe_now, vm) };

        // SAFETY: `this` is live, and only this thread touches the regular heap.
        let reg_next = (unsafe { &*this }).timers.peek().map(|min| {
            // SAFETY: `peek` returns a live heap node.
            let next = unsafe { &(*min).next };
            Timespec {
                sec: next.sec,
                nsec: next.nsec,
            }
        });

        let Some(next) = Self::soonest(wtf_next, reg_next) else {
            if let Some(us) = quic_next_tick_us {
                if us >= 0 {
                    *spec = Timespec {
                        sec: us / US_PER_S,
                        nsec: (us % US_PER_S) * NS_PER_US,
                    };
                    return true;
                }
            }
            return false;
        };

        // Real clock: both heaps hold opt-out-of-fake-timers nodes armed in
        // real-time units; the mocked clock made internal pacing spin on re-arm.
        let now = *maybe_now.get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
        if next.greater(&now) {
            *spec = next.duration(&now);
            if let Some(us) = quic_next_tick_us {
                if us >= 0 {
                    Self::clamp_to_quic(spec, us);
                }
            }
        } else {
            *spec = Timespec { sec: 0, nsec: 0 };
        }
        true
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

    /// Pop the next due timer. `now` is filled lazily on first call so we
    /// don't pay for `clock_gettime` when the heap is empty.
    fn next(&mut self, has_set_now: &mut bool, now: &mut Timespec) -> Option<*mut EventLoopTimer> {
        let timer = self.timers.peek()?;
        if !*has_set_now {
            // Real clock: this heap is the opt-out-of-fake-timers set.
            *now = Timespec::now(TimespecMockMode::ForceRealTime);
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
    }

    /// # Safety
    /// `vm` is the erased `*mut VirtualMachine` for the calling JS thread and
    /// must remain live across any `EventLoopTimer::fire` re-entry.
    // Forwards `vm` to `__bun_fire_timer` without dereferencing it;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn drain_timers(&mut self, vm: *mut () /* erased *mut VirtualMachine */) {
        // Note (§Forbidden aliased-&mut): fired handlers re-enter `vm.timer`
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
        // TODO: the call-site auto-ref at jsc_hooks.rs (`(*state).timer
        // .drain_timers(...)`) still creates a `&mut All` for the call frame
        // itself; switch it to `All::drain_timers(core::ptr::addr_of_mut!(
        // (*state).timer), vm)` and change this signature to `this: *mut Self`.
        let this: *mut Self = self;

        let mut wtf_now: Option<Timespec> = None;
        // SAFETY: `this` is the live per-thread `All`; `vm` per fn contract.
        let _ = unsafe { Self::drain_due_wtf_timers(this, &mut wtf_now, vm) };

        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        loop {
            // SAFETY: `this` derived from `&mut self`; short-lived exclusive
            // borrow scoped to this `next()` call only — dropped before fire().
            let Some(t) = (unsafe { &mut *this }).next(&mut has_set_now, &mut now) else {
                break;
            };
            // Note: re-pack into bun_event_loop's local Timespec stub
            // until the lower tier unifies on bun_core::Timespec.
            let el_now = ElTimespec {
                sec: now.sec,
                nsec: now.nsec,
            };
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            // `fire` dispatches through the FIRE_TIMER hook (§Dispatch hot
            // path) and may re-enter `(*runtime_state()).timer` — no `&mut`
            // to `All` is live here.
            let fired = unsafe { EventLoopTimer::fire(t, &el_now, vm) };
            // SAFETY: `vm` per fn contract.
            if unsafe { fold_timer(vm, fired) }.is_err() {
                break;
            }
        }
    }

    pub(crate) fn increment_immediate_ref(&mut self, delta: i32, ctx: bun_io::EventLoopCtx) {
        let old = self.immediate_ref_count;
        let new = old + delta;
        self.immediate_ref_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            {
                self.immediate_refd_spawn_sync_loop = ctx.is_spawn_sync_loop();
                ctx.loop_ref();
            }
            #[cfg(windows)]
            {
                // Lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                if self.uv_idle.data.is_null() {
                    self.uv_idle.init(uv::Loop::get());
                    // Note: `data` is only used as a
                    // non-null "initialized" sentinel — never dereferenced.
                    self.uv_idle.data = bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr()
                        .cast::<core::ffi::c_void>();
                }
                self.uv_idle.start(Some(Self::on_uv_idle_noop));
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            ctx.loop_unref_for(self.immediate_refd_spawn_sync_loop);
            #[cfg(windows)]
            if !self.uv_idle.data.is_null() {
                self.uv_idle.stop();
            }
        }
        #[cfg(windows)]
        let _ = ctx;
    }

    /// Empty `uv_idle` callback. Its presence alone
    /// keeps `uv_run` from blocking in the poll phase; the body is a no-op.
    /// No preconditions (the handle pointer is unused), so the fn is safe; the
    /// safe fn item coerces into the `uv_idle_cb` fn-pointer slot.
    #[cfg(windows)]
    extern "C" fn on_uv_idle_noop(_: *mut uv::uv_idle_t) {
        // prevent libuv from polling forever
    }

    pub(crate) fn increment_timer_ref(&mut self, delta: i32, ctx: bun_io::EventLoopCtx) {
        let old = self.active_timer_count;
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count = new;
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            {
                self.timer_refd_spawn_sync_loop = ctx.is_spawn_sync_loop();
                ctx.loop_ref();
            }
            // `uv_timer.ref()` is intentionally unconditional (no `data !=
            // null` guard). Invariant: every path that reaches a positive
            // `active_timer_count` first inserts a timer, and `insert`
            // → `ensure_uv_timer` lazily `uv_timer_init`s the handle. Guarding
            // here would silently drop the ref and let the loop exit early.
            #[cfg(windows)]
            self.uv_timer.ref_();
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            ctx.loop_unref_for(self.timer_refd_spawn_sync_loop);
            #[cfg(windows)]
            self.uv_timer.unref();
        }
        #[cfg(windows)]
        let _ = ctx;
    }

    /// VM teardown, after `cancel_all_timeout_objects`: unlink every timer still
    /// in either heap, whatever its kind. Owners keep their nodes (now
    /// `CANCELLED`, which their own `state == ACTIVE` checks respect); nothing
    /// can fire afterwards even if the loop turns again.
    ///
    /// # Safety
    /// `this` is the live per-thread `All`; JS thread; never on a VM that keeps running.
    pub(crate) unsafe fn disarm_all_for_vm_teardown(this: *mut Self) {
        let mut nodes: Vec<*mut EventLoopTimer> = Vec::new();
        let mut stack: Vec<*mut EventLoopTimer> = Vec::new();
        // SAFETY: fn contract.
        let roots = unsafe { [(*this).timers.0.root, (*this).fake_timers.timers.0.root] };
        for root in roots {
            if !root.is_null() {
                stack.push(root);
            }
        }
        while let Some(node) = stack.pop() {
            // SAFETY: intrusive-heap invariant — reachable nodes are live while linked.
            let (child, next) = unsafe { ((*node).heap.child, (*node).heap.next) };
            if !child.is_null() {
                stack.push(child);
            }
            if !next.is_null() {
                stack.push(next);
            }
            nodes.push(node);
        }
        for node in nodes {
            // SAFETY: collected from the live heap above; `remove` relinks the
            // others but every node stays a valid allocation owned elsewhere.
            unsafe { (*this).remove(node) };
        }
    }

    /// VM-teardown / `--isolate` file-swap pass: `cancel()` every
    /// `TimeoutObject` / `ImmediateObject` still linked in `timers` /
    /// `fake_timers.timers` so the in-heap `+1` ref and the JS pin
    /// (`this_value` Strong) are released before the GC sweep, and discard
    /// every `AbortSignal.timeout()` timer through its signal so the signal
    /// stops reporting an active timer.
    ///
    /// # Safety
    /// JS thread only, with the TLS `RuntimeState` still installed and `vm`
    /// the live per-thread VM. Must run BEFORE JSC teardown
    /// (`Zig__GlobalObject__destructOnExit` / `WebWorker__teardownJSCVM`) and
    /// BEFORE `runtime_state` is nulled — the GC sweep frees the
    /// `TimeoutObject` boxes whose `event_loop_timer` fields the heap nodes
    /// alias, and the `AbortSignal`s that own the `AbortSignalTimeout` boxes.
    pub(crate) unsafe fn cancel_all_timeout_objects(
        this: *mut Self,
        vm: *mut crate::jsc::virtual_machine::VirtualMachine,
    ) {
        let mut to_cancel: Vec<*const TimerObjectInternals> = Vec::new();
        let mut signal_timeouts: Vec<*mut AbortSignalTimeout> = Vec::new();
        let mut stack: Vec<*mut EventLoopTimer> = Vec::new();

        // SAFETY: `this` is the live per-thread `All` (JS thread only).
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

        for internals in to_cancel {
            // SAFETY: each pointer was collected from the live heap; the
            // parent box is still alive (the +1 ref `cancel()` releases is
            // exactly the one keeping it pinned). `cancel()` may free the
            // parent on the final deref — never touched again.
            unsafe { (*internals).cancel(vm) };
        }

        // `AbortSignal.timeout()` boxes are owned by the C++ `AbortSignal`, so
        // each one is handed back to its signal, which unlinks and frees it and
        // clears `m_timeout`. Only unlinking the node here would leave every
        // observed signal's wrapper (under `--isolate`: the retired global its
        // listeners close over) pinned by `isReachableFromOpaqueRoots` for the
        // rest of the process; see `Timeout::discard`.
        for t in signal_timeouts {
            // SAFETY: each `t` was collected from the live heap above, so its
            // box (and therefore its owning signal) is still alive; JS thread;
            // no borrow of `*this` is held across the call (`discard` re-enters
            // `remove` through `timer_remove`). `t` is freed by the call.
            unsafe { AbortSignalTimeout::discard(t) };
        }
    }
}

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

// LAYERING: `Kind`/`KindBig` moved DOWN to `bun_event_loop` so `TimerFlags`
// (also moved down) can name them without a `bun_runtime` dep — needed by
// `bun_jsc::abort_signal::Timeout.flags`. `Kind::big()` lives next to the
// type so `TimeoutObject`/`TimerObjectInternals` can call it as a method.
pub use bun_event_loop::EventLoopTimer::{Kind, KindBig};

/// Sized to be the same as one pointer.
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct ID {
    pub id: i32,
    pub kind: KindBig,
}
impl ID {
    #[inline]
    fn async_id(self) -> u64 {
        // Layout: 8 bytes, `id` (i32) then `kind` (u32). Reassemble via
        // native-endian byte concat so the value is stable on every supported
        // target without relying on struct-layout reinterpretation.
        let mut bytes = [0u8; 8];
        bytes[..4].copy_from_slice(&self.id.to_ne_bytes());
        bytes[4..].copy_from_slice(&(self.kind as u32).to_ne_bytes());
        u64::from_ne_bytes(bytes)
    }
}

const US_PER_S: i64 = bun_core::time::US_PER_S as i64;
const NS_PER_US: i64 = bun_core::time::NS_PER_US as i64;

/// The timer drain's fold: report what a fired timer's handler left pending
/// as uncaught, or — if it is the VM's termination — tell the drain to stop.
///
/// # Safety
/// `vm` is the erased per-thread `*mut VirtualMachine`.
#[inline]
unsafe fn fold_timer(
    vm: *mut (),
    fired: bun_event_loop::JsResult<()>,
) -> Result<(), bun_jsc::Stopped> {
    #[cold]
    #[inline(never)]
    unsafe fn report(vm: *mut (), err: bun_jsc::JsError) -> Result<(), bun_jsc::Stopped> {
        // SAFETY: fn contract.
        let global = unsafe { (*vm.cast::<bun_jsc::virtual_machine::VirtualMachine>()).global() };
        bun_jsc::task::report_error_or_terminate(global, err)
    }
    match fired {
        Ok(()) => Ok(()),
        // SAFETY: fn contract.
        Err(err) => unsafe { report(vm, err) },
    }
}
