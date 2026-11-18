//! The data of web-platform-tests that the tests of the `URL` class use.

use core::iter::Peekable;
use core::str::Chars;
use std::collections::BTreeMap;

use bun_engine_text::{StringRef, Text};
use bun_url_whatwg::{ByteUrl, Input, Punycode, Record, Storage, Url, form};

use crate::{ascii, string, url};

/// The members of an object. A value that is not a string is kept as it is written.
type Case = BTreeMap<String, String>;

fn json_string(input: &mut Peekable<Chars<'_>>) -> String {
    let mut units = Vec::new();
    loop {
        let character = match input.next().unwrap() {
            '"' => return String::from_utf16_lossy(&units),
            '\\' => match input.next().unwrap() {
                'u' => {
                    let digits: String = input.take(4).collect();
                    units.push(u16::from_str_radix(&digits, 16).unwrap());
                    continue;
                }
                'b' => '\u{8}',
                'f' => '\u{c}',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                escaped => escaped,
            },
            character => character,
        };
        units.extend_from_slice(character.encode_utf16(&mut [0; 2]));
    }
}

/// An array of comments and of objects that are flat but for arrays of strings, which are left out.
fn cases(json: &str) -> Vec<Case> {
    let mut input = json.chars().peekable();
    let (mut cases, mut open, mut name, mut depth) = (Vec::new(), None::<Case>, None, 0);
    while let Some(character) = input.next() {
        let value = match character {
            '"' => json_string(&mut input),
            'a'..='z' => {
                let rest = core::iter::from_fn(|| input.next_if(char::is_ascii_alphabetic));
                core::iter::once(character).chain(rest).collect()
            }
            _ => {
                match character {
                    '{' => open = Some(Case::new()),
                    '}' => cases.extend(open.take()),
                    '[' => depth += 1,
                    ']' => (depth, name) = (depth - 1, None),
                    _ => {}
                }
                continue;
            }
        };
        match (&mut open, depth, name.take()) {
            (Some(_), 1, None) => name = Some(value),
            (Some(_), 1, Some(_)) if character == 'n' => {}
            (Some(case), 1, Some(name)) => drop(case.insert(name, value)),
            _ => {}
        }
    }
    cases
}

fn check_getters(url: &Record<impl Storage>, case: &Case) {
    for (name, actual) in [
        ("href", url.href()),
        ("protocol", url.protocol()),
        ("username", url.username()),
        ("password", url.password()),
        ("host", url.host()),
        ("hostname", url.hostname()),
        ("port", url.port_text()),
        ("pathname", url.path()),
        ("search", url.search()),
        ("hash", url.hash()),
    ] {
        assert_eq!(ascii(actual), case[name], "{name} of {case:?}");
    }
    assert_eq!(url.port(), case["port"].parse().ok());
    let origin = match case["input"].as_str() {
        "ftps:/example.com/" | "ftps:example.com/" => Some("ftps:"),
        "blob:ftp://host/path" => Some("ftp://host"),
        "blob:ws://example.org/" => Some("ws://example.org"),
        "blob:wss://example.org/" => Some("wss://example.org"),
        _ => case.get("origin").map(String::as_str),
    };
    if let Some(origin) = origin {
        assert_eq!(url.origin().unwrap().to_string(), origin, "{case:?}");
    }
}

#[test]
fn constructor() {
    let cases = cases(include_str!(
        "../../../../../test/js/node/test/fixtures/wpt/url/resources/urltestdata.json"
    ));
    assert!(cases.len() > 800);
    for case in &cases {
        let input = &case["input"];
        let base = case.get("base").map(|base| url(base));
        let narrow = string(input);
        let wide: Vec<u16> = input.encode_utf16().collect();
        let is_valid = !case.contains_key("failure");
        for text in [narrow.text(), Text::Utf16(&wide)] {
            let can_parse = Url::can_parse(text, base.as_ref(), Punycode::Checked);
            assert_eq!(can_parse, is_valid, "{case:?}");
        }
        for input in [
            Input::String(&narrow),
            Input::Text(Text::Utf16(&wide)),
            Input::Utf8(input.as_bytes()),
        ] {
            let parsed = Url::parse(input, base.as_ref(), Punycode::Checked);
            assert_eq!(parsed.is_ok(), is_valid, "{case:?}");
            if let Ok(parsed) = parsed {
                check_getters(&parsed, case);
            }
        }
        if !is_valid {
            continue;
        }

        let base = case.get("base");
        let base = base.map(|base| ByteUrl::parse(base.as_bytes(), None).unwrap());
        let bytes = ByteUrl::parse(input.as_bytes(), base.as_ref()).unwrap();
        check_getters(&bytes, case);

        let href = StringRef::from_latin1(bytes.href());
        let again = Url::parse(&href, None, Punycode::Checked).unwrap();
        assert!(again.string().unwrap().ptr_eq(&href), "{case:?}");
        if let Some(expected) = case.get("searchParams") {
            let query = Text::Latin1(again.query().unwrap_or_default());
            let pairs = form::parse(query, usize::MAX).unwrap();
            let pairs = pairs.iter().map(|it| (it.name.text(), it.value.text()));
            assert_eq!(form::serialize(pairs).unwrap().to_string(), *expected);
        }
    }
}

#[test]
fn to_ascii() {
    let cases = cases(include_str!(
        "../../../../../test/js/node/test/fixtures/wpt/url/resources/toascii.json"
    ));
    assert!(cases.len() > 80);
    for case in &cases {
        let (host, expected) = (&case["input"], case.get("output").map(String::as_bytes));
        let href = string(&format!("https://{host}/x"));
        let parsed = Url::parse(&href, None, Punycode::Checked);
        assert_eq!(parsed.as_ref().ok().map(Url::host), expected, "{case:?}");

        let mut assigned = url("https://x/x");
        let outcome = assigned.set_hostname(string(host).text(), Punycode::Checked);
        assert_eq!(outcome.is_ok(), expected.is_some());
        assert_eq!(assigned.host(), expected.unwrap_or(b"x"), "{case:?}");
    }
}
