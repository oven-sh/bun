use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSValue, JsCell, JsThread, ScriptTimer, Strong, WrapperGuard};
use bun_ptr::{RefCount, RefPtr};

use crate::generated_bindgen::timer::js_Immediate as js;
use crate::jsc_hooks::timer_all_of;

use super::js_timer::{self, LoopHold, WaitsIn};
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
    Live {
        root: Strong,
        hold: Option<LoopHold>,
    },
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
        let wrapper = js::wrap(immediate.clone(), global);
        let this = wrapper.to_js();
        let timer = &raw const wrapper.event_loop_timer;
        ScriptTimer::track(timer, vm, cx.context());
        js::arguments_set_cached(this, global, arguments);
        js::callback_set_cached(this, global, callback);
        wrapper.phase.set(Phase::Live {
            root: Strong::create(this, global),
            hold: Some(wrapper.hold_loop(vm)),
        });

        match clock {
            Clock::Real => vm.enqueue_immediate_task(immediate.into_raw().cast()),
            Clock::Fake => {
                let timers = timer_all_of(vm);
                let min_delay = i64::from(timers.fake_timers.min_delay_ms());
                let deadline = timers.fake_timers.now().add_ms(min_delay);
                timers.update(ScriptTimer::node(timer), &deadline);
            }
        }
        js_timer::did_schedule(cx, id, true);
        this
    }

    fn hold_loop(&self, vm: &VirtualMachine) -> LoopHold {
        match self.event_loop_timer.clock.get() {
            Clock::Real => LoopHold::new(vm, WaitsIn::ImmediateQueue),
            Clock::Fake => LoopHold::new(vm, WaitsIn::Heap),
        }
    }

    fn dequeue(&self) -> Option<(Strong, Option<LoopHold>)> {
        match self.phase.replace(Phase::Dequeued) {
            Phase::Live { root, hold } => Some((root, hold)),
            cleared => {
                self.phase.set(cleared);
                None
            }
        }
    }

    fn call(&self, vm: &VirtualMachine, this: JSValue, thrown: Option<&mut JSValue>) -> bool {
        let callback = js::callback_get_cached(this).expect("Immediate callback slot");
        let arguments = js::arguments_get_cached(this).expect("Immediate arguments slot");
        let threw = js_timer::call(vm, self.id, this, callback, arguments, thrown);
        self.phase.set(Phase::Done);
        threw
    }

    /// `queued` is the queue's ref. Returns whether the microtask checkpoint is still owed.
    pub(crate) fn run(queued: RefPtr<Self>, vm: &VirtualMachine) -> bool {
        let Some((root, hold)) = queued.dequeue() else {
            return false;
        };
        if !js_timer::may_run(&queued.event_loop_timer, vm)
            || (hold.is_none() && !vm.is_event_loop_alive_excluding_immediates())
        {
            return false;
        }
        let this = root.get();
        drop((root, hold));

        vm.event_loop().enter();
        let threw = queued.call(vm, this, None);
        drop(queued);
        let stopped = vm.event_loop().exit_maybe_drain_microtasks(!threw).is_err();
        stopped || threw
    }

    pub(crate) fn release_unrun(&self) {
        drop(self.dequeue());
    }

    /// SAFETY: the fake heap has just popped `node`, which is an `ImmediateObject`'s.
    pub(crate) unsafe fn fire(
        node: *mut EventLoopTimer,
        vm: &VirtualMachine,
        thrown: &mut JSValue,
    ) {
        // Dropped last: the microtask checkpoint does not keep the object alive.
        let _entered;
        // SAFETY: fn contract. It was linked, so its root holds the JS object, which holds a ref.
        let immediate = unsafe {
            let native = Self::from_timer_ptr(node);
            let Phase::Live { root, .. } = (*native).phase.get() else {
                debug_assert!(false, "a linked immediate is live");
                return;
            };
            WrapperGuard::from_parts(root.get(), core::ptr::NonNull::new_unchecked(native))
        };
        if !js_timer::may_run(&immediate.event_loop_timer, vm) {
            js_timer::did_cancel(vm, immediate.id);
            return immediate.cancel();
        }
        _entered = vm.enter_event_loop_scope();
        immediate.call(vm, immediate.to_js(), Some(thrown));
    }

    /// It stays in the loop's queue, which skips it.
    pub(super) fn cancel(&self) {
        self.event_loop_timer.disarm();
        self.phase.set(Phase::Done);
    }

    pub(crate) fn do_ref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| {
            if let Phase::Live { hold, .. } = phase {
                hold.get_or_insert_with(|| self.hold_loop(VirtualMachine::get()));
            }
        });
        this_value.to_js()
    }

    pub(crate) fn do_unref(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        self.phase.with_mut(|phase| {
            if let Phase::Live { hold, .. } = phase {
                *hold = None;
            }
        });
        this_value.to_js()
    }

    pub(crate) fn has_ref(&self) -> bool {
        matches!(self.phase.get(), Phase::Live { hold: Some(_), .. })
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
