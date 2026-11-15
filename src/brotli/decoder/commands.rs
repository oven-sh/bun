//! The data of a compressed meta-block (RFC 7932 section 9.3).

use core::ops::ControlFlow;

use super::bit_reader::{BitReader, FastReader, REFILLED};
use super::huffman::{
    Forest, Ranges, RangesRoot, Root, Symbol, SymbolLists, SymbolTree, peek_symbol,
};
use super::transform::Transform;
use super::{Blocks, Category, Decoder, Resume, State, Stop, ring_buffer};
use crate::DecodeError;
use crate::context::{
    ContextLut, ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS, distance_context,
};
use crate::dictionary;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, CommandCodes, DISTANCE_SHORT_CODES, DistanceParams,
    FIRST_COMMAND_WITH_DISTANCE, INITIAL_DISTANCES, INSERT_LENGTH_CODES, MAX_ALLOWED_DISTANCE,
    MAX_CODE_LENGTH, SHORT_CODE_BASES, SHORT_CODE_DELTAS,
};

/// In place of a distance context.
const LAST_DISTANCE: u32 = DISTANCE_CONTEXTS as u32;

/// Small: where the extra bits of the insert length end, and the distance context. Large: both lowest lengths.
#[allow(clippy::indexing_slicing)] // Runs at compile time.
static COMMANDS: [Ranges; COMMAND_SYMBOLS.next_power_of_two()] = {
    let mut commands = [Ranges::new(0, [0; 2], 0); _];
    let mut symbol = 0;
    while symbol < COMMAND_SYMBOLS {
        let CommandCodes { insert, copy } = CommandCodes::of(symbol);
        let (insert, copy) = (INSERT_LENGTH_CODES[insert], COPY_LENGTH_CODES[copy]);
        let context = if symbol < FIRST_COMMAND_WITH_DISTANCE {
            LAST_DISTANCE as u8
        } else {
            distance_context(copy)
        };
        commands[symbol] = Ranges::new(
            (insert.extra_bits + copy.extra_bits) as u32,
            [insert.extra_bits, context],
            ((copy.base as u32) << 16) | insert.base as u32,
        );
        symbol += 1;
    }
    commands
};

#[inline(never)]
pub(super) fn push_command_tree(
    forest: &mut Forest<Ranges>,
    code: &SymbolLists,
) -> Result<(), Stop> {
    forest.push(code, Root::Narrow, |symbol, length| {
        #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
        COMMANDS[symbol as usize % COMMANDS.len()].with_code_length(length)
    })
}

/// Large: a short code if the second small number is not zero, or else the lowest distance.
#[inline(never)]
pub(super) fn push_distance_tree(
    forest: &mut Forest<Ranges>,
    code: &SymbolLists,
    params: &DistanceParams,
) -> Result<(), Stop> {
    let (postfix_bits, direct_codes) = (params.postfix_bits, params.direct_codes);
    forest.push(code, Root::Narrow, |symbol, length| {
        let ranges = match symbol.checked_sub(DISTANCE_SHORT_CODES + direct_codes) {
            None if symbol < DISTANCE_SHORT_CODES => Ranges::new(0, [0, 1], symbol),
            None => Ranges::new(0, [0; 2], symbol - DISTANCE_SHORT_CODES + 1),
            Some(code) => {
                let group = code >> postfix_bits;
                let extra_bits = 1 + group / 2;
                let start = ((2 + group % 2) << extra_bits) - 4;
                let postfix = code & ((1 << postfix_bits) - 1);
                let lowest = (start << postfix_bits) + postfix + direct_codes + 1;
                Ranges::new(extra_bits, [0; 2], lowest)
            }
        };
        ranges.with_code_length(length)
    })
}

/// Bits `start..end`.
#[inline(always)]
fn bits_in(bits: u64, start: u32, end: u32) -> u32 {
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    static BELOW: [u64; 256] = {
        let mut masks = [u64::MAX; 256];
        let mut i = 0;
        while i < 64 {
            masks[i] = (1 << i) - 1;
            i += 1;
        }
        masks
    };
    #[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
    let below_end = bits & BELOW[usize::from(end as u8)];
    (below_end >> (start % u64::BITS)) as u32
}

#[derive(Clone, Copy)]
pub(super) struct RecentDistances {
    distances: [u32; 4],
    last: u32,
}

impl Default for RecentDistances {
    fn default() -> Self {
        let mut distances = INITIAL_DISTANCES;
        distances.reverse();
        Self { distances, last: 3 }
    }
}

#[allow(clippy::indexing_slicing)] // Reduced to the size of the tables.
impl RecentDistances {
    /// Zero, or more than [`MAX_ALLOWED_DISTANCE`], if `code` leads to no distance.
    #[inline(always)]
    fn resolve(&self, code: u32) -> u32 {
        let code = code as usize % 16;
        let at = self.last.wrapping_sub(u32::from(SHORT_CODE_BASES[code]));
        self.distances[at as usize % 4].wrapping_add_signed(i32::from(SHORT_CODE_DELTAS[code]))
    }

    /// The last distance is not remembered twice if it came from code zero.
    #[inline(always)]
    fn push(&mut self, distance: u32, is_repeat: bool) {
        self.last = self.last.wrapping_add(u32::from(!is_repeat));
        self.distances[self.last as usize % 4] = distance;
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum Phase {
    #[default]
    InsertLength,
    CopyLength,
    Literals,
    Distance,
}

/// How far the current command got.
#[derive(Clone, Copy, Default)]
pub(super) struct Command {
    pub(super) phase: Phase,
    ranges: Ranges,
    insert_length: usize,
    copy_length: usize,
}

/// What there is to choose from for a block.
struct Trees<'a> {
    symbols: &'a Forest<Symbol>,
    ranges: &'a Forest<Ranges>,
    first: [usize; 3],
    literal_map: &'a [u8],
    distance_map: &'a [u8],
    context_modes: &'a [ContextMode],
}

struct Tables<'a> {
    trees: Trees<'a>,
    ranges: &'a [Ranges],
    command_root: &'a RangesRoot,
    literal_trees: [&'a SymbolTree; LITERAL_CONTEXTS],
    literal_root: Root,
    /// Only the first of `literal_trees` counts.
    ignores_context: bool,
    context_lut: &'static ContextLut,
    distance_roots: [&'a RangesRoot; DISTANCE_CONTEXTS],
    /// What the extra bits of a distance are multiplied by.
    distance_step: u32,
    ring_size: usize,
    ring_limit: usize,
    earlier_laps: usize,
    max_backward_distance: usize,
    dictionary: &'a [u8],
    meta_block_end: usize,
}

impl Tables<'_> {
    fn select(&mut self, category: Category, block_type: usize) -> Result<(), Stop> {
        let (trees, [literals, commands, distances]) = (&self.trees, self.trees.first);
        match category {
            Category::Literal => {
                let map = slice_for::<LITERAL_CONTEXTS>(trees.literal_map, block_type)?;
                self.ignores_context = *map == [map[0]; LITERAL_CONTEXTS];
                let used = if self.ignores_context { 1 } else { map.len() };
                for (tree, &index) in self.literal_trees.iter_mut().zip(map).take(used) {
                    *tree = trees.symbols.tree(literals + usize::from(index))?;
                }
                let mode = trees.context_modes.get(block_type);
                self.context_lut = mode.ok_or(Stop::UNREACHABLE)?.lut();
            }
            Category::Command => self.command_root = trees.ranges.tree(commands + block_type)?,
            Category::Distance => {
                let map = slice_for::<DISTANCE_CONTEXTS>(trees.distance_map, block_type)?;
                for (root, &index) in self.distance_roots.iter_mut().zip(map) {
                    *root = trees.ranges.tree(distances + usize::from(index))?;
                }
            }
        }
        Ok(())
    }

    /// Returns the length of the next block.
    #[inline(never)]
    fn switch(
        &mut self,
        category: Category,
        blocks: &mut [Blocks; 3],
        reader: &mut BitReader<'_>,
    ) -> Result<u32, Stop> {
        let blocks = category.of(blocks);
        blocks.switch(self.trees.symbols, reader)?;
        self.select(category, blocks.current())?;
        Ok(blocks.remaining)
    }

    /// And the length of its code.
    #[inline(always)]
    fn peek_literal<const IN_CONTEXT: bool>(
        &self,
        [last, second_last]: [u8; 2],
        bits: u64,
    ) -> Option<(u8, u32)> {
        let context = self.context_lut.context(last, second_last);
        let tree = self
            .literal_trees
            .get(if IN_CONTEXT { context } else { 0 })?;
        Some(peek_symbol(tree, self.literal_root, bits).literal())
    }
}

struct Cursor<'a, 'b> {
    reader: BitReader<'a>,
    command: Command,
    blocks: &'b mut [Blocks; 3],
    block_remaining: [u32; 3],
    position: usize,
    recent: RecentDistances,
}

impl Command {
    pub(super) fn unwritten_literals(&self) -> usize {
        match self.phase {
            Phase::Literals => self.insert_length,
            _ => 0,
        }
    }
}

impl Decoder {
    #[inline(never)]
    pub(super) fn decode_commands(&mut self, reader: &mut BitReader<'_>) -> Result<State, Stop> {
        let [first_literal_tree, ..] = self.first_trees;
        let any_root = self.ranges.tree(0)?;
        let mut tables = Tables {
            trees: Trees {
                symbols: &self.symbols,
                ranges: &self.ranges,
                first: self.first_trees,
                literal_map: &self.literal_map.trees,
                distance_map: &self.distance_map.trees,
                context_modes: &self.context_modes,
            },
            ranges: self.ranges.entries(),
            command_root: any_root,
            literal_trees: [self.symbols.tree(first_literal_tree)?; LITERAL_CONTEXTS],
            literal_root: self.literal_root,
            ignores_context: true,
            context_lut: ContextMode::Lsb6.lut(),
            distance_roots: [any_root; DISTANCE_CONTEXTS],
            distance_step: 1 << self.distance_params.postfix_bits,
            ring_size: self.ring.size(),
            ring_limit: self.ring.limit(),
            earlier_laps: self.ring.earlier_laps(),
            max_backward_distance: self.max_backward_distance,
            dictionary: &self.dictionary,
            meta_block_end: (self.ring.position + self.command.unwritten_literals())
                .wrapping_add_signed(self.remaining),
        };
        for category in [Category::Literal, Category::Command, Category::Distance] {
            tables.select(category, category.of(&mut self.blocks).current())?;
        }
        let mut cursor = Cursor {
            reader: *reader,
            command: self.command,
            block_remaining: self.blocks.map(|blocks| blocks.remaining),
            blocks: &mut self.blocks,
            position: self.ring.position,
            recent: self.recent_distances,
        };
        let ring = self.ring.bytes_mut();
        let next = loop {
            let stopped = match (cursor.command.phase, tables.ignores_context) {
                (Phase::InsertLength, true) => run_fast::<false>(&tables, &mut cursor, ring),
                (Phase::InsertLength, false) => run_fast::<true>(&tables, &mut cursor, ring),
                _ => None,
            };
            if let Some(next) = stopped.or_else(|| run_carefully(&mut tables, &mut cursor, ring)) {
                break next;
            }
        };
        *reader = cursor.reader;
        self.command = cursor.command;
        self.ring.position = cursor.position;
        let unwritten = match next {
            Ok(State::Copy { length, .. } | State::CopyFromDictionary { length, .. }) => length,
            _ => cursor.command.unwritten_literals(),
        };
        self.remaining = tables.meta_block_end as isize - (cursor.position + unwritten) as isize;
        self.recent_distances = cursor.recent;
        for (blocks, remaining) in cursor.blocks.iter_mut().zip(cursor.block_remaining) {
            blocks.remaining = remaining;
        }
        next
    }
}

fn slice_for<const N: usize>(map: &[u8], block_type: usize) -> Result<&[u8; N], Stop> {
    map.as_chunks().0.get(block_type).ok_or(Stop::UNREACHABLE)
}

/// `None` if decoding goes on in the same blocks.
type Stopped = Option<Result<State, Stop>>;

/// Decodes the commands that are clear of the ends of the input, the blocks, the meta-block and the ring.
#[inline(never)]
fn run_fast<const IN_CONTEXT: bool>(
    tables: &Tables<'_>,
    cursor: &mut Cursor<'_, '_>,
    whole_ring: &mut [u8],
) -> Stopped {
    /// Looking a symbol up does not wait for a refill, so each step leaves enough bits for that.
    const MAX_STEP: u32 = REFILLED - MAX_CODE_LENGTH as u32;

    let limit = (tables.ring_limit.min(tables.max_backward_distance)).min(tables.meta_block_end);
    let limit = limit as u32;
    let mut reader = cursor.reader.begin_fast()?;
    if cursor.position < 2 || !reader.refill() {
        return None;
    }
    let mut position = cursor.position as u32;
    let [mut literals_left, commands_left, distances_left] = cursor.block_remaining;
    // One countdown for both. A command that reads no distance gives that one back.
    let mut left = commands_left.min(distances_left);
    cursor.block_remaining = [0, commands_left - left, distances_left - left];
    let distance_roots = tables.distance_roots;

    let stopped = loop {
        let Some(ring) = whole_ring.get_mut(..limit as usize + ring_buffer::SLACK) else {
            break None;
        };
        let mut command = in_root(tables.command_root, reader.bits.peek());
        if left == 0 || !reader.refill() {
            break None;
        }
        let bits = reader.bits.peek();
        if command.total_length() > MAX_STEP {
            match command.resolve(tables.ranges, bits) {
                Some(resolved) if resolved.total_length() <= MAX_STEP => command = resolved,
                _ => break None,
            }
        }
        let [insert_end, context] = command.small();
        let [_, shortest_copy] = command.halves_of_large();
        let insert = insert_length(command, bits);
        let copy = shortest_copy + bits_in(bits, insert_end, command.total_length());
        let copy_start = position + insert;
        if copy_start + copy >= limit || insert > literals_left {
            break None;
        }
        reader.bits.skip_known(command.total_length());
        left -= 1;

        let mut interrupt = |phase, position| {
            cursor.block_remaining[2] += 1;
            cursor.command = Command {
                phase,
                ranges: *command,
                insert_length: (copy_start - position) as usize,
                copy_length: copy as usize,
            };
        };
        if insert != 0 {
            literals_left -= insert;
            position = read_literals::<IN_CONTEXT>(tables, &mut reader, ring, position, copy_start);
            if position != copy_start {
                literals_left += copy_start - position;
                interrupt(Phase::Literals, position);
                break None;
            }
        }

        let (distance, is_repeat) = match distance_roots.get(context as usize) {
            None => {
                cursor.block_remaining[2] += 1;
                (cursor.recent.resolve(0), true)
            }
            Some(root) => {
                let mut bits = reader.bits.peek();
                let mut ranges = in_root(root, bits);
                if ranges.total_length() + MAX_CODE_LENGTH as u32 > reader.bits.count() {
                    match ranges.resolve(tables.ranges, bits) {
                        Some(resolved)
                            if resolved.total_length() <= MAX_STEP && reader.refill() =>
                        {
                            (ranges, bits) = (resolved, reader.bits.peek());
                        }
                        _ => {
                            interrupt(Phase::Distance, position);
                            break None;
                        }
                    }
                }
                reader.bits.skip_known(ranges.total_length());
                distance_of(ranges, bits, tables, &cursor.recent)
            }
        };

        if distance.wrapping_sub(1) < position {
            cursor.recent.push(distance, is_repeat);
            let (source, target) = ((position - distance) as usize, position as usize);
            position += copy;
            if ring_buffer::copy(ring, source, target, distance as usize, copy as usize).is_none() {
                break Some(Err(Stop::UNREACHABLE));
            }
        } else {
            cursor.position = position as usize;
            let stopped = cursor.copy(tables, whole_ring, distance, is_repeat, copy as usize);
            position = cursor.position as u32;
            if stopped.is_some() {
                break stopped;
            }
        }
    };
    cursor.position = position as usize;
    let [literals, commands, distances] = &mut cursor.block_remaining;
    *literals = literals_left;
    *commands += left;
    *distances += left;
    cursor.reader.end_fast(&reader);
    stopped
}

#[inline(always)]
fn insert_length(command: &Ranges, bits: u64) -> u32 {
    let ([insert_end, _], [shortest, _]) = (command.small(), command.halves_of_large());
    shortest + bits_in(bits, command.code_length(), insert_end)
}

/// And whether it is the last one again.
#[inline(always)]
fn distance_of(
    ranges: &Ranges,
    bits: u64,
    tables: &Tables<'_>,
    recent: &RecentDistances,
) -> (u32, bool) {
    if let [_, 0] = ranges.small() {
        let extra = bits_in(bits, ranges.code_length(), ranges.total_length());
        (ranges.large() + extra * tables.distance_step, false)
    } else {
        (recent.resolve(ranges.large()), ranges.large() == 0)
    }
}

/// From `position`, which is in `2..end`. Returns `end` unless the input ends soon.
#[inline(always)]
fn read_literals<const IN_CONTEXT: bool>(
    tables: &Tables<'_>,
    reader: &mut FastReader<'_>,
    ring: &mut [u8],
    mut position: u32,
    end: u32,
) -> u32 {
    let mut before = [0; 2];
    if IN_CONTEXT {
        let at = position.wrapping_sub(2) as usize;
        let Some(&[second_last, last]) = ring.get(at..at + 2) else {
            return position;
        };
        before = [last, second_last];
    }
    loop {
        // That leaves a fourth code to look at, even if not all of it counts yet.
        for needs_refill in [true, false, false] {
            let literal = tables.peek_literal::<IN_CONTEXT>(before, reader.bits.peek());
            let slot = ring.get_mut(position as usize);
            let (Some((literal, length)), Some(slot)) = (literal, slot) else {
                return position;
            };
            if needs_refill && !reader.refill() {
                return position;
            }
            reader.bits.skip_known(length);
            *slot = literal;
            before = [literal, before[0]];
            position += 1;
            if position == end {
                return position;
            }
        }
    }
}

/// From where the current command was interrupted, whatever gets in its way, and then up to the end of a short input.
#[inline(never)]
fn run_carefully(tables: &mut Tables<'_>, cursor: &mut Cursor<'_, '_>, ring: &mut [u8]) -> Stopped {
    loop {
        let stopped = match read_up_to_copy(tables, cursor, ring) {
            Ok(ControlFlow::Continue((distance, is_repeat))) => {
                cursor.command.phase = Phase::InsertLength;
                let length = cursor.command.copy_length;
                cursor.copy(tables, ring, distance, is_repeat, length)
            }
            Ok(ControlFlow::Break(state)) => Some(Ok(state)),
            Err(stop) => Some(Err(stop)),
        };
        let [.., distances_left] = cursor.block_remaining;
        if stopped.is_some() || (distances_left != 0 && cursor.reader.begin_fast().is_some()) {
            return stopped;
        }
    }
}

/// Returns the distance, and whether it is the last one again.
#[inline(always)]
fn read_up_to_copy(
    tables: &mut Tables<'_>,
    cursor: &mut Cursor<'_, '_>,
    ring: &mut [u8],
) -> Result<ControlFlow<State, (u32, bool)>, Stop> {
    let Cursor {
        reader,
        command,
        blocks,
        block_remaining: [literals_left, commands_left, distances_left],
        position,
        recent,
    } = cursor;
    if command.phase == Phase::InsertLength {
        if *commands_left == 0 {
            *commands_left = tables.switch(Category::Command, blocks, reader)?;
        }
        reader.refill();
        let bits = reader.bits.peek();
        let ranges = look_up(tables.command_root, tables.ranges, bits)?;
        let [insert_end, _] = ranges.small();
        reader.bits.skip(insert_end)?;
        command.ranges = *ranges;
        command.insert_length = insert_length(ranges, bits) as usize;
        command.phase = Phase::CopyLength;
    }
    let [insert_end, context] = command.ranges.small();

    if command.phase == Phase::CopyLength {
        let extra = reader.read(command.ranges.total_length() - insert_end)?;
        let [_, shortest] = command.ranges.halves_of_large();
        command.copy_length = (shortest + extra) as usize;
        *commands_left -= 1;
        command.phase = Phase::Literals;
    }

    if command.phase == Phase::Literals {
        while command.insert_length != 0 {
            if *literals_left == 0 {
                *literals_left = tables.switch(Category::Literal, blocks, reader)?;
            }
            let start = *position;
            let end = start + command.insert_length.min(*literals_left as usize);
            let end = end.min(tables.ring_limit);
            let result = read_some_literals(tables, reader, ring, position, end);
            command.insert_length -= *position - start;
            *literals_left -= (*position - start) as u32;
            result?;
            if *position == tables.ring_limit {
                return Ok(ControlFlow::Break(State::RingLimit(Resume::Commands)));
            }
        }
        if *position >= tables.meta_block_end {
            return Ok(ControlFlow::Break(State::MetaBlockDone));
        }
        command.phase = Phase::Distance;
    }

    if *distances_left == 0 && context != LAST_DISTANCE {
        *distances_left = tables.switch(Category::Distance, blocks, reader)?;
    }
    let Some(root) = tables.distance_roots.get(context as usize) else {
        return Ok(ControlFlow::Continue((recent.resolve(0), true)));
    };
    reader.refill();
    let bits = reader.bits.peek();
    let ranges = look_up(root, tables.ranges, bits)?;
    reader.bits.skip(ranges.total_length())?;
    *distances_left -= 1;
    let distance = distance_of(ranges, bits, tables, recent);
    Ok(ControlFlow::Continue(distance))
}

#[inline(always)]
#[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
fn in_root(root: &RangesRoot, bits: u64) -> &Ranges {
    &root[usize::from(bits as u8)]
}

#[inline(always)]
fn look_up<'a>(root: &'a RangesRoot, entries: &'a [Ranges], bits: u64) -> Result<&'a Ranges, Stop> {
    (in_root(root, bits).resolve(entries, bits)).ok_or(Stop::UNREACHABLE)
}

#[inline(always)]
fn read_some_literals(
    tables: &Tables<'_>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    position: &mut usize,
    end: usize,
) -> Result<(), Stop> {
    if tables.ignores_context {
        read_some_literals_with::<false>(tables, reader, ring, position, end)
    } else {
        read_some_literals_with::<true>(tables, reader, ring, position, end)
    }
}

#[inline(never)]
fn read_some_literals_with<const IN_CONTEXT: bool>(
    tables: &Tables<'_>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    position: &mut usize,
    mut end: usize,
) -> Result<(), Stop> {
    if *position < 2 {
        end = end.min(2);
    } else if let Some(mut fast) = reader.begin_fast()
        && fast.refill()
    {
        let (start, end) = (*position as u32, end as u32);
        *position = read_literals::<IN_CONTEXT>(tables, &mut fast, ring, start, end) as usize;
        reader.end_fast(&fast);
    }
    let before = |n: usize| {
        let at = position.wrapping_sub(n) & (tables.ring_size - 1);
        ring.get(at).copied().unwrap_or(0)
    };
    let mut before = [before(1), before(2)];
    let (mut local, mut count, mut result) = (*reader, 0, Ok(()));
    for slot in ring.get_mut(*position..end).ok_or(Stop::UNREACHABLE)? {
        if local.bits.count() < MAX_CODE_LENGTH as u32 {
            local.refill();
        }
        let literal = tables.peek_literal::<IN_CONTEXT>(before, local.bits.peek());
        let (literal, length) = literal.ok_or(Stop::UNREACHABLE)?;
        result = local.bits.skip(length);
        if result.is_err() {
            break;
        }
        *slot = literal;
        before = [literal, before[0]];
        count += 1;
    }
    *reader = local;
    *position += count;
    result
}

impl Cursor<'_, '_> {
    #[inline(never)]
    fn copy(
        &mut self,
        tables: &Tables<'_>,
        ring: &mut [u8],
        distance: u32,
        is_repeat: bool,
        length: usize,
    ) -> Stopped {
        let max_distance = (tables.max_backward_distance).min(self.position + tables.earlier_laps);
        if (distance as usize).wrapping_sub(1) < max_distance {
            self.recent.push(distance, is_repeat);
            let distance = distance as usize;
            let source = self.position.wrapping_sub(distance) & (tables.ring_size - 1);
            if self.position + length >= tables.ring_limit {
                return Some(Ok(State::Copy { distance, length }));
            }
            let before_wrap = length.min(tables.ring_size - source);
            for (source, length) in [(source, before_wrap), (0, length - before_wrap)] {
                if length != 0
                    && ring_buffer::copy(ring, source, self.position, distance, length).is_none()
                {
                    return Some(Err(Stop::UNREACHABLE));
                }
                self.position += length;
            }
        } else {
            if distance == 0 || distance > MAX_ALLOWED_DISTANCE {
                return Some(Err(DecodeError::Distance.into()));
            }
            let beyond = distance as usize - max_distance;
            if let Some(offset) = tables.dictionary.len().checked_sub(beyond) {
                if length > beyond {
                    return Some(Err(DecodeError::CompoundDictionary.into()));
                }
                self.recent.push(distance, is_repeat);
                let end = self.position + length;
                if end >= tables.ring_limit {
                    return Some(Ok(State::CopyFromDictionary { offset, length }));
                }
                let source = tables.dictionary.split_at(offset).1;
                if ring_buffer::copy_from(source, ring, self.position, length).is_none() {
                    return Some(Err(Stop::UNREACHABLE));
                }
                self.position = end;
            } else {
                let address = beyond - tables.dictionary.len() - 1;
                match write_word(ring, self.position, length, address) {
                    Ok(written) => self.position += written,
                    Err(stop) => return Some(Err(stop)),
                }
                if self.position >= tables.ring_limit {
                    return Some(Ok(State::RingLimit(Resume::Commands)));
                }
            }
        }
        (self.position >= tables.meta_block_end).then_some(Ok(State::MetaBlockDone))
    }
}

/// Returns the length of the transformed word.
#[inline(always)]
fn write_word(
    ring: &mut [u8],
    position: usize,
    length: usize,
    address: usize,
) -> Result<usize, Stop> {
    if !(dictionary::MIN_WORD_LENGTH..=dictionary::MAX_WORD_LENGTH).contains(&length) {
        return Err(DecodeError::Dictionary.into());
    }
    let index_bits = dictionary::size_bits(length);
    let word = dictionary::padded_word(length, address & ((1 << index_bits) - 1))
        .ok_or(Stop::UNREACHABLE)?;
    let transform = Transform::get(address >> index_bits).ok_or(DecodeError::Transform)?;
    let out = ring.get_mut(position..).and_then(<[u8]>::first_chunk_mut);
    (out.and_then(|out| transform.apply(word, length, out))).ok_or(Stop::UNREACHABLE)
}
