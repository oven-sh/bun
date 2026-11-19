//! RFC 9002 §7.7.

use super::rtt::{GRANULARITY, Rtt};
use crate::time::{Duration, Instant};

/// In packets.
const BURST: u8 = 10;
const MAX_QUANTUM: u64 = 64 * 1024;
const MICROS_PER_HALVING: u64 = 512;
const MAX_OVERFLOWS: u32 = 5;
/// After how many without an overflow one is forgotten.
const QUANTA_PER_OVERFLOW: u64 = 256;
/// In packets.
const CAUTIOUS_TURN: usize = 16;
const FRACTION_BITS: u32 = 24;

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
}

impl Pacer {
    pub(super) fn set_rate(&mut self, len: u64, per: Duration, rtt: &Rtt) {
        self.time_per_byte = per.as_micros().saturating_mul(1 << FRACTION_BITS) / len.max(1);
        self.max_lag = rtt.probe_timeout();
        // The shorter the path, the less it takes to make up for a burst that gets lost.
        self.bonus = match rtt.has_sample() {
            true => MAX_QUANTUM >> (rtt.min.as_micros() / MICROS_PER_HALVING).min(63),
            false => 0,
        }
        .min(self.max_quantum());
        let steady = len.saturating_mul(GRANULARITY.as_micros()) / per.as_micros().max(1);
        self.quantum = steady
            .saturating_add(self.bonus)
            .clamp(1, self.max_quantum());
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

    /// Returns when to try again, if it is too early.
    #[inline]
    pub(super) fn delay(&mut self, now: Instant) -> Option<Instant> {
        if self.rest == 0 && self.next <= now + GRANULARITY / (1 << self.overflows) {
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
        self.next = self.next.min(now);
        if !is_recovering {
            self.burst_tokens = BURST;
        }
    }

    #[inline]
    pub(super) fn on_sent(&mut self, now: Instant, len: u16) {
        if self.burst_tokens > 0 {
            self.burst_tokens -= 1;
            return;
        }
        self.rest = self.rest.saturating_sub(len.into());
        self.sent_since_overflow += u64::from(len);
        if self.sent_since_overflow > QUANTA_PER_OVERFLOW * self.max_quantum() {
            (self.overflows, self.sent_since_overflow) = (self.overflows.saturating_sub(1), 0);
        }
        if now > self.catch_up_until {
            self.next = self.next.max(now);
        }
        let time = (self.time_per_byte.saturating_mul(len.into())).saturating_add(self.remainder);
        self.remainder = time % (1 << FRACTION_BITS);
        self.next = self.next + Duration::from_micros(time >> FRACTION_BITS);
    }

    pub(super) fn on_loss(&mut self) {
        (self.burst_tokens, self.rest) = (0, 0);
    }

    pub(super) fn on_overflow(&mut self) {
        (self.overflows, self.sent_since_overflow) = ((self.overflows + 1).min(MAX_OVERFLOWS), 0);
    }
}
