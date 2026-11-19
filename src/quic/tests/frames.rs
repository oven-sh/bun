use bun_quic::Layer::Transport;
use bun_quic::transport_code::*;

use crate::harness::raw::Kind::{Handshake, Short};
use crate::harness::raw::Raw;
use crate::harness::wire::{FRAMES, MAX, frames};

/// One of each type, with integers of all lengths.
const SAMPLES: [&str; 25] = [
    "ping",
    "ack 70000-70100 100-200 5 +1000",
    "reset_stream 0 0x4000 64",
    "stop_sending 0 0x40000000",
    "crypto 64 abc",
    "new_token abc",
    "stream 0 64 abc",
    "fin 0 64 abc",
    "max_data 64",
    "max_stream_data 0 64",
    "max_streams_bidi 64",
    "max_streams_uni 64",
    "data_blocked 64",
    "stream_data_blocked 0 64",
    "streams_blocked_bidi 64",
    "streams_blocked_uni 64",
    "new_connection_id 1 0 raw-id-1 *16",
    "retire_connection_id 64",
    "path_challenge *8",
    "path_response *8",
    "close 1 2 abc",
    "application_close 1 abc",
    "handshake_done",
    "datagram abc",
    "ack_frequency 0 2 20000 1",
];

#[test]
fn truncated_frames() {
    let has_sample = |name| SAMPLES.iter().any(|it| it.starts_with(name));
    assert!(FRAMES.iter().all(|it| has_sample(it.1)));
    for sample in SAMPLES.into_iter().chain(["#0300000000010203"]) {
        let frame = frames(sample);
        for len in 1..frame.len() {
            let mut raw = Raw::client().connected();
            let packet = raw.seal(Short, frame[..len].to_vec());
            raw.deliver(&packet);
            let error = Some((Transport, FRAME_ENCODING_ERROR));
            assert_eq!(raw.error(), error, "{sample} {len}");
        }
    }
}

#[test]
fn values_out_of_range() {
    let count = (1u64 << 60) + 1;
    for frame in [
        "#1f",
        "#4040",
        "#0201000002",
        "#02050001000400",
        "#02050001000103",
        "new_token -",
        &format!("stream 0 {MAX} a"),
        &format!("crypto {MAX} a"),
        &format!("max_streams_bidi {count}"),
        &format!("max_streams_uni {count}"),
        &format!("streams_blocked_bidi {count}"),
        &format!("streams_blocked_uni {count}"),
        "new_connection_id 1 2 raw-id-1 *16",
        "new_connection_id 1 0 - *16",
        "new_connection_id 1 0 *21 *16",
        "ack_frequency 0 2 20000 2",
    ] {
        for raw in Raw::both() {
            let mut raw = raw.connected();
            raw.send(frame);
            let error = Some((Transport, FRAME_ENCODING_ERROR));
            assert_eq!(raw.error(), error, "{frame}");
        }
    }
}

#[test]
fn forms_of_stream_frames() {
    let mut raw = Raw::client().connected();
    raw.send("#0a000161, #0e00010162, #0c0002636465");
    raw.send("#0b040161, #0908616263");
    raw.send("#080c616263");
    raw.send("#0d0c0364");
    assert_eq!(
        raw.events(),
        "0 opened, 0 data abcde, 4 opened, 8 opened, 4 fin a, 8 fin abc, \
         12 opened, 12 data abc, 12 fin d"
    );
}

#[test]
fn frames_without_consequences() {
    for raw in Raw::both() {
        let mut raw = raw.connected();
        raw.send("#0300000000010203, padding 1, ping, padding 20, ping, padding 8");
        raw.send("data_blocked 99999999, streams_blocked_bidi 1, streams_blocked_uni 1");
        raw.send("max_data 1, max_streams_bidi 1, max_streams_uni 1");
        assert_eq!((raw.frames(), raw.events()), Default::default());
        assert_eq!(raw.connection().stats().pings_received, 2);
    }
}

#[test]
fn frames_that_only_a_server_sends() {
    for frame in ["new_token abc", "handshake_done"] {
        let mut raw = Raw::client().connected();
        raw.send(frame);
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
}

#[test]
fn frames_that_handshake_packets_cannot_have() {
    let is_allowed = |it: &&str| ["ping", "ack ", "cryp", "clos"].contains(&&it[..4]);
    for sample in SAMPLES.into_iter().filter(|it| !is_allowed(it)) {
        for mut raw in Raw::both() {
            raw.start(&[]);
            raw.shake_hands_with(sample);
            let error = Some((Transport, PROTOCOL_VIOLATION));
            assert_eq!(raw.error(), error, "{sample}");
        }
    }
}

#[test]
fn packets_without_frames_or_with_reserved_bits() {
    for (flipped, frames) in [(0, ""), (0x08, "ping"), (0x10, "ping")] {
        let mut raw = Raw::client().connected();
        raw.flipped = flipped;
        raw.send(frames);
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
    for flipped in [0x04, 0x08] {
        let mut raw = Raw::client();
        raw.start(&[]);
        raw.flipped = flipped;
        raw.send_in(Handshake, "ping");
        assert_eq!(raw.error(), Some((Transport, PROTOCOL_VIOLATION)));
    }
}
