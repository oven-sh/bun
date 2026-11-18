//! Puts up to seventeen digits, a sign, a point and an exponent in their places with a few wide stores.

use core::hint::select_unpredictable;

use crate::NUMBER_TEXT_CAPACITY;
use crate::digit_words::{ZEROS, store};
use crate::sixteen_digits::write_sixteen_digits;

type Buffer = [u8; NUMBER_TEXT_CAPACITY];

/// What a decimal number has besides the sixteen digits that start with its first nonzero one.
#[derive(Clone, Copy)]
pub(crate) struct Ending {
    /// A character, which only means something if `min_count` includes it.
    pub(crate) last: u8,
    /// Whether `last` takes the place of the sixteenth digit, a zero, or follows it.
    pub(crate) is_sixteenth: bool,
    /// So many digits are written even if they end in zeros.
    pub(crate) min_count: u8,
}

impl Ending {
    #[inline(always)]
    pub(crate) fn index(self) -> usize {
        16 - usize::from(self.is_sixteenth)
    }

    #[inline(always)]
    fn count(self, leading_count: usize) -> usize {
        let min_count = usize::from(self.min_count);
        select_unpredictable(min_count > leading_count, min_count, leading_count)
    }
}

/// With an exponent unless `point`, the number of digits that precede the decimal point, is from -5 to 21.
#[inline(always)]
pub(crate) fn write_decimal(
    out: &mut Buffer,
    is_negative: bool,
    leading: u64,
    ending: Ending,
    point: i32,
) -> usize {
    match point {
        -5..=7 => write_with_early_point(out, is_negative, leading, ending, point),
        8..=15 => write_with_late_point(out, is_negative, leading, ending, point),
        16..=21 => write_large(out, is_negative, leading, ending, point),
        _ => write_exponential(out, is_negative, leading, ending, point),
    }
}

#[derive(Clone, Copy)]
#[repr(align(16))]
struct Head {
    /// Selects the digits that do not make room for the point.
    kept: u64,
    kept_at: u8,
    moved_at: u8,
    point_at: u8,
}

static HEADS: [Head; 13] = {
    let mut heads = [Head {
        kept: u64::MAX,
        kept_at: 0,
        moved_at: 1,
        point_at: 1,
    }; 13];
    let mut index = 0;
    while index < 13 {
        if index < 6 {
            heads[index].kept_at = 7 - index as u8;
            heads[index].moved_at = 7 - index as u8;
        } else {
            heads[index].point_at = index as u8 - 5;
            heads[index].kept = (1 << (8 * (index - 5))) - 1;
        }
        index += 1;
    }
    heads
};

/// Every layout writes its digits where the buffer has room for all sixteen.
#[inline(always)]
fn sixteen_at(out: &mut Buffer, at: usize) -> &mut [u8; 16] {
    out[at..].first_chunk_mut().expect("room for the digits")
}

#[inline(always)]
fn write_with_early_point(
    out: &mut Buffer,
    is_negative: bool,
    leading: u64,
    ending: Ending,
    point: i32,
) -> usize {
    let start = usize::from(is_negative);
    let head = &HEADS[(point + 5) as usize];
    let moved_at = usize::from(head.moved_at & 7);
    let point_at = usize::from(head.point_at & 7);
    out[0] = b'-';
    store(out, start, ZEROS);
    let written = write_sixteen_digits(leading, sixteen_at(out, start + moved_at));
    out[start + moved_at + ending.index()] = ending.last;
    let first = written.first_eight;
    let merged = first & head.kept | (first << 8) & !head.kept;
    store(out, start + usize::from(head.kept_at & 7), merged);
    out[start + point_at] = b'.';
    let end = moved_at + ending.count(written.count);
    start + select_unpredictable(end > point_at + 1, end, point_at)
}

#[inline(never)]
fn write_with_late_point(
    out: &mut Buffer,
    is_negative: bool,
    leading: u64,
    ending: Ending,
    point: i32,
) -> usize {
    let start = usize::from(is_negative);
    let point = point as usize & 15;
    out[0] = b'-';
    let written = write_sixteen_digits(leading, sixteen_at(out, start + 1));
    out[start + 1 + ending.index()] = ending.last;
    let (second, moved) = (written.second_eight, u64::MAX << (point % 8 * 8));
    store(out, start + 8, second & !moved | (second << 8) & moved);
    out[start + point] = b'.';
    store(out, start, written.first_eight);
    let count = ending.count(written.count);
    start + select_unpredictable(count > point, count + 1, point)
}

#[inline(never)]
fn write_large(
    out: &mut Buffer,
    is_negative: bool,
    leading: u64,
    ending: Ending,
    point: i32,
) -> usize {
    let start = usize::from(is_negative);
    out[0] = b'-';
    write_sixteen_digits(leading, sixteen_at(out, start));
    store(out, start + 16, ZEROS);
    let needs_last = usize::from(ending.min_count) > ending.index();
    out[start + ending.index()] = select_unpredictable(needs_last, ending.last, b'0');
    if i32::from(ending.min_count) > point {
        out[start + 16..start + 18].copy_from_slice(&[b'.', ending.last]);
        return start + 18;
    }
    start + point as usize
}

#[inline(never)]
pub(crate) fn write_exponential(
    out: &mut Buffer,
    is_negative: bool,
    leading: u64,
    ending: Ending,
    point: i32,
) -> usize {
    let start = usize::from(is_negative);
    out[0] = b'-';
    let written = write_sixteen_digits(leading, sixteen_at(out, start + 1));
    out[start + 1 + ending.index()] = ending.last;
    out[start..start + 2].copy_from_slice(&[written.first_eight as u8, b'.']);
    let count = ending.count(written.count);
    write_exponent(point - 1, out, start + count + usize::from(count > 1))
}

/// The digits of each magnitude, and how many in the top byte.
static EXPONENTS: [u32; 325] = {
    let mut exponents = [0; 325];
    let mut n = 0;
    while n < 325 {
        let count = 1 + (n >= 10) as u32 + (n >= 100) as u32;
        let digits = (n / 100) | (n / 10 % 10) << 8 | (n % 10) << 16 | 0x30_3030;
        exponents[n as usize] = digits >> (24 - 8 * count) | count << 24;
        n += 1;
    }
    exponents
};

/// `e`, a sign and up to three digits in a word that goes at `at`. Returns where the text ends.
#[inline(always)]
pub(crate) fn write_exponent<const N: usize>(exponent: i32, out: &mut [u8; N], at: usize) -> usize {
    let is_negative = exponent < 0;
    let digits = EXPONENTS[select_unpredictable(is_negative, -exponent, exponent) as usize];
    let prefix = select_unpredictable(is_negative, *b"e-", *b"e+");
    let word = u64::from(u16::from_le_bytes(prefix)) | u64::from(digits) << 16;
    store(out, at, word);
    at + 2 + (digits >> 24) as usize
}
