//! RFC 9002 §5 and §6.

use super::sent::{Control, Fate, Sent, SentFrame, SentPacket};
use super::space::{Space, SpaceId, Spaces};
use super::streams::Flags;
use super::timers::Timer;
use super::{Connection, Phase};
use crate::error::{Error, Result};
use crate::event::{CloseReason, Event};
use crate::frame::Ack;
use crate::packet::MIN_DATAGRAM_LEN;
use crate::time::{Duration, Instant};

pub(super) const INITIAL_PACKET_THRESHOLD: u64 = 3;
const MAX_PACKET_THRESHOLD: u64 = 256;
/// In round trips.
const MAX_LATENESS: u64 = 4;
const PERSISTENT_CONGESTION_THRESHOLD: u64 = 3;
const MIN_HANDSHAKE_TIMEOUT: Duration = Duration::from_millis(10);
const MIN_TAIL_TIMEOUT: Duration = Duration::from_millis(10);
const MAX_PROBE_TIMEOUT: Duration = Duration::from_secs(60);
const DELIVERY_PERIOD: Duration = Duration::from_secs(30);
/// One part in so many of what has been sent has to be acknowledged in a period.
const DELIVERY_PARTS: u64 = 8;
const PROBES: u8 = 2;
/// After how many timeouts in a row the size of the packets is suspected.
const BLACK_HOLE_THRESHOLD: u32 = 2;
const MIN_SKIP_RANGE: u64 = 256;

/// To tell whether a peer that is there takes what is sent to it.
#[derive(Default)]
pub(super) struct Delivery {
    pub(super) period_end: Instant,
    target: u64,
    is_in_doubt: bool,
}

impl Connection {
    #[inline]
    pub(super) fn on_ack(&mut self, now: Instant, id: SpaceId, ack: &Ack) -> Result {
        let Some(space) = self.spaces.get_mut(id) else {
            return Ok(());
        };
        let is_skipped = |skipped| {
            skipped <= ack.largest
                && (ack.ranges().take_while(|it| it.end > skipped)).any(|it| it.start <= skipped)
        };
        // RFC 9000 §13.1 and §21.4.
        if ack.largest >= space.next_number
            || id == SpaceId::Data && self.skipped.is_some_and(is_skipped)
        {
            return Err(Error::violation("acknowledged a packet that was not sent"));
        }
        let previous_largest = space.sent.largest_acked;
        space.sent.largest_acked = previous_largest.max(Some(ack.largest));
        let mut largest_sent_at = space.received.on_ack(ack);
        let oldest = now - self.rtt.smoothed * MAX_LATENESS;
        let late = space.sent.find_late(oldest, ack.ranges());
        if let Some(late) = &late {
            let distance = previous_largest.unwrap_or(0).saturating_sub(late.number) + 1;
            self.packet_threshold = (self.packet_threshold.max(distance)).min(MAX_PACKET_THRESHOLD);
            self.rtt.on_late(now - late.at);
            self.congestion.on_late(late.len);
        }

        let mut has_news = false;
        let Sent {
            packets, frames, ..
        } = &mut space.sent;
        for range in ack.ranges() {
            let positions = Sent::find(packets, &range);
            if positions.end == 0 {
                break;
            }
            for packet in packets.range_mut(positions).filter(|it| it.is_in_flight()) {
                packet.fate = Fate::Acked;
                has_news = true;
                if packet.number == ack.largest {
                    largest_sent_at = Some(packet.flight.at);
                }
                self.congestion.on_acked(&packet.flight);
                self.path.mtu.on_acked(&packet.flight);
                for frame in frames.of(packet) {
                    match frame {
                        SentFrame::Stream {
                            id,
                            offset,
                            len,
                            fin,
                        } => (self.streams).on_data_acked(id, offset..offset + u64::from(len), fin),
                        SentFrame::Crypto { offset, len } => {
                            space.crypto_send.on_acked(offset..offset + u64::from(len));
                        }
                        SentFrame::Owed(id, Flags::OWES_RESET_STREAM) => {
                            self.streams.on_reset_acked(id);
                        }
                        SentFrame::RetireConnectionId(sequence) => {
                            self.remote_ids.on_acked(sequence);
                        }
                        SentFrame::Datagram(id) => {
                            (self.streams.state.events).push_back(Event::DatagramAcked(id));
                        }
                        SentFrame::MtuProbe => {
                            self.path.mtu.on_probe_acked(packet.flight.len);
                            self.congestion.set_datagram_len(self.path.mtu.current);
                        }
                        SentFrame::Owed(..) | SentFrame::NewConnectionId(_) => {}
                    }
                }
            }
        }
        if let Some(setup) = &mut self.setup {
            setup.is_validated_by_peer |= id == SpaceId::Handshake;
            largest_sent_at.take_if(|_| setup.is_catching_up);
        }
        let is_larger = Some(ack.largest) > previous_largest;
        if !has_news && !is_larger && late.is_none() {
            return Ok(());
        }
        if let Some(sent_at) = largest_sent_at.filter(|_| has_news && is_larger) {
            let delay = match id {
                SpaceId::Data => {
                    let scale = 1 << self.peer.ack_delay_exponent;
                    (Duration::from_micros(ack.delay) * scale).min(self.peer_max_ack_delay())
                }
                _ => Duration::ZERO,
            };
            if !self.rtt.has_sample() {
                self.first_sample_at = now;
            }
            self.rtt.update(now - sent_at, delay);
        }
        self.detect_lost(now, id);
        if !self.has_to_unblock_server() {
            self.pto_count = 0;
        }
        if id == SpaceId::Data {
            if self.next_skip == u64::MAX && self.skipped.is_some_and(|it| it < ack.largest) {
                self.plan_skip();
            }
            let (rtt, sent) = (self.rtt.smoothed, self.spaces.data.next_number);
            if (self.ack_controller.as_mut()).is_some_and(|it| it.on_ack(now, rtt, sent)) {
                self.streams.state.owed |= Control::ACK_FREQUENCY;
            }
        }
        Ok(())
    }

    #[inline]
    pub(super) fn peer_max_ack_delay(&self) -> Duration {
        Duration::from_millis(self.peer.max_ack_delay_millis)
    }

    /// For 1-RTT packets, without backoff.
    #[inline]
    pub(super) fn probe_timeout(&self) -> Duration {
        self.rtt.probe_timeout() + self.peer_max_ack_delay()
    }

    pub(super) fn plan_skip(&mut self) {
        let window = self.congestion.window() / u64::from(self.path.mtu.current);
        let range = (2 * window).max(MIN_SKIP_RANGE) as u32;
        let distance = u64::from(self.crypto.random_below(range));
        self.next_skip = self.spaces.data.next_number + 1 + distance;
    }

    #[inline]
    fn detect_lost(&mut self, now: Instant, id: SpaceId) {
        let delay = self.rtt.loss_delay();
        let (mut at, mut lost_since) = (0, Instant::NEVER);
        loop {
            let space = self.spaces.open(id);
            space.sent.loss_time = Instant::NEVER;
            let largest = space.sent.largest_acked.unwrap_or(0);
            let Some(packet) = (space.sent.packets.get_mut(at)).filter(|it| it.number < largest)
            else {
                break;
            };
            at += 1;
            if !packet.is_in_flight() {
                lost_since = Instant::NEVER;
                continue;
            }
            let (sent_at, before) = (packet.flight.at, *packet);
            if sent_at + delay > now && largest - packet.number < self.packet_threshold {
                space.sent.loss_time = sent_at + delay;
                break;
            }
            packet.fate = Fate::Lost;
            if self.on_lost(id, &before) && sent_at > self.first_sample_at {
                lost_since = lost_since.min(sent_at);
                if sent_at - lost_since > self.probe_timeout() * PERSISTENT_CONGESTION_THRESHOLD {
                    self.congestion.on_persistent_congestion();
                }
            }
        }
        self.spaces.open(id).sent.remove_settled();
        if self.path.mtu.end_ack() {
            self.congestion.set_datagram_len(self.path.mtu.current);
        }
        self.congestion.end_ack(now, &self.rtt);
    }

    /// Returns whether that is a sign of congestion (RFC 9000 §14.4).
    fn on_lost(&mut self, id: SpaceId, packet: &SentPacket) -> bool {
        if self.requeue(id, packet, Fate::Lost) {
            self.congestion.discard(&packet.flight);
            return false;
        }
        self.stats.packets_lost += 1;
        self.congestion.on_lost(&packet.flight);
        self.path.mtu.on_lost(&packet.flight);
        self.spaces.open(id).sent.remember_lost(packet);
        true
    }

    /// RFC 9000 §13.3. Returns whether it is an MTU probe.
    fn requeue(&mut self, id: SpaceId, packet: &SentPacket, fate: Fate) -> bool {
        let space = self.spaces.open(id);
        let is_requeued = packet.fate == Fate::Probed;
        if !is_requeued {
            self.streams.state.owed |= packet.control;
            self.stats.packets_retransmitted += 1;
        }
        let mut is_mtu_probe = false;
        for frame in space.sent.frames.of(packet) {
            match frame {
                SentFrame::Datagram(id) if fate == Fate::Lost => {
                    (self.streams.state.events).push_back(Event::DatagramLost(id));
                }
                SentFrame::MtuProbe if fate == Fate::Lost => {
                    self.path.mtu.on_probe_lost(packet.flight.len);
                    is_mtu_probe = true;
                }
                SentFrame::Datagram(_) | SentFrame::MtuProbe => {}
                _ if is_requeued => {}
                SentFrame::Stream {
                    id,
                    offset,
                    len,
                    fin,
                } => (self.streams).on_data_lost(id, offset..offset + u64::from(len), fin),
                SentFrame::Crypto { offset, len } => {
                    space.crypto_send.on_lost(offset..offset + u64::from(len));
                }
                SentFrame::Owed(id, frame) => self.streams.on_owed_frame_lost(id, frame),
                SentFrame::NewConnectionId(sequence) => self.local_ids.on_lost(sequence),
                SentFrame::RetireConnectionId(sequence) => self.remote_ids.on_lost(sequence),
            }
        }
        is_mtu_probe
    }

    /// For packets that cannot arrive, which says nothing about the network.
    pub(super) fn resend_all(&mut self, id: SpaceId) {
        let mut at = 0;
        while let Some(packet) = self.spaces.open(id).sent.packets.get_mut(at) {
            at += 1;
            let before = *packet;
            if before.is_in_flight() {
                packet.fate = Fate::Lost;
                self.congestion.discard(&before.flight);
                self.requeue(id, &before, Fate::Lost);
            }
        }
        let space = self.spaces.open(id);
        space.sent.remove_settled();
        space.sent.loss_time = Instant::NEVER;
        space.sent.forget_lost();
        space.received.forget_sent_acks();
    }

    /// RFC 9002 §6.4.
    pub(super) fn discard_space(
        &mut self,
        now: Instant,
        take: fn(&mut Spaces) -> Option<Box<Space>>,
    ) {
        if let Some(space) = take(&mut self.spaces) {
            for packet in space.sent.packets.iter().filter(|it| it.is_in_flight()) {
                self.congestion.discard(&packet.flight);
            }
            self.pto_count = 0;
            self.set_loss_timer(now);
        }
    }

    fn earliest(&self, time: impl Fn(SpaceId, &Space) -> Instant) -> (Instant, SpaceId) {
        let times = SpaceId::ALL.map(|id| {
            let space = self.spaces.get(id);
            (space.map_or(Instant::NEVER, |space| time(id, space)), id)
        });
        let [first, rest @ ..] = times;
        (rest.into_iter()).fold(first, |a, b| if b.0 < a.0 { b } else { a })
    }

    fn backed_off(&self, timeout: Duration) -> Duration {
        (timeout * (1 << self.pto_count.min(16))).min(MAX_PROBE_TIMEOUT.max(timeout))
    }

    /// For the end of what there is to send. Acknowledgments are not delayed for more than a packet.
    #[inline]
    fn expects_prompt_ack(&self) -> bool {
        self.pto_count == 0
            && self.spaces.data.sent.packets.len() > 1
            && self.rtt.has_sample()
            && !self.has_frames()
    }

    fn probe_time(&self, id: SpaceId, space: &Space) -> Instant {
        let timeout = match id {
            _ if !space.sent.has_in_flight() => return Instant::NEVER,
            SpaceId::Data if self.phase != Phase::Confirmed => return Instant::NEVER,
            SpaceId::Data if self.expects_prompt_ack() => {
                (self.probe_timeout()).min((self.rtt.smoothed * 2).max(MIN_TAIL_TIMEOUT))
            }
            SpaceId::Data => self.probe_timeout(),
            _ => self.rtt.probe_timeout().max(MIN_HANDSHAKE_TIMEOUT),
        };
        space.sent.last_at + self.backed_off(timeout)
    }

    /// RFC 9002 §6.2.2.1.
    #[inline]
    fn has_to_unblock_server(&self) -> bool {
        self.phase != Phase::Confirmed
            && self.side.is_client()
            && (self.setup.as_ref()).is_some_and(|it| !it.is_validated_by_peer)
    }

    /// RFC 9002 §A.8.
    #[inline]
    pub(super) fn set_loss_timer(&mut self, now: Instant) {
        let deadline = if self.phase != Phase::Confirmed {
            self.handshake_loss_deadline(now)
        } else if self.spaces.data.sent.loss_time != Instant::NEVER {
            self.spaces.data.sent.loss_time
        } else {
            self.probe_time(SpaceId::Data, &self.spaces.data)
        };
        self.timers.set(Timer::Loss, deadline);
    }

    #[cold]
    fn handshake_loss_deadline(&self, now: Instant) -> Instant {
        let (loss_time, _) = self.earliest(|_, space| space.sent.loss_time);
        if loss_time != Instant::NEVER {
            return loss_time;
        }
        if !self.path.is_validated && self.path.allowance() < MIN_DATAGRAM_LEN {
            return Instant::NEVER;
        }
        match self.earliest(|id, space| self.probe_time(id, space)).0 {
            Instant::NEVER if self.has_to_unblock_server() => {
                let timeout = self.rtt.probe_timeout().max(MIN_HANDSHAKE_TIMEOUT);
                (self.timers.get(Timer::Loss)).min(now + self.backed_off(timeout))
            }
            time => time,
        }
    }

    /// For the first datagram after a period. The path may just be back, so the peer gets another one.
    #[cold]
    pub(super) fn check_delivery(&mut self, now: Instant) {
        let (released, unacked) = self.streams.state.delivery();
        let is_behind = released < self.delivery.target;
        if is_behind && self.delivery.is_in_doubt {
            return self.time_out(now, CloseReason::IdleTimeout);
        }
        self.delivery = Delivery {
            period_end: now + DELIVERY_PERIOD,
            target: released + unacked.div_ceil(DELIVERY_PARTS),
            is_in_doubt: is_behind,
        };
    }

    /// RFC 9002 §A.9.
    pub(super) fn on_loss_timeout(&mut self, now: Instant) {
        let (loss_time, id) = self.earliest(|_, space| space.sent.loss_time);
        if loss_time != Instant::NEVER {
            self.detect_lost(now, id);
            return self.set_loss_timer(now);
        }
        match self.earliest(|id, space| self.probe_time(id, space)) {
            (Instant::NEVER, _) => {
                let handshake =
                    (self.spaces.handshake.as_mut()).filter(|it| it.write_keys.is_some());
                let space = handshake.or(self.spaces.initial.as_mut());
                crate::with(space, |it| it.probes = 1);
            }
            (_, SpaceId::Data) => self.probe(SpaceId::Data, PROBES.into()),
            _ => {
                self.probe(SpaceId::Initial, usize::MAX);
                self.probe(SpaceId::Handshake, usize::MAX);
                if self.side.is_client() {
                    self.probe(SpaceId::Data, PROBES.into());
                }
            }
        }
        self.pto_count = self.pto_count.saturating_add(1);
        if self.pto_count == BLACK_HOLE_THRESHOLD {
            self.path.mtu.fall_back();
            self.congestion.set_datagram_len(self.path.mtu.current);
        }
        // The probes may have to wait.
        let timeout = self.backed_off(self.probe_timeout());
        self.timers.set(Timer::Loss, now + timeout);
    }

    /// Sends the frames of the oldest packets again (RFC 9002 §6.2.4).
    fn probe(&mut self, id: SpaceId, mut max_packets: usize) {
        let mut at = 0;
        while max_packets > 0
            && let Some(space) = self.spaces.get_mut(id)
            && let Some(packet) = space.sent.packets.get_mut(at)
        {
            at += 1;
            space.probes = if self.path.is_validated { PROBES } else { 1 };
            let before = *packet;
            if before.fate == Fate::Unknown {
                packet.fate = Fate::Probed;
                self.requeue(id, &before, Fate::Probed);
                max_packets -= 1;
            }
        }
    }
}
