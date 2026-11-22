//! The system takes some time for each datagram that it gets on its own, which spreads out a burst. That can be the only
//! way through a short queue if many packets are due whenever the sender wakes up.

use super::{Feedback, MICROS_PER_SECOND, Rtt, SEGMENT};
use crate::time::Instant;

const MIN_PERIOD_LEN: u64 = 1024 * SEGMENT;
const MIN_ROUND_TRIPS: u64 = 8;
/// In thousandths of what is sent.
const HIGH_LOSS: u64 = 30;
/// In periods.
const MAX_STAY: u32 = 63;

#[derive(Default)]
pub(super) struct Spread {
    pub(super) is_on: bool,
    /// The last packet that was sent before the period.
    after: u64,
    /// It is postponed by pauses.
    since: Instant,
    updated_at: Instant,
    acked: u64,
    lost: u64,
    /// For it to stay on, in thousandths and in bytes per second.
    max_loss: u64,
    min_rate: u64,
    /// For how many more periods not to try the other way.
    rest: u32,
    on_for: u32,
    off_for: u32,
}

impl Spread {
    pub(super) fn on_idle_restart(&mut self, now: Instant) {
        self.since = self.since + (now - core::mem::replace(&mut self.updated_at, now));
    }

    pub(super) fn on_late(&mut self, len: u64) {
        let len = len.min(self.lost);
        (self.acked, self.lost) = (self.acked + len, self.lost - len);
    }

    /// For when what happens is not typical.
    #[inline]
    pub(super) fn start_period(&mut self, now: Instant, last_sent: u64) {
        (self.after, self.since, self.updated_at) = (last_sent, now, now);
        (self.acked, self.lost) = (0, 0);
    }

    #[inline]
    pub(super) fn update(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        rtt: &Rtt,
        is_queue_short: bool,
    ) {
        self.updated_at = now;
        let newest_acked = feedback.newest_acked.map_or(0, |it| it.sequence);
        if newest_acked.max(feedback.newest_lost) > self.after {
            self.acked += feedback.acked;
            self.lost += feedback.lost;
        }
        if self.acked + self.lost == 0 {
            self.since = now;
        } else if self.acked + self.lost >= MIN_PERIOD_LEN
            && now > self.since + rtt.smoothed * MIN_ROUND_TRIPS
        {
            self.end_period(now, is_queue_short);
            self.start_period(now, feedback.last_sent);
        }
    }

    fn end_period(&mut self, now: Instant, is_queue_short: bool) {
        let loss = self.lost * 1000 / (self.acked + self.lost);
        let rate = self.acked.saturating_mul(MICROS_PER_SECOND) / (now - self.since).as_micros();
        let longer = |it: u32| (2 * it + 1).min(MAX_STAY);
        if self.is_on && (loss > self.max_loss || rate < self.min_rate) {
            (self.on_for, self.off_for) = (0, longer(self.off_for));
            (self.is_on, self.rest) = (false, self.off_for);
        } else if self.rest > 0 {
            self.rest -= 1;
        } else if self.is_on {
            (self.is_on, self.off_for) = (false, 0);
        } else if loss < HIGH_LOSS {
            self.on_for = 0;
        } else if is_queue_short || self.on_for > 0 {
            (self.max_loss, self.min_rate) = (loss / 2, rate - rate / 10);
            self.on_for = longer(self.on_for);
            (self.is_on, self.rest) = (true, self.on_for);
        }
    }
}
