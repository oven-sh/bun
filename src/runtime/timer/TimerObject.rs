//! `TimerObject` — the native side of `Timeout` and `Immediate` (`Timer.bind.ts`).

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::EventLoopTimer::{ImmediateTask, OwnedBy, TimerFlags as Flags};
use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_ptr::{RefCount, RefPtr};

use crate::generated_bindgen::timer::{js_Immediate as JSImmediate, js_Timeout as JSTimeout};
use crate::jsc::{Debugger, JSGlobalObject, JSValue, JsRef, JsResult, ScriptExecutionStatus};
use core::cell::Cell;
// Note: `bun_jsc::VirtualMachine` is a *module* alias; the struct lives at
// `virtual_machine::VirtualMachine`.
use crate::jsc::virtual_machine::VirtualMachine;
use crate::jsc_hooks::timer_all;

use super::{
    Clock, EventLoopTimerTag, ID, Kind, KindBig, RefCountedTimer, TimeoutObject, TimerRef,
};

/// See [`TimeoutObject`] and [`ImmediateObject`].
#[derive(bun_ptr::RefCounted)]
pub(crate) struct TimerObject<const TAG: EventLoopTimerTag> {
    ref_count: RefCount,
    pub(crate) event_loop_timer: RefCountedTimer<TAG>,
    /// Identifier for this timer that is exposed to JavaScript (by `+timer`).
    pub(crate) id: u64,
    pub this_value: JsRef,
    pub(crate) interval: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
    /// The context whose script created the timer.
    pub(crate) context: bun_jsc::ContextId,
    /// `VirtualMachine::test_isolation_generation` when it did.
    pub(crate) generation: u32,
}

#[cfg(not(debug_assertions))]
const _: () = assert!(size_of::<TimeoutObject>() == 96);

/// `Immediate`, declared in `Timer.bind.ts`.
pub(crate) type ImmediateObject = TimerObject<{ EventLoopTimerTag::ImmediateObject }>;

bun_event_loop::impl_timer_owner!(ImmediateObject; event_loop_timer: RefCountedTimer<ImmediateObject>);

// ──────────────────────────────────────────────────────────────────────────
// `runImmediateTask` path for `__bun_run_immediate_task` (dispatch.rs).
// ──────────────────────────────────────────────────────────────────────────

// C++ symbol emitted from ImmediateList.cpp / setTimeout.cpp; already linked.
unsafe extern "C" {
    /// `thrown` receives the callback's exception. `None` reports it as uncaught.
    safe fn Bun__JSTimeout__call(
        global_object: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        thrown: Option<&mut JSValue>,
    ) -> bool;
}

impl<const TAG: EventLoopTimerTag> TimerObject<TAG> {
    const IS_IMMEDIATE: bool = matches!(TAG, EventLoopTimerTag::ImmediateObject);

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

    fn set_enable_keeping_event_loop_alive(&self, vm: &VirtualMachine, enable: bool) {
        if self.flags.get().is_keeping_event_loop_alive() == enable {
            return;
        }
        self.update_flags(|f| f.set_is_keeping_event_loop_alive(enable));

        let timers = timer_all();
        let uws_loop = vm.uws_loop();
        let delta = if enable { 1 } else { -1 };
        // setImmediate has slightly different event loop logic
        if Self::IS_IMMEDIATE && !self.flags.get().fake() {
            timers.increment_immediate_ref(delta, uws_loop)
        } else {
            timers.increment_timer_ref(delta, uws_loop)
        }
    }

    /// Invoke the JS callback via the
    /// C++ `Bun__JSTimeout__call` thunk (which handles exceptions internally).
    /// Returns `true` if an exception was thrown.
    ///
    /// Note (noalias re-entrancy): takes `&self`, NOT `&mut self`.
    /// The JS callback can re-enter `cancel()`/`refresh()` on this same
    /// object via another `&Self` derived from the JS wrapper's `m_ptr`.
    /// With `&mut self` here, LLVM's `noalias` lets it keep `self.flags` in a
    /// register across the FFI call, so `set_in_callback(false)`'s RMW
    /// clobbers the `has_cleared_timer` bit that `cancel()` set — the interval
    /// re-fires forever. The fields they write are `Cell`/`JsRef`, so `&self`
    /// carries no such guarantee.
    fn run(
        &self,
        global: &JSGlobalObject,
        timer: JSValue,
        callback: JSValue,
        arguments: JSValue,
        async_id: u64,
        vm: &VirtualMachine,
        thrown: Option<&mut JSValue>,
    ) -> bool {
        if vm.is_inspector_enabled() {
            Debugger::will_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        // Bun__JSTimeout__call handles exceptions.
        // `Cell<Flags>` RMW so the `in_callback` write reaches memory before JS
        // runs (re-entrant `_destroyed` getter reads it via a different pointer).
        self.update_flags(|f| f.set_in_callback(true));
        let result = Bun__JSTimeout__call(global, timer, callback, arguments, thrown);
        // No early returns between the `in_callback` set and this clear.
        // `Cell<Flags>` RMW: must reload `flags` from memory — re-entrant
        // `cancel()` may have set `has_cleared_timer` / cleared
        // `is_keeping_event_loop_alive`.
        self.update_flags(|f| f.set_in_callback(false));

        if vm.is_inspector_enabled() {
            Debugger::did_dispatch_async_call(global, Debugger::AsyncCallType::DOMTimer, async_id);
        }

        result
    }

    /// `start()` makes the JS object and schedules the timer.
    pub(super) fn new(
        cx: &bun_jsc::JsThread<'_>,
        id: u64,
        kind: Kind,
        interval: u32,
        clock: Clock,
    ) -> RefPtr<Self> {
        debug_assert!(Self::IS_IMMEDIATE == (kind == Kind::SetImmediate));
        let mut flags = Flags::default();
        flags.set_kind(kind);
        flags.set_fake(clock == Clock::Fake);
        let this = RefPtr::new(Self {
            ref_count: RefCount::init(),
            event_loop_timer: RefCountedTimer::init_paused(),
            id,
            this_value: JsRef::empty(),
            interval: Cell::new(interval),
            flags: Cell::new(flags),
            context: cx.context().id(),
            generation: cx.vm().test_isolation_generation.get(),
        });
        // Only a graph's context keeps a list of its timers.
        if let Some(context) = cx.vm().as_graph_context(cx.context()) {
            let kind = if Self::IS_IMMEDIATE {
                bun_jsc::ContextTimer::ImmediateObject
            } else {
                bun_jsc::ContextTimer::TimeoutObject
            };
            // SAFETY: `drop` untracks it.
            unsafe { context.track_timer(this.as_ptr().cast(), kind) };
        }
        this
    }

    fn did_schedule_async_call(&self, cx: &bun_jsc::JsThread<'_>) {
        if cx.vm().is_inspector_enabled() {
            Debugger::did_schedule_async_call(
                cx.global(),
                Debugger::AsyncCallType::DOMTimer,
                self.async_id(),
                self.flags.get().kind() != Kind::SetInterval,
            );
        }
    }

    /// A JS timer stays on the clock it was created on.
    fn clock(&self) -> Clock {
        if self.flags.get().fake() {
            Clock::Fake
        } else {
            Clock::Real
        }
    }
}

impl ImmediateObject {
    pub(super) fn start(
        this: RefPtr<Self>,
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        let timer = Self::to_js_nonnull(this.clone().into_non_null(), cx.global());
        let _keep = bun_jsc::EnsureStillAlive(timer);
        JSImmediate::arguments_set_cached(timer, cx.global(), arguments);
        JSImmediate::callback_set_cached(timer, cx.global(), callback);
        this.this_value.set_strong(timer, cx.global());
        this.did_schedule_async_call(cx);

        let vm = cx.vm();
        this.set_enable_keeping_event_loop_alive(vm, true);
        if this.flags.get().fake() {
            let timers = timer_all();
            let min_delay = timers.fake_timers.min_delay_ms();
            let time = timers.fake_timers.now().add_ms(i64::from(min_delay));
            timers.update_with_clock(TimerRef::from_ref_ptr(this), &time, Clock::Fake);
        } else {
            vm.enqueue_immediate_task(ImmediateTask::new(this));
        }
        timer
    }

    /// Returns `true` if an
    /// exception was thrown.
    ///
    /// `queued` is the ref that the queue of immediates held.
    pub(crate) fn run_immediate_task(queued: RefPtr<ImmediateObject>, vm: &VirtualMachine) -> bool {
        let s = &*queued;
        let cleared = s.flags.get().has_cleared_timer()
            // The VM's stop was requested: nothing more enters script (as `fire_catching`).
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || vm.has_outlived_its_script(s.context, s.generation)
            // unref'd setImmediate callbacks should only run if there are things
            // keeping the event loop alive other than setImmediates
            || (!s.flags.get().is_keeping_event_loop_alive()
                && !vm.is_event_loop_alive_excluding_immediates());
        if cleared {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.this_value.downgrade();
            return false;
        }

        let Some(timer) = s.this_value.try_get() else {
            #[cfg(debug_assertions)]
            panic!("ImmediateObject::run_immediate_task: this_object is null");
            #[cfg(not(debug_assertions))]
            {
                s.set_enable_keeping_event_loop_alive(vm, false);
                return false;
            }
        };
        let global_this = vm.global();
        s.this_value.downgrade();
        s.set_enable_keeping_event_loop_alive(vm, false);
        timer.ensure_still_alive();

        vm.event_loop().enter();
        let callback =
            JSImmediate::callback_get_cached(timer).expect("ImmediateObject callback slot");
        let arguments =
            JSImmediate::arguments_get_cached(timer).expect("ImmediateObject arguments slot");

        let exception_thrown = s.run(
            global_this,
            timer,
            callback,
            arguments,
            s.async_id(),
            vm,
            None,
        );
        s.update_flags(|f| f.set_has_cleared_timer(true));
        drop(queued);

        let event_loop = vm.event_loop();
        if event_loop
            .exit_maybe_drain_microtasks(!exception_thrown)
            .is_err()
        {
            return true;
        }

        exception_thrown
    }

    pub(crate) fn cancel_pending_immediate(&self, vm: &VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        self.this_value.downgrade();
    }
}

impl TimeoutObject {
    pub(super) fn start(
        this: RefPtr<Self>,
        cx: &bun_jsc::JsThread<'_>,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        let timer = Self::to_js_nonnull(this.clone().into_non_null(), cx.global());
        let _keep = bun_jsc::EnsureStillAlive(timer);
        let interval = JSValue::js_number(f64::from(this.interval.get()));
        JSTimeout::arguments_set_cached(timer, cx.global(), arguments);
        JSTimeout::callback_set_cached(timer, cx.global(), callback);
        JSTimeout::idle_timeout_set_cached(timer, cx.global(), interval);
        JSTimeout::repeat_set_cached(
            timer,
            cx.global(),
            if this.flags.get().kind() == Kind::SetInterval {
                interval
            } else {
                JSValue::NULL
            },
        );
        this.this_value.set_strong(timer, cx.global());
        this.did_schedule_async_call(cx);

        Self::schedule(this, timer, cx.vm(), cx.global());
        timer
    }
}

impl<const TAG: EventLoopTimerTag> TimerObject<TAG>
where
    RefCountedTimer<TAG>: OwnedBy<Self>,
{
    /// `dispatch::fire_first_timer`
    /// arm body for `Tag::TimeoutObject`/`Tag::ImmediateObject`. Runs the
    /// callback of a popped timer via `run()`, then either reschedules
    /// (setInterval / `t._repeat`) or releases the heap ref.
    pub(crate) fn fire_catching(
        popped: RefPtr<Self>,
        vm: &VirtualMachine,
        thrown: Option<&mut JSValue>,
    ) {
        let s = &*popped;
        let id = s.id;
        let kind: KindBig = s.flags.get().kind().into();
        let async_id = ID { id, kind };
        let has_been_cleared = s.flags.get().has_cleared_timer()
            || vm.script_execution_status() != ScriptExecutionStatus::Running
            || vm.has_outlived_its_script(s.context, s.generation);

        let global_this = vm.global();
        let Some(this_object) = s.this_value.try_get() else {
            s.set_enable_keeping_event_loop_alive(vm, false);
            s.update_flags(|f| f.set_has_cleared_timer(true));
            s.this_value.downgrade();
            return;
        };

        let (callback, arguments, mut idle_timeout, mut repeat): (
            JSValue,
            JSValue,
            JSValue,
            JSValue,
        ) = if Self::IS_IMMEDIATE {
            (
                JSImmediate::callback_get_cached(this_object)
                    .expect("ImmediateObject callback slot"),
                JSImmediate::arguments_get_cached(this_object)
                    .expect("ImmediateObject arguments slot"),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            )
        } else {
            (
                JSTimeout::callback_get_cached(this_object).expect("TimeoutObject callback slot"),
                JSTimeout::arguments_get_cached(this_object).expect("TimeoutObject arguments slot"),
                JSTimeout::idle_timeout_get_cached(this_object)
                    .expect("TimeoutObject idleTimeout slot"),
                JSTimeout::repeat_get_cached(this_object).expect("TimeoutObject repeat slot"),
            )
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
            s.this_value.downgrade();
            return;
        }

        // Only read on the .setInterval path where it is written below.
        let mut time_before_call = Timespec::EPOCH;

        if kind != KindBig::SetInterval {
            s.this_value.downgrade();
        } else {
            time_before_call = s.clock_now().add_ms(i64::from(s.interval.get()));
        }
        this_object.ensure_still_alive();

        let timers = timer_all();
        let fake_clock = timers.fake_timers.installs();

        let _entered = vm.enter_event_loop_scope();

        let _ = s.run(
            global_this,
            this_object,
            callback,
            arguments,
            async_id.async_id(),
            vm,
            thrown,
        );

        let fake_clock_after = timers.fake_timers.installs();
        // The callback tore down this timer's fake clock. `FakeTimers::clear` can't see a firing timer, so cancel it here.
        if s.flags.get().fake() && fake_clock_after != fake_clock {
            s.cancel(vm);
        }

        if !Self::IS_IMMEDIATE {
            idle_timeout = JSTimeout::idle_timeout_get_cached(this_object)
                .expect("TimeoutObject idleTimeout slot");
            repeat = JSTimeout::repeat_get_cached(this_object).expect("TimeoutObject repeat slot");
        }

        if !Self::IS_IMMEDIATE
            && kind == KindBig::SetTimeout
            && !repeat.is_null()
            && idle_timeout.get_number().is_some_and(|num| num != -1.0)
        {
            Self::convert_to_interval(&popped, global_this, this_object, repeat, vm);
        }

        let is_interval = !Self::IS_IMMEDIATE && kind == KindBig::SetInterval;
        if is_interval
            && s.should_reschedule_timer(repeat, idle_timeout)
            && !s.flags.get().has_cleared_timer()
        {
            // `refresh()` may have put it back.
            drop(s.event_loop_timer.disarm());
            if s.flags.get().has_js_ref() {
                s.set_enable_keeping_event_loop_alive(vm, true);
            }
            let clock = s.clock();
            timers.update_with_clock(TimerRef::from_ref_ptr(popped), &time_before_call, clock);
        } else {
            // A timeout that `refresh()` or `convert_to_interval()` has put back is not done.
            if is_interval || !s.event_loop_timer.is_active() {
                s.set_enable_keeping_event_loop_alive(vm, false);
            }
            drop(popped);
        }
    }

    pub(crate) fn call_catching(
        global: &JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        let mut thrown = JSValue::ZERO;
        Bun__JSTimeout__call(
            global,
            JSValue::UNDEFINED,
            callback,
            arguments,
            Some(&mut thrown),
        );
        thrown
    }

    fn clock_now(&self) -> Timespec {
        if self.flags.get().fake() {
            return timer_all().fake_timers.now();
        }
        Timespec::now(TimespecMockMode::ForceRealTime)
    }

    /// A `setTimeout` whose
    /// `t._repeat` was assigned promotes itself to a `setInterval` after its
    /// first fire (Node `lib/internal/timers.js:613`).
    fn convert_to_interval(
        this: &RefPtr<Self>,
        global: &JSGlobalObject,
        timer: JSValue,
        repeat: JSValue,
        vm: &VirtualMachine,
    ) {
        debug_assert!(this.flags.get().kind() == Kind::SetTimeout);

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
        this.this_value.set_strong(timer, global);
        this.update_flags(|f| f.set_kind(Kind::SetInterval));
        this.interval.set(new_interval);
        this.event_loop_timer.is_due_when_idle.set(false);
        Self::reschedule(this, timer, vm, global);
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
    /// `refresh()` and `convert_to_interval()`.
    fn reschedule(
        this: &RefPtr<Self>,
        timer: JSValue,
        vm: &VirtualMachine,
        global_this: &JSGlobalObject,
    ) {
        let idle_timeout =
            JSTimeout::idle_timeout_get_cached(timer).expect("TimeoutObject idleTimeout slot");
        let repeat = JSTimeout::repeat_get_cached(timer).expect("TimeoutObject repeat slot");

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        if !this.should_reschedule_timer(repeat, idle_timeout) {
            return;
        }

        let heap_ref = this
            .event_loop_timer
            .disarm()
            .unwrap_or_else(|| this.clone());
        Self::schedule(heap_ref, timer, vm, global_this);
    }

    /// The heap takes over `this`, which is in no heap.
    fn schedule(
        this: RefPtr<Self>,
        timer: JSValue,
        vm: &VirtualMachine,
        global_this: &JSGlobalObject,
    ) {
        let timers = timer_all();

        let now = this.clock_now();
        let min_delay = if this.flags.get().fake() {
            timers.fake_timers.min_delay_ms()
        } else {
            0
        };
        let scheduled_time = now.add_ms(i64::from(this.interval.get().max(min_delay)));
        this.update_flags(|f| f.set_has_cleared_timer(false));

        // Set _idleStart to the current monotonic timestamp in milliseconds
        // This mimics Node.js's behavior where _idleStart is the libuv timestamp when the timer was scheduled
        JSTimeout::idle_start_set_cached(
            timer,
            global_this,
            JSValue::js_number(now.ms_unsigned() as f64),
        );

        if this.flags.get().has_js_ref() {
            this.set_enable_keeping_event_loop_alive(vm, true);
        }

        let clock = this.clock();
        timers.update_with_clock(TimerRef::from_ref_ptr(this), &scheduled_time, clock);
    }

    /// `clearTimeout`/`clearInterval`
    /// / `clearImmediate` / `Timeout#[Symbol.dispose]` body.
    pub(crate) fn cancel(&self, vm: &VirtualMachine) {
        self.set_enable_keeping_event_loop_alive(vm, false);
        // An immediate stays in the event loop's queue, and `run_immediate_task` skips it.
        self.update_flags(|f| f.set_has_cleared_timer(true));
        self.this_value.downgrade();
        drop(self.event_loop_timer.disarm());
    }

    pub(crate) fn dispose(&self, cx: &mut JsScope<'_>) {
        self.cancel(cx.global().bun_vm());
    }
}

impl<const TAG: EventLoopTimerTag> Drop for TimerObject<TAG> {
    fn drop(&mut self) {
        let vm = VirtualMachine::get();
        let kind = self.flags.get().kind();

        let timers = timer_all();

        // (a) `vm.timer.maps.get(kind).swapRemove(id)` if
        //     `has_accessed_primitive` — drops the id→*const TimeoutObject
        //     entry minted by `to_primitive`. Swap-remove: the id map is only
        //     ever keyed into, never iterated in order, and `drop` runs for
        //     every id-accessed timer a GC sweep collects, so the ordered
        //     remove's O(n) shift + index rebuild here was O(n²) across a
        //     sweep.
        if !Self::IS_IMMEDIATE && self.flags.get().has_accessed_primitive() {
            // SAFETY: JS thread; no JS runs in this block.
            let maps = unsafe { &mut *timers.maps.get() };
            let map = maps.get(kind);
            if map.swap_remove(&self.id) {
                // If this map got
                // large, shrink it back down: reclaim once the slack exceeds 256 KiB.
                const ENTRY_SIZE: usize =
                    core::mem::size_of::<u64>() + core::mem::size_of::<*const TimeoutObject>();
                let allocated_bytes = map.capacity() * ENTRY_SIZE;
                let used_bytes = map.count() * ENTRY_SIZE;
                if allocated_bytes - used_bytes > 256 * 1024 {
                    map.shrink_and_free(map.count() + 8);
                }
            } else if kind == Kind::SetInterval {
                // A `setTimeout` promoted to a `setInterval` by
                // `convert_to_interval()` keeps the entry minted by
                // `to_primitive` in `maps.set_timeout`. Remove it from there
                // too, or `cancel_timer_by_id` would find a dangling pointer.
                maps.set_timeout.swap_remove(&self.id);
            }
        }

        if let Some(context) = vm.timer_context(self.context) {
            context.untrack_timer(core::ptr::from_mut(self).cast());
        }

        // (b) `setEnableKeepingEventLoopAlive(vm, false)` — without this a
        //     dropped-while-ref'd timer leaks `active_timer_count` /
        //     `immediate_ref_count` and the process hangs at exit.
        self.set_enable_keeping_event_loop_alive(vm, false);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JS-host-method facade
// ──────────────────────────────────────────────────────────────────────────
impl<const TAG: EventLoopTimerTag> TimerObject<TAG> {
    pub(crate) fn do_ref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        let this_value = this_value.to_js();
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

    pub(crate) fn do_unref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        let this_value = this_value.to_js();
        this_value.ensure_still_alive();

        let did_have_js_ref = self.flags.get().has_js_ref();
        self.update_flags(|f| f.set_has_js_ref(false));

        if did_have_js_ref {
            self.set_enable_keeping_event_loop_alive(VirtualMachine::get(), false);
        }

        this_value
    }

    pub(crate) fn has_ref(&self) -> bool {
        self.flags.get().is_keeping_event_loop_alive()
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
        !self.event_loop_timer.is_active() && !self.event_loop_timer.is_new()
    }

    /// Runs on the mutator thread during lazy sweep; do not touch any
    /// `JSValue`/`Strong` content here.
    pub(crate) fn finalize(&self) {
        self.this_value.finalize();
    }
}

impl ImmediateObject {
    /// Immediates don't have numeric IDs in Node.js, so nothing looks this one up.
    pub(crate) fn to_primitive(&self) -> JsResult<u64> {
        Ok(self.id)
    }
}

impl TimeoutObject {
    /// Node's deadline is `_idleStart + _idleTimeout`; writing `_idleStart`
    /// must move the heap entry so `t2._idleStart = t1._idleStart` works.
    pub(super) fn reschedule_from_idle_start(&self, idle_start_ms: f64) {
        if !idle_start_ms.is_finite() {
            return;
        }
        let Some(heap_ref) = self.event_loop_timer.disarm() else {
            return;
        };

        let ms = (idle_start_ms as i64)
            .saturating_add(i64::from(self.interval.get()))
            .max(0);
        let scheduled_time = Timespec::EPOCH.add_ms(ms);
        timer_all().update_with_clock(
            TimerRef::from_ref_ptr(heap_ref),
            &scheduled_time,
            self.clock(),
        );
    }

    pub(crate) fn refresh(
        this: &RefPtr<Self>,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JSValue {
        let (global_object, this_value) = (cx.global(), this_value.to_js());
        // We do not support refreshing after cleanup
        if this.flags.get().has_cleared_timer() {
            return this_value;
        }

        let has_fake_clock = timer_all().fake_timers.is_active();
        if this.flags.get().fake() && !has_fake_clock {
            return this_value;
        }

        this.this_value.set_strong(this_value, global_object);
        Self::reschedule(this, this_value, VirtualMachine::get(), global_object);

        this_value
    }

    /// First access mints an
    /// `id → *const TimeoutObject` entry in `All.maps` so `clearTimeout(+t)` (numeric-id form) can resolve it.
    pub(crate) fn to_primitive(this: &RefPtr<Self>) -> JsResult<u64> {
        if !this.flags.get().has_accessed_primitive() {
            this.update_flags(|f| f.set_has_accessed_primitive(true));
            // SAFETY: JS thread; the borrow ends at this statement.
            unsafe { &mut *timer_all().maps.get() }
                .get(this.flags.get().kind())
                .put_no_clobber(this.id, this.as_ptr())?;
        }
        Ok(this.id)
    }
}
