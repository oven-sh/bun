//! Radices that are powers of two. With `BITS` bits to a character, as many digits take 64 characters.

use bun_engine_text::CodeUnit;

use super::{packed, repeated};
use crate::Error;
use crate::digits::{digit_or_zero, unroll};

/// Ones in the low `bits` bits of each lane of `lane` bits.
const fn lanes(bits: usize, lane: usize) -> u64 {
    u64::MAX / (u64::MAX >> (64 - lane)) * ((1 << bits) - 1)
}

/// Of the low `8 * BITS` bits. Each step moves the high half of a lane down and the low half up.
#[inline(always)]
fn eight_characters<const BITS: usize>(value: u64) -> [u8; 8] {
    let spread = |value: u64, bits: usize, lane: usize| {
        (value >> bits & lanes(bits, lane)) | (value & lanes(bits, lane)) << (lane / 2)
    };
    let ones = spread(spread(spread(value, 4 * BITS, 64), 2 * BITS, 32), BITS, 16);
    let letters = (ones + repeated(0x80 - 10)) >> 7 & repeated(1);
    (ones + repeated(b'0') + letters * u64::from(b'a' - b'0' - 10)).to_le_bytes()
}

/// `out` has the length that the trimmed `value` takes, or that rounded up to a multiple of eight.
pub(super) fn write(out: &mut [u8], value: &[u64], bits: u32) {
    match bits {
        1 => write_groups::<1>(out, value),
        2 => write_groups::<2>(out, value),
        3 => write_groups::<3>(out, value),
        4 => write_groups::<4>(out, value),
        _ => write_groups::<5>(out, value),
    }
}

fn write_groups<const BITS: usize>(out: &mut [u8], value: &[u64]) {
    let (out, whole) = out.as_rchunks_mut::<64>();
    let (value_whole, value) = value.split_at(whole.len() * BITS);
    for (out, digits) in whole
        .iter_mut()
        .rev()
        .zip(value_whole.as_chunks::<BITS>().0)
    {
        let out = out.as_chunks_mut::<8>().0;
        unroll!(group in 0, 8 => {
            let (index, shift) = (group * BITS / 8, group * BITS % 8 * 8);
            let mut bits = digits[index] >> shift;
            if shift + 8 * BITS > 64 {
                bits |= digits[index + 1] << (64 - shift);
            }
            out[7 - group] = eight_characters::<BITS>(bits);
        });
    }
    let characters = |group: usize| {
        let (index, shift) = (group * BITS / 8, group * BITS % 8 * 8);
        let bits = digit_or_zero(value, index + 1).funnel_shr(value[index], shift as u32);
        eight_characters::<BITS>(bits)
    };
    let (first, groups) = out.as_rchunks_mut::<8>();
    for (group, out) in groups.iter_mut().rev().enumerate() {
        *out = characters(group);
    }
    if !first.is_empty() {
        for (out, character) in first
            .iter_mut()
            .rev()
            .zip(characters(groups.len()).into_iter().rev())
        {
            *out = character;
        }
    }
}

#[inline(always)]
fn read_eight<const BITS: usize>(characters: u64) -> Option<u64> {
    let ones = if BITS == 4 {
        let letters = characters >> 6 & repeated(1);
        let ones = (characters & repeated(0x0f)) + letters * 9;
        // What the characters are, in lower case, if they are right.
        let are_above_nine = (ones + repeated(6)) >> 4 & repeated(1);
        let expected = ones + repeated(b'0') + are_above_nine * u64::from(b'a' - b'0' - 10);
        if characters | letters << 5 != expected {
            return None;
        }
        ones
    } else {
        characters ^ repeated(b'0')
    };
    if ones & !lanes(BITS, 8) != 0 {
        return None;
    }
    let twos = (ones << BITS | ones >> 8) & lanes(2 * BITS, 16);
    let fours = (twos << (2 * BITS) | twos >> 16) & lanes(4 * BITS, 32);
    Some((fours << (4 * BITS) | fours >> 32) & lanes(8 * BITS, 64))
}

/// `out` has room for so many characters, and at most `bits` digits above those of whole groups of 64.
pub(super) fn read<T: CodeUnit>(out: &mut [u64], units: &[T], bits: u32) -> Result<(), Error> {
    match bits {
        1 => read_groups::<T, 1>(out, units),
        3 => read_groups::<T, 3>(out, units),
        _ => read_groups::<T, 4>(out, units),
    }
    .ok_or(Error::InvalidText)
}

fn read_groups<T: CodeUnit, const BITS: usize>(out: &mut [u64], units: &[T]) -> Option<()> {
    let (units, whole) = units.as_rchunks::<64>();
    let (out_whole, out) = out.split_at_mut(whole.len() * BITS);
    for (out, units) in out_whole
        .as_chunks_mut::<BITS>()
        .0
        .iter_mut()
        .zip(whole.iter().rev())
    {
        let groups = units.as_chunks::<8>().0;
        let mut digits = [0; BITS];
        unroll!(group in 0, 8 => {
            let (index, shift) = (group * BITS / 8, group * BITS % 8 * 8);
            let bits = read_eight::<BITS>(packed(&groups[7 - group]))?;
            digits[index] |= bits << shift;
            if shift + 8 * BITS > 64 {
                digits[index + 1] = bits >> (64 - shift);
            }
        });
        *out = digits;
    }
    let (first, groups) = units.as_rchunks::<8>();
    let padded = first.iter().fold(repeated(b'0'), |characters, unit| {
        characters >> 8 | u64::from(unit.to_u16().min(0xff)) << 56
    });
    let (mut pending, mut pending_bits) = (0u128, 0);
    let mut out = out.iter_mut();
    for characters in groups.iter().rev().map(packed).chain([padded]) {
        pending |= u128::from(read_eight::<BITS>(characters)?) << pending_bits;
        pending_bits += 8 * BITS;
        if pending_bits >= 64
            && let Some(out) = out.next()
        {
            *out = pending as u64;
            pending >>= 64;
            pending_bits -= 64;
        }
    }
    for out in out {
        *out = core::mem::take(&mut pending) as u64;
    }
    Some(())
}
