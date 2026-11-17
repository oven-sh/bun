//! The literals and matches of a compressed block.

use core::cell::Cell;
use core::hint::cold_path;

use bun_highway::zlib::{MATCH_SPAN, repeat};

use super::bits::{BitReader, REFILLED_BITS};
use super::tables::{DISTANCE_BITS, Entry, LITERAL_LENGTH_BITS, Special, Tables};
use super::window::{LAP, SLACK, Window};
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
    /// Too little is left of the input or in front of the limit.
    Limit,
}

/// What one round of `decode_fast()` may write before the match it ends with, plus one byte of that.
pub(super) const FAST_ROOM: usize = 4;
/// With less it does not get to the first round.
pub(super) const FAST_INPUT: usize = 16;

const CHUNK: usize = 32;

/// A match is read from one and written to another, and they may overlap.
type Span = [Cell<u8>; MATCH_SPAN];

#[inline(always)]
fn part<const N: usize>(cells: &[Cell<u8>], at: usize) -> Option<&[Cell<u8>; N]> {
    cells.get(at..at + N)?.try_into().ok()
}

#[inline(always)]
fn match_source(window: &[Cell<u8>], at: usize, distance: usize) -> Option<&Span> {
    let (from, is_in_last_lap) = (at as u32).overflowing_sub(distance as u32);
    let from = if is_in_last_lap {
        from.wrapping_add(LAP as u32)
    } else {
        from
    };
    part(window, from as usize)
}

/// May write up to `CHUNK - 1` bytes too many.
#[inline(always)]
fn copy_match(from: &Span, to: &Span, distance: usize, len: usize) {
    if distance < len.min(CHUNK) {
        return repeat(from, to, distance, len);
    }
    let copy_chunk = |at| {
        if let (Some(from), Some(to)) = (from.get(at..at + CHUNK), to.get(at..at + CHUNK)) {
            let bytes: [u8; CHUNK] = core::array::from_fn(|i| from.get(i).map_or(0, Cell::get));
            to.iter().zip(bytes).for_each(|(to, byte)| to.set(byte));
        }
    };
    copy_chunk(0);
    for at in (CHUNK..MAX_MATCH).step_by(CHUNK) {
        if at >= len {
            break;
        }
        copy_chunk(at);
    }
}

/// Goes on for as long as the window ends below `limit` and enough input is left for any symbol.
#[inline(always)]
pub(super) fn decode_fast(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    window: &mut Window,
    limit: usize,
    reach: Reach,
    last_distance: &Cell<usize>,
) -> Result<Stop> {
    if tables.literal_length_mask == u64::MAX {
        decode_fast_with::<false>(tables, bits, window, limit, reach, last_distance)
    } else {
        decode_fast_with::<true>(tables, bits, window, limit, reach, last_distance)
    }
}

enum Exit {
    Limit,
    EndOfBlock,
    Damaged(Damage),
    Internal,
}

/// The mask takes a register, of which there are too few.
#[inline(never)]
fn decode_fast_with<const MASK: bool>(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    window: &mut Window,
    limit: usize,
    reach: Reach,
    last_distance: &Cell<usize>,
) -> Result<Stop> {
    let position = &mut window.end;
    let window = Cell::from_mut(window.bytes.as_mut_slice()).as_slice_of_cells();
    let writable_end = limit + SLACK - 1;
    let mut writable = window.get(*position..writable_end).ok_or(Error::Internal)?;
    let (mut input, mut buffer) = (bits.rest, bits.buffer);
    // Only the lowest 6 bits are right.
    let mut count = bits.count;
    let mask = if MASK {
        tables.literal_length_mask % (1 << LITERAL_LENGTH_BITS)
    } else {
        u64::MAX
    };
    let surely_in_reach = reach.max.min(reach.available_at(*position));

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
            input = input.get((!count as usize / 8) % 8..).unwrap_or_default();
            count |= REFILLED_BITS;
        };
    }

    macro_rules! write_literals {
        ($entry:expr) => {
            if let [first, second, ..] = writable {
                let literals = $entry.literals();
                first.set(literals[0]);
                second.set(literals[1]);
            }
            writable = writable.get($entry.literal_count()..).unwrap_or_default();
        };
    }

    refill!(input.first_chunk().ok_or(Error::Internal)?);
    let mut entry = tables.literal_length.look_up(buffer & mask);
    let exit = loop {
        macro_rules! stop {
            ($exit:expr) => {{
                cold_path();
                break $exit;
            }};
        }
        let Some(mut word) = input.first_chunk() else {
            stop!(Exit::Limit);
        };
        if writable.len() < SLACK {
            stop!(Exit::Limit);
        }
        // The lookup comes first as all else waits for it.
        macro_rules! take_literals {
            () => {
                let literals = entry;
                skip!(literals.0);
                entry = tables.literal_length.look_up(buffer & mask);
                write_literals!(literals);
            };
        }

        if entry.is_only_literals() {
            take_literals!();
            if entry.is_only_literals() {
                take_literals!();
                refill!(word);
                continue;
            }
        }

        let (len, mut code);
        if entry.is_special() {
            if input.len() < 16 {
                stop!(Exit::Limit);
            }
            if let Special::Subtable = entry.kind() {
                skip!(LITERAL_LENGTH_BITS);
                entry = tables.literal_length.follow(entry, buffer);
                if entry.is_only_literals() {
                    take_literals!();
                    refill!(word);
                    continue;
                }
            }
            skip!(entry.0);
            len = if entry.is_special() {
                if !matches!(entry.kind(), Special::LengthWithExtraBits) {
                    stop!(match entry.kind() {
                        Special::EndOfBlock => Exit::EndOfBlock,
                        _ => Exit::Damaged(Damage::LiteralLengthCode),
                    });
                }
                let extra = entry.small_number(buffer) % 32;
                skip!(entry.small());
                entry.match_length() + extra
            } else {
                entry.match_length()
            };
            code = tables.distance.look_up(buffer);
            refill!(word);
            match input.first_chunk() {
                Some(next) => word = next,
                None => stop!(Exit::Internal),
            }
        } else {
            skip!(entry.0);
            code = tables.distance.look_up(buffer);
            write_literals!(entry);
            len = entry.match_length();
        }

        if code.entry().is_special() {
            if !matches!(code.entry().kind(), Special::Subtable) {
                stop!(Exit::Damaged(Damage::DistanceCode));
            }
            skip!(DISTANCE_BITS);
            code = tables.distance.follow(code.entry(), buffer);
        }
        let stream = buffer;
        skip!(code.entry().0);
        entry = tables.literal_length.look_up(buffer & mask);
        let distance = code.distance(stream);
        // A store, which the compiler does not move the lookup behind.
        last_distance.set(distance);
        let at = writable_end - writable.len();
        if distance > surely_in_reach && (distance > reach.max || distance > reach.available_at(at))
        {
            stop!(Exit::Damaged(Damage::DistanceTooFarBack));
        }
        refill!(word);
        let Some(from) = match_source(window, at, distance) else {
            stop!(Exit::Internal);
        };
        let Some(to) = writable.first_chunk() else {
            stop!(Exit::Internal);
        };
        copy_match(from, to, distance, len);
        writable = writable.get(len..).unwrap_or_default();
    };

    (bits.rest, bits.buffer, bits.count) = (input, buffer, count % u64::BITS);
    *position = writable_end - writable.len();
    match exit {
        Exit::Limit => Ok(Stop::Limit),
        Exit::EndOfBlock => Ok(Stop::EndOfBlock),
        Exit::Damaged(damage) => Err(damage.into()),
        Exit::Internal => Err(Error::Internal),
    }
}

enum Symbol {
    Literal(u8),
    EndOfBlock,
    Match { len: usize, distance: usize },
}

/// The next symbol and how many bits it takes, if they are all there.
#[inline(always)]
fn peek(tables: &Tables, bits: &mut BitReader<'_>) -> Result<Option<(Symbol, u32)>, Damage> {
    bits.refill();
    let (mut stream, mut used) = (bits.buffer, 0);
    let mut advance = |stream: &mut u64, count: u32| {
        *stream >>= count;
        used += count;
        (used <= bits.count).then_some(used)
    };
    let is_link = |entry: Entry| entry.is_special() && matches!(entry.kind(), Special::Subtable);

    let mut entry = tables
        .literal_length
        .look_up(stream & tables.literal_length_mask);
    if is_link(entry) {
        advance(&mut stream, LITERAL_LENGTH_BITS);
        entry = tables.literal_length.follow(entry, stream);
    }
    if entry.literal_count() != 0 {
        let used = advance(&mut stream, entry.small());
        return Ok(used.map(|used| (Symbol::Literal(entry.first_literal()), used)));
    }
    let Some(used) = advance(&mut stream, entry.bits()) else {
        return Ok(None);
    };
    let mut len = entry.match_length();
    if entry.is_special() {
        match entry.kind() {
            Special::LengthWithExtraBits => {}
            Special::EndOfBlock => return Ok(Some((Symbol::EndOfBlock, used))),
            _ => return Err(Damage::LiteralLengthCode),
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
    let Some(used) = advance(&mut stream, code.entry().bits()) else {
        return Ok(None);
    };
    if code.entry().is_special() {
        return Err(Damage::DistanceCode);
    }
    Ok(Some((Symbol::Match { len, distance }, used)))
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
    window: &mut Window,
    reach: Reach,
) -> Result<Step> {
    let Some((symbol, used)) = peek(tables, bits)? else {
        return Ok(Step::NeedsInput);
    };
    bits.skip(used);
    match symbol {
        Symbol::Literal(literal) => {
            *window.bytes.get_mut(window.end).ok_or(Error::Internal)? = literal;
            window.end += 1;
            Ok(Step::Literal)
        }
        Symbol::EndOfBlock => Ok(Step::EndOfBlock),
        Symbol::Match { distance, .. } if distance > reach.max => {
            Err(Damage::DistanceTooFarBack.into())
        }
        Symbol::Match { distance, .. } if distance > reach.available_at(window.end) => {
            Ok(Step::OutOfReach)
        }
        Symbol::Match { len, distance } => {
            let cells = Cell::from_mut(window.bytes.as_mut_slice()).as_slice_of_cells();
            let from = match_source(cells, window.end, distance).ok_or(Error::Internal)?;
            let to = part(cells, window.end).ok_or(Error::Internal)?;
            copy_match(from, to, distance, len);
            window.end += len;
            Ok(Step::Match(distance))
        }
    }
}

/// A match of the greatest length.
#[derive(Clone, Copy)]
pub(super) struct LongestMatch {
    pub(super) distance: usize,
    code: u64,
    code_bits: u32,
}

impl LongestMatch {
    pub(super) fn peek(tables: &Tables, bits: &mut BitReader<'_>) -> Option<Self> {
        match peek(tables, bits) {
            Ok(Some((Symbol::Match { len, distance }, code_bits))) if len == MAX_MATCH => {
                Some(Self {
                    distance,
                    code: bits.peek(code_bits),
                    code_bits,
                })
            }
            _ => None,
        }
    }

    /// Adds what it stands for to `len` for as long as it is next, and `len` is no more than `max`.
    pub(super) fn take_all(self, bits: &mut BitReader<'_>, mut len: usize, max: usize) -> usize {
        while len <= max && bits.has(self.code_bits) && bits.peek(self.code_bits) == self.code {
            bits.skip(self.code_bits);
            len += MAX_MATCH;
        }
        len
    }
}
