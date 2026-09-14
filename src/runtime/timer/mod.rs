//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.

use core::cell::Cell;

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
use bun_ptr::{BackRef, JsCell};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Guarded;

/// `EventLoopTimer.next`'s type; the low tier re-exports `bun_core::Timespec`.
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;
pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, State as EventLoopTimerState, Tag as EventLoopTimerTag, TimerHeap,
    TimerOwner, TimerRef,
};

use crate::jsc::JSValue;
use crate::jsc::virtual_machine::VirtualMachine;

// ─── JS-facing surface (`impl All { set_timeout / clear_* / … }`) ────────────
// Named `timer` so codegen (`generated_js2native.rs`) resolves
// `crate::timer::timer::internal_bindings::timer_clock_ms` per the
// `$rust(Timer.rs, …)` → `crate::<dir>::<file>` path-mapping.

#[path = "Timer.rs"]
pub mod timer;

// ─── impl_timer_object! ──────────────────────────────────────────────────────
// Shared scaffold for `TimeoutObject` / `ImmediateObject`: both are a
// `#[JsClass]` payload of `{ref_count, event_loop_timer, internals, heap_ref}`
// whose JS-facing host-fns are pure forwarders to [`TimerObject`]. The macro
// emits the parts shared by both types so each `*.rs` file holds only its
// type-specific surface (`init`, `do_refresh`, cached-prop accessors, the
// [`TimerObject`] impl).
//
// Emits, at the call-site module path (so `#[JsClass]`/`#[host_fn]` produce the
// same extern symbol names as before — `Timeout__create`, `TimeoutPrototype__*`,
// `ImmediateClass__construct`, …):
//   - `#[bun_jsc::JsClass(name = $js_name)] #[derive(RefCounted)] pub struct $T { … }`
//   - `bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer)`
//   - `impl Drop for $T` (unlinks from `All` before the box is freed)
//   - `impl $T`: `init_with`/`constructor`/`finalize` and the forwarder
//     host-fns `to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/
//     `dispose`.
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
            pub event_loop_timer: ::bun_ptr::JsCell<super::EventLoopTimer>,
            pub internals: super::TimerObjectInternals,
            /// The ref held while this timer is scheduled — by the timer heap
            /// for a `Timeout`, by the event loop's immediate queue for an
            /// `Immediate`. Released when it fires for the last time or is
            /// cancelled.
            pub heap_ref: ::core::cell::Cell<Option<::bun_ptr::RefPtr<Self>>>,
        }

        ::bun_event_loop::impl_timer_owner!($T; from_timer_ptr => event_loop_timer);

        impl Drop for $T {
            fn drop(&mut self) {
                <Self as super::TimerObject>::unschedule_for_drop(self);
            }
        }

        impl $T {
            /// Shared body of `TimeoutObject::init` / `ImmediateObject::init`:
            /// allocate → wrap in the JS cell → schedule → inspector
            /// `did_schedule_async_call`. The per-type `init` fn picks
            /// `kind`/`interval` and forwards here.
            pub fn init_with(
                global: &::bun_jsc::JSGlobalObject,
                id: i32,
                kind: super::Kind,
                interval: u32,
                callback: ::bun_jsc::JSValue,
                arguments: ::bun_jsc::JSValue,
            ) -> ::bun_jsc::JSValue {
                let vm = global.bun_vm();
                let timer = ::bun_ptr::RefPtr::new(Self {
                    ref_count: ::bun_ptr::RefCount::init(),
                    event_loop_timer: ::bun_ptr::JsCell::new(super::EventLoopTimer::init_paused(
                        super::EventLoopTimerTag::$tag,
                    )),
                    internals: super::TimerObjectInternals::new(id, kind, interval, vm),
                    heap_ref: ::core::cell::Cell::new(None),
                });
                // `timer`'s ref moves to the JS wrapper (released via `finalize`).
                let js_value = Self::to_js_nonnull(timer.as_non_null(), global);
                debug_assert!(
                    <Self as ::bun_jsc::JsClass>::from_js(js_value) == Some(timer.as_ptr()),
                    concat!($js_name, "__create ABI mismatch"),
                );
                let this = timer.into_this_ptr();
                let _keep = ::bun_jsc::EnsureStillAlive(js_value);
                <Self as super::TimerObject>::schedule(this, js_value, global, callback, arguments);
                if vm.is_inspector_enabled() {
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
                this: ::bun_ptr::ThisPtr<Self>,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                <Self as super::TimerObject>::to_primitive(this)
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_ref(
                &self,
                _global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                <Self as super::TimerObject>::do_ref(self, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn do_unref(
                &self,
                _global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                <Self as super::TimerObject>::do_unref(self, frame.this())
            }

            #[::bun_jsc::host_fn(method)]
            pub fn has_ref(
                &self,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                <Self as super::TimerObject>::has_ref(self)
            }

            /// `.classes.ts` `refCounted: true` — runs on the mutator thread
            /// during lazy sweep, before the wrapper's ref is dropped. Do not
            /// touch any `JSValue`/`Strong` content.
            pub fn finalize(&self) {
                self.internals.this_value.with_mut(|r| r.finalize())
            }

            #[::bun_jsc::host_fn(getter)]
            pub fn get_destroyed(
                &self,
                _global: &::bun_jsc::JSGlobalObject,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                Ok(::bun_jsc::JSValue::from(<Self as super::TimerObject>::get_destroyed(self)))
            }

            #[::bun_jsc::host_fn(method)]
            pub fn dispose(
                this: ::bun_ptr::ThisPtr<Self>,
                _global: &::bun_jsc::JSGlobalObject,
                _frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                <Self as super::TimerObject>::cancel(this);
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
pub mod date_header_timer;

#[path = "EventLoopDelayMonitor.rs"]
pub mod event_loop_delay_monitor;

/// `clearTimeout(id)` lookup table: the object's `Drop` removes its entry, so
/// every `BackRef` in here points at a live timer.
pub(crate) type IdMap<T> = ArrayHashMap<i32, BackRef<T, bun_ptr::Root>>;

/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
#[derive(Default)]
pub struct Maps {
    pub(crate) set_timeout: IdMap<TimeoutObject>,
    pub(crate) set_interval: IdMap<TimeoutObject>,
    pub(crate) set_immediate: IdMap<ImmediateObject>,
}

// ─── FakeTimers ──────────────────────────────────────────────────────────────
// Real definition lives in `runtime/test_runner/timers/FakeTimers.rs` and
// depends on `TimerHeap`. Re-export so `All.fake_timers` and the test_runner
// host fns see the same nominal type.
pub(crate) use crate::test_runner::timers::fake_timers::FakeTimers;

// ─── DateHeaderTimer / EventLoopDelayMonitor ─────────────────────────────────

pub struct DateHeaderTimer {
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
}
bun_event_loop::impl_timer_owner!(DateHeaderTimer; from_timer_ptr => event_loop_timer);
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::DateHeaderTimer,
            )),
        }
    }
}
impl DateHeaderTimer {
    #[inline]
    fn timer_ref(&self) -> TimerRef {
        TimerRef::new(self, |t| &t.event_loop_timer)
    }

    /// Refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub(crate) fn run(&self, vm: &VirtualMachine, all: &All) {
        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let loop_ = vm.uws_loop_mut();
        let now = Timespec::now(TimespecMockMode::ForceRealTime);

        // Record when we last ran it.
        self.event_loop_timer.with_mut(|t| t.next = now);

        // updateDate() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count > 0 {
            // Reschedule it automatically for 1 second later.
            self.event_loop_timer
                .with_mut(|t| t.next = now.add_ms(1000));
            all.insert(self.timer_ref());
        }
    }
}

pub struct EventLoopDelayMonitor {
    /// Weak, so a leaked monitor does not pin the retired `--isolate` realm.
    /// `stop_active_handles` drops it before `~VM` (`All` outlives the heap).
    histogram: JsCell<bun_jsc::Weak<()>>,
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pub(crate) resolution_ms: Cell<i32>,
    pub(crate) last_fire_ns: Cell<u64>,
    pub(crate) enabled: Cell<bool>,
}
bun_event_loop::impl_timer_owner!(EventLoopDelayMonitor; from_timer_ptr => event_loop_timer);
impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            histogram: JsCell::new(bun_jsc::Weak::default()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::EventLoopDelayMonitor,
            )),
            resolution_ms: Cell::new(10),
            last_fire_ns: Cell::new(0),
            enabled: Cell::new(false),
        }
    }
}
impl EventLoopDelayMonitor {
    #[inline]
    fn timer_ref(&self) -> TimerRef {
        TimerRef::new(self, |t| &t.event_loop_timer)
    }

    fn enable(&self, vm: &VirtualMachine, all: &All, histogram: JSValue, resolution_ms: i32) {
        self.disable(all);
        self.histogram
            .set(bun_jsc::Weak::create_passive(histogram, vm.global()));
        self.resolution_ms.set(resolution_ms);
        self.enabled.set(true);

        // Schedule timer
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        self.event_loop_timer
            .with_mut(|t| t.next = now.add_ms(i64::from(resolution_ms)));
        all.insert(self.timer_ref());
    }

    pub(crate) fn disable(&self, all: &All) {
        if !self.enabled.get() {
            return;
        }
        self.enabled.set(false);
        self.histogram.set(bun_jsc::Weak::default());
        self.last_fire_ns.set(0);
        // FIRED (not linked) when called from `on_fire`.
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            all.remove(self.timer_ref());
        }
    }

    /// Record `now - last_fire_ns`
    /// into the JS histogram and reschedule.
    pub(crate) fn on_fire(&self, now: &Timespec, all: &All) {
        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        if !self.enabled.get() {
            return;
        }
        let Some(histogram) = self.histogram.get().get() else {
            self.disable(all);
            return;
        };

        let now_ns = now.ns();
        let last_fire_ns = self.last_fire_ns.get();
        if last_fire_ns > 0 {
            let expected_ns = u64::try_from(self.resolution_ms.get())
                .expect("int cast")
                .saturating_mul(1_000_000);
            let actual_ns = now_ns - last_fire_ns;

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

        self.last_fire_ns.set(now_ns);

        // Reschedule
        let next = now.add_ms(i64::from(self.resolution_ms.get()));
        self.event_loop_timer.with_mut(|t| t.next = next);
        all.insert(self.timer_ref());
    }
}

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject ─────────────────

pub mod timer_object_internals;
pub use timer_object_internals::{Flags as TimerFlags, TimerObject, TimerObjectInternals};

/// `jsc.WebCore.AbortSignal.Timeout` — real struct lives in `bun_jsc` (which
/// this crate depends on). Re-exported here so `dispatch` resolves the same
/// `event_loop_timer`/`flags` offsets the low tier wrote.
pub use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub use self::immediate_object::ImmediateObject;
pub use self::timeout_object::TimeoutObject;

/// A timer created by WTF code and invoked by Bun's event loop.
#[path = "WTFTimer.rs"]
pub mod wtf_timer;
pub(crate) use wtf_timer::WTFTimer;

// ─── All ─────────────────────────────────────────────────────────────────────

/// The per-VM timer state. Lives in `RuntimeState` (boxed, JS-thread-owned,
/// stable address for the VM's lifetime) and is reached through
/// [`crate::jsc_hooks::timer_all`]. Every method takes `&self`: timer
/// callbacks re-enter this struct (a `setInterval` callback calling
/// `clearTimeout`, `refresh()`, `setTimeout`, …), so state is held in
/// `Cell`/`JsCell` and no `&mut All` ever exists. Only `wtf_timers` is touched
/// off the JS thread (under its lock).
pub(crate) struct All {
    last_id: Cell<i32>,
    thread_id: std::thread::ThreadId,
    pub(crate) timers: TimerHeap,
    active_timer_count: Cell<i32>,
    #[cfg(windows)]
    uv_timer: JsCell<uv::Timer>,
    /// Whether we have emitted a warning for passing a negative timeout duration
    warned_negative_number: Cell<bool>,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    warned_not_number: Cell<bool>,
    /// Incremented when timers are scheduled or rescheduled. See
    /// TimerFlags.epoch. Masked to 25 bits on increment.
    epoch: Cell<u32>,
    immediate_ref_count: Cell<i32>,
    #[cfg(windows)]
    uv_idle: JsCell<uv::uv_idle_t>,
    pub(crate) event_loop_delay: EventLoopDelayMonitor,
    pub(crate) fake_timers: FakeTimers,
    pub(crate) maps: JsCell<Maps>,
    pub(crate) date_header_timer: DateHeaderTimer,
    pub(crate) wtf_timers: Guarded<TimerHeap>,
}

impl All {
    pub(crate) fn init() -> Self {
        Self {
            last_id: Cell::new(1),
            thread_id: std::thread::current().id(),
            timers: TimerHeap::new(InHeap::Regular),
            active_timer_count: Cell::new(0),
            #[cfg(windows)]
            uv_timer: JsCell::new(bun_core::ffi::zeroed()),
            warned_negative_number: Cell::new(false),
            warned_not_number: Cell::new(false),
            epoch: Cell::new(0),
            immediate_ref_count: Cell::new(0),
            #[cfg(windows)]
            uv_idle: JsCell::new(bun_core::ffi::zeroed()),
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: JsCell::new(Maps::default()),
            date_header_timer: DateHeaderTimer::default(),
            wtf_timers: Guarded::init(TimerHeap::new(InHeap::Wtf)),
        }
    }

    /// Hand out the next JS-visible timer id.
    #[inline]
    pub(crate) fn next_id(&self) -> i32 {
        let id = self.last_id.get();
        self.last_id.set(id.wrapping_add(1));
        id
    }

    /// The epoch a freshly created JS timer starts with (see [`TimerFlags`]).
    #[inline]
    pub(crate) fn epoch(&self) -> u32 {
        self.epoch.get()
    }

    #[inline]
    fn assert_js_thread(&self) {
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "timer::All: non-WTF timers may only be touched on the owning JS thread",
        );
    }

    pub(crate) fn insert(&self, timer: TimerRef) {
        self.assert_js_thread();
        let tag = timer.tag();
        debug_assert!(tag != EventLoopTimerTag::WTFTimer, "use wtf_arm");

        // Bump the global epoch into the per-timer flags so equal-deadline JS
        // timers (setTimeout/setInterval/AbortSignal.timeout) fire in insertion
        // order. Before heap insert: `EventLoopTimer::less` reads epoch as tiebreak.
        let next_epoch = self.epoch.get().wrapping_add(1) & ((1u32 << 25) - 1);
        if crate::dispatch::set_js_timer_epoch(timer, next_epoch) {
            self.epoch.set(next_epoch);
        }

        if self.fake_timers.is_active() && tag.allow_fake_timers() {
            self.fake_timers.timers.insert(timer);
            timer.set_state(EventLoopTimerState::ACTIVE);
        } else {
            self.timers.insert(timer);
            timer.set_state(EventLoopTimerState::ACTIVE);
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
    pub(crate) fn close_loop_handles_for_vm_teardown(&self) {
        extern "C" fn timer_closed(_: *mut uv::Timer) {}
        extern "C" fn idle_closed(_: *mut uv::uv_idle_t) {}
        self.uv_timer.with_mut(|timer| {
            if !timer.data.is_null() {
                timer.stop();
                timer.close(timer_closed);
            }
        });
        self.uv_idle.with_mut(|idle| {
            if !idle.data.is_null() {
                idle.stop();
                idle.close(idle_closed);
            }
        });
    }

    /// Lazily `uv_timer_init` the
    /// per-`All` libuv timer, then (re)start it for the soonest deadline
    /// across both heaps. On Windows there is no epoll/kqueue fallback; this
    /// `uv_timer_t` is the ONLY thing that wakes `uv_run` for JS timers.
    #[cfg(windows)]
    fn ensure_uv_timer(&self) {
        // `vm` here means the OWNING VM (the one this timer is embedded in),
        // not the calling thread's. Guard the TLS fallback so a cross-thread
        // caller fails loudly instead of silently arming a fresh `uv_loop_t`
        // on the wrong thread.
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "ensure_uv_timer: called off the owning JS thread; TLS loop/VM would diverge from vm.event_loop_handle",
        );
        self.uv_timer.with_mut(|timer| {
            if timer.data.is_null() {
                timer.init(uv::Loop::get());
                // `data` is only a non-null "initialized" sentinel.
                timer.data = VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
                timer.unref();
            }
            debug_assert!(
                !timer.is_closing(),
                "timer scheduled after teardown closed the heap's uv timer"
            );
        });

        let reg_next = self.timers.peek().map(TimerRef::next);
        let wtf_next = self.wtf_timers.lock().peek().map(TimerRef::next);
        let Some(next_ts) = Self::soonest(reg_next, wtf_next) else {
            return;
        };

        self.uv_timer.get().update_loop_time();
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let wait = if next_ts.greater(&now) {
            next_ts.duration(&now)
        } else {
            Timespec { sec: 0, nsec: 0 }
        };

        // minimum 1ms
        // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
        let wait_ms = core::cmp::max(1, wait.ms_unsigned());

        let active_timer_count = self.active_timer_count.get();
        self.uv_timer.with_mut(|timer| {
            // Restarting an overdue handle shifts the wakeup out by 1ms. Done
            // on every insert, the already-due callback never runs.
            if !(timer.is_active() && timer.get_due_in() <= wait_ms) {
                timer.start(wait_ms, 0, Some(Self::on_uv_timer));
            }

            if active_timer_count > 0 {
                timer.ref_();
            } else {
                timer.unref();
            }
        });
    }

    /// libuv timer callback; drain due
    /// timers then re-arm for the next deadline. Only ever invoked by libuv on
    /// the loop's (= this `All`'s) thread, so the handle pointer is not needed:
    /// the thread's `All` is the one that armed it.
    #[cfg(windows)]
    extern "C" fn on_uv_timer(_: *mut uv::Timer) {
        let all = crate::jsc_hooks::timer_all();
        all.drain_timers(VirtualMachine::get());
        all.ensure_uv_timer();
    }

    /// Disarm `timer`: unlink it if it is linked (a slot that already left the
    /// heap — popped to fire, or never inserted — is fine) and mark it
    /// `CANCELLED`. This is the one "remove if armed" entry point; callers need
    /// not check first.
    pub(crate) fn remove(&self, timer: TimerRef) {
        self.assert_js_thread();
        match timer.in_heap() {
            InHeap::Regular => self.timers.remove(timer),
            InHeap::Fake => self.fake_timers.timers.remove(timer),
            InHeap::None => {}
            InHeap::Wtf => debug_assert!(false, "use wtf_disarm"),
        }
        timer.set_state(EventLoopTimerState::CANCELLED);
    }

    /// Remove the EventLoopTimer if necessary, then re-insert at `time`.
    pub(crate) fn update(&self, timer: TimerRef, time: &Timespec) {
        self.assert_js_thread();
        if timer.in_heap() != InHeap::None {
            self.remove(timer);
        }

        timer.set_next(*time);

        // `insert` bumps the global epoch and writes it into the per-timer
        // flags so equal-deadline JS timers fire in refresh order.
        self.insert(timer);
    }

    /// (Re)arm a `WTFTimer`. Any thread; the slot is only touched under the
    /// `wtf_timers` lock.
    fn wtf_arm(&self, timer: TimerRef, time: Timespec) {
        {
            let wtf = self.wtf_timers.lock();
            debug_assert!(timer.tag() == EventLoopTimerTag::WTFTimer);
            if timer.state() == EventLoopTimerState::ACTIVE {
                wtf.remove(timer);
            }
            timer.set_next(time);
            wtf.insert(timer);
            timer.set_state(EventLoopTimerState::ACTIVE);
        }
        #[cfg(windows)]
        if self.thread_id == std::thread::current().id() {
            self.ensure_uv_timer();
        }
    }

    /// Disarm a `WTFTimer`; no-op if it is not linked. Any thread; the slot
    /// is only touched under the `wtf_timers` lock.
    fn wtf_disarm(&self, timer: TimerRef) {
        let wtf = self.wtf_timers.lock();
        debug_assert!(timer.tag() == EventLoopTimerTag::WTFTimer);
        if timer.state() == EventLoopTimerState::ACTIVE {
            wtf.remove(timer);
            timer.set_state(EventLoopTimerState::CANCELLED);
        }
    }

    /// Fire every due `WTFTimer` and return the next WTF deadline, if any. The
    /// popped slot is only read under the lock; once it drops nothing here
    /// touches the slot again (a GC thread may re-arm it concurrently).
    fn drain_due_wtf_timers(&self, maybe_now: &mut Option<Timespec>) -> Option<Timespec> {
        loop {
            let min = {
                let wtf = self.wtf_timers.lock();
                let min_next = wtf.peek()?.next();
                let now = *maybe_now
                    .get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
                if min_next.greater(&now) {
                    return Some(min_next);
                }
                let min = wtf.delete_min().expect("peek succeeded");
                min.set_state(EventLoopTimerState::FIRED);
                min
            };
            // Only `WTFTimer`s are ever in this heap. They run JSC-internal
            // work, not user JS, so there is nothing to fold.
            crate::dispatch::fire_wtf_timer(min);
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
    /// Note (b2): the caller is in `bun_jsc::event_loop`, which can't name
    /// `bun_runtime`. The two reads it needs — `event_loop.immediate_tasks.len()`
    /// and the QUIC tick — are passed in pre-computed until the cycle is broken.
    pub(crate) fn get_timeout(
        &self,
        spec: &mut Timespec,
        has_pending_immediate: bool,
        quic_next_tick_us: Option<i64>,
        now_out: &mut Option<Timespec>,
    ) -> bool {
        #[cfg(unix)]
        if has_pending_immediate {
            *spec = Timespec { sec: 0, nsec: 0 };
            return true;
        }
        #[cfg(not(unix))]
        let _ = has_pending_immediate;

        let maybe_now: &mut Option<Timespec> = now_out;

        let wtf_next = self.drain_due_wtf_timers(maybe_now);
        let reg_next = self.timers.peek().map(TimerRef::next);

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
    fn next(&self, has_set_now: &mut bool, now: &mut Timespec) -> Option<TimerRef> {
        let timer = self.timers.peek()?;
        if !*has_set_now {
            // Real clock: this heap is the opt-out-of-fake-timers set.
            *now = Timespec::now(TimespecMockMode::ForceRealTime);
            *has_set_now = true;
        }
        if timer.next().greater(now) {
            return None;
        }
        let deleted = self.timers.delete_min().expect("peek succeeded");
        debug_assert!(deleted == timer);
        Some(timer)
    }

    /// Fire every due timer. Handlers re-enter `self` (setInterval reschedule
    /// → `update`, `clearTimeout` → `remove`, …), which is why nothing here
    /// holds a borrow of the heap across `fire_timer`.
    pub(crate) fn drain_timers(&self, vm: &VirtualMachine) {
        let mut wtf_now: Option<Timespec> = None;
        let _ = self.drain_due_wtf_timers(&mut wtf_now);

        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        while let Some(t) = self.next(&mut has_set_now, &mut now) {
            let fired = crate::dispatch::fire_timer(t, &now, vm);
            if fold_timer(vm, fired).is_err() {
                break;
            }
        }
    }

    pub(crate) fn increment_immediate_ref(&self, delta: i32) {
        let old = self.immediate_ref_count.get();
        let new = old + delta;
        self.immediate_ref_count.set(new);
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            VirtualMachine::get().uws_loop_mut().ref_();
            #[cfg(windows)]
            {
                // Lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                self.uv_idle.with_mut(|idle| {
                    if idle.data.is_null() {
                        idle.init(uv::Loop::get());
                        // `data` is only a non-null "initialized" sentinel.
                        idle.data = VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
                    }
                    idle.start(Some(Self::on_uv_idle_noop));
                });
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            VirtualMachine::get().uws_loop_mut().unref();
            #[cfg(windows)]
            self.uv_idle.with_mut(|idle| {
                if !idle.data.is_null() {
                    idle.stop();
                }
            });
        }
    }

    /// Empty `uv_idle` callback. Its presence alone
    /// keeps `uv_run` from blocking in the poll phase; the body is a no-op.
    #[cfg(windows)]
    extern "C" fn on_uv_idle_noop(_: *mut uv::uv_idle_t) {
        // prevent libuv from polling forever
    }

    pub(crate) fn increment_timer_ref(&self, delta: i32) {
        let old = self.active_timer_count.get();
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count.set(new);
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            VirtualMachine::get().uws_loop_mut().ref_();
            // `uv_timer.ref()` is intentionally unconditional (no `data !=
            // null` guard). Invariant: every path that reaches a positive
            // `active_timer_count` first inserts a timer, and `insert`
            // → `ensure_uv_timer` lazily `uv_timer_init`s the handle. Guarding
            // here would silently drop the ref and let the loop exit early.
            #[cfg(windows)]
            self.uv_timer.with_mut(|t| t.ref_());
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            VirtualMachine::get().uws_loop_mut().unref();
            #[cfg(windows)]
            self.uv_timer.with_mut(|t| t.unref());
        }
    }

    /// Every slot linked into `timers` or `fake_timers.timers`.
    fn linked_timers(&self) -> Vec<TimerRef> {
        let mut nodes = self.timers.to_vec();
        nodes.append(&mut self.fake_timers.timers.to_vec());
        nodes
    }

    /// VM teardown, after `cancel_all_timeout_objects`: unlink every timer still
    /// in either heap, whatever its kind. Owners keep their nodes (now
    /// `CANCELLED`, which their own `state == ACTIVE` checks respect); nothing
    /// can fire afterwards even if the loop turns again. JS thread; never on a
    /// VM that keeps running.
    pub(crate) fn disarm_all_for_vm_teardown(&self) {
        for node in self.linked_timers() {
            self.remove(node);
        }
    }

    /// VM-teardown / `--isolate` file-swap pass: `cancel()` every
    /// `TimeoutObject` / `ImmediateObject` still linked in `timers` /
    /// `fake_timers.timers` so the in-heap `+1` ref and the JS pin
    /// (`this_value` Strong) are released before the GC sweep, and discard
    /// every `AbortSignal.timeout()` timer through its signal so the signal
    /// stops reporting an active timer.
    ///
    /// JS thread only. Must run BEFORE JSC teardown
    /// (`Zig__GlobalObject__destructOnExit` / `WebWorker__teardownJSCVM`) — the
    /// GC sweep frees the `TimeoutObject` boxes whose `event_loop_timer` slots
    /// the heap links, and the `AbortSignal`s that own the `AbortSignalTimeout`
    /// boxes.
    pub(crate) fn cancel_all_timeout_objects(&self, vm: &VirtualMachine) {
        let mut timeouts: Vec<TimerRef> = Vec::new();
        let mut signal_timeouts: Vec<TimerRef> = Vec::new();
        for t in self.linked_timers() {
            match t.tag() {
                EventLoopTimerTag::TimeoutObject | EventLoopTimerTag::ImmediateObject => {
                    timeouts.push(t)
                }
                EventLoopTimerTag::AbortSignalTimeout => signal_timeouts.push(t),
                _ => {}
            }
        }
        // Each call may free the owner (the `+1` it releases is exactly the one
        // keeping it pinned) and re-enters `remove`; no heap borrow is held.
        for t in timeouts.into_iter().chain(signal_timeouts) {
            crate::dispatch::cancel_js_timer(t, vm);
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
#[inline]
fn fold_timer(
    vm: &VirtualMachine,
    fired: bun_event_loop::JsResult<()>,
) -> Result<(), bun_jsc::Stopped> {
    #[cold]
    #[inline(never)]
    fn report(vm: &VirtualMachine, err: bun_jsc::JsError) -> Result<(), bun_jsc::Stopped> {
        bun_jsc::task::report_error_or_terminate(vm.global(), err)
    }
    match fired {
        Ok(()) => Ok(()),
        Err(err) => report(vm, err),
    }
}
