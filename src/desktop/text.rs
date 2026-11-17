//! What `str` has, on top of `bun_core::strings`. Separators are ASCII.

use bun_core::strings;
use bun_ui::protocol::Text;

pub(crate) fn string(bytes: &[u8]) -> String {
    Text::lossy(bytes).into_string()
}

pub(crate) fn split<'a>(text: &'a str, separator: &'a str) -> impl Iterator<Item = &'a str> {
    strings::split(text.as_bytes(), separator.as_bytes())
        .map(|part| core::str::from_utf8(part).unwrap_or_default())
}

pub(crate) fn split_once<'a>(text: &'a str, separator: &str) -> Option<(&'a str, &'a str)> {
    let at = strings::index_of(text.as_bytes(), separator.as_bytes())?;
    Some((&text[..at], &text[at + separator.len()..]))
}

pub(crate) fn before<'a>(text: &'a str, separator: &str) -> &'a str {
    split_once(text, separator).map_or(text, |it| it.0)
}

pub(crate) fn contains(text: &str, part: &str) -> bool {
    strings::contains(text.as_bytes(), part.as_bytes())
}

/// Each character that has a replacement.
pub(crate) fn escape(text: &str, replacement: impl Fn(char) -> Option<&'static str>) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match replacement(character) {
            Some(it) => escaped.push_str(it),
            None => escaped.push(character),
        }
    }
    escaped
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    string(&bun_base64::encode_alloc(bytes))
}

pub(crate) fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    bun_boringssl_sys::rand_bytes(&mut bytes);
    bytes
}

pub(crate) fn random_uuid() -> String {
    bun_jsc::uuid::UUID::init_with(&random_bytes()).to_string()
}

pub(crate) fn escape_html(text: &str) -> String {
    escape(text, |it| match it {
        '&' => Some("&amp;"),
        '<' => Some("&lt;"),
        '>' => Some("&gt;"),
        '"' => Some("&quot;"),
        '\'' => Some("&#x27;"),
        _ => None,
    })
}

/// `encodeURIComponent()`
pub(crate) fn encode_component(text: &str) -> String {
    encode(text, b"-_.!~*'()")
}

/// As `base::EscapePath`.
pub(crate) fn encode_path(text: &str) -> String {
    encode(text, b"-_.!~*'()$&+,/;=@")
}

fn encode(text: &str, kept: &[u8]) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte.is_ascii_alphanumeric() || kept.contains(&byte) {
            true => encoded.push(byte.into()),
            false => encoded.extend(['%', digit(byte >> 4), digit(byte & 15)]),
        }
    }
    encoded
}

fn digit(value: u8) -> char {
    b"0123456789ABCDEF"[value as usize].into()
}

pub(crate) fn from_base64(text: &str) -> Vec<u8> {
    bun_base64::decode_alloc(text.as_bytes()).unwrap_or_default()
}

pub(crate) fn replace(text: &str, part: &str, replacement: &str) -> String {
    split(text, part).collect::<Vec<_>>().join(replacement)
}

pub(crate) fn origin_of(url: &str) -> String {
    let origin =
        bun_web::url::Url::parse(url.as_bytes()).map(|it| bun_web::origin::Origin::of(&it));
    origin.map_or_else(|| "null".to_owned(), |it| string(it.as_bytes()))
}
