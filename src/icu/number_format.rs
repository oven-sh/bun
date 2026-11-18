//! Numbers and ranges of numbers, formatted as a skeleton says.

use core::ffi::{CStr, c_char, c_void};
use core::ptr;

use crate::argument::{locale_id, number_skeleton_length};
use crate::error::Status;
use crate::ffi::{adopt, call, length, open};
use crate::formatted_value::{FormattedValue, UFormattedValue};
use crate::{Error, Result};

bun_opaque::opaque_ffi! {
    struct UNumberFormatter;
    pub(crate) struct UFormattedNumber;
    struct UNumberRangeFormatter;
    pub(crate) struct UFormattedNumberRange;
}

icu_functions! {
    fn unumf_openForSkeletonAndLocale(skeleton: *const u16, length: i32, locale: *const c_char, status: &mut Status) -> *mut UNumberFormatter;
    fn unumf_close(formatter: *mut UNumberFormatter);
    fn unumf_openResult(status: &mut Status) -> *mut UFormattedNumber;
    fn unumf_closeResult(result: *mut UFormattedNumber);
    fn unumf_formatDouble(formatter: *const UNumberFormatter, value: f64, result: *mut UFormattedNumber, status: &mut Status);
    fn unumf_formatDecimal(
        formatter: *const UNumberFormatter,
        value: *const u8,
        length: i32,
        result: *mut UFormattedNumber,
        status: &mut Status,
    );
    fn unumf_resultAsValue(result: *const UFormattedNumber, status: &mut Status) -> *const UFormattedValue;
    fn unumrf_openForSkeletonWithCollapseAndIdentityFallback(
        skeleton: *const u16,
        length: i32,
        collapse: Collapse,
        identity_fallback: IdentityFallback,
        locale: *const c_char,
        parse_error: *mut c_void,
        status: &mut Status,
    ) -> *mut UNumberRangeFormatter;
    fn unumrf_close(formatter: *mut UNumberRangeFormatter);
    fn unumrf_openResult(status: &mut Status) -> *mut UFormattedNumberRange;
    fn unumrf_closeResult(result: *mut UFormattedNumberRange);
    fn unumrf_formatDoubleRange(
        formatter: *const UNumberRangeFormatter,
        start: f64,
        end: f64,
        result: *mut UFormattedNumberRange,
        status: &mut Status,
    );
    fn unumrf_formatDecimalRange(
        formatter: *const UNumberRangeFormatter,
        start: *const u8,
        start_length: i32,
        end: *const u8,
        end_length: i32,
        result: *mut UFormattedNumberRange,
        status: &mut Status,
    );
    fn unumrf_resultAsValue(result: *const UFormattedNumberRange, status: &mut Status) -> *const UFormattedValue;
}

/// Of a numeric string, whose exponent has at most five characters.
pub const MAX_DECIMAL_LENGTH: usize = 1_000_000;

fn decimal_length(value: &[u8]) -> Result<i32> {
    const MAX_EXPONENT_LENGTH: usize = "-9999".len();

    let exponent = value
        .iter()
        .skip_while(|byte| !byte.eq_ignore_ascii_case(&b'e'));
    if value.len() > MAX_DECIMAL_LENGTH || exponent.skip(1).count() > MAX_EXPONENT_LENGTH {
        return Err(Error::ILLEGAL_ARGUMENT);
    }
    length(value)
}

/// The fields of `Category::NUMBER`.
pub mod field {
    pub const INTEGER: i32 = 0;
    pub const FRACTION: i32 = 1;
    pub const DECIMAL_SEPARATOR: i32 = 2;
    pub const EXPONENT_SYMBOL: i32 = 3;
    pub const EXPONENT_SIGN: i32 = 4;
    pub const EXPONENT: i32 = 5;
    pub const GROUPING_SEPARATOR: i32 = 6;
    pub const CURRENCY: i32 = 7;
    pub const PERCENT: i32 = 8;
    pub const SIGN: i32 = 10;
    pub const MEASURE_UNIT: i32 = 11;
    pub const COMPACT: i32 = 12;
    /// New in ICU 71.
    pub const APPROXIMATELY_SIGN: i32 = 13;
}

icu_handle! {
    pub struct NumberFormatter(UNumberFormatter), unumf_close
}

icu_handle! {
    /// Takes one result after another.
    pub struct FormattedNumber(UFormattedNumber), unumf_closeResult
}

impl NumberFormatter {
    pub fn open(skeleton: &[u16], locale: &CStr) -> Result<NumberFormatter> {
        let locale = locale_id(locale)?;
        let length = number_skeleton_length(skeleton)?;
        adopt(
            // SAFETY: `skeleton` has `length` units and `locale` is terminated. Neither is kept.
            |status| unsafe {
                unumf_openForSkeletonAndLocale(skeleton.as_ptr(), length, locale, status)
            },
            NumberFormatter,
        )
    }

    pub fn format_double(&self, value: f64, result: &mut FormattedNumber) -> Result<()> {
        // SAFETY: both objects are open.
        call(|status| unsafe {
            unumf_formatDouble(self.0.as_ptr(), value, result.0.as_ptr(), status)
        })
    }

    /// `value` is a numeric string of the General Decimal Arithmetic Specification.
    pub fn format_decimal(&self, value: &[u8], result: &mut FormattedNumber) -> Result<()> {
        let length = decimal_length(value)?;
        // SAFETY: both objects are open, and `value`, which is copied, has `length` bytes.
        call(|status| unsafe {
            unumf_formatDecimal(
                self.0.as_ptr(),
                value.as_ptr(),
                length,
                result.0.as_ptr(),
                status,
            )
        })
    }
}

impl FormattedNumber {
    pub fn open() -> Result<FormattedNumber> {
        // SAFETY: it takes nothing but the status.
        open(|status| unsafe { unumf_openResult(status) }).map(FormattedNumber)
    }

    pub(crate) fn as_ptr(&self) -> *const UFormattedNumber {
        self.0.as_ptr()
    }

    pub fn value(&self) -> Result<FormattedValue<'_>> {
        // SAFETY: the result is open, and to format into it takes the borrow back.
        unsafe { FormattedValue::new(|status| unumf_resultAsValue(self.0.as_ptr(), status)) }
    }
}

/// Whether what both ends of a range have in common is written once.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Collapse {
    Auto = 0,
    None = 1,
}

/// How a range is written whose ends read the same.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum IdentityFallback {
    Approximately = 2,
    Range = 3,
}

icu_handle! {
    pub struct NumberRangeFormatter(UNumberRangeFormatter), unumrf_close
}

icu_handle! {
    pub struct FormattedNumberRange(UFormattedNumberRange), unumrf_closeResult
}

impl NumberRangeFormatter {
    pub fn open(
        skeleton: &[u16],
        locale: &CStr,
        collapse: Collapse,
        identity_fallback: IdentityFallback,
    ) -> Result<NumberRangeFormatter> {
        let locale = locale_id(locale)?;
        let length = number_skeleton_length(skeleton)?;
        adopt(
            // SAFETY: `skeleton` has `length` units and `locale` is terminated. Neither is kept. The parse error is optional.
            |status| unsafe {
                unumrf_openForSkeletonWithCollapseAndIdentityFallback(
                    skeleton.as_ptr(),
                    length,
                    collapse,
                    identity_fallback,
                    locale,
                    ptr::null_mut(),
                    status,
                )
            },
            NumberRangeFormatter,
        )
    }

    pub fn format_doubles(&self, start: f64, end: f64) -> Result<FormattedNumberRange> {
        let result = FormattedNumberRange::open()?;
        // SAFETY: both objects are open.
        call(|status| unsafe {
            unumrf_formatDoubleRange(self.0.as_ptr(), start, end, result.0.as_ptr(), status)
        })?;
        Ok(result)
    }

    /// As in `NumberFormatter::format_decimal`.
    pub fn format_decimals(&self, start: &[u8], end: &[u8]) -> Result<FormattedNumberRange> {
        let (start_length, end_length) = (decimal_length(start)?, decimal_length(end)?);
        let result = FormattedNumberRange::open()?;
        // SAFETY: both objects are open, and the strings, which are copied, have these lengths.
        call(|status| unsafe {
            unumrf_formatDecimalRange(
                self.0.as_ptr(),
                start.as_ptr(),
                start_length,
                end.as_ptr(),
                end_length,
                result.0.as_ptr(),
                status,
            )
        })?;
        Ok(result)
    }
}

impl FormattedNumberRange {
    fn open() -> Result<FormattedNumberRange> {
        // SAFETY: it takes nothing but the status.
        open(|status| unsafe { unumrf_openResult(status) }).map(FormattedNumberRange)
    }

    pub(crate) fn as_ptr(&self) -> *const UFormattedNumberRange {
        self.0.as_ptr()
    }

    pub fn value(&self) -> Result<FormattedValue<'_>> {
        // SAFETY: the result is open, and is formatted into only once.
        unsafe { FormattedValue::new(|status| unumrf_resultAsValue(self.0.as_ptr(), status)) }
    }
}
