use core::time::Duration;
use std::sync::Arc;

use bun_threading::{Condition, Guarded};

use super::timer::Timers;
use super::{DeferredTask, Ticket};
use crate::{GcFree, Vm};

/// What the embedder does for a `Vm`. Nothing is called once the `Vm` has begun to destroy its cells.
pub trait EventLoop: Send + Sync + GcFree {
    /// On the thread of the `Vm`. The ticket is valid for as long as something holds it.
    fn add_pending_work(&self, ticket: Arc<Ticket>);

    /// On any thread. The task is to run on that of the `Vm`.
    fn schedule_work(&self, ticket: Arc<Ticket>, task: DeferredTask);

    /// On any thread, also while a collection ends.
    fn cancel_pending_work(&self, ticket: &Ticket);

    /// On any thread. `Vm::run_due_timers` is to be called after that time instead of the one that was set before.
    /// It is no reason to keep the process alive.
    fn set_timer(&self, delay: Option<Duration>);
}

#[derive(Default)]
struct Gate {
    event_loop: Option<Arc<dyn EventLoop>>,
    calls_in_progress: usize,
}

/// What other threads have of a `Vm`, which it may outlive.
#[derive(Default)]
pub(super) struct Host {
    gate: Guarded<Gate>,
    call_ended: Condition,
    pub(super) timers: Guarded<Timers>,
}

impl Host {
    /// False if there is none, or not any more.
    pub(super) fn with_event_loop(&self, call: impl FnOnce(&dyn EventLoop)) -> bool {
        let event_loop = {
            let mut gate = self.gate.lock();
            let Some(event_loop) = gate.event_loop.clone() else {
                return false;
            };
            gate.calls_in_progress += 1;
            event_loop
        };
        call(&*event_loop);
        drop(event_loop);
        let mut gate = self.gate.lock();
        gate.calls_in_progress -= 1;
        if gate.event_loop.is_none() {
            self.call_ended.broadcast();
        }
        true
    }

    pub(super) fn close(&self) {
        let timers = self.timers.lock().close();
        drop(timers);
        let mut gate = self.gate.lock();
        let event_loop = gate.event_loop.take();
        while gate.calls_in_progress != 0 {
            self.call_ended.wait_guarded(&mut gate);
        }
        drop(gate);
        drop(event_loop);
    }
}

impl Vm {
    /// Without one, nothing that is deferred ever runs. Panics the second time.
    pub fn set_event_loop(&self, event_loop: Arc<dyn EventLoop>) {
        let host = &self.services.deferred.host;
        let old = host.gate.lock().event_loop.replace(event_loop);
        assert!(old.is_none());
        host.timers.lock().rearm(host);
    }
}
