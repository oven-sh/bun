//! Streams that are sent in order, by an application that writes when it is asked to.

use bun_quic::Direction::Unidirectional;
use bun_quic::{Connection, Duration, Event, Side, StreamId};

use crate::harness::messages::{GET, OK};
use crate::harness::network::Network;
use crate::harness::priority;
use crate::harness::raw::{RTT, Raw};
use crate::harness::wire::filler;

fn path(bytes_per_second: u64) -> Network {
    let mut network = Network::new(1);
    network.config(|it| {
        it.sends_in_order = true;
        it.parameters.initial_max_data = 90_000_000;
        it.parameters.initial_max_stream_data_uni = 90_000_000;
        it.parameters.initial_max_streams_uni = 9000;
    });
    (network.bytes_per_second, network.max_queueing) = (bytes_per_second, Duration::from_secs(1));
    network.connect();
    network.client.waits_to_be_asked = true;
    network
}

impl Network {
    fn open(&mut self, urgency: u8, is_incremental: bool) -> u64 {
        let id = self.client.open(Unidirectional);
        (self.client.connection()).set_priority(StreamId(id), priority(urgency, is_incremental));
        id
    }

    fn upload(&mut self, urgency: u8, len: usize) -> u64 {
        let id = self.open(urgency, false);
        self.client.send(id, &filler(0, len), true);
        id
    }

    fn got(&self, id: u64) -> usize {
        (self.server.streams.get(&id)).map_or(0, |it| it.received.len())
    }

    /// Returns how much of `others` arrives in the meantime that had not been asked for.
    fn passed_until(&mut self, others: &[u64], is_done: impl Fn(&Self) -> bool) -> usize {
        let on_its_way = |&id| self.client.streams[&id].written;
        let before = others.iter().map(on_its_way).sum::<usize>();
        self.run_until(is_done);
        (others.iter().map(|&id| self.got(id)).sum::<usize>()).saturating_sub(before)
    }

    fn ends(&self, id: u64) -> bool {
        (self.server.streams.get(&id)).is_some_and(|it| it.is_read_to_end)
    }
}

#[test]
fn little_more_is_asked_for_than_can_be_sent() {
    for (rate, kept) in [
        (100_000, 500..1500),
        (1_000_000, 2000..5000),
        (10_000_000, 20_000..40_000),
        (100_000_000, 60_000..70_000),
    ] {
        let mut network = path(rate);
        let len = (rate as usize * 2).min(8_000_000);
        let id = network.upload(3, len);
        network.run_until(|it| it.got(id) > len / 2);
        let written = network.client.streams[&id].written;
        network.client.connection().reset(StreamId(id), 0);
        network.run_for(Duration::from_secs(2));
        assert!(kept.contains(&(written - network.got(id))), "{rate}");
    }
}

/// With a stream that has not sent anything, and others that have for a while.
fn under_way(others: &[(u8, usize)]) -> (Network, u64, Vec<u64>) {
    let mut network = path(250_000);
    let oldest = network.open(3, false);
    let ids = Vec::from_iter(others.iter().map(|it| network.upload(it.0, it.1)));
    network.run_for(Duration::from_secs(2));
    (network, oldest, ids)
}

#[test]
fn an_older_or_more_urgent_stream_goes_next() {
    for (others, is_new) in [
        (&[(3, 1_000_000)][..], false),
        (&[(3, 3_000_000)], false),
        (&[(3, 1_000_000); 4], false),
        (&[(6, 1_000_000); 4], true),
        (&[(6, 8000); 90], true),
    ] {
        for (len, max_passed) in [(100, 0), (20_000, 2048)] {
            let (mut network, mut id, others) = under_way(others);
            if is_new {
                id = network.open(3, false);
            }
            network.client.send(id, &filler(0, len), true);
            assert!(network.passed_until(&others, |it| it.ends(id)) <= max_passed);
        }
    }
}

#[test]
fn short_streams_pass() {
    for (urgency, len, kilobytes) in [
        (3, 100, 0..2),
        (3, 2048, 15..18),
        (3, 5000, 39..43),
        (3, 8192, 64..69),
        (3, 8193, 500..530),
        (4, 100, 0..2),
        (4, 8192, 64..69),
        (4, 8193, 100..120),
        (4, 20_000, 430..470),
    ] {
        let (mut network, _, others) = under_way(&[(3, 1_000_000)]);
        let id = network.upload(urgency, len);
        let passed = network.passed_until(&others, |it| it.ends(id));
        assert!(kilobytes.contains(&(passed / 1000)), "{urgency} {len}");
    }
}

#[test]
fn starts_and_ends_pass() {
    for (sent, unsent, finishes) in [(0, 100, false), (0, 0, true), (9, 0, true), (9, 100, false)] {
        let (mut network, _, others) = under_way(&[(3, 1_000_000)]);
        let id = network.open(3, false);
        network.client.waits_to_be_asked = false;
        network.client.send(id, &filler(0, sent), false);
        network.run_until(|it| it.got(id) == sent);
        network.client.send(id, &filler(0, unsent), finishes);
        if sent + usize::from(finishes) == 0 {
            network.client.waits_to_be_asked = true;
            network.client.send(id, &filler(0, 90_000), false);
        }
        let is_there = |it: &Network| it.got(id) >= sent + unsent && it.ends(id) == finishes;
        assert!(network.passed_until(&others, is_there) < 3000);
    }
}

#[test]
fn what_passes_gets_a_small_part_of_the_path() {
    for (urgency, is_incremental, count, len, percent) in [
        (3, false, 200, 500, 11..14),
        (3, false, 90, 2000, 11..14),
        (3, false, 90, 8000, 11..14),
        (3, true, 90, 8000, 11..14),
        (4, false, 90, 8000, 13..16),
        (4, true, 90, 8000, 13..16),
        (3, false, 9, 90_000, 0..1),
        (4, false, 9, 90_000, 2..4),
        (4, true, 9, 90_000, 2..4),
    ] {
        let (mut network, _, first) = under_way(&[(3, 1_000_000)]);
        let others = Vec::from_iter((0..count).map(|_| {
            let id = network.open(urgency, is_incremental);
            network.client.send(id, &filler(0, len), true);
            id
        }));
        let left = 1_000_000 - network.client.streams[&first[0]].written;
        let passed = network.passed_until(&others, |it| it.ends(first[0]));
        assert!(percent.contains(&(passed * 100 / left)), "{count} {len}");
    }
}

#[test]
fn less_urgent_streams_do_not_starve_beside_many_short_ones() {
    for (len, is_asked, kilobytes) in [
        (100, true, 64..68),
        (100, false, 0..1),
        (5000, true, 185..200),
    ] {
        let (mut network, _, others) = under_way(&[(0, 1000); 900]);
        network.client.waits_to_be_asked = is_asked;
        let id = network.upload(3, len);
        let passed = network.passed_until(&others, |it| it.ends(id));
        assert!(kilobytes.contains(&(passed / 1000)), "{len}");
    }
}

#[test]
fn short_streams_do_not_pass_each_other() {
    let (mut network, _, ids) = under_way(&[(3, 1000); 900]);
    while let Some(first) = ids.iter().position(|&id| !network.ends(id)) {
        assert!(!ids[first..].iter().any(|&id| network.ends(id)));
        network.run_for(Duration::from_millis(20));
    }
}

#[test]
fn a_long_stream_has_whole_turns_on_a_slow_path() {
    let (mut network, _, long) = under_way(&[(3, 3_000_000)]);
    let other = network.upload(3, 200_000);
    let first = network.passed_until(&long, |it| it.got(other) > 16_000);
    let rest = network.passed_until(&long, |it| it.ends(other));
    assert!(first < 1500 && (170_000..190_000).contains(&rest));
}

const AMPLE: &str = "max_data=90000000 max_stream_data_uni=9000000 max_streams_uni=99";

fn asked(parameters: &str) -> Raw {
    let raw = Raw::client().config(|it| it.sends_in_order = true);
    let mut raw = raw.with(AMPLE).with(parameters).connected();
    raw.send("ack");
    raw.peer.waits_to_be_asked = true;
    raw
}

impl Raw {
    /// After being busy for so long. Returns how much a stream has sent.
    fn wake_after(&mut self, millis: u64, id: u64) -> usize {
        self.now = self.now + Duration::from_millis(millis);
        self.process();
        self.streams[&id].len()
    }
}

#[test]
fn a_sender_that_wakes_late_asks_for_more() {
    let mut raw = asked("");
    let id = raw.peer.open(Unidirectional);
    raw.peer.send(id, &filler(0, 900_000), true);
    let sent = [0, 1, 1, 3].map(|millis| raw.wake_after(millis, id) / 1000);
    assert_eq!(sent, [18, 18, 31, 47]);
    assert_eq!(raw.events(), ["3 writable"; 3].join(", "));
}

#[test]
fn little_of_a_small_window_is_kept_in_stock() {
    for (window, kept) in [(9_000_000, 12_780), (64_000, 11_972), (32_000, 9972)] {
        let mut raw = asked(&format!("max_data={window}"));
        let id = raw.peer.open(Unidirectional);
        raw.peer.send(id, &filler(0, 900_000), true);
        let sent = raw.wake_after(0, id);
        assert_eq!(raw.peer.streams[&id].written - sent, kept);
    }
}

#[test]
fn time_is_made_up_for_if_more_is_awaited() {
    type Action = fn(&mut Connection, StreamId);
    let actions: [(Action, _); 6] = [
        (|_, _| {}, 44),
        (|it, id| it.await_data(id, true), 44),
        (|it, id| it.await_data(id, false), 33),
        (|it, id| it.finish(id), 33),
        (|it, id| it.reset(id, 0), 33),
        (|it, id| (it.finish(id), it.await_data(id, true)).1, 33),
    ];
    for (action, expected) in actions {
        let mut raw = asked("");
        let [id, other] = [(); 2].map(|()| raw.peer.open(Unidirectional));
        raw.peer.send(id, &filler(0, 26_000), false);
        raw.process();
        raw.connection().await_data(StreamId(other), true);
        action(raw.connection(), StreamId(other));
        assert_eq!(raw.wake_after(4, id), 26_000);
        raw.peer.send(id, &filler(0, 90_000), false);
        assert_eq!(raw.wake_after(0, id) / 1000, expected);
    }
}

#[test]
fn an_invitation_ends_when_the_stream_gets_in_line_again() {
    let mut raw = asked("");
    let id = StreamId(raw.peer.open(Unidirectional));
    raw.connection().want_write(id);
    raw.peer.poll(raw.now);
    let (data, window) = (
        filler(0, 900_000),
        raw.connection().stats().congestion_window,
    );
    let written = [100, 900_000, 900_000].map(|len| raw.connection().write(id, &data[..len]));
    let [first, asked_for, rest] = written.map(|it| it.unwrap() as u64);
    assert!(first + asked_for < window);
    assert_eq!(first + asked_for + rest, window + 65_536);
}

#[test]
fn a_stream_that_is_too_long_to_pass_keeps_its_turn() {
    let mut raw = asked("max_stream_data_uni=4000");
    let [blocked, other] = [(); 2].map(|()| raw.peer.open(Unidirectional));
    raw.send(&format!("max_stream_data {other} 90000"));
    raw.peer.send(blocked, &filler(0, 9000), false);
    raw.peer.send(other, &filler(0, 9000), false);
    raw.advance(RTT);
    raw.send("ack");
    raw.peer.send(blocked, b"a", false);
    raw.peer.send(other, &filler(9000, 9000), false);
    assert_eq!(raw.wake_after(0, other), 18_000);
}

#[test]
fn a_stream_that_writes_nothing_is_asked_twice_at_most() {
    let mut raw = asked("");
    let [long, other, empty] = [(); 3].map(|()| raw.peer.open(Unidirectional));
    raw.peer.send(long, &filler(0, 900_000), false);
    raw.peer.send(other, &filler(0, 9000), false);
    raw.advance(RTT);
    raw.peer.polls = false;
    raw.connection().want_write(StreamId(empty));
    raw.send("ack");
    let mut asked_for = Vec::new();
    while asked_for.len() < 9
        && let Some((_, _, Event::Stream(id, ..))) = raw.peer.endpoint.poll_event(raw.now)
    {
        raw.connection().write(id, &[]);
        raw.connection().want_write(id);
        asked_for.push(id.0);
    }
    assert_eq!(asked_for, [empty, long, other, empty]);
}

#[test]
fn what_passes_leaves_credit_to_the_oldest_stream() {
    for is_incremental in [false, true] {
        let mut raw = asked("max_data=64000");
        let oldest = raw.peer.open(Unidirectional);
        raw.peer.send(oldest, &filler(0, 900_000), true);
        for _ in 0..90 {
            let id = raw.peer.open(Unidirectional);
            (raw.connection()).set_priority(StreamId(id), priority(4, is_incremental));
            raw.peer.send(id, &filler(0, 2000), true);
        }
        while raw.wake_after(0, oldest) < 800_000 {
            raw.advance(RTT);
            raw.forget();
            let limit = raw.streams[&oldest].len() + 64_000;
            raw.send(&format!("ack, max_data {limit}"));
        }
        let all = raw.streams.values().map(Vec::len).sum::<usize>();
        assert_eq!(all - raw.streams[&oldest].len(), 64_000 / 32 * 15);
    }
}

#[test]
fn what_waits_for_credit_does_not_hold_up_other_streams() {
    type Action = fn(&mut Raw);
    let actions: [(Action, _); 5] = [
        (|_| {}, false),
        (|it| it.send("max_stream_data 0 90000"), true),
        (|it| it.connection().finish(StreamId(0)), false),
        (|it| it.connection().reset(StreamId(0), 0), false),
        (|it| assert!(it.peer.send_headers(0, "a=b")), false),
    ];
    for (action, is_unblocked) in actions {
        let raw = Raw::http3(Side::Client).config(|it| it.sends_in_order = true);
        let raw = raw.with("max_data=9000000 max_stream_data_bidi_local=4096");
        let mut raw = raw.connected_with("");
        for id in [0, 4] {
            raw.write_http3(id, &format!("headers {GET}"), true);
        }
        raw.send("max_stream_data 4 9000000");
        raw.peer.send_headers(0, &format!("{OK} a=*60000"));
        raw.peer.send_headers(4, OK);
        raw.peer.waits_to_be_asked = true;
        raw.peer.send(4, &filler(0, 900_000), true);
        for round in 0..5 {
            raw.advance(RTT);
            raw.send("ack");
            if round == 2 {
                action(&mut raw);
            }
        }
        assert!(raw.streams[&4].len() > 900_000);
        assert_eq!(raw.streams[&0].len() > 4096, is_unblocked);
    }
}
