//! Research prototype of "rules-regex" (top-down pass): what the five regex rules need beside the port of regexpp, on the bytes
//! of a file. `char_source` is src/lint/char_source.rs as it is to be written (ported from ESLint lib/rules/utils/char-source.js),
//! `spaces` is the scan of no-regex-spaces, `escapes` the scan of no-useless-escape over a string or a template element.
//! rustc --edition 2024 -O support.rs -o /tmp/rxr/support && node support-vectors.cjs 200000 1 | /tmp/rxr/support
#![deny(warnings, dead_code, unused_variables, unused_mut)]

/// `scanner::decode_rune_in_string` of src/lint/scanner.rs, shortened: the character at the head of `s` and its length; U+FFFD and 1 where no sequence starts.
fn decode_rune_in_string(s: &[u8]) -> (char, usize) {
    let Some(&first) = s.first() else {
        return (char::REPLACEMENT_CHARACTER, 0);
    };
    let size = match first {
        0x00..=0x7F => return (char::from(first), 1),
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => return (char::REPLACEMENT_CHARACTER, 1),
    };
    s.get(..size)
        .and_then(|bytes| core::str::from_utf8(bytes).ok())
        .and_then(|text| text.chars().next())
        .map_or((char::REPLACEMENT_CHARACTER, 1), |ch| (ch, size))
}

mod char_source {
    //! Ported from ESLint lib/rules/utils/char-source.js.
    use super::decode_rune_in_string;

    /// Where one UTF-16 code unit of the value of a string literal or of a template token is written.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct CodeUnit {
        /// Offset of its source from the opening quote, in bytes. The second half of a character outside the BMP has the start of the character.
        pub(crate) start: u32,
        /// Length of its source in bytes: the character, or the whole escape sequence.
        pub(crate) length: u32,
    }

    /// An object used to keep track of the position in a source text where the next characters will be read.
    struct TextReader<'a> {
        source: &'a [u8],
        pos: usize,
    }

    impl TextReader<'_> {
        /// The character at `pos` and its length in bytes; `None` at the end.
        fn read(&self) -> Option<(char, usize)> {
            match decode_rune_in_string(self.source.get(self.pos..).unwrap_or(&[])) {
                (_, 0) => None,
                read => Some(read),
            }
        }

        /// Advances by `count` characters, fewer at the end.
        fn advance_chars(&mut self, count: usize) {
            for _ in 0..count {
                match self.read() {
                    Some((_, length)) => self.pos += length,
                    None => return,
                }
            }
        }
    }

    fn offset(pos: usize) -> u32 {
        u32::try_from(pos).unwrap_or(u32::MAX)
    }

    /// Reads a Unicode escape sequence: the reader is after the `u`. How many code units it gives.
    fn read_unicode_sequence(reader: &mut TextReader<'_>) -> usize {
        let rest = reader.source.get(reader.pos..).unwrap_or(&[]);
        if rest.first() == Some(&b'{') {
            let digits = rest.get(1..).unwrap_or(&[]);
            let count = digits.iter().take_while(|byte| byte.is_ascii_hexdigit()).count();
            if count > 0 && digits.get(count) == Some(&b'}') {
                let mut code_point: u32 = 0;
                for &digit in digits.get(..count).unwrap_or(&[]) {
                    code_point = code_point.saturating_mul(16).saturating_add(char::from(digit).to_digit(16).unwrap_or(0));
                }
                reader.pos += count + 2;
                return if code_point > 0xFFFF { 2 } else { 1 };
            }
        }
        reader.advance_chars(4);
        1
    }

    /// Reads an octal escape sequence: the reader is after the first octal digit.
    fn read_octal_sequence(reader: &mut TextReader<'_>, max_length: usize) {
        let more = reader
            .source
            .get(reader.pos..)
            .unwrap_or(&[])
            .iter()
            .take(max_length - 1)
            .take_while(|byte| matches!(byte, b'0'..=b'7'))
            .count();
        reader.pos += more;
    }

    /// Reads an escape sequence or line continuation: the reader is on the backslash. How many code units it gives; a second unit that is the second half of the character after the backslash is left to the caller.
    fn read_escape_sequence_or_line_continuation(reader: &mut TextReader<'_>) -> (usize, Option<CodeUnit>) {
        reader.pos += 1;
        let Some((ch, length)) = reader.read() else {
            return (1, None);
        };
        reader.pos += length;
        match ch {
            'b' | 'f' | 'n' | 'r' | 't' | 'v' => (1, None),
            'x' => {
                reader.advance_chars(2);
                (1, None)
            }
            'u' => (read_unicode_sequence(reader), None),
            '\r' => {
                if reader.source.get(reader.pos) == Some(&b'\n') {
                    reader.pos += 1;
                }
                (0, None)
            }
            '\n' | '\u{2028}' | '\u{2029}' => (0, None),
            '0'..='3' => {
                read_octal_sequence(reader, 3);
                (1, None)
            }
            '4'..='7' => {
                read_octal_sequence(reader, 2);
                (1, None)
            }
            // The value is the first code unit of the character: the second half of one outside the BMP is read as a character of its own.
            _ if length == 4 => (
                1,
                Some(CodeUnit {
                    start: offset(reader.pos - length),
                    length: 4,
                }),
            ),
            _ => (1, None),
        }
    }

    /// Reads an escape sequence or line continuation and generates the respective `CodeUnit` elements.
    fn map_escape_sequence_or_line_continuation(reader: &mut TextReader<'_>, code_units: &mut Vec<CodeUnit>) {
        let start = reader.pos;
        let (count, half) = read_escape_sequence_or_line_continuation(reader);
        let unit = CodeUnit {
            start: offset(start),
            length: offset(reader.pos - start),
        };
        for _ in 0..count {
            code_units.push(unit);
        }
        code_units.extend(half);
    }

    /// One character that is no escape: one code unit, or two that share the character.
    fn push_character(reader: &mut TextReader<'_>, length: usize, code_units: &mut Vec<CodeUnit>) {
        let unit = CodeUnit {
            start: offset(reader.pos),
            length: offset(length),
        };
        code_units.push(unit);
        if length == 4 {
            code_units.push(unit);
        }
        reader.pos += length;
    }

    /// Parses a string literal: `source` starts at its opening quote. The code units that the literal gives.
    pub(crate) fn parse_string_literal(source: &[u8]) -> Vec<CodeUnit> {
        let mut reader = TextReader { source, pos: 0 };
        let Some((quote, length)) = reader.read() else {
            return Vec::new();
        };
        reader.pos += length;
        let mut code_units = Vec::new();
        while let Some((ch, length)) = reader.read() {
            if ch == quote {
                break;
            }
            if ch == '\\' {
                map_escape_sequence_or_line_continuation(&mut reader, &mut code_units);
            } else {
                push_character(&mut reader, length, &mut code_units);
            }
        }
        code_units
    }

    /// Parses a template token: `source` starts at its `` ` `` or its `}`. The code units that the token gives.
    pub(crate) fn parse_template_token(source: &[u8]) -> Vec<CodeUnit> {
        let mut reader = TextReader { source, pos: 1 };
        let mut code_units = Vec::new();
        while let Some((ch, length)) = reader.read() {
            if ch == '`' || (ch == '$' && source.get(reader.pos + 1) == Some(&b'{')) {
                break;
            }
            if ch == '\\' {
                map_escape_sequence_or_line_continuation(&mut reader, &mut code_units);
            } else if ch == '\r' && source.get(reader.pos + 1) == Some(&b'\n') {
                push_character(&mut reader, 2, &mut code_units);
            } else {
                push_character(&mut reader, length, &mut code_units);
            }
        }
        code_units
    }
}

/// no-regex-spaces, `/( {2,})(?: [+*{?]|[^+*{?]|$)/gu` over a pattern: each match as where its spaces start and how many the group holds.
fn spaces(units: &[u16]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(&unit) = units.get(i) {
        if unit != 0x20 {
            i += 1;
            continue;
        }
        let run = units.get(i..).unwrap_or(&[]).iter().take_while(|&&unit| unit == 0x20).count();
        let end = i + run;
        if run < 2 {
            i = end;
            continue;
        }
        match units.get(end) {
            None => {
                out.push((i, run));
                break;
            }
            // The last space is what the quantifier repeats: two more before it are a match.
            Some(0x2B | 0x2A | 0x7B | 0x3F) => {
                if run >= 3 {
                    out.push((i, run - 1));
                }
                i = end + 1;
            }
            Some(&next) => {
                out.push((i, run));
                // The character after the spaces is part of the match, a surrogate pair as one.
                let pair = (0xD800..=0xDBFF).contains(&next) && units.get(end + 1).is_some_and(|low| (0xDC00..=0xDFFF).contains(low));
                i = end + if pair { 2 } else { 1 };
            }
        }
    }
    out
}

/// no-useless-escape, `/\\\D/gu` over the text of a string literal or of a template element: each backslash that no digit follows, as its offset and the character after it.
fn escapes(text: &[u8]) -> Vec<(usize, char)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(&byte) = text.get(i) {
        if byte != b'\\' {
            i += 1;
            continue;
        }
        let (ch, length) = decode_rune_in_string(text.get(i + 1..).unwrap_or(&[]));
        if length == 0 {
            break;
        }
        if ch.is_ascii_digit() {
            i += 1;
            continue;
        }
        out.push((i, ch));
        i += 1 + length;
    }
    out
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len() / 2).filter_map(|i| text.get(2 * i..2 * i + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok())).collect()
}

fn main() {
    use std::io::BufRead;
    let (mut lines, mut wrong) = (0u32, 0u32);
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let mut fields = line.split(' ');
        let (Some(kind), Some(source), Some(expected)) = (fields.next(), fields.next(), fields.next()) else { continue };
        let source = unhex(source);
        let got = match kind {
            "S" | "T" => {
                let units = if kind == "S" { char_source::parse_string_literal(&source) } else { char_source::parse_template_token(&source) };
                units.iter().map(|unit| format!("{}:{}", unit.start, unit.length)).collect::<Vec<_>>().join(",")
            }
            "P" => {
                let units: Vec<u16> = source.chunks(2).map(|pair| u16::from_be_bytes([pair[0], *pair.get(1).unwrap_or(&0)])).collect();
                spaces(&units).iter().map(|(at, count)| format!("{at}:{count}")).collect::<Vec<_>>().join(",")
            }
            _ => escapes(&source).iter().map(|(at, ch)| format!("{at}:{:x}", u32::from(*ch))).collect::<Vec<_>>().join(","),
        };
        lines += 1;
        if got != expected.trim_end_matches('-') && !(got.is_empty() && expected == "-") {
            wrong += 1;
            if wrong <= 10 {
                println!("{kind} {source:x?}\n  expected {expected}\n  got      {got}");
            }
        }
    }
    println!("{lines} vectors, {wrong} wrong");
}
