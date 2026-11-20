//! RFC 9002 §5.

use core::ops::RangeInclusive;

use crate::time::Duration;

/// RFC 9002 §6.1.2.
pub(crate) const GRANULARITY: Duration = Duration::from_millis(1);
const INITIAL_RTT: Duration = Duration::from_millis(50);
/// In eighths of a round trip.
const TIME_THRESHOLDS: RangeInclusive<u64> = 9..=18;

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Rtt {
    pub(crate) latest: Duration,
    /// Zero until there is a sample, like the others.
    pub(crate) smoothed: Duration,
    pub(crate) variation: Duration,
    pub(crate) min: Duration,
    /// By how much it has grown.
    time_threshold_excess: u64,
}

impl Rtt {
    #[inline]
    pub(crate) fn has_sample(&self) -> bool {
        !self.smoothed.is_zero()
    }

    pub(crate) fn update(&mut self, sample: Duration, ack_delay: Duration) {
        let sample = sample.max(Duration::from_micros(1));
        self.latest = sample;
        if !self.has_sample() {
            (self.min, self.smoothed, self.variation) = (sample, sample, sample / 2);
            return;
        }
        self.min = self.min.min(sample);
        let adjusted = match sample >= self.min + ack_delay {
            true => sample - ack_delay,
            false => sample,
        };
        self.variation = (self.variation * 3 + self.smoothed.abs_diff(adjusted)) / 4;
        self.smoothed = (self.smoothed * 7 + adjusted) / 8;
    }

    /// RFC 9002 §5.2.
    pub(crate) fn forget_min(&mut self) {
        self.min = self.latest;
    }

    /// RFC 9002 §6.2.1, without the delay of acknowledgments and without backoff.
    #[inline]
    pub(crate) fn probe_timeout(&self) -> Duration {
        match self.has_sample() {
            true => self.smoothed + (self.variation * 4).max(GRANULARITY),
            false => INITIAL_RTT * 3,
        }
    }

    /// The variation starts as a guess, and takes many samples to come down from there or from a spike.
    #[inline]
    pub(crate) fn probe_delay(&self, max_ack_delay: Duration) -> Duration {
        let max = match self.has_sample() {
            true => {
                let margin = (self.smoothed / 2).max(GRANULARITY);
                self.smoothed + self.smoothed.max(margin + max_ack_delay)
            }
            false => Duration::MAX,
        };
        (self.probe_timeout() + max_ack_delay).min(max)
    }

    /// RFC 9002 §6.1.2.
    #[inline]
    pub(crate) fn loss_delay(&self) -> Duration {
        let threshold = TIME_THRESHOLDS.start() + self.time_threshold_excess;
        match self.has_sample() {
            true => (self.smoothed.max(self.latest) * threshold / 8).max(GRANULARITY),
            false => INITIAL_RTT * threshold / 8,
        }
    }

    /// For a packet that counted as lost, and is acknowledged `elapsed` after it was sent.
    pub(crate) fn on_late(&mut self, elapsed: Duration) {
        let rtt = self.smoothed.max(self.latest).as_micros().max(1);
        let needed = elapsed.as_micros().saturating_mul(8) / rtt + 2;
        let excess = (needed.min(*TIME_THRESHOLDS.end())).saturating_sub(*TIME_THRESHOLDS.start());
        self.time_threshold_excess = self.time_threshold_excess.max(excess);
    }

    pub(crate) fn forget_lateness(&mut self) {
        self.time_threshold_excess = 0;
    }
}
