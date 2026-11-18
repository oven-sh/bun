use bun_engine_text::Text;
use bun_url_whatwg::form::{self, Pair};

use crate::string;

fn pair(name: &str, value: &str) -> Pair {
    let (name, value) = (string(name), string(value));
    Pair { name, value }
}

#[test]
fn parser() {
    let cases: [(&str, &[(&str, &str)]); 10] = [
        ("", &[]),
        ("&&", &[]),
        ("a&=&b=&=c", &[("a", ""), ("", ""), ("b", ""), ("", "c")]),
        ("a==b=&", &[("a", "=b=")]),
        ("+a+=%2B%20", &[(" a ", "+ ")]),
        ("%=%4&%zz%41", &[("%", "%4"), ("%zzA", "")]),
        ("é=%C3%A9é", &[("é", "éé")]),
        ("†=%E2%80&%EF%BB%BF", &[("†", "\u{fffd}"), ("\u{feff}", "")]),
        ("%C3©", &[("\u{fffd}©", "")]),
        ("?a= \t", &[("?a", " \t")]),
    ];
    for (input, expected) in cases {
        let expected: Vec<Pair> = expected.iter().map(|&(a, b)| pair(a, b)).collect();
        let wide: Vec<u16> = input.encode_utf16().collect();
        for text in [string(input).text(), Text::Utf16(&wide)] {
            assert_eq!(form::parse(text, usize::MAX).unwrap(), expected, "{input}");
        }
    }
}

#[test]
fn serializer() {
    let printable: String = (' '..='~').collect();
    let (name, value) = (string(&printable), [0xe9, 0xd800, 0xd83d, 0xde00]);
    let pairs = [
        (name.text(), Text::Utf16(&value)),
        (Text::EMPTY, Text::Latin1(b"\xe9\0")),
    ];
    assert_eq!(
        form::serialize(pairs).unwrap().to_string(),
        "+%21%22%23%24%25%26%27%28%29*%2B%2C-.%2F0123456789%3A%3B%3C%3D%3E%3F%40ABCDEFGHIJKLMNOPQRSTUVWXYZ%5B%5C%5D%5E_\
         %60abcdefghijklmnopqrstuvwxyz%7B%7C%7D%7E=%C3%A9%EF%BF%BD%F0%9F%98%80&=%C3%A9%00"
    );
}

#[test]
fn limits() {
    let limit = 2 * size_of::<Pair>();
    let parse = |input: &str| form::parse(string(input).text(), limit);
    assert!(parse("a&b").is_ok());
    assert!(parse("a&b&c").is_err());
    assert!(parse(&"é".repeat(limit / 4)).is_ok() && parse(&"é".repeat(limit / 4 + 1)).is_err());
    assert!(parse(&"a".repeat(limit + 1)).is_ok());
}
