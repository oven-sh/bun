//! The order of texts as people expect it: ICU's collator for English, which is CLDR's root
//! collation. It is what `localeCompare` and `Intl.Collator` go by.

use super::{is_valid_utf8, wtf8_decoded_units};
use core::cmp::Ordering;

unsafe extern "C" {
    fn Bun__collateUTF8(
        is_numeric_and_base: bool,
        a: *const u8,
        a_len: usize,
        b: *const u8,
        b_len: usize,
    ) -> i32;
    fn Bun__collateUTF16(
        is_numeric_and_base: bool,
        a: *const u16,
        a_len: usize,
        b: *const u16,
        b_len: usize,
    ) -> i32;
}

fn collate(a: &[u8], b: &[u8], is_numeric_and_base: bool) -> Ordering {
    // What a text is must not depend on the text that it is compared with, so ICU gets no bytes to read in a way of its own.
    let order = if !is_valid_utf8(a) || !is_valid_utf8(b) {
        let a: Vec<u16> = wtf8_decoded_units(a).collect();
        let b: Vec<u16> = wtf8_decoded_units(b).collect();
        // SAFETY: two live slices, which are read and not kept.
        unsafe {
            Bun__collateUTF16(
                is_numeric_and_base,
                a.as_ptr(),
                a.len(),
                b.as_ptr(),
                b.len(),
            )
        }
    } else {
        // SAFETY: two live slices, which are read and not kept.
        unsafe {
            Bun__collateUTF8(
                is_numeric_and_base,
                a.as_ptr(),
                a.len(),
                b.as_ptr(),
                b.len(),
            )
        }
    };
    order.cmp(&0)
}

/// `a.localeCompare(b, "en")`, for WTF-8. Other bytes are what `TextDecoder` makes of them. 50 ns for two module specifiers.
pub fn locale_compare(a: &[u8], b: &[u8]) -> Ordering {
    collate(a, b, false)
}

/// `new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare(a, b)`, for WTF-8: without
/// regard to case and accents, and a run of digits counts as the number that it is.
pub fn locale_compare_numeric_base(a: &[u8], b: &[u8]) -> Ordering {
    collate(a, b, true)
}
