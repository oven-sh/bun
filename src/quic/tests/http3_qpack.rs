use bun_quic::Side::{self, Client, Server};
use bun_quic::{Direction, Duration, StreamId};

use crate::harness::messages::{GET, OK};
use crate::harness::network::Network;
use crate::harness::raw::Raw;
use crate::harness::wire::{bytes, http3, show_hex};

const BOTH: [Side; 2] = [Client, Server];
const CAPACITY: &str = "#3fe11f";
const INSERT_AB: &str = "#41610162";
const INSERT_CD: &str = "#41630164";

/// A prefix, the lines of `Raw::head`, and more lines.
fn headers(raw: &Raw, prefix: &str, more: &str) -> String {
    let head = ["d1d7500161c1", "d9"][raw.side as usize];
    format!("headers #{prefix}{head}{more}")
}

#[test]
fn acknowledges_insertions_and_sections() {
    for side in BOTH {
        let mut raw = Raw::http3(side).exchange();
        for byte in bytes(&[CAPACITY, INSERT_AB, INSERT_CD].concat()) {
            raw.write_encoder(&show_hex(&[byte]));
        }
        assert_eq!(raw.read_decoder(), "increment 1, increment 1");
        raw.write_http3(0, &headers(&raw, "0200", "80"), false);
        assert_eq!(raw.read_decoder(), "ack 0");
        raw.write_http3(0, "headers #03811110", true);
        assert_eq!(raw.read_decoder(), "ack 0");
        let events = format!("0 Head {} a=b, 0 Trailers c=d a=b, 0 fin -", raw.head());
        assert!(raw.events().starts_with(&events));
    }
}

#[test]
fn instructions_wait_for_a_packet() {
    let mut raw = Raw::http3(Client).exchange();
    raw.write_encoder(&format!("{CAPACITY}, {INSERT_AB}"));
    raw.connection().acknowledge();
    raw.forget();
    assert_eq!((raw.wait(), raw.frames()), (5, "stream 7 1 #01".into()));
    raw.write_encoder(INSERT_CD);
    raw.peer.send_headers(0, OK);
    assert_eq!(raw.frames(), "stream 7 2 #01, stream 0 0 #01030000d9");
    assert!(raw.sleeps_for() > 5);
}

#[test]
fn a_section_waits_for_what_it_refers_to() {
    for side in BOTH {
        for (polls, len) in [(true, 1), (true, 99), (false, 1), (false, 99)] {
            let mut raw = Raw::http3(side).exchange();
            raw.peer.polls = polls;
            let frames = headers(&raw, "0300", "8081") + ", data a, headers #040080";
            let stream = http3(&frames);
            stream.chunks(len).for_each(|it| raw.write(0, it, false));
            raw.write(0, &[], true);
            raw.write_encoder(&format!("{CAPACITY}, {INSERT_AB}"));
            raw.peer.polls = true;
            assert_eq!(raw.events(), "");
            assert_eq!(raw.read_decoder(), "increment 1");
            raw.write_encoder(INSERT_CD);
            let events = format!("0 Head {} c=d a=b, 0 data a", raw.head());
            assert_eq!(raw.events(), events);
            assert_eq!(raw.read_decoder(), "ack 0");
            raw.write_encoder(INSERT_AB);
            assert!(raw.events().starts_with("0 Trailers a=b, 0 fin -"));
            assert_eq!(raw.read_decoder(), "ack 0");
        }
    }
}

#[test]
fn trailers_that_had_to_wait_follow_the_content() {
    let mut raw = Raw::http3(Client).exchange();
    raw.write_http3(0, &format!("headers {GET}"), false);
    raw.forget();
    raw.peer.polls = false;
    raw.write_http3(0, "data a, headers #020080", true);
    raw.write_encoder(&format!("{CAPACITY}, {INSERT_AB}"));
    raw.peer.polls = true;
    assert_eq!(raw.events(), "0 data a, 0 Trailers a=b, 0 fin -");
}

#[test]
fn only_the_streams_that_refer_to_it_wait() {
    let mut raw = Raw::http3(Client).connected_with("");
    for (id, prefix, line) in [
        (0, "0300", "80"),
        (4, "0200", "80"),
        (8, "0000", ""),
        (12, "0200", "80"),
    ] {
        raw.write_http3(id, &headers(&raw, prefix, line), false);
    }
    let events = format!("0 opened, 4 opened, 8 opened, 8 Head {GET}, 12 opened");
    assert_eq!(raw.events(), events);
    raw.write_encoder(&format!("{CAPACITY}, {INSERT_AB}"));
    raw.peer.log.sort();
    assert_eq!(raw.events(), format!("12 Head {GET} a=b, 4 Head {GET} a=b"));
    raw.write_encoder(INSERT_CD);
    assert_eq!(raw.events(), format!("0 Head {GET} c=d"));
}

#[test]
fn errors() {
    for side in BOTH {
        for (index, instructions, code) in [
            (1, "#3fe21f", 0x201),
            (1, "#3fe11fff240161", 0x201),
            (2, "#00", 0x202),
            (2, "#01", 0x202),
            (2, "#80", 0x202),
        ] {
            let mut raw = Raw::http3(side).connected_with("");
            raw.write_http3(raw.unidirectional(index), instructions, false);
            assert_eq!(raw.http3_error(), Some(code), "{instructions}");
        }
        for len in [1, 99] {
            let mut raw = Raw::http3(side).exchange();
            let frame = http3(&headers(&raw, "0000", "ff24"));
            let (last, start) = frame.split_last().unwrap();
            start.chunks(len).for_each(|it| raw.write(0, it, false));
            raw.write(0, &[*last], false);
            assert_eq!(raw.http3_error(), Some(0x200));
        }
    }
}

#[test]
fn uses_the_table_that_the_peer_allows() {
    for (is_wanted, settings, is_used) in [
        (true, "1=4096 7=100", true),
        (true, "1=100 7=0", true),
        (true, "1=0 7=100", false),
        (true, "", false),
        (false, "1=4096 7=100", false),
    ] {
        for side in BOTH {
            let raw = Raw::http3(side).http3_config(|it| it.encodes_with_dynamic_table = is_wanted);
            let mut raw = raw.connected_with(settings);
            let fields = format!("{} abc=defghijklmno", [OK, GET][side as usize]);
            for id in (0..40).step_by(4) {
                match side {
                    Client => {
                        raw.write_http3(id, &format!("headers {GET}"), true);
                        raw.peer.send_headers(id, &fields);
                        raw.connection().finish(StreamId(id));
                    }
                    Server => drop(raw.request(&fields)),
                }
                assert_eq!(raw.read_http3(id), format!("headers {fields}"));
                let instructions = std::mem::take(raw.decoder.instructions());
                raw.write(raw.unidirectional(2), &instructions, false);
            }
            let len = raw.streams[&(10 | !side as u64)].len();
            assert!(if is_used { len > 4 } else { len == 1 }, "{settings}");
            assert_eq!(raw.error(), None);
        }
    }
}

#[test]
fn stays_in_step_over_a_lossy_network() {
    for seed in 0..8 {
        let mut network = Network::new(seed);
        network.config(|it| {
            crate::harness::http3(it);
            it.http3.as_mut().unwrap().encodes_with_dynamic_table = true;
        });
        network.connect();
        network.run_for(Duration::from_millis(100));
        (network.loss_per_mille, network.jitter) = (100, Duration::from_millis(20));
        let fields = |id: u64| format!("a{}=b{} c=d{}", id % 28, id % 12, id / 40);
        for round in 0..20 {
            let ids = (round * 40..).step_by(4).take(10);
            for id in ids.clone() {
                network.client.open(Direction::Bidirectional);
                (network.client).send_headers(id, &format!("{GET} {}", fields(id)));
                network.client.connection().finish(StreamId(id));
            }
            for id in ids.clone() {
                let head = format!("{id} Head {GET} {}", fields(id));
                network.run_until(|it| it.server.has_logged(&head));
                (network.server).send_headers(id, &format!("{OK} {}", fields(id)));
                network.server.connection().finish(StreamId(id));
            }
            for id in ids {
                let head = format!("{id} Head {OK} {}", fields(id));
                network.run_until(|it| it.client.has_logged(&head));
            }
            network.server.log.clear();
            network.client.log.clear();
        }
    }
}
