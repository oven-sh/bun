//! The data of a compressed meta-block (RFC 7932 section 9.3).

use super::bit_reader::{BitReader, FastReader, REFILLED};
use super::huffman::{
    Forest, Ranges, RangesRoot, Root, Symbol, SymbolLists, SymbolTree, peek_symbol,
};
use super::{Blocks, Decoder, Resume, State, Stop, ring_buffer};
use crate::DecodeError;
use crate::context::{
    ContextLut, ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS, distance_context,
};
use crate::dictionary;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, CommandCodes, DISTANCE_SHORT_CODES, DistanceParams,
    FIRST_COMMAND_WITH_DISTANCE, INITIAL_DISTANCES, INSERT_LENGTH_CODES, MAX_ALLOWED_DISTANCE,
    MAX_BLOCK_TYPES, MAX_CODE_LENGTH, SHORT_CODE_BASES, SHORT_CODE_DELTAS,
};
use crate::transform::Transform;

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
struct RecentDistances {
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
enum Phase {
    #[default]
    Lengths,
    Literals,
    Distance,
}

/// How far the current command got.
#[derive(Clone, Copy, Default)]
pub(super) struct Command {
    phase: Phase,
    distance_context: u32,
    pub(super) unwritten_literals: u32,
    copy_length: u32,
}

struct Tables<'a> {
    symbols: &'a Forest<Symbol>,
    ranges: &'a Forest<Ranges>,
    first_trees: [usize; 3],
    literal_root: Root,
    literal_map: &'a [u8],
    distance_map: &'a [u8],
    context_modes: &'a [Option<ContextMode>; MAX_BLOCK_TYPES],
    /// What the extra bits of a distance are multiplied by.
    distance_step: u32,
    ring_size: usize,
    ring_limit: usize,
    earlier_laps: usize,
    max_backward_distance: usize,
    dictionary: &'a [u8],
    meta_block_end: usize,
}

impl<'a> Tables<'a> {
    #[inline(always)]
    fn literal_contexts(&self, block_type: usize) -> Result<LiteralContexts<'a>, Stop> {
        let mode = self.context_modes.get(block_type);
        let map = slice_for(self.literal_map, block_type)?;
        Ok(LiteralContexts {
            block_type,
            lut: mode.ok_or(Stop::UNREACHABLE)?.map(ContextMode::lut),
            map,
            first: self.literal_tree(map[0])?,
        })
    }

    #[inline(always)]
    fn literal_tree(&self, index: u8) -> Result<&'a SymbolTree, Stop> {
        self.symbols.tree(self.first_trees[0] + usize::from(index))
    }

    #[inline(always)]
    fn command_root(&self, block_type: usize) -> Result<&'a RangesRoot, Stop> {
        self.ranges.tree(self.first_trees[1] + block_type)
    }

    #[inline(always)]
    fn distance_root(&self, index: u8) -> Result<&'a RangesRoot, Stop> {
        self.ranges.tree(self.first_trees[2] + usize::from(index))
    }

    /// Where neither the ring nor the meta-block gets in the way.
    #[inline(always)]
    fn clear_end(&self) -> usize {
        (self.ring_limit.min(self.max_backward_distance)).min(self.meta_block_end)
    }
}

#[derive(Clone, Copy)]
struct LiteralContexts<'a> {
    block_type: usize,
    /// `None` if all of them have the same tree.
    lut: Option<&'static ContextLut>,
    map: &'a [u8; LITERAL_CONTEXTS],
    first: &'a SymbolTree,
}

trait LiteralTrees {
    const IN_CONTEXT: bool;
    fn after(&self, last: u8, second_last: u8) -> &SymbolTree;
}

impl LiteralTrees for SymbolTree {
    const IN_CONTEXT: bool = false;

    #[inline(always)]
    fn after(&self, _: u8, _: u8) -> &SymbolTree {
        self
    }
}

/// Looked up in advance, which only pays for many literals.
struct TreesByContext<'a> {
    block_type: usize,
    lut: &'static ContextLut,
    trees: [&'a SymbolTree; LITERAL_CONTEXTS],
}

impl LiteralTrees for TreesByContext<'_> {
    const IN_CONTEXT: bool = true;

    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    fn after(&self, last: u8, second_last: u8) -> &SymbolTree {
        self.trees[self.lut.context(last, second_last) % LITERAL_CONTEXTS]
    }
}

impl<'a> TreesByContext<'a> {
    #[inline(never)]
    fn select<'b>(
        selected: &'b mut Option<Self>,
        tables: &Tables<'a>,
        contexts: &LiteralContexts<'a>,
        lut: &'static ContextLut,
    ) -> Result<&'b Self, Stop> {
        selected.take_if(|trees| trees.block_type != contexts.block_type);
        match selected {
            Some(trees) => Ok(trees),
            none => {
                let selected = none.insert(Self {
                    block_type: contexts.block_type,
                    lut,
                    trees: [contexts.first; _],
                });
                for (tree, &index) in selected.trees.iter_mut().zip(contexts.map) {
                    *tree = tables.literal_tree(index)?;
                }
                Ok(selected)
            }
        }
    }
}

/// What commands change, other than the ring.
pub(super) struct Cursor {
    pub(super) command: Command,
    pub(super) blocks: [Blocks; 3],
    recent: RecentDistances,
    /// That of the ring, while commands are decoded.
    position: usize,
}

impl Default for Cursor {
    fn default() -> Self {
        Self {
            command: Command::default(),
            blocks: [Blocks::SINGLE; 3],
            recent: RecentDistances::default(),
            position: 0,
        }
    }
}

/// What it takes for the fast loops to make up for getting ready.
const MANY_BYTES: usize = 32;
/// The same for [`Cursor::work_left`].
const MUCH_WORK: u32 = 32;
/// Until the fast loop gets another try, however often it did not get far.
const MAX_CAREFUL_COMMANDS: u32 = 64;

#[inline(always)]
fn is_clear(tables: &Tables<'_>, reader: &BitReader<'_>, position: usize) -> bool {
    reader.input_len() >= MANY_BYTES
        && (2..tables.clear_end().saturating_sub(MANY_BYTES)).contains(&position)
}

impl Decoder {
    #[inline(never)]
    pub(super) fn decode_commands(&mut self, reader: &mut BitReader<'_>) -> Result<State, Stop> {
        let tables = Tables {
            symbols: &self.symbols,
            ranges: &self.ranges,
            first_trees: self.first_trees,
            literal_root: self.literal_root,
            literal_map: &self.literal_map.trees,
            distance_map: &self.distance_map.trees,
            context_modes: &self.context_modes,
            distance_step: 1 << self.distance_params.postfix_bits,
            ring_size: self.ring.size(),
            ring_limit: self.ring.limit(),
            earlier_laps: self.ring.earlier_laps(),
            max_backward_distance: self.max_backward_distance,
            dictionary: &self.dictionary,
            meta_block_end: (self.ring.position + self.cursor.command.unwritten_literals as usize)
                .wrapping_add_signed(self.remaining),
        };
        let cursor = &mut self.cursor;
        cursor.position = self.ring.position;
        let ring = self.ring.bytes_mut();
        let mut trees = None;
        let mut careful_commands = 1;
        let mut is_fast =
            cursor.command.phase == Phase::Lengths && is_clear(&tables, reader, cursor.position);
        let next = loop {
            let stopped = if is_fast {
                let before = cursor.work_left();
                let stopped = run_fast_in_block(&tables, &mut trees, cursor, reader, ring);
                careful_commands = match before - cursor.work_left() {
                    ..MUCH_WORK => (2 * careful_commands).min(MAX_CAREFUL_COMMANDS),
                    _ => 1,
                };
                stopped.unwrap_or_else(|stop| Some(Err(stop)))
            } else {
                run_carefully(&tables, &mut trees, careful_commands, cursor, reader, ring)
            };
            if let Some(next) = stopped {
                break next;
            }
            is_fast = !is_fast;
        };
        self.ring.position = cursor.position;
        let unwritten = match next {
            Ok(State::Copy { length, .. } | State::CopyFromDictionary { length, .. }) => length,
            _ => cursor.command.unwritten_literals as usize,
        };
        self.remaining = tables.meta_block_end as isize - (cursor.position + unwritten) as isize;
        next
    }
}

#[inline(always)]
fn slice_for<const N: usize>(map: &[u8], block_type: usize) -> Result<&[u8; N], Stop> {
    map.as_chunks().0.get(block_type).ok_or(Stop::UNREACHABLE)
}

/// `None` if decoding goes on.
type Stopped = Option<Result<State, Stop>>;

#[inline(always)]
fn run_fast_in_block<'a>(
    tables: &Tables<'a>,
    trees: &mut Option<TreesByContext<'a>>,
    cursor: &mut Cursor,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Result<Stopped, Stop> {
    let contexts = tables.literal_contexts(cursor.blocks[0].current())?;
    Ok(match contexts.lut {
        None => run_fast(tables, contexts.first, cursor, reader, ring),
        Some(lut) => {
            let is_selected =
                matches!(trees, Some(trees) if trees.block_type == contexts.block_type);
            if !is_selected && (cursor.blocks[0].remaining as usize) < MANY_BYTES {
                return Ok(None);
            }
            let trees = TreesByContext::select(trees, tables, &contexts, lut)?;
            run_fast(tables, trees, cursor, reader, ring)
        }
    })
}

/// Decodes the commands that are clear of the ends of the input, the blocks, the meta-block and the ring.
#[inline(never)]
fn run_fast(
    tables: &Tables<'_>,
    trees: &impl LiteralTrees,
    cursor: &mut Cursor,
    whole_input: &mut BitReader<'_>,
    whole_ring: &mut [u8],
) -> Stopped {
    /// Looking a symbol up does not wait for a refill, so each step leaves enough bits for that.
    const MAX_STEP: u32 = REFILLED - MAX_CODE_LENGTH as u32;

    let [literals, commands, distances] = &mut cursor.blocks;
    let command_root = tables.command_root(commands.current()).ok()?;
    let [a, b, c, d] = *slice_for(tables.distance_map, distances.current()).ok()?;
    let root = |index| tables.distance_root(index).ok();
    let distance_roots = [root(a)?, root(b)?, root(c)?, root(d)?];
    let all_ranges = tables.ranges.entries();
    let limit = tables.clear_end() as u32;
    let mut reader = whole_input.begin_fast()?;
    let mut position = cursor.position as u32;
    let mut literals_left = literals.remaining;
    let mut left = commands.remaining;

    let stopped = loop {
        let Some(ring) = whole_ring.get_mut(..limit as usize + ring_buffer::SLACK) else {
            break None;
        };
        let mut command = in_root(command_root, reader.bits.peek());
        if left == 0 || !reader.refill() {
            break None;
        }
        let bits = reader.bits.peek();
        if command.total_length() > MAX_STEP {
            match command.resolve(all_ranges, bits) {
                Some(resolved) if resolved.total_length() <= MAX_STEP => command = resolved,
                _ => break None,
            }
        }
        let [_, context] = command.small();
        let [insert, copy] = lengths_of(command, bits);
        let copy_start = position + insert;
        if copy_start + copy >= limit || insert > literals_left {
            break None;
        }
        reader.bits.skip_known(command.total_length());
        left -= 1;

        let mut interrupt = |phase, position| {
            cursor.command = Command {
                phase,
                distance_context: context,
                unwritten_literals: copy_start - position,
                copy_length: copy,
            };
        };
        if insert != 0 {
            literals_left -= insert;
            let root = tables.literal_root;
            position = read_literals(trees, root, &mut reader, ring, position, copy_start);
            if position != copy_start {
                literals_left += copy_start - position;
                interrupt(Phase::Literals, position);
                break None;
            }
        }

        let (distance, is_repeat) = match distance_roots.get(context as usize) {
            None => (cursor.recent.resolve(0), true),
            Some(root) => {
                let Some(distances_left) = cursor.blocks[2].remaining.checked_sub(1) else {
                    interrupt(Phase::Distance, position);
                    break None;
                };
                let mut bits = reader.bits.peek();
                let mut ranges = in_root(root, bits);
                if ranges.total_length() + MAX_CODE_LENGTH as u32 > reader.bits.count() {
                    match ranges.resolve(all_ranges, bits) {
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
                cursor.blocks[2].remaining = distances_left;
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
            core::hint::cold_path();
            cursor.position = position as usize;
            let stopped = cursor.copy(tables, whole_ring, distance, is_repeat, copy as usize);
            position = cursor.position as u32;
            if stopped.is_some() {
                break stopped;
            }
        }
    };
    cursor.position = position as usize;
    let [literals, commands, _] = &mut cursor.blocks;
    literals.remaining = literals_left;
    commands.remaining = left;
    whole_input.end_fast(&reader);
    stopped
}

/// Of the insert and of the copy.
#[inline(always)]
fn lengths_of(command: &Ranges, bits: u64) -> [u32; 2] {
    let ([insert_end, _], [insert, copy]) = (command.small(), command.halves_of_large());
    [
        insert + bits_in(bits, command.code_length(), insert_end),
        copy + bits_in(bits, insert_end, command.total_length()),
    ]
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
fn read_literals<T: LiteralTrees>(
    trees: &T,
    root: Root,
    reader: &mut FastReader<'_>,
    ring: &mut [u8],
    position: u32,
    end: u32,
) -> u32 {
    let mut before = [0; 2];
    if T::IN_CONTEXT {
        let at = position.wrapping_sub(2) as usize;
        let Some(&[second_last, last]) = ring.get(at..at + 2) else {
            return position;
        };
        before = [last, second_last];
    }
    let Some([first, rest @ ..]) = ring.get_mut(position as usize..end as usize) else {
        return position;
    };
    let (mut slot, mut rest) = (first, rest.iter_mut());
    loop {
        // That leaves a fourth code to look at, even if not all of it counts yet.
        for needs_refill in [true, false, false] {
            let tree = trees.after(before[0], before[1]);
            let (literal, length) = peek_symbol(tree, root, reader.bits.peek()).literal();
            if needs_refill && !reader.refill() {
                return end - 1 - rest.len() as u32;
            }
            reader.bits.skip_known(length);
            *slot = literal;
            before = [literal, before[0]];
            let Some(next) = rest.next() else {
                return end;
            };
            slot = next;
        }
    }
}

/// From where the current command was interrupted, whatever gets in its way, for `min_commands` and until several more are clear.
#[inline(never)]
fn run_carefully<'a>(
    tables: &Tables<'a>,
    trees: &mut Option<TreesByContext<'a>>,
    mut min_commands: u32,
    cursor: &mut Cursor,
    shared_reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Stopped {
    let (mut reader, mut command, mut position) = (*shared_reader, cursor.command, cursor.position);
    let mut run = || {
        let [literals, commands, distances] = &cursor.blocks;
        let mut contexts = tables.literal_contexts(literals.current())?;
        let mut command_root = tables.command_root(commands.current())?;
        let mut distance_map =
            slice_for::<DISTANCE_CONTEXTS>(tables.distance_map, distances.current())?;
        let copy_limit = tables.ring_limit.min(tables.meta_block_end);
        loop {
            let [literals, commands, distances] = &mut cursor.blocks;
            if command.phase == Phase::Lengths {
                if commands.remaining == 0 {
                    commands.switch(tables.symbols, &mut reader)?;
                    command_root = tables.command_root(commands.current())?;
                }
                reader.refill();
                let bits = reader.bits.peek();
                let ranges = look_up(command_root, tables.ranges.entries(), bits)?;
                reader.skip_peeked(ranges.total_length())?;
                [_, command.distance_context] = ranges.small();
                [command.unwritten_literals, command.copy_length] = lengths_of(ranges, bits);
                commands.remaining -= 1;
                command.phase = Phase::Literals;
            }

            if command.phase == Phase::Literals {
                while command.unwritten_literals != 0 {
                    if literals.remaining == 0 {
                        literals.switch(tables.symbols, &mut reader)?;
                        contexts = tables.literal_contexts(literals.current())?;
                    }
                    let start = position;
                    let end = start + command.unwritten_literals.min(literals.remaining) as usize;
                    let mut end = end.min(tables.ring_limit);
                    if end - start >= MANY_BYTES && reader.input_len() >= MANY_BYTES {
                        core::hint::cold_path();
                        if start < 2 {
                            end = 2;
                        } else {
                            // Lending a copy lets `reader` stay in registers.
                            let mut lent = reader;
                            position = read_many_literals(
                                tables, contexts, trees, &mut lent, ring, start, end,
                            )?;
                            reader = lent;
                        }
                    }
                    let result =
                        read_few_literals(tables, contexts, &mut reader, ring, &mut position, end);
                    command.unwritten_literals -= (position - start) as u32;
                    literals.remaining -= (position - start) as u32;
                    result?;
                    if position == tables.ring_limit {
                        return Ok(Some(State::RingLimit(Resume::Commands)));
                    }
                }
                if position >= tables.meta_block_end {
                    return Ok(Some(State::MetaBlockDone));
                }
                command.phase = Phase::Distance;
            }

            let (distance, is_repeat) = if command.distance_context == LAST_DISTANCE {
                (cursor.recent.resolve(0), true)
            } else {
                if distances.remaining == 0 {
                    distances.switch(tables.symbols, &mut reader)?;
                    distance_map = slice_for(tables.distance_map, distances.current())?;
                }
                reader.refill();
                let bits = reader.bits.peek();
                #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
                let index = distance_map[command.distance_context as usize % DISTANCE_CONTEXTS];
                let ranges = look_up(tables.distance_root(index)?, tables.ranges.entries(), bits)?;
                reader.bits.skip(ranges.total_length())?;
                distances.remaining -= 1;
                distance_of(ranges, bits, tables, &cursor.recent)
            };
            command.phase = Phase::Lengths;

            let (back, length) = (distance as usize, command.copy_length as usize);
            if back.wrapping_sub(1) < position.min(tables.max_backward_distance)
                && position + length < copy_limit
            {
                cursor.recent.push(distance, is_repeat);
                ring_buffer::copy(ring, position - back, position, back, length)
                    .ok_or(Stop::UNREACHABLE)?;
                position += length;
            } else {
                core::hint::cold_path();
                cursor.position = position;
                let stopped = cursor.copy(tables, ring, distance, is_repeat, length);
                position = cursor.position;
                if let Some(stopped) = stopped {
                    return stopped.map(Some);
                }
            }
            if min_commands > 1 {
                min_commands -= 1;
            } else if cursor.blocks[1].remaining > 1 && is_clear(tables, &reader, position) {
                return Ok(None);
            }
        }
    };
    let stopped = run().transpose();
    (*shared_reader, cursor.command, cursor.position) = (reader, command, position);
    stopped
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

/// See [`read_literals`].
#[inline(never)]
fn read_many_literals<'a>(
    tables: &Tables<'a>,
    contexts: LiteralContexts<'a>,
    trees: &mut Option<TreesByContext<'a>>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    start: usize,
    end: usize,
) -> Result<usize, Stop> {
    let Some(mut fast) = reader.begin_fast() else {
        return Ok(start);
    };
    let (root, start, end) = (tables.literal_root, start as u32, end as u32);
    let position = match contexts.lut {
        None => read_literals(contexts.first, root, &mut fast, ring, start, end),
        Some(lut) => {
            let trees = TreesByContext::select(trees, tables, &contexts, lut)?;
            read_literals(trees, root, &mut fast, ring, start, end)
        }
    };
    reader.end_fast(&fast);
    Ok(position as usize)
}

#[inline(always)]
fn read_few_literals(
    tables: &Tables<'_>,
    contexts: LiteralContexts<'_>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    position: &mut usize,
    end: usize,
) -> Result<(), Stop> {
    let before = |n: usize| {
        let at = position.wrapping_sub(n) & (tables.ring_size - 1);
        ring.get(at).copied().unwrap_or(0)
    };
    let (mut last, mut second_last) = (contexts.lut).map_or((0, 0), |_| (before(1), before(2)));
    let mut tree = contexts.first;
    for slot in ring.get_mut(*position..end).ok_or(Stop::UNREACHABLE)? {
        reader.refill_for(MAX_CODE_LENGTH as u32);
        if let Some(lut) = contexts.lut {
            #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
            let index = contexts.map[lut.context(last, second_last) % LITERAL_CONTEXTS];
            tree = tables.literal_tree(index)?;
        }
        let (literal, length) =
            peek_symbol(tree, tables.literal_root, reader.bits.peek()).literal();
        reader.bits.skip(length)?;
        *slot = literal;
        (last, second_last) = (literal, last);
        *position += 1;
    }
    Ok(())
}

impl Cursor {
    /// In the current blocks, as the number of literals that take as long.
    fn work_left(&self) -> u32 {
        let [literals, commands, _] = &self.blocks;
        literals.remaining + 8 * commands.remaining
    }

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
