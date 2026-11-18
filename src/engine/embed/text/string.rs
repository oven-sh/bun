//! Making, sharing and converting strings.

use core::ffi::c_void;

use bun_engine_text::{
    Atom, CodeUnit, Cursor, FreeExternalBuffer, StringBuilder, StringImpl, StringRef, SymbolRef,
    Text, hash_latin1, with_text,
};

use super::abi::{RawText, or_abort, room, slice};

#[unsafe(no_mangle)]
extern "C" fn engine_text_compute_hash(string: &StringImpl) -> u32 {
    string.hash()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_hash_latin1(characters: *const u8, length: usize) -> u32 {
    // SAFETY: a span.
    hash_latin1(unsafe { slice(characters, length) })
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_hash_ignoring_ascii_case(text: RawText<'_>) -> u32 {
    let text = text.text();
    StringBuilder::on_stack::<256, _>(|folded| {
        with_text!(text, |units| folded.write_latin1(units.len(), |cursor| {
            cursor.push_mapped(units, |unit| unit.to_ascii_lower().to_u16() as u8);
        }));
        folded.text().hash()
    })
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_set_never_atomize(string: &StringImpl) {
    string.set_never_atomize();
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_shared_cost(string: &StringImpl) -> usize {
    string.shared_cost()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_borrow_latin1(characters: *const u8, length: usize) -> StringRef {
    // SAFETY: they outlive the string.
    StringRef::from_static_units(unsafe { slice(characters, length) })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_borrow_utf16(units: *const u16, length: usize) -> StringRef {
    // SAFETY: they outlive the string.
    StringRef::from_static_units(unsafe { slice(units, length) })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_external_latin1(
    characters: *const u8,
    length: usize,
    context: *mut c_void,
    free: Option<FreeExternalBuffer>,
) -> StringRef {
    // SAFETY: they stay until `free` is called.
    unsafe { StringRef::external(slice(characters, length), context, free) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_external_utf16(
    units: *const u16,
    length: usize,
    context: *mut c_void,
    free: Option<FreeExternalBuffer>,
) -> StringRef {
    // SAFETY: they stay until `free` is called.
    unsafe { StringRef::external(slice(units, length), context, free) }
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_shared_substring(
    string: &StringImpl,
    start: u32,
    length: u32,
) -> StringRef {
    let start = start as usize;
    StringRef::substring(string, start..start + length as usize)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_isolated_copy(string: &StringImpl) -> StringRef {
    StringRef::isolated_copy(string).into_string()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_atom_of_latin1(characters: *const u8, length: usize) -> Atom {
    // SAFETY: a span.
    Atom::new(Text::Latin1(unsafe { slice(characters, length) }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_atom_of_utf16(units: *const u16, length: usize) -> Atom {
    // SAFETY: a span.
    Atom::new(Text::Utf16(unsafe { slice(units, length) }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_atom_of_literal(characters: *const u8, length: usize) -> Atom {
    // SAFETY: a literal is in static memory.
    Atom::from_static_latin1(unsafe { slice(characters, length) })
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_atom_of_string(string: &StringImpl) -> Atom {
    Atom::from_string(string)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_private_symbol(description: &StringImpl) -> SymbolRef {
    SymbolRef::private(description)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_registered_symbol(key: &StringImpl) -> SymbolRef {
    SymbolRef::registered(key)
}

/// Null if the bytes are not UTF-8.
#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_from_utf8(bytes: *const u8, length: usize) -> Option<StringRef> {
    // SAFETY: a span.
    let bytes = unsafe { slice(bytes, length) };
    or_abort(StringRef::try_wide_from_utf8(bytes))
}

/// Null if the string cannot be allocated.
#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_try_from_utf8_lossy(
    bytes: *const u8,
    length: usize,
) -> Option<StringRef> {
    // SAFETY: a span.
    let bytes = unsafe { slice(bytes, length) };
    StringRef::try_wide_from_utf8_lossy(bytes).ok()
}

/// Whether the bytes are UTF-8 for exactly so many units.
#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_decode_utf8(
    bytes: *const u8,
    length: usize,
    target: *mut u16,
    capacity: usize,
) -> bool {
    // SAFETY: spans.
    let (bytes, target) = unsafe { (slice(bytes, length), room(target, capacity)) };
    let mut read = 0;
    let written = Cursor::fill_uninit(target, |it| read = it.push_valid_utf8(bytes)).len();
    read == length && written == capacity
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_utf8_length(text: RawText<'_>) -> usize {
    text.text().utf8_len()
}

/// As many whole characters as fit. Returns how many bytes it has written.
#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_write_utf8(
    text: RawText<'_>,
    target: *mut u8,
    capacity: usize,
) -> usize {
    // SAFETY: a span.
    let target = unsafe { room(target, capacity) };
    let write = |cursor: &mut Cursor<'_, u8>| _ = text.text().write_utf8(cursor);
    Cursor::fill_uninit(target, write).len()
}

/// This and the next five return null if nothing changes.
#[unsafe(no_mangle)]
extern "C" fn engine_text_to_ascii_lower_case(text: RawText<'_>) -> Option<StringRef> {
    or_abort(text.text().to_ascii_lower_case())
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_to_ascii_upper_case(text: RawText<'_>) -> Option<StringRef> {
    or_abort(text.text().to_ascii_upper_case())
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_to_upper_case(text: RawText<'_>) -> Option<StringRef> {
    or_abort(bun_engine_unicode::to_upper_case(text.text()))
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_to_well_formed(text: RawText<'_>) -> Option<StringRef> {
    or_abort(text.text().to_well_formed())
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_replace_unit(
    text: RawText<'_>,
    target: u16,
    replacement: u16,
) -> Option<StringRef> {
    fn replace<In: CodeUnit, Out: CodeUnit>(units: &[In], target: u16, by: u16) -> StringRef {
        let (target, by) = (
            In::from_u16_truncating(target),
            Out::from_u16_truncating(by),
        );
        let keep = |unit: In| Out::from_u16_truncating(unit.to_u16());
        or_abort(StringRef::try_write(units.len(), |cursor| {
            cursor.push_mapped(units, |unit| if unit == target { by } else { keep(unit) });
        }))
    }
    let text = text.text();
    text.contains_unit(target).then(|| match text {
        Text::Latin1(it) if replacement.is_latin1() => replace::<u8, u8>(it, target, replacement),
        Text::Latin1(it) => replace::<u8, u16>(it, target, replacement),
        Text::Utf16(it) => replace::<u16, u16>(it, target, replacement),
    })
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_replace_all(
    text: RawText<'_>,
    pattern: RawText<'_>,
    replacement: RawText<'_>,
) -> Option<StringRef> {
    let (text, pattern, replacement) = (text.text(), pattern.text(), replacement.text());
    if pattern.is_empty() {
        return None;
    }
    let mut matches = text.matches(pattern).peekable();
    matches.peek()?;
    StringBuilder::on_stack::<256, _>(|result| {
        let mut copied = 0;
        for start in matches {
            result.push_text(text.slice(copied..start));
            result.push_text(replacement);
            copied = start + pattern.len();
        }
        result.push_text(text.slice_from(copied));
        Some(or_abort(result.take()))
    })
}
