//! Qualities 0 and 1 compress each piece of input on its own, without copying it.

mod one_pass;
mod two_pass;

use core::ops::{ControlFlow, Range};

use bun_highway::with_bmi2;
use one_pass::OnePass;
use two_pass::TwoPass;

use super::bit_stream::{write_empty_last, write_uncompressed};
use super::bit_writer::{BitWriter, Code};
use super::command::{
    codes_of_short_lengths, combine_length_codes, copy_length_code, insert_length_code,
};
use super::huffman::{Lengths, TreeBuilder};
use super::matching::{HASH_MULTIPLIER_32, bytes_at, load32, load64, match_length};
use super::params::FAST_WINDOW_BITS;
use super::symbol_set::SymbolSet;
use super::try_reserve_for;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, INSERT_LENGTH_CODES, LITERAL_SYMBOLS, LengthCode,
    SHORT_COPY_END, WINDOW_GAP,
};
use crate::memory::{self, Result};

/// Half for distances, and half for commands, which have either literals and a copy of two bytes, or a copy alone.
const SYMBOLS: usize = 128;
const FIRST_COPY_AT_LAST_DISTANCE: usize = 24;
const FIRST_COPY: usize = 40;
const FIRST_DISTANCE: usize = 64;

/// For the second half of 24 extra bits. Inserting no literals does not come up, so the symbol has no code.
const MORE_BITS: usize = 0;
const HALF_OF_24_BITS: u32 = 12;

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
    ranges[MORE_BITS].1 = HALF_OF_24_BITS;
    ranges[23].1 = HALF_OF_24_BITS;
    ranges[FIRST_COPY + 23].1 = HALF_OF_24_BITS;
    ranges
};

/// From the high bits: an index, the extra bits, zeros. The indices of the symbols follow those of the literals.
#[derive(Clone, Copy)]
struct Item(u32);

impl Item {
    const LAST_DISTANCE: Self = Self::new(FIRST_DISTANCE, 0);
    const EXTRA_BITS: u32 = f32::MANTISSA_DIGITS - 1;
    const INDICES: usize = 1 << (u32::BITS - Self::EXTRA_BITS);

    /// `value` is in the range that `symbol` stands for.
    const fn new(symbol: usize, value: u32) -> Self {
        let (base, extra_bits) = RANGES[symbol % SYMBOLS];
        let extra = (value - base) << (Self::EXTRA_BITS - extra_bits);
        Self((((LITERAL_SYMBOLS + symbol) as u32) << Self::EXTRA_BITS) | extra)
    }

    /// For each length below `N`. `first` is the symbol for `codes[0]`.
    const fn for_short_lengths<const N: usize>(
        first: usize,
        codes: &[LengthCode; 24],
    ) -> [Self; N] {
        let symbols: [u8; N] = codes_of_short_lengths(codes);
        let mut items = [Self(0); N];
        let mut length = codes[0].base as usize;
        while length < N {
            items[length] = Self::new(first + symbols[length] as usize, length as u32);
            length += 1;
        }
        items
    }

    #[inline(always)]
    fn literal(literal: u8) -> Self {
        Self(u32::from(literal) << Self::EXTRA_BITS)
    }

    /// Two symbols for each power of two, like the exponent and the first bit of the mantissa of a float.
    #[inline(always)]
    fn distance(distance: u32) -> Self {
        const OFFSET: u32 = Item::new(FIRST_DISTANCE + 16, 4).0 - (4f32.to_bits() << 1);
        let value = (distance + 3) as i32 as f32;
        Self((value.to_bits() << 1) + OFFSET)
    }

    #[inline(always)]
    fn index(self) -> usize {
        (self.0 >> Self::EXTRA_BITS) as usize
    }
}

struct ItemCodes([Code; Item::INDICES]);

impl ItemCodes {
    fn literals(&mut self) -> &mut [Code] {
        &mut self.0[..LITERAL_SYMBOLS]
    }

    fn symbols(&mut self) -> &mut [Code] {
        &mut self.0[LITERAL_SYMBOLS..][..SYMBOLS]
    }
}

with_bmi2! {
    fn write_literals(literals: &[u8], codes: &ItemCodes, writer: &mut BitWriter) {
        writer.write_codes::<5, _>(literals, |literal| codes.0[usize::from(literal)]);
    }
}

with_bmi2! {
    fn write_items(items: &[Item], codes: &ItemCodes, writer: &mut BitWriter) {
        writer.write_codes::<4, _>(items, |item| {
            codes.0[item.index()].plus(u64::from(item.0) << (u64::BITS - Item::EXTRA_BITS))
        });
    }
}

trait Sink {
    /// Whether the literals in `start..end` are not worth compressing. Asked before each insert.
    fn refuses(&self, start: usize, end: usize) -> bool;

    /// For each symbol with a code, as soon as it is known.
    fn found(&mut self, item: Item);

    fn items(&mut self, items: &[Item]);

    /// Those that are too many to make items of.
    fn literals(&mut self, input: &[u8], range: Range<usize>);
}

const BATCH_SIZE: usize = 1024;
const MAX_LITERAL_ITEMS: usize = 2 * WINDOW_GAP;
const MAX_ITEMS_PER_MATCH: usize = 1 + MAX_LITERAL_ITEMS + 4;

static SHORT_INSERTS: [Item; MAX_LITERAL_ITEMS + 1] =
    Item::for_short_lengths(0, &INSERT_LENGTH_CODES);
static SHORT_COPIES: [Item; 582] = Item::for_short_lengths(FIRST_COPY, &COPY_LENGTH_CODES);
static COPIES_AT_LAST_DISTANCE: [Item; SHORT_COPY_END] =
    Item::for_short_lengths(FIRST_COPY_AT_LAST_DISTANCE, &COPY_LENGTH_CODES);

/// A loop over items of all kinds has no branches that depend on the input.
struct Batch<'a, S: Sink> {
    items: &'a mut [Item; BATCH_SIZE + MAX_ITEMS_PER_MATCH],
    count: usize,
    sink: &'a mut S,
}

impl<S: Sink> Batch<'_, S> {
    #[inline(always)]
    fn flush(&mut self) {
        let count = core::mem::take(&mut self.count);
        self.sink.items(&self.items[..count]);
    }

    #[inline(always)]
    fn make_room_for_match(&mut self) {
        if self.count > BATCH_SIZE {
            core::hint::cold_path();
            self.flush();
        }
    }

    #[inline(always)]
    fn push<const N: usize>(&mut self, items: [Item; N]) {
        self.items[self.count..self.count + N].copy_from_slice(&items);
        self.count += N;
        for item in items {
            self.sink.found(item);
        }
    }

    #[inline(always)]
    fn put_literals(&mut self, at: usize, literals: Chunk) {
        self.items[at..at + WINDOW_GAP].copy_from_slice(&literals.map(Item::literal));
    }

    /// `input` has a chunk at the end of `range`.
    #[inline(always)]
    fn insert(&mut self, input: &[u8], range: Range<usize>) {
        let length = range.end - range.start;
        let Some(&command) = SHORT_INSERTS.get(length) else {
            let count = core::mem::take(&mut self.count);
            return insert_after(self.items, count, input, range, self.sink);
        };
        self.push([command]);
        self.put_literals(self.count, bytes_at(input, range.start));
        if length > WINDOW_GAP {
            let more = bytes_at(input, range.start + WINDOW_GAP);
            self.put_literals(self.count + WINDOW_GAP, more);
        }
        self.count += length;
    }

    #[inline(always)]
    fn copy(&mut self, length: usize, distance: Item) {
        if let Some(&command) = SHORT_COPIES.get(length) {
            self.push([command, distance]);
        } else {
            let symbol = FIRST_COPY + copy_length_code(length);
            let room = &mut self.items[self.count..];
            self.count += put_command(symbol, length, room);
            self.sink.found(room[0]);
            self.push([distance]);
        }
    }
}

/// Returns how many `items` it takes, up to two.
#[inline(never)]
fn put_command(symbol: usize, length: usize, items: &mut [Item]) -> usize {
    let (base, extra_bits) = RANGES[symbol % SYMBOLS];
    let more = (length as u32 - base) >> extra_bits;
    items[0] = Item::new(symbol, length as u32 - (more << extra_bits));
    items[1] = Item::new(MORE_BITS, more);
    1 + usize::from(symbol % FIRST_COPY == 23)
}

/// After the first `count` of `items`, which has room for two more.
#[inline(never)]
fn insert_after(
    items: &mut [Item],
    count: usize,
    input: &[u8],
    range: Range<usize>,
    sink: &mut impl Sink,
) {
    let symbol = insert_length_code(range.len());
    let added = put_command(symbol, range.len(), &mut items[count..]);
    sink.found(items[count]);
    sink.items(&items[..count + added]);
    sink.literals(input, range);
}

/// The literals after the last match.
fn insert_last(input: &[u8], range: Range<usize>, sink: &mut impl Sink) {
    insert_after(&mut [Item(0); 2], 0, input, range, sink);
}

#[derive(Default)]
struct Table(Vec<u32>);

impl Table {
    fn cleared<const SIZE: usize>(&mut self) -> Result<&mut [u32; SIZE]> {
        self.0.clear();
        memory::try_reserve(&mut self.0, SIZE)?;
        memory::resize(&mut self.0, SIZE, 0);
        self.0.first_chunk_mut().ok_or(memory::AllocError)
    }
}

fn table_bits(input_size: usize, max_bits: u32) -> u32 {
    input_size.next_power_of_two().ilog2().clamp(8, max_bits)
}

/// The bytes at a position.
type Chunk = [u8; WINDOW_GAP];

#[inline(always)]
fn chunk_at(input: &[u8], at: usize) -> Option<&Chunk> {
    if at > input.len().checked_sub(WINDOW_GAP)? {
        return None;
    }
    input[at..at + WINDOW_GAP].as_array()
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
        let mut next = at as usize + 1;
        let mut next_chunk = chunk_at(self.searched, next)?;
        loop {
            let ours = next_chunk;
            at = next as u32;
            next += misses >> 5;
            misses += 1;
            next_chunk = chunk_at(self.searched, next)?;
            let candidate = core::mem::replace(self.slot(load64(ours, 0)), at);
            if let Some(last_distance) = last_distance
                && let Some(theirs) =
                    chunk_at(self.searched, at.wrapping_sub(last_distance) as usize)
                && (MIN_MATCH == 6 || load32(ours, 0) == load32(theirs, 0))
                && (load64(ours, 0) ^ load64(theirs, 0)) << Self::IGNORED_BITS == 0
            {
                return Some((at, Self::compare(ours, theirs, last_distance)));
            }
            let theirs = chunk_at(self.searched, candidate as usize)?;
            // Much of what matches is out of reach in the largest tables, so two branches cost more than they save.
            if MIN_MATCH == 6 || load32(ours, 0) == load32(theirs, 0) {
                let found = Self::compare(ours, theirs, at - candidate);
                if found.obstacles == 0 {
                    return Some((at, found));
                }
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
            chunk_at(self.searched, candidate as usize),
        ) {
            (Some(ours), Some(theirs)) => Self::compare(ours, theirs, at - candidate),
            _ => NO_MATCH,
        }
    }
}

/// Returns where the last command ends, or gives up with the end of the literals that `sink` refuses.
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
    let mut batch = Batch {
        items: &mut [Item(0); _],
        count: 0,
        sink,
    };
    let mut last_distance = 0;
    let mut scanned = finder.scan(start as u32, None);
    // Each lookup comes before the output of the previous match, which fills the wait for its result.
    while let Some((match_start, found)) = scanned {
        if batch.sink.refuses(next_literal, match_start as usize) {
            return ControlFlow::Break(match_start as usize);
        }
        let length = finder.length(match_start, &found);
        let mut at = match_start + length;
        let mut next = finder.after_match(at, true);
        batch.make_room_for_match();
        batch.insert(input, next_literal..match_start as usize);
        let distance = if found.distance == last_distance {
            Item::LAST_DISTANCE
        } else {
            Item::distance(found.distance)
        };
        last_distance = found.distance;
        let rest = length as usize - 2;
        if let Some(&command) = COPIES_AT_LAST_DISTANCE.get(rest) {
            batch.push([distance, command]);
        } else {
            batch.push([distance]);
            batch.copy(rest, Item::LAST_DISTANCE);
        }

        while next.obstacles == 0 {
            let length = finder.length(at, &next);
            last_distance = next.distance;
            at += length;
            next = finder.after_match(at, false);
            batch.make_room_for_match();
            batch.copy(length as usize, Item::distance(last_distance));
        }
        next_literal = at as usize;
        scanned = finder.scan(at, Some(last_distance));
    }
    batch.flush();
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

/// The groups of eight symbols of the first half, in the order of their codes. Only [`MORE_BITS`] ends up out of order.
const ORDER: [usize; 8] = [3, 4, 5, 0, 6, 1, 7, 2];

const fn symbol_with_rank(rank: usize) -> usize {
    ORDER[rank / 8 % 8] % 8 * 8 + rank % 8
}

/// What to prepend the codes to.
const ROOM: [Code; SYMBOLS] = {
    let mut room = [Code::EMPTY; _];
    let mut i = 0;
    while i < SYMBOLS {
        room[i] = Code::new(RANGES[i].1, 0);
        i += 1;
    }
    room
};

/// Ties are decided as if `first_command` came first.
fn build_and_write_codes(
    mut histogram: [u32; SYMBOLS],
    first_command: usize,
    codes: &mut [Code],
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) {
    histogram[MORE_BITS] = 0;
    codes.copy_from_slice(&ROOM);
    let (commands, distances) = histogram.split_at_mut(SYMBOLS / 2);
    let mut lengths = [0; SYMBOLS / 2];
    commands.rotate_left(first_command);
    let mut next = trees.set_lengths(commands, 15, &mut lengths);
    lengths.rotate_right(first_command);
    let ranked = ORDER.map(|group| bytes_at::<8>(&lengths, group * 8));
    let mut stored = Lengths::zeros(COMMAND_SYMBOLS);
    for rank in &SymbolSet::matching(ranked.as_flattened(), |length| length != 0) {
        let symbol = symbol_with_rank(rank);
        stored.all_mut()[usize::from(FULL_SYMBOLS[symbol])] = lengths[symbol];
        codes[symbol].prepend(next.take(lengths[symbol]));
    }
    trees.write_complex(&stored, writer);

    stored = Lengths::zeros(SYMBOLS / 2);
    let lengths = stored.all_mut();
    next = trees.set_lengths(distances, 14, lengths);
    for symbol in &SymbolSet::matching(lengths, |length| length != 0) {
        codes[FIRST_DISTANCE + symbol].prepend(next.take(lengths[symbol]));
    }
    trees.write_complex(&stored, writer);
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
        if !input.is_empty() {
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
        }
        if is_last {
            write_empty_last(writer);
        }
        Ok(())
    }
}
