//! Locale identifiers in the syntax of ICU (`sr_Latn_RS@calendar=gregorian`).

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::error::Status;
use crate::ffi::filled;
use crate::{Buffer, Result, default_locale};

icu_functions! {
    fn uloc_toLanguageTag(locale: *const c_char, out: *mut u8, capacity: i32, strict: i8, status: &mut Status) -> i32;
    fn uloc_countAvailable() -> i32;
    fn uloc_getAvailable(index: i32) -> *const c_char;
    fn uloc_toUnicodeLocaleType(key: *const c_char, value: *const c_char) -> *const c_char;
    fn uloc_addLikelySubtags(locale: *const c_char, out: *mut u8, capacity: i32, status: &mut Status) -> i32;
    fn uloc_minimizeSubtags(locale: *const c_char, out: *mut u8, capacity: i32, status: &mut Status) -> i32;
    fn uloc_isRightToLeft(locale: *const c_char) -> i8;
}

/// # Safety
/// For an index below what `count` returns, `get` returns null or a string that is a constant of the process.
pub(crate) unsafe fn listed(
    count: unsafe extern "C" fn() -> i32,
    get: unsafe extern "C" fn(i32) -> *const c_char,
) -> impl Iterator<Item = &'static CStr> {
    default_locale::settle();
    // SAFETY: it takes nothing.
    (0..unsafe { count() }).filter_map(move |index| {
        // SAFETY: the caller's.
        unsafe {
            let locale = get(index);
            (!locale.is_null()).then(|| CStr::from_ptr(locale))
        }
    })
}

/// Those that have data to format with and to break text with.
pub fn available() -> impl Iterator<Item = &'static CStr> {
    // SAFETY: the names are keys of a table that stays loaded.
    unsafe { listed(uloc_countAvailable, uloc_getAvailable) }
}

/// What ICU falls back to for a locale that it has no data for.
pub fn default() -> &'static CStr {
    default_locale::get()
}

/// The name in BCP 47 of a value of a `u` or `t` key, if CLDR knows the value.
pub fn unicode_type(key: &CStr, value: &CStr) -> Option<&'static [u8]> {
    default_locale::settle();
    // SAFETY: both strings are terminated.
    let known = unsafe { uloc_toUnicodeLocaleType(key.as_ptr(), value.as_ptr()) };
    if known.is_null() || known == value.as_ptr() {
        return None;
    }
    // SAFETY: what is not the argument itself is an entry of a table that lasts as long as the process.
    Some(unsafe { CStr::from_ptr(known) }.to_bytes())
}

/// Add Likely Subtags of UTS #35.
pub fn add_likely_subtags(locale: &CStr) -> Result<Buffer<u8>> {
    let locale = locale_id(locale)?;
    // SAFETY: `locale` is terminated, and `out` has room for `capacity`.
    filled(|out, capacity, status| unsafe { uloc_addLikelySubtags(locale, out, capacity, status) })
}

/// Remove Likely Subtags of UTS #35, which favors the region over the script.
pub fn minimize_subtags(locale: &CStr) -> Result<Buffer<u8>> {
    let locale = locale_id(locale)?;
    // SAFETY: `locale` is terminated, and `out` has room for `capacity`.
    filled(|out, capacity, status| unsafe { uloc_minimizeSubtags(locale, out, capacity, status) })
}

/// Of the script that `locale` names, or of its likely one.
pub fn is_right_to_left(locale: &CStr) -> bool {
    default_locale::settle();
    // SAFETY: `locale` is terminated.
    locale_id(locale).is_ok_and(|locale| unsafe { uloc_isRightToLeft(locale) } != 0)
}

pub fn to_language_tag(locale: &CStr) -> Result<Buffer<u8>> {
    let locale = locale_id(locale)?;
    // SAFETY: `locale` is terminated, and `out` has room for `capacity`.
    filled(|out, capacity, status| unsafe { uloc_toLanguageTag(locale, out, capacity, 0, status) })
}
