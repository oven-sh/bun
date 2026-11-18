use core::cell::{Cell, OnceCell};
use std::os::windows::io::{AsHandle as _, OwnedHandle};

use crate::port::key;
use crate::sys::{self, Timeout, WaitPacket};

/// The timeout of a wait ends on a tick of the system clock, up to 15.6 ms late, so this ends the wait instead.
#[derive(Default)]
pub(crate) struct Timer {
    handles: OnceCell<(OwnedHandle, WaitPacket)>,
    /// In the past if it is not set.
    due_ns: Cell<u64>,
    is_associated: Cell<bool>,
}

impl Timer {
    /// For a wait on `port` that has to end in `remaining_ns`.
    pub(crate) fn timeout(&self, port: &OwnedHandle, now_ns: u64, remaining_ns: u64) -> Timeout {
        const TICKS_PER_MS: i64 = 10_000;
        let ticks = remaining_ns.div_ceil(100) as i64;
        if ticks == 0 {
            return Timeout::Now;
        }
        if self.arm(port, now_ns, remaining_ns, ticks) {
            // The timer stands still while the machine sleeps.
            Timeout::WallClockAfter(ticks + 32 * TICKS_PER_MS)
        } else {
            Timeout::After(ticks.max(TICKS_PER_MS))
        }
    }

    fn handles(&self) -> Option<&(OwnedHandle, WaitPacket)> {
        if let Some(handles) = self.handles.get() {
            return Some(handles);
        }
        let packet = WaitPacket::new().ok()??;
        let timer = sys::create_high_resolution_timer()?;
        Some(self.handles.get_or_init(|| (timer, packet)))
    }

    /// One that is due earlier is left alone: most waits end with another packet.
    fn arm(&self, port: &OwnedHandle, now_ns: u64, remaining_ns: u64, ticks: i64) -> bool {
        let Some((timer, packet)) = self.handles() else {
            return false;
        };
        /// Callers read the clock for each wait, so one deadline comes out a little different each time.
        const SLACK_NS: u64 = 100_000;
        let due_ns = now_ns.saturating_add(remaining_ns);
        if !(now_ns..=due_ns.saturating_add(SLACK_NS)).contains(&self.due_ns.get()) {
            if !sys::set_timer(timer, ticks) {
                return false;
            }
            self.due_ns.set(due_ns);
        }
        if !self.is_associated.get() {
            let associated = packet.associate(port, timer.as_handle(), key::TIMER, 0);
            self.is_associated.set(associated.is_ok());
        }
        self.is_associated.get()
    }

    pub(crate) fn fired(&self) {
        self.due_ns.set(0);
        self.is_associated.set(false);
    }
}
