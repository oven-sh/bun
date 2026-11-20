//! Writes meta-blocks (RFC 7932 section 9.2).

use bun_highway::with_bmi2;

use super::bit_writer::{BitWriter, Bits, Code};
use super::block_splitter::{Block, BlockSplit};
use super::command::{Command, ROOM_FOR_LENGTHS, room_for_distance};
use super::histogram::Histogram;
use super::huffman::{TreeBuilder, assign_codes, max_description_size};
use super::log2::log2_floor;
use super::meta_block::{Literals, MetaBlock, Source};
use super::params::Params;
use crate::context::{ContextMode, DISTANCE_CONTEXT_BITS, DISTANCE_CONTEXTS, LITERAL_CONTEXT_BITS};
use crate::format::{
    Alphabet, BLOCK_LENGTH_CODES, BLOCK_LENGTH_SYMBOLS, COMMAND_SYMBOLS, DistanceParams,
    FIRST_COMMAND_WITH_DISTANCE, LITERAL_SYMBOLS, MAX_BLOCK_TYPES,
};
use crate::memory::{self, Result};

const MAX_RUN_LENGTH_CODE: u32 = 6;
const MAX_CONTEXT_MAP_SYMBOLS: usize = MAX_BLOCK_TYPES + MAX_RUN_LENGTH_CODE as usize;
/// Without postfix bits and direct codes.
const PLAIN_DISTANCE_SYMBOLS: usize = DistanceParams::new(0, 0, true).alphabet.size as usize;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum MetaBlockKind {
    Compressed,
    LastCompressed,
    Uncompressed,
}

/// `length` is in `1..=1 << 24`.
fn write_header(writer: &mut BitWriter, kind: MetaBlockKind, length: usize) {
    let nibbles = match length {
        ..=0x1_0000 => 4,
        0x1_0001..=0x10_0000 => 5,
        _ => 6,
    };
    if kind == MetaBlockKind::LastCompressed {
        writer.write(2, 1);
    } else {
        writer.write(1, 0);
    }
    writer.write(2, u64::from(nibbles - 4));
    writer.write(nibbles * 4, length as u64 - 1);
    if kind != MetaBlockKind::LastCompressed {
        writer.write(1, u64::from(kind == MetaBlockKind::Uncompressed));
    }
}

/// One block type of each category, no distance parameters and no contexts.
pub(super) fn write_plain_header(writer: &mut BitWriter, kind: MetaBlockKind, length: usize) {
    write_header(writer, kind, length);
    writer.write(13, 0);
}

pub(super) fn write_uncompressed(writer: &mut BitWriter, parts: [&[u8]; 2]) {
    write_header(
        writer,
        MetaBlockKind::Uncompressed,
        parts[0].len() + parts[1].len(),
    );
    writer.align();
    for part in parts {
        writer.write_bytes(part);
    }
}

pub(super) fn write_empty_last(writer: &mut BitWriter) {
    writer.write(2, 3);
    writer.align();
}

/// `length` is at most `1 << 24`.
pub(super) fn write_metadata_header(writer: &mut BitWriter, length: usize) {
    writer.write(4, 6);
    match length.checked_sub(1) {
        None => writer.write(2, 0),
        Some(stored) => {
            let bytes = log2_floor(stored) / 8 + 1;
            writer.write(2, u64::from(bytes));
            writer.write(8 * bytes, stored as u64);
        }
    }
    writer.align();
}

/// `count` is in `1..=256`.
fn write_count(writer: &mut BitWriter, count: usize) {
    if count == 1 {
        writer.write(1, 0);
    } else {
        let bits = log2_floor(count - 1);
        writer.write(4, u64::from(bits << 1) | 1);
        writer.write(bits, (count - 1 - (1 << bits)) as u64);
    }
}

fn block_length_symbol(length: u32) -> usize {
    BLOCK_LENGTH_CODES.partition_point(|code| u32::from(code.base) <= length) - 1
}

struct LastTypes([usize; 2]);

impl LastTypes {
    fn new() -> Self {
        Self([1, 0])
    }

    fn symbol_for(&mut self, kind: u8) -> usize {
        let kind = usize::from(kind);
        let [last, second_last] = self.0;
        self.0 = [kind, last];
        if kind == last + 1 {
            1
        } else if kind == second_last {
            0
        } else {
            kind + 2
        }
    }
}

/// Follows the blocks of a split.
struct BlockCursor<'a> {
    rest: &'a [Block],
    left: u32,
}

impl<'a> BlockCursor<'a> {
    const ENDLESS: Self = Self {
        rest: &[],
        left: u32::MAX,
    };

    fn new(split: &'a BlockSplit) -> Self {
        Self {
            rest: &split.blocks[1..],
            left: split.blocks[0].length,
        }
    }

    /// How many symbols the current block has left.
    #[inline(always)]
    fn left(&self) -> usize {
        self.left as usize
    }

    #[inline(always)]
    fn skip(&mut self, symbols: usize) {
        self.left -= symbols as u32;
    }

    fn next_block(&mut self) -> Block {
        let block = self.rest[0];
        self.rest = &self.rest[1..];
        self.left = block.length;
        block
    }
}

/// Writes the block switch commands of a category.
struct BlockSwitcher<'a> {
    cursor: BlockCursor<'a>,
    last_types: LastTypes,
    type_codes: Vec<Code>,
    length_codes: [Code; BLOCK_LENGTH_SYMBOLS],
}

impl<'a> BlockSwitcher<'a> {
    fn single_block() -> Self {
        Self {
            cursor: BlockCursor::ENDLESS,
            last_types: LastTypes::new(),
            type_codes: Vec::new(),
            length_codes: [Code::EMPTY; BLOCK_LENGTH_SYMBOLS],
        }
    }

    fn build_and_write(
        split: &'a BlockSplit,
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<Self> {
        let mut switcher = Self::single_block();
        write_count(writer, split.type_count);
        if split.type_count == 1 {
            return Ok(switcher);
        }
        switcher.cursor = BlockCursor::new(split);
        switcher.type_codes = memory::filled(Code::EMPTY, split.type_count + 2)?;
        let mut types = [0; MAX_BLOCK_TYPES + 2];
        let mut lengths = [0; BLOCK_LENGTH_SYMBOLS];
        let mut last_types = LastTypes::new();
        for (i, block) in split.blocks.iter().enumerate() {
            types[last_types.symbol_for(block.kind)] += u32::from(i != 0);
            lengths[block_length_symbol(block.length)] += 1;
        }
        let alphabet = Alphabet::new(split.type_count as u32 + 2);
        writer.try_reserve(max_description_size(alphabet))?;
        trees.build_and_write(&types, alphabet, &mut switcher.type_codes, writer);
        let alphabet = Alphabet::BLOCK_LENGTHS;
        writer.try_reserve(max_description_size(alphabet))?;
        trees.build_and_write(&lengths, alphabet, &mut switcher.length_codes, writer);
        let first = split.blocks[0];
        switcher.last_types.symbol_for(first.kind);
        writer.write_bits(switcher.length_bits(first.length));
        Ok(switcher)
    }

    fn length_bits(&self, length: u32) -> Bits {
        let symbol = block_length_symbol(length);
        let range = BLOCK_LENGTH_CODES[symbol];
        self.length_codes[symbol].bits().then(Bits::new(
            u32::from(range.extra_bits),
            u64::from(length - u32::from(range.base)),
        ))
    }

    /// Returns the type of the next block.
    fn switch(&mut self, writer: &mut BitWriter) -> usize {
        let block = self.cursor.next_block();
        let type_code = self.type_codes[self.last_types.symbol_for(block.kind)];
        writer.write_bits(type_code.bits().then(self.length_bits(block.length)));
        usize::from(block.kind)
    }
}

fn move_to_front(values: &[u32]) -> impl Iterator<Item = u32> {
    let mut list: [u8; 256] = core::array::from_fn(|i| i as u8);
    values.iter().map(move |&value| {
        let index = list.iter().take_while(|&&v| u32::from(v) != value).count();
        list[..=index].rotate_right(1);
        index as u32
    })
}

#[inline(never)]
fn write_context_map(
    map: &[u32],
    tree_count: usize,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> Result<()> {
    write_count(writer, tree_count);
    if tree_count == 1 {
        return Ok(());
    }
    let mut values = memory::empty(map.len())?;
    values.extend(move_to_front(map));
    let runs = || values.chunk_by(|&a, &b| a == 0 && b == 0);
    let longest = runs().map(<[u32]>::len).max();
    let max_code = longest.map_or(0, log2_floor).min(MAX_RUN_LENGTH_CODE);

    let mut symbols = memory::empty(map.len())?;
    for run in runs() {
        if run[0] != 0 {
            symbols.push((run[0] + max_code, 0));
            continue;
        }
        let mut left = run.len() as u32;
        while left >= 2 << max_code {
            symbols.push((max_code, (1 << max_code) - 1));
            left -= (2 << max_code) - 1;
        }
        let code = left.ilog2();
        symbols.push((code, left - (1 << code)));
    }

    let mut histogram = [0; MAX_CONTEXT_MAP_SYMBOLS];
    for &(symbol, _) in &symbols {
        histogram[symbol as usize] += 1;
    }
    match max_code {
        0 => writer.write(1, 0),
        _ => writer.write(5, u64::from((max_code - 1) << 1) | 1),
    }
    let alphabet = Alphabet::new(tree_count as u32 + max_code);
    writer.try_reserve(max_description_size(alphabet) + 3 * symbols.len())?;
    let mut codes = [Code::EMPTY; MAX_CONTEXT_MAP_SYMBOLS];
    trees.build_and_write(&histogram, alphabet, &mut codes, writer);
    for (symbol, extra) in symbols {
        let extra_bits = if symbol <= max_code { symbol } else { 0 };
        let extra = Bits::new(extra_bits, u64::from(extra));
        writer.write_bits(codes[symbol as usize].bits().then(extra));
    }
    writer.write(1, 1);
    Ok(())
}

/// All contexts of a block type use the tree with its number.
#[inline(never)]
fn write_trivial_context_map(
    type_count: usize,
    context_bits: u32,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> Result<()> {
    write_count(writer, type_count);
    if type_count == 1 {
        return Ok(());
    }
    let run_code = context_bits - 1;
    writer.write(5, u64::from((run_code - 1) << 1) | 1);
    let mut histogram = [1; MAX_CONTEXT_MAP_SYMBOLS];
    histogram[1..run_code as usize].fill(0);
    histogram[run_code as usize] = type_count as u32;
    let alphabet = Alphabet::new(type_count as u32 + run_code);
    writer.try_reserve(max_description_size(alphabet) + 5 * type_count)?;
    let mut codes = [Code::EMPTY; MAX_CONTEXT_MAP_SYMBOLS];
    trees.build_and_write(&histogram, alphabet, &mut codes, writer);
    for i in 0..type_count {
        writer.write_bits(codes[if i == 0 { 0 } else { i + run_code as usize }].bits());
        let extra = Bits::new(run_code, (1 << run_code) - 1);
        writer.write_bits(codes[run_code as usize].bits().then(extra));
    }
    writer.write(1, 1);
    Ok(())
}

#[inline(never)]
pub(super) fn write_full_meta_block(
    length: usize,
    commands: &[Command],
    block: &MetaBlock,
    context_mode: ContextMode,
    kind: MetaBlockKind,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> Result<()> {
    write_header(writer, kind, length);
    let mut switchers = [
        BlockSwitcher::build_and_write(&block.literal_split, trees, writer)?,
        BlockSwitcher::build_and_write(&block.command_split, trees, writer)?,
        BlockSwitcher::build_and_write(&block.distance_split, trees, writer)?,
    ];

    let distance = &block.distance_params;
    writer.write(2, u64::from(distance.postfix_bits));
    writer.write(4, u64::from(distance.direct_codes >> distance.postfix_bits));
    writer.try_reserve(block.literal_split.type_count / 4)?;
    for _ in 0..block.literal_split.type_count {
        writer.write(2, context_mode as u64);
    }
    let literal_map = block.literal_context_map.as_deref();
    let distance_map = block.distance_context_map.as_deref();
    for (map, tree_count, context_bits) in [
        (
            literal_map,
            block.literal_histograms.len(),
            LITERAL_CONTEXT_BITS,
        ),
        (
            distance_map,
            block.distance_histograms.len(),
            DISTANCE_CONTEXT_BITS,
        ),
    ] {
        match map {
            Some(map) => write_context_map(map, tree_count, trees, writer)?,
            None => write_trivial_context_map(tree_count, context_bits, trees, writer)?,
        }
    }
    let room_for_distances = memory::collected(
        (0..distance.alphabet.size).map(|symbol| room_for_distance(distance, symbol)),
    )?;
    let table_size = block.literal_histograms.len() * LITERAL_SYMBOLS + SLOTS;
    let command_codes = block.command_histograms.len() * COMMAND_SYMBOLS;
    let distance_codes = block.distance_histograms.len() * room_for_distances.len();
    let mut all = memory::empty(table_size + command_codes + distance_codes)?;
    let mut append = |all: &mut Vec<Code>, counts: &[u32], alphabet, room: &[Code]| -> Result<()> {
        let first = all.len();
        all.extend_from_slice(room);
        writer.try_reserve(max_description_size(alphabet))?;
        trees.build_and_write(counts, alphabet, &mut all[first..], writer);
        Ok(())
    };
    for Histogram { counts, .. } in &block.literal_histograms {
        let room = &[Code::EMPTY; LITERAL_SYMBOLS];
        append(&mut all, counts, Alphabet::LITERALS, room)?;
    }
    memory::resize(&mut all, table_size, Code::EMPTY);
    for Histogram { counts, .. } in &block.command_histograms {
        append(&mut all, counts, Alphabet::COMMANDS, &ROOM_FOR_LENGTHS)?;
    }
    for Histogram { counts, .. } in &block.distance_histograms {
        append(&mut all, counts, distance.alphabet, &room_for_distances)?;
    }

    let (table, rest) = all.split_at_mut(table_size);
    let (symbols, distances) = rest.split_at(command_codes);
    let codes = Codes {
        commands: symbols.as_chunks().0,
        distances,
        distance_symbols: room_for_distances.len(),
        distance_map,
    };
    write_commands(
        commands,
        &block.literals,
        table,
        &codes,
        &mut switchers,
        writer,
    )
}

/// After the codes of the literals, for those of the commands and distances of a batch with their extra bits.
const SLOTS: usize = 128;
const BATCH_SIZE: usize = 384;

struct Codes<'a> {
    commands: &'a [[Code; COMMAND_SYMBOLS]],
    distances: &'a [Code],
    distance_symbols: usize,
    distance_map: Option<&'a [u32]>,
}

impl Codes<'_> {
    fn distances_by_context(&self, kind: usize) -> [&[Code]; DISTANCE_CONTEXTS] {
        core::array::from_fn(|context| {
            let tree = (self.distance_map)
                .map_or(kind, |map| map[kind * DISTANCE_CONTEXTS + context] as usize);
            &self.distances[tree * self.distance_symbols..][..self.distance_symbols]
        })
    }
}

/// The codes of the current block types.
struct CurrentCodes<'a> {
    commands: &'a [Code; COMMAND_SYMBOLS],
    distances: [&'a [Code]; DISTANCE_CONTEXTS],
}

impl CurrentCodes<'_> {
    #[inline(always)]
    fn lengths(&self, command: &Command) -> Code {
        command.with_lengths(self.commands[command.symbol()])
    }

    #[inline(always)]
    fn distance(&self, command: &Command) -> Code {
        command
            .with_distance(self.distances[command.distance_context()][command.distance().symbol()])
    }

    /// Returns how many commands, literals and indices into `table` there were before it ran out of any of them. All commands copy.
    #[inline(never)]
    fn index_batch(
        &self,
        commands: &[Command],
        literals: &[u16],
        table: &mut [Code],
        indices: &mut [u32; BATCH_SIZE],
    ) -> [usize; 3] {
        const FEW: usize = Literals::SLACK;
        let first_slot = table.len() - SLOTS;
        let mut rest = literals;
        let mut count = 0;
        let mut slot = first_slot as u32;
        for (command, slots) in commands.iter().zip(table[first_slot..].as_chunks_mut().0) {
            let inserted = command.insert_length();
            if inserted > FEW || inserted + FEW > rest.len() || count + FEW + 2 > BATCH_SIZE {
                break;
            }
            *slots = [self.lengths(command), self.distance(command)];
            indices[count] = slot;
            let few: [_; FEW] = core::array::from_fn(|i| u32::from(rest[i]));
            indices[count + 1..][..FEW].copy_from_slice(&few);
            count += 1 + inserted;
            indices[count] = slot + 1;
            count += usize::from(command.symbol() >= FIRST_COMMAND_WITH_DISTANCE);
            rest = &rest[inserted..];
            slot += 2;
        }
        let command_count = (slot as usize - first_slot) / 2;
        [command_count, literals.len() - rest.len(), count]
    }
}

with_bmi2! {
    fn write_indexed(indices: &[u32], table: &[Code], writer: &mut BitWriter) {
        writer.write_codes::<4, _>(indices, |index| table[index as usize]);
    }
}

with_bmi2! {
    fn write_literals(literals: &[u16], table: &[Code], writer: &mut BitWriter) {
        writer.write_codes::<5, _>(literals, |literal| table[usize::from(literal)]);
    }
}

/// `table` has the codes of the literals, and [`SLOTS`] more.
fn write_commands(
    mut commands: &[Command],
    literals: &Literals,
    table: &mut [Code],
    codes: &Codes<'_>,
    [literal_blocks, command_blocks, distance_blocks]: &mut [BlockSwitcher<'_>; 3],
    writer: &mut BitWriter,
) -> Result<()> {
    let mut literals = literals.padded();
    let mut current = CurrentCodes {
        commands: &codes.commands[0],
        distances: codes.distances_by_context(0),
    };
    let mut indices = [0; _];
    loop {
        // The last command may copy nothing.
        let count = (commands.len().saturating_sub(1))
            .min(SLOTS / 2)
            .min(command_blocks.cursor.left())
            .min(distance_blocks.cursor.left());
        let max_literals = literal_blocks.cursor.left().min(BATCH_SIZE);
        let padded = &literals[..literals.len().min(max_literals + Literals::SLACK)];
        writer.try_reserve(14 * count + 2 * padded.len())?;
        let [command_count, literal_count, index_count] =
            current.index_batch(&commands[..count], padded, table, &mut indices);
        write_indexed(&indices[..index_count], table, writer);
        command_blocks.cursor.skip(command_count);
        literal_blocks.cursor.skip(literal_count);
        (distance_blocks.cursor).skip(index_count - command_count - literal_count);
        literals = &literals[literal_count..];

        let [command, rest @ ..] = &commands[command_count..] else {
            return Ok(());
        };
        commands = rest;
        if command_blocks.cursor.left() == 0 {
            current.commands = &codes.commands[command_blocks.switch(writer)];
        }
        command_blocks.cursor.skip(1);
        writer.write_bits(current.lengths(command).bits());
        if let Some(extra) = command.separate_length_extra() {
            writer.write_bits(extra);
        }
        let mut left = command.insert_length();
        while left != 0 {
            if literal_blocks.cursor.left() == 0 {
                literal_blocks.switch(writer);
            }
            let count = left.min(literal_blocks.cursor.left()).min(4096);
            writer.try_reserve(2 * count)?;
            write_literals(&literals[..count], table, writer);
            literal_blocks.cursor.skip(count);
            (literals, left) = (&literals[count..], left - count);
        }
        if command.has_distance_symbol() {
            if distance_blocks.cursor.left() == 0 {
                current.distances = codes.distances_by_context(distance_blocks.switch(writer));
            }
            distance_blocks.cursor.skip(1);
            writer.write_bits(current.distance(command).bits());
        }
    }
}

/// One prefix code for each category.
#[inline(never)]
pub(super) fn write_plain_meta_block(
    source: &Source<'_>,
    commands: &[Command],
    params: &Params,
    kind: MetaBlockKind,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> Result<()> {
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/entropy_encode_static.h#L524
    static FIXED_COMMAND_CODES: [Code; COMMAND_SYMBOLS] = {
        let mut lengths = [11; COMMAND_SYMBOLS];
        lengths.split_at_mut(448).0.copy_from_slice(&[9; 448]);
        let mut codes = ROOM_FOR_LENGTHS;
        assign_codes(&lengths, &mut codes);
        codes
    };
    const ROOM_FOR_DISTANCES: [Code; PLAIN_DISTANCE_SYMBOLS] = {
        let (mut room, mut symbol) = ([Code::EMPTY; _], 0);
        while symbol < room.len() {
            room[symbol] = room_for_distance(&DistanceParams::new(0, 0, true), symbol as u32);
            symbol += 1;
        }
        room
    };
    static FIXED_DISTANCE_CODES: [Code; PLAIN_DISTANCE_SYMBOLS] = {
        let mut codes = ROOM_FOR_DISTANCES;
        assign_codes(&[6; 64], &mut codes);
        codes
    };

    let fast = params.quality == 2;
    write_plain_header(writer, kind, source.length);
    let literals = Literals::gather(source, commands)?;
    let mut literal_counts = [0; LITERAL_SYMBOLS];
    for &literal in literals.all() {
        literal_counts[usize::from(literal as u8)] += 1;
    }
    let mut literal_codes = [Code::EMPTY; LITERAL_SYMBOLS + SLOTS];
    let mut build_and_write = |counts: &[u32], alphabet, codes: &mut [Code], writer: &mut _| {
        if fast {
            trees.build_and_write_fast(counts, alphabet, codes, writer);
        } else {
            trees.build_and_write(counts, alphabet, codes, writer);
        }
    };
    build_and_write(
        &literal_counts,
        Alphabet::LITERALS,
        &mut literal_codes,
        writer,
    );

    let (mut command_codes, mut distance_codes);
    let (command_codes, distance_codes) = if fast && commands.len() <= 128 {
        // How the stream describes these two codes.
        writer.write(56, 0x92_6244_1630_7003);
        writer.write(3, 0);
        writer.write(28, 0x0369_DC03);
        (&FIXED_COMMAND_CODES, &FIXED_DISTANCE_CODES)
    } else {
        let mut symbols = [0; COMMAND_SYMBOLS];
        let mut distances = [0; PLAIN_DISTANCE_SYMBOLS];
        for command in commands {
            symbols[command.symbol()] += 1;
            distances[command.distance().symbol()] += u32::from(command.has_distance_symbol());
        }
        command_codes = ROOM_FOR_LENGTHS;
        distance_codes = ROOM_FOR_DISTANCES;
        build_and_write(&symbols, Alphabet::COMMANDS, &mut command_codes, writer);
        build_and_write(
            &distances,
            params.distance.alphabet,
            &mut distance_codes,
            writer,
        );
        (&command_codes, &distance_codes)
    };
    let codes = Codes {
        commands: core::slice::from_ref(command_codes),
        distances: distance_codes,
        distance_symbols: PLAIN_DISTANCE_SYMBOLS,
        distance_map: None,
    };
    let mut switchers = core::array::from_fn(|_| BlockSwitcher::single_block());
    write_commands(
        commands,
        &literals,
        &mut literal_codes,
        &codes,
        &mut switchers,
        writer,
    )
}
