use core::time::Duration;

use bun_dns_client::{Family, RecordType, SocketError, Transport};

use crate::machine::{NOTHING, Sent, Setup, Test, one_server, resolv_conf, shown, two_servers};
use crate::wire::*;

const FIRST: &str = "10.0.0.1:53";
const SECOND: &str = "10.0.0.2:53";
const THIRD: &str = "10.0.0.3:53";

/// For the number that decides on a probe.
pub(crate) const LUCK: u16 = 10;
const NO_LUCK: u16 = 15;

/// Of each try, with the same number to make up the jitter from.
fn timeouts(setup: Setup, random: u16) -> Vec<u64> {
    let mut test = setup.start();
    test.world().randoms.extend([random | 1; 99]);
    test.ask("a.test");
    core::iter::from_fn(|| (!test.is_idle()).then(|| test.wait_for_timeout())).collect()
}

#[test]
fn timeout_doubles_with_each_round() {
    assert_eq!(timeouts(one_server(), 0), [2000, 4000, 8000, 16000]);
    assert_eq!(timeouts(one_server(), u16::MAX), [2000, 2000, 4000, 8000]);
    assert_eq!(
        timeouts(one_server(), u16::MAX / 2),
        [2000, 3001, 6001, 12001]
    );
    assert_eq!(
        timeouts(two_servers().tries(2), 0),
        [2000, 2000, 4000, 4000]
    );
}

#[test]
fn timeout_that_was_asked_for() {
    for (asked, expected) in [
        (1, &[250, 500][..]),
        (250, &[250, 500]),
        (300, &[300, 600]),
        (5001, &[5000, 10000]),
        (10001, &[5000, 10000, 1]),
        (31000, &[5000, 10000, 20000]),
    ] {
        let setup = resolv_conf("options timeout:3").tries(2);
        assert_eq!(timeouts(setup.timeout(asked), 0), expected);
    }
    let setup = two_servers().tries(1).timeout(7000);
    assert_eq!(timeouts(setup, 0), [5000, 5000, 2000]);
}

#[test]
fn timeout_that_was_asked_for_follows_the_latency() {
    for (latency, expected, overtime) in [
        (1, [250, 500], 500),
        (150, [750, 1500], 0),
        (900, [4500, 9000], 0),
    ] {
        let asked = one_server().timeout(1000);
        for setup in [asked, resolv_conf("options timeout:1")] {
            let mut test = setup.tries(2).start();
            test.warm_up(latency);
            test.world().randoms.extend([1; 9]);
            assert_eq!([next_timeout(&mut test), test.wait_for_timeout()], expected);
            assert_eq!(test.is_idle(), overtime == 0);
            assert!(test.is_idle() || test.wait_for_timeout() == overtime);
        }
    }
}

#[test]
fn overtime() {
    for (options, repeats) in [("", 1), ("use-vc", 0)] {
        let setup = resolv_conf(format!("options {options}")).tries(1);
        let mut test = setup.timeout(7000).start();
        let slow = test.ask("a.test");
        test.set_servers(&["127.0.0.1:53", SECOND]);
        test.wait(4999);
        assert_eq!(test.servers()[0], "127.0.0.1:53");
        assert_eq!(test.wait(1), NOTHING);
        assert_eq!(test.servers()[0], SECOND);
        let place = |it: &Sent| (it.socket, it.id());
        let repeated: Vec<_> = test.sent().iter().map(place).collect();
        assert_eq!(repeated, vec![place(&slow); repeats]);
        test.set_servers(&["127.0.0.1:53"]);
        let again = test.ask("a.test");
        assert_eq!(again.socket, 1);
        test.wait(1999);
        assert_eq!(test.decline(&slow, NXDOMAIN), ["ENOTFOUND"]);

        test.wait(3001);
        assert_eq!(test.sent().len(), repeats);
        let other = test.ask("b.test");
        test.decline(&other, NXDOMAIN);
        test.set_servers(&["127.0.0.1:53", SECOND]);
        test.set_servers(&["127.0.0.1:53", SECOND]);
        assert_eq!(test.wait(2000), ["2: ETIMEOUT"]);
        assert_eq!(test.servers()[0], "127.0.0.1:53");
        assert!(test.is_idle());
    }
}

#[test]
fn no_overtime_for_what_is_not_needed() {
    let mut test = one_server().tries(1).timeout(7000).start();
    test.lookup("a.test", Family::Unspecified);
    let [a, _] = test.sent_exactly();
    test.answer(&a, &[address("1.1.1.1", 9)]);
    assert_eq!(test.wait(5000), ["1.1.1.1/9"]);
    assert!(test.is_idle());
}

#[test]
fn longest_timeout_that_was_asked_for() {
    for (asked, max, random, expected) in [
        (None, 5000, 0, [2000, 4000, 5000, 5000]),
        (None, 5000, u16::MAX, [2000, 2000, 2500, 2500]),
        (None, 100, 0, [100; 4]),
        (Some(9000), 9000, u16::MAX, [9000; 4]),
        (Some(9000), 300, 0, [300; 4]),
        (Some(40000), 45000, u16::MAX, [40000; 4]),
    ] {
        let mut setup = one_server();
        (setup.timeout_ms, setup.max_timeout_ms) = (asked, Some(max));
        assert_eq!(timeouts(setup, random), expected);
    }
}

#[test]
fn next_check() {
    for (asked, max, check) in [
        (None, None, 1000),
        (None, Some(500), 500),
        (Some(1), None, 250),
        (Some(700), Some(800), 700),
        (Some(9000), None, 1000),
        (Some(9000), Some(300), 300),
    ] {
        let mut setup = one_server();
        (setup.timeout_ms, setup.max_timeout_ms) = (asked, max);
        let mut test = setup.start();
        assert_eq!(test.client.next_check(), None);
        test.tick(7);
        test.ask("a.test");
        assert_eq!(test.ms_to_next_check(), check);
        test.tick(200);
        test.ask("b.test");
        assert_eq!(test.ms_to_next_check(), check - 200);
        test.tick(check as u64 - 200);
        assert_eq!(test.ms_to_next_check(), check);
    }
}

#[test]
fn timer_that_fires_early_ends_nothing() {
    let mut test = one_server().tries(1).start();
    test.ask("a.test");
    test.tick(500);
    test.ask("b.test");
    let ended = [500, 1000, 500, 499, 1].map(|ms| test.tick(ms));
    assert_eq!(ended.map(|it| it.len()), [0, 1, 0, 0, 1]);
}

#[test]
fn timer_that_fires_late() {
    let mut test = one_server().tries(1).start();
    test.ask("a.test");
    assert_eq!(test.tick(1500), NOTHING);
    assert_eq!(test.tick(1500), ["ETIMEOUT"]);
}

#[test]
fn many_rounds() {
    for asked in [None, Some(u64::MAX)] {
        let mut setup = one_server().tries(64);
        setup.timeout_ms = asked;
        let mut test = setup.start();
        test.ask("a.test");
        for _ in 1..64 {
            assert_eq!(test.wait(u64::MAX), NOTHING);
        }
        assert_eq!(test.wait(u64::MAX), ["ETIMEOUT"]);
    }
}

#[test]
fn rounds_with_a_list_that_got_shorter() {
    let mut test = one_server().tries(2).start();
    test.set_servers(&[FIRST, SECOND, THIRD]);
    let mut query = test.ask("a.test");
    for _ in 0..5 {
        assert_eq!(test.wait(4000), NOTHING);
        query = test.sent().swap_remove(0);
    }
    test.set_servers(&[&test.server_of(&query)]);
    test.world().randoms.extend([1; 9]);
    test.decline(&query, TRUNCATED);
    test.sent_one();
    assert_eq!(test.wait_for_timeout(), 8000);
}

fn answer_after(test: &mut Test, ms: u64, flags: u16) {
    let query = test.ask("a.test");
    test.world().now += Duration::from_millis(ms);
    assert_eq!(test.decline(&query, flags).len(), 1);
}

fn next_timeout(test: &mut Test) -> u64 {
    test.ask("a.test");
    test.wait_for_timeout()
}

#[test]
fn timeout_follows_the_latency() {
    for (latencies, expected) in [
        (&[100, 100][..], 2000),
        (&[100, 200, 300], 1000),
        (&[0, 0, 0], 250),
        (&[0, 0, 152], 255),
        (&[1900, 1900, 1900], 5000),
    ] {
        let mut test = one_server().tries(1).start();
        for (&ms, flags) in latencies.iter().zip([0, NXDOMAIN, 0]) {
            answer_after(&mut test, ms, flags);
        }
        assert_eq!(next_timeout(&mut test), expected);
    }

    let mut test = one_server().tries(1).start();
    (0..3).for_each(|_| answer_after(&mut test, 100, REFUSED));
    assert_eq!(next_timeout(&mut test), 2000);
}

const HOUR: u64 = 3600;
const DAY: u64 = 24 * HOUR;

fn at(test: &mut Test, seconds: u64) {
    test.world().now = Duration::from_secs(20 * DAY + seconds);
}

#[test]
fn recent_latency_comes_first() {
    let mut test = one_server().tries(1).start();
    for (seconds, latencies, timeouts) in [
        (0, &[100; 3][..], &[][..]),
        (60, &[300; 3], &[(70, 1500)]),
        (120, &[200], &[(130, 1500), (180, 1000)]),
        (900, &[500; 3], &[(1000, 2500), (1800, 1450)]),
        (HOUR, &[100; 3], &[(HOUR + 1800, 500), (2 * HOUR, 1230)]),
        (DAY, &[700; 3], &[(DAY + 2 * HOUR, 3500), (2 * DAY, 1655)]),
    ] {
        at(&mut test, seconds);
        for &ms in latencies {
            answer_after(&mut test, ms, 0);
        }
        for &(seconds, expected) in timeouts {
            at(&mut test, seconds);
            assert_eq!(next_timeout(&mut test), expected);
        }
    }
}

#[test]
fn how_long_latency_is_recent() {
    for period in [60, 900, HOUR, DAY] {
        let mut test = one_server().tries(1).start();
        for (seconds, ms) in [(0, 100), (period, 300)] {
            at(&mut test, seconds);
            (0..3).for_each(|_| answer_after(&mut test, ms, 0));
        }
        at(&mut test, 2 * period - 1);
        assert_eq!([(); 2].map(|()| next_timeout(&mut test)), [1500, 1000]);
    }
}

#[test]
fn servers_with_fewer_failures_come_first() {
    let mut test = one_server().start();
    test.set_servers(&[FIRST, SECOND, THIRD]);
    let mut query = test.ask("a.test");
    let mut asked = Vec::new();
    for _ in 0..4 {
        asked.push(test.server_of(&query));
        test.break_socket(query.socket);
        test.process(query.socket, true, false);
        query = test.sent_one();
        test.wait(1);
    }
    assert_eq!(asked, [FIRST, SECOND, THIRD, FIRST]);
    assert_eq!(test.servers(), [SECOND, THIRD, FIRST]);
    test.decline(&query, SERVFAIL);
    assert_eq!(test.servers(), [SECOND, THIRD, FIRST]);
}

#[test]
fn servers_at_the_limit_take_turns() {
    let mut test = two_servers().tries(1).start();
    for round in 0..20 {
        test.world().randoms.push_back(NO_LUCK);
        let query = test.ask(&format!("{round}.test"));
        assert_eq!(test.server_of(&query), FIRST);
        test.wait(2000);
        assert_eq!(test.servers(), [SECOND, FIRST]);
        test.wait(2000);
        test.sent();
    }
}

#[test]
fn servers_at_the_limit_take_turns_in_no_time() {
    let mut test = two_servers().start();
    answer_after(&mut test, 0, NXDOMAIN);
    (0..20).for_each(|index| drop(test.ask(&format!("{index}.test"))));
    test.wait(2000);
    test.sent();
    test.world().unreachable = test.client.servers().skip(1).collect();
    assert_eq!(test.wait(2000), NOTHING);
    assert_eq!(test.sent().len(), 20);
}

#[test]
fn failures_are_counted_up_to_a_limit() {
    for (first, second, best) in [
        (1, 1, FIRST),
        (2, 1, SECOND),
        (16, 15, SECOND),
        (17, 16, FIRST),
        (64, 64, FIRST),
    ] {
        let mut test = two_servers().tries(1).start();
        test.ask_many("test", first);
        test.wait(2000);
        let again = test.sent();
        assert!(again.iter().all(|it| test.server_of(it) == SECOND));
        for query in &again[second..] {
            test.decline(query, REFUSED);
        }
        test.wait(2000);
        assert_eq!(test.servers()[0], best);
        test.set_servers(&[SECOND, FIRST]);
        assert_eq!(test.servers()[0], best);
    }
}

/// What timed out at the first of `servers` has been sent to the second.
fn after_many_timeouts(options: &str, servers: &[&str]) -> (Test, Vec<Sent>) {
    let mut test = resolv_conf(format!("options {options}")).start();
    test.set_servers(&servers[..1]);
    (0..20).for_each(|index| drop(test.ask(&format!("{index}.test"))));
    test.set_servers(servers);
    test.wait(2000);
    let sent = test.sent();
    assert_eq!(test.server_of(&sent[0]), servers[1]);
    (test, sent)
}

/// Returns the server that got all of `sent` once more.
fn sent_again(test: &Test, sent: &mut Vec<Sent>) -> String {
    let again = test.sent();
    assert_eq!(again.len(), sent.len());
    assert!(again.iter().all(|it| it.socket == again[0].socket));
    *sent = again;
    test.server_of(&sent[0])
}

fn break_socket_of(test: &mut Test, sent: &mut Vec<Sent>) -> String {
    test.break_socket(sent[0].socket);
    assert_eq!(test.process(sent[0].socket, true, false), NOTHING);
    sent_again(test, sent)
}

#[test]
fn second_failure_of_a_socket_leads_to_another_server() {
    let ways: [&dyn Fn(&mut Test, &Sent) -> Vec<String>; 2] =
        [&|test, sent| test.process_error(sent.socket), &|test, _| {
            let results = [Err(SocketError::Failed)];
            test.world().send_results.extend(results);
            test.resolve(RecordType::A, "a.test")
        }];
    for options in ["", "rotate"] {
        for (way, count) in ways.iter().zip([20, 21]) {
            let (mut test, mut sent) = after_many_timeouts(options, &[FIRST, SECOND]);
            assert_eq!(break_socket_of(&mut test, &mut sent), SECOND);
            assert_eq!(way(&mut test, &sent[0]), NOTHING);
            let again = test.sent();
            assert_eq!(again.len(), count);
            assert!(again.iter().all(|it| test.server_of(it) == FIRST));
            assert_eq!(test.servers(), [SECOND, FIRST]);
        }
    }
}

#[test]
fn sockets_that_fail_together() {
    let mut test = two_servers().start();
    test.ask_many("test", 20);
    test.wait(2000);
    let sent = test.sent();
    (0..3).for_each(|index| drop(test.decline(&sent[index], TRUNCATED)));
    let [stream, _, _] = test.sent_exactly();
    test.decline(&stream, NXDOMAIN);
    test.wait(1);
    test.ask("a.test");
    for (socket, count) in [(stream.socket, 2), (sent[0].socket, 18)] {
        assert_eq!(test.process_error(socket), NOTHING);
        let again = test.sent();
        assert_eq!(again.len(), count);
        assert!(again.iter().all(|it| test.server_of(it) == SECOND));
    }
}

#[test]
fn answers_to_others_give_no_third_chance() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
    test.decline(&sent.remove(0), TRUNCATED);
    test.decline(&sent.remove(0), TRUNCATED);
    for (other, expected) in test.sent().iter().zip([SECOND, FIRST]) {
        test.decline(other, NXDOMAIN);
        assert_eq!(break_socket_of(&mut test, &mut sent), expected);
    }
}

#[test]
fn second_chance_is_for_a_stream_that_has_worked() {
    let (mut test, mut sent) = after_many_timeouts("use-vc", &[FIRST, SECOND]);
    assert_eq!(break_socket_of(&mut test, &mut sent), FIRST);

    let (mut test, mut sent) = after_many_timeouts("use-vc", &[FIRST, SECOND]);
    test.decline(&sent.remove(0), NXDOMAIN);
    let asked = [(); 2].map(|()| break_socket_of(&mut test, &mut sent));
    assert_eq!(asked, [SECOND, FIRST]);
}

#[test]
fn servers_take_turns_at_failing_sockets() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND, THIRD]);
    let asked = [(); 7].map(|()| break_socket_of(&mut test, &mut sent));
    assert_eq!(asked, [THIRD, SECOND, THIRD, FIRST, SECOND, THIRD, SECOND]);

    let servers: Vec<_> = (1..=70).map(|port| format!("10.0.0.1:{port}")).collect();
    let servers: Vec<_> = servers.iter().map(String::as_str).collect();
    let (mut test, mut sent) = after_many_timeouts("", &servers);
    for next in servers[2..].iter().chain(&servers[1..]) {
        assert_eq!(break_socket_of(&mut test, &mut sent), *next);
    }
}

#[test]
fn timeout_leads_to_the_best() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
    break_socket_of(&mut test, &mut sent);
    break_socket_of(&mut test, &mut sent);
    test.wait(4000);
    assert_eq!(sent_again(&test, &mut sent), SECOND);

    let (mut test, _) = after_many_timeouts("", &[FIRST, SECOND]);
    test.wait(2000);
    drop(test.client.cancel());
    test.sent();
    let mut sent = vec![test.ask("a.test")];
    for ms in [2000, 4000] {
        assert_eq!(break_socket_of(&mut test, &mut sent), SECOND);
        test.wait(ms);
        assert_eq!(sent_again(&test, &mut sent), FIRST);
    }
}

#[test]
fn what_does_not_use_up_the_second_chance() {
    let ways: [&dyn Fn(&mut Test, &mut Vec<Sent>); 3] = [
        &|test, sent| {
            (sent[1..].iter()).for_each(|query| drop(test.decline(query, NXDOMAIN)));
            test.wait(2000);
        },
        &|test, sent| drop(test.answer(&sent[0], &[ASKED.to_vec()])),
        &|test, sent| {
            break_socket_of(test, sent);
            test.decline(&sent[0], NXDOMAIN);
        },
    ];
    for way in ways {
        let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
        way(&mut test, &mut sent);
        drop(test.client.cancel());
        test.sent();
        let mut sent = vec![test.ask("a.test")];
        let asked = [(); 2].map(|()| break_socket_of(&mut test, &mut sent));
        assert_eq!(asked, [SECOND, FIRST]);
    }
}

#[test]
fn best_of_the_others() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND, THIRD]);
    break_socket_of(&mut test, &mut sent);
    test.wait(2000);
    drop(test.client.cancel());
    test.sent();
    assert_eq!(test.servers(), [SECOND, FIRST, THIRD]);
    let mut sent = vec![test.ask("a.test")];
    assert_eq!(break_socket_of(&mut test, &mut sent), FIRST);
}

#[test]
fn rotate_after_a_failure_of_a_socket() {
    let text = "nameserver 10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.4\noptions rotate";
    let mut test = resolv_conf(text).start();
    test.world().randoms.push_back(0);
    let mut sent = vec![test.ask("a.test")];
    for (random, expected) in [
        (0, SECOND),
        (1, "10.0.0.4:53"),
        (0, THIRD),
        (2, "10.0.0.4:53"),
        (1, SECOND),
    ] {
        test.world().randoms.push_back(random);
        assert_eq!(break_socket_of(&mut test, &mut sent), expected);
    }
}

#[test]
fn rotate_at_the_limit() {
    let ways: [(&dyn Fn(&mut Test, &Sent) -> Vec<String>, &[&str]); 2] = [
        (
            &|test, sent| test.process_error(sent.socket),
            &[FIRST, SECOND],
        ),
        (
            &|test, sent| test.answer(sent, &[ASKED.to_vec()]),
            &[SECOND],
        ),
    ];
    for (way, expected) in ways {
        let (mut test, _) = after_many_timeouts("rotate", &[FIRST, SECOND]);
        test.wait(2000);
        drop(test.client.cancel());
        test.sent();
        test.world().randoms.extend([NO_LUCK, 0]);
        let mut query = test.ask("a.test");
        assert_eq!(test.server_of(&query), FIRST);
        for expected in expected {
            test.world().randoms.push_back(1);
            way(&mut test, &query);
            query = test.sent_one();
            assert_eq!(test.server_of(&query), *expected);
        }
    }
}

#[test]
fn no_socket_for_the_best() {
    let (mut test, _) = after_many_timeouts("", &[FIRST, SECOND]);
    drop(test.client.cancel());
    test.world().unreachable = vec![SECOND.parse().unwrap()];
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["21: ECONNREFUSED"]);
    test.world().unreachable.clear();
    let mut sent = vec![test.ask("a.test")];
    assert_eq!(break_socket_of(&mut test, &mut sent), FIRST);
}

#[test]
fn no_socket_for_the_other_server() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
    test.world().unreachable = vec![FIRST.parse().unwrap()];
    let before = test.world().connect_calls;
    let asked = [(); 4].map(|()| break_socket_of(&mut test, &mut sent));
    assert_eq!(asked, [SECOND; 4]);
    assert_eq!(test.world().connect_calls - before, 5);

    let mut test = two_servers().tries(64).start();
    test.world().unreachable = vec![SECOND.parse().unwrap()];
    let ask = |index| test.ask(&format!("{index}.test"));
    let mut sent: Vec<_> = (0..20).map(ask).collect();
    (0..30).for_each(|_| drop(break_socket_of(&mut test, &mut sent)));
    assert_eq!(test.world().connect_calls, 61);
}

#[test]
fn end_of_a_connection_that_worked() {
    for options in ["", "use-vc"] {
        let (mut test, mut sent) = after_many_timeouts(options, &[FIRST, SECOND]);
        for _ in 0..3 {
            test.decline(&sent.remove(0), NXDOMAIN);
            assert_eq!(break_socket_of(&mut test, &mut sent), SECOND);
        }
    }

    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
    break_socket_of(&mut test, &mut sent);
    test.decline(&sent.remove(0), TRUNCATED);
    test.sent_one();
    assert_eq!(break_socket_of(&mut test, &mut sent), SECOND);

    let (mut test, mut sent) = after_many_timeouts("use-vc", &[FIRST, SECOND]);
    for expected in [SECOND, FIRST] {
        test.answer(&sent[0], &[ASKED.to_vec()]);
        test.sent_one();
        assert_eq!(break_socket_of(&mut test, &mut sent), expected);
    }
}

#[test]
fn stream_after_a_failure_of_a_socket() {
    let mut test = one_server().start();
    time_out(&mut test, &[5000]);
    test.set_servers(&[FIRST, SECOND]);
    let mut sent = vec![test.ask("b.test")];
    break_socket_of(&mut test, &mut sent);
    break_socket_of(&mut test, &mut sent);
    test.world().randoms.push_back(NO_LUCK);
    answer_after(&mut test, 0, NXDOMAIN);
    test.decline(&sent[0], TRUNCATED);
    assert_eq!(test.server_of(&test.sent_one()), FIRST);

    let mut test = one_server().start();
    let mut sent = vec![test.ask("a.test")];
    (0..3).for_each(|_| drop(break_socket_of(&mut test, &mut sent)));
    drop(test.client.cancel());
    test.ask("b.test");
    test.set_servers(&[FIRST, SECOND]);
    let mut sent = vec![test.ask("c.test")];
    let asked = [(); 2].map(|()| break_socket_of(&mut test, &mut sent));
    assert_eq!(asked, [SECOND; 2]);
    test.wait(2000);
    test.sent_one();
    test.decline(&sent[0], TRUNCATED);
    assert_eq!(test.server_of(&test.sent_one()), SECOND);
}

#[test]
fn malformed_reply_leads_to_a_server_that_is_as_good() {
    let mut test = two_servers().start();
    let [a, b] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.arrive(a.socket, &reply(&a.bytes, 0, [&[ASKED.to_vec()], &[], &[]]));
    assert_eq!(test.decline(&b, NXDOMAIN), ["2: ENOTFOUND"]);
    assert_eq!(test.servers(), [FIRST, SECOND]);
    assert_eq!(test.server_of(&test.sent_one()), SECOND);

    let (mut test, sent) = after_many_timeouts("", &[FIRST, SECOND]);
    let mut query = sent[0].clone();
    for _ in 0..6 {
        assert_eq!(test.answer(&query, &[ASKED.to_vec()]), NOTHING);
        query = test.sent_one();
        assert_eq!(test.server_of(&query), SECOND);
    }
    assert_eq!(test.answer(&query, &[ASKED.to_vec()]), ["EBADRESP"]);
}

/// Some queries to the only server time out, and some more after each pause.
fn time_out(test: &mut Test, pauses: &[u64]) {
    for ms in [2000].iter().chain(pauses) {
        test.wait(ms - 2000);
        (0..3).for_each(|index| drop(test.ask(&format!("{index}.test"))));
        test.wait(2000);
        drop(test.client.cancel());
        test.sent();
    }
}

#[test]
fn server_that_has_long_been_silent_gets_no_extra_turn() {
    for (first, second, expected) in [
        (&[2500, 2500][..], 0, FIRST),
        (&[2500, 2501], 0, SECOND),
        (&[3000, 3000], 1000, FIRST),
        (&[3000, 3001], 1000, SECOND),
        (&[HOUR * 1000], 0, FIRST),
        (&[HOUR * 1000, 2000], 0, SECOND),
    ] {
        let mut test = one_server().start();
        time_out(&mut test, first);
        test.set_servers(&[FIRST, SECOND]);
        let mut sent = vec![test.ask("b.test")];
        assert_eq!(break_socket_of(&mut test, &mut sent), SECOND);
        test.world().now += Duration::from_millis(second);
        assert_eq!(break_socket_of(&mut test, &mut sent), expected);
    }
}

#[test]
fn server_that_is_not_silent_gets_no_extra_turn() {
    let ways: [&dyn Fn(&mut Test, &Sent) -> Vec<String>; 2] = [
        &|test, sent| test.process_error(sent.socket),
        &|test, sent| test.answer(sent, &[ASKED.to_vec()]),
    ];
    for way in ways {
        let mut test = one_server().start();
        time_out(&mut test, &[]);
        let query = test.ask("a.test");
        way(&mut test, &query);
        drop(test.client.cancel());
        test.sent();
        test.set_servers(&[FIRST, SECOND]);
        let mut sent = vec![test.ask("b.test")];
        let asked = [(); 2].map(|()| break_socket_of(&mut test, &mut sent));
        assert_eq!(asked, [SECOND; 2]);
    }
}

#[test]
fn answer_ends_an_outage() {
    let mut test = one_server().start();
    time_out(&mut test, &[4000, 4000]);
    answer_after(&mut test, 0, NXDOMAIN);
    time_out(&mut test, &[4000]);
    test.set_servers(&[FIRST, SECOND]);
    let mut sent = vec![test.ask("b.test")];
    let asked = [(); 2].map(|()| break_socket_of(&mut test, &mut sent));
    assert_eq!(asked, [SECOND, FIRST]);
}

#[test]
fn new_list_after_a_failure_of_a_socket() {
    let (mut test, mut sent) = after_many_timeouts("", &[FIRST, SECOND]);
    test.set_servers(&[SECOND, FIRST]);
    break_socket_of(&mut test, &mut sent);
    break_socket_of(&mut test, &mut sent);
    assert_eq!(test.set_servers(&[THIRD, "10.0.0.4:53"]), NOTHING);
    assert_eq!(sent_again(&test, &mut sent), THIRD);
}

#[test]
fn rotate() {
    let text = "nameserver 10.0.0.1 10.0.0.2 10.0.0.3\noptions rotate";
    let mut test = resolv_conf(text).start();
    let ask = |test: &mut Test, name: &str, randoms: &[u16]| {
        test.world().randoms.extend(randoms);
        let query = test.ask(name);
        test.server_of(&query)
    };
    let asked = [0, 1, 2, 3].map(|it| ask(&mut test, &format!("a{it}"), &[it]));
    assert_eq!(asked, [FIRST, SECOND, THIRD, FIRST]);
    test.break_socket(1);
    test.process(1, true, false);
    test.sent();
    let asked = [0, 1, 2].map(|it| ask(&mut test, &format!("b{it}"), &[NO_LUCK, it]));
    assert_eq!(asked, [FIRST, THIRD, FIRST]);
    assert_eq!(test.set_servers(&[]).len(), 7);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["8: ENOSERVER"]);
}

/// The first of two servers failed `ms` ago.
pub(crate) fn after_a_failure(ms: u64) -> Test {
    let mut test = two_servers().start();
    test.ask("a.test");
    test.break_socket(0);
    test.process(0, true, false);
    test.decline(&test.sent_one(), NXDOMAIN);
    test.wait(ms);
    test
}

#[test]
fn probe() {
    let mut test = after_a_failure(5000);
    test.world().randoms.push_back(LUCK);
    test.resolve(RecordType::A, "b.test");
    let [query, probe] = test.sent_exactly();
    assert_eq!(
        [test.server_of(&query), test.server_of(&probe)],
        [SECOND, FIRST]
    );
    assert_eq!(query.question(), probe.question());

    test.world().randoms.push_back(LUCK);
    let next = test.ask("c.test");
    assert_eq!(test.decline(&next, REFUSED), ["3: EREFUSED"]);
    assert_eq!(test.decline(&query, REFUSED), ["2: EREFUSED"]);
    assert!(!test.is_idle() && !test.client.has_requests());

    assert_eq!(test.decline(&probe, REFUSED), NOTHING);
    assert_eq!(test.servers(), [FIRST, SECOND]);
    assert!(test.is_idle());
}

#[test]
fn probe_does_not_last() {
    for (asked, answers, expected) in [(3000, 0, 3000), (9000, 0, 5000), (9000, 3, 500)] {
        let mut setup = two_servers();
        setup.timeout_ms = Some(asked);
        let mut test = setup.start();
        (0..answers).for_each(|_| answer_after(&mut test, 100, 0));
        let query = test.ask("a.test");
        test.break_socket(query.socket);
        test.process(query.socket, true, false);
        test.decline(&test.sent_one(), NXDOMAIN);
        test.wait(5000);
        let [query, _] = ask_with_luck(&mut test);
        test.decline(&query, REFUSED);
        test.wait(expected - 1);
        assert!(!test.is_idle());
        test.wait(1);
        assert!(test.is_idle());
    }
}

#[test]
fn probe_is_for_one_that_failed() {
    let mut test = after_a_failure(6000);
    test.set_servers(&[FIRST, SECOND, THIRD]);
    test.world().randoms.push_back(LUCK);
    test.resolve(RecordType::A, "b.test");
    assert_eq!(
        test.sent_exactly().map(|it| test.server_of(&it)),
        [SECOND, FIRST]
    );
}

#[test]
fn probe_next_to_a_retry() {
    let mut test = two_servers().start();
    let [a, _] = ["a.test", "b.test"].map(|name| test.ask(name));
    test.wait(2000);
    let [a_again, b_again] = test.sent_exactly();
    assert_eq!(a_again.question(), a.question());
    test.decline(&a_again, REFUSED);
    test.decline(&b_again, REFUSED);
    test.wait(5000);

    test.world().randoms.push_back(NO_LUCK);
    test.ask("c.test");
    test.wait(2000);
    let [retry, probe] = test.sent_exactly();
    assert_eq!(
        [test.server_of(&retry), test.server_of(&probe)],
        [SECOND, FIRST]
    );
    assert_eq!(test.transport_of(&probe), Transport::Udp);
    assert_eq!(test.decline(&probe, REFUSED), NOTHING);
    test.wait(2000);
    assert_eq!(test.server_of(&test.sent_one()), FIRST);
}

#[test]
fn probe_over_a_stream() {
    let ways: [(&str, &dyn Fn(&mut Test)); 2] = [
        ("use-vc", &|test| {
            test.world().randoms.push_back(LUCK);
            test.resolve(RecordType::A, "a.test");
        }),
        ("", &|test| {
            let [_, other] = ["a.test", "b.test"].map(|name| {
                test.world().randoms.push_back(NO_LUCK);
                let query = test.ask(name);
                test.decline(&query, TRUNCATED);
                test.sent_one()
            });
            test.decline(&other, NXDOMAIN);
            test.process_error(other.socket);
        }),
    ];
    for (options, way) in ways {
        let (mut test, _) = after_many_timeouts(options, &[FIRST, SECOND]);
        drop(test.client.cancel());
        test.wait(5000);
        way(&mut test);
        let [query, probe] = test.sent_exactly();
        assert_eq!(
            [&query, &probe].map(|it| (test.server_of(it), test.transport_of(it))),
            [SECOND, FIRST].map(|it| (it.into(), Transport::Tcp))
        );
    }
}

#[test]
fn no_probe() {
    for (ms, random) in [(4999, LUCK), (5000, NO_LUCK)] {
        let mut test = after_a_failure(ms);
        test.world().randoms.push_back(random);
        test.ask("b.test");
    }

    let mut test = after_a_failure(5000);
    test.set_servers(&[FIRST, SECOND, THIRD]);
    test.world().randoms.push_back(NO_LUCK);
    test.ask("b.test");
    test.wait(2000);
    assert_eq!(test.server_of(&test.sent_one()), THIRD);

    let mut test = one_server().tries(1).start();
    test.ask("a.test");
    test.wait(2000);
    test.wait(5000);
    test.world().randoms.push_back(LUCK);
    test.ask("b.test");
}

/// The query and the probe.
fn ask_with_luck<const N: usize>(test: &mut Test) -> [Sent; N] {
    test.world().randoms.push_back(LUCK);
    test.resolve(RecordType::A, "b.test");
    test.sent_exactly()
}

#[test]
fn probe_for_the_first_of_two_that_failed() {
    let mut test = after_a_failure(1000);
    test.set_servers(&[FIRST, SECOND, THIRD]);
    let query = test.ask("c.test");
    test.process_error(query.socket);
    test.sent_one();
    ask_with_luck::<1>(&mut test);
    drop(test.client.cancel());
    test.wait(4000);
    ask_with_luck::<2>(&mut test);

    let mut test = after_a_failure(0);
    let [old, new] = ["c.test", "d.test"].map(|name| test.ask(name));
    test.decline(&old, TRUNCATED);
    let old = test.sent_one();
    test.wait(1000);
    test.process_error(old.socket);
    assert_eq!(test.server_of(&test.sent_one()), FIRST);
    test.decline(&new, NXDOMAIN);
    drop(test.client.cancel());
    test.wait(4000);
    ask_with_luck::<2>(&mut test);
}

#[test]
fn no_room_for_a_probe() {
    let mut test = one_server().start();
    test.ask("a.test");
    test.wait(1999);
    test.world().unreachable = vec![FIRST.parse().unwrap()];
    test.ask_many("test", 63);
    test.wait(1);
    test.ask_many("a.test", 63);
    test.set_servers(&[FIRST, SECOND]);
    test.world().now += Duration::from_secs(5);
    let next_check = test.client.next_check();
    ask_with_luck::<1>(&mut test);
    assert_eq!(test.client.next_check(), next_check);
}

#[test]
fn probe_that_fails() {
    let ways: [&dyn Fn(&mut Test, &Sent) -> Vec<String>; 4] = [
        &|test, _| test.wait(2000),
        &|test, probe| test.decline(probe, TRUNCATED),
        &|test, probe| test.answer(probe, &[ASKED.to_vec()]),
        &|test, probe| {
            test.break_socket(probe.socket);
            test.process(probe.socket, true, false)
        },
    ];
    for fail in ways {
        let mut test = after_a_failure(5000);
        let [query, probe] = ask_with_luck(&mut test);
        test.decline(&query, REFUSED);
        assert_eq!(fail(&mut test, &probe), NOTHING);
        assert!(test.is_idle() && test.sent().is_empty());
        assert_eq!(test.servers(), [SECOND, FIRST]);
    }
}

#[test]
fn probe_that_is_called_off() {
    let mut test = after_a_failure(5000);
    ask_with_luck::<2>(&mut test);
    assert_eq!(shown(&test.client.cancel()), ["2: ECANCELLED"]);
    assert!(test.is_idle());
    test.wait(4999);
    ask_with_luck::<1>(&mut test);
    drop(test.client.cancel());
    test.wait(1);
    ask_with_luck::<2>(&mut test);
    assert_eq!(test.set_servers(&[SECOND]), NOTHING);
    assert!(test.sent().is_empty() && test.client.has_requests());
    assert_eq!(test.open_sockets(), 1);
}

#[test]
fn new_list() {
    let mut test = one_server().start();
    test.set_servers(&[
        SECOND,
        "[1::1]:0",
        SECOND,
        "10.0.0.2:54",
        "10.0.0.2:0",
        "[1::1]:53",
    ]);
    assert_eq!(test.servers(), [SECOND, "[1::1]:53", "10.0.0.2:54"]);
    test.set_servers(&["10.0.0.2:54", FIRST, SECOND]);
    assert_eq!(test.servers(), ["10.0.0.2:54", FIRST, SECOND]);
}

#[test]
fn server_that_stays_keeps_its_history() {
    let mut test = after_a_failure(0);
    test.set_servers(&[FIRST, THIRD, SECOND]);
    assert_eq!(test.servers(), [THIRD, SECOND, FIRST]);

    let mut test = resolv_conf("nameserver fe80::1%eth0").start();
    let query = test.ask("a.test");
    let server = test.world().opened[0].server;
    assert_eq!(Ok(server), "[fe80::1%7]:53".parse());
    assert_eq!(test.set_servers(&[FIRST, "[fe80::1]:53"]), NOTHING);
    assert_eq!(test.servers(), [FIRST, "[fe80::1%7]:53"]);
    assert!(test.sent().is_empty());
    assert_eq!(test.decline(&query, REFUSED), ["EREFUSED"]);
}

#[test]
fn server_that_is_back_takes_its_place() {
    let mut test = after_a_failure(5000);
    test.set_servers(&[SECOND, FIRST, THIRD]);
    let [_, probe] = ask_with_luck(&mut test);
    assert_eq!(test.servers(), [SECOND, THIRD, FIRST]);
    test.decline(&probe, REFUSED);
    assert_eq!(test.servers(), [SECOND, FIRST, THIRD]);
}

#[test]
fn queries_leave_a_server_that_goes() {
    let mut test = two_servers().start();
    test.ask("a.test");
    test.wait(1000);
    test.ask("b.test");
    test.wait(1000);
    test.sent_one();
    assert_eq!(test.set_servers(&[THIRD]), NOTHING);
    let [a, b] = test.sent_exactly();
    assert_eq!([a.question(), b.question()], ["b.test A", "a.test A"]);
    assert_eq!((test.server_of(&a), test.open_sockets()), (THIRD.into(), 1));
}

#[test]
fn shorter_list_than_the_tries_were_counted_for() {
    let mut test = two_servers().tries(64).start();
    test.ask("a.test");
    (0..100).for_each(|_| assert_eq!(test.wait(u64::MAX), NOTHING));
    let query = test.sent().pop().unwrap();
    assert_eq!(test.set_servers(&[&test.server_of(&query)]), NOTHING);
    assert_eq!(test.decline(&query, TRUNCATED), NOTHING);
    assert_eq!(test.decline(&test.sent_one(), REFUSED), ["EREFUSED"]);
}

#[test]
fn no_servers() {
    let mut test = one_server().start();
    test.ask("a.test");
    test.break_socket(0);
    test.process(0, true, false);
    test.resolve(RecordType::A, "b.test");
    assert_eq!(test.set_servers(&[]), ["ECONNREFUSED", "2: ETIMEOUT"]);
    assert_eq!(test.servers(), NOTHING);
    assert_eq!(test.resolve(RecordType::A, "a.test"), ["3: ENOSERVER"]);
    assert!(test.is_idle());

    let mut test = resolv_conf("search s").start();
    test.lookup("h", Family::Unspecified);
    let [a, _] = test.sent_exactly();
    test.decline(&a, NXDOMAIN);
    test.ask("b.test");
    assert_eq!(test.set_servers(&[]), ["2: ETIMEOUT", "ENOSERVER"]);
}
