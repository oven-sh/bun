//! Many small packets can fill a slow path with their headers. A queue looks like a path that has become longer, so
//! there is a trial: fewer packets for a few round trips, and a look at what happens when that ends.
//!
//! And each of them that is lost holds up what follows in its stream for a round trip.

use super::rtt::{GRANULARITY, Rtt};
use crate::time::{Duration, Instant};

const MIN_PACKETS_IN_FLIGHT: u16 = 12;
/// In bytes. Headers make little difference to more than that.
const MAX_LEN: u64 = 600;
const PACKETS_PER_ROUND_TRIP: u64 = 16;
const MAX_WAIT: Duration = Duration::from_millis(20);
/// In round trips. Four times as long after each relapse, which is what comes no later than this after a trial.
const TRIAL_LEN: u64 = 4;
const MAX_RELAPSES: u8 = 3;
/// In round trips.
const LOSS_MEMORY: u64 = 32;

#[derive(Default, PartialEq, Eq)]
enum Phase {
    /// What is known about the queue is out of date.
    #[default]
    Rested,
    Watching,
    Trial,
}

#[derive(Default)]
pub(super) struct Crowd {
    packets_in_flight: u16,
    phase: Phase,
    relapses: u8,
    /// The round-trip time that fewer packets have not helped against.
    base_micros: u32,
    /// The start or the end of the last trial.
    since: Instant,
    loss_forgotten_at: Instant,
}

impl Crowd {
    #[inline]
    pub(super) fn on_sent(&mut self) {
        self.packets_in_flight = self.packets_in_flight.wrapping_add(1);
    }

    #[inline]
    pub(super) fn on_settled(&mut self) {
        self.packets_in_flight = self.packets_in_flight.wrapping_sub(1);
    }

    pub(super) fn on_idle_restart(&mut self, idle: Duration, rtt: &Rtt) {
        if idle > rtt.smoothed * TRIAL_LEN {
            self.phase = Phase::Rested;
        }
    }

    #[inline]
    pub(super) fn would_grow(&self, unsent: u64, in_flight: u64) -> bool {
        self.packets_in_flight >= MIN_PACKETS_IN_FLIGHT
            && unsent < MAX_LEN
            && in_flight < u64::from(self.packets_in_flight) * MAX_LEN
    }

    /// For how long after the last packet the next one waits for more.
    pub(super) fn wait(
        &mut self,
        now: Instant,
        rtt: &Rtt,
        continues_series: impl FnOnce() -> bool,
    ) -> Duration {
        let wait = (rtt.smoothed / PACKETS_PER_ROUND_TRIP).min(MAX_WAIT);
        if self.phase == Phase::Rested || wait < GRANULARITY / 2 {
            return Duration::ZERO;
        }
        if self.phase == Phase::Watching && !(now < self.loss_forgotten_at && continues_series()) {
            if rtt.latest_without_ack_delay() <= self.limit(rtt) + rtt.variation {
                return Duration::ZERO;
            }
            match now < self.since + rtt.smoothed * TRIAL_LEN {
                true => {
                    (self.relapses, self.base_micros) = (MAX_RELAPSES.min(self.relapses + 1), 0)
                }
                false => self.relapses = 0,
            }
            (self.phase, self.since) = (Phase::Trial, now);
        }
        wait
    }

    pub(super) fn on_loss(&mut self, now: Instant, in_flight: u64, rtt: &Rtt) {
        if self.would_grow(0, in_flight) {
            self.loss_forgotten_at = now + rtt.smoothed * LOSS_MEMORY;
        }
    }

    #[inline]
    pub(super) fn on_feedback(&mut self, now: Instant, rtt: &Rtt) {
        let current = rtt.smoothed.max(rtt.latest_without_ack_delay());
        let micros = current.as_micros().try_into().unwrap_or(u32::MAX);
        self.base_micros = self.base_micros.min(micros);
        if self.phase != Phase::Trial {
            self.phase = Phase::Watching;
            return;
        }
        let is_queue_gone = current <= self.limit(rtt);
        if is_queue_gone && self.relapses == 0
            || now >= self.since + rtt.smoothed * (TRIAL_LEN << (2 * self.relapses))
        {
            (self.phase, self.since) = (Phase::Watching, now);
            if !is_queue_gone {
                self.base_micros = micros;
            }
        }
    }

    /// Of a round-trip time without a queue.
    fn limit(&self, rtt: &Rtt) -> Duration {
        let base = Duration::from_micros(self.base_micros.into()).max(rtt.min);
        base + base / 8 + GRANULARITY
    }
}
