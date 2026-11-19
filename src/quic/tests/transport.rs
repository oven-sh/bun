#[allow(dead_code)]
mod harness;

use bun_quic::{
    Algorithm, CloseReason, Config, Direction, Duration, Layer, Side, StreamId, Version,
};
use harness::Network;

fn pair() -> Network {
    Network::new(Config::client(), Config::server())
}

fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|at| (at * 31 + (at >> 8)) as u8).collect()
}

fn open(network: &mut Network, side: Side, direction: Direction) -> StreamId {
    let connection = network.peer(side).connection();
    connection.open(direction, std::ptr::null_mut()).unwrap()
}

fn echo(network: &mut Network, len: usize) {
    network.server.echoes = true;
    let (id, data) = (
        open(network, Side::Client, Direction::Bidirectional),
        pattern(len),
    );
    network.client.send(id, &data, true);
    network.run_until(|it| it.client.streams[&id].is_closed);
    assert!(network.client.streams[&id].received == data);
}

#[test]
fn handshake() {
    let mut network = pair();
    network.connect();
    network.run_for(Duration::from_secs(1));
    assert_eq!(
        network.client.log,
        ["ready", "confirmed", "token", "ticket"]
    );
    assert_eq!(network.server.log, ["ready", "confirmed"]);
}

#[test]
fn versions() {
    use Version::*;
    for (client, server) in [
        (&[V1][..], &[Draft29, V1, V2][..]),
        (&[V2], &[V1, V2]),
        (&[Draft29], &[Draft29, V1, V2]),
        (&[V1, V2], &[V1, V2]),
        (&[V1, V2], &[V1]),
        (&[V2, V1], &[V2, V1]),
    ] {
        let mut network = pair();
        network.client.config.versions = client;
        network.server.config.versions = server;
        network.connect();
        echo(&mut network, 5000);
    }
}

#[test]
fn no_common_version() {
    let mut network = pair();
    network.client.config.versions = &[Version::Draft29];
    network.start(&[]);
    network.run_until(|it| it.client.closed.is_some());
    assert_eq!(network.client.closed, Some(CloseReason::NoCommonVersion));
}

#[test]
fn bulk_transfer() {
    for congestion in [Algorithm::Bbr, Algorithm::Cubic] {
        let mut network = pair();
        network.client.config.congestion = congestion;
        network.server.config.congestion = congestion;
        network.connect();
        let start = network.now;
        echo(&mut network, 20_000_000);
        println!(
            "{congestion:?} {:?} {:?} {:?}",
            network.now - start,
            network.client.connection().stats(),
            network.server.connection().stats()
        );
    }
}

#[test]
fn unreliable_network() {
    for seed in 0..200 {
        let mut network = Network::seeded(seed, Config::client(), Config::server());
        network.loss_per_mille = seed % 5 * 50;
        network.duplicates_per_mille = seed % 3 * 50;
        network.jitter = Duration::from_millis(seed % 7 * 3);
        network.mtu = 1252 + seed as usize;
        network.client.tls.hello_len = 200 + 20 * seed as usize;
        network.server.tls.certificate_len = 100 * seed as usize;
        network.client.config.handshake_timeout = Duration::from_secs(60);
        network.server.config.handshake_timeout = Duration::from_secs(60);
        network.connect();
        echo(&mut network, 200_000);
    }
}

#[test]
fn many_streams() {
    let mut network = pair();
    network.connect();
    for _ in 0..350 {
        echo(&mut network, 100);
    }
}

#[test]
fn early_data() {
    for is_accepted in [true, false] {
        let mut network = pair();
        network.client.config.wants_tickets = true;
        network.connect();
        network.run_for(Duration::from_secs(1));
        let now = network.now;
        network.client.connection().close(now);
        network.run_for(Duration::from_secs(1));
        network.client.log.clear();
        network.server.log.clear();
        network.server.tls.accepts_early_data = is_accepted;
        let ticket = network.client.tickets[0].clone();
        network.start(&ticket);
        let start = network.now;
        echo(&mut network, if is_accepted { 3000 } else { 0 });
        if is_accepted {
            assert!(network.now - start < Duration::from_millis(25));
        }
        network.run_for(Duration::from_secs(1));
        assert_eq!(
            network.client.has_logged("early data rejected"),
            !is_accepted
        );
        assert!(network.client.has_logged("confirmed"));
    }
}

#[test]
fn application_close() {
    let mut network = pair();
    network.connect();
    let now = network.now;
    (network.client.connection()).abort(now, Layer::Application, 42, b"bye");
    network.run_until(|it| it.server.closed.is_some());
    let reason = CloseReason::Peer {
        layer: Layer::Application,
        code: 42,
        reason: b"bye".to_vec(),
    };
    assert_eq!(network.server.closed, Some(reason));
    assert_eq!(network.client.closed, Some(CloseReason::Local));
    network.run_for(Duration::from_secs(10));
    assert_eq!(network.client.endpoint.timeout(), None);
    assert_eq!(network.server.endpoint.timeout(), None);
}

#[test]
fn idle_timeout() {
    let mut network = pair();
    network.connect();
    network.run_until(|it| it.server.closed.is_some() && it.client.closed.is_some());
    assert_eq!(network.client.closed, Some(CloseReason::IdleTimeout));
    assert_eq!(network.server.closed, Some(CloseReason::IdleTimeout));
}

#[test]
fn rebinding() {
    for address in ["192.0.2.1:2000", "192.0.2.77:2000"] {
        let mut network = pair();
        network.connect();
        echo(&mut network, 100_000);
        network.client.address = address.parse().unwrap();
        echo(&mut network, 100_000);
        assert!(network.server.has_logged(&format!("path {address}")));
    }
}

#[test]
fn stateless_reset() {
    let mut network = pair();
    network.server.resets = true;
    network.connect();
    network.server.connection().abort_silently();
    let id = open(&mut network, Side::Client, Direction::Bidirectional);
    network.client.send(id, b"hello", true);
    network.run_until(|it| it.client.closed.is_some());
    assert_eq!(network.client.closed, Some(CloseReason::StatelessReset));
}

#[test]
fn refused() {
    let mut network = pair();
    network.server.refuses = true;
    network.start(&[]);
    network.run_until(|it| it.client.closed.is_some());
    let reason = CloseReason::Peer {
        layer: Layer::Transport,
        code: 2,
        reason: Vec::new(),
    };
    assert_eq!(network.client.closed, Some(reason));
}
