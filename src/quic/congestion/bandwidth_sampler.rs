//! draft-cheng-iccrg-delivery-rate-estimation-02.

use super::{Flight, MICROS_PER_SECOND};
use crate::time::{Duration, Instant};

pub(super) struct BandwidthSampler {
    /// In bytes.
    pub(super) delivered: u64,
    pub(super) delivered_at: Instant,
    /// Of the newest packet that was delivered.
    pub(super) sent_at: Instant,
    /// The last packet that was sent before the application ran dry, until a later one is delivered.
    limited_through: Option<u64>,
}

pub(super) fn micros(duration: Duration) -> u32 {
    duration.as_micros().try_into().unwrap_or(u32::MAX)
}

impl BandwidthSampler {
    pub(super) fn new() -> Self {
        Self {
            delivered: 0,
            delivered_at: Instant::default(),
            sent_at: Instant::default(),
            limited_through: Some(0),
        }
    }

    #[inline]
    pub(super) fn is_application_limited(&self) -> bool {
        self.limited_through.is_some()
    }

    #[inline]
    pub(super) fn on_application_limited(&mut self, last_sent: u64) {
        self.limited_through = Some(last_sent);
    }

    pub(super) fn on_idle_restart(&mut self, now: Instant) {
        (self.delivered_at, self.sent_at) = (now, now);
    }

    #[inline]
    pub(super) fn on_sent(&self, flight: &mut Flight) {
        flight.delivered = self.delivered as u32;
        flight.since_delivery = micros(flight.at - self.delivered_at);
        flight.send_elapsed = micros(flight.at - self.sent_at);
        flight.is_application_limited = self.is_application_limited();
    }

    /// Returns bytes per second, unless no time has passed.
    pub(super) fn on_delivered(&mut self, now: Instant, len: u64, newest: &Flight) -> Option<u64> {
        self.delivered += len;
        self.delivered_at = now;
        self.sent_at = self.sent_at.max(newest.at);
        self.limited_through.take_if(|last| newest.sequence > *last);

        let delivered = (self.delivered as u32).wrapping_sub(newest.delivered);
        let ack_elapsed = (now - newest.at).as_micros();
        let ack_elapsed = ack_elapsed.saturating_add(newest.since_delivery.into());
        let elapsed = ack_elapsed.max(newest.send_elapsed.into());
        (ack_elapsed > 0).then(|| u64::from(delivered) * MICROS_PER_SECOND / elapsed)
    }
}
