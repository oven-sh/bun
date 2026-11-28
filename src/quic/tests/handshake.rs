use std::rc::Rc;

use bun_quic::Layer::Transport;
use bun_quic::crypto::Cipher;
use bun_quic::tls::{self, Alert, Level, Session, Status};
use bun_quic::transport_code::*;
use bun_quic::{Batch, Direction, Duration, Side, Unrouted};

use crate::harness::keys::{V1, V2};
use crate::harness::raw::Kind::{Early, Handshake, Initial, Short};
use crate::harness::raw::{Packet, RTT, Raw};
use crate::harness::tls::{FINISHED, Options, TICKET, Toy, message, next_message, secret};
use crate::harness::wire::show_hex;

#[test]
fn flights_of_a_server() {
    let mut raw = Raw::client();
    raw.start(&[]);
    assert_eq!(raw.events(), "");
    assert_eq!(raw.outline(), "I[ack, crypto] H[crypto]");
    assert!(!raw.connection().is_ready() && raw.connection().tls().is_some());
    raw.shake_hands();
    assert_eq!(raw.events(), "ready, confirmed");
    let frames = "1[handshake_done, new_token, crypto, new_connection_id]";
    assert_eq!(raw.outline(), frames);
    assert!(raw.connection().is_ready() && raw.connection().tls().is_none());
    raw.confirm();
    raw.advance(1000);
    assert_eq!((raw.packets(), raw.events()), Default::default());
}

#[test]
fn flights_of_a_client() {
    let mut raw = Raw::server();
    raw.start(&[]);
    assert_eq!(raw.outline(), "I[crypto]");
    assert!(raw.connection().peer_parameters().is_none());
    raw.shake_hands();
    assert_eq!(raw.events(), "ready");
    assert_eq!(raw.outline(), "I[ack] H[ack, crypto] 1[new_connection_id]");
    assert!(raw.connection().peer_parameters().is_some() && raw.connection().tls().is_some());
    raw.confirm();
    assert_eq!(raw.events(), "confirmed");
    assert_eq!(raw.outline(), "1[ack]");
    assert!(raw.connection().tls().is_none());
    raw.send("handshake_done");
    assert_eq!(raw.events(), "");
}

#[test]
fn datagrams_with_initial_packets_are_expanded() {
    for mut raw in Raw::both() {
        raw.peer.tls.certificate_len = 10;
        raw.start(&[]);
        assert_eq!(raw.sizes(), [1200]);
        raw.shake_hands();
        assert_eq!(raw.sizes()[0] == 1200, raw.side.is_server());
    }
}

#[test]
fn other_datagrams_are_not_expanded() {
    let mut raw = Raw::client();
    raw.send_in(Initial, "hello 0 100");
    assert!(raw.sizes()[0] < 100);

    let mut raw = Raw::server();
    raw.start(&[]);
    raw.shake_hands();
    raw.forget();
    raw.send_in(Handshake, "ping");
    raw.send("ping");
    raw.send("ping");
    assert!(matches!(raw.sizes()[..], [..100, ..100]));
}

/// RFC 9000 §14.1, §17.2.2.
#[test]
fn initial_packets_with_a_token_or_in_a_small_datagram() {
    for (len, token, for_server, for_client) in [
        (1199, &b""[..], false, true),
        (1200, b"", true, true),
        (1200, b"a", true, false),
    ] {
        for (mut raw, is_read) in Raw::both().into_iter().zip([for_server, for_client]) {
            raw.start(&[]);
            raw.forget();
            (raw.initial_len, raw.token) = (len, token.to_vec());
            raw.send_in(Initial, "ping");
            assert_eq!(raw.outline().starts_with("I[ack"), is_read);
        }
    }
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    raw.initial_len = 600;
    raw.send_all(&[(Initial, "ping"), (Initial, "ping")]);
    assert!(raw.packets().starts_with("I[ack 0-2,"));
}

/// RFC 9000 §14.
#[test]
fn a_datagram_that_is_too_small_is_no_error() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    raw.initial_len = 1199;
    raw.send_in(Initial, "ping");
    assert_eq!(raw.error(), None);
    raw.initial_len = 1200;
    raw.shake_hands();
    assert!(raw.events().starts_with("ready"));
}

#[test]
fn cipher_suites() {
    use Cipher::*;
    for cipher in [Aes128GcmSha256, Aes256GcmSha384, ChaCha20Poly1305Sha256] {
        for mut raw in Raw::both() {
            raw.peer.tls.cipher = cipher;
            raw = raw.connected();
            raw.send("ping, ping");
            raw.advance(25);
            assert_eq!(raw.outline(), "1[ack]");
        }
    }
}

#[test]
fn key_log() {
    let [mut client, mut server] = Raw::both();
    (client.peer.tls.logs_keys, server.peer.tls.logs_keys) = (true, true);
    client.start(&[]);
    assert_eq!(client.events(), "key Handshake, key Application");
    server.start(&[]);
    server.shake_hands();
    assert_eq!(server.events(), "key Handshake, key Application, ready");
}

#[test]
fn lengths_of_connection_ids() {
    for len in [0, 1, 20] {
        for mut raw in Raw::both() {
            raw.source = vec![7; len];
            raw = raw.connected();
            raw.send("path_challenge *8");
            assert_eq!(raw.take()[0].destination, raw.source);
        }
    }
    for len in 7..=21 {
        let mut raw = Raw::client();
        (raw.original, raw.destination) = (vec![7; len], vec![7; len]);
        raw.start(&[]);
        let packets = raw.take();
        assert_eq!(packets.is_empty(), !(8..=20).contains(&len));
        assert!(
            packets
                .iter()
                .all(|it| it.source.len() == 8 && it.source != raw.original)
        );
    }
    let mut raw = Raw::client();
    raw.source = vec![7; 21];
    raw.start(&[]);
    assert_eq!(raw.packets(), "");
    for (random, len) in [(0, 8), (12, 20), (13, 8), (255, 16)] {
        let mut raw = Raw::server();
        raw.peer.crypto.planned.borrow_mut().push(vec![random; 21]);
        raw.start(&[]);
        assert_eq!(raw.original, vec![random; len]);
    }
}

#[test]
fn a_client_goes_on_with_the_id_that_the_server_chose() {
    let mut raw = Raw::server();
    raw.start(&[]);
    assert_eq!(raw.take()[0].destination, raw.original);
    raw.send_in(Initial, "ack");
    raw.wait();
    assert_eq!(raw.take()[0].destination, raw.source);
}

#[test]
fn hello_in_pieces() {
    for order in [[0, 1, 2], [2, 1, 0], [1, 0, 2], [0, 2, 1]] {
        for mut raw in Raw::both() {
            raw.hello_len = 2500;
            if raw.side.is_server() {
                raw.start(&[]);
                raw.forget();
            }
            let pieces = ["hello 0 1000", "hello 1000 2000", "hello 2000"];
            for at in [order[0], order[0], order[1]] {
                raw.send_in(Initial, pieces[at]);
                assert_eq!(raw.outline(), "I[ack]");
            }
            raw.send_in(Initial, pieces[order[2]]);
            raw.send_in(Handshake, "flight");
            assert!(raw.peer.has_logged("ready"));
        }
    }
}

/// RFC 9000 §7.5.
#[test]
fn buffers_4096_bytes_that_are_out_of_order() {
    for mut raw in Raw::both() {
        raw.hello_len = 4096;
        if raw.side.is_server() {
            raw.start(&[]);
        }
        for range in ["3000", "2000 3000", "1000 2000", "1 1000", "0 1"] {
            raw.send_in(Initial, &format!("hello {range}"));
        }
        raw.send_in(Handshake, "flight");
        assert!(raw.peer.has_logged("ready"));
    }
}

#[test]
fn buffers_4096_bytes_that_have_many_gaps() {
    for mut raw in Raw::both() {
        raw.hello_len = 3900;
        if raw.side.is_server() {
            raw.start(&[]);
        }
        let len = raw.hello().len();
        for first in [1, 2, 0] {
            let pieces = (first..len)
                .step_by(3)
                .map(|at| format!("hello {at} {}", at + 1));
            for packet in pieces.collect::<Vec<_>>().chunks(100) {
                raw.send_in(Initial, &packet.join(", "));
            }
        }
        raw.send_in(Handshake, "flight");
        assert!(raw.peer.has_logged("ready"));
    }
}

#[test]
fn long_flights() {
    let mut raw = Raw::server();
    raw.peer.tls.hello_len = 2500;
    raw.start(&[]);
    assert_eq!(raw.sizes(), [1200; 3]);
    raw.shake_hands();
    assert_eq!(raw.events(), "ready");
}

/// RFC 8446 §4.1.4.
#[test]
fn a_second_hello() {
    for (offered, chosen) in [("00000001", V1), ("000000016b3343cf", V2)] {
        let mut raw = Raw::client().with(&format!("version_information=#00000001{offered}"));
        raw.peer.tls.asks_for_another_hello = true;
        raw.start(&[]);
        assert_eq!(raw.packets(), "I[ack 0, crypto 0 #02000000]");
        let hello = raw.hello();
        raw.version = chosen;
        let frame = format!("crypto {} {}", hello.len(), show_hex(&hello));
        raw.send_in(Initial, &frame);
        assert_eq!(raw.versions_of_packets(), [chosen; 2]);
        raw.shake_hands();
        assert_eq!(raw.events(), "ready, confirmed");
    }
    let mut raw = Raw::server().with_ticket();
    raw.resume();
    raw.forget();
    raw.send_in(Initial, "ack, crypto 0 #02000000");
    assert_eq!(raw.events(), "early data rejected");
    assert_eq!(raw.outline(), "I[ack, crypto]");
    raw.send_in(Initial, &format!("crypto 4 {}", show_hex(&raw.hello())));
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.events(), "ready");
}

/// RFC 9000 §8.1.
#[test]
fn a_server_sends_three_times_what_it_got_until_the_address_is_validated() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 10_000;
    raw.start(&[]);
    assert_eq!(raw.sizes(), [1200; 3]);
    raw.send_in(Initial, "ack");
    assert_eq!(raw.sizes(), [1200; 3]);
    raw.send_in(Handshake, "ack");
    assert_eq!(raw.sizes().len(), 4);
    raw.send_in(Handshake, "ack, flight");
    assert_eq!(raw.events(), "ready, confirmed");
}

/// RFC 9002 §6.2.2.1.
#[test]
fn a_server_that_may_not_send_sets_no_probe_timer() {
    let mut raw = Raw::client();
    let start = raw.now;
    raw.start(&[]);
    raw.advance(150 + 300);
    assert_eq!(raw.sizes(), [1200; 3]);
    raw.advance(1000);
    let timeout = raw.peer.endpoint.timeout();
    assert_eq!(timeout, Some(start + Duration::from_secs(10)));
}

#[test]
fn a_server_that_may_send_more_starts_with_what_it_has_not_sent() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 4000;
    raw.start(&[]);
    let sent = raw.crypto[1].len();
    raw.forget();
    raw.send_in(Initial, "hello");
    assert_eq!(raw.sizes(), [1200; 3]);
    assert!(sent < 4000 && raw.crypto[1].len() > 4000);
}

#[test]
fn a_server_does_not_get_far_ahead_of_what_is_lost() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 30_000;
    raw.start(&[]);
    for _ in 0..10 {
        raw.advance(1000);
        raw.send_in(Initial, "hello");
    }
    assert!((12_000..16_384).contains(&raw.crypto[1].len()));
}

#[test]
fn a_server_that_may_send_everything_starts_with_what_is_lost() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 20_000;
    raw.start(&[]);
    raw.forget();
    raw.send_in(Initial, "hello");
    let last = raw.take().pop().unwrap().number;
    raw.send_in(Handshake, &format!("ack {last}"));
    assert!(raw.frames().starts_with("crypto 0 "));
}

#[test]
fn a_client_repeats_its_hello_until_it_gives_up() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.forget();
    for timeout in [150, 300, 600, 1200, 2400, 4800] {
        assert_eq!(raw.wait(), timeout);
        assert_eq!(raw.outline(), "I[crypto]; I[crypto]");
    }
    assert_eq!(raw.wait(), 10_000 - 9450);
    assert_eq!(raw.events(), "closed: HandshakeTimeout");
    assert_eq!(raw.packets(), "");
}

#[test]
fn bounds_of_the_probe_timeout() {
    let mut raw = Raw::server().config(|it| {
        it.handshake_timeout = Duration::ZERO;
        it.parameters.max_idle_timeout_millis = 0;
    });
    raw.peer.tls.hello_len = 2000;
    raw.start(&[]);
    for count in 0..12 {
        raw.forget();
        assert_eq!(raw.wait(), 60_000.min(150 << count));
    }
    for mut raw in Raw::both() {
        raw.start(&[]);
        raw.advance(1);
        raw.send_in(Initial, "ack");
        raw.forget();
        assert_eq!(raw.wait(), [9, 10][raw.side as usize]);
    }
}

#[test]
fn a_server_repeats_its_flight() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    assert_eq!(raw.wait(), 150);
    assert_eq!(raw.outline(), "I[crypto] H[crypto]");
    for answer in ["I[ack, crypto] H[crypto]", "I[ack]"] {
        raw.send_in(Initial, "hello");
        assert_eq!(raw.outline(), answer);
    }
    raw.advance(RTT);
    raw.send_in(Initial, "ack");
    assert_eq!(raw.wait(), RTT);
    assert_eq!(raw.outline(), "H[crypto]");
}

/// RFC 9002 §6.2.2.1.
#[test]
fn a_client_probes_as_long_as_the_server_may_be_unable_to_send() {
    for (frames, probe) in [("ack", "I[ping]"), ("ack, hello", "H[ping]")] {
        let mut raw = Raw::server();
        raw.start(&[]);
        raw.advance(RTT);
        raw.send_in(Initial, frames);
        raw.forget();
        assert_eq!(raw.wait(), 2 * RTT);
        assert_eq!(raw.outline(), probe);
    }
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.advance(RTT);
    raw.send_in(Initial, "ack");
    raw.forget();
    for (timeout, probes) in [(40, "I[ping]"), (80, "I[ping]; I[ping]")] {
        assert_eq!(raw.wait(), timeout);
        assert_eq!(raw.outline(), probes);
    }
    raw.send_all(&[(Initial, "ack, hello"), (Handshake, "ping")]);
    raw.forget();
    raw.wait();
    assert_eq!(raw.outline(), "H[ping]");
    raw.send_in(Handshake, "ack");
    raw.wait();
    assert_eq!(raw.events(), "closed: HandshakeTimeout");
}

#[test]
fn lost_packets_of_a_flight() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 6000;
    raw.start(&[]);
    raw.advance(RTT);
    raw.send_all(&[(Initial, "ack"), (Handshake, "ack 0")]);
    let sent = raw.take();
    raw.advance(RTT);
    raw.send_in(Handshake, "ack 4 0");
    assert_eq!(raw.take()[0].frames, sent[2].frames);
    assert_eq!(raw.connection().stats().packets_lost, 2);
    assert_eq!(raw.wait(), RTT / 8);
    assert_eq!(raw.take()[0].frames, sent[4].frames);
}

impl Raw {
    /// Where the CRYPTO frames of each packet start.
    fn crypto_offsets(&mut self) -> String {
        let offsets = |packet: Packet| {
            let rest = (packet.frames.iter()).filter_map(|it| it.strip_prefix("crypto "));
            let offsets = rest.filter_map(|it| it.split_ascii_whitespace().next());
            offsets.collect::<Vec<_>>().join(" ")
        };
        let packets = self.take().into_iter().map(offsets);
        packets.collect::<Vec<_>>().join(", ")
    }
}

#[test]
fn crypto_frames_of_a_client_start_where_they_did_before() {
    let mut raw = Raw::server();
    raw.peer.tls.hello_len = 4000;
    raw.start(&[]);
    assert_eq!(raw.crypto_offsets(), "0, 1148, 2295, 3442");
    raw.advance(RTT);
    raw.send_retry(&[1; 50]);
    assert_eq!(raw.crypto_offsets(), "0, 1102, 2203, 3304");
    raw.source = vec![1; 20];
    for start in [
        "0, 1085 1102",
        "0, 1083 1085, 1102",
        "0, 1081 1083 1085, 1102",
    ] {
        raw.now = raw.now + Duration::from_secs(3);
        raw.send_in(Initial, "ping");
        raw.next[0] += 1;
        let offsets = format!("{start}, 2169 2203, 3253 3304");
        assert_eq!(raw.crypto_offsets(), offsets);
    }
}

#[test]
fn crypto_frames_of_a_server_fill_the_packets() {
    let mut raw = Raw::client();
    raw.peer.tls.certificate_len = 2500;
    raw.start(&[]);
    assert_eq!(raw.crypto_offsets(), "0, 0, 894, 2046");
    raw.advance(RTT);
    raw.send_all(&[(Initial, "ack"), (Handshake, "ping")]);
    raw.forget();
    raw.wait();
    assert_eq!(raw.crypto_offsets(), "0, 1153, 2305");
}

#[test]
fn the_end_of_the_handshake_is_repeated() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.shake_hands();
    raw.forget();
    assert_eq!(raw.wait(), 2 * RTT);
    assert!(raw.outline().starts_with("H[crypto]"));

    let mut raw = Raw::server();
    raw.start(&[]);
    raw.shake_hands();
    raw.request_packets("a");
    raw.wait();
    assert_eq!(
        raw.frames(),
        ["crypto 0 #14000000, new_connection_id 1 0, stream 2 0 a"; 2].join(", ")
    );

    let mut raw = Raw::client();
    raw.start(&[]);
    raw.shake_hands();
    raw.forget();
    raw.wait();
    assert!(
        raw.frames()
            .starts_with("handshake_done, new_token, crypto 0 ")
    );
}

#[test]
fn a_server_that_waits_for_the_end_of_the_handshake_is_heard_from() {
    let answered = |raw: &mut Raw, count| -> Vec<_> {
        let is_answered = |_: &u32| {
            raw.send("ping");
            raw.outline() == "H[ack]"
        };
        (1..=count).filter(is_answered).collect()
    };
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    assert_eq!(answered(&mut raw, 3), []);
    for (frames, times) in [("ack", 1), ("ack", 1), ("ping", 20)] {
        (0..times).for_each(|_| raw.send_in(Handshake, frames));
        raw.forget();
        assert_eq!(answered(&mut raw, 40), [1, 2, 4, 8, 16, 32]);
    }
    raw.next[1] -= 1;
    raw.send_in(Handshake, "ping");
    assert_eq!(answered(&mut raw, 3), []);
    raw.waits = false;
    raw.send_in(Handshake, "ping");
    (0..2).for_each(|_| raw.send("ping"));
    assert_eq!(answered(&mut raw, 1), [1]);

    let mut raw = Raw::server();
    raw.start(&[]);
    raw.send_all(&[(Initial, "ack, hello"), (Handshake, "ping")]);
    raw.forget();
    assert_eq!(answered(&mut raw, 3), []);
}

#[test]
fn rules_of_quic_go_before_alerts() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "crypto 0 #05000000");
    assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
}

/// RFC 9001 §4.8.
#[test]
fn alerts() {
    for (mut raw, packets) in Raw::both().into_iter().zip([
        "I[ack 0, close 0x12a]",
        "I[ack 0, close 0x12a] H[close 0x12a]",
    ]) {
        raw.peer.tls.rejects_peer_with = Some(Alert(42));
        raw.start(&[]);
        if raw.side.is_server() {
            raw.forget();
            raw.shake_hands();
        }
        assert_eq!(raw.error(), Some((Transport, CRYPTO_ERROR + 42)));
        assert_eq!(raw.reason, b"TLS alert");
        assert_eq!(raw.packets(), packets);
    }
    let mut raw = Raw::client();
    raw.peer.tls.rejects_peer_with = Some(Alert(120));
    raw.start(&[]);
    assert_eq!(raw.error(), Some((Transport, CRYPTO_ERROR + 120)));
    assert_eq!(raw.reason, b"no application protocol");

    let mut raw = Raw::client();
    raw.start(&[]);
    raw.send_in(Handshake, "crypto 4 #0000, crypto 0 #63000002");
    assert_eq!(raw.error(), Some((Transport, CRYPTO_ERROR + 10)));

    let mut raw = Raw::server();
    raw.peer.tls.fails_to_start = true;
    raw.start(&[]);
    assert_eq!(raw.events(), "closed with close 0x150");
    assert_eq!(raw.packets(), "");
}

/// RFC 9001 §4.1.3.
#[test]
fn new_data_at_a_level_that_is_over() {
    for mut raw in Raw::both() {
        raw.start(&[]);
        let frame = format!("crypto {} a", raw.hello().len());
        raw.send_in(Initial, &format!("hello, {frame}"));
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.shake_hands();
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.error(), None);
    raw.send_in(Handshake, &format!("crypto {} a", raw.flight().len()));
    assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
}

/// RFC 9001 §5.7.
#[test]
fn packets_that_are_ahead_of_their_keys() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.forget();
    raw.send("handshake_done, fin 3 0 a");
    raw.send_in(Handshake, "flight");
    assert_eq!((raw.packets(), raw.events()), Default::default());
    raw.send_in(Initial, "ack, hello");
    assert_eq!(
        raw.events(),
        "ready, confirmed, 3 opened, 3 fin a, 3 closed"
    );
    assert_eq!(raw.connection().stats().packets_received, 3);

    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    raw.send("fin 0 0 a");
    raw.send_in(Handshake, "ack");
    assert_eq!((raw.packets(), raw.events()), Default::default());
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.events(), "ready, confirmed, 0 opened, 0 fin a");
}

#[test]
fn waiting_for_keys_is_not_part_of_the_round_trip() {
    let mut raw = Raw::client().with_ticket();
    raw.send_all(&[(Initial, "hello"), (Early, "fin 0 0 a")]);
    raw.peer.send(0, b"b", true);
    raw.advance(RTT);
    raw.send_all(&[(Initial, "ack"), (Handshake, "ack"), (Short, "ack")]);
    raw.advance(1000);
    raw.send_in(Handshake, "flight");
    assert_eq!(raw.connection().stats().smoothed_rtt.as_millis(), RTT);
}

/// RFC 9001 §4.9.
#[test]
fn keys_are_discarded() {
    for mut raw in Raw::both() {
        raw.start(&[]);
        let frames = ["ack", "ack, hello"][raw.side as usize];
        raw.send_in(Initial, frames);
        raw.forget();
        raw.send_in(Initial, "ping");
        assert_eq!(raw.outline(), "I[ack]");
        raw.send_in(Handshake, "ping");
        assert_eq!(raw.outline(), "H[ack]");
        raw.send_in(Initial, "ping");
        assert_eq!(raw.outline(), "");
        raw.send_in(Handshake, "ack, flight");
        raw.confirm();
        raw.forget();
        raw.send_in(Handshake, "ping");
        assert_eq!(raw.outline(), "");
    }
}

#[test]
fn tickets_and_tokens() {
    let ticket = format!("crypto 0 {}", show_hex(&message(TICKET, &[b"a"])));
    for (wants_tickets, events) in [(false, "token abc"), (true, "token abc, ticket")] {
        let raw = Raw::server().config(|it| it.wants_tickets = wants_tickets);
        let mut raw = raw.connected();
        raw.send(&format!("new_token abc, {ticket}"));
        raw.send(&ticket);
        assert_eq!(raw.events(), events);
        assert_eq!(raw.connection().tls().is_some(), wants_tickets);
    }
}

/// RFC 9000 §8.1.3.
#[test]
fn tokens_have_nothing_in_common() {
    let mut raw = Raw::client();
    let mut tokens = Vec::new();
    for _ in 0..2 {
        let now = raw.now;
        raw.start(&[]);
        raw.send_all(&[(Initial, "ack"), (Handshake, "ack, flight")]);
        assert!(raw.now == now && !raw.new_token.is_empty());
        tokens.push(raw.new_token.clone());
        raw = raw.again();
    }
    let same = (tokens[0].iter().zip(&tokens[1])).filter(|(a, b)| a == b);
    assert!(same.count() <= 2, "{tokens:?}");
}

#[test]
fn only_tickets_follow_the_handshake() {
    let stream = [
        message(TICKET, &[b"a"]),
        message(TICKET, &[&[FINISHED; 9]]),
        message(FINISHED, &[]),
    ]
    .concat();
    let unexpected = Some((Transport, CRYPTO_ERROR + 10));
    for (pieces, error) in [
        (&[(0, 26)][..], unexpected),
        (&[(0, 25)], None),
        (&[(0, 7), (7, 22), (22, 26)], unexpected),
        (&[(0, 12), (0, 5), (12, 26)], unexpected),
        (&[(0, 12), (12, 22)], None),
        (&[(22, 26), (0, 22)], None),
        (&[(0, 9), (9, 26)], None),
    ] {
        let mut raw = Raw::server().connected();
        for &(start, end) in pieces {
            raw.send(&format!("crypto {start} {}", show_hex(&stream[start..end])));
        }
        assert_eq!(raw.error(), error, "{pieces:?}");
    }
    for (wants_tickets, pause) in [(false, 0), (true, 0), (true, 3000)] {
        for (kind, error) in [(13, PROTOCOL_VIOLATION), (24, CRYPTO_ERROR + 10)] {
            let raw = Raw::server().config(|it| it.wants_tickets = wants_tickets);
            let mut raw = raw.connected();
            raw.advance(pause);
            raw.send(&format!("crypto 0 {}", show_hex(&message(kind, &[]))));
            assert_eq!(raw.error(), Some((Transport, error)));
        }
    }
}

#[test]
fn tickets_are_not_awaited_for_ever() {
    let ticket = message(TICKET, &[b"a"]);
    for (first, pauses, count, has_tls) in [
        ("handshake_done", &[1999, 999, 999][..], 3, true),
        ("handshake_done", &[1999, 1000], 1, false),
        ("handshake_done", &[2000], 0, false),
        ("handshake_done", &[1; 15], 15, true),
        ("handshake_done", &[1; 17], 16, false),
        ("ping", &[1, 3000], 2, true),
    ] {
        let mut raw = Raw::server().config(|it| it.wants_tickets = true);
        raw.start(&[]);
        raw.shake_hands();
        raw.send(first);
        for (at, &pause) in pauses.iter().enumerate() {
            raw.advance(pause);
            let offset = at * ticket.len();
            raw.send(&format!("crypto {offset} {}", show_hex(&ticket)));
        }
        assert_eq!(raw.peer.tickets.len(), count);
        assert_eq!(raw.connection().tls().is_some(), has_tls);
    }
}

#[test]
fn long_tickets_out_of_order() {
    let mut raw = Raw::server()
        .config(|it| it.wants_tickets = true)
        .connected();
    let tickets = message(TICKET, &[&[1; 16_000]]).repeat(3);
    let mut pieces: Vec<_> = tickets.chunks(1000).enumerate().collect();
    pieces.rotate_left(1);
    for (at, piece) in pieces {
        raw.send(&format!("crypto {} {}", at * 1000, show_hex(piece)));
    }
    assert_eq!(raw.events(), "ticket, ticket, ticket");
}

struct Careless(Box<Toy>);

impl Session for Careless {
    fn resume(&mut self, ticket: &[u8]) -> bool {
        self.0.resume(ticket)
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut tls::Handshake<'_>,
    ) -> Result<Status, Alert> {
        handshake.read_secret(Level::Initial, Cipher::Aes128GcmSha256, &[0; 32]);
        handshake.write_secret(Level::Initial, Cipher::Aes128GcmSha256, &[0; 32]);
        if let Some((Level::Application, _)) = input {
            handshake.send(Level::Initial, b"a");
            handshake.send(Level::Handshake, b"a");
            assert!(!handshake.peer_parameters(&[0, 0], false));
        }
        self.0.advance(input, handshake)
    }
}

#[test]
fn calls_of_tls_that_are_out_of_place() {
    let mut raw = Raw::server().config(|it| it.wants_tickets = true);
    let tls = Careless(Toy::new(Side::Client, raw.random, raw.peer.tls));
    let (config, tls) = (Rc::new(raw.peer.config.clone()), Box::new(tls));
    let endpoint = &mut raw.peer.endpoint;
    raw.peer.handle = Some(endpoint.connect(raw.now, config, raw.addresses, tls, &[]));
    raw.process();
    raw.shake_hands();
    raw.confirm();
    raw.forget();
    let ticket = show_hex(&message(TICKET, &[b"a"]));
    raw.send(&format!("crypto 0 {ticket}"));
    assert_eq!((raw.events(), raw.frames()), ("ticket".into(), "".into()));
}

/// Has keys for reading sooner than BoringSSL. Goes no further than that if it `stalls`.
struct Eager {
    inner: Box<Toy>,
    level: Option<Level>,
    stalls: bool,
}

impl Session for Eager {
    fn resume(&mut self, _: &[u8]) -> bool {
        false
    }

    fn advance(
        &mut self,
        input: Option<(Level, &[u8])>,
        handshake: &mut tls::Handshake<'_>,
    ) -> Result<Status, Alert> {
        let status = if self.stalls {
            let (_, parts) = next_message(&mut input.unwrap().1).unwrap();
            assert!(handshake.peer_parameters(parts[1], true));
            Status::InProgress
        } else {
            self.inner.advance(input, handshake)?
        };
        if let Some(level) = self.level.take() {
            let cipher = Options::default().cipher;
            handshake.read_secret(level, cipher, &secret(cipher, 1, level, Side::Client));
        }
        Ok(status)
    }
}

fn hello_to_eager_server(level: Level, stalls: bool) -> Raw {
    let mut raw = Raw::client();
    let mut hello = raw.packet(Initial, "hello");
    let versions = raw.peer.config.versions;
    let unrouted = (raw.peer.endpoint).receive(raw.now, &raw.addresses, &mut hello, versions);
    let Some(Unrouted::Incoming(incoming)) = unrouted else {
        panic!("not accepted");
    };
    let tls = Box::new(Eager {
        inner: Toy::new(Side::Server, 0, raw.peer.tls),
        level: Some(level),
        stalls,
    });
    let config = Rc::new(raw.peer.config.clone());
    raw.peer.handle = Some(raw.peer.endpoint.accept(raw.now, incoming, config, tls));
    raw.forget();
    raw
}

/// RFC 9001 §5.7.
#[test]
fn packets_wait_for_the_end_of_the_handshake_even_if_there_are_keys() {
    let mut raw = hello_to_eager_server(Level::Application, false);
    raw.send("stream 0 0 a");
    assert_eq!(raw.events(), "");
}

/// RFC 9001 §5.6.
#[test]
fn a_server_does_not_write_with_the_keys_for_early_data() {
    let mut raw = hello_to_eager_server(Level::EarlyData, true);
    raw.send_in(Early, "ping");
    assert_eq!(raw.connection().stats().pings_received, 1);
    raw.advance(100);
    assert_eq!(raw.packets(), "");
}

#[test]
fn datagrams_wait_for_keys() {
    for raw in Raw::both() {
        let mut raw = raw.with("max_datagram_frame_size=100");
        match raw.side {
            Side::Client => raw.send_in(Initial, "hello 0 100"),
            Side::Server => raw.start(&[]),
        }
        raw.forget();
        raw.connection().send_datagram(1, b"a".to_vec());
        assert_eq!(raw.packets(), "");
        raw.send_all(&[(Initial, "hello"), (Handshake, "flight")]);
        assert!(raw.frames().ends_with("datagram a"));
    }
}

#[test]
fn the_peer_closes_during_the_handshake() {
    for kind in [Initial, Handshake] {
        for mut raw in Raw::both() {
            raw.start(&[]);
            raw.send_in(Initial, "hello");
            raw.forget();
            raw.send_all(&[(kind, "close 0x128 6 no, ping"), (Handshake, "flight")]);
            assert_eq!(raw.events(), "closed by close 0x128 no");
            assert_eq!(raw.packets(), "");
        }
    }
}

#[test]
fn streams_can_be_opened_once_the_application_knows() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.peer.polls = false;
    raw.shake_hands();
    let available = |raw: &mut Raw| raw.connection().available_streams(Direction::Bidirectional);
    assert_eq!(available(&mut raw), 0);
    raw.peer.polls = true;
    assert_eq!(raw.events(), "ready");
    assert_eq!(available(&mut raw), 100);
    let id = raw.peer.open(Direction::Bidirectional);
    raw.forget();
    raw.peer.send(id, b"a", true);
    assert_eq!(raw.packets(), "1[fin 0 0 a]");
    raw.send_all(&[(Handshake, "ack"), (Short, "ack, fin 0 0 b")]);
    assert_eq!(raw.events(), "confirmed, 0 fin b, 0 closed");
}

/// RFC 9001 §4.1.2.
#[test]
fn acknowledgment_of_a_1_rtt_packet_confirms_the_handshake() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.shake_hands();
    raw.forget();
    raw.send("ack");
    assert_eq!(raw.events(), "confirmed");
    raw.send_all(&[(Handshake, "ping"), (Short, "handshake_done")]);
    raw.advance(RTT);
    assert_eq!((raw.events(), raw.outline()), ("".into(), "1[ack]".into()));
}

#[test]
fn a_server_does_not_probe_for_a_hello_that_has_arrived() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.forget();
    raw.wait();
    assert_eq!(raw.outline(), "I[crypto] H[crypto]");
    raw.send_in(Initial, "ack 0");
    raw.wait();
    assert_eq!(raw.outline(), "H[crypto]");
}

/// RFC 9002 §6.2.2.1.
#[test]
fn a_client_keeps_probing_while_the_server_may_be_unable_to_send() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.advance(RTT);
    raw.send_in(Initial, "ack");
    raw.forget();
    let mut timeouts = Vec::new();
    for _ in 0..3 {
        timeouts.push(raw.wait());
        let probe = raw.take().pop().unwrap();
        assert_eq!(probe.frames, ["ping"]);
        raw.send_in(Initial, &format!("ack {}", probe.number));
        raw.forget();
    }
    assert_eq!(timeouts, [40, 70, 122]);
}

/// RFC 9002 §6.2.2.1.
#[test]
fn a_server_probes_as_soon_as_it_can_send_again() {
    let mut raw = Raw::client();
    raw.start(&[]);
    raw.advance(2000);
    raw.waits = false;
    raw.send_in(Initial, "padding 1");
    let mut batch = Batch::default();
    (raw.peer.endpoint).poll_transmit(raw.now, &mut batch, 64, |_| {});
    assert_eq!(batch.len(), 1);
}

/// RFC 9002 §6.4.
#[test]
fn probe_timeout_starts_over_when_keys_are_discarded() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.forget();
    let timeout = raw.wait();
    raw.advance(timeout * 3 / 2);
    raw.send_all(&[(Initial, "hello"), (Handshake, "ping")]);
    raw.forget();
    assert_eq!((raw.wait(), raw.outline()), (timeout, "H[ping]".into()));
}

#[test]
fn backoff_ends_with_the_first_round_trip_time() {
    let mut raw = Raw::server();
    raw.start(&[]);
    for _ in 0..2 {
        raw.forget();
        raw.wait();
    }
    raw.forget();
    raw.advance(RTT);
    raw.send_in(Initial, "ack");
    assert_eq!((raw.wait(), raw.outline()), (2 * RTT, "I[ping]".into()));
}
