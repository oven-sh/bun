//! What a unit of a text is, and folding. The text stays UTF-8 bytes and a position is a byte offset.

use std::borrow::Cow;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Unit {
    /// git, globset.
    Byte,
    /// A name of minimatch with a POSIX class.
    CodePoint,
    /// minimatch, picomatch, npm `ignore`.
    Utf16,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct Text {
    pub(crate) unit: Unit,
    /// `Canonicalize` of ECMAScript without the flag `u`. With `Unit::Byte`: ASCII only.
    pub(crate) folds: bool,
}

/// The text, and whether it goes on with a `/`.
#[derive(Copy, Clone)]
pub(crate) struct Subject<'p> {
    pub(crate) bytes: &'p [u8],
    pub(crate) slash: bool,
}

impl<'p> Subject<'p> {
    pub(crate) fn of(bytes: &'p [u8]) -> Subject<'p> {
        Subject {
            bytes,
            slash: false,
        }
    }

    #[inline]
    pub(crate) fn len(self) -> usize {
        self.bytes.len() + usize::from(self.slash)
    }

    #[inline]
    pub(crate) fn get(self, at: usize) -> Option<u8> {
        match self.bytes.get(at) {
            Some(byte) => Some(*byte),
            None if self.slash && at == self.bytes.len() => Some(b'/'),
            None => None,
        }
    }

    /// The byte that ends at `at`.
    #[inline]
    pub(crate) fn before(self, at: usize) -> Option<u8> {
        self.get(at.checked_sub(1)?)
    }
}

const REPLACEMENT: u32 = 0xFFFD;

fn is_continuation(byte: u8) -> bool {
    byte & 0xC0 == 0x80
}

/// The length of the valid sequence of UTF-8 that starts at `at`. 0: there is none.
fn sequence_len(bytes: &[u8], at: usize) -> usize {
    let Some(&lead) = bytes.get(at) else {
        return 0;
    };
    // 0 is no continuation.
    let after = |i: usize| bytes.get(at + i).copied().unwrap_or(0);
    // How long it is, and what its second byte may be.
    let (len, low, high) = match lead {
        0..0x80 => return 1,
        0xC2..=0xDF => (2, 0x80, 0xBF),
        0xE0 => (3, 0xA0, 0xBF),
        0xE1..=0xEC | 0xEE | 0xEF => (3, 0x80, 0xBF),
        0xED => (3, 0x80, 0x9F),
        0xF0 => (4, 0x90, 0xBF),
        0xF1..=0xF3 => (4, 0x80, 0xBF),
        0xF4 => (4, 0x80, 0x8F),
        _ => return 0,
    };
    let is_valid = (low..=high).contains(&after(1)) && (2..len).all(|i| is_continuation(after(i)));
    if is_valid { len } else { 0 }
}

/// As JavaScript reads a file: U+FFFD for each byte that is in no sequence. The readers take the length of a character from its first byte.
pub(crate) fn well_formed(bytes: &[u8]) -> Cow<'_, [u8]> {
    if bytes.is_ascii() {
        return Cow::Borrowed(bytes);
    }
    let mut out = Vec::new();
    let (mut at, mut copied) = (0, 0);
    while at < bytes.len() {
        let len = sequence_len(bytes, at);
        if len == 0 {
            out.extend_from_slice(&bytes[copied..at]);
            out.extend_from_slice("\u{FFFD}".as_bytes());
            copied = at + 1;
        }
        at += len.max(1);
    }
    if copied == 0 {
        return Cow::Borrowed(bytes);
    }
    out.extend_from_slice(&bytes[copied..]);
    Cow::Owned(out)
}

/// The character of `len` bytes at `at`, where `sequence_len` has found it. `len` is 2, 3 or 4.
fn code_point_at(bytes: &[u8], at: usize, len: usize) -> u32 {
    let lead = bytes.get(at).copied().unwrap_or(0);
    let rest = bytes.get(at + 1..at + len).unwrap_or_default();
    let first = u32::from(lead) & (0x7F >> len);
    rest.iter()
        .fold(first, |c, byte| (c << 6) | u32::from(byte & 0x3F))
}

fn high_half(c: u32) -> u32 {
    0xD800 + (c.wrapping_sub(0x10000) >> 10)
}

fn low_half(c: u32) -> u32 {
    0xDC00 + (c.wrapping_sub(0x10000) & 0x3FF)
}

/// The one character that `mapped` is, if it is one UTF-16 unit.
fn one_unit(mut mapped: impl Iterator<Item = char>) -> Option<u32> {
    match (mapped.next(), mapped.next()) {
        (Some(one), None) if u32::from(one) <= 0xFFFF => Some(u32::from(one)),
        _ => None,
    }
}

/// `char::to_lowercase`, if that is one UTF-16 unit. What else `Text::fold` takes to `unit`, for a class.
pub(crate) fn unfold(unit: u32) -> u32 {
    match char::from_u32(unit) {
        Some(c) if unit <= 0xFFFF => one_unit(c.to_lowercase()).unwrap_or(unit),
        _ => unit,
    }
}

impl Text {
    pub(crate) const UTF16: Text = Text {
        unit: Unit::Utf16,
        folds: false,
    };

    /// Whether a unit of it is U+FFFD, which a bad byte of a path is too: then bytes do not say whether two texts are the same.
    pub(crate) fn has_replacement(self, literal: &[u8]) -> bool {
        if self.unit == Unit::Byte || literal.is_ascii() {
            return false;
        }
        let mut at = 0;
        while let Some((unit, len)) = self.plain().next(Subject::of(literal), at) {
            if unit == REPLACEMENT {
                return true;
            }
            at += len;
        }
        false
    }

    /// The same without folding.
    pub(crate) fn plain(self) -> Text {
        Text {
            unit: self.unit,
            folds: false,
        }
    }

    /// `char::to_uppercase`, if that is one UTF-16 unit, and not from beyond ASCII into ASCII.
    pub(crate) fn fold(self, unit: u32) -> u32 {
        if !self.folds {
            return unit;
        }
        if unit < 0x80 {
            return u32::from((unit as u8).to_ascii_uppercase());
        }
        match char::from_u32(unit) {
            Some(c) if self.unit != Unit::Byte && unit <= 0xFFFF => one_unit(c.to_uppercase())
                .filter(|folded| *folded >= 0x80)
                .unwrap_or(unit),
            _ => unit,
        }
    }

    #[inline]
    fn ascii(self, byte: u8) -> (u32, usize) {
        let folded = if self.folds {
            byte.to_ascii_uppercase()
        } else {
            byte
        };
        (u32::from(folded), 1)
    }

    /// The unit that starts at `at`, folded, and its length in bytes.
    #[inline]
    pub(crate) fn next(self, subject: Subject<'_>, at: usize) -> Option<(u32, usize)> {
        let byte = subject.get(at)?;
        Some(match self.unit {
            _ if byte < 0x80 => self.ascii(byte),
            Unit::Byte => (u32::from(byte), 1),
            _ => self.next_wide(subject.bytes, at),
        })
    }

    fn next_wide(self, bytes: &[u8], at: usize) -> (u32, usize) {
        let is_utf16 = self.unit == Unit::Utf16;
        match sequence_len(bytes, at) {
            0 => match at.checked_sub(2) {
                // The second half of four bytes.
                Some(start) if is_utf16 && sequence_len(bytes, start) == 4 => {
                    (low_half(code_point_at(bytes, start, 4)), 2)
                }
                _ => (REPLACEMENT, 1),
            },
            4 if is_utf16 => (high_half(code_point_at(bytes, at, 4)), 2),
            len => (self.fold(code_point_at(bytes, at, len)), len),
        }
    }

    /// The unit that ends at `at`, folded, and its length in bytes.
    #[inline]
    pub(crate) fn prev(self, subject: Subject<'_>, at: usize) -> Option<(u32, usize)> {
        let byte = subject.before(at)?;
        Some(match self.unit {
            _ if byte < 0x80 => self.ascii(byte),
            Unit::Byte => (u32::from(byte), 1),
            _ => self.prev_wide(subject.bytes, at),
        })
    }

    /// A byte that starts a sequence is never inside of another one, so what `next` steps over is found from behind as well.
    fn prev_wide(self, bytes: &[u8], at: usize) -> (u32, usize) {
        let is_utf16 = self.unit == Unit::Utf16;
        for back in 1..=4 {
            let Some(start) = at.checked_sub(back) else {
                break;
            };
            if bytes.get(start).is_some_and(|it| is_continuation(*it)) {
                continue;
            }
            return match sequence_len(bytes, start) {
                4 if is_utf16 && back == 4 => (low_half(code_point_at(bytes, start, 4)), 2),
                4 if is_utf16 && back == 2 => (high_half(code_point_at(bytes, start, 4)), 2),
                len if len == back => (self.fold(code_point_at(bytes, start, len)), len),
                _ => (REPLACEMENT, 1),
            };
        }
        (REPLACEMENT, 1)
    }

    /// How many units `bytes` are.
    pub(crate) fn count_units(self, bytes: &[u8]) -> usize {
        if bytes.is_ascii() {
            return bytes.len();
        }
        let (mut at, mut count) = (0, 0);
        while let Some((_, len)) = self.next(Subject::of(bytes), at) {
            at += len;
            count += 1;
        }
        count
    }
}

/// `c` in UTF-8. A half of a pair is written as if it were a character.
pub(crate) fn push_utf8(out: &mut Vec<u8>, c: u32) {
    let continuation = |shift: u32| 0x80 | ((c >> shift) & 0x3F) as u8;
    match c {
        0..0x80 => out.push(c as u8),
        0x80..0x800 => out.extend_from_slice(&[0xC0 | (c >> 6) as u8, continuation(0)]),
        0x800..0x10000 => {
            out.extend_from_slice(&[0xE0 | (c >> 12) as u8, continuation(6), continuation(0)]);
        }
        _ => out.extend_from_slice(&[
            0xF0 | (c >> 18) as u8,
            continuation(12),
            continuation(6),
            continuation(0),
        ]),
    }
}
