use std::collections::BTreeMap;

use bun_quic::Layer::Transport;
use bun_quic::{Batch, ConnectionId, Duration, Instant, StreamId, TokenBucket};

use crate::harness::raw::Kind::{Initial, Short};
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
            (21, 0, None),
            (22, 0, Some(21)),
            (43, 0, Some(42)),
            (44, 0, Some(43)),
            (1200, 0, Some(43)),
            (1200, 18, Some(61)),
            (1200, 19, Some(43)),
            (50, 18, Some(49)),
            (1200, 0xff, Some(51)),
        ] {
            let mut stray = [&[0x40], &id[..]].concat();
            stray.resize(len, 0);
            *raw.peer.crypto.planned.borrow_mut() = vec![vec![random; 62]];
            let is_sent = raw.peer.endpoint.reset(&raw.addresses, &stray);
            assert_eq!(is_sent, expected.is_some());
            let expected = expected.map(|len| {
                let first = random & 0x7f | 0x40;
                [&[first][..], &vec![random; len - 17], &token].concat()
            });
            assert_eq!(raw.take().pop().map(|it| it.datagram), expected);
        }
    }
}

#[test]
fn runs_of_datagrams() {
    let mut raw = Raw::client();
    for (port, len) in [(1, 40), (1, 40), (1, 30), (1, 30), (1, 40), (2, 40)] {
        raw.act_as(port);
        (raw.peer.endpoint).reset(&raw.addresses, &vec![0x40; len + 1]);
    }
    let mut batch = Batch::default();
    assert_eq!(raw.runs(&mut batch, 2), [(1, 80, 40)]);
    assert!(raw.peer.endpoint.wants_to_transmit());
    let runs = [(1, 110, 40), (1, 30, 30), (1, 40, 40), (2, 40, 40)];
    assert_eq!(raw.runs(&mut batch, 100), runs);
    assert!(!raw.peer.endpoint.wants_to_transmit());
    assert_eq!((batch.len(), batch.bytes().len()), (6, 220));
    batch.clear();
    assert!(batch.len() == 0 && batch.bytes().is_empty() && batch.runs().next().is_none());

    raw.peer.endpoint.reset(&raw.addresses, &[0x40; 31]);
    for _ in 0..65 {
        raw.peer.endpoint.reset(&raw.addresses, &[0x40; 41]);
    }
    let runs = [(2, 30, 30), (2, 64 * 40, 40), (2, 40, 40)];
    assert_eq!(raw.runs(&mut batch, 100), runs);
}

#[test]
fn a_run_fits_in_a_udp_packet() {
    for excess in [0, 1] {
        let raw = Raw::server().with("max_datagram_frame_size=1200");
        let (mut raw, mut batch) = (raw.connected(), Batch::default());
        let first = raw.peer.handle;
        (0..54).for_each(|_| raw.connect_to(443));
        assert_eq!(raw.runs(&mut batch, 100), [(443, 54 * 1200, 1200)]);
        let rest = 65507 - 54 * 1200 + excess;
        raw.peer.handle = first;
        (raw.connection()).send_datagram(0, vec![0; rest - (1 + 8 + 2) - 3 - 16]);
        assert_eq!(raw.runs(&mut batch, 100).len(), 1 + excess);
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
    for max_len in [48, 200] {
        (raw.peer.endpoint).poll_transmit(raw.now, &mut batch, max_len, |it| {
            visited.push((it.addresses().peer.port(), it.stats().packets_sent));
        });
        assert_eq!(raw.peer.endpoint.wants_to_transmit(), max_len == 48);
    }
    assert_eq!(visited, [(1, 44), (2, 4), (1, 49), (2, 48), (2, 49)]);
    assert_eq!(batch.len(), 98);
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
    endpoint.get_mut(handles[2]).unwrap().abort_silently();
    for answered in [&[][..], &[0, 1], &[0, 1, 3], &[0, 1, 3, 4]] {
        for (at, &it) in handles.iter().enumerate() {
            let has_read_hello = endpoint.get(it).unwrap().peer_parameters().is_some();
            assert_eq!(has_read_hello, answered.contains(&at));
        }
        let is_due = endpoint.timeout() == Some(Instant::default());
        assert_eq!(is_due, answered.len() < 4);
        endpoint.handle_timeouts(raw.now);
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
    raw.advance(1000);
    let now = raw.now;
    raw.connection().abort(now, Transport, 1, b"");
    assert!(!raw.peer.poll(now));
    let end = raw.peer.endpoint.timeout().unwrap();
    assert!(end > now + Duration::from_millis(3 * (RTT + 25)));
    raw.peer.endpoint.handle_timeouts(end);
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
