//! draft-iyengar-quic-delayed-ack-02.

use crate::coding::Write;
use crate::error::{Error, Result};
use crate::frame::kind;
use crate::time::{Duration, Instant};

pub(super) const MIN_ACK_DELAY: Duration = Duration::from_millis(10);
pub(super) const MAX_ACK_DELAY: Duration = Duration::from_millis(25);
/// What `max_ack_delay` can be at most (RFC 9000 §18.2).
const MAX_REQUESTED_DELAY: Duration = Duration::from_millis(1 << 14);
pub(super) const MAX_FRAME_LEN: usize = 2 + 8 + 2 + 4 + 1;

const MIN_TOLERANCE: u64 = 2;
const MAX_TOLERANCE: u64 = 150;
/// For a peer that has not asked for one (RFC 9000 §13.2.2).
const MAX_OWN_TOLERANCE: u64 = 10;
const OWN_ACKS_PER_ROUND_TRIP: u64 = 8;
/// The more an ACK frame covers, the longer the burst that it releases. A queue that loses packets may be short.
const ROUND_TRIPS_AFTER_LOSS: u64 = 128;
const ROUND_TRIPS_PER_UPDATE: u64 = 3;
const MIN_TIME_PER_UPDATE: Duration = Duration::from_millis(1);
const PROPORTIONAL_GAIN: f32 = 0.8;
const INTEGRAL_GAIN: f32 = 0.35;
const ERROR_PER_PACKET: f32 = 0.05;

/// When to acknowledge.
pub(super) struct Policy {
    pub(super) packet_tolerance: u64,
    pub(super) max_delay: Duration,
    pub(super) ignores_order: bool,
    next_sequence: u64,
    /// How many packets have arrived since when.
    arrived: u64,
    since: Instant,
}

impl Default for Policy {
    /// RFC 9000 §13.2.
    fn default() -> Self {
        Self {
            packet_tolerance: MIN_TOLERANCE,
            max_delay: MAX_ACK_DELAY,
            ignores_order: false,
            next_sequence: 0,
            arrived: 0,
            since: Instant::default(),
        }
    }
}

impl Policy {
    #[inline]
    pub(super) fn on_packet(&mut self, now: Instant, rtt: Duration, follows_loss: bool) {
        if self.next_sequence > 0 {
            return;
        }
        if follows_loss {
            self.packet_tolerance = MIN_TOLERANCE;
            self.since = now + rtt * ROUND_TRIPS_AFTER_LOSS;
        }
        self.arrived = (self.arrived + 1) * u64::from(now >= self.since);
        let elapsed = now - self.since;
        if elapsed > rtt {
            let per_round_trip = (rtt * self.arrived).as_micros() / elapsed.as_micros();
            self.packet_tolerance =
                (per_round_trip / OWN_ACKS_PER_ROUND_TRIP).clamp(MIN_TOLERANCE, MAX_OWN_TOLERANCE);
            (self.arrived, self.since) = (0, now);
        }
    }

    pub(super) fn update(
        &mut self,
        sequence: u64,
        packet_tolerance: u64,
        max_delay: Duration,
        ignores_order: bool,
    ) -> Result {
        if packet_tolerance == 0 || !(MIN_ACK_DELAY..MAX_REQUESTED_DELAY).contains(&max_delay) {
            return Err(Error::violation("invalid ACK_FREQUENCY frame"));
        }
        if sequence >= self.next_sequence {
            *self = Self {
                packet_tolerance,
                max_delay,
                ignores_order,
                next_sequence: sequence + 1,
                ..*self
            };
        }
        Ok(())
    }
}

/// Finds the tolerance at which the peer acknowledges a few times in a round trip.
#[derive(Default)]
pub(super) struct Controller {
    acks: u64,
    since: Instant,
    next_update: Instant,
    integral: f32,
    tolerance: Option<u64>,
    next_sequence: u64,
}

impl Controller {
    pub(super) fn new(now: Instant, rtt: Duration) -> Self {
        Self {
            since: now,
            next_update: now + rtt * ROUND_TRIPS_PER_UPDATE,
            ..Self::default()
        }
    }

    /// For a new path.
    pub(super) fn restart(&mut self) {
        (self.integral, self.tolerance) = (0.0, Some(MIN_TOLERANCE));
    }

    /// Returns whether to tell the peer.
    #[inline]
    pub(super) fn on_ack(&mut self, now: Instant, rtt: Duration, packets_sent: u64) -> bool {
        self.acks += 1;
        now >= self.next_update && self.update(now, rtt, packets_sent)
    }

    fn update(&mut self, now: Instant, rtt: Duration, packets_sent: u64) -> bool {
        self.next_update = now + (rtt * ROUND_TRIPS_PER_UPDATE).max(MIN_TIME_PER_UPDATE);
        let elapsed = now - self.since;
        if rtt.is_zero() || elapsed.is_zero() {
            return false;
        }
        self.since = now;
        let round_trips = elapsed.as_micros() as f32 / rtt.as_micros() as f32;
        let error = (self.acks as f32 / round_trips / target_acks(rtt)).ln();
        let step = error * (rtt * ROUND_TRIPS_PER_UPDATE).as_micros() as f32 / 1e6;
        self.integral += step;
        let output = PROPORTIONAL_GAIN * error + INTEGRAL_GAIN * self.integral;
        let change = (output.abs() / ERROR_PER_PACKET) as u64;
        let last = self.tolerance;
        if change > 0 {
            let from = last.unwrap_or_else(|| match packets_sent / self.acks {
                MAX_TOLERANCE.. => MAX_TOLERANCE / 2,
                average => average.max(MIN_TOLERANCE),
            });
            let (new, bound) = match output > 0.0 {
                true => (
                    from.saturating_add(change).min(MAX_TOLERANCE),
                    MAX_TOLERANCE,
                ),
                false => (
                    from.saturating_sub(change).max(MIN_TOLERANCE),
                    MIN_TOLERANCE,
                ),
            };
            if new == bound {
                self.integral -= step;
            }
            self.tolerance = Some(new);
        }
        if self.tolerance.is_some() {
            self.acks = 0;
        }
        self.tolerance != last
    }

    pub(super) fn write_frame(&mut self, max_delay: Duration, out: &mut Vec<u8>) {
        out.varint(kind::ACK_FREQUENCY);
        out.varint(self.next_sequence);
        out.varint(self.tolerance.unwrap_or(MIN_TOLERANCE));
        out.varint(max_delay.as_micros());
        // The packet numbers that we skip are not worth an acknowledgment.
        out.push(1);
        self.next_sequence += 1;
    }
}

/// In a round trip.
fn target_acks(rtt: Duration) -> f32 {
    match rtt.as_micros().div_ceil(1000) {
        ..=5 => 2.5,
        6..=10 => 2.0,
        11..=15 => 1.6,
        16..=20 => 1.4,
        21..=30 => 1.3,
        31..=40 => 1.2,
        41..=50 => 1.1,
        51..=60 => 1.0,
        61..=70 => 0.9,
        71..=80 => 0.8,
        81..=100 => 0.7,
        _ => 0.5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_is_lower_for_longer_paths() {
        let target = |micros| target_acks(Duration::from_micros(micros));
        let steps = (0..200).filter(|it| target(1000 * it) > target(1000 * it + 1));
        assert!(steps.eq([5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 100]));
    }

    #[test]
    fn controller_waits_for_a_round_trip_time() {
        let (start, rtt) = (Instant::default(), Duration::from_millis(1));
        let mut controller = Controller::new(start, Duration::ZERO);
        assert!(!controller.on_ack(start, rtt, 9));
        assert!(!controller.on_ack(start + rtt * 3, Duration::ZERO, 9));
        assert!(controller.on_ack(start + rtt * 4, rtt, 9));
        assert_eq!(controller.tolerance, Some(MIN_TOLERANCE));
    }
}
