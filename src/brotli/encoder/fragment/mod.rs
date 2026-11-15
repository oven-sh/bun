//! Qualities 0 and 1 compress each piece of input on its own, without copying it.

mod one_pass;
mod two_pass;

use core::ops::ControlFlow;

use one_pass::OnePass;
use two_pass::TwoPass;

use super::bit_stream::{write_empty_last, write_uncompressed};
use super::bit_writer::{BitWriter, Bits};
use super::command::{combine_length_codes, copy_length_code, insert_length_code};
use super::huffman::{Code, Lengths, TreeBuilder, assign_codes};
use super::matching::{HASH_MULTIPLIER_32, load64, match_length};
use super::params::FAST_WINDOW_BITS;
use super::try_reserve_for;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, INSERT_LENGTH_CODES, LengthCode, SHORT_COPY_END, WINDOW_GAP,
};
use crate::memory::{self, Result};

/// Half of the symbols stand for commands, and half for distances.
const SYMBOLS: usize = 128;
const FIRST_COPY_AT_LAST_DISTANCE: usize = 24;
const FIRST_COPY: usize = 40;
const FIRST_DISTANCE: usize = 64;
/// From here on, the length has too many extra bits to be written together with the distance.
const HUGE_COPY: u32 = COPY_LENGTH_CODES[23].base as u32;

/// A command has either literals and a copy of two bytes, or a copy alone.
#[derive(Clone, Copy)]
struct Token {
    symbol: usize,
    /// In the range that the symbol stands for.
    value: usize,
}

impl Token {
    /// Inserting no literals does not come up, so the symbol has no code.
    const NONE: Self = Self {
        symbol: 0,
        value: 0,
    };
    const LAST_DISTANCE: Self = Self {
        symbol: FIRST_DISTANCE,
        value: 0,
    };

    #[inline(always)]
    fn insert(length: usize) -> Self {
        Self {
            symbol: insert_length_code(length),
            value: length,
        }
    }

    /// `first` is the symbol for two bytes.
    #[inline(always)]
    fn copy(first: usize, length: usize) -> Self {
        Self {
            symbol: first + copy_length_code(length),
            value: length,
        }
    }

    /// Two symbols for each power of two.
    #[inline(always)]
    fn distance(distance: u32) -> Self {
        let value = distance as usize + 3;
        let extra_bits = value.ilog2() - 1;
        Self {
            symbol: FIRST_DISTANCE + 12 + 2 * extra_bits as usize + (value >> extra_bits),
            value,
        }
    }
}

/// The lowest value and the number of extra bits of each symbol.
const RANGES: [(u32, u32); SYMBOLS] = {
    const fn range(code: LengthCode) -> (u32, u32) {
        (code.base as u32, code.extra_bits as u32)
    }
    let mut ranges = [(0, 0); SYMBOLS];
    let mut i = 0;
    while i < 24 {
        ranges[i] = range(INSERT_LENGTH_CODES[i]);
        ranges[FIRST_COPY_AT_LAST_DISTANCE + i % 16] = range(COPY_LENGTH_CODES[i % 16]);
        ranges[FIRST_COPY + i] = range(COPY_LENGTH_CODES[i]);
        ranges[FIRST_DISTANCE + 16 + 2 * i] = (4 << i, i as u32 + 1);
        ranges[FIRST_DISTANCE + 17 + 2 * i] = (6 << i, i as u32 + 1);
        i += 1;
    }
    ranges
};

/// From the low bits: the length of the code, the length with the extra bits (8 bits each), `code - (base << length)`.
struct TokenCodes([i64; SYMBOLS]);

impl TokenCodes {
    const fn new(codes: &[Code; SYMBOLS]) -> Self {
        let mut packed = [0; SYMBOLS];
        let mut i = 0;
        while i < SYMBOLS {
            let (code, (base, extra_bits)) = (codes[i].bits(), RANGES[i]);
            let addend = code.value as i64 - ((base as i64) << code.count);
            packed[i] = (addend << 16) | (((code.count + extra_bits) << 8) | code.count) as i64;
            i += 1;
        }
        Self(packed)
    }

    #[inline(always)]
    fn bits(&self, token: Token) -> Bits {
        let packed = self.0[token.symbol % SYMBOLS];
        let shifted = (token.value as u64) << (packed & 63);
        Bits::new(
            u32::from((packed >> 8) as u8),
            shifted.wrapping_add_signed(packed >> 16),
        )
    }
}

trait Sink {
    /// Whether the literals in `start..end` are not worth compressing. Asked before each insert.
    fn refuses(&mut self, start: usize, end: usize) -> bool;

    /// The command that inserts all but the last [`WINDOW_GAP`] bytes.
    fn insert(&mut self, padded: &[u8]);

    /// They have no more than 56 bits.
    fn tokens(&mut self, first: Token, second: Token);
}

#[derive(Default)]
struct Table(Vec<u32>);

impl Table {
    fn cleared<const SIZE: usize>(&mut self) -> Result<&mut [u32; SIZE]> {
        self.0.clear();
        memory::try_reserve(&mut self.0, SIZE)?;
        self.0.resize(SIZE, 0);
        self.0.first_chunk_mut().ok_or(memory::AllocError)
    }
}

fn table_bits(input_size: usize, max_bits: u32) -> u32 {
    input_size.next_power_of_two().ilog2().clamp(8, max_bits)
}

/// The bytes at a position.
type Chunk = [u8; WINDOW_GAP];

#[inline(always)]
fn chunk_at(input: &[u8], at: u32) -> Option<&Chunk> {
    input.get(at as usize..at as usize + WINDOW_GAP)?.as_array()
}

#[inline(never)]
fn long_match_length(input: &[u8], at: u32, distance: u32) -> u32 {
    match_length(&input[(at - distance) as usize..], &input[at as usize..]) as u32
}

struct Finder<'a, const TABLE_SIZE: usize, const MIN_MATCH: usize> {
    block: &'a [u8],
    /// Has a chunk for each position that a match may start at.
    searched: &'a [u8],
    table: &'a mut [u32; TABLE_SIZE],
}

struct Comparison {
    distance: u32,
    /// Zero for a match.
    obstacles: u64,
    /// The bits that differ after the bytes that have to match.
    difference: u64,
}

impl<const TABLE_SIZE: usize, const MIN_MATCH: usize> Finder<'_, TABLE_SIZE, MIN_MATCH> {
    const IGNORED_BITS: u32 = 64 - 8 * MIN_MATCH as u32;

    #[inline(always)]
    fn slot(&mut self, bytes: u64) -> &mut u32 {
        let hash = (bytes << Self::IGNORED_BITS).wrapping_mul(u64::from(HASH_MULTIPLIER_32));
        &mut self.table[(hash >> (64 - TABLE_SIZE.ilog2())) as usize]
    }

    #[inline(always)]
    fn compare(ours: &Chunk, theirs: &Chunk, distance: u32) -> Comparison {
        Comparison {
            distance,
            obstacles: ((load64(ours, 0) ^ load64(theirs, 0)) << Self::IGNORED_BITS)
                | u64::from((distance + WINDOW_GAP as u32 - 1) >> FAST_WINDOW_BITS),
            difference: load64(ours, MIN_MATCH) ^ load64(theirs, MIN_MATCH),
        }
    }

    /// Never below `MIN_MATCH`, which the room for the output counts on.
    #[inline(always)]
    fn length(&self, at: u32, found: &Comparison) -> u32 {
        let rest = if found.difference == 0 || at as usize + WINDOW_GAP > self.block.len() {
            long_match_length(self.block, at + MIN_MATCH as u32, found.distance)
        } else {
            found.difference.trailing_zeros() / 8
        };
        MIN_MATCH as u32 + rest
    }

    /// The first match after `at`, with one more byte between lookups for every 32 lookups without a match.
    #[inline(always)]
    fn scan(&mut self, mut at: u32, last_distance: Option<u32>) -> Option<(u32, Comparison)> {
        let mut misses = 32;
        let mut next = at + 1;
        let mut next_chunk = chunk_at(self.searched, next)?;
        loop {
            let ours = next_chunk;
            at = next;
            next = at + (misses >> 5);
            misses += 1;
            next_chunk = chunk_at(self.searched, next)?;
            let candidate = core::mem::replace(self.slot(load64(ours, 0)), at);
            if let Some(last_distance) = last_distance
                && let Some(theirs) = chunk_at(self.searched, at.wrapping_sub(last_distance))
                && (load64(ours, 0) ^ load64(theirs, 0)) << Self::IGNORED_BITS == 0
            {
                return Some((at, Self::compare(ours, theirs, last_distance)));
            }
            let found = Self::compare(ours, chunk_at(self.searched, candidate)?, at - candidate);
            if found.obstacles == 0 {
                return Some((at, found));
            }
        }
    }

    /// Stores the last positions of the match that ends at `at`, and looks for one that starts there.
    #[inline(always)]
    fn after_match(&mut self, at: u32, after_literals: bool) -> Comparison {
        const BEFORE: usize = 5;
        const NO_MATCH: Comparison = Comparison {
            distance: 0,
            obstacles: 1,
            difference: 0,
        };
        let from = (at - BEFORE as u32) as usize;
        let Some(around) = self.searched.get(from..from + BEFORE + WINDOW_GAP + 1) else {
            return NO_MATCH;
        };
        let mut store = |hashed_back: usize, back: u32| {
            *self.slot(load64(around, BEFORE - hashed_back)) = at - back;
        };
        if MIN_MATCH == 6 {
            store(5, 5);
            store(4, 4);
        }
        store(3, 3);
        store(2, 2);
        // Filing the last position under the third to last hash looks wrong, but the output depends on it.
        let is_odd_one = MIN_MATCH == 4 && after_literals;
        store(if is_odd_one { 3 } else { 1 }, 1);

        let candidate = core::mem::replace(self.slot(load64(around, BEFORE)), at);
        match (
            around[BEFORE..].first_chunk(),
            chunk_at(self.searched, candidate),
        ) {
            (Some(ours), Some(theirs)) => Self::compare(ours, theirs, at - candidate),
            _ => NO_MATCH,
        }
    }
}

/// Returns where the last command ends, or breaks with the end of the literals that `sink` refuses.
#[inline(always)]
fn find_matches<const TABLE_SIZE: usize, const MIN_MATCH: usize>(
    input: &[u8],
    start: usize,
    end: usize,
    mut next_literal: usize,
    table: &mut [u32; TABLE_SIZE],
    sink: &mut impl Sink,
) -> ControlFlow<usize, usize> {
    if end - start < WINDOW_GAP {
        return ControlFlow::Continue(next_literal);
    }
    let limit = (end - MIN_MATCH).min(input.len() - WINDOW_GAP) as u32;
    let mut finder = Finder::<_, MIN_MATCH> {
        block: &input[..end],
        searched: &input[..limit as usize + WINDOW_GAP],
        table,
    };
    let mut last_distance = 0;
    let mut scanned = finder.scan(start as u32, None);
    // Each lookup comes before the output of the previous match, which fills the wait for its result.
    while let Some((match_start, found)) = scanned {
        if sink.refuses(next_literal, match_start as usize) {
            return ControlFlow::Break(match_start as usize);
        }
        let length = finder.length(match_start, &found);
        let mut at = match_start + length;
        let mut next = finder.after_match(at, true);
        sink.insert(&input[next_literal..match_start as usize + WINDOW_GAP]);
        let distance = if found.distance == last_distance {
            Token::LAST_DISTANCE
        } else {
            Token::distance(found.distance)
        };
        last_distance = found.distance;
        match length as usize - 2 {
            rest @ ..SHORT_COPY_END => {
                sink.tokens(distance, Token::copy(FIRST_COPY_AT_LAST_DISTANCE, rest))
            }
            rest => {
                sink.tokens(distance, Token::NONE);
                sink.tokens(Token::copy(FIRST_COPY, rest), Token::LAST_DISTANCE);
            }
        }

        while next.obstacles == 0 {
            let length = finder.length(at, &next);
            last_distance = next.distance;
            at += length;
            next = finder.after_match(at, false);
            let copy = Token::copy(FIRST_COPY, length as usize);
            let distance = Token::distance(last_distance);
            if length < HUGE_COPY {
                sink.tokens(copy, distance);
            } else {
                sink.tokens(copy, Token::NONE);
                sink.tokens(distance, Token::NONE);
            }
        }
        next_literal = at as usize;
        scanned = finder.scan(at, Some(last_distance));
    }
    ControlFlow::Continue(next_literal)
}

/// What the symbols of the first half are in the alphabet of the format.
const FULL_SYMBOLS: [u16; SYMBOLS / 2] = {
    let mut full = [0; SYMBOLS / 2];
    let mut i = 0;
    while i < 24 {
        full[i] = combine_length_codes(i, 0, false);
        full[FIRST_COPY_AT_LAST_DISTANCE + i % 16] = combine_length_codes(0, i % 16, true);
        full[FIRST_COPY + i] = combine_length_codes(0, i, false);
        i += 1;
    }
    full
};

const fn codes_for(lengths: &[u8; SYMBOLS]) -> TokenCodes {
    /// Sorts groups of eight by [`FULL_SYMBOLS`]. Only [`Token::NONE`], which has no code, ends up out of order.
    const GROUPS: [usize; 8] = [3, 4, 5, 0, 6, 1, 7, 2];
    let mut sorted_lengths = [0; SYMBOLS / 2];
    let mut i = 0;
    while i < SYMBOLS / 2 {
        sorted_lengths[i] = lengths[GROUPS[i / 8] * 8 + i % 8];
        i += 1;
    }
    let mut sorted_codes = [Code::EMPTY; SYMBOLS / 2];
    assign_codes(&sorted_lengths, &mut sorted_codes);
    let mut codes = [Code::EMPTY; SYMBOLS];
    i = 0;
    while i < SYMBOLS / 2 {
        codes[GROUPS[i / 8] * 8 + i % 8] = sorted_codes[i];
        i += 1;
    }
    let distance_codes = codes.split_at_mut(SYMBOLS / 2).1;
    assign_codes(lengths.split_at(SYMBOLS / 2).1, distance_codes);
    TokenCodes::new(&codes)
}

/// Ties are decided as if `first_command` came first.
fn build_and_write_codes(
    mut histogram: [u32; SYMBOLS],
    first_command: usize,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> TokenCodes {
    histogram[Token::NONE.symbol] = 0;
    let (commands, distances) = histogram.split_at_mut(SYMBOLS / 2);
    let mut lengths = [0; SYMBOLS];
    let (command_lengths, distance_lengths) = lengths.split_at_mut(SYMBOLS / 2);
    commands.rotate_left(first_command);
    trees.set_lengths(commands, 15, command_lengths);
    command_lengths.rotate_right(first_command);
    trees.set_lengths(distances, 14, distance_lengths);

    let mut stored = Lengths::zeros(COMMAND_SYMBOLS);
    for (&symbol, &length) in FULL_SYMBOLS.iter().zip(&*command_lengths) {
        stored.all_mut()[usize::from(symbol)] = length;
    }
    trees.write_complex(&stored, writer);
    stored = Lengths::zeros(SYMBOLS / 2);
    stored.all_mut().copy_from_slice(distance_lengths);
    trees.write_complex(&stored, writer);
    codes_for(&lengths)
}

#[allow(clippy::large_enum_variant)] // There is one for each stream.
pub(super) enum Fragments {
    OnePass(OnePass),
    TwoPass(TwoPass),
}

impl Fragments {
    pub(super) fn new(quality: u32) -> Self {
        match quality {
            0 => Self::OnePass(OnePass::default()),
            _ => Self::TwoPass(TwoPass::default()),
        }
    }

    pub(super) fn compress(
        &mut self,
        input: &[u8],
        is_last: bool,
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        try_reserve_for(input.len(), writer)?;
        let start = writer.position();
        match self {
            Self::OnePass(method) => method.compress(input, trees, writer)?,
            Self::TwoPass(method) => method.compress(input, trees, writer)?,
        }
        if writer.position() - start > 31 + 8 * input.len() {
            writer.rewind(start);
            write_uncompressed(writer, [input, &[]]);
        }
        if is_last {
            write_empty_last(writer);
        }
        Ok(())
    }
}
