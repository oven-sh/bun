//! The literals and matches of a compressed block.

use core::cell::Cell;

use super::bits::{BitReader, REFILLED_BITS};
use super::tables::{DISTANCE_BITS, Entry, LITERAL_LENGTH_BITS, Special, Tables};
use super::window::{LAP, SLACK};
use crate::array::At;
use crate::error::{Damage, Error, Result};
use crate::format::MAX_MATCH;

/// How far back a match may start.
#[derive(Clone, Copy)]
pub(super) struct Reach {
    /// What the header allows.
    pub(super) max: usize,
    /// So many bytes are there to copy from, at the position `from`.
    pub(super) available: usize,
    pub(super) from: usize,
}

impl Reach {
    #[inline(always)]
    fn available_at(self, position: usize) -> usize {
        self.available + (position - self.from)
    }
}

pub(super) enum Stop {
    EndOfBlock,
    /// Too little is left of the input or in front of the limit. If the last symbol was a match, this is its distance.
    Limit(usize),
}

/// What one round of `decode_fast()` may write before the match it ends with, plus one byte of that.
pub(super) const FAST_ROOM: usize = 4;

const CHUNK: usize = 32;
const HALF_CHUNK: usize = CHUNK / 2;

/// A match is read from one and written to another, and they may overlap.
type Span = [Cell<u8>; MATCH_SPAN];
const MATCH_SPAN: usize = 320;

#[inline(always)]
fn part<const N: usize>(cells: &[Cell<u8>], at: usize) -> Option<&[Cell<u8>; N]> {
    cells.get(at..at + N)?.try_into().ok()
}

#[inline(always)]
fn load<const N: usize>(cells: &[Cell<u8>; N]) -> [u8; N] {
    cells.each_ref().map(Cell::get)
}

#[inline(always)]
fn store<const N: usize>(cells: &[Cell<u8>; N], bytes: [u8; N]) {
    for (cell, byte) in cells.iter().zip(bytes) {
        cell.set(byte);
    }
}

/// In chunks of `N` bytes from `done` on, until they cover `len` bytes.
#[inline(always)]
fn copy_chunks<const N: usize>(from: &Span, to: &Span, mut done: usize, len: usize) {
    while done < len.min(MAX_MATCH)
        && let (Some(from), Some(to)) = (part::<N>(from, done), part(to, done))
    {
        store(to, load(from));
        done += N;
    }
}

#[inline(always)]
fn match_source(window: &[Cell<u8>], at: usize, distance: usize) -> Option<&Span> {
    let from = at.wrapping_sub(distance);
    let from = if distance > at {
        from.wrapping_add(LAP)
    } else {
        from
    };
    part(window, from as u32 as usize)
}

/// May write up to `CHUNK - 1` bytes too many.
#[inline(always)]
fn copy_match(from: &Span, to: &Span, distance: usize, len: usize) {
    if distance < len.min(CHUNK) {
        return repeat(from, to, distance, len);
    }
    if let (Some(from), Some(to)) = (from.first_chunk::<CHUNK>(), to.first_chunk()) {
        store(to, load(from));
    }
    copy_chunks::<CHUNK>(from, to, CHUNK, len);
}

/// By distance: what is left of half a chunk behind the whole periods, and how much those take of a chunk.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static PERIODS: [[u8; 2]; HALF_CHUNK] = {
    let mut periods = [[0; _]; _];
    let mut distance = 1;
    while distance < HALF_CHUNK {
        periods[distance] = [
            (HALF_CHUNK % distance) as u8,
            (CHUNK - CHUNK % distance) as u8,
        ];
        distance += 1;
    }
    periods
};

/// For a match that is longer than its distance, which is less than `CHUNK`.
#[cold]
#[inline(never)]
fn repeat(from: &Span, to: &Span, distance: usize, len: usize) {
    if distance >= HALF_CHUNK {
        return copy_chunks::<HALF_CHUNK>(from, to, 0, len);
    }
    if distance == 1 {
        let chunk = [from[0].get(); CHUNK];
        let mut done = 0;
        while done < len.min(MAX_MATCH)
            && let Some(to) = part(to, done)
        {
            store(to, chunk);
            done += CHUNK;
        }
        return;
    }
    let period = from.first_chunk().map_or([0; _], load);
    let mut bits = 8 * distance as u32;
    let mut lower = u128::from_le_bytes(period) & ((1 << bits) - 1);
    while bits < u128::BITS {
        lower |= lower << bits;
        bits *= 2;
    }
    let [rest, step] = *PERIODS.at(distance);
    let (rest, step) = (8 * u32::from(rest), usize::from(step));
    let upper = lower >> rest;
    let upper = upper | (upper << 1) << (u128::BITS - 1 - rest);
    let mut done = 0;
    while done < len.min(MAX_MATCH)
        && let (Some(first), Some(second)) = (part(to, done), part(to, done + HALF_CHUNK))
    {
        store(first, lower.to_le_bytes());
        store(second, upper.to_le_bytes());
        done += step;
    }
}

/// Goes on for as long as `position` is below `limit` and enough input is left for any symbol.
#[inline(never)]
pub(super) fn decode_fast(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    window: &mut [u8],
    position: &mut usize,
    limit: usize,
    reach: Reach,
) -> Result<Stop> {
    let window = Cell::from_mut(window).as_slice_of_cells();
    let writable = window.get(..limit + SLACK - 1).ok_or(Error::Internal)?;
    let input = bits.rest;
    let (mut taken, mut buffer, mut at) = (0u32, bits.buffer, *position as u32);
    // Only the lowest 6 bits are right.
    let mut count = bits.count;
    let surely_in_reach = reach.max.min(reach.available_at(*position));
    let input = input.get(..u32::MAX as usize / 2).unwrap_or(input);
    let next_word = |taken: u32| -> Option<&[u8; 8]> {
        input
            .get(taken as usize..taken as usize + 8)?
            .try_into()
            .ok()
    };

    macro_rules! skip {
        ($bits:expr) => {
            buffer = buffer.wrapping_shr($bits);
            count = count.wrapping_sub($bits);
        };
    }
    // All of `buffer` is bits of the stream afterwards.
    macro_rules! refill {
        ($word:expr) => {
            buffer |= u64::from_le_bytes(*$word).wrapping_shl(count);
            taken += (!count / 8) % 8;
            count |= REFILLED_BITS;
        };
    }

    let Some(word) = next_word(taken) else {
        return Ok(Stop::Limit(0));
    };
    refill!(word);
    let mut entry = tables.literal_length.look_up(buffer);
    let mut distance = 0;
    let stop = loop {
        let Some(mut word) = next_word(taken) else {
            break Ok(Stop::Limit(distance));
        };
        let Some(ahead) = part::<SLACK>(writable, at as usize) else {
            break Ok(Stop::Limit(distance));
        };
        // Evaluates to the room behind them.
        macro_rules! write_literals {
            ($room:expr) => {{
                skip!(entry.0);
                if let Some(room) = $room.first_chunk() {
                    store(room, entry.literals());
                }
                at += entry.literal_count() as u32;
                part($room, entry.literal_count())
            }};
        }
        macro_rules! next_round {
            () => {
                entry = tables.literal_length.look_up(buffer);
                refill!(word);
                continue;
            };
        }

        let is_literal = entry.is_only_literals();
        let ahead: Option<&[_; SLACK - 4]> = if is_literal {
            let behind = write_literals!(ahead);
            entry = tables.literal_length.look_up(buffer);
            behind
        } else {
            ahead.first_chunk()
        };
        let Some(ahead) = ahead else {
            break Err(Error::Internal);
        };
        if is_literal && entry.is_only_literals() {
            let _: Option<&Span> = write_literals!(ahead);
            next_round!();
        }

        let (len, to);
        if entry.is_special() {
            if next_word(taken + 8).is_none() {
                break Ok(Stop::Limit(0));
            }
            if let Special::Subtable = entry.kind() {
                skip!(LITERAL_LENGTH_BITS);
                entry = tables.literal_length.follow(entry, buffer);
                if entry.is_only_literals() {
                    let _: Option<&Span> = write_literals!(ahead);
                    next_round!();
                }
            }
            skip!(entry.0);
            len = if entry.is_special() {
                match entry.kind() {
                    Special::LengthWithExtraBits => {}
                    Special::EndOfBlock => break Ok(Stop::EndOfBlock),
                    _ => break Err(Damage::LiteralLengthCode.into()),
                }
                let extra = entry.small_number(buffer);
                skip!(entry.small());
                entry.match_length() + extra
            } else {
                entry.match_length()
            };
            refill!(word);
            match next_word(taken) {
                Some(next) => word = next,
                None => break Err(Error::Internal),
            }
            to = ahead.first_chunk();
        } else {
            len = entry.match_length();
            to = write_literals!(ahead);
        }

        let mut code = tables.distance.look_up(buffer);
        if code.entry().is_special() {
            if !matches!(code.entry().kind(), Special::Subtable) {
                break Err(Damage::DistanceCode.into());
            }
            skip!(DISTANCE_BITS);
            code = tables.distance.follow(code.entry(), buffer);
        }
        distance = code.distance(buffer);
        skip!(code.entry().0);
        if distance > surely_in_reach
            && (distance > reach.max || distance > reach.available_at(at as usize))
        {
            break Err(Damage::DistanceTooFarBack.into());
        }
        entry = tables.literal_length.look_up(buffer);
        refill!(word);
        let Some(from) = match_source(window, at as usize, distance) else {
            break Err(Error::Internal);
        };
        let Some(to) = to else {
            break Err(Error::Internal);
        };
        copy_match(from, to, distance, len);
        at += len as u32;
    };

    bits.rest = bits.rest.get(taken as usize..).unwrap_or_default();
    (bits.buffer, bits.count) = (buffer, count % u64::BITS);
    *position = at as usize;
    stop
}

pub(super) enum Step {
    NeedsInput,
    EndOfBlock,
    Literal,
    Match(usize),
    /// Further than `Reach::available`. Nothing has been written.
    OutOfReach,
}

/// One symbol, or a length and its distance. Takes no bits unless all that it needs are there.
#[inline(always)]
pub(super) fn decode_one(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    window: &mut [u8],
    position: &mut usize,
    reach: Reach,
) -> Result<Step> {
    bits.refill();
    let (mut stream, mut used) = (bits.buffer, 0);
    let mut advance = |stream: &mut u64, count: u32| {
        *stream >>= count;
        used += count;
        used <= bits.count
    };
    let is_link = |entry: Entry| entry.is_special() && matches!(entry.kind(), Special::Subtable);

    let mut entry = tables.literal_length.look_up(stream);
    if is_link(entry) {
        advance(&mut stream, LITERAL_LENGTH_BITS);
        entry = tables.literal_length.follow(entry, stream);
    }
    if entry.literal_count() != 0 {
        if !advance(&mut stream, entry.small()) {
            return Ok(Step::NeedsInput);
        }
        *window.get_mut(*position).ok_or(Error::Internal)? = entry.first_literal();
        *position += 1;
        bits.skip(used);
        return Ok(Step::Literal);
    }
    if !advance(&mut stream, entry.bits()) {
        return Ok(Step::NeedsInput);
    }
    let mut len = entry.match_length();
    if entry.is_special() {
        match entry.kind() {
            Special::LengthWithExtraBits => {}
            Special::EndOfBlock => {
                bits.skip(used);
                return Ok(Step::EndOfBlock);
            }
            _ => return Err(Damage::LiteralLengthCode.into()),
        }
        len += entry.small_number(stream);
        advance(&mut stream, entry.small());
    }

    let mut code = tables.distance.look_up(stream);
    if is_link(code.entry()) {
        advance(&mut stream, DISTANCE_BITS);
        code = tables.distance.follow(code.entry(), stream);
    }
    let distance = code.distance(stream);
    if !advance(&mut stream, code.entry().bits()) {
        return Ok(Step::NeedsInput);
    }
    if code.entry().is_special() {
        return Err(Damage::DistanceCode.into());
    }
    if distance > reach.max {
        return Err(Damage::DistanceTooFarBack.into());
    }
    bits.skip(used);
    if distance > reach.available_at(*position) {
        return Ok(Step::OutOfReach);
    }
    let window = Cell::from_mut(window).as_slice_of_cells();
    let from = match_source(window, *position, distance).ok_or(Error::Internal)?;
    let to = part(window, *position).ok_or(Error::Internal)?;
    copy_match(from, to, distance, len);
    *position += len;
    Ok(Step::Match(distance))
}
