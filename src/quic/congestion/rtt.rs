//! RFC 9002 §5.

use crate::time::Duration;

/// RFC 9002 §6.1.2.
pub(crate) const GRANULARITY: Duration = Duration::from_millis(1);
const INITIAL_RTT: Duration = Duration::from_millis(50);

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Rtt {
    pub(crate) latest: Duration,
    /// Zero until there is a sample, like the others.
    pub(crate) smoothed: Duration,
    pub(crate) variation: Duration,
    pub(crate) min: Duration,
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

    /// RFC 9002 §6.2.1, without the delay of acknowledgments and without backoff.
    #[inline]
    pub(crate) fn probe_timeout(&self) -> Duration {
        match self.has_sample() {
            true => self.smoothed + (self.variation * 4).max(GRANULARITY),
            false => INITIAL_RTT * 3,
        }
    }

    /// RFC 9002 §6.1.2.
    #[inline]
    pub(crate) fn loss_delay(&self) -> Duration {
        match self.has_sample() {
            true => (self.smoothed.max(self.latest) * 9 / 8).max(GRANULARITY),
            false => INITIAL_RTT * 9 / 8,
        }
    }
}
