//! RFC 9000 §5.2.

use core::hash::BuildHasher;
use core::net::{IpAddr, SocketAddr};
use core::ops::Range;
use std::collections::VecDeque;
use std::rc::Rc;

use crate::batch::Batch;
use crate::cid::{ConnectionId, LocalId, ResetToken};
use crate::config::Config;
use crate::connection::handshake::Awaited;
use crate::connection::{Connection, Introduction, Remains};
use crate::crypto::{Crypto, InitialSecret, TAG_LEN, retry_tag};
use crate::deadlines::Deadlines;
use crate::error::{Layer, transport_code};
use crate::event::{CloseReason, Context, Event};
use crate::frame::{Frame, kind};
use crate::hash::{IdMap, KeyedMap, Seeded};
use crate::http3::{Fields, Header, Pool};
use crate::packet::{
    FIXED_BIT, Invariants, LONG_HEADER, LongFields, LongHeader, LongKind, MIN_DATAGRAM_LEN,
    MIN_INITIAL_ID_LEN, MIN_RESET_LEN, Opened, Sealed, Unsealed,
};
use crate::path::{AMPLIFICATION_FACTOR, Addresses, is_reserved_port, without_zone};
use crate::stream_id::{Side, StreamId};
use crate::time::{Duration, Instant};
use crate::tls;
use crate::token::{RETRY_LIFETIME, Scope, Tokens, Validation};
use crate::token_bucket::TokenBucket;
use crate::version::Version;

const MAX_REPLIES: usize = 256;
/// RFC 9000 §10.3.
const USUAL_RESET_LENS: Range<usize> = 43..62;
/// What may be a stateless reset itself gets one that is shorter than any packet for us, and that is not answered.
const MIN_STRAY_LEN: usize = 1 + LocalId::LEN + 4 + TAG_LEN;
const RECENT_RESETS: usize = 64;
const RESET_INTERVAL: Duration = Duration::from_millis(100);
/// As many of the largest ones as a run of a [`Batch`] can have.
const DATAGRAMS_PER_TURN: usize = 44;
/// While the socket sets the pace, it takes long until all have had their turn.
const DATAGRAMS_PER_SHORT_TURN: usize = 8;
/// Of the number of connections that are put in order. The others are not going to transmit soon.
const SORTED_BITS: u32 = 9;
/// The other clients wait until the established connections have been served.
const MIN_HELLOS_PER_PASS: usize = 2;
/// If there has been that much time for other things, or as much as it takes.
const TIME_PER_HELLO: Duration = Duration::from_millis(1);
const MAX_HELLOS_PER_PASS: u64 = 128;
const MAX_HELLO_TIME_PER_PASS: Duration = Duration::from_millis(20);
/// Into how many the clients are divided by their addresses.
const GROUPS: usize = 64;
const MAX_AWAITING_HELLO: usize = 1024;
const MAX_AWAITING_TURN: usize = 2048;
const MAX_AWAITING_FINISHED: usize = 8192;
const UNVALIDATED_CLIENTS: TokenBucket = TokenBucket::new(100.0, 512.0);
const VERSION_NEGOTIATIONS: TokenBucket = TokenBucket::new(100.0, 200.0);
/// If many connections end at once, there may not be room for more than one datagram each.
const REPEATED_CLOSES: TokenBucket = TokenBucket::new(100.0, 16.0);

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Handle {
    slot: u32,
    generation: u32,
}

pub(crate) struct Routes {
    pub(crate) by_id: IdMap<LocalId, u32>,
    pub(crate) by_initial_id: KeyedMap<ConnectionId, u32>,
    pub(crate) by_reset_token: KeyedMap<(SocketAddr, ResetToken), u32>,
}

/// What the connections have in common.
pub(crate) struct Shared {
    pub(crate) crypto: &'static dyn Crypto,
    pub(crate) routes: Routes,
    pub(crate) tokens: Tokens,
    pub(crate) pool: Pool,
    pub(crate) scratch: Vec<u8>,
    /// From then on, runs are made of full datagrams only.
    pub(crate) was_backed_up: bool,
    pub(crate) repeated_closes: TokenBucket,
}

impl Shared {
    pub(crate) fn new_id(&mut self, slot: u32) -> LocalId {
        loop {
            let id = LocalId(self.crypto.random());
            if self.routes.by_id.try_insert(id, slot).is_ok() {
                return id;
            }
        }
    }
}

#[derive(Default)]
struct Slot {
    connection: Option<Box<Connection>>,
    /// Of the connection that was here.
    remains: Option<Box<Remains>>,
    generation: u32,
    awaited: Option<Awaited>,
    group: u8,
    /// From [`Endpoint::unvalidated_clients`].
    has_permit: bool,
    may_have_events: bool,
    may_transmit: bool,
}

#[derive(Default)]
struct Slots {
    all: Vec<Slot>,
    /// In place of those that are out of range.
    vacant: Slot,
}

impl Slots {
    #[inline]
    fn at(&self, index: u32) -> &Slot {
        self.all.get(index as usize).unwrap_or(&self.vacant)
    }

    #[inline]
    fn at_mut(&mut self, index: u32) -> &mut Slot {
        self.all.get_mut(index as usize).unwrap_or(&mut self.vacant)
    }
}

/// The connections that wait for the same. The oldest has to make room for a new one, unless the group of the new
/// one has more than its share.
struct Queue {
    /// Also some that have left.
    handles: VecDeque<Handle>,
    len: usize,
    max_len: usize,
    group_lens: [u16; GROUPS],
}

impl Queue {
    fn new(max_len: usize) -> Self {
        Self {
            handles: VecDeque::new(),
            len: 0,
            max_len,
            group_lens: [0; GROUPS],
        }
    }

    fn is_full_for(&self, group: u8) -> bool {
        let group_len = self.group_lens.get(usize::from(group)).copied();
        self.len >= self.max_len && usize::from(group_len.unwrap_or(0)) >= self.max_len / GROUPS / 2
    }

    fn leave(&mut self, group: u8) {
        self.len -= 1;
        self.change_group_len(group, -1);
    }

    fn change_group_len(&mut self, group: u8, by: i16) -> usize {
        self.group_lens.get_mut(usize::from(group)).map_or(0, |it| {
            *it = it.wrapping_add_signed(by);
            usize::from(*it)
        })
    }

    /// Returns the one that has to leave.
    fn join(&mut self, new: Handle, group: u8, awaited: Awaited, slots: &Slots) -> Option<Handle> {
        let group_len = self.change_group_len(group, 1);
        self.len += 1;
        self.handles.push_back(new);
        if self.len > self.max_len {
            return match group_len > self.max_len / 4 {
                true => self.handles.pop_back(),
                false => self.pop(awaited, slots),
            };
        }
        if self.handles.len() > 2 * self.len {
            self.handles.retain(|it| it.awaits(awaited, slots));
        }
        None
    }

    fn pop(&mut self, awaited: Awaited, slots: &Slots) -> Option<Handle> {
        core::iter::from_fn(|| self.handles.pop_front()).find(|it| it.awaits(awaited, slots))
    }
}

impl Handle {
    fn awaits(self, awaited: Awaited, slots: &Slots) -> bool {
        let slot = slots.at(self.slot);
        (slot.generation, slot.awaited) == (self.generation, Some(awaited))
    }
}

/// A datagram that is not for any of the connections.
pub enum Unrouted<'a> {
    Incoming(Incoming<'a>),
    /// For [`Endpoint::reset`].
    Stray(&'a mut [u8]),
}

/// The first datagram of a client.
pub struct Incoming<'a> {
    client: Box<(Addresses, Introduction)>,
    packet: Opened<'a>,
    rest: &'a mut [u8],
    len: usize,
    has_permit: bool,
}

pub struct Endpoint {
    shared: Shared,
    slots: Slots,
    free: Vec<u32>,
    connections: usize,
    awaiting_hello: Queue,
    awaiting_turn: Queue,
    polled_at: Instant,
    time_for_hellos: Duration,
    /// Some of the IDs for which a stateless reset has been sent, and from when on they can have another one.
    recent_resets: [([u8; LocalId::LEN], Instant); RECENT_RESETS],
    awaiting_finished: Queue,
    /// A client gives its permit back when its address is validated. Without one it has to see to that first.
    unvalidated_clients: TokenBucket,
    last_retry_expires_at: Instant,
    version_negotiations: TokenBucket,
    /// They can be earlier than what the connections say.
    deadlines: Deadlines,
    with_events: VecDeque<u32>,
    to_transmit: VecDeque<u32>,
    is_backed_up: bool,
    /// For [`Self::favor_longest_waiting`].
    order: Vec<u64>,
    replies: VecDeque<(Addresses, Vec<u8>)>,
}

impl Endpoint {
    pub fn new(crypto: &'static dyn Crypto) -> Self {
        Self {
            shared: Shared {
                crypto,
                routes: Routes {
                    by_id: IdMap::with_hasher(Seeded(u64::from_ne_bytes(crypto.random()))),
                    by_initial_id: KeyedMap::default(),
                    by_reset_token: KeyedMap::default(),
                },
                tokens: Tokens::new(crypto),
                pool: Pool::default(),
                scratch: Vec::new(),
                was_backed_up: false,
                repeated_closes: REPEATED_CLOSES,
            },
            slots: Slots::default(),
            free: Vec::new(),
            connections: 0,
            awaiting_hello: Queue::new(MAX_AWAITING_HELLO),
            awaiting_turn: Queue::new(MAX_AWAITING_TURN),
            polled_at: Instant::default(),
            time_for_hellos: Duration::ZERO,
            recent_resets: [Default::default(); _],
            awaiting_finished: Queue::new(MAX_AWAITING_FINISHED),
            unvalidated_clients: UNVALIDATED_CLIENTS,
            last_retry_expires_at: Instant::default(),
            version_negotiations: VERSION_NEGOTIATIONS,
            deadlines: Deadlines::default(),
            with_events: VecDeque::new(),
            to_transmit: VecDeque::new(),
            is_backed_up: false,
            order: Vec::new(),
            replies: VecDeque::new(),
        }
    }

    /// For which [`Event::Closed`] is yet to come.
    pub fn connection_count(&self) -> usize {
        self.connections
    }

    pub fn handles(&self) -> Vec<Handle> {
        let slots = (0..).zip(&self.slots.all);
        (slots.filter(|(_, it)| it.connection.is_some()))
            .map(|(slot, it)| Handle {
                slot,
                generation: it.generation,
            })
            .collect()
    }

    pub fn connections(&self) -> impl Iterator<Item = &Connection> {
        (self.slots.all.iter()).filter_map(|it| it.connection.as_deref())
    }

    #[inline]
    pub fn get(&self, handle: Handle) -> Option<&Connection> {
        let slot = self.slots.at(handle.slot);
        (slot.connection.as_deref()).filter(|_| slot.generation == handle.generation)
    }

    #[inline]
    pub fn get_mut(&mut self, handle: Handle) -> Option<&mut Connection> {
        self.touch(handle).map(|it| it.0)
    }

    #[inline]
    fn touch(&mut self, handle: Handle) -> Option<(&mut Connection, &mut Shared)> {
        let slot = self.slots.at_mut(handle.slot);
        let connection =
            (slot.connection.as_deref_mut()).filter(|_| slot.generation == handle.generation)?;
        enqueue(
            &mut self.with_events,
            &mut slot.may_have_events,
            handle.slot,
        );
        enqueue(&mut self.to_transmit, &mut slot.may_transmit, handle.slot);
        Some((connection, &mut self.shared))
    }

    fn handle(&self, slot: u32) -> Handle {
        Handle {
            slot,
            generation: self.slots.at(slot).generation,
        }
    }

    fn insert(&mut self, new: impl FnOnce(u32, &mut Shared) -> Box<Connection>) -> Handle {
        let slot = self.free.pop().unwrap_or_else(|| {
            self.slots.all.push(Slot::default());
            self.slots.all.len() as u32 - 1
        });
        self.slots.at_mut(slot).connection = Some(new(slot, &mut self.shared));
        self.connections += 1;
        let handle = self.handle(slot);
        self.touch(handle);
        handle
    }

    /// `ticket` is from [`Event::Ticket`], or empty.
    pub fn connect(
        &mut self,
        now: Instant,
        config: Rc<Config>,
        addresses: Addresses,
        tls: Box<dyn tls::Session>,
        ticket: &[u8],
    ) -> Handle {
        self.insert(|slot, shared| {
            Connection::connect(now, slot, config, addresses, tls, ticket, shared)
        })
    }

    pub fn accept(
        &mut self,
        now: Instant,
        incoming: Incoming,
        config: Rc<Config>,
        tls: Box<dyn tls::Session>,
    ) -> Handle {
        let (addresses, client) = *incoming.client;
        let handle = self.insert(|slot, shared| {
            (shared.routes.by_initial_id).insert(client.destination, slot);
            let mut connection =
                Connection::accept(now, slot, config, addresses, tls, client, shared);
            connection.receive_first(now, &incoming.packet, incoming.rest, incoming.len, shared);
            connection
        });
        let group = self.group(&addresses);
        let slot = self.slots.at_mut(handle.slot);
        (slot.has_permit, slot.group) = (incoming.has_permit, group);
        self.track_handshake(now, handle.slot);
        handle
    }

    fn group(&self, client: &Addresses) -> u8 {
        let network = match client.peer.ip().to_canonical() {
            IpAddr::V4(ip) => ip.to_bits().into(),
            IpAddr::V6(ip) => ip.to_bits() >> 64,
        };
        let hash = self.shared.routes.by_initial_id.hasher().hash_one(network);
        (hash % GROUPS as u64) as u8
    }

    fn queue(&mut self, awaited: Awaited) -> (&mut Queue, &Slots) {
        match awaited {
            Awaited::Hello => (&mut self.awaiting_hello, &self.slots),
            Awaited::Turn => (&mut self.awaiting_turn, &self.slots),
            Awaited::Finished => (&mut self.awaiting_finished, &self.slots),
        }
    }

    #[cold]
    fn track_handshake(&mut self, now: Instant, index: u32) {
        let handle = self.handle(index);
        let slot = self.slots.at_mut(index);
        let (awaited, is_validated) = match &slot.connection {
            Some(it) => (it.awaited(), it.is_validated()),
            None => (None, false),
        };
        if is_validated && core::mem::take(&mut slot.has_permit) {
            self.unvalidated_clients.put_back(1);
        }
        let (before, group) = (core::mem::replace(&mut slot.awaited, awaited), slot.group);
        if before == awaited {
            return;
        }
        if let Some(before) = before {
            self.queue(before).0.leave(group);
        }
        let Some(awaited) = awaited else {
            return;
        };
        let (queue, slots) = self.queue(awaited);
        if let Some(unlucky) = queue.join(handle, group, awaited, slots)
            && let Some(connection) = self.get_mut(unlucky)
        {
            match awaited {
                Awaited::Turn => {
                    let code = transport_code::CONNECTION_REFUSED;
                    connection.abort(now, Layer::Transport, code, &[]);
                }
                _ => connection.abort_silently(),
            }
            self.track_handshake(now, unlucky.slot);
        }
    }

    /// RFC 9000 §5.2.2.
    pub fn refuse(&mut self, incoming: Incoming) {
        self.close(incoming, transport_code::CONNECTION_REFUSED);
    }

    fn close(&mut self, incoming: Incoming, code: u64) {
        let (addresses, client) = *incoming.client;
        let fields = LongFields {
            version: client.version,
            kind: LongKind::Initial,
            destination: &client.source,
            source: &client.destination,
            token: &[],
        };
        let mut out = Vec::new();
        let packet = Unsealed::long(&mut out, &fields, 0, 1);
        out.extend_from_slice(&[kind::TRANSPORT_CLOSE as u8, code as u8, 0, 0]);
        packet.end(&mut out);
        packet.seal(&mut out, Some(&client.write_keys));
        self.reply(&addresses, out);
    }

    /// RFC 9000 §10.3. Returns whether it is going to be sent.
    pub fn reset(&mut self, now: Instant, from: &Addresses, stray: &[u8]) -> bool {
        let Some(id) = (stray.get(1..).and_then(<[u8]>::first_chunk)).filter(|_| {
            stray.len() >= MIN_STRAY_LEN
                && stray.first() >= Some(&FIXED_BIT)
                && !is_reserved_port(from.peer.port())
        }) else {
            return false;
        };
        if let Some(recent) = (self.recent_resets).get_mut(usize::from(id[0]) % RECENT_RESETS) {
            if recent.0 == *id && now < recent.1 {
                return false;
            }
            *recent = (*id, now + RESET_INTERVAL);
        }
        let [first, len, rest @ ..] = self.shared.crypto.random::<{ USUAL_RESET_LENS.end }>();
        let lens = match stray.len() < USUAL_RESET_LENS.end {
            true => MIN_RESET_LEN..MIN_STRAY_LEN,
            false => USUAL_RESET_LENS,
        };
        let len = lens.start + usize::from(len) % lens.len();
        let mut out = vec![first & !LONG_HEADER | FIXED_BIT];
        out.extend(rest.iter().take(len - 1 - ResetToken::LEN));
        out.extend_from_slice(&self.shared.tokens.reset_token(id).0);
        self.reply(from, out)
    }

    fn reply(&mut self, to: &Addresses, datagram: Vec<u8>) -> bool {
        let has_room = self.replies.len() < MAX_REPLIES;
        if has_room {
            self.replies.push_back((*to, datagram));
        }
        has_room
    }

    /// `accepted` is empty if clients are not welcome. The content of `datagram` is lost.
    #[inline]
    pub fn receive<'a>(
        &mut self,
        now: Instant,
        from: &Addresses,
        datagram: &'a mut [u8],
        accepted: &[Version],
    ) -> Option<Unrouted<'a>> {
        let (&first, rest) = datagram.split_first().filter(|_| from.peer.port() != 0)?;
        let is_long = first & LONG_HEADER != 0;
        let routes = &self.shared.routes;
        let route = if is_long {
            let id = Invariants::read(datagram).map(|it| it.destination);
            (id.and_then(LocalId::new)
                .and_then(|id| routes.by_id.get(&id)))
            .or_else(|| routes.by_initial_id.get(&ConnectionId::new(id?)?))
        } else {
            routes.by_id.get(&LocalId(*rest.first_chunk()?))
        };
        let Some(&index) = route else {
            return match is_long {
                _ if self.receive_reset(from, datagram) => None,
                true => (self.admit(now, from, datagram, accepted)).map(Unrouted::Incoming),
                false => Some(Unrouted::Stray(datagram)),
            };
        };
        let slot = self.slots.at_mut(index);
        if slot.awaited == Some(Awaited::Hello) && self.awaiting_turn.is_full_for(slot.group) {
            return None;
        }
        if let Some(connection) = &mut slot.connection {
            connection.receive(now, from, datagram, &mut self.shared);
            enqueue(&mut self.with_events, &mut slot.may_have_events, index);
            enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
            if slot.awaited.is_some() {
                self.track_handshake(now, index);
            }
        } else if let Some(remains) = &mut slot.remains
            && without_zone(from.peer) == without_zone(remains.addresses.peer)
        {
            // RFC 9000 §10.2.1.
            remains.allowance += AMPLIFICATION_FACTOR * datagram.len();
            if (1..=remains.allowance).contains(&remains.farewell.len()) {
                remains.datagrams_received = remains.datagrams_received.saturating_add(1);
                if remains.datagrams_received.is_power_of_two() {
                    remains.allowance -= remains.farewell.len();
                    let farewell = remains.farewell.clone();
                    self.reply(from, farewell);
                }
            }
        }
        None
    }

    /// RFC 9000 §10.3.1. Returns false if it is something else.
    fn receive_reset(&mut self, from: &Addresses, datagram: &[u8]) -> bool {
        let token = (datagram.last_chunk()).filter(|_| datagram.len() >= MIN_RESET_LEN);
        let key = token.map(|&it| (without_zone(from.peer), ResetToken(it)));
        let Some(&slot) = key.and_then(|it| self.shared.routes.by_reset_token.get(&it)) else {
            return false;
        };
        crate::with(self.get_mut(self.handle(slot)), |it| {
            it.drain(CloseReason::StatelessReset);
        });
        true
    }

    fn admit<'a>(
        &mut self,
        now: Instant,
        from: &Addresses,
        datagram: &'a mut [u8],
        accepted: &[Version],
    ) -> Option<Incoming<'a>> {
        let len = datagram.len();
        if accepted.is_empty() || len < MIN_DATAGRAM_LEN {
            return None;
        }
        // The order in RFC 9000 §12.2 is not required.
        if let Some(early) = LongHeader::read(datagram).filter(|it| it.kind == LongKind::EarlyData)
            && let Some(rest) =
                (datagram.get(early.len..)).filter(|it| it.first() >= Some(&LONG_HEADER))
            && let Some(initial) = LongHeader::read(rest)
            && (initial.kind, &initial.destination) == (LongKind::Initial, &early.destination)
        {
            let (early, initial) = (early.len, initial.len);
            datagram.get_mut(..early + initial)?.rotate_left(early);
        }
        let invariants = Invariants::read(datagram).filter(|it| it.version != 0)?;
        if !accepted.iter().any(|it| it.number() == invariants.version) {
            let max_len = (invariants.source.len()).max(invariants.destination.len());
            if max_len <= ConnectionId::MAX_LEN
                && !is_reserved_port(from.peer.port())
                && self.version_negotiations.take(now, 1)
            {
                self.negotiate_version(from, &invariants, accepted);
            }
            return None;
        }
        let header = LongHeader::read(datagram).filter(|header| {
            header.kind == LongKind::Initial
                && header.destination.len() >= MIN_INITIAL_ID_LEN
                && invariants.first & FIXED_BIT != 0
        })?;
        // The client is going to send it again.
        if self.awaiting_turn.is_full_for(self.group(from)) {
            return None;
        }
        let scope = Scope {
            version: header.version,
            peer: from.peer,
            destination: &header.destination,
        };
        let validation = self.shared.tokens.validate(now, &scope, header.token);
        let has_permit = validation == Validation::Unknown;
        if has_permit && !self.unvalidated_clients.take(now, 1) {
            self.retry(now, from, &header);
            return None;
        }
        let header = header.without_token();
        let secret = InitialSecret::new(self.shared.crypto, header.version, &header.destination);
        let read_keys = secret.keys(Side::Client);
        let (packet, rest) = datagram.split_at_mut(header.len.min(len));
        let sealed = Sealed::new(packet, header.number_offset, &*read_keys.header, 0)?;
        let packet = sealed.open(&read_keys.payload)?;
        let mut has_hello = false;
        let is_valid = packet.is_valid_initial(|frame| {
            has_hello |= matches!(frame, Frame::Crypto { .. });
            !matches!(frame, Frame::Ack(_) | Frame::Close { .. })
        });
        if !is_valid || !has_hello {
            return None;
        }
        let client = Introduction {
            version: header.version,
            source: header.source,
            destination: header.destination,
            original_destination: match validation {
                Validation::Retry(id) => Some(id),
                _ => None,
            },
            may_be_retried: has_permit && now < self.last_retry_expires_at,
            read_keys,
            write_keys: secret.keys(Side::Server),
        };
        let incoming = Incoming {
            client: Box::new((*from, client)),
            packet,
            rest,
            len,
            has_permit,
        };
        // RFC 9000 §8.1.2.
        if validation == Validation::InvalidRetry {
            self.close(incoming, transport_code::INVALID_TOKEN);
            return None;
        }
        Some(incoming)
    }

    /// RFC 9000 §6.1.
    fn negotiate_version(&mut self, from: &Addresses, packet: &Invariants, accepted: &[Version]) {
        let [first] = self.shared.crypto.random();
        let mut out = Vec::new();
        Invariants {
            first: first | LONG_HEADER | FIXED_BIT,
            version: 0,
            destination: packet.source,
            source: packet.destination,
            rest: &[],
        }
        .write(&mut out);
        out.extend(accepted.iter().flat_map(|it| it.number().to_be_bytes()));
        self.reply(from, out);
    }

    /// RFC 9000 §8.1.2.
    fn retry(&mut self, now: Instant, from: &Addresses, header: &LongHeader) {
        self.last_retry_expires_at = now + RETRY_LIFETIME;
        let (crypto, version) = (self.shared.crypto, header.version);
        let [unused, id @ ..] = crypto.random::<{ 1 + LocalId::LEN }>();
        let scope = Scope {
            version,
            peer: from.peer,
            destination: &id,
        };
        let mut out = Vec::new();
        Invariants {
            first: LongKind::Retry.first_byte(version) | unused & 0x0f,
            version: version.number(),
            destination: &header.source,
            source: &id,
            rest: &self.shared.tokens.retry(now, &scope, &header.destination),
        }
        .write(&mut out);
        let tag = retry_tag(crypto, version, &header.destination, &out);
        out.extend_from_slice(&tag);
        self.reply(from, out);
    }

    #[inline]
    pub fn has_events(&self) -> bool {
        !self.with_events.is_empty()
    }

    /// How many connections may have events.
    #[inline]
    pub fn waiting_with_events(&self) -> usize {
        self.with_events.len()
    }

    #[inline]
    pub fn poll_event(&mut self, now: Instant) -> Option<(Handle, Context, Event)> {
        self.polled_at = now;
        loop {
            let index = *self.with_events.front()?;
            let slot = self.slots.at_mut(index);
            let handle = Handle {
                slot: index,
                generation: slot.generation,
            };
            enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
            if let Some(connection) = &mut slot.connection
                && let Some(event) = connection.poll_event(now, &mut self.shared)
            {
                return Some((handle, connection.context, event));
            }
            slot.may_have_events = false;
            self.with_events.pop_front();
            if let Some(mut connection) = slot.connection.take_if(|it| it.is_over()) {
                self.retire(now, index, &mut connection);
                return Some((handle, connection.context, Event::Closed(connection)));
            }
        }
    }

    /// The connection with the latest event lets the others go first.
    pub fn take_turns(&mut self) {
        let next = self.with_events.pop_front();
        self.with_events.extend(next);
    }

    fn retire(&mut self, now: Instant, index: u32, connection: &mut Connection) {
        let slot = self.slots.at_mut(index);
        slot.generation = slot.generation.wrapping_add(1);
        self.connections -= 1;
        let remains = Box::new(connection.remains(&mut self.shared));
        let lingers_for = slot.remains.insert(remains).lingers_for;
        self.track_handshake(now, index);
        match lingers_for.is_zero() {
            true => self.vacate(index),
            false => self.deadlines.set(index, now + lingers_for),
        }
    }

    fn vacate(&mut self, index: u32) {
        self.deadlines.set(index, Instant::NEVER);
        crate::with(self.slots.at_mut(index).remains.take(), |remains| {
            let routes = &mut self.shared.routes;
            for id in &remains.ids {
                routes.by_id.remove(id);
            }
            if let Some(id) = &remains.initial_route {
                routes.by_initial_id.remove(id);
            }
            self.free.push(index);
        });
    }

    /// No turn starts once `batch` has about `max_len` datagrams. Returns whether it has come to that. `visit` gets the
    /// connections that may have changed.
    pub fn poll_transmit(
        &mut self,
        now: Instant,
        batch: &mut Batch,
        max_len: usize,
        mut visit: impl FnMut(&Connection),
    ) -> bool {
        // So that the turns do not fall into step with the batches.
        let (mut limit, mut spread) = match self.to_transmit.len() + self.replies.len() {
            ..=1 => (max_len, None),
            _ => (max_len - max_len / 4, Some(max_len as u32 / 2)),
        };
        let crypto = self.shared.crypto;
        let mut is_full = |batch: &Batch| {
            if let Some(spread) = spread.take_if(|_| batch.len() >= limit) {
                limit += crypto.random_below(spread) as usize;
            }
            batch.len() >= limit
        };
        while !is_full(batch)
            && let Some((addresses, datagram)) = self.replies.pop_front()
        {
            let start = batch.bytes.len();
            batch.bytes.extend_from_slice(&datagram);
            batch.commit(&addresses, start, 0);
        }
        let max_turn = match self.is_backed_up {
            true => DATAGRAMS_PER_SHORT_TURN,
            false => DATAGRAMS_PER_TURN,
        };
        while !is_full(batch)
            && let Some(index) = self.to_transmit.pop_front()
        {
            let slot = self.slots.at_mut(index);
            slot.may_transmit = false;
            if let Some(connection) = &mut slot.connection {
                if connection.transmit(now, batch, max_turn, &mut self.shared) {
                    enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
                }
                if connection.has_events() {
                    enqueue(&mut self.with_events, &mut slot.may_have_events, index);
                }
                bring_forward(&mut self.deadlines, index, connection);
                visit(connection);
            }
        }
        is_full(batch)
    }

    /// Whether the socket has not taken all there was to send.
    #[inline]
    pub fn set_backed_up(&mut self, is_backed_up: bool) {
        self.is_backed_up = is_backed_up;
        self.shared.was_backed_up |= is_backed_up;
    }

    #[inline]
    pub fn wants_to_transmit(&self) -> bool {
        !self.to_transmit.is_empty() || !self.replies.is_empty()
    }

    /// How many connections may have something to send.
    #[inline]
    pub fn waiting_to_transmit(&self) -> usize {
        self.to_transmit.len()
    }

    /// For [`Self::handle_timeouts`] to answer.
    #[inline]
    fn has_waiting_clients(&self) -> bool {
        self.awaiting_turn.len > 0
    }

    /// When to call [`Self::handle_timeouts`].
    pub fn timeout(&mut self) -> Option<Instant> {
        if self.has_waiting_clients() {
            return Some(Instant::default());
        }
        for &index in &self.to_transmit {
            if let Some(connection) = &self.slots.at(index).connection {
                bring_forward(&mut self.deadlines, index, connection);
            }
        }
        while let Some((deadline, index)) = self.deadlines.first()
            && let Some(connection) = &self.slots.at(index).connection
            && connection.timeout() > deadline
        {
            self.deadlines.set(index, connection.timeout());
        }
        self.deadlines.first().map(|it| it.0)
    }

    /// `clock` tells how long it takes. Returns the time at the end.
    pub fn handle_timeouts(&mut self, now: Instant, mut clock: impl FnMut() -> Instant) -> Instant {
        while let Some((_, index)) = self.deadlines.first().filter(|it| it.0 <= now) {
            let slot = self.slots.at_mut(index);
            match (slot.connection.as_mut()).map(|it| (it.timeout(), it)) {
                Some((deadline, _)) if deadline > now => self.deadlines.set(index, deadline),
                Some((_, connection)) => {
                    // It is going to be set again, as the connection has to transmit.
                    self.deadlines.set(index, Instant::NEVER);
                    enqueue(&mut self.with_events, &mut slot.may_have_events, index);
                    enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
                    connection.handle_timeouts(now, &mut self.shared);
                }
                None => self.vacate(index),
            }
        }
        self.favor_longest_waiting(now);
        let away = now - core::mem::replace(&mut self.polled_at, now);
        self.time_for_hellos =
            (self.time_for_hellos + away).min(TIME_PER_HELLO * MAX_HELLOS_PER_PASS);
        let (mut turns, mut start) = (0..MIN_HELLOS_PER_PASS, now);
        while (turns.next().is_some()
            || self.time_for_hellos >= TIME_PER_HELLO && start < now + MAX_HELLO_TIME_PER_PASS)
            && let Some(handle) = self.awaiting_turn.pop(Awaited::Turn, &self.slots)
        {
            if let Some((connection, shared)) = self.touch(handle)
                && connection.awaited() == Some(Awaited::Turn)
            {
                connection.answer_hello(now, shared);
            }
            let end = clock();
            self.time_for_hellos = self.time_for_hellos - (end - start).max(TIME_PER_HELLO);
            start = end;
            self.track_handshake(now, handle.slot);
        }
        start
    }

    /// What is sent last is the first to find a queue full.
    fn favor_longest_waiting(&mut self, now: Instant) {
        const MAX_WAIT: u64 = (1 << (32 - SORTED_BITS)) - 1;
        let next = self.to_transmit.iter().take(1 << SORTED_BITS);
        self.order.extend((0..).zip(next).map(|(position, &index)| {
            let connection = self.slots.at(index).connection.as_ref();
            let wait = connection.map_or(0, |it| (now - it.last_sent_at()).as_micros());
            ((MAX_WAIT - wait.min(MAX_WAIT)) << SORTED_BITS | position) << 32 | u64::from(index)
        }));
        self.order.sort_unstable();
        for (index, key) in self.to_transmit.iter_mut().zip(self.order.drain(..)) {
            *index = key as u32;
        }
    }

    /// Returns false if the stream cannot be written to.
    #[inline]
    pub fn send_headers<'a>(
        &mut self,
        handle: Handle,
        id: StreamId,
        headers: impl Iterator<Item = Header<'a>>,
    ) -> bool {
        (self.touch(handle))
            .is_some_and(|(it, shared)| it.send_headers(id, headers, &mut shared.scratch))
    }

    /// To use the memory again.
    #[inline]
    pub fn recycle(&mut self, fields: Fields) {
        self.shared.pool.put(fields);
    }
}

#[inline]
fn enqueue(queue: &mut VecDeque<u32>, is_queued: &mut bool, index: u32) {
    if !core::mem::replace(is_queued, true) {
        queue.push_back(index);
    }
}

#[inline]
fn bring_forward(deadlines: &mut Deadlines, index: u32, connection: &Connection) {
    let deadline = connection.timeout();
    if deadline < deadlines.get(index) {
        deadlines.set(index, deadline);
    }
}
