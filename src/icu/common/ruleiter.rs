//! A cursor over a `UnicodeSet` pattern. ICU4C: ruleiter.cpp

use crate::common::patternprops;
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;

#[derive(Clone, Copy)]
pub(crate) struct RuleCharacterIterator<'a> {
    pub(crate) text: &'a [u16],
    pub(crate) pos: usize,
}

impl<'a> RuleCharacterIterator<'a> {
    pub(crate) fn consumed_since(&self, start: usize) -> &'a [u16] {
        self.text.slice(start..self.pos)
    }

    pub(crate) fn next(&mut self) -> Option<u32> {
        (self.pos < self.text.len()).then(|| utf16::next(self.text, &mut self.pos))
    }

    /// Like `next`, but also returns `None` for an unpaired surrogate, which is consumed.
    pub(crate) fn next_char(&mut self) -> Option<char> {
        self.next().and_then(char::from_u32)
    }

    /// Parses the escape after a backslash.
    pub(crate) fn next_escape(&mut self) -> Option<u32> {
        const MAX_U_NOTATION_LEN: usize = 12;
        let window = self.text.get(..self.pos + MAX_U_NOTATION_LEN);
        unescape_at(window.unwrap_or(self.text), &mut self.pos)
    }

    /// Returns whether the skipped white space separates lexical elements. U+200E and U+200F do not.
    pub(crate) fn skip_white_space(&mut self) -> bool {
        let start = self.pos;
        self.pos = patternprops::skip_white_space(self.text, start);
        self.consumed_since(start)
            .iter()
            .any(|&c| !matches!(c, 0x200e | 0x200f))
    }
}

// ICU4C: ustring.cpp, u_unescapeAt
fn unescape_at(s: &[u16], offset: &mut usize) -> Option<u32> {
    let is_at = |offset: usize, c: u8| s.get(offset) == Some(&c.into());
    let (mut radix, mut braces) = (16, false);
    let (min_digits, max_digits) = match u8::try_from(*s.get(*offset)?) {
        Ok(b'u') => (4, 4),
        Ok(b'U') => (8, 8),
        Ok(b'x') if is_at(*offset + 1, b'{') => {
            braces = true;
            (1, 7)
        }
        Ok(b'x') => (1, 2),
        Ok(b'0'..=b'7') => {
            radix = 8;
            (1, 3)
        }
        _ => return Some(unescape_non_numeric(s, offset)),
    };
    *offset += usize::from(radix == 16) + usize::from(braces);
    let (mut result, mut digits) = (0, 0);
    while digits < max_digits
        && let Some(c) = s.get(*offset).and_then(|&c| char::from_u32(c.into()))
        && let Some(digit) = c.to_digit(radix)
    {
        result = result * radix + digit;
        *offset += 1;
        digits += 1;
    }
    if digits < min_digits || (braces && !is_at(*offset, b'}')) || result > 0x10_ffff {
        return None;
    }
    *offset += usize::from(braces);
    if utf16::is_lead(result)
        && let Some(&next) = s.get(*offset)
    {
        let mut ahead = *offset + 1;
        let trail = if is_at(*offset, b'\\') {
            unescape_at(s, &mut ahead).unwrap_or(0)
        } else {
            next.into()
        };
        if utf16::is_trail(trail) {
            *offset = ahead;
            result = utf16::get_supplementary(result, trail);
        }
    }
    Some(result)
}

/// Parses a C-style escape, `\cX` or an escaped literal.
fn unescape_non_numeric(s: &[u16], offset: &mut usize) -> u32 {
    let c = utf16::next(s, offset);
    match char::from_u32(c) {
        Some('a') => 0x07,
        Some('b') => 0x08,
        Some('c') if *offset < s.len() => utf16::next(s, offset) & 0x1f,
        Some('e') => 0x1b,
        Some('f') => 0x0c,
        Some('n') => 0x0a,
        Some('r') => 0x0d,
        Some('t') => 0x09,
        Some('v') => 0x0b,
        _ => c,
    }
}
