//! Distributes the literals, commands and distances of a meta-block between block types and contexts.

use super::Fallible;
use super::bit_cost::{bits_entropy, population_cost};
use super::block_splitter::{BlockSplit, count_literals, split_block};
use super::cluster::cluster_histograms;
use super::command::{Command, prefix_encode_copy_distance};
use super::entropy_encode::optimize_huffman_counts_for_rle;
use super::histogram::{
    Histogram, HistogramCommand, HistogramDistance, HistogramLiteral, build_histograms_with_context,
};
use super::params::{DistanceParams, EncoderParams};
use crate::common::constants::{
    DISTANCE_CONTEXT_BITS, LITERAL_CONTEXT_BITS, MAX_NPOSTFIX, MAX_NUMBER_OF_BLOCK_TYPES,
    NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS,
};
use crate::common::context::{ContextLut, ContextType, context_lut};
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_zeroed};

pub(crate) const MAX_STATIC_CONTEXTS: usize = 13;

/// An empty context map stands for the one in which every block type has one histogram of its own.
pub(crate) struct MetaBlockSplit {
    pub(crate) literal_split: BlockSplit,
    pub(crate) command_split: BlockSplit,
    pub(crate) distance_split: BlockSplit,
    pub(crate) literal_context_map: Vec<u32>,
    pub(crate) distance_context_map: Vec<u32>,
    pub(crate) literal_histograms: Vec<HistogramLiteral>,
    pub(crate) command_histograms: Vec<HistogramCommand>,
    pub(crate) distance_histograms: Vec<HistogramDistance>,
}

fn same_distance_codes(a: &DistanceParams, b: &DistanceParams) -> bool {
    a.distance_postfix_bits == b.distance_postfix_bits
        && a.num_direct_distance_codes == b.num_direct_distance_codes
}

/// Encodes the distances of `cmds`, which are encoded for `orig_params`, for `new_params`.
fn recompute_distance_prefixes(
    cmds: &mut [Command],
    orig_params: &DistanceParams,
    new_params: &DistanceParams,
) {
    if same_distance_codes(orig_params, new_params) {
        return;
    }
    for cmd in cmds {
        if cmd.has_distance_symbol() {
            (cmd.dist_prefix, cmd.dist_extra) = prefix_encode_copy_distance(
                cmd.restore_distance_code(orig_params) as usize,
                new_params.num_direct_distance_codes as usize,
                new_params.distance_postfix_bits as usize,
            );
        }
    }
}

/// How many bits the distances of `cmds`, which are encoded for `orig_params`, take with `new_params`. `None` if one of
/// them is too large for `new_params`.
fn compute_distance_cost(
    cmds: &[Command],
    orig_params: &DistanceParams,
    new_params: &DistanceParams,
    tmp: &mut HistogramDistance,
) -> Checked<Option<f64>> {
    let equal_params = same_distance_codes(orig_params, new_params);
    let mut extra_bits = 0f64;
    tmp.clear();

    for cmd in cmds {
        if cmd.has_distance_symbol() {
            let dist_prefix = if equal_params {
                cmd.dist_prefix
            } else {
                let distance = cmd.restore_distance_code(orig_params) as usize;
                if distance > new_params.max_distance {
                    return Ok(None);
                }
                prefix_encode_copy_distance(
                    distance,
                    new_params.num_direct_distance_codes as usize,
                    new_params.distance_postfix_bits as usize,
                )
                .0
            };
            tmp.add(dist_prefix.symbol())?;
            extra_bits += f64::from(dist_prefix.num_extra_bits());
        }
    }

    Ok(Some(population_cost(tmp)? + extra_bits))
}

/// Splits with the slow shortest-path block splitter and clusters the contexts. Also picks the distance parameters that
/// suit `cmds` best, returns them and encodes the distances of `cmds`, which are encoded for `params.dist`, for them.
pub(crate) fn build_meta_block(
    ring_buffer: &[u8],
    pos: usize,
    mask: usize,
    params: &EncoderParams,
    prev_byte: u8,
    prev_byte2: u8,
    cmds: &mut [Command],
    literal_context_mode: ContextType,
) -> Fallible<(MetaBlockSplit, DistanceParams)> {
    let mut ndirect_msb = 0u32;
    let mut check_orig = true;
    let mut best_dist_cost = 1e99;
    let orig_params = params.dist;
    let mut best_params = orig_params;
    {
        let mut tmp = try_box(HistogramDistance::new())?;
        for npostfix in 0..=MAX_NPOSTFIX {
            while ndirect_msb < 16 {
                let ndirect = ndirect_msb << npostfix;
                let new_params = DistanceParams::new(npostfix, ndirect, params.large_window);
                if npostfix == orig_params.distance_postfix_bits
                    && ndirect == orig_params.num_direct_distance_codes
                {
                    check_orig = false;
                }
                let Some(dist_cost) =
                    compute_distance_cost(cmds, &orig_params, &new_params, &mut tmp)?
                else {
                    break;
                };
                if dist_cost > best_dist_cost {
                    break;
                }
                best_dist_cost = dist_cost;
                best_params = new_params;
                ndirect_msb += 1;
            }
            ndirect_msb = ndirect_msb.saturating_sub(1);
            ndirect_msb /= 2;
        }
        if check_orig {
            let dist_cost =
                compute_distance_cost(cmds, &orig_params, &orig_params, &mut tmp)?.ok_or(Bug)?;
            if dist_cost < best_dist_cost {
                best_params = orig_params;
            }
        }
    }
    recompute_distance_prefixes(cmds, &orig_params, &best_params);

    let (literal_split, command_split, distance_split) =
        split_block(cmds, ring_buffer, pos, mask, params.quality)?;

    let mut literal_context_multiplier = 1usize;
    let mut literal_context_lut = None;
    if !params.disable_literal_context_modeling {
        literal_context_multiplier = 1 << LITERAL_CONTEXT_BITS;
        literal_context_lut = Some(context_lut(literal_context_mode));
    }

    // One histogram for each block type and context, to be clustered.
    let literal_histograms_size = literal_split.num_types * literal_context_multiplier;
    let mut all_literal_histograms = try_vec(HistogramLiteral::new(), literal_histograms_size)?;

    let distance_histograms_size = distance_split.num_types << DISTANCE_CONTEXT_BITS;
    let mut all_distance_histograms = try_vec(HistogramDistance::new(), distance_histograms_size)?;

    let mut command_histograms = try_vec(HistogramCommand::new(), command_split.num_types)?;

    build_histograms_with_context(
        cmds,
        &literal_split,
        &command_split,
        &distance_split,
        ring_buffer,
        pos,
        mask,
        prev_byte,
        prev_byte2,
        literal_context_lut,
        &mut all_literal_histograms,
        &mut command_histograms,
        &mut all_distance_histograms,
    )?;

    let mut literal_context_map = try_zeroed(literal_split.num_types << LITERAL_CONTEXT_BITS)?;
    let literal_histograms = cluster_histograms(&all_literal_histograms, &mut literal_context_map)?;
    drop(all_literal_histograms);

    if params.disable_literal_context_modeling {
        // So far there is one entry for each block type. Give all the contexts of the type that entry.
        for i in (0..literal_split.num_types).rev() {
            let histogram = literal_context_map.at(i)?;
            literal_context_map
                .sub_mut(i << LITERAL_CONTEXT_BITS..(i + 1) << LITERAL_CONTEXT_BITS)?
                .fill(histogram);
        }
    }

    let mut distance_context_map = try_zeroed(distance_histograms_size)?;
    let distance_histograms =
        cluster_histograms(&all_distance_histograms, &mut distance_context_map)?;
    Ok((
        MetaBlockSplit {
            literal_split,
            command_split,
            distance_split,
            literal_context_map,
            distance_context_map,
            literal_histograms,
            command_histograms,
            distance_histograms,
        },
        best_params,
    ))
}

/// Greedy block splitter for one category: literals, commands or distances. Every block type has a histogram for each of
/// `num_contexts` contexts.
struct GreedyBlockSplitter<const N: usize> {
    /// How many of the `N` symbols count for the entropy.
    alphabet_size: usize,
    num_contexts: usize,
    max_block_types: usize,
    /// A block has at least this many symbols.
    min_block_size: usize,
    /// Histograms A and B are merged if `entropy(A + B) < entropy(A) + entropy(B) + split_threshold`, where A is the
    /// current histogram and B that of the last or of the second last block type. With contexts, these are sums.
    split_threshold: f64,
    split: BlockSplit,
    /// `num_contexts` for each block type, and as many for the current block.
    histograms: Vec<Histogram<N>>,
    /// Scratch space for [`Self::finish_block`]: `num_contexts` for each of the last two block types.
    combined_histograms: Vec<Histogram<N>>,
    /// After this many symbols it is decided whether to merge the block with an earlier one.
    target_block_size: usize,
    /// How many symbols the current histograms have.
    block_size: usize,
    /// The first of the current histograms.
    curr_histogram_ix: usize,
    /// The first histogram of each of the last two block types.
    last_histogram_ix: [usize; 2],
    /// The entropies of the last block type, followed by those of the second last at `num_contexts`.
    last_entropy: [f64; 2 * MAX_STATIC_CONTEXTS],
    /// How many times in a row the current block was merged with the last one.
    merge_last_count: usize,
}

impl<const N: usize> GreedyBlockSplitter<N> {
    fn new(
        alphabet_size: usize,
        num_contexts: usize,
        min_block_size: usize,
        split_threshold: f64,
        num_symbols: usize,
    ) -> Fallible<Self> {
        if num_contexts > MAX_STATIC_CONTEXTS {
            return Err(Bug.into());
        }
        let max_num_blocks = num_symbols.checked_div(min_block_size).ok_or(Bug)? + 1;
        let max_block_types = MAX_NUMBER_OF_BLOCK_TYPES
            .checked_div(num_contexts)
            .ok_or(Bug)?;
        // One more than there can be block types, for the current histograms of a meta-block that has them all.
        let max_num_types = max_num_blocks.min(max_block_types + 1);
        Ok(Self {
            alphabet_size,
            num_contexts,
            max_block_types,
            min_block_size,
            split_threshold,
            split: BlockSplit::with_capacity(max_num_blocks)?,
            histograms: try_vec(Histogram::new(), max_num_types * num_contexts)?,
            combined_histograms: try_vec(Histogram::new(), 2 * num_contexts)?,
            target_block_size: min_block_size,
            block_size: 0,
            curr_histogram_ix: 0,
            last_histogram_ix: [0; 2],
            last_entropy: [0.0; 2 * MAX_STATIC_CONTEXTS],
            merge_last_count: 0,
        })
    }

    /// Does one of three things with the current block: gives it a new block type, gives it the type of the second last
    /// block, or merges it with the last block.
    fn finish_block(&mut self) -> Checked {
        let num_contexts = self.num_contexts;
        // The reference encoder does this for the last block as well, which can be shorter or even empty, and the block
        // lengths in the output depend on it.
        self.block_size = self.block_size.max(self.min_block_size);
        if self.split.types.is_empty() {
            self.split.push(0, self.block_size as u32)?;
            for i in 0..num_contexts {
                let histogram = self.histograms.get(i).ok_or(Bug)?;
                let entropy = bits_entropy(histogram.data.sub(..self.alphabet_size)?);
                self.last_entropy.put(i, entropy)?;
                self.last_entropy.put(num_contexts + i, entropy)?;
            }
            self.split.num_types += 1;
            self.curr_histogram_ix += num_contexts;
            self.block_size = 0;
            return Ok(());
        }

        // Whether to merge is decided by the total change of entropy over all contexts.
        let mut entropy = [0f64; MAX_STATIC_CONTEXTS];
        let mut combined_entropy = [0f64; 2 * MAX_STATIC_CONTEXTS];
        let mut diff = [0f64; 2];
        for i in 0..num_contexts {
            let curr_histogram = self.histograms.get(self.curr_histogram_ix + i).ok_or(Bug)?;
            let curr_entropy = bits_entropy(curr_histogram.data.sub(..self.alphabet_size)?);
            entropy.put(i, curr_entropy)?;
            for j in 0..2 {
                let jx = j * num_contexts + i;
                let last_histogram_ix = self.last_histogram_ix.at(j)? + i;
                let combined_histogram = self.combined_histograms.at_mut(jx)?;
                combined_histogram.copy_from(curr_histogram);
                combined_histogram
                    .add_histogram(self.histograms.get(last_histogram_ix).ok_or(Bug)?);
                let combined = bits_entropy(combined_histogram.data.sub(..self.alphabet_size)?);
                combined_entropy.put(jx, combined)?;
                *diff.at_mut(j)? += combined - curr_entropy - self.last_entropy.at(jx)?;
            }
        }

        if self.split.num_types < self.max_block_types
            && diff[0] > self.split_threshold
            && diff[1] > self.split_threshold
        {
            // A new block type. The histograms after the current ones are still empty.
            self.split
                .push(self.split.num_types as u8, self.block_size as u32)?;
            self.last_histogram_ix[1] = self.last_histogram_ix[0];
            self.last_histogram_ix[0] = self.split.num_types * num_contexts;
            for i in 0..num_contexts {
                let last_entropy = self.last_entropy.at(i)?;
                self.last_entropy.put(num_contexts + i, last_entropy)?;
                self.last_entropy.put(i, entropy.at(i)?)?;
            }
            self.split.num_types += 1;
            self.curr_histogram_ix += num_contexts;
            self.block_size = 0;
            self.merge_last_count = 0;
            self.target_block_size = self.min_block_size;
        } else if diff[1] < diff[0] - 20.0 {
            // The type of the second last block.
            let num_blocks = self.split.types.len();
            let second_last_type = self.split.types.at(num_blocks.wrapping_sub(2))?;
            self.split.push(second_last_type, self.block_size as u32)?;
            self.last_histogram_ix.swap(0, 1);
            for i in 0..num_contexts {
                self.histograms
                    .at_mut(self.last_histogram_ix[0] + i)?
                    .copy_from(self.combined_histograms.get(num_contexts + i).ok_or(Bug)?);
                let last_entropy = self.last_entropy.at(i)?;
                self.last_entropy.put(num_contexts + i, last_entropy)?;
                self.last_entropy
                    .put(i, combined_entropy.at(num_contexts + i)?)?;
                self.histograms.at_mut(self.curr_histogram_ix + i)?.clear();
            }
            self.block_size = 0;
            self.merge_last_count = 0;
            self.target_block_size = self.min_block_size;
        } else {
            // Merge with the last block.
            *self.split.lengths.last_mut().ok_or(Bug)? += self.block_size as u32;
            for i in 0..num_contexts {
                self.histograms
                    .at_mut(self.last_histogram_ix[0] + i)?
                    .copy_from(self.combined_histograms.get(i).ok_or(Bug)?);
                let combined = combined_entropy.at(i)?;
                self.last_entropy.put(i, combined)?;
                if self.split.num_types == 1 {
                    self.last_entropy.put(num_contexts + i, combined)?;
                }
                self.histograms.at_mut(self.curr_histogram_ix + i)?.clear();
            }
            self.block_size = 0;
            self.merge_last_count += 1;
            if self.merge_last_count > 1 {
                self.target_block_size += self.min_block_size;
            }
        }
        Ok(())
    }

    /// Adds `symbol` to the current block, and ends the block when it has reached its target size.
    #[inline(always)]
    fn add_symbol(&mut self, symbol: usize, context: usize) -> Checked {
        self.histograms
            .at_mut(self.curr_histogram_ix + context)?
            .add(symbol)?;
        self.block_size += 1;
        if self.block_size == self.target_block_size {
            self.finish_block()?;
        }
        Ok(())
    }

    /// Ends the last block. Returns the blocks and the histograms of the block types.
    fn finish(mut self) -> Checked<(BlockSplit, Vec<Histogram<N>>)> {
        self.finish_block()?;
        self.histograms
            .truncate(self.split.num_types * self.num_contexts);
        Ok((self.split, self.histograms))
    }
}

/// What maps the context IDs of the literals to fewer contexts.
pub(crate) type StaticContextMap = [u32; 1 << LITERAL_CONTEXT_BITS];

/// Makes the context map that uses `static_context_map` for each of `num_block_types`.
fn map_static_contexts(
    num_contexts: usize,
    static_context_map: &StaticContextMap,
    num_block_types: usize,
) -> Fallible<Vec<u32>> {
    let mut context_map = try_zeroed(num_block_types << LITERAL_CONTEXT_BITS)?;
    let (block_types, _) = context_map.as_chunks_mut::<{ 1 << LITERAL_CONTEXT_BITS }>();
    for (i, contexts) in block_types.iter_mut().enumerate() {
        let offset = (i * num_contexts) as u32;
        for (context, &static_context) in contexts.iter_mut().zip(static_context_map) {
            *context = offset + static_context;
        }
    }
    Ok(context_map)
}

/// [`build_meta_block_greedy`] without the context map. `literal_context` maps the two bytes before a literal, the last
/// one first, to one of `num_contexts`.
fn split_greedily(
    ring_buffer: &[u8],
    mut pos: usize,
    mask: usize,
    mut prev_byte: u8,
    mut prev_byte2: u8,
    num_contexts: usize,
    literal_context: impl Fn(u8, u8) -> Checked<usize>,
    commands: &[Command],
) -> Fallible<MetaBlockSplit> {
    let mut literal_blocks = GreedyBlockSplitter::new(
        NUM_LITERAL_SYMBOLS,
        num_contexts,
        512,
        400.0,
        count_literals(commands),
    )?;
    let mut command_blocks =
        GreedyBlockSplitter::new(NUM_COMMAND_SYMBOLS, 1, 1024, 500.0, commands.len())?;
    let mut distance_blocks = GreedyBlockSplitter::new(64, 1, 512, 100.0, commands.len())?;

    for cmd in commands {
        command_blocks.add_symbol(usize::from(cmd.cmd_prefix), 0)?;
        for _ in 0..cmd.insert_len {
            let literal = ring_buffer.at(pos & mask)?;
            literal_blocks.add_symbol(
                usize::from(literal),
                literal_context(prev_byte, prev_byte2)?,
            )?;
            prev_byte2 = prev_byte;
            prev_byte = literal;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.copy_len() != 0 {
            prev_byte2 = ring_buffer.at(pos.wrapping_sub(2) & mask)?;
            prev_byte = ring_buffer.at(pos.wrapping_sub(1) & mask)?;
            if cmd.has_distance_symbol() {
                distance_blocks.add_symbol(cmd.dist_prefix.symbol(), 0)?;
            }
        }
    }

    let (literal_split, literal_histograms) = literal_blocks.finish()?;
    let (command_split, command_histograms) = command_blocks.finish()?;
    let (distance_split, distance_histograms) = distance_blocks.finish()?;
    Ok(MetaBlockSplit {
        literal_split,
        command_split,
        distance_split,
        literal_context_map: Vec::new(),
        distance_context_map: Vec::new(),
        literal_histograms,
        command_histograms,
        distance_histograms,
    })
}

/// Splits with a fast greedy block splitter, which tries to merge a block with the last or the second last one. With
/// more than one context, `static_context_map` maps the literal contexts to `num_contexts` histograms, in the same way
/// for all block types.
pub(crate) fn build_meta_block_greedy(
    ring_buffer: &[u8],
    pos: usize,
    mask: usize,
    prev_byte: u8,
    prev_byte2: u8,
    literal_context_lut: &ContextLut,
    num_contexts: usize,
    static_context_map: Option<&StaticContextMap>,
    commands: &[Command],
) -> Fallible<MetaBlockSplit> {
    if num_contexts == 1 {
        return split_greedily(
            ring_buffer,
            pos,
            mask,
            prev_byte,
            prev_byte2,
            1,
            |_, _| Ok(0),
            commands,
        );
    }
    let static_context_map = static_context_map.ok_or(Bug)?;
    let mut mb = split_greedily(
        ring_buffer,
        pos,
        mask,
        prev_byte,
        prev_byte2,
        num_contexts,
        |prev_byte, prev_byte2| {
            let context = usize::from(literal_context_lut.context(prev_byte, prev_byte2));
            Ok(static_context_map.at(context)? as usize)
        },
        commands,
    )?;
    mb.literal_context_map =
        map_static_contexts(num_contexts, static_context_map, mb.literal_split.num_types)?;
    Ok(mb)
}

/// Changes the histograms so that their prefix codes take less room. `num_distance_codes` is how many distance symbols
/// are in use.
pub(crate) fn optimize_histograms(num_distance_codes: u32, mb: &mut MetaBlockSplit) -> Checked {
    for histogram in &mut mb.literal_histograms {
        optimize_huffman_counts_for_rle(&mut histogram.data)?;
    }
    for histogram in &mut mb.command_histograms {
        optimize_huffman_counts_for_rle(&mut histogram.data)?;
    }
    for histogram in &mut mb.distance_histograms {
        optimize_huffman_counts_for_rle(histogram.data.sub_mut(..num_distance_codes as usize)?)?;
    }
    Ok(())
}
