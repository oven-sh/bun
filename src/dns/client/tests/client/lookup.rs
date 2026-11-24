use bun_dns_client::{Family, Route, Variable};

use crate::config::searched;
use crate::machine::{HOSTS, NOTHING, NSSWITCH, Sent, Setup, Test, one_server, resolv_conf};
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
