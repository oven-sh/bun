//! Distributes the symbols of a meta-block among block types and contexts.

use super::block_splitter::{self, BlockSplit, Tuning, with_symbols};
use super::cluster::{BIT, Clusters, Items, Limit, MAX_CLUSTERS, Prices, cost_of};
use super::command::{Command, DistancePrefix};
use super::histogram::{DISTANCE_SYMBOLS, count_symbols};
use super::huffman::smooth_counts;
use super::matching::bytes_at;
use super::params::Params;
use super::ring_buffer::Window;
use crate::context::{ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS};
use crate::format::{
    COMMAND_SYMBOLS, DISTANCE_SHORT_CODES, DistanceParams, LITERAL_SYMBOLS, MAX_POSTFIX_BITS,
};
use crate::memory::{self, Result};

/// The input that a meta-block covers.
pub(super) struct Source<'a> {
    pub(super) window: Window<'a>,
    pub(super) start: usize,
    pub(super) length: usize,
    pub(super) literal_count: usize,
    /// The bytes before the start, the last one first.
    pub(super) before: [u8; 2],
}

/// The literals of a meta-block, each with a number above its 8 bits.
pub(super) struct Literals {
    padded: Vec<u16>,
}

impl Literals {
    pub(super) const SLACK: usize = 16;

    pub(super) fn gather(source: &Source<'_>, commands: &[Command]) -> Result<Self> {
        let mut padded = memory::zeroed(source.literal_count + Self::SLACK)?;
        let (mut position, mut rest) = (source.start, &mut *padded);
        let mut commands = commands.iter();
        loop {
            let misfit = commands.find(|command| {
                let count = command.insert_length();
                let at = source.window.index(position);
                if count <= Self::SLACK
                    && let Some(bytes) = source.window.bytes.get(at..at + Self::SLACK)
                    && let Some(slots) = rest.first_chunk_mut::<{ Self::SLACK }>()
                {
                    *slots = bytes_at(bytes, 0).map(u16::from);
                    rest = &mut core::mem::take(&mut rest)[count..];
                    position += count + command.copy_length();
                    return false;
                }
                true
            });
            let Some(command) = misfit else {
                return Ok(Self { padded });
            };
            let count = command.insert_length();
            widen(source.window.parts(position, count), rest);
            rest = &mut rest[count..];
            position += count + command.copy_length();
        }
    }

    /// The numbers are those of the contexts.
    fn gather_with_contexts(
        source: &Source<'_>,
        commands: &[Command],
        mode: ContextMode,
    ) -> Result<Self> {
        let lut = mode.lut();
        let mut padded = memory::zeroed(source.literal_count + Self::SLACK)?;
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
                    *slot = u16::from_le_bytes([literal, lut.context(last, second_last) as u8]);
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
        Ok(Self { padded })
    }

    /// With [`SLACK`](Self::SLACK) more at the end.
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

#[inline(never)]
fn widen(parts: [&[u8]; 2], mut slots: &mut [u16]) {
    for part in parts {
        let filled;
        (filled, slots) = slots.split_at_mut(part.len());
        for (slot, &byte) in filled.iter_mut().zip(part) {
            *slot = u16::from(byte);
        }
    }
}

pub(super) struct MetaBlock {
    /// With the number of their histogram.
    pub(super) literals: Literals,
    pub(super) literal_split: BlockSplit,
    pub(super) command_split: BlockSplit,
    pub(super) distance_split: BlockSplit,
    pub(super) literal_context_map: Vec<u32>,
    pub(super) distance_context_map: Vec<u32>,
    pub(super) literal_histograms: Vec<[u32; LITERAL_SYMBOLS]>,
    pub(super) command_histograms: Vec<[u32; COMMAND_SYMBOLS]>,
    pub(super) distance_histograms: Vec<[u32; DISTANCE_SYMBOLS]>,
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
        let distance_params = choose_distance_params(commands, params)?;
        if distance_params != params.distance {
            for command in commands.iter_mut().filter(|c| c.has_distance_symbol()) {
                let code = command.distance().code(&params.distance);
                command.set_distance(DistancePrefix::new(code, &distance_params));
            }
        }
        let (items, clusters) = (&mut Items::default(), &mut Clusters::default());

        let mut symbols = memory::collected(commands.iter().map(|c| c.symbol() as u16))?;
        let command_split = block_splitter::split(
            &symbols,
            COMMAND_SYMBOLS,
            source.length,
            &Tuning::COMMANDS,
            items,
            clusters,
        )?;
        let mut command_histograms = memory::filled([0; _], command_split.type_count)?;
        for (kind, symbols) in command_split.apply_to(&mut symbols) {
            count_symbols(symbols, &mut command_histograms[kind]);
        }

        let with_distance = || commands.iter().filter(|c| c.has_distance_symbol());
        let size = (distance_params.alphabet.size as usize).next_multiple_of(8);
        symbols.clear();
        symbols.extend(with_distance().map(|c| c.distance().symbol() as u16));
        let distance_split = block_splitter::split(
            &symbols,
            size,
            source.length,
            &Tuning::DISTANCES,
            items,
            clusters,
        )?;
        let mut counts = memory::zeroed(distance_split.type_count * DISTANCE_CONTEXTS * size)?;
        let mut distance_contexts = with_distance().map(Command::distance_context);
        for (kind, symbols) in distance_split.apply_to(&mut symbols) {
            for (&symbol, context) in symbols.iter().zip(&mut distance_contexts) {
                counts[(kind * DISTANCE_CONTEXTS + context) * size + usize::from(symbol)] += 1;
            }
        }
        drop(symbols);
        items.clear();
        for counts in counts.chunks_exact(size) {
            items.push_counts(counts)?;
        }
        let prices = Prices {
            description: 100,
            first_description: 50,
            change: 3 * BIT,
            several: 20 * BIT,
        };
        let (distance_histograms, distance_context_map) =
            clustered(size, source.length, &prices, items, clusters)?;

        let mut literals = Literals::gather(source, commands)?;
        let literal_split = block_splitter::split(
            literals.all(),
            LITERAL_SYMBOLS,
            source.length,
            &Tuning::LITERALS,
            items,
            clusters,
        )?;
        let use_contexts = !params.disable_literal_context_modeling;
        let contexts = if use_contexts { LITERAL_CONTEXTS } else { 1 };
        if use_contexts {
            literals = Literals::gather_with_contexts(source, commands, context_mode)?;
        }
        let mut zeros = memory::zeroed_array()?;
        items.clear();
        for kind in 0..literal_split.type_count {
            let blocks = with_symbols(&literal_split.blocks, literals.all());
            let blocks = blocks.filter_map(|(block, literals)| {
                (usize::from(block.kind) == kind).then_some(literals)
            });
            items.push_literals(blocks, contexts, &mut zeros)?;
        }
        let prices = Prices {
            description: 100,
            first_description: 70,
            change: 5 * BIT,
            several: 30 * BIT,
        };
        let (literal_histograms, mut literal_context_map) =
            clustered(LITERAL_SYMBOLS, source.length, &prices, items, clusters)?;
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
        Ok(Self {
            literals,
            literal_split,
            command_split,
            distance_split,
            literal_context_map,
            distance_context_map,
            literal_histograms,
            command_histograms,
            distance_histograms,
            distance_params,
        })
    }

    pub(super) fn smooth_histograms(&mut self) {
        for histogram in &mut self.literal_histograms {
            smooth_counts(histogram);
        }
        for histogram in &mut self.command_histograms {
            smooth_counts(histogram);
        }
        for histogram in &mut self.distance_histograms {
            smooth_counts(&mut histogram[..self.distance_params.alphabet.size as usize]);
        }
    }
}

/// The histograms of the clusters, and the cluster for each item.
fn clustered<const N: usize>(
    alphabet_size: usize,
    input_size: usize,
    prices: &Prices,
    items: &Items,
    clusters: &mut Clusters,
) -> Result<(Vec<[u32; N]>, Vec<u32>)> {
    let usual = (input_size / 1024).clamp(8, 128) - 1;
    clusters.find(
        items,
        alphabet_size,
        Limit {
            usual,
            surcharge: 3,
            max: MAX_CLUSTERS,
        },
        prices,
    )?;
    let mut merged = memory::filled([0; _], clusters.count)?;
    for (item, &cluster) in clusters.of_item.iter().enumerate() {
        items.add_to(item, &mut merged[cluster as usize]);
    }
    Ok((merged, core::mem::take(&mut clusters.of_item)))
}

#[inline(never)]
fn choose_distance_params(commands: &[Command], params: &Params) -> Result<DistanceParams> {
    let original = params.distance;
    let step = (commands.len() / (commands.len() / 4).clamp(256, 2048)) | 1;
    let mut codes = memory::empty(commands.len() / step + 1)?;
    let with_distance = commands
        .iter()
        .step_by(step)
        .filter(|c| c.has_distance_symbol());
    codes.extend(with_distance.map(|c| c.distance().code(&original) as u32));
    // The parameters are for distances that are alike in these.
    let mut low_bits = [0; 8];
    for &code in &codes {
        low_bits[code as usize % 8] += u32::from(code >= DISTANCE_SHORT_CODES);
    }
    let flat = 3 * BIT * low_bits.iter().sum::<u32>() as i32;
    if flat - cost_of(&low_bits, 0) < 20 * BIT + flat / 333 {
        return Ok(original);
    }

    let with_distance = commands.iter().filter(|c| c.has_distance_symbol());
    let largest = with_distance.map(|c| c.distance().code(&original)).max();
    let cost_with = |candidate: &DistanceParams| {
        let (mut counts, mut extra_bits) = ([0; DISTANCE_SYMBOLS], 0);
        for &code in &codes {
            let prefix = DistancePrefix::new(code as usize, candidate);
            counts[prefix.symbol()] += 1;
            extra_bits += prefix.extra_bits();
        }
        let size = (candidate.alphabet.size as usize).next_multiple_of(8);
        cost_of(&counts[..size], 100 / step as u32) + extra_bits as i32 * BIT
    };
    let mut best = (original, i32::MAX);
    let mut direct_msb = 0;
    for postfix_bits in 0..=MAX_POSTFIX_BITS {
        while direct_msb < 16 {
            let direct_codes = direct_msb << postfix_bits;
            let candidate = DistanceParams::new(postfix_bits, direct_codes, params.large_window);
            if largest > Some(candidate.max_distance) {
                break;
            }
            let cost = cost_with(&candidate);
            if cost > best.1 {
                break;
            }
            best = (candidate, cost);
            direct_msb += 1;
        }
        direct_msb = direct_msb.saturating_sub(1) / 2;
    }
    Ok(if cost_with(&original) < best.1 {
        original
    } else {
        best.0
    })
}
