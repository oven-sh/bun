use bun_quic::Direction::{Bidirectional, Unidirectional};
use bun_quic::Layer::Transport;
use bun_quic::transport_code::PROTOCOL_VIOLATION;
use bun_quic::{Config, StreamId, TransportParameters, Version};

use crate::harness::http3;
use crate::harness::keys::V2;
use crate::harness::raw::Kind::{Early, Handshake, Initial};
use crate::harness::raw::{RTT, Raw};
use crate::harness::tls::next_message;
use crate::harness::wire::hex;

#[test]
fn a_server_is_ready_before_the_end_of_the_handshake() {
    let mut raw = Raw::client().with_ticket();
    raw.send_all(&[(Initial, "hello"), (Early, "stream 0 0 a, ping")]);
    assert_eq!(raw.events(), "ready, 0 opened, 0 data a");
    assert_eq!(raw.outline(), "I[ack, crypto] H[crypto]");
    raw.send_in(Early, "stream 0 1 b");
    assert_eq!(raw.events(), "0 data b");
    assert_eq!(raw.packets(), "1[ack 0-1]");
    raw.peer.send(0, b"c", false);
    assert_eq!(raw.packets(), "1[stream 0 0 c]");
    raw.shake_hands();
    raw.send("stream 0 2 d, stream 4 0 e");
    assert_eq!(raw.events(), "confirmed, 4 opened, 0 data d, 4 data e");
    for (id, expected) in [(0, true), (4, false)] {
        let info = raw.connection().stream_info(StreamId(id)).unwrap();
        assert_eq!(info.has_early_data, expected);
    }
}

#[test]
fn packets_that_are_ahead_of_the_end_of_the_hello() {
    let mut raw = Raw::client().with_ticket();
    raw.send_in(Initial, "hello 0 100");
    raw.send_in(Early, "fin 0 0 a");
    assert_eq!(raw.events(), "");
    raw.send_in(Initial, "hello 100");
    assert_eq!(raw.events(), "ready, 0 opened, 0 fin a");
}

/// RFC 9001 §4.9.3.
#[test]
fn late_packets_are_read_for_a_while() {
    let mut raw = Raw::client().with_ticket();
    let [first, second] = ["fin 0 0 a", "fin 4 0 a"].map(|it| raw.packet(Early, it));
    raw.resume();
    let [third, fourth] = ["fin 8 0 a", "fin 12 0 a"].map(|it| raw.packet(Early, it));
    raw.shake_hands();
    raw.send("ack");
    raw.forget();
    let probe_timeout = RTT + 4 * (3 * RTT) / 8 + 25;
    raw.advance(3 * probe_timeout - 1);
    raw.deliver(&first);
    assert_eq!(raw.events(), "0 opened, 0 fin a");
    raw.deliver(&third);
    assert_eq!(raw.events(), "8 opened, 8 fin a");
    raw.advance(1);
    raw.deliver(&second);
    raw.deliver(&fourth);
    assert_eq!(raw.events(), "");
}

/// RFC 9000 §12.5.
#[test]
fn frames_that_are_not_allowed() {
    for frame in [
        "ack 0",
        "crypto 0 a",
        "handshake_done",
        "new_token a",
        "path_response *8",
        "retire_connection_id 0",
    ] {
        let mut raw = Raw::client().with_ticket();
        raw.resume();
        raw.send_in(Early, frame);
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
        assert_eq!(raw.reason, b"frame is not allowed in this type of packet");
    }
}

/// RFC 9001 §4.6.3 and RFC 9114 §7.2.4.2.
#[test]
fn a_server_rejects_what_was_promised_under_other_terms() {
    let changes: [fn(&mut Config); 4] = [
        |_| {},
        |it| it.parameters.initial_max_data -= 1,
        |it| it.parameters.max_datagram_frame_size += 1,
        |it| it.http3.as_mut().unwrap().connect_protocol = true,
    ];
    for (at, change) in changes.into_iter().enumerate() {
        let mut raw = Raw::client().config(http3).with_ticket().config(change);
        raw.send_all(&[(Initial, "hello"), (Early, "ping")]);
        raw.send_in(Early, "ping");
        assert_eq!(raw.events(), if at == 0 { "ready" } else { "" });
        raw.shake_hands();
        assert!(raw.peer.has_logged("confirmed"));
        let pings = raw.connection().stats().pings_received;
        assert_eq!(pings, if at == 0 { 2 } else { 0 });
    }
}

#[test]
fn a_client_does_not_wait() {
    let mut raw = Raw::server().with("max_stream_data_bidi_remote=3 max_streams_uni=1");
    raw = raw.with_ticket();
    raw.peer.tls.logs_keys = true;
    (raw.peer).connect(raw.now, raw.addresses.peer, raw.random, &raw.ticket);
    assert!(!raw.connection().is_ready());
    let available =
        [Bidirectional, Unidirectional].map(|it| raw.connection().available_streams(it));
    assert_eq!(available, [100, 1]);
    let id = raw.peer.open(Bidirectional);
    raw.peer.send(id, b"abcde", true);
    assert_eq!(raw.events(), "key EarlyData");
    let packets = raw.take();
    assert_eq!(
        (packets[1].kind, packets[1].is_coalesced),
        (Some(Early), true)
    );
    assert_eq!(
        packets[1].frames,
        ["stream_data_blocked 0 3", "stream 0 0 abc"]
    );
    let (_, hello) = next_message(&mut &raw.crypto[0][..]).unwrap();
    assert_eq!(hello[2], b"session");

    raw.send_in(Initial, "ack, hello");
    raw.forget();
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, b"f", true);
    assert_eq!(raw.packets(), "0[fin 2 0 f]");

    raw.set("max_stream_data_bidi_remote=5 max_streams_uni=2");
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.events(), "2 closed, key Application, ready, 0 writable");
    assert_eq!(raw.connection().available_streams(Unidirectional), 1);
    let last = raw.take().pop().unwrap();
    assert_eq!(last.frames, ["new_connection_id 1 0", "fin 0 3 de"]);
    assert_eq!(last.number, 2);
    raw.confirm();
    assert_eq!(raw.events(), "confirmed");
}

/// RFC 9221 §3.
#[test]
fn datagrams() {
    let raw = Raw::client().config(|it| it.parameters.max_datagram_frame_size = 100);
    let mut raw = raw.with_ticket();
    raw.send_all(&[(Initial, "hello"), (Early, "datagram a")]);
    raw.shake_hands();
    raw.send("datagram b");
    assert_eq!(
        raw.events(),
        "ready, early datagram a, confirmed, datagram b"
    );

    let mut raw = Raw::server()
        .with("max_datagram_frame_size=100")
        .with_ticket();
    raw.resume();
    raw.forget();
    raw.connection().send_datagram(1, b"a".to_vec());
    assert_eq!(raw.packets(), "0[datagram a]");
    raw.shake_hands();
    raw.confirm();
    assert_eq!(raw.events(), "ready, datagram 1 acked, confirmed");
}

/// RFC 9000 §7.4.1.
#[test]
fn what_a_client_remembers() {
    let preferred = format!("{}01aa{}", "01".repeat(24), "02".repeat(16));
    let mut raw = Raw::server().with(&format!(
        "max_idle_timeout=1001 max_udp_payload_size=1202 max_data=3 max_stream_data_bidi_local=4
        max_stream_data_bidi_remote=5 max_stream_data_uni=6 max_streams_bidi=7 max_streams_uni=8
        ack_delay_exponent=9 max_ack_delay=10 disable_active_migration=-
        active_connection_id_limit=11 max_datagram_frame_size=12 stateless_reset_token=*16
        version_information=#0000000100000001 preferred_address=#{preferred}"
    ));
    raw = raw.with_ticket();
    let start = [&hex("00000001 00000001 00000007")[..], b"session"].concat();
    assert!(raw.ticket.starts_with(&start));
    raw.resume();
    let mut expected = TransportParameters::default();
    expected.max_idle_timeout_millis = 1001;
    expected.max_udp_payload_size = 1202;
    expected.initial_max_data = 3;
    expected.initial_max_stream_data_bidi_local = 4;
    expected.initial_max_stream_data_bidi_remote = 5;
    expected.initial_max_stream_data_uni = 6;
    expected.initial_max_streams_bidi = 7;
    expected.initial_max_streams_uni = 8;
    expected.disable_active_migration = true;
    expected.active_connection_id_limit = 11;
    expected.max_datagram_frame_size = 12;
    assert_eq!(raw.connection().peer_parameters(), Some(&expected));
}

/// RFC 9000 §7.4.1.
#[test]
fn limits_must_not_be_reduced() {
    for name in [
        "active_connection_id_limit",
        "max_data",
        "max_stream_data_bidi_local",
        "max_stream_data_bidi_remote",
        "max_stream_data_uni",
        "max_streams_bidi",
        "max_streams_uni",
    ] {
        for (value, error) in [(9, Some(PROTOCOL_VIOLATION)), (10, None), (11, None)] {
            let mut raw = Raw::server().with(&format!("{name}=10")).with_ticket();
            raw.set(&format!("{name}={value}"));
            raw.resume();
            raw.shake_hands();
            assert_eq!(raw.error(), error.map(|it| (Transport, it)), "{name}");
        }
    }
}

#[test]
fn a_client_is_told_about_a_rejection() {
    let mut raw = Raw::server().with_ticket();
    raw.accepts_early_data = false;
    raw.resume();
    raw.shake_hands();
    assert_eq!(raw.events(), "early data rejected, ready");
    raw.confirm();
    assert_eq!(raw.events(), "confirmed");
}

/// RFC 9369 §5.
#[test]
fn a_client_resumes_with_the_version_of_the_ticket() {
    let raw = Raw::server().config(|it| it.versions = &[Version::V2]);
    let mut raw = raw.with_ticket();
    raw.peer.config.versions = &[Version::V1, Version::V2];
    raw.resume();
    assert_eq!(raw.versions_of_packets(), [V2]);
    let information = raw.peer_parameter("version_information");
    assert_eq!(information.unwrap(), "#6b3343cf6b3343cf");
}

/// RFC 9001 §4.1.2.
#[test]
fn acknowledgment_of_early_data_does_not_confirm_the_handshake() {
    let mut raw = Raw::server().with_ticket();
    raw.resume();
    raw.request_packets("a");
    raw.shake_hands();
    raw.forget();
    raw.send("ack 0");
    assert_eq!(raw.events(), "");
    raw.send("ack 0-1");
    assert_eq!(raw.events(), "confirmed");
}

/// RFC 9000 §10.1.
#[test]
fn idle_timeout_that_was_remembered_does_not_last() {
    let raw = Raw::server().config(|it| it.parameters.max_idle_timeout_millis = 0);
    let mut raw = raw.with("max_idle_timeout=5000").with_ticket();
    raw.set("max_idle_timeout=");
    raw.resume();
    raw.shake_hands();
    raw.confirm();
    raw.advance(1000);
    assert_eq!(raw.peer.endpoint.timeout(), None);
}
