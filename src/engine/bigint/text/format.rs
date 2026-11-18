use core::mem::MaybeUninit;

use bun_engine_text::{StringRef, StringWriter};

use super::powers::Halving;
use super::radix::{CHARACTERS_PER_BIT, CHUNK_DIVISORS, CHUNKS};
use super::{CHARACTERS, bit_groups, decimal, repeated};
use crate::digits::{self, DigitDivisor, unroll};
use crate::{BigIntRef, Error, Poll, Scratch, Work};

impl BigIntRef<'_> {
    /// How much room [`write_text`](Self::write_text) needs. `radix` is from 2 to 36.
    #[inline]
    pub fn max_text_length(self, radix: u32) -> usize {
        let characters = if radix.is_power_of_two() {
            let bits = digits::bit_length(self.digits).max(1);
            bits.div_ceil(radix.ilog2() as usize)
        } else {
            chunk_count(self.digits, radix) * CHUNKS[radix as usize].characters
        };
        characters + usize::from(self.is_negative)
    }

    /// BigInt::toString of ECMA-262. Returns the text, which ends where `out` ends.
    pub fn write_text<'a>(
        self,
        radix: u32,
        out: &'a mut [u8],
        poll: Poll<'_>,
    ) -> Result<&'a [u8], Error> {
        self.write_text_with(radix, out, &mut Work::new(poll))
    }

    fn write_text_with<'a>(
        self,
        radix: u32,
        out: &'a mut [u8],
        work: &mut Work<'_>,
    ) -> Result<&'a [u8], Error> {
        let mut start = out.len() + usize::from(self.is_negative) - self.max_text_length(radix);
        let characters = &mut out[start..];
        if self.is_zero() {
            start = out.len() - 1;
            out[start] = b'0';
        } else if radix.is_power_of_two() {
            bit_groups::write(characters, self.digits, radix.ilog2());
        } else {
            write_chunks(characters, self.digits, radix, work)?;
            start += leading_zero_count(characters);
        }
        if self.is_negative {
            start -= 1;
            out[start] = b'-';
        }
        Ok(&out[start..])
    }

    /// BigInt::toString of ECMA-262.
    pub fn to_string_ref(self, radix: u32, poll: Poll<'_>) -> Result<StringRef, Error> {
        let copy = |text: &[u8]| match *text {
            [character] => Ok(StringRef::single_character(character)),
            _ => StringRef::try_from_units(text).map_err(|_| Error::OutOfMemory),
        };
        if let [digit] = *self.digits {
            let mut text = [0; MAX_DIGIT_TEXT_LENGTH];
            let start = write_digit(&mut text, digit, radix) - 1;
            text[start] = b'-';
            return copy(&text[start + usize::from(!self.is_negative)..]);
        }
        let length = self.max_text_length(radix);
        if radix.is_power_of_two() && length > 1 {
            let mut writer = StringWriter::try_new(length).map_err(|_| Error::OutOfMemory)?;
            self.write_text(radix, writer.push_repeated(b'0', length), poll)?;
            return Ok(writer.finish());
        }
        let (mut scratch, work) = (Scratch::<u8, 1024>::new(), &mut Work::new(poll));
        let out = scratch.filled(b'0', length, work)?;
        copy(self.write_text_with(radix, out, work)?)
    }
}

/// With room for a sign, in groups of eight.
const MAX_DIGIT_TEXT_LENGTH: usize = 72;

/// Writes at the end of `out`, and returns where the text starts.
#[inline(always)]
fn write_digit(out: &mut [u8; MAX_DIGIT_TEXT_LENGTH], digit: u64, radix: u32) -> usize {
    if radix == 10 {
        return decimal::write_digit(out, digit);
    }
    if radix.is_power_of_two() {
        let length = digit.bit_width().div_ceil(radix.ilog2()) as usize;
        let room = out.len() - length.next_multiple_of(8);
        bit_groups::write(&mut out[room..], &[digit], radix.ilog2());
        return out.len() - length;
    }
    let (divisor, chunk) = (CHUNK_DIVISORS[radix as usize], CHUNKS[radix as usize]);
    let mut start = out.len() - chunk.characters;
    let mut left = 0;
    let top = divisor.divide_next(&mut left, digit);
    write_chunk(&mut out[start..], left, divisor, radix);
    if top == 0 {
        return start + leading_zero_count(&out[start..]);
    }
    start -= 1;
    out[start] = CHARACTERS[top as usize];
    start
}

/// Enough for any value of this many bits.
#[inline]
fn chunk_count(value: &[u64], radix: u32) -> usize {
    let bits = digits::bit_length(value) as u64;
    let characters = ((bits * CHARACTERS_PER_BIT[radix as usize]) >> 32) as usize + 1;
    if radix == 10 {
        characters.div_ceil(decimal::CHUNK_LENGTH)
    } else {
        characters.div_ceil(CHUNKS[radix as usize].characters)
    }
}

/// Not all characters are zeros.
#[inline]
fn leading_zero_count(characters: &[u8]) -> usize {
    let mut count = 0;
    while let Some(group) = characters[count..].first_chunk() {
        let others = u64::from_le_bytes(*group) ^ repeated(b'0');
        if others != 0 {
            return count + others.trailing_zeros() as usize / 8;
        }
        count += 8;
    }
    let rest = characters[count..].iter();
    count + rest.take_while(|&&character| character == b'0').count()
}

/// Fills `out`, which is a number of chunks long.
#[inline]
fn write_chunks(
    out: &mut [u8],
    value: &[u64],
    radix: u32,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    const MAX_WHOLE_LENGTH: usize = 44;
    if let Some(copy) = [MaybeUninit::uninit(); MAX_WHOLE_LENGTH].get_mut(..value.len()) {
        write_piece(out, copy.write_copy_of_slice(value), radix);
        return Ok(());
    }
    write_in_pieces(out, value, radix, work)
}

fn write_in_pieces(
    out: &mut [u8],
    value: &[u64],
    radix: u32,
    work: &mut Work<'_>,
) -> Result<(), Error> {
    const MAX_PIECE_LENGTH: usize = 32;
    let chunk = CHUNKS[radix as usize];
    let halving = Halving::new(chunk_count(value, radix), MAX_PIECE_LENGTH);
    let mut scratch = Scratch::<u64, 128>::new();
    let pieces = scratch.filled(0, halving.length(), work)?;
    pieces[..value.len()].copy_from_slice(value);
    let mut scratch = Scratch::<u64, 128>::new();
    for power in halving.powers(chunk.power, &mut scratch, work)?.rev() {
        digits::divide_each(pieces, power.half, power.digits, power.zeros, work)?;
    }
    let texts = out.rchunks_mut(halving.piece_length * chunk.characters);
    for (out, piece) in texts.zip(pieces.chunks_exact_mut(halving.piece_length)) {
        work.spend(4 * piece.len() * piece.len())?;
        write_piece(out, piece, radix);
    }
    Ok(())
}

fn write_piece(out: &mut [u8], piece: &mut [u64], radix: u32) {
    if radix == 10 {
        const DIVISOR: DigitDivisor = DigitDivisor::new(CHUNKS[10].power);
        let out = out.as_chunks_mut().0.iter_mut().rev();
        for_each_chunk(out, piece, DIVISOR, decimal::write_chunk);
        return;
    }
    let divisor = CHUNK_DIVISORS[radix as usize];
    let out = out.rchunks_exact_mut(CHUNKS[radix as usize].characters);
    for_each_chunk(out, piece, divisor, |out, value| {
        write_chunk(out, value, divisor, radix);
    });
}

/// The chunk over its power yields one character each time it is multiplied by the radix.
#[inline(always)]
fn write_chunk(out: &mut [u8], mut value: u64, divisor: DigitDivisor, radix: u32) {
    let mut fraction = divisor.divide_next(&mut value, 0) + 1;
    for out in out {
        let character;
        (fraction, character) = fraction.carrying_mul(u64::from(radix), 0);
        *out = CHARACTERS[character as usize];
    }
}

/// Divides again and again, and writes the remainders as [`DigitDivisor::divide_next`] leaves them. Each division
/// waits for the one before it in its run, so several runs go on at once.
#[inline(always)]
fn for_each_chunk<T>(
    mut out: impl ExactSizeIterator<Item = T>,
    mut value: &mut [u64],
    divisor: DigitDivisor,
    write: impl Fn(T, u64),
) {
    const RUNS: usize = 4;
    while out.len() >= RUNS && value.len() >= RUNS {
        let mut left = [0; RUNS];
        for digit in value.iter_mut().rev() {
            unroll!(run in 0, RUNS => {
                *digit = divisor.divide_next(&mut left[run], *digit);
            });
        }
        for (left, out) in left.into_iter().zip(&mut out) {
            write(out, left);
        }
        let length = digits::trim(value).len();
        value = &mut value[..length];
    }
    for out in out {
        let mut left = 0;
        for digit in value.iter_mut().rev() {
            *digit = divisor.divide_next(&mut left, *digit);
        }
        write(out, left);
        if let [rest @ .., 0] = value {
            value = rest;
        }
    }
}
