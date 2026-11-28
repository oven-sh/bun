//! If sending less does not make round trips shorter, then others fill the queue, or the route has become longer. A
//! window for the shortest round trip there was gets less through in that time, which makes the next one smaller.

use super::MICROS_PER_SECOND;
use super::bandwidth_sampler::micros;
use crate::time::Duration;

/// For how many rounds a flight is compared with a larger one.
const MAX_AGE: u8 = 20;
/// Those who start together take some time to drain what they have queued.
const MIN_ROUNDS: u8 = 4;
const MIN_MICROS: u32 = 400_000;
/// What arrives in the first one was sent before.
const TRIAL_ROUNDS: u8 = 2;
/// A queue that others fill overflows now and then, not all the time.
const MAX_LOSSY_ROUNDS: u8 = 3;

/// In bytes and microseconds.
#[derive(Default, Clone, Copy)]
struct Round {
    flight: u32,
    rtt: u32,
}

impl Round {
    fn bandwidth(self) -> u64 {
        u64::from(self.flight) * MICROS_PER_SECOND / u64::from(self.rtt.max(1))
    }

    fn is_smaller(self, than: Self, sixteenths: u64) -> bool {
        u64::from(self.flight) * 16 <= u64::from(than.flight) * (16 - sixteenths)
    }

    /// Whether it is also shorter, by much of what it would be if nobody else was there.
    fn is_shorter(self, than: Self) -> bool {
        let gain = u64::from(than.rtt.saturating_sub(self.rtt));
        let yielded = gain * u64::from(than.flight) / u64::from(than.rtt.max(1));
        yielded * 8 >= u64::from(than.flight - self.flight) * 3
    }
}

#[derive(Default)]
pub(super) struct ForeignDelay {
    /// The largest flight and the shortest round trip so far.
    round: Round,
    last_flight: u32,
    pub(super) has_lost: bool,
    lossy_rounds: u8,
    previous: Round,
    /// The one with the largest flight of late.
    former: Round,
    age: u8,
    /// Since the flight has become smaller to no avail, or since the trial has started.
    rounds: u8,
    micros: u32,
    /// Zero unless a larger flight is on trial.
    pub(super) trial_len: u32,
    /// In bytes per second. What it has to beat, or else the last sample.
    bandwidth: u32,
}

/// What to go by after a trial.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Verdict {
    pub(super) rtt: Duration,
    /// In bytes per second.
    pub(super) bandwidth: u64,
}

pub(super) fn saturate(value: u64) -> u32 {
    value.try_into().unwrap_or(u32::MAX)
}

impl ForeignDelay {
    pub(super) fn keeps_losing(&self) -> bool {
        self.lossy_rounds >= MAX_LOSSY_ROUNDS
    }

    /// In bytes per second. It is half as much again as before, like the flight.
    #[inline]
    pub(super) fn trial_rate(&self) -> u64 {
        match self.trial_len {
            0 => 0,
            _ => u64::from(self.bandwidth) * 4 / 3,
        }
    }

    #[inline]
    pub(super) fn on_acked(&mut self, rtt: Duration, in_flight: u64) {
        let Round { flight, rtt: min } = self.round;
        self.round = Round {
            flight: flight.max(saturate(in_flight)),
            rtt: micros(rtt).min(if min > 0 { min } else { u32::MAX }),
        };
    }

    /// For what was sent while something else than the path limited the flight.
    #[inline]
    pub(super) fn on_limited(&mut self) {
        (self.round, self.last_flight) = (Round::default(), 0);
        if core::mem::take(&mut self.trial_len) > 0 {
            self.rounds = 0;
        }
    }

    /// `bandwidth` is the latest sample.
    pub(super) fn end_round(
        &mut self,
        min_rtt: Duration,
        bandwidth: u64,
        may_try: bool,
    ) -> Option<Verdict> {
        let mut round = core::mem::take(&mut self.round);
        self.lossy_rounds = match core::mem::take(&mut self.has_lost) {
            true => self.lossy_rounds.saturating_add(1),
            false => 0,
        };
        // What has arrived was sent in the round before, and a peak may only be what is left of that one.
        let last_flight = core::mem::replace(&mut self.last_flight, round.flight);
        round.flight = round.flight.min(last_flight);
        let previous = core::mem::replace(&mut self.previous, round);
        if self.trial_len > 0 {
            return self.judge(round.rtt, bandwidth);
        }
        let last_bandwidth = core::mem::replace(&mut self.bandwidth, saturate(bandwidth));
        if self.keeps_losing() {
            self.start_over();
        } else if self.lossy_rounds > 0 {
            // It counted as in flight without being in the queue.
            (self.last_flight, self.previous.flight) = (0, 0);
        }
        if self.previous.flight == 0 {
            self.age += 1;
            if self.age > MAX_AGE {
                self.start_over();
            }
            return None;
        }
        // A path that keeps getting slower hides that in the long run.
        let has_helped = round.is_smaller(previous, 2) && round.is_shorter(previous);
        let has_shrunk = round.is_smaller(self.former, 4);
        if has_shrunk
            && !has_helped
            && !round.is_shorter(self.former)
            && u64::from(round.rtt) > min_rtt.as_micros() * 2
        {
            self.rounds = self.rounds.saturating_add(1);
            self.micros = self.micros.saturating_add(round.rtt);
            if may_try && self.rounds >= MIN_ROUNDS && self.micros >= MIN_MICROS {
                self.start_trial(round, bandwidth.max(last_bandwidth.into()));
            }
            return None;
        }
        (self.rounds, self.micros) = (0, 0);
        self.age += 1;
        if has_shrunk || has_helped || round.flight >= self.former.flight || self.age > MAX_AGE {
            (self.former, self.age) = (round, 0);
        }
        None
    }

    fn start_over(&mut self) {
        *self = Self {
            lossy_rounds: self.lossy_rounds,
            ..Self::default()
        };
    }

    /// A sample is too low if the window has just become smaller, which is why it takes the better one of two.
    fn start_trial(&mut self, round: Round, bandwidth: u64) {
        let bandwidth = bandwidth.min(round.bandwidth());
        (self.rounds, self.micros) = (0, 0);
        self.trial_len = round.flight.saturating_add(round.flight / 2);
        self.bandwidth = saturate(bandwidth + bandwidth / 8);
    }

    /// No more gets through a queue that nobody else is in.
    fn judge(&mut self, rtt: u32, bandwidth: u64) -> Option<Verdict> {
        // Recovery holds the flight back.
        self.rounds += u8::from(self.lossy_rounds == 0);
        let to_beat = u64::from(self.bandwidth);
        if bandwidth >= to_beat {
            // No more than it takes to have as much in flight as before, as the path may have become slower.
            self.former.rtt = self.former.rtt.max(rtt);
            let bandwidth = bandwidth.max(self.former.bandwidth());
            self.start_over();
            // Twice that is the window. With any more, those who squeeze one another outbid one another.
            let rtt = Duration::from_micros(u64::from(rtt) / 2);
            return Some(Verdict { rtt, bandwidth });
        }
        if self.keeps_losing() {
            self.start_over();
        } else if self.rounds >= TRIAL_ROUNDS {
            (self.trial_len, self.rounds) = (0, 0);
        } else {
            return None;
        }
        Some(Verdict {
            rtt: Duration::ZERO,
            // The path may just have stalled.
            bandwidth: bandwidth.max(to_beat - to_beat / 9),
        })
    }
}
