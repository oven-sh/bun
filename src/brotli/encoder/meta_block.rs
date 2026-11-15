//! Distributes the symbols of a meta-block among block types and contexts.

use super::block_splitter::{self, Block, BlockSplit};
use super::cluster::cluster_histograms;
use super::command::{Command, DistancePrefix};
use super::histogram::{
    CommandHistogram, DISTANCE_SYMBOLS, DistanceHistogram, Histogram, LiteralHistogram,
    bits_entropy,
};
use super::huffman::smooth_counts;
use super::literal_contexts::{ContextGroups, MAX_GROUPS};
use super::matching::put_bytes;
use super::params::Params;
use super::ring_buffer::Window;
use crate::context::{ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS};
use crate::format::{
    COMMAND_SYMBOLS, DistanceParams, LITERAL_SYMBOLS, MAX_BLOCK_TYPES, MAX_POSTFIX_BITS,
};
use crate::memory::{self, Result, Zeroable};

const MAX_HISTOGRAMS: usize = 256;

/// The input that a meta-block covers.
pub(super) struct Source<'a> {
    pub(super) window: Window<'a>,
    pub(super) start: usize,
    pub(super) length: usize,
    /// The bytes before the start, the last one first.
    pub(super) before: [u8; 2],
}

/// The literals of a meta-block, each with a number above its 8 bits.
pub(super) struct Literals {
    padded: Vec<u16>,
}

impl Literals {
    const SLACK: usize = 8;

    fn zeroed<T: Zeroable>(commands: &[Command]) -> Result<Vec<T>> {
        let count: usize = commands.iter().map(Command::insert_length).sum();
        memory::zeroed(count + Self::SLACK)
    }

    pub(super) fn gather(source: &Source<'_>, commands: &[Command]) -> Result<Self> {
        let mut bytes = Self::zeroed::<u8>(commands)?;
        let (mut position, mut count) = (source.start, 0);
        for command in commands {
            let mut copied = 0;
            loop {
                let eight = source.window.bytes_at::<8>(position + copied);
                put_bytes(&mut bytes, count + copied, eight);
                copied += 8;
                if copied >= command.insert_length() {
                    break;
                }
            }
            count += command.insert_length();
            position += command.insert_length() + command.copy_length();
        }
        let padded = memory::collected(bytes.iter().map(|&byte| u16::from(byte)))?;
        Ok(Self { padded })
    }

    /// The numbers are those of the contexts.
    fn gather_with_contexts(
        source: &Source<'_>,
        commands: &[Command],
        mode: ContextMode,
        numbers: &[u8; LITERAL_CONTEXTS],
    ) -> Result<Self> {
        let lut = mode.lut();
        let mut padded = Self::zeroed(commands)?;
        let (mut position, mut count) = (source.start, 0);
        let [last, second_last] = source.before;
        let [a, b, c, d] = source.window.bytes_at(position);
        let mut from_two_before = [second_last, last, a, b, c, d];
        for command in commands {
            let end = count + command.insert_length();
            let next_position = position + command.insert_length() + command.copy_length();
            loop {
                let slots = padded[count..count + 4].iter_mut();
                for (slot, &[second_last, last, literal]) in
                    slots.zip(from_two_before.array_windows())
                {
                    let context = lut.context(last, second_last) % LITERAL_CONTEXTS;
                    *slot = u16::from_le_bytes([literal, numbers[context]]);
                }
                (position, count) = (position + 4, count + 4);
                if count >= end {
                    break;
                }
                from_two_before = source.window.bytes_at(position - 2);
            }
            (position, count) = (next_position, end);
            from_two_before = source.window.bytes_at(position - 2);
        }
        padded[count..].fill(0);
        Ok(Self { padded })
    }

    /// With some more at the end, whose number is zero.
    pub(super) fn padded(&self) -> &[u16] {
        &self.padded
    }

    pub(super) fn all(&self) -> &[u16] {
        &self.padded[..self.padded.len() - Self::SLACK]
    }

    fn all_mut(&mut self) -> &mut [u16] {
        let count = self.padded.len() - Self::SLACK;
        &mut self.padded[..count]
    }
}

pub(super) struct MetaBlock {
    /// With the number of their histogram.
    pub(super) literals: Literals,
    pub(super) literal_split: BlockSplit,
    pub(super) command_split: BlockSplit,
    pub(super) distance_split: BlockSplit,
    /// `None` if each block type has one histogram.
    pub(super) literal_context_map: Option<Vec<u32>>,
    pub(super) distance_context_map: Option<Vec<u32>>,
    pub(super) literal_histograms: Vec<LiteralHistogram>,
    pub(super) command_histograms: Vec<CommandHistogram>,
    pub(super) distance_histograms: Vec<DistanceHistogram>,
    pub(super) distance_params: DistanceParams,
}

impl MetaBlock {
    /// Searches for the best split, and clusters the contexts. Encodes the distances of `commands` anew.
    pub(super) fn build(
        source: &Source<'_>,
        commands: &mut [Command],
        params: &Params,
        context_mode: ContextMode,
    ) -> Result<Self> {
        let distance_params = choose_distance_params(commands, params);
        if distance_params != params.distance {
            for command in commands.iter_mut().filter(|c| c.has_distance_symbol()) {
                let code = command.distance().code(&params.distance);
                command.set_distance(DistancePrefix::new(code, &distance_params));
            }
        }

        let iterations = if params.quality < 11 { 3 } else { 10 };
        let mut literals = Literals::gather(source, commands)?;
        let literal_split = block_splitter::split::<LITERAL_SYMBOLS>(
            literals.all(),
            &block_splitter::LITERALS,
            iterations,
        )?;
        let mut symbols = memory::collected(commands.iter().map(|c| c.symbol() as u16))?;
        let command_split = block_splitter::split::<COMMAND_SYMBOLS>(
            &symbols,
            &block_splitter::COMMANDS,
            iterations,
        )?;
        let mut command_histograms = memory::filled(Histogram::EMPTY, command_split.type_count)?;
        for (kind, symbols) in command_split.apply_to(&mut symbols) {
            command_histograms[kind].add_all(symbols);
        }

        let with_distance = || commands.iter().filter(|c| c.has_distance_symbol());
        symbols.clear();
        symbols.extend(with_distance().map(|c| c.distance().symbol() as u16));
        let distance_split = block_splitter::split::<DISTANCE_SYMBOLS>(
            &symbols,
            &block_splitter::DISTANCES,
            iterations,
        )?;
        let mut distance_histograms = memory::filled(
            Histogram::EMPTY,
            distance_split.type_count * DISTANCE_CONTEXTS,
        )?;
        let mut distance_contexts = with_distance().map(Command::distance_context);
        for (kind, symbols) in distance_split.apply_to(&mut symbols) {
            for (&symbol, context) in symbols.iter().zip(&mut distance_contexts) {
                distance_histograms[kind * DISTANCE_CONTEXTS + context].add(usize::from(symbol));
            }
        }
        drop(symbols);

        let use_contexts = !params.disable_literal_context_modeling;
        let contexts = if use_contexts { LITERAL_CONTEXTS } else { 1 };
        if use_contexts {
            let numbers = core::array::from_fn(|context| context as u8);
            literals = Literals::gather_with_contexts(source, commands, context_mode, &numbers)?;
        }
        let mut literal_histograms =
            memory::filled(Histogram::EMPTY, literal_split.type_count * contexts)?;
        for (kind, literals) in literal_split.apply_to(literals.all_mut()) {
            for [literal, context] in literals.iter().map(|tagged| tagged.to_le_bytes()) {
                literal_histograms[kind * contexts + usize::from(context)].add(literal.into());
            }
        }

        let (literal_histograms, mut literal_context_map) =
            cluster_histograms(&literal_histograms, MAX_HISTOGRAMS)?;
        for (kind, literals) in literal_split.apply_to(literals.all_mut()) {
            let map = &literal_context_map[kind * contexts..][..contexts];
            for tagged in literals {
                let [literal, context] = tagged.to_le_bytes();
                *tagged = u16::from_le_bytes([literal, map[usize::from(context)] as u8]);
            }
        }
        if !use_contexts {
            let size = literal_context_map.len() * LITERAL_CONTEXTS;
            let spread = (0..size).map(|i| literal_context_map[i / LITERAL_CONTEXTS]);
            literal_context_map = memory::collected(spread)?;
        }
        let (distance_histograms, distance_context_map) =
            cluster_histograms(&distance_histograms, MAX_HISTOGRAMS)?;
        Ok(Self {
            literals,
            literal_split,
            command_split,
            distance_split,
            literal_context_map: Some(literal_context_map),
            distance_context_map: Some(distance_context_map),
            literal_histograms,
            command_histograms,
            distance_histograms,
            distance_params,
        })
    }

    /// In one pass. `groups` are for the UTF-8 context mode.
    pub(super) fn build_greedy(
        source: &Source<'_>,
        commands: &[Command],
        params: &Params,
        groups: Option<&ContextGroups>,
    ) -> Result<Self> {
        let group_count = groups.map_or(1, |groups| groups.count);
        let mut literals = match groups {
            None => Literals::gather(source, commands),
            Some(groups) => Literals::gather_with_contexts(
                source,
                commands,
                ContextMode::Utf8,
                &groups.of_context,
            ),
        }?;
        let literal_count = literals.all().len();
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/metablock.c#L561
        let mut splitter =
            GreedySplitter::new(LITERAL_SYMBOLS, group_count, 512, 400.0, literal_count)?;
        splitter.add_literals(literals.all());
        let (literal_split, literal_histograms) = splitter.finish();
        for (kind, literals) in literal_split.apply_to(literals.all_mut()) {
            for tagged in literals {
                *tagged += ((kind * group_count) << 8) as u16;
            }
        }

        let mut symbols = GreedySplitter::new(COMMAND_SYMBOLS, 1, 1024, 500.0, commands.len())?;
        let mut distances = GreedySplitter::new(64, 1, 512, 100.0, commands.len())?;
        for command in commands {
            symbols.add_if(true, command.symbol());
            distances.add_if(command.has_distance_symbol(), command.distance().symbol());
        }
        let (command_split, command_histograms) = symbols.finish();
        let (distance_split, distance_histograms) = distances.finish();
        let literal_context_map = groups.map(|groups| {
            memory::collected((0..literal_split.type_count * LITERAL_CONTEXTS).map(|i| {
                let first = i / LITERAL_CONTEXTS * groups.count;
                first as u32 + u32::from(groups.of_context[i % LITERAL_CONTEXTS])
            }))
        });
        Ok(Self {
            literals,
            literal_context_map: literal_context_map.transpose()?,
            distance_context_map: None,
            literal_split,
            command_split,
            distance_split,
            literal_histograms,
            command_histograms,
            distance_histograms,
            distance_params: params.distance,
        })
    }

    pub(super) fn smooth_histograms(&mut self) {
        for histogram in &mut self.literal_histograms {
            smooth_counts(&mut histogram.counts);
        }
        for histogram in &mut self.command_histograms {
            smooth_counts(&mut histogram.counts);
        }
        for histogram in &mut self.distance_histograms {
            smooth_counts(&mut histogram.counts[..self.distance_params.alphabet.size as usize]);
        }
    }
}

fn choose_distance_params(commands: &[Command], params: &Params) -> DistanceParams {
    let original = params.distance;
    let mut best = original;
    let mut best_cost = 1e99;
    let mut tried_original = false;
    let mut direct_msb = 0;
    for postfix_bits in 0..=MAX_POSTFIX_BITS {
        while direct_msb < 16 {
            let direct_codes = direct_msb << postfix_bits;
            let candidate = DistanceParams::new(postfix_bits, direct_codes, params.large_window);
            tried_original |= candidate == original;
            match distance_cost(commands, &original, &candidate) {
                Some(cost) if cost <= best_cost => (best, best_cost) = (candidate, cost),
                _ => break,
            }
            direct_msb += 1;
        }
        direct_msb = direct_msb.saturating_sub(1) / 2;
    }
    if !tried_original
        && distance_cost(commands, &original, &original).is_some_and(|cost| cost < best_cost)
    {
        best = original;
    }
    best
}

/// `None` if a distance is too large for `candidate`.
fn distance_cost(
    commands: &[Command],
    original: &DistanceParams,
    candidate: &DistanceParams,
) -> Option<f64> {
    let mut histogram = DistanceHistogram::EMPTY;
    let mut extra_bits = 0;
    for command in commands.iter().filter(|c| c.has_distance_symbol()) {
        let mut prefix = command.distance();
        if original != candidate {
            let code = prefix.code(original);
            if code > candidate.max_distance {
                return None;
            }
            prefix = DistancePrefix::new(code, candidate);
        }
        histogram.add(prefix.symbol());
        extra_bits += prefix.extra_bits();
    }
    Some(histogram.cost() + f64::from(extra_bits))
}

/// Gives each block a new type, or merges it with one of the last two types.
struct GreedySplitter<const N: usize> {
    /// How many symbols the entropy looks at.
    alphabet_size: usize,
    groups: usize,
    min_block_size: usize,
    split_threshold: f64,
    split: BlockSplit,
    /// One for each group of each type, and then of the current block.
    histograms: Vec<Histogram<N>>,
    current: usize,
    block_size: usize,
    target_block_size: usize,
    last_types: [usize; 2],
    last_entropies: [[f64; MAX_GROUPS]; 2],
    merges_with_last: usize,
}

impl<const N: usize> GreedySplitter<N> {
    fn new(
        alphabet_size: usize,
        groups: usize,
        min_block_size: usize,
        split_threshold: f64,
        symbols: usize,
    ) -> Result<Self> {
        let max_blocks = symbols / min_block_size + 1;
        let max_types = max_blocks.min(MAX_BLOCK_TYPES / groups + 1);
        let mut histograms = memory::empty(max_types * groups)?;
        histograms.resize(groups, Histogram::EMPTY);
        Ok(Self {
            alphabet_size,
            groups,
            min_block_size,
            split_threshold,
            split: BlockSplit {
                type_count: 0,
                blocks: memory::empty(max_blocks)?,
            },
            histograms,
            current: 0,
            block_size: 0,
            target_block_size: min_block_size,
            last_types: [0; 2],
            last_entropies: [[0.0; MAX_GROUPS]; 2],
            merges_with_last: 0,
        })
    }

    #[inline(always)]
    fn add_if(&mut self, condition: bool, symbol: usize) {
        self.histograms[self.current].counts[symbol] += u32::from(condition);
        self.block_size += usize::from(condition);
        if self.block_size == self.target_block_size {
            self.finish_block(false);
        }
    }

    /// With the number of their group.
    fn add_literals(&mut self, mut literals: &[u16]) {
        loop {
            let (fit, rest) = literals.split_at(literals.len().min(self.target_block_size));
            let histograms = &mut self.histograms[self.current..];
            for [literal, group] in fit.iter().map(|tagged| tagged.to_le_bytes()) {
                histograms[usize::from(group)].counts[usize::from(literal)] += 1;
            }
            self.block_size = fit.len();
            if self.block_size < self.target_block_size {
                return;
            }
            self.finish_block(false);
            literals = rest;
        }
    }

    #[inline(never)]
    fn finish_block(&mut self, is_final: bool) {
        let length = self.block_size.max(self.min_block_size) as u32;
        self.block_size = 0;
        if is_final && self.split.type_count == 0 {
            self.start_type(length, is_final);
            return;
        }
        let (finished, current) = self.histograms.split_at_mut(self.current);
        let mut entropies = [0.0; MAX_GROUPS];
        for (entropy, histogram) in entropies.iter_mut().zip(&*current) {
            *entropy = bits_entropy(&histogram.counts[..self.alphabet_size]);
        }
        if self.split.type_count == 0 {
            self.last_entropies = [entropies; 2];
            self.start_type(length, is_final);
            return;
        }

        let mut merged_entropies = [[0.0; MAX_GROUPS]; 2];
        let mut losses = [0.0; 2];
        for (group, histogram) in current.iter().enumerate() {
            for j in 0..2 {
                let mut sum = finished[self.last_types[j] * self.groups + group];
                sum.merge(histogram);
                let merged = bits_entropy(&sum.counts[..self.alphabet_size]);
                merged_entropies[j][group] = merged;
                losses[j] += merged - entropies[group] - self.last_entropies[j][group];
            }
        }

        if self.split.type_count < MAX_BLOCK_TYPES / self.groups
            && losses[0] > self.split_threshold
            && losses[1] > self.split_threshold
        {
            self.last_types = [self.split.type_count, self.last_types[0]];
            self.last_entropies = [entropies, self.last_entropies[0]];
            self.merges_with_last = 0;
            self.target_block_size = self.min_block_size;
            self.start_type(length, is_final);
            return;
        }
        if losses[1] < losses[0] - 20.0 {
            self.last_types.swap(0, 1);
            self.last_entropies = [merged_entropies[1], self.last_entropies[0]];
            self.merges_with_last = 0;
            self.target_block_size = self.min_block_size;
            self.split.blocks.push(Block {
                kind: self.last_types[0] as u8,
                length,
            });
        } else {
            self.last_entropies[0] = merged_entropies[0];
            if self.split.type_count == 1 {
                self.last_entropies[1] = merged_entropies[0];
            }
            self.merges_with_last += 1;
            if self.merges_with_last > 1 {
                self.target_block_size += self.min_block_size;
            }
            if let Some(last) = self.split.blocks.last_mut() {
                last.length += length;
            }
        }
        let targets = &mut finished[self.last_types[0] * self.groups..];
        for (target, histogram) in targets.iter_mut().zip(current) {
            target.merge(histogram);
            histogram.clear();
        }
    }

    fn start_type(&mut self, length: u32, is_final: bool) {
        self.split.blocks.push(Block {
            kind: self.split.type_count as u8,
            length,
        });
        self.split.type_count += 1;
        self.current += self.groups;
        if !is_final {
            self.histograms
                .resize(self.current + self.groups, Histogram::EMPTY);
        }
    }

    fn finish(mut self) -> (BlockSplit, Vec<Histogram<N>>) {
        self.finish_block(true);
        self.histograms.truncate(self.current);
        (self.split, self.histograms)
    }
}
