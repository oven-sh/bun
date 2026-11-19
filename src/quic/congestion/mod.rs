//! Congestion control and pacing (RFC 9002 §7).

mod bandwidth_sampler;
mod bbr;
mod cubic;
mod pacer;
mod rtt;
mod windowed_filter;

use bbr::Bbr;
use cubic::Cubic;
use pacer::Pacer;
pub(crate) use rtt::{GRANULARITY, Rtt};

use crate::time::Instant;

/// What TCP counts in on Ethernet, and the least that is counted in here.
const SEGMENT: u64 = 1460;
const INITIAL_WINDOW: u64 = 32 * SEGMENT;
const MAX_WINDOW: u64 = 16 * 1024 * 1024;
const MICROS_PER_SECOND: u64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    Cubic,
    Bbr,
}

/// Of a packet in flight. It goes back to the [`Controller`] once: as acknowledged, as lost or to be discarded.
#[derive(Default, Clone, Copy)]
pub(crate) struct Flight {
    pub(crate) at: Instant,
    pub(crate) len: u16,
    /// Counts from 1, across the packet number spaces.
    sequence: u64,
    /// The low bits of the number of bytes delivered before.
    delivered: u32,
    /// In microseconds, since the last delivery.
    since_delivery: u32,
    /// In microseconds, since the newest packet that was delivered was sent.
    send_elapsed: u32,
    is_application_limited: bool,
}

const _: () = assert!(size_of::<Flight>() == 32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Permit {
    Now,
    /// To keep the pace.
    At(Instant),
    /// The window is full.
    Blocked,
}

/// What one ACK frame or one expiry of the loss timer comes to.
#[derive(Default)]
struct Feedback {
    acked: u64,
    newest_acked: Option<Flight>,
    lost: u64,
    newest_lost: u64,
    is_persistent_congestion: bool,
    /// What remains.
    in_flight: u64,
    last_sent: u64,
}

#[expect(clippy::large_enum_variant, reason = "the large one is the default")]
enum Model {
    Cubic(Cubic),
    Bbr(Bbr),
}

/// Knows of the ack-eliciting packets on the active path.
pub(crate) struct Controller {
    model: Model,
    pacer: Pacer,
    in_flight: u64,
    last_sent: u64,
    /// The last packet that took another path.
    last_foreign: u64,
    feedback: Feedback,
}

fn segment(datagram_len: u16) -> u64 {
    SEGMENT.max(datagram_len.into())
}

impl Controller {
    pub(crate) fn new(algorithm: Algorithm, datagram_len: u16, random: u32) -> Self {
        let segment = segment(datagram_len);
        Self {
            model: match algorithm {
                Algorithm::Cubic => Model::Cubic(Cubic::new(segment)),
                Algorithm::Bbr => Model::Bbr(Bbr::new(segment, random)),
            },
            pacer: Pacer::default(),
            in_flight: 0,
            last_sent: 0,
            last_foreign: 0,
            feedback: Feedback::default(),
        }
    }

    /// For a new path. The packets sent so far do not count any more (RFC 9000 §9.4).
    pub(crate) fn restart(&mut self, datagram_len: u16) {
        let (algorithm, random) = match &self.model {
            Model::Cubic(_) => (Algorithm::Cubic, 0),
            Model::Bbr(bbr) => (Algorithm::Bbr, bbr.random),
        };
        *self = Self {
            last_sent: self.last_sent,
            last_foreign: self.last_sent,
            ..Self::new(algorithm, datagram_len, random)
        };
    }

    pub(crate) fn set_datagram_len(&mut self, datagram_len: u16) {
        match &mut self.model {
            Model::Cubic(Cubic { segment: it, .. }) | Model::Bbr(Bbr { segment: it, .. }) => {
                *it = segment(datagram_len);
            }
        }
    }

    /// In bytes.
    #[inline]
    pub(crate) fn in_flight(&self) -> u64 {
        self.in_flight
    }

    #[inline]
    pub(crate) fn window(&self) -> u64 {
        match &self.model {
            Model::Cubic(cubic) => cubic.window,
            Model::Bbr(bbr) => bbr.window(),
        }
    }

    /// For one more packet, which may be what fills the window over the brim.
    #[inline]
    pub(crate) fn permit(&mut self, now: Instant) -> Permit {
        if self.in_flight == 0 {
            return Permit::Now;
        }
        if self.in_flight >= self.window() {
            self.pacer.on_limited_otherwise();
            return Permit::Blocked;
        }
        self.pacer.delay(now).map_or(Permit::Now, Permit::At)
    }

    #[inline]
    pub(crate) fn on_sent(&mut self, now: Instant, len: u16, rtt: &Rtt) -> Flight {
        if self.in_flight == 0 {
            self.on_idle_restart(now, rtt);
        }
        self.in_flight += u64::from(len);
        self.last_sent += 1;
        self.pacer.on_sent(now, len);
        let mut flight = Flight {
            at: now,
            len,
            sequence: self.last_sent,
            ..Flight::default()
        };
        match &mut self.model {
            Model::Cubic(cubic) => cubic.on_sent(flight.sequence, self.in_flight),
            Model::Bbr(bbr) => bbr.on_sent(&mut flight),
        }
        flight
    }

    #[inline(never)]
    fn on_idle_restart(&mut self, now: Instant, rtt: &Rtt) {
        let is_recovering = match &mut self.model {
            Model::Cubic(cubic) => {
                cubic.on_idle_restart(now);
                cubic.is_recovering
            }
            Model::Bbr(bbr) => {
                bbr.on_idle_restart(now);
                bbr.is_recovering()
            }
        };
        self.pacer.on_idle_restart(now, is_recovering);
        self.update_pacing_rate(rtt);
    }

    /// There is nothing more to send, or no credit for it.
    pub(crate) fn on_application_limited(&mut self) {
        self.pacer.on_limited_otherwise();
        if let Model::Bbr(bbr) = &mut self.model
            && self.in_flight < bbr.window()
        {
            bbr.on_application_limited(self.last_sent);
        }
    }

    /// Takes a packet out of the flight without drawing a conclusion. Returns whether it was part of it.
    #[inline]
    pub(crate) fn discard(&mut self, flight: &Flight) -> bool {
        let is_counted = flight.sequence > self.last_foreign;
        if is_counted {
            self.in_flight = self.in_flight.saturating_sub(flight.len.into());
        }
        is_counted
    }

    /// In any order, to be followed by [`Self::end_ack`].
    #[inline]
    pub(crate) fn on_acked(&mut self, flight: &Flight) {
        if self.discard(flight) {
            self.feedback.acked += u64::from(flight.len);
            let newest = self.feedback.newest_acked.get_or_insert(*flight);
            if newest.sequence < flight.sequence {
                *newest = *flight;
            }
        }
    }

    /// Likewise.
    #[inline]
    pub(crate) fn on_lost(&mut self, flight: &Flight) {
        if self.discard(flight) {
            self.feedback.lost += u64::from(flight.len);
            self.feedback.newest_lost = self.feedback.newest_lost.max(flight.sequence);
        }
    }

    /// Likewise (RFC 9002 §7.6).
    pub(crate) fn on_persistent_congestion(&mut self) {
        self.feedback.is_persistent_congestion = true;
    }

    /// After an ACK frame, with `rtt` up to date, or after the loss timer has expired.
    pub(crate) fn end_ack(&mut self, now: Instant, rtt: &Rtt) {
        let feedback = Feedback {
            in_flight: self.in_flight,
            last_sent: self.last_sent,
            ..core::mem::take(&mut self.feedback)
        };
        if feedback.acked == 0 && feedback.lost == 0 {
            return;
        }
        if feedback.lost > 0 {
            self.pacer.on_loss();
        }
        match &mut self.model {
            Model::Cubic(cubic) => cubic.on_feedback(now, &feedback, rtt),
            Model::Bbr(bbr) => bbr.on_feedback(now, &feedback, rtt),
        }
        self.update_pacing_rate(rtt);
    }

    fn update_pacing_rate(&mut self, rtt: &Rtt) {
        let (len, per) = match &self.model {
            Model::Cubic(cubic) => cubic.pacing_rate(rtt),
            Model::Bbr(bbr) => bbr.pacing_rate(rtt),
        };
        self.pacer.set_rate(len, per, rtt.probe_timeout());
    }
}

#[cfg(test)]
mod tests;
