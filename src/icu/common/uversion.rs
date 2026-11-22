//! Version numbers and their text. ICU4C: putil.cpp

use crate::common::slice_ext::SliceExt;
use std::ffi::c_ulong;

pub(crate) type UVersionInfo = [u8; 4];

/// `u_versionFromString`
pub(crate) fn parse(mut text: &[u8]) -> UVersionInfo {
    let mut version = UVersionInfo::default();
    for field in &mut version {
        let Some((value, rest)) = strtoul(text) else {
            break;
        };
        *field = value as u8;
        let Some((b'.', rest)) = rest.split_first() else {
            break;
        };
        text = rest;
    }
    version
}

/// Returns the decimal number at the start of `text` and the rest, or `None` if there is no digit.
fn strtoul(text: &[u8]) -> Option<(c_ulong, &[u8])> {
    let (_, text) = text.split_while(|c| matches!(c, b' ' | 0x09..=0x0d));
    let (negative, text) = match text {
        [b'-', rest @ ..] => (true, rest),
        [b'+', rest @ ..] => (false, rest),
        _ => (false, text),
    };
    let (digits, rest) = text.split_while(u8::is_ascii_digit);
    if digits.is_empty() {
        return None;
    }
    let value = digits
        .iter()
        .try_fold(0, |value: c_ulong, digit| {
            value
                .checked_mul(10)?
                .checked_add(c_ulong::from(digit - b'0'))
        })
        .map_or(c_ulong::MAX, |value| {
            if negative {
                value.wrapping_neg()
            } else {
                value
            }
        });
    Some((value, rest))
}
