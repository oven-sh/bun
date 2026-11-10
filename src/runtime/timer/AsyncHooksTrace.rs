//! The log behind the `node.async_hooks` trace events of timers and immediates.
//!
//! Node writes those events from an async hook (`lib/internal/trace_events_async_hooks.js`): the
//! `init`, `before`, `after` and `destroy` of every `Timeout` and `Immediate`. Bun's timers call no
//! hook. While the category is on they note the same four points here, which runs no JavaScript,
//! and `src/js/internal/trace_events.ts` writes the events when it next takes the log.

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::virtual_machine::{VirtualMachine, timer_observer};

use super::Kind;

/// The hooks of Node's `AsyncHook`. `src/js/internal/trace_events.ts` reads these numbers.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Op {
    Init = 0,
    Before = 1,
    After = 2,
    Destroy = 3,
}

/// Added to the [`Op`] of an `Immediate`.
const IMMEDIATE: u8 = 4;

#[derive(Default)]
pub(crate) struct AsyncHooksTrace {
    /// Three numbers per record: the [`Op`] (plus [`IMMEDIATE`]), the id of the timer, and the
    /// microseconds that `performance.now()` counts.
    log: Vec<f64>,
    /// Node queues `emitDestroy` and runs the hook from the loop, so the `destroy` that script
    /// causes is never inside the events of that script. These wait for the microtask checkpoint
    /// that follows it, where the time is taken: the first two numbers of a record.
    pending_destroys: Vec<[f64; 2]>,
}

impl AsyncHooksTrace {
    /// For a timer that has just read [`timer_observer::ASYNC_HOOKS_TRACE`] from its VM.
    #[cold]
    #[inline(never)]
    pub(crate) fn record(op: Op, kind: Kind, id: u64) {
        let vm = VirtualMachine::get();
        // SAFETY: a VM that has timers has its boxed `RuntimeState`; JS thread only, and no other
        // borrow of this field is live (nothing here runs JavaScript).
        let this = unsafe { &mut (*crate::jsc_hooks::runtime_state()).timer.async_hooks_trace };
        let immediate = if kind == Kind::SetImmediate {
            IMMEDIATE
        } else {
            0
        };
        let code = f64::from(op as u8 | immediate);
        if op != Op::Destroy {
            this.log
                .extend_from_slice(&[code, id as f64, Self::micros(vm)]);
            return;
        }
        let is_first = this.pending_destroys.is_empty();
        this.pending_destroys.push([code, id as f64]);
        if !vm.jsc_vm().is_entered() {
            // The loop itself ended the timer, so there is no script whose checkpoint to wait for.
            this.flush_pending_destroys(vm);
        } else if is_first {
            vm.event_loop_ref()
                .deferred_tasks
                .post_task(Some(this.as_deferred_task()), Self::on_microtask_checkpoint);
        }
    }

    pub(crate) fn set_enabled(&mut self, vm: &VirtualMachine, enabled: bool) {
        vm.as_mut()
            .set_timer_observer(timer_observer::ASYNC_HOOKS_TRACE, enabled);
        if !enabled {
            vm.event_loop_ref()
                .deferred_tasks
                .unregister_task(Some(self.as_deferred_task()));
            *self = Self::default();
        }
    }

    pub(crate) fn take(&mut self) -> Option<Vec<f64>> {
        (!self.log.is_empty()).then(|| core::mem::take(&mut self.log))
    }

    fn as_deferred_task(&mut self) -> NonNull<c_void> {
        NonNull::from(self).cast()
    }

    unsafe extern "C" fn on_microtask_checkpoint(this: *mut c_void) -> bool {
        // SAFETY: `this` is the field of this thread's `RuntimeState` that `record` posted, and
        // `set_enabled(false)` takes the task back before that state goes.
        unsafe { &mut *this.cast::<Self>() }.flush_pending_destroys(VirtualMachine::get());
        false
    }

    fn flush_pending_destroys(&mut self, vm: &VirtualMachine) {
        let at = Self::micros(vm);
        self.log.reserve(self.pending_destroys.len() * 3);
        for [code, id] in self.pending_destroys.drain(..) {
            self.log.extend_from_slice(&[code, id, at]);
        }
    }

    fn micros(vm: &VirtualMachine) -> f64 {
        ((bun_jsc::virtual_machine_exports::read_origin_timer(vm) + 500) / 1000) as f64
    }
}
