use bun_engine_text::{CodeUnit, Text, with_text};
use bun_icu::Buffer;

use crate::Result;

const MAX_LENGTH: usize = 8;

/// One to eight ASCII letters and digits, ordered as strings are.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct Subtag([u8; MAX_LENGTH]);

impl Subtag {
    pub(crate) const UND: Subtag = Subtag(*b"und\0\0\0\0\0");
    pub(crate) const WORLD: Subtag = Subtag(*b"001\0\0\0\0\0");

    pub(crate) fn new(bytes: &[u8]) -> Option<Subtag> {
        let mut padded = [0; MAX_LENGTH];
        padded.get_mut(..bytes.len())?.copy_from_slice(bytes);
        (!bytes.is_empty() && bytes.iter().all(u8::is_ascii_alphanumeric)).then_some(Subtag(padded))
    }

    pub(crate) fn from_text(text: Text<'_>) -> Option<Subtag> {
        let mut bytes = [0; MAX_LENGTH];
        let bytes = bytes.get_mut(..text.len())?;
        for (byte, unit) in bytes.iter_mut().zip(text.code_units()) {
            *byte = u8::try_from(unit).ok()?;
        }
        Subtag::new(bytes)
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        let padding = u64::from_be_bytes(self.0).trailing_zeros() as usize / 8;
        &self.0[..MAX_LENGTH - padding]
    }

    pub(crate) fn to_lowercase(mut self) -> Subtag {
        self.0.make_ascii_lowercase();
        self
    }

    pub(crate) fn to_uppercase(mut self) -> Subtag {
        self.0.make_ascii_uppercase();
        self
    }

    pub(crate) fn to_titlecase(self) -> Subtag {
        let mut title = self.to_lowercase();
        title.0[0].make_ascii_uppercase();
        title
    }
}

/// `text` in lower case, if it is a sequence of subtags with a hyphen between each two.
pub(crate) fn lowercase_subtags(text: Text<'_>) -> Result<Option<Buffer<u8>>> {
    fn lowercase<T: CodeUnit>(units: &[T]) -> Result<Option<Buffer<u8>>> {
        let mut length = 0;
        for &unit in units {
            if unit.is(b'-') && length != 0 {
                length = 0;
            } else if (unit.is_ascii_alphabetic() || unit.is_ascii_digit()) && length < MAX_LENGTH {
                length += 1;
            } else {
                return Ok(None);
            }
        }
        if length == 0 {
            return Ok(None);
        }
        let mut bytes = Buffer::new();
        bytes.try_reserve_exact(units.len())?;
        // Digits and the hyphen have the bit already.
        bytes.extend(units.iter().map(|unit| unit.to_u16() as u8 | 0x20));
        Ok(Some(bytes))
    }
    with_text!(text, |units| lowercase(units))
}

/// Reads a sequence of subtags from the front.
#[derive(Clone)]
pub(crate) struct Subtags<'a> {
    rest: &'a [u8],
}

impl<'a> Subtags<'a> {
    pub(crate) fn new(text: &'a [u8]) -> Subtags<'a> {
        Subtags { rest: text }
    }

    /// Starts with a subtag, or is empty.
    pub(crate) fn rest(&self) -> &'a [u8] {
        self.rest
    }

    pub(crate) fn next_if(&mut self, accepts: impl Fn(&[u8]) -> bool) -> Option<&'a [u8]> {
        let mut ahead = self.clone();
        let subtag = ahead.next().filter(|subtag| accepts(subtag))?;
        *self = ahead;
        Some(subtag)
    }

    /// The longest run of subtags that `accepts` takes, with the hyphens inside it.
    pub(crate) fn run(&mut self, accepts: impl Fn(&[u8]) -> bool) -> &'a [u8] {
        let start = self.rest;
        let mut length = 0;
        while let Some(subtag) = self.next_if(&accepts) {
            length += usize::from(length != 0) + subtag.len();
        }
        &start[..length]
    }
}

impl<'a> Iterator for Subtags<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        if self.rest.is_empty() {
            return None;
        }
        let length = (self.rest.iter())
            .take_while(|byte| byte.is_ascii_alphanumeric())
            .count();
        let (subtag, rest) = self.rest.split_at(length);
        self.rest = rest.get(1..).unwrap_or_default();
        Some(subtag)
    }
}

fn is_alphabetic(subtag: &[u8]) -> bool {
    subtag.iter().all(u8::is_ascii_alphabetic)
}

pub(crate) fn is_language(subtag: &[u8]) -> bool {
    matches!(subtag.len(), 2 | 3 | 5..=MAX_LENGTH) && is_alphabetic(subtag)
}

pub(crate) fn is_script(subtag: &[u8]) -> bool {
    subtag.len() == 4 && is_alphabetic(subtag)
}

pub(crate) fn is_region(subtag: &[u8]) -> bool {
    match subtag.len() {
        2 => is_alphabetic(subtag),
        3 => subtag.iter().all(u8::is_ascii_digit),
        _ => false,
    }
}

pub(crate) fn is_variant(subtag: &[u8]) -> bool {
    subtag.len() >= 5 || matches!(subtag, [b'0'..=b'9', _, _, _])
}

pub(crate) fn is_singleton(subtag: &[u8]) -> bool {
    subtag.len() == 1
}

pub(crate) fn is_unicode_key(subtag: &[u8]) -> bool {
    matches!(subtag, [_, second] if second.is_ascii_alphabetic())
}

pub(crate) fn is_transformed_key(subtag: &[u8]) -> bool {
    matches!(subtag, [first, b'0'..=b'9'] if first.is_ascii_alphabetic())
}

/// An attribute, or a part of the value of a key.
pub(crate) fn is_value(subtag: &[u8]) -> bool {
    subtag.len() >= 3
}
