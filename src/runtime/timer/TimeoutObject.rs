use core::cell::Cell;

use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, JsCell, JsResult, JsThread, ScriptTimer, Strong, WrapperGuard};
use bun_ptr::{RefCount, RefPtr};

use crate::generated_bindgen::timer::js_Timeout as js;
use crate::jsc_hooks::{timer_all, timer_all_of};

use super::js_timer::{self, LoopHold, WaitsIn};
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
    in_id_map: Cell<bool>,
}

#[cfg(not(debug_assertions))]
const _: () = assert!(size_of::<TimeoutObject>() == 96);

enum Phase {
    /// Linked, or in its callback: the node's `state` says which.
    Live {
        root: Strong,
        hold: Option<LoopHold>,
    },
    /// New or fired. `refresh()` arms it.
    Idle { refd: bool },
    /// For good.
    Cleared,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    SetTimeout,
    SetInterval,
}

bun_event_loop::impl_timer_owner!(TimeoutObject; from_timer_ptr => event_loop_timer);

fn idle_timeout(this: JSValue) -> Option<f64> {
    js::idle_timeout_get_cached(this)
        .expect("Timeout idleTimeout slot")
        .get_number()
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
            phase: JsCell::new(Phase::Idle { refd: true }),
            interval: Cell::new(interval),
            kind: Cell::new(kind),
            in_id_map: Cell::new(false),
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
        match *self.phase.get() {
            Phase::Live { .. } => timer_all_of(vm).update(self.node(), deadline),
            Phase::Idle { refd } => {
                let root = Strong::create(this, vm.global());
                timer_all_of(vm).update(self.node(), deadline);
                let hold = refd.then(|| LoopHold::new(vm, WaitsIn::Heap));
                self.phase.set(Phase::Live { root, hold });
            }
            Phase::Cleared => {}
        }
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
            timer.in_id_map.set(false);
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
            let Phase::Live { root, .. } = (*native).phase.get() else {
                debug_assert!(false, "a linked timer is live");
                return;
            };
            WrapperGuard::from_parts(root.get(), core::ptr::NonNull::new_unchecked(native))
        };
        let this = timer.to_js();
        let callback = js::callback_get_cached(this).expect("Timeout callback slot");
        let arguments = js::arguments_get_cached(this).expect("Timeout arguments slot");
        if !js_timer::may_run(&timer.event_loop_timer, vm) || !callback.to_boolean() {
            js_timer::did_cancel(vm, timer.id);
            return timer.cancel();
        }

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
        if matches!(timer.phase.get(), Phase::Cleared) {
            return;
        }

        // https://github.com/nodejs/node/blob/a7cbb904745591c9a9d047a364c2c188e5470047/lib/internal/timers.js#L612
        let repeat = js::repeat_get_cached(this).expect("Timeout repeat slot");
        if !repeat.is_null() {
            match (next_round, idle_timeout(this)) {
                (_, Some(-1.0)) | (None, None) => {}
                (Some(deadline), _) => timer.arm(this, vm, &deadline),
                (None, Some(_)) => timer.promote_to_interval(this, vm, repeat),
            }
        }

        if !timer.is_linked()
            && let Phase::Live { hold, .. } = timer.phase.get()
        {
            let refd = hold.is_some();
            timer.phase.set(Phase::Idle { refd });
        }
    }

    fn promote_to_interval(&self, this: JSValue, vm: &VirtualMachine, repeat: JSValue) {
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
        if has_clock
            && !matches!(self.phase.get(), Phase::Cleared)
            && idle_timeout(this) != Some(-1.0)
            && !(self.repeats() && js::repeat_get_cached(this).is_some_and(JSValue::is_null))
        {
            self.start(this, vm);
        }
        this
    }

    pub(crate) fn do_ref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| match phase {
            Phase::Live { hold, .. } => {
                hold.get_or_insert_with(|| LoopHold::new(VirtualMachine::get(), WaitsIn::Heap));
            }
            Phase::Idle { refd } => *refd = true,
            Phase::Cleared => {}
        });
        this_value.to_js()
    }

    pub(crate) fn do_unref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| match phase {
            Phase::Live { hold, .. } => *hold = None,
            Phase::Idle { refd } => *refd = false,
            Phase::Cleared => {}
        });
        this_value.to_js()
    }

    pub(crate) fn has_ref(&self) -> bool {
        matches!(self.phase.get(), Phase::Live { hold: Some(_), .. })
    }

    pub(crate) fn get_destroyed(&self) -> bool {
        !matches!(self.phase.get(), Phase::Live { .. })
    }

    pub(crate) fn to_primitive(&self) -> JsResult<u64> {
        if !self.in_id_map.get() && !matches!(self.phase.get(), Phase::Cleared) {
            let timers = timer_all();
            timers
                .ids
                .with_mut(|ids| ids.put_no_clobber(self.id, self))?;
            self.in_id_map.set(true);
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
            .unwrap()
            .without_async_context()
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
        js::idle_start_get_cached(this_value.to_js()).unwrap()
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
        if self.in_id_map.get() {
            timer_all().ids.with_mut(|ids| {
                ids.swap_remove(&self.id);
                if ids.capacity() - ids.count() > MAX_SLACK {
                    ids.shrink_and_free(ids.count() + 8);
                }
            });
        }
    }
}
