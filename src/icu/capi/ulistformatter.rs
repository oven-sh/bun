//! `unicode/ulistformatter.h`

use crate::capi::ffi::raw::ulistformatter::{Lengths, StringPtrs};
use crate::capi::ffi::{Dest, ErrorCode, NonNullHandle, NulStr, Text, UChar};
use crate::capi::uformattedvalue::UFormattedValue;
use crate::common::locid::Locale;
use crate::common::memory::{self, Appendable};
use crate::common::utypes::*;
use crate::i18n::listformatter::ListFormatter;
use bun_icu_macros::capi;
use std::ffi::c_int;
use std::ptr::{from_ref, null};

pub(crate) type UListFormatter = ListFormatter;

pub(crate) type UFormattedList = UFormattedValue;

/// Indexed by `UListFormatterType` and then by `UListFormatterWidth`.
const STYLES: [[&[u8]; 3]; 3] = [
    [b"standard", b"standard-short", b"standard-narrow"],
    [b"or", b"or-short", b"or-narrow"],
    [b"unit", b"unit-short", b"unit-narrow"],
];

/// A null string is empty.
fn get_unicode_strings<'a>(
    strings: StringPtrs<'a>,
    lengths: Lengths<'a>,
) -> Result<Vec<&'a [UChar]>, UErrorCode> {
    strings.check()?;
    let mut items = memory::try_with_capacity(strings.length() as usize)?;
    items.add_each(strings.texts(lengths).map(Text::get_or_empty));
    Ok(items)
}

#[capi]
fn ulistfmt_openForType(
    locale: NulStr<u8>,
    type_: c_int,
    width: c_int,
    status: ErrorCode,
) -> Option<Box<UListFormatter>> {
    status.open(|| {
        let style = STYLES
            .get(type_ as usize)
            .and_then(|it| it.get(width as usize));
        let style = style.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        ListFormatter::create_instance(&Locale::new(locale.get()), style)
    })
}

#[capi]
fn ulistfmt_close(listfmt: Option<Box<UListFormatter>>) {
    drop(listfmt);
}

#[capi]
fn ulistfmt_openResult(ec: ErrorCode) -> Option<Box<UFormattedList>> {
    ec.open(|| Ok(UFormattedValue::new_unset()))
}

#[capi]
fn ulistfmt_resultAsValue(
    uresult: Option<&UFormattedList>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_| uresult.non_null().map(from_ref))
}

#[capi]
fn ulistfmt_closeResult(uresult: Option<Box<UFormattedList>>) {
    drop(uresult);
}

#[capi]
fn ulistfmt_format(
    listfmt: Option<&UListFormatter>,
    #[len(_count)] strings: StringPtrs,
    #[len(_count)] lengths: Lengths,
    _count: i32,
    (result, _): Dest<UChar>,
    status: ErrorCode,
) -> i32 {
    status.run(-1, |status| {
        result.check()?;
        match listfmt
            .non_null()?
            .format(&get_unicode_strings(strings, lengths)?)
        {
            Ok(list) => Ok(result.extract_to(list.text(), status)),
            Err(code) => {
                *status = code;
                Ok(0)
            }
        }
    })
}

#[capi]
fn ulistfmt_formatStringsToResult(
    listfmt: Option<&UListFormatter>,
    #[len(_count)] strings: StringPtrs,
    #[len(_count)] lengths: Lengths,
    _count: i32,
    uresult: Option<&mut UFormattedList>,
    status: ErrorCode,
) {
    status.run((), |_| {
        let result = uresult.non_null()?;
        let list = listfmt
            .non_null()?
            .format(&get_unicode_strings(strings, lengths)?);
        result.set(list)
    })
}
