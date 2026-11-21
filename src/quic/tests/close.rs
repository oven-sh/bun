use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::{Application, Transport};
use bun_quic::{Duration, Layer, PreferredAddress, StreamId};

use crate::harness::http3;
use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::{MAX, bytes, filler};

/// Three probe timeouts, in milliseconds.
const SETTLING_PERIOD: u64 = 202;

impl Raw {
    fn abort(&mut self, layer: Layer, code: u64, reason: &[u8]) {
        let now = self.now;
        self.connection().abort(now, layer, code, reason);
    }

    fn close_gracefully(&mut self) {
        let now = self.now;
        self.connection().close(now);
    }

    /// RFC 9000 §10.3.
    fn reset(&mut self, start: &[u8], len: usize, token: &[u8]) {
        let unpredictable = filler(0, len - start.len() - token.len());
        self.deliver(&[start, &unpredictable, token].concat());
    }
}

type Step = fn(&mut Raw);

/// With the types of packets that there are keys for.
const PHASES: [(fn() -> Raw, Step, &str); 7] = [
    (Raw::server, |_| {}, "I"),
    (Raw::server, |it| it.send_in(Initial, "ack, hello"), "IH"),
    (Raw::server, Raw::shake_hands, "H1"),
    (Raw::server, |it| (it.shake_hands(), it.confirm()).1, "1"),
    (Raw::client, |_| {}, "IH1"),
    (Raw::client, |it| it.send_in(Handshake, "ack"), "H1"),
    (Raw::client, Raw::shake_hands, "1"),
];

/// RFC 9000 §10.2.3.
#[test]
fn immediate_close_in_every_phase() {
    for (new, step, kinds) in PHASES {
        for (layer, long, short) in [
            (Transport, "close 0x2a", "close 0x2a"),
            (Application, "close 0xc", "application_close 0x2a"),
        ] {
            let mut raw = new();
            raw.start(&[]);
            step(&mut raw);
            raw.forget();
            raw.abort(layer, 42, b"bye");
            assert!(raw.connection().is_closing());
            let frame = |kind| if kind == '1' { short } else { long };
            let packets = kinds.chars().map(|it| format!("{it}[{}]", frame(it)));
            assert_eq!(raw.packets(), packets.collect::<Vec<_>>().join(" "));
            let has_reason = layer == Transport || kinds.ends_with('1');
            assert_eq!(raw.reason, if has_reason { &b"bye"[..] } else { b"" });
            assert_eq!(raw.events(), "closed: Local");
            raw.advance(60_000);
            assert_eq!(raw.packets(), "");
        }
    }
}

#[test]
fn graceful_close_in_every_phase() {
    for (new, step, kinds) in PHASES {
        let mut raw = new();
        raw.start(&[]);
        step(&mut raw);
        raw.forget();
        raw.close_gracefully();
        assert!(raw.connection().is_closing());
        let packets = kinds.chars().map(|it| format!("{it}[close 0x0]"));
        assert_eq!(raw.packets(), packets.collect::<Vec<_>>().join(" "));
        assert_eq!(raw.events(), "closed: Local");
    }
}

/// RFC 9000 §14.1.
#[test]
fn only_a_client_expands_the_datagram() {
    for (mut raw, is_expanded) in Raw::both().into_iter().zip([false, true]) {
        raw.start(&[]);
        raw.forget();
        raw.abort(Transport, 0, &[]);
        assert_eq!(raw.sizes()[0] >= 1200, is_expanded);
    }
}

#[test]
fn client_finishes_the_handshake_to_be_understood() {
    for (layer, packets) in [
        (Transport, "I[ack, close] H[ack, close] 1[close]"),
        (Application, "H[ack, crypto]; H[close] 1[application_close]"),
    ] {
        let mut raw = Raw::server();
        raw.start(&[]);
        raw.forget();
        raw.waits = false;
        raw.shake_hands();
        raw.abort(layer, 1, &[]);
        assert_eq!(raw.outline(), packets);
    }
}

#[test]
fn reason_is_cut_to_what_fits() {
    let mut raw = Raw::client().connected();
    raw.abort(Transport, u64::MAX, &filler(0, 2000));
    assert_eq!(raw.sizes(), [1200]);
    assert_eq!(raw.close, Some((Transport, MAX)));

    for (len, sent) in [(127, 127), (128, 128), (129, 128)] {
        let mut raw = Raw::server();
        raw.start(&[]);
        raw.forget();
        raw.abort(Transport, 1, &filler(0, len));
        assert_eq!(raw.packets(), "I[close 0x1]");
        assert_eq!(raw.reason, filler(0, sent));
    }

    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    raw.abort(Transport, 1, &filler(0, 2000));
    let packets = raw.take();
    assert_eq!((packets.len(), packets[0].datagram.len()), (3, 1193));
}

/// RFC 9000 §19.19.
#[test]
fn reason_is_not_cut_within_a_character() {
    for (start, sent) in [(124, 128), (125, 125), (127, 127), (128, 128)] {
        let mut raw = Raw::server();
        raw.start(&[]);
        let reason = ["a".repeat(start), "\u{1f35e}".repeat(2)].concat();
        raw.abort(Transport, 1, reason.as_bytes());
        raw.process();
        assert_eq!(raw.reason, reason.as_bytes()[..sent]);
    }
    let mut raw = Raw::client().connected();
    raw.abort(Transport, 1, &[0x80; 2000]);
    raw.process();
    assert_eq!(raw.reason, []);
}

#[test]
fn acknowledges_what_has_arrived() {
    let mut raw = Raw::client().connected();
    raw.send("ping");
    raw.advance(1);
    raw.abort(Application, 1, &[]);
    assert_eq!(raw.packets(), "1[ack 0-1 +125, application_close 0x1]");
}

#[test]
fn immediate_close_delivers_nothing_more() {
    let raw = Raw::client().config(|it| it.parameters.max_datagram_frame_size = 9);
    let mut raw = raw.connected();
    raw.send("stream 0 0 a, fin 2 0 b");
    raw.peer.send(0, b"c", false);
    raw.forget();
    raw.waits = false;
    raw.peer.send(0, b"d", false);
    raw.send("stream 0 1 e, stream 4 0 f, datagram g");
    raw.abort(Application, 1, &[]);
    raw.send("stream 0 2 h");
    assert_eq!(raw.connection().write(StreamId(0), b"i"), None);
    assert_eq!(raw.frames(), "application_close 0x1");
    assert_eq!(raw.events(), "0 closed, closed: Local");
}

#[test]
fn error_delivers_the_events_so_far() {
    let raw = Raw::client().config(|it| it.parameters.max_datagram_frame_size = 9);
    let mut raw = raw.connected();
    raw.send("datagram a, stream 0 0 b, handshake_done");
    assert_eq!(
        raw.events(),
        "datagram a, 0 opened, 0 closed, closed with close 0xa"
    );
}

#[test]
fn first_reason_counts() {
    let steps: [(Step, Step, &str, &str); 8] = [
        (
            |it| it.abort(Transport, 1, &[]),
            |it| it.abort(Application, 2, &[]),
            "close 0x1",
            "closed: Local",
        ),
        (
            |it| it.abort(Transport, 1, &[]),
            Raw::close_gracefully,
            "close 0x1",
            "closed: Local",
        ),
        (
            |it| it.abort(Transport, 1, &[]),
            |it| it.send("close 2 0 -"),
            "close 0x1",
            "closed: Local",
        ),
        (
            |it| it.abort(Transport, 1, &[]),
            |it| it.connection().abort_silently(),
            "",
            "closed: Local",
        ),
        (
            Raw::close_gracefully,
            |it| it.abort(Application, 2, &[]),
            "application_close 0x2",
            "closed: Local",
        ),
        (
            Raw::close_gracefully,
            |it| it.send("close 2 0 -"),
            "",
            "closed by close 0x2 -",
        ),
        (
            |it| it.send("new_connection_id 1 1 raw-id-1 sixteen-bytes-xy, close 2 0 -"),
            |it| it.reset(&[0x40], 43, b"sixteen-bytes-xy"),
            "",
            "closed by close 0x2 -",
        ),
        (
            |it| it.send("handshake_done"),
            |it| it.abort(Application, 2, &[]),
            "close 0xa",
            "closed with close 0xa",
        ),
    ];
    for (first, second, frames, events) in steps {
        let mut raw = Raw::client().connected();
        raw.waits = false;
        first(&mut raw);
        second(&mut raw);
        assert_eq!((raw.frames(), raw.events()), (frames.into(), events.into()));
    }
}

#[test]
fn graceful_close_delivers_what_has_been_written() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a, stream 4 0 a, fin 8 0 a, stream 2 0 a");
    let (bidirectional, unidirectional) =
        (raw.peer.open(Bidirectional), raw.peer.open(Unidirectional));
    raw.forget();
    raw.peer.send(0, b"b", false);
    raw.peer.send(4, b"c", true);
    raw.peer.send(bidirectional, b"d", true);
    raw.peer.send(unidirectional, b"e", false);
    raw.close_gracefully();
    raw.close_gracefully();
    assert_eq!(raw.connection().available_streams(Unidirectional), 0);
    assert_eq!(
        raw.lose(),
        "reset_stream 0 0x0 0, stop_sending 0 0x100, stop_sending 1 0x100, stop_sending 4 0x100, \
         reset_stream 8 0x0 0, fin 4 0 c, fin 1 0 d, stream 3 0 e"
    );
    raw.forget();
    raw.send("stream 2 1 f, stream 12 0 g");
    assert_eq!(raw.events(), "2 data f");
    assert_eq!(raw.frames(), "stop_sending 12 0x0, fin 12 0 -");
    raw.advance(100);
    raw.forget();
    raw.send("ack");
    assert_eq!(raw.frames(), "close 0x0");
}

#[test]
fn graceful_close_waits_for_congestion_control() {
    let mut raw = Raw::client().connected();
    let (id, data) = (raw.peer.open(Unidirectional), filler(0, 60_000));
    raw.peer.send(id, &data, true);
    raw.close_gracefully();
    while raw.close.is_none() {
        raw.advance(RTT);
        raw.send("ack");
    }
    assert!(raw.streams[&id] == data);

    let mut raw = Raw::client().connected();
    let id = raw.peer.open(Bidirectional);
    raw.peer.send(id, &data, false);
    raw.advance(RTT);
    raw.forget();
    raw.close_gracefully();
    assert_eq!(raw.outline(), "");
    raw.advance(100);
    assert_eq!(
        raw.outline(),
        "1[ack, reset_stream, stop_sending]; 1[ack, ping]; 1[close]"
    );
}

#[test]
fn graceful_close_waits_for_datagrams() {
    let mut raw = Raw::client()
        .with("max_datagram_frame_size=1200")
        .connected();
    (0..60).for_each(|id| raw.connection().send_datagram(id, filler(0, 1100)));
    raw.close_gracefully();
    while raw.close.is_none() {
        raw.advance(RTT);
        raw.send("ack");
    }
    let closed = raw.peer.closed.unwrap();
    assert_eq!(closed.stats().datagrams_sent, 60);
}

#[test]
fn graceful_close_does_not_wait_forever() {
    let mut raw = Raw::client().config(|it| it.parameters.max_idle_timeout_millis = 0);
    raw = raw.connected();
    raw.request_packets("a");
    raw.close_gracefully();
    raw.advance(29_999);
    assert_eq!((raw.close, raw.events()), (None, "".into()));
    raw.forget();
    raw.advance(1);
    assert_eq!(raw.frames(), "close 0x0");
    assert_eq!(raw.events(), "3 closed, closed: Local");
}

/// RFC 9114 §5.2.
#[test]
fn server_closes_when_the_client_knows_that_it_goes_away() {
    for (is_acked, after) in [(true, RTT), (false, SETTLING_PERIOD)] {
        let mut raw = Raw::client().config(http3).connected_with("");
        raw.send("ack");
        raw.connection().go_away();
        raw.forget();
        let start = raw.now;
        if is_acked {
            raw.advance(RTT);
            raw.send("ack");
        }
        while raw.close.is_none() {
            raw.forget();
            raw.wait();
        }
        assert_eq!((raw.now - start).as_millis(), after);
        assert_eq!(raw.close, Some((Application, 0x100)));
    }
}

/// RFC 9000 §10.2.2.
#[test]
fn close_from_the_peer() {
    for (frames, events) in [
        ("close 0 0 -", "closed by close 0x0 -"),
        ("close 0x10 6 why", "closed by close 0x10 why"),
        (
            "application_close 7 why",
            "closed by application_close 0x7 why",
        ),
        ("close 1 0 a, close 2 0 b", "closed by close 0x1 a"),
        (
            "ping, close 1 0 a, stream 8 0 b, #ff",
            "closed by close 0x1 a",
        ),
    ] {
        for raw in Raw::both() {
            let mut raw = raw.connected();
            raw.request_packets("ab");
            raw.send(frames);
            let id = !raw.side as u64 | 2;
            assert_eq!(raw.events(), format!("{id} closed, {events}"));
            raw.send("ping");
            raw.advance(60_000);
            assert_eq!(raw.packets(), "");
        }
    }
}

#[test]
fn what_came_before_the_close_is_delivered() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a, stream 4 0 a");
    raw.connection().set_paused(StreamId(0), true);
    raw.send("fin 0 1 b");
    raw.forget();
    raw.send("stream 4 1 c, close 0 0 -");
    assert!(raw.peer.closed.as_ref().unwrap().is_closing());
    assert_eq!(
        raw.events(),
        "4 data c, 0 fin b, 0 closed, 4 closed, closed by close 0x0 -"
    );
}

/// RFC 9000 §10.2.1.
#[test]
fn close_is_repeated_less_and_less_often() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        raw.abort(Application, 1, b"bye");
        let farewell = raw.take().remove(0).datagram;
        for count in 1..=17u32 {
            raw.send("ping");
            let replies = raw.take().into_iter().map(|it| it.datagram);
            let expected = count.is_power_of_two().then(|| farewell.clone());
            assert_eq!(replies.collect::<Vec<_>>(), expected.as_slice());
        }
    }
}

/// RFC 9000 §10.2.
#[test]
fn connection_ids_are_forgotten_after_three_probe_timeouts() {
    let steps: [(Step, u64); 4] = [
        (|it| it.abort(Transport, 0, &[]), SETTLING_PERIOD + 1),
        (|it| it.send("close 0 0 -"), SETTLING_PERIOD + 1),
        (|it| it.send("handshake_done"), SETTLING_PERIOD + 1),
        (|it| it.connection().abort_silently(), 0),
    ];
    for (step, period) in steps {
        let mut raw = Raw::client().connected();
        step(&mut raw);
        raw.forget();
        assert_eq!(raw.peer.endpoint.connection_count(), 0);
        if period > 0 {
            raw.advance(period - 1);
            raw.send("ping");
            assert_eq!(raw.events(), "");
            raw.advance(1);
        }
        for id in [raw.destination.clone(), raw.ids[&1].0.clone()] {
            raw.destination = id;
            raw.send("ping");
            assert_eq!(raw.events(), "stray");
        }
        assert_eq!(raw.peer.endpoint.timeout(), None);
    }
}

#[test]
fn grace_period_starts_at_once() {
    let mut raw = Raw::client().config(|it| it.parameters.max_idle_timeout_millis = 0);
    raw = raw.connected();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, b"a", true);
    raw.close_gracefully();
    raw.now = raw.now + Duration::from_secs(30);
    assert_eq!(raw.packets(), "1[close 0x0]");
}

#[test]
fn nothing_follows_the_end_however_long_the_application_takes() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.close_gracefully();
    raw.forget();
    raw.peer.polls = false;
    raw.send("close 2 0 -");
    raw.advance(60_000);
    assert_eq!(raw.packets(), "");
    raw.peer.polls = true;
    assert_eq!(raw.events(), "3 closed, closed by close 0x2 -");
}

#[test]
fn silent_close() {
    let mut raw = Raw::client().connected();
    raw.send("stream 0 0 a");
    raw.forget();
    raw.waits = false;
    raw.send("stream 0 1 b, stream 4 0 c");
    raw.connection().abort_silently();
    assert_eq!(raw.events(), "0 closed, closed: Local");
    assert_eq!(raw.packets(), "");
}

/// RFC 9000 §10.3.1.
#[test]
fn stateless_reset() {
    let token = *b"sixteen-bytes-xy";
    for (is_routed, first, len) in [
        (false, 0x40, 21),
        (false, 0x7f, 43),
        (false, 0x40, 1200),
        (false, 0xc0, 1200),
        (true, 0x40, 25),
        (true, 0x40, 43),
    ] {
        let raw = Raw::server().with("stateless_reset_token=sixteen-bytes-xy");
        let mut raw = raw.connected();
        raw.send("stream 3 0 a");
        raw.forget();
        let id = if is_routed { &raw.destination[..] } else { &[] };
        raw.reset(&[&[first], id].concat(), len, &token);
        assert_eq!(raw.events(), "3 closed, closed: StatelessReset");
        raw.send("ping");
        raw.advance(1000);
        assert_eq!(raw.packets(), "");
    }
}

#[test]
fn stateless_reset_with_the_token_of_a_later_id() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        raw.send("new_connection_id 1 1 raw-id-1 sixteen-bytes-xy");
        raw.forget();
        raw.reset(&[0x40], 43, b"sixteen-bytes-xy");
        assert_eq!(raw.events(), "closed: StatelessReset");
    }
}

#[test]
fn what_is_not_a_stateless_reset() {
    let mut raw = Raw::server().with("stateless_reset_token=sixteen-bytes-xy");
    raw = raw.connected();
    raw.reset(&[0x40], 43, b"sixteen-bytes-xz");
    raw.reset(&[0x40], 20, b"sixteen-bytes-xy");
    assert_eq!(raw.events(), "stray, stray");
    let start = [&[0x40], &raw.destination[..]].concat();
    raw.reset(&start, 43, b"sixteen-bytes-xz");
    raw.reset(&start, 20, &[]);
    assert_eq!(raw.events(), "");
    assert!(!raw.connection().is_closing());
}

/// RFC 9000 §18.2.
#[test]
fn stateless_reset_for_the_preferred_address() {
    let address = PreferredAddress::new("198.51.100.2:444".parse().ok(), None);
    let raw = Raw::client().config(|it| it.parameters.preferred_address = Some(address));
    let mut raw = raw.connected();
    let parameter = bytes(&raw.peer_parameter("preferred_address").unwrap());
    let (id, token) = parameter[4 + 2 + 16 + 2 + 1..].split_at(8);
    raw.connection().abort_silently();
    raw.forget();
    (raw.peer.resets, raw.destination) = (true, id.to_vec());
    raw.send("ping, padding 50");
    assert!(raw.take()[0].datagram.ends_with(token));
}

#[test]
fn what_is_known_in_each_phase() {
    for mut raw in Raw::both() {
        raw.set("max_data=77");
        raw.start(&[]);
        let side = raw.side;
        let connection = raw.connection();
        assert!(!connection.is_ready() && connection.tls().is_some());
        assert_eq!(connection.peer_parameters().is_some(), side.is_client());
        assert_eq!(connection.local_parameters().max_ack_delay_millis, 25);
        raw.shake_hands();
        raw.confirm();
        let addresses = raw.addresses;
        let connection = raw.connection();
        assert!(connection.is_ready() && connection.tls().is_none());
        assert_eq!(connection.peer_parameters().unwrap().initial_max_data, 77);
        assert!(*connection.addresses() == addresses && !connection.is_closing());
    }
}

#[test]
fn error_for_the_end_of_a_graceful_close() {
    let mut raw = Raw::client().connected();
    raw.request_packets("a");
    raw.connection().finish(StreamId(3));
    raw.connection().set_close_error(Transport, 1, b"a");
    raw.close_gracefully();
    raw.connection().set_close_error(Application, 2, b"b");
    raw.forget();
    raw.waits = false;
    raw.send("ack");
    raw.abort(Transport, 3, b"c");
    raw.connection().set_close_error(Transport, 4, b"d");
    assert_eq!(raw.frames(), "close 0x3");

    let steps: [Step; 2] = [Raw::close_gracefully, |it| it.connection().go_away()];
    for close in steps {
        let mut raw = Raw::client().config(http3).connected_with("");
        raw.connection().set_close_error(Application, 2, b"b");
        close(&mut raw);
        raw.process();
        raw.send("ack");
        assert_eq!(
            (raw.close, &raw.reason[..]),
            (Some((Application, 2)), &b"b"[..])
        );
    }
}

#[test]
fn abort_after_the_close_of_the_peer_delivers_nothing_but_the_end() {
    let aborts: [Step; 2] = [
        |it| it.abort(Transport, 1, &[]),
        |it| it.connection().abort_silently(),
    ];
    for abort in aborts {
        let mut raw = Raw::client().connected();
        raw.send("stream 0 0 a");
        raw.forget();
        raw.waits = false;
        raw.send("stream 0 1 b, reset_stream 4 1 0, close 2 0 -");
        abort(&mut raw);
        assert_eq!(raw.events(), "0 closed, closed by close 0x2 -");
        assert_eq!(raw.packets(), "");
    }
}
