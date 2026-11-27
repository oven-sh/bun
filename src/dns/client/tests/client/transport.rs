use core::time::Duration;
use std::collections::BTreeSet;

use bun_dns_client::SocketError::{Failed, WouldBlock};
use bun_dns_client::{Events, Family, RecordType, Transport};

use crate::machine::{NOTHING, Sent, Setup, Test, one_server, resolv_conf, shown, two_servers};
use crate::wire::*;

fn over_tcp() -> Setup {
    resolv_conf("nameserver 10.0.0.1\noptions use-vc")
}

fn good(to: &Sent) -> Vec<u8> {
    reply(&to.bytes, 0, [&[address("1.1.1.1", 60)], &[], &[]])
}

const GOOD: [&str; 1] = ["1.1.1.1/60"];

#[test]
fn socket_is_shared_while_it_is_busy() {
    let mut test = one_server().start();
    let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    assert_eq!((a.socket, b.socket), (0, 0));
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
    assert!(!test.is_idle());
    assert_eq!(test.deliver(&a, &good(&a)), GOOD);
    assert!(test.is_idle());
    assert_eq!(test.world().opened[0].watches, [false]);
    assert_eq!(test.ask("c.test").socket, 1);

    let mut test = resolv_conf("search s").start();
    test.lookup("a", Family::Inet);
    test.decline(&test.sent_one(), NXDOMAIN);
    assert_eq!(test.sent_one().socket, 0);
}

#[test]
fn one_event_reads_all_there_is() {
    let mut test = one_server().start();
    let [a, b, c] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
    test.arrive(0, &good(&b));
    assert_eq!(test.deliver(&a, &good(&a)), ["2: 1.1.1.1/60", GOOD[0]]);
    assert_eq!(test.world().opened[0].receive_calls, 3);
    assert_eq!(test.deliver(&c, &good(&c)), ["3: 1.1.1.1/60"]);
    assert_eq!(test.world().opened[0].receive_calls, 4);
}

#[test]
fn events_without_a_cause() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.start();
        let query = test.ask("a.test");
        assert_eq!(test.process(0, true, true), NOTHING);
        assert_eq!(test.process(0, false, false), NOTHING);
        assert_eq!(test.world().send_calls, 1);
        assert_eq!(test.world().opened[0].receive_calls, 1);
        assert_eq!(shown(&test.client.process(99, Events::default())), NOTHING);
        assert_eq!(test.deliver(&query, &good(&query)), GOOD);
    }
}

#[test]
fn ids_on_a_socket_differ() {
    let mut test = one_server().start();
    test.world().randoms.extend([7, 8, 7, 8, 9]);
    let ids = ["a.test", "b.test", "c.test"].map(|name| test.ask(name).id());
    assert_eq!(ids, [7, 8, 9]);
}

#[test]
fn no_random_numbers() {
    for mut setup in [one_server(), over_tcp(), resolv_conf("options rotate")] {
        setup.world.has_no_randoms = true;
        let mut test = setup.start();
        assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
        assert!(test.is_idle() && test.sent().is_empty());

        test.world().has_no_randoms = false;
        let query = test.ask("b.test");
        test.world().has_no_randoms = true;
        assert_eq!(test.resolve(RecordType::A, "c.test"), ["3: ECONNREFUSED"]);
        assert_eq!(test.deliver(&query, &good(&query)), ["2: 1.1.1.1/60"]);
        assert!(test.is_idle());
    }
}

#[test]
fn random_numbers_run_out() {
    let mut test = one_server().start();
    test.ask("a.test");
    test.world().has_no_randoms = true;
    test.world().randoms.push_back(8);
    assert_eq!(test.wait(2000), NOTHING);
    assert_eq!(test.sent_one().id(), 8);
    assert_eq!(test.resolve(RecordType::A, "b.test"), ["2: ECONNREFUSED"]);
    assert_eq!(test.wait(3999), NOTHING);
    assert_eq!(test.wait(1), ["ECONNREFUSED"]);
    assert!(test.is_idle());
}

#[test]
fn half_of_the_ids_fill_a_socket() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.timeout(5000).start();
        test.world().randoms.extend((0..=u16::MAX).chain(0..9));
        let sent = test.ask_many("test", 2 * 32768 + 1);
        let sockets = sent.iter().map(|it| it.socket);
        assert!(sockets.eq((0..2 * 32768 + 1).map(|index| index / 32768)));
        assert_eq!(test.deliver(&sent[0], &good(&sent[0])), GOOD);
        assert_eq!(test.client.cancel().len(), 2 * 32768);
        assert!(test.is_idle());
    }
}

#[test]
fn socket_that_works_is_kept() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.start();
        let mut last = test.ask("first.test");
        for index in 0..300 {
            test.wait(200);
            let next = test.ask(&format!("{index}.test"));
            assert_eq!(next.socket, 0);
            assert_eq!(test.deliver(&last, &good(&last)).len(), 1);
            last = next;
        }
    }
}

#[test]
fn burst_goes_out_in_parts() {
    let mut test = one_server().tries(1).start();
    (0..146).for_each(|index| drop(test.resolve(RecordType::A, format!("{index}.test"))));
    let mut sent = test.sent();
    assert_eq!(sent.len(), 64);
    test.world().now += Duration::from_millis(1);
    test.resolve(RecordType::A, "146.test");
    for (ms, count, check) in [(0, 8, 2), (1, 64, 2), (1, 8, 2), (1, 3, 996)] {
        assert_eq!(test.wait(ms), NOTHING);
        let more = test.sent();
        assert_eq!(more.len(), count);
        assert_eq!(test.ms_to_next_check(), check);
        sent.extend(more);
    }
    let questions = sent.iter().map(Sent::question);
    assert!(questions.eq((0..147).map(|index| format!("{index}.test A"))));
    assert_eq!(test.world().opened.len(), 1);
    let timeouts = [1995, 1, 1, 1, 1, 1].map(|ms| test.wait(ms).len());
    assert_eq!(timeouts, [0, 64, 8, 64, 8, 3]);
}

#[test]
fn requests_make_no_room() {
    let mut test = one_server().start();
    test.ask_many("test", 64);
    test.world().now += Duration::from_millis(100);
    for name in ["a.test", "A.test", "b.test"] {
        test.resolve(RecordType::A, name);
    }
    assert!(test.sent().is_empty());
    assert_eq!(test.world().opened[0].receive_calls, 0);
    test.wait(0);
    assert_eq!(test.sent().len(), 2);
}

#[test]
fn replies_make_room() {
    let mut test = one_server().start();
    let sent = test.ask_many("test", 64);
    (0..99).for_each(|index| drop(test.resolve(RecordType::A, format!("{index}.a.test"))));
    test.world().now += Duration::from_millis(1);
    for (query, flags) in sent.iter().zip([0, REFUSED, NXDOMAIN, SERVFAIL]) {
        test.decline(query, flags);
        test.sent_one();
    }
    let after_a_pause = [1, 1].map(|ms| (test.wait(ms), test.sent().len()).1);
    assert_eq!(after_a_pause, [8, 64]);

    let mut test = one_server().start();
    let sent = test.ask_many("test", 100);
    test.wait(9);
    for query in &sent[1..] {
        test.decline(query, 0);
    }
    (0..99).for_each(|index| drop(test.resolve(RecordType::A, format!("{index}.a.test"))));
    assert_eq!(test.sent().len(), 64);
}

#[test]
fn socket_is_kept_for_what_was_held_back() {
    let mut test = one_server().start();
    let [old, _] = ["old.test", "older.test"].map(|name| test.ask(name));
    test.wait(1);
    test.ask("last.test");
    test.decline(&old, 0);
    test.wait(1999);
    let mut sent = test.sent();
    sent.extend(test.ask_many("test", 63));
    test.resolve(RecordType::A, "a.test");
    sent.iter().for_each(|it| test.arrive(1, &good(it)));
    test.world().now += Duration::from_millis(1);
    assert_eq!(test.process(1, true, false).len(), 64);
    assert_eq!(test.sent_exactly().map(|it| it.socket), [1, 1]);
}

fn with_two_held_back(setup: Setup) -> Test {
    let mut test = setup.start();
    test.ask_many("test", 64);
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    test
}

#[test]
fn what_was_held_back_goes_to_the_best_server() {
    let mut test = with_two_held_back(two_servers());
    test.process_error(0);
    test.wait(2);
    let sent = test.sent();
    assert_eq!(sent.len(), 66);
    assert!(sent.iter().all(|it| test.server_of(it) == "10.0.0.2:53"));

    let mut test = with_two_held_back(one_server().tries(1));
    assert_eq!(test.set_servers(&["10.0.0.9:53"]).len(), 64);
    assert_eq!(test.sent().len(), 2);

    let mut test = with_two_held_back(one_server());
    let answers = test.set_servers(&[]);
    assert_eq!(answers[64..], ["65: ENOSERVER", "66: ENOSERVER"]);
    assert!(test.is_idle());

    let mut test = with_two_held_back(one_server());
    let answers = shown(&test.client.cancel());
    assert_eq!(answers[63..65], ["64: ECANCELLED", "65: ECANCELLED"]);
    assert!(answers.len() == 66 && test.is_idle() && !test.client.has_requests());
}

#[test]
fn what_was_held_back_is_not_forgotten() {
    let mut test = one_server().tries(1).start();
    test.ask_many("test", 63);
    test.world().send_results.extend([Ok(0), Err(Failed)]);
    test.ask("last.test");
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    let answers = test.wait(2);
    assert_eq!(answers[63..], ["64: ECONNREFUSED", "65: ECONNREFUSED"]);
    assert_eq!(test.sent_one().question(), "b.test A");
}

#[test]
fn nothing_is_held_back_for_long() {
    let mut test = one_server().timeout(5000).start();
    let mut last = test.ask_many("test", 64).pop().unwrap();
    (0..3000).for_each(|index| drop(test.resolve(RecordType::A, format!("{index}.a.test"))));
    for _ in 0..1999 {
        test.world().now += Duration::from_millis(1);
        test.decline(&last, 0);
        last = test.sent_one();
    }
    test.world().now += Duration::from_millis(1);
    test.decline(&last, 0);
    assert_eq!(test.sent().len(), 3000 - 1999);
}

#[test]
fn what_was_held_back_keeps_its_timeout() {
    let mut test = one_server().tries(2).start();
    let sent = test.ask_many("test", 64);
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    sent.iter().for_each(|it| test.arrive(0, &good(it)));
    assert_eq!(test.wait(0).len(), 64);
    assert_eq!(test.sent().len(), 2);
    test.ask("c.test");
    let ended = [250, 500, 1249, 1, 500].map(|ms| (test.wait(ms).len(), test.sent().len()));
    assert_eq!(ended, [(0, 1), (1, 0), (0, 0), (0, 2), (2, 0)]);
}

#[test]
fn refusal_in_a_crowd() {
    for (setup, others, flags, is_final) in [
        (one_server(), 64, REFUSED, false),
        (one_server(), 63, REFUSED, true),
        (one_server(), 64, SERVFAIL, true),
        (one_server().tries(1), 64, REFUSED, true),
        (over_tcp(), 64, REFUSED, true),
    ] {
        let mut test = setup.start();
        let last = test.ask_many("test", others + 1).pop().unwrap();
        assert_eq!(test.decline(&last, flags).len(), usize::from(is_final));
        assert_eq!(test.sent().len(), usize::from(!is_final));
    }
}

#[test]
fn server_that_refuses_without_a_crowd() {
    let mut test = one_server().start();
    let first = test.ask("a.test");
    assert_eq!(test.decline(&first, REFUSED), ["EREFUSED"]);
    for (ms, is_final) in [(59_999, true), (59_999, true), (60_000, false)] {
        test.wait(ms - 2);
        let last = test.ask_many("test", 65).pop().unwrap();
        assert_eq!(test.decline(&last, REFUSED).len(), usize::from(is_final));
        drop(test.client.cancel());
    }
}

#[test]
fn many_refusals_in_a_row() {
    const R: u16 = REFUSED;
    for (flags, expected) in [
        (&[R; 5][..], [5, 64, 40, 0]),
        (&[R; 6], [5, 0, 0, 64]),
        (&[R, R, R, 0, R, R, R], [7, 64, 39, 0]),
        (&[R, R, R, R, R, R, 0], [6, 0, 0, 64]),
    ] {
        let mut test = one_server().start();
        let sent = test.ask_many("test", 128);
        (0..104).for_each(|index| drop(test.resolve(RecordType::A, format!("{index}.a.test"))));
        for (query, &flags) in sent[64..].iter().zip(flags) {
            test.decline(query, flags);
        }
        let at_once = test.sent().len();
        let [a, b, c] = [50, 49, 3].map(|ms| (test.wait(ms), test.sent().len()).1);
        assert_eq!([at_once, a, b, c], expected);
    }
}

#[test]
fn streams_hold_nothing_back() {
    let test = with_two_held_back(over_tcp());
    assert_eq!(test.sent().len(), 2);

    let mut test = one_server().start();
    let sent = test.ask_many("test", 64);
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    test.decline(&sent[0], TRUNCATED);
    let next = test.sent_exactly().map(|it| it.question());
    assert_eq!(next, ["0.test A", "a.test A"]);
}

#[test]
fn retired_socket_is_better_than_none() {
    let mut test = one_server().tries(1).start();
    test.world().randoms.extend(0..=u16::MAX);
    test.ask("a.test");
    test.wait(1999);
    test.ask("b.test");
    test.world().unreachable = test.client.servers().collect();
    assert_eq!(test.wait(1), ["ETIMEOUT"]);
    let sent = test.ask_many("test", 32767);
    assert!(sent.iter().all(|it| it.socket == 0));
    assert_eq!(test.world().connect_calls, 2);
    assert_eq!(test.resolve(RecordType::A, "last.test").len(), 1);
}

#[test]
fn new_socket_some_time_after_there_was_none() {
    let mut test = one_server().tries(1).start();
    for (name, is_full, socket) in [
        ("a.test", false, 0),
        ("b.test", false, 0),
        ("c.test", true, 0),
        ("d.test", false, 0),
        ("e.test", false, 1),
    ] {
        test.world().unreachable = test.client.servers().filter(|_| is_full).collect();
        assert_eq!(test.ask(name).socket, socket);
        test.wait(1000);
    }
}

#[test]
fn new_stream_as_soon_as_there_is_one() {
    let mut test = over_tcp().start();
    test.ask("a.test");
    test.wait(1);
    test.ask("b.test");
    test.world().unreachable = test.client.servers().collect();
    test.wait(1999);
    assert_eq!(test.sent_one().socket, 0);
    test.world().unreachable.clear();
    assert_eq!(test.ask("c.test").socket, 1);
}

#[test]
fn stream_that_is_far_behind_is_no_better_than_none() {
    let mut test = over_tcp().tries(1).start();
    test.world().streams_take_time = true;
    // 256 bytes with the header, the type, the class and the length.
    let name = |index| format!("{index:058}.{0:058}.{0:058}.{0:059}", 0);
    test.resolve(RecordType::A, name(0));
    test.wait(1);
    test.resolve(RecordType::A, name(1));
    test.world().unreachable = test.client.servers().collect();
    assert_eq!(test.wait(1999), ["ETIMEOUT"]);
    for index in 2..32768 {
        assert_eq!(test.resolve(RecordType::A, name(index)), NOTHING);
    }
    let last = test.resolve(RecordType::A, "last.test");
    assert_eq!(last, ["32769: ECONNREFUSED"]);
}

#[test]
fn timeouts_from_before_there_was_no_socket() {
    let mut setup = one_server().tries(1);
    setup.timeout_ms = Some(300);
    let mut test = setup.start();
    test.ask("first.test");
    test.world().unreachable = test.client.servers().collect();
    for index in 1..90 {
        test.wait(10);
        assert_eq!(test.ask(&format!("{index}.test")).socket, 0);
        assert_eq!(test.world().connect_calls, 1 + index / 30);
    }
}

#[test]
fn retired_socket_is_better_than_too_many() {
    let mut setup = one_server().tries(1).timeout(600_000);
    setup.max_timeout_ms = setup.timeout_ms;
    let mut test = setup.start();
    test.warm_up(1);
    for index in 0..300 {
        assert_eq!(
            test.ask(&format!("{index}.test")).socket,
            3 + index.min(255)
        );
        test.wait(250);
        test.sent();
    }
    test.wait(600_000 - 300 * 250);
    assert_eq!(test.ask("last.test").socket, 3 + 256);
}

#[test]
fn socket_makes_way_for_that_of_the_retries() {
    let mut test = one_server().start();
    test.ask("a.test");
    test.world().socket_limit = Some(1);
    test.wait(2000);
    assert_eq!(test.sent_one().socket, 1);
}

#[test]
fn number_of_a_closed_socket_comes_back() {
    let mut test = resolv_conf("nameserver 10.0.0.1 10.0.0.2\noptions rotate").start();
    let ask = |test: &mut Test, name, server| {
        test.world().randoms.push_back(server);
        test.ask(name)
    };
    let a = ask(&mut test, "a.test", 0);
    test.decline(&a, REFUSED);
    ask(&mut test, "b.test", 1);
    let c = ask(&mut test, "c.test", 0);
    assert_eq!(test.server_of(&c), "10.0.0.1:53");

    let mut test = one_server().start();
    let a = test.ask("a.test");
    test.decline(&a, TRUNCATED);
    let again = test.sent_one();
    test.decline(&again, REFUSED);
    test.ask("b.test");
    test.wait(1000);
    let c = test.ask("c.test");
    test.decline(&c, TRUNCATED);
    assert_eq!(test.transport_of(&test.sent_one()), Transport::Tcp);
}

#[test]
fn same_question_is_asked_once() {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    assert_eq!(test.resolve(RecordType::A, "A.tEst."), NOTHING);
    assert_eq!(test.lookup("a.test", Family::Inet), NOTHING);
    assert!(test.sent().is_empty());
    let expected = ["EREFUSED", "2: EREFUSED", "3: EREFUSED"];
    assert_eq!(test.decline(&query, REFUSED), expected);
    assert!(test.is_idle());
    test.ask("a.test");
}

#[test]
fn same_question_after_a_timeout() {
    let mut test = one_server().start();
    test.ask("a.test");
    assert_eq!(test.wait(2000), NOTHING);
    let (old, new) = (test.sent_one(), test.ask("a.test"));
    assert_eq!(test.resolve(RecordType::A, "a.test"), NOTHING);
    assert!(test.sent().is_empty());
    let expected = ["2: 1.1.1.1/60", "3: 1.1.1.1/60"];
    assert_eq!(test.deliver(&new, &good(&new)), expected);
    assert_eq!(test.answer(&old, &[address("2.2.2.2", 99)]), ["2.2.2.2/99"]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["4: 1.1.1.1/60"]);
    test.wait(60_000);
    test.ask("a.test");
}

/// The times at which the first query was sent again, with one more request every millisecond.
fn repeats(mut test: Test, ms: u64) -> Vec<u64> {
    let first = test.ask("a.test");
    let is_repeated = |_: &u64| {
        test.world().now += Duration::from_millis(1);
        assert_eq!(test.resolve(RecordType::A, "A.test"), NOTHING);
        let sent = test.sent();
        assert!(sent.iter().all(|it| it.bytes == first.bytes));
        assert!(sent.iter().all(|it| it.socket == first.socket));
        !sent.is_empty()
    };
    (1..ms).filter(is_repeated).collect()
}

#[test]
fn same_question_some_time_later() {
    assert_eq!(repeats(one_server().start(), 160), [10, 20, 40, 80]);
    assert!(repeats(over_tcp().start(), 160).is_empty());

    let mut test = one_server().tries(1).start();
    let query = test.ask("a.test");
    test.wait(250);
    test.ask("a.test");
    assert_eq!(test.deliver(&query, &good(&query)).len(), 2);
    assert!(test.is_idle());

    test.ask("b.test");
    test.wait(1999);
    test.ask("b.test");
    assert_eq!(test.wait(1), ["3: ETIMEOUT", "4: ETIMEOUT"]);

    test.ask("c.test");
    test.wait(1999);
    test.world().send_results.push_back(Err(Failed));
    let expected = ["5: ECONNREFUSED", "6: ECONNREFUSED"];
    assert_eq!(test.resolve(RecordType::A, "c.test"), expected);
}

#[test]
fn repeats_take_room() {
    let mut test = one_server().start();
    test.ask_many("test", 63);
    test.wait(250);
    assert_eq!(test.ask("0.test").question(), "0.test A");
    test.resolve(RecordType::A, "1.test");
    assert!(test.sent().is_empty());
}

#[test]
fn same_question_as_one_that_was_just_answered() {
    let mut test = resolv_conf("search s t").start();
    for other in [None, Some("other.test")] {
        test.lookup("a", Family::Inet);
        let first = test.sent_one();
        let second = test.ask("a.t");
        other.map(|name| test.ask(name));
        test.arrive(first.socket, &reply(&first.bytes, NXDOMAIN, [&[]; 3]));
        assert_eq!(test.decline(&second, REFUSED).len(), 2);
        assert!(test.sent().is_empty());
    }

    let mut test = resolv_conf("search s t\nnameserver 10.0.0.1 10.0.0.2\noptions rotate").start();
    test.world().randoms.extend([0, 7, 1, 8]);
    test.lookup("a", Family::Inet);
    let first = test.sent_one();
    let second = test.ask("a.t");
    test.arrive(first.socket, &reply(&first.bytes, NXDOMAIN, [&[]; 3]));
    test.break_socket(second.socket);
    test.wait(2000);
    assert_eq!(test.sent_one().question(), "a.t A");
}

/// How many datagrams that answer nothing `socket` puts up with.
fn strays_left(test: &mut Test, socket: usize) -> usize {
    let is_open = |_: &usize| {
        test.arrive(socket, b"");
        test.process(socket, true, false);
        test.world().opened[socket].is_open
    };
    (0..).take_while(is_open).count()
}

#[test]
fn too_many_datagrams_that_answer_nothing() {
    let mut test = two_servers().start();
    test.ask_many("test", 2);
    assert_eq!(strays_left(&mut test, 0), 32);
    let again = test.sent_exactly().map(|it| test.server_of(&it));
    assert_eq!(again, ["10.0.0.2:53"; 2]);

    let mut test = one_server().start();
    let sent = test.ask_many("test", 3);
    let mut unknown = good(&sent[0]);
    unknown[0] ^= 0x80;
    (0..5).for_each(|_| test.arrive_from(0, &unknown, "10.0.0.2:53"));
    (0..6).for_each(|_| test.arrive(0, &unknown));
    (0..7).for_each(|_| test.arrive(0, &sent[0].bytes));
    assert_eq!(test.deliver(&sent[1], &good(&sent[1])).len(), 1);
    assert_eq!(strays_left(&mut test, 0), 32 - 5 - 6);

    let mut test = over_tcp().start();
    let query = test.ask("a.test");
    (0..999).for_each(|_| drop(test.deliver(&query, b"")));
    assert_eq!(test.deliver(&query, &good(&query)), GOOD);
}

#[test]
fn late_replies_are_expected() {
    let mut test = one_server().start();
    let sent = test.ask_many("test", 5);
    test.wait(1000);
    test.ask("a.test");
    test.wait(1000);
    (0..99).for_each(|_| drop(test.deliver(&sent[0], &good(&sent[0]))));
    assert_eq!(strays_left(&mut test, 0), 32 + 5);
}

#[test]
fn copies_of_a_reply_that_left_nothing_to_wait_for() {
    for was_busy in [false, true] {
        let mut test = resolv_conf("search s").start();
        if was_busy {
            let sent = test.ask_many("test", 2);
            sent.iter().for_each(|it| drop(test.decline(it, 0)));
        }
        test.lookup("a", Family::Inet);
        let first = test.sent_one();
        (0..34).for_each(|_| drop(test.decline(&first, NXDOMAIN)));
        assert_eq!(test.world().opened[first.socket].is_open, was_busy);
    }
}

#[test]
fn copies_of_replies_are_expected() {
    for (replies, is_recent) in [(1, true), (8193, true), (16384, true), (16385, false)] {
        let mut test = one_server().start();
        test.world().randoms.extend(0..=u16::MAX);
        test.ask("slow.test");
        let first = test.ask("first.test");
        test.decline(&first, 0);
        for _ in 1..replies {
            let query = test.ask("a.test");
            test.decline(&query, 0);
        }
        (0..33).for_each(|_| drop(test.decline(&first, 0)));
        assert_eq!(test.world().opened[0].is_open, is_recent);
    }
}

#[test]
fn messages_that_answer_nothing() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(1).start();
        let query = test.ask("a.test");
        let changed = |at: usize, mask: u8| {
            let mut message = good(&query);
            message[at] ^= mask;
            message
        };
        let (id, flags, name, kind, class) = (1, 2, 13, 21, 23);
        let whole = good(&query);
        for message in [
            changed(id, 1),
            changed(flags, 0x80),
            changed(flags, 0x08),
            changed(flags, 0x40),
            changed(name, 3),
            changed(kind, 3),
            changed(class, 2),
            whole[..0].to_vec(),
            whole[..1].to_vec(),
            whole[..3].to_vec(),
            whole[..11].to_vec(),
            whole[..23].to_vec(),
        ] {
            assert_eq!(test.deliver(&query, &message), NOTHING);
            assert!(test.sent().is_empty());
        }
        assert_eq!(test.deliver(&query, &changed(name, 0x20)), GOOD);
    }
}

#[test]
fn senders() {
    let mut test = two_servers().start();
    let query = test.ask("a.test");
    for sender in [
        "10.0.0.2:53",
        "10.0.0.1:54",
        "10.0.0.1:0",
        "[::ffff:10.0.0.1]:53",
    ] {
        test.arrive_from(0, &good(&query), sender);
        assert_eq!(test.process(0, true, false), NOTHING);
    }
    assert_eq!(test.deliver(&query, &good(&query)), GOOD);
}

#[test]
fn unspecified_address_is_this_machine() {
    for (server, peer) in [("0.0.0.0:54", "127.0.0.1:54"), ("[::]:54", "[::1]:54")] {
        let mut test = one_server().start();
        test.set_servers(&[server]);
        let query = test.ask("a.test");
        assert_eq!(test.server_of(&query), peer);
        assert_eq!(test.servers(), [server]);
        assert_eq!(test.deliver(&query, &good(&query)), GOOD);
    }
}

#[test]
fn reading_takes_turns_with_the_event_loop() {
    for (count, expected) in [(4095, [2, 0]), (4096, [0, 2])] {
        let mut test = one_server().start();
        let [a, b, c] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
        test.arrive(0, &a.bytes[..2]);
        test.arrive(0, &good(&c));
        (1..count).for_each(|_| test.arrive(0, &good(&c)));
        test.arrive(0, &good(&a));
        test.arrive(0, &good(&b));
        let [first, second] = [(); 2].map(|()| test.process(0, true, false));
        assert_eq!([first.len() - 1, second.len()], expected);
        assert!(first.iter().chain(&second).all(|it| it.ends_with(GOOD[0])));

        let mut test = one_server().start();
        test.ask_many("test", 4090);
        test.wait(1);
        let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
        test.wait(1999);
        (0..count).for_each(|_| test.arrive(0, b""));
        test.arrive(0, &good(&a));
        test.arrive(0, &good(&b));
        assert_eq!(
            [(); 2].map(|()| test.process(0, true, false).len()),
            expected
        );

        let (mut test, replies) = two_on_a_stream();
        let long = frame(&vec![0; u16::MAX.into()]);
        test.arrive(0, &[frame(b"").repeat(count), long, replies].concat());
        assert_eq!(
            [(); 2].map(|()| test.process(0, true, false).len()),
            expected
        );
    }
}

#[test]
fn reply_that_cannot_be_read() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(2).start();
        let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
        assert_eq!(test.deliver(&a, &good(&a)[..30]), NOTHING);
        let again = test.sent_one();
        assert_eq!((again.question(), again.socket), (a.question(), 0));
        assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
        assert_eq!(test.deliver(&again, &good(&again)[..30]), ["EBADRESP"]);
        assert!(test.is_idle());
    }

    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.deliver(&query, &good(&query)[..30]);
    assert_eq!(test.server_of(&test.sent_one()), "10.0.0.2:53");
}

#[test]
fn reply_without_one_question() {
    let outcome = |change: &dyn Fn(&mut Vec<u8>)| {
        let mut test = one_server().tries(1).start();
        let query = test.ask("a.test");
        let mut message = good(&query);
        change(&mut message);
        test.deliver(&query, &message)
    };
    for count in [0, 2] {
        assert_eq!(outcome(&|message| message[5] = count), ["EBADRESP"]);
    }
    let header = |message: &mut Vec<u8>| {
        message[5] = 0;
        message.truncate(12);
    };
    assert_eq!(outcome(&header), ["EBADRESP"]);
    let answer_only = |message: &mut Vec<u8>| {
        message[5] = 0;
        message.drain(12..24);
    };
    assert_eq!(outcome(&answer_only), ["EBADRESP"]);
}

#[test]
fn truncated() {
    let mut test = one_server().tries(1).start();
    let query = test.ask("a.test");
    let half = reply(&query.bytes, TRUNCATED, [&[ASKED.to_vec()], &[], &[]]);
    assert_eq!(test.deliver(&query, &half), NOTHING);
    let again = test.sent_one();
    assert_eq!(test.transport_of(&again), Transport::Tcp);
    assert_eq!(
        (again.question(), test.open_sockets()),
        (query.question(), 1)
    );

    let still = reply(
        &again.bytes,
        TRUNCATED,
        [&[address("1.1.1.1", 60)], &[], &[]],
    );
    assert_eq!(test.deliver(&again, &still), GOOD);
    assert!(test.is_idle());
    let next = test.ask("a.test");
    assert_eq!(test.transport_of(&next), Transport::Udp);
}

#[test]
fn truncated_among_others() {
    let mut test = one_server().start();
    let [a, b, _] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
    test.arrive(0, &reply(&a.bytes, TRUNCATED, [&[], &[], &[]]));
    test.decline(&b, TRUNCATED);
    let again = test.sent_exactly().map(|it| it.question());
    assert_eq!(again, [a.question(), b.question()]);
    assert_eq!(test.ask("d.test").socket, 0);
}

#[test]
fn refusals_are_final() {
    for code in [FORMERR, SERVFAIL, NXDOMAIN, REFUSED] {
        let mut test = two_servers().start();
        let query = test.ask("a.test");
        assert_eq!(test.decline(&query, code).len(), 1);
        assert_eq!(test.servers(), ["10.0.0.1:53", "10.0.0.2:53"]);
        assert!(test.is_idle());
    }
}

#[test]
fn each_datagram_has_an_id_and_a_socket_of_its_own() {
    let mut test = one_server().start();
    let mut tries = vec![test.ask("a.test")];
    let slow = test.ask("b.test");
    assert_eq!(test.wait(1999), NOTHING);
    assert!(test.sent().is_empty());
    test.deliver(&slow, &good(&slow));
    for _ in 0..3 {
        assert_eq!(test.wait(60_000), NOTHING);
        tries.push(test.sent_one());
        assert_eq!(test.open_sockets(), 1);
    }
    assert_eq!(tries.iter().map(Sent::id).collect::<BTreeSet<_>>().len(), 4);
    assert!(tries.iter().map(|it| it.socket).eq(0..4));
    assert_eq!(test.deliver(&tries[3], &good(&tries[2])), NOTHING);
    assert_eq!(test.wait(60_000), ["ETIMEOUT"]);
    assert!(test.is_idle());
}

#[test]
fn socket_with_a_timeout_serves_those_it_has() {
    let mut test = one_server().start();
    let a = test.ask("a.test");
    test.wait(1000);
    let b = test.ask("b.test");
    test.wait(1000);
    assert_eq!((test.sent_one().socket, test.ask("c.test").socket), (1, 1));
    assert_eq!(test.deliver(&a, &good(&a)), NOTHING);
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
    assert_eq!(test.open_sockets(), 1);
}

/// The first try, which has timed out, and the second.
fn on_two_streams(tries: u32) -> (Test, Sent, Sent) {
    let mut test = over_tcp().tries(tries).start();
    let first = test.ask("a.test");
    assert_eq!(test.wait(2000), NOTHING);
    let second = test.sent_one();
    assert_eq!((first.socket, second.socket), (0, 1));
    (test, first, second)
}

#[test]
fn late_reply_on_a_stream() {
    for is_late in [true, false] {
        let (mut test, first, second) = on_two_streams(2);
        let answered = if is_late { first } else { second };
        assert_eq!(test.deliver(&answered, &good(&answered)), GOOD);
        assert!(test.is_idle());
    }

    let (mut test, first, second) = on_two_streams(2);
    assert_eq!(test.deliver(&first, &good(&first)[..30]), NOTHING);
    assert!(test.sent().is_empty());
    assert_eq!(test.deliver(&second, &good(&second)), GOOD);

    let (mut test, ..) = on_two_streams(2);
    assert_eq!(shown(&test.client.cancel()), ["ECANCELLED"]);
    assert!(test.is_idle());
}

#[test]
fn late_reply_that_has_arrived() {
    let (mut test, first, _) = on_two_streams(2);
    test.set_servers(&["10.0.0.1:53", "10.0.0.2:53"]);
    test.arrive(0, &frame(&good(&first)));
    assert_eq!(test.wait(9000), GOOD);
    assert_eq!(test.servers()[0], "10.0.0.1:53");

    let mut test = two_servers().tries(1).start();
    test.ask("other.test");
    let query = test.ask("a.test");
    test.decline(&query, TRUNCATED);
    let first = test.sent_one();
    test.wait(2000);
    let [_, second] = test.sent_exactly();
    test.break_socket(second.socket);
    test.arrive(first.socket, &frame(&good(&first)));
    assert_eq!(test.wait(2000), ["2: 1.1.1.1/60", "ETIMEOUT"]);
}

#[test]
fn two_streams_are_enough_for_a_while() {
    for (ms, socket) in [(4999, 1), (5000, 2)] {
        let (mut test, first, second) = on_two_streams(9);
        test.wait(ms);
        let again = test.sent_one();
        assert_eq!(
            (again.socket, again.id() == second.id()),
            (socket, socket == 1)
        );
        assert_eq!(test.ask("b.test").socket, socket);
        assert_eq!(test.deliver(&first, &good(&first)), GOOD);
    }

    let (mut test, ..) = on_two_streams(9);
    let mut after = |ms, name: Option<&str>| {
        test.wait(ms);
        let socket = test.sent_one().socket;
        name.map(|name| test.ask(name));
        socket
    };
    let (b, c) = (Some("b.test"), Some("c.test"));
    let steps = [
        (4000, None),
        (8000, b),
        (2000, None),
        (4000, None),
        (8000, None),
        (5000, c),
        (2000, None),
    ];
    assert_eq!(
        steps.map(|(ms, name)| after(ms, name)),
        [1, 2, 2, 3, 4, 4, 5]
    );
}

#[test]
fn another_stream_once_the_first_is_gone() {
    for has_other in [false, true] {
        let (mut test, ..) = on_two_streams(9);
        test.set_servers(&["10.0.0.1:53", "10.0.0.2:53"]);
        test.break_socket(0);
        assert_eq!(test.process(0, true, false), NOTHING);
        assert!(test.sent().is_empty());
        if has_other {
            test.ask("b.test");
            test.sent();
        }
        test.set_servers(&["10.0.0.1:53"]);
        test.sent();
        test.wait(60_000);
        let next = 2 + usize::from(has_other);
        assert!(test.sent().iter().all(|it| it.socket == next));
    }
}

#[test]
fn place_of_a_late_try_is_taken() {
    let (mut test, first, second) = on_two_streams(9);
    test.process_error(0);
    test.ask("b.test");
    test.wait(4000);
    test.world().randoms.extend([1, first.id()]);
    let [b, again] = test.sent_exactly();
    assert_eq!((b.socket, again.socket), (2, 2));

    let (mut test, ..) = on_two_streams(9);
    test.process_error(0);
    test.set_servers(&["10.0.0.2:53", "10.0.0.1:53"]);
    test.world().randoms.extend([1, first.id()]);
    let other = test.ask("b.test");
    assert_eq!(other.id(), first.id());
    test.wait(4000);
    let again = test.sent().pop().unwrap();
    assert_eq!(again.question(), first.question());
    assert_ne!(again.id(), first.id());
    assert_eq!(test.deliver(&second, &good(&second)), GOOD);
    assert_eq!(test.deliver(&other, &good(&other)), ["2: 1.1.1.1/60"]);
}

#[test]
fn late_try_at_a_server_that_goes() {
    let (mut test, ..) = on_two_streams(9);
    assert_eq!(test.set_servers(&["10.0.0.2:53"]), NOTHING);
    assert_eq!(test.sent_one().question(), "a.test A");
}

#[test]
fn end_of_a_stream_with_nothing_but_late_tries() {
    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.decline(&query, TRUNCATED);
    let first = test.sent_one();
    test.wait(2000);
    test.wait(2000);
    assert_eq!(test.servers()[0], "10.0.0.1:53");
    test.process_error(test.sent()[0].socket);
    test.set_servers(&["10.0.0.2:53", "10.0.0.1:53"]);
    assert_eq!(test.servers()[0], "10.0.0.1:53");
    assert_eq!(test.deliver(&first, &good(&first)), GOOD);
}

#[test]
fn no_second_stream() {
    let ways: [&dyn Fn(&mut Test); 2] = [
        &|test| {
            test.wait(2000);
            test.process_error(test.sent_one().socket);
        },
        &|test| {
            test.world().send_results.push_back(Err(Failed));
            test.wait(2000);
        },
    ];
    for way in ways {
        let mut test = over_tcp().tries(3).start();
        let first = test.ask("a.test");
        test.wait(1);
        test.ask("b.test");
        test.world().now -= Duration::from_millis(1);
        way(&mut test);
        let again = test.sent_one();
        assert_eq!((again.socket, again.id()), (0, first.id()));
        test.wait(1);
        assert_eq!(test.sent_one().socket, 0);
        assert_eq!(test.wait(4000), NOTHING);
        assert_eq!(test.sent_exactly().map(|it| it.socket), [2, 2]);
        assert_eq!(test.wait(8000).len(), 2);
    }
}

#[test]
fn stream_that_fails_on_its_own_account() {
    let (mut test, ..) = on_two_streams(2);
    let other = test.ask("b.test");
    test.decline(&other, 0);
    assert_eq!(test.process_error(1), ["ECONNREFUSED"]);

    let (mut test, first, _) = on_two_streams(2);
    test.ask("b.test");
    test.decline(&first, 0x0800);
    test.break_socket(0);
    test.process(0, true, false);
    assert_eq!(test.process_error(1), ["ECONNREFUSED"]);

    let mut test = over_tcp().tries(2).start();
    test.world().randoms.extend(0..=u16::MAX);
    test.ask_many("test", 32768);
    test.wait(2000);
    assert_eq!(test.process_error(1).len(), 32768);

    let mut test = over_tcp().tries(2).start();
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.wait(2000);
    test.ask_many("test", 0);
    test.decline(&a, 0);
    assert_eq!(test.process_error(1), ["2: ECONNREFUSED"]);
}

#[test]
fn retired_stream_that_works() {
    for (has_worked, expected) in [(false, 0), (true, 1)] {
        let mut test = over_tcp().start();
        let [a, ..] = ["a.test", "b.test", "c.test"].map(|name| test.ask(name));
        test.wait(2000);
        let [_, b, _] = test.sent_exactly();
        if has_worked {
            test.decline(&b, 0);
        }
        test.decline(&a, 0);
        assert_eq!(test.ask("d.test").socket, expected);
        test.wait(4000);
        assert!(test.sent().iter().all(|it| it.socket == expected));
    }

    let mut test = over_tcp().tries(1).start();
    test.ask("a.test");
    test.wait(1);
    let [b, _] = ["b.test", "c.test"].map(|name| test.ask(name));
    assert_eq!(test.wait(1999), ["ETIMEOUT"]);
    test.decline(&b, 0);
    assert_eq!(test.ask("d.test").socket, 0);
}

#[test]
fn stream_that_connects_late() {
    let mut test = over_tcp().start();
    test.world().streams_take_time = true;
    test.resolve(RecordType::A, "a.test");
    for ms in [2000, 4000] {
        test.wait(ms);
        assert_eq!(test.open_sockets(), 2);
    }
    test.process(0, false, true);
    let first = test.sent_one();
    assert_eq!(test.deliver(&first, &good(&first)), GOOD);
    assert!(test.is_idle());
}

#[test]
fn timeout_on_a_stream_that_has_worked_since() {
    let mut test = over_tcp().start();
    let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.wait(1);
    assert_eq!(test.deliver(&a, &good(&a)), GOOD);
    test.ask("c.test");
    test.wait(1999);
    let again = test.sent_one();
    assert_eq!((again.socket, again.id()), (0, b.id()));
    test.wait(1);
    assert_eq!(test.sent_one().socket, 1);
}

#[test]
fn what_has_arrived_is_not_late() {
    let mut test = one_server().tries(1).start();
    let a = test.ask("a.test");
    test.wait(1000);
    let b = test.ask("b.test");
    test.arrive(b.socket, &good(&b));
    test.world().now += core::time::Duration::from_secs(9);
    assert_eq!(test.deliver(&a, &good(&a)), ["2: 1.1.1.1/60", GOOD[0]]);

    let c = test.ask("c.test");
    test.arrive(c.socket, &good(&c));
    assert_eq!(test.wait(9000), ["3: 1.1.1.1/60"]);
}

#[test]
fn one_last_look_at_each_socket() {
    let mut test = resolv_conf("nameserver 10.0.0.1 10.0.0.2\noptions rotate").start();
    for (name, server) in [("a.test", 0), ("b.test", 1), ("c.test", 0)] {
        test.world().randoms.push_back(server);
        test.ask(name);
    }
    test.wait(2000);
    assert_eq!(
        [0, 1].map(|it| test.world().opened[it].receive_calls),
        [1, 1]
    );
}

#[test]
fn events_also_look_at_the_clock() {
    let mut test = one_server().tries(1).start();
    let [_, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.world().now += core::time::Duration::from_secs(2);
    assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60", "ETIMEOUT"]);
}

#[test]
fn timeouts_come_in_order() {
    let mut test = one_server().tries(1).start();
    test.ask("a.test");
    test.ask("b.test");
    test.wait(1);
    test.ask("c.test");
    assert_eq!(test.wait(9999), ["ETIMEOUT", "2: ETIMEOUT", "3: ETIMEOUT"]);
}

#[test]
fn no_socket() {
    for (tries, calls) in [(1, 2), (3, 6), (u32::MAX, 128)] {
        let mut test = two_servers().tries(tries).start();
        let servers = test.client.servers().collect();
        test.world().unreachable = servers;
        assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
        assert_eq!(test.world().connect_calls, calls);
        assert!(test.is_idle());
    }
}

#[test]
fn all_tries_that_take_time() {
    let mut setup = one_server().tries(200);
    setup.max_timeout_ms = Some(10);
    let mut test = setup.start();
    test.ask("a.test");
    for _ in 1..200 {
        assert_eq!(test.wait(10), NOTHING);
    }
    assert_eq!(test.wait(10), ["ETIMEOUT"]);
}

#[test]
fn tries_that_take_no_time_count_in_a_row() {
    let mut setup = one_server().tries(1000);
    setup.max_timeout_ms = Some(10);
    let mut test = setup.start();
    test.ask("a.test");
    for _ in 0..3 {
        test.world().send_results.extend([Err(Failed); 63]);
        assert_eq!(test.wait(10), NOTHING);
    }
    test.world().send_results.extend([Err(Failed); 64]);
    assert_eq!(test.wait(10), ["ECONNREFUSED"]);
}

#[test]
fn next_server_if_there_is_no_socket() {
    let mut test = two_servers().start();
    test.world().unreachable = vec!["10.0.0.1:53".parse().unwrap()];
    let query = test.ask("a.test");
    assert_eq!(test.server_of(&query), "10.0.0.2:53");
}

#[test]
fn send_fails() {
    let mut test = two_servers().start();
    test.ask("a.test");
    test.world().send_results.push_back(Err(Failed));
    assert_eq!(test.resolve(RecordType::A, "b.test"), NOTHING);
    let [a, b] = test.sent_exactly();
    assert_eq!([a.question(), b.question()], ["a.test A", "b.test A"]);
    assert_eq!(test.server_of(&a), "10.0.0.2:53");
    assert_eq!(test.open_sockets(), 1);

    let mut test = one_server().start();
    test.world().send_results.extend([Err(Failed); 4]);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["ECONNREFUSED"]);
    assert!(test.is_idle());
}

#[test]
fn receive_fails() {
    for setup in [one_server(), over_tcp()] {
        let mut test = setup.tries(2).start();
        let names = ["a.test", "b.test", "c.test", "d.test"];
        let [_, b, _, _] = names.map(|name| test.ask(name));
        assert_eq!(test.deliver(&b, &good(&b)), ["2: 1.1.1.1/60"]);
        test.break_socket(0);
        assert_eq!(test.process(0, true, false), NOTHING);
        let again = test.sent_exactly().map(|it| it.question());
        assert_eq!(again, ["a.test A", "c.test A", "d.test A"]);
        test.break_socket(1);
        let expected = ["ECONNREFUSED", "3: ECONNREFUSED", "4: ECONNREFUSED"];
        assert_eq!(test.process(1, true, false), expected);
        assert!(test.is_idle());
    }
}

#[test]
fn replies_before_a_failure_count() {
    let mut test = one_server().tries(1).start();
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.arrive(0, &good(&a));
    test.break_socket(0);
    assert_eq!(test.process(0, true, false), [GOOD[0], "2: ECONNREFUSED"]);
}

#[test]
fn error_on_a_socket() {
    for streams_take_time in [false, true] {
        let mut test = over_tcp().tries(1).start();
        test.world().streams_take_time = streams_take_time;
        test.resolve(RecordType::A, "a.test");
        assert_eq!(test.process_error(0), ["ECONNREFUSED"]);
        assert!(test.is_idle());
    }

    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.arrive(0, &good(&query));
    assert_eq!(test.process_error(0), GOOD);
    assert_eq!(test.servers(), ["10.0.0.1:53", "10.0.0.2:53"]);

    let mut test = resolv_conf("search s").start();
    test.lookup("a", Family::Inet);
    let query = test.sent_one();
    test.arrive(0, &reply(&query.bytes, NXDOMAIN, [&[], &[], &[]]));
    assert_eq!(test.process_error(0), NOTHING);
    assert_eq!(test.sent_one().socket, 1);
}

#[test]
fn replies_behind_an_error() {
    for (setup, errors, expected) in [
        (one_server(), 1, GOOD[0]),
        (one_server(), 2, "ECONNREFUSED"),
        (over_tcp(), 1, "ECONNREFUSED"),
    ] {
        let mut test = setup.tries(1).start();
        let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
        (0..errors).for_each(|_| test.break_socket(0));
        assert_eq!(test.deliver(&a, &good(&a)), [expected, "2: ECONNREFUSED"]);
    }

    let mut test = two_servers().start();
    let query = test.ask("a.test");
    test.break_socket(0);
    assert_eq!(test.deliver(&query, &good(&query)), GOOD);
    assert_eq!(test.servers(), ["10.0.0.1:53", "10.0.0.2:53"]);
    assert!(test.is_idle());
}

#[test]
fn last_error_is_reported() {
    let mut test = one_server().tries(2).start();
    test.ask("a.test");
    test.break_socket(0);
    test.process(0, true, false);
    assert_eq!(test.wait(60_000), ["ETIMEOUT"]);
}

#[test]
fn datagrams_wait_for_room() {
    let results = [Err(WouldBlock), Ok(0), Err(WouldBlock)];
    for (results, events) in [(&results[..], 2), (&results[1..], 1)] {
        let mut test = one_server().start();
        test.world().send_results.extend([Err(WouldBlock); 3]);
        for name in ["a.test", "b.test", "c.test"] {
            assert_eq!(test.resolve(RecordType::A, name), NOTHING);
        }
        assert_eq!(test.ask("d.test").question(), "d.test A");
        test.world().send_results.extend(results);
        (0..events).for_each(|_| drop(test.process(0, false, true)));
        let [a] = test.sent_exactly();
        assert_eq!(test.deliver(&a, &good(&a)), GOOD);
        test.process(0, false, true);
        assert_eq!(
            test.sent_exactly().map(|it| it.question()),
            ["b.test A", "c.test A"]
        );
        assert_eq!(test.world().opened[0].watches, [true, false]);
    }
}

#[test]
fn datagrams_that_a_writable_socket_does_not_take_are_lost() {
    let mut test = one_server().start();
    test.world().send_results.extend([Err(WouldBlock); 6]);
    for name in ["a.test", "b.test", "c.test"] {
        test.resolve(RecordType::A, name);
    }
    assert_eq!(test.process(0, false, true), NOTHING);
    assert_eq!(test.world().opened[0].watches, [true]);
    assert_eq!(test.process(0, false, true), NOTHING);
    assert_eq!(test.sent_exactly().map(|it| it.question()), ["c.test A"]);
    assert_eq!(test.world().opened[0].watches, [true, false]);
    test.wait(2000);
    assert_eq!(test.sent().len(), 3);
}

#[test]
fn datagram_that_waits_for_too_long() {
    for first in [Err(WouldBlock), Ok(0)] {
        let mut test = one_server().tries(1).start();
        test.world().send_results.extend([first, Err(WouldBlock)]);
        test.resolve(RecordType::A, "a.test");
        test.sent();
        test.wait(1);
        test.resolve(RecordType::A, "b.test");
        assert_eq!(test.wait(1999), ["ETIMEOUT"]);
        test.process(0, false, true);
        assert_eq!(test.sent_one().question(), "b.test A");
    }
}

#[test]
fn newer_datagram_takes_the_room() {
    let mut test = one_server().start();
    test.world().send_results.extend([Err(WouldBlock); 2]);
    test.resolve(RecordType::A, "a.test");
    test.process(0, false, true);
    test.ask("b.test");
    test.world().send_results.push_back(Err(WouldBlock));
    test.process(0, false, true);
    test.process(0, false, true);
    assert_eq!(test.sent_one().question(), "a.test A");
}

#[test]
fn reply_to_a_datagram_that_waits() {
    let mut test = one_server().tries(2).start();
    test.world().randoms.extend([7, 8, 7]);
    let a = test.ask("a.test");
    test.wait(1);
    test.ask("b.test");
    test.world().unreachable = test.client.servers().collect();
    test.world().send_results.push_back(Err(WouldBlock));
    assert_eq!(test.wait(1999), NOTHING);
    assert_eq!(test.world().opened[0].watches, [false, true]);
    assert_eq!(test.deliver(&a, &good(&a)), GOOD);
    test.process(0, false, true);
    assert!(test.sent().is_empty());
    assert_eq!(test.world().opened[0].watches, [false, true, false]);
}

#[test]
fn flush_fails() {
    let as_it_is: fn(&[u8]) -> Vec<u8> = <[u8]>::to_vec;
    for (setup, wrap) in [(one_server(), as_it_is), (over_tcp(), frame)] {
        let mut test = setup.tries(1).start();
        let a = test.ask("a.test");
        test.world()
            .send_results
            .extend([Err(WouldBlock), Err(Failed)]);
        test.resolve(RecordType::A, "b.test");
        test.arrive(0, &wrap(&good(&a)));
        assert_eq!(test.process(0, true, true), [GOOD[0], "2: ECONNREFUSED"]);
        assert!(test.is_idle());
    }
}

#[test]
fn stream_that_does_not_connect() {
    let mut test = over_tcp().tries(1).start();
    test.world().streams_take_time = true;
    test.resolve(RecordType::A, "a.test");
    assert_eq!(test.process(0, true, false), NOTHING);
    assert_eq!(test.wait(2000), ["ETIMEOUT"]);
    assert_eq!(test.world().opened[0].receive_calls, 0);
}

#[test]
fn stream_that_is_still_connecting() {
    let mut test = over_tcp().start();
    test.world().streams_take_time = true;
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    assert_eq!(test.world().send_calls, 0);
    test.process(0, false, true);
    assert_eq!((test.sent().len(), test.world().send_calls), (2, 1));
    assert_eq!(test.ask("c.test").socket, 0);
    assert_eq!(test.world().opened[0].watches, [true, false]);
}

#[test]
fn stream_without_room() {
    for result in [Err(WouldBlock), Ok(25)] {
        let mut test = over_tcp().start();
        test.world().send_results.push_back(result);
        test.resolve(RecordType::A, "a.test");
        test.resolve(RecordType::A, "b.test");
        assert_eq!(test.world().send_calls, 1);
        test.process(0, false, true);
        assert_eq!(
            test.sent_exactly().map(|it| it.question()),
            ["a.test A", "b.test A"]
        );
        assert_eq!(test.world().opened[0].watches, [true, false]);
    }
}

#[test]
fn stream_that_takes_a_byte_at_a_time() {
    let mut test = over_tcp().start();
    test.world().send_results.extend([Ok(1); 51]);
    test.resolve(RecordType::A, "a.test");
    test.resolve(RecordType::A, "b.test");
    (0..51).for_each(|_| assert_eq!(test.process(0, false, true), NOTHING));
    assert_eq!(
        test.sent_exactly().map(|it| it.question()),
        ["a.test A", "b.test A"]
    );
    assert_eq!(test.world().opened[0].watches, [true, false]);
}

fn two_on_a_stream() -> (Test, Vec<u8>) {
    let mut test = over_tcp().tries(1).start();
    let replies = ["a.test", "b.test"].map(|name| frame(&good(&test.ask(name))));
    (test, replies.concat())
}

#[test]
fn stream_in_pieces() {
    let len = two_on_a_stream().1.len();
    for piece in 1..=len {
        let (mut test, stream) = two_on_a_stream();
        let mut answers = Vec::new();
        for piece in stream.chunks(piece) {
            test.arrive(0, piece);
            answers.extend(test.process(0, true, false));
        }
        assert_eq!(answers, [GOOD[0], "2: 1.1.1.1/60"]);
        assert!(test.is_idle());
    }
}

#[test]
fn stream_is_read_once() {
    let mut test = over_tcp().start();
    test.world().randoms.extend([7, 8, 7]);
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    assert_eq!(test.decline(&a, REFUSED), ["EREFUSED"]);
    assert_eq!(test.world().opened[0].receive_calls, 1);
    let again = test.ask("a.test");
    assert_eq!(test.deliver(&again, &good(&again)), ["3: 1.1.1.1/60"]);
}

#[test]
fn stream_that_ends() {
    let len = two_on_a_stream().1.len();
    for end in 1..len {
        let (mut test, stream) = two_on_a_stream();
        test.arrive(0, &stream[..end]);
        test.break_socket(0);
        let answers = [test.process(0, true, false), test.process(0, true, false)];
        let first = if end < len / 2 {
            "ECONNREFUSED"
        } else {
            GOOD[0]
        };
        assert_eq!(answers.concat(), [first, "2: ECONNREFUSED"]);
    }
}

#[test]
fn stream_with_more_than_one_read_takes() {
    let mut test = over_tcp().start();
    let mut stream = Vec::new();
    for name in ["a.test", "b.test", "c.test", "d.test"] {
        let query = test.ask(name);
        let padding = record(HINFO, 60, &vec![0; usize::from(u16::MAX) - 52]);
        let message = reply(
            &query.bytes,
            0,
            [&[address("1.1.1.1", 60), padding], &[], &[]],
        );
        assert_eq!(message.len(), usize::from(u16::MAX));
        stream.extend(frame(&message));
    }
    test.arrive(0, &stream);
    let answers = [test.process(0, true, false), test.process(0, true, false)];
    assert_eq!(answers.concat().len(), 4);
}

#[test]
fn local_address() {
    let mut test = one_server().start();
    let mut local_for = |server: &str, local: &str| {
        test.client.set_local_ip(local.parse().unwrap());
        drop(test.client.cancel());
        test.set_servers(&[server]);
        let socket = test.ask("a.test").socket;
        let local = test.world().opened[socket].local;
        local.map(|ip| ip.to_string()).unwrap_or_default()
    };
    assert_eq!(local_for("10.0.0.1:53", "1::1"), "");
    assert_eq!(local_for("[2::2]:53", "1.1.1.1"), "1::1");
    assert_eq!(local_for("10.0.0.1:53", "::"), "1.1.1.1");
    assert_eq!(local_for("[2::2]:53", "0.0.0.0"), "");
    assert_eq!(local_for("10.0.0.1:53", "::"), "");
}

fn one_request_of_each_kind() -> Test {
    let mut test = one_server().start();
    test.resolve(RecordType::A, "a.test");
    test.lookup("b.test", Family::Unspecified);
    test.reverse("1.1.1.1");
    test.name_info("2.2.2.2", 1);
    let [a, b, ..] = test.sent_exactly::<5>();
    test.decline(&a, TRUNCATED);
    test.answer(&b, &[address("1.1.1.1", 60)]);
    assert!(test.client.has_requests());
    test.sent();
    test
}

#[test]
fn cancel() {
    let mut test = one_request_of_each_kind();
    let expected = [
        "2: ECANCELLED",
        "3: ECANCELLED",
        "4: ECANCELLED",
        "ECANCELLED",
    ];
    assert_eq!(shown(&test.client.cancel()), expected);
    assert!(test.is_idle() && !test.client.has_requests() && test.sent().is_empty());
    assert_eq!(shown(&test.client.cancel()), NOTHING);
    test.ask("a.test");
}

#[test]
fn close() {
    let expected = [
        "2: EDESTRUCTION",
        "3: EDESTRUCTION",
        "4: EDESTRUCTION",
        "EDESTRUCTION",
    ];
    assert_eq!(shown(&one_request_of_each_kind().client.close()), expected);
}
