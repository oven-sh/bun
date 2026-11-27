//! Short bursts take many wake-ups. They help to get through a short queue, but not if it is the rate that is too high.

use super::pacer::MAX_OVERFLOWS;
use super::{Feedback, MICROS_PER_SECOND, SEGMENT};
use crate::time::Instant;

const MIN_PERIOD_LEN: u64 = 1024 * SEGMENT;
/// What longer bursts may cost, in thousandths of the rate and of what is delivered.
const TOLERATED_SLOWDOWN: u64 = 25;
const TOLERATED_LOSS: u64 = 60;
/// In periods.
const MIN_BACKOFF: u8 = 7;
const MAX_BACKOFF: u8 = 63;

#[derive(Default)]
struct Period {
    since: Instant,
    acked: u64,
    lost: u64,
    /// That have cut bursts short.
    max_overflows: u8,
    /// It is made of whole cycles, in each of which the sender probes for bandwidth.
    is_comparable: bool,
}

#[derive(Default)]
pub(super) struct Trial {
    /// How many overflows are disregarded.
    spared: u8,
    /// Whether that number has yet to prove itself.
    is_new: bool,
    /// The last one that has not.
    failed: u8,
    /// In how many periods to try it again.
    pause: u8,
    backoff: u8,
    /// From bursts that were too long.
    is_recovering: bool,
    period: Period,
    last_len: u64,
    /// In bytes per second.
    min_rate: u64,
    /// In thousandths.
    max_loss: u64,
}

impl Trial {
    #[inline]
    pub(super) fn max_overflows(&self) -> u8 {
        MAX_OVERFLOWS - self.spared
    }

    #[inline]
    pub(super) fn is_unsettled(&self) -> bool {
        self.is_new || self.is_recovering
    }

    pub(super) fn abandon(&mut self) {
        (self.spared, self.is_new, self.is_recovering) = (0, false, false);
        self.period.is_comparable = false;
    }

    /// `starts_cycle` is `None` unless the path is what limits the rate.
    #[inline]
    pub(super) fn update(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        starts_cycle: Option<bool>,
        overflows: u8,
    ) {
        let period = &mut self.period;
        period.acked += feedback.acked;
        period.lost += feedback.lost;
        period.max_overflows = period.max_overflows.max(overflows);
        period.is_comparable &= starts_cycle.is_some();
        let is_judged = self.spared > 0 && !self.is_recovering;
        if starts_cycle != Some(false) && period.acked >= MIN_PERIOD_LEN && now > period.since {
            self.end_period(now, is_judged, starts_cycle.is_some());
        } else if is_judged
            && period.lost * 1000 / period.acked.max(self.last_len).max(1) > self.max_loss
        {
            self.retreat(now);
        }
    }

    fn end_period(&mut self, now: Instant, is_judged: bool, starts_cycle: bool) {
        let period = &self.period;
        let rate =
            period.acked.saturating_mul(MICROS_PER_SECOND) / (now - period.since).as_micros();
        let loss = period.lost * 1000 / period.acked;
        if is_judged && (loss > self.max_loss || period.is_comparable && rate < self.min_rate) {
            return self.retreat(now);
        }
        if period.is_comparable {
            let min_rate = rate - rate / 1000 * TOLERATED_SLOWDOWN;
            let max_loss = loss + TOLERATED_LOSS;
            (self.min_rate, self.max_loss) = match self.spared {
                0 => (min_rate, max_loss),
                _ => (
                    min_rate.max(self.min_rate),
                    (max_loss + TOLERATED_LOSS).min(self.max_loss),
                ),
            };
            let next = MAX_OVERFLOWS + 1 - period.max_overflows;
            self.is_new = next <= MAX_OVERFLOWS && (next < self.failed || self.pause == 0);
            if self.is_new {
                self.spared = next;
            }
            self.last_len = period.acked;
        } else if core::mem::take(&mut self.is_new) {
            self.spared -= 1;
        }
        (self.pause, self.is_recovering) = (self.pause.saturating_sub(1), false);
        self.period = Period {
            since: now,
            is_comparable: starts_cycle,
            ..Period::default()
        };
    }

    /// By one step, unless it is the path that has changed.
    fn retreat(&mut self, now: Instant) {
        if core::mem::take(&mut self.is_new) {
            self.backoff = (2 * self.backoff + 1).clamp(MIN_BACKOFF, MAX_BACKOFF);
            (self.failed, self.pause) = (self.spared, self.backoff);
            self.spared -= 1;
        } else {
            self.spared = 0;
        }
        self.is_recovering = true;
        self.period = Period {
            since: now,
            ..Period::default()
        };
    }
}
