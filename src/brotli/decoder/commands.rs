//! The data of a compressed meta-block (RFC 7932 section 9.3).

mod lanes;
mod portable;

use core::hint::select_unpredictable;

use bun_core::vec::BorrowedCursor;
use bun_highway::brotli_decoder::{
    self as machine, ContextParts, Destination, Distance, Format, Frame, Machine, MetaBlock,
    Progress, Root, SymbolLists, SymbolTree, Uncoded, Unfinished,
};
use bun_highway::{with_avx2, with_bmi2};

use super::bit_reader::BitReader;
use super::huffman::{Forest, peek_symbol};
use super::ring_buffer;
use super::{Blocks, Codes, Decoder, Resume, State, Stop};
use crate::DecodeError;
use crate::context::{
    ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS, context_of_sum, distance_context,
};
use crate::dictionary;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, CommandCodes, DISTANCE_SHORT_CODES, DistanceParams,
    FIRST_COMMAND_WITH_DISTANCE, INITIAL_DISTANCES, INSERT_LENGTH_CODES, MAX_ALLOWED_DISTANCE,
    MAX_CODE_LENGTH, SHORT_CODE_BASES, SHORT_CODE_DELTAS,
};
use crate::transform::{self, Transform};

const LAST_DISTANCE: u32 = machine::Command::LAST_DISTANCE;

#[allow(clippy::indexing_slicing)] // Runs at compile time.
static FORMAT: Format = {
    let mut inserts = [(0, 0); INSERT_LENGTH_CODES.len()];
    let mut code = 0;
    while code < inserts.len() {
        let insert = INSERT_LENGTH_CODES[code];
        inserts[code] = (insert.base, insert.extra_bits);
        code += 1;
    }
    let (words, index_bits) = (&dictionary::WORDS, dictionary::SIZE_BITS_BY_LENGTH);
    Format::new(&inserts, words, index_bits, &transform::for_machine())
};

#[allow(clippy::indexing_slicing)] // Runs at compile time.
static COMMANDS: [Uncoded<machine::Command>; COMMAND_SYMBOLS.next_power_of_two()] = {
    let mut commands = [machine::Command::new(0, [0; 2], 2, 0); _];
    let mut symbol = 0;
    while symbol < COMMAND_SYMBOLS {
        let CommandCodes { insert, copy } = CommandCodes::of(symbol);
        let copy = COPY_LENGTH_CODES[copy];
        let context = if symbol < FIRST_COMMAND_WITH_DISTANCE {
            LAST_DISTANCE as u8
        } else {
            distance_context(copy)
        };
        let extra_bits = [INSERT_LENGTH_CODES[insert].extra_bits, copy.extra_bits];
        commands[symbol] = machine::Command::new(insert as u8, extra_bits, copy.base, context);
        symbol += 1;
    }
    commands
};

pub(super) fn push_command_tree(
    forest: &mut Forest<machine::Command>,
    code: &SymbolLists,
    root: Root,
) -> Result<(), Stop> {
    forest.push(code, root, |symbol, length| {
        #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
        COMMANDS[symbol as usize % COMMANDS.len()].with_code_length(length)
    })
}

#[inline(always)]
const fn distance_for(symbol: u32, postfix_bits: u32, direct_codes: u32) -> Uncoded<Distance> {
    let code = symbol.wrapping_sub(DISTANCE_SHORT_CODES + direct_codes);
    let group = code >> postfix_bits;
    let extra_bits = 1 + group / 2;
    let start = (2 + group % 2).wrapping_shl(extra_bits);
    let start = start.wrapping_sub(4).wrapping_sub(group) << postfix_bits;
    let unless_direct = ((code <= symbol) as u32).wrapping_neg();
    let if_direct = symbol.wrapping_sub(DISTANCE_SHORT_CODES - 1);
    let lowest = if_direct.wrapping_add(start & unless_direct);
    Distance::new(extra_bits & unless_direct, lowest)
}

pub(super) fn push_distance_tree(
    forest: &mut Forest<Distance>,
    code: &SymbolLists,
    params: &DistanceParams,
) -> Result<(), Stop> {
    const USUAL_PARAMS: DistanceParams = DistanceParams::new(0, 0, false);
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    static USUAL: [Uncoded<Distance>; USUAL_PARAMS.alphabet.size as usize] = {
        let (mut all, mut code) = ([Distance::new(0, 0); _], 0);
        while code < all.len() {
            all[code] = match code {
                ..16 => Distance::from_recent(SHORT_CODE_BASES[code], SHORT_CODE_DELTAS[code]),
                _ => distance_for(code as u32, 0, 0),
            };
            code += 1;
        }
        all
    };
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    let usual = |symbol: u32| USUAL[symbol as usize % USUAL.len()];
    if params.alphabet == USUAL_PARAMS.alphabet {
        return forest.push(code, Root::Bits8, |symbol, length| {
            usual(symbol).with_code_length(length)
        });
    }
    forest.push(code, Root::Bits8, |symbol, length| {
        let long = distance_for(symbol, params.postfix_bits, params.direct_codes);
        select_unpredictable(symbol < DISTANCE_SHORT_CODES, usual(symbol), long)
            .with_code_length(length)
    })
}

/// Bits `start..end`. Making the mask takes long on x64.
#[inline(always)]
fn bits_in(bits: u64, start: u32, end: u32) -> u32 {
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    static BELOW: [u64; u64::BITS as usize] = {
        let mut masks = [0; u64::BITS as usize];
        let mut i = 0;
        while i < masks.len() {
            masks[i] = (1 << i) - 1;
            i += 1;
        }
        masks
    };
    debug_assert!(end < u64::BITS);
    let end = end % u64::BITS;
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    let below_end = if cfg!(target_arch = "x86_64") {
        BELOW[end as usize]
    } else {
        (1 << end) - 1
    };
    ((bits & below_end) >> (start % u64::BITS)) as u32
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
    #[inline(always)]
    fn get(&self, age: u8) -> u32 {
        self.distances[self.last.wrapping_sub(u32::from(age)) as usize % 4]
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
    codes: &'a Codes,
    /// What the extra bits of a distance are multiplied by.
    distance_step: u32,
    max_backward_distance: usize,
    ring_limit: usize,
    last_lap: usize,
    padded_dictionary: &'a [u8],
    meta_block_end: usize,
}

impl<'a> Tables<'a> {
    #[inline(always)]
    fn literal_contexts(&self, block_type: usize) -> Result<LiteralContexts<'a>, Stop> {
        let mode = self.codes.context_modes.get(block_type);
        let map = self.codes.literal_map.of(block_type);
        Ok(LiteralContexts {
            block_type,
            mode: *mode.ok_or(Stop::UNREACHABLE)?,
            map,
            first: self.literal_tree(map[0])?,
        })
    }

    #[inline(always)]
    fn literal_tree(&self, index: u8) -> Result<&'a SymbolTree, Stop> {
        (self.codes.symbols).tree(self.codes.first_literal_tree + usize::from(index))
    }

    /// Where neither the ring nor the meta-block gets in the way.
    #[inline(always)]
    fn clear_end(&self) -> usize {
        self.ring_limit.min(self.meta_block_end)
    }
}

#[derive(Clone, Copy)]
struct LiteralContexts<'a> {
    block_type: usize,
    /// `None` if all of them have the same tree.
    mode: Option<ContextMode>,
    map: &'a [u8; LITERAL_CONTEXTS],
    first: &'a SymbolTree,
}

impl<'a> LiteralContexts<'a> {
    /// For each sum of the parts of a context.
    #[inline(always)]
    fn look_up(&self, tables: &Tables<'a>, trees: &mut TreesByContext<'a>) -> Result<(), Stop> {
        let (forest, first) = (&tables.codes.symbols, tables.codes.first_literal_tree);
        (forest.look_up(first, self.map, trees)).ok_or(Stop::UNREACHABLE)?;
        for sum in LITERAL_CONTEXTS..LITERAL_CONTEXTS + 16 {
            let tree = *trees.get(context_of_sum(sum)).ok_or(Stop::UNREACHABLE)?;
            *trees.get_mut(sum).ok_or(Stop::UNREACHABLE)? = tree;
        }
        Ok(())
    }
}

trait LiteralTrees {
    const IN_CONTEXT: bool;
    fn of(&self, context: u32) -> &SymbolTree;
}

impl LiteralTrees for SymbolTree {
    const IN_CONTEXT: bool = false;

    #[inline(always)]
    fn of(&self, _: u32) -> &SymbolTree {
        self
    }
}

type TreesByContext<'a> = [&'a SymbolTree; ContextParts::END];

impl LiteralTrees for TreesByContext<'_> {
    const IN_CONTEXT: bool = true;

    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
    fn of(&self, context: u32) -> &SymbolTree {
        self[context as usize % ContextParts::END]
    }
}

/// What the fast loops keep from one run to the next.
struct Ready<'a> {
    owner: Frame,
    destination: Destination,
    machine: Option<Machine<'a>>,
    trees: Option<TreesByContext<'a>>,
    /// Of the literals, whose trees either of them has.
    block_type: Option<usize>,
    uses_lanes: bool,
}

impl<'a> Ready<'a> {
    #[inline(always)]
    fn has_input(&self, tables: &Tables<'_>, reader: &BitReader<'_>, position: usize) -> bool {
        let (len, until_end) = (
            reader.input().len(),
            tables.meta_block_end.saturating_sub(position),
        );
        len >= MANY_BYTES || matches!(&self.machine, Some(it) if it.can_run(len, until_end))
    }

    #[inline(always)]
    fn is_clear(&self, tables: &Tables<'_>, reader: &BitReader<'_>, position: usize) -> bool {
        position + MANY_BYTES / 4 < tables.clear_end() && self.has_input(tables, reader, position)
    }

    fn use_lanes(&mut self, do_pay: bool) {
        self.uses_lanes = do_pay;
        if let Some(machine) = &mut self.machine {
            machine.max_insert = if do_pay {
                lanes::MIN_COUNT as u32
            } else {
                u32::MAX
            };
        }
    }

    #[inline(never)]
    fn select(&mut self, tables: &Tables<'a>, contexts: &LiteralContexts<'a>) -> Result<(), Stop> {
        if self.block_type.replace(contexts.block_type).is_none() {
            let meta_block = MetaBlock {
                format: &FORMAT,
                context_parts: tables.codes.mode_in_trees.parts(),
                literal_root: tables.codes.literal_root,
                command_root: tables.codes.command_root,
                commands: tables.codes.commands.entries(),
                distances: tables.codes.distances.entries(),
                distance_step: tables.distance_step,
                max_backward_distance: tables.max_backward_distance,
                padded_dictionary: tables.padded_dictionary,
                destination: self.destination,
                owner: self.owner,
            };
            Machine::begin(&mut self.machine, &meta_block, contexts.first);
        }
        self.use_lanes(true);
        match (&mut self.machine, contexts.mode) {
            (Some(machine), None) => machine.set_literal_tree(contexts.first),
            (Some(machine), Some(_)) => with_avx2(
                #[inline(always)]
                || contexts.look_up(tables, machine.set_literal_trees(contexts.first)),
            )?,
            (None, None) => {}
            (None, Some(_)) => {
                contexts.look_up(tables, self.trees.get_or_insert([contexts.first; _]))?;
            }
        }
        Ok(())
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

impl Decoder {
    #[inline(never)]
    pub(super) fn decode_commands(
        &mut self,
        reader: &mut BitReader<'_>,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<State, Stop> {
        let codes = self.codes.as_deref().ok_or(Stop::UNREACHABLE)?;
        let tables = Tables {
            codes,
            distance_step: 1 << codes.distance_params.postfix_bits,
            max_backward_distance: self.max_backward_distance,
            ring_limit: self.ring.limit(),
            last_lap: self.ring.last_lap(),
            padded_dictionary: &self.padded_dictionary,
            meta_block_end: (self.ring.position + self.cursor.command.unwritten_literals as usize)
                .saturating_add_signed(self.remaining),
        };
        let cursor = &mut self.cursor;
        cursor.position = self.ring.position;
        let next = if reader.input().len() < MANY_BYTES {
            let stopped = run_carefully(&tables, None, 1, cursor, reader, self.ring.bytes_mut());
            stopped.unwrap_or(Err(Stop::UNREACHABLE))
        } else {
            let destination = self.ring.destination(output);
            run(&tables, destination, cursor, reader, self.ring.bytes_mut())
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

#[inline(never)]
fn run(
    tables: &Tables<'_>,
    destination: Destination,
    cursor: &mut Cursor,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Result<State, Stop> {
    let mut ready = Ready {
        owner: Frame::current(),
        destination,
        machine: None,
        trees: None,
        block_type: None,
        uses_lanes: false,
    };
    let mut careful_commands = 1;
    let mut is_fast =
        cursor.command.phase == Phase::Lengths && ready.is_clear(tables, reader, cursor.position);
    loop {
        let stopped = if is_fast {
            let before = cursor.work_left();
            let stopped = run_fast_in_block(tables, &mut ready, cursor, reader, ring);
            careful_commands = match before - cursor.work_left() {
                ..MUCH_WORK => (2 * careful_commands).min(MAX_CAREFUL_COMMANDS),
                _ => 1,
            };
            stopped.unwrap_or_else(|stop| Some(Err(stop)))
        } else {
            run_carefully(
                tables,
                Some(&mut ready),
                careful_commands,
                cursor,
                reader,
                ring,
            )
        };
        if let Some(next) = stopped {
            return next;
        }
        is_fast = !is_fast;
    }
}

/// `None` if decoding goes on.
type Stopped = Option<Result<State, Stop>>;

#[inline(always)]
fn run_fast_in_block<'a>(
    tables: &Tables<'a>,
    ready: &mut Ready<'a>,
    cursor: &mut Cursor,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Result<Stopped, Stop> {
    let contexts = tables.literal_contexts(cursor.blocks[0].current())?;
    let is_selected = ready.block_type == Some(contexts.block_type);
    if let Some(mode) = contexts.mode {
        let pays = is_selected || cursor.blocks[0].remaining as usize >= MANY_BYTES;
        if mode != tables.codes.mode_in_trees || !pays {
            return Ok(None);
        }
    }
    if !is_selected {
        ready.select(tables, &contexts)?;
    }
    match (&mut ready.machine, &ready.trees, contexts.mode) {
        (Some(machine), ..) => run_machine(tables, machine, cursor, reader, ring),
        (None, Some(_), Some(_)) if cursor.position < 2 => Ok(None),
        (None, Some(trees), Some(_)) => Ok(portable::run(tables, trees, cursor, reader, ring)),
        _ => Ok(portable::run(tables, contexts.first, cursor, reader, ring)),
    }
}

#[inline(always)]
fn run_machine<'a>(
    tables: &Tables<'a>,
    machine: &mut Machine<'a>,
    cursor: &mut Cursor,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Result<Stopped, Stop> {
    let [_, commands, distances] = &cursor.blocks;
    (machine.set_distance_trees(*tables.codes.distance_map.of(distances.current())))
        .and(machine.set_command_tree(tables.codes.commands.start(commands.current())?))
        .ok_or(Stop::UNREACHABLE)?;
    let mut progress = begin(reader, cursor.blocks.map(|blocks| blocks.remaining));
    let stopped = loop {
        progress.position = cursor.position;
        progress.recent = [3, 2, 1, 0].map(|age| cursor.recent.get(age));
        let limits = [tables.clear_end(), tables.last_lap, tables.meta_block_end];
        let unfinished = machine.run(&mut progress, ring, limits, false);
        cursor.position = progress.position;
        cursor.recent = RecentDistances {
            distances: progress.recent,
            last: 3,
        };
        match unfinished.ok_or(Stop::UNREACHABLE)? {
            Unfinished::Nothing => break cursor.after_word(tables),
            Unfinished::Literals {
                count,
                distance_context,
                copy_length,
            } => {
                cursor.command = Command {
                    phase: Phase::Literals,
                    distance_context,
                    unwritten_literals: count,
                    copy_length,
                };
                break None;
            }
            Unfinished::Copy {
                distance,
                is_repeat,
                length,
            } => {
                let stopped = cursor.copy(tables, ring, distance, is_repeat, length as usize);
                if stopped.is_some() {
                    break stopped;
                }
            }
        }
    };
    for (blocks, remaining) in cursor.blocks.iter_mut().zip(progress.remaining) {
        blocks.remaining = remaining;
    }
    reader.go_on_from(progress.input);
    Ok(stopped)
}

#[inline(always)]
fn begin<'i>(reader: &BitReader<'i>, remaining: [u32; 3]) -> Progress<'i> {
    Progress {
        input: reader.lend(),
        position: 0,
        remaining,
        recent: [0; _],
    }
}

/// Of the insert and of the copy.
#[inline(always)]
fn lengths_of(command: &machine::Command, bits: u64) -> [u32; 2] {
    let [insert, extra_bits] = FORMAT.insert(command.insert_code());
    let middle = command.insert_end();
    [
        insert + bits_in(bits, middle - extra_bits, middle),
        command.min_copy() + bits_in(bits, middle, command.total_length()),
    ]
}

/// Zero, or more than [`MAX_ALLOWED_DISTANCE`], if there is none. And whether it is the last one again.
#[inline(always)]
fn distance_of(
    entry: &Distance,
    bits: u64,
    tables: &Tables<'_>,
    recent: &RecentDistances,
) -> (u32, bool) {
    match entry.age() {
        None => {
            let extra = bits_in(bits, entry.code_length(), entry.total_length());
            (entry.addend() + extra * tables.distance_step, false)
        }
        Some(age) => (
            recent.get(age).wrapping_add(entry.addend()),
            entry.is_repeat(),
        ),
    }
}

/// From where the current command was interrupted, whatever gets in its way, for `min_commands` and until several more are clear.
#[inline(never)]
fn run_carefully<'a>(
    tables: &Tables<'a>,
    mut ready: Option<&mut Ready<'a>>,
    mut min_commands: u32,
    cursor: &mut Cursor,
    shared_reader: &mut BitReader<'_>,
    ring: &mut [u8],
) -> Stopped {
    let (mut reader, mut command, mut position) = (*shared_reader, cursor.command, cursor.position);
    let mut run = || {
        let [literals, commands, distances] = &cursor.blocks;
        let mut contexts = tables.literal_contexts(literals.current())?;
        let mut command_tree = tables.codes.commands.entries_of(commands.current())?;
        let mut distance_map = tables
            .codes
            .distance_map
            .of::<DISTANCE_CONTEXTS>(distances.current());
        let copy_limit = tables.clear_end();
        loop {
            let [literals, commands, distances] = &mut cursor.blocks;
            if command.phase == Phase::Lengths {
                if commands.remaining == 0 {
                    commands.switch(&tables.codes.symbols, &mut reader)?;
                    command_tree = tables.codes.commands.entries_of(commands.current())?;
                }
                reader.refill();
                let bits = reader.bits.peek();
                let root = tables.codes.command_root;
                let entry = (command_tree.get(bits as usize & root as usize))
                    .and_then(|entry| entry.resolve(command_tree, root, bits))
                    .ok_or(Stop::UNREACHABLE)?;
                reader.skip_peeked(entry.total_length())?;
                command.distance_context = entry.distance_context();
                [command.unwritten_literals, command.copy_length] = lengths_of(entry, bits);
                commands.remaining -= 1;
                command.phase = Phase::Literals;
            }

            if command.phase == Phase::Literals {
                while command.unwritten_literals != 0 {
                    if literals.remaining == 0 {
                        literals.switch(&tables.codes.symbols, &mut reader)?;
                        contexts = tables.literal_contexts(literals.current())?;
                    }
                    let start = position;
                    let end = start + command.unwritten_literals.min(literals.remaining) as usize;
                    let mut end = end.min(tables.ring_limit);
                    if end - start >= MANY_BYTES / 2
                        && let Some(ready) = &mut ready
                        && ready.has_input(tables, &reader, start)
                    {
                        core::hint::cold_path();
                        if start < 2 {
                            end = 2;
                        } else {
                            // Lending a copy lets `reader` stay in registers.
                            let mut lent = reader;
                            position = read_many_literals(
                                tables, &contexts, ready, &mut lent, ring, start, end,
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
                (cursor.recent.get(0), true)
            } else {
                if distances.remaining == 0 {
                    distances.switch(&tables.codes.symbols, &mut reader)?;
                    distance_map = tables.codes.distance_map.of(distances.current());
                }
                reader.refill();
                let bits = reader.bits.peek();
                #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
                let index = distance_map[command.distance_context as usize % DISTANCE_CONTEXTS];
                let tree = tables.codes.distances.entries_of(usize::from(index))?;
                let entry = (tree.get(usize::from(bits as u8)))
                    .and_then(|entry| entry.resolve(tree, bits))
                    .ok_or(Stop::UNREACHABLE)?;
                reader.bits.skip(entry.total_length())?;
                distances.remaining -= 1;
                distance_of(entry, bits, tables, &cursor.recent)
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
            } else if cursor.blocks[1].remaining > 1
                && matches!(&ready, Some(it) if it.is_clear(tables, &reader, position))
            {
                return Ok(None);
            }
        }
    };
    let stopped = run().transpose();
    (*shared_reader, cursor.command, cursor.position) = (reader, command, position);
    stopped
}

/// From `start`, which is in `2..end`. Returns how far it got.
#[inline(never)]
fn read_many_literals<'a>(
    tables: &Tables<'a>,
    contexts: &LiteralContexts<'a>,
    ready: &mut Ready<'a>,
    reader: &mut BitReader<'_>,
    ring: &mut [u8],
    mut start: usize,
    end: usize,
) -> Result<usize, Stop> {
    if (contexts.mode).is_some_and(|mode| mode != tables.codes.mode_in_trees) {
        return Ok(start);
    }
    if ready.block_type != Some(contexts.block_type) {
        ready.select(tables, contexts)?;
    }
    if ready.uses_lanes
        && end - start >= lanes::MIN_COUNT
        && let Some((input, mut bit)) = reader.rest_with_next_bit()
    {
        let out = ring.get_mut(..end).ok_or(Stop::UNREACHABLE)?;
        let can_guess = ready.machine.is_some();
        let trees = (contexts.mode).and_then(|_| match &ready.machine {
            Some(machine) => machine.literal_trees(),
            None => ready.trees.as_ref(),
        });
        let paid = match trees {
            Some(trees) => with_bmi2(
                #[inline(always)]
                || lanes::read(tables, trees, can_guess, input, &mut bit, out, &mut start),
            ),
            None => with_bmi2(
                #[inline(always)]
                || {
                    lanes::read(
                        tables,
                        contexts.first,
                        can_guess,
                        input,
                        &mut bit,
                        out,
                        &mut start,
                    )
                },
            ),
        };
        reader.skip_to_bit(bit);
        ready.use_lanes(paid != Some(false));
    }
    let Some(machine) = &mut ready.machine else {
        let trees = ready.trees.as_ref().filter(|_| contexts.mode.is_some());
        let range = [start as u32, end as u32];
        return Ok(portable::read_many_literals(
            tables,
            contexts.first,
            trees,
            reader,
            ring,
            range,
        ));
    };
    let mut progress = begin(reader, [(end - start) as u32, 0, 0]);
    progress.position = start;
    let limits = [tables.ring_limit, 0, tables.meta_block_end];
    (machine.run(&mut progress, ring, limits, true)).ok_or(Stop::UNREACHABLE)?;
    reader.go_on_from(progress.input);
    Ok(progress.position)
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
        let at = position.checked_sub(n);
        let at = at.unwrap_or_else(|| (*position + tables.last_lap).wrapping_sub(n));
        ring.get(at).copied().unwrap_or(0)
    };
    let lut = contexts.mode.map(ContextMode::lut);
    let (mut last, mut second_last) = lut.map_or((0, 0), |_| (before(1), before(2)));
    let mut tree = contexts.first;
    for slot in ring.get_mut(*position..end).ok_or(Stop::UNREACHABLE)? {
        reader.refill_for(MAX_CODE_LENGTH as u32);
        if let Some(lut) = lut {
            #[allow(clippy::indexing_slicing)] // Reduced to the size of the table.
            let index = contexts.map[lut.context(last, second_last) % LITERAL_CONTEXTS];
            tree = tables.literal_tree(index)?;
        }
        let (literal, length) =
            peek_symbol(tree, tables.codes.literal_root, reader.bits.peek()).literal();
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
        let max_distance = (tables.max_backward_distance).min(self.position + tables.last_lap);
        if (distance as usize).wrapping_sub(1) < max_distance {
            self.recent.push(distance, is_repeat);
            let distance = distance as usize;
            if self.position + length >= tables.ring_limit {
                return Some(Ok(State::Copy { distance, length }));
            }
            let (source, before_wrap) =
                ring_buffer::source_of(self.position, distance, length, tables.last_lap);
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
            let dictionary_len = (tables.padded_dictionary.len()).saturating_sub(machine::SLACK);
            if let Some(offset) = dictionary_len.checked_sub(beyond) {
                if length > beyond {
                    return Some(Err(DecodeError::CompoundDictionary.into()));
                }
                self.recent.push(distance, is_repeat);
                let end = self.position + length;
                if end >= tables.ring_limit {
                    return Some(Ok(State::CopyFromDictionary { offset, length }));
                }
                let source = tables.padded_dictionary.split_at(offset).1;
                if ring_buffer::copy_from(source, ring, self.position, length).is_none() {
                    return Some(Err(Stop::UNREACHABLE));
                }
                self.position = end;
            } else {
                let address = beyond - dictionary_len - 1;
                match write_word(ring, self.position, length, address) {
                    Ok(written) => self.position += written,
                    Err(stop) => return Some(Err(stop)),
                }
            }
        }
        self.after_word(tables)
    }

    #[inline(always)]
    fn after_word(&self, tables: &Tables<'_>) -> Stopped {
        if self.position >= tables.ring_limit {
            return Some(Ok(State::RingLimit(Resume::Commands)));
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
