//! `unicode/uformattednumber.h`

use crate::capi::ffi::{Dest, ErrorCode, Mut, Owned, Ref, UChar};
use crate::capi::ufieldpositer::UFieldPositionIterator;
use crate::capi::uformattedvalue::{UFormattedValue, Value};
use crate::common::utypes::*;
use crate::i18n::fphdlimp::FieldPositionIteratorHandler;
use crate::i18n::number_fluent::UFormattedNumberData;
use bun_icu_macros::capi;

pub(crate) type UFormattedNumber = UFormattedValue;

/// "FDN" in ASCII, for numbers and ranges.
pub(crate) const MAGIC: i32 = 0x4644_4E00;

pub(crate) fn data(
    uresult: Ref<'_, UFormattedNumber>,
) -> Result<&UFormattedNumberData, UErrorCode> {
    match &UFormattedValue::validate(uresult, MAGIC)?.value {
        Value::Number(number) => Ok(number),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

pub(crate) fn data_mut(
    uresult: Mut<'_, UFormattedNumber>,
) -> Result<&mut UFormattedNumberData, UErrorCode> {
    match &mut UFormattedValue::validate_mut(uresult, MAGIC)?.value {
        Value::Number(number) => Ok(number),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

#[capi]
fn unumf_openResult(ec: ErrorCode) -> *mut UFormattedNumber {
    UFormattedValue::open(MAGIC, || Value::Number(UFormattedNumberData::new()), ec)
}

#[capi]
fn unumf_closeResult(uresult: Owned<UFormattedNumber>) {
    UFormattedValue::close(uresult, MAGIC)
}

#[capi]
fn unumf_resultToString(
    uresult: Ref<UFormattedNumber>,
    (buffer, _): Dest<UChar>,
    ec: ErrorCode,
) -> i32 {
    ec.run(0, |cx, status| {
        let text = data(uresult)?.text();
        buffer.check()?;
        Ok(cx.extract_to(text, buffer, status))
    })
}

#[capi]
fn unumf_resultGetAllFieldPositions(
    uresult: Ref<UFormattedNumber>,
    ufpositer: Mut<UFieldPositionIterator>,
    ec: ErrorCode,
) {
    ec.run((), |_, _| {
        let result = data(uresult)?;
        let fpi = ufpositer.get_mut()?;
        let mut fpih = FieldPositionIteratorHandler::new();
        result
            .base
            .get_all_field_positions(|field, start, limit| fpih.add_attribute(field, start, limit));
        fpih.finish_into(fpi)
    })
}
