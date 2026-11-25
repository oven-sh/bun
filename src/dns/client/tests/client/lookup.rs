use bun_dns_client::{Family, RecordType, Route, Variable};

use crate::config::searched;
use crate::machine::{
    HOSTS, NOTHING, NSSWITCH, Sent, Setup, Test, one_server, resolv_conf, two_servers,
};
use crate::wire::*;

fn both(setup: Setup, host: &str) -> (Test, [Sent; 2]) {
    let mut test = setup.tries(1).start();
    assert_eq!(test.lookup(host, Family::Unspecified), NOTHING);
    let sent = test.sent_exactly();
    (test, sent)
}

#[test]
fn without_a_query() {
    for family in [Family::Unspecified, Family::Inet, Family::Inet6] {
        let lookup = |host| resolv_conf("search s").start().lookup(host, family);
        assert_eq!(lookup("1.2.3.4"), ["1.2.3.4/0"]);
        assert_eq!(lookup("a.onion"), ["ENOTFOUND"]);
        assert_eq!(lookup("é"), ["EBADNAME"]);
    }
    for host in ["1.2.3.256", "1.2.3.4.5", "1.a"] {
        assert_eq!(searched(one_server(), host), host);
    }
}

#[test]
#[cfg(unix)]
fn short_forms_of_an_address() {
    for host in ["1", "1.2", "1.2.3", "1.2.3.04", "0x1.2"] {
        let mut test = resolv_conf("search s")
            .file(HOSTS, format!("1.1.1.1 {host}"))
            .start();
        assert_eq!(test.lookup(host, Family::Unspecified), ["ENOTFOUND"]);
    }
}

#[test]
fn families() {
    let all = [address("1.1.1.1", 1), address("1::1", 2)];
    for (family, question, expected) in [
        (Family::Inet, "a.test A", "1.1.1.1/1"),
        (Family::Inet6, "a.test AAAA", "1::1/2"),
    ] {
        let mut test = one_server().start();
        test.lookup("a.test", family);
        let query = test.sent_one();
        assert_eq!(query.question(), question);
        assert_eq!(test.answer(&query, &all), [expected]);
    }
    for order in [[0, 1], [1, 0]] {
        let (mut test, sent) = both(one_server(), "a.test");
        assert_eq!(
            sent.each_ref().map(Sent::question),
            ["a.test A", "a.test AAAA"]
        );
        assert_eq!(test.answer(&sent[order[0]], &all), NOTHING);
        assert_eq!(test.answer(&sent[order[1]], &all), ["1::1/2, 1.1.1.1/1"]);
    }
}

#[test]
fn aliases() {
    let alias = || record(CNAME, 5, &name("c.test"));
    let (mut test, [a, aaaa]) = both(one_server(), "a.test");
    test.answer(&a, &[alias(), address("1.1.1.1", 9)]);
    assert_eq!(test.answer(&aaaa, &[alias()]), ["1.1.1.1/5"]);

    let (mut test, [a, aaaa]) = both(one_server(), "a.test");
    test.answer(&a, &[alias()]);
    assert_eq!(test.answer(&aaaa, &[alias()]), ["ENODATA"]);
}

#[test]
fn one_family_is_enough() {
    for code in [0, FORMERR, SERVFAIL, NXDOMAIN, REFUSED] {
        for good in [0, 1] {
            let all = [address("1.1.1.1", 1), address("1::1", 2)];
            let expected = [["1.1.1.1/1", "1::1/2"][good]];
            let (mut test, sent) = both(one_server(), "a.test");
            test.answer(&sent[good], &all);
            assert_eq!(test.decline(&sent[1 - good], code), expected);
            let (mut test, sent) = both(one_server(), "a.test");
            test.decline(&sent[1 - good], code);
            assert_eq!(test.answer(&sent[good], &all), expected);
        }
    }
}

#[test]
fn both_families_fail() {
    for (a, aaaa, goes_on, expected) in [
        (NXDOMAIN, NXDOMAIN, true, "ENOTFOUND"),
        (NXDOMAIN, SERVFAIL, true, "ENOTFOUND"),
        (NXDOMAIN, 0, true, "ENODATA"),
        (0, NXDOMAIN, true, "ENODATA"),
        (0, 0, true, "ENODATA"),
        (0, REFUSED, true, "EREFUSED"),
        (0, NOTIMP, true, "ENOTIMP"),
        (SERVFAIL, NXDOMAIN, true, "ESERVFAIL"),
        (FORMERR, 0, true, "EFORMERR"),
        (SERVFAIL, REFUSED, false, "ESERVFAIL"),
    ] {
        for order in [[0, 1], [1, 0]] {
            let (mut test, sent) = both(resolv_conf("search s"), "a.test");
            let mut answers = order.map(|index| test.decline(&sent[index], [a, aaaa][index]));
            let next = test.sent();
            assert_eq!(next.len(), 2 * usize::from(goes_on));
            for query in next {
                answers[1] = test.decline(&query, NXDOMAIN);
            }
            assert_eq!(answers.concat(), [expected]);
        }
    }

    let (mut test, [a, aaaa]) = both(resolv_conf("search s"), "a.test");
    test.decline(&a, SERVFAIL);
    test.decline(&aaaa, 0);
    let [a, aaaa] = test.sent_exactly();
    test.decline(&a, REFUSED);
    assert_eq!(test.decline(&aaaa, 0), ["ESERVFAIL"]);
}

#[test]
fn one_family_gets_no_reply() {
    for answered in [0, 1] {
        let (mut test, sent) = both(one_server(), "a.test");
        assert_eq!(test.decline(&sent[answered], 0), NOTHING);
        assert_eq!(test.wait(2000), ["ETIMEOUT"]);
    }
}

#[test]
fn ipv6_is_not_asked_for_again_if_there_is_no_such_name() {
    for (answered, flags, left) in [
        (0, NXDOMAIN, None),
        (0, 0, Some("a.test AAAA")),
        (1, NXDOMAIN, Some("a.test A")),
    ] {
        let mut test = one_server().start();
        test.lookup("a.test", Family::Unspecified);
        test.decline(&test.sent()[answered], flags);
        assert_eq!(test.wait(2000).is_empty(), left.is_some());
        let again = test.sent().pop().map(|it| it.question());
        assert_eq!(again.as_deref(), left);
    }
}

#[test]
fn ipv6_is_not_asked_for_again_once_there_is_ipv4() {
    let mut test = one_server().start();
    test.lookup("a.test", Family::Unspecified);
    let [a, _] = test.sent_exactly();
    test.answer(&a, &[address("1.1.1.1", 9)]);
    assert_eq!(test.wait(2000), ["1.1.1.1/9"]);
    assert_eq!(test.lookup("a.test", Family::Unspecified), NOTHING);
    assert_eq!(test.sent_one().question(), "a.test AAAA");
    assert_eq!(test.wait(2000), ["2: 1.1.1.1/7"]);

    test.lookup("b.test", Family::Unspecified);
    let [_, aaaa] = test.sent_exactly();
    test.answer(&aaaa, &[address("1::1", 9)]);
    assert_eq!(test.wait(2000), NOTHING);
    assert_eq!(test.sent_one().question(), "b.test A");

    let mut test = one_server().start();
    test.lookup("a.test", Family::Unspecified);
    let [a, _] = test.sent_exactly();
    test.answer(&a, &[record(CNAME, 9, &name("c.test"))]);
    assert_eq!(test.wait(2000), NOTHING);
    assert_eq!(test.sent_one().question(), "a.test AAAA");
}

#[test]
fn ipv4_that_comes_with_the_timeout() {
    let mut test = one_server().start();
    test.lookup("a.test", Family::Unspecified);
    let [a, _] = test.sent_exactly();
    test.arrive(0, &reply(&a.bytes, 0, [&[address("1.1.1.1", 9)], &[], &[]]));
    assert_eq!(test.wait(2000), ["1.1.1.1/9"]);
    assert!(test.is_idle());
}

#[test]
fn ipv6_is_asked_for_again_for_those_who_need_it() {
    let mut test = one_server().start();
    test.lookup("a.test", Family::Unspecified);
    test.lookup("a.test", Family::Inet6);
    let [a, _] = test.sent_exactly();
    test.answer(&a, &[address("1.1.1.1", 9)]);
    assert_eq!(test.wait(2000), ["1.1.1.1/9"]);
    assert_eq!(
        test.answer(&test.sent_one(), &[address("1::1", 9)]),
        ["2: 1::1/9"]
    );
}

#[test]
fn search() {
    let (mut test, [a, aaaa]) = both(resolv_conf("search s t"), "h");
    test.decline(&a, NXDOMAIN);
    assert!(test.sent().is_empty());
    test.decline(&aaaa, SERVFAIL);
    let [a, aaaa] = test.sent_exactly();
    assert_eq!([a.question(), aaaa.question()], ["h.t A", "h.t AAAA"]);
    test.answer(&a, &[address("1.1.1.1", 1)]);
    assert_eq!(test.decline(&aaaa, 0), ["1.1.1.1/1"]);

    assert_eq!(searched(resolv_conf("search s"), "h."), "h");
    assert_eq!(searched(resolv_conf("search s"), r"h\."), "h.");
    let long = [
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(59),
    ]
    .join(".");
    let expected = format!("{long} {long}.s");
    assert_eq!(searched(resolv_conf("search st s"), &long), expected);
}

/// How a lookup of `host` ends if the queries get these codes, one after the other.
fn after(text: &str, host: &str, codes: &[u16]) -> Vec<String> {
    let mut test = resolv_conf(text).start();
    let mut answers = test.lookup(host, Family::Inet);
    for &code in codes {
        assert_eq!(answers, NOTHING);
        answers = test.decline(&test.sent_one(), code);
    }
    answers
}

#[test]
fn what_ends_a_search() {
    assert_eq!(
        after("search s t", "h", &[0, NXDOMAIN, NXDOMAIN]),
        ["ENODATA"]
    );
    assert_eq!(after("search s t", "h", &[NXDOMAIN, FORMERR]), ["EFORMERR"]);
    for (code, error) in [(SERVFAIL, "ESERVFAIL"), (REFUSED, "EREFUSED")] {
        assert_eq!(after("search s t", "h", &[code]), [error]);
        assert_eq!(after("search s", "h", &[NXDOMAIN, code]), [error]);
        assert_eq!(after("search s", "h", &[0, code]), ["ENODATA"]);
        for (next, error) in [(NXDOMAIN, "ENOTFOUND"), (0, "ENODATA")] {
            assert_eq!(
                after("search s\noptions ndots:0", "h", &[code, next]),
                [error]
            );
        }
    }
    let (mut test, _) = both(resolv_conf("search s t"), "h");
    assert_eq!(test.wait(2000), ["ETIMEOUT"]);
}

#[test]
fn search_through_the_cache() {
    let mut test = resolv_conf("search s t").start();
    test.lookup("h", Family::Inet);
    for _ in 0..2 {
        let query = test.sent_one();
        test.deliver(
            &query,
            &reply(&query.bytes, NXDOMAIN, [&[], &[soa(9, 9)], &[]]),
        );
    }
    test.answer(&test.sent_one(), &[address("1.1.1.1", 9)]);
    assert_eq!(test.lookup("h", Family::Inet), ["2: 1.1.1.1/9"]);
}

#[test]
fn both_families_from_the_cache() {
    let (mut test, [a, aaaa]) = both(one_server(), "a.test");
    test.answer(&aaaa, &[address("1::1", 9)]);
    test.answer(&a, &[address("1.1.1.1", 9)]);
    let ip = "1::1".parse().unwrap();
    test.world().routes.insert(ip, Route::Unknown);
    assert_eq!(
        test.lookup("a.test", Family::Unspecified),
        ["2: 1.1.1.1/9, 1::1/9"]
    );
}

#[test]
fn hosts_file() {
    let setup = || resolv_conf("search s").file(HOSTS, "1.1.1.1 h\n2.2.2.2 i.s");
    assert_eq!(
        setup().start().lookup("h", Family::Unspecified),
        ["1.1.1.1/0"]
    );
    assert_eq!(setup().start().lookup("h", Family::Inet6), NOTHING);
    assert_eq!(searched(setup(), "i"), "i.s i");

    for (code, expected) in [(NXDOMAIN, "1.1.1.1/0"), (FORMERR, "EFORMERR")] {
        let mut test = setup().file(NSSWITCH, "hosts: dns files").start();
        test.lookup("h", Family::Inet);
        test.decline(&test.sent_one(), NXDOMAIN);
        assert_eq!(test.decline(&test.sent_one(), code), [expected]);
    }
}

#[test]
fn host_aliases() {
    let with = |path| {
        let text = "\nx\nbad b!d\nH\tone.test \r\nh two.test\nh.i three.test";
        let mut setup = resolv_conf("search s").file("/aliases", text);
        setup.variables.push((Variable::HostAliases, path));
        setup
    };
    assert_eq!(searched(with("/aliases"), "h"), "one.test");
    assert_eq!(searched(with("/aliases"), "h.i"), "h.i h.i.s");
    for host in ["x", "bad", "other"] {
        assert_eq!(searched(with("/aliases"), host), format!("{host}.s {host}"));
    }
    assert_eq!(searched(with("/missing"), "h"), "h.s h");
}

const FIRST: &str = "10.0.0.1:53";
const SECOND: &str = "10.0.0.2:53";

fn three_servers() -> Setup {
    resolv_conf("nameserver 10.0.0.1 10.0.0.2 10.0.0.3")
}

/// Server `n` replies with `codes[n - 1]`, or not at all. Returns which were asked, and the outcome.
fn tour(test: &mut Test, codes: &[Option<u16>]) -> String {
    let (mut answers, mut asked) = (test.lookup("a.test", Family::Inet), String::new());
    while answers.is_empty() {
        let query = test.sent_one();
        let number = test.server_of(&query).as_bytes()[7];
        asked.push(number.into());
        answers = match codes[usize::from(number - b'1')] {
            Some(0) => test.answer(&query, &[address("1.1.1.1", 0)]),
            Some(code) => test.decline(&query, code),
            None => test.wait(60_000),
        };
    }
    format!("{asked} {}", answers.concat())
}

#[test]
fn excuse_leads_to_the_next_server() {
    for (code, error) in [
        (FORMERR, "EFORMERR"),
        (SERVFAIL, "ESERVFAIL"),
        (NOTIMP, "ENOTIMP"),
        (REFUSED, "EREFUSED"),
        (9, "ESERVFAIL"),
    ] {
        for tries in [1, 4] {
            let tour = |setup: Setup, codes: &[_]| tour(&mut setup.tries(tries).start(), codes);
            assert_eq!(tour(one_server(), &[Some(code)]), format!("1 {error}"));
            assert_eq!(tour(two_servers(), &[Some(code), Some(0)]), "12 1.1.1.1/0");
            assert_eq!(
                tour(two_servers(), &[Some(code), Some(NXDOMAIN)]),
                "12 ENOTFOUND"
            );
            assert_eq!(
                tour(three_servers(), &[Some(REFUSED), Some(NOTIMP), Some(code)]),
                format!("123 {error}")
            );
            assert_eq!(
                tour(three_servers(), &[Some(code), None, Some(0)]),
                "123 1.1.1.1/0"
            );
        }
    }
    let codes = [Some(NXDOMAIN), Some(0)];
    assert_eq!(tour(&mut two_servers().start(), &codes), "1 ENOTFOUND");
}

#[test]
fn excuse_does_not_count_against_a_server() {
    let mut test = two_servers().start();
    assert_eq!(tour(&mut test, &[Some(REFUSED), Some(0)]), "12 1.1.1.1/0");
    assert_eq!(test.servers(), [FIRST, SECOND]);
}

#[test]
fn next_server_is_silent() {
    for (tries, expected) in [
        (1, "12 ETIMEOUT"),
        (2, "1212 ETIMEOUT"),
        (4, "12121 EREFUSED"),
    ] {
        let mut test = two_servers().tries(tries).start();
        assert_eq!(tour(&mut test, &[Some(REFUSED), None]), expected);
        assert_eq!(
            tour(&mut test, &[Some(REFUSED), Some(0)]),
            "12 2: 1.1.1.1/0"
        );
    }
    let mut test = two_servers().tries(1).start();
    assert_eq!(tour(&mut test, &[None, Some(REFUSED)]), "12 EREFUSED");
}

#[test]
fn excuse_is_final_for_the_others() {
    let mut test = two_servers().start();
    test.resolve(RecordType::A, "a.test");
    test.lookup("a.test", Family::Inet);
    test.resolve(RecordType::A, "a.test");
    let expected = ["EREFUSED", "3: EREFUSED"];
    assert_eq!(test.decline(&test.sent_one(), REFUSED), expected);
    let next = test.sent_one();
    let anew = test.ask("a.test");
    assert_eq!([&next, &anew].map(|it| test.server_of(it)), [SECOND, FIRST]);
    assert_eq!(
        test.answer(&next, &[address("1.1.1.1", 9)]),
        ["2: 1.1.1.1/9"]
    );

    let mut test = two_servers().start();
    test.reverse("1.1.1.1");
    assert_eq!(test.decline(&test.sent_one(), REFUSED), ["ENOTFOUND"]);
}

#[test]
fn reply_after_an_excuse_is_not_kept() {
    let answers = [address("1.1.1.1", 9)];
    let negative = [soa(9, 9)];
    for (flags, sections) in [(0, [&answers[..], &[]]), (NXDOMAIN, [&[], &negative[..]])] {
        for is_read_again in [false, true] {
            let mut test = two_servers().start();
            test.lookup("a.test.", Family::Inet);
            test.decline(&test.sent_one(), REFUSED);
            let next = test.sent_one();
            if is_read_again {
                test.ask("b.test");
            }
            let reply = reply(&next.bytes, flags, [sections[0], sections[1], &[]]);
            assert_eq!(test.deliver(&next, &reply).len(), 1);
            let anew = test.ask("a.test");
            assert_eq!(test.server_of(&anew), FIRST);
        }
    }
}

#[test]
fn lookup_waits_with_one_that_was_excused() {
    let mut test = three_servers().start();
    test.lookup("a.test", Family::Inet);
    for _ in 0..2 {
        test.decline(&test.sent_one(), SERVFAIL);
        assert_eq!(test.lookup("a.test", Family::Inet), NOTHING);
    }
    assert_eq!(
        test.answer(&test.sent_one(), &[address("1.1.1.1", 9)]),
        ["1.1.1.1/9", "2: 1.1.1.1/9", "3: 1.1.1.1/9"]
    );

    let mut test = two_servers().start();
    test.lookup("a.test", Family::Inet);
    test.decline(&test.sent_one(), SERVFAIL);
    test.sent_one();
    test.wait(2000);
    test.decline(&test.sent_one(), SERVFAIL);
    test.sent_one();
    test.lookup("a.test", Family::Inet);
    assert_eq!(test.server_of(&test.sent_one()), FIRST);
}

#[test]
fn lookup_that_comes_later_has_moved_on_too() {
    let all = [address("1.1.1.1", 0), address("1::1", 0)];
    let (mut test, sent) = both(two_servers(), "a.test");
    test.decline(&sent[0], SERVFAIL);
    test.decline(&sent[1], SERVFAIL);
    let [a, aaaa] = test.sent_exactly();
    test.lookup("a.test", Family::Unspecified);
    assert_eq!(test.answer(&a, &all), NOTHING);
    assert_eq!(
        test.answer(&aaaa, &all),
        ["1::1/0, 1.1.1.1/0", "2: 1::1/0, 1.1.1.1/0"]
    );

    let mut test = two_servers().start();
    test.lookup("a.test", Family::Inet6);
    test.decline(&test.sent_one(), SERVFAIL);
    let aaaa = test.sent_one();
    test.lookup("a.test", Family::Unspecified);
    assert_eq!(test.answer(&test.sent_one(), &all), ["2: 1.1.1.1/0"]);
    assert_eq!(test.answer(&aaaa, &all), ["1::1/0"]);
}

#[test]
fn excuse_for_both_families() {
    let all = [address("1.1.1.1", 1), address("1::1", 2)];
    for first in [0, 1] {
        for second in [0, 1] {
            let (mut test, sent) = both(two_servers(), "a.test");
            assert_eq!(test.decline(&sent[first], REFUSED), NOTHING);
            assert_eq!(test.decline(&sent[1 - first], REFUSED), NOTHING);
            let sent = test.sent_exactly::<2>();
            assert_eq!(test.answer(&sent[second], &all), NOTHING);
            assert_eq!(test.answer(&sent[1 - second], &all), ["1::1/2, 1.1.1.1/1"]);
        }
    }
}

#[test]
fn excuse_for_ipv6_after_ipv4_from_elsewhere() {
    let all = [address("1.1.1.1", 1), address("1::1", 2)];
    for is_answered in [true, false] {
        let mut test = two_servers().start();
        test.lookup("a.test", Family::Unspecified);
        let [a, aaaa] = test.sent_exactly();
        test.decline(&a, REFUSED);
        assert_eq!(test.answer(&test.sent_one(), &all), NOTHING);
        assert_eq!(test.decline(&aaaa, REFUSED), NOTHING);
        if is_answered {
            let elsewhere = test.sent_one();
            assert_eq!(test.answer(&elsewhere, &all), ["1::1/2, 1.1.1.1/1"]);
        } else {
            assert_eq!(test.wait(2000), ["1.1.1.1/1"]);
        }
    }
}

#[test]
fn excuse_for_ipv6() {
    for (flags, answers, expected) in [
        (0, &[address("1.1.1.1", 1)][..], Some("1.1.1.1/1")),
        (NXDOMAIN, &[], Some("ENOTFOUND")),
        (0, &[], None),
    ] {
        for order in [[0, 1], [1, 0]] {
            let (mut test, sent) = both(two_servers(), "a.test");
            let replies = [
                reply(&sent[0].bytes, flags, [answers, &[], &[]]),
                reply(&sent[1].bytes, SERVFAIL, [&[], &[], &[]]),
            ];
            let outcome = order.map(|index| test.deliver(&sent[index], &replies[index]));
            assert_eq!(outcome.concat().pop().as_deref(), expected);
            assert_eq!(test.is_idle(), expected.is_some());
            let last = test.wait(2000).pop();
            assert_eq!(last.as_deref(), expected.is_none().then_some("ETIMEOUT"));
            assert!(test.is_idle() && !test.client.has_requests());
        }
    }
}

#[test]
fn excuse_for_ipv6_that_another_needs() {
    let (mut test, sent) = both(two_servers(), "a.test");
    assert_eq!(test.lookup("a.test", Family::Inet6), NOTHING);
    assert_eq!(test.decline(&sent[1], SERVFAIL), NOTHING);
    let elsewhere = test.sent_one();
    assert_eq!(
        test.answer(&sent[0], &[address("1.1.1.1", 1)]),
        ["1.1.1.1/1"]
    );
    assert_eq!(
        test.answer(&elsewhere, &[address("1::1", 2)]),
        ["2: 1::1/2"]
    );
}

#[test]
fn excuse_for_ipv4() {
    for order in [[0, 1], [1, 0]] {
        let (mut test, sent) = both(two_servers(), "a.test");
        for index in order {
            let outcome = match index {
                0 => test.decline(&sent[0], SERVFAIL),
                _ => test.answer(&sent[1], &[address("1::1", 2)]),
            };
            assert_eq!(outcome, NOTHING);
        }
        assert_eq!(
            test.answer(&test.sent_one(), &[address("1.1.1.1", 1)]),
            ["1::1/2, 1.1.1.1/1"]
        );
    }
}

#[test]
fn each_name_of_a_search_starts_over() {
    let setup = resolv_conf("nameserver 10.0.0.1 10.0.0.2\nsearch s");
    let (mut test, [a, aaaa]) = both(setup, "h");
    test.decline(&a, REFUSED);
    test.decline(&aaaa, NXDOMAIN);
    test.decline(&test.sent_one(), NXDOMAIN);
    let [a, aaaa] = test.sent_exactly();
    assert_eq!(
        (a.question(), test.server_of(&a)),
        ("h A".into(), FIRST.into())
    );
    test.decline(&aaaa, REFUSED);
    assert_eq!(test.answer(&a, &[address("1.1.1.1", 1)]), ["1.1.1.1/1"]);
}

#[test]
fn excuse_that_is_late() {
    let setup = || resolv_conf("nameserver 10.0.0.1 10.0.0.2\noptions use-vc");
    for excuses_first in [true, false] {
        let mut test = setup().start();
        test.lookup("a.test", Family::Inet);
        let late = test.sent_one();
        test.wait(2000);
        let next = test.sent_one();
        if excuses_first {
            assert_eq!(test.decline(&late, REFUSED), NOTHING);
            assert!(test.sent().is_empty());
            assert_eq!(test.decline(&next, NOTIMP), ["ENOTIMP"]);
        } else {
            assert_eq!(test.decline(&next, NOTIMP), NOTHING);
            assert_eq!(test.decline(&late, REFUSED), ["EREFUSED"]);
        }
        assert!(test.is_idle());
    }
}

#[test]
fn excuses_are_forgotten_with_the_list() {
    let mut test = two_servers().start();
    test.lookup("a.test", Family::Inet);
    test.decline(&test.sent_one(), REFUSED);
    let next = test.sent_one();
    test.set_servers(&["10.0.0.3:53", SECOND]);
    assert_eq!(test.decline(&next, REFUSED), NOTHING);
    assert_eq!(test.server_of(&test.sent_one()), "10.0.0.3:53");
}
