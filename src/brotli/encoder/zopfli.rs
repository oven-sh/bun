//! Finds the cheapest sequence of commands for a block (qualities 10 and 11).

use core::array::from_fn;
use core::hint::select_unpredictable;
use core::ops::RangeInclusive;

use bun_highway::brotli::{self, Place, SLOT_SHIFT, Ways};

use super::command::{
    Command, Commands, DISTANCE_CODE_OFFSET, DistancePrefix, codes_of_short_lengths,
    combine_length_codes, copy_length_code, insert_length_code,
};
use super::hash::{BinaryTree, Candidate, Candidates};
use super::histogram::DISTANCE_SYMBOLS;
use super::input_block::InputBlock;
use super::literal_cost::{self, Sum};
use super::log2::{const_log2, fast_log2};
use super::matching::{bytes_at, match_length};
use super::prepared_dictionary::PreparedDictionary;
use super::ring_buffer::Window;
use super::symbol_set::SymbolSet;
use super::words::WordMatches;
use crate::format::{
    Alphabet, COMMAND_SYMBOLS, COPY_LENGTH_CODES, DISTANCE_SHORT_CODES,
    FIRST_COMMAND_WITH_DISTANCE, INSERT_LENGTH_CODES, LITERAL_SYMBOLS, SHORT_CODE_BASES,
    SHORT_CODE_DELTAS, SHORT_COPY_END,
};
use crate::memory::{self, Result};

const UNREACHED: f32 = 1.7e38;
const LONG_COPY: usize = 16384;
const HASHED_BYTES: usize = 4;

/// The last command on the cheapest known way to a position.
#[derive(Clone, Copy)]
struct Node {
    /// The length in the low 25 bits, and above it that of the word of the static dictionary, if it is one.
    copy: u32,
    distance: u32,
    /// The length in the low 27 bits, and above it the short distance code plus one, or zero.
    insert: u32,
}

impl Node {
    const WORD_SHIFT: u32 = 25;
    const CODE_SHIFT: u32 = 27;

    #[inline(always)]
    fn copy_length(&self) -> usize {
        self.copy as usize % (1 << Self::WORD_SHIFT)
    }

    fn coded_copy_length(&self) -> usize {
        match self.copy >> Self::WORD_SHIFT {
            0 => self.copy_length(),
            word_length => word_length as usize,
        }
    }

    #[inline(always)]
    fn insert_length(&self) -> usize {
        self.insert as usize % (1 << Self::CODE_SHIFT)
    }

    #[inline(always)]
    fn command_length(&self) -> usize {
        self.copy_length() + self.insert_length()
    }

    fn distance_code(&self) -> usize {
        match self.insert >> Self::CODE_SHIFT {
            0 => self.distance as usize + DISTANCE_CODE_OFFSET,
            short => short as usize - 1,
        }
    }

    #[inline(always)]
    fn changes_last_distances(&self) -> bool {
        (self.insert >> Self::CODE_SHIFT != 1) & (self.copy >> Self::WORD_SHIFT == 0)
    }
}

const LANES: usize = 4;

type CostByCopyLength = [f32; SHORT_COPY_END + LANES];

const SHORT_COPY_CODES: [u8; SHORT_COPY_END + LANES] = codes_of_short_lengths(&COPY_LENGTH_CODES);

static COPY_EXTRA_BITS: CostByCopyLength = {
    let (mut bits, mut length) = ([0.0; _], 0);
    while length < bits.len() {
        bits[length] = COPY_LENGTH_CODES[SHORT_COPY_CODES[length] as usize].extra_bits as f32;
        length += 1;
    }
    bits
};

static INSERT_EXTRA_BITS: [f32; INSERT_LENGTH_CODES.len()] = {
    let (mut bits, mut code) = ([0.0; _], 0);
    while code < bits.len() {
        bits[code] = INSERT_LENGTH_CODES[code].extra_bits as f32;
        code += 1;
    }
    bits
};

#[derive(Clone, Copy)]
struct SymbolCosts {
    commands: [f32; COMMAND_SYMBOLS],
    /// Of the command symbol, for each insert length code.
    with_distance: [CostByCopyLength; INSERT_LENGTH_CODES.len()],
    with_last_distance: [CostByCopyLength; 8],
    distances: [f32; DISTANCE_SYMBOLS],
    cheapest_command: f32,
    /// For each insert length code, the most that another one saves for the same copy.
    most_saved: [f32; INSERT_LENGTH_CODES.len()],
}

static FIRST_GUESS: SymbolCosts = {
    const fn logarithms_from<const N: usize>(first: u32) -> [f32; N] {
        let (mut costs, mut i) = ([0.0; N], 0);
        while i < N {
            costs[i] = const_log2(first + i as u32);
            i += 1;
        }
        costs
    }
    let mut costs = SymbolCosts {
        commands: logarithms_from(11),
        with_distance: [[0.0; _]; _],
        with_last_distance: [[0.0; _]; _],
        distances: logarithms_from(20),
        cheapest_command: 0.0,
        most_saved: [0.0; _],
    };
    costs.changed();
    costs
};

impl SymbolCosts {
    const fn changed(&mut self) {
        self.cheapest_command = UNREACHED;
        let mut i = 0;
        while i < COMMAND_SYMBOLS {
            self.cheapest_command = self.cheapest_command.min(self.commands[i]);
            i += 1;
        }
        let mut length = 0;
        while length < SHORT_COPY_CODES.len() {
            let (copy_code, mut insert_code) = (SHORT_COPY_CODES[length] as usize, 0);
            while insert_code < self.with_distance.len() {
                let symbol = combine_length_codes(insert_code, copy_code, false);
                self.with_distance[insert_code][length] = self.commands[symbol as usize];
                if insert_code < self.with_last_distance.len() {
                    let symbol = combine_length_codes(insert_code, copy_code, true);
                    self.with_last_distance[insert_code][length] = self.commands[symbol as usize];
                }
                insert_code += 1;
            }
            length += 1;
        }
        self.most_saved = [0.0; _];
        let mut copy_code = 0;
        while copy_code < COPY_LENGTH_CODES.len() {
            self.compare_insert_codes(copy_code, false);
            self.compare_insert_codes(copy_code, true);
            copy_code += 1;
        }
    }

    const fn compare_insert_codes(&mut self, copy_code: usize, is_last_distance: bool) {
        let (mut costs, mut cheapest, mut code) = (INSERT_EXTRA_BITS, UNREACHED, 0);
        while code < costs.len() {
            let symbol = combine_length_codes(code, copy_code, is_last_distance) as usize;
            costs[code] += self.commands[symbol];
            if symbol >= FIRST_COMMAND_WITH_DISTANCE {
                costs[code] += self.distances[0];
            }
            cheapest = cheapest.min(costs[code]);
            code += 1;
        }
        while code > 0 {
            code -= 1;
            self.most_saved[code] = self.most_saved[code].max(costs[code] - cheapest);
        }
    }

    fn set_from(&mut self, commands: &[Command], alphabet: Alphabet) {
        let mut symbols = [0; COMMAND_SYMBOLS];
        let mut distances = [0; DISTANCE_SYMBOLS];
        for command in commands {
            symbols[command.symbol()] += 1;
            distances[command.distance().symbol()] += u32::from(command.has_distance_symbol());
        }
        set_costs(&symbols, true, &mut self.commands);
        let distances = &distances[..alphabet.size as usize];
        set_costs(distances, true, &mut self.distances);
        self.changed();
    }
}

/// `commands` start at `position`.
fn literal_costs_in(
    commands: &[Command],
    window: Window<'_>,
    mut position: usize,
) -> [f32; LITERAL_SYMBOLS] {
    let mut literals = [0; LITERAL_SYMBOLS];
    for command in commands {
        for part in window.parts(position, command.insert_length()) {
            for &literal in part {
                literals[usize::from(literal)] += 1;
            }
        }
        position += command.insert_length() + command.copy_length();
    }
    let mut costs = [0.0; LITERAL_SYMBOLS];
    set_costs(&literals, false, &mut costs);
    costs
}

fn set_costs(histogram: &[u32], count_missing: bool, costs: &mut [f32]) {
    let total = histogram.iter().map(|&count| count as usize).sum();
    let missing = if count_missing {
        SymbolSet::matching(histogram, |count| count == 0).len()
    } else {
        0
    };
    let log2_total = fast_log2(total) as f32;
    let missing_cost = fast_log2(total + missing) as f32 + 2.0;
    for (cost, &count) in costs.iter_mut().zip(histogram) {
        *cost = match count {
            0 => missing_cost,
            _ => (log2_total - fast_log2(count as usize) as f32).max(1.0),
        };
    }
}

const MAX_STARTS: usize = 5;

#[derive(Clone, Copy)]
struct Start {
    offset: usize,
    /// Compared with nothing but literals.
    relative_cost: f32,
    slot: usize,
}

/// The best positions for a command to start at. Until there are enough, the rest are [`UNREACHED`].
struct Starts {
    /// From the high bits: the relative cost, which has a minus sign, the offset, and the slot. The largest number is the best.
    ranked: [u64; MAX_STARTS],
    last_distances: [[i32; 4]; Self::SLOTS],
    costs: [f32; Self::SLOTS],
    /// As in `ranked`.
    free_slot: u64,
}

impl Starts {
    const SLOTS: usize = 8;
    const OFFSET_SHIFT: u32 = SLOT_SHIFT + Self::SLOTS.ilog2();

    fn new() -> Self {
        let slot = |index: usize| (index << SLOT_SHIFT) as u64;
        let unreached = u64::from(UNREACHED.to_bits()) << 32;
        Self {
            ranked: from_fn(|rank| unreached | slot(MAX_STARTS - 1 - rank)),
            last_distances: [[0; 4]; _],
            costs: [0.0; _],
            free_slot: slot(MAX_STARTS),
        }
    }

    #[inline(always)]
    fn push(&mut self, offset: usize, saved: f32, cost: f32, last_distances: [i32; 4]) {
        let slot = (self.free_slot >> SLOT_SHIFT) as usize % Self::SLOTS;
        (self.last_distances[slot], self.costs[slot]) = (last_distances, cost);
        let mut moved = (u64::from((-saved).to_bits()) << 32)
            | ((offset << Self::OFFSET_SHIFT) as u64 + self.free_slot);
        for ranked in &mut self.ranked {
            (*ranked, moved) = (moved.max(*ranked), moved.min(*ranked));
        }
        self.free_slot = moved % (1 << Self::OFFSET_SHIFT);
    }

    /// A bit for each short distance code, for the best one and for the others. `count` is 1 or [`MAX_STARTS`].
    #[inline(always)]
    fn promising(&self, count: usize, place: Place<'_>, hopeless: f32) -> (u32, u64) {
        if count == 1 {
            let last_distances = &self.last_distances[self.get(0).slot];
            (brotli::short_codes(place, last_distances), 0)
        } else {
            brotli::short_codes_of_five(place, &self.last_distances, &self.ranked, hopeless)
        }
    }

    #[inline(always)]
    fn get(&self, rank: usize) -> Start {
        let packed = self.ranked[rank];
        Start {
            offset: (packed as u32 >> Self::OFFSET_SHIFT) as usize,
            relative_cost: f32::from_bits((packed >> 32) as u32),
            slot: (packed >> SLOT_SHIFT) as usize % Self::SLOTS,
        }
    }
}

/// Takes the place of the cost of an offset that went into [`Starts`].
#[derive(Clone, Copy)]
struct Link(u32);

impl Link {
    /// `earlier`: where the last command before this one ends that changes the last distances, or zero.
    #[inline(always)]
    fn new(earlier: usize, changes_last_distances: bool) -> Self {
        Self((earlier as u32 * 2) | u32::from(changes_last_distances))
    }

    #[inline(always)]
    fn earlier(self) -> usize {
        self.0 as usize / 2
    }

    #[inline(always)]
    fn changes_last_distances(self) -> bool {
        self.0 & 1 != 0
    }
}

/// A bit for each lane in which `a` is less than `b`.
#[inline(always)]
fn less(a: [f32; LANES], b: &[f32; LANES]) -> u32 {
    (0..LANES).fold(0, |bits, i| bits | (u32::from(a[i] < b[i]) << i))
}

#[inline(always)]
fn lanes(values: &[f32], at: usize) -> &[f32; LANES] {
    values[at..].first_chunk().unwrap_or(&[UNREACHED; LANES])
}

/// The literals from a start on.
#[derive(Clone, Copy)]
struct Insert {
    length: u32,
    code: usize,
    /// Of the whole way.
    cost: f32,
}

/// What the tries from one offset share.
struct Attempt {
    offset: usize,
    min_length: usize,
    /// A start that costs this much gains nothing from a copy that the best one tried.
    hopeless: f32,
    last_match: ShortMatch,
    /// From [`SHORT_COPY_END`] on.
    longest_improvement: usize,
}

#[derive(Clone, Copy, Default)]
struct ShortMatch {
    distance: usize,
    length: usize,
    /// It does not count after a longer match than this.
    max_tried: usize,
}

struct Paths<'a> {
    block: InputBlock<'a>,
    padded: &'a [u8],
    symbols: &'a SymbolCosts,
    /// The cost of all the bytes before each offset.
    literals: Vec<f32>,
    /// Longer matches are only tried in full.
    max_varied_length: usize,
    /// Fewer candidates can be tried at once.
    at_once_below: usize,
    starts: Starts,
    /// See [`Ways`]. Valid where `costs` is below [`UNREACHED`].
    nodes: Vec<u32>,
    /// With room for a [`CostByCopyLength`] from each offset on. See [`Link`].
    costs: Vec<f32>,
    /// Before the block.
    first_distances: [i32; 4],
}

impl<'a> Paths<'a> {
    fn new(block: &InputBlock<'a>, first_distances: [i32; 4]) -> Result<Self> {
        let mut literals = memory::empty(block.length + 1)?;
        literals.push(0.0);
        literal_cost::estimate(block.data_from(block.position), &mut literals);
        let distances = block.params.distance;
        let is_usual = block.dictionary.is_none()
            && distances.postfix_bits == 0
            && distances.direct_codes == 0;
        let size = block.length + COPY_EXTRA_BITS.len();
        let mut paths = Self {
            block: *block,
            padded: block.padded(),
            symbols: &FIRST_GUESS,
            literals,
            max_varied_length: if block.params.quality > 10 { 325 } else { 150 },
            at_once_below: if is_usual { LANES + 1 } else { 0 },
            starts: Starts::new(),
            nodes: memory::zeroed(3 * size)?,
            costs: memory::filled(UNREACHED, size)?,
            first_distances,
        };
        paths.costs[0] = 0.0;
        Ok(paths)
    }

    fn start_over(&mut self, symbols: &'a SymbolCosts, literal_costs: &[f32; LITERAL_SYMBOLS]) {
        self.symbols = symbols;
        let data = self.block.data_from(self.block.position);
        let mut sum = Sum::default();
        for (cost, &literal) in self.literals[1..].iter_mut().zip(data) {
            *cost = sum.add(literal_costs[usize::from(literal)]);
        }
        self.starts = Starts::new();
        self.costs[1..].fill(UNREACHED);
    }

    #[inline(always)]
    fn node(&self, offset: usize) -> Node {
        let row = self.costs.len();
        Node {
            copy: self.nodes[offset],
            distance: self.nodes[row + offset],
            insert: self.nodes[2 * row + offset],
        }
    }

    /// Returns whether it is cheaper than what is known.
    #[inline(always)]
    fn try_node(&mut self, offset: usize, cost: f32, node: Node) -> bool {
        let is_cheaper = cost < self.costs[offset];
        if is_cheaper {
            let row = self.costs.len();
            self.costs[offset] = cost;
            self.nodes[offset] = node.copy;
            self.nodes[row + offset] = node.distance;
            self.nodes[2 * row + offset] = node.insert;
        }
        is_cheaper
    }

    #[inline(always)]
    fn ways_from(&mut self, offset: usize) -> Ways<'_> {
        Ways {
            costs: &mut self.costs,
            nodes: &mut self.nodes,
            offset: offset as u32,
        }
    }

    /// The way to `offset` is final.
    #[inline(always)]
    fn settle(&mut self, offset: usize) {
        let (cost, as_literals) = (self.costs[offset], self.literals[offset]);
        debug_assert!(offset == 0 || cost >= 1.0);
        if cost > as_literals {
            return;
        }
        let mut last_distances = self.first_distances;
        if offset != 0 {
            let node = self.node(offset);
            let earlier = self.last_change_up_to(offset - node.command_length());
            let changes = node.changes_last_distances();
            self.costs[offset] = f32::from_bits(Link::new(earlier, changes).0);
            last_distances = self.distances_from(select_unpredictable(changes, offset, earlier));
        }
        (self.starts).push(offset, as_literals - cost, cost, last_distances);
    }

    #[inline(always)]
    fn link(&self, offset: usize) -> Link {
        let link = Link(self.costs[offset].to_bits());
        debug_assert!(link.earlier() <= offset);
        link
    }

    /// `offset` went into `starts`. See [`Link::new`].
    #[inline(always)]
    fn last_change_up_to(&self, offset: usize) -> usize {
        let link = self.link(offset);
        select_unpredictable(link.changes_last_distances(), offset, link.earlier())
    }

    /// The last distances after the command that ends at `change` changed them.
    #[inline(always)]
    fn distances_from(&self, mut change: usize) -> [i32; 4] {
        let mut distances = [0; 4];
        let mut first_distances = self.first_distances.iter();
        for distance in &mut distances {
            if change != 0 {
                *distance = self.nodes[self.costs.len() + change] as i32;
                change = self.link(change).earlier();
            } else if let Some(&first) = first_distances.next() {
                *distance = first;
            }
        }
        distances
    }

    /// Shorter copies lead to positions that are reached more cheaply already.
    #[inline(always)]
    fn min_useful_length(&self, offset: usize) -> usize {
        let best = self.starts.get(0);
        let literals = self.literals[offset] - self.literals[best.offset];
        let min_cost = self.starts.costs[best.slot] + self.symbols.cheapest_command + literals;
        // With each extra bit that the length takes.
        let [none, one, two] = [min_cost, min_cost + 1.0, min_cost + 1.0 + 1.0];
        if let Some(costs) = self.costs[offset + 2..].first_chunk::<20>() {
            let mut dearer = 0;
            for i in 0..16 {
                dearer |= u16::from([none, none, one, two][i / LANES] < costs[i]) << i;
            }
            let dearer = u32::from(dearer) | (less([two; LANES], lanes(costs, 16)) << 16);
            if dearer != 0 {
                return 2 + dearer.trailing_zeros() as usize;
            }
        }
        let mut min_cost = two + 1.0;
        let (mut length, mut bucket, mut bucket_end) = (22, 32, 38);
        loop {
            let dearer = less([min_cost; LANES], lanes(&self.costs, offset + length));
            if dearer != 0 {
                return length + dearer.trailing_zeros() as usize;
            }
            length += LANES;
            if length == bucket_end {
                min_cost += 1.0;
                bucket_end += bucket;
                bucket *= 2;
            }
        }
    }

    /// Has the last two of `length` bytes.
    #[inline(always)]
    fn place_for(&self, offset: usize, length: usize) -> Place<'a> {
        let pair = bytes_at(self.padded, offset + length - 2);
        (self.block.window).place(self.block.position + offset, length - 2, pair)
    }

    /// `None` if the byte after `tried` ends it.
    #[inline(always)]
    fn match_at(
        &self,
        position: usize,
        data: &[u8],
        distance: usize,
        tried: usize,
    ) -> Option<ShortMatch> {
        let block = &self.block;
        let mut max_tried = block.window.before_end(position);
        let source = if distance.wrapping_sub(1) < block.max_backward(position) {
            max_tried = max_tried.min(block.window.before_end(position - distance));
            block.window.from(position - distance)
        } else {
            let end_distance = block.dictionary_end_distance(position);
            (block.dictionary)
                .and_then(|dictionary| dictionary.at_distance(distance, end_distance))
                .unwrap_or_default()
        };
        (source.get(tried)? == data.get(tried)?).then(|| ShortMatch {
            distance,
            length: match_length(source, data),
            max_tried,
        })
    }

    #[inline(always)]
    fn insert_from(&self, rank: usize, offset: usize) -> Insert {
        let start = self.starts.get(rank);
        let length = offset - start.offset;
        let code = insert_length_code(length);
        Insert {
            length: length as u32,
            code,
            cost: start.relative_cost + INSERT_EXTRA_BITS[code] + self.literals[offset],
        }
    }

    /// `node` has all but the copy length.
    #[inline(always)]
    fn try_lengths(
        &mut self,
        attempt: &mut Attempt,
        lengths: RangeInclusive<usize>,
        insert_code: usize,
        [with_distance, without_distance]: [f32; 2],
        node: Node,
    ) {
        let (first, last) = lengths.into_inner();
        let (cost, symbol_costs) = match self.symbols.with_last_distance.get(insert_code) {
            Some(costs) if node.insert >> Node::CODE_SHIFT == 1 => (without_distance, costs),
            _ => (with_distance, &self.symbols.with_distance[insert_code]),
        };
        let start = brotli::Start {
            cost,
            symbol_costs,
            insert: node.insert,
        };
        let (offset, short) = (attempt.offset, first..SHORT_COPY_END.min(last + 1));
        let ways = self.ways_from(offset);
        brotli::try_lengths(ways, short, &COPY_EXTRA_BITS, start, node.distance);
        if last >= SHORT_COPY_END {
            let long = first.max(SHORT_COPY_END)..=last;
            let longest = self.try_long_lengths(offset, long, insert_code, with_distance, node);
            attempt.longest_improvement = attempt.longest_improvement.max(longest);
        }
    }

    /// Returns the longest improvement.
    #[inline(never)]
    fn try_long_lengths(
        &mut self,
        offset: usize,
        lengths: RangeInclusive<usize>,
        insert_code: usize,
        base: f32,
        node: Node,
    ) -> usize {
        let (mut length, last) = lengths.into_inner();
        let mut longest = 0;
        while length <= last {
            let copy_code = copy_length_code(length);
            let range = COPY_LENGTH_CODES[copy_code];
            let symbol = combine_length_codes(insert_code, copy_code, false);
            let cost =
                base + f32::from(range.extra_bits) + self.symbols.commands[usize::from(symbol)];
            let end = (last + 1).min(usize::from(range.base) + (1 << range.extra_bits));
            let (ways, lengths) = (self.ways_from(offset), length..end);
            let taken =
                brotli::try_lengths_at_cost(ways, lengths, cost, node.distance, node.insert);
            longest = longest.max(taken);
            length = end;
        }
        longest
    }

    /// `promising` has 16 bits for each start from `first_rank` on.
    #[inline(never)]
    fn try_short_codes(&mut self, attempt: &mut Attempt, mut first_rank: usize, promising: u128) {
        let position = self.block.position + attempt.offset;
        let data = self.block.data_from(position);
        let (mut promising, mut more) = (promising as u64, (promising >> 64) as u64);
        let (mut found, mut previous_rank, mut tried) = (attempt.last_match, usize::MAX, 0);
        loop {
            if promising == 0 {
                if more == 0 {
                    break;
                }
                (promising, more, first_rank) = (more, 0, first_rank + 4);
            }
            let bit = promising.trailing_zeros() as usize;
            promising &= promising - 1;
            let (rank, code) = (first_rank + bit / 16, bit % 16);
            tried = select_unpredictable(rank == previous_rank, tried, attempt.min_length - 1);
            previous_rank = rank;
            let last_distances = &self.starts.last_distances[self.starts.get(rank).slot];
            let base = last_distances[usize::from(SHORT_CODE_BASES[code]) % 4];
            let distance = (base + i32::from(SHORT_CODE_DELTAS[code])) as usize;
            if distance != found.distance {
                let Some(longer) = self.match_at(position, data, distance, tried) else {
                    continue;
                };
                found = longer;
            }
            if found.length <= tried || tried > found.max_tried {
                continue;
            }
            let insert = self.insert_from(rank, attempt.offset);
            let node = Node {
                copy: 0,
                distance: distance as u32,
                insert: ((code as u32 + 1) << Node::CODE_SHIFT) | insert.length,
            };
            let bases = [insert.cost + self.symbols.distances[code], insert.cost];
            self.try_lengths(attempt, tried + 1..=found.length, insert.code, bases, node);
            tried = found.length;
            let shift = bit / 16 * 16;
            if (promising >> shift) as u16 != 0 && self.block.dictionary.is_none() {
                let longer = self.longer_than(rank, attempt.offset, tried);
                promising &= !(u64::from(!longer) << shift);
            }
        }
        attempt.last_match = found;
    }

    /// A bit for each short distance code that may lead to a longer match.
    #[inline(always)]
    fn longer_than(&self, rank: usize, offset: usize, length: usize) -> u16 {
        if offset + length >= self.block.length {
            return 0;
        }
        let last_distances = &self.starts.last_distances[self.starts.get(rank).slot];
        brotli::short_codes(self.place_for(offset, length + 1), last_distances) as u16
    }

    #[inline(always)]
    fn try_one_by_one(&mut self, attempt: &mut Attempt, rank: usize, candidates: &[Candidate]) {
        let insert = self.insert_from(rank, attempt.offset);
        let mut next_length = attempt.min_length;
        for candidate in candidates {
            let matched = candidate.length();
            if matched < next_length {
                continue;
            }
            let prefix = DistancePrefix::new(
                candidate.distance() + DISTANCE_CODE_OFFSET,
                &self.block.params.distance,
            );
            let with_distance =
                insert.cost + prefix.extra_bits() as f32 + self.symbols.distances[prefix.symbol()];
            let node = Node {
                copy: 0,
                distance: candidate.distance() as u32,
                insert: insert.length,
            };
            if let Some(word_length) = candidate.word_length() {
                let cost = with_distance
                    + COPY_EXTRA_BITS[word_length]
                    + self.symbols.with_distance[insert.code][word_length];
                let copy = ((word_length << Node::WORD_SHIFT) | matched) as u32;
                self.try_node(attempt.offset + matched, cost, Node { copy, ..node });
            } else {
                if matched > self.max_varied_length {
                    next_length = matched;
                }
                let (lengths, bases) = (next_length..=matched, [with_distance; 2]);
                self.try_lengths(attempt, lengths, insert.code, bases, node);
            }
            next_length = matched + 1;
        }
    }

    /// From two starts. The last of the first `count` has the length `longest`.
    #[inline(always)]
    fn try_at_once(
        &mut self,
        attempt: &Attempt,
        [rank, other_rank]: [usize; 2],
        candidates: &[Candidate; LANES],
        count: usize,
        longest: usize,
    ) {
        let symbols = self.symbols;
        let start = |insert: Insert| brotli::Start {
            cost: insert.cost,
            symbol_costs: &symbols.with_distance[insert.code],
            insert: insert.length,
        };
        let best = start(self.insert_from(rank, attempt.offset));
        let other = start(self.insert_from(other_rank, attempt.offset));
        let after_short_codes = &symbols.distances[DISTANCE_SHORT_CODES as usize..];
        if let Some(distance_costs) = after_short_codes.first_chunk() {
            brotli::try_matches(
                self.ways_from(attempt.offset),
                attempt.min_length..longest + 1,
                &COPY_EXTRA_BITS,
                [best, other],
                &candidates.map(|candidate| candidate.0),
                count,
                distance_costs,
            );
        }
    }

    /// Settles `offset`, and tries the first `count` of `padded`, which has [`LANES`] more, from 1 or [`MAX_STARTS`]. Returns the offset to go on from.
    #[inline(always)]
    fn step(&mut self, starts: usize, offset: usize, padded: &[Candidate], count: usize) -> usize {
        /// More than rounding can make up for, compared with the largest number.
        const MARGIN: f32 = 16.0 * f32::EPSILON;
        self.settle(offset);
        let min_length = self.min_useful_length(offset);
        let best = self.starts.get(0);
        let hopeless = best.relative_cost
            + self.symbols.most_saved[insert_length_code(offset - best.offset)]
            + (self.literals[offset] + 256.0) * MARGIN;
        let place = self.place_for(offset, min_length);
        let (first, others) = self.starts.promising(starts, place, hopeless);
        let all = || u128::from(first) | (u128::from(others) << 16);
        let mut attempt = Attempt {
            offset,
            min_length,
            hopeless,
            last_match: ShortMatch::default(),
            longest_improvement: 0,
        };

        let last = padded[count.saturating_sub(1)];
        let last = select_unpredictable(count == 0, Candidate::default(), last);
        let longest = last.length();
        let Some(four) = padded.first_chunk().filter(|_| {
            count < self.at_once_below && longest < SHORT_COPY_END && last.word_length().is_none()
        }) else {
            return self.step_slowly(&mut attempt, starts, all(), &padded[..count]);
        };
        if longest >= min_length {
            if first != 0 {
                self.try_short_codes(&mut attempt, 0, first.into());
            }
            let (mut ranks, mut done) = ([0, usize::from(starts > 1 && others as u16 == 0)], 0);
            loop {
                self.try_at_once(&attempt, ranks, four, count, longest);
                if starts == 1 || ranks[1] == 1 || self.starts.get(1).relative_cost >= hopeless {
                    break;
                }
                self.try_short_codes(&mut attempt, 1, (others as u16).into());
                (ranks, done) = ([1, 1], 1);
            }
            if others >> (16 * done) != 0 {
                self.try_short_codes(&mut attempt, 1 + done, (others >> (16 * done)).into());
            }
        } else if u64::from(first) | others != 0 {
            self.try_short_codes(&mut attempt, 0, all());
        }
        if attempt.longest_improvement < LONG_COPY {
            return offset + 1;
        }
        self.skip(offset, attempt.longest_improvement)
    }

    #[inline(never)]
    fn step_slowly(
        &mut self,
        attempt: &mut Attempt,
        starts: usize,
        mut promising: u128,
        candidates: &[Candidate],
    ) -> usize {
        let (offset, skipped) = (attempt.offset, attempt.min_length - 2);
        let end_distance = (self.block).dictionary_end_distance(self.block.position + offset);
        let pair = bytes_at(self.padded, offset + skipped);
        if let Some(dictionary) = self.block.dictionary
            && let Some(place) = dictionary.place(end_distance, skipped, pair)
        {
            let (first, others) = self.starts.promising(starts, place, attempt.hopeless);
            promising |= u128::from(first) | (u128::from(others) << 16);
        }
        for rank in 0..starts.min(2) {
            if promising as u16 != 0 {
                self.try_short_codes(attempt, rank, (promising as u16).into());
            }
            promising >>= 16;
            if rank == 0 || self.starts.get(rank).relative_cost < attempt.hopeless {
                self.try_one_by_one(attempt, rank, candidates);
            }
        }
        if promising != 0 {
            self.try_short_codes(attempt, 2, promising);
        }
        let mut skip = 1;
        if attempt.longest_improvement >= LONG_COPY {
            skip = attempt.longest_improvement;
        }
        if let [only] = candidates
            && only.length() > self.max_varied_length
        {
            skip = skip.max(only.length());
        }
        self.skip(attempt.offset, skip)
    }

    /// Returns the offset to go on from.
    #[inline(never)]
    fn skip(&mut self, offset: usize, length: usize) -> usize {
        let next = offset + length;
        for skipped in offset + 1..next.min(searched_length(&self.block)) {
            self.settle(skipped);
        }
        next
    }

    /// `counts` has how many of `found` there are for each offset, and there are [`LANES`] more.
    #[inline(never)]
    fn extend_all(&mut self, mut found: &[Candidate], counts: &[u8]) {
        let (mut offset, searched) = (0, searched_length(&self.block));
        while offset < searched {
            let count = usize::from(counts[offset]);
            let next = self.step(MAX_STARTS, offset, found, count);
            found = &found[count..];
            if next != offset + 1 {
                let passed = counts[offset + 1..next.min(searched)].iter();
                found = &found[passed.map(|&count| usize::from(count)).sum()..];
            }
            offset = next;
        }
    }

    fn add_cheapest_to(&self, commands: &mut Commands) -> Result<()> {
        let mut end = self.block.length;
        while self.costs[end] == UNREACHED {
            end -= 1;
        }
        let mut count = 0;
        let mut offset = end;
        while offset != 0 {
            offset -= self.node(offset).command_length();
            count += 1;
        }
        // And one for the literals after them.
        commands.try_reserve(count + 1)?;
        let first = commands.list.len();
        memory::resize(&mut commands.list, first + count, Command::insert_only(0));
        offset = end;
        for slot in commands.list[first..].iter_mut().rev() {
            let node = self.node(offset);
            offset -= node.command_length();
            let mut insert_length = node.insert_length();
            if offset == 0 {
                insert_length += core::mem::take(&mut commands.pending_literals);
            }
            *slot = Command::new(
                &self.block.params.distance,
                insert_length,
                node.copy_length(),
                node.coded_copy_length(),
                node.distance_code(),
            );
            commands.literal_count += insert_length;
        }
        if end != 0 {
            let node = self.node(end);
            let earlier = self.last_change_up_to(end - node.command_length());
            commands.last_distances = self.distances_from(earlier);
            if node.changes_last_distances() {
                commands.remember_distance(node.distance as usize);
            }
        }
        commands.pending_literals += self.block.length - end;
        Ok(())
    }
}

fn searched_length(block: &InputBlock<'_>) -> usize {
    block.length.saturating_sub(HASHED_BYTES - 1)
}

struct Finder<'a, 'b> {
    tree: &'b mut BinaryTree,
    block: InputBlock<'a>,
    words: WordMatches,
    in_window: Vec<Candidate>,
    in_dictionary: Vec<Candidate>,
}

impl Finder<'_, '_> {
    /// Returns how many it found. Only the last candidate stays if it is longer than `long`.
    #[inline(always)]
    fn find(&mut self, offset: usize, nearby: usize, long: usize, found: &mut Candidates) -> usize {
        const MOST: usize = BinaryTree::MAX_CANDIDATES + PreparedDictionary::MAX_CANDIDATES;
        const { assert!((MOST + LANES) * size_of::<Candidate>() <= size_of::<Candidates>()) };
        let position = self.block.position + offset;
        let search = self
            .block
            .search_at(position, &self.block.padded()[offset..]);
        let mut count = self.tree.find_all(&search, nearby, &mut self.words, found);
        if let Some(dictionary) = self.block.dictionary {
            self.in_window.clear();
            self.in_window.extend_from_slice(&found[..count]);
            self.in_dictionary.clear();
            dictionary.find_all(&self.block.query_at(position), &mut self.in_dictionary);
            count += self.in_dictionary.len();
            merge(&self.in_dictionary, &self.in_window, &mut found[..count]);
        }
        if let Some(&last) = found[..count].last()
            && last.length() > long
        {
            found[0] = last;
            return 1;
        }
        count
    }

    fn store_between(&mut self, offset: usize, next: usize) {
        let block = &self.block;
        let end = (block.position + next).min(block.store_end(BinaryTree::LOOKAHEAD));
        self.tree
            .store_range(block.window, block.position + offset + 1, end);
    }
}

fn merge<'a>(mut a: &'a [Candidate], mut b: &'a [Candidate], merged: &mut [Candidate]) {
    let order = |first: &Candidate| (first.length(), first.distance());
    for slot in merged {
        let from = match (a.first(), b.first()) {
            (Some(first_a), Some(first_b)) if order(first_a) >= order(first_b) => &mut b,
            (None, _) => &mut b,
            _ => &mut a,
        };
        *slot = from.split_off_first().copied().unwrap_or_default();
    }
}

#[inline(never)]
pub(super) fn add_commands(
    tree: &mut BinaryTree,
    block: &InputBlock<'_>,
    commands: &mut Commands,
) -> Result<()> {
    let scratch = |size| memory::empty(block.dictionary.map_or(0, |_| size));
    let mut finder = Finder {
        tree,
        block: *block,
        words: WordMatches::new(),
        in_window: scratch(BinaryTree::MAX_CANDIDATES)?,
        in_dictionary: scratch(PreparedDictionary::MAX_CANDIDATES)?,
    };
    let mut refined;
    let mut paths = Paths::new(block, commands.last_distances)?;
    let long = paths.max_varied_length;
    let searched = searched_length(block);
    let blank: Candidates = [Candidate::default(); _];

    if block.params.quality == 10 {
        let mut found = blank;
        let mut offset = 0;
        while offset < searched {
            let count = finder.find(offset, 16, long, &mut found);
            let next = paths.step(1, offset, &found, count);
            if next > offset + 1 {
                finder.store_between(offset, next);
            }
            offset = next;
        }
        return paths.add_cheapest_to(commands);
    }

    let mut found = memory::empty(4 * block.length + 2 * blank.len())?;
    let mut counts = memory::zeroed::<u8>(block.length)?;
    let (mut offset, mut total) = (0, 0);
    while offset < searched {
        let Some(room) = found[total..].first_chunk_mut() else {
            memory::try_reserve(&mut found, blank.len())?;
            found.extend_from_slice(&blank);
            continue;
        };
        let count = finder.find(offset, 64, long, room);
        counts[offset] = count as u8;
        total += count;
        offset = match room[..count] {
            [only] if only.length() > long => {
                finder.store_between(offset, offset + only.length());
                offset + only.length()
            }
            _ => offset + 1,
        };
    }

    let (first, literal_count) = (commands.list.len(), commands.literal_count);
    let pending_literals = commands.pending_literals;
    paths.extend_all(&found, &counts);
    paths.add_cheapest_to(commands)?;

    let added = &commands.list[first..];
    refined = memory::copied(core::slice::from_ref(&FIRST_GUESS))?;
    refined[0].set_from(added, block.params.distance.alphabet);
    let literal_costs = literal_costs_in(added, block.window, block.position - pending_literals);
    paths.start_over(&refined[0], &literal_costs);
    commands.list.truncate(first);
    commands.literal_count = literal_count;
    commands.pending_literals = pending_literals;
    commands.last_distances = paths.first_distances;
    paths.extend_all(&found, &counts);
    paths.add_cheapest_to(commands)
}
