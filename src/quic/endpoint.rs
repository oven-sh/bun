//! RFC 9000 §5.2.

use core::ops::Range;
use std::collections::VecDeque;
use std::rc::Rc;

use crate::batch::Batch;
use crate::cid::{ConnectionId, LocalId, ResetToken};
use crate::config::Config;
use crate::connection::handshake::Awaited;
use crate::connection::{Connection, Introduction, Opened, Remains};
use crate::crypto::{Crypto, InitialSecret, retry_tag};
use crate::deadlines::Deadlines;
use crate::error::transport_code;
use crate::event::{CloseReason, Context, Event};
use crate::frame::{Frame, kind};
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
use crate::token_bucket::TokenBucket;
use crate::version::Version;

const MAX_REPLIES: usize = 256;
/// RFC 9000 §10.3.
const USUAL_RESET_LENS: Range<usize> = 43..62;
const DATAGRAMS_PER_TURN: usize = 16;
/// RFC 9000 §7.2.
const MIN_INITIAL_ID_LEN: usize = 8;

#[repr(C)]
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
    awaited: Option<Awaited>,
    /// From [`Endpoint::unvalidated_clients`].
    has_token: bool,
    may_have_events: bool,
    may_transmit: bool,
}

/// The connections that wait for the same. The oldest has to make room for a new one.
struct Queue {
    /// Also some that have left.
    handles: VecDeque<Handle>,
    len: usize,
    max_len: usize,
}

impl Queue {
    fn new(max_len: usize) -> Self {
        Self {
            handles: VecDeque::new(),
            len: 0,
            max_len,
        }
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
    has_token: bool,
}

pub struct Endpoint {
    shared: Shared,
    slots: Vec<Slot>,
    free: Vec<u32>,
    connections: usize,
    awaiting_hello: Queue,
    awaiting_finished: Queue,
    /// A client gives its token back when its address is validated. Without one it has to see to that first.
    unvalidated_clients: TokenBucket,
    version_negotiations: TokenBucket,
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
            awaiting_hello: Queue::new(1024),
            awaiting_finished: Queue::new(8192),
            unvalidated_clients: TokenBucket::new(100.0, 512.0),
            version_negotiations: TokenBucket::new(100.0, 200.0),
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
        let handle = self.insert(|slot, shared| {
            (shared.routes.by_initial_id).insert(client.destination, slot);
            let mut connection =
                Connection::accept(now, slot, config, addresses, tls, client, shared);
            connection.receive_first(now, &incoming.packet, incoming.rest, incoming.len, shared);
            connection
        });
        if let Some(slot) = self.slots.get_mut(handle.slot as usize) {
            slot.has_token = incoming.has_token;
        }
        self.track_handshake(handle.slot);
        handle
    }

    fn queue(&mut self, awaited: Awaited) -> (&mut Queue, &mut [Slot]) {
        match awaited {
            Awaited::Hello => (&mut self.awaiting_hello, &mut self.slots),
            Awaited::Finished => (&mut self.awaiting_finished, &mut self.slots),
        }
    }

    #[cold]
    fn track_handshake(&mut self, index: u32) {
        let handle = self.handle(index);
        let Some(slot) = self.slots.get_mut(index as usize) else {
            return;
        };
        let (awaited, is_validated) = match &slot.tenant {
            Tenant::Live(it) if !it.is_over() => (it.awaited(), it.is_validated()),
            _ => (None, false),
        };
        if is_validated && core::mem::take(&mut slot.has_token) {
            self.unvalidated_clients.put_back();
        }
        let before = core::mem::replace(&mut slot.awaited, awaited);
        if before == awaited {
            return;
        }
        if let Some(before) = before {
            self.queue(before).0.len -= 1;
        }
        let Some(awaited) = awaited else {
            return;
        };
        let (queue, slots) = self.queue(awaited);
        let is_waiting = |it: &Handle| {
            (slots.get(it.slot as usize)).is_some_and(|slot| {
                (slot.generation, slot.awaited) == (it.generation, Some(awaited))
            })
        };
        queue.len += 1;
        queue.handles.push_back(handle);
        if queue.handles.len() > 2 * queue.len {
            queue.handles.retain(is_waiting);
        }
        if queue.len > queue.max_len
            && let Some(oldest) = core::iter::from_fn(|| queue.handles.pop_front()).find(is_waiting)
        {
            self.get_mut(oldest).map(Connection::abort_silently);
            self.track_handshake(oldest.slot);
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
    pub fn reset(&mut self, from: &Addresses, stray: &[u8]) -> bool {
        let Some(id) = (stray.get(1..1 + LocalId::LEN))
            .filter(|_| stray.len() > MIN_RESET_LEN && stray.first() >= Some(&FIXED_BIT))
        else {
            return false;
        };
        let [first, len, rest @ ..] = self.shared.crypto.random::<{ USUAL_RESET_LENS.end }>();
        let len = USUAL_RESET_LENS.start + usize::from(len) % USUAL_RESET_LENS.len();
        let len = len.min(stray.len() - 1);
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
            let id = Invariants::read(datagram)?.destination;
            (LocalId::new(id).and_then(|id| routes.by_id.get(&id)))
                .or_else(|| routes.by_initial_id.get(&ConnectionId::new(id)?))
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
        let slot = self.slots.get_mut(index as usize)?;
        match &mut slot.tenant {
            Tenant::None => {}
            Tenant::Live(connection) => {
                connection.receive(now, from, datagram, &mut self.shared);
                enqueue(&mut self.with_events, &mut slot.may_have_events, index);
                enqueue(&mut self.to_transmit, &mut slot.may_transmit, index);
                if slot.awaited.is_some() {
                    self.track_handshake(index);
                }
            }
            Tenant::Gone { remains, .. } if *from != remains.addresses => {}
            Tenant::Gone {
                remains,
                datagrams_received,
            } => {
                // RFC 9000 §10.2.1.
                *datagrams_received = datagrams_received.saturating_add(1);
                if datagrams_received.is_power_of_two()
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
            if self.version_negotiations.take(now, 1) {
                self.negotiate_version(from, &invariants, accepted);
            }
            return None;
        }
        let header = LongHeader::read(datagram).filter(|header| {
            header.kind == LongKind::Initial
                && header.destination.len() >= MIN_INITIAL_ID_LEN
                && invariants.first & FIXED_BIT != 0
        })?;
        let scope = Scope {
            version: header.version,
            peer: from.peer,
            destination: &header.destination,
        };
        let validation = self.shared.tokens.validate(now, &scope, header.token);
        let has_token = validation == Validation::Unknown;
        if has_token && !self.unvalidated_clients.take(now, 1) {
            self.retry(now, from, &header);
            return None;
        }
        let header = header.without_token();
        let secret = InitialSecret::new(self.shared.crypto, header.version, &header.destination);
        let read_keys = secret.keys(Side::Client);
        let (packet, rest) = datagram.split_at_mut_checked(header.len)?;
        let sealed = Sealed::new(packet, header.number_offset, &*read_keys.header, 0)?;
        let (first, number) = (sealed.first, sealed.number);
        let packet = Opened {
            first,
            number,
            payload: sealed.open(&read_keys.payload)?,
        };
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
            read_keys,
            write_keys: secret.keys(Side::Server),
        };
        let incoming = Incoming {
            client: Box::new((*from, client)),
            packet,
            rest,
            len,
            has_token,
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
        let remains = Box::new(connection.remains(&mut self.shared));
        let lingers_for = remains.lingers_for;
        slot.tenant = Tenant::Gone {
            remains,
            datagrams_received: 0,
        };
        self.track_handshake(index);
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
