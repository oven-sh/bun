//! RFC 9000 §8 and §9.

use core::net::{IpAddr, SocketAddr};

use smallvec::SmallVec;

use super::Connection;
use super::ids::RemoteId;
use super::mtu::Mtu;
use super::space::SpaceId;
use super::timers::Timer;
use crate::congestion::Rtt;
use crate::crypto::Crypto;
use crate::endpoint::Shared;
use crate::error::Result;
use crate::event::Event;
use crate::frame::kind;
use crate::packet::MIN_DATAGRAM_LEN;
use crate::path::Addresses;
use crate::time::{Duration, Instant};

const MAX_CANDIDATES: usize = 3;
const MAX_CHALLENGES: usize = 5;
pub(super) const MAX_FRAMES_LEN: usize = 2 * (1 + 8);
const FIRST_CHALLENGE_TIMEOUT: Duration = Duration::from_millis(250);
/// For a path on which no challenge can be sent, or has to be.
const UNUSED_TIMEOUT: Duration = Duration::from_secs(8);
/// RFC 9000 §8.1.
const AMPLIFICATION_FACTOR: u64 = 3;

struct Challenge {
    data: [u8; 8],
    /// RFC 9000 §8.2.1.
    is_expanded: bool,
}

pub(super) struct Path {
    pub(super) addresses: Addresses,
    pub(super) remote: RemoteId,
    pub(super) mtu: Mtu,
    pub(super) is_validated: bool,
    received: u64,
    sent: u64,
    challenges: Vec<Challenge>,
    owes_challenge: bool,
    challenge_deadline: Instant,
    pub(super) owed_response: Option<[u8; 8]>,
    /// The peer has answered a challenge.
    is_confirmed: bool,
    /// The peer has moved here.
    is_wanted: bool,
}

impl Path {
    pub(super) fn new(addresses: Addresses, remote: RemoteId, is_validated: bool) -> Self {
        Self {
            addresses,
            remote,
            mtu: Mtu::new(unmapped(addresses.peer)),
            is_validated,
            received: 0,
            sent: 0,
            challenges: Vec::new(),
            owes_challenge: false,
            challenge_deadline: Instant::NEVER,
            owed_response: None,
            is_confirmed: false,
            is_wanted: false,
        }
    }

    #[inline]
    pub(super) fn on_received(&mut self, len: usize) {
        self.received += len as u64;
    }

    #[inline]
    pub(super) fn on_sent(&mut self, len: usize) {
        self.sent += len as u64;
    }

    /// How long the next datagram can be.
    #[inline]
    pub(super) fn allowance(&self) -> usize {
        match self.is_validated {
            true => self.mtu.current.into(),
            false => (AMPLIFICATION_FACTOR * self.received)
                .saturating_sub(self.sent)
                .min(self.mtu.current.into()) as usize,
        }
    }

    #[inline]
    pub(super) fn owes_frames(&self) -> bool {
        self.owes_challenge || self.owed_response.is_some()
    }

    /// The caller has to see to it that there is room for [`MAX_FRAMES_LEN`] bytes.
    pub(super) fn write_frames(&mut self, now: Instant, crypto: &dyn Crypto, out: &mut Vec<u8>) {
        if let Some(data) = self.owed_response.take() {
            out.push(kind::PATH_RESPONSE as u8);
            out.extend_from_slice(&data);
        }
        if core::mem::take(&mut self.owes_challenge) {
            let data = crypto.random();
            out.push(kind::PATH_CHALLENGE as u8);
            out.extend_from_slice(&data);
            self.challenge_deadline = now + FIRST_CHALLENGE_TIMEOUT * (1 << self.challenges.len());
            let is_expanded = self.allowance() >= MIN_DATAGRAM_LEN;
            self.challenges.push(Challenge { data, is_expanded });
        }
    }

    fn challenge(&mut self, now: Instant) {
        self.challenges.clear();
        self.owes_challenge = true;
        self.challenge_deadline = now + UNUSED_TIMEOUT;
    }

    /// Returns whether it is for this path.
    fn on_response(&mut self, now: Instant, data: [u8; 8]) -> bool {
        let Some(challenge) = self.challenges.iter().find(|it| it.data == data) else {
            return false;
        };
        (self.is_validated, self.is_confirmed) = (true, true);
        if challenge.is_expanded {
            self.challenges = Vec::new();
            (self.owes_challenge, self.challenge_deadline) = (false, Instant::NEVER);
        } else {
            self.challenge(now);
        }
        true
    }

    /// Returns false if the validation has failed.
    fn on_timeout(&mut self, now: Instant) -> bool {
        if self.challenge_deadline > now {
            return true;
        }
        self.owes_challenge =
            !self.owes_challenge && (1..MAX_CHALLENGES).contains(&self.challenges.len());
        self.challenge_deadline = match self.owes_challenge {
            true => now + UNUSED_TIMEOUT,
            false => Instant::NEVER,
        };
        self.owes_challenge
    }
}

fn unmapped(address: SocketAddr) -> SocketAddr {
    SocketAddr::new(address.ip().to_canonical(), address.port())
}

/// RFC 9000 §21.5.3.
fn is_internal(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(ip) => {
            ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
        }
    }
}

impl Connection {
    /// Whether a packet from there is worth decrypting.
    pub(super) fn accepts_from(&self, from: &Addresses) -> bool {
        match self.side.is_server() {
            true => self.is_confirmed(),
            false => {
                from.peer == self.path.addresses.peer
                    || Some(from.peer) == self.previous_peer
                    || (self.candidates.iter()).any(|it| it.addresses.peer == from.peer)
            }
        }
    }

    /// For an authentic packet that did not come on the current path. Returns the path to answer on.
    pub(super) fn candidate(
        &mut self,
        now: Instant,
        from: &Addresses,
        destination: &[u8],
        shared: &mut Shared,
    ) -> Result<Option<&mut Path>> {
        if let Some(at) = self.candidates.iter().position(|it| it.addresses == *from) {
            return Ok(self.candidates.get_mut(at));
        }
        // RFC 9000 §9.5.
        let keeps_id = self.path.remote.id.is_empty() || destination == self.last_destination.0;
        let remote = match self.remote_ids.take_spare() {
            Some(spare) => spare,
            None if keeps_id => self.path.remote,
            None => return Ok(None),
        };
        if self.candidates.len() == MAX_CANDIDATES {
            let oldest = self.candidates.remove(0);
            self.abandon_path(&oldest, shared)?;
        }
        let is_validated = self.side.is_client() || from.peer == self.path.addresses.peer;
        let mut path = Path::new(*from, remote, is_validated);
        path.mtu.set_peer_limit(self.peer.max_udp_payload_size);
        path.challenge(now);
        path.owes_challenge = self.side.is_server();
        self.track_reset_token(&remote, shared);
        self.candidates.push(path);
        Ok(self.candidates.last_mut())
    }

    pub(super) fn track_reset_token(&self, remote: &RemoteId, shared: &mut Shared) {
        if let Some(token) = remote.reset_token {
            shared
                .routes
                .by_reset_token
                .entry(token)
                .or_insert(self.slot);
        }
    }

    pub(super) fn untrack_reset_token(&self, remote: &RemoteId, shared: &mut Shared) {
        if let Some(token) = &remote.reset_token
            && shared.routes.by_reset_token.get(token) == Some(&self.slot)
        {
            shared.routes.by_reset_token.remove(token);
        }
    }

    pub(super) fn paths(&self) -> impl Iterator<Item = &Path> {
        core::iter::once(&self.path).chain(&self.candidates)
    }

    /// For a path that is not among the others any more.
    fn abandon_path(&mut self, path: &Path, shared: &mut Shared) -> Result {
        let sequence = path.remote.sequence;
        if self.paths().any(|it| it.remote.sequence == sequence) {
            return Ok(());
        }
        self.untrack_reset_token(&path.remote, shared);
        self.remote_ids.retire(sequence)
    }

    pub(super) fn on_new_connection_id(
        &mut self,
        new: RemoteId,
        retire_prior_to: u64,
        shared: &mut Shared,
    ) -> Result {
        let mut in_use: SmallVec<[_; MAX_CANDIDATES + 1]> =
            self.paths().map(|it| it.remote).collect();
        in_use.sort_unstable_by_key(|it| it.sequence);
        in_use.dedup_by_key(|it| it.sequence);
        self.remote_ids.add(new, retire_prior_to, &in_use)?;
        let oldest = self.remote_ids.retire_prior_to;
        if self.path.remote.sequence < oldest
            && let Some(spare) = self.remote_ids.take_spare()
        {
            let old = core::mem::replace(&mut self.path.remote, spare);
            self.untrack_reset_token(&old, shared);
            self.track_reset_token(&spare, shared);
            self.remote_ids.retire(old.sequence)?;
            self.spin = false;
        }
        while let Some(at) = (self.candidates.iter()).position(|it| it.remote.sequence < oldest) {
            let path = self.candidates.remove(at);
            self.abandon_path(&path, shared)?;
        }
        Ok(())
    }

    /// For the packet with the largest number, if it is not a probing packet (RFC 9000 §9.3).
    pub(super) fn on_peer_moved(
        &mut self,
        now: Instant,
        to: &Addresses,
        shared: &mut Shared,
    ) -> Result {
        if self.side.is_client() {
            return Ok(());
        }
        let Some(at) = self.candidates.iter().position(|it| it.addresses == *to) else {
            self.candidates
                .iter_mut()
                .for_each(|it| it.is_wanted = false);
            return Ok(());
        };
        let Some(candidate) = self.candidates.get_mut(at) else {
            return Ok(());
        };
        if candidate.is_confirmed {
            return self.switch_path(at, shared);
        }
        if !core::mem::replace(&mut candidate.is_wanted, true)
            && self.path.challenges.is_empty()
            && self.path.addresses.peer != to.peer
        {
            // RFC 9000 §9.3.3.
            self.path.challenge(now);
        }
        Ok(())
    }

    pub(super) fn on_path_response(
        &mut self,
        now: Instant,
        data: [u8; 8],
        shared: &mut Shared,
    ) -> Result {
        if self.path.on_response(now, data) {
            return Ok(());
        }
        let is_client = self.side.is_client();
        match (self.candidates.iter_mut())
            .position(|it| it.on_response(now, data) && (is_client || it.is_wanted))
        {
            Some(at) => self.switch_path(at, shared),
            None => Ok(()),
        }
    }

    fn switch_path(&mut self, at: usize, shared: &mut Shared) -> Result {
        let old = core::mem::replace(&mut self.path, self.candidates.remove(at));
        self.abandon_path(&old, shared)?;
        let (from, to) = (old.addresses, self.path.addresses);
        self.previous_peer = Some(from.peer);
        self.spin = false;
        if from.local == to.local && from.peer.ip() == to.peer.ip() {
            self.path.mtu = old.mtu;
        } else {
            // RFC 9000 §9.4.
            self.resend_all(SpaceId::Data);
            (self.rtt, self.first_sample_at) = (Rtt::default(), Instant::NEVER);
            self.congestion.restart(self.path.mtu.current);
        }
        self.pto_count = 0;
        // Only the last change is of interest.
        let events = &mut self.streams.state.events;
        let pending = events.iter_mut().find_map(|event| match event {
            Event::PathChanged { to, .. } => Some(to),
            _ => None,
        });
        match pending {
            Some(pending) => *pending = to,
            None => events.push_back(Event::PathChanged {
                from,
                to,
                is_preferred: self.side.is_client(),
            }),
        }
        Ok(())
    }

    pub(super) fn on_path_timeout(&mut self, now: Instant, shared: &mut Shared) -> Result {
        self.path.on_timeout(now);
        while let Some(at) = self
            .candidates
            .iter_mut()
            .position(|it| !it.on_timeout(now))
        {
            let path = self.candidates.remove(at);
            self.abandon_path(&path, shared)?;
        }
        Ok(())
    }

    pub(super) fn set_path_timer(&mut self) {
        let deadlines = self.paths().map(|it| it.challenge_deadline);
        let earliest = deadlines.fold(Instant::NEVER, Instant::min);
        self.timers.set(Timer::Path, earliest);
    }

    /// RFC 9000 §9.6.
    pub(super) fn try_preferred_address(&mut self, now: Instant, shared: &mut Shared) -> Result {
        let Some(preferred) = &self.peer.preferred_address else {
            return Ok(());
        };
        let remote = RemoteId {
            sequence: 1,
            id: preferred.id,
            reset_token: Some(preferred.reset_token),
        };
        let Addresses {
            local,
            peer: current,
        } = self.path.addresses;
        let peer = match local {
            SocketAddr::V4(_) => preferred.ipv4.map(SocketAddr::V4),
            SocketAddr::V6(_) => preferred.ipv6.map(SocketAddr::V6),
        };
        let peer = peer.filter(|peer| {
            self.config.uses_preferred_address
                && *peer != current
                && (is_internal(current.ip()) || !is_internal(peer.ip()))
        });
        self.on_new_connection_id(remote, 0, shared)?;
        if let Some(peer) = peer
            && let Some(path) = self.candidate(now, &Addresses { local, peer }, &[], shared)?
        {
            path.challenge(now);
        }
        Ok(())
    }
}
