//! https://fetch.spec.whatwg.org/#terminology-headers

use std::borrow::Cow;

use bun_core::strings;

use crate::Bytes;
use crate::mime::Mime;
use crate::net::record::{RecordReader, RecordWriter};
use crate::wire::{self, Wire};

pub fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#'..=b'\'' | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
        )
}

pub fn is_valid_value(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\0\r\n").is_none()
}

pub fn is_token(text: &[u8]) -> bool {
    !text.is_empty() && text.iter().all(|it| is_token_byte(*it))
}

fn trim_by(text: &[u8], trims: impl Fn(&&u8) -> bool) -> &[u8] {
    let text = &text[text.iter().take_while(&trims).count()..];
    &text[..text.len() - text.iter().rev().take_while(&trims).count()]
}

pub fn trim_http_whitespace(text: &[u8]) -> &[u8] {
    trim_by(text, |it| matches!(it, b'\t' | b'\n' | b'\r' | b' '))
}

pub fn trim_tabs_and_spaces(text: &[u8]) -> &[u8] {
    trim_by(text, |it| matches!(it, b'\t' | b' '))
}

/// `text` starts with the opening quote. The value, and what follows it.
pub fn collect_quoted(text: &[u8]) -> (Vec<u8>, &[u8]) {
    let (mut value, mut rest) = (Vec::new(), &text[1..]);
    loop {
        rest = match rest {
            [] => return (value, rest),
            [b'"', after @ ..] => return (value, after),
            [b'\\', byte, after @ ..] | [byte, after @ ..] => {
                value.push(*byte);
                after
            }
        };
    }
}

/// At the separators that are not in quotes.
pub fn split(text: &[u8], separator: u8) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(text);
    core::iter::from_fn(move || {
        let (text, mut at) = (rest?, 0);
        while let Some(found) = strings::index_of_any_pos(text, &[b'"', separator], at) {
            if text[found] == separator {
                rest = Some(&text[found + 1..]);
                return Some(trim_tabs_and_spaces(&text[..found]));
            }
            at = text.len() - collect_quoted(&text[found..]).1.len();
        }
        rest = None;
        Some(trim_tabs_and_spaces(text))
    })
}

/// `None` unless all of them are tokens.
pub fn tokens(value: &[u8]) -> Option<Vec<&[u8]>> {
    split(value, b',')
        .filter(|it| !it.is_empty())
        .map(|it| is_token(it).then_some(it))
        .collect()
}

pub fn digits(text: &[u8]) -> Option<u64> {
    (!text.is_empty() && text.iter().all(u8::is_ascii_digit)).then(|| {
        text.iter().fold(0u64, |all, it| {
            all.saturating_mul(10).saturating_add(u64::from(it - b'0'))
        })
    })
}

fn has_cors_unsafe_byte(value: &[u8]) -> bool {
    value.iter().any(|it| {
        matches!(it, 0..=8 | 10..=0x1f | b'"' | b'(' | b')' | b':' | b'<' | b'>' | b'?' | b'@' | b'[' | b'\\' | b']' | b'{' | b'}' | 0x7f)
    })
}

fn is_simple_range(value: &[u8]) -> bool {
    let Some((first, last)) = value
        .strip_prefix(b"bytes=")
        .and_then(|it| strings::split_once_char(it, b'-'))
    else {
        return false;
    };
    let magnitude = |it| {
        (
            strings::trim_leading_char(it, b'0').len(),
            strings::trim_leading_char(it, b'0'),
        )
    };
    digits(first).is_some()
        && (last.is_empty() || (digits(last).is_some() && magnitude(first) <= magnitude(last)))
}

/// More than the names that are known have.
fn lowercase_start<'b>(name: &[u8], buffer: &'b mut [u8; 48]) -> &'b [u8] {
    let start = &mut buffer[..name.len().min(48)];
    start.copy_from_slice(&name[..start.len()]);
    start.make_ascii_lowercase();
    start
}

/// `name` is in lower case.
pub fn is_cors_safelisted(name: &[u8], value: &[u8]) -> bool {
    value.len() <= 128
        && match lowercase_start(name, &mut [0; _]) {
            b"accept" => !has_cors_unsafe_byte(value),
            b"accept-language" | b"content-language" => value.iter().all(|it| {
                it.is_ascii_alphanumeric()
                    || matches!(it, b' ' | b'*' | b',' | b'-' | b'.' | b';' | b'=')
            }),
            b"content-type" => {
                !has_cors_unsafe_byte(value)
                    && Mime::parse(value).is_some_and(|it| {
                        matches!(
                            it.essence(),
                            b"application/x-www-form-urlencoded"
                                | b"multipart/form-data"
                                | b"text/plain"
                        )
                    })
            }
            b"range" => is_simple_range(value),
            b"save-data" => value.eq_ignore_ascii_case(b"on"),
            b"device-memory" | b"dpr" | b"downlink" => {
                let (whole, fraction) =
                    strings::split_once_char(value, b'.').unwrap_or((value, b"0"));
                digits(whole).is_some() && digits(fraction).is_some()
            }
            b"width" | b"viewport-width" | b"rtt" => digits(value).is_some(),
            b"ect" => matches!(value, b"2g" | b"3g" | b"4g" | b"slow-2g"),
            _ => false,
        }
}

pub fn is_forbidden_method(method: &[u8]) -> bool {
    matches!(
        &*method.to_ascii_uppercase(),
        b"CONNECT" | b"TRACE" | b"TRACK"
    )
}

pub fn normalize_method(method: &[u8]) -> Cow<'_, [u8]> {
    let upper = method.to_ascii_uppercase();
    match &*upper {
        b"DELETE" | b"GET" | b"HEAD" | b"OPTIONS" | b"POST" | b"PUT" => upper.into(),
        _ => method.into(),
    }
}

/// `name` is in lower case.
pub fn is_forbidden_request_header(name: &[u8], value: &[u8]) -> bool {
    let mut buffer = [0; _];
    let name = lowercase_start(name, &mut buffer);
    match name {
        b"x-http-method" | b"x-http-method-override" | b"x-method-override" => {
            split(value, b',').any(is_forbidden_method)
        }
        b"accept-charset"
        | b"accept-encoding"
        | b"access-control-request-headers"
        | b"access-control-request-method"
        | b"access-control-request-private-network"
        | b"connection"
        | b"content-length"
        | b"cookie"
        | b"cookie2"
        | b"date"
        | b"dnt"
        | b"expect"
        | b"host"
        | b"keep-alive"
        | b"origin"
        | b"referer"
        | b"set-cookie"
        | b"te"
        | b"trailer"
        | b"transfer-encoding"
        | b"upgrade"
        | b"user-agent"
        | b"via" => true,
        _ => name.starts_with(b"proxy-") || name.starts_with(b"sec-"),
    }
}

/// The names are as they were first given.
#[derive(Clone, Default)]
pub struct HeaderList(Vec<(Bytes, Bytes)>);

impl Wire for HeaderList {
    fn write(self, to: &mut wire::Writer) {
        self.0.write(to);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<HeaderList> {
        let all = HeaderList(Wire::read(from)?);
        let is_valid = from.peer() == Some(crate::remote::HOST)
            || all.iter().all(|it| is_token(it.0) && is_valid_value(it.1));
        is_valid.then_some(all).ok_or(wire::Malformed)
    }
}

impl HeaderList {
    pub const fn new() -> HeaderList {
        HeaderList(Vec::new())
    }

    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        self.0.iter().map(|it| (&*it.0, &*it.1))
    }

    pub fn values<'a>(&'a self, name: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
        self.iter()
            .filter(move |it| it.0.eq_ignore_ascii_case(name))
            .map(|it| it.1)
    }

    pub fn contains(&self, name: &[u8]) -> bool {
        self.values(name).next().is_some()
    }

    /// All of its values.
    pub fn get(&self, name: &[u8]) -> Option<Cow<'_, [u8]>> {
        let mut values = self
            .iter()
            .filter(|it| it.0.eq_ignore_ascii_case(name))
            .map(|it| it.1);
        let first = Cow::Borrowed(values.next()?);
        Some(values.fold(first, |all, it| [&all, &b", "[..], it].concat().into()))
    }

    pub fn get_or_empty(&self, name: &[u8]) -> Cow<'_, [u8]> {
        self.get(name).unwrap_or_default()
    }

    pub fn append(&mut self, name: &[u8], value: &[u8]) {
        let name = self
            .iter()
            .find(|it| it.0.eq_ignore_ascii_case(name))
            .map_or(name, |it| it.0)
            .into();
        self.0.push((name, value.into()));
    }

    pub fn delete(&mut self, name: &[u8]) {
        self.0.retain(|it| !it.0.eq_ignore_ascii_case(name));
    }

    pub fn retain(&mut self, mut keeps: impl FnMut(&[u8], &[u8]) -> bool) {
        self.0.retain(|it| keeps(&it.0, &it.1));
    }

    pub fn set(&mut self, name: &[u8], value: &[u8]) {
        let mut value = Some(value);
        self.0.retain_mut(|it| {
            !it.0.eq_ignore_ascii_case(name)
                || value.take().map(|value| it.1 = value.into()).is_some()
        });
        self.0
            .extend(value.map(|value| (name.into(), value.into())));
    }

    pub fn set_if_absent(&mut self, name: &[u8], value: &[u8]) {
        if !value.is_empty() && !self.contains(name) {
            self.0.push((name.into(), value.into()));
        }
    }

    /// Each name once.
    pub fn combined(&self) -> impl Iterator<Item = (&[u8], Cow<'_, [u8]>)> {
        let is_first = |at: usize, name: &[u8]| {
            !self.0[..at]
                .iter()
                .any(|it| it.0.eq_ignore_ascii_case(name))
        };
        self.iter()
            .enumerate()
            .filter(move |(at, it)| is_first(*at, it.0))
            .map(|(_, it)| (it.0, self.get_or_empty(it.0)))
    }

    /// https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
    pub fn sorted_and_combined(&self) -> Vec<(Vec<u8>, Cow<'_, [u8]>)> {
        let mut names: Vec<_> = self.iter().map(|it| it.0.to_ascii_lowercase()).collect();
        names.sort_unstable();
        names.dedup();
        let mut sorted = Vec::with_capacity(names.len());
        for name in names {
            if name == b"set-cookie" {
                sorted.extend(
                    self.values(b"set-cookie")
                        .map(|it| (name.clone(), it.into())),
                );
            } else {
                let value = self.get_or_empty(&name);
                sorted.push((name, value));
            }
        }
        sorted
    }

    pub fn mime(&self) -> Option<Mime> {
        Mime::extract(&self.get(b"content-type")?)
    }

    pub(crate) fn write(&self, out: &mut RecordWriter) {
        out.count(self.iter().count());
        (self.iter().flat_map(|it| [it.0, it.1])).for_each(|it| out.bytes(it));
    }

    pub(crate) fn read(record: &mut RecordReader<'_>) -> Option<HeaderList> {
        let pairs = record.list(|it| Some((it.bytes()?, it.bytes()?)))?;
        Some(pairs.into_iter().collect())
    }

    pub fn is_attachment(&self) -> bool {
        self.get_or_empty(b"content-disposition")
            .trim_ascii_start()
            .get(..10)
            .is_some_and(|it| it.eq_ignore_ascii_case(b"attachment"))
    }

    pub fn is_nosniff(&self) -> bool {
        split(&self.get_or_empty(b"x-content-type-options"), b',')
            .next()
            .is_some_and(|it| it.eq_ignore_ascii_case(b"nosniff"))
    }
}

impl<N: AsRef<[u8]>, V: AsRef<[u8]>> FromIterator<(N, V)> for HeaderList {
    fn from_iter<I: IntoIterator<Item = (N, V)>>(pairs: I) -> HeaderList {
        HeaderList(
            pairs
                .into_iter()
                .map(|it| (it.0.as_ref().into(), it.1.as_ref().into()))
                .collect(),
        )
    }
}
