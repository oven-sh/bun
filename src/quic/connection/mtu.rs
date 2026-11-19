//! RFC 9000 §14.3.

use core::net::SocketAddr;

use crate::packet::MIN_DATAGRAM_LEN;

const MAX_PROBES: u8 = 3;
const LINK_MTU: u16 = 1500;
const MIN_IPV6_MTU: u16 = 1280;

pub(super) struct Mtu {
    pub(super) current: u16,
    max: u16,
    /// What did not get through.
    failed: Option<u16>,
    lost_probes: u8,
    in_flight: Option<u16>,
}

impl Mtu {
    pub(super) fn new(peer: SocketAddr) -> Self {
        let overhead = if peer.is_ipv4() { 20 + 8 } else { 40 + 8 };
        Self {
            current: MIN_IPV6_MTU - overhead,
            max: LINK_MTU - overhead,
            failed: None,
            lost_probes: 0,
            in_flight: None,
        }
    }

    pub(super) fn set_peer_limit(&mut self, limit: u64) {
        self.max = limit.min(self.max.into()) as u16;
        self.current = self.current.min(self.max);
    }

    #[inline]
    pub(super) fn next_probe(&self) -> Option<u16> {
        let ceiling = self.failed.unwrap_or(self.max);
        (self.in_flight.is_none() && ceiling - self.current > ceiling / 100)
            .then(|| self.failed.map_or(ceiling, |it| it.midpoint(self.current)))
    }

    pub(super) fn on_probe_sent(&mut self, len: u16) {
        self.in_flight = Some(len);
    }

    pub(super) fn on_probe_acked(&mut self, len: u16) {
        if self.in_flight.take_if(|it| *it == len).is_some() {
            (self.current, self.lost_probes) = (len, 0);
        }
    }

    pub(super) fn on_probe_lost(&mut self, len: u16) {
        if self.in_flight.take_if(|it| *it == len).is_some() {
            self.lost_probes += 1;
            if self.lost_probes == MAX_PROBES {
                (self.failed, self.lost_probes) = (Some(len), 0);
            }
        }
    }

    /// Nothing gets through, which may be because of the size.
    pub(super) fn fall_back(&mut self) {
        self.current = MIN_DATAGRAM_LEN as u16;
        (self.failed, self.lost_probes, self.in_flight) = (None, 0, None);
    }
}
