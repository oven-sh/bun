use std::collections::BTreeMap;

use bun_quic::Direction::Unidirectional;
use bun_quic::Layer::Transport;
use bun_quic::Side::{Client, Server};
use bun_quic::{Batch, Config, ConnectionId, Duration, Instant, StreamId, TokenBucket};

use crate::harness::crypto::Toy;
use crate::harness::keys::Secret;
use crate::harness::paths::NEW;
use crate::harness::peer::Peer;
use crate::harness::raw::Kind::{Early, Initial, Short};
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::hex;

impl Raw {
    fn connect_to(&mut self, port: u16) {
        self.addresses.peer.set_port(port);
        (self.peer).connect(self.now, self.addresses.peer, self.random, &[]);
    }

    /// The port, the number of bytes, and the length of a datagram.
    fn runs(&mut self, batch: &mut Batch, max_len: usize) -> Vec<(u16, usize, usize)> {
        (self.peer.endpoint).poll_transmit(self.now, batch, max_len, |_| {});
        let runs = batch.runs().map(|it| (it.0.peer.port(), it.1.len(), it.2));
        runs.collect()
    }

    /// In datagrams.
    fn run_lens(&mut self) -> Vec<usize> {
        let runs = self.runs(&mut Batch::default(), 100);
        runs.iter().map(|it| it.1.div_ceil(it.2)).collect()
    }

    /// All of it arrives.
    fn receive_bytes(&mut self, id: u64, lens: &[usize]) {
        for &len in lens {
            self.peer.send(id, &vec![0; len], false);
            self.advance(RTT);
            self.send("ack");
        }
    }
}

#[test]
fn handles() {
    let (mut raw, mut other) = (Raw::server(), Raw::server());
    assert!(!raw.peer.endpoint.has_events() && !raw.peer.endpoint.wants_to_transmit());
    assert_eq!(raw.peer.endpoint.timeout(), None);
    let [first, second] = [1, 2].map(|port| {
        raw.connect_to(port);
        raw.connection().context = std::ptr::without_provenance_mut(port.into());
        raw.peer.handle.unwrap()
    });
    let port = |raw: &Raw, it| Some(raw.peer.endpoint.get(it)?.addresses().peer.port());
    assert_eq!([first, second].map(|it| port(&raw, it)), [Some(1), Some(2)]);
    assert_eq!(raw.peer.endpoint.handles(), [first, second]);
    assert_eq!(raw.peer.endpoint.connection_count(), 2);
    assert!(other.peer.endpoint.get(first).is_none());
    assert!(other.peer.endpoint.get_mut(first).is_none());

    raw.peer.endpoint.get_mut(first).unwrap().abort_silently();
    assert_eq!(raw.peer.endpoint.connection_count(), 2);
    assert!(raw.peer.poll(raw.now));
    assert_eq!(raw.peer.events(), "closed: Local @1");
    for is_reused in [false, true] {
        let endpoint = &mut raw.peer.endpoint;
        assert!(endpoint.get(first).is_none() && endpoint.get_mut(first).is_none());
        assert!(!endpoint.send_headers(first, StreamId(0), std::iter::empty()));
        assert_eq!(endpoint.connection_count(), 1 + usize::from(is_reused));
        assert_eq!(endpoint.handles().len(), 1 + usize::from(is_reused));
        assert_eq!(endpoint.handles().last(), Some(&second));
        raw.connect_to(3);
    }
}

#[test]
fn ids_are_not_used_twice() {
    let mut raw = Raw::server();
    *raw.peer.crypto.planned.borrow_mut() = vec![vec![1; 8], vec![1; 8], vec![1; 8], vec![2; 8]];
    for expected in [[1; 8], [2; 8]] {
        raw.connect_to(1);
        let id = raw
            .connection()
            .local_parameters()
            .initial_source_connection_id;
        assert_eq!(id, ConnectionId::new(&expected));
    }
}

#[test]
fn the_id_that_the_client_chose_leads_to_its_connection() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    let id = std::mem::replace(&mut raw.destination, raw.original.clone());
    raw.send_in(Initial, "hello");
    assert_eq!(raw.outline(), "I[ack, crypto] H[crypto]");
    assert_eq!(raw.peer.endpoint.connection_count(), 1);
    let late = raw.packet(Initial, "hello");
    raw.destination = id;
    raw.shake_hands();
    raw.forget();
    raw.deliver(&late);
    assert_eq!(raw.packets(), "");
    assert_eq!(raw.peer.endpoint.connection_count(), 1);
}

/// RFC 9000 §5.2.2.
#[test]
fn only_an_initial_packet_starts_a_connection() {
    for (kind, token, count) in [(0, &[0][..], 1), (1, &[], 0), (2, &[], 0)] {
        let mut raw = Raw::client();
        let mut payload = raw.encode(Initial, "hello");
        payload.resize(1200, 0);
        let len = (0x4000 | (4 + payload.len() + 16) as u16).to_be_bytes();
        let mut packet = [&raw.long_header(kind), token, &len, &[0; 4]].concat();
        packet[0] |= 3;
        let offset = packet.len() - 4;
        let secret = Secret::initial(raw.peer.crypto, raw.version, &raw.original, Client);
        let (key, nonce) = secret.packet_key(0);
        let tag = key.seal(&nonce, &packet, &mut payload);
        packet.extend([&payload[..], &tag].concat());
        let mask = (secret.header_key()).mask(packet[offset + 4..].first_chunk().unwrap());
        packet[0] ^= mask[0] & 0x0f;
        (0..4).for_each(|at| packet[offset + at] ^= mask[1 + at]);
        raw.next[0] = 1;
        raw.deliver(&packet);
        assert_eq!(raw.peer.endpoint.connection_count(), count);
    }
}

/// RFC 9000 §5.2.2.
#[test]
fn refusal() {
    let mut raw = Raw::client();
    raw.peer.refuses = true;
    raw.start(&[]);
    let packet = raw.take().remove(0);
    assert_eq!(packet.frames, ["close 0x2"]);
    assert_eq!((packet.number, packet.datagram.len()), (0, 26 + 1 + 4 + 16));
    assert_eq!(
        (packet.destination, packet.source),
        (raw.source, raw.original)
    );
    assert_eq!(raw.peer.endpoint.connection_count(), 0);

    let mut raw = Raw::server();
    raw.start(&[]);
    raw.send_in(Initial, "close 2 0 -");
    assert_eq!(raw.events(), "closed by close 0x2 -");

    let mut raw = Raw::client().config(|it| it.versions = &[]);
    raw.start(&[]);
    assert_eq!((raw.packets(), raw.events()), Default::default());
    assert_eq!(raw.peer.endpoint.connection_count(), 0);
}

/// RFC 9000 §10.3.
#[test]
fn stateless_resets() {
    let mut raw = Raw::client().connected();
    let token = hex(&raw.peer_parameter("stateless_reset_token").unwrap());
    let ids = [(raw.destination.clone(), token), raw.ids[&1].clone()];
    raw.connection().abort_silently();
    raw.forget();
    for (id, token) in ids {
        for (len, random, expected) in [
            (28, 0, None),
            (29, 0, Some(21)),
            (29, 7, Some(28)),
            (61, 8, Some(21)),
            (62, 0, Some(43)),
            (62, 18, Some(61)),
            (1200, 19, Some(43)),
            (1200, 0xff, Some(51)),
        ] {
            let mut stray = [&[0x40], &id[..]].concat();
            stray.resize(len, 0);
            *raw.peer.crypto.planned.borrow_mut() = vec![vec![random; 62]];
            let is_sent = [0, 99].map(|after| {
                let now = raw.now + Duration::from_millis(after);
                raw.peer.endpoint.reset(now, &raw.addresses, &stray)
            });
            assert_eq!(is_sent, [expected.is_some(), false]);
            raw.advance(100);
            let expected = expected.map(|len| {
                let first = random & 0x7f | 0x40;
                [&[first][..], &vec![random; len - 17], &token].concat()
            });
            assert_eq!(raw.take().pop().map(|it| it.datagram), expected);
        }
    }
}

/// RFC 9000 §10.3.2.
#[test]
fn reset_tokens_depend_on_a_secret_of_the_endpoint() {
    let tokens = [1, 2].map(|seed| {
        let mut raw = Raw::client();
        raw.peer = Peer::new(Server, Toy::new(seed, &[]), Config::server());
        raw.peer.resets = true;
        raw.deliver(&[0x40; 100]);
        *raw.take()[0].datagram.last_chunk::<16>().unwrap()
    });
    assert_ne!(tokens[0], tokens[1]);
}

#[test]
fn replies_go_one_by_one() {
    let mut raw = Raw::client();
    let runs = [(1, 43, 43), (1, 43, 43), (1, 21, 21), (2, 43, 43)];
    for (id, (port, len, _)) in (0x40..).zip(runs) {
        raw.act_as(port);
        *raw.peer.crypto.planned.borrow_mut() = vec![vec![0; 62]];
        (raw.peer.endpoint).reset(raw.now, &raw.addresses, &vec![id; 2 * len]);
    }
    let mut batch = Batch::default();
    assert_eq!(raw.runs(&mut batch, 2), runs[..2]);
    assert!(raw.peer.endpoint.wants_to_transmit());
    assert_eq!(raw.runs(&mut batch, 100), runs);
    assert!(!raw.peer.endpoint.wants_to_transmit());
    assert_eq!((batch.len(), batch.bytes().len()), (4, 150));
    batch.clear();
    assert!(batch.len() == 0 && batch.bytes().is_empty() && batch.runs().next().is_none());
}

#[test]
fn runs_get_longer_as_they_arrive() {
    for (packets, arrived, runs) in [
        (240, &[][..], &[1; 8][..]),
        (260, &[], &[2, 1, 1, 1, 1, 1, 1]),
        (260, &[2000], &[3, 1, 1, 1, 2]),
        (260, &[3000], &[4, 2, 2]),
        (260, &[3000, 5500], &[8]),
    ] {
        let mut raw = Raw::server().connected();
        raw.receive_packets(packets);
        let id = raw.peer.open(Unidirectional);
        raw.receive_bytes(id, arrived);
        raw.peer.send(id, &[0; 9000], false);
        assert_eq!(raw.run_lens(), runs);
    }
}

#[test]
fn runs_start_early_if_there_is_more_than_fits_the_window() {
    for (len, first_run) in [(52_000, 1), (54_000, 2)] {
        for is_asked in [false, true] {
            let raw = Raw::server().config(|it| it.sends_in_order = is_asked);
            let mut raw = raw.connected();
            raw.peer.waits_to_be_asked = is_asked;
            let id = raw.peer.open(Unidirectional);
            raw.peer.send(id, &vec![0; len], false);
            raw.peer.poll(raw.now);
            assert_eq!(raw.run_lens()[0], first_run);
        }
    }
}

#[test]
fn probes_go_one_by_one() {
    let mut raw = Raw::server().connected();
    raw.receive_packets(260);
    let id = raw.peer.open(Unidirectional);
    raw.receive_bytes(id, &[2000, 3000]);
    raw.peer.send(id, &[0; 3000], false);
    for runs in [1, 3] {
        let mut batch = Batch::default();
        assert_eq!(raw.runs(&mut batch, 100).len(), runs);
        assert_eq!(batch.len(), 3);
        raw.now = raw.peer.endpoint.timeout().unwrap();
        raw.peer.endpoint.handle_timeouts(raw.now, || raw.now);
    }
}

#[test]
fn nothing_goes_with_a_probe_of_the_mtu() {
    let mut raw = Raw::client().with("max_udp_payload_size=").connected();
    raw.request_packets(&"a".repeat(9));
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &[0; 1500], false);
    raw.lose();
    raw.request_many_packets(250);
    raw.peer.send(id, &[0; 3000], false);
    raw.advance(RTT);
    raw.peer.send(id, &[0; 2000], false);
    raw.waits = false;
    raw.send("ack");
    let runs = [(1000, 1472, 1472), (1000, 2400, 1200)];
    assert_eq!(raw.runs(&mut Batch::default(), 100), runs);
}

#[test]
fn nothing_goes_with_a_probe_of_the_path() {
    let mut raw = Raw::server().connected();
    raw.receive_packets(260);
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &[0; 2000], false);
    raw.waits = false;
    raw.send("path_challenge 12345678");
    assert_eq!(raw.run_lens(), [1, 2]);
}

#[test]
fn runs_are_short_for_a_while_after_one_was_lost() {
    for (arrived, is_late, rounds, runs) in [
        (0, false, 4, &[4, 4, 3][..]),
        (0, true, 4, &[8, 3]),
        (9100, false, 4, &[11]),
        (0, false, 190, &[4, 4, 3]),
        (0, false, 210, &[6, 4, 1]),
    ] {
        let mut raw = Raw::server().connected();
        raw.receive_packets(260);
        let id = raw.peer.open(Unidirectional);
        raw.receive_bytes(id, &[3000, 5500, arrived]);
        raw.request_packets("a");
        raw.peer.send(id, &[0; 9000], false);
        raw.process();
        let all = raw.received[2].clone();
        raw.lose();
        raw.send("ping");
        raw.send("ping");
        for round in 0..rounds {
            for _ in 0..10 {
                raw.peer.send(id, b"b", false);
                raw.forget();
            }
            raw.advance(RTT);
            raw.send("ack");
            if is_late && round == 1 {
                raw.received[2].extend(&all);
            }
        }
        raw.peer.send(id, &[0; 12_000], false);
        assert_eq!(raw.run_lens(), runs);
    }
}

#[test]
fn run_that_comes_last_can_be_lost_as_a_whole() {
    for (packets, first_run) in [(500, 1), (520, 2)] {
        let mut raw = Raw::server().connected();
        raw.receive_packets(260);
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &[0; 2000], false);
        raw.lose();
        raw.send("ping");
        raw.send("ping");
        raw.advance(RTT + 5);
        raw.send("ack");
        raw.receive_packets(packets);
        raw.peer.send(id, &[0; 9000], false);
        assert_eq!(raw.run_lens()[0], first_run);
    }
}

#[test]
fn connections_take_turns() {
    let mut raw = Raw::server();
    raw.peer.tls.hello_len = 56_000;
    raw.connect_to(1);
    raw.connect_to(2);
    raw.connection();
    let (mut batch, mut visited) = (Batch::default(), Vec::new());
    for max_len in [64, 200] {
        let is_full = (raw.peer.endpoint).poll_transmit(raw.now, &mut batch, max_len, |it| {
            visited.push((it.addresses().peer.port(), it.stats().packets_sent));
        });
        let endpoint = &raw.peer.endpoint;
        assert_eq!(is_full, max_len == 64);
        assert_eq!(endpoint.wants_to_transmit(), is_full);
        let waiting = (
            endpoint.waiting_to_transmit(),
            endpoint.waiting_with_events(),
        );
        assert_eq!(waiting, [(0, 0), (2, 2)][usize::from(max_len == 64)]);
        while raw.peer.endpoint.poll_event(raw.now).is_some() {}
    }
    assert!(matches!(
        visited[..],
        [(1, 44), (2, 44), (1, 49 | 50), (2, 49 | 50)]
    ));
    assert_eq!(batch.len() as u64, visited[2].1 + visited[3].1);
    let len = batch.len();
    for (max_len, is_full) in [(len + 1, false), (len, true)] {
        let endpoint = &mut raw.peer.endpoint;
        assert_eq!(
            endpoint.poll_transmit(raw.now, &mut batch, max_len, |_| {}),
            is_full
        );
    }
}

#[test]
fn few_are_told_twice_if_many_connections_end_at_once() {
    let mut raw = Raw::client().connected();
    for _ in 1..40 {
        raw = raw.again().connected();
    }
    let mut datagrams = 0;
    for handle in raw.peer.endpoint.handles() {
        let connection = raw.peer.endpoint.get_mut(handle).unwrap();
        connection.abort(raw.now, Transport, 0, &[]);
        datagrams += raw.run_lens().len();
        raw.now = raw.now + Duration::from_millis(1);
    }
    assert_eq!(datagrams, 40 + 16 + 3);
}

#[test]
fn turns_are_short_while_the_socket_is_backed_up() {
    let mut raw = Raw::server();
    raw.peer.tls.hello_len = 56_000;
    raw.connect_to(1);
    raw.connect_to(2);
    raw.connection();
    for (is_backed_up, expected) in [(true, &[(1, 8), (2, 8)][..]), (false, &[(1, 41)])] {
        raw.peer.endpoint.set_backed_up(is_backed_up);
        let runs = raw.runs(&mut Batch::default(), 12);
        let turns = (runs.chunk_by(|a, b| a.0 == b.0)).map(|it| (it[0].0, it.len()));
        assert_eq!(turns.collect::<Vec<_>>(), expected);
    }
}

#[test]
fn short_datagrams_go_alone_once_the_socket_was_backed_up() {
    for (was_backed_up, runs) in [(false, &[3][..]), (true, &[2, 1])] {
        let mut raw = Raw::server().connected();
        raw.receive_packets(260);
        let id = raw.peer.open(Unidirectional);
        raw.receive_bytes(id, &[3000]);
        raw.peer.endpoint.set_backed_up(was_backed_up);
        raw.peer.endpoint.set_backed_up(false);
        raw.peer.send(id, &[0; 3000], false);
        assert_eq!(raw.run_lens(), runs);
    }
}

#[test]
fn batches_for_several_peers_vary_in_length() {
    for (peers, random, len) in [(2, 0, 24), (2, 0x80, 32), (2, 0xff, 40), (1, 0xff, 32)] {
        let mut raw = Raw::server();
        raw.peer.tls.hello_len = 56_000;
        (0..peers).for_each(|it| raw.connect_to(1 + it));
        raw.peer.endpoint.set_backed_up(true);
        raw.peer.crypto.planned.borrow_mut().push(vec![random; 4]);
        let mut batch = Batch::default();
        raw.runs(&mut batch, 32);
        assert_eq!(batch.len(), len);
    }
}

#[test]
fn there_are_no_runs_for_a_while_if_loss_is_high() {
    let raw = Raw::server().with("max_data=90000000 max_stream_data_uni=9000000");
    let mut raw = raw.connected();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &vec![0; 8_000_000], false);
    let rounds = (0..120).map(|_| {
        raw.advance(RTT);
        for (at, packet) in raw.take().iter().enumerate() {
            if at % 10 == 5 || at >= 40 {
                raw.received[2].remove(&packet.number);
            }
        }
        let longest_run = std::mem::take(&mut raw.peer.longest_run);
        raw.send("ack");
        longest_run > 1
    });
    let rounds = rounds.skip(6).collect::<Vec<_>>();
    let stays = rounds.chunk_by(|a, b| a == b).map(<[bool]>::len);
    assert!(rounds[0] && stays.eq([34, 35, 45]));
}

#[test]
fn turns_are_short_after_a_burst_has_lost_its_end() {
    for (lost, turns) in [(2..5, 1), (5..8, 2)] {
        let mut raw = Raw::server().connected();
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &[0; 9000], false);
        for packet in raw.take().drain(lost) {
            raw.received[2].remove(&packet.number);
        }
        raw.advance(1);
        raw.request_packets("a");
        for _ in 0..4 {
            raw.advance(2 * RTT);
            raw.send("ack");
        }
        raw.peer.send(id, &[0; 10_000], false);
        let mut visits = 0;
        (raw.peer.endpoint).poll_transmit(raw.now, &mut Batch::default(), 100, |_| visits += 1);
        assert_eq!(visits, turns);
    }
}

#[test]
fn who_has_waited_longest_sends_first() {
    for (early, late, after) in [(0, 1, 10_000), (1, 0, 10_000), (0, 1, 1), (1, 0, 1)] {
        let raw = Raw::client().connected();
        let first = raw.peer.handle;
        let mut raw = raw.again();
        raw.addresses.peer.set_port(1001);
        let mut raw = raw.connected();
        let handles = [first, raw.peer.handle];
        // The late one times out sooner, as it has two packets in flight.
        for (at, micros) in [(early, 0), (late, after), (late, after)] {
            raw.peer.handle = handles[at];
            let id = raw.peer.open(Unidirectional);
            raw.connection().write(StreamId(id), b"a");
            raw.peer.process(raw.now + Duration::from_micros(micros));
        }
        let sent = raw.peer.process(raw.now + Duration::from_millis(100));
        let order = sent.iter().map(|it| usize::from(it.0.peer.port()) - 1000);
        assert_eq!(order.collect::<Vec<_>>(), [early, early, late, late]);
    }
}

#[test]
fn timers_that_are_stopped_do_not_wake_the_application() {
    let mut raw = Raw::client().connected();
    raw.advance(1000);
    raw.forget();
    let idle = raw.peer.endpoint.timeout().unwrap();
    raw.send("ping");
    assert_eq!(raw.packets(), "");
    assert!(raw.peer.endpoint.timeout().unwrap() < idle);
    raw.send("ping");
    assert_eq!(raw.packets(), "1[ack 0-2]");
    assert!(raw.peer.endpoint.timeout().unwrap() >= idle);

    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &[1; 20_000], true);
    raw.forget();
    assert!(raw.sleeps_for() < 10);
    raw.send("ack");
    raw.send("ack");
    assert!(raw.sleeps_for() > 1000);

    raw.move_to(NEW);
    raw.send_expanded("ping");
    raw.send("respond");
    raw.advance(RTT);
    assert!(raw.sleeps_for() > 1000);
}

#[test]
fn clients_are_answered_two_at_a_time() {
    let mut raw = Raw::client();
    raw.waits = false;
    let handles = [1, 2, 3, 4, 5].map(|port| {
        raw.act_as(port);
        raw.send_in(Initial, "hello");
        raw.peer.handle.unwrap()
    });
    let endpoint = &mut raw.peer.endpoint;
    endpoint.poll_event(raw.now);
    endpoint.get_mut(handles[2]).unwrap().abort_silently();
    for answered in [&[][..], &[0, 1], &[0, 1, 3], &[0, 1, 3, 4]] {
        for (at, &it) in handles.iter().enumerate() {
            let has_read_hello = endpoint.get(it).unwrap().peer_parameters().is_some();
            assert_eq!(has_read_hello, answered.contains(&at));
        }
        let is_due = endpoint.timeout() == Some(Instant::default());
        assert_eq!(is_due, answered.len() < 4);
        endpoint.handle_timeouts(raw.now, || raw.now);
    }
}

#[test]
fn more_clients_are_answered_if_the_application_takes_long() {
    for (away, cost, answered) in [
        (2, 0, 2),
        (3, 0, 3),
        (128, 0, 128),
        (129, 0, 128),
        (129, 500, 40),
        (129, 15_000, 2),
        (10, 3000, 4),
        (9, 3000, 3),
    ] {
        let mut raw = Raw::client();
        raw.waits = false;
        raw.peer.endpoint.poll_event(raw.now);
        let handles = Vec::from_iter((1..=130).map(|port| {
            raw.act_as(port);
            raw.send_in(Initial, "hello");
            raw.peer.handle.unwrap()
        }));
        let endpoint = &mut raw.peer.endpoint;
        let mut clock = raw.now + Duration::from_millis(away);
        endpoint.handle_timeouts(clock, || {
            clock = clock + Duration::from_micros(cost);
            clock
        });
        let has_read_hello = |it| endpoint.get(it).unwrap().peer_parameters().is_some();
        assert_eq!(
            handles.into_iter().filter(|&it| has_read_hello(it)).count(),
            answered
        );
    }
}

#[test]
fn connections_can_take_turns_with_their_events() {
    for (takes_turns, expected) in [(false, [0, 0, 0, 1, 1, 1]), (true, [0, 1, 0, 1, 0, 1])] {
        let mut raw = Raw::client().with_ticket();
        raw.waits = false;
        let [_, second] = [1, 2].map(|port| {
            raw.act_as(port);
            raw.send_all(&[(Initial, "hello"), (Early, "stream 0 0 a")]);
            raw.peer.handle.unwrap()
        });
        raw.peer.endpoint.handle_timeouts(raw.now, || raw.now);
        let mut order = Vec::new();
        while let Some((handle, ..)) = raw.peer.endpoint.poll_event(raw.now) {
            order.push(u8::from(handle == second));
            if takes_turns {
                raw.peer.endpoint.take_turns();
            }
        }
        assert_eq!(order, expected);
    }
}

#[test]
fn every_connection_has_its_own_timers() {
    let (mut raw, mut handles) = (Raw::server(), Vec::new());
    let (start, mut expected, mut actual) = (raw.now, BTreeMap::new(), BTreeMap::new());
    for port in 1..=50 {
        let (begin, timeout) = (u64::from(port), 2055 - u64::from(port) * 37 % 51 * 40);
        raw.peer.config.handshake_timeout = Duration::from_millis(timeout);
        raw.now = start + Duration::from_millis(begin);
        raw.connect_to(port);
        raw.connection().context = std::ptr::without_provenance_mut(port.into());
        handles.push(raw.peer.handle.unwrap());
        raw.peer.process(raw.now);
        let times = [150, 150, 450, 450, 1050, 1050].into_iter();
        let times = times.take_while(|&it| it < timeout);
        let times = times.chain([timeout]).map(|it| begin + it);
        expected.insert(port, times.collect::<Vec<_>>());
    }
    for (port, &handle) in (1..).zip(&handles).step_by(7) {
        raw.peer.endpoint.get_mut(handle).unwrap().abort_silently();
        expected.remove(&port);
    }
    raw.peer.process(raw.now);
    raw.peer.log.clear();
    while let Some(now) = raw.peer.endpoint.timeout() {
        let sent = raw.peer.process(now).into_iter().map(|it| it.0.peer.port());
        let closed = raw.peer.log.drain(..).map(|line| {
            let port = line.strip_prefix("closed: HandshakeTimeout @");
            port.unwrap().parse().unwrap()
        });
        for port in sent.chain(closed) {
            let times = actual.entry(port).or_insert_with(Vec::new);
            times.push((now - start).as_millis());
        }
    }
    assert_eq!(actual, expected);
}

#[test]
fn the_timeout_is_up_to_date_before_anything_is_sent() {
    let mut raw = Raw::client().connected();
    let (now, idle) = (raw.now + Duration::from_secs(1), Duration::from_secs(30));
    raw.advance(1000);
    let before = raw.peer.endpoint.timeout().unwrap();
    assert!(before > now + idle / 2);
    let ping = raw.packet(Short, "ping");
    raw.waits = false;
    raw.deliver(&ping);
    let delay = Duration::from_millis(RTT / 4);
    assert_eq!(raw.peer.endpoint.timeout(), Some(now + delay));
}

#[test]
fn handling_events_can_give_rise_to_packets() {
    let mut raw = Raw::client().connected();
    raw.peer.polls = false;
    raw.write(2, &[0; 12 * 1024], false);
    raw.advance(RTT);
    assert_eq!(raw.frames(), "");
    raw.peer.polls = true;
    assert!(raw.frames().starts_with("max_stream_data 2 "));
}

#[test]
fn a_connection_ends_even_if_it_never_gets_to_send() {
    let mut raw = Raw::client().connected();
    raw.advance(29_900);
    let now = raw.now;
    raw.connection().abort(now, Transport, 1, b"");
    assert!(!raw.peer.poll(now));
    let soon = now + Duration::from_millis(100);
    raw.peer.endpoint.handle_timeouts(soon, || soon);
    let end = raw.peer.endpoint.timeout().unwrap();
    assert!(end > now + Duration::from_millis(3 * (RTT + 25)));
    raw.peer.endpoint.handle_timeouts(end, || end);
    assert!(raw.peer.poll(end));
    assert_eq!(raw.peer.events(), "closed: Local");
    assert!(raw.peer.endpoint.timeout().unwrap() > end);
    assert!(raw.peer.process(end).is_empty());
}

#[test]
fn token_bucket() {
    let mut bucket = TokenBucket::new(10.0, 3.0);
    bucket.put_back(1);
    for (millis, count, expected) in [
        (1000, 4, false),
        (1000, 2, true),
        (1000, 2, false),
        (1099, 2, false),
        (1101, 2, true),
        (1101, 1, false),
        (1101, 0, true),
        (9000, 4, false),
        (9000, 3, true),
    ] {
        let now = Instant::from_micros(millis * 1000);
        assert_eq!(bucket.take(now, count), expected, "{millis} {count}");
    }
    bucket.put_back(2);
    let now = Instant::from_micros(9_000_000);
    assert!(bucket.take(now, 2) && !bucket.take(now, 1));
}

#[test]
fn time_saturates() {
    let (instant, micros, max) = (Instant::from_micros, Duration::from_micros, u64::MAX);
    assert_eq!(Duration::from_secs(2).as_millis(), 2000);
    assert_eq!(Duration::from_millis(2).as_micros(), 2000);
    assert_eq!(
        [Duration::from_secs(max), Duration::from_millis(max)],
        [micros(max); 2]
    );
    assert!(Duration::ZERO.is_zero() && !micros(1).is_zero());
    for (a, b, sum, difference, product, quotient) in [
        (7, 2, 9, 5, 14, 3),
        (2, 7, 9, 0, 14, 0),
        (max, 2, max, max - 2, max, max / 2),
        (7, 0, 7, 7, 0, 0),
    ] {
        assert_eq!((instant(a) + micros(b)).as_micros(), sum);
        assert_eq!((instant(a) - micros(b)).as_micros(), difference);
        assert_eq!(instant(a) - instant(b), micros(difference));
        assert_eq!(micros(a) + micros(b), micros(sum));
        assert_eq!(micros(a) - micros(b), micros(difference));
        assert_eq!(micros(a) * b, micros(product));
        assert_eq!(micros(a) / b, micros(quotient));
    }
}

#[test]
fn connection_ids() {
    for len in 0..=20 {
        let id = ConnectionId::new(&[0xa; 20][..len]).unwrap();
        assert_eq!(
            (&*id, format!("{id:?}")),
            (&[0xa; 20][..len], "0a".repeat(len))
        );
    }
    assert_eq!(ConnectionId::new(&[0; 21]), None);
    assert_eq!(ConnectionId::new(&[]), Some(ConnectionId::default()));
    assert_ne!(ConnectionId::new(&[0]), ConnectionId::new(&[0, 0]));
}
