use crate::machine::{HOSTS, NOTHING, NSSWITCH, one_server};
use crate::wire::*;

fn ptr(host: &[u8]) -> Vec<u8> {
    record(PTR, 60, host)
}

#[test]
fn questions() {
    for (ip, expected) in [
        ("1.20.0.255", "255.0.20.1.in-addr.arpa PTR"),
        (
            "123:4567:89ab:cdef::10",
            "0.1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.f.e.d.c.b.a.9.8.7.6.5.4.3.2.1.0.ip6.arpa PTR",
        ),
    ] {
        let mut test = one_server().start();
        assert_eq!(test.reverse(ip), NOTHING);
        assert_eq!(test.name_info(ip, 1), NOTHING);
        assert_eq!(test.sent_one().question(), expected);
    }
}

#[test]
fn names() {
    let odd = [&b"a b"[..], b"a.b", b"a/b", b"*", b""].map(|label| ptr(&labels(&[label])));
    let alias = record(CNAME, 60, &name("0/25.test"));
    let answers = [
        &[alias, ptr(&name("a.test")), ptr(&name("b.test"))][..],
        &odd,
    ]
    .concat();
    let mut test = one_server().start();
    test.reverse("1.1.1.1");
    assert_eq!(test.answer(&test.sent_one(), &answers), ["a.test, b.test"]);
    assert_eq!(test.name_info("1.1.1.1", 80), ["2: b.test, http"]);
    assert_eq!(test.name_info("1.1.1.1", 65535), ["3: b.test, 65535"]);
    assert_eq!(test.name_info("1.1.1.1", 0), ["4: b.test, -"]);
}

#[test]
fn hosts_file_first() {
    let mut test = one_server().file(HOSTS, "1.1.1.1 a b c").start();
    assert_eq!(test.reverse("1.1.1.1"), ["b, c"]);
    assert_eq!(test.name_info("1.1.1.1", 1), ["2: a, 1"]);
    assert_eq!(test.reverse("2.2.2.2"), NOTHING);
}

#[test]
fn hosts_file_last() {
    let unusable = [ptr(&name("-a"))];
    let alias = [record(CNAME, 60, &name("c.test"))];
    for (code, answers, error) in [
        (0, &[][..], "ENOTFOUND"),
        (0, &unusable, "ENOTFOUND"),
        (0, &alias, "ENODATA"),
        (NXDOMAIN, &[], "ENOTFOUND"),
        (NXDOMAIN, &alias, "ENOTFOUND"),
        (SERVFAIL, &[], "ENOTFOUND"),
    ] {
        for (ip, names, host) in [("1.1.1.1", "b", "a, 1"), ("2.2.2.2", error, error)] {
            let setup = one_server().file(NSSWITCH, "hosts: dns files");
            let mut test = setup.file(HOSTS, "1.1.1.1 a b").start();
            test.reverse(ip);
            test.name_info(ip, 1);
            let query = test.sent_one();
            let outcomes = test.deliver(&query, &reply(&query.bytes, code, [answers, &[], &[]]));
            assert_eq!(outcomes, [names.into(), format!("2: {host}")]);
        }
    }
}

#[test]
fn no_reply() {
    let mut test = one_server().tries(2).start();
    test.reverse("1.1.1.1");
    assert_eq!(test.wait(2000), NOTHING);
    assert_eq!(test.wait(4000), ["ENOTFOUND"]);
}
