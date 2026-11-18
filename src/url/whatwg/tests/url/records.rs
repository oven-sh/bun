use std::borrow::Cow;

use bun_engine_text::Text;
use bun_url_whatwg::{ByteUrl, Error, Input, PathStyle, Punycode, Scheme, Url};

use crate::{ascii, string, url};

#[test]
fn null_empty_and_invalid() {
    let null = Url::null();
    assert!(null.is_null() && null.is_empty() && !null.is_valid());
    let empty = Url::parse_or_keep(&string(""), None, Punycode::Unchecked);
    assert!(!empty.is_null() && empty.is_empty() && !empty.is_valid());
    assert_ne!(null, empty);

    for text in ["/a/b.js?q#f", "http://日本 語/"] {
        let text = string(text);
        let mut invalid = Url::parse_or_keep(&text, Some(&null), Punycode::Unchecked);
        assert!(!invalid.is_valid() && invalid.string().unwrap().ptr_eq(&text));
        let parts = [
            invalid.href(),
            invalid.protocol(),
            invalid.username(),
            invalid.password(),
            invalid.host(),
            invalid.port_text(),
            invalid.path(),
            invalid.search(),
            invalid.hash(),
        ];
        assert_eq!(parts.concat(), b"");
        assert_eq!((invalid.query(), invalid.fragment()), (None, None));
        assert_eq!((invalid.port(), invalid.scheme()), (None, Scheme::Other));
        assert_eq!(invalid.file_path(PathStyle::Posix).unwrap(), None);
        assert_eq!(invalid.set_hash(Text::from_ascii("x")), Err(Error::Invalid));
        assert!(invalid.set_port(Text::from_ascii("1")).is_ok() && !invalid.is_valid());
        assert!(!Url::can_parse(
            Text::from_ascii("x"),
            Some(&invalid),
            Punycode::Unchecked
        ));
    }
}

#[test]
fn bytes_are_borrowed_if_they_can_be() {
    let href = |input| ByteUrl::parse(input, None).unwrap().into_href();
    assert!(matches!(
        href(b"https://h/a?b#c"),
        Cow::Borrowed(b"https://h/a?b#c")
    ));
    assert!(matches!(
        href(b" redis://h:1/0\n"),
        Cow::Borrowed(b"redis://h:1/0")
    ));
    assert!(matches!(href(b"https://h"), Cow::Owned(_)));
    assert_eq!(
        &*href(b"a:\xf0\x9f/\xc3\xa9\xff"),
        b"a:%EF%BF%BD/%C3%A9%EF%BF%BD"
    );
    assert!(ByteUrl::parse(b"http://\xff/", None).is_err());
}

#[test]
fn lone_surrogates() {
    let parse = |units: &[u16]| {
        let input = [&"a://h/".encode_utf16().collect::<Vec<_>>(), units].concat();
        Url::parse(Input::Text(Text::Utf16(&input)), None, Punycode::Checked).unwrap()
    };
    assert_eq!(parse(&[0xd83d, 0xde00]).path(), b"/%F0%9F%98%80");
    assert_eq!(parse(&[0xd83d, 9, 0xde00]).path(), b"/%EF%BF%BD%EF%BF%BD");
    assert_eq!(parse(&[0xdc00; 400]).path().len(), 1 + 9 * 400);
}

#[test]
fn every_length_of_every_part() {
    for length in 1..140 {
        let part = "a".repeat(length);
        for href in [
            format!("https://{part}.b:1/{part}?{part}#{part}"),
            format!("ws://{part}:{part}@h/{part}/?{part}"),
            format!("{part}:{part}#{part}"),
        ] {
            assert_eq!(ascii(url(&href).href()), href);
        }
        let messy = format!("HTTP://{part}.B:80/{part}/../{part} /./é?{part}'#{part}`");
        let tidy = format!("http://{part}.b/{part}%20/%C3%A9?{part}%27#{part}%60");
        assert_eq!(ascii(url(&messy).href()), tidy);
    }
}

#[test]
fn what_is_removed_does_not_count() {
    for (input, expected) in [
        ("http://h/a/.. ", "http://h/"),
        ("file:///a/%2e\0", "file:///a/"),
        ("http://h/a/.\t./b", "http://h/b"),
        ("ht\ntp://h:8\r0/", "http://h/"),
        ("a:\t/\t/u\t:\t@h", "a://u@h"),
        ("a:b \t?c", "a:b%20?c"),
    ] {
        assert_eq!(ascii(url(input).href()), expected);
    }
    let base = url("http://h/");
    for input in ["/\t/a b", "ht\ttp://a b", "a:\t//a b", "file:/\n/a b"] {
        assert!(!Url::can_parse(
            string(input).text(),
            Some(&base),
            Punycode::Checked
        ));
    }
}

#[test]
fn derived_strings() {
    let full = url("https://%C3%A9:%FF@h:1/p?q#f");
    assert_eq!(full.decoded_username().unwrap(), Some(string("é")));
    assert_eq!(full.decoded_password().unwrap(), None);
    assert_eq!(full.scheme_and_host().unwrap(), string("https://h:1"));
    assert_eq!(full.path_start(), 22);
    assert!(full.has_credentials());

    let origin = |href| url(href).origin().unwrap().to_string();
    assert_eq!(origin("blob:https://u@h:443/id"), "https://h");
    assert_eq!(origin("blob:file:///id"), "file://");
    assert_eq!(origin("blob:id"), "null");
    assert_eq!(origin("file://h/"), "null");

    let long = format!("a:{}", "b".repeat(1023));
    let shown = format!("{}...{}", &long[..511], "b".repeat(510));
    assert_eq!(url(&long).string_for_message().to_string(), shown);
    assert_eq!(url(&long[..1024]).string_for_message().len(), 1024);
}

#[test]
fn schemes() {
    assert_eq!(Scheme::named(Text::Utf16(&[0x77, 0x73])), Scheme::Ws);
    assert_eq!(Scheme::named(Text::Utf16(&[0x177, 0x73])), Scheme::Other);
    assert_eq!(Scheme::named(Text::from_ascii("HTTP")), Scheme::Other);
    assert_eq!(Scheme::Ftp.default_port(), Some(21));
}
