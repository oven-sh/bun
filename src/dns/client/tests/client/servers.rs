use core::time::Duration;

use bun_dns_client::{Family, RecordType};

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
        (1, 250),
        (250, 250),
        (300, 300),
        (5000, 5000),
        (u64::MAX, 5000),
    ] {
        let mut setup = resolv_conf("options timeout:3").tries(1);
        setup.timeout_ms = Some(asked);
        assert_eq!(timeouts(setup, 0), [expected]);
    }
}

#[test]
fn many_rounds() {
    let mut test = one_server().tries(64).start();
    test.ask("a.test");
    for _ in 1..64 {
        assert_eq!(test.wait(u64::MAX), NOTHING);
    }
    assert_eq!(test.wait(u64::MAX), ["ETIMEOUT"]);
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
fn failures_are_counted_up_to_a_limit() {
    for (first, second, best) in [
        (1, 1, FIRST),
        (2, 1, SECOND),
        (16, 15, SECOND),
        (17, 16, FIRST),
        (300, 300, FIRST),
    ] {
        let mut test = two_servers().tries(1).start();
        for index in 0..first {
            test.ask(&format!("{index}.test"));
        }
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
    assert_eq!(test.decline(&probe, REFUSED), NOTHING);
    test.wait(2000);
    assert_eq!(test.server_of(&test.sent_one()), FIRST);
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
