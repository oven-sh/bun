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
    fn Bun__collatorForLanguageTag(
        tag: *const u8,
        tag_len: usize,
        is_well_formed: *mut bool,
    ) -> *const c_void;
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
    Root {
        numeric_and_base: bool,
    },
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
    collate(
        a,
        b,
        With::Root {
            numeric_and_base: false,
        },
    )
}

/// `new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare(a, b)`, for WTF-8: without
/// regard to case and accents, and a run of digits counts as the number that it is.
pub fn locale_compare_numeric_base(a: &[u8], b: &[u8]) -> Ordering {
    collate(
        a,
        b,
        With::Root {
            numeric_and_base: true,
        },
    )
}

/// `new Intl.Collator(locale)` for one BCP 47 tag, with its `-u-co-`, `-u-kn-` and `-u-kf-` extensions. ICU keeps
/// one per tag for the life of the process, so this is a `Copy` handle: open it once per configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Collator(NonNull<c_void>);

// SAFETY: the collator is read-only after it is opened and ICU's `ucol_strcoll` is reentrant on a `const UCollator`.
unsafe impl Send for Collator {}
// SAFETY: as above.
unsafe impl Sync for Collator {}

/// Why [`Collator::open`] has no collator for a language tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoCollator {
    /// Not a `unicode_locale_id` of UTS 35 (ECMA-402's `IsStructurallyValidLanguageTag`): `localeCompare` throws a
    /// `RangeError` for it.
    Malformed,
    /// Well-formed, but ICU has no collation data for it (`"xx"`): `Intl` passes it over.
    Unsupported,
}

impl Collator {
    /// The collator of one tag, supported as `Intl.Collator.supportedLocalesOf` says. 150 us the first time a tag is
    /// opened, a hash lookup after that.
    pub fn open(locale: &[u8]) -> Result<Collator, NoCollator> {
        let mut is_well_formed = false;
        // SAFETY: a live slice, which is read and not kept; `is_well_formed` is a live local.
        let collator = unsafe {
            Bun__collatorForLanguageTag(locale.as_ptr(), locale.len(), &raw mut is_well_formed)
        };
        match NonNull::new(collator.cast_mut()) {
            Some(collator) => Ok(Collator(collator)),
            None if is_well_formed => Err(NoCollator::Unsupported),
            None => Err(NoCollator::Malformed),
        }
    }

    /// `new Intl.Collator(locales)` for a list of tags: `None` when none is supported (the root). `Err` is the first
    /// tag that is not well-formed, wherever it is in the list.
    pub fn open_first<'a>(
        locales: impl IntoIterator<Item = &'a [u8]>,
    ) -> Result<Option<Collator>, &'a [u8]> {
        let mut first = None;
        for tag in locales {
            match Collator::open(tag) {
                Ok(collator) => {
                    if first.is_none() {
                        first = Some(collator);
                    }
                }
                Err(NoCollator::Unsupported) => {}
                Err(NoCollator::Malformed) => return Err(tag),
            }
        }
        Ok(first)
    }

    /// `Intl.Collator.prototype.compare`, for WTF-8. Other bytes are what `TextDecoder` makes of them.
    pub fn compare(self, a: &[u8], b: &[u8]) -> Ordering {
        collate(a, b, With::Locale(self))
    }
}
