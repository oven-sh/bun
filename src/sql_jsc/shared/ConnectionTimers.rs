use core::cell::Cell;
use core::fmt::Arguments;

use bun_core::fmt::{ConnTimeoutKind, fmt_conn_timeout};
use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::{
    EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, JsCell, VirtualMachine,
    VirtualMachineSqlExt as _,
};

pub struct ConnectionTimers {
    max_lifetime_ms: u32,
    pub(crate) max_lifetime_timer: JsCell<EventLoopTimer>,
    /// `maxLifetime` ran out while busy; the connection closes when it stops being busy.
    lifetime_exceeded: Cell<bool>,
    /// The pool handed it to a reservation or a transaction: busy even when nothing is on the wire.
    checked_out: Cell<bool>,
}

impl ConnectionTimers {
    pub(crate) fn new(max_lifetime_ms: u32, max_lifetime_tag: EventLoopTimerTag) -> Self {
        Self {
            max_lifetime_ms,
            max_lifetime_timer: JsCell::new(EventLoopTimer::init_paused(max_lifetime_tag)),
            lifetime_exceeded: Cell::new(false),
            checked_out: Cell::new(false),
        }
    }

    pub(crate) fn set_checked_out(&self, checked_out: bool) {
        self.checked_out.set(checked_out);
    }

    pub(crate) fn stop(&self) {
        stop(&self.max_lifetime_timer);
    }
}

fn start(timer: &JsCell<EventLoopTimer>, ms: u32) {
    timer.with_mut(|t| t.next = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, ms.into()));
    // The fire path recovers the connection from this pointer.
    VirtualMachine::get_mut().timer().insert(timer.as_ptr());
}

fn stop(timer: &JsCell<EventLoopTimer>) {
    if timer.get().state == EventLoopTimerState::ACTIVE {
        timer.with_mut(|t| VirtualMachine::get_mut().timer().remove(t));
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Connecting,
    Connected,
    Failed,
}

pub trait TimedConnection {
    fn timers(&self) -> &ConnectionTimers;
    fn phase(&self) -> Phase;
    /// In flight or queued.
    fn has_requests(&self) -> bool;
    fn fail_timeout(&self, kind: ConnTimeoutKind, message: Arguments<'_>);
    /// Tells the pool to give this connection no more work.
    fn notify_retiring(&self);

    fn is_busy(&self) -> bool {
        self.timers().checked_out.get() || self.has_requests()
    }

    fn start_max_lifetime_timer(&self) {
        let timers = self.timers();
        if timers.max_lifetime_ms != 0
            && timers.max_lifetime_timer.get().state != EventLoopTimerState::ACTIVE
        {
            start(&timers.max_lifetime_timer, timers.max_lifetime_ms);
        }
    }

    fn on_max_lifetime_timeout(&self) {
        let timers = self.timers();
        timers
            .max_lifetime_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        match self.phase() {
            Phase::Failed => {}
            Phase::Connected if self.is_busy() => {
                timers.lifetime_exceeded.set(true);
                self.notify_retiring();
            }
            _ => self.fail_lifetime_timeout(),
        }
    }

    /// Called wherever the connection can stop being busy. Returns whether it closed.
    fn retire_if_idle(&self) -> bool {
        let is_due = self.timers().lifetime_exceeded.get()
            && self.phase() == Phase::Connected
            && !self.is_busy();
        if is_due {
            self.fail_lifetime_timeout();
        }
        is_due
    }

    fn fail_lifetime_timeout(&self) {
        let (kind, ms) = (ConnTimeoutKind::MaxLifetime, self.timers().max_lifetime_ms);
        self.fail_timeout(kind, format_args!("{}", fmt_conn_timeout(kind, ms, "")));
    }
}
