use core::cell::{Cell, OnceCell};
use std::os::windows::io::{AsHandle as _, OwnedHandle};

use bun_threading::spin::has_multiple_cpus;

use crate::port::key;
use crate::sys::{self, Priority, Timeout, WaitPacket};

const MAX_EXCESS_RUN_NS: u64 = 30_000_000;

thread_local! {
    static IS_BOOSTED: Cell<bool> = const { Cell::new(false) };
}

fn clear_boost() {
    if IS_BOOSTED.take()
        && let Some(priority) = Priority::query()
    {
        priority.set_boost(0);
    }
}

/// A wait timeout expires on a clock tick, up to 15.6 ms late, so a high-resolution timer ends the wait instead.
#[derive(Default)]
pub(crate) struct Timer {
    handles: OnceCell<(OwnedHandle, WaitPacket)>,
    /// In the past while the timer is not set.
    due_ns: Cell<u64>,
    is_associated: Cell<bool>,
    /// Since a deadline was last reached. Whatever ends a sleep early boosts the thread by itself.
    sleep_count: Cell<u32>,
    /// Recent run time in excess of sleep time.
    excess_run_ns: Cell<u64>,
    /// When a run can next be exempt from the fair-share check.
    next_exemption_ns: Cell<u64>,
    is_exempt: Cell<bool>,
}

impl Timer {
    /// Arms the timer for a wait on `port` that has to end in `remaining_ns`.
    pub(crate) fn prepare_timeout(
        &self,
        port: &OwnedHandle,
        now_ns: u64,
        remaining_ns: u64,
    ) -> Timeout {
        const TICKS_PER_MS: i64 = 10_000;
        const BACKSTOP_DELAY_MS: i64 = 32;
        let ticks = remaining_ns.div_ceil(100) as i64;
        if ticks == 0 {
            return Timeout::Zero;
        }
        if self.try_arm(port, now_ns, remaining_ns, ticks) {
            // The timer does not advance while the machine is suspended.
            Timeout::WallClock(ticks + BACKSTOP_DELAY_MS * TICKS_PER_MS)
        } else {
            Timeout::Relative(ticks.max(TICKS_PER_MS))
        }
    }

    /// Called before a sleep. A timer expiry gives no priority boost, so this applies that of a socket completion.
    pub(crate) fn update_boost(
        &self,
        now_ns: u64,
        run_ns: u64,
        is_short_run: bool,
        remaining_ns: u64,
    ) {
        const MAX_BOOSTED_SLEEP_NS: u64 = 1_000_000_000;
        const MAX_BOOSTED_SLEEPS: u32 = 4;
        const LONG_SLEEP_THRESHOLD_NS: u64 = 15_000_000;
        const BOOST_LEVELS: i32 = 2;
        if remaining_ns > MAX_BOOSTED_SLEEP_NS || self.sleep_count.get() == MAX_BOOSTED_SLEEPS {
            return clear_boost();
        }
        let is_first_sleep = self.sleep_count.get() == 0;
        self.sleep_count.update(|count| count + 1);
        let is_fair_share =
            self.excess_run_ns.get() + run_ns <= MAX_EXCESS_RUN_NS / 2 + remaining_ns;
        if !((is_first_sleep || is_short_run) && (is_fair_share || self.try_exempt(now_ns))) {
            return clear_boost();
        }
        // A foreground process gets this boost at the end of every wait.
        if let Some(priority) = Priority::query()
            && (IS_BOOSTED.get() || priority.boost() < BOOST_LEVELS)
        {
            priority.set_boost(BOOST_LEVELS + i32::from(remaining_ns > LONG_SLEEP_THRESHOLD_NS));
            IS_BOOSTED.set(true);
        }
    }

    fn try_exempt(&self, now_ns: u64) -> bool {
        const EXEMPTION_INTERVAL_NS: u64 = 5_000_000_000;
        let is_exempt = now_ns >= self.next_exemption_ns.get();
        self.is_exempt.set(is_exempt);
        if is_exempt {
            self.next_exemption_ns.set(now_ns + EXEMPTION_INTERVAL_NS);
        }
        is_exempt
    }

    pub(crate) fn record_wait(&self, run_ns: u64, sleep_ns: u64) {
        self.excess_run_ns.update(|excess_ns| {
            if self.is_exempt.take() {
                0
            } else {
                (excess_ns + run_ns)
                    .min(MAX_EXCESS_RUN_NS)
                    .saturating_sub(sleep_ns)
            }
        });
    }

    pub(crate) fn note_deadline(&self, has_packets: bool) {
        self.sleep_count.set(0);
        // GC helper threads would run next to this thread, and a thread that yields on a lock loses a time slice.
        if !has_packets && has_multiple_cpus() {
            clear_boost();
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

    /// A timer that is due earlier is not set again: most waits end with another packet.
    fn try_arm(&self, port: &OwnedHandle, now_ns: u64, remaining_ns: u64, ticks: i64) -> bool {
        let Some((timer, packet)) = self.handles() else {
            return false;
        };
        /// Callers read the clock for each wait, so the same deadline differs slightly between calls.
        const SLACK_NS: u64 = 100_000;
        let due_ns = now_ns.saturating_add(remaining_ns);
        if !(now_ns..=due_ns.saturating_add(SLACK_NS)).contains(&self.due_ns.get()) {
            if !sys::set_timer(timer, ticks) {
                return false;
            }
            self.due_ns.set(due_ns);
        }
        if !self.is_associated.get() {
            let result = packet.associate(port, timer.as_handle(), key::TIMER, 0);
            self.is_associated.set(result.is_ok());
        }
        self.is_associated.get()
    }

    pub(crate) fn on_expire(&self) {
        self.due_ns.set(0);
        self.is_associated.set(false);
    }
}
