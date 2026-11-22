use core::cell::{Cell, OnceCell};
use std::os::windows::io::{AsHandle as _, OwnedHandle};

use bun_threading::spin::has_other_cpu;

use crate::port::key;
use crate::sys::{self, Priority, Timeout, WaitPacket};

const MAX_DEBT_NS: u64 = 30_000_000;

thread_local! {
    static IS_BOOSTED: Cell<bool> = const { Cell::new(false) };
}

fn drop_boost() {
    if IS_BOOSTED.take()
        && let Some(priority) = Priority::get()
    {
        priority.set_boost(0);
    }
}

/// The timeout of a wait ends on a tick of the system clock, up to 15.6 ms late, so this ends the wait instead.
#[derive(Default)]
pub(crate) struct Timer {
    handles: OnceCell<(OwnedHandle, WaitPacket)>,
    /// In the past if it is not set.
    due_ns: Cell<u64>,
    is_associated: Cell<bool>,
    /// How many times the thread has gone to sleep since a deadline. What comes earlier raises the priority by itself.
    early: Cell<u32>,
    /// How much longer the thread has run than slept of late.
    debt_ns: Cell<u64>,
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

    /// Time raises no priority, so the thread would queue behind what keeps the CPUs busy. This makes it count like a socket.
    pub(crate) fn before_sleep(&self, ran_ns: u64, is_brief: bool, remaining_ns: u64) {
        const MAX_NS: u64 = 1_000_000_000;
        const MAX_EARLY: u32 = 4;
        const LONG_NS: u64 = 15_000_000;
        const LEVELS: i32 = 2;
        if remaining_ns > MAX_NS || self.early.get() == MAX_EARLY {
            return drop_boost();
        }
        let is_first = self.early.replace(self.early.get() + 1) == 0;
        if self.debt_ns.get() + ran_ns > MAX_DEBT_NS / 2 + remaining_ns || !(is_first || is_brief) {
            return drop_boost();
        }
        // In the foreground, every wait ends with as much.
        if let Some(priority) = Priority::get()
            && (IS_BOOSTED.get() || priority.boost() < LEVELS)
        {
            priority.set_boost(LEVELS + i32::from(remaining_ns > LONG_NS));
            IS_BOOSTED.set(true);
        }
    }

    pub(crate) fn waited(&self, ran_ns: u64, slept_ns: u64) {
        (self.debt_ns).update(|debt| (debt + ran_ns).min(MAX_DEBT_NS).saturating_sub(slept_ns));
    }

    pub(crate) fn note_deadline(&self, has_packets: bool) {
        self.early.set(0);
        // The helpers of the collector would run next to it, and whoever yields at a lock loses a time slice.
        if !has_packets && has_other_cpu() {
            drop_boost();
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
