//! `TimerObjectInternals` — fields shared by `TimeoutObject` / `ImmediateObject`,
//! and [`TimerObject`] — the behaviour shared by both, generic over the
//! owning type so the timer slot, the heap's ref and the id map are reached
//! through `self` instead of a `container_of`.
//!
//! `run_immediate_task()` drives the `__bun_run_immediate_task` dispatch
//! path; `fire()` + `reschedule()`/`should_reschedule_timer()`/
//! `convert_to_interval()` drive the timer-heap dispatch path
//! (Timeout/Immediate arms); `schedule()` backs the `TimeoutObject::init` /
//! `ImmediateObject::init` constructors.

use core::cell::Cell;

use bun_core::{Timespec, TimespecMockMode};
use bun_ptr::{BackRef, JsCell, RefPtr, ThisPtr};

use crate::jsc::virtual_machine::VirtualMachine;
use crate::jsc::{
    Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus,
    generated::{JSImmediate, JSTimeout},
};
use crate::jsc_hooks::timer_all;

use super::{
    EventLoopTimer, EventLoopTimerState, ID, IdMap, Kind, KindBig, Maps, TimerOwner, TimerRef,
};

/// Data that TimerObject and ImmediateObject have in common.
#[repr(C)]
pub struct TimerObjectInternals {
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub(crate) id: i32,
    pub(crate) interval: Cell<u32>,
    pub this_value: JsCell<JsRef>,
    pub(crate) flags: Cell<Flags>,
    /// `bun test --isolate` generation this timer was created in.
    pub(crate) generation: u32,
}

impl TimerObjectInternals {
    pub(crate) fn new(id: i32, kind: Kind, interval: u32, vm: &VirtualMachine) -> Self {
        let mut flags = Flags::default();
        flags.set_kind(kind);
        flags.set_epoch(timer_all().epoch());
        Self {
            id,
            interval: Cell::new(interval),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(flags),
            generation: vm.test_isolation_generation,
        }
    }

    /// Read-modify-write `self.flags` through the `Cell` (R-2: `flags` is
    /// `Cell<Flags>` so the write is interior-mutable, callable from
    /// `&self` host-fns that re-enter JS).
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut fl = self.flags.get();
        f(&mut fl);
        self.flags.set(fl);
    }

    #[inline]
    pub(crate) fn async_id(&self) -> u64 {
        ID {
            id: self.id,
            kind: self.flags.get().kind().into(),
        }
        .async_id()
    }
}

// LAYERING: `Flags` (the packed-u32 state machine) was MOVED DOWN to
// `bun_event_loop::EventLoopTimer::TimerFlags` so `bun_jsc::abort_signal::Timeout`
// can name it without a forward dep on this crate. Re-exported here so existing
// `TimerObjectInternals`/`All::update` callers see the same nominal type.
pub use bun_event_loop::EventLoopTimer::TimerFlags as Flags;

// C++ symbol emitted from ImmediateList.cpp / setTimeout.cpp; already linked.
unsafe extern "C" {
    safe fn Bun__JSTimeout__call(
        global_object: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

/// The behaviour shared by [`TimeoutObject`](super::TimeoutObject) and
/// [`ImmediateObject`](super::ImmediateObject).
///
/// Re-entrancy: every method that runs the JS callback takes
/// `this: ThisPtr<Self>` / `&self` (never `&mut`) — the callback can reach
/// this same object again through its JS wrapper (`clearTimeout()`,
/// `refresh()`, the `_destroyed` getter), so all state is in `Cell`/`JsCell`.
/// Methods that may drop the heap's ref (and with it possibly the last ref)
/// take `ThisPtr<Self>`; after they release it `this` may be gone.
pub trait TimerObject: bun_ptr::RefCounted + TimerOwner + Sized + 'static {
    fn internals(&self) -> &TimerObjectInternals;
    fn event_loop_timer(&self) -> &JsCell<EventLoopTimer>;
    /// The slot for the ref held while this timer is scheduled (see the
    /// struct field docs).
    fn heap_ref(&self) -> &Cell<Option<RefPtr<Self>>>;
    /// The `clearTimeout(id)` table a timer of `kind` registers in.
    fn id_map(maps: &mut Maps, kind: Kind) -> &mut IdMap<Self>;

    #[inline]
    fn timer_ref(&self) -> TimerRef {
        TimerRef::new(self, Self::event_loop_timer)
    }

    #[inline]
    fn event_loop_timer_state(&self) -> EventLoopTimerState {
        self.event_loop_timer().get().state
    }

    #[inline]
    fn set_event_loop_timer_state(&self, state: EventLoopTimerState) {
        self.event_loop_timer().with_mut(|t| t.state = state);
    }

    /// Take the scheduled-timer ref on behalf of the heap / immediate queue,
    /// unless it is already held.
    #[inline]
    fn hold_heap_ref(this: ThisPtr<Self>) {
        let slot = this.heap_ref();
        let held = slot.take();
        slot.set(Some(held.unwrap_or_else(|| RefPtr::from_this(this))));
    }

    /// Release the scheduled-timer ref, if held. May free `this`.
    #[inline]
    fn release_heap_ref(this: ThisPtr<Self>) {
        drop(this.heap_ref().take());
    }

    fn set_enable_keeping_event_loop_alive(&self, enable: bool) {
        let internals = self.internals();
        if internals.flags.get().is_keeping_event_loop_alive() == enable {
            return;
        }
        internals.update_flags(|f| f.set_is_keeping_event_loop_alive(enable));

        let delta = if enable { 1 } else { -1 };
        match internals.flags.get().kind() {
            Kind::SetTimeout | Kind::SetInterval => timer_all().increment_timer_ref(delta),
            // setImmediate has slightly different event loop logic
            Kind::SetImmediate => timer_all().increment_immediate_ref(delta),
        }
    }

    /// Invoke the JS callback via the C++ `Bun__JSTimeout__call` thunk (which
    /// handles exceptions internally). Returns `true` if an exception was
    /// thrown. The caller pins `self` with a ref across the call.
    fn run(
        &self,
        global: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: &VirtualMachine,
    ) -> bool {
        let internals = self.internals();
        if vm.is_inspector_enabled() {
            Debugger::will_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        // `Cell<Flags>` RMW so the `in_callback` write reaches memory before JS
        // runs (re-entrant `_destroyed` getter reads it through the wrapper).
        internals.update_flags(|f| f.set_in_callback(true));
        let result = Bun__JSTimeout__call(global, timer, callback, arguments);
        // No early returns between the `in_callback` set and this clear.
        // Fresh `Cell` read: re-entrant `cancel()` may have set
        // `has_cleared_timer` / cleared `is_keeping_event_loop_alive`.
        internals.update_flags(|f| f.set_in_callback(false));

        if vm.is_inspector_enabled() {
            Debugger::did_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    /// Constructor tail: wire the JS wrapper's cached slots and hand the timer
    /// to the heap (`Timeout`) or the immediate queue (`Immediate`).
    fn schedule(
        this: ThisPtr<Self>,
        timer: JSValue,
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) {
        let internals = this.internals();
        if internals.flags.get().kind() == Kind::SetImmediate {
            JSImmediate::arguments_set_cached(timer, global, arguments);
            JSImmediate::callback_set_cached(timer, global, callback);
            // Low tier stores `*mut ()` (§Dispatch); `__bun_run_immediate_task`
            // recovers the `ThisPtr<ImmediateObject>`.
            global
                .bun_vm()
                .event_loop_mut()
                .enqueue_immediate_task(this.as_ptr().cast());
            this.set_enable_keeping_event_loop_alive(true);
            // ref'd by event loop
            Self::hold_heap_ref(this);
        } else {
            JSTimeout::arguments_set_cached(timer, global, arguments);
            JSTimeout::callback_set_cached(timer, global, callback);
            JSTimeout::idle_timeout_set_cached(
                timer,
                global,
                JSValue::js_number(f64::from(internals.interval.get())),
            );
            JSTimeout::repeat_set_cached(
                timer,
                global,
                if internals.flags.get().kind() == Kind::SetInterval {
                    JSValue::js_number(f64::from(internals.interval.get()))
                } else {
                    JSValue::NULL
                },
            );

            // this takes the heap's ref and sets _idleStart
            Self::reschedule(this, timer, global);
        }

        internals
            .this_value
            .with_mut(|r| r.set_strong(timer, global));
    }

    /// `__bun_run_immediate_task` body. Returns `true` if an exception was
    /// thrown.
    fn run_immediate_task(this: ThisPtr<Self>, vm: &VirtualMachine) -> bool {
        let s = this.internals();
        let cleared = s.flags.get().has_cleared_timer()
            // The VM's stop was requested: nothing more enters script (as `fire`).
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || s.generation != vm.test_isolation_generation
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!s.flags.get().is_keeping_event_loop_alive()
                && !vm.is_event_loop_alive_excluding_immediates());
        if cleared {
            this.set_enable_keeping_event_loop_alive(false);
            s.this_value.with_mut(|r| r.downgrade());
            Self::release_heap_ref(this);
            return false;
        }

        let Some(timer) = s.this_value.get().try_get() else {
            #[cfg(debug_assertions)]
            panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            #[cfg(not(debug_assertions))]
            {
                this.set_enable_keeping_event_loop_alive(false);
                Self::release_heap_ref(this);
                return false;
            }
        };
        let global = vm.global();
        s.this_value.with_mut(|r| r.downgrade());
        this.set_event_loop_timer_state(EventLoopTimerState::FIRED);
        this.set_enable_keeping_event_loop_alive(false);
        timer.ensure_still_alive();

        vm.event_loop_mut().enter();
        let callback =
            JSImmediate::callback_get_cached(timer).expect("ImmediateObject callback slot");
        let arguments =
            JSImmediate::arguments_get_cached(timer).expect("ImmediateObject arguments slot");

        let exception_thrown = {
            let _pin = RefPtr::from_this(this);
            let async_id = s.async_id();
            let result = this.run(global, timer, callback, arguments, async_id, vm);
            // Fresh read: re-entrant `cancel()` may have changed `state`.
            if this.event_loop_timer_state() == EventLoopTimerState::FIRED {
                Self::release_heap_ref(this);
            }
            result
            // `_pin` drops here; after that `this` may be gone.
        };
        // --- after this point, the timer is no longer guaranteed to be alive ---

        if vm
            .event_loop_mut()
            .exit_maybe_drain_microtasks(!exception_thrown)
            .is_err()
        {
            return true;
        }

        exception_thrown
    }

    /// VM-teardown release of the immediate queue's ref on a still-queued
    /// `ImmediateObject`, without running it.
    fn cancel_pending_immediate(this: ThisPtr<Self>) {
        this.set_enable_keeping_event_loop_alive(false);
        this.internals().this_value.with_mut(|r| r.downgrade());
        Self::release_heap_ref(this);
    }

    /// Timer-heap dispatch arm for `Tag::TimeoutObject`/`Tag::ImmediateObject`:
    /// the JS timer's slot was just popped; invoke its callback via `run()`,
    /// then either reschedule (setInterval / `t._repeat`) or release the heap's
    /// ref.
    fn fire(this: ThisPtr<Self>, vm: &VirtualMachine) {
        let s = this.internals();
        let id = s.id;
        let kind: KindBig = s.flags.get().kind().into();
        let async_id = ID { id, kind };
        let has_been_cleared = this.event_loop_timer_state() == EventLoopTimerState::CANCELLED
            || s.flags.get().has_cleared_timer()
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || s.generation != vm.test_isolation_generation;

        this.set_event_loop_timer_state(EventLoopTimerState::FIRED);

        let global = vm.global();
        let Some(this_object) = s.this_value.get().try_get() else {
            this.set_enable_keeping_event_loop_alive(false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            Self::release_heap_ref(this);
            return;
        };

        let (callback, arguments, mut idle_timeout, mut repeat): (
            JSValue,
            JSValue,
            JSValue,
            JSValue,
        ) = match kind {
            KindBig::SetImmediate => (
                JSImmediate::callback_get_cached(this_object)
                    .expect("ImmediateObject callback slot"),
                JSImmediate::arguments_get_cached(this_object)
                    .expect("ImmediateObject arguments slot"),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            ),
            KindBig::SetTimeout | KindBig::SetInterval => (
                JSTimeout::callback_get_cached(this_object).expect("TimeoutObject callback slot"),
                JSTimeout::arguments_get_cached(this_object).expect("TimeoutObject arguments slot"),
                JSTimeout::idle_timeout_get_cached(this_object)
                    .expect("TimeoutObject idleTimeout slot"),
                JSTimeout::repeat_get_cached(this_object).expect("TimeoutObject repeat slot"),
            ),
        };

        if has_been_cleared || !callback.to_boolean() {
            if vm.is_inspector_enabled() {
                Debugger::did_cancel_async_call(
                    global,
                    Debugger::AsyncCallType::DOMTimer,
                    async_id.async_id(),
                );
            }
            this.set_enable_keeping_event_loop_alive(false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            Self::release_heap_ref(this);
            return;
        }

        // Only read on the .setInterval path where it is written below.
        let mut time_before_call = Timespec::EPOCH;

        if kind != KindBig::SetInterval {
            s.this_value.with_mut(|r| r.downgrade());
        } else {
            time_before_call = Timespec::ms_from_now(
                TimespecMockMode::AllowMockedTime,
                i64::from(s.interval.get()),
            );
        }
        this_object.ensure_still_alive();

        vm.event_loop_mut().enter();
        {
            // Ensure it stays alive for this scope.
            let _pin = RefPtr::from_this(this);

            let _ = this.run(
                global,
                this_object,
                callback,
                arguments,
                async_id.async_id(),
                vm,
            );

            match kind {
                KindBig::SetTimeout | KindBig::SetInterval => {
                    idle_timeout = JSTimeout::idle_timeout_get_cached(this_object)
                        .expect("TimeoutObject idleTimeout slot");
                    repeat = JSTimeout::repeat_get_cached(this_object)
                        .expect("TimeoutObject repeat slot");
                }
                KindBig::SetImmediate => {}
            }

            // Every `s.flags.get()` / `state` read below is fresh — re-entrant
            // `cancel()`/`refresh()` writes during `run` above are observed.
            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == KindBig::SetInterval {
                    if !this.should_reschedule_timer(repeat, idle_timeout) {
                        // Stopped Node-style (`_repeat = null` / `_idleTimeout = -1`)
                        // rather than through `cancel()`, so nothing has let go of
                        // the wrapper yet.
                        s.this_value.with_mut(|r| r.downgrade());
                        break 'is_timer_done true;
                    }
                    match this.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            timer_all().update(this.timer_ref(), &time_before_call);

                            if s.flags.get().has_js_ref() {
                                this.set_enable_keeping_event_loop_alive(true);
                            }

                            // The heap keeps its ref.
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback;
                            // `reschedule()` saw the heap's ref still held and re-linked under it.
                            timer_all().update(this.timer_ref(), &time_before_call);
                        }
                        _ => {
                            break 'is_timer_done true;
                        }
                    }
                } else {
                    if kind == KindBig::SetTimeout && !repeat.is_null() {
                        if let Some(num) = idle_timeout.get_number() {
                            if num != -1.0 {
                                // reschedule() inside convertToInterval re-links under the
                                // heap's still-held ref; the .ACTIVE arm below keeps it.
                                Self::convert_to_interval(this, global, this_object, repeat);
                            }
                        }
                    }

                    match this.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            break 'is_timer_done true;
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback,
                            // or the timer was converted to an interval via t._repeat. It is
                            // linked again; the heap keeps its ref.
                        }
                        _ => {
                            // The developer called clearTimeout() synchronously in the callback.
                            // cancel() saw state == .FIRED and left the heap's ref, so release
                            // it here.
                            break 'is_timer_done true;
                        }
                    }
                }

                break 'is_timer_done false;
            };

            if is_timer_done {
                this.set_enable_keeping_event_loop_alive(false);
                // The timer will not be re-entered into the event loop at this point.
                Self::release_heap_ref(this);
            }
            // `_pin` drops here; after that `this` may be gone.
        }
        // --- after this point, the timer is no longer guaranteed to be alive ---

        vm.event_loop_mut().exit();
    }

    /// A `setTimeout` whose
    /// `t._repeat` was assigned promotes itself to a `setInterval` after its
    /// first fire (Node `lib/internal/timers.js:613`).
    fn convert_to_interval(
        this: ThisPtr<Self>,
        global: &JSGlobalObject,
        timer: JSValue,
        repeat: JSValue,
    ) {
        let internals = this.internals();
        debug_assert!(internals.flags.get().kind() == Kind::SetTimeout);

        let new_interval: u32 = if let Some(num) = repeat.get_number() {
            if num < 1.0 || num > f64::from(u32::MAX >> 1) {
                1
            } else {
                num as u32
            }
        } else {
            1
        };

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L613
        JSTimeout::idle_timeout_set_cached(timer, global, repeat);
        internals
            .this_value
            .with_mut(|r| r.set_strong(timer, global));
        internals.update_flags(|f| f.set_kind(Kind::SetInterval));
        internals.interval.set(new_interval);
        Self::reschedule(this, timer, global);
    }

    fn should_reschedule_timer(&self, repeat: JSValue, idle_timeout: JSValue) -> bool {
        if self.internals().flags.get().kind() == Kind::SetInterval && repeat.is_null() {
            return false;
        }
        if let Some(num) = idle_timeout.get_number() {
            if num == -1.0 {
                return false;
            }
        }
        true
    }

    /// (Re-)insert the timer's slot into the heap at `now + interval`, taking
    /// the heap's ref if it is not already held. Called from `schedule()`,
    /// `do_refresh()`, and `convert_to_interval()`.
    fn reschedule(this: ThisPtr<Self>, timer: JSValue, global: &JSGlobalObject) {
        let internals = this.internals();
        if internals.flags.get().kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout =
            JSTimeout::idle_timeout_get_cached(timer).expect("TimeoutObject idleTimeout slot");
        let repeat = JSTimeout::repeat_get_cached(timer).expect("TimeoutObject repeat slot");

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !this.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        let scheduled_time = now.add_ms(i64::from(internals.interval.get()));
        let was_active = this.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        if was_active {
            timer_all().remove(this.timer_ref());
        } else {
            Self::hold_heap_ref(this);
        }

        timer_all().update(this.timer_ref(), &scheduled_time);
        internals.update_flags(|f| f.set_has_cleared_timer(false));

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        JSTimeout::idle_start_set_cached(
            timer,
            global,
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if internals.flags.get().has_js_ref() {
            this.set_enable_keeping_event_loop_alive(true);
        }
    }

    /// `Drop` body (the refcount reached zero): unlink `self` from every
    /// `timer::All` structure it may still be reachable from so the imminent
    /// free cannot leave a dangling slot in the heap, a dangling id-map entry,
    /// or a leaked keep-alive count. `this_value` is released by `JsRef: Drop`.
    fn unschedule_for_drop(&mut self) {
        let kind = self.internals().flags.get().kind();
        let id = self.internals().id;

        if self.event_loop_timer_state() == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.timer_ref());
        }

        // Drop the `id → timer` entry minted by `to_primitive`. Swap-remove: the
        // id map is only ever keyed into, never iterated in order, and this runs
        // for every id-accessed timer a GC sweep collects, so the ordered
        // remove's O(n) shift + index rebuild here was O(n²) across a sweep.
        if self.internals().flags.get().has_accessed_primitive() {
            timer_all().maps.with_mut(|maps| {
                let map = Self::id_map(maps, kind);
                if map.swap_remove(&id) {
                    // If this map got
                    // large, shrink it back down. Keys are i32, values are one
                    // pointer (~12 bytes per entry), so 21,000 timers accessed by
                    // ID ≈ 252 KiB; reclaim once the slack exceeds 256 KiB.
                    const ENTRY_SIZE: usize =
                        core::mem::size_of::<i32>() + core::mem::size_of::<*mut EventLoopTimer>();
                    let allocated_bytes = map.capacity() * ENTRY_SIZE;
                    let used_bytes = map.count() * ENTRY_SIZE;
                    if allocated_bytes - used_bytes > 256 * 1024 {
                        map.shrink_and_free(map.count() + 8);
                    }
                } else if kind == Kind::SetInterval {
                    // A `setTimeout` promoted to a `setInterval` by
                    // `convert_to_interval()` keeps the entry minted by
                    // `to_primitive` in `maps.set_timeout`. Remove it from there
                    // too, or `remove_timer_by_id` would hand out a dangling
                    // entry after the parent is freed.
                    maps.set_timeout.swap_remove(&id);
                }
            });
        }

        // Without this a dropped-while-ref'd timer leaks `active_timer_count` /
        // `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(false);
    }

    // ──────────────────────────────────────────────────────────────────────
    // JS-host-method facade — `do_ref`/`do_unref`/`do_refresh`/`has_ref`/
    // `to_primitive`/`get_destroyed`/`cancel`, called from the
    // `TimeoutObject.rs` / `ImmediateObject.rs` host-fn shims.
    // ──────────────────────────────────────────────────────────────────────

    fn do_ref(&self, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

        let internals = self.internals();
        let did_have_js_ref = internals.flags.get().has_js_ref();
        internals.update_flags(|f| f.set_has_js_ref(true));

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        // Node only re-enables the keep-alive ref when `!this._destroyed`. Checking
        // `has_cleared_timer` alone is not sufficient: a one-shot timer that has already fired
        // has `has_cleared_timer == false` but is still destroyed. Calling `.unref(); .ref()`
        // on such a timer would otherwise leak an event-loop ref and hang the process.
        if !did_have_js_ref && !self.get_destroyed() {
            self.set_enable_keeping_event_loop_alive(true);
        }

        Ok(this_value)
    }

    fn do_unref(&self, this_value: JSValue) -> JsResult<JSValue> {
        this_value.ensure_still_alive();

        let internals = self.internals();
        let did_have_js_ref = internals.flags.get().has_js_ref();
        internals.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(false);
        }

        Ok(this_value)
    }

    /// Node's deadline is `_idleStart + _idleTimeout`; writing `_idleStart`
    /// must move the heap entry so `t2._idleStart = t1._idleStart` works.
    fn set_idle_start(&self, idle_start_ms: f64) {
        let internals = self.internals();
        if internals.flags.get().kind() == Kind::SetImmediate
            || internals.flags.get().has_cleared_timer()
            || self.event_loop_timer_state() != EventLoopTimerState::ACTIVE
            || !idle_start_ms.is_finite()
        {
            return;
        }

        let ms = (idle_start_ms as i64)
            .saturating_add(i64::from(internals.interval.get()))
            .max(0);
        let scheduled_time = Timespec::EPOCH.add_ms(ms);
        // The timer is ACTIVE so `update()` removes then re-inserts; the heap
        // keeps its ref.
        timer_all().update(self.timer_ref(), &scheduled_time);
    }

    fn do_refresh(
        this: ThisPtr<Self>,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let internals = this.internals();
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(internals.flags.get().kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if internals.id == -1
            || internals.flags.get().kind() == Kind::SetImmediate
            || internals.flags.get().has_cleared_timer()
        {
            return Ok(this_value);
        }

        internals
            .this_value
            .with_mut(|r| r.set_strong(this_value, global_object));
        Self::reschedule(this, this_value, global_object);

        Ok(this_value)
    }

    fn has_ref(&self) -> JsResult<JSValue> {
        Ok(JSValue::from(
            self.internals().flags.get().is_keeping_event_loop_alive(),
        ))
    }

    /// First access mints an `id → timer` entry in `All.maps` so
    /// `clearTimeout(+t)` / `clearImmediate(+t)` (numeric-id form) can resolve
    /// it. `Drop` removes the entry.
    fn to_primitive(this: ThisPtr<Self>) -> JsResult<JSValue> {
        let internals = this.internals();
        if !internals.flags.get().has_accessed_primitive() {
            internals.update_flags(|f| f.set_has_accessed_primitive(true));
            let kind = internals.flags.get().kind();
            timer_all()
                .maps
                .with_mut(|maps| Self::id_map(maps, kind).put(internals.id, BackRef::from(this)))?;
        }
        Ok(JSValue::js_number(f64::from(internals.id)))
    }

    /// Getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    fn get_destroyed(&self) -> bool {
        let internals = self.internals();
        if internals.flags.get().has_cleared_timer() {
            return true;
        }
        if internals.flags.get().in_callback() {
            return false;
        }
        match self.event_loop_timer_state() {
            EventLoopTimerState::ACTIVE | EventLoopTimerState::PENDING => false,
            EventLoopTimerState::FIRED | EventLoopTimerState::CANCELLED => true,
        }
    }

    /// `clearTimeout`/`clearInterval`
    /// / `clearImmediate` / `Timeout#[Symbol.dispose]` body. May free `this`.
    fn cancel(this: ThisPtr<Self>) {
        let internals = this.internals();
        this.set_enable_keeping_event_loop_alive(false);
        internals.update_flags(|f| f.set_has_cleared_timer(true));

        if internals.flags.get().kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            internals.this_value.with_mut(|r| r.downgrade());
            return;
        }

        let was_active = this.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        this.set_event_loop_timer_state(EventLoopTimerState::CANCELLED);
        internals.this_value.with_mut(|r| r.downgrade());

        if was_active {
            timer_all().remove(this.timer_ref());
            Self::release_heap_ref(this);
        }
    }

    /// [`cancel`](Self::cancel) on behalf of something other than the timer
    /// itself (VM teardown, the fake clock's `clear`), which may already have
    /// popped the slot: also releases the heap's ref when `cancel()` finds the
    /// slot no longer `ACTIVE`. May free `this`.
    fn release_heap_entry(this: ThisPtr<Self>) {
        let held = this.heap_ref().take();
        Self::cancel(this);
        drop(held);
    }
}
