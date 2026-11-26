use bun_core::strings;
use bun_dns_client::{Family, Route};

use crate::machine::{HOSTS, Setup, Test, show};

/// `routes` are destinations, each with the source that this machine would use, if any.
fn machine(routes: &[(&str, &str)]) -> Test {
    let lines = routes.iter().map(|(ip, _)| format!("{ip} h\n"));
    let mut setup = Setup::default().file(HOSTS, lines.collect::<String>());
    for (destination, source) in routes.iter().filter(|(_, source)| !source.is_empty()) {
        let route = source.parse().map_or(Route::Unknown, Route::From);
        setup
            .world
            .routes
            .insert(destination.parse().unwrap(), route);
    }
    setup.start()
}

fn sorted(routes: &[(&str, &str)]) -> Vec<String> {
    let answer = machine(routes).lookup("h", Family::Unspecified).concat();
    let addresses = strings::tokenize(answer.as_bytes(), b", ");
    addresses.map(|it| show(&it[..it.len() - 2])).collect()
}

fn assert_first_is_better(pair: [(&str, &str); 2]) {
    let [better, worse] = pair;
    assert_eq!(sorted(&[better, worse]), [better.0, worse.0]);
    assert_eq!(sorted(&[worse, better]), [better.0, worse.0]);
}

fn assert_neither_is_better(pair: [(&str, &str); 2]) {
    let [one, other] = pair;
    assert_eq!(sorted(&[one, other]), [one.0, other.0]);
    assert_eq!(sorted(&[other, one]), [other.0, one.0]);
}

/// RFC 6724 §10.2
#[test]
fn examples() {
    for pair in [
        [
            ("2001:db8:1::1", "2001:db8:1::2"),
            ("198.51.100.121", "169.254.13.78"),
        ],
        [
            ("198.51.100.121", "198.51.100.117"),
            ("2001:db8:1::1", "fe80::1"),
        ],
        [("2001:db8:1::1", "2001:db8:1::2"), ("10.1.2.3", "10.1.2.4")],
        [("fe80::1", "fe80::2"), ("2001:db8:1::1", "2001:db8:1::2")],
        [
            ("2001:db8:1::1", "2001:db8:1::2"),
            ("2001:db8:3ffe::1", "2001:db8:3f44::2"),
        ],
        [
            ("2002:c633:6401::1", "2002:c633:6401::2"),
            ("2001:db8:1::1", "2002:c633:6401::2"),
        ],
        [
            ("2001:db8:1::1", "2001:db8:1::2"),
            ("2002:c633:6401::1", "2002:c633:6401::2"),
        ],
    ] {
        assert_first_is_better(pair);
    }
}

#[test]
fn reachable_first() {
    assert_first_is_better([("1.1.1.1", "169.254.0.1"), ("ff01::1", "")]);
}

#[test]
fn matching_scope() {
    for (source, matches, others) in [
        ("", "ff01::1", &["ff00::1"][..]),
        ("fe80::1", "ff02::1", &["ff01::1"]),
        ("fe80::1", "::1", &["1::1"]),
        ("fec0::1", "ff05::1", &["ff04::1"]),
        ("feff::1", "ff15::1", &["ff04::1"]),
        ("1::1", "ff0e::1", &["ff06::1", "ff0d::1"]),
        ("1::1", "ff1e::1", &["ff0d::1"]),
    ] {
        for other in others {
            assert_first_is_better([(matches, source), (other, source)]);
        }
    }
}

#[test]
fn precedence() {
    let best_first = [
        "::1", "::", "1.1.1.1", "2002::1", "2001::1", "fc00::1", "::2",
    ];
    for pair in best_first.array_windows::<2>() {
        assert_first_is_better(pair.map(|ip| (ip, ip)));
        assert_first_is_better(pair.map(|ip| (ip, "fec0::1")));
    }
    for usual in ["fbff::1", "fe00::1", "febf::1", "ff00::1"] {
        assert_first_is_better([usual, "1.1.1.1"].map(|ip| (ip, ip)));
    }
    assert_first_is_better(["::1", "fe80::1"].map(|ip| (ip, ip)));
    assert_first_is_better(["2001::1", "fdff::1"].map(|ip| (ip, ip)));
    for equals in [["::", "1::1"], ["::2", "3ffe::1"]] {
        assert_neither_is_better(equals.map(|ip| (ip, ip)));
        assert_neither_is_better(equals.map(|ip| (ip, "fec0::1")));
    }
    for last in ["fec0::1", "feff::1", "3ffe::1"] {
        assert_first_is_better([("fc00::1", "fc00::1"), (last, last)]);
    }
}

#[test]
fn labels() {
    let kinds = [
        "2001:1::", "1.1.1.1", "2002::", "2001::", "fc00::", "::2", "3ffe::",
    ];
    for (index, source) in kinds.into_iter().enumerate() {
        for other in &kinds[..index] {
            assert_first_is_better([(source, source), (other, source)]);
        }
    }
    assert_first_is_better([("fe80::1", "fe80::2"), ("::1", "fe80::2")]);
    assert_first_is_better([("fec0::1", "fec0::2"), ("ff05::1", "fec0::2")]);
    assert_first_is_better([("1.1.1.1", "::ffff:1.1.1.2"), ("1::1", "::ffff:1.1.1.2")]);
}

#[test]
fn smaller_scope() {
    for link_local in ["127.0.0.1", "169.254.0.1"] {
        assert_first_is_better([(link_local, link_local), ("1.1.1.1", "1.1.1.1")]);
    }
    assert_first_is_better([("ff02::1", "fe80::1"), ("ff0e::1", "1::1")]);
    assert_first_is_better([("fec0::1", "fec0::2"), ("::2", "::2")]);
    assert_first_is_better([("ff01::1", ""), ("::1", "")]);
}

#[test]
fn prefix_of_a_mapped_address() {
    assert_first_is_better(["1.1.1.1", "::ffff:1.1.1.2"].map(|ip| (ip, ip)));
}

#[test]
fn order_is_kept_otherwise() {
    let equals = [
        ("3.3.3.3", "1.1.1.1"),
        ("1.1.1.2", "1.1.1.1"),
        ("2.2.2.2", "1.1.1.1"),
    ];
    assert_eq!(sorted(&equals), equals.map(|(ip, _)| ip));
    let unknown = [("1.1.1.1", ""), ("2.2.2.2", "1.1.1.1"), ("3.3.3.3", "?")];
    assert_eq!(sorted(&unknown), unknown.map(|(ip, _)| ip));
}

#[test]
fn routes_for_a_long_list() {
    let [v4, v6] = ["1.1.1.", "1::"].map(|net| (1..50).map(move |host| format!("{net}{host}")));
    let [v4, v6]: [Vec<_>; 2] = [v4.collect(), v6.collect()];
    let pairs = v6.iter().zip(&v4);
    let routes = pairs.flat_map(|(v6, v4)| [(&**v6, ""), (&**v4, "1.1.2.1")]);
    let routes: Vec<_> = routes.collect();
    let mut test = machine(&routes);
    test.lookup("h", Family::Unspecified);
    assert_eq!(test.world().route_calls, 64);
    assert_eq!(sorted(&routes), [&v4[..], &v6].concat());
}

#[test]
fn one_address_needs_no_route() {
    let mut test = machine(&[("1.1.1.1", "")]);
    test.lookup("h", Family::Unspecified);
    assert_eq!(test.world().route_calls, 0);
}
