//! What has no members. Unless a function can fail, the caller has made sure of `VALUE_ROOM`.

use core::hint::cold_path;

use bun_engine_date::{MAX_ISO_STRING_LENGTH, write_iso_string};
use bun_engine_number::{NUMBER_TEXT_CAPACITY, write_f64};
use bun_engine_text::{CodeUnit, Cursor, PropertyName, Text, has_nothing_to_escape_in_json};

use crate::{DateInstance, Gc, JsCell, JsString, NoGc, Value};

pub(super) const VALUE_ROOM: usize = NUMBER_TEXT_CAPACITY;

pub(super) enum Kind {
    Integer(i32),
    Double(f64),
    Cell(Gc<JsCell>),
    Other(Option<Value>),
}

impl Kind {
    /// Without a constant that takes a register.
    #[inline(always)]
    pub(super) fn of(slot: Option<Value>) -> Kind {
        const SHIFT: u32 = Value::DOUBLE_OFFSET.trailing_zeros();
        let bits = Value::bits_of(slot);
        match bits >> SHIFT {
            0 if bits <= Value::UNDEFINED.to_bits() => Kind::Other(slot),
            // SAFETY: what is no number and above the constants is a cell.
            0 => Kind::Cell(unsafe { Gc::from_address(bits as usize) }),
            tag if tag == Value::NUMBER_TAG >> SHIFT => Kind::Integer(bits as i32),
            _ => Kind::Double(f64::from_bits(bits - Value::DOUBLE_OFFSET)),
        }
    }
}

#[inline(always)]
pub(super) fn push_literal<T: CodeUnit>(value: Value, to: &mut Cursor<'_, T>) {
    /// By the bits of the value, with the length at the end.
    static WORDS: [[u8; 8]; 16] = {
        let mut words = [*b"null\0\0\0\x04"; 16];
        words[Value::TRUE.to_bits() as usize] = *b"true\0\0\0\x04";
        words[Value::FALSE.to_bits() as usize] = *b"false\0\0\x05";
        words
    };
    let word = &WORDS[value.to_bits() as usize % WORDS.len()];
    to.push_latin1_prefix(word, usize::from(word[7] % 8));
}

#[inline(always)]
pub(super) fn push_null<T: CodeUnit>(to: &mut Cursor<'_, T>) {
    to.push_array(b"null".map(T::from));
}

#[inline(always)]
pub(super) fn write_number(number: f64, out: &mut [u8; NUMBER_TEXT_CAPACITY]) -> usize {
    if number.is_finite() {
        write_f64(number, out)
    } else {
        out[..4].copy_from_slice(b"null");
        4
    }
}

#[inline(never)]
pub(super) extern "rust-cold" fn write_number_apart(
    number: f64,
    out: &mut [u8; NUMBER_TEXT_CAPACITY],
) -> usize {
    write_number(number, out)
}

#[inline(never)]
pub(super) extern "rust-cold" fn push_date<T: CodeUnit>(date: Gc<JsCell>, to: &mut Cursor<'_, T>) {
    let mut text = [T::default(); MAX_ISO_STRING_LENGTH];
    let Some(length) = write_iso_string(date.cast::<DateInstance>().time(), &mut text) else {
        return push_null(to);
    };
    to.push(b'"'.into());
    to.push_prefix(&text, length);
    to.push(b'"'.into());
}

#[inline(never)]
extern "rust-cold" fn try_push_rope<T: CodeUnit>(
    rope: Gc<JsString>,
    to: &mut Cursor<'_, T>,
) -> bool {
    /// A longer one is worth putting together for good.
    const MAX_COPIED_LENGTH: usize = 256;
    /// And a still longer one where the collector can make room for it.
    const MAX_LENGTH: usize = 1024;
    let length = rope.len() as usize;
    if rope.is_concatenation()
        && length <= MAX_COPIED_LENGTH
        && (!T::IS_LATIN1 || rope.is_latin1())
        && to.has_room(length + 2)
        && !rope.is_read_again()
    {
        let before = to.mark();
        to.push(b'"'.into());
        let start = to.mark();
        rope.write_to(to);
        if has_nothing_to_escape_in_json(to.since(start)) {
            to.push(b'"'.into());
            return true;
        }
        to.rewind(before);
    }
    length <= MAX_LENGTH
        && (rope.view_without_collecting()).is_some_and(|it| to.try_push_json_quoted(it.text()))
}

#[inline(always)]
pub(super) fn try_push_string<T: CodeUnit>(
    string: Gc<JsString>,
    no_gc: &NoGc<'_>,
    to: &mut Cursor<'_, T>,
) -> bool {
    #[inline(never)]
    extern "rust-cold" fn latin1_part<'a>(
        rope: &JsString,
        no_gc: &'a NoGc<'_>,
    ) -> Option<&'a [u8]> {
        u8::units(rope.try_text(no_gc)?)
    }
    let text = match string.try_impl() {
        Some(characters) => characters.text(),
        None => {
            cold_path();
            let is_part = string.is_unresolved_substring() && string.is_latin1();
            match is_part.then(|| latin1_part(&string, no_gc)).flatten() {
                Some(part) => Text::Latin1(part),
                None => return to.apart(|to| try_push_rope(string, to)),
            }
        }
    };
    to.try_push_json_quoted(text)
}

/// With the colon, and a space if there is a gap.
#[inline(never)]
pub(super) extern "rust-cold" fn try_push_key<T: CodeUnit, const HAS_GAP: bool>(
    name: PropertyName<'_>,
    to: &mut Cursor<'_, T>,
) -> bool {
    if !to.try_push_json_quoted(name.text()) || !to.has_room(2) {
        return false;
    }
    to.push_latin1_prefix(b": ", 1 + usize::from(HAS_GAP));
    true
}
