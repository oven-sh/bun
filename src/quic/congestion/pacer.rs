//! RFC 9002 §7.7.

use super::rtt::{GRANULARITY, Rtt};
use crate::time::{Duration, Instant};

/// In packets.
const BURST: u8 = 10;
const MAX_QUANTUM: u64 = 64 * 1024;
const MICROS_PER_HALVING: u64 = 512;
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
}

impl Pacer {
    pub(super) fn set_rate(&mut self, len: u64, per: Duration, rtt: &Rtt) {
        self.time_per_byte = per.as_micros().saturating_mul(1 << FRACTION_BITS) / len.max(1);
        self.max_lag = rtt.probe_timeout();
        // The shorter the path, the less it takes to make up for a burst that gets lost.
        self.bonus = match rtt.has_sample() {
            true => MAX_QUANTUM >> (rtt.min.as_micros() / MICROS_PER_HALVING).min(63),
            false => 0,
        };
        let steady = len.saturating_mul(GRANULARITY.as_micros()) / per.as_micros().max(1);
        self.quantum = steady.saturating_add(self.bonus).clamp(1, MAX_QUANTUM);
    }

    #[inline]
    pub(super) fn bonus(&self) -> u64 {
        self.bonus
    }

    /// Returns when to try again, if it is too early.
    #[inline]
    pub(super) fn delay(&mut self, now: Instant) -> Option<Instant> {
        if self.rest == 0 && self.next <= now + GRANULARITY {
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
}
