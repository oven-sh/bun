use bun_engine_text::{StringRef, Text};
use bun_url_whatwg::{
    Error, OnError, Punycode, Result, Url, domain_to_ascii, domain_to_unicode, name_to_ascii,
    name_to_unicode,
};

use crate::{ascii, string, url};

fn convert(conversion: impl Fn(Text<'_>) -> Result<StringRef>, input: &str) -> Result<String> {
    conversion(string(input).text()).map(|output| output.to_string())
}

#[test]
fn addresses() {
    for (input, expected) in [
        ("0", "0.0.0.0"),
        ("0xFFffFFff", "255.255.255.255"),
        ("1.0x.017.9.", "1.0.15.9"),
        ("1.65536", "1.1.0.0"),
        ("%31０.0.0.1", "10.0.0.1"),
        ("4294967296x", "4294967296x"),
        ("[0:f:0:0:f:f:0:0]", "[0:f::f:f:0:0]"),
        ("[1:2:3:4:5:6:7::]", "[1:2:3:4:5:6:7:0]"),
        ("[::1:2:3:4:1.2.3.4]", "[::1:2:3:4:102:304]"),
        ("[ABCD:00:0::]", "[abcd::]"),
    ] {
        assert_eq!(ascii(url(&format!("http://{input}")).host()), expected);
    }
    for input in [
        "09",
        "1.2.3.4.5",
        "256.1",
        "1.16777216",
        "4294967296",
        "a.1",
        "1..2",
        "[]",
        "[:1]",
        "[1::2::3]",
        "[1::2:]",
        "[12345::]",
        "[::1.2.3]",
        "[::01.2.3.4]",
        "[1:2:3:4:5:6:7:1.2.3.4]",
    ] {
        let href = string(&format!("http://{input}/"));
        assert!(
            !Url::can_parse(href.text(), None, Punycode::Unchecked),
            "{input}"
        );
    }
}

#[test]
fn ace_labels() {
    let can_parse = |host: &str, punycode| {
        Url::can_parse(string(&format!("https://{host}/")).text(), None, punycode)
    };
    for (host, is_valid) in [
        ("xn--ls8h.com", true),
        ("XN--LS8H.com", true),
        ("a.xn--nxasmq6b", true),
        ("xn--mgbh0fb.xn--kgbechtv", true),
        ("axn--a.ab--cd", true),
        ("xn--a.com", false),
        ("a.x%6E--a", false),
        ("xn--", false),
        ("xn---.com", false),
        ("xn--ascii-.com", false),
        ("xn--1ug.com", false),
        ("xn--u-ccb.com", false),
        ("xn--0.com", false),
        ("xn--9999999999999999999999999b", false),
        ("xn--xn---epa", false),
        ("1a.xn--mgbh0fb", false),
    ] {
        assert_eq!(can_parse(host, Punycode::Checked), is_valid, "{host}");
        assert!(can_parse(host, Punycode::Unchecked), "{host}");
    }
    let long = format!("xn--{}-9xf", "a".repeat(64));
    assert!(can_parse(&long, Punycode::Checked));
}

#[test]
fn long_domains() {
    let host = "é.".repeat(300);
    let parsed = Url::parse(&string(&format!("ws://{host}/")), None, Punycode::Checked).unwrap();
    assert_eq!(parsed.hostname().len(), 2400);
}

#[test]
fn long_domains_are_decoded() {
    let decoded = domain_to_unicode(string(&"xn--9ca.".repeat(2000)).text()).unwrap();
    assert_eq!(decoded, string(&"é.".repeat(2000)));
    let label = "a".repeat(5000);
    let decoded = domain_to_unicode(string(&format!("{label}.xn--zca")).text()).unwrap();
    assert_eq!(decoded, string(&format!("{label}.ß")));
}

#[test]
fn domains_are_parsed_as_hosts() {
    assert_eq!(
        convert(domain_to_ascii, "Español.com/x").unwrap(),
        "xn--espaol-zwa.com"
    );
    assert_eq!(convert(domain_to_ascii, "0x7f.1").unwrap(), "127.0.0.1");
    assert_eq!(
        convert(domain_to_unicode, "XN--espaol-zwa.com").unwrap(),
        "español.com"
    );
    assert_eq!(convert(domain_to_unicode, "[0::1]").unwrap(), "[::1]");
    for input in ["", "a@b", "a:1", "[::1]:1", "xn--iñvalid.com", "xn--a"] {
        assert_eq!(
            convert(domain_to_ascii, input),
            Err(Error::Invalid),
            "{input}"
        );
        assert_eq!(
            convert(domain_to_unicode, input),
            Err(Error::Invalid),
            "{input}"
        );
    }
}

#[test]
fn names_are_not() {
    let strictly = |name: Text<'_>| name_to_ascii(name, OnError::Fail);
    let leniently = |name: Text<'_>| name_to_ascii(name, OnError::Ignore);
    assert_eq!(convert(strictly, "A:b/0x1").unwrap(), "a:b/0x1");
    assert_eq!(convert(strictly, "É。a").unwrap(), "xn--9ca.a");
    assert_eq!(convert(strictly, "xn--a"), Err(Error::Invalid));
    assert_eq!(convert(leniently, "xn--a").unwrap(), "xn--a\u{fffd}");
    assert_eq!(
        convert(name_to_unicode, "xn--9ca.xn--a").unwrap(),
        "é.xn--a\u{fffd}"
    );

    let halves = Text::Utf16(&[0xd83d, 0xad, 0xde00]);
    assert_eq!(strictly(halves), Err(Error::Invalid));
    assert_eq!(leniently(halves), Ok(string("\u{fffd}\u{fffd}")));
    assert_eq!(name_to_unicode(halves), Ok(string("\u{fffd}\u{fffd}")));

    let long = "a".repeat(5000);
    assert_eq!(convert(name_to_unicode, &long).unwrap(), long);
    assert_eq!(
        convert(name_to_unicode, &format!("xn--9ca.{long}")),
        Err(Error::OutOfMemory)
    );
}
