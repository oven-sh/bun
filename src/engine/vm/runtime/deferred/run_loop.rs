use core::time::Duration;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use bun_threading::{Condition, Guarded};

use super::{DeferredTask, EventLoop, Ticket};
use crate::{Cx, FastHashMap, JsResult, ScriptExecutionStatus, Vm};

#[derive(Default)]
struct Work {
    /// By address.
    pending: FastHashMap<usize, Arc<Ticket>>,
    tasks: VecDeque<(Arc<Ticket>, DeferredTask)>,
    timer: Option<Instant>,
}

/// An event loop for a program that has nothing else to wait for.
#[derive(Default)]
pub struct RunLoop {
    work: Guarded<Work>,
    changed: Condition,
}

fn key(ticket: &Ticket) -> usize {
    core::ptr::from_ref(ticket).addr()
}

impl EventLoop for RunLoop {
    fn add_pending_work(&self, ticket: Arc<Ticket>) {
        self.work.lock().pending.insert(key(&ticket), ticket);
    }

    fn schedule_work(&self, ticket: Arc<Ticket>, task: DeferredTask) {
        self.work.lock().tasks.push_back((ticket, task));
        self.changed.signal();
    }

    fn cancel_pending_work(&self, ticket: &Ticket) {
        self.work.lock().pending.remove(&key(ticket));
        self.changed.signal();
    }

    fn set_timer(&self, delay: Option<Duration>) {
        self.work.lock().timer = delay.map(|delay| Instant::now() + delay);
        self.changed.signal();
    }
}

impl RunLoop {
    pub fn install(vm: &Vm) -> Arc<RunLoop> {
        let run_loop = Arc::<RunLoop>::default();
        vm.set_event_loop(Arc::<RunLoop>::clone(&run_loop));
        run_loop
    }

    pub fn has_pending_work(&self) -> bool {
        !self.work.lock().pending.is_empty()
    }

    /// Until no work is pending. Fails only if execution is terminated.
    pub fn run(&self, cx: &mut Cx) -> JsResult<()> {
        while self.wait() {
            self.run_once(cx)?;
        }
        Ok(())
    }

    /// What is due now.
    pub fn run_once(&self, cx: &mut Cx) -> JsResult<()> {
        let now = Instant::now();
        if self.work.lock().timer.take_if(|it| *it <= now).is_some() {
            cx.run_due_timers();
        }
        loop {
            let mut work = self.work.lock();
            let Some((ticket, task)) = work.tasks.pop_front() else {
                return Ok(());
            };
            let was_pending = work.pending.remove(&key(&ticket)).is_some();
            drop(work);
            if was_pending {
                run_task(cx, &ticket, task)
                    .inspect_err(|_| cx.is_execution_forbidden().set(true))?;
            }
        }
    }

    /// False if there is nothing to wait for.
    fn wait(&self) -> bool {
        let mut work = self.work.lock();
        while !work.pending.is_empty() {
            let now = Instant::now();
            match work.timer.map(|it| it.saturating_duration_since(now)) {
                _ if !work.tasks.is_empty() => return true,
                Some(Duration::ZERO) => return true,
                Some(delay) => {
                    let _ = (self.changed).timed_wait_guarded(&mut work, delay.as_nanos() as u64);
                }
                None => self.changed.wait_guarded(&mut work),
            }
        }
        false
    }
}

fn run_task(cx: &mut Cx, ticket: &Ticket, task: DeferredTask) -> JsResult<()> {
    let (Some(realm), Some(owner)) = (ticket.realm(cx), ticket.script_execution_owner(cx)) else {
        return Ok(());
    };
    let cx = cx.in_realm(realm);
    if (realm.hooks().script_execution_status)(cx, owner) != ScriptExecutionStatus::Running {
        return Ok(());
    }
    cx.clear_kept_objects();
    if let Err(thrown) = task.run(cx, ticket) {
        let exception = cx.catch(thrown)?;
        (realm.hooks().report_uncaught_exception)(cx, exception);
    }
    cx.drain_microtasks()
}
