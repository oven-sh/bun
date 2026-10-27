use core::cell::Cell;
use core::fmt::Arguments;

use bun_core::fmt::{ConnTimeoutKind, fmt_conn_timeout};
use bun_core::{Timespec, TimespecMockMode};

use crate::jsc::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag, JsCell, VirtualMachine};

pub struct ConnectionTimers {
    idle_timeout_ms: u32,
    pub(crate) connection_timeout_ms: u32,
    max_lifetime_ms: u32,
    /// The connection timeout until the connection is established, the idle timeout after.
    pub(crate) timer: JsCell<EventLoopTimer>,
    pub(crate) max_lifetime_timer: JsCell<EventLoopTimer>,
    /// `maxLifetime` ran out while busy; the connection closes when it stops being busy.
    lifetime_exceeded: Cell<bool>,
    /// The pool handed it to a reservation or a transaction: busy even when nothing is on the wire.
    checked_out: Cell<bool>,
}

impl ConnectionTimers {
    pub(crate) fn new(
        idle_timeout_ms: u32,
        connection_timeout_ms: u32,
        max_lifetime_ms: u32,
        timer_tag: EventLoopTimerTag,
        max_lifetime_tag: EventLoopTimerTag,
    ) -> Self {
        Self {
            idle_timeout_ms,
            connection_timeout_ms,
            max_lifetime_ms,
            timer: JsCell::new(EventLoopTimer::init_paused(timer_tag)),
            max_lifetime_timer: JsCell::new(EventLoopTimer::init_paused(max_lifetime_tag)),
            lifetime_exceeded: Cell::new(false),
            checked_out: Cell::new(false),
        }
    }

    pub(crate) fn set_checked_out(&self, checked_out: bool) {
        self.checked_out.set(checked_out);
    }

    pub(crate) fn stop(&self) {
        stop(&self.timer);
        stop(&self.max_lifetime_timer);
    }
}

fn start(timer: &JsCell<EventLoopTimer>, ms: u32) {
    timer.with_mut(|t| t.next = Timespec::ms_from_now(TimespecMockMode::ForceRealTime, ms.into()));
    // SAFETY: not in the heap (every caller checks or `stop`s first). It is a field of a boxed
    // connection, which `stop`s it before it is freed. The fire path recovers the connection from
    // this pointer.
    unsafe { VirtualMachine::timer_insert(VirtualMachine::get(), timer.as_ptr()) };
}

fn stop(timer: &JsCell<EventLoopTimer>) {
    if timer.get().state == EventLoopTimerState::ACTIVE {
        // SAFETY: `ACTIVE` is in the heap.
        unsafe { VirtualMachine::timer_remove(VirtualMachine::get(), timer.as_ptr()) };
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// With what the timeout's message says about how far it got.
    Connecting(&'static str),
    Connected,
    Failed,
}

pub trait TimedConnection {
    fn timers(&self) -> &ConnectionTimers;
    fn phase(&self) -> Phase;
    /// In flight or queued.
    fn has_requests(&self) -> bool;
    fn is_processing_data(&self) -> bool;
    fn fail_timeout(&self, kind: ConnTimeoutKind, message: Arguments<'_>);
    /// Tells the pool to give this connection no more work.
    fn notify_retiring(&self);

    fn is_busy(&self) -> bool {
        self.timers().checked_out.get() || self.has_requests()
    }

    /// The timeout that counts now. 0 ms: none.
    fn timeout(&self) -> (ConnTimeoutKind, u32, &'static str) {
        let timers = self.timers();
        match self.phase() {
            Phase::Connecting(stage) => (
                ConnTimeoutKind::Connection,
                timers.connection_timeout_ms,
                stage,
            ),
            Phase::Connected if !self.is_busy() => {
                (ConnTimeoutKind::Idle, timers.idle_timeout_ms, "")
            }
            _ => (ConnTimeoutKind::Idle, 0, ""),
        }
    }

    fn reset_connection_timeout(&self) {
        // A read resets the idle timeout at its end, and leaves the connection timeout running.
        if self.is_processing_data() {
            return;
        }
        let timer = &self.timers().timer;
        stop(timer);
        let (_, ms, _) = self.timeout();
        if ms != 0 {
            start(timer, ms);
        }
    }

    fn on_connection_timeout(&self) {
        self.timers()
            .timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let (kind, ms, stage) = self.timeout();
        if ms != 0 && !self.is_processing_data() {
            self.fail_timeout(kind, format_args!("{}", fmt_conn_timeout(kind, ms, stage)));
        }
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
