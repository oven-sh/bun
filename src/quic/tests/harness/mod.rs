pub(crate) mod crypto;
pub(crate) mod tls;

use std::collections::{BTreeMap, VecDeque};
use std::net::SocketAddr;
use std::rc::Rc;

use bun_quic::{
    Addresses, Batch, CloseReason, Config, Connection, Duration, Endpoint, Event, Handle, Instant,
    Side, StreamEvent, StreamId, Unrouted,
};
use crypto::Random;

#[unsafe(no_mangle)]
extern "Rust" fn __bun_crash_handler_out_of_memory() -> ! {
    panic!("out of memory");
}

/// Stands in for highway_byte_set.cpp, which test/js/bun/util/highway-strings.test.ts covers.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_byte_set_prefix_length(
    text: *const u8,
    len: usize,
    [rows, columns]: &[[u8; 16]; 2],
) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter()
        .take_while(|&&byte| rows[usize::from(byte >> 4)] & columns[usize::from(byte & 15)] != 0)
        .count()
}

/// Stands in for highway_strings.cpp.
#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(text: *const u8, len: usize, byte: u8) -> usize {
    // SAFETY: the caller passes a slice, as a pointer and a length.
    let text = unsafe { core::slice::from_raw_parts(text, len) };
    text.iter().take_while(|&&other| other != byte).count()
}

#[derive(Default)]
pub(crate) struct Stream {
    pub(crate) received: Vec<u8>,
    pub(crate) headers: Vec<Vec<(String, String)>>,
    pub(crate) is_read_to_end: bool,
    pub(crate) is_closed: bool,
    unsent: VecDeque<u8>,
    finishes: bool,
}

/// An endpoint with one connection at a time.
pub(crate) struct Peer {
    pub(crate) endpoint: Endpoint,
    pub(crate) address: SocketAddr,
    pub(crate) config: Config,
    pub(crate) tls: tls::Options,
    pub(crate) handle: Option<Handle>,
    pub(crate) log: Vec<String>,
    pub(crate) streams: BTreeMap<StreamId, Stream>,
    pub(crate) tickets: Vec<Vec<u8>>,
    pub(crate) closed: Option<CloseReason>,
    pub(crate) echoes: bool,
    pub(crate) refuses: bool,
    pub(crate) resets: bool,
    pub(crate) bytes_sent: usize,
    pub(crate) bytes_received: usize,
    pub(crate) datagrams_sent: usize,
    busy_until: Instant,
}

impl Peer {
    fn new(seed: u64, address: &str, config: Config) -> Self {
        Self {
            endpoint: Endpoint::new(Box::leak(Box::new(crypto::Toy(Random::new(seed))))),
            address: address.parse().unwrap(),
            config,
            tls: tls::Options::default(),
            handle: None,
            log: Vec::new(),
            streams: BTreeMap::new(),
            tickets: Vec::new(),
            closed: None,
            echoes: false,
            refuses: false,
            resets: false,
            bytes_sent: 0,
            bytes_received: 0,
            datagrams_sent: 0,
            busy_until: Instant::default(),
        }
    }

    pub(crate) fn connection(&mut self) -> &mut Connection {
        self.endpoint.get_mut(self.handle.unwrap()).unwrap()
    }

    /// Writes as flow control allows.
    pub(crate) fn send(&mut self, id: StreamId, data: &[u8], finishes: bool) {
        let stream = self.streams.entry(id).or_default();
        stream.unsent.extend(data);
        stream.finishes = finishes;
        self.write(self.handle.unwrap(), id);
    }

    fn write(&mut self, handle: Handle, id: StreamId) {
        let stream = self.streams.entry(id).or_default();
        let Some(connection) = self.endpoint.get_mut(handle) else {
            return;
        };
        let len = connection.write(id, stream.unsent.make_contiguous());
        stream.unsent.drain(..len.unwrap_or(0));
        if stream.unsent.is_empty() && stream.finishes {
            connection.finish(id);
        }
    }

    pub(crate) fn has_logged(&self, line: &str) -> bool {
        self.log.iter().any(|it| it == line)
    }

    fn receive(&mut self, now: Instant, side: Side, peer: SocketAddr, datagram: &mut [u8]) {
        self.bytes_received += datagram.len();
        let from = Addresses {
            local: self.address,
            peer,
        };
        let accepted = match side {
            Side::Client => &[],
            Side::Server => self.config.versions,
        };
        match self.endpoint.receive(now, &from, datagram, accepted) {
            Some(Unrouted::Incoming(incoming)) if self.refuses => self.endpoint.refuse(incoming),
            Some(Unrouted::Incoming(incoming)) => {
                let tls = tls::Toy::new(Side::Server, 100, self.tls);
                let config = Rc::new(self.config.clone());
                self.handle = Some(self.endpoint.accept(now, incoming, config, tls));
            }
            Some(Unrouted::Stray(stray)) if self.resets => {
                self.endpoint.reset(&from, stray);
            }
            _ => {}
        }
    }

    fn handle_events(&mut self, now: Instant) {
        while let Some((handle, _, event)) = self.endpoint.poll_event(now) {
            let line = match event {
                Event::Stream(id, _, event) => {
                    self.handle_stream_event(handle, id, event);
                    continue;
                }
                Event::Ready => "ready".into(),
                Event::HandshakeConfirmed => "confirmed".into(),
                Event::EarlyDataRejected => "early data rejected".into(),
                Event::Ticket(ticket) => {
                    self.tickets.push(ticket);
                    "ticket".into()
                }
                Event::Token(_) => "token".into(),
                Event::KeyLog(_) => "key log".into(),
                Event::StreamsAvailable(direction) => format!("available {direction:?}"),
                Event::Datagram { data, is_early } => {
                    format!("datagram {} {is_early}", data.escape_ascii())
                }
                Event::DatagramAcked(id) => format!("datagram {id} acked"),
                Event::DatagramLost(id) => format!("datagram {id} lost"),
                Event::DatagramAbandoned(id) => format!("datagram {id} abandoned"),
                Event::PathChanged { to, .. } => format!("path {}", to.peer),
                Event::GoAway => "go away".into(),
                Event::Origin(payload) => format!("origin {}", payload.escape_ascii()),
                Event::Closed(connection) => {
                    self.closed = Some(connection.close_reason().clone());
                    "closed".into()
                }
            };
            self.log.push(line);
        }
    }

    fn handle_stream_event(&mut self, handle: Handle, id: StreamId, event: StreamEvent) {
        let stream = self.streams.entry(id).or_default();
        assert!(!stream.is_closed);
        let line = match event {
            StreamEvent::Opened => "opened".into(),
            StreamEvent::Headers(fields) => {
                let text = |bytes: &[u8]| bytes.escape_ascii().to_string();
                let lines = fields.iter().map(|it| (text(it.0), text(it.1)));
                stream.headers.push(lines.collect());
                let line = format!("headers {:?}", fields.section);
                self.endpoint.recycle(fields);
                line
            }
            StreamEvent::Data { data, is_last } => {
                assert!(!stream.is_read_to_end);
                stream.received.extend_from_slice(&data);
                stream.is_read_to_end = is_last;
                if self.echoes {
                    stream.unsent.extend(data);
                    stream.finishes = is_last;
                    self.write(handle, id);
                }
                return;
            }
            StreamEvent::Writable => return self.write(handle, id),
            StreamEvent::Reset(code) => format!("reset {code:#x}"),
            StreamEvent::Stopped(code) => format!("stopped {code:#x}"),
            StreamEvent::Closed => {
                stream.is_closed = true;
                "closed".into()
            }
        };
        self.log.push(format!("stream {} {line}", id.0));
    }
}

pub(crate) struct Datagram {
    pub(crate) sender: Side,
    pub(crate) from: SocketAddr,
    pub(crate) to: SocketAddr,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) struct Network {
    pub(crate) now: Instant,
    pub(crate) client: Peer,
    pub(crate) server: Peer,
    pub(crate) random: Random,
    /// One way.
    pub(crate) latency: Duration,
    pub(crate) jitter: Duration,
    pub(crate) bytes_per_second: u64,
    pub(crate) max_queueing: Duration,
    pub(crate) mtu: usize,
    pub(crate) loss_per_mille: u64,
    pub(crate) duplicates_per_mille: u64,
    /// Can change a datagram, and drops it by returning false.
    pub(crate) filter: Box<dyn FnMut(&mut Datagram) -> bool>,
    in_flight: BTreeMap<(Instant, usize), Datagram>,
    count: usize,
}

impl Network {
    pub(crate) fn new(client: Config, server: Config) -> Self {
        Self::seeded(1, client, server)
    }

    pub(crate) fn seeded(seed: u64, client: Config, server: Config) -> Self {
        Self {
            now: Instant::from_micros(1_000_000),
            client: Peer::new(seed << 2, "192.0.2.1:1000", client),
            server: Peer::new(seed << 2 | 1, "198.51.100.1:443", server),
            random: Random::new(seed << 2 | 2),
            latency: Duration::from_millis(10),
            jitter: Duration::ZERO,
            bytes_per_second: 125_000_000,
            max_queueing: Duration::from_millis(50),
            mtu: 1472,
            loss_per_mille: 0,
            duplicates_per_mille: 0,
            filter: Box::new(|_| true),
            in_flight: BTreeMap::new(),
            count: 0,
        }
    }

    pub(crate) fn start(&mut self, ticket: &[u8]) {
        let addresses = Addresses {
            local: self.client.address,
            peer: self.server.address,
        };
        let client = &mut self.client;
        let tls = tls::Toy::new(Side::Client, self.random.next() as u8, client.tls);
        let config = Rc::new(client.config.clone());
        client.handle = Some((client.endpoint).connect(self.now, config, addresses, tls, ticket));
    }

    pub(crate) fn connect(&mut self) {
        self.start(&[]);
        self.run_until(|it| it.client.has_logged("confirmed") && it.server.has_logged("confirmed"));
    }

    pub(crate) fn peer(&mut self, side: Side) -> &mut Peer {
        match side {
            Side::Client => &mut self.client,
            Side::Server => &mut self.server,
        }
    }

    pub(crate) fn inject(&mut self, datagram: Datagram) {
        self.count += 1;
        self.in_flight.insert((self.now, self.count), datagram);
    }

    fn process(&mut self, side: Side) {
        let now = self.now;
        for round in 0.. {
            assert!(round < 10_000, "does not come to rest");
            self.peer(side).endpoint.handle_timeouts(now);
            self.peer(side).handle_events(now);
            let mut batch = Batch::default();
            self.peer(side).endpoint.poll_transmit(now, &mut batch, 64);
            for (addresses, bytes, segment_len) in batch.runs() {
                for bytes in bytes.chunks(segment_len) {
                    self.transmit(Datagram {
                        sender: side,
                        from: self.peer_address(side),
                        to: addresses.peer,
                        bytes: bytes.to_vec(),
                    });
                }
            }
            let endpoint = &mut self.peer(side).endpoint;
            if !endpoint.has_events()
                && !endpoint.wants_to_transmit()
                && endpoint.timeout().is_none_or(|it| it > now)
            {
                break;
            }
        }
    }

    fn peer_address(&self, side: Side) -> SocketAddr {
        match side {
            Side::Client => self.client.address,
            Side::Server => self.server.address,
        }
    }

    fn transmit(&mut self, mut datagram: Datagram) {
        let (now, len) = (self.now, datagram.bytes.len());
        let (max_queueing, rate) = (self.max_queueing, self.bytes_per_second);
        let sender = self.peer(datagram.sender);
        sender.bytes_sent += len;
        sender.datagrams_sent += 1;
        if sender.busy_until > now + max_queueing {
            return;
        }
        let duration = Duration::from_micros((len as u64 * 1_000_000).div_ceil(rate));
        sender.busy_until = sender.busy_until.max(now) + duration;
        let sent_at = sender.busy_until;
        if len > self.mtu
            || self.random.below(1000) < self.loss_per_mille
            || !(self.filter)(&mut datagram)
        {
            return;
        }
        let copies = 1 + usize::from(self.random.below(1000) < self.duplicates_per_mille);
        for _ in 0..copies {
            let jitter = Duration::from_micros(self.random.below(self.jitter.as_micros() + 1));
            self.count += 1;
            let copy = Datagram {
                bytes: datagram.bytes.clone(),
                ..datagram
            };
            (self.in_flight).insert((sent_at + self.latency + jitter, self.count), copy);
        }
    }

    /// Returns false if nothing is going to happen until `deadline`.
    pub(crate) fn step(&mut self, deadline: Instant) -> bool {
        self.process(Side::Client);
        self.process(Side::Server);
        let next = [
            self.in_flight.first_key_value().map(|it| it.0.0),
            self.client.endpoint.timeout(),
            self.server.endpoint.timeout(),
        ];
        let Some(next) = next
            .into_iter()
            .flatten()
            .min()
            .filter(|&it| it <= deadline)
        else {
            return false;
        };
        self.now = self.now.max(next);
        while let Some(entry) = self.in_flight.first_entry().filter(|it| it.key().0 <= next) {
            let (now, mut datagram) = (self.now, entry.remove());
            let receiver = self.peer(!datagram.sender);
            if datagram.to == receiver.address {
                receiver.receive(now, !datagram.sender, datagram.from, &mut datagram.bytes);
            }
        }
        self.process(Side::Client);
        self.process(Side::Server);
        true
    }

    #[track_caller]
    pub(crate) fn run_until(&mut self, is_done: impl Fn(&Self) -> bool) {
        let deadline = self.now + Duration::from_secs(3600);
        while !is_done(self) {
            assert!(
                self.step(deadline) || is_done(self),
                "stuck\nclient: {:?} {:?}\nserver: {:?} {:?}",
                self.client.log,
                self.client.closed,
                self.server.log,
                self.server.closed,
            );
        }
    }

    pub(crate) fn run_for(&mut self, duration: Duration) {
        let deadline = self.now + duration;
        while self.step(deadline) {}
        self.now = deadline;
    }
}
