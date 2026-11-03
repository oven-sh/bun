//! The order of texts as people expect it: ICU's collator for English, which is CLDR's root
//! collation, or for a locale of the caller's. It is what `localeCompare` and `Intl.Collator` go by.

use super::{is_valid_utf8, wtf8_decoded_units};
use core::cmp::Ordering;
use core::ffi::c_void;
use core::ptr::NonNull;

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
    fn Bun__collatorForLanguageTag(tag: *const u8, tag_len: usize) -> *const c_void;
    fn Bun__collatorCollateUTF8(
        collator: *const c_void,
        a: *const u8,
        a_len: usize,
        b: *const u8,
        b_len: usize,
    ) -> i32;
    fn Bun__collatorCollateUTF16(
        collator: *const c_void,
        a: *const u16,
        a_len: usize,
        b: *const u16,
        b_len: usize,
    ) -> i32;
}

/// Which ICU collator a comparison goes through.
#[derive(Clone, Copy)]
enum With {
    /// The root collation (`"en"`), with `numeric: true, sensitivity: "base"` when set.
    Root { numeric_and_base: bool },
    Locale(Collator),
}

fn collate(a: &[u8], b: &[u8], with: With) -> Ordering {
    // What a text is must not depend on the text that it is compared with, so ICU gets no bytes to read in a way of its own.
    let order = if !is_valid_utf8(a) || !is_valid_utf8(b) {
        let a: Vec<u16> = wtf8_decoded_units(a).collect();
        let b: Vec<u16> = wtf8_decoded_units(b).collect();
        // SAFETY: two live slices, which are read and not kept; a collator lives for the process.
        unsafe {
            match with {
                With::Root { numeric_and_base } => {
                    Bun__collateUTF16(numeric_and_base, a.as_ptr(), a.len(), b.as_ptr(), b.len())
                }
                With::Locale(collator) => Bun__collatorCollateUTF16(
                    collator.0.as_ptr(),
                    a.as_ptr(),
                    a.len(),
                    b.as_ptr(),
                    b.len(),
                ),
            }
        }
    } else {
        // SAFETY: two live slices, which are read and not kept; a collator lives for the process.
        unsafe {
            match with {
                With::Root { numeric_and_base } => {
                    Bun__collateUTF8(numeric_and_base, a.as_ptr(), a.len(), b.as_ptr(), b.len())
                }
                With::Locale(collator) => Bun__collatorCollateUTF8(
                    collator.0.as_ptr(),
                    a.as_ptr(),
                    a.len(),
                    b.as_ptr(),
                    b.len(),
                ),
            }
        }
    };
    order.cmp(&0)
}

/// `a.localeCompare(b, "en")`, for WTF-8. Other bytes are what `TextDecoder` makes of them. 50 ns for two module specifiers.
pub fn locale_compare(a: &[u8], b: &[u8]) -> Ordering {
    collate(a, b, With::Root { numeric_and_base: false })
}

/// `new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare(a, b)`, for WTF-8: without
/// regard to case and accents, and a run of digits counts as the number that it is.
pub fn locale_compare_numeric_base(a: &[u8], b: &[u8]) -> Ordering {
    collate(a, b, With::Root { numeric_and_base: true })
}

/// `new Intl.Collator(locale)`: ICU's collator for one BCP 47 language tag (`"zh-CN"`), which orders as
/// `a.localeCompare(b, locale)` does. ICU opens one per tag for the life of the process and shares it, so this is
/// a `Copy` handle that any thread may compare with; open it once per configuration, not per comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Collator(NonNull<c_void>);

// SAFETY: the collator is read-only after it is opened and ICU's `ucol_strcoll` is reentrant on a `const UCollator`.
unsafe impl Send for Collator {}
// SAFETY: as above.
unsafe impl Sync for Collator {}

impl Collator {
    /// `None` for a tag that is not well-formed, which `localeCompare` throws a `RangeError` for. A well-formed tag
    /// that ICU has no data for gets the root collation, as `Intl` falls back to the default locale. 150 us the
    /// first time a tag is opened, a hash lookup after that.
    pub fn open(locale: &[u8]) -> Option<Collator> {
        // SAFETY: a live slice, which is read and not kept.
        let collator = unsafe { Bun__collatorForLanguageTag(locale.as_ptr(), locale.len()) };
        NonNull::new(collator.cast_mut()).map(Collator)
    }

    /// `Intl.Collator.prototype.compare`, for WTF-8. Other bytes are what `TextDecoder` makes of them.
    pub fn compare(self, a: &[u8], b: &[u8]) -> Ordering {
        collate(a, b, With::Locale(self))
    }
}

/// `a.localeCompare(b, locale)`, for WTF-8: the root collation when `locale` is not a well-formed language tag.
/// Looks the collator up by tag each time; a loop keeps a [`Collator`] instead.
pub fn locale_compare_in(locale: &[u8], a: &[u8], b: &[u8]) -> Ordering {
    match Collator::open(locale) {
        Some(collator) => collator.compare(a, b),
        None => locale_compare(a, b),
    }
}
