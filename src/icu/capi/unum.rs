//! `unicode/unum.h`

use crate::capi::ffi::{ErrorCode, NulStr, Null, Text, UChar};
use crate::common::locid::Locale;
use crate::common::utypes::*;
use crate::i18n::numfmt::NumberFormat;
use bun_icu_macros::capi;
use std::sync::Arc;

type UNumberFormatStyle = i32;
const UNUM_DECIMAL: UNumberFormatStyle = 1;

type UNumberFormatAttribute = i32;
const UNUM_GROUPING_USED: UNumberFormatAttribute = 1;
const UNUM_MIN_INTEGER_DIGITS: UNumberFormatAttribute = 4;
const UNUM_MAX_FRACTION_DIGITS: UNumberFormatAttribute = 6;
const UNUM_MIN_FRACTION_DIGITS: UNumberFormatAttribute = 7;
const UNUM_GROUPING_SIZE: UNumberFormatAttribute = 10;
const UNUM_SECONDARY_GROUPING_SIZE: UNumberFormatAttribute = 15;
const UNUM_MINIMUM_GROUPING_DIGITS: UNumberFormatAttribute = 22;

/// The values that `NumberFormat` has built in.
const ATTRIBUTES: [(UNumberFormatAttribute, i32); 7] = [
    (UNUM_MIN_INTEGER_DIGITS, 1),
    (UNUM_MIN_FRACTION_DIGITS, 0),
    (UNUM_MAX_FRACTION_DIGITS, 3),
    (UNUM_GROUPING_USED, 1),
    (UNUM_GROUPING_SIZE, -2),
    (UNUM_SECONDARY_GROUPING_SIZE, -2),
    (UNUM_MINIMUM_GROUPING_DIGITS, -2),
];

pub(crate) struct UNumberFormat {
    format: Arc<NumberFormat>,
    /// One bit for each of `ATTRIBUTES`, and the next one for all others.
    attributes_set: u8,
}

impl UNumberFormat {
    /// Fails unless the caller has set all of `ATTRIBUTES` and nothing else.
    pub(crate) fn format(&self) -> Result<Arc<NumberFormat>, UErrorCode> {
        if self.attributes_set == (1 << ATTRIBUTES.len()) - 1 {
            Ok(Arc::clone(&self.format))
        } else {
            Err(U_UNSUPPORTED_ERROR)
        }
    }
}

/// Accepts only `UNUM_DECIMAL`, which ignores the pattern.
#[capi]
fn unum_open(
    style: UNumberFormatStyle,
    (_pattern, _): Text<UChar>,
    locale: NulStr<u8>,
    parse_err: Null,
    status: ErrorCode,
) -> Option<Box<UNumberFormat>> {
    status.open(|| {
        if style != UNUM_DECIMAL || !parse_err.is_null() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        Ok(UNumberFormat {
            format: NumberFormat::create_shared_instance(&Locale::new(locale.get()))?,
            attributes_set: 0,
        })
    })
}

#[capi]
fn unum_close(fmt: Option<Box<UNumberFormat>>) {
    drop(fmt);
}

/// Accepts only the pairs in `ATTRIBUTES`.
#[capi]
fn unum_setAttribute(
    fmt: Option<&mut UNumberFormat>,
    attr: UNumberFormatAttribute,
    new_value: i32,
) {
    let index = ATTRIBUTES.iter().position(|&it| it == (attr, new_value));
    debug_assert!(index.is_some());
    if let Some(fmt) = fmt {
        fmt.attributes_set |= 1 << index.unwrap_or(ATTRIBUTES.len());
    }
}
