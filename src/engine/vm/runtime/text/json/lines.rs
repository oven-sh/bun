//! A value on each line, in a text that may break off anywhere.

use bun_alloc::AllocError;
use bun_engine_text::{CodeUnit, Text, scan};
use smallvec::SmallVec;

use super::parser::Parser;
use super::{Failure, Source, with_units};
use crate::{Cx, JsResult, ValueVec};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum LinesEnd {
    Complete,
    NeedsMoreText,
    SyntaxError,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ParsedLines {
    /// The units up to the end of the last value. An invalid sequence of UTF-8 counts as the three bytes of U+FFFD.
    pub read: usize,
    pub end: LinesEnd,
}

/// Appends the values up to the first one that is incomplete or has an error.
pub fn parse_lines(cx: &Cx, text: Text<'_>, values: &mut ValueVec) -> JsResult<ParsedLines> {
    Ok(parse_source(cx, text.into(), values)?.0)
}

/// The same for UTF-8, of which it parses copies of a few lines at a time.
pub fn parse_utf8_lines(cx: &Cx, bytes: &[u8], values: &mut ValueVec) -> JsResult<ParsedLines> {
    const FIRST_WINDOW: usize = 4096;
    const USUAL_WINDOW: usize = 16 * FIRST_WINDOW;
    let is_ascii = Text::Latin1(bytes).is_ascii();
    let mut window = SmallVec::<[u8; FIRST_WINDOW]>::new();
    let (mut rest, mut size, mut before, mut read) = (bytes, FIRST_WINDOW, 0, 0);
    loop {
        let (taken, is_last) = (size.min(rest.len()), size >= rest.len());
        window.clear();
        cx.or_out_of_memory(window.try_reserve_exact(taken).map_err(|_| AllocError))?;
        window.extend_from_slice(&rest[..taken]);
        let lines = match Text::Latin1(&window).rfind_unit(b'\n'.into(), taken) {
            _ if is_last => &window[..],
            last => &window[..last.map_or(0, |at| at + 1)],
        };
        let source = match is_ascii {
            true => Text::Latin1(lines).into(),
            false => Source::Utf8(lines),
        };
        let (parsed, has_invalid_bytes) = parse_source(cx, source, values)?;
        let repaired = match has_invalid_bytes {
            true => length_when_repaired(&lines[..parsed.read]),
            false => parsed.read,
        };
        if parsed.read != 0 {
            read = before + repaired;
        }
        if is_last || parsed.end == LinesEnd::SyntaxError {
            let end = parsed.end;
            return Ok(ParsedLines { read, end });
        }
        let blank = match parsed.end {
            LinesEnd::Complete => lines.len() - parsed.read,
            _ => 0,
        };
        before += repaired + blank;
        rest = &rest[parsed.read + blank..];
        // A value that takes more than half of the window is not gone through again in one of the same size.
        if size < USUAL_WINDOW || parsed.read + blank < taken / 2 {
            size *= 2;
        }
        if lines.is_empty() {
            let end = Text::Latin1(rest).find_unit(b'\n'.into(), taken);
            size = size.max(end.map_or(rest.len(), |at| at + 1));
        }
    }
}

/// `read` counts the units of the source. With whether it has invalid sequences of UTF-8.
fn parse_source(
    cx: &Cx,
    source: Source<'_>,
    values: &mut ValueVec,
) -> JsResult<(ParsedLines, bool)> {
    with_units!(source, |units, _| parse_units(cx, units, source, values))
        .map_err(|failure| failure.throw(cx, source))
}

/// Whether the text breaks off between the digits before `at` and those of an exponent.
fn lacks_only_exponent<T: CodeUnit>(units: &[T], at: usize) -> bool {
    let (before, rest) = units.split_at(at);
    let letter = match rest {
        [letter] => letter,
        [letter, sign] if sign.is(b'+') || sign.is(b'-') => letter,
        _ => return false,
    };
    letter.to_ascii_lower().is(b'e') && before.last().is_some_and(|unit| unit.is_ascii_digit())
}

fn length_when_repaired(bytes: &[u8]) -> usize {
    let replacement = char::REPLACEMENT_CHARACTER.len_utf8();
    let length = |chunk: core::str::Utf8Chunk<'_>| {
        chunk.valid().len() + usize::from(!chunk.invalid().is_empty()) * replacement
    };
    bytes.utf8_chunks().map(length).sum()
}

fn parse_units<T: CodeUnit>(
    cx: &Cx,
    units: &[T],
    source: Source<'_>,
    values: &mut ValueVec,
) -> Result<(ParsedLines, bool), Failure> {
    Parser::run(cx, source, (), |parser, tables, mut cursor| {
        let mut read = 0;
        let end = loop {
            if parser.skip_white_space(&mut cursor) == units.len() {
                break LinesEnd::Complete;
            }
            let value;
            (cursor, value) = match parser.value(tables, cursor) {
                Ok(read) => read,
                Err(Failure::Syntax(error)) => {
                    let is_incomplete =
                        lacks_only_exponent(units, error.at) || error.is_at_end(source)?;
                    break if is_incomplete {
                        LinesEnd::NeedsMoreText
                    } else {
                        LinesEnd::SyntaxError
                    };
                }
                Err(failure) => return Err(failure),
            };
            let after = parser.position(&cursor);
            if lacks_only_exponent(units, after) {
                break LinesEnd::NeedsMoreText;
            }
            values.try_push(value)?;
            read = after;
            let blank = |unit: u16| unit.is(b' ') | unit.is(b'\t') | unit.is(b'\r');
            let rest = &units[after..];
            let next = rest.get(scan::run_len(rest, blank));
            if next.is_some_and(|unit| !unit.is(b'\n')) {
                break LinesEnd::SyntaxError;
            }
        };
        Ok((ParsedLines { read, end }, parser.has_invalid_bytes))
    })
}
