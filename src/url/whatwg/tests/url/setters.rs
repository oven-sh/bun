use bun_engine_text::Text;
use bun_url_whatwg::{Punycode, Url};

use crate::{ascii, string, url};

fn check<T>(set: impl Fn(&mut Url, Text<'_>) -> T, cases: &[(&str, &str, &str)]) {
    for &(href, value, expected) in cases {
        let wide: Vec<u16> = value.encode_utf16().collect();
        for text in [string(value).text(), Text::Utf16(&wide)] {
            let mut actual = url(href);
            set(&mut actual, text);
            assert_eq!(ascii(actual.href()), expected, "{href} {value:?}");

            let parsed = url(expected);
            let parts =
                |url: &Url| [url.protocol(), url.username(), url.password(), url.host()].concat();
            assert_eq!(parts(&actual), parts(&parsed), "{href} {value:?}");
            assert_eq!(actual.port(), parsed.port());
            assert_eq!(actual.path(), parsed.path());
            assert_eq!(actual.query(), parsed.query());
            assert_eq!(actual.fragment(), parsed.fragment());
        }
    }
}

#[test]
fn protocol() {
    let cases = [
        ("a://h/p", "", "a://h/p"),
        ("a://h/p", "B+c:d", "b+c://h/p"),
        ("a://h/p", "1b", "a://h/p"),
        ("a://h/p", "b c", "a://h/p"),
        ("a://h/p", "http", "a://h/p"),
        ("a:p?q#f", "long", "long:p?q#f"),
        ("a:/.//p", "bc", "bc:/.//p"),
        ("http://h/", "a", "http://h/"),
        ("http://u:p@h:443/p?q#f", "h\tttps", "https://u:p@h/p?q#f"),
        ("http://h:81/", "wss", "wss://h:81/"),
        ("http://h/p", "file", "file://h/p"),
        ("http://u@h/", "file", "http://u@h/"),
        ("http://h:81/", "file", "http://h:81/"),
        ("file:///p", "http", "file:///p"),
        ("file://h/p", "http", "http://h/p"),
    ];
    check(Url::set_protocol, &cases);
}

#[test]
fn credentials() {
    let usernames = [
        ("http://h/", "a b:é@", "http://a%20b%3A%C3%A9%40@h/"),
        ("http://u:p@h:1/p?q#f", "", "http://:p@h:1/p?q#f"),
        ("http://u@h/", "", "http://h/"),
        ("http://:p@h/", "\t%41", "http://%09%41:p@h/"),
        ("file://h/", "u", "file://h/"),
        ("a:///p", "u", "a:///p"),
        ("a:p", "u", "a:p"),
        ("a://h?q", "u", "a://u@h?q"),
    ];
    check(Url::set_username, &usernames);
    let passwords = [
        ("http://h/", "/😀", "http://:%2F%F0%9F%98%80@h/"),
        ("http://u:p@h/", "", "http://u@h/"),
        ("http://:p@h/", "", "http://h/"),
        ("http://u@h:1/p", "p", "http://u:p@h:1/p"),
        ("a:/p", "p", "a:/p"),
    ];
    check(Url::set_password, &passwords);
    let removals = [("ws://u:p@h:1/p", "", "ws://h:1/p"), ("a:p", "", "a:p")];
    check(|url, _| url.remove_credentials(), &removals);
}

#[test]
fn host_and_hostname() {
    let both = [
        (
            "http://u:p@h:1/p?q#f",
            "EXAMPLE.com",
            "http://u:p@example.com:1/p?q#f",
        ),
        ("http://h/p", "", "http://h/p"),
        ("http://h/p", "a/b", "http://a/p"),
        ("http://h/p", "a\\b", "http://a/p"),
        ("http://h/p", "a?b", "http://a/p"),
        ("http://h/p", "a@b", "http://h/p"),
        ("http://h/p", "0x7f.1", "http://127.0.0.1/p"),
        ("http://h/p", "[0::1]", "http://[::1]/p"),
        ("http://h/p", "[::1", "http://h/p"),
        ("http://h/p", "faß.de", "http://xn--fa-hia.de/p"),
        ("http://h/p", "xn--a", "http://h/p"),
        ("file:///p", "h", "file://h/p"),
        ("file://h/p", "", "file:///p"),
        ("file://h/p", "LOC%61lhost", "file:///p"),
        ("file://h/p", "a:1", "file://h/p"),
        ("a:p", "h", "a:p"),
        ("a:/p", "É", "a://%C3%89/p"),
        ("a:/p", "", "a:///p"),
        ("a:/.//p", "h", "a://h//p"),
        ("a://h/p", "", "a:///p"),
        ("a://h:1/p", "", "a://h:1/p"),
        ("a://u@h/p", "", "a://u@h/p"),
        ("a://h/p", "a\\b", "a://h/p"),
    ];
    check(|url, value| url.set_host(value, Punycode::Checked), &both);
    check(
        |url, value| url.set_hostname(value, Punycode::Checked),
        &both,
    );

    let hosts = [
        ("http://h:1/p", "a:2", "http://a:2/p"),
        ("http://h:1/p", "a:080x", "http://a/p"),
        ("http://h:1/p", "a:", "http://a:1/p"),
        ("http://h:1/p", "a:x", "http://a:1/p"),
        ("http://h:1/p", "a:65536", "http://a:1/p"),
        ("http://h/p", "[::1]:2", "http://[::1]:2/p"),
        ("http://h/p", ":2", "http://h/p"),
        ("a:/p", "h:0", "a://h:0/p"),
    ];
    check(|url, value| url.set_host(value, Punycode::Checked), &hosts);
    let hostnames = [
        ("http://h/", "a:2", "http://h/"),
        ("a://h/", "[::1]:", "a://h/"),
    ];
    check(
        |url, value| url.set_hostname(value, Punycode::Checked),
        &hostnames,
    );

    let mut unchecked = url("http://h/");
    let label = Text::from_ascii("xn--a");
    assert_eq!(unchecked.set_hostname(label, Punycode::Unchecked), Ok(()));
    assert_eq!(unchecked.href(), b"http://xn--a/");
}

#[test]
fn port() {
    let cases = [
        ("http://h/p?q#f", "8080", "http://h:8080/p?q#f"),
        ("http://h:1/", "", "http://h/"),
        ("http://h:1/", "80", "http://h/"),
        ("http://h:1/", "0", "http://h:0/"),
        ("http://h:1/", "0065535/", "http://h:65535/"),
        ("http://h:1/", "65536", "http://h:1/"),
        ("http://h:1/", "x", "http://h:1/"),
        ("http://h:1/", "\n2\t3", "http://h:23/"),
        ("http://h:1/", "\n", "http://h:1/"),
        ("file://h/", "1", "file://h/"),
        ("a:///", "1", "a:///"),
        ("a://h", "80", "a://h:80"),
    ];
    check(Url::set_port, &cases);
}

#[test]
fn pathname() {
    let cases = [
        ("http://h/p?q#f", "", "http://h/?q#f"),
        ("http://h/p?q#f", "a/./b/../c", "http://h/a/c?q#f"),
        ("http://h:1/p", "\\a\\%2e%2E\\b", "http://h:1/b"),
        ("http://h/", "?#^ é", "http://h/%3F%23%5E%20%C3%A9"),
        ("http://h/", "..?", "http://h/..%3F"),
        ("file:///p", "c|/..", "file:///c:/"),
        ("a:p", "/x", "a:p"),
        ("a://h/p", "", "a://h"),
        ("a://h", "\\x", "a://h/\\x"),
        ("a:/p", "", "a:/"),
        ("a:/p?q", "//x", "a:/.//x?q"),
        ("a:/.//p?q", "x", "a:/x?q"),
    ];
    check(Url::set_pathname, &cases);
}

#[test]
fn search_and_hash() {
    let searches = [
        ("http://h/?q#f", "", "http://h/#f"),
        ("http://h/#f", "?", "http://h/?#f"),
        ("http://h/", "??'#\"`", "http://h/??%27%23%22`"),
        ("a:p", "' é", "a:p?'%20%C3%A9"),
        ("a://h", "\ta", "a://h?a"),
    ];
    check(Url::set_search, &searches);
    let hashes = [
        ("http://h/?q#f", "", "http://h/?q"),
        ("http://h/", "#", "http://h/#"),
        ("http://h/", "##`' ", "http://h/##%60'%20"),
        ("a:p", "\u{1}", "a:p#%01"),
    ];
    check(Url::set_hash, &hashes);
    let queries = [
        ("http://h/", "?a", "http://h/??a"),
        ("http://h/", "", "http://h/?"),
    ];
    check(|url, value| url.set_query(Some(value)), &queries);
    let fragments = [
        ("http://h/", "#a", "http://h/##a"),
        ("http://h/", "", "http://h/#"),
    ];
    check(|url, value| url.set_fragment(Some(value)), &fragments);
}
