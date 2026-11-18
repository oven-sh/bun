//! Looking at characters and copying them.

use bun_engine_text::{Text, equal_units};

use super::abi::{NOT_FOUND, RawText, room, slice};

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_is_ascii8(characters: *const u8, length: usize) -> bool {
    // SAFETY: a span.
    Text::Latin1(unsafe { slice(characters, length) }).is_ascii()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_is_ascii16(units: *const u16, length: usize) -> bool {
    // SAFETY: a span.
    Text::Utf16(unsafe { slice(units, length) }).is_ascii()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_fits_latin1(units: *const u16, length: usize) -> bool {
    // SAFETY: a span.
    Text::Utf16(unsafe { slice(units, length) }).fits_latin1()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_find_unit8(
    characters: *const u8,
    length: usize,
    character: u8,
    start: usize,
) -> usize {
    // SAFETY: a span.
    let text = Text::Latin1(unsafe { slice(characters, length) });
    text.find_unit(character.into(), start).unwrap_or(NOT_FOUND)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_find_unit16(
    units: *const u16,
    length: usize,
    unit: u16,
    start: usize,
) -> usize {
    // SAFETY: a span.
    let text = Text::Utf16(unsafe { slice(units, length) });
    text.find_unit(unit, start).unwrap_or(NOT_FOUND)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_find_last_unit(text: RawText<'_>, unit: u16, end: usize) -> usize {
    text.text().rfind_unit(unit, end).unwrap_or(NOT_FOUND)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_find(text: RawText<'_>, needle: RawText<'_>, start: usize) -> usize {
    text.text().find(needle.text(), start).unwrap_or(NOT_FOUND)
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_find_ignoring_ascii_case(
    text: RawText<'_>,
    needle: RawText<'_>,
    start: usize,
) -> usize {
    let text = text.text();
    let start = start.min(text.len());
    text.slice_from(start)
        .find_ignore_ascii_case(needle.text())
        .map_or(NOT_FOUND, |index| start + index)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_equal_bytes(a: *const u8, b: *const u8, size: usize) -> bool {
    // SAFETY: two spans of that size.
    unsafe { equal_units(slice(a, size), slice(b, size)) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_equal_across_widths(
    characters: *const u8,
    units: *const u16,
    length: usize,
) -> bool {
    // SAFETY: two spans of that length.
    unsafe { equal_units(slice(characters, length), slice(units, length)) }
}

#[unsafe(no_mangle)]
extern "C" fn engine_text_equal_ignoring_ascii_case(a: RawText<'_>, b: RawText<'_>) -> bool {
    a.text().eq_ignore_ascii_case(b.text())
}

/// Negative, zero or positive.
#[unsafe(no_mangle)]
extern "C" fn engine_text_compare(a: RawText<'_>, b: RawText<'_>) -> i32 {
    a.text().cmp(&b.text()) as i32
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_widen(target: *mut u16, source: *const u8, length: usize) {
    // SAFETY: two spans of that length.
    unsafe { Text::Latin1(slice(source, length)).copy_to(room(target, length)) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn engine_text_narrow(target: *mut u8, source: *const u16, length: usize) {
    // SAFETY: two spans of that length.
    unsafe { Text::Utf16(slice(source, length)).copy_to(room(target, length)) }
}
