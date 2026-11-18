//! <https://w3c.github.io/IndexedDB/#key-construct>, as bytes that sort like the keys, and of which none starts with another.

use std::sync::Arc;

pub type Key = Arc<[u8]>;

const END: u8 = 0;
const NUMBER: u8 = 0x10;
const DATE: u8 = 0x20;
const STRING: u8 = 0x30;
const BINARY: u8 = 0x40;
const ARRAY: u8 = 0x50;
const PAST: u8 = 0x60;

fn push_float(out: &mut Vec<u8>, kind: u8, value: f64) {
    let bits = (value + 0.0).to_bits();
    out.push(kind);
    out.extend_from_slice(
        &if bits >> 63 == 1 {
            !bits
        } else {
            bits | 1 << 63
        }
        .to_be_bytes(),
    );
}

pub fn push_number(out: &mut Vec<u8>, value: f64) {
    push_float(out, NUMBER, value);
}

pub fn push_date(out: &mut Vec<u8>, time: f64) {
    push_float(out, DATE, time);
}

pub fn push_string(out: &mut Vec<u8>, units: impl ExactSizeIterator<Item = u16>) {
    out.reserve(units.len() + 2);
    out.push(STRING);
    for unit in units {
        match unit {
            ..0x7f => out.push(unit as u8 + 1),
            0x7f..0x407f => out.extend_from_slice(&(unit - 0x7f + 0x8000).to_be_bytes()),
            _ => out.extend_from_slice(&[0xc0, (unit >> 8) as u8, unit as u8]),
        }
    }
    out.push(END);
}

pub fn push_binary(out: &mut Vec<u8>, bytes: &[u8]) {
    out.reserve(bytes.len() + 2);
    out.push(BINARY);
    for byte in bytes {
        match byte {
            0 | 1 => out.extend_from_slice(&[1, byte + 1]),
            _ => out.push(*byte),
        }
    }
    out.push(END);
}

pub fn begin_array(out: &mut Vec<u8>) {
    out.push(ARRAY);
}

pub fn end_array(out: &mut Vec<u8>) {
    out.push(END);
}

pub enum Token {
    Number(f64),
    Date(f64),
    String(Vec<u16>),
    Binary(Vec<u8>),
    BeginArray,
    EndArray,
}

fn read_units(rest: &mut &[u8], mut found: impl FnMut(u16)) -> Option<()> {
    loop {
        let (unit, len) = match **rest {
            [END, ..] => break,
            [byte @ ..0x80, ..] => (u16::from(byte) - 1, 1),
            [high @ ..0xc0, low, ..] => (u16::from_be_bytes([high, low]) - 0x8000 + 0x7f, 2),
            [_, high, low, ..] => (u16::from_be_bytes([high, low]), 3),
            _ => return None,
        };
        found(unit);
        *rest = &rest[len..];
    }
    *rest = &rest[1..];
    Some(())
}

fn read_binary<'k>(rest: &mut &'k [u8]) -> Option<&'k [u8]> {
    let (escaped, after) = bun_core::strings::split_once_char(rest, END)?;
    *rest = after;
    Some(escaped)
}

pub fn read_token(rest: &mut &[u8]) -> Option<Token> {
    Some(match *rest.split_off_first()? {
        kind @ (NUMBER | DATE) => {
            let bits = u64::from_be_bytes(rest.split_off(..8)?.try_into().ok()?);
            let value = f64::from_bits(if bits >> 63 == 1 {
                bits ^ 1 << 63
            } else {
                !bits
            });
            if kind == NUMBER {
                Token::Number(value)
            } else {
                Token::Date(value)
            }
        }
        STRING => {
            let mut units = Vec::new();
            read_units(rest, |it| units.push(it))?;
            Token::String(units)
        }
        BINARY => {
            let mut escaped = read_binary(rest)?.iter();
            Token::Binary(
                core::iter::from_fn(|| {
                    escaped.next().and_then(|it| {
                        if *it == 1 {
                            Some(escaped.next()? - 1)
                        } else {
                            Some(*it)
                        }
                    })
                })
                .collect(),
            )
        }
        ARRAY => Token::BeginArray,
        END => Token::EndArray,
        _ => return None,
    })
}

/// One key, as the functions above write it.
pub(super) fn is_valid(mut key: &[u8]) -> bool {
    const MOST_DEPTH: usize = 2000;
    let mut depth = 0usize;
    loop {
        if key.first() == Some(&BINARY) {
            let mut bytes = escaped_bytes(key).iter();
            while let Some(byte) = bytes.next() {
                if *byte == 1 && !matches!(bytes.next(), Some(1 | 2)) {
                    return false;
                }
            }
        }
        match read_token(&mut key) {
            None => return false,
            Some(Token::Number(it) | Token::Date(it)) if it.is_nan() => return false,
            Some(Token::BeginArray) if depth > MOST_DEPTH => return false,
            Some(Token::BeginArray) => depth += 1,
            Some(Token::EndArray) if depth == 0 => return false,
            Some(Token::EndArray) => depth -= 1,
            Some(_) => {}
        }
        if depth == 0 {
            return key.is_empty();
        }
    }
}

fn escaped_bytes(key: &[u8]) -> &[u8] {
    read_binary(&mut &key[1..]).unwrap_or_default()
}

pub fn as_number(mut key: &[u8]) -> Option<f64> {
    if key.first() == Some(&NUMBER)
        && let Token::Number(number) = read_token(&mut key)?
    {
        Some(number)
    } else {
        None
    }
}

/// The first key, and what follows it.
pub fn split(keys: &[u8]) -> (&[u8], &[u8]) {
    let (mut rest, mut depth) = (keys, 0usize);
    while let Some(kind) = rest.split_off_first() {
        match *kind {
            NUMBER | DATE => _ = rest.split_off(..8),
            STRING => _ = read_units(&mut rest, |_| {}),
            BINARY => _ = read_binary(&mut rest),
            ARRAY => depth += 1,
            _ => depth = depth.saturating_sub(1),
        }
        if depth == 0 {
            break;
        }
    }
    keys.split_at(keys.len() - rest.len())
}

/// Sorts after everything that starts with `key`, and before the next key.
pub fn past(key: &[u8]) -> Vec<u8> {
    [key, &[PAST]].concat()
}

crate::wire! {
    /// From the first, up to and without the second.
    #[derive(Clone)]
    pub struct KeyRange {
        pub from: Vec<u8>,
        pub to: Vec<u8>,
    }
}

impl KeyRange {
    pub fn new(
        lower: Option<&[u8]>,
        upper: Option<&[u8]>,
        is_lower_open: bool,
        is_upper_open: bool,
    ) -> KeyRange {
        KeyRange {
            from: lower.map_or_else(
                Vec::new,
                |it| if is_lower_open { past(it) } else { it.to_vec() },
            ),
            to: upper.map_or_else(
                || vec![PAST],
                |it| if is_upper_open { it.to_vec() } else { past(it) },
            ),
        }
    }

    pub fn all() -> KeyRange {
        KeyRange::new(None, None, true, true)
    }

    pub fn only(key: &[u8]) -> KeyRange {
        KeyRange {
            from: key.to_vec(),
            to: past(key),
        }
    }

    pub fn is_all(&self) -> bool {
        self.from.is_empty() && self.to == [PAST]
    }

    pub fn includes(&self, key: &[u8]) -> bool {
        *self.from <= *key && *key < *self.to
    }
}
