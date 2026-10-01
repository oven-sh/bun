//! Lines and characters of a position: `internal/scanner/scanner.go` and the line starts of `internal/core/core.go` of typescript-go.

use bun_core::strings;

/// `utf8.DecodeRuneInString` of Go: where no valid sequence starts, the result is U+FFFD and the length 1 (0 for no text).
pub(crate) fn decode_rune_in_string(s: &[u8]) -> (char, usize) {
    const RUNE_ERROR: (char, usize) = (char::REPLACEMENT_CHARACTER, 1);
    let Some((&s0, rest)) = s.split_first() else {
        return (char::REPLACEMENT_CHARACTER, 0);
    };
    // The range of the second byte leaves out overlong forms, surrogates and what lies above U+10FFFF.
    let (size, lo, hi, bits) = match s0 {
        0x00..=0x7F => return (char::from(s0), 1),
        0xC2..=0xDF => (2, 0x80, 0xBF, s0 & 0x1F),
        0xE0 => (3, 0xA0, 0xBF, s0 & 0x0F),
        0xE1..=0xEC | 0xEE..=0xEF => (3, 0x80, 0xBF, s0 & 0x0F),
        0xED => (3, 0x80, 0x9F, s0 & 0x0F),
        0xF0 => (4, 0x90, 0xBF, s0 & 0x07),
        0xF1..=0xF3 => (4, 0x80, 0xBF, s0 & 0x07),
        0xF4 => (4, 0x80, 0x8F, s0 & 0x07),
        _ => return RUNE_ERROR,
    };
    let Some(continuation) = rest.get(..size - 1) else {
        return RUNE_ERROR;
    };
    let mut code_point = u32::from(bits);
    for (i, &b) in continuation.iter().enumerate() {
        let (lo, hi) = if i == 0 { (lo, hi) } else { (0x80, 0xBF) };
        if b < lo || b > hi {
            return RUNE_ERROR;
        }
        code_point = (code_point << 6) | u32::from(b & 0x3F);
    }
    char::from_u32(code_point).map_or(RUNE_ERROR, |ch| (ch, size))
}

/// `IsLineBreak` of `internal/stringutil/util.go`: the line terminators of ECMAScript.
fn is_line_break(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `ComputeECMALineStarts`: the start of each line; a line ends after LF, CR, CR LF, U+2028 or U+2029.
pub fn compute_ecma_line_starts(text: &[u8]) -> Vec<u32> {
    // A position is a `u32`: what lies behind that range is not mapped.
    let text = text.get(..u32::MAX as usize).unwrap_or(text);
    let text_pos = |pos: usize| u32::try_from(pos).unwrap_or(u32::MAX);
    let mut result: Vec<u32> = Vec::with_capacity(strings::count_char(text, b'\n') + 1);
    let mut pos: usize = 0;
    let mut line_start: u32 = 0;
    while let Some(&b) = text.get(pos) {
        if b.is_ascii() {
            pos += 1;
            match b {
                b'\r' => {
                    if text.get(pos) == Some(&b'\n') {
                        pos += 1;
                    }
                    result.push(line_start);
                    line_start = text_pos(pos);
                }
                b'\n' => {
                    result.push(line_start);
                    line_start = text_pos(pos);
                }
                _ => {}
            }
        } else {
            let (ch, size) = decode_rune_in_string(text.get(pos..).unwrap_or_default());
            pos += size;
            if is_line_break(ch) {
                result.push(line_start);
                line_start = text_pos(pos);
            }
        }
    }
    result.push(line_start);
    result
}

/// `UTF16Len`: the number of UTF-16 code units of UTF-8 text; each byte that is not part of valid UTF-8 counts as one.
pub fn utf16_len(s: &[u8]) -> usize {
    // Fast path: for ASCII-only text each byte is one UTF-16 code unit.
    if s.is_ascii() {
        return s.len();
    }
    let mut n = 0;
    let mut rest = s;
    while !rest.is_empty() {
        let (r, size) = decode_rune_in_string(rest);
        n += r.len_utf16();
        rest = rest.get(size..).unwrap_or_default();
    }
    n
}

/// `ComputeLineOfPosition`: the 0-based line whose start is the last one at or before `pos`.
pub fn compute_line_of_position(line_starts: &[u32], pos: u32) -> usize {
    match line_starts.binary_search(&pos) {
        Ok(line) => line,
        // Line 0 where the reference has -1, for a position in front of the first start.
        Err(next_line) => next_line.saturating_sub(1),
    }
}

/// `GetECMALineAndUTF16CharacterOfPosition`: the 0-based line and the 0-based character, in UTF-16 code units, of a byte position.
pub fn get_ecma_line_and_utf16_character_of_position(
    text: &[u8],
    line_starts: &[u32],
    pos: u32,
) -> (usize, usize) {
    // Where the reference panics on a position outside the text, this takes the end of the text.
    let pos = (pos as usize).min(text.len());
    let line = compute_line_of_position(line_starts, u32::try_from(pos).unwrap_or(u32::MAX));
    let line_start = line_starts.get(line).map_or(0, |&start| start as usize);
    let character = text.get(line_start..pos).map_or(0, utf16_len);
    (line, character)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_byte_that_starts_no_valid_sequence_decodes_as_one_replacement_character() {
        assert_eq!(decode_rune_in_string(b""), ('\u{FFFD}', 0));
        assert_eq!(decode_rune_in_string(b"ab"), ('a', 1));
        assert_eq!(decode_rune_in_string("\u{e9}b".as_bytes()), ('\u{e9}', 2));
        assert_eq!(
            decode_rune_in_string("\u{2028}b".as_bytes()),
            ('\u{2028}', 3)
        );
        assert_eq!(
            decode_rune_in_string("\u{1F600}b".as_bytes()),
            ('\u{1F600}', 4)
        );
        // A continuation byte, two overlong forms, a surrogate, a code point above U+10FFFF, a sequence that ends early.
        let invalid: [&[u8]; 7] = [
            b"\x80",
            b"\xC0\x80",
            b"\xE0\x80\xA8",
            b"\xED\xA0\x80",
            b"\xF4\x90\x80\x80",
            b"\xF0\x9F\x98",
            b"\xFF",
        ];
        for bytes in invalid {
            assert_eq!(decode_rune_in_string(bytes), ('\u{FFFD}', 1), "{bytes:x?}");
        }
    }

    #[test]
    fn lines_and_characters_of_text_that_is_not_valid_utf8_are_those_of_the_reference() {
        // U+2028 after a byte that starts no sequence ends a line; U+0085 and U+000B end none.
        let text = b"a\xF0\xE2\x80\xA8b\xC2\x85c\x0Bd\r\ne\rf\xE2\x80\xA9";
        let starts = compute_ecma_line_starts(text);
        assert_eq!(starts, vec![0, 5, 13, 15, 19]);
        let at = |pos: u32| get_ecma_line_and_utf16_character_of_position(text, &starts, pos);
        assert_eq!(at(4), (0, 4));
        assert_eq!(at(8), (1, 2));
        assert_eq!(at(12), (1, 6));
        assert_eq!(at(14), (2, 1));
        assert_eq!(at(19), (4, 0));

        // A position inside a sequence counts each of its bytes so far as one character.
        let text = b"a\xF0\x9F\x98\x80\xF0\x9Fb\xE2\x80\xA8c\xC3\xA9\xFFd";
        let starts = compute_ecma_line_starts(text);
        assert_eq!(starts, vec![0, 11]);
        let at = |pos: u32| get_ecma_line_and_utf16_character_of_position(text, &starts, pos);
        assert_eq!(at(3), (0, 3));
        assert_eq!(at(5), (0, 3));
        assert_eq!(at(7), (0, 5));
        assert_eq!(at(10), (0, 8));
        assert_eq!(at(14), (1, 2));
        assert_eq!(at(16), (1, 4));

        assert_eq!(
            compute_ecma_line_starts(b"\r\n\r\r\n\n"),
            vec![0, 2, 3, 5, 6]
        );
        assert_eq!(compute_ecma_line_starts(b"\xE2\x80"), vec![0]);
    }
}
