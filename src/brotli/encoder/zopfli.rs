//! Finds the cheapest sequence of commands for a block (qualities 10 and 11).

use core::hint::select_unpredictable;
use core::ops::RangeInclusive;

use super::command::{
    Command, Commands, DISTANCE_CODE_OFFSET, DistancePrefix, codes_of_short_lengths,
    combine_length_codes, copy_length_code, insert_length_code,
};
use super::hash::{BinaryTree, BytePair, Candidate};
use super::histogram::DISTANCE_SYMBOLS;
use super::input_block::InputBlock;
use super::literal_cost;
use super::log2::{const_log2, fast_log2};
use super::matching::match_length;
use super::ring_buffer::Window;
use super::symbol_set::SymbolSet;
use crate::format::{
    Alphabet, COMMAND_SYMBOLS, COPY_LENGTH_CODES, INSERT_LENGTH_CODES, LITERAL_SYMBOLS,
    SHORT_CODE_BASES, SHORT_CODE_DELTAS, SHORT_COPY_END,
};
use crate::memory::{self, Result};

const UNREACHED: f32 = 1.7e38;
const LONG_COPY: usize = 16384;
const HASHED_BYTES: usize = 4;

/// The last command on the cheapest known way to a position.
#[derive(Clone, Copy, Default)]
struct Node {
    /// The length in the low 25 bits, and above it 9 plus what it exceeds the length in the stream by.
    copy_length: u32,
    distance: u32,
    /// The length in the low 27 bits, and above it the short distance code plus one, or zero.
    insert_length: u32,
}

impl Node {
    #[inline(always)]
    fn with_length(self, length: usize) -> Self {
        self.with_word(length, length)
    }

    #[inline(always)]
    fn with_word(self, length: usize, word_length: usize) -> Self {
        Self {
            copy_length: (length | ((length + 9 - word_length) << 25)) as u32,
            ..self
        }
    }

    #[inline(always)]
    fn copy_length(&self) -> usize {
        (self.copy_length & 0x1FF_FFFF) as usize
    }

    fn coded_copy_length(&self) -> usize {
        self.copy_length() + 9 - (self.copy_length >> 25) as usize
    }

    #[inline(always)]
    fn insert_length(&self) -> usize {
        (self.insert_length & 0x7FF_FFFF) as usize
    }

    #[inline(always)]
    fn command_length(&self) -> usize {
        self.copy_length() + self.insert_length()
    }

    #[inline(always)]
    fn distance_code(&self) -> usize {
        match self.insert_length >> 27 {
            0 => self.distance as usize + DISTANCE_CODE_OFFSET,
            short => short as usize - 1,
        }
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

#[derive(Clone, Copy)]
struct SymbolCosts {
    commands: [f32; COMMAND_SYMBOLS],
    /// Of the command symbol, for each insert length code.
    with_distance: [CostByCopyLength; 24],
    with_last_distance: [CostByCopyLength; 8],
    distances: [f32; DISTANCE_SYMBOLS],
    cheapest_command: f32,
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
    };
    costs.commands_changed();
    costs
};

impl SymbolCosts {
    const fn commands_changed(&mut self) {
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
        self.commands_changed();
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

/// Carries the rounding error along.
fn accumulate(costs: &mut [f32]) {
    let (mut total, mut carry) = (0.0, 0.0);
    for cost in costs {
        carry += *cost;
        *cost = total + carry;
        carry -= *cost - total;
        total = *cost;
    }
}

const MAX_STARTS: usize = 5;

#[derive(Clone, Copy, Default)]
struct Start {
    cost: f32,
    last_distances: [i32; 4],
}

/// The best positions for a command to start at: those that cost the least, compared with nothing but literals.
struct Starts {
    /// From the high bits: the difference, which is not positive, the offset, and the slot. The largest number is the best.
    sorted: [u64; MAX_STARTS],
    count: usize,
    slots: [Start; Self::SLOTS],
    free_slot: u64,
}

impl Starts {
    const SLOTS: usize = (MAX_STARTS + 1).next_power_of_two();

    fn new() -> Self {
        Self {
            sorted: core::array::from_fn(|rank| (MAX_STARTS - 1 - rank) as u64),
            count: 0,
            slots: Default::default(),
            free_slot: MAX_STARTS as u64,
        }
    }

    #[inline(always)]
    fn push(&mut self, offset: usize, relative_cost: f32, start: Start, max_count: usize) {
        self.slots[self.free_slot as usize % Self::SLOTS] = start;
        let mut moved = (u64::from(relative_cost.to_bits()) << 32)
            | ((offset * Self::SLOTS) as u64 + self.free_slot);
        for slot in &mut self.sorted {
            (*slot, moved) = (moved.max(*slot), moved.min(*slot));
        }
        self.free_slot = moved % Self::SLOTS as u64;
        self.count = max_count.min(self.count + 1);
    }

    /// The offset, the difference, and the rest.
    #[inline(always)]
    fn get(&self, rank: usize) -> (usize, f32, Start) {
        let packed = self.sorted[rank];
        (
            packed as u32 as usize / Self::SLOTS,
            f32::from_bits((packed >> 32) as u32),
            self.slots[packed as usize % Self::SLOTS],
        )
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

struct Paths<'a> {
    block: InputBlock<'a>,
    symbols: &'a SymbolCosts,
    /// The cost of all the bytes before each offset.
    literals: Vec<f32>,
    /// Longer matches are only tried in full.
    max_varied_length: usize,
    starts_to_try: usize,
    starts: Starts,
    /// Where `costs` is below [`UNREACHED`].
    nodes: Vec<Node>,
    /// With [`LANES`] more at the end. See [`Link`].
    costs: Vec<f32>,
    /// Before the block.
    first_distances: [i32; 4],
}

impl<'a> Paths<'a> {
    fn new(block: &InputBlock<'a>, first_distances: [i32; 4]) -> Result<Self> {
        let thorough = block.params.quality > 10;
        let mut literals = memory::empty(block.length + 1)?;
        literals.push(0.0);
        literal_cost::estimate(block.data_from(block.position), &mut literals);
        accumulate(&mut literals);
        let mut paths = Self {
            block: *block,
            symbols: &FIRST_GUESS,
            literals,
            max_varied_length: if thorough { 325 } else { 150 },
            starts_to_try: if thorough { MAX_STARTS } else { 1 },
            starts: Starts::new(),
            nodes: memory::filled(Node::default(), block.length + 1)?,
            costs: memory::filled(UNREACHED, block.length + 1 + LANES)?,
            first_distances,
        };
        paths.costs[0] = 0.0;
        Ok(paths)
    }

    fn start_over(&mut self, symbols: &'a SymbolCosts, literal_costs: &[f32; LITERAL_SYMBOLS]) {
        self.symbols = symbols;
        let data = self.block.data_from(self.block.position);
        for (cost, &literal) in self.literals[1..].iter_mut().zip(data) {
            *cost = literal_costs[usize::from(literal)];
        }
        accumulate(&mut self.literals);
        self.starts = Starts::new();
        self.costs[1..].fill(UNREACHED);
    }

    #[inline(always)]
    fn changes_last_distances(&self, node: &Node, offset: usize) -> bool {
        let copy_start = self.block.position + offset - node.copy_length();
        node.distance as usize <= self.block.max_copy_distance(copy_start)
            && node.distance_code() > 0
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
            let node = self.nodes[offset];
            let earlier = self.last_change_up_to(offset - node.command_length());
            let changes = self.changes_last_distances(&node, offset);
            self.costs[offset] = f32::from_bits(Link::new(earlier, changes).0);
            last_distances = self.distances_from(select_unpredictable(changes, offset, earlier));
        }
        let start = Start {
            cost,
            last_distances,
        };
        self.starts
            .push(offset, cost - as_literals, start, self.starts_to_try);
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
                *distance = self.nodes[change].distance as i32;
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
        let (start, _, Start { cost, .. }) = self.starts.get(0);
        let literals = self.literals[offset] - self.literals[start];
        let mut min_cost = cost + self.symbols.cheapest_command + literals;
        let (mut length, mut bucket, mut bucket_end) = (2, 4, 10);
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

    /// The length of the match at `distance`, if it may be longer than `longer_than`.
    #[inline(always)]
    fn match_at(
        &self,
        position: usize,
        data: &[u8],
        distance: usize,
        longer_than: usize,
    ) -> Option<usize> {
        let block = &self.block;
        let source = if distance.wrapping_sub(1) < block.max_backward(position) {
            if longer_than > block.window.before_end(position - distance) {
                return None;
            }
            block.window.from(position - distance)
        } else {
            let end_distance = block.dictionary_end_distance(position);
            block.dictionary?.at_distance(distance, end_distance)?
        };
        (source.get(longer_than) == Some(&data[longer_than])).then(|| match_length(source, data))
    }

    /// `node` has all but the length. Returns the longest improvement, from [`SHORT_COPY_END`] on.
    #[inline(always)]
    fn try_lengths(
        &mut self,
        offset: usize,
        lengths: RangeInclusive<usize>,
        insert_code: usize,
        [with_distance, without_distance]: [f32; 2],
        node: Node,
    ) -> usize {
        let (first, last) = lengths.into_inner();
        let (base, symbol_costs) = match self.symbols.with_last_distance.get(insert_code) {
            Some(costs) if node.insert_length >> 27 == 1 => (without_distance, costs),
            _ => (with_distance, &self.symbols.with_distance[insert_code]),
        };
        let short_end = SHORT_COPY_END.min(last + 1);
        let mut length = first;
        while length < short_end {
            let (extra, symbol) = (lanes(&COPY_EXTRA_BITS, length), lanes(symbol_costs, length));
            let costs = core::array::from_fn(|i| base + extra[i] + symbol[i]);
            let mut better = less(costs, lanes(&self.costs, offset + length));
            better &= (1 << LANES.min(short_end - length)) - 1;
            while better != 0 {
                let lane = better.trailing_zeros() as usize % LANES;
                better &= better - 1;
                self.costs[offset + length + lane] = costs[lane];
                self.nodes[offset + length + lane] = node.with_length(length + lane);
            }
            length += LANES;
        }
        if last < SHORT_COPY_END {
            return 0;
        }
        let lengths = first.max(SHORT_COPY_END)..=last;
        self.try_long_lengths(offset, lengths, insert_code, with_distance, node)
    }

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
            let (from, to) = (offset + length, offset + end);
            let targets = (self.costs[from..to].iter_mut()).zip(&mut self.nodes[from..to]);
            for (i, (old_cost, old_node)) in targets.enumerate() {
                if cost < *old_cost {
                    (*old_cost, *old_node) = (cost, node.with_length(length + i));
                    longest = length + i;
                }
            }
            length = end;
        }
        longest
    }

    /// A bit for each short distance code that may match for longer than `longer_than`, which is not zero.
    #[inline(always)]
    fn promising_codes(
        &self,
        position: usize,
        data: &[u8],
        [a, b, c, d]: [i32; 4],
        longer_than: usize,
    ) -> u32 {
        let pair = BytePair::new(self.block.window, position, data, longer_than - 1);
        let [near_a, near_b] = [a, b].map(|distance| pair.may_be_around(distance));
        let mut promising = (near_a & 1)
            | ((near_b & 1) << 1)
            | (pair.may_be_at(c) << 2)
            | (pair.may_be_at(d) << 3)
            | ((near_a >> 1) << 4)
            | ((near_b >> 1) << 10);
        if self.block.dictionary.is_some() {
            let max_backward = self.block.max_backward(position);
            // The codes that refer to each of them may reach into the dictionary.
            for (distance, codes) in [(a + 3, 0x03F1), (b + 3, 0xFC02), (c, 4), (d, 8)] {
                if distance as usize > max_backward {
                    promising |= codes;
                }
            }
        }
        promising
    }

    /// Settles `offset`, and tries the copies from there. Returns the longest improvement, from [`LONG_COPY`] on.
    #[inline(always)]
    fn extend(&mut self, offset: usize, candidates: &[Candidate]) -> Option<usize> {
        self.settle(offset);
        let position = self.block.position + offset;
        let data = self.block.data_from(position);
        let comparable = data.len().min(self.block.window.before_end(position) + 1);
        let min_length = self.min_useful_length(offset);
        let mut longest = 0;

        for rank in 0..self.starts.count {
            let (start, relative_cost, Start { last_distances, .. }) = self.starts.get(rank);
            let insert_length = offset - start;
            let insert_code = insert_length_code(insert_length);
            let base_cost = relative_cost
                + f32::from(INSERT_LENGTH_CODES[insert_code].extra_bits)
                + self.literals[offset];

            let mut tried = min_length - 1;
            let mut promising = 0;
            if tried < comparable {
                promising = self.promising_codes(position, data, last_distances, tried);
            }
            while promising != 0 && tried < comparable {
                let code = promising.trailing_zeros() as usize % 16;
                promising &= promising - 1;
                let base = last_distances[usize::from(SHORT_CODE_BASES[code]) % 4];
                let distance = (base + i32::from(SHORT_CODE_DELTAS[code])) as usize;
                let matched = self.match_at(position, data, distance, tried);
                let Some(matched) = matched.filter(|&matched| matched > tried) else {
                    continue;
                };
                let node = Node {
                    copy_length: 0,
                    distance: distance as u32,
                    insert_length: (((code + 1) << 27) | insert_length) as u32,
                };
                let bases = [base_cost + self.symbols.distances[code], base_cost];
                let lengths = tried + 1..=matched;
                longest = longest.max(self.try_lengths(offset, lengths, insert_code, bases, node));
                tried = matched;
            }

            if rank >= 2 {
                continue;
            }
            let mut next_length = min_length;
            for candidate in candidates {
                let matched = candidate.length();
                if matched < next_length {
                    continue;
                }
                let prefix = DistancePrefix::new(
                    candidate.distance() + DISTANCE_CODE_OFFSET,
                    &self.block.params.distance,
                );
                let with_distance = base_cost
                    + prefix.extra_bits() as f32
                    + self.symbols.distances[prefix.symbol()];
                let node = Node {
                    copy_length: 0,
                    distance: candidate.distance() as u32,
                    insert_length: insert_length as u32,
                };
                if let Some(word_length) = candidate.word_length() {
                    let cost = with_distance
                        + COPY_EXTRA_BITS[word_length]
                        + self.symbols.with_distance[insert_code][word_length];
                    if cost < self.costs[offset + matched] {
                        self.costs[offset + matched] = cost;
                        self.nodes[offset + matched] = node.with_word(matched, word_length);
                    }
                } else {
                    if matched > self.max_varied_length {
                        next_length = matched;
                    }
                    let (lengths, bases) = (next_length..=matched, [with_distance; 2]);
                    longest =
                        longest.max(self.try_lengths(offset, lengths, insert_code, bases, node));
                }
                next_length = matched + 1;
            }
        }
        Some(longest).filter(|&longest| longest >= LONG_COPY)
    }

    /// Extends the paths from `offset`, and returns the offset to go on from.
    fn step(&mut self, offset: usize, candidates: &[Candidate]) -> usize {
        let mut skip = self.extend(offset, candidates).unwrap_or(1);
        if let [only] = candidates
            && only.length() > self.max_varied_length
        {
            skip = skip.max(only.length());
        }
        let next = offset + skip;
        for skipped in offset + 1..next.min(searched_length(&self.block)) {
            self.settle(skipped);
        }
        next
    }

    /// `counts` has how many of `found` there are for each offset.
    fn extend_all(&mut self, mut found: &[Candidate], counts: &[u8]) {
        let (mut offset, searched) = (0, searched_length(&self.block));
        while offset < searched {
            let next = self.step(offset, &found[..usize::from(counts[offset])]);
            let passed = counts[offset..next.min(searched)].iter();
            found = &found[passed.map(|&count| usize::from(count)).sum()..];
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
            offset -= self.nodes[offset].command_length();
            count += 1;
        }
        // And one for the literals after them.
        commands.try_reserve(count + 1)?;
        let first = commands.list.len();
        commands.list.resize(first + count, Command::insert_only(0));
        offset = end;
        for slot in commands.list[first..].iter_mut().rev() {
            let node = self.nodes[offset];
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
            let node = self.nodes[end];
            let earlier = self.last_change_up_to(end - node.command_length());
            commands.last_distances = self.distances_from(earlier);
            if self.changes_last_distances(&node, end) {
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
    in_window: Vec<Candidate>,
    in_dictionary: Vec<Candidate>,
}

impl Finder<'_, '_> {
    const MAX_CANDIDATES: usize = 2 * BinaryTree::MAX_CANDIDATES;

    /// Appends to `found`, which has room. Only the last candidate stays if it is longer than `long`.
    #[inline(always)]
    fn find(&mut self, offset: usize, long: usize, found: &mut Vec<Candidate>) {
        let position = self.block.position + offset;
        let search = self
            .block
            .search_at(position, &self.block.padded()[offset..]);
        let short_match_range = if self.block.params.quality > 10 {
            64
        } else {
            16
        };
        let first = found.len();
        self.tree.find_all(&search, short_match_range, found);
        if let Some(dictionary) = self.block.dictionary {
            self.in_window.clear();
            self.in_window.extend(found.drain(first..));
            self.in_dictionary.clear();
            dictionary.find_all(&self.block.query_at(position), &mut self.in_dictionary);
            merge(&self.in_dictionary, &self.in_window, found);
        }
        if let Some(&last) = found[first..].last()
            && last.length() > long
        {
            found.truncate(first);
            found.push(last);
        }
    }

    fn store_between(&mut self, offset: usize, next: usize) {
        let block = &self.block;
        let end = (block.position + next).min(block.store_end(BinaryTree::LOOKAHEAD));
        self.tree
            .store_range(block.window, block.position + offset + 1, end);
    }
}

fn merge(mut a: &[Candidate], mut b: &[Candidate], merged: &mut Vec<Candidate>) {
    while let ([first_a, rest_a @ ..], [first_b, rest_b @ ..]) = (a, b) {
        if (first_a.length(), first_a.distance()) < (first_b.length(), first_b.distance()) {
            merged.push(*first_a);
            a = rest_a;
        } else {
            merged.push(*first_b);
            b = rest_b;
        }
    }
    merged.extend_from_slice(a);
    merged.extend_from_slice(b);
}

#[inline(never)]
pub(super) fn add_commands(
    tree: &mut BinaryTree,
    block: &InputBlock<'_>,
    commands: &mut Commands,
) -> Result<()> {
    let scratch = block.dictionary.map_or(0, |_| BinaryTree::MAX_CANDIDATES);
    let mut finder = Finder {
        tree,
        block: *block,
        in_window: memory::empty(scratch)?,
        in_dictionary: memory::empty(scratch)?,
    };
    let mut refined;
    let mut paths = Paths::new(block, commands.last_distances)?;
    let long = paths.max_varied_length;
    let searched = searched_length(block);

    if block.params.quality == 10 {
        let mut found = memory::empty(Finder::MAX_CANDIDATES)?;
        let mut offset = 0;
        while offset < searched {
            found.clear();
            finder.find(offset, long, &mut found);
            let next = paths.step(offset, &found);
            if next > offset + 1 {
                finder.store_between(offset, next);
            }
            offset = next;
        }
        return paths.add_cheapest_to(commands);
    }

    let mut found = memory::empty(4 * block.length)?;
    let mut counts = memory::zeroed::<u8>(block.length)?;
    let mut offset = 0;
    while offset < searched {
        memory::try_reserve(&mut found, Finder::MAX_CANDIDATES)?;
        let first = found.len();
        finder.find(offset, long, &mut found);
        counts[offset] = (found.len() - first) as u8;
        offset = match found[first..] {
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
