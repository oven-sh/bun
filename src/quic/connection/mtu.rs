//! RFC 9000 §14.3.

use core::net::SocketAddr;
use core::ops::Range;

use crate::congestion::Flight;
use crate::packet::MIN_DATAGRAM_LEN;
use crate::time::{Duration, Instant};

const MAX_LOST_PROBES: u8 = 3;
/// A part of the packets may take a narrower way.
const NEEDED_PROBES: u8 = 2;
const MAX_NEEDED_PROBES: u8 = 8;
/// If only some probes get through, the search rests, for twice as long each time, and needs more of them.
const REST: Duration = Duration::from_secs(1);
const MAX_RESTS: u8 = 6;
const PROBES_PER_REST: u8 = 4;
/// The loss of a probe says little if one of the next packets is lost too, or if it arrives after all.
const NEXT_PACKETS: u64 = 2;
const MAX_EXPLAINED_LOSSES: u8 = 8;
/// After how many times in a row that only small packets got through the size is suspected.
const MAX_SUSPICIONS: u8 = 3;
const LINK_MTU: u16 = 1500;

pub(super) struct Mtu {
    pub(super) current: u16,
    max: u16,
    /// What did not get through.
    failed: Option<u16>,
    acked_probes: u8,
    lost_probes: u8,
    unexplained_loss: Option<u64>,
    in_flight: Option<u64>,
    rests: u8,
    resumes_at: Instant,
    /// When the latest large packet that got through was sent.
    last_success: Instant,
    is_suspect: bool,
    suspicions: u8,
}

impl Mtu {
    pub(super) fn new(peer: SocketAddr) -> Self {
        let overhead = if peer.is_ipv4() { 20 + 8 } else { 40 + 8 };
        Self {
            current: MIN_DATAGRAM_LEN as u16,
            max: LINK_MTU - overhead,
            failed: None,
            acked_probes: 0,
            lost_probes: 0,
            unexplained_loss: None,
            in_flight: None,
            rests: 0,
            resumes_at: Instant::default(),
            last_success: Instant::default(),
            is_suspect: false,
            suspicions: 0,
        }
    }

    pub(super) fn set_peer_limit(&mut self, limit: u64) {
        self.max = limit.min(self.max.into()) as u16;
    }

    #[inline]
    pub(super) fn next_probe(&self, now: Instant) -> Option<u16> {
        let ceiling = self.failed.unwrap_or(self.max);
        (ceiling - self.current > ceiling / 100
            && self.in_flight.is_none()
            && (now >= self.resumes_at || !self.is_in_doubt()))
        .then(|| self.failed.map_or(ceiling, |it| it.midpoint(self.current)))
    }

    fn is_in_doubt(&self) -> bool {
        self.acked_probes > 0
            && (self.unexplained_loss.is_some() || self.lost_probes == MAX_EXPLAINED_LOSSES)
    }

    pub(super) fn on_probe_sent(&mut self, now: Instant, number: u64) {
        if self.is_in_doubt() {
            self.end_round();
        }
        self.in_flight = Some(number);
        self.resumes_at = now + REST * (1 << self.rests);
    }

    pub(super) fn on_probe_acked(&mut self, number: u64, len: u16) {
        if self.in_flight.take_if(|it| *it == number).is_some() {
            self.acked_probes += 1;
            let needed = NEEDED_PROBES + PROBES_PER_REST * self.rests;
            if self.acked_probes == needed.min(MAX_NEEDED_PROBES) {
                self.current = len;
                self.rests = self.failed.map_or(0, |_| self.rests.saturating_sub(1));
                self.end_round();
            }
        }
    }

    pub(super) fn on_probe_lost(&mut self, number: u64, len: u16) {
        if self.in_flight.take_if(|it| *it == number).is_some() {
            self.lost_probes += 1;
            self.unexplained_loss.get_or_insert(number);
            if self.lost_probes == MAX_LOST_PROBES && self.acked_probes == 0 {
                self.failed = Some(len);
                self.end_round();
            }
        }
    }

    #[inline]
    pub(super) fn find_late_probe(&mut self, mut acked: impl Iterator<Item = Range<u64>>) {
        (self.unexplained_loss).take_if(|it| acked.any(|range| range.contains(it)));
    }

    pub(super) fn end_round(&mut self) {
        self.rests = MAX_RESTS.min(self.rests + u8::from(self.is_in_doubt()));
        (self.acked_probes, self.lost_probes) = (0, 0);
        (self.in_flight, self.unexplained_loss) = (None, None);
    }

    #[inline]
    pub(super) fn on_acked(&mut self, packet: &Flight) {
        if usize::from(packet.len) > MIN_DATAGRAM_LEN && packet.at > self.last_success {
            (self.last_success, self.suspicions) = (packet.at, 0);
        }
    }

    pub(super) fn on_lost(&mut self, number: u64, packet: &Flight) {
        (self.unexplained_loss).take_if(|it| number <= *it + NEXT_PACKETS);
        self.is_suspect |=
            usize::from(packet.len) > MIN_DATAGRAM_LEN && packet.at > self.last_success;
    }

    /// Returns whether the size changed.
    #[inline]
    pub(super) fn end_ack(&mut self) -> bool {
        self.suspicions += u8::from(core::mem::take(&mut self.is_suspect));
        let is_too_large = self.suspicions == MAX_SUSPICIONS;
        if is_too_large {
            self.fall_back();
        }
        is_too_large
    }

    /// Nothing gets through, which may be because of the size.
    pub(super) fn fall_back(&mut self) {
        (self.current, self.failed) = (MIN_DATAGRAM_LEN as u16, None);
        self.suspicions = 0;
        self.end_round();
    }
}
