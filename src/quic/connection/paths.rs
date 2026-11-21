//! RFC 9000 §8 and §9.

use core::net::{IpAddr, Ipv4Addr, SocketAddr};

use smallvec::SmallVec;

use super::Connection;
use super::ids::RemoteId;
use super::mtu::Mtu;
use super::recovery::INITIAL_PACKET_THRESHOLD;
use super::sent::Control;
use super::timers::Timer;
use crate::cid::{LocalId, ResetToken};
use crate::congestion::Rtt;
use crate::crypto::Crypto;
use crate::endpoint::Shared;
use crate::error::Result;
use crate::event::Event;
use crate::frame::kind;
use crate::packet::MIN_DATAGRAM_LEN;
use crate::path::{AMPLIFICATION_FACTOR, Addresses, is_reserved_port, without_zone};
use crate::stream_id::Side;
use crate::time::{Duration, Instant};

const MAX_CANDIDATES: usize = 3;
const MAX_CHALLENGES: usize = 5;
const FIRST_CHALLENGE_TIMEOUT: Duration = Duration::from_millis(250);
/// For a path on which no challenge can be sent, or has to be, or that is not moved to.
const UNUSED_TIMEOUT: Duration = Duration::from_secs(8);

struct Challenge {
    data: [u8; 8],
    /// RFC 9000 §8.2.1.
    is_expanded: bool,
}

pub(super) struct Path {
    pub(super) addresses: Addresses,
    pub(super) remote: RemoteId,
    /// The one that the peer has used last.
    pub(super) local_id: Option<LocalId>,
    pub(super) mtu: Mtu,
    pub(super) is_validated: bool,
    received: u64,
    sent: u64,
    challenges: Vec<Challenge>,
    owes_challenge: bool,
    challenge_deadline: Instant,
    /// The latest goes first. Two paths of the peer can be one for us.
    owed_responses: [Option<[u8; 8]>; 2],
    /// We are the ones who want to move here.
    is_preferred: bool,
    /// The peer has answered a challenge.
    is_confirmed: bool,
    /// The peer has moved here.
    pub(super) is_wanted: bool,
}

impl Path {
    pub(super) fn new(addresses: Addresses, remote: RemoteId, is_validated: bool) -> Self {
        Self {
            addresses,
            remote,
            local_id: None,
            mtu: Mtu::new(unmapped(addresses.peer)),
            is_validated,
            received: 0,
            sent: 0,
            challenges: Vec::new(),
            owes_challenge: false,
            challenge_deadline: Instant::NEVER,
            owed_responses: [None; 2],
            is_preferred: false,
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
            false => (AMPLIFICATION_FACTOR as u64 * self.received)
                .saturating_sub(self.sent)
                .min(self.mtu.current.into()) as usize,
        }
    }

    #[inline]
    pub(super) fn owes_frames(&self) -> bool {
        self.owes_challenge || self.owed_responses[0].is_some()
    }

    pub(super) fn owe_response(&mut self, data: [u8; 8]) {
        self.owed_responses = [Some(data), self.owed_responses[0]];
    }

    /// How long the datagram with these frames can be.
    pub(super) fn probe_len(&self) -> usize {
        match self.is_preferred && self.owes_challenge {
            true => MIN_DATAGRAM_LEN,
            false => self.allowance().min(MIN_DATAGRAM_LEN),
        }
    }

    /// Returns whether there is a response among them.
    pub(super) fn write_frames(
        &mut self,
        now: Instant,
        crypto: &dyn Crypto,
        out: &mut Vec<u8>,
    ) -> bool {
        let is_expanded = self.probe_len() == MIN_DATAGRAM_LEN;
        let responses = core::mem::take(&mut self.owed_responses);
        for data in responses.iter().rev().flatten() {
            out.push(kind::PATH_RESPONSE as u8);
            out.extend_from_slice(data);
        }
        if core::mem::take(&mut self.owes_challenge) {
            let data = crypto.random();
            out.push(kind::PATH_CHALLENGE as u8);
            out.extend_from_slice(&data);
            self.challenge_deadline = now + FIRST_CHALLENGE_TIMEOUT * (1 << self.challenges.len());
            self.challenges.push(Challenge { data, is_expanded });
        }
        responses[0].is_some()
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
            (self.owes_challenge, self.challenge_deadline) = (false, now + UNUSED_TIMEOUT);
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
        // It starts over with the next packet.
        let is_kept = self.owes_challenge || core::mem::take(&mut self.is_wanted);
        if !self.owes_challenge {
            self.challenges = Vec::new();
        }
        self.challenge_deadline = match is_kept {
            true => now + UNUSED_TIMEOUT,
            false => Instant::NEVER,
        };
        is_kept
    }

    pub(super) fn reset_key(&self) -> Option<(SocketAddr, ResetToken)> {
        Some((without_zone(self.addresses.peer), self.remote.reset_token?))
    }

    fn is_challenged(&self) -> bool {
        self.owes_challenge || !self.challenges.is_empty()
    }
}

fn unmapped(address: SocketAddr) -> SocketAddr {
    SocketAddr::new(address.ip().to_canonical(), address.port())
}

/// From where an address can be reached.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Reach {
    Nowhere,
    Host,
    Link,
    Site,
    Internet,
}

impl Reach {
    fn of(ip: IpAddr) -> Self {
        match ip.to_canonical() {
            IpAddr::V4(ip) => match ip.octets() {
                [0 | 224.., ..] => Self::Nowhere,
                [127, ..] => Self::Host,
                [169, 254, ..] => Self::Link,
                [10, ..] | [100, 64..128, ..] | [172, 16..32, ..] | [192, 168, ..] => Self::Site,
                _ => Self::Internet,
            },
            IpAddr::V6(ip) => match ip.segments() {
                [0, 0, 0, 0, 0, 0, 0, 1] => Self::Host,
                [0 | 0xff00.., ..] => Self::Nowhere,
                [0x64, 0xff9b, 0, 0, 0, 0, ..] => {
                    Self::of(Ipv4Addr::from_bits(ip.to_bits() as u32).into())
                }
                [0xfe80..0xfec0, ..] => Self::Link,
                [0xfc00..0xfe00 | 0xfec0.., ..] => Self::Site,
                _ => Self::Internet,
            },
        }
    }
}

/// RFC 9000 §21.5.6.
fn may_move(from: SocketAddr, to: SocketAddr) -> bool {
    Reach::of(to.ip()) >= Reach::of(from.ip()).max(Reach::Host) && !is_reserved_port(to.port())
}

impl Connection {
    /// Whether a packet from there is worth decrypting.
    pub(super) fn accepts_from(&self, from: &Addresses) -> bool {
        match self.side.is_server() {
            true => self.is_confirmed(),
            false => (self.candidates.iter().map(|it| it.addresses.peer))
                .chain(self.previous_peer)
                .any(|it| it == from.peer),
        }
    }

    /// For an authentic packet that did not come on the current path. Returns the path to answer on.
    pub(super) fn candidate(
        &mut self,
        now: Instant,
        from: &Addresses,
        destination: &[u8],
        validates: bool,
        shared: &mut Shared,
    ) -> Result<Option<&mut Path>> {
        let local_id = LocalId::new(destination);
        if let Some(path) = (self.candidates.iter_mut()).find(|it| it.addresses == *from) {
            path.local_id = local_id;
            return Ok(Some(path));
        }
        // RFC 9000 §9.5.
        let is_continued = |path: &&Path| {
            path.remote.id.is_empty()
                || (path.local_id, path.addresses.local) == (local_id, from.local)
        };
        let kept = self.paths().find(is_continued).map(|it| it.remote);
        let remote = match kept {
            _ if !may_move(self.first_peer, from.peer) || !self.new_paths.take(now, 1) => None,
            None => self.remote_ids.take_spare(),
            Some(_) => kept,
        };
        let Some(remote) = remote else {
            return Ok(None);
        };
        let is_preferred = validates && self.side.is_client();
        let is_validated = match self.side {
            Side::Client => !is_preferred,
            Side::Server => from.peer == self.path.addresses.peer,
        };
        let mut path = Path::new(*from, remote, is_validated);
        (path.local_id, path.is_preferred) = (local_id, is_preferred);
        path.mtu.set_peer_limit(self.peer.max_udp_payload_size);
        path.challenge(now);
        path.owes_challenge = validates;
        self.track_reset_token(&path, shared);
        let replaced = (self.candidates.len() == MAX_CANDIDATES).then(|| {
            let idle = (self.candidates.iter()).position(|it| !it.is_wanted && !it.is_confirmed);
            self.candidates.remove(idle.unwrap_or(0))
        });
        self.candidates.push(path);
        replaced.map_or(Ok(()), |it| self.abandon_path(&it, shared))?;
        Ok(self.candidates.last_mut())
    }

    pub(super) fn track_reset_token(&self, path: &Path, shared: &mut Shared) {
        if let Some(key) = path.reset_key() {
            shared.routes.by_reset_token.entry(key).or_insert(self.slot);
        }
    }

    pub(super) fn untrack_reset_token(&self, path: &Path, shared: &mut Shared) {
        if let Some(key) = &path.reset_key()
            && shared.routes.by_reset_token.get(key) == Some(&self.slot)
        {
            shared.routes.by_reset_token.remove(key);
        }
    }

    pub(super) fn paths(&self) -> impl Iterator<Item = &Path> {
        core::iter::once(&self.path).chain(&self.candidates)
    }

    /// For a path that is not among the others any more.
    fn abandon_path(&mut self, path: &Path, shared: &mut Shared) -> Result {
        if !self.paths().any(|it| it.reset_key() == path.reset_key()) {
            self.untrack_reset_token(path, shared);
        }
        let sequence = path.remote.sequence;
        if self.paths().any(|it| it.remote.sequence == sequence) {
            return Ok(());
        }
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
            self.untrack_reset_token(&self.path, shared);
            let old = core::mem::replace(&mut self.path.remote, spare);
            self.track_reset_token(&self.path, shared);
            self.remote_ids.retire(old.sequence)?;
            self.spin_bit = false;
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
        for other in self.candidates.iter_mut().filter(|it| it.addresses != *to) {
            other.is_wanted = false;
        }
        let mut candidates = self.candidates.iter_mut().enumerate();
        let Some((at, candidate)) = candidates.find(|it| it.1.addresses == *to) else {
            return Ok(());
        };
        if candidate.is_confirmed {
            return self.switch_path(now, at, shared);
        }
        if !core::mem::replace(&mut candidate.is_wanted, true) {
            if !candidate.is_challenged() {
                candidate.challenge(now);
            }
            // RFC 9000 §9.3.3.
            if !self.path.is_challenged() && self.path.addresses.peer != to.peer {
                self.path.challenge(now);
            }
        }
        Ok(())
    }

    /// There is no point in sending more on the current path.
    #[inline]
    pub(super) fn has_peer_moved(&self) -> bool {
        self.candidates.iter().any(|it| it.is_wanted)
    }

    pub(super) fn on_path_response(
        &mut self,
        now: Instant,
        from: &Addresses,
        data: [u8; 8],
        shared: &mut Shared,
    ) -> Result {
        if self.path.on_response(now, data) {
            return Ok(());
        }
        let is_client = self.side.is_client();
        match (self.candidates.iter_mut()).position(|it| {
            it.on_response(now, data) && (is_client || it.is_wanted && it.addresses == *from)
        }) {
            Some(at) => self.switch_path(now, at, shared),
            None => Ok(()),
        }
    }

    fn switch_path(&mut self, now: Instant, at: usize, shared: &mut Shared) -> Result {
        let new = self.candidates.remove(at);
        let (from, to) = (self.path.addresses, new.addresses);
        let is_other_port = from.local == to.local && from.peer.ip() == to.peer.ip();
        if self.side.is_server() || !is_other_port {
            self.lose_all(now);
        }
        let old = core::mem::replace(&mut self.path, new);
        self.abandon_path(&old, shared)?;
        self.path.is_wanted = false;
        self.previous_peer = Some(from.peer);
        self.spin_bit = false;
        if is_other_port {
            self.path.mtu = old.mtu;
        } else {
            // RFC 9000 §9.4.
            (self.rtt, self.first_sample_at) = (Rtt::default(), Instant::NEVER);
            self.congestion.restart(self.path.mtu.current);
            self.packet_threshold = INITIAL_PACKET_THRESHOLD;
            if let Some(controller) = &mut self.ack_controller {
                controller.restart();
                self.streams.state.owed |= Control::ACK_FREQUENCY;
            }
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
        let peer = peer.filter(|&peer| self.config.uses_preferred_address && peer != current);
        self.on_new_connection_id(remote, 0, shared)?;
        peer.map_or(Ok(()), |peer| {
            (self.candidate(now, &Addresses { local, peer }, &[], true, shared)).map(drop)
        })
    }
}
