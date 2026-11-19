use bun_quic::Layer::Transport;
use bun_quic::Version;
use bun_quic::transport_code::TRANSPORT_PARAMETER_ERROR;

use crate::harness::raw::Kind::{Handshake, Initial};
use crate::harness::raw::{RTT, Raw};

/// RFC 9000 §17.2.5.2.
#[test]
fn a_client_starts_again_with_the_token() {
    for versions in [&[Version::V1], &[Version::V2], &[Version::Draft29]] {
        for len in [1, 63, 64, 500] {
            let mut raw = Raw::server().config(|it| it.versions = versions);
            raw.start(&[]);
            let first = raw.take().remove(0);
            assert_eq!((first.number, &first.token[..]), (0, &[][..]));
            let token = vec![7; len];
            raw.send_retry(&token);
            let second = raw.take().remove(0);
            assert_eq!((second.number, &second.token), (1, &token));
            assert_eq!((second.frames, second.source), (first.frames, first.source));
            assert_eq!(second.destination, b"retry-id");
            raw.send_in(Initial, "ack, hello");
            let third = raw.take().remove(0);
            assert_eq!(
                (third.token, third.destination),
                (token, raw.source.clone())
            );
            raw.send_in(Handshake, "flight");
            assert_eq!(raw.events(), "ready");
        }
    }
}

/// RFC 9002 §6.3.
#[test]
fn recovery_starts_again() {
    let mut raw = Raw::server();
    raw.start(&[]);
    raw.advance(150 + 300 + RTT);
    raw.send_retry(b"token");
    raw.forget();
    assert_eq!(raw.wait(), 150);
    assert_eq!(raw.take()[0].token, b"token");
    let stats = raw.connection().stats();
    assert_eq!((stats.packets_lost, stats.min_rtt.as_millis()), (0, 0));
}

#[test]
fn packets_that_a_client_discards() {
    let cases: [fn(&mut Raw) -> Vec<u8>; 5] = [
        |raw| raw.retry(b""),
        |raw| {
            let mut packet = raw.retry(b"token");
            *packet.last_mut().unwrap() ^= 1;
            packet
        },
        |raw| {
            raw.source.clone_from(&raw.original);
            raw.retry(b"token")
        },
        |raw| {
            raw.send_in(Initial, "ack");
            raw.retry(b"token")
        },
        |raw| {
            raw.send_retry(b"first");
            raw.retry(b"second")
        },
    ];
    for case in cases {
        let mut raw = Raw::server();
        raw.start(&[]);
        let packet = case(&mut raw);
        raw.forget();
        raw.deliver(&packet);
        assert_eq!(raw.packets(), "");
        raw.shake_hands();
        assert_eq!(raw.events(), "ready");
    }
}

/// RFC 9000 §7.3.
#[test]
fn the_server_has_to_repeat_the_ids() {
    for parameter in [
        "retry_source_connection_id=",
        "retry_source_connection_id=raw-id-0",
        "original_destination_connection_id=retry-id",
        "initial_source_connection_id=retry-id",
    ] {
        let mut raw = Raw::server().with(parameter);
        raw.start(&[]);
        raw.send_retry(b"token");
        raw.shake_hands();
        assert_eq!(raw.error(), Some((Transport, TRANSPORT_PARAMETER_ERROR)));
    }
    let mut raw = Raw::server();
    raw.source = b"retry-id".to_vec();
    raw.start(&[]);
    raw.send_retry(b"token");
    raw.shake_hands();
    assert_eq!(raw.events(), "ready");
}
