use bun_dns_client::{Error, RecordType};

use crate::machine::{NOTHING, one_server};
use crate::wire::*;

/// What a reply with these sections makes of a query for `kind`, which has one try.
fn outcome(kind: RecordType, flags: u16, sections: [&[Vec<u8>]; 3]) -> String {
    let mut test = one_server().tries(1).start();
    assert_eq!(test.resolve(kind, "a.test"), NOTHING);
    let query = test.sent_one();
    let answers = test.deliver(&query, &reply(&query.bytes, flags, sections));
    assert!(test.is_idle());
    answers.concat()
}

fn answered(kind: RecordType, answers: &[Vec<u8>]) -> String {
    outcome(kind, 0, [answers, &[], &[]])
}

fn mx(preference: u16, host: &[u8]) -> Vec<u8> {
    record(MX, 60, &[&numbers(&[preference]), host].concat())
}

fn srv(host: &[u8]) -> Vec<u8> {
    record(SRV, 60, &[&numbers(&[1, 2, 3]), host].concat())
}

fn naptr(strings: [&[u8]; 3], replacement: &[u8]) -> Vec<u8> {
    let strings = strings.map(string).concat();
    let data = [&numbers(&[10, 20]), &strings[..], replacement].concat();
    record(NAPTR, 60, &data)
}

fn caa(flags: u8, tag: &[u8], value: &[u8]) -> Vec<u8> {
    record(CAA, 60, &[&[flags], &string(tag)[..], value].concat())
}

fn txt(strings: &[&[u8]]) -> Vec<u8> {
    let data: Vec<u8> = strings.iter().flat_map(|it| string(it)).collect();
    record(TXT, 60, &data)
}

fn one_of_each() -> Vec<(RecordType, Vec<u8>, &'static str)> {
    vec![
        (RecordType::A, address("1.2.3.4", 60), "1.2.3.4/60"),
        (RecordType::AAAA, address("1::2", 61), "1::2/61"),
        (
            RecordType::CNAME,
            record(CNAME, 99, &name("c.test")),
            "c.test",
        ),
        (RecordType::MX, mx(5, &name("m.test")), "5 m.test"),
        (RecordType::NS, record(NS, 60, &name("n.test")), "n.test"),
        (
            RecordType::TXT,
            txt(&[b"a", b"", b"\0\xff"]),
            r#"["a", "", "\\x00\\xff"]"#,
        ),
        (RecordType::SRV, srv(&name("s.test")), "1 2 3 s.test"),
        (RecordType::PTR, record(PTR, 60, &name("p.test")), "p.test"),
        (
            RecordType::NAPTR,
            naptr([b"u", b"E2U", b"!a!b!"], &[0]),
            "10 20 u E2U !a!b! ",
        ),
        (RecordType::SOA, soa(60, 5), "ns.test root.test 1 2 3 4 5"),
        (
            RecordType::CAA,
            caa(128, b"issue", b"ca.test"),
            "128 issue ca.test",
        ),
    ]
}

#[test]
fn query() {
    let mut test = one_server().start();
    test.world().randoms.push_back(0xabcd);
    test.resolve(RecordType::CAA, "Ab.test");
    let header = [0xab, 0xcd, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    let question = *b"\x02Ab\x04test\0\x01\x01\0\x01";
    assert_eq!(test.sent_one().bytes, [&header[..], &question].concat());
}

#[test]
fn each_type() {
    let all: Vec<_> = one_of_each().into_iter().map(|(_, it, _)| it).collect();
    for (kind, record, expected) in one_of_each() {
        let twice = answered(kind, &[record.clone(), record.clone()]);
        assert_eq!(twice, format!("{expected}, {expected}"));
        assert_eq!(answered(kind, &[record]), expected);
        assert_eq!(answered(kind, &all), expected);
    }
}

#[test]
fn any() {
    let (mut all, mut expected) = (Vec::new(), Vec::new());
    for (kind, record, shown) in one_of_each() {
        all.insert(0, record);
        expected.push(format!("{kind:?} {shown}"));
    }
    assert_eq!(answered(RecordType::ANY, &all), expected.join(", "));
    let hinfo = record(HINFO, 60, b"\x07RFC8482\0");
    assert_eq!(answered(RecordType::ANY, &[hinfo]), "");
    assert_eq!(answered(RecordType::ANY, &[]), "ENODATA");
    assert_eq!(
        answered(RecordType::ANY, &[record(255, 60, b"")]),
        "EBADRESP"
    );
}

#[test]
fn data_that_ends_early() {
    for (kind, whole, _) in one_of_each() {
        // What follows a string of TXT or the tag of CAA is optional.
        let shortest = match kind {
            RecordType::TXT => 2,
            RecordType::CAA => 7,
            _ => whole.len() - 12,
        };
        for len in 0..shortest {
            let cut = record(kind as u16, 60, &whole[12..12 + len]);
            let padding = record(HINFO, 60, &[0; 64]);
            for asked in [kind, RecordType::ANY] {
                let outcome = answered(asked, &[cut.clone(), padding.clone()]);
                assert_eq!(outcome, "EBADRESP", "{kind:?} {len}");
            }
        }
    }
}

#[test]
fn message_that_ends_early() {
    for (kind, whole, _) in one_of_each() {
        for len in 0..whole.len() {
            let outcome = answered(kind, &[whole[..len].to_vec()]);
            assert_eq!(outcome, "EBADRESP", "{kind:?} {len}");
        }
    }
}

#[test]
fn what_follows() {
    for (kind, len) in [(RecordType::A, 5), (RecordType::AAAA, 17)] {
        let long = record(kind as u16, 60, &vec![1; len]);
        assert_eq!(answered(kind, &[long]), "EBADRESP");
    }
    let trailing = [address("6.7.8.9", 60), vec![0xff; 3]].concat();
    assert_eq!(answered(RecordType::A, &[trailing]), "6.7.8.9/60");
}

#[test]
fn only_what_was_asked_for_is_read() {
    let empty = |kind| record(kind, 60, b"");
    let others = [
        NS, SOA, PTR, HINFO, MX, TXT, AAAA, SRV, NAPTR, OPT, CAA, 65280,
    ]
    .map(empty);
    let answers = [&others[..], &[address("1.2.3.4", 60)]].concat();
    assert_eq!(answered(RecordType::A, &answers), "1.2.3.4/60");

    let (good, cut) = ([address("1.2.3.4", 60)], [vec![0xc0]]);
    assert_eq!(outcome(RecordType::A, 0, [&good, &cut, &[]]), "1.2.3.4/60");
    assert_eq!(outcome(RecordType::A, 0, [&good, &[], &cut]), "1.2.3.4/60");
    assert_eq!(
        outcome(RecordType::A, NXDOMAIN, [&[], &cut, &[]]),
        "ENOTFOUND"
    );
    assert_eq!(outcome(RecordType::A, 0, [&[], &good, &good]), "ENODATA");
    assert_eq!(outcome(RecordType::A, 0, [&good, &good, &[]]), "1.2.3.4/60");
}

fn among_other_types(missing: RecordType) -> &'static str {
    use RecordType::*;
    match missing {
        A | AAAA | CNAME | NS | PTR => "ENODATA",
        SOA => "EBADRESP",
        MX | TXT | SRV | NAPTR | CAA | ANY => "",
    }
}

#[test]
fn classes() {
    for (kind, whole, expected) in one_of_each() {
        let in_class = |class| {
            answered(
                kind,
                &[resource(ASKED, kind as u16, class, 60, &whole[12..])],
            )
        };
        let missing = among_other_types(kind);
        let in_chaos = match kind {
            RecordType::TXT | RecordType::CAA => expected,
            _ => missing,
        };
        assert_eq!(in_class(CHAOS), in_chaos);
        assert_eq!(in_class(4), missing);
    }
}

#[test]
fn owner_names_are_skipped() {
    for owner in [&[0][..], &labels(&[b"a b\0"]), &[1, b'x', 0xc0, 12]] {
        let record = resource(owner, A, IN, 60, &[1, 2, 3, 4]);
        assert_eq!(answered(RecordType::A, &[record]), "1.2.3.4/60");
    }
    for reserved in [0x40, 0x80, 0xbf] {
        let record = resource(&[reserved, 0], A, IN, 60, &[1, 2, 3, 4]);
        assert_eq!(answered(RecordType::A, &[record]), "EBADRESP");
    }
}

#[test]
fn nothing_of_the_type() {
    let alias = [record(CNAME, 60, &name("c.test"))];
    for (kind, _, _) in one_of_each() {
        let expected = match kind {
            RecordType::A | RecordType::AAAA => "",
            RecordType::CNAME => "c.test",
            _ => among_other_types(kind),
        };
        assert_eq!(answered(kind, &alias), expected);
        assert_eq!(answered(kind, &[]), "ENODATA");
    }
}

#[test]
fn response_codes() {
    let expected = ["EFORMERR", "ESERVFAIL", "ENOTFOUND", "ENOTIMP", "EREFUSED"];
    let answers = [address("1.2.3.4", 60)];
    for code in 1..16 {
        let expected = expected.get(code - 1).unwrap_or(&"ESERVFAIL");
        assert_eq!(
            outcome(RecordType::A, code as u16, [&[], &[], &[]]),
            *expected
        );
        assert_eq!(
            outcome(RecordType::A, code as u16, [&answers, &[], &[]]),
            *expected
        );
    }
}

#[test]
fn time_to_live() {
    let alias = |ttl| record(CNAME, ttl, &name("c.test"));
    let answers = [
        alias(30),
        address("1.1.1.1", 60),
        alias(20),
        address("2.2.2.2", 10),
    ];
    assert_eq!(answered(RecordType::A, &answers), "1.1.1.1/20, 2.2.2.2/10");
    let extremes = [0, 0x7fff_ffff, 0x8000_0000, u32::MAX].map(|ttl| address("::", ttl));
    assert_eq!(
        answered(RecordType::AAAA, &extremes),
        "::/0, ::/2147483647, ::/2147483647, ::/2147483647"
    );
}

#[test]
fn as_many_as_fit() {
    let mut test = one_server().start();
    let query = test.ask("a.test");
    let count = (usize::from(u16::MAX) - query.bytes.len()) / 16;
    let answers = test.answer(&query, &vec![address("1.2.3.4", 60); count]);
    assert_eq!(answers, [vec!["1.2.3.4/60"; count].join(", ")]);
}

#[test]
fn text_fields() {
    let regexp = |text: &[u8]| answered(RecordType::NAPTR, &[naptr([b"", b"", text], ASKED)]);
    assert_eq!(regexp("é ~".as_bytes()), r"10 20   \xc3\xa9 ~ a.test");
    for strings in [["é", "", ""], ["", "é", ""], ["\n", "", ""], ["", "\n", ""]] {
        let record = naptr(strings.map(str::as_bytes), ASKED);
        assert_eq!(answered(RecordType::NAPTR, &[record]), "EBADRESP");
    }
    for control in [b"\0", b"\x1f", b"\x7f"] {
        assert_eq!(regexp(control), "EBADRESP");
        assert_eq!(
            answered(RecordType::CAA, &[caa(0, control, b"")]),
            "EBADRESP"
        );
    }
    assert_eq!(
        answered(RecordType::CAA, &[caa(0, b"issue", b"")]),
        "0 issue "
    );
    assert_eq!(
        answered(RecordType::CAA, &[caa(0, b"a", b"\0\xff")]),
        r"0 a \x00\xff"
    );
    assert_eq!(answered(RecordType::TXT, &[txt(&[b""])]), r#"[""]"#);
    assert_eq!(
        answered(RecordType::TXT, &[record(TXT, 60, b"\x01a\x02b")]),
        "EBADRESP"
    );
    assert_eq!(answered(RecordType::CAA, &[caa(0, b"", b"x")]), "EBADRESP");
    assert_eq!(
        answered(RecordType::CAA, &[caa(0, b"\xe9", b"x")]),
        "EBADRESP"
    );
}

#[test]
fn targets_are_hosts() {
    let (good, odd) = (name("_a-1.b-.test"), labels(&[b"a b", b"test"]));
    let make: [(RecordType, &dyn Fn(&[u8]) -> Vec<u8>, &str); 4] = [
        (RecordType::CNAME, &|host| record(CNAME, 60, host), ""),
        (RecordType::NS, &|host| record(NS, 60, host), ""),
        (RecordType::MX, &|host| mx(1, host), "1 "),
        (RecordType::SRV, &srv, "1 2 3 "),
    ];
    for (kind, make, before) in make {
        for odd in [&odd, &name("-a.test"), &labels(&[b"a.b"])] {
            assert_eq!(answered(kind, &[make(odd)]), "EBADRESP");
            let left = format!("{before}_a-1.b-.test");
            assert_eq!(answered(kind, &[make(&good), make(odd)]), left);
            let left = if kind == RecordType::CNAME {
                "EBADRESP"
            } else {
                &left
            };
            assert_eq!(answered(kind, &[make(odd), make(&good)]), left);
        }
        assert_eq!(
            answered(kind, &[make(&name("a.-b"))]),
            format!("{before}a.-b")
        );
        assert_eq!(answered(kind, &[make(&[0])]), before);
        for text in ["*.test", "0/25.test"] {
            let expected = if kind == RecordType::CNAME {
                text
            } else {
                "EBADRESP"
            };
            assert_eq!(answered(kind, &[make(&name(text))]), expected);
        }
    }
    assert_eq!(answered(RecordType::ANY, &[record(NS, 60, &odd)]), "");
}

/// RFC 6763 §4.1
#[test]
fn service_instance() {
    let instance = [record(PTR, 60, &labels(&[b"My Printer", b"_ipp"]))];
    assert_eq!(answered(RecordType::PTR, &instance), "My Printer._ipp");
    assert_eq!(answered(RecordType::ANY, &instance), "PTR My Printer._ipp");
}

#[test]
fn errors_for_javascript() {
    use Error::*;
    for (error, errno, code) in [
        (ENODATA, 1, "DNS_ENODATA"),
        (EFORMERR, 2, "DNS_EFORMERR"),
        (ESERVFAIL, 3, "DNS_ESERVFAIL"),
        (ENOTFOUND, 4, "DNS_ENOTFOUND"),
        (ENOTIMP, 5, "DNS_ENOTIMP"),
        (EREFUSED, 6, "DNS_EREFUSED"),
        (EBADQUERY, 7, "DNS_EBADQUERY"),
        (EBADNAME, 8, "DNS_ENOTFOUND"),
        (EBADFAMILY, 9, "DNS_EBADFAMILY"),
        (EBADRESP, 10, "DNS_EBADRESP"),
        (ECONNREFUSED, 11, "DNS_ECONNREFUSED"),
        (ETIMEOUT, 12, "DNS_ETIMEOUT"),
        (ENOMEM, 15, "DNS_ENOMEM"),
        (EDESTRUCTION, 16, "DNS_EDESTRUCTION"),
        (EBADSTR, 17, "DNS_EBADSTR"),
        (EBADFLAGS, 18, "DNS_EBADFLAGS"),
        (EBADHINTS, 20, "DNS_EBADHINTS"),
        (ECANCELLED, 24, "DNS_ECANCELLED"),
        (ESERVICE, 25, "DNS_ESERVICE"),
        (ENOSERVER, 26, "DNS_ENOSERVER"),
        (EAI_AGAIN, -3001, "DNS_EAI_AGAIN"),
    ] {
        assert_eq!((error as i32, error.code()), (errno, code));
    }
}
