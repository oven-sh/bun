//! What `bun_core::strings` calls by name, so that a program can have that crate without ICU.

use core::cmp::Ordering;
use core::slice;
use std::sync::LazyLock;

use crate::Result;
use crate::argument::MAX_EXPANDABLE_LENGTH;
use crate::collator::{Attribute, Collator, Value};
use crate::normalizer::Form;

fn english(attributes: &[(Attribute, Value)]) -> Collator {
    let open = || -> Result<Collator> {
        let mut collator = Collator::open(c"en")?;
        collator.set(Attribute::Normalization, Value::On)?;
        for &(attribute, value) in attributes {
            collator.set(attribute, value)?;
        }
        Ok(collator)
    };
    open().expect("the root collation is linked in")
}

/// By as much of the texts as a collator takes.
///
/// # Safety
/// The pointers have these lengths.
unsafe fn collate<T>(
    compare: impl FnOnce(&Collator, &[T], &[T]) -> Result<Ordering>,
    is_numeric_and_base: bool,
    (a, a_length): (*const T, usize),
    (b, b_length): (*const T, usize),
) -> i32 {
    static DEFAULT: LazyLock<Collator> = LazyLock::new(|| english(&[]));
    static NUMERIC_AND_BASE: LazyLock<Collator> = LazyLock::new(|| {
        english(&[
            (Attribute::Strength, Value::Primary),
            (Attribute::Numeric, Value::On),
        ])
    });

    let collator = match is_numeric_and_base {
        true => &NUMERIC_AND_BASE,
        false => &DEFAULT,
    };
    // SAFETY: the caller's.
    let (a, b) = unsafe {
        (
            slice::from_raw_parts(a, a_length.min(MAX_EXPANDABLE_LENGTH)),
            slice::from_raw_parts(b, b_length.min(MAX_EXPANDABLE_LENGTH)),
        )
    };
    compare(collator, a, b).unwrap_or(Ordering::Equal) as i32
}

/// Less than, equal to or greater than zero. What is not UTF-8 counts as U+FFFD.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__collateUTF8(
    is_numeric_and_base: bool,
    a: *const u8,
    a_length: usize,
    b: *const u8,
    b_length: usize,
) -> i32 {
    let (a, b) = ((a, a_length), (b, b_length));
    // SAFETY: the caller passes two slices.
    unsafe { collate(Collator::compare_utf8, is_numeric_and_base, a, b) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__collateUTF16(
    is_numeric_and_base: bool,
    a: *const u16,
    a_length: usize,
    b: *const u16,
    b_length: usize,
) -> i32 {
    let (a, b) = ((a, a_length), (b, b_length));
    // SAFETY: the caller passes two slices.
    unsafe { collate(Collator::compare, is_numeric_and_base, a, b) }
}

/// `form` counts NFC, NFD, NFKC, NFKD from zero. Returns the length of the result, which is in `out` if it fits, or -1.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__normalizeUTF16(
    form: u8,
    text: *const u16,
    length: usize,
    out: *mut u16,
    capacity: usize,
) -> i32 {
    let form = match form {
        0 => Form::Nfc,
        1 => Form::Nfd,
        2 => Form::Nfkc,
        _ => Form::Nfkd,
    };
    // SAFETY: the caller passes two slices that do not overlap.
    let (text, out) = unsafe {
        (
            slice::from_raw_parts(text, length),
            slice::from_raw_parts_mut(out, capacity),
        )
    };
    let mut end = 0;
    let result = form.normalize_pieces(text, |_, normalized| {
        let start = end;
        end += normalized.len();
        if let Some(room) = out.get_mut(start..end) {
            room.copy_from_slice(normalized);
        }
    });
    result.map_or(-1, |()| i32::try_from(end).unwrap_or(-1))
}
