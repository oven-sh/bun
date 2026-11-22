//! Reading UTF-8. A maximal ill-formed subsequence counts as U+FFFD. ICU4C: unicode/utf8.h

use crate::common::slice_ext::SliceExt;

const U8_LEAD3_T1_BITS: [u8; 16] = [
    0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x10, 0x30, 0x30,
];

const U8_LEAD4_T1_BITS: [u8; 16] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1e, 0x0f, 0x0f, 0x0f, 0x00, 0x00, 0x00, 0x00,
];

/// Requires a `lead` in 0xe0..=0xef, or its low four bits.
#[inline(always)]
pub(crate) fn is_valid_lead3_and_t1(lead: u8, t1: u8) -> bool {
    U8_LEAD3_T1_BITS.at(usize::from(lead & 0xf)) & (1 << (t1 >> 5)) != 0
}

/// Requires a `lead` in 0xf0..=0xf4, or its low three bits.
#[inline(always)]
fn is_valid_lead4_and_t1(lead: u8, t1: u8) -> bool {
    U8_LEAD4_T1_BITS.at(usize::from(t1 >> 4)) & (1 << (lead & 7)) != 0
}

#[inline(always)]
pub(crate) fn is_single(c: u8) -> bool {
    c < 0x80
}

#[inline(always)]
pub(crate) fn is_trail(c: u8) -> bool {
    c & 0xc0 == 0x80
}

/// Returns 0 if `*i` is at or past the end of `s`.
#[inline(always)]
pub(crate) fn next_or_fffd(s: &[u8], i: &mut usize) -> u32 {
    const FFFD: u32 = 0xfffd;
    let mut c = u32::from(s.get(*i).copied().unwrap_or(0));
    *i += 1;
    if c < 0x80 {
        return c;
    }
    let Some(&(mut t)) = s.get(*i) else {
        return FFFD;
    };
    if c >= 0xe0 {
        if c < 0xf0 {
            if !is_valid_lead3_and_t1(c as u8, t) {
                return FFFD;
            }
            c &= 0xf;
            t &= 0x3f;
        } else {
            c -= 0xf0;
            if c > 4 || !is_valid_lead4_and_t1(c as u8, t) {
                return FFFD;
            }
            c = (c << 6) | u32::from(t & 0x3f);
            *i += 1;
            let Some(&t2) = s.get(*i) else { return FFFD };
            t = t2.wrapping_sub(0x80);
            if t > 0x3f {
                return FFFD;
            }
        }
        c = (c << 6) | u32::from(t);
        *i += 1;
        let Some(&last) = s.get(*i) else { return FFFD };
        t = last;
    } else {
        if c < 0xc2 {
            return FFFD;
        }
        c &= 0x1f;
    }
    t = t.wrapping_sub(0x80);
    if t > 0x3f {
        return FFFD;
    }
    *i += 1;
    (c << 6) | u32::from(t)
}

/// Requires `0 < *i <= s.len()`.
#[inline(always)]
pub(crate) fn prev_or_fffd(s: &[u8], i: &mut usize) -> u32 {
    *i = i.saturating_sub(1);
    let c = s.at(*i);
    if is_single(c) {
        u32::from(c)
    } else {
        prev_multibyte(s.slice(..*i + 1), i)
    }
}

/// `*i` is the index of the last byte of `s`, and moves to the start of the last sequence.
fn prev_multibyte(s: &[u8], i: &mut usize) -> u32 {
    let trails = s.iter().rev().take(3).take_while(|&&b| is_trail(b)).count();
    let start = i.saturating_sub(trails);
    let mut limit = start;
    let c = next_or_fffd(s, &mut limit);
    if limit != s.len() {
        return 0xfffd;
    }
    *i = start;
    c
}
