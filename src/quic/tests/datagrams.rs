//! RFC 9221.

use bun_quic::Direction::Unidirectional;
use bun_quic::{Duration, Side, StreamId};

use crate::harness::messages::GET;
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::filler;

fn both() -> [Raw; 2] {
    Raw::both().map(|raw| {
        let raw = raw.config(|it| it.parameters.max_datagram_frame_size = 100);
        raw.with("max_datagram_frame_size=65535").connected()
    })
}

#[test]
fn receives() {
    for mut raw in both() {
        for (frames, events) in [
            ("datagram a", "datagram a"),
            ("datagram -", "datagram -"),
            ("datagram a, ping, datagram b", "datagram a, datagram b"),
            ("ping, #30616263", "datagram abc"),
            ("padding 3, #30", "datagram -"),
            ("datagram *97", "datagram *97"),
        ] {
            raw.send(frames);
            assert_eq!(raw.events(), events);
        }
        raw.send(&format!("#30{}", "61".repeat(99)));
        assert_eq!(raw.events(), "datagram ~99");
    }
}

/// RFC 9221 §5.2.
#[test]
fn acknowledges() {
    for mut raw in both() {
        raw.send("datagram a");
        raw.events();
        assert_eq!((raw.wait(), raw.packets()), (5, "1[ack 0-1 +625]".into()));
    }
}

#[test]
fn tells_what_became_of_them() {
    for mut raw in both() {
        for (id, data) in [(7, "a"), (8, "b")] {
            raw.connection().send_datagram(id, data.into());
        }
        assert_eq!(raw.lose(), "datagram a, datagram b");
        raw.connection().send_datagram(9, Vec::new());
        assert_eq!(raw.frames(), "datagram -");
        raw.advance(RTT);
        raw.send("ack");
        assert_eq!(raw.events(), "datagram 9 acked");
        raw.wait();
        assert_eq!(raw.events(), "datagram 7 lost, datagram 8 lost");
        assert_eq!(raw.frames(), "");
        assert_eq!(raw.connection().stats().datagrams_sent, 3);
    }
}

#[test]
fn probes_do_not_repeat_them() {
    for (is_lost, events) in [(true, "datagram 1 lost"), (false, "datagram 1 acked")] {
        for mut raw in both() {
            raw.connection().send_datagram(1, "a".into());
            match is_lost {
                true => raw.lose(),
                false => raw.frames(),
            };
            raw.wait();
            assert_eq!(raw.frames(), "ping, ping");
            assert_eq!(raw.events(), "");
            raw.send("ack");
            assert_eq!(raw.events(), events);
        }
    }
}

/// RFC 9221 §3 and §5.
#[test]
fn what_is_too_long_is_given_up() {
    const ROOM: usize = 1200 - (1 + 8 + 2) - 16;
    for (limit, len, fits) in [
        ("", 0, false),
        ("0", 0, false),
        ("1", 0, false),
        ("2", 0, true),
        ("65", 63, true),
        ("65", 64, false),
        ("67", 64, true),
        ("66", 64, false),
        ("65535", ROOM - 3, true),
        ("65535", ROOM - 2, false),
    ] {
        let raw = Raw::client().with(&format!("max_datagram_frame_size={limit}"));
        let mut raw = raw.connected();
        raw.connection().send_datagram(1, filler(0, len));
        assert_eq!(raw.take().len(), usize::from(fits), "{limit} {len}");
        let events = if fits { "" } else { "datagram 1 abandoned" };
        assert_eq!(raw.events(), events);
        assert_eq!(raw.connection().stats().datagrams_sent, u64::from(fits));
    }
}

#[test]
fn share_packets_with_other_frames() {
    let [mut raw, _] = both();
    raw.send("ping");
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 600), false);
    for (id, len) in [(1, 600), (2, 2000), (3, 97), (4, 1170), (5, 700)] {
        raw.connection().send_datagram(id, filler(0, len));
    }
    assert_eq!(
        raw.packets(),
        "1[ack 0-1, datagram *600, datagram *97, stream 3 0 *463]; 1[datagram *1170]; \
         1[datagram *700, stream 3 463 *137]"
    );
    assert_eq!(raw.events(), "datagram 2 abandoned");
}

#[test]
fn what_is_lost_goes_first() {
    let [mut raw, _] = both();
    raw.request_packets("abcd");
    raw.advance(RTT);
    raw.waits = false;
    raw.send("ack 4");
    raw.connection().send_datagram(1, b"e".to_vec());
    assert_eq!(raw.frames(), "stream 3 0 a, datagram e");
}

#[test]
fn acknowledgment_that_leaves_no_room_goes_first() {
    let [mut raw, _] = both();
    raw.send("ping");
    raw.connection().send_datagram(1, filler(0, 1170));
    assert_eq!(raw.packets(), "1[ack 0-1]; 1[datagram *1170]");
}

/// RFC 9221 §5.4.
#[test]
fn wait_for_congestion_control() {
    let [mut raw, _] = both();
    (0..100).for_each(|id| raw.connection().send_datagram(id, filler(0, 1100)));
    let sent = raw.take().len();
    assert_eq!(raw.connection().unsent_datagrams(), 100 - sent);
    assert_eq!(raw.connection().drop_oldest_datagram(), Some(sent as u64));
    assert_eq!(raw.connection().unsent_datagrams(), 99 - sent);
    while raw.connection().drop_oldest_datagram().is_some() {}
    raw.advance(10);
    assert_eq!(raw.packets(), "");
}

#[test]
fn do_not_wait_for_one_another() {
    for mut raw in both() {
        for id in 0..40 {
            raw.now = raw.now + Duration::from_micros(100);
            raw.connection().send_datagram(id, b"a".to_vec());
            assert_eq!(raw.frames(), "datagram a");
        }
    }
}

/// RFC 9297 §2.1.1.
#[test]
fn wait_for_the_settings_of_http3() {
    for (settings, frames, events) in [
        ("0x33=1", "datagram a", ""),
        ("0x33=0", "", "datagram 1 abandoned"),
        ("", "", "datagram 1 abandoned"),
    ] {
        for side in [Side::Client, Side::Server] {
            let mut raw = (Raw::http3(side).with("max_datagram_frame_size=100")).connected();
            raw.connection().send_datagram(1, b"a".to_vec());
            assert_eq!((raw.frames(), raw.events()), Default::default());
            raw.write(raw.unidirectional(0), &[0], false);
            raw.write_control(&format!("settings {settings}"));
            assert_eq!((raw.frames(), raw.events()), (frames.into(), events.into()));
        }
    }
}

#[test]
fn control_frames_of_http3_go_first() {
    let raw = Raw::http3(Side::Client).with("max_datagram_frame_size=100");
    let mut raw = raw.connected_with("0x33=1");
    raw.write_http3(0, &format!("headers {GET}"), false);
    raw.send("ack");
    raw.forget();
    raw.connection().send_datagram(1, b"a".to_vec());
    raw.connection().set_paused(StreamId(0), true);
    raw.connection().go_away();
    assert!(raw.outline().ends_with("stream, datagram]"));
}

#[test]
fn what_only_fits_with_a_short_header_waits_for_it() {
    let raw = Raw::server().with("max_datagram_frame_size=65535");
    let mut raw = raw.with_ticket();
    raw.resume();
    raw.forget();
    raw.connection().send_datagram(1, vec![0; 1160]);
    assert_eq!(raw.events(), "");
    raw.shake_hands();
    assert_eq!(raw.connection().stats().datagrams_sent, 1);
}
