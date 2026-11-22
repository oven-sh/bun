use bun_dns_client::{RecordType, is_hostname_byte};

use crate::machine::{NOTHING, one_server, show};
use crate::wire::*;

/// The name in the query for `text`, or the answer that takes no query.
fn encoded(text: impl AsRef<[u8]>) -> String {
    let mut test = one_server().start();
    let answers = test.resolve(RecordType::A, text);
    match &test.sent()[..] {
        [query] => show(&query.bytes[12..query.bytes.len() - 4]),
        _ => answers.concat(),
    }
}

/// The text of the PTR record with `data`, which comes after `before` at offset 36.
fn decoded(before: &[u8], data: &[u8]) -> String {
    let mut test = one_server().tries(1).start();
    assert_eq!(test.resolve(RecordType::PTR, "a.test"), NOTHING);
    let answers = [record(HINFO, 60, before), record(PTR, 60, data)];
    test.answer(&test.sent_one(), &answers).concat()
}

const BEFORE: u16 = 36;

fn pointer(to: u16) -> Vec<u8> {
    numbers(&[0xc000 | to])
}

#[test]
fn to_the_wire() {
    for (text, expected) in [
        ("", r"\x00"),
        (".", r"\x00"),
        ("a", r"\x01a\x00"),
        ("a.", r"\x01a\x00"),
        ("aB.c-_/*9", r"\x02aB\x06c-_/*9\x00"),
        (r"a\.b.c", r"\x03a.b\x01c\x00"),
        (r"a\.", r"\x02a.\x00"),
        (r"\a\098\046", r"\x03ab.\x00"),
        ("onion", r"\x05onion\x00"),
        ("aonion", r"\x06aonion\x00"),
        ("a.union", r"\x01a\x05union\x00"),
        ("a.onion.b", r"\x01a\x05onion\x01b\x00"),
    ] {
        assert_eq!(encoded(text), expected, "{text}");
    }
    for text in [
        "..", ".a", "a..", "a..b", "a b", "a\0", "é", "a:b", r"\", r"a\", r"\9", r"\09", r"\04a",
        r"\256", r"\260", r"\301", r"\000", r"\\", r"\ ", ".onion",
    ] {
        assert_eq!(encoded(text), "EBADNAME", "{text}");
    }
    for text in ["a.onion", "a.b.OnIoN", "a.onion.", r"a\.onion", r"\.onion"] {
        assert_eq!(encoded(text), "ENOTFOUND", "{text}");
    }
}

#[test]
fn bytes_of_a_host_name() {
    let all: Vec<u8> = (0..=255).filter(|&byte| is_hostname_byte(byte)).collect();
    let expected = "*-./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
    assert_eq!(show(&all), expected);
}

#[test]
fn limits_to_the_wire() {
    let label = |len| "a".repeat(len);
    assert_eq!(encoded(label(63)), format!(r"?{}\x00", label(63)));
    for len in [64, 254, 255, 256, 300] {
        assert_eq!(encoded(label(len)), "EBADNAME");
        assert_eq!(encoded(label(len) + ".a"), "EBADNAME");
    }
    let long = |last| [label(63), label(63), label(63), label(last)].join(".");
    for end in ["", "."] {
        assert_ne!(encoded(long(61) + end), "EBADNAME");
        assert_eq!(encoded(long(62) + end), "EBADNAME");
        assert_ne!(encoded("a.".repeat(126) + "a" + end), "EBADNAME");
        assert_eq!(encoded("a.".repeat(127) + "a" + end), "EBADNAME");
    }
}

#[test]
fn to_text() {
    assert_eq!(decoded(b"", &[0]), "");
    assert_eq!(decoded(b"", &name("A.b")), "A.b");
    let special = labels(&[br#"".;\()@$"#, b" !~", b"\0\x1f\x7f\x80\xc6\xc8\xff"]);
    assert_eq!(
        decoded(b"", &special),
        r#"\"\.\;\\\(\)\@\$. !~.\000\031\127\128\198\200\255"#
    );
}

#[test]
fn compression() {
    assert_eq!(decoded(b"", ASKED), "a.test");
    assert_eq!(
        decoded(b"", &[b"\x01x", &pointer(14)[..]].concat()),
        "x.test"
    );
    assert_eq!(decoded(b"", &pointer(19)), "");
    let chain = [b"\x01y", ASKED, b"\x01z", &pointer(BEFORE)].concat();
    assert_eq!(decoded(&chain, &pointer(BEFORE + 4)), "z.y.a.test");
}

#[test]
fn pointers_lead_back() {
    let data = BEFORE + 12;
    for to in [0, 11, data, data + 1, data + 2, 0x3fff] {
        assert_eq!(decoded(b"", &pointer(to)), "EBADRESP", "{to}");
    }
    let after_label = [b"\x01x", &pointer(data)[..]].concat();
    assert_eq!(decoded(b"", &after_label), "EBADRESP");
    let ahead = [pointer(BEFORE + 2), name("x")].concat();
    assert_eq!(decoded(&ahead, &pointer(BEFORE)), "EBADRESP");
}

#[test]
fn what_a_pointer_leads_to() {
    for before in [&[0x40][..], &[0x80], &[63], &[13], &[14]] {
        assert_eq!(decoded(before, &pointer(BEFORE)), "EBADRESP");
    }
    // A label that ends in the last byte but one, which leaves half a pointer.
    assert_eq!(decoded(&[0; 157][..], &pointer(0xc0)), "");
    let mut before = vec![0; 157];
    before[156] = 13;
    assert_eq!(decoded(&before, &pointer(0xc0)), "EBADRESP");
}

#[test]
fn limits_to_text() {
    let long = |last| {
        [
            vec![b'a'; 63],
            vec![b'b'; 63],
            vec![b'c'; 63],
            vec![b'd'; last],
        ]
    };
    let inline = |last| labels(&long(last).each_ref().map(|label| &label[..]));
    assert_eq!(decoded(b"", &inline(61)).len(), 253);
    assert_eq!(decoded(b"", &inline(62)), "EBADRESP");
    assert_eq!(
        decoded(&inline(59), &[b"\x01x", &pointer(BEFORE)[..]].concat()).len(),
        253
    );
    assert_eq!(
        decoded(&inline(60), &[b"\x01x", &pointer(BEFORE)[..]].concat()),
        "EBADRESP"
    );

    let chained = |count: u16| {
        let links = (0..count - 2).flat_map(|link| pointer(BEFORE + 2 * link));
        let before: Vec<u8> = ASKED.iter().copied().chain(links).collect();
        decoded(&before, &pointer(BEFORE + 2 * (count - 2)))
    };
    assert_eq!(chained(128), "a.test");
    assert_eq!(chained(129), "EBADRESP");
}

#[test]
fn each_name_of_a_record() {
    let (good, bad, times) = (ASKED, &pointer(0x3fff)[..], &[0; 20][..]);
    for (kind, data) in [
        (RecordType::CNAME, bad.to_vec()),
        (RecordType::NS, bad.to_vec()),
        (RecordType::MX, [&[0; 2], bad].concat()),
        (RecordType::SRV, [&[0; 6], bad].concat()),
        (RecordType::NAPTR, [&[0; 7], bad].concat()),
        (RecordType::SOA, [bad, good, times].concat()),
        (RecordType::SOA, [good, bad, times].concat()),
    ] {
        let mut test = one_server().tries(1).start();
        test.resolve(kind, "a.test");
        let answers = test.answer(&test.sent_one(), &[record(kind as u16, 60, &data)]);
        assert_eq!(answers, ["EBADRESP"]);
    }
}
