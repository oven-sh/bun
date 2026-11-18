use core::hint::cold_path;

use bun_engine_text::{CodeUnit, Cursor};

use crate::NUMBER_TEXT_CAPACITY;
use crate::digit_words::{eight_digits, split_sixteen_digits, store};
use crate::powers_of_ten::SMALL_POWERS;

type Buffer = [u8; NUMBER_TEXT_CAPACITY];

const EIGHT_DIGITS: u64 = 100_000_000;
const SIXTEEN_DIGITS: u64 = EIGHT_DIGITS * EIGHT_DIGITS;

/// How many digits `number` has.
#[inline]
pub fn decimal_length(number: u64) -> usize {
    let bits = 64 - (number | 1).leading_zeros();
    let at_least = ((bits * 1233) >> 12) as usize;
    at_least + usize::from(number | 1 >= SMALL_POWERS[at_least])
}

/// Returns the length of the text, which starts the buffer.
#[inline]
pub fn write_i32(number: i32, out: &mut Buffer) -> usize {
    write_integer(number < 0, u64::from(number.unsigned_abs()), out)
}

/// Returns the length of the text, which starts the buffer.
#[inline]
pub fn write_u32(number: u32, out: &mut Buffer) -> usize {
    write_integer(false, u64::from(number), out)
}

/// Returns the length of the text, which starts the buffer.
#[inline]
pub fn write_i64(number: i64, out: &mut Buffer) -> usize {
    write_integer(number < 0, number.unsigned_abs(), out)
}

/// Returns the length of the text, which starts the buffer.
#[inline]
pub fn write_u64(number: u64, out: &mut Buffer) -> usize {
    write_integer(false, number, out)
}

#[inline(always)]
pub(crate) fn write_integer(is_negative: bool, magnitude: u64, out: &mut Buffer) -> usize {
    if magnitude < EIGHT_DIGITS {
        return write_short(is_negative, magnitude as u32, out);
    }
    write_long(is_negative, magnitude, out)
}

fn write_long(is_negative: bool, magnitude: u64, out: &mut Buffer) -> usize {
    if magnitude < SIXTEEN_DIGITS {
        let (upper, lower) = split_sixteen_digits(magnitude);
        let at = write_short(is_negative, upper, out);
        store(out, at, eight_digits(lower));
        return at + 8;
    }
    let (middle, lower) = split_sixteen_digits(magnitude % SIXTEEN_DIGITS);
    let at = write_short(is_negative, (magnitude / SIXTEEN_DIGITS) as u32, out);
    store(out, at, eight_digits(middle));
    store(out, at + 8, eight_digits(lower));
    at + 16
}

/// A number below 10^8.
#[inline(always)]
fn write_short(is_negative: bool, magnitude: u32, out: &mut Buffer) -> usize {
    let start = usize::from(is_negative);
    out[0] = b'-';
    let mut put = |characters: &[u8], count: usize| {
        out[start..start + characters.len()].copy_from_slice(characters);
        start + count
    };
    match ShortDecimal::of_short(magnitude) {
        ShortDecimal::Two(characters, count) => put(&characters.to_le_bytes(), count),
        ShortDecimal::Four(characters, count) => put(&characters.to_le_bytes(), count),
        ShortDecimal::Eight(characters, count) => put(&characters.to_le_bytes(), count),
    }
}

/// What `push_i32` may overwrite behind the text.
pub const INTEGER_TEXT_SLACK: usize = 3;

/// With the sign.
#[inline(always)]
pub fn i32_text_length(number: i32) -> usize {
    usize::from(number < 0) + decimal_length(number.unsigned_abs().into())
}

#[inline(always)]
pub fn push_i32<T: CodeUnit>(number: i32, to: &mut Cursor<'_, T>) {
    if number < 0 {
        cold_path();
        to.push(b'-'.into());
    }
    let magnitude = number.unsigned_abs();
    if u64::from(magnitude) >= EIGHT_DIGITS {
        let (upper, lower) = split_sixteen_digits(magnitude.into());
        let unused = u32::from(upper < 10);
        let characters = (two_digits(upper) >> (unused * 8)) as u16;
        to.push_latin1_prefix(&characters.to_le_bytes(), 2 - unused as usize);
        return to.push_latin1_prefix(&eight_digits(lower).to_le_bytes(), 8);
    }
    match ShortDecimal::of_short(magnitude) {
        ShortDecimal::Two(it, count) => to.push_latin1_prefix(&it.to_le_bytes(), count),
        ShortDecimal::Four(it, count) => to.push_latin1_prefix(&it.to_le_bytes(), count),
        ShortDecimal::Eight(it, count) => to.push_latin1_prefix(&it.to_le_bytes(), count),
    }
}

/// The characters of a number, the first one in the lowest byte, and how many there are.
enum ShortDecimal {
    Two(u16, usize),
    Four(u32, usize),
    Eight(u64, usize),
}

impl ShortDecimal {
    #[inline(always)]
    fn of_short(number: u32) -> ShortDecimal {
        if number < 100 {
            let unused = u32::from(number < 10);
            let characters = (two_digits(number) >> (unused * 8)) as u16;
            ShortDecimal::Two(characters, 2 - unused as usize)
        } else if number < 10_000 {
            let unused = u32::from(number < 1000);
            let characters = four_digits(number) >> (unused * 8);
            ShortDecimal::Four(characters, 4 - unused as usize)
        } else {
            let unused = u32::from(number < 100_000)
                + u32::from(number < 1_000_000)
                + u32::from(number < 10_000_000);
            ShortDecimal::Eight(eight_digits(number) >> (unused * 8), 8 - unused as usize)
        }
    }
}

#[inline(always)]
fn four_digits(number: u32) -> u32 {
    let upper = (number * 5243) >> 19;
    two_digits(upper) | two_digits(number - upper * 100) << 16
}

#[inline(always)]
fn two_digits(number: u32) -> u32 {
    static PAIRS: [u16; 256] = {
        let mut pairs = [0; 256];
        let mut n = 0;
        while n < 100 {
            pairs[n as usize] = u16::from_le_bytes([b'0' + n / 10, b'0' + n % 10]);
            n += 1;
        }
        pairs
    };
    u32::from(PAIRS[usize::from(number as u8)])
}
