//! `unicode/uversion.h`, `unicode/icudataver.h`, `unicode/ulocdata.h`

use crate::capi::ffi::{ErrorCode, Out};
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::Subtag;
use crate::common::uresimp::ures_open_direct;
use bun_icu_macros::capi;
use std::ffi::c_ulong;

type UVersionInfo = [u8; 4];

/// Returns the low byte of `strtoul(text, &rest, 10)` and the rest, or `None` if there is no digit.
fn parse_field(text: &[u8]) -> Option<(u8, &[u8])> {
    let (is_negative, number) = match text.split_while(|c| matches!(c, b' ' | b'\t'..=b'\r')).1 {
        [b'-', number @ ..] => (true, number),
        [b'+', number @ ..] | number => (false, number),
    };
    let (digits, rest) = number.split_while(u8::is_ascii_digit);
    let value = digits.iter().try_fold(0, |value: c_ulong, digit| {
        value
            .checked_mul(10)?
            .checked_add(c_ulong::from(digit - b'0'))
    });
    let field = match value {
        Some(value) if is_negative => (value as u8).wrapping_neg(),
        Some(value) => value as u8,
        None => u8::MAX,
    };
    (!digits.is_empty()).then_some((field, rest))
}

/// Stores a version like "48.1". ICU4C: putil.cpp, u_versionFromUString
fn store_version(bundle: &[u8], key: &[u8], version: Out<'_, UVersionInfo>, status: ErrorCode<'_>) {
    const U_MAX_VERSION_STRING_LENGTH: usize = 20;
    status.run((), |_| {
        let text = ures_open_direct(None, bundle)?.get_string_by_key(key)?;
        let text = Subtag::<U_MAX_VERSION_STRING_LENGTH>::new(invariant_prefix(text.iter()));
        let mut rest = Some(&*text);
        version.set(std::array::from_fn(|_| {
            let (field, after) = rest.and_then(parse_field).unzip();
            rest = after.and_then(|after| after.strip_prefix(b"."));
            field.unwrap_or(0)
        }));
        Ok(())
    })
}

#[capi]
fn u_getVersion(version_array: Out<UVersionInfo>) {
    version_array.set([79, 1, 0, 0])
}

#[capi]
fn u_getDataVersion(data_version_fillin: Out<UVersionInfo>, status: ErrorCode) {
    store_version(b"icuver", b"DataVersion", data_version_fillin, status)
}

#[capi]
fn ulocdata_getCLDRVersion(version_array: Out<UVersionInfo>, status: ErrorCode) {
    store_version(b"supplementalData", b"cldrVersion", version_array, status)
}
