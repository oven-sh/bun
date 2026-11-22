//! `unicode/uformattednumber.h`

use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, UChar};
use crate::capi::ufieldpositer::UFieldPositionIterator;
use crate::capi::uformattedvalue::UFormattedValue;
use crate::common::utypes::*;
use crate::i18n::fphdlimp::FieldPositionIteratorHandler;
use crate::i18n::number_fluent::UFormattedNumberData;
use bun_icu_macros::capi;

pub(crate) type UFormattedNumber = UFormattedValue;

pub(crate) fn data(
    uresult: Option<&UFormattedNumber>,
) -> Result<&UFormattedNumberData, UErrorCode> {
    match uresult.non_null()? {
        UFormattedValue::Number(number) => Ok(number),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

pub(crate) fn data_mut(
    uresult: Option<&mut UFormattedNumber>,
) -> Result<&mut UFormattedNumberData, UErrorCode> {
    match uresult.non_null()? {
        UFormattedValue::Number(number) => Ok(number),
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

#[capi]
fn unumf_openResult(ec: ErrorCode) -> Option<Box<UFormattedNumber>> {
    UFormattedValue::open(|| UFormattedValue::Number(UFormattedNumberData::new()), ec)
}

#[capi]
fn unumf_closeResult(uresult: Option<Box<UFormattedNumber>>) {
    drop(uresult);
}

#[capi]
fn unumf_resultToString(
    uresult: Option<&UFormattedNumber>,
    (buffer, _): Dest<UChar>,
    ec: ErrorCode,
) -> i32 {
    ec.run(0, |status| {
        let text = data(uresult)?.text();
        buffer.check()?;
        Ok(buffer.extract_to(text, status))
    })
}

#[capi]
fn unumf_resultGetAllFieldPositions(
    uresult: Option<&UFormattedNumber>,
    ufpositer: Option<&mut UFieldPositionIterator>,
    ec: ErrorCode,
) {
    ec.run((), |_| {
        let result = data(uresult)?;
        let fpi = ufpositer.non_null()?;
        let mut fpih = FieldPositionIteratorHandler::new();
        result
            .base
            .get_all_field_positions(|field, start, limit| fpih.add_attribute(field, start, limit));
        fpih.finish_into(fpi)
    })
}
