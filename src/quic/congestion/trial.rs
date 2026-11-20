//! Short bursts take many wake-ups. They help to get through a short queue, but not if it is the rate that is too high.

use super::{Feedback, MICROS_PER_SECOND, SEGMENT};
use crate::time::Instant;

const MIN_PERIOD_LEN: u64 = 1024 * SEGMENT;
/// What longer bursts may cost, in thousandths of the rate and of what is delivered.
const TOLERATED_SLOWDOWN: u64 = 25;
const TOLERATED_LOSS: u64 = 60;
/// In periods.
const MIN_BACKOFF: u32 = 7;
const MAX_BACKOFF: u32 = 63;

#[derive(Default)]
pub(super) struct Trial {
    /// How many of the times that bursts can be halved are done without.
    pub(super) spared: u32,
    /// Whether that is one more than in the last period.
    is_new: bool,
    since: Option<Instant>,
    acked: u64,
    lost: u64,
    /// Not zero once `spared` is not.
    last_len: u64,
    /// In bytes per second.
    min_rate: u64,
    /// In thousandths.
    max_loss: u64,
    /// In periods, the first of which is for the rate to recover.
    pause: u32,
    backoff: u32,
}

impl Trial {
    pub(super) fn interrupt(&mut self) {
        self.since = None;
    }

    /// A period is made of whole cycles, in each of which the sender probes for bandwidth.
    #[inline]
    pub(super) fn update(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        starts_cycle: bool,
        are_bursts_short: bool,
    ) {
        let Some(since) = self.since else {
            (self.since, self.acked, self.lost) = (starts_cycle.then_some(now), 0, 0);
            return;
        };
        self.acked += feedback.acked;
        self.lost += feedback.lost;
        let is_judged = self.spared > 0 && self.pause < self.backoff.max(1);
        if !starts_cycle || self.acked < MIN_PERIOD_LEN {
            if is_judged && self.lost * 1000 / self.acked.max(self.last_len) > self.max_loss {
                self.retreat();
            }
            return;
        }
        let rate = self.acked.saturating_mul(MICROS_PER_SECOND) / (now - since).as_micros().max(1);
        let loss = self.lost * 1000 / self.acked;
        if is_judged && (rate < self.min_rate || loss > self.max_loss) {
            return self.retreat();
        }
        let min_rate = rate - rate / 1000 * TOLERATED_SLOWDOWN;
        match self.spared {
            0 => (self.min_rate, self.max_loss) = (min_rate, loss + TOLERATED_LOSS),
            _ => self.min_rate = self.min_rate.max(min_rate),
        }
        self.is_new = self.pause == 0 && are_bursts_short;
        self.spared += u32::from(self.is_new);
        (self.pause, self.last_len) = (self.pause.saturating_sub(1), self.acked);
        (self.since, self.acked, self.lost) = (Some(now), 0, 0);
    }

    /// By one step, unless it is the path that has changed.
    fn retreat(&mut self) {
        (self.spared, self.backoff) = match self.is_new {
            true => (self.spared - 1, 2 * self.backoff + 1),
            false => (0, self.backoff),
        };
        self.backoff = self.backoff.clamp(MIN_BACKOFF, MAX_BACKOFF);
        (self.pause, self.since, self.is_new) = (self.backoff, None, false);
    }
}
