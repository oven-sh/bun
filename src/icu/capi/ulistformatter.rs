//! `unicode/ulistformatter.h`

use crate::capi::ffi::raw::ulistformatter::{Lengths, StringPtrs};
use crate::capi::ffi::{CallerMem, Dest, ErrorCode, NonNullHandle, NulStr, UChar};
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
    cx: &'a CallerMem,
    strings: StringPtrs<'a>,
    lengths: Lengths<'a>,
) -> Result<Vec<&'a [UChar]>, UErrorCode> {
    strings.check()?;
    // Reserves for the stated count: with 32-bit pointers a slice is cut at the end of the address space.
    let mut items = memory::try_with_capacity(strings.length() as usize)?;
    items.add_each(
        cx.strings(strings, lengths)
            .map(|string| cx.text_or_empty(string)),
    );
    Ok(items)
}

#[capi]
fn ulistfmt_openForType(
    locale: NulStr<u8>,
    type_: c_int,
    width: c_int,
    status: ErrorCode,
) -> Option<Box<UListFormatter>> {
    status.open(|cx, _| {
        let style = STYLES
            .get(type_ as usize)
            .and_then(|it| it.get(width as usize));
        let style = style.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        ListFormatter::create_instance(&Locale::new(cx.c_str(locale)), style)
    })
}

#[capi]
fn ulistfmt_close(listfmt: Option<Box<UListFormatter>>) {
    drop(listfmt);
}

#[capi]
fn ulistfmt_openResult(ec: ErrorCode) -> Option<Box<UFormattedList>> {
    ec.open(|_, _| Ok(UFormattedValue::new_unset()))
}

#[capi]
fn ulistfmt_resultAsValue(
    uresult: Option<&UFormattedList>,
    ec: ErrorCode,
) -> *const UFormattedValue {
    ec.run_no_alloc(null(), |_, _| uresult.non_null().map(from_ref))
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
    status.run(-1, |cx, status| {
        result.check()?;
        match listfmt
            .non_null()?
            .format(&get_unicode_strings(cx, strings, lengths)?)
        {
            Ok(list) => Ok(cx.extract_to(list.text(), result, status)),
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
    status.run((), |cx, _| {
        let result = uresult.non_null()?;
        let list = listfmt
            .non_null()?
            .format(&get_unicode_strings(cx, strings, lengths)?);
        result.set(list)
    })
}
