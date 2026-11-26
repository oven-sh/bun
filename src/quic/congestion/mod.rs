//! Congestion control and pacing (RFC 9002 §7).

mod bandwidth_sampler;
mod bbr;
mod ceiling;
mod crowd;
mod cubic;
mod pacer;
mod rtt;
mod spread;
mod trial;
mod windowed_filter;

use bbr::Bbr;
use crowd::Crowd;
use cubic::Cubic;
use pacer::{Pacer, Place};
pub(crate) use rtt::{GRANULARITY, Rtt};
use spread::Spread;

use crate::time::Instant;

/// What TCP counts in on Ethernet, and the least that is counted in here.
const SEGMENT: u64 = 1460;
const INITIAL_WINDOW: u64 = 32 * SEGMENT;
const MAX_WINDOW: u64 = 16 * 1024 * 1024;
/// To lose their ends is what happens to bursts that are too long for a queue. It takes this many packets to tell, no
/// more than `OVERFLOW_SPAN` bursts apart.
const OVERFLOW_LEN: u64 = 3;
/// How many count at once. More than that is what an outage comes to.
const MAX_LOST_STARTS: u8 = 2;
const OVERFLOW_SPAN: u64 = 4;
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
    place: Place,
    /// Counts from 1, across the packet number spaces.
    pub(crate) sequence: u64,
    /// The low bits of the number of bytes delivered before.
    delivered: u32,
    /// In microseconds, since the last delivery.
    since_delivery: u32,
    /// In microseconds, since the newest packet that was delivered was sent.
    send_elapsed: u32,
    is_application_limited: bool,
}

const _: () = assert!(size_of::<Flight>() == 32);

impl Flight {
    #[inline]
    pub(crate) fn starts_burst(&self) -> bool {
        self.place != Place::Later
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Permit {
    Now,
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
    is_overflow: bool,
    lost_starts: u8,
    /// See [`Pacer::loses_starts`].
    loses_starts: bool,
    is_persistent_congestion: bool,
    /// What remains.
    in_flight: u64,
    prior_in_flight: u64,
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
    spread: Spread,
    crowd: Crowd,
    in_flight: u64,
    /// Until when to wait for more room in a window that has been full.
    refill_at: Instant,
    /// As of the last packet, however many ACK frames have come in since.
    prior_in_flight: u64,
    last_sent: u64,
    /// The last packet that took another path.
    last_foreign: u64,
    last_lost: u64,
    /// How many packets in a row were lost up to `last_lost`, unless the first of them started a burst.
    lost_run: Option<u32>,
    /// How many packets the last bursts have lost at their ends, and the last of them.
    lost_ends: u64,
    last_lost_end: u64,
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
            spread: Spread::default(),
            crowd: Crowd::default(),
            in_flight: 0,
            refill_at: Instant::default(),
            prior_in_flight: 0,
            last_sent: 0,
            last_foreign: 0,
            last_lost: 0,
            lost_run: None,
            lost_ends: 0,
            last_lost_end: 0,
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

    /// What the window has left.
    #[inline]
    pub(crate) fn room(&self) -> u64 {
        self.window().saturating_sub(self.in_flight)
    }

    /// About how many bytes the pacer lets go out at this time, and how many can go out in each [`GRANULARITY`].
    #[inline]
    pub(crate) fn pace(&self, now: Instant, datagram_len: u64, rtt: &Rtt) -> (u64, u64) {
        let clocked = self.window() * GRANULARITY.as_micros() / rtt.smoothed.as_micros().max(1);
        let allowance = (self.pacer).allowance(now, self.in_flight == 0, datagram_len);
        (allowance, self.pacer.steady().min(clocked))
    }

    /// For one more packet, which may be what fills the window over the brim. After that, it may wait until more of
    /// what is `unsent` can be sent together.
    #[inline]
    pub(crate) fn permit(&mut self, now: Instant, unsent: u64) -> Permit {
        if self.in_flight == 0 {
            return Permit::Now;
        }
        let window = self.window();
        if self.in_flight >= window {
            self.refill_at = Instant::NEVER;
            match self.holds_back() {
                true => self.pacer.on_limited_otherwise(),
                false => self.pacer.on_window_full(now, window),
            }
            return Permit::Blocked;
        }
        if now < self.refill_at {
            let wanted = unsent.min(self.pacer.bonus()).min(window / 3);
            if self.in_flight + wanted >= window && !self.is_recovering() {
                self.refill_at = self.refill_at.min(now + GRANULARITY);
                self.pacer.on_limited_otherwise();
                return Permit::At(self.refill_at);
            }
            self.refill_at = Instant::default();
        }
        self.pacer.delay(now).map_or(Permit::Now, Permit::At)
    }

    /// Whether what is `unsent` would be one more of many small packets.
    #[inline]
    pub(crate) fn is_crowded(&self, unsent: u64) -> bool {
        self.crowd.would_grow(unsent, self.in_flight) && self.pacer.has_run_dry()
    }

    /// Until when it waits for more, if it is all there is to send.
    pub(crate) fn gathers_until(
        &mut self,
        now: Instant,
        rtt: &Rtt,
        continues_series: impl FnOnce() -> bool,
    ) -> Instant {
        let until = self.pacer.last_sent_at() + self.crowd.wait(now, rtt, continues_series);
        if now < until {
            self.pacer.on_limited_otherwise();
        }
        until
    }

    /// After how many packets to make way for other connections, which may share the queues.
    #[inline]
    pub(crate) fn max_turn(&self) -> usize {
        self.pacer.max_turn()
    }

    /// Whether to hand datagrams to the system one by one.
    #[inline]
    pub(crate) fn spreads_out(&self) -> bool {
        self.spread.is_on
    }

    /// Whether so little is waiting on the path that a burst can make a difference.
    #[inline]
    pub(crate) fn is_queue_short(&self, rtt: &Rtt) -> bool {
        let min_rtt = match &self.model {
            Model::Cubic(_) => rtt.min,
            Model::Bbr(bbr) => bbr.min_rtt(rtt),
        };
        self.pacer.is_queue_short(rtt.smoothed - min_rtt)
    }

    #[inline]
    pub(crate) fn on_sent(&mut self, now: Instant, len: u16, rtt: &Rtt) -> Flight {
        if self.in_flight == 0 {
            self.on_idle_restart(now, rtt);
        }
        self.in_flight += u64::from(len);
        self.crowd.on_sent();
        self.prior_in_flight = self.in_flight;
        self.last_sent += 1;
        let mut flight = Flight {
            at: now,
            len,
            place: self.pacer.on_sent(now, len),
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
        match &mut self.model {
            Model::Cubic(cubic) => cubic.on_idle_restart(now),
            Model::Bbr(bbr) => bbr.on_idle_restart(now),
        }
        (self.crowd).on_idle_restart(now - self.pacer.last_sent_at(), rtt);
        self.pacer.on_idle_restart(now, self.is_recovering());
        if matches!(&self.model, Model::Bbr(bbr) if bbr.suspects_short_queue()) {
            self.pacer.shorten_burst();
        }
        self.spread.on_idle_restart(now);
        self.update_pacing_rate(rtt);
    }

    fn is_recovering(&self) -> bool {
        match &self.model {
            Model::Cubic(cubic) => cubic.is_recovering,
            Model::Bbr(bbr) => bbr.is_recovering(),
        }
    }

    /// Whether a window that has been full is to be the end of making up for waking late.
    fn holds_back(&self) -> bool {
        match &self.model {
            Model::Cubic(_) => true,
            Model::Bbr(bbr) => bbr.holds_back() || self.spread.is_on,
        }
    }

    /// There is nothing more to send, or no credit for it.
    pub(crate) fn on_application_limited(&mut self) {
        self.on_run_dry(false);
    }

    /// Likewise, but the application may have gone for more.
    pub(crate) fn on_run_dry(&mut self, awaits_more: bool) {
        self.pacer.on_application_limited(awaits_more);
        if let Model::Bbr(bbr) = &mut self.model
            && !awaits_more
            && self.in_flight < bbr.window()
        {
            bbr.on_application_limited(self.last_sent);
        }
    }

    /// For a packet with DATAGRAM frames, which do not wait for one another (RFC 9221 §5).
    pub(crate) fn hurry(&mut self) {
        self.pacer.hurry();
    }

    /// For when the loss of what has been sent so far has nothing to do with bursts.
    pub(crate) fn excuse_bursts(&mut self, now: Instant) {
        self.spread.start_period(now, self.last_sent);
    }

    /// Takes a packet out of the flight without drawing a conclusion. Returns whether it was part of it.
    #[inline]
    pub(crate) fn discard(&mut self, flight: &Flight) -> bool {
        let is_counted = flight.sequence > self.last_foreign;
        if is_counted {
            self.in_flight = self.in_flight.saturating_sub(flight.len.into());
            self.crowd.on_settled();
        }
        is_counted
    }

    /// In any order, to be followed by [`Self::end_ack`].
    #[inline]
    pub(crate) fn on_acked(&mut self, flight: &Flight) {
        if self.discard(flight) {
            if flight.place == Place::FirstAfterGap {
                self.pacer.on_start_settled(false);
            }
            self.feedback.acked += u64::from(flight.len);
            let newest = self.feedback.newest_acked.get_or_insert(*flight);
            if newest.sequence < flight.sequence {
                *newest = *flight;
            }
        }
    }

    /// Likewise.
    #[inline]
    pub(crate) fn on_lost(&mut self, flight: &Flight, ends_burst: bool) {
        if self.discard(flight) {
            if flight.place == Place::FirstAfterGap && self.feedback.lost_starts < MAX_LOST_STARTS {
                self.feedback.lost_starts += 1;
                // The gap may have been the time that the system took to send.
                self.pacer.on_start_settled(!self.spread.is_on);
            }
            self.lost_run = match flight.sequence == self.last_lost + 1 {
                true => self.lost_run.map(|it| it.saturating_add(1)),
                false => (!flight.starts_burst()).then_some(1),
            };
            self.last_lost = flight.sequence;
            if ends_burst && let Some(len) = self.lost_run {
                self.on_end_lost(flight, len.into());
            }
            let feedback = &mut self.feedback;
            feedback.lost += u64::from(flight.len);
            feedback.newest_lost = feedback.newest_lost.max(flight.sequence);
        }
    }

    fn on_end_lost(&mut self, last: &Flight, len: u64) {
        let burst = self.pacer.quantum().div_ceil(last.len.max(1).into());
        if last.sequence > self.last_lost_end + OVERFLOW_SPAN * burst {
            self.lost_ends = 0;
        }
        self.last_lost_end = last.sequence;
        self.lost_ends += len;
        if self.lost_ends >= OVERFLOW_LEN {
            (self.lost_ends, self.feedback.is_overflow) = (0, true);
        }
    }

    /// For bytes that have arrived after all.
    pub(crate) fn on_late(&mut self, len: u64) {
        if let Model::Bbr(bbr) = &mut self.model {
            bbr.on_late(len);
            self.spread.on_late(len);
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
            prior_in_flight: self.prior_in_flight,
            last_sent: self.last_sent,
            loses_starts: self.pacer.loses_starts(),
            ..core::mem::take(&mut self.feedback)
        };
        if feedback.acked == 0 && feedback.lost == 0 {
            return;
        }
        self.pacer.on_feedback(feedback.lost > 0);
        self.crowd.on_feedback(now, rtt);
        if feedback.lost > 0 {
            self.crowd.on_loss(now, self.in_flight, rtt);
        }
        let is_queue_short = self.is_queue_short(rtt);
        if feedback.is_overflow
            || matches!(&self.model, Model::Cubic(cubic) if cubic.is_congested(&feedback))
        {
            let is_burst_at_fault = feedback.is_overflow && is_queue_short;
            (self.pacer).on_overflow(is_burst_at_fault, feedback.prior_in_flight);
        }
        match &mut self.model {
            Model::Cubic(cubic) => cubic.on_feedback(now, &feedback, rtt),
            Model::Bbr(bbr) => {
                bbr.on_feedback(now, &feedback, rtt);
                (self.pacer).try_longer_bursts(now, &feedback, bbr.starts_cycle(now));
                let is_typical = !self.pacer.is_on_trial() && !feedback.is_persistent_congestion;
                match bbr.is_cycling() && is_typical {
                    true => self.spread.update(now, &feedback, rtt, is_queue_short),
                    false => self.spread.start_period(now, feedback.last_sent),
                }
            }
        }
        self.pacer.reconsider_catching_up(self.holds_back());
        self.update_pacing_rate(rtt);
    }

    fn update_pacing_rate(&mut self, rtt: &Rtt) {
        let (len, per) = match &self.model {
            Model::Cubic(cubic) => cubic.pacing_rate(rtt),
            Model::Bbr(bbr) => bbr.pacing_rate(rtt),
        };
        self.pacer.set_rate(len, per, rtt);
    }
}

#[cfg(test)]
mod tests;
