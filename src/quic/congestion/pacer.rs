//! RFC 9002 §7.7.

use super::Feedback;
use super::rtt::{GRANULARITY, Rtt};
use super::trial::Trial;
use crate::time::{Duration, Instant};

/// In packets.
const BURST: u8 = 10;
/// In bytes. What a packet counts as at least if the last one has only just taken all there was to send, so that what is
/// written bit by bit gets time to gather, up to [`GRANULARITY`].
const MIN_CHARGE: u64 = 1200;
const MAX_QUANTUM: u64 = 64 * 1024;
const MICROS_PER_HALVING: u64 = 512;
pub(super) const MAX_OVERFLOWS: u32 = 5;
/// After how many without an overflow one is forgotten.
const QUANTA_PER_OVERFLOW: u64 = 256;
/// If it is back within this many, it takes four times as long to forget it again.
const QUANTA_PER_RELAPSE: u64 = 32;
const MAX_RELAPSES: u32 = 3;
/// In bytes. It takes more than a burst to overflow a longer one.
const SHORT_QUEUE: u64 = 96 * 1024;
/// In packets.
const CAUTIOUS_TURN: usize = 16;
/// A burst starts after the time that this many packets take, or else after `MAX_PAUSE`.
const PAUSE: u64 = 3;
const MAX_PAUSE: Duration = Duration::from_micros(250);
const STARTS_AVERAGED: u32 = 512;
/// The shares of lost starts, in millionths, at which a queue is taken to be shared, and at which it is not any more.
const SHARED_ABOVE: u32 = 10_000;
const SHARED_DOWN_TO: u32 = 3_000;
/// The share from which on the ends get lost often enough by chance.
const LOSSY_ABOVE: u32 = 30_000;
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
    /// A sender makes up for waking late up to this time, unless something else holds it back for long.
    catch_up_until: Instant,
    /// Since that was set.
    was_window_full: bool,
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
    /// Or rather since one was forgotten.
    has_forgotten: bool,
    /// Which overflow has come back, and how many times.
    relapses: (u32, u32),
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
    /// Since the last packet.
    has_run_dry: bool,
    /// The next packet is not to hold up those that follow.
    is_urgent: bool,
    /// Nothing has been heard of what was sent since the flight was empty. The free burst may still be in the queue.
    is_restarting: bool,
    trial: Trial,
}

impl Pacer {
    pub(super) fn set_rate(&mut self, len: u64, per: Duration, rtt: &Rtt) {
        let time_per_byte = per.as_micros().saturating_mul(1 << FRACTION_BITS) / len.max(1);
        if self.was_window_full && time_per_byte < self.time_per_byte {
            // It stays as many bytes.
            let lag = self.catch_up_until - GRANULARITY - self.next;
            self.next = self.next + (lag - lag * time_per_byte / self.time_per_byte);
        }
        self.time_per_byte = time_per_byte;
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

    pub(super) fn is_queue_short(&self, queue_delay: Duration) -> bool {
        queue_delay.as_micros() < self.time_per_byte.saturating_mul(SHORT_QUEUE) >> FRACTION_BITS
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
            self.rest = match self.is_restarting && self.next > now {
                true => 1,
                false => self.quantum,
            };
        }
        if self.rest > 0 {
            return None;
        }
        (self.catch_up_until, self.was_window_full) = (self.next + self.max_lag, false);
        Some(self.next)
    }

    #[inline]
    pub(super) fn on_limited_otherwise(&mut self) {
        self.catch_up_until = Instant::default();
    }

    /// Whoever wakes late fills the window before it has read the acknowledgments that are waiting.
    #[inline]
    pub(super) fn on_window_full(&mut self, now: Instant, window: u64) {
        if core::mem::replace(&mut self.was_window_full, true) {
            return;
        }
        if self.is_queue_in_doubt() || self.next + GRANULARITY >= now {
            return self.on_limited_otherwise();
        }
        let owed = self.time_per_byte.saturating_mul(window / 2) >> FRACTION_BITS;
        self.next = self.next.max(now - Duration::from_micros(owed));
        self.catch_up_until = self.catch_up_until.min(now + GRANULARITY);
    }

    /// Once they have been read.
    #[inline]
    pub(super) fn reconsider_catching_up(&mut self, is_held_back: bool) {
        if self.was_window_full && (is_held_back || self.is_queue_in_doubt()) {
            self.on_limited_otherwise();
        }
    }

    fn is_queue_in_doubt(&self) -> bool {
        self.overflows > 0
            || self.trial.max_overflows() < MAX_OVERFLOWS
            || self.trial.is_unsettled()
            || self.is_shared
    }

    pub(super) fn on_application_limited(&mut self) {
        self.on_limited_otherwise();
        self.has_run_dry = true;
    }

    pub(super) fn hurry(&mut self) {
        self.is_urgent = true;
    }

    pub(super) fn on_idle_restart(&mut self, now: Instant, is_recovering: bool) {
        (self.next, self.left_at) = (self.next.min(now), now);
        self.is_restarting = self.has_run_dry && !is_recovering;
        if now - self.last_sent_at > self.max_lag {
            self.trial.abandon();
        }
        if !is_recovering {
            self.burst_tokens = BURST;
        }
        if self.overflows > 0 && !self.loses_starts() {
            self.shorten_burst();
        }
    }

    pub(super) fn shorten_burst(&mut self) {
        self.burst_tokens = self.burst_tokens.min(BURST / 2);
    }

    #[inline]
    pub(super) fn has_run_dry(&self) -> bool {
        self.has_run_dry
    }

    pub(super) fn last_sent_at(&self) -> Instant {
        self.last_sent_at
    }

    #[inline]
    pub(super) fn on_sent(&mut self, now: Instant, len: u16) -> Place {
        let time = self.time_per_byte.saturating_mul(len.into());
        let pause = Duration::from_micros(time.saturating_mul(PAUSE) >> FRACTION_BITS);
        let gap = now - self.last_sent_at;
        let place = match gap > pause.min(MAX_PAUSE) {
            true if now >= self.left_at => Place::FirstAfterGap,
            true => Place::First,
            false => Place::Later,
        };
        let is_urgent = core::mem::take(&mut self.is_urgent);
        let len = u64::from(len);
        let charge = match self.has_run_dry && gap <= MAX_PAUSE && !is_urgent {
            true => MIN_CHARGE.clamp(len, len.saturating_add(self.steady)),
            false => len,
        };
        (self.last_sent_at, self.has_run_dry) = (now, false);
        self.left_at =
            self.left_at.max(now) + Duration::from_micros((time / 4 * 3) >> FRACTION_BITS);
        if self.burst_tokens > 0 {
            self.burst_tokens -= 1;
            return place;
        }
        self.rest = self.rest.saturating_sub(charge);
        self.sent_since_overflow += len;
        if self.sent_since_overflow > QUANTA_PER_OVERFLOW * self.max_quantum() {
            self.forget_overflow();
        }
        if now > self.catch_up_until {
            self.next = self.next.max(now);
        }
        let time = (self.time_per_byte.saturating_mul(charge)).saturating_add(self.remainder);
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

    /// Whether an overflow may just as well be none.
    #[inline]
    pub(super) fn loses_starts(&self) -> bool {
        self.lost_starts > LOSSY_ABOVE
    }

    pub(super) fn on_feedback(&mut self, has_loss: bool) {
        self.is_restarting = false;
        if has_loss {
            (self.burst_tokens, self.rest) = (0, 0);
        }
    }

    /// `in_flight` has been sent since then.
    pub(super) fn on_overflow(&mut self, is_burst_at_fault: bool, in_flight: u64) {
        let is_relapse = is_burst_at_fault
            && self.sent_since_overflow <= QUANTA_PER_RELAPSE * self.max_quantum() + in_flight;
        self.overflows = (self.overflows + 1).min(self.trial.max_overflows());
        if core::mem::take(&mut self.has_forgotten) {
            let (overflow, count) = self.relapses;
            let count = u32::from(overflow == self.overflows) * count + 1;
            self.relapses = (
                self.overflows,
                u32::from(is_relapse) * count.min(MAX_RELAPSES),
            );
        }
        self.sent_since_overflow = 0;
    }

    fn forget_overflow(&mut self) {
        let (overflow, count) = self.relapses;
        let quanta = QUANTA_PER_OVERFLOW << (u32::from(overflow == self.overflows) * 2 * count);
        if self.sent_since_overflow > quanta * self.max_quantum() {
            if overflow > self.overflows {
                self.relapses = (0, 0);
            }
            self.has_forgotten = self.overflows > 0;
            (self.overflows, self.sent_since_overflow) = (self.overflows.saturating_sub(1), 0);
        }
    }

    #[inline]
    pub(super) fn is_on_trial(&self) -> bool {
        self.trial.is_unsettled()
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
