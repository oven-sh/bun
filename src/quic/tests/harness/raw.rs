use std::collections::{BTreeMap, BTreeSet};

use bun_qpack::Decoder;
use bun_quic::tls::Level;
use bun_quic::{
    Addresses, CloseReason, Config, Connection, Direction, Duration, Instant, Layer, Side,
};

use super::keys::{DRAFT_29, Secret, V1, V2, retry_tag};
use super::peer::Peer;
use super::wire::{self, prefixed, take, take_prefixed, varint};
use super::{address, crypto, tls};

/// Far enough for small packets not to be gathered, however many there are, unless the round trip time has just gone up.
pub(crate) const APART: Duration = Duration::from_micros(251);
/// The round trip time that a connection starts with, in milliseconds.
pub(crate) const RTT: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Initial,
    Early,
    Handshake,
    Short,
}

impl Kind {
    fn space(self) -> usize {
        [0, 2, 1, 2][self as usize]
    }
}

/// What the endpoint has sent.
pub(crate) struct Packet {
    pub(crate) at: Instant,
    pub(crate) addresses: Addresses,
    pub(crate) is_coalesced: bool,
    pub(crate) datagram: Vec<u8>,
    /// `None` if it is not protected, or not with keys that we have.
    pub(crate) kind: Option<Kind>,
    pub(crate) version: u32,
    pub(crate) first: u8,
    pub(crate) destination: Vec<u8>,
    pub(crate) source: Vec<u8>,
    pub(crate) token: Vec<u8>,
    pub(crate) number: u64,
    pub(crate) frames: Vec<String>,
}

/// Sends an endpoint whatever a test comes up with, and reads the answer. Datagrams arrive at once.
pub(crate) struct Raw {
    pub(crate) now: Instant,
    pub(crate) peer: Peer,
    pub(crate) side: Side,
    /// As the peer sees them.
    pub(crate) addresses: Addresses,
    /// Whether the peer gets to act after each datagram.
    pub(crate) waits: bool,

    pub(crate) version: u32,
    pub(crate) source: Vec<u8>,
    pub(crate) destination: Vec<u8>,
    /// The destination of the first packet.
    pub(crate) original: Vec<u8>,
    pub(crate) retry_source: Option<Vec<u8>>,
    pub(crate) token: Vec<u8>,
    /// For each packet number space.
    pub(crate) next: [u64; 3],
    pub(crate) number_len: usize,
    /// The bits to invert in the first byte of each packet.
    pub(crate) flipped: u8,
    pub(crate) initial_len: usize,
    /// How many times the keys have been updated.
    pub(crate) generation: usize,
    pub(crate) peer_generation: usize,

    pub(crate) random: u8,
    pub(crate) parameters: BTreeMap<u64, Option<Vec<u8>>>,
    /// What follows them.
    pub(crate) more_parameters: Vec<u8>,
    /// For a client to offer.
    pub(crate) ticket: Vec<u8>,
    pub(crate) accepts_early_data: bool,
    pub(crate) hello_len: usize,
    pub(crate) written: BTreeMap<u64, u64>,

    pub(crate) inbox: Vec<Packet>,
    pub(crate) received: [BTreeSet<u64>; 3],
    pub(crate) crypto: [Vec<u8>; 3],
    pub(crate) streams: BTreeMap<u64, Vec<u8>>,
    pub(crate) read: BTreeMap<u64, usize>,
    pub(crate) decoder: Decoder,
    /// With their reset tokens.
    pub(crate) ids: BTreeMap<u64, (Vec<u8>, Vec<u8>)>,
    pub(crate) new_token: Vec<u8>,
    pub(crate) challenges: Vec<(Addresses, Vec<u8>)>,
    pub(crate) close: Option<(Layer, u64)>,
    pub(crate) reason: Vec<u8>,
}

impl Raw {
    /// `config` is for the other side, which is the one that is tested.
    pub(crate) fn new(side: Side, config: Config) -> Self {
        // The last packet number that can be skipped, and the longest delay.
        let crypto = crypto::Toy::new(1, &[4, 13]);
        let mut this = Self {
            now: Instant::from_micros(1_000_000),
            peer: Peer::new(!side, crypto, config),
            side,
            addresses: Addresses {
                local: address(!side),
                peer: address(side),
            },
            waits: true,
            version: V1,
            source: b"raw-id-0".to_vec(),
            destination: b"original".to_vec(),
            original: b"original".to_vec(),
            retry_source: None,
            token: Vec::new(),
            next: [0; 3],
            number_len: 4,
            flipped: 0,
            initial_len: 1200,
            generation: 0,
            peer_generation: 0,
            random: 1,
            parameters: BTreeMap::new(),
            more_parameters: Vec::new(),
            ticket: Vec::new(),
            accepts_early_data: false,
            hello_len: 200,
            written: BTreeMap::new(),
            inbox: Vec::new(),
            received: Default::default(),
            crypto: Default::default(),
            streams: BTreeMap::new(),
            read: BTreeMap::new(),
            decoder: Decoder::new(4096, 100),
            ids: BTreeMap::new(),
            new_token: Vec::new(),
            challenges: Vec::new(),
            close: None,
            reason: Vec::new(),
        };
        this.set(
            "max_data=10000000 max_stream_data_bidi_local=1000000 max_stream_data_uni=1000000
            max_stream_data_bidi_remote=1000000 max_streams_bidi=100 max_streams_uni=100
            max_udp_payload_size=1200",
        );
        this
    }

    pub(crate) fn client() -> Self {
        Self::new(Side::Client, Config::server())
    }

    pub(crate) fn server() -> Self {
        Self::new(Side::Server, Config::client())
    }

    pub(crate) fn both() -> [Self; 2] {
        [Self::client(), Self::server()]
    }

    /// For another connection with the same endpoint.
    pub(crate) fn again(self) -> Self {
        let fresh = Self::new(self.side, Config::server());
        let id = [&b"origina"[..], &[self.random]].concat();
        Self {
            now: self.now,
            peer: self.peer,
            addresses: self.addresses,
            random: self.random + 1,
            parameters: self.parameters,
            destination: id.clone(),
            original: id,
            ..fresh
        }
    }

    pub(crate) fn config(mut self, change: impl FnOnce(&mut Config)) -> Self {
        change(&mut self.peer.config);
        self
    }

    /// Transport parameters.
    pub(crate) fn set(&mut self, parameters: &str) {
        (self.parameters).extend(parameters.split_ascii_whitespace().map(wire::parameter));
    }

    pub(crate) fn with(mut self, parameters: &str) -> Self {
        self.set(parameters);
        self
    }

    fn encode_parameters(&self) -> Vec<u8> {
        let mut all = BTreeMap::from([(0x0f, Some(self.source.clone()))]);
        if self.side.is_server() {
            all.insert(0x00, Some(self.original.clone()));
            all.insert(0x10, self.retry_source.clone());
        }
        all.extend(self.parameters.clone());
        let all = (all.into_iter()).filter_map(|(id, it)| Some([varint(id), prefixed(&it?)]));
        (all.flatten().flatten())
            .chain(self.more_parameters.clone())
            .collect()
    }

    pub(crate) fn peer_parameters(&self) -> Vec<(&'static str, String)> {
        let (space, part) = if self.side.is_client() {
            (1, 0)
        } else {
            (0, 1)
        };
        let (_, parts) = tls::next_message(&mut &self.crypto[space][..]).unwrap();
        wire::decode_parameters(parts[part])
    }

    pub(crate) fn peer_parameter(&self, name: &str) -> Option<String> {
        let mut parameters = self.peer_parameters().into_iter();
        parameters.find(|it| it.0 == name).map(|it| it.1)
    }

    /// What the peer has sent for a client to offer.
    pub(crate) fn peer_ticket(&self) -> Vec<u8> {
        tls::next_message(&mut &self.crypto[2][..]).unwrap().1[0].to_vec()
    }

    /// What there is to say in Initial packets.
    pub(crate) fn hello(&self) -> Vec<u8> {
        let padding = vec![0; self.hello_len];
        if self.side.is_server() {
            return tls::message(tls::SERVER_HELLO, &[&padding]);
        }
        let alpn: &[u8] = match self.version {
            DRAFT_29 => b"\x05h3-29",
            _ => b"\x02h3",
        };
        let parameters = self.encode_parameters();
        let parts = [
            &[self.random][..],
            &parameters,
            &self.ticket,
            alpn,
            &padding,
        ];
        tls::message(tls::CLIENT_HELLO, &parts)
    }

    /// What there is to say in Handshake packets.
    pub(crate) fn flight(&self) -> Vec<u8> {
        let finished = tls::message(tls::FINISHED, &[]);
        if self.side.is_client() {
            return finished;
        }
        let parts = [
            &self.encode_parameters()[..],
            &[self.accepts_early_data.into()],
        ];
        let certificate = tls::message(tls::CERTIFICATE, &[&[7; 100]]);
        [tls::message(tls::EXTENSIONS, &parts), certificate, finished].concat()
    }

    pub(crate) fn connection(&mut self) -> &mut Connection {
        self.peer.connection()
    }

    /// Up to where the client has sent its first packets.
    pub(crate) fn start(&mut self, ticket: &[u8]) {
        match self.side {
            Side::Client => self.send_in(Kind::Initial, "hello"),
            Side::Server => (self.peer).connect(self.now, self.addresses.peer, self.random, ticket),
        }
        self.process();
    }

    /// Up to where the peer has the last message of the handshake.
    pub(crate) fn shake_hands(&mut self) {
        self.shake_hands_with("ack, flight");
    }

    /// `frames` are for the Handshake packet.
    pub(crate) fn shake_hands_with(&mut self, frames: &str) {
        let hello = ["ack", "ack, hello"][self.side as usize];
        self.advance(RTT);
        self.send_all(&[(Kind::Initial, hello), (Kind::Handshake, frames)]);
    }

    /// Up to where nothing is left to acknowledge.
    pub(crate) fn confirm(&mut self) {
        self.advance(RTT);
        match self.side {
            Side::Client => self.send("ack"),
            Side::Server => {
                let done = (Kind::Short, "ack, handshake_done");
                self.send_all(&[(Kind::Handshake, "ack"), done]);
            }
        }
        self.advance(RTT);
    }

    pub(crate) fn connected(mut self) -> Self {
        self.start(&[]);
        self.shake_hands();
        self.confirm();
        self.forget();
        self
    }

    /// With our control and QPACK streams.
    pub(crate) fn connected_with(mut self, settings: &str) -> Self {
        self = self.connected();
        let control = [vec![0], wire::http3(&format!("settings {settings}"))].concat();
        for (index, start) in (0..).zip([control, vec![2], vec![3]]) {
            self.write(self.unidirectional(index), &start, false);
        }
        self.advance(RTT);
        self.forget();
        self
    }

    /// The ID of a stream of ours.
    pub(crate) fn unidirectional(&self, index: u64) -> u64 {
        index << 2 | 2 | self.side as u64
    }

    fn secret(&self, kind: Kind, version: u32, sender: Side) -> Secret {
        let level = match kind {
            Kind::Initial => {
                let id = self.retry_source.as_ref().unwrap_or(&self.original);
                return Secret::initial(self.peer.crypto, version, id, sender);
            }
            Kind::Early => Level::EarlyData,
            Kind::Handshake => Level::Handshake,
            Kind::Short => Level::Application,
        };
        let cipher = self.peer.tls.cipher;
        Secret {
            crypto: self.peer.crypto,
            version,
            cipher,
            bytes: tls::secret(cipher, self.random, level, sender),
        }
    }

    /// For all that has arrived.
    pub(crate) fn ack(&self, kind: Kind) -> String {
        let mut ranges: Vec<(u64, u64)> = Vec::new();
        for &number in self.received[kind.space()].iter().rev() {
            match ranges.last_mut() {
                Some(last) if last.0 == number + 1 => last.0 = number,
                _ => ranges.push((number, number)),
            }
        }
        (ranges.iter()).fold("ack".into(), |text, it| format!("{text} {}-{}", it.0, it.1))
    }

    /// On top of what `wire` knows, `ack` is for all that has arrived, `respond` is for the last challenge to the current
    /// address, or else to any, and `hello` and `flight` are CRYPTO frames, which can be told where to start and to end.
    pub(crate) fn encode(&self, kind: Kind, frames: &str) -> Vec<u8> {
        let frame = |tokens: Vec<&str>| match tokens[..] {
            ["ack"] if self.received[kind.space()].is_empty() => Vec::new(),
            ["ack"] => wire::frames(&self.ack(kind)),
            ["respond"] => {
                let here = (self.challenges.iter()).rfind(|it| it.0 == self.addresses);
                let challenge = here.or_else(|| self.challenges.last()).unwrap();
                [&[0x1b], &challenge.1[..]].concat()
            }
            [name @ ("hello" | "flight"), ref range @ ..] => {
                let data = if name == "hello" {
                    self.hello()
                } else {
                    self.flight()
                };
                let start = range.first().map_or(0, |it| it.parse().unwrap());
                let end = range.get(1).map_or(data.len(), |it| it.parse().unwrap());
                [
                    vec![0x06],
                    varint(start as u64),
                    prefixed(&data[start..end]),
                ]
                .concat()
            }
            _ => wire::frame(&tokens),
        };
        wire::groups(frames).into_iter().flat_map(frame).collect()
    }

    /// Up to the source connection ID.
    pub(crate) fn long_header(&self, kind: u8) -> Vec<u8> {
        let first = 0xc0 | ((kind + u8::from(self.version == V2)) % 4) << 4;
        let ids = [&self.destination, &self.source].map(|id| prefixed(id));
        [&[first][..], &self.version.to_be_bytes(), &ids.concat()].concat()
    }

    pub(crate) fn seal(&mut self, kind: Kind, mut payload: Vec<u8>) -> Vec<u8> {
        let number = self.next[kind.space()];
        self.next[kind.space()] += 1;
        let mut packet = match kind {
            Kind::Short => {
                let first = 0x40 | (self.generation as u8 & 1) << 2;
                [&[first], &self.destination[..]].concat()
            }
            Kind::Initial => [self.long_header(0), prefixed(&self.token)].concat(),
            _ => self.long_header(kind as u8),
        };
        let min_len = match kind {
            Kind::Initial => self.initial_len.saturating_sub(packet.len() + 2 + 16),
            _ => 0,
        };
        payload.resize(payload.len().max(min_len.max(4) - self.number_len), 0);
        if kind != Kind::Short {
            let len = self.number_len + payload.len() + 16;
            packet.extend((0x4000 | len as u16).to_be_bytes());
        }
        packet[0] = (packet[0] | (self.number_len - 1) as u8) ^ self.flipped;
        let offset = packet.len();
        packet.extend(&number.to_be_bytes()[8 - self.number_len..]);
        let mut secret = self.secret(kind, self.version, self.side);
        let header_key = secret.header_key();
        for _ in 0..if kind == Kind::Short {
            self.generation
        } else {
            0
        } {
            secret = secret.next();
        }
        let (key, nonce) = secret.packet_key(number);
        let tag = key.seal(&nonce, &packet, &mut payload);
        packet.extend([&payload[..], &tag].concat());
        let mask = header_key.mask(packet[offset + 4..].first_chunk().unwrap());
        packet[0] ^= mask[0] & if kind == Kind::Short { 0x1f } else { 0x0f };
        for at in 0..self.number_len {
            packet[offset + at] ^= mask[1 + at];
        }
        packet
    }

    pub(crate) fn packet(&mut self, kind: Kind, frames: &str) -> Vec<u8> {
        self.seal(kind, self.encode(kind, frames))
    }

    pub(crate) fn deliver(&mut self, datagram: &[u8]) {
        (self.peer).receive(self.now, &self.addresses, &mut datagram.to_vec());
        if self.waits {
            self.process();
        }
    }

    /// In one datagram.
    pub(crate) fn send_all(&mut self, packets: &[(Kind, &str)]) {
        let packets = packets.iter().map(|&(kind, it)| self.packet(kind, it));
        let datagram = packets.collect::<Vec<_>>().concat();
        self.deliver(&datagram);
    }

    pub(crate) fn send_in(&mut self, kind: Kind, frames: &str) {
        self.send_all(&[(kind, frames)]);
    }

    pub(crate) fn send(&mut self, frames: &str) {
        self.send_in(Kind::Short, frames);
    }

    /// With a packet number that is out of turn.
    pub(crate) fn send_as(&mut self, number: u64, frames: &str) {
        let next = std::mem::replace(&mut self.next[2], number);
        let packet = self.packet(Kind::Short, frames);
        self.next[2] = next.max(number + 1);
        self.deliver(&packet);
    }

    /// What comes next on a stream.
    pub(crate) fn write(&mut self, id: u64, mut data: &[u8], fin: bool) {
        loop {
            let chunk = data.split_off(..data.len().min(1200)).unwrap();
            let offset = self.written.entry(id).or_default();
            let kind = 0x0e | u64::from(fin && data.is_empty());
            let frame = [[kind, id, *offset].map(varint).concat(), prefixed(chunk)].concat();
            *offset += chunk.len() as u64;
            let packet = self.seal(Kind::Short, frame);
            self.deliver(&packet);
            if data.is_empty() {
                return;
            }
        }
    }

    pub(crate) fn write_http3(&mut self, id: u64, frames: &str, fin: bool) {
        self.write(id, &wire::http3(frames), fin);
    }

    /// Has the peer send one packet for each byte, on a new stream.
    pub(crate) fn request_packets(&mut self, data: &str) {
        self.request_packets_every(Duration::ZERO, data);
    }

    /// Has the peer send three times as much as counts as progress, and returns the acknowledgments for each part.
    pub(crate) fn request_three_parts(&mut self) -> [String; 3] {
        let id = self.peer.open(Direction::Unidirectional);
        self.forget();
        [(); 3].map(|()| {
            self.peer.send(id, &[0; 4096], false);
            self.advance(1);
            let packets = self.take();
            format!(
                "ack {}-{}",
                packets[0].number,
                packets.last().unwrap().number
            )
        })
    }

    pub(crate) fn request_many_packets(&mut self, count: usize) {
        self.request_packets_every(APART, &"a".repeat(count));
    }

    fn request_packets_every(&mut self, interval: Duration, data: &str) {
        let id = self.peer.open(Direction::Unidirectional);
        for byte in data.bytes() {
            self.now = self.now + interval;
            self.peer.send(id, &[byte], false);
            self.process();
        }
        self.forget();
    }

    /// Until `count` more have arrived.
    pub(crate) fn receive_packets(&mut self, count: usize) {
        let id = self.peer.open(Direction::Unidirectional);
        for at in 1..=count {
            self.peer.send(id, b"a", false);
            self.forget();
            if at % 10 == 0 || at == count {
                self.advance(RTT);
                self.send("ack");
            }
        }
    }

    /// RFC 9000 §17.2.5.
    pub(crate) fn retry(&self, token: &[u8]) -> Vec<u8> {
        let packet = [&self.long_header(3), token].concat();
        let tag = retry_tag(self.peer.crypto, self.version, &self.original, &packet);
        [&packet[..], &tag].concat()
    }

    pub(crate) fn process(&mut self) {
        let limit = self.parameters.get(&0x03).cloned().flatten();
        let limit = limit.and_then(|it| wire::try_varint(&mut &it[..]));
        for (addresses, datagram) in self.peer.process(self.now) {
            assert!(limit.is_none_or(|it| datagram.len() as u64 <= it.max(1200)));
            let mut rest = &datagram[..];
            while !rest.is_empty() {
                let is_coalesced = rest.len() < datagram.len();
                let mut packet = Packet {
                    at: self.now,
                    addresses,
                    is_coalesced,
                    datagram: datagram.clone(),
                    kind: None,
                    version: self.version,
                    first: rest[0],
                    destination: Vec::new(),
                    source: Vec::new(),
                    token: Vec::new(),
                    number: 0,
                    frames: Vec::new(),
                };
                match rest[0] >> 7 {
                    0 => self.read_short(std::mem::take(&mut rest), &mut packet),
                    _ => self.read_long(&mut rest, &mut packet),
                }
                self.inbox.push(packet);
            }
        }
    }

    fn read_short(&mut self, bytes: &[u8], packet: &mut Packet) {
        let generation = self.peer_generation;
        for len in [self.source.len()].into_iter().chain(0..=20) {
            for generation in [generation, generation + 1] {
                if self.open(Kind::Short, generation, bytes, 1 + len, packet) {
                    packet.destination = bytes[1..1 + len].to_vec();
                    self.peer_generation = generation;
                    self.generation = self.generation.max(generation);
                    return;
                }
            }
        }
        packet.frames.push(format!("{} bytes", bytes.len()));
    }

    fn read_long(&mut self, input: &mut &[u8], packet: &mut Packet) {
        let start = *input;
        packet.version = u32::from_be_bytes(take(input, 5)[1..].try_into().unwrap());
        for id in [&mut packet.destination, &mut packet.source] {
            let len = take(input, 1)[0];
            *id = take(input, len.into()).to_vec();
        }
        if packet.version == 0 {
            let versions = wire::show_hex(std::mem::take(input));
            return packet.frames.push(format!("versions {versions}"));
        }
        let kind = match ((start[0] >> 4) + 4 - u8::from(packet.version == V2)) % 4 {
            0 => Kind::Initial,
            1 => Kind::Early,
            2 => Kind::Handshake,
            _ => {
                let (untagged, tag) = start.split_last_chunk().unwrap();
                let (crypto, version) = (self.peer.crypto, packet.version);
                assert!(*tag == retry_tag(crypto, version, &self.original, untagged));
                packet.token = take(input, input.len() - 16).to_vec();
                *input = &[];
                return packet.frames.push("retry".into());
            }
        };
        if kind == Kind::Initial {
            packet.token = take_prefixed(input).to_vec();
            if self.side.is_server() && self.crypto[0].is_empty() {
                self.original.clone_from(&packet.destination);
                self.version = packet.version;
            }
        }
        let protected = take_prefixed(input);
        let end = start.len() - input.len();
        let is_first = self.received[0].is_empty();
        assert!(self.open(kind, 0, &start[..end], end - protected.len(), packet));
        if is_first {
            self.destination.clone_from(&packet.source);
        }
    }

    fn open(
        &mut self,
        kind: Kind,
        generation: usize,
        bytes: &[u8],
        offset: usize,
        packet: &mut Packet,
    ) -> bool {
        let Some(sample) = bytes.get(offset + 4..).and_then(|it| it.first_chunk()) else {
            return false;
        };
        let mut secret = self.secret(kind, packet.version, !self.side);
        let mask = secret.header_key().mask(sample);
        let is_short = kind == Kind::Short;
        let first = bytes[0] ^ mask[0] & if is_short { 0x1f } else { 0x0f };
        let len = usize::from(first & 3) + 1;
        let mut header = [&[first], &bytes[1..offset + len]].concat();
        (header[offset..].iter_mut().zip(&mask[1..])).for_each(|(to, from)| *to ^= from);
        let low = (header[offset..].iter()).fold(0, |sum, &it| sum << 8 | u64::from(it));
        let largest = self.received[kind.space()].last().copied();
        let (expected, window) = (largest.map_or(0, |it| it + 1), 1 << (8 * len));
        let number = expected + (low.wrapping_sub(expected) & (window - 1));
        (0..generation).for_each(|_| secret = secret.next());
        let (key, nonce) = secret.packet_key(number);
        let (payload, tag) = bytes[offset + len..].split_last_chunk().unwrap();
        let mut payload = payload.to_vec();
        if !key.open(&nonce, &header, &mut payload, tag) {
            return false;
        }
        assert_eq!(first & if is_short { 0x58 } else { 0x4c }, 0x40);
        assert!(!is_short || usize::from(first >> 2 & 1) == generation % 2);
        (packet.kind, packet.first, packet.number) = (Some(kind), first, number);
        self.received[kind.space()].insert(number);
        let frames = wire::decode(&payload);
        let is_eliciting = frames.iter().any(|it| !matches!(it.name, "ack" | "close"));
        if kind == Kind::Initial && (self.side.is_server() || is_eliciting) {
            assert!(packet.datagram.len() >= 1200);
        }
        let note = |it| self.note(kind, packet.addresses, it);
        packet.frames = frames.into_iter().map(note).collect();
        true
    }

    /// Returns the text, without what is random or of no consequence.
    fn note(&mut self, kind: Kind, addresses: Addresses, frame: wire::Decoded) -> String {
        match (frame.name, &frame.integers[..], &frame.bytes[..]) {
            ("ack", [_, largest, ..], _) => assert!(*largest < self.next[kind.space()]),
            ("crypto", [at], [data]) => place(&mut self.crypto[kind.space()], *at, data),
            ("stream" | "fin", [id, at], [data]) => {
                place(self.streams.entry(*id).or_default(), *at, data);
            }
            ("new_connection_id", [sequence, retire_prior_to], [id, token]) => {
                self.ids.insert(*sequence, (id.to_vec(), token.to_vec()));
                return format!("{} {sequence} {retire_prior_to}", frame.name);
            }
            ("new_token", _, [token]) => {
                self.new_token = token.to_vec();
                return frame.name.into();
            }
            ("path_challenge", _, [data]) => {
                self.challenges.push((addresses, data.to_vec()));
                return frame.name.into();
            }
            ("close", [code, 0], [reason]) | ("application_close", [code], [reason]) => {
                let layer = [Layer::Application, Layer::Transport][frame.integers.len() - 1];
                (self.close, self.reason) = (Some((layer, *code)), reason.to_vec());
                return format!("{} {code:#x}", frame.name);
            }
            _ => {}
        }
        frame.text
    }

    pub(crate) fn advance(&mut self, millis: u64) {
        let deadline = self.now + Duration::from_millis(millis);
        self.process();
        while let Some(next) = (self.peer.endpoint.timeout()).filter(|&it| it <= deadline) {
            self.now = next;
            self.process();
        }
        self.now = deadline;
    }

    /// Until there is a packet or an event. Returns how many milliseconds that took.
    #[track_caller]
    pub(crate) fn wait(&mut self) -> u64 {
        let start = self.now;
        self.process();
        while self.inbox.is_empty() && self.peer.log.is_empty() {
            self.now = self.peer.endpoint.timeout().unwrap();
            self.process();
        }
        (self.now - start).as_millis()
    }

    /// In milliseconds, unless something arrives.
    pub(crate) fn sleeps_for(&mut self) -> u64 {
        (self.peer.endpoint.timeout().unwrap() - self.now).as_millis()
    }

    /// Since the last call of this or of what follows.
    pub(crate) fn take(&mut self) -> Vec<Packet> {
        self.process();
        std::mem::take(&mut self.inbox)
    }

    /// Spaces are between the packets of a datagram, and semicolons between datagrams.
    pub(crate) fn packets(&mut self) -> String {
        let mut text = String::new();
        for packet in self.take() {
            if !packet.is_coalesced && !text.is_empty() {
                text.push(';');
            }
            if !packet.is_coalesced && packet.addresses != self.addresses {
                text += &format!(" {}", packet.addresses.peer);
            }
            let kind = packet
                .kind
                .map_or("", |it| ["I", "0", "H", "1"][it as usize]);
            text += &format!(" {kind}[{}]", packet.frames.join(", "));
        }
        text.trim_start().into()
    }

    /// Likewise, with just the names of the frames.
    pub(crate) fn outline(&mut self) -> String {
        self.process();
        for frame in self.inbox.iter_mut().flat_map(|it| &mut it.frames) {
            *frame = frame.split_ascii_whitespace().next().unwrap().into();
        }
        self.packets()
    }

    pub(crate) fn sizes(&mut self) -> Vec<usize> {
        let packets = self.take().into_iter().filter(|it| !it.is_coalesced);
        packets.map(|it| it.datagram.len()).collect()
    }

    /// All but ACK frames.
    pub(crate) fn frames(&mut self) -> String {
        let frames = self.take().into_iter().flat_map(|it| it.frames);
        let frames = frames.filter(|it| !it.starts_with("ack "));
        frames.collect::<Vec<_>>().join(", ")
    }

    /// The same, from packets that are not going to be acknowledged.
    pub(crate) fn lose(&mut self) -> String {
        self.process();
        for packet in &self.inbox {
            self.received[packet.kind.unwrap().space()].remove(&packet.number);
        }
        self.frames()
    }

    pub(crate) fn events(&mut self) -> String {
        self.process();
        self.peer.events()
    }

    pub(crate) fn forget(&mut self) {
        self.take();
        self.peer.log.clear();
    }

    /// What the peer has closed the connection with because of us.
    #[track_caller]
    pub(crate) fn error(&mut self) -> Option<(Layer, u64)> {
        self.process();
        let reason = self.peer.closed.as_ref().map(|it| it.close_reason());
        let error = reason.map(|reason| match reason {
            CloseReason::Error { layer, code, .. } => (*layer, *code),
            _ => panic!("{reason:?}"),
        });
        assert_eq!(error, self.close);
        error
    }

    /// The frames that a stream has got since the last call.
    pub(crate) fn read_http3(&mut self, id: u64) -> String {
        self.process();
        let encoder = 2 << 2 | 2 | !self.side as u64;
        let [instructions, frames] = [encoder, id].map(|id| {
            let read = *self.read.entry(id).or_insert(id as usize >> 1 & 1);
            let data = self.streams.get(&id).and_then(|it| it.get(read..));
            data.unwrap_or_default()
        });
        (self
            .decoder
            .read_encoder_stream(instructions, &mut Vec::new()))
        .unwrap();
        *self.read.get_mut(&encoder).unwrap() += instructions.len();
        let mut rest = frames;
        let text = wire::show_http3(&mut rest, id, &mut self.decoder);
        *self.read.get_mut(&id).unwrap() += frames.len() - rest.len();
        text
    }
}

/// Bytes that are sent again have to be the same.
fn place(stream: &mut Vec<u8>, offset: u64, data: &[u8]) {
    let known = &stream[offset as usize..];
    let len = known.len().min(data.len());
    assert!(known[..len] == data[..len]);
    stream.extend_from_slice(&data[len..]);
}
