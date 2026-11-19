use std::collections::BTreeMap;
use std::net::SocketAddr;

use bun_quic::{Addresses, Config, Direction, Duration, Instant, Side};

use super::crypto::{Random, Toy};
use super::peer::Peer;
use super::wire::filler;

/// Two endpoints and what is between them.
pub(crate) struct Network {
    pub(crate) now: Instant,
    pub(crate) client: Peer,
    pub(crate) server: Peer,
    /// What the server takes for the address of the client.
    pub(crate) translated: SocketAddr,
    random: Random,
    /// One way.
    pub(crate) latency: Duration,
    pub(crate) jitter: Duration,
    pub(crate) bytes_per_second: u64,
    pub(crate) max_queueing: Duration,
    pub(crate) mtu: usize,
    pub(crate) loss_per_mille: u64,
    pub(crate) duplicates_per_mille: u64,
    busy_until: [Instant; 2],
    in_flight: BTreeMap<(Instant, usize), (Side, Addresses, Vec<u8>)>,
    count: usize,
}

impl Network {
    pub(crate) fn new(seed: u64) -> Self {
        let peer = |side, config| Peer::new(side, Toy::new(seed << 2 | side as u64, &[]), config);
        Self {
            now: Instant::from_micros(1_000_000),
            client: peer(Side::Client, Config::client()),
            server: peer(Side::Server, Config::server()),
            translated: super::address(Side::Client),
            random: Random::new(seed << 2 | 2),
            latency: Duration::from_millis(10),
            jitter: Duration::ZERO,
            bytes_per_second: 125_000_000,
            max_queueing: Duration::from_millis(50),
            mtu: 1472,
            loss_per_mille: 0,
            duplicates_per_mille: 0,
            busy_until: Default::default(),
            in_flight: BTreeMap::new(),
            count: 0,
        }
    }

    pub(crate) fn config(&mut self, change: impl Fn(&mut Config)) {
        change(&mut self.client.config);
        change(&mut self.server.config);
    }

    pub(crate) fn start(&mut self, ticket: &[u8]) {
        let random = self.random.next() as u8;
        (self.client).connect(self.now, self.server.address, random, ticket);
    }

    pub(crate) fn connect(&mut self) {
        self.start(&[]);
        self.run_until(|it| it.client.has_logged("confirmed") && it.server.has_logged("confirmed"));
    }

    /// Returns how long it took.
    #[track_caller]
    pub(crate) fn echo(&mut self, len: usize) -> Duration {
        let (start, data) = (self.now, filler(0, len));
        let id = self.client.open(Direction::Bidirectional);
        self.server.echoes = true;
        if self.client.config.http3.is_some() {
            let request = ":method=POST :scheme=https :authority=a :path=/";
            assert!(self.client.send_headers(id, request));
        }
        self.client.send(id, &data, true);
        self.run_until(|it| it.client.streams[&id].is_closed);
        assert!(self.client.streams[&id].received == data);
        self.now - start
    }

    fn peer(&mut self, side: Side) -> &mut Peer {
        match side {
            Side::Client => &mut self.client,
            Side::Server => &mut self.server,
        }
    }

    fn process(&mut self) {
        for side in [Side::Client, Side::Server] {
            let now = self.now;
            for (addresses, datagram) in self.peer(side).process(now) {
                self.transmit(side, addresses, &datagram);
            }
        }
    }

    fn transmit(&mut self, sender: Side, addresses: Addresses, datagram: &[u8]) {
        let busy_until = &mut self.busy_until[sender as usize];
        if *busy_until > self.now + self.max_queueing {
            return;
        }
        let micros = (datagram.len() as u64 * 1_000_000).div_ceil(self.bytes_per_second);
        *busy_until = self.now.max(*busy_until) + Duration::from_micros(micros);
        if datagram.len() > self.mtu || self.random.below(1000) < self.loss_per_mille {
            return;
        }
        let (local, peer) = match sender {
            Side::Client => (addresses.peer, self.translated),
            Side::Server => (addresses.peer, addresses.local),
        };
        for _ in 0..1 + usize::from(self.random.below(1000) < self.duplicates_per_mille) {
            let jitter = Duration::from_micros(self.random.below(self.jitter.as_micros() + 1));
            self.count += 1;
            self.in_flight.insert(
                (*busy_until + self.latency + jitter, self.count),
                (!sender, Addresses { local, peer }, datagram.to_vec()),
            );
        }
    }

    /// Returns false if nothing is going to happen until `deadline`.
    fn step(&mut self, deadline: Instant) -> bool {
        self.process();
        let next = [
            self.in_flight.first_key_value().map(|it| it.0.0),
            self.client.endpoint.timeout(),
            self.server.endpoint.timeout(),
        ];
        let next = next.into_iter().flatten().min();
        let Some(next) = next.filter(|&it| it <= deadline) else {
            return false;
        };
        self.now = self.now.max(next);
        while let Some(entry) = self.in_flight.first_entry().filter(|it| it.key().0 <= next) {
            let (now, (receiver, mut from, mut datagram)) = (self.now, entry.remove());
            if receiver.is_client() {
                if from.local != self.translated {
                    continue;
                }
                from.local = self.client.address;
            }
            self.peer(receiver).receive(now, &from, &mut datagram);
        }
        self.process();
        true
    }

    #[track_caller]
    pub(crate) fn run_until(&mut self, is_done: impl Fn(&Self) -> bool) {
        let deadline = self.now + Duration::from_secs(3600);
        while !is_done(self) {
            assert!(
                self.step(deadline) || is_done(self),
                "stuck\nclient: {:?}\nserver: {:?}",
                self.client.log.last_chunk::<3>(),
                self.server.log.last_chunk::<3>(),
            );
        }
    }

    pub(crate) fn run_for(&mut self, duration: Duration) {
        let deadline = self.now + duration;
        while self.step(deadline) {}
        self.now = deadline;
    }
}
