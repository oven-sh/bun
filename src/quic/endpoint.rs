//! RFC 9000 §5.2.

use std::collections::VecDeque;
use std::rc::Rc;

use crate::batch::Batch;
use crate::cid::{ConnectionId, LocalId, ResetToken};
use crate::config::Config;
use crate::connection::{Connection, Introduction, Opened, Remains};
use crate::crypto::{Crypto, InitialSecret, retry_tag};
use crate::deadlines::Deadlines;
use crate::error::transport_code;
use crate::event::{CloseReason, Context, Event};
use crate::frame::kind;
use crate::hash::{IdMap, KeyedMap, Seeded};
use crate::http3::{Fields, Header, Pool};
use crate::packet::{
    FIXED_BIT, Invariants, LONG_HEADER, LongFields, LongHeader, LongKind, MIN_DATAGRAM_LEN,
    MIN_RESET_LEN, Sealed, Unsealed,
};
use crate::path::Addresses;
use crate::stream_id::{Side, StreamId};
use crate::time::Instant;
use crate::tls;
use crate::token::{Scope, Tokens, Validation};
use crate::version::Version;

/// With more handshakes going on, clients have to prove their address first.
const RETRY_THRESHOLD: usize = 512;
const MAX_HANDSHAKES: usize = 8192;
const MAX_REPLIES: usize = 256;
const MAX_RESET_LEN: usize = 61;
const DATAGRAMS_PER_TURN: usize = 16;
/// RFC 9000 §7.2.
const MIN_INITIAL_ID_LEN: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Handle {
    slot: u32,
    generation: u32,
}

pub(crate) struct Routes {
    pub(crate) by_id: IdMap<LocalId, u32>,
    pub(crate) by_initial_id: KeyedMap<ConnectionId, u32>,
    pub(crate) by_reset_token: KeyedMap<ResetToken, u32>,
}

/// What the connections have in common.
pub(crate) struct Shared {
    pub(crate) crypto: &'static dyn Crypto,
    pub(crate) routes: Routes,
    pub(crate) tokens: Tokens,
    pub(crate) pool: Pool,
    pub(crate) scratch: Vec<u8>,
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
enum Tenant {
    #[default]
    None,
    Live(Box<Connection>),
    Gone {
        remains: Box<Remains>,
        datagrams_received: u32,
    },
}

#[derive(Default)]
struct Slot {
    tenant: Tenant,
    generation: u32,
    is_handshaking: bool,
    may_have_events: bool,
    may_transmit: bool,
}

/// A datagram that is not for any of the connections.
pub enum Unrouted<'a> {
    Incoming(Incoming<'a>),
    /// For [`Endpoint::reset`].
    Stray(&'a [u8]),
}

/// The first datagram of a client.
pub struct Incoming<'a> {
    client: Box<(Addresses, Introduction)>,
    packet: Opened<'a>,
    rest: &'a mut [u8],
    len: usize,
}

impl Incoming<'_> {
    pub fn version(&self) -> Version {
        self.client.1.version
    }
}

pub struct Endpoint {
    shared: Shared,
    slots: Vec<Slot>,
    free: Vec<u32>,
    connections: usize,
    handshakes: usize,
    /// They can be earlier than what the connections say.
    deadlines: Deadlines,
    with_events: VecDeque<u32>,
    to_transmit: VecDeque<u32>,
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
            },
            slots: Vec::new(),
            free: Vec::new(),
            connections: 0,
            handshakes: 0,
            deadlines: Deadlines::default(),
            with_events: VecDeque::new(),
            to_transmit: VecDeque::new(),
            replies: VecDeque::new(),
        }
    }

    /// For which [`Event::Closed`] is yet to come.
    pub fn connection_count(&self) -> usize {
        self.connections
    }

    pub fn handles(&self) -> Vec<Handle> {
        let slots = (0..).zip(&self.slots);
        (slots.filter(|(_, it)| matches!(it.tenant, Tenant::Live(_))))
            .map(|(slot, it)| Handle {
                slot,
                generation: it.generation,
            })
            .collect()
    }

    #[inline]
    pub fn get(&self, handle: Handle) -> Option<&Connection> {
        match self.slots.get(handle.slot as usize)? {
            Slot {
                tenant: Tenant::Live(connection),
                generation,
                ..
            } if *generation == handle.generation => Some(connection),
            _ => None,
        }
    }

    #[inline]
    pub fn get_mut(&mut self, handle: Handle) -> Option<&mut Connection> {
        self.touch(handle).map(|it| it.0)
    }

    #[inline]
    fn touch(&mut self, handle: Handle) -> Option<(&mut Connection, &mut Shared)> {
        let slot = self.slots.get_mut(handle.slot as usize)?;
        let Tenant::Live(connection) = &mut slot.tenant else {
            return None;
        };
        if slot.generation != handle.generation {
            return None;
        }
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
            generation: self.slots.get(slot as usize).map_or(0, |it| it.generation),
        }
    }

    fn insert(&mut self, new: impl FnOnce(u32, &mut Shared) -> Box<Connection>) -> Handle {
        let slot = self.free.pop().unwrap_or_else(|| {
            self.slots.push(Slot::default());
            self.slots.len() as u32 - 1
        });
        let connection = new(slot, &mut self.shared);
        if let Some(it) = self.slots.get_mut(slot as usize) {
            it.is_handshaking = connection.side().is_server();
            self.handshakes += usize::from(it.is_handshaking);
            it.tenant = Tenant::Live(connection);
        }
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
        self.insert(|slot, shared| {
            (shared.routes.by_initial_id).insert(client.destination, slot);
            let mut connection =
                Connection::accept(now, slot, config, addresses, tls, client, shared);
            connection.receive_first(now, &incoming.packet, incoming.rest, incoming.len, shared);
            connection
        })
    }

    /// RFC 9000 §5.2.2.
    pub fn refuse(&mut self, incoming: Incoming) {
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
        let code = transport_code::CONNECTION_REFUSED as u8;
        out.extend_from_slice(&[kind::TRANSPORT_CLOSE as u8, code, 0, 0]);
        packet.end(&mut out);
        packet.seal(&mut out, &client.write_keys);
        self.reply(&addresses, out);
    }

    /// RFC 9000 §10.3. Returns whether it is going to be sent.
    pub fn reset(&mut self, from: &Addresses, stray: &[u8]) -> bool {
        let max_len = MAX_RESET_LEN.min(stray.len().saturating_sub(1));
        let (Some(range), Some(id)) = (
            max_len.checked_sub(MIN_RESET_LEN),
            stray.get(1..1 + LocalId::LEN),
        ) else {
            return false;
        };
        let [first, len, rest @ ..] = self.shared.crypto.random::<MAX_RESET_LEN>();
        let len = MIN_RESET_LEN + usize::from(len) % (range + 1);
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
        let (&first, rest) = datagram.split_first()?;
        let is_long = first & LONG_HEADER != 0;
        let routes = &self.shared.routes;
        let route = if is_long {
            let id = Invariants::read(datagram)?.destination;
            (LocalId::new(id).and_then(|id| routes.by_id.get(&id)))
                .or_else(|| routes.by_initial_id.get(&ConnectionId::new(id)?))
        } else {
            routes.by_id.get(&LocalId(*rest.first_chunk()?))
        };
        let Some(&index) = route else {
            return match is_long {
                true => (self.admit(now, from, datagram, accepted)).map(Unrouted::Incoming),
                false => (!self.receive_reset(from, datagram)).then_some(Unrouted::Stray(datagram)),
            };
        };
        let slot = self.slots.get_mut(index as usize)?;
        match &mut slot.tenant {
            Tenant::None => {}
            Tenant::Live(connection) => {
                connection.receive(now, from, datagram, &mut self.shared);
                if slot.is_handshaking && !connection.is_handshaking() {
                    slot.is_handshaking = false;
                    self.handshakes -= 1;
                }
                enqueue(&mut self.with_events, &mut slot.may_have_events, index);
                enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
            }
            Tenant::Gone {
                remains,
                datagrams_received,
            } => {
                // RFC 9000 §10.2.1.
                *datagrams_received = datagrams_received.saturating_add(1);
                if datagrams_received.is_power_of_two()
                    && *from == remains.addresses
                    && (1..=3 * datagram.len()).contains(&remains.farewell.len())
                {
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
        let Some(token) = token.copied().map(ResetToken) else {
            return false;
        };
        let Some(&slot) = self.shared.routes.by_reset_token.get(&token) else {
            return false;
        };
        let handle = self.handle(slot);
        if let Some(connection) = self.get_mut(handle).filter(|it| it.is_reset(from, token)) {
            connection.drain(CloseReason::StatelessReset);
        }
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
        let invariants = Invariants::read(datagram).filter(|it| it.version != 0)?;
        if !accepted.iter().any(|it| it.number() == invariants.version) {
            self.negotiate_version(from, &invariants, accepted);
            return None;
        }
        let header = LongHeader::read(datagram).filter(|header| {
            header.kind == LongKind::Initial
                && header.destination.len() >= MIN_INITIAL_ID_LEN
                && invariants.first & FIXED_BIT != 0
                && self.handshakes < MAX_HANDSHAKES
        })?;
        let scope = Scope {
            version: header.version,
            peer: from.peer,
            destination: &header.destination,
        };
        let original_destination = match self.shared.tokens.validate(now, &scope, header.token) {
            Validation::Retry(original_destination) => Some(original_destination),
            Validation::Unknown if self.handshakes >= RETRY_THRESHOLD => {
                self.retry(now, from, &header);
                return None;
            }
            Validation::Unknown | Validation::NewToken => None,
        };
        let header = header.without_token();
        let secret = InitialSecret::new(self.shared.crypto, header.version, &header.destination);
        let read_keys = secret.keys(Side::Client);
        let (packet, rest) = datagram.split_at_mut_checked(header.len)?;
        let sealed = Sealed::new(packet, header.number_offset, &*read_keys.header, 0)?;
        let (first, number) = (sealed.first, sealed.number);
        let payload = sealed.open(&read_keys.payload)?;
        let client = Introduction {
            version: header.version,
            source: header.source,
            destination: header.destination,
            original_destination,
            read_keys,
            write_keys: secret.keys(Side::Server),
        };
        Some(Incoming {
            client: Box::new((*from, client)),
            packet: Opened {
                first,
                number,
                payload,
            },
            rest,
            len,
        })
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

    #[inline]
    pub fn poll_event(&mut self, now: Instant) -> Option<(Handle, Context, Event)> {
        loop {
            let index = *self.with_events.front()?;
            let slot = self.slots.get_mut(index as usize)?;
            let handle = Handle {
                slot: index,
                generation: slot.generation,
            };
            let mut is_over = false;
            if let Tenant::Live(connection) = &mut slot.tenant {
                enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
                if let Some(event) = connection.poll_event(now, &mut self.shared) {
                    return Some((handle, connection.context, event));
                }
                is_over = connection.is_over();
            }
            slot.may_have_events = false;
            self.with_events.pop_front();
            if is_over && let Some(connection) = self.retire(now, index) {
                return Some((handle, connection.context, Event::Closed(connection)));
            }
        }
    }

    fn retire(&mut self, now: Instant, index: u32) -> Option<Box<Connection>> {
        let slot = self.slots.get_mut(index as usize)?;
        let Tenant::Live(mut connection) = core::mem::take(&mut slot.tenant) else {
            return None;
        };
        slot.generation = slot.generation.wrapping_add(1);
        self.connections -= 1;
        self.handshakes -= usize::from(core::mem::take(&mut slot.is_handshaking));
        let remains = Box::new(connection.remains(&mut self.shared));
        let lingers_for = remains.lingers_for;
        slot.tenant = Tenant::Gone {
            remains,
            datagrams_received: 0,
        };
        match lingers_for.is_zero() {
            true => self.vacate(index),
            false => self.deadlines.set(index, now + lingers_for),
        }
        Some(connection)
    }

    fn vacate(&mut self, index: u32) {
        let slot = self.slots.get_mut(index as usize);
        if let Some(Tenant::Gone { remains, .. }) = slot.map(|it| core::mem::take(&mut it.tenant)) {
            let routes = &mut self.shared.routes;
            for id in &remains.ids {
                routes.by_id.remove(id);
            }
            if let Some(id) = &remains.initial_route {
                routes.by_initial_id.remove(id);
            }
            self.deadlines.set(index, Instant::NEVER);
            self.free.push(index);
        }
    }

    /// Adds to `batch` until it has about `max_len` datagrams.
    pub fn poll_transmit(&mut self, now: Instant, batch: &mut Batch, max_len: usize) {
        while batch.len() < max_len
            && let Some((addresses, datagram)) = self.replies.pop_front()
        {
            let start = batch.bytes.len();
            batch.bytes.extend_from_slice(&datagram);
            batch.commit(&addresses, start);
        }
        while batch.len() < max_len
            && let Some(index) = self.to_transmit.pop_front()
            && let Some(slot) = self.slots.get_mut(index as usize)
        {
            slot.may_transmit = false;
            if let Tenant::Live(connection) = &mut slot.tenant {
                let turn = DATAGRAMS_PER_TURN.min(max_len - batch.len());
                if connection.transmit(now, batch, turn, &mut self.shared) {
                    enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
                }
                if connection.has_events() {
                    enqueue(&mut self.with_events, &mut slot.may_have_events, index);
                }
                bring_forward(&mut self.deadlines, index, connection);
            }
        }
    }

    #[inline]
    pub fn wants_to_transmit(&self) -> bool {
        !self.to_transmit.is_empty() || !self.replies.is_empty()
    }

    /// When to call [`Self::handle_timeouts`].
    pub fn timeout(&mut self) -> Option<Instant> {
        for &index in &self.to_transmit {
            if let Some(Tenant::Live(connection)) =
                self.slots.get(index as usize).map(|it| &it.tenant)
            {
                bring_forward(&mut self.deadlines, index, connection);
            }
        }
        self.deadlines.first().map(|it| it.0)
    }

    pub fn handle_timeouts(&mut self, now: Instant) {
        while let Some((_, index)) = self.deadlines.first().filter(|it| it.0 <= now) {
            let handle = self.handle(index);
            match self.get(handle).map(Connection::timeout) {
                Some(deadline) if deadline > now => self.deadlines.set(index, deadline),
                Some(_) => {
                    // It is going to be set again, as the connection has to transmit.
                    self.deadlines.set(index, Instant::NEVER);
                    if let Some((connection, shared)) = self.touch(handle) {
                        connection.handle_timeouts(now, shared);
                    }
                }
                None => self.vacate(index),
            }
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
