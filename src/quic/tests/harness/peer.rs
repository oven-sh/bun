use std::collections::{BTreeMap, VecDeque};
use std::net::SocketAddr;
use std::rc::Rc;

use bun_quic::http3::{Header, Section};
use bun_quic::{
    Addresses, Batch, CloseReason, Config, Connection, Direction, Endpoint, Event, Handle, Instant,
    Layer, Side, StreamEvent, StreamId, Unrouted,
};

use super::wire::{self, show};
use super::{crypto, tls};

#[derive(Default)]
pub(crate) struct Stream {
    pub(crate) received: Vec<u8>,
    pub(crate) is_read_to_end: bool,
    pub(crate) is_closed: bool,
    unsent: VecDeque<u8>,
    /// Of the current piece.
    rest: usize,
    finishes: bool,
}

/// An endpoint and its application.
pub(crate) struct Peer {
    pub(crate) endpoint: Endpoint,
    pub(crate) crypto: &'static crypto::Toy,
    pub(crate) side: Side,
    pub(crate) address: SocketAddr,
    pub(crate) config: Config,
    pub(crate) tls: tls::Options,
    /// Of the latest connection.
    pub(crate) handle: Option<Handle>,
    pub(crate) log: Vec<String>,
    pub(crate) streams: BTreeMap<u64, Stream>,
    pub(crate) tickets: Vec<Vec<u8>>,
    pub(crate) closed: Option<Box<Connection>>,
    pub(crate) polls: bool,
    pub(crate) echoes: bool,
    pub(crate) refuses: bool,
    pub(crate) resets: bool,
    /// How many bytes it offers at a time.
    pub(crate) piece_len: Option<usize>,
    turns: u32,
}

impl Peer {
    pub(crate) fn new(side: Side, crypto: &'static crypto::Toy, config: Config) -> Self {
        Self {
            endpoint: Endpoint::new(crypto),
            crypto,
            side,
            address: super::address(side),
            config,
            tls: tls::Options::default(),
            handle: None,
            log: Vec::new(),
            streams: BTreeMap::new(),
            tickets: Vec::new(),
            closed: None,
            polls: true,
            echoes: false,
            refuses: false,
            resets: false,
            piece_len: None,
            turns: 0,
        }
    }

    pub(crate) fn connect(&mut self, now: Instant, peer: SocketAddr, random: u8, ticket: &[u8]) {
        let local = self.address;
        let (config, addresses) = (Rc::new(self.config.clone()), Addresses { local, peer });
        let tls = tls::Toy::new(Side::Client, random, self.tls);
        self.handle = Some(self.endpoint.connect(now, config, addresses, tls, ticket));
        (self.closed, self.streams) = (None, BTreeMap::new());
    }

    #[track_caller]
    pub(crate) fn connection(&mut self) -> &mut Connection {
        self.endpoint.get_mut(self.handle.unwrap()).unwrap()
    }

    #[track_caller]
    pub(crate) fn open(&mut self, direction: Direction) -> u64 {
        let id = self.connection().open(direction, std::ptr::null_mut());
        id.unwrap().0
    }

    /// Writes as flow control allows.
    pub(crate) fn send(&mut self, id: u64, data: &[u8], finishes: bool) {
        let stream = self.streams.entry(id).or_default();
        stream.unsent.extend(data);
        stream.finishes = finishes;
        self.write(self.handle.unwrap(), id);
    }

    fn write(&mut self, handle: Handle, id: u64) {
        let stream = self.streams.entry(id).or_default();
        let connection = self.endpoint.get_mut(handle).unwrap();
        loop {
            let unsent = stream.unsent.make_contiguous();
            if stream.rest == 0 || self.piece_len.is_none() {
                stream.rest = unsent.len().min(self.piece_len.unwrap_or(usize::MAX));
            }
            let len = connection.write(StreamId(id), &unsent[..stream.rest]);
            stream.unsent.drain(..len.unwrap_or(0));
            stream.rest -= len.unwrap_or(0);
            if stream.rest > 0 || stream.unsent.is_empty() {
                break;
            }
        }
        if stream.unsent.is_empty() && stream.finishes {
            connection.finish(StreamId(id));
        }
    }

    pub(crate) fn send_headers(&mut self, id: u64, fields: &str) -> bool {
        let fields = wire::fields(&wire::groups(fields).concat());
        let headers = fields.iter().map(|(name, value, indexing)| Header {
            name,
            value,
            static_index: None,
            indexing: *indexing,
        });
        (self.endpoint).send_headers(self.handle.unwrap(), StreamId(id), headers)
    }

    pub(crate) fn has_logged(&self, line: &str) -> bool {
        self.log.iter().any(|it| it == line)
    }

    /// Since the last call.
    pub(crate) fn events(&mut self) -> String {
        std::mem::take(&mut self.log).join(", ")
    }

    pub(crate) fn receive(&mut self, now: Instant, from: &Addresses, datagram: &mut [u8]) {
        let accepted = match self.side {
            Side::Client => &[],
            Side::Server => self.config.versions,
        };
        match self.endpoint.receive(now, from, datagram, accepted) {
            Some(Unrouted::Incoming(incoming)) if self.refuses => self.endpoint.refuse(incoming),
            Some(Unrouted::Incoming(incoming)) => {
                let tls = tls::Toy::new(Side::Server, 0, self.tls);
                let config = Rc::new(self.config.clone());
                self.handle = Some(self.endpoint.accept(now, incoming, config, tls));
                (self.closed, self.streams) = (None, BTreeMap::new());
            }
            Some(Unrouted::Stray(stray)) if self.resets => {
                self.endpoint.reset(from, stray);
            }
            Some(Unrouted::Stray(_)) => self.log.push("stray".into()),
            None => {}
        }
    }

    /// Does what is due, and returns the datagrams.
    pub(crate) fn process(&mut self, now: Instant) -> Vec<(Addresses, Vec<u8>)> {
        self.turns += 1;
        assert!(self.turns < 1_000_000, "does not end");
        let (mut batch, mut datagrams) = (Batch::default(), Vec::new());
        for _ in 0..10_000 {
            self.endpoint.handle_timeouts(now);
            while self.polls && self.poll(now) {}
            batch.clear();
            self.endpoint.poll_transmit(now, &mut batch, 64, |_| {});
            let before = datagrams.len();
            for (addresses, range, len) in batch.runs() {
                let run = batch.bytes()[range].chunks(len);
                datagrams.extend(run.map(|it| (*addresses, it.to_vec())));
            }
            assert_eq!(datagrams.len() - before, batch.len());
            if !(self.polls && self.endpoint.has_events())
                && !self.endpoint.wants_to_transmit()
                && self.endpoint.timeout().is_none_or(|it| it > now)
            {
                return datagrams;
            }
        }
        panic!("does not come to rest");
    }

    /// Returns whether there was an event.
    pub(crate) fn poll(&mut self, now: Instant) -> bool {
        let Some((handle, context, event)) = self.endpoint.poll_event(now) else {
            return false;
        };
        let (line, context) = match event {
            Event::Stream(id, context, event) => (self.on_stream(handle, id.0, event), context),
            event => (self.on_event(event), context),
        };
        self.log.push(match context.addr() {
            0 => line,
            context => format!("{line} @{context}"),
        });
        true
    }

    fn on_event(&mut self, event: Event) -> String {
        match event {
            Event::Stream(..) => unreachable!(),
            Event::Ready => "ready".into(),
            Event::HandshakeConfirmed => "confirmed".into(),
            Event::EarlyDataRejected => "early data rejected".into(),
            Event::Ticket(ticket) => {
                self.tickets.push(ticket);
                "ticket".into()
            }
            Event::Token(token) => format!("token {}", show(&token)),
            Event::KeyLog(line) => format!("key {}", show(&line)),
            Event::StreamsAvailable(direction) => format!("available {direction:?}"),
            Event::Datagram { data, is_early } => {
                let early = if is_early { "early " } else { "" };
                format!("{early}datagram {}", show(&data))
            }
            Event::DatagramAcked(id) => format!("datagram {id} acked"),
            Event::DatagramLost(id) => format!("datagram {id} lost"),
            Event::DatagramAbandoned(id) => format!("datagram {id} abandoned"),
            Event::PathChanged {
                from,
                to,
                is_preferred,
            } => {
                let preferred = if is_preferred { "preferred " } else { "" };
                format!("{preferred}path {} to {}", from.peer, to.peer)
            }
            Event::GoAway => "go away".into(),
            Event::Origin(payload) => format!("origin {}", show(&payload)),
            Event::Closed(connection) => {
                let kind = |layer: &Layer| ["close", "application_close"][*layer as usize];
                let line = match connection.close_reason() {
                    CloseReason::Error { layer, code, .. } => {
                        format!("closed with {} {code:#x}", kind(layer))
                    }
                    CloseReason::Peer {
                        layer,
                        code,
                        reason,
                    } => format!("closed by {} {code:#x} {}", kind(layer), show(reason)),
                    reason => format!("closed: {reason:?}"),
                };
                self.closed = Some(connection);
                line
            }
        }
    }

    fn on_stream(&mut self, handle: Handle, id: u64, event: StreamEvent) -> String {
        let stream = self.streams.entry(id).or_default();
        assert!(!stream.is_closed);
        let line = match event {
            StreamEvent::Opened => "opened".into(),
            StreamEvent::Headers(fields) => {
                assert_eq!(fields.iter().count(), fields.len());
                let rest = if fields.is_incomplete { " .." } else { "" };
                let lines = wire::show_fields(fields.iter());
                let line = format!("{:?}{lines}{rest}", fields.section);
                if self.echoes && fields.section == Section::Head {
                    assert_eq!(self.handle, Some(handle));
                    self.send_headers(id, ":status=200");
                }
                self.endpoint.recycle(fields);
                line
            }
            StreamEvent::Data { data, is_last } => {
                assert!(!stream.is_read_to_end);
                stream.received.extend_from_slice(&data);
                stream.is_read_to_end = is_last;
                let line = format!("{} {}", if is_last { "fin" } else { "data" }, show(&data));
                if self.echoes {
                    stream.unsent.extend(data);
                    stream.finishes = is_last;
                    self.write(handle, id);
                }
                line
            }
            StreamEvent::Writable => {
                if !stream.unsent.is_empty() {
                    self.write(handle, id);
                }
                "writable".into()
            }
            StreamEvent::Reset(code) => format!("reset {code:#x}"),
            StreamEvent::Stopped(code) => format!("stopped {code:#x}"),
            StreamEvent::Closed => {
                stream.is_closed = true;
                "closed".into()
            }
        };
        format!("{id} {line}")
    }
}
