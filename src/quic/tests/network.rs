use bun_quic::{Algorithm, Direction, Duration, PreferredAddress, Version};

use crate::harness::http3;
use crate::harness::network::Network;
use crate::harness::wire::filler;

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
        let mut network = Network::new(1);
        network.client.config.versions = client;
        network.server.config.versions = server;
        network.connect();
        network.echo(5000);
    }
}

#[test]
fn no_common_version() {
    let mut network = Network::new(1);
    network.client.config.versions = &[Version::Draft29];
    network.start(&[]);
    network.run_until(|it| it.client.closed.is_some());
    assert_eq!(network.client.events(), "closed: NoCommonVersion");
}

#[test]
fn fills_the_link() {
    for congestion in [Algorithm::Bbr, Algorithm::Cubic] {
        let mut network = Network::new(1);
        network.config(|it| it.congestion = congestion);
        network.bytes_per_second = 10_000_000;
        network.connect();
        assert!(network.echo(10_000_000) < Duration::from_secs(2));
    }
}

#[test]
fn bbr_drains_the_queue_after_startup() {
    let mut network = Network::new(1);
    network.config(|it| it.congestion = Algorithm::Bbr);
    (network.bytes_per_second, network.max_queueing) = (2_000_000, Duration::from_secs(1));
    network.connect();
    let id = network.client.open(Direction::Bidirectional);
    network.client.send(id, &filler(0, 3_000_000), true);
    network.run_for(Duration::from_millis(500));
    let rtt = network.client.connection().stats().smoothed_rtt;
    assert!(rtt < network.latency * 4);
}

#[test]
fn queues_stay_short_if_the_credit_runs_out() {
    for (connection, stream) in [(100_000, 9_000_000), (9_000_000, 100_000)] {
        let mut network = Network::new(1);
        network.config(|it| {
            it.parameters.initial_max_data = connection;
            it.parameters.initial_max_stream_data_uni = stream;
        });
        (network.bytes_per_second, network.latency) = (2_000_000, Duration::from_millis(10));
        network.max_queueing = Duration::from_secs(1);
        network.connect();
        let id = network.client.open(Direction::Unidirectional);
        network.client.send(id, &filler(0, 8_000_000), true);
        network.run_for(Duration::from_secs(2));
        let rtts = (0..20).map(|_| {
            network.run_for(Duration::from_millis(50));
            network.client.connection().stats().smoothed_rtt.as_millis()
        });
        assert!(rtts.sum::<u64>() < 20 * 38);
        assert!(network.server.streams[&id].received.len() > 5_000_000);
    }
}

#[test]
fn queues_stay_short_if_the_application_has_to_go_for_more() {
    let mut network = Network::new(1);
    network.config(|it| {
        it.parameters.initial_max_data = 20_000_000;
        it.parameters.initial_max_stream_data_uni = 20_000_000;
    });
    (network.bytes_per_second, network.latency) = (60_000_000, Duration::from_millis(3));
    network.max_queueing = Duration::from_secs(1);
    network.connect();
    let id = network.client.open(Direction::Unidirectional);
    network.client.send(id, &[0], false);
    network.client.refill = Some((id, 20_000));
    network.run_for(Duration::from_millis(200));
    assert!(network.client.connection().stats().smoothed_rtt < Duration::from_millis(10));
    assert!(network.server.streams[&id].received.len() > 9_000_000);
}

#[test]
fn unreliable_links() {
    for seed in 0..120 {
        let mut network = Network::new(seed);
        network.loss_per_mille = seed % 5 * 50;
        network.duplicates_per_mille = seed % 3 * 50;
        network.jitter = Duration::from_millis(seed % 7 * 3);
        network.mtu = 1252 + 2 * seed as usize;
        network.client.tls.hello_len = 200 + 30 * seed as usize;
        network.server.tls.certificate_len = 150 * seed as usize;
        network.config(|it| {
            it.handshake_timeout = Duration::from_secs(60);
            it.congestion = [Algorithm::Bbr, Algorithm::Cubic][seed as usize % 2];
            if seed % 4 < 2 {
                http3(it);
            }
        });
        network.connect();
        network.echo(200_000);
    }
}

#[test]
fn more_streams_than_at_first_allowed() {
    let mut network = Network::new(1);
    network.connect();
    for _ in 0..350 {
        network.echo(100);
    }
}

#[test]
fn early_data() {
    for is_accepted in [true, false] {
        let mut network = Network::new(1);
        network.client.config.wants_tickets = true;
        network.connect();
        network.run_for(Duration::from_secs(1));
        let now = network.now;
        network.client.connection().close(now);
        network.run_for(Duration::from_secs(1));
        network.client.log.clear();
        network.server.tls.uses_early_data = is_accepted;
        let ticket = network.client.tickets[0].clone();
        network.start(&ticket);
        if is_accepted {
            assert!(network.echo(2000) < Duration::from_millis(25));
        }
        network.run_for(Duration::from_secs(1));
        let is_rejected = network.client.has_logged("early data rejected");
        assert_eq!(is_rejected, !is_accepted);
        network.echo(3000);
    }
}

#[test]
fn rebinding() {
    for address in ["192.0.2.1:2000", "192.0.2.77:2000"] {
        let mut network = Network::new(1);
        network.connect();
        network.echo(100_000);
        network.translated = address.parse().unwrap();
        network.echo(100_000);
        let line = format!("path 192.0.2.1:1000 to {address}");
        assert!(network.server.has_logged(&line));
    }
}

#[test]
fn preferred_address() {
    let mut network = Network::new(1);
    let address = PreferredAddress::new("198.51.100.2:444".parse().ok(), None);
    network.server.config.parameters.preferred_address = Some(address);
    network.client.config.uses_preferred_address = true;
    network.connect();
    network.echo(100_000);
    let line = "preferred path 198.51.100.1:443 to 198.51.100.2:444";
    assert!(network.client.has_logged(line));
    let local = network.server.connection().addresses().local;
    assert_eq!(local.to_string(), "198.51.100.2:444");
}

#[test]
fn stateless_reset() {
    let mut network = Network::new(1);
    network.server.resets = true;
    network.connect();
    network.server.connection().abort_silently();
    network.run_until(|it| it.client.closed.is_some());
    assert!(network.client.has_logged("closed: StatelessReset"));
}

#[test]
fn link_that_stops_carrying_large_packets() {
    for mtu in [1200, 1252, 1400] {
        let mut network = Network::new(1);
        network.connect();
        network.echo(200_000);
        network.mtu = mtu;
        assert!(network.echo(200_000) < Duration::from_secs(2));
        assert!(network.echo(200_000) < Duration::from_millis(200));
    }
}

#[test]
fn outages() {
    for (congestion, secs) in [
        (Algorithm::Bbr, 1),
        (Algorithm::Cubic, 5),
        (Algorithm::Bbr, 15),
    ] {
        let mut network = Network::new(1);
        network.config(|it| it.congestion = congestion);
        network.connect();
        network.echo(200_000);
        let id = network.client.open(Direction::Bidirectional);
        network.client.send(id, &filler(0, 200_000), true);
        network.run_for(Duration::from_millis(15));
        network.loss_per_mille = 1000;
        network.run_for(Duration::from_secs(secs));
        network.loss_per_mille = 0;
        let start = network.now;
        network.run_until(|it| it.client.streams[&id].is_closed);
        assert!(network.now - start < Duration::from_secs(1 + secs));
        assert!(network.client.streams[&id].received == filler(0, 200_000));
    }
}

#[test]
fn outage_for_good() {
    let mut network = Network::new(1);
    network.connect();
    network.echo(1000);
    network.loss_per_mille = 1000;
    network.run_until(|it| it.client.closed.is_some() && it.server.closed.is_some());
    assert!(network.client.has_logged("closed: IdleTimeout"));
    assert!(network.server.has_logged("closed: IdleTimeout"));
}

#[test]
fn round_trip_times() {
    for micros in [0, 50, 1000, 50_000, 400_000, 2_000_000] {
        for congestion in [Algorithm::Bbr, Algorithm::Cubic] {
            let mut network = Network::new(1);
            network.config(|it| it.congestion = congestion);
            network.latency = Duration::from_micros(micros);
            network.connect();
            let limit = network.latency * 24 + Duration::from_millis(20);
            assert!(network.echo(300_000) < limit);
            let stats = network.client.connection().stats();
            assert_eq!(stats.packets_lost, 0);
            let least = network.latency * 2;
            assert!((least..least + Duration::from_millis(2)).contains(&stats.min_rtt));
        }
    }
}

#[test]
fn both_close_at_the_same_time() {
    let mut network = Network::new(1);
    network.connect();
    let now = network.now;
    network.client.connection().close(now);
    network.server.connection().close(now);
    network.run_for(Duration::from_secs(1));
    for peer in [&mut network.client, &mut network.server] {
        assert!(peer.has_logged("closed: Local") && !peer.has_logged("stray"));
        assert_eq!(peer.endpoint.timeout(), None);
    }
}
