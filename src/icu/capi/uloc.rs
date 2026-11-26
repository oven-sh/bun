//! `unicode/uloc.h`. Only `uloc_setDefault` takes a null string.

use crate::capi::ffi::raw::uloc::IdBuffer;
use crate::capi::ffi::{self, Dest, ErrorCode, NulStr, Out, UBool};
use crate::capi::uenum::{self, UEnumeration};
use crate::common::charstr::ByteSink;
use crate::common::locavailable::{uloc_count_available, uloc_get_available};
use crate::common::locid::uloc_set_default;
use crate::common::loclikely::{ulocimp_add_likely_subtags_to, ulocimp_minimize_subtags_to};
use crate::common::locresdata::uloc_get_character_orientation;
use crate::common::memory::try_box;
use crate::common::sink::CheckedArraySink;
use crate::common::slice_ext::{to_index, to_length};
use crate::common::uloc::*;
use crate::common::uloc_keytype::ulocimp_to_bcp_type;
use crate::common::uloc_tag::{
    LanguageTag, ulocimp_to_language_tag_to, ultag_is_unicode_locale_type,
};
use crate::common::unicode::uloc::{ULOC_LAYOUT_UNKNOWN, ULayoutType};
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::{CStr, c_char};
use std::ptr::null;

fn non_null(s: NulStr<'_, u8>) -> Result<&[u8], UErrorCode> {
    s.get().ok_or(U_UNSUPPORTED_ERROR)
}

/// Runs `write` on a sink over `buffer` and appends the NUL. If `write` fails, its partial output stays in `buffer`.
fn via_byte_sink(
    mut buffer: Dest<'_, u8>,
    status: &mut UErrorCode,
    write: &dyn Fn(&mut ByteSink) -> Result<(), UErrorCode>,
) -> Result<i32, UErrorCode> {
    buffer.check()?;
    let mut sink = CheckedArraySink::new(buffer.reborrow().cleared());
    write(&mut sink)?;
    let length = sink.length();
    Ok(buffer.terminate(length, status))
}

fn write_for_locale(
    locale_id: NulStr<'_, u8>,
    buffer: Dest<'_, u8>,
    status: ErrorCode<'_>,
    write: impl Fn(&[u8], &mut ByteSink) -> Result<(), UErrorCode>,
) -> i32 {
    status.run(0, |status| {
        let locale_id = buffer.apart(non_null(locale_id)?)?;
        via_byte_sink(buffer, status, &|sink| write(locale_id, sink))
    })
}

pub(crate) fn get_available(index: i32) -> *const c_char {
    ffi::on_oom(null(), || {
        uloc_get_available(to_index(index)).map_or(null(), CStr::as_ptr)
    })
}

pub(crate) fn count_available() -> i32 {
    ffi::on_oom(0, uloc_count_available) as i32
}

#[capi]
fn uloc_getKeywordValue(
    locale_id: NulStr<u8>,
    keyword_name: NulStr<u8>,
    (buffer, _): Dest<u8>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let keyword_name = buffer.apart(non_null(keyword_name)?)?;
        let locale_id = buffer.apart(non_null(locale_id)?)?;
        via_byte_sink(buffer, status, &|sink| {
            ulocimp_get_keyword_value_to(locale_id, keyword_name, sink)
        })
    })
}

#[capi]
fn uloc_setKeywordValue(
    keyword_name: NulStr<u8>,
    keyword_value: NulStr<u8>,
    (buffer, buffer_capacity): IdBuffer,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let (keyword_name, keyword_value) = (non_null(keyword_name)?, non_null(keyword_value)?);
        let id = buffer.text().filter(|_| buffer_capacity > 1);
        let id = id.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        let base_len = locale_get_keywords_start(id).unwrap_or(id.len());
        let keywords = id.get(base_len..).unwrap_or_default();
        let updated = ulocimp_set_keyword_value_of_keywords(keywords, keyword_name, keyword_value)?;
        let length = base_len + updated.len();
        // Nothing is written unless the NUL fits too.
        if length >= to_length(buffer_capacity) && !updated.is_empty() {
            *status = U_BUFFER_OVERFLOW_ERROR;
            return Ok(ffi::to_int32(length));
        }
        let mut buffer = buffer.into_dest();
        buffer.write_at(base_len, &updated);
        Ok(buffer.terminate(length, status))
    })
}

#[capi]
fn uloc_openKeywords(locale_id: NulStr<u8>, status: ErrorCode) -> Option<Box<UEnumeration>> {
    status.run(None, |_| {
        uloc_open_keywords(non_null(locale_id)?)?
            .map(|keywords| uenum::open_boxed(keywords).and_then(try_box))
            .transpose()
    })
}

#[capi]
fn uloc_getLanguage(locale_id: NulStr<u8>, (language, _): Dest<u8>, err: ErrorCode) -> i32 {
    write_for_locale(locale_id, language, err, |locale_id, sink| {
        uloc_get_language(locale_id).map(|language| sink.add_all(&language))
    })
}

#[capi]
fn uloc_getScript(locale_id: NulStr<u8>, (script, _): Dest<u8>, err: ErrorCode) -> i32 {
    write_for_locale(locale_id, script, err, |locale_id, sink| {
        uloc_get_script(locale_id).map(|script| sink.add_all(&script))
    })
}

#[capi]
fn uloc_getCountry(locale_id: NulStr<u8>, (country, _): Dest<u8>, err: ErrorCode) -> i32 {
    write_for_locale(locale_id, country, err, |locale_id, sink| {
        uloc_get_country(locale_id).map(|country| sink.add_all(&country))
    })
}

#[capi]
fn uloc_getBaseName(locale_id: NulStr<u8>, (name, _): Dest<u8>, err: ErrorCode) -> i32 {
    write_for_locale(locale_id, name, err, ulocimp_get_base_name_to)
}

#[capi]
fn uloc_canonicalize(locale_id: NulStr<u8>, (name, _): Dest<u8>, err: ErrorCode) -> i32 {
    write_for_locale(locale_id, name, err, ulocimp_canonicalize_to)
}

#[capi]
fn uloc_getDefault() -> *const c_char {
    ffi::ignore_oom(uloc_get_default).as_ptr()
}

#[capi]
fn uloc_setDefault(new_default_locale: NulStr<u8>, err: ErrorCode) {
    err.run((), |_| {
        uloc_set_default(new_default_locale.get());
        Ok(())
    })
}

#[capi]
fn uloc_toUnicodeLocaleType(keyword: NulStr<u8>, value: NulStr<u8>) -> *const c_char {
    let (Some(keyword), Some(text @ [_, ..])) = (keyword.get(), value.get()) else {
        return null();
    };
    match ffi::ignore_oom(|| ulocimp_to_bcp_type(keyword, text)) {
        Some(known) => known.as_ptr(),
        None if ultag_is_unicode_locale_type(text) => value.as_ptr().cast(),
        None => null(),
    }
}

/// `strict` is false.
#[capi]
fn uloc_toLanguageTag(
    locale_id: NulStr<u8>,
    (langtag, _): Dest<u8>,
    strict: UBool,
    status: ErrorCode,
) -> i32 {
    write_for_locale(locale_id, langtag, status, |locale_id, sink| {
        if strict != 0 {
            return Err(U_UNSUPPORTED_ERROR);
        }
        ulocimp_to_language_tag_to(locale_id, sink)
    })
}

#[capi]
fn uloc_forLanguageTag(
    langtag: NulStr<u8>,
    (locale_id, _): Dest<u8>,
    parsed_length: Out<i32>,
    status: ErrorCode,
) -> i32 {
    status.run(0, |status| {
        let tag = LanguageTag::new(non_null(langtag)?);
        let tag = tag.inspect_err(|_| parsed_length.set(0))?;
        parsed_length.set(tag.parsed_length() as i32);
        via_byte_sink(locale_id, status, &|sink| tag.to_locale_id(sink))
    })
}

#[capi]
fn uloc_addLikelySubtags(
    locale_id: NulStr<u8>,
    (maximized_locale_id, _): Dest<u8>,
    status: ErrorCode,
) -> i32 {
    write_for_locale(
        locale_id,
        maximized_locale_id,
        status,
        ulocimp_add_likely_subtags_to,
    )
}

#[capi]
fn uloc_minimizeSubtags(
    locale_id: NulStr<u8>,
    (minimized_locale_id, _): Dest<u8>,
    status: ErrorCode,
) -> i32 {
    write_for_locale(
        locale_id,
        minimized_locale_id,
        status,
        ulocimp_minimize_subtags_to,
    )
}

#[capi]
fn uloc_getAvailable(offset: i32) -> *const c_char {
    get_available(offset)
}

#[capi]
fn uloc_countAvailable() -> i32 {
    count_available()
}

#[capi]
fn uloc_getCharacterOrientation(locale_id: NulStr<u8>, status: ErrorCode) -> ULayoutType {
    status.run(ULOC_LAYOUT_UNKNOWN, |_| {
        uloc_get_character_orientation(non_null(locale_id)?)
    })
}
