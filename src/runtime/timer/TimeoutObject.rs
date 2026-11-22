use core::cell::Cell;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, JsCell, JsResult, JsThread, ScriptTimer, WrapperGuard};
use bun_ptr::{RefCount, RefPtr};

use crate::generated_bindgen::timer::js_Timeout as js;
use crate::jsc_hooks::{timer_all, timer_all_of};

use super::js_timer::{self, Armed, WaitsIn};
use super::{Clock, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

/// `Timeout`, declared in `Timer.bind.ts`. The JS object holds the only ref.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct TimeoutObject {
    ref_count: RefCount<Self>,
    pub(super) event_loop_timer: ScriptTimer,
    /// What `+timer` returns.
    pub(crate) id: u64,
    phase: JsCell<Phase>,
    interval: Cell<u32>,
    kind: Cell<Kind>,
    /// The last of `ref()` and `unref()`, for the next time it is armed.
    refd: Cell<bool>,
    /// An id enters `All::ids` once.
    id_was_read: Cell<bool>,
}

#[cfg(not(debug_assertions))]
const _: () = assert!(size_of::<TimeoutObject>() == 96);

enum Phase {
    /// Linked, or in its callback: the node's `state` says which.
    Live(Armed),
    /// New or fired. `refresh()` arms it.
    Idle,
    /// Only `promote_to_interval` arms it again.
    Cleared,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    SetTimeout,
    SetInterval,
}

bun_event_loop::impl_timer_owner!(TimeoutObject; from_timer_ptr => event_loop_timer);

fn idle_timeout(this: JSValue) -> Option<f64> {
    js::idle_timeout_get_cached(this)?.get_number()
}

fn repeat(this: JSValue) -> Option<JSValue> {
    js::repeat_get_cached(this).filter(|repeat| !repeat.is_null())
}

impl TimeoutObject {
    pub(super) fn init<'a>(
        cx: &JsThread<'a>,
        id: u64,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
        clock: Clock,
    ) -> WrapperGuard<'a, Self> {
        let (vm, global) = (cx.vm(), cx.global());
        let tag = EventLoopTimerTag::TimeoutObject;
        let timer = RefPtr::new(Self {
            ref_count: RefCount::init(),
            event_loop_timer: ScriptTimer::new(tag, clock, vm, cx.context()),
            id,
            phase: JsCell::new(Phase::Idle),
            interval: Cell::new(interval),
            kind: Cell::new(kind),
            refd: Cell::new(true),
            id_was_read: Cell::new(false),
        });
        let timer = js::wrap(timer, global);
        let this = timer.to_js();
        ScriptTimer::track(&raw const timer.event_loop_timer, vm, cx.context());

        let interval = JSValue::js_number(f64::from(interval));
        let repeat = match kind {
            Kind::SetTimeout => JSValue::NULL,
            Kind::SetInterval => interval,
        };
        js::arguments_set_cached(this, global, arguments);
        js::callback_set_cached(this, global, callback);
        js::idle_timeout_set_cached(this, global, interval);
        js::repeat_set_cached(this, global, repeat);

        timer.start(this, vm);
        js_timer::did_schedule(cx, id, kind == Kind::SetTimeout);
        timer
    }

    pub(crate) fn repeats(&self) -> bool {
        self.kind.get() == Kind::SetInterval
    }

    fn node(&self) -> *const EventLoopTimer {
        ScriptTimer::node(&raw const self.event_loop_timer)
    }

    fn is_linked(&self) -> bool {
        self.event_loop_timer.state.get() == EventLoopTimerState::ACTIVE
    }

    fn now(&self, vm: &VirtualMachine) -> Timespec {
        match self.event_loop_timer.clock.get() {
            Clock::Real => Timespec::now(TimespecMockMode::ForceRealTime),
            Clock::Fake => timer_all_of(vm).fake_timers.now(),
        }
    }

    fn arm(&self, this: JSValue, vm: &VirtualMachine, deadline: &Timespec) {
        if !matches!(self.phase.get(), Phase::Live(_)) {
            self.phase.set(Phase::Live(Armed::new(this, vm)));
        }
        timer_all_of(vm).update(self.node(), deadline);
        if self.refd.get() {
            self.hold_loop(vm);
        }
    }

    fn hold_loop(&self, vm: &VirtualMachine) {
        self.phase.with_mut(|phase| {
            if let Phase::Live(armed) = phase {
                armed.hold_loop(vm, WaitsIn::Heap);
            }
        });
    }

    fn release_loop(&self) {
        self.phase.with_mut(|phase| {
            if let Phase::Live(armed) = phase {
                armed.release_loop();
            }
        });
    }

    fn is_cleared(&self) -> bool {
        matches!(self.phase.get(), Phase::Cleared)
    }

    /// Script stops a timer with `_idleTimeout = -1`, and an interval with `_repeat = null`.
    fn may_arm(&self, this: JSValue) -> bool {
        !(self.repeats() && repeat(this).is_none()) && idle_timeout(this) != Some(-1.0)
    }

    /// Arms it for one interval from now.
    fn start(&self, this: JSValue, vm: &VirtualMachine) {
        let now = self.now(vm);
        let min_delay = match self.event_loop_timer.clock.get() {
            Clock::Real => 0,
            Clock::Fake => timer_all_of(vm).fake_timers.min_delay_ms(),
        };
        let delay = self.interval.get().max(min_delay);
        self.arm(this, vm, &now.add_ms(i64::from(delay)));
        let idle_start = JSValue::js_number(now.ms_unsigned() as f64);
        js::idle_start_set_cached(this, vm.global(), idle_start);
    }

    pub(super) fn cancel(&self) {
        self.event_loop_timer.disarm();
        self.phase.set(Phase::Cleared);
    }

    pub(super) fn cancel_by_id(vm: &VirtualMachine, id: u64) {
        let timer = timer_all_of(vm).ids.with_mut(|ids| {
            let index = ids.get_index(&id)?;
            // SAFETY: `drop` removes the entry.
            let timer = unsafe { &*ids.values()[index] };
            if !vm.context_may_name(vm.context_of_caller(), timer.event_loop_timer.context()) {
                return None;
            }
            ids.swap_remove_at(index);
            Some(timer)
        });
        if let Some(timer) = timer {
            timer.cancel();
        }
    }

    /// SAFETY: a heap has just popped `node`, which is a `TimeoutObject`'s.
    pub(crate) unsafe fn fire(
        node: *mut EventLoopTimer,
        vm: &VirtualMachine,
        thrown: Option<&mut JSValue>,
    ) {
        // Dropped last: the microtask checkpoint sees the final phase, and does not keep the object alive.
        let _entered;
        // SAFETY: fn contract. It was linked, so its root holds the JS object, which holds a ref.
        let timer = unsafe {
            let native = Self::from_timer_ptr(node);
            let Phase::Live(armed) = (*native).phase.get() else {
                debug_assert!(false, "a linked timer is live");
                return;
            };
            WrapperGuard::from_parts(armed.this(), core::ptr::NonNull::new_unchecked(native))
        };
        let this = timer.to_js();
        let Some(callback) = js::callback_get_cached(this).filter(|callback| {
            js_timer::may_run(&timer.event_loop_timer, vm) && callback.to_boolean()
        }) else {
            js_timer::did_cancel(vm, timer.id);
            return timer.cancel();
        };
        let arguments = js::arguments_get_cached(this);

        let next_round = timer
            .repeats()
            .then(|| timer.now(vm).add_ms(i64::from(timer.interval.get())));
        let fake_timers = &timer_all_of(vm).fake_timers;
        let installs = fake_timers.installs();

        _entered = vm.enter_event_loop_scope();
        js_timer::call(vm, timer.id, this, callback, arguments, thrown);

        // `FakeTimers::clear` does not see a timer that is in its callback.
        if timer.event_loop_timer.clock.get() == Clock::Fake && fake_timers.installs() != installs {
            timer.cancel();
        }

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        match next_round {
            None => timer.promote_to_interval(this, vm),
            Some(_) if timer.is_cleared() => {}
            Some(deadline) if timer.may_arm(this) => timer.arm(this, vm, &deadline),
            Some(_) => timer.release_loop(),
        }

        if !timer.is_linked() && !timer.is_cleared() {
            timer.phase.set(Phase::Idle);
        }
    }

    /// A timeout repeats once script has set `_repeat`.
    fn promote_to_interval(&self, this: JSValue, vm: &VirtualMachine) {
        let Some(repeat) = repeat(this) else { return };
        if idle_timeout(this).is_none_or(|ms| ms == -1.0) {
            return;
        }
        let ms = repeat.get_number();
        let interval = ms.filter(|&ms| !(ms < 1.0 || ms > f64::from(i32::MAX)));
        js::idle_timeout_set_cached(this, vm.global(), repeat);
        self.kind.set(Kind::SetInterval);
        self.interval.set(interval.map_or(1, |ms| ms as u32));
        self.event_loop_timer.is_due_when_idle.set(false);
        if ms != Some(-1.0) {
            self.start(this, vm);
        }
    }

    pub(crate) fn refresh(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JSValue {
        let (this, vm) = (this_value.to_js(), cx.global().bun_vm());
        let has_clock = self.event_loop_timer.clock.get() == Clock::Real
            || timer_all_of(vm).fake_timers.is_active();
        if has_clock && !self.is_cleared() && self.may_arm(this) {
            self.start(this, vm);
        }
        this
    }

    pub(crate) fn do_ref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        if !self.refd.replace(true) {
            self.hold_loop(VirtualMachine::get());
        }
        this_value.to_js()
    }

    pub(crate) fn do_unref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.refd.set(false);
        self.release_loop();
        this_value.to_js()
    }

    pub(crate) fn has_ref(&self) -> bool {
        matches!(self.phase.get(), Phase::Live(armed) if armed.holds_loop())
    }

    pub(crate) fn get_destroyed(&self) -> bool {
        !matches!(self.phase.get(), Phase::Live(_))
    }

    pub(crate) fn to_primitive(&self) -> JsResult<u64> {
        if !self.id_was_read.replace(true) {
            let ids = &timer_all().ids;
            ids.with_mut(|ids| ids.put_no_clobber(self.id, self))?;
        }
        Ok(self.id)
    }

    pub(crate) fn dispose(&self, _cx: &mut JsScope<'_>) {
        self.cancel();
    }

    pub(crate) fn close<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        _cx: &mut JsScope<'a>,
    ) -> JsWrapper<'a, Self> {
        self.cancel();
        this_value
    }

    pub(crate) fn get_on_timeout(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::callback_get_cached(this_value.to_js())
            .map_or(JSValue::UNDEFINED, JSValue::without_async_context)
    }

    pub(crate) fn set_on_timeout(
        _this: &Self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        js::callback_set_cached(this_value.to_js(), cx.global(), value.to_js());
    }

    pub(crate) fn get_idle_start(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::idle_start_get_cached(this_value.to_js()).unwrap_or(JSValue::UNDEFINED)
    }

    /// Node's deadline is `_idleStart + _idleTimeout`.
    pub(crate) fn set_idle_start(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let value = value.to_js();
        if self.is_linked()
            && let Some(idle_start) = value.get_number().filter(|ms| ms.is_finite())
        {
            let ms = (idle_start as i64).saturating_add(i64::from(self.interval.get()));
            timer_all().update(self.node(), &Timespec::EPOCH.add_ms(ms.max(0)));
        }
        js::idle_start_set_cached(this_value.to_js(), cx.global(), value);
    }
}

impl Drop for TimeoutObject {
    fn drop(&mut self) {
        const MAX_SLACK: usize = 256 * 1024 / size_of::<(u64, *const TimeoutObject)>();
        if self.id_was_read.get() {
            timer_all().ids.with_mut(|ids| {
                if ids.swap_remove(&self.id) && ids.capacity() - ids.count() > MAX_SLACK {
                    ids.shrink_and_free(ids.count() + 8);
                }
            });
        }
    }
}
