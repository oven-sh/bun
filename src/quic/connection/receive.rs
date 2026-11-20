//! RFC 9000 §12 and §13.1.

use super::ids::RemoteId;
use super::key_update::Generation;
use super::received::Order;
use super::space::SpaceId;
use super::streams::{Half, Load};
use super::timers::Timer;
use super::{Connection, Phase};
use crate::cid::{LocalId, ResetToken};
use crate::congestion::GRANULARITY;
use crate::crypto::InitialSecret;
use crate::endpoint::Shared;
use crate::error::{Error, Result, http3_code, transport_code};
use crate::event::CloseReason;
use crate::frame::Frame;
use crate::packet::{
    FIXED_BIT, Invariants, KEY_PHASE, LONG_HEADER, LongHeader, LongKind, MIN_DATAGRAM_LEN,
    MIN_RESET_LEN, Opened, SPIN_BIT, Sealed,
};
use crate::path::{Addresses, without_zone};
use crate::stream_id::Side;
use crate::time::{Duration, Instant};

const MAX_COALESCED: usize = 8;
const LOAD_WHILE_GOING_AWAY: u32 = 2000;
/// Some peers change keys and IDs after a number of packets, however fast they go.
const PACKETS_PER_LOAD: u64 = 500;
const MAX_UNDECRYPTABLE: usize = 32;
const MAX_UNDECRYPTABLE_LEN: usize = 48 * 1024;
const UNVALIDATED_MAX_UNDECRYPTABLE_LEN: usize = 16 * 1024;

struct Arrival<'a> {
    now: Instant,
    from: &'a Addresses,
    /// As of before the frames.
    is_current_path: bool,
    space: SpaceId,
    is_early: bool,
    destination: &'a [u8],
}

impl Connection {
    pub(crate) fn receive(
        &mut self,
        now: Instant,
        from: &Addresses,
        datagram: &mut [u8],
        shared: &mut Shared,
    ) {
        self.stats.bytes_received += datagram.len() as u64;
        let len = datagram.len();
        let current = self.path.addresses;
        // A client may not know its address, or the zone of that of the server.
        let from = &match self.side {
            Side::Server => *from,
            Side::Client if without_zone(from.peer) == without_zone(current.peer) => current,
            Side::Client => Addresses {
                local: current.local,
                peer: from.peer,
            },
        };
        if *from == current {
            self.path.on_received(len);
        } else if !self.accepts_from(from) {
            return;
        }
        let result = self.receive_packets(now, from, datagram, len, shared);
        self.after_datagram(now, from, len, result, shared);
    }

    /// For the datagram that a server got first. `rest` follows the packet.
    pub(crate) fn receive_first(
        &mut self,
        now: Instant,
        packet: &Opened,
        rest: &mut [u8],
        len: usize,
        shared: &mut Shared,
    ) {
        self.stats.bytes_received += len as u64;
        self.stats.packets_received += 1;
        self.path.on_received(len);
        let from = self.path.addresses;
        let arrival = Arrival {
            now,
            from: &from,
            is_current_path: true,
            space: SpaceId::Initial,
            is_early: false,
            destination: &[],
        };
        let result = (self.process(&arrival, packet, shared))
            .and_then(|_| self.receive_packets(now, &from, rest, len, shared));
        self.after_datagram(now, &from, len, result.map(|_| true), shared);
    }

    /// It takes longer than anything else.
    pub(crate) fn answer_hello(&mut self, now: Instant, shared: &mut Shared) {
        let (from, result) = (self.path.addresses, self.read_hello(now, shared));
        self.after_datagram(now, &from, 0, result.map(|()| true), shared);
    }

    #[inline]
    fn after_datagram(
        &mut self,
        now: Instant,
        from: &Addresses,
        len: usize,
        result: Result<bool>,
        shared: &mut Shared,
    ) {
        let result = match result {
            Ok(true) if self.setup.is_some() => {
                self.retry_undecryptable(now, shared).map(|()| true)
            }
            result => result,
        };
        let result = match self.streams.state.load {
            0 => result,
            _ => result.and_then(|is_useful| self.bear_load(now).map(|()| is_useful)),
        };
        match result {
            Err(error) => self.fail(now, error),
            Ok(_) if !self.is_receiving() => {}
            Ok(is_useful) => {
                if is_useful {
                    let mut candidates = self.candidates.iter_mut();
                    if let Some(path) = candidates.find(|it| it.addresses == *from) {
                        path.on_received(len);
                    }
                    self.restart_idle_timer(now);
                    let pause = match self.spaces.data.received.unacked_eliciting {
                        0 => self.keep_alive_period,
                        _ => self.expected_pause,
                    };
                    self.timers.set(Timer::KeepAlive, now + pause);
                    self.has_sent_since_receiving = false;
                    if self.pto_count > 1 {
                        self.on_sign_of_life();
                    }
                    self.update_unsent_target();
                    self.streams.state.start_write_round(now);
                }
                self.set_loss_timer(now);
                if is_useful && now >= self.delivery.period_end {
                    self.check_delivery(now);
                }
            }
        }
    }

    #[cold]
    fn bear_load(&mut self, now: Instant) -> Result {
        let load = core::mem::take(&mut self.streams.state.load);
        let earned = self.stats.packets_received / PACKETS_PER_LOAD;
        let new = earned.saturating_sub(core::mem::replace(&mut self.earned_load, earned));
        (self.tolerated_load).put_back(new.try_into().unwrap_or(u32::MAX));
        match (self.tolerated_load.take(now, load), &self.http3) {
            (true, _) => Ok(()),
            (false, Some(_)) if self.side.is_server() && !self.streams.table.is_going_away => {
                self.tolerated_load.put_back(LOAD_WHILE_GOING_AWAY);
                self.go_away();
                Ok(())
            }
            (false, Some(_)) => Err(Error::http3(http3_code::EXCESSIVE_LOAD, "excessive load")),
            (false, None) => Err(Error::violation("excessive load")),
        }
    }

    /// Returns whether there was a packet that is authentic and new.
    #[inline]
    fn receive_packets(
        &mut self,
        now: Instant,
        from: &Addresses,
        mut rest: &mut [u8],
        datagram_len: usize,
        shared: &mut Shared,
    ) -> Result<bool> {
        let mut is_useful = false;
        for _ in 0..MAX_COALESCED {
            let Some(&first) = rest.first().filter(|_| self.is_receiving()) else {
                break;
            };
            if first & LONG_HEADER == 0 {
                is_useful |= self.receive_short(now, from, rest, shared)?;
                break;
            }
            let is_alone = rest.len() == datagram_len;
            let Some(header) = LongHeader::read(rest) else {
                let packet = Invariants::read(rest);
                if let Some(packet) = packet.filter(|it| it.version == 0 && is_alone) {
                    self.on_version_negotiation(&packet);
                }
                break;
            };
            if header.kind == LongKind::Retry {
                if is_alone && first & FIXED_BIT != 0 {
                    self.on_retry(now, &header, rest);
                }
                break;
            }
            let has_token = !header.token.is_empty();
            let header = header.without_token();
            let packet = rest.split_off_mut(..header.len).unwrap_or_default();
            let is_acceptable = match (header.kind, self.side.is_server()) {
                (LongKind::Initial, true) => datagram_len >= MIN_DATAGRAM_LEN,
                (LongKind::Initial, false) => !has_token,
                (LongKind::EarlyData, is_server) => is_server,
                _ => true,
            };
            if is_acceptable && first & FIXED_BIT != 0 {
                is_useful |= self.receive_long(now, from, &header, packet, shared)?;
            }
        }
        Ok(is_useful)
    }

    fn receive_long(
        &mut self,
        now: Instant,
        from: &Addresses,
        header: &LongHeader,
        packet: &mut [u8],
        shared: &mut Shared,
    ) -> Result<bool> {
        self.stats.packets_received += 1;
        let (id, is_early) = match header.kind {
            LongKind::Initial => (SpaceId::Initial, false),
            LongKind::Handshake => (SpaceId::Handshake, false),
            LongKind::EarlyData | LongKind::Retry => (SpaceId::Data, true),
        };
        let source = match &self.setup {
            Some(setup) => setup.initial_source,
            None => self.peer.initial_source_connection_id,
        };
        let is_ours = self.local_ids.iter().any(|it| it.0 == *header.destination)
            || id != SpaceId::Handshake && Some(header.destination) == self.initial_route;
        // RFC 9000 §7.2 and §12.2.
        if !is_ours || source.is_some_and(|it| it != header.source) || *from != self.path.addresses
        {
            return Ok(false);
        }
        let is_other_version = header.version != self.version;
        if is_other_version && id == SpaceId::Initial {
            self.prepare_for_version(header);
        }
        let keys = match (&self.setup, self.spaces.get(id)) {
            (Some(setup), Some(_)) if is_other_version && id == SpaceId::Initial => {
                let other = setup.other_keys.as_ref();
                other.filter(|it| it.0 == header.version).map(|it| &it.1)
            }
            _ if is_other_version && self.is_version_settled() => return Ok(false),
            _ if is_early => self.early_keys.as_ref(),
            (_, space) => space.and_then(|it| it.read_keys.as_ref()),
        };
        let (Some(keys), Some(space)) = (keys, self.spaces.get(id)) else {
            let may_get_keys = match header.kind {
                LongKind::Handshake => self.phase == Phase::Handshake,
                LongKind::EarlyData => self.spaces.handshake.is_none(),
                _ => false,
            };
            if may_get_keys {
                self.postpone(packet);
            }
            return Ok(false);
        };
        let (offset, expected) = (header.number_offset, space.received.expected);
        let Some(sealed) = Sealed::new(packet, offset, &*keys.header, expected) else {
            return Ok(false);
        };
        let Some(packet) = sealed.open(&keys.payload) else {
            return self.on_forgery();
        };
        if id == SpaceId::Initial
            && !packet.is_valid_initial(
                |frame| !matches!(frame, Frame::Ack(ack) if ack.largest >= space.next_number),
            )
        {
            return Ok(false);
        }
        if is_other_version && self.side.is_client() {
            self.switch_version(header.version);
        }
        if let Some(setup) = &mut self.setup {
            if setup.initial_source.is_none() {
                setup.initial_source = Some(header.source);
                self.path.remote.id = header.source;
            }
            if id == SpaceId::Handshake && self.side.is_server() && self.spaces.initial.is_some() {
                // RFC 9000 §8.1 and RFC 9001 §4.9.1.
                self.path.is_validated = true;
                if self.timers.is_set(Timer::Handshake) {
                    let idle_timeout = Duration::from_millis(self.local.max_idle_timeout_millis);
                    let timeout = self.config.handshake_timeout.max(idle_timeout);
                    (self.timers).set(Timer::Handshake, setup.started_at + timeout);
                }
                self.discard_space(now, |it| it.initial.take());
            }
        }
        let arrival = Arrival {
            now,
            from,
            is_current_path: true,
            space: id,
            is_early,
            destination: &header.destination,
        };
        self.process(&arrival, &packet, shared)
    }

    /// RFC 9369 §4.1.
    fn prepare_for_version(&mut self, header: &LongHeader) {
        let is_possible = self.compatible_versions().any(|it| it == header.version);
        if let Some(setup) = &mut self.setup
            && is_possible
            && self.side.is_client()
            && !setup.is_version_settled
            && setup.other_keys.is_none()
        {
            let secret =
                InitialSecret::new(self.crypto, header.version, &setup.initial_destination);
            setup.other_keys = Some((header.version, secret.keys(!self.side)));
        }
    }

    #[inline]
    fn receive_short(
        &mut self,
        now: Instant,
        from: &Addresses,
        packet: &mut [u8],
        shared: &mut Shared,
    ) -> Result<bool> {
        self.stats.packets_received += 1;
        let Some((&[first, destination @ ..], _)) =
            packet.split_first_chunk::<{ 1 + LocalId::LEN }>()
        else {
            return Ok(false);
        };
        let destination = LocalId(destination);
        if first & FIXED_BIT == 0
            || Some(destination) != self.path.local_id
                && !self.local_ids.iter().any(|it| it == destination)
        {
            return Ok(false);
        }
        let space = &self.spaces.data;
        let Some(keys) = (space.read_keys.as_ref()).filter(|_| self.phase != Phase::Handshake)
        else {
            self.postpone(packet);
            return Ok(false);
        };
        let tail = packet
            .last_chunk()
            .copied()
            .filter(|_| packet.len() >= MIN_RESET_LEN);
        let expected = space.received.expected;
        let opened =
            Sealed::new(packet, 1 + LocalId::LEN, &*keys.header, expected).and_then(|it| {
                let phase = it.first & KEY_PHASE != 0;
                let generation = self.key_update.generation(phase, it.number);
                let key = match generation {
                    Generation::Current => Some(&keys.payload),
                    _ => self.key_update.other_key(generation),
                };
                Some((key.and_then(|key| it.open(key))?, generation))
            });
        let Some((packet, generation)) = opened else {
            if tail.is_some_and(|tail| self.is_reset(from, ResetToken(tail))) {
                self.drain(CloseReason::StatelessReset);
                return Ok(false);
            }
            return self.on_forgery();
        };
        let (space, version) = (&mut self.spaces.data, self.version);
        if !space.received.is_duplicate(packet.number)
            && (self.key_update).on_opened(generation, packet.number, space, version)?
        {
            if generation == Generation::Next {
                self.streams.state.add_load(Load::Heavy);
            }
            self.early_keys = None;
            (self.timers).set(Timer::KeyDiscard, now + self.settling_period());
        }
        let is_current_path = *from == self.path.addresses;
        if is_current_path && packet.number >= expected && self.uses_spin_bit {
            // RFC 9000 §17.4.
            self.spin_bit = (packet.first & SPIN_BIT != 0) == self.side.is_server();
        }
        let arrival = Arrival {
            now,
            from,
            is_current_path,
            space: SpaceId::Data,
            is_early: false,
            destination: &destination.0,
        };
        let is_new = self.process(&arrival, &packet, shared)?;
        if is_new && *from == self.path.addresses {
            self.path.local_id = Some(destination);
        }
        Ok(is_new)
    }

    /// RFC 9000 §10.3.1.
    fn is_reset(&self, from: &Addresses, token: ResetToken) -> bool {
        (self.paths()).any(|it| it.reset_key() == Some((without_zone(from.peer), token)))
    }

    /// RFC 9001 §6.6.
    fn on_forgery(&mut self) -> Result<bool> {
        self.integrity_limit = self.integrity_limit.saturating_sub(1);
        match self.integrity_limit {
            0 => Err(Error::transport(
                transport_code::AEAD_LIMIT_REACHED,
                "too many packets failed authentication",
            )),
            _ => Ok(false),
        }
    }

    fn postpone(&mut self, packet: &[u8]) {
        if let Some(setup) = &mut self.setup {
            let len: usize = setup.undecryptable.iter().map(Vec::len).sum();
            let max_len = match self.path.is_validated {
                true => MAX_UNDECRYPTABLE_LEN,
                false => UNVALIDATED_MAX_UNDECRYPTABLE_LEN,
            };
            if setup.undecryptable.len() < MAX_UNDECRYPTABLE && len + packet.len() <= max_len {
                setup.undecryptable.push(packet.to_vec());
            }
        }
    }

    #[cold]
    fn retry_undecryptable(&mut self, now: Instant, shared: &mut Shared) -> Result {
        let from = self.path.addresses;
        while let Some(setup) = &mut self.setup
            && core::mem::take(&mut setup.can_read_more)
        {
            setup.is_catching_up = true;
            for mut packet in core::mem::take(&mut setup.undecryptable) {
                self.stats.packets_received -= 1;
                self.receive_packets(now, &from, &mut packet, 0, shared)?;
            }
        }
        if self.is_confirmed() {
            self.setup = None;
        }
        crate::with(self.setup.as_mut(), |it| it.is_catching_up = false);
        Ok(())
    }

    /// Returns false for a duplicate.
    #[inline]
    fn process(&mut self, arrival: &Arrival, packet: &Opened, shared: &mut Shared) -> Result<bool> {
        let space = self.spaces.open(arrival.space);
        if packet.has_reserved_bits() {
            return Err(Error::violation("reserved bits are set"));
        }
        if space.received.is_duplicate(packet.number) {
            return Ok(false);
        }
        if packet.payload.is_empty() {
            return Err(Error::violation("packet has no frames"));
        }
        let is_largest = packet.number >= space.received.expected;
        if packet.number > space.received.expected {
            space.received.gap_at = arrival.now;
        }
        let (mut is_eliciting, mut is_probing, mut has_ack) = (false, true, false);
        let mut rest = packet.payload;
        while !rest.is_empty() && self.is_receiving() {
            let frame = Frame::read(&mut rest)?;
            let is_allowed = match arrival.space {
                SpaceId::Data => !arrival.is_early || frame.is_allowed_in_early_data(),
                _ => frame.is_allowed_in_handshake(),
            };
            if !is_allowed {
                return Err(Error::violation(
                    "frame is not allowed in this type of packet",
                ));
            }
            is_eliciting |= frame.is_ack_eliciting();
            is_probing &= frame.is_probing();
            if matches!(frame, Frame::Ack(_)) && core::mem::replace(&mut has_ack, true) {
                self.streams.state.add_load(Load::Light);
            }
            self.on_frame(arrival, frame, shared)?;
        }
        if let Some(space) = self.spaces.get_mut(arrival.space) {
            let order = (space.received).insert(arrival.now, packet.number, is_eliciting);
            if is_eliciting {
                self.plan_ack(arrival.now, arrival.space, &order);
                if arrival.space == SpaceId::Initial {
                    self.hurry_handshake();
                }
            }
        }
        if !(arrival.is_current_path && self.candidates.is_empty()) && is_largest && !is_probing {
            if *arrival.from != self.path.addresses && self.side.is_server() {
                self.candidate(arrival.now, arrival.from, arrival.destination, true, shared)?;
            }
            self.on_peer_moved(arrival.now, arrival.from, shared)?;
        }
        Ok(true)
    }

    /// RFC 9000 §13.2.1.
    #[inline]
    fn plan_ack(&mut self, now: Instant, id: SpaceId, order: &Order) {
        let follows_loss = core::mem::take(&mut self.streams.state.misses_data);
        self.ack_policy.on_packet(now, self.rtt.min, follows_loss);
        let (policy, space) = (&self.ack_policy, self.spaces.open(id));
        if id != SpaceId::Data
            || space.received.unacked_eliciting >= policy.packet_tolerance
            || *order == Order::AfterGap
            || *order == Order::Late && !policy.ignores_order
        {
            space.received.is_ack_due = true;
        } else if !self.timers.is_set(Timer::Ack) {
            // The timer may be late.
            let max_delay = policy.max_delay * 7 / 8;
            let delay = match self.rtt.has_sample() {
                true => (self.rtt.smoothed / 4).clamp(GRANULARITY, max_delay),
                false => max_delay,
            };
            self.timers.set(Timer::Ack, now + delay);
        }
    }

    #[inline]
    fn on_frame(&mut self, arrival: &Arrival, frame: Frame, shared: &mut Shared) -> Result {
        let now = arrival.now;
        match frame {
            Frame::Stream {
                id,
                offset,
                data,
                fin,
            } => return self.on_stream(id, offset, data, fin, arrival.is_early, shared),
            Frame::Ack(ack) => {
                self.on_ack(now, arrival.space, &ack)?;
                // RFC 9001 §4.1.2.
                if self.phase == Phase::Established && self.key_update.is_acked(&self.spaces.data) {
                    return self.confirm_handshake(now, shared);
                }
            }
            Frame::Padding | Frame::StreamsBlocked => {}
            Frame::DataBlocked(limit) => self.streams.state.on_data_blocked(limit),
            Frame::Ping => self.stats.pings_received += 1,
            Frame::Crypto { offset, data } => {
                return self.on_crypto(now, arrival.space, offset, data, shared);
            }
            Frame::ResetStream {
                id,
                code,
                final_size,
            } => return self.on_reset_stream(id, code, final_size),
            Frame::StopSending { id, code } => return self.on_stop_sending(id, code),
            Frame::MaxData(limit) => self.streams.on_max_data(limit),
            Frame::MaxStreamData { id, limit } => {
                if let Some((stream, state)) = self.streams.accept(id, Half::Send)? {
                    state.raise_send_limit(id, stream, limit);
                }
            }
            Frame::MaxStreams(direction, limit) => self.streams.on_max_streams(direction, limit),
            Frame::StreamDataBlocked { id, limit } => {
                if let Some((stream, state)) = self.streams.accept(id, Half::Receive)? {
                    state.on_stream_data_blocked(id, stream, limit);
                }
            }
            Frame::NewToken(token) => return self.on_new_token(token),
            Frame::NewConnectionId {
                sequence,
                retire_prior_to,
                id,
                reset_token,
            } => {
                if self.path.remote.id.is_empty() {
                    return Err(Error::violation("peer does not use connection IDs"));
                }
                self.streams.state.add_load(Load::Heavy);
                let new = RemoteId {
                    sequence,
                    id,
                    reset_token: Some(reset_token),
                };
                return self.on_new_connection_id(new, retire_prior_to, shared);
            }
            Frame::RetireConnectionId(sequence) => {
                self.streams.state.add_load(Load::Heavy);
                return (self.local_ids).on_retired(sequence, arrival.destination, shared);
            }
            Frame::PathChallenge(data) => {
                self.streams.state.add_load(Load::Light);
                let path = match *arrival.from == self.path.addresses {
                    true => Some(&mut self.path),
                    false => {
                        let is_server = self.side.is_server();
                        self.candidate(now, arrival.from, arrival.destination, is_server, shared)?
                    }
                };
                if let Some(path) = path {
                    path.owe_response(data);
                }
            }
            Frame::PathResponse(data) => {
                return self.on_path_response(now, arrival.from, data, shared);
            }
            Frame::Close {
                layer,
                code,
                reason,
            } => {
                let reason = reason.to_vec();
                let reason = CloseReason::Peer {
                    layer,
                    code,
                    reason,
                };
                self.drain(reason);
            }
            Frame::HandshakeDone if self.side.is_server() => {
                return Err(Error::violation("HANDSHAKE_DONE frame from a client"));
            }
            Frame::HandshakeDone => return self.confirm_handshake(now, shared),
            Frame::Datagram { data, frame_len } => {
                return self.on_datagram(data, frame_len, arrival.is_early);
            }
            Frame::AckFrequency { .. } if !self.config.adapts_ack_frequency => {
                return Err(Error::violation("ACK_FREQUENCY frame was not negotiated"));
            }
            Frame::AckFrequency {
                sequence,
                packet_tolerance,
                max_ack_delay_micros,
                ignore_order,
            } => {
                let delay = Duration::from_micros(max_ack_delay_micros);
                return (self.ack_policy).update(sequence, packet_tolerance, delay, ignore_order);
            }
        }
        Ok(())
    }
}
