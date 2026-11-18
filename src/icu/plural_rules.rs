//! The plural categories of CLDR.

use core::ffi::{CStr, c_char};

use crate::argument::locale_id;
use crate::enumeration::UEnumeration;
use crate::error::Status;
use crate::ffi::{filled, open};
use crate::number_format::{
    FormattedNumber, FormattedNumberRange, UFormattedNumber, UFormattedNumberRange,
};
use crate::{Buffer, Enumeration, Result};

bun_opaque::opaque_ffi! { struct UPluralRules; }

icu_functions! {
    fn uplrules_openForType(locale: *const c_char, kind: Kind, status: &mut Status) -> *mut UPluralRules;
    fn uplrules_close(rules: *mut UPluralRules);
    fn uplrules_select(rules: *const UPluralRules, number: f64, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn uplrules_selectFormatted(
        rules: *const UPluralRules,
        number: *const UFormattedNumber,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
    fn uplrules_selectForRange(
        rules: *const UPluralRules,
        range: *const UFormattedNumberRange,
        out: *mut u16,
        capacity: i32,
        status: &mut Status,
    ) -> i32;
    fn uplrules_getKeywords(rules: *const UPluralRules, status: &mut Status) -> *mut UEnumeration;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Kind {
    Cardinal = 0,
    Ordinal = 1,
}

icu_handle! {
    pub struct PluralRules(UPluralRules), uplrules_close
}

impl PluralRules {
    pub fn open(locale: &CStr, kind: Kind) -> Result<PluralRules> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated.
        open(|status| unsafe { uplrules_openForType(locale, kind, status) }).map(PluralRules)
    }

    pub fn select_integer(&self, number: i32) -> Result<Buffer<u16>> {
        // SAFETY: the rules are open, and `out` has room for `capacity`.
        filled(|out, capacity, status| unsafe {
            uplrules_select(self.0.as_ptr(), number.into(), out, capacity, status)
        })
    }

    /// For the digits that are visible.
    pub fn select(&self, number: &FormattedNumber) -> Result<Buffer<u16>> {
        // SAFETY: both objects are open, and `out` has room for `capacity`.
        filled(|out, capacity, status| unsafe {
            uplrules_selectFormatted(self.0.as_ptr(), number.as_ptr(), out, capacity, status)
        })
    }

    pub fn select_range(&self, range: &FormattedNumberRange) -> Result<Buffer<u16>> {
        // SAFETY: both objects are open, and `out` has room for `capacity`.
        filled(|out, capacity, status| unsafe {
            uplrules_selectForRange(self.0.as_ptr(), range.as_ptr(), out, capacity, status)
        })
    }

    pub fn categories(&self) -> Result<Enumeration> {
        // SAFETY: the rules are open. The list is a copy.
        Enumeration::open(|status| unsafe { uplrules_getKeywords(self.0.as_ptr(), status) })
    }
}
