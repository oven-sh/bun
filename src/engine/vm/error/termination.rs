//! Ending whatever runs, with an exception that no script can catch.

use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::sync::Arc;
use std::time::Instant;

use bun_threading::{Condition, Guarded};

use crate::{Cx, Thrown, Trap, Traps, Vm};

#[derive(Default)]
pub(super) struct Deferral {
    depth: Cell<u32>,
    did_suspend_exception: Cell<bool>,
}

/// What becomes of a request that is there when a deferral ends.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AfterDeferral {
    /// The next check for traps sees it.
    RaiseTrap,
    Throw,
}

/// Leaves the exception pending only if it was so at the start.
pub struct DeferTermination(NonNull<Vm>);

impl Drop for DeferTermination {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: made and dropped inside a call that has the `Vm`.
        unsafe { self.0.as_ref() }.end_termination_deferral(AfterDeferral::RaiseTrap);
    }
}

impl Vm {
    /// For long computations to poll. They end with `throw_termination`.
    #[inline]
    pub fn is_termination_requested(&self) -> bool {
        self.traps().is_pending(Trap::TERMINATION)
            && !self.is_termination_deferred()
            && !self.traps().are_deferred()
    }

    /// Whether the scripts on the stack are being ended.
    #[inline]
    pub fn has_termination_request(&self) -> bool {
        self.traps().has_termination_request()
    }

    pub fn set_has_termination_request(&self, value: bool) {
        self.traps().set_has_termination_request(value);
    }

    /// In whichever form it has reached.
    pub fn has_pending_termination(&self) -> bool {
        self.traps().is_pending(Trap::TERMINATION)
            || self.has_termination_request()
            || self.has_pending_termination_exception()
    }

    /// What has been cut short stays so, and what runs next is not affected. Returns whether anything was pending.
    pub fn cancel_termination(&self) -> bool {
        debug_assert!(!self.is_termination_deferred());
        let was_pending = self.has_pending_termination();
        let did_clear_trap = self.traps().clear(Trap::TERMINATION);
        if self.has_pending_termination_exception() {
            self.clear_exception();
        }
        self.set_has_termination_request(false);
        was_pending || did_clear_trap
    }

    #[cold]
    pub(crate) fn answer_termination_request(&self) {
        self.traps().clear(Trap::TERMINATION);
        self.set_has_termination_request(true);
        self.throw_termination_exception();
    }

    /// Leaves the trap as it is.
    pub fn throw_termination_exception(&self) {
        debug_assert!(self.has_termination_request() && !self.is_termination_deferred());
        self.set_exception(self.termination_exception());
    }

    /// A trap that nothing has handled ends the next script.
    #[inline]
    pub(crate) fn reset_termination_request(&self) {
        if self.has_termination_request() && !self.traps().is_pending(Trap::TERMINATION) {
            self.set_has_termination_request(false);
        }
    }

    #[inline]
    pub fn defer_termination(&self) -> DeferTermination {
        self.begin_termination_deferral();
        DeferTermination(NonNull::from(self))
    }

    #[inline]
    pub fn begin_termination_deferral(&self) {
        let deferral = &self.services.errors.termination_deferral;
        let depth = deferral.depth.get();
        deferral.depth.set(depth + 1);
        if depth == 0 && self.has_pending_termination_exception() {
            self.clear_exception();
            deferral.did_suspend_exception.set(true);
        }
    }

    #[inline]
    pub fn end_termination_deferral(&self, after: AfterDeferral) {
        let deferral = &self.services.errors.termination_deferral;
        deferral.depth.update(|depth| depth - 1);
        if deferral.depth.get() != 0 {
            return;
        }
        if deferral.did_suspend_exception.take() {
            self.set_exception(self.termination_exception());
        } else if self.has_termination_request() {
            match after {
                AfterDeferral::RaiseTrap => self.traps().request_termination(),
                AfterDeferral::Throw => self.throw_termination_exception(),
            }
        }
    }

    #[inline]
    pub fn is_termination_deferred(&self) -> bool {
        self.services.errors.termination_deferral.depth.get() != 0
    }
}

impl Cx {
    /// Answers the trap.
    #[cold]
    pub fn throw_termination(&self) -> Thrown {
        self.answer_termination_request();
        Thrown::new()
    }
}

/// A limit on the time that a call may take. Dropping it does not cancel it.
pub struct TerminationDeadline {
    time: Option<Instant>,
    traps: usize,
    did_fire: AtomicBool,
}

struct Timer {
    /// The earliest is last. The `Vm` of each is alive.
    deadlines: Vec<Arc<TerminationDeadline>>,
    has_thread: bool,
}

static TIMER: Guarded<Timer> = Guarded::new(Timer {
    deadlines: Vec::new(),
    has_thread: false,
});
static DEADLINE_ADDED: Condition = Condition::new();

impl TerminationDeadline {
    /// Whether it has requested termination.
    pub fn did_fire(&self) -> bool {
        self.did_fire.load(Ordering::Acquire)
    }

    /// `did_fire` does not change any more.
    pub fn cancel(&self) {
        (TIMER.lock().deadlines).retain(|it| !core::ptr::eq(&raw const **it, self));
    }
}

fn run_timer() {
    let mut timer = TIMER.lock();
    loop {
        let now = Instant::now();
        let is_due = |it: &mut Arc<TerminationDeadline>| it.time.is_some_and(|time| time <= now);
        while let Some(deadline) = timer.deadlines.pop_if(is_due) {
            deadline.did_fire.store(true, Ordering::Release);
            // SAFETY: a `Vm` takes the lock to remove its deadlines before it goes.
            unsafe { &*core::ptr::with_exposed_provenance::<Traps>(deadline.traps) }
                .request_termination();
        }
        match timer.deadlines.last().and_then(|it| it.time) {
            Some(time) => {
                let nanoseconds = u64::try_from((time - now).as_nanos()).unwrap_or(u64::MAX);
                let _ = DEADLINE_ADDED.timed_wait_guarded(&mut timer, nanoseconds);
            }
            None => DEADLINE_ADDED.wait_guarded(&mut timer),
        }
    }
}

impl Vm {
    pub fn add_termination_deadline(&self, after: Duration) -> Arc<TerminationDeadline> {
        const STACK_SIZE: usize = 128 << 10;
        let deadline = Arc::new(TerminationDeadline {
            time: Instant::now().checked_add(after),
            traps: core::ptr::from_ref(self.traps()).expose_provenance(),
            did_fire: AtomicBool::new(false),
        });
        if deadline.time.is_none() {
            return deadline;
        }
        self.services.errors.has_had_deadlines.set(true);
        let mut timer = TIMER.lock();
        let index = (timer.deadlines).partition_point(|it| it.time > deadline.time);
        timer.deadlines.insert(index, Arc::clone(&deadline));
        if timer.has_thread {
            DEADLINE_ADDED.signal();
        } else {
            let thread = std::thread::Builder::new()
                .name("TerminationTimer".into())
                .stack_size(STACK_SIZE)
                .spawn(run_timer);
            if thread.is_err() {
                bun_alloc::out_of_memory();
            }
            timer.has_thread = true;
        }
        deadline
    }

    pub(super) fn cancel_termination_deadlines(&self) {
        if self.services.errors.has_had_deadlines.get() {
            let traps = core::ptr::from_ref(self.traps()).addr();
            TIMER.lock().deadlines.retain(|it| it.traps != traps);
        }
    }
}
