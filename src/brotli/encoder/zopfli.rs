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
use super::log2::fast_log2;
use super::matching::match_length;
use super::symbol_set::SymbolSet;
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, INSERT_LENGTH_CODES, LITERAL_SYMBOLS, SHORT_CODE_BASES,
    SHORT_CODE_DELTAS, SHORT_COPY_END,
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

static COPY_EXTRA_BITS: CostByCopyLength = {
    let codes: [u8; SHORT_COPY_END + LANES] = codes_of_short_lengths(&COPY_LENGTH_CODES);
    let (mut bits, mut length) = ([0.0; _], 0);
    while length < codes.len() {
        bits[length] = COPY_LENGTH_CODES[codes[length] as usize].extra_bits as f32;
        length += 1;
    }
    bits
};

struct CostModel {
    commands: Box<[f32; COMMAND_SYMBOLS]>,
    /// Of the command symbol, for each insert length code.
    with_distance: Box<[CostByCopyLength; 24]>,
    with_last_distance: Box<[CostByCopyLength; 8]>,
    distances: Box<[f32; DISTANCE_SYMBOLS]>,
    cheapest_command: f32,
    /// Of all the bytes before each position.
    literals: Vec<f32>,
}

impl CostModel {
    fn from_literal_costs(data: &[u8]) -> Result<Self> {
        let mut literals = memory::empty(data.len() + 1)?;
        literals.push(0.0);
        literal_cost::estimate(data, &mut literals);
        accumulate(&mut literals);
        let mut model = Self {
            commands: memory::filled_array(0.0)?,
            with_distance: memory::filled_array([0.0; _])?,
            with_last_distance: memory::filled_array([0.0; _])?,
            distances: memory::filled_array(0.0)?,
            cheapest_command: 0.0,
            literals,
        };
        for (costs, first) in [
            (&mut model.commands[..], 11),
            (&mut model.distances[..], 20),
        ] {
            for (i, cost) in costs.iter_mut().enumerate() {
                *cost = fast_log2(first + i) as f32;
            }
        }
        model.commands_changed();
        Ok(model)
    }

    fn commands_changed(&mut self) {
        self.cheapest_command = self.commands.iter().copied().fold(UNREACHED, f32::min);
        for (rows, use_last) in [
            (&mut self.with_distance[..], false),
            (&mut self.with_last_distance[..], true),
        ] {
            for (insert_code, row) in rows.iter_mut().enumerate() {
                for (length, cost) in row.iter_mut().enumerate() {
                    let copy_code = copy_length_code(length);
                    let symbol = combine_length_codes(insert_code, copy_code, use_last);
                    *cost = self.commands[usize::from(symbol)];
                }
            }
        }
    }

    /// `commands` start at `start`, which may be before the block.
    fn set_from_commands(&mut self, block: &InputBlock<'_>, start: usize, commands: &[Command]) {
        let mut literals = [0; LITERAL_SYMBOLS];
        let mut symbols = [0; COMMAND_SYMBOLS];
        let mut distances = [0; DISTANCE_SYMBOLS];
        let mut position = start;
        for command in commands {
            symbols[command.symbol()] += 1;
            if command.has_distance_symbol() {
                distances[command.distance().symbol()] += 1;
            }
            for part in block.window.parts(position, command.insert_length()) {
                for &literal in part {
                    literals[usize::from(literal)] += 1;
                }
            }
            position += command.insert_length() + command.copy_length();
        }
        let mut literal_costs = [0.0; LITERAL_SYMBOLS];
        set_costs(&literals, false, &mut literal_costs);
        set_costs(&symbols, true, &mut *self.commands);
        let used = block.params.distance.alphabet.size as usize;
        set_costs(&distances[..used], true, &mut *self.distances);
        self.commands_changed();
        let data = block.data_from(block.position);
        for (cost, &literal) in self.literals[1..].iter_mut().zip(data) {
            *cost = literal_costs[usize::from(literal)];
        }
        accumulate(&mut self.literals);
    }
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

/// The best positions for a command to start at: those that cost the least, compared with nothing but literals.
#[derive(Default)]
struct Starts {
    /// The bits of the difference, which is not positive, and below them the offset. The largest number is the best.
    sorted: [u64; MAX_STARTS],
    count: usize,
}

impl Starts {
    #[inline(always)]
    fn push(&mut self, offset: usize, relative_cost: f32, max_count: usize) {
        let mut moved = (u64::from(relative_cost.to_bits()) << 32) | offset as u64;
        for slot in &mut self.sorted {
            (*slot, moved) = (moved.max(*slot), moved.min(*slot));
        }
        self.count = max_count.min(self.count + 1);
    }

    #[inline(always)]
    fn get(&self, rank: usize) -> (usize, f32) {
        let packed = self.sorted[rank];
        (
            packed as u32 as usize,
            f32::from_bits((packed >> 32) as u32),
        )
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
    model: CostModel,
    /// Longer matches are only tried in full.
    max_varied_length: usize,
    starts_to_try: usize,
    starts: Starts,
    /// Where `costs` is below [`UNREACHED`].
    nodes: Vec<Node>,
    /// With [`LANES`] more at the end.
    costs: Vec<f32>,
    /// At the offsets that went into `starts`.
    last_distances: Vec<[i32; 4]>,
}

impl<'a> Paths<'a> {
    fn new(block: &InputBlock<'a>, last_distances: [i32; 4]) -> Result<Self> {
        let thorough = block.params.quality > 10;
        let mut paths = Self {
            block: *block,
            model: CostModel::from_literal_costs(block.data_from(block.position))?,
            max_varied_length: if thorough { 325 } else { 150 },
            starts_to_try: if thorough { MAX_STARTS } else { 1 },
            starts: Starts::default(),
            nodes: memory::filled(Node::default(), block.length + 1)?,
            costs: memory::filled(UNREACHED, block.length + 1 + LANES)?,
            last_distances: memory::filled(last_distances, block.length + 1)?,
        };
        paths.costs[0] = 0.0;
        Ok(paths)
    }

    fn reset(&mut self) {
        self.starts = Starts::default();
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
        let (cost, as_literals) = (self.costs[offset], self.model.literals[offset]);
        if cost > as_literals {
            return;
        }
        if offset != 0 {
            let node = self.nodes[offset];
            let before @ [a, b, c, _] = self.last_distances[offset - node.command_length()];
            self.last_distances[offset] = select_unpredictable(
                self.changes_last_distances(&node, offset),
                [node.distance as i32, a, b, c],
                before,
            );
        }
        self.starts
            .push(offset, cost - as_literals, self.starts_to_try);
    }

    /// Shorter copies lead to positions that are reached more cheaply already.
    #[inline(always)]
    fn min_useful_length(&self, offset: usize) -> usize {
        let (start, _) = self.starts.get(0);
        let literals = self.model.literals[offset] - self.model.literals[start];
        let mut min_cost = self.costs[start] + self.model.cheapest_command + literals;
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
        let (base, symbol_costs) = match self.model.with_last_distance.get(insert_code) {
            Some(costs) if node.insert_length >> 27 == 1 => (without_distance, costs),
            _ => (with_distance, &self.model.with_distance[insert_code]),
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
                base + f32::from(range.extra_bits) + self.model.commands[usize::from(symbol)];
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
            let (start, relative_cost) = self.starts.get(rank);
            let insert_length = offset - start;
            let insert_code = insert_length_code(insert_length);
            let base_cost = relative_cost
                + f32::from(INSERT_LENGTH_CODES[insert_code].extra_bits)
                + self.model.literals[offset];

            let last_distances = self.last_distances[start];
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
                let bases = [base_cost + self.model.distances[code], base_cost];
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
                let with_distance =
                    base_cost + prefix.extra_bits() as f32 + self.model.distances[prefix.symbol()];
                let node = Node {
                    copy_length: 0,
                    distance: candidate.distance() as u32,
                    insert_length: insert_length as u32,
                };
                if let Some(word_length) = candidate.word_length() {
                    let cost = with_distance
                        + COPY_EXTRA_BITS[word_length]
                        + self.model.with_distance[insert_code][word_length];
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

    fn add_cheapest_to(&self, commands: &mut Commands) {
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
            commands.last_distances = self.last_distances[end - node.command_length()];
            if self.changes_last_distances(&node, end) {
                commands.remember_distance(node.distance as usize);
            }
        }
        commands.pending_literals += self.block.length - end;
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
        match self.block.dictionary {
            None => self.tree.find_all(&search, short_match_range, found),
            Some(dictionary) => {
                self.in_window.clear();
                self.in_dictionary.clear();
                self.tree
                    .find_all(&search, short_match_range, &mut self.in_window);
                dictionary.find_all(&self.block.query_at(position), &mut self.in_dictionary);
                merge(&self.in_dictionary, &self.in_window, found);
            }
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

/// `commands` has room.
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
        paths.add_cheapest_to(commands);
        return Ok(());
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
    for pass in 0..2 {
        if pass == 1 {
            let start = block.position - pending_literals;
            paths
                .model
                .set_from_commands(block, start, &commands.list[first..]);
            paths.reset();
            commands.list.truncate(first);
            commands.literal_count = literal_count;
            commands.pending_literals = pending_literals;
            commands.last_distances = paths.last_distances[0];
        }
        let mut rest = &*found;
        let mut offset = 0;
        while offset < searched {
            let next = paths.step(offset, &rest[..usize::from(counts[offset])]);
            let passed = counts[offset..next.min(searched)].iter();
            rest = &rest[passed.map(|&count| usize::from(count)).sum()..];
            offset = next;
        }
        paths.add_cheapest_to(commands);
    }
    Ok(())
}
