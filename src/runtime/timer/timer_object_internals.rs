//! `TimerObjectInternals` — what `TimeoutObject` / `ImmediateObject` wrap.
//!
//! Struct + `Flags` packed-u32 state machine. `run_immediate_task()` +
//! helpers (`event_loop_timer`/`ref_`/`deref`/
//! `set_enable_keeping_event_loop_alive`/`run`) drive the
//! `__bun_run_immediate_task` dispatch path. `fire()` + `reschedule()`/
//! `should_reschedule_timer()`/`convert_to_interval()` drive the
//! `FIRE_TIMER` dispatch path (Timeout/Immediate arms). `init()` backs the
//! `TimeoutObject::init` / `ImmediateObject::init` constructors.

use bun_core::{Timespec, TimespecMockMode};

use crate::generated_bindgen::timer::{js_Immediate as JSImmediate, js_Timeout as JSTimeout};
use crate::jsc::JsCell;
use crate::jsc::virtual_machine::VirtualMachine;
use crate::jsc::{Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus};
use crate::jsc_hooks::timer_all;
use core::cell::{Cell, UnsafeCell};

use super::{
    ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, ID, Kind, KindBig,
};

/// The native half of a `Timeout` or an `Immediate`. `TimeoutObject` and `ImmediateObject` are
/// transparent wrappers of it, one for each JS class.
///
/// Only [`Self::alloc`] makes one (`ref_count` is private), on the heap, where it stays until its
/// last ref is released. It is only ever borrowed shared until then.
#[repr(C)]
#[derive(bun_ptr::RefCounted)]
pub(crate) struct TimerObjectInternals {
    ref_count: bun_ptr::RefCount<Self>,
    /// The timer heap links the node by address and writes to it. Every access here copies a
    /// field in or out.
    pub(super) event_loop_timer: UnsafeCell<EventLoopTimer>,
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub(crate) id: u64,
    pub this_value: JsCell<JsRef>,
    pub(crate) interval: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
    /// The context whose script created the timer.
    pub(crate) context: bun_jsc::ContextId,
    /// `VirtualMachine::test_isolation_generation` when it did.
    pub(crate) generation: u32,
}

// Putting `interval` between `id` and `this_value` would add 8 bytes of padding.
const _: () = assert!(
    core::mem::size_of::<TimerObjectInternals>()
        == core::mem::size_of::<bun_ptr::RefCount<TimerObjectInternals>>().next_multiple_of(8)
            + core::mem::size_of::<EventLoopTimer>()
            + 40
);

impl TimerObjectInternals {
    /// Read-modify-write `self.flags` through the `Cell` (R-2: `flags` is
    /// `Cell<Flags>` so the write is interior-mutable, callable from
    /// `&self` host-fns that re-enter JS).
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut fl = self.flags.get();
        f(&mut fl);
        self.flags.set(fl);
    }
}

// LAYERING: `Flags` (the packed-u32 state machine) was MOVED DOWN to
// `bun_event_loop::EventLoopTimer::TimerFlags` so `bun_jsc::abort_signal::Timeout`
// can name it without a forward dep on this crate. Re-exported here so existing
// `TimerObjectInternals`/`All::update` callers see the same nominal type.
pub(crate) use bun_event_loop::EventLoopTimer::TimerFlags as Flags;

// ──────────────────────────────────────────────────────────────────────────
// `runImmediateTask` path for `__bun_run_immediate_task` (dispatch.rs).
// ──────────────────────────────────────────────────────────────────────────

// C++ symbol emitted from ImmediateList.cpp / setTimeout.cpp; already linked.
unsafe extern "C" {
    safe fn Bun__JSTimeout__call(
        global_object: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
    ) -> bool;
}

impl TimerObjectInternals {
    /// A new timer with one ref, for the JS object. `tag` and `kind` are those of the same JS
    /// class. [`Self::init`] schedules it.
    pub(super) fn alloc(
        tag: EventLoopTimerTag,
        cx: &bun_jsc::JsThread<'_>,
        id: u64,
        kind: Kind,
        interval: u32,
    ) -> *mut Self {
        debug_assert!((tag == EventLoopTimerTag::ImmediateObject) == (kind == Kind::SetImmediate));
        bun_core::heap::into_raw(Box::new(Self {
            ref_count: bun_ptr::RefCount::init(),
            event_loop_timer: UnsafeCell::new(EventLoopTimer::init_paused(tag)),
            id,
            this_value: JsCell::new(JsRef::empty()),
            interval: Cell::new(interval),
            flags: {
                let mut f = Flags::default();
                f.set_kind(kind);
                f.set_epoch(timer_all().epoch.get());
                Cell::new(f)
            },
            context: cx.context().id(),
            generation: cx.vm().test_isolation_generation.get(),
        }))
    }

    #[inline]
    fn event_loop_timer(&self) -> *mut EventLoopTimer {
        self.event_loop_timer.get()
    }

    /// Increment the intrusive refcount.
    fn ref_(&self) {
        // SAFETY: `self` is live.
        unsafe { bun_ptr::RefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut()) }
    }

    /// Release a `TimeoutObject`/`ImmediateObject` that was unlinked from a
    /// timer heap by something other than [`Self::cancel`] (e.g.
    /// `FakeTimers::clear`'s `delete_min` drain). Downgrades the `Strong` JS
    /// pin and releases the `+1` taken by `reschedule()`, so GC can collect
    /// the wrapper and the box frees on the final deref.
    ///
    /// `cancel()` skips its own `remove`/`deref` because `state` is already
    /// `CANCELLED`, which is why the explicit `deref` follows.
    ///
    /// # Safety
    /// `this` is live, with the ref of `reschedule()` still to be released. This call may free it.
    pub(crate) unsafe fn release_heap_pin(this: core::ptr::NonNull<Self>, vm: &VirtualMachine) {
        // SAFETY: fn contract. The ref still to be released keeps `this` live across `cancel`.
        unsafe {
            this.as_ref().cancel(vm);
            Self::deref(this.as_ptr());
        }
    }

    /// Releases a ref, and frees `this` if it was the last.
    ///
    /// # Safety
    /// `this` is live and the ref is the caller's to release. No reference to `*this` is used
    /// afterwards.
    unsafe fn deref(this: *mut Self) {
        // SAFETY: fn contract; `this` is the box of `alloc` (see the type).
        unsafe { bun_ptr::RefCount::<Self>::deref(this) }
    }

    /// Releases a ref while the caller holds another.
    fn deref_pinned(&self) {
        self.ref_count.release_not_last();
    }

    #[inline]
    pub(crate) fn async_id(&self) -> u64 {
        ID {
            id: self.id,
            kind: self.flags.get().kind().into(),
        }
        .async_id()
    }

    fn set_enable_keeping_event_loop_alive(&self, vm: &VirtualMachine, enable: bool) {
        if self.flags.get().is_keeping_event_loop_alive() == enable {
            return;
        }
        self.update_flags(|f| f.set_is_keeping_event_loop_alive(enable));

        let uws_loop = vm.uws_loop();
        let delta = if enable { 1 } else { -1 };
        match self.flags.get().kind() {
            Kind::SetTimeout | Kind::SetInterval => {
                timer_all().increment_timer_ref(delta, uws_loop)
            }
            // setImmediate has slightly different event loop logic
            Kind::SetImmediate => timer_all().increment_immediate_ref(delta, uws_loop),
        }
    }

    /// Invoke the JS callback via the
    /// C++ `Bun__JSTimeout__call` thunk (which handles exceptions internally).
    /// Returns `true` if an exception was thrown.
    ///
    /// The callback can reach this same object (`cancel()`, `do_refresh()`), so the caller's
    /// `ref_()` pins the parent for the duration of the call.
    fn run(
        &self,
        global: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: &VirtualMachine,
    ) -> bool {
        if vm.is_inspector_enabled() {
            Debugger::will_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        self.update_flags(|f| f.set_in_callback(true));
        let result = Bun__JSTimeout__call(global, timer, callback, arguments);
        // No early returns between the `in_callback` set and this clear.
        self.update_flags(|f| f.set_in_callback(false));

        if vm.is_inspector_enabled() {
            Debugger::did_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    /// Schedules a timer fresh from [`Self::alloc`], called with the same `cx`. `timer` is its
    /// JS object.
    pub(super) fn init(
        &self,
        timer: JSValue,
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
    ) {
        let vm = cx.vm();
        let kind = self.flags.get().kind();
        let interval = self.interval.get();

        // Only a graph's context keeps a list of its timers.
        if let Some(context) = vm.as_graph_context(cx.context()) {
            context.track_timer(
                core::ptr::from_ref(self).cast_mut().cast(),
                bun_jsc::ContextTimer::Object,
            );
        }

        if kind == Kind::SetImmediate {
            JSImmediate::arguments_set_cached(timer, cx.global(), arguments);
            JSImmediate::callback_set_cached(timer, cx.global(), callback);
            // `__bun_run_immediate_task` casts it to `*mut ImmediateObject`, the transparent
            // wrapper of `Self`.
            vm.enqueue_immediate_task(core::ptr::from_ref(self).cast_mut().cast());
            self.set_enable_keeping_event_loop_alive(vm, true);
            // ref'd by event loop
            self.ref_();
        } else {
            JSTimeout::arguments_set_cached(timer, cx.global(), arguments);
            JSTimeout::callback_set_cached(timer, cx.global(), callback);
            JSTimeout::idle_timeout_set_cached(
                timer,
                cx.global(),
                JSValue::js_number(f64::from(interval)),
            );
            JSTimeout::repeat_set_cached(
                timer,
                cx.global(),
                if kind == Kind::SetInterval {
                    JSValue::js_number(f64::from(interval))
                } else {
                    JSValue::NULL
                },
            );

            // this increments the refcount and sets _idleStart
            self.reschedule(timer, vm, cx.global());
        }

        self.this_value
            .with_mut(|r| r.set_strong(timer, cx.global()));
    }

    /// Returns `true` if an
    /// exception was thrown.
    ///
    /// # Safety
    /// `this` points at the live `TimerObjectInternals` of an `ImmediateObject`, which this call
    /// may free.
    pub(crate) unsafe fn run_immediate_task(this: *mut Self, vm: &VirtualMachine) -> bool {
        // SAFETY: per fn contract. `s` is not used after a `release()`.
        let s = unsafe { &*this };
        // SAFETY: per fn contract; the queued task's ref is this call's to release.
        let release = || unsafe { Self::deref(this) };
        let cleared = s.flags.get().has_cleared_timer()
            // The VM's stop was requested: nothing more enters script (as `fire`).
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || vm.has_outlived_its_script(s.context, s.generation)
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!s.flags.get().is_keeping_event_loop_alive()
                && !vm.is_event_loop_alive_excluding_immediates());
        if cleared {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.this_value.with_mut(|r| r.downgrade());
            release();
            return false;
        }

        let Some(timer) = s.this_value.get().try_get() else {
            #[cfg(debug_assertions)]
            panic!("TimerObjectInternals.runImmediateTask: this_object is null");
            #[cfg(not(debug_assertions))]
            {
                s.set_enable_keeping_event_loop_alive(vm, false);
                release();
                return false;
            }
        };
        let global_this = vm.global();
        s.this_value.with_mut(|r| r.downgrade());
        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);
        s.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        vm.event_loop().enter();
        let callback =
            JSImmediate::callback_get_cached(timer).expect("ImmediateObject callback slot");
        let arguments =
            JSImmediate::arguments_get_cached(timer).expect("ImmediateObject arguments slot");

        let exception_thrown = {
            s.ref_();
            let async_id = s.async_id();
            let result = s.run(global_this, timer, callback, arguments, async_id, vm);
            // Fresh read: re-entrant `cancel()`/`refresh()` may have changed
            // `state` (`ref_()` above pins the parent).
            if s.event_loop_timer_state() == EventLoopTimerState::FIRED {
                s.deref_pinned();
            }
            release();
            result
        };
        // --- after this point, the timer is no longer guaranteed to be alive ---

        if vm
            .event_loop()
            .exit_maybe_drain_microtasks(!exception_thrown)
            .is_err()
        {
            return true;
        }

        exception_thrown
    }

    /// # Safety
    /// `this` must be the live `internals` of a queued `ImmediateObject`.
    pub(crate) unsafe fn cancel_pending_immediate(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: per fn contract.
        let s = unsafe { &*this };
        s.set_enable_keeping_event_loop_alive(vm, false);
        s.this_value.with_mut(|r| r.downgrade());
        // SAFETY: the queue's ref is this call's to release, and `s` is not used again.
        unsafe { Self::deref(this) };
    }

    /// `EventLoopTimer.fire` dispatch
    /// arm body for `Tag::TimeoutObject`/`Tag::ImmediateObject`. Pops the JS
    /// timer, invokes its callback via `run()`, then either reschedules
    /// (setInterval / `t._repeat`) or releases the heap ref.
    ///
    /// # Safety
    /// `this` points at a live `TimerObjectInternals`, which this call may free, and the timer
    /// heap has just popped its node.
    pub(crate) unsafe fn fire(this: *mut Self, _now: &ElTimespec, vm: &VirtualMachine) {
        // SAFETY: per fn contract. `s` is not used after a `release()`.
        let s = unsafe { &*this };
        // SAFETY: per fn contract; the popped node's ref is this call's to release.
        let release = || unsafe { Self::deref(this) };
        let id = s.id;
        let kind: KindBig = s.flags.get().kind().into();
        let async_id = ID { id, kind };
        let has_been_cleared = s.event_loop_timer_state() == EventLoopTimerState::CANCELLED
            || s.flags.get().has_cleared_timer()
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || vm.has_outlived_its_script(s.context, s.generation);

        s.set_event_loop_timer_state(EventLoopTimerState::FIRED);

        let global_this = vm.global();
        let Some(this_object) = s.this_value.get().try_get() else {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            release();
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
                    global_this,
                    Debugger::AsyncCallType::DOMTimer,
                    async_id.async_id(),
                );
            }
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.with_mut(|r| r.downgrade());
            release();
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

        vm.event_loop().enter();
        {
            // Ensure it stays alive for this scope.
            s.ref_();
            // The matching `release()` is at the end of this
            // block. Every path through the labelled-block + `is_timer_done`
            // tail reaches it (no `return` between here and there).

            let _ = s.run(
                global_this,
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

            let is_timer_done = 'is_timer_done: {
                // Node doesn't drain microtasks after each timer callback.
                if kind == KindBig::SetInterval {
                    if !s.should_reschedule_timer(repeat, idle_timeout) {
                        break 'is_timer_done true;
                    }
                    // `ref_()` above pins the parent across the deref.
                    match s.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            // If we didn't clear the setInterval, reschedule it starting from
                            // SAFETY: as in `reschedule`; the ref that the popped node held is
                            // kept for it.
                            unsafe { timer_all().update(s.event_loop_timer(), &time_before_call) };

                            if s.flags.get().has_js_ref() {
                                s.set_enable_keeping_event_loop_alive(vm, true);
                            }

                            // The ref count doesn't change. It wasn't decremented.
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback.
                            // SAFETY: as in `reschedule`, which took the node's ref.
                            unsafe { timer_all().update(s.event_loop_timer(), &time_before_call) };

                            // Balance out the ref count.
                            // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                            s.deref_pinned();
                        }
                        _ => {
                            break 'is_timer_done true;
                        }
                    }
                } else {
                    if kind == KindBig::SetTimeout && !repeat.is_null() {
                        if let Some(num) = idle_timeout.get_number() {
                            if num != -1.0 {
                                // reschedule() inside convertToInterval will see state == .FIRED
                                // and add a ref; fall through to the switch below so the .ACTIVE
                                // arm can balance it.
                                s.convert_to_interval(global_this, this_object, repeat, vm);
                            }
                        }
                    }

                    // `ref_()` above pins the parent across the deref.
                    match s.event_loop_timer_state() {
                        EventLoopTimerState::FIRED => {
                            break 'is_timer_done true;
                        }
                        EventLoopTimerState::ACTIVE => {
                            // The developer called timer.refresh() synchronously in the callback,
                            // or the timer was converted to an interval via t._repeat. Balance out
                            // the ref count: the transition from "FIRED" -> "ACTIVE" via
                            // reschedule() caused it to increment.
                            s.deref_pinned();
                        }
                        _ => {
                            // The developer called clearTimeout() synchronously in the callback.
                            // cancel() saw state == .FIRED and skipped its deref, so release the
                            // heap ref here.
                            break 'is_timer_done true;
                        }
                    }
                }

                break 'is_timer_done false;
            };

            if is_timer_done {
                s.set_enable_keeping_event_loop_alive(vm, false);
                // The timer will not be re-entered into the event loop at this point.
                s.deref_pinned();
            }

            // End of pinned scope. After
            // this `*this` may be freed; do not touch past this block.
            release();
        }
        // --- after this point, the timer is no longer guaranteed to be alive ---

        vm.event_loop().exit();
    }

    /// A `setTimeout` whose
    /// `t._repeat` was assigned promotes itself to a `setInterval` after its
    /// first fire (Node `lib/internal/timers.js:613`).
    fn convert_to_interval(
        &self,
        global: &JSGlobalObject,
        timer: JSValue,
        repeat: JSValue,
        vm: &VirtualMachine,
    ) {
        debug_assert!(self.flags.get().kind() == Kind::SetTimeout);

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
        self.this_value.with_mut(|r| r.set_strong(timer, global));
        self.update_flags(|f| f.set_kind(Kind::SetInterval));
        self.interval.set(new_interval);
        self.reschedule(timer, vm, global);
    }

    fn should_reschedule_timer(&self, repeat: JSValue, idle_timeout: JSValue) -> bool {
        if self.flags.get().kind() == Kind::SetInterval && repeat.is_null() {
            return false;
        }
        if let Some(num) = idle_timeout.get_number() {
            if num == -1.0 {
                return false;
            }
        }
        true
    }

    /// Re-insert the
    /// `EventLoopTimer` into the heap at `now + interval`. Called from
    /// `init()`, `do_refresh()`, and `convert_to_interval()` above.
    pub(crate) fn reschedule(
        &self,
        timer: JSValue,
        vm: &VirtualMachine,
        global_this: &JSGlobalObject,
    ) {
        if self.flags.get().kind() == Kind::SetImmediate {
            return;
        }

        let idle_timeout =
            JSTimeout::idle_timeout_get_cached(timer).expect("TimeoutObject idleTimeout slot");
        let repeat = JSTimeout::repeat_get_cached(timer).expect("TimeoutObject repeat slot");

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !self.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let all = timer_all();

        let now = Timespec::now(TimespecMockMode::AllowMockedTime);
        // Only `Bun.sleep()` has an `interval` below 1.
        let min_delay = all.fake_timers.min_delay_ms();
        let scheduled_time = now.add_ms(i64::from(self.interval.get().max(min_delay)));
        let was_active = self.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        if !was_active {
            self.ref_();
        }

        // SAFETY: the node is in a cell of `self`, which stays where `alloc` put it (see the
        // type) for as long as it has a ref. A linked node holds one: it is released once the node
        // is unlinked, by `fire`, `cancel` or `release_heap_pin`, and `Drop` unlinks a node that
        // is still linked. `ACTIVE` is linked: `fire` marks the popped node `FIRED` before it
        // calls anything, and `FakeTimers::clear` marks what it unlinks `CANCELLED`.
        unsafe { all.update(self.event_loop_timer(), &scheduled_time) };
        self.update_flags(|f| f.set_has_cleared_timer(false));

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        JSTimeout::idle_start_set_cached(
            timer,
            global_this,
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if self.flags.get().has_js_ref() {
            self.set_enable_keeping_event_loop_alive(vm, true);
        }
    }
}

/// Final teardown (count hit
/// zero). Unlinks the timer from every `Timer::All` data structure it may
/// still be reachable from so the free cannot leave a dangling
/// `*mut EventLoopTimer` in the heap or a leaked keep-alive count.
/// `this_value` is released by `JsRef: Drop` right after.
impl Drop for TimerObjectInternals {
    fn drop(&mut self) {
        let vm = VirtualMachine::get();
        let kind = self.flags.get().kind();
        let all = timer_all();

        // (b) `vm.timer.remove(eventLoopTimer())` if state == .ACTIVE — without
        //     this the freed node stays linked into `All.timers` and the next
        //     `delete_min`/`drain_timers` dereferences freed memory.
        if self.event_loop_timer_state() == EventLoopTimerState::ACTIVE {
            // SAFETY: `ACTIVE` is linked (see `reschedule`).
            unsafe { all.remove(self.event_loop_timer()) };
        }

        // (c) `vm.timer.maps.get(kind).swapRemove(id)` if
        //     `has_accessed_primitive` — drops the id→*mut EventLoopTimer
        //     entry minted by `to_primitive`. Swap-remove: the id map is only
        //     ever keyed into, never iterated in order, and `deinit` runs for
        //     every id-accessed timer a GC sweep collects, so the ordered
        //     remove's O(n) shift + index rebuild here was O(n²) across a
        //     sweep.
        if self.flags.get().has_accessed_primitive() {
            let map = all.maps.get(kind);
            if map.swap_remove(self.id) {
                map.shrink_if_sparse();
            } else if kind == Kind::SetInterval {
                // A `setTimeout` promoted to a `setInterval` by
                // `convert_to_interval()` keeps the entry minted by
                // `to_primitive` in `maps.set_timeout`. Remove it from there
                // too, or `remove_timer_by_id` would hand out a dangling
                // `*mut EventLoopTimer` after `self` is freed.
                all.maps.set_timeout.swap_remove(self.id);
            }
        }

        if let Some(context) = vm.timer_context(self.context) {
            context.untrack_timer(core::ptr::from_mut(self).cast());
        }

        // (d) `setEnableKeepingEventLoopAlive(vm, false)` — without this a
        //     dropped-while-ref'd timer leaks `active_timer_count` /
        //     `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(vm, false);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JS-host-method facade — `do_ref`/`do_unref`/`do_refresh`/`has_ref`/
// `to_primitive`/`get_destroyed`/`finalize`/`cancel`, called from
// `TimeoutObject.rs` / `ImmediateObject.rs` host-fn shims.
// ──────────────────────────────────────────────────────────────────────────
impl TimerObjectInternals {
    fn event_loop_timer_state(&self) -> EventLoopTimerState {
        // SAFETY: see the field.
        unsafe { (*self.event_loop_timer.get()).state }
    }

    fn set_event_loop_timer_state(&self, state: EventLoopTimerState) {
        // SAFETY: see the field.
        unsafe { (*self.event_loop_timer.get()).state = state };
    }

    pub(crate) fn do_ref(&self, this_value: JSValue) -> JSValue {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(true));

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L256
        // and
        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L685-L687
        // Node only re-enables the keep-alive ref when `!this._destroyed`. Checking
        // `has_cleared_timer` alone is not sufficient: a one-shot timer that has already fired
        // has `has_cleared_timer == false` but is still destroyed. Calling `.unref(); .ref()`
        // on such a timer would otherwise leak an event-loop ref and hang the process.
        if !did_have_js_ref && !self.get_destroyed() {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), true);
        }

        this_value
    }

    pub(crate) fn do_unref(&self, this_value: JSValue) -> JSValue {
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), false);
        }

        this_value
    }

    /// Node's deadline is `_idleStart + _idleTimeout`; writing `_idleStart`
    /// must move the heap entry so `t2._idleStart = t1._idleStart` works.
    pub(crate) fn set_idle_start(&self, idle_start_ms: f64) {
        if self.flags.get().kind() == Kind::SetImmediate
            || self.flags.get().has_cleared_timer()
            || self.event_loop_timer_state() != EventLoopTimerState::ACTIVE
            || !idle_start_ms.is_finite()
        {
            return;
        }

        let ms = (idle_start_ms as i64)
            .saturating_add(i64::from(self.interval.get()))
            .max(0);
        let scheduled_time = Timespec::EPOCH.add_ms(ms);
        // The timer is ACTIVE so `update()` removes then re-inserts with no refcount change.
        // SAFETY: as in `reschedule`, which took the node's ref.
        unsafe { timer_all().update(self.event_loop_timer(), &scheduled_time) };
    }

    pub(crate) fn do_refresh(
        &self,
        global_object: &JSGlobalObject,
        this_value: JSValue,
    ) -> JSValue {
        // Immediates do not have a refresh function, and our binding generator should not let this
        // function be reached even if you override the `this` value calling a Timeout object's
        // `refresh` method
        debug_assert!(self.flags.get().kind() != Kind::SetImmediate);

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if self.flags.get().kind() == Kind::SetImmediate || self.flags.get().has_cleared_timer() {
            return this_value;
        }

        self.this_value
            .with_mut(|r| r.set_strong(this_value, global_object));
        self.reschedule(this_value, VirtualMachine::get(), global_object);

        this_value
    }

    pub(crate) fn has_ref(&self) -> bool {
        self.flags.get().is_keeping_event_loop_alive()
    }

    /// First access mints an
    /// `id → *mut EventLoopTimer` entry in `All.maps` so `clearTimeout(+t)` /
    /// `clearImmediate(+t)` (numeric-id form) can resolve it.
    pub(crate) fn to_primitive(&self) -> JsResult<u64> {
        if !self.flags.get().has_accessed_primitive() {
            self.update_flags(|f| f.set_has_accessed_primitive(true));
            timer_all()
                .maps
                .get(self.flags.get().kind())
                .put_no_clobber(self.id, self.event_loop_timer())?;
        }
        Ok(self.id)
    }

    /// Getter for `_destroyed`
    /// on JS Timeout and Immediate objects.
    pub(crate) fn get_destroyed(&self) -> bool {
        if self.flags.get().has_cleared_timer() {
            return true;
        }
        if self.flags.get().in_callback() {
            return false;
        }
        match self.event_loop_timer_state() {
            EventLoopTimerState::ACTIVE | EventLoopTimerState::PENDING => false,
            EventLoopTimerState::FIRED | EventLoopTimerState::CANCELLED => true,
        }
    }

    /// Runs on the mutator thread during lazy sweep; do not touch any
    /// `JSValue`/`Strong` content here.
    pub(crate) fn finalize(&self) {
        self.this_value.with_mut(|r| r.finalize());
    }

    /// `clearTimeout`/`clearInterval` / `clearImmediate` / `Timeout#[Symbol.dispose]`, for a
    /// caller that holds a ref of its own, or borrows through the JS object, which does.
    pub(crate) fn cancel(&self, vm: &VirtualMachine) {
        if self.stop(vm) {
            self.deref_pinned();
        }
    }

    /// [`Self::cancel`] for a caller that found the timer in the heap or in a map.
    ///
    /// # Safety
    /// `this` is live. This call may free it.
    pub(crate) unsafe fn cancel_unpinned(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: fn contract. `stop` returns the ref of the node it unlinked.
        unsafe {
            if (*this).stop(vm) {
                Self::deref(this);
            }
        }
    }

    /// Returns whether it unlinked the node, whose ref is then the caller's to release.
    #[must_use]
    fn stop(&self, vm: &VirtualMachine) -> bool {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.update_flags(|f| f.set_has_cleared_timer(true));

        if self.flags.get().kind() == Kind::SetImmediate {
            // Release the strong reference so the GC can collect the JS object.
            // The immediate task is still in the event loop queue and will be skipped
            // by runImmediateTask when it sees has_cleared_timer == true.
            self.this_value.with_mut(|r| r.downgrade());
            return false;
        }

        let was_active = self.event_loop_timer_state() == EventLoopTimerState::ACTIVE;
        self.set_event_loop_timer_state(EventLoopTimerState::CANCELLED);
        self.this_value.with_mut(|r| r.downgrade());

        if was_active {
            // SAFETY: it was `ACTIVE`, which is linked (see `reschedule`).
            unsafe { timer_all().remove(self.event_loop_timer()) };
        }
        was_active
    }
}
