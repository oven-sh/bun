//! RFC 9002 §7.7.

use super::Feedback;
use super::rtt::{GRANULARITY, Rtt};
use super::trial::Trial;
use crate::time::{Duration, Instant};

/// In packets.
const BURST: u8 = 10;
const MAX_QUANTUM: u64 = 64 * 1024;
const MICROS_PER_HALVING: u64 = 512;
pub(super) const MAX_OVERFLOWS: u32 = 5;
/// After how many without an overflow one is forgotten.
const QUANTA_PER_OVERFLOW: u64 = 256;
/// In packets.
const CAUTIOUS_TURN: usize = 16;
/// A burst starts after the time that this many packets take, or else after `MAX_PAUSE`.
const PAUSE: u64 = 3;
const MAX_PAUSE: Duration = Duration::from_micros(250);
const STARTS_AVERAGED: u32 = 512;
/// The shares of lost starts, in millionths, at which a queue is taken to be shared, and at which it is not any more.
const SHARED_ABOVE: u32 = 10_000;
const SHARED_DOWN_TO: u32 = 3_000;
const MIN_SHARED_QUANTUM: u64 = 4096;
const MAX_SHARED_OVERFLOWS: u32 = 2;
const FRACTION_BITS: u32 = 24;

/// Of a packet in its burst.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) enum Place {
    #[default]
    Later,
    /// The last burst may still be leaving.
    First,
    FirstAfterGap,
}

#[derive(Default)]
pub(super) struct Pacer {
    /// How many packets go out without delay.
    burst_tokens: u8,
    next: Instant,
    /// A sender that nothing else holds back makes up for waking late, up to this time.
    catch_up_until: Instant,
    /// What `next` is rounded down by, in fractions of a microsecond.
    remainder: u64,
    /// In fractions of a microsecond.
    time_per_byte: u64,
    max_lag: Duration,
    /// How many bytes go out together.
    quantum: u64,
    /// The part of it that does not depend on the rate.
    bonus: u64,
    /// Of the current one.
    rest: u64,
    /// Of a queue on the path. Each one halves the bursts.
    overflows: u32,
    sent_since_overflow: u64,
    last_sent_at: Instant,
    /// When what has been sent is through an interface that is only faster than the pace by a third.
    left_at: Instant,
    /// The share of bursts whose first packet was lost, in millionths.
    lost_starts: u32,
    /// Others fill the queue as well. It takes in more of those that wake up more often, unless all of them send
    /// bursts in proportion to their rates.
    is_shared: bool,
    /// What the rate comes to in [`GRANULARITY`].
    steady: u64,
    trial: Trial,
}

impl Pacer {
    pub(super) fn set_rate(&mut self, len: u64, per: Duration, rtt: &Rtt) {
        self.time_per_byte = per.as_micros().saturating_mul(1 << FRACTION_BITS) / len.max(1);
        self.max_lag = rtt.probe_timeout();
        // The shorter the path, the less it takes to make up for a burst that gets lost.
        self.bonus = match rtt.has_sample() && !self.is_shared {
            true => MAX_QUANTUM >> (rtt.min.as_micros() / MICROS_PER_HALVING).min(63),
            false => 0,
        }
        .min(self.max_quantum());
        let steady = len.saturating_mul(GRANULARITY.as_micros()) / per.as_micros().max(1);
        self.steady = steady;
        let limit = match self.is_shared {
            true => (steady / 2).clamp(MIN_SHARED_QUANTUM, MAX_QUANTUM),
            false => 0,
        };
        self.quantum = (steady.saturating_add(self.bonus)).clamp(1, self.max_quantum().max(limit));
    }

    #[inline]
    fn max_quantum(&self) -> u64 {
        MAX_QUANTUM >> self.overflows
    }

    #[inline]
    pub(super) fn max_turn(&self) -> usize {
        match self.overflows {
            0 => usize::MAX,
            overflows => (CAUTIOUS_TURN >> overflows).max(1),
        }
    }

    #[inline]
    pub(super) fn bonus(&self) -> u64 {
        self.bonus
    }

    pub(super) fn quantum(&self) -> u64 {
        self.quantum
    }

    /// How early a quantum may go out.
    #[inline]
    fn lead(&self) -> Duration {
        let halvings = match self.is_shared {
            true => self.overflows.min(MAX_SHARED_OVERFLOWS),
            false => self.overflows,
        };
        GRANULARITY / (1 << halvings)
    }

    /// Returns when to try again, if it is too early.
    #[inline]
    pub(super) fn delay(&mut self, now: Instant) -> Option<Instant> {
        if self.rest == 0 && self.next <= now + self.lead() {
            self.rest = self.quantum;
        }
        if self.rest > 0 {
            return None;
        }
        self.catch_up_until = self.next + self.max_lag;
        Some(self.next)
    }

    #[inline]
    pub(super) fn on_limited_otherwise(&mut self) {
        self.catch_up_until = Instant::default();
    }

    pub(super) fn on_idle_restart(&mut self, now: Instant, is_recovering: bool) {
        (self.next, self.left_at) = (self.next.min(now), now);
        if now - self.last_sent_at > self.max_lag {
            self.trial.abandon();
        }
        if !is_recovering {
            self.burst_tokens = BURST;
        }
    }

    #[inline]
    pub(super) fn on_sent(&mut self, now: Instant, len: u16) -> Place {
        let time = self.time_per_byte.saturating_mul(len.into());
        let pause = Duration::from_micros(time.saturating_mul(PAUSE) >> FRACTION_BITS);
        let place = match now - self.last_sent_at > pause.min(MAX_PAUSE) {
            true if now >= self.left_at => Place::FirstAfterGap,
            true => Place::First,
            false => Place::Later,
        };
        self.last_sent_at = now;
        self.left_at =
            self.left_at.max(now) + Duration::from_micros((time / 4 * 3) >> FRACTION_BITS);
        if self.burst_tokens > 0 {
            self.burst_tokens -= 1;
            return place;
        }
        self.rest = self.rest.saturating_sub(len.into());
        self.sent_since_overflow += u64::from(len);
        if self.sent_since_overflow > QUANTA_PER_OVERFLOW * self.max_quantum() {
            (self.overflows, self.sent_since_overflow) = (self.overflows.saturating_sub(1), 0);
        }
        if now > self.catch_up_until {
            self.next = self.next.max(now);
        }
        let time = time.saturating_add(self.remainder);
        self.remainder = time % (1 << FRACTION_BITS);
        self.next = self.next + Duration::from_micros(time >> FRACTION_BITS);
        place
    }

    /// For the first packet of a burst, which finds room in a queue that has only this sender to fill it.
    #[inline]
    pub(super) fn on_start_settled(&mut self, is_lost: bool) {
        if self.trial.is_unsettled() {
            return;
        }
        self.lost_starts -= self.lost_starts / STARTS_AVERAGED;
        self.lost_starts += u32::from(is_lost) * (1_000_000 / STARTS_AVERAGED);
        self.is_shared = self.lost_starts
            > match self.is_shared {
                true => SHARED_DOWN_TO,
                false => SHARED_ABOVE,
            };
    }

    pub(super) fn on_loss(&mut self) {
        (self.burst_tokens, self.rest) = (0, 0);
    }

    pub(super) fn on_overflow(&mut self) {
        self.overflows = (self.overflows + 1).min(self.trial.max_overflows());
        self.sent_since_overflow = 0;
    }

    #[inline]
    pub(super) fn try_longer_bursts(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        starts_cycle: Option<bool>,
    ) {
        if self.is_shared {
            return self.trial.abandon();
        }
        let starts_cycle = starts_cycle.filter(|_| now - self.last_sent_at <= self.max_lag);
        let overflows = self.overflows * u32::from(self.max_quantum() < self.steady);
        self.trial.update(now, feedback, starts_cycle, overflows);
        self.overflows = self.overflows.min(self.trial.max_overflows());
    }
}
