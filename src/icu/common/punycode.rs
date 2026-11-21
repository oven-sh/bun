//! Punycode (RFC 3492) in lower case. ICU4C: punycode.cpp

use crate::common::memory::{Appendable, defer_oom};
use crate::common::sink::{CheckedArraySink, TextBuf, WritableAlias, stack_or_heap};
use crate::common::slice_ext::SliceExt;
use crate::common::utf16::{self, from_latin1};
use crate::common::utypes::{U_INPUT_TOO_LONG_ERROR, U_INVALID_CHAR_FOUND, UErrorCode};
use std::num::NonZeroU32;

const BASE: u32 = 36;
const TMIN: u32 = 1;
const TMAX: u32 = 26;
const SKEW: u32 = 38;
const DAMP: u32 = 700;
const INITIAL_BIAS: u32 = 72;
const INITIAL_N: u32 = 0x80;
const DELIMITER: u16 = b'-' as u16;

// Input limits, because both algorithms take quadratic time.
const ENCODE_MAX_CODE_UNITS: usize = 1000;
const DECODE_MAX_CHARS: usize = 2000;

/// Returns the threshold `t` of RFC 3492: a digit below `t` is the last digit of a variable-length integer.
fn threshold(k: u32, bias: u32) -> u32 {
    k.saturating_sub(bias).clamp(TMIN, TMAX)
}

/// `code_point_count` includes the current code point.
#[inline]
fn adapt_bias(delta: u32, code_point_count: NonZeroU32, is_first: bool) -> u32 {
    let mut delta = delta / if is_first { DAMP } else { 2 };
    delta += delta / code_point_count;
    let mut k = 0;
    while delta > ((BASE - TMIN) * TMAX) / 2 {
        delta /= BASE - TMIN;
        k += BASE;
    }
    k + (BASE - TMIN + 1) * delta / (delta + SKEW)
}

fn digit_to_basic(digit: u32) -> u16 {
    (match digit {
        0..=25 => u32::from(b'a') + digit,
        _ => u32::from(b'0') + digit - 26,
    }) as u16
}

fn basic_to_digit(unit: u16) -> Option<u32> {
    match u8::try_from(unit) {
        Ok(c @ b'a'..=b'z') => Some(u32::from(c - b'a')),
        Ok(c @ b'0'..=b'9') => Some(u32::from(c - b'0') + 26),
        _ => None,
    }
}

pub(crate) const ACE_PREFIX: [u16; 4] = from_latin1(b"xn--");

/// Returns an upper bound for the output length of `encode`. A delta below 2^31 has at most 10 digits.
pub(crate) const fn max_encoded_len(length: usize) -> usize {
    ACE_PREFIX.len() + 1 + 10 * length
}

/// Returns `ACE_PREFIX` and the encoded `text`, stored in `stack` if `max_encoded_len` units fit, else in `heap`.
pub(crate) fn encode<'a>(
    text: &[u16],
    stack: &'a mut [u16],
    heap: &'a mut Vec<u16>,
) -> Result<&'a [u16], UErrorCode> {
    const NO_CODE_POINT: u32 = u32::MAX;
    if text.len() > ENCODE_MAX_CODE_UNITS {
        return Err(U_INPUT_TOO_LONG_ERROR);
    }
    let buffer = stack_or_heap(max_encoded_len(text.len()), stack, heap)?;
    let mut dest = CheckedArraySink::new(buffer);
    dest.add_all(&ACE_PREFIX);
    // The smallest code point not yet encoded.
    let mut next = NO_CODE_POINT;
    let mut basic_count = 0;
    let mut i = 0;
    while let Some(&unit) = text.get(i) {
        if unit < 0x80 {
            dest.add(unit);
            basic_count += 1;
            i += 1;
            continue;
        }
        let c = utf16::next(text, &mut i);
        if utf16::is_surrogate(c) {
            return Err(U_INVALID_CHAR_FOUND);
        }
        next = next.min(c);
    }
    if basic_count > 0 {
        dest.add(DELIMITER);
    }

    // With at most 1000 code points up to U+10FFFF, `delta` stays below 2^31.
    let (mut n, mut delta, mut bias) = (INITIAL_N, 0, INITIAL_BIAS);
    let mut handled_count = basic_count;
    while next != NO_CODE_POINT {
        delta += (next - n) * (handled_count + 1);
        (n, next) = (next, NO_CODE_POINT);
        for c in utf16::code_points(text) {
            if c < n {
                delta += 1;
            } else if c > n {
                next = next.min(c);
            } else {
                let (mut q, mut k) = (delta, BASE);
                loop {
                    let t = threshold(k, bias);
                    if q < t {
                        break;
                    }
                    dest.add(digit_to_basic(t + (q - t) % (BASE - t)));
                    q = (q - t) / (BASE - t);
                    k += BASE;
                }
                dest.add(digit_to_basic(q));
                bias = adapt_bias(
                    delta,
                    NonZeroU32::MIN.saturating_add(handled_count),
                    handled_count == basic_count,
                );
                delta = 0;
                handled_count += 1;
            }
        }
        delta += 1;
        n += 1;
    }
    let length = dest.length();
    Ok(buffer.slice(..length))
}

/// Decodes `text`, which has no `ACE_PREFIX`, into the empty `dest`. Returns `None` if it is invalid or too long.
pub(crate) fn decode(text: &[u16], dest: &mut WritableAlias) -> Option<()> {
    if text.len() > DECODE_MAX_CHARS {
        return None;
    }
    let (basic, extended) = text.split_at(
        text.iter()
            .rposition(|&unit| unit == DELIMITER)
            .unwrap_or(0),
    );
    if basic.iter().any(|&unit| unit >= 0x80) {
        return None;
    }
    dest.add_all(basic);
    let mut units = extended.iter().skip(usize::from(!basic.is_empty()));

    let (mut c, mut i, mut bias) = (INITIAL_N, 0, INITIAL_BIAS);
    let mut code_point_count = NonZeroU32::MIN.saturating_add(basic.len() as u32);
    // Up to this index, code point indexes equal code unit indexes.
    let mut first_supplementary = usize::MAX;
    while let Some(mut unit) = units.next() {
        let (mut sum, mut weight, mut k) = (u64::from(i), 1, BASE);
        loop {
            let digit = basic_to_digit(*unit)?;
            sum += u64::from(digit) * weight;
            if sum > i32::MAX as u64 {
                return None;
            }
            let t = threshold(k, bias);
            if digit < t {
                break;
            }
            // `digit >= 1`, so `weight <= sum < 2^31`. The product needs no check.
            weight *= u64::from(BASE - t);
            k += BASE;
            unit = units.next()?;
        }
        let sum = sum as u32;
        bias = adapt_bias(sum - i, code_point_count, i == 0);

        // Both terms are below 2^31.
        c += sum / code_point_count;
        i = sum % code_point_count;
        if c > 0x10_ffff || utf16::is_surrogate(c) {
            return None;
        }
        let mut unit_index = i as usize;
        if unit_index > first_supplementary {
            unit_index = first_supplementary;
            utf16::fwd_n(
                dest.as_slice(),
                &mut unit_index,
                i as usize - first_supplementary,
            );
        } else if c > 0xffff {
            first_supplementary = unit_index;
        } else {
            first_supplementary = first_supplementary.saturating_add(1);
        }
        defer_oom(dest.open_gap(unit_index, utf16::length(c)))?;
        if c > 0xffff {
            dest.as_mut_slice()
                .copy_at(unit_index, &[utf16::lead(c), utf16::trail(c)]);
        } else {
            dest.as_mut_slice().set(unit_index, c as u16);
        }
        i += 1;
        code_point_count = code_point_count.saturating_add(1);
    }
    Some(())
}
