//! The primitives that take more than a few instructions.

use bun_engine_number::{
    JsonNumber, parse_few_json_digits, parse_few_json_places, parse_json_double, parse_json_number,
};
use bun_engine_text::{CodeUnit, StringBuilder, Text, scan, unescape_json};

use super::reader::{Cursor, WINDOW};
use super::strings::{SHORT, ShortText};
use super::{Parser, Tables};
use crate::json::records::Recorder;
use crate::json::syntax_error::Expected;
use crate::json::{Source, with_units};
use crate::{JsString, Value};

const BYTES_ON_STACK: usize = 512;

/// What a string literal stands for.
enum Characters<'a> {
    Plain(Text<'a>),
    Decoded(&'a mut StringBuilder),
}

impl<'a, R: Recorder> Parser<'a, R> {
    #[inline(never)]
    pub(super) extern "rust-cold" fn any_primitive(
        &mut self,
        tables: &mut Tables,
        mut cursor: Cursor<'a>,
    ) -> (Cursor<'a>, Option<Value>) {
        let (value, length) = match self.reader.window(&mut cursor) {
            [b'"', ..] => return self.any_string(tables, cursor),
            [b'-' | b'0'..=b'9', ..] => return self.any_number(cursor),
            [b't', b'r', b'u', b'e', ..] => (Value::TRUE, 4),
            [b'f', b'a', b'l', b's', b'e', ..] => (Value::FALSE, 5),
            [b'n', b'u', b'l', b'l', ..] => (Value::NULL, 4),
            _ => {
                let nothing = self.unexpected(&cursor, Expected::Value);
                return (cursor, nothing);
            }
        };
        cursor.advance(length);
        (cursor, Some(value))
    }

    #[inline(never)]
    pub(super) extern "rust-cold" fn any_number(
        &mut self,
        mut cursor: Cursor<'a>,
    ) -> (Cursor<'a>, Option<Value>) {
        let (number, length) = parse_json_double(self.reader.window(&mut cursor));
        // What follows has been seen as far as it matters.
        if !(1..=WINDOW - "e+1".len()).contains(&length) {
            return self.long_number(cursor);
        }
        cursor.advance(length as u32);
        (cursor, Some(number.into()))
    }

    #[inline(never)]
    pub(super) extern "rust-cold" fn negative_number(
        &mut self,
        mut cursor: Cursor<'a>,
    ) -> (Cursor<'a>, Option<Value>) {
        let window = self.reader.window(&mut cursor);
        let eight = |at: u32| {
            *window[at as usize..]
                .first_chunk()
                .expect("inside the window")
        };
        let goes_on = |at: u32| window[at as usize] | 0x20 == b'e';
        if window[1].is_ascii_digit()
            && let Some((whole, count)) = parse_few_json_digits(eight(1))
        {
            let point = 1 + count;
            if window[point as usize] != b'.' {
                if whole != 0 && !goes_on(point) {
                    cursor.advance(point);
                    return (cursor, Some(Value::int32(-whole)));
                }
            } else if let Some((number, count)) = parse_few_json_places(whole, eight(point + 1))
                && !goes_on(point + 1 + count)
            {
                cursor.advance(point + 1 + count);
                return (cursor, Some((-number).into()));
            }
        }
        self.any_number(cursor)
    }

    #[cold]
    #[inline(never)]
    fn long_number(&mut self, mut cursor: Cursor<'a>) -> (Cursor<'a>, Option<Value>) {
        let position = self.position(&cursor);
        let number = with_units!(self.reader.source(), |units, _| {
            let rest = &units[position..];
            parse_json_number(rest).map(|(number, length)| {
                self.reader.skip(&mut cursor, rest, length);
                number
            })
        });
        let value = match number {
            Ok(JsonNumber::Int32(number)) => Some(number.into()),
            Ok(JsonNumber::Double(number)) => Some(number.into()),
            Err(_) => self.unexpected(&cursor, Expected::Value),
        };
        (cursor, value)
    }

    #[inline(never)]
    pub(super) extern "rust-cold" fn new_short_string(
        &mut self,
        tables: &mut Tables,
        text: ShortText,
    ) -> Option<Value> {
        let string = tables.strings.add_short(self.cx, text);
        self.or_out_of_memory(string).map(Into::into)
    }

    #[inline(never)]
    pub(super) extern "rust-cold" fn any_string(
        &mut self,
        tables: &mut Tables,
        mut cursor: Cursor<'a>,
    ) -> (Cursor<'a>, Option<Value>) {
        let (cx, is_wide) = (self.cx, !self.reader.source().is_latin1());
        let string = self.read_string(&mut cursor, is_wide, |characters| match characters {
            Characters::Plain(text) => tables.strings.any(cx, text, is_wide),
            Characters::Decoded(it) if it.len() <= BYTES_ON_STACK / 2 => {
                tables.strings.any(cx, it.text(), !it.is_latin1())
            }
            Characters::Decoded(it) => it.take().map(|string| JsString::new(cx, string)),
        });
        let value = string.and_then(|string| self.or_out_of_memory(string));
        (cursor, value.map(Into::into))
    }

    /// Reads the string literal at the cursor, and lends its characters.
    #[inline(always)]
    pub(super) fn with_characters<T>(
        &mut self,
        cursor: &mut Cursor<'a>,
        read: impl FnOnce(Text<'_>) -> T,
    ) -> Option<T> {
        self.read_string(cursor, false, |characters| match characters {
            Characters::Plain(text) => read(text),
            Characters::Decoded(it) => read(it.text()),
        })
    }

    /// If `runs_widen`, two units in a row that are no escapes make what is decoded UTF-16, unless it is short.
    #[inline(always)]
    fn read_string<T>(
        &mut self,
        cursor: &mut Cursor<'a>,
        runs_widen: bool,
        read: impl FnOnce(Characters<'_>) -> T,
    ) -> Option<T> {
        let position = self.position(cursor);
        with_units!(self.reader.source(), |units, is_utf8| {
            let rest = &units[position..];
            let end = 1 + scan::json_string_run_len(&rest[1..]);
            let run = CodeUnit::text(&rest[1..end]);
            if rest.get(end).is_some_and(|unit| unit.is(b'"')) && (!is_utf8 || run.is_ascii()) {
                self.reader.skip(cursor, rest, end + 1);
                return Some(read(Characters::Plain(run)));
            }
            let Some((result, length)) = self.decode(rest, end, is_utf8, runs_widen, read) else {
                return self
                    .failure
                    .is_none()
                    .then(|| self.unexpected(cursor, Expected::Value))?;
            };
            self.reader.skip(cursor, rest, length);
            Some(result)
        })
    }

    /// `end` is that of the first run of units that are not special. Returns the length of the literal too.
    #[inline(never)]
    fn decode<T, U: CodeUnit>(
        &mut self,
        rest: &[U],
        mut end: usize,
        is_utf8: bool,
        runs_widen: bool,
        read: impl FnOnce(Characters<'_>) -> T,
    ) -> Option<(T, usize)> {
        StringBuilder::on_stack::<BYTES_ON_STACK, _>(|characters| {
            let (mut start, mut has_run) = (1, false);
            let limit = if is_utf8 { 0x7f } else { u16::MAX };
            loop {
                let (run, before) = (&rest[start..end], characters.len());
                if runs_widen && run.len() > SHORT {
                    characters.widen(0);
                }
                match U::text(run) {
                    Text::Latin1(bytes) if is_utf8 => {
                        if !characters.push_utf8(bytes) {
                            self.has_invalid_bytes = true;
                            characters.truncate(before);
                            characters.push_utf8_lossy(bytes);
                        }
                    }
                    text => characters.push_text(text),
                }
                has_run |= characters.len() > before + 1;
                let (unit, length) = match &rest[end..] {
                    [quote, ..] if quote.is(b'"') => break,
                    [backslash, escape @ ..] if backslash.is(b'\\') => unescape_json(escape)?,
                    _ => return None,
                };
                characters.push_unit(unit);
                start = end + 1 + length;
                // Else the runs have to be told apart, to decide on the width.
                if !runs_widen || has_run || !characters.is_latin1() {
                    start += characters.push_json_unescaped(&rest[start..], limit);
                }
                end = start + scan::json_string_run_len(&rest[start..]);
            }
            if runs_widen && has_run && characters.len() > SHORT {
                characters.widen(0);
            }
            if characters.has_overflowed() {
                return self.out_of_memory();
            }
            Some((read(Characters::Decoded(characters)), end + 1))
        })
    }
}
