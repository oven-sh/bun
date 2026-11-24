//! The literals and matches of a compressed block.

use core::cell::Cell;
use core::hint::cold_path;

use bun_deflate::format::MAX_MATCH_LEN;
use bun_highway::with_bmi2;
use bun_highway::zlib::{Appender, Span, copy_match};

use super::Status;
use super::bits::{BitReader, REFILLED_BITS};
use super::tables::{DISTANCE_BITS, Entry, LITERAL_LENGTH_BITS, Special, Tables};
use super::window::{LAP, SLACK};
use crate::error::{Damage, Error, Result};

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
    /// Told apart from `LittleRoom` so that each gets a branch of its own.
    LittleInput,
    LittleRoom,
}

/// What one round of `decode_fast()` may write before the match it ends with, plus one byte of that.
pub(super) const FAST_ROOM: usize = 4;
/// With less it does not get to the first round.
pub(super) const FAST_INPUT: usize = 16;

/// What symbols are decoded to.
pub(super) trait Tape {
    fn position(&self) -> usize;
    /// With less than `SLACK` nothing more is to be written.
    fn room(&self) -> usize;
    fn push(&mut self, bytes: [u8; 4], count: usize);
    /// `false` if that is out of bounds.
    fn copy(&mut self, distance: usize, len: usize) -> bool;
}

impl Tape for Appender<'_> {
    #[inline(always)]
    fn position(&self) -> usize {
        self.position()
    }

    #[inline(always)]
    fn room(&self) -> usize {
        self.room()
    }

    #[inline(always)]
    fn push(&mut self, bytes: [u8; 4], count: usize) {
        self.push(bytes, count);
    }

    #[inline(always)]
    fn copy(&mut self, distance: usize, len: usize) -> bool {
        self.copy(distance, len)
    }
}

/// The window, or something that has all that is within reach in front of its end, which moves once this is dropped.
pub(super) struct Lap<'a> {
    all: &'a [Cell<u8>],
    rest: &'a [Cell<u8>],
    rest_end: usize,
    end: &'a mut usize,
    /// From an address to one that will be written to soon.
    output_offset: Option<usize>,
}

impl<'a> Lap<'a> {
    /// Nothing starts at or behind `limit`.
    #[inline(always)]
    pub(super) fn new(
        (bytes, end): (&'a mut [u8], &'a mut usize),
        limit: usize,
        output_offset: Option<usize>,
    ) -> Result<Self> {
        let all = Cell::from_mut(bytes).as_slice_of_cells();
        let rest_end = limit + SLACK - 1;
        Ok(Self {
            all,
            rest: all.get(*end..rest_end).ok_or(Error::Internal)?,
            rest_end,
            end,
            output_offset,
        })
    }

    #[inline(always)]
    fn match_source(&self, distance: usize) -> Option<&'a Span> {
        let (from, is_in_last_lap) = (self.position() as u32).overflowing_sub(distance as u32);
        let from = if is_in_last_lap {
            from.wrapping_add(LAP as u32)
        } else {
            from
        } as usize;
        self.all
            .get(from..from + size_of::<Span>())?
            .try_into()
            .ok()
    }
}

impl Tape for Lap<'_> {
    #[inline(always)]
    fn position(&self) -> usize {
        self.rest_end - self.rest.len()
    }

    #[inline(always)]
    fn room(&self) -> usize {
        self.rest.len()
    }

    #[inline(always)]
    fn push(&mut self, bytes: [u8; 4], count: usize) {
        if let [first, second, third, fourth, ..] = self.rest {
            first.set(bytes[0]);
            second.set(bytes[1]);
            third.set(bytes[2]);
            fourth.set(bytes[3]);
        }
        self.rest = self.rest.get(count..).unwrap_or_default();
    }

    #[inline(always)]
    fn copy(&mut self, distance: usize, len: usize) -> bool {
        let (Some(from), Some(to)) = (self.match_source(distance), self.rest.first_chunk()) else {
            return false;
        };
        copy_match(from, to, distance, len, self.output_offset);
        self.rest = self.rest.get(len..).unwrap_or_default();
        true
    }
}

impl Drop for Lap<'_> {
    #[inline(always)]
    fn drop(&mut self) {
        *self.end = self.position();
    }
}

macro_rules! fast_decoder {
    ($(#[$meta:meta])* $name:ident($($arg:ident: $type:ty),*; $reach:ident) => $tape:expr) => {
        $(#[$meta])*
        #[inline(always)]
        pub(super) fn $name(
            tables: &Tables,
            bits: &mut BitReader<'_>,
            $($arg: $type,)*
            $reach: Reach,
            last_distance: &Cell<usize>,
        ) -> Result<Stop> {
            with_bmi2! {
                /// The mask takes a register, of which there are too few.
                fn unmasked(
                    tables: &Tables,
                    bits: &mut BitReader<'_>,
                    $($arg: $type,)*
                    $reach: Reach,
                    last_distance: &Cell<usize>,
                ) -> Result<Stop> {
                    decode_fast::<false>(tables, bits, $tape, $reach, last_distance)
                }
            }
            with_bmi2! {
                fn masked(
                    tables: &Tables,
                    bits: &mut BitReader<'_>,
                    $($arg: $type,)*
                    $reach: Reach,
                    last_distance: &Cell<usize>,
                ) -> Result<Stop> {
                    decode_fast::<true>(tables, bits, $tape, $reach, last_distance)
                }
            }
            if tables.literal_length_mask == u64::MAX {
                unmasked(tables, bits, $($arg,)* $reach, last_distance)
            } else {
                masked(tables, bits, $($arg,)* $reach, last_distance)
            }
        }
    };
}

fast_decoder! {
    /// The arguments of `Lap::new()`.
    decode_to_slice(slice: (&mut [u8], &mut usize), limit: usize, output_offset: usize; reach)
        => Lap::new(slice, limit, Some(output_offset))?
}

fast_decoder! {
    /// Positions count from the first byte that is within reach.
    decode_to_vec(vec: &mut Vec<u8>, room: usize; reach)
        => Appender::new(vec, reach.from, room)
}

enum Exit {
    LittleInput,
    LittleRoom,
    EndOfBlock,
    Damaged(Damage),
    Internal,
}

/// Goes on for as long as there is room, and enough input for any symbol.
#[inline(always)]
fn decode_fast<const MASK: bool>(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    mut tape: impl Tape,
    reach: Reach,
    last_distance: &Cell<usize>,
) -> Result<Stop> {
    let (mut input, mut buffer) = (bits.rest, bits.buffer);
    // Only the lowest 6 bits are right.
    let mut count = bits.count;
    let mask = if MASK {
        tables.literal_length_mask % (1 << LITERAL_LENGTH_BITS)
    } else {
        u64::MAX
    };
    let surely_in_reach = reach.max.min(reach.available_at(tape.position()));

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
            tape.push($entry.literals(), $entry.literal_count());
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
            stop!(Exit::LittleInput);
        };
        if tape.room() < SLACK {
            stop!(Exit::LittleRoom);
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
                stop!(Exit::LittleInput);
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
        if distance > surely_in_reach
            && (distance > reach.max || distance > reach.available_at(tape.position()))
        {
            stop!(Exit::Damaged(Damage::DistanceTooFarBack));
        }
        refill!(word);
        if !tape.copy(distance, len) {
            stop!(Exit::Internal);
        }
    };

    (bits.rest, bits.buffer, bits.count) = (input, buffer, count % u64::BITS);
    match exit {
        Exit::LittleInput => Ok(Stop::LittleInput),
        Exit::LittleRoom => Ok(Stop::LittleRoom),
        Exit::EndOfBlock => Ok(Stop::EndOfBlock),
        Exit::Damaged(damage) => Err(damage.into()),
        Exit::Internal => Err(Error::Internal),
    }
}

enum Symbol {
    /// Only the first byte counts. Alone it is stored from a high-byte register, which some Raptor Lake CPUs get wrong:
    /// https://github.com/trifectatechfoundation/zlib-rs/issues/306
    Literal([u8; 4]),
    EndOfBlock,
    Match {
        len: usize,
        distance: usize,
    },
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
        return Ok(used.map(|used| (Symbol::Literal(entry.literals()), used)));
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
    tape: &mut impl Tape,
    reach: Reach,
) -> Result<Step> {
    let Some((symbol, used)) = peek(tables, bits)? else {
        return Ok(Step::NeedsInput);
    };
    bits.skip(used);
    match symbol {
        Symbol::Literal(literals) => {
            tape.push(literals, 1);
            Ok(Step::Literal)
        }
        Symbol::EndOfBlock => Ok(Step::EndOfBlock),
        Symbol::Match { distance, .. } if distance > reach.max => {
            Err(Damage::DistanceTooFarBack.into())
        }
        Symbol::Match { distance, .. } if distance > reach.available_at(tape.position()) => {
            Ok(Step::OutOfReach)
        }
        Symbol::Match { len, distance } if tape.copy(distance, len) => Ok(Step::Match(distance)),
        Symbol::Match { .. } => Err(Error::Internal),
    }
}

/// Where there is room for all that starts. `None` if that is used up.
#[inline(always)]
pub(super) fn decode_slowly(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    mut tape: impl Tape,
    reach: Reach,
) -> Result<Option<Status>> {
    while tape.room() >= SLACK {
        match decode_one(tables, bits, &mut tape, reach)? {
            Step::NeedsInput => return Ok(Some(Status::NeedsInput)),
            Step::EndOfBlock => return Ok(Some(Status::BlockEnd)),
            Step::Literal | Step::Match(_) => {}
            Step::OutOfReach => return Err(Damage::DistanceTooFarBack.into()),
        }
    }
    Ok(None)
}

pub(super) enum NoMatch {
    /// Only the first byte counts.
    Literal([u8; 4]),
    EndOfBlock,
}

/// Takes nothing else, nor a literal that there is no room for.
#[inline(always)]
pub(super) fn take_unless_match(
    tables: &Tables,
    bits: &mut BitReader<'_>,
    room: usize,
) -> Option<NoMatch> {
    let (taken, used) = match peek(tables, bits) {
        Ok(Some((Symbol::Literal(bytes), used))) if room != 0 => (NoMatch::Literal(bytes), used),
        Ok(Some((Symbol::EndOfBlock, used))) => (NoMatch::EndOfBlock, used),
        _ => return None,
    };
    bits.skip(used);
    Some(taken)
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
            Ok(Some((Symbol::Match { len, distance }, code_bits))) if len == MAX_MATCH_LEN => {
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
            len += MAX_MATCH_LEN;
        }
        len
    }
}
