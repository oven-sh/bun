use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, JsCell, JsThread, ScriptTimer, WrapperGuard};
use bun_ptr::{RefCount, RefPtr};

use crate::generated_bindgen::timer::js_Immediate as js;
use crate::jsc_hooks::timer_all_of;

use super::js_timer::{self, Armed, WaitsIn};
use super::{Clock, EventLoopTimer, EventLoopTimerTag};

/// `Immediate`, declared in `Timer.bind.ts`. The JS object holds a ref, and so does the loop's queue.
#[derive(bun_ptr::RefCounted)]
pub(crate) struct ImmediateObject {
    ref_count: RefCount<Self>,
    /// Linked only on the fake clock.
    event_loop_timer: ScriptTimer,
    pub(crate) id: u64,
    phase: JsCell<Phase>,
}

enum Phase {
    /// In the loop's queue. On the fake clock: linked, or in its callback.
    Live(Armed),
    /// Out of the loop's queue: in its callback, or dropped without running.
    Dequeued,
    Done,
}

bun_event_loop::impl_timer_owner!(ImmediateObject; from_timer_ptr => event_loop_timer);

impl ImmediateObject {
    pub(super) fn init(
        cx: &JsThread<'_>,
        id: u64,
        callback: JSValue,
        arguments: JSValue,
        clock: Clock,
    ) -> JSValue {
        let (vm, global) = (cx.vm(), cx.global());
        let tag = EventLoopTimerTag::ImmediateObject;
        let immediate = RefPtr::new(Self {
            ref_count: RefCount::init(),
            event_loop_timer: ScriptTimer::new(tag, clock, vm, cx.context()),
            id,
            phase: JsCell::new(Phase::Done),
        });
        let queued = (clock == Clock::Real).then(|| immediate.clone());
        let wrapper = js::wrap(immediate, global);
        let this = wrapper.to_js();
        let timer = &raw const wrapper.event_loop_timer;
        ScriptTimer::track(timer, vm, cx.context());
        js::arguments_set_cached(this, global, arguments);
        js::callback_set_cached(this, global, callback);

        let mut armed = Armed::new(this, vm);
        match queued {
            Some(queued) => vm.enqueue_immediate_task(queued.into_raw().cast()),
            None => {
                let timers = timer_all_of(vm);
                let min_delay = i64::from(timers.fake_timers.min_delay_ms());
                let deadline = timers.fake_timers.now().add_ms(min_delay);
                timers.update(ScriptTimer::node(timer), &deadline);
            }
        }
        armed.hold_loop(vm, wrapper.waits_in());
        wrapper.phase.set(Phase::Live(armed));
        js_timer::did_schedule(cx, id, true);
        this
    }

    fn waits_in(&self) -> WaitsIn {
        match self.event_loop_timer.clock.get() {
            Clock::Real => WaitsIn::ImmediateQueue,
            Clock::Fake => WaitsIn::Heap,
        }
    }

    fn dequeue(&self) -> Option<Armed> {
        match self.phase.replace(Phase::Dequeued) {
            Phase::Live(armed) => Some(armed),
            cleared => {
                self.phase.set(cleared);
                None
            }
        }
    }

    fn call(&self, vm: &VirtualMachine, this: JSValue, thrown: Option<&mut JSValue>) -> bool {
        // It runs once, and can outlive that.
        let threw = js::callback_take_cached(this, vm.global()).is_some_and(|callback| {
            let arguments = js::arguments_take_cached(this, vm.global());
            js_timer::call(vm, self.id, this, callback, arguments, thrown)
        });
        self.phase.set(Phase::Done);
        threw
    }

    /// `queued` is the queue's ref. Returns whether the microtask checkpoint is still owed.
    pub(crate) fn run(queued: RefPtr<Self>, vm: &VirtualMachine) -> bool {
        let Some(armed) = queued.dequeue() else {
            return false;
        };
        if !js_timer::may_run(&queued.event_loop_timer, vm)
            || (!armed.holds_loop() && !vm.is_event_loop_alive_excluding_immediates())
        {
            return false;
        }
        let this = armed.this();
        drop(armed);

        vm.event_loop().enter();
        let threw = queued.call(vm, this, None);
        drop(queued);
        let stopped = vm.event_loop().exit_maybe_drain_microtasks(!threw).is_err();
        stopped || threw
    }

    pub(crate) fn release_unrun(&self) {
        drop(self.dequeue());
    }

    /// SAFETY: a heap has just popped `node`, which is an `ImmediateObject`'s.
    pub(crate) unsafe fn fire(
        node: *mut EventLoopTimer,
        vm: &VirtualMachine,
        thrown: Option<&mut JSValue>,
    ) {
        // Dropped last: the microtask checkpoint does not keep the object alive.
        let _entered;
        // SAFETY: fn contract. It was linked, so its root holds the JS object, which holds a ref.
        let immediate = unsafe {
            let native = Self::from_timer_ptr(node);
            let Phase::Live(armed) = (*native).phase.get() else {
                debug_assert!(false, "a linked immediate is live");
                return;
            };
            WrapperGuard::from_parts(armed.this(), core::ptr::NonNull::new_unchecked(native))
        };
        if !js_timer::may_run(&immediate.event_loop_timer, vm) {
            js_timer::did_cancel(vm, immediate.id);
            return immediate.cancel();
        }
        _entered = vm.enter_event_loop_scope();
        immediate.call(vm, immediate.to_js(), thrown);
    }

    /// It stays in the loop's queue, which skips it.
    pub(super) fn cancel(&self) {
        self.event_loop_timer.disarm();
        self.phase.set(Phase::Done);
    }

    pub(crate) fn do_ref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| {
            if let Phase::Live(armed) = phase {
                armed.hold_loop(VirtualMachine::get(), self.waits_in());
            }
        });
        this_value.to_js()
    }

    pub(crate) fn do_unref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| {
            if let Phase::Live(armed) = phase {
                armed.release_loop();
            }
        });
        this_value.to_js()
    }

    pub(crate) fn has_ref(&self) -> bool {
        matches!(self.phase.get(), Phase::Live(armed) if armed.holds_loop())
    }

    pub(crate) fn get_destroyed(&self) -> bool {
        matches!(self.phase.get(), Phase::Done)
    }

    /// No `clear*` function takes it.
    pub(crate) fn to_primitive(&self) -> u64 {
        self.id
    }

    pub(crate) fn dispose(&self, _cx: &mut JsScope<'_>) {
        self.cancel();
    }
}
