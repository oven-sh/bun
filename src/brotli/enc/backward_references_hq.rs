//! Backward references for qualities 10 and 11: the cheapest sequence of commands for a block, under a model of what
//! each symbol costs.

use super::Fallible;
use super::command::{
    Command, combine_length_codes, get_copy_extra, get_copy_length_code, get_insert_extra,
    get_insert_length_code, prefix_encode_copy_distance,
};
use super::fast_log::fast_log2;
use super::find_match_length::find_match_length_with_limit;
use super::hash::{
    BackwardMatch, H10, Hasher, MAX_NUM_MATCHES_H10, lookup_all_compound_dictionary_matches,
};
use super::literal_cost::estimate_bit_costs_for_literals;
use super::params::{DistanceParams, EncoderParams};
use super::quality::LONG_COPY_QUICK_STEP;
use crate::common::constants::{
    NUM_COMMAND_SYMBOLS, NUM_DISTANCE_SHORT_CODES, NUM_LITERAL_SYMBOLS, max_backward_limit,
};
use crate::common::context::ContextLut;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec, try_zeroed};

/// `calculate_distance_code_limit(MAX_ALLOWED_DISTANCE, 3, 120).max_alphabet_size`.
const MAX_EFFECTIVE_DISTANCE_ALPHABET_SIZE: usize = 544;

/// About 2^127.
const INFINITY: f32 = 1.7e38;

/// How many bytes [`H10`] hashes.
const HASH_TYPE_LENGTH_H10: usize = 4;
/// How many bytes [`H10`] looks at when a position is added to it.
const STORE_LOOKAHEAD_H10: usize = 128;

const MAX_NUM_COMPOUND_DICTIONARY_MATCHES: usize = 64;

/// The best command found that ends just before a byte of the block.
///
/// For each node `i > 0` with a cost below [`INFINITY`], the copy length is at least 2, the command length is at most
/// `i`, and the cost of the node at `i` less the command length is below [`INFINITY`] too.
#[derive(Clone, Copy)]
struct ZopfliNode {
    /// The copy length in the low 25 bits. In the high 7, 9 plus the copy length less the length code.
    length: u32,
    /// The distance of the copy.
    distance: u32,
    /// The number of literals before the copy in the low 27 bits. In the high 5, the distance short code + 1, or 0 if
    /// there is none.
    dcode_insert_length: u32,
    /// Three values in turn:
    /// - until the forward pass gets here, the bits of the `f32` cost of getting here from the start of the block;
    /// - then the "shortcut": the last node on the way here whose command changes the last distances;
    /// - for the nodes on the path chosen, the length of the next command, or `u32::MAX` at the end.
    u: u32,
}

impl ZopfliNode {
    const INIT: Self = Self {
        length: 1,
        distance: 0,
        dcode_insert_length: 0,
        u: INFINITY.to_bits(),
    };

    #[inline(always)]
    fn cost(&self) -> f32 {
        f32::from_bits(self.u)
    }

    #[inline(always)]
    fn copy_length(&self) -> u32 {
        self.length & 0x1FF_FFFF
    }

    #[inline(always)]
    fn length_code(&self) -> u32 {
        let modifier = self.length >> 25;
        (self.copy_length() + 9).wrapping_sub(modifier)
    }

    #[inline(always)]
    fn insert_length(&self) -> u32 {
        self.dcode_insert_length & 0x7FF_FFFF
    }

    #[inline(always)]
    fn distance_code(&self) -> u32 {
        let short_code = self.dcode_insert_length >> 27;
        if short_code == 0 {
            self.distance.wrapping_add(NUM_DISTANCE_SHORT_CODES - 1)
        } else {
            short_code - 1
        }
    }

    #[inline(always)]
    fn command_length(&self) -> u32 {
        self.copy_length() + self.insert_length()
    }
}

/// What each symbol costs, in bits.
struct ZopfliCostModel {
    /// For the insert and copy length symbols.
    cost_cmd: [f32; NUM_COMMAND_SYMBOLS],
    cost_dist: Vec<f32>,
    /// `literal_costs[i]` is the cost of the first `i` bytes of the block as literals.
    literal_costs: Vec<f32>,
    min_cost_cmd: f32,
    num_bytes: usize,
}

/// Sets `cost` to the entropy of each symbol of `histogram`.
fn set_cost(histogram: &[u32], literal_histogram: bool, cost: &mut [f32]) {
    let sum: usize = histogram.iter().map(|&count| count as usize).sum();
    let log2sum = fast_log2(sum) as f32;
    let mut missing_symbol_sum = sum;
    if !literal_histogram {
        missing_symbol_sum += histogram.iter().filter(|&&count| count == 0).count();
    }
    let missing_symbol_cost = fast_log2(missing_symbol_sum) as f32 + 2.0;
    for (cost, &count) in cost.iter_mut().zip(histogram) {
        if count == 0 {
            *cost = missing_symbol_cost;
            continue;
        }
        *cost = log2sum - fast_log2(count as usize) as f32;
        // No symbol takes less than a bit.
        if *cost < 1.0 {
            *cost = 1.0;
        }
    }
}

impl ZopfliCostModel {
    fn new(dist: &DistanceParams, num_bytes: usize) -> Result<Self, OutOfMemory> {
        Ok(Self {
            cost_cmd: [0.0; NUM_COMMAND_SYMBOLS],
            cost_dist: try_zeroed(dist.alphabet_size_limit as usize)?,
            literal_costs: try_zeroed(num_bytes + 2)?,
            min_cost_cmd: 0.0,
            num_bytes,
        })
    }

    /// Turns the cost of each literal, as `cost_at` gives it for `self.literal_costs` and an index in the block, into
    /// running totals. The rounding errors are carried along.
    #[inline(always)]
    fn accumulate_literal_costs(
        &mut self,
        mut cost_at: impl FnMut(&[f32], usize) -> Checked<f32>,
    ) -> Checked {
        let mut literal_carry = 0f32;
        let mut total = 0f32;
        self.literal_costs.put(0, 0.0)?;
        for i in 0..self.num_bytes {
            literal_carry += cost_at(&self.literal_costs, i)?;
            let next = total + literal_carry;
            self.literal_costs.put(i + 1, next)?;
            literal_carry -= next - total;
            total = next;
        }
        Ok(())
    }

    /// Takes the statistics of `commands`, which start `last_insert_len` bytes before `position`.
    fn set_from_commands(
        &mut self,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
        commands: &[Command],
        last_insert_len: usize,
    ) -> Checked {
        let mut histogram_literal = [0u32; NUM_LITERAL_SYMBOLS];
        let mut histogram_cmd = [0u32; NUM_COMMAND_SYMBOLS];
        let mut histogram_dist = [0u32; MAX_EFFECTIVE_DISTANCE_ALPHABET_SIZE];
        let mut cost_literal = [0f32; NUM_LITERAL_SYMBOLS];
        let mut pos = position.wrapping_sub(last_insert_len);

        for command in commands {
            let inslength = command.insert_len as usize;
            let copylength = command.copy_len() as usize;
            let distcode = usize::from(command.dist_prefix & 0x3FF);
            let cmdcode = usize::from(command.cmd_prefix);

            *histogram_cmd.at_mut(cmdcode)? += 1;
            if cmdcode >= 128 {
                *histogram_dist.at_mut(distcode)? += 1;
            }
            for j in 0..inslength {
                let literal = ringbuffer.at(pos.wrapping_add(j) & ringbuffer_mask)?;
                *histogram_literal.at_mut(usize::from(literal))? += 1;
            }
            pos = pos.wrapping_add(inslength + copylength);
        }

        set_cost(&histogram_literal, true, &mut cost_literal);
        set_cost(&histogram_cmd, false, &mut self.cost_cmd);
        set_cost(
            histogram_dist.sub(..self.cost_dist.len())?,
            false,
            &mut self.cost_dist,
        );

        self.min_cost_cmd = self
            .cost_cmd
            .iter()
            .fold(INFINITY, |min, &cost| if min < cost { min } else { cost });

        self.accumulate_literal_costs(|_, i| {
            cost_literal.at(usize::from(
                ringbuffer.at((position + i) & ringbuffer_mask)?,
            ))
        })
    }

    /// Estimates the cost of a literal from the bytes around it. The other symbols cost more the higher they are.
    fn set_from_literal_costs(
        &mut self,
        position: usize,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
    ) -> Checked {
        let mut literal_histograms = [0usize; 3 * 256];
        estimate_bit_costs_for_literals(
            position,
            self.num_bytes,
            ringbuffer_mask,
            ringbuffer,
            &mut literal_histograms,
            self.literal_costs.sub_mut(1..)?,
        )?;
        self.accumulate_literal_costs(|literal_costs, i| literal_costs.at(i + 1))?;
        for (i, cost) in self.cost_cmd.iter_mut().enumerate() {
            *cost = fast_log2(11 + i) as f32;
        }
        for (i, cost) in self.cost_dist.iter_mut().enumerate() {
            *cost = fast_log2(20 + i) as f32;
        }
        self.min_cost_cmd = fast_log2(11) as f32;
        Ok(())
    }

    #[inline(always)]
    fn command_cost(&self, cmdcode: u16) -> Checked<f32> {
        self.cost_cmd.at(usize::from(cmdcode))
    }

    #[inline(always)]
    fn distance_cost(&self, distcode: usize) -> Checked<f32> {
        self.cost_dist.at(distcode)
    }

    /// The cost of the bytes `from..to` of the block as literals.
    #[inline(always)]
    fn literal_costs(&self, from: usize, to: usize) -> Checked<f32> {
        Ok(self.literal_costs.at(to)? - self.literal_costs.at(from)?)
    }
}

/// Makes a copy of `len` bytes, after the literals from `start_pos` to `pos`, the command that ends at `pos + len`.
/// `len` is at least 2, and `cost` and the cost of the node at `start_pos` are below [`INFINITY`].
#[inline(always)]
fn update_zopfli_node(
    nodes: &mut [ZopfliNode],
    pos: usize,
    start_pos: usize,
    len: usize,
    len_code: usize,
    dist: usize,
    short_code: usize,
    cost: f32,
) -> Checked {
    nodes.put(
        pos + len,
        ZopfliNode {
            length: (len | ((len + 9).wrapping_sub(len_code) << 25)) as u32,
            distance: dist as u32,
            dcode_insert_length: ((short_code << 27) | (pos - start_pos)) as u32,
            u: cost.to_bits(),
        },
    )
}

/// A position at which a command may start.
#[derive(Clone, Copy, Default)]
struct PosData {
    pos: usize,
    /// The last distances there.
    distance_cache: [i32; 4],
    /// `cost` less the cost of getting there with literals alone.
    costdiff: f32,
    cost: f32,
}

/// Up to 8 positions, by increasing `costdiff`.
#[derive(Default)]
struct StartPosQueue {
    /// A ring buffer. The smallest `costdiff` is at `-idx & 7`.
    q: [PosData; 8],
    /// How many were pushed.
    idx: usize,
}

impl StartPosQueue {
    #[inline(always)]
    fn size(&self) -> usize {
        self.idx.min(8)
    }

    /// When the queue is full, `posdata` replaces the one with the largest `costdiff`.
    fn push(&mut self, posdata: PosData) -> Checked {
        let offset = !self.idx & 7;
        self.idx += 1;
        let len = self.size();
        self.q.put(offset, posdata)?;
        // Restore the order. One pass is enough, since only the new item is out of place.
        for offset in offset..offset + len - 1 {
            if self.q.at(offset & 7)?.costdiff > self.q.at((offset + 1) & 7)?.costdiff {
                self.q.swap(offset & 7, (offset + 1) & 7);
            }
        }
        Ok(())
    }

    /// The one with the `k`th smallest `costdiff`.
    #[inline(always)]
    fn at(&self, k: usize) -> Checked<&PosData> {
        self.q.get(k.wrapping_sub(self.idx) & 7).ok_or(Bug)
    }
}

/// The shortest copy at `pos` that can lower the cost of a later node, if a command costs `start_cost` at least.
fn compute_minimum_copy_length(
    start_cost: f32,
    nodes: &[ZopfliNode],
    num_bytes: usize,
    pos: usize,
) -> Checked<usize> {
    let mut min_cost = start_cost;
    let mut len = 2usize;
    let mut next_len_bucket = 4usize;
    let mut next_len_offset = 10usize;
    while pos + len <= num_bytes && nodes.at(pos + len)?.cost() <= min_cost {
        // `pos + len` was already reached for no more than the least that it takes from here.
        len += 1;
        if len == next_len_offset {
            // From here on the copy length code has one more extra bit.
            min_cost += 1.0;
            next_len_offset += next_len_bucket;
            next_len_bucket *= 2;
        }
    }
    Ok(len)
}

/// The shortcut of the node at `pos`, given those of the nodes before it.
fn compute_distance_shortcut(
    block_start: usize,
    pos: usize,
    max_backward_limit: usize,
    gap: usize,
    nodes: &[ZopfliNode],
) -> Checked<u32> {
    let node = nodes.at(pos)?;
    let c_len = node.copy_length() as usize;
    let i_len = node.insert_length() as usize;
    let dist = node.distance as usize;
    // The copy starts at `block_start + pos - c_len`. A distance that reaches further back than that, or than the
    // window, refers to the static dictionary. Neither that nor distance code 0 changes the last distances.
    if pos == 0 {
        Ok(0)
    } else if dist + c_len <= block_start + pos + gap
        && dist <= max_backward_limit + gap
        && node.distance_code() > 0
    {
        Ok(pos as u32)
    } else {
        Ok(nodes.at(pos.wrapping_sub(c_len).wrapping_sub(i_len))?.u)
    }
}

/// The last four distances at `pos`, if the best commands found are used to get there. `starting_dist_cache` has those
/// at the start of the block.
fn compute_distance_cache(
    pos: usize,
    starting_dist_cache: &[i32],
    nodes: &[ZopfliNode],
) -> Checked<[i32; 4]> {
    let mut dist_cache = [0i32; 4];
    let mut idx = 0usize;
    let mut p = nodes.at(pos)?.u as usize;
    while idx < 4 && p > 0 {
        let node = nodes.at(p)?;
        dist_cache.put(idx, node.distance as i32)?;
        idx += 1;
        p = nodes
            .at(p
                .wrapping_sub(node.copy_length() as usize)
                .wrapping_sub(node.insert_length() as usize))?
            .u as usize;
    }
    for (dist, &starting_dist) in dist_cache.iter_mut().skip(idx).zip(starting_dist_cache) {
        *dist = starting_dist;
    }
    Ok(dist_cache)
}

/// Replaces the cost of the node at `pos` by its shortcut, and adds it to the queue if it is worth starting a command
/// there.
fn evaluate_node(
    block_start: usize,
    pos: usize,
    max_backward_limit: usize,
    gap: usize,
    starting_dist_cache: &[i32],
    model: &ZopfliCostModel,
    queue: &mut StartPosQueue,
    nodes: &mut [ZopfliNode],
) -> Checked {
    let node_cost = nodes.at(pos)?.cost();
    nodes.at_mut(pos)?.u =
        compute_distance_shortcut(block_start, pos, max_backward_limit, gap, nodes)?;
    if node_cost <= model.literal_costs(0, pos)? {
        queue.push(PosData {
            pos,
            cost: node_cost,
            costdiff: node_cost - model.literal_costs(0, pos)?,
            distance_cache: compute_distance_cache(pos, starting_dist_cache, nodes)?,
        })?;
    }
    Ok(())
}

/// 4. The distance that each short code stands for. A negative one comes out as a huge one.
#[inline(always)]
fn short_code_distances(distance_cache: &[i32; 4]) -> [usize; NUM_DISTANCE_SHORT_CODES as usize] {
    let [last, second, third, fourth] = *distance_cache;
    [
        last,
        second,
        third,
        fourth,
        last.wrapping_sub(1),
        last.wrapping_add(1),
        last.wrapping_sub(2),
        last.wrapping_add(2),
        last.wrapping_sub(3),
        last.wrapping_add(3),
        second.wrapping_sub(1),
        second.wrapping_add(1),
        second.wrapping_sub(2),
        second.wrapping_add(2),
        second.wrapping_sub(3),
        second.wrapping_add(3),
    ]
    .map(|distance| distance as usize)
}

/// Tries the commands whose copy starts at `pos`. `matches` has what can be copied, by increasing length. Returns the
/// length of the longest copy that lowered the cost of a node.
fn update_nodes(
    num_bytes: usize,
    block_start: usize,
    pos: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &EncoderParams,
    max_backward_limit: usize,
    starting_dist_cache: &[i32],
    matches: &[BackwardMatch],
    model: &ZopfliCostModel,
    queue: &mut StartPosQueue,
    nodes: &mut [ZopfliNode],
) -> Checked<usize> {
    let stream_offset = params.stream_offset;
    let cur_ix = block_start + pos;
    let cur_ix_masked = cur_ix & ringbuffer_mask;
    let max_distance = cur_ix.min(max_backward_limit);
    let dictionary_start = (cur_ix + stream_offset).min(max_backward_limit);
    let max_len = num_bytes - pos;
    let max_zopfli_len = params.max_zopfli_len();
    let max_iters = params.max_zopfli_candidates();
    let addon = &params.dictionary;
    let gap = addon.total_size;
    let mut result = 0usize;

    let current = ringbuffer.sub(cur_ix_masked..)?;

    evaluate_node(
        block_start + stream_offset,
        pos,
        max_backward_limit,
        gap,
        starting_dist_cache,
        model,
        queue,
        nodes,
    )?;

    let min_len = {
        let posdata = queue.at(0)?;
        let min_cost = posdata.cost + model.min_cost_cmd + model.literal_costs(posdata.pos, pos)?;
        compute_minimum_copy_length(min_cost, nodes, num_bytes, pos)?
    };

    // The positions at which the command may start, the most promising one first.
    for k in 0..max_iters.min(queue.size()) {
        let posdata = queue.at(k)?;
        let start = posdata.pos;
        let inscode = get_insert_length_code(pos - start);
        let start_costdiff = posdata.costdiff;
        let base_cost =
            start_costdiff + get_insert_extra(inscode)? as f32 + model.literal_costs(0, pos)?;

        // The distances that have a short code at that position.
        let mut best_len = min_len - 1;
        for (j, &backward) in short_code_distances(&posdata.distance_cache)
            .iter()
            .enumerate()
        {
            if best_len >= max_len {
                break;
            }
            let mut prev_ix = cur_ix.wrapping_sub(backward);
            if cur_ix_masked + best_len > ringbuffer_mask {
                break;
            }
            let continuation = current.at(best_len)?;
            if backward > dictionary_start + gap {
                // That is in the static dictionary.
                continue;
            }
            let len = if backward <= max_distance {
                if prev_ix >= cur_ix {
                    continue;
                }
                prev_ix &= ringbuffer_mask;
                if prev_ix + best_len > ringbuffer_mask
                    || continuation != ringbuffer.at(prev_ix + best_len)?
                {
                    continue;
                }
                find_match_length_with_limit(ringbuffer.sub(prev_ix..)?, current, max_len)
            } else if backward > dictionary_start {
                // That is in the compound dictionary.
                let mut d = 0usize;
                let mut offset = dictionary_start + 1 + addon.total_size - 1;
                while offset >= backward + addon.chunk_offsets.at(d + 1)? {
                    d += 1;
                }
                let source = &addon.chunks.get(d).ok_or(Bug)?.source;
                offset = offset - addon.chunk_offsets.at(d)? - backward;
                let limit = (addon.chunk_offsets.at(d + 1)? - addon.chunk_offsets.at(d)? - offset)
                    .min(max_len);
                if best_len >= limit || continuation != source.at(offset + best_len)? {
                    continue;
                }
                find_match_length_with_limit(source.sub(offset..)?, current, limit)
            } else {
                // A decoder has those bytes, but they came before the part of the stream that this encoder has seen.
                continue;
            };
            let dist_cost = base_cost + model.distance_cost(j)?;
            for l in best_len + 1..=len {
                let copycode = get_copy_length_code(l);
                let cmdcode = combine_length_codes(inscode, copycode, j == 0);
                let cost = (if cmdcode < 128 { base_cost } else { dist_cost })
                    + get_copy_extra(copycode)? as f32
                    + model.command_cost(cmdcode)?;
                if cost < nodes.at(pos + l)?.cost() {
                    update_zopfli_node(nodes, pos, start, l, l, backward, j + 1, cost)?;
                    result = result.max(l);
                }
                best_len = l;
            }
        }

        // For the other positions only the last distances are worth a try: they differ, `matches` does not.
        if k >= 2 {
            continue;
        }

        let mut len = min_len;
        for m in matches {
            let dist = m.distance as usize;
            let is_dictionary_match = dist > dictionary_start + gap;
            // The last distances were tried already, so this does not look for a short code.
            let dist_code = dist + NUM_DISTANCE_SHORT_CODES as usize - 1;
            let (dist_symbol, _) = prefix_encode_copy_distance(
                dist_code,
                params.dist.num_direct_distance_codes as usize,
                params.dist.distance_postfix_bits as usize,
            );
            let distnumextra = dist_symbol >> 10;
            let dist_cost = base_cost
                + f32::from(distnumextra)
                + model.distance_cost(usize::from(dist_symbol & 0x3FF))?;

            // All the lengths up to that of the match, or only that one for a dictionary word and for a long match.
            let max_match_len = m.length();
            if len < max_match_len && (is_dictionary_match || max_match_len > max_zopfli_len) {
                len = max_match_len;
            }
            while len <= max_match_len {
                let len_code = if is_dictionary_match {
                    m.length_code()
                } else {
                    len
                };
                let copycode = get_copy_length_code(len_code);
                let cmdcode = combine_length_codes(inscode, copycode, false);
                let cost =
                    dist_cost + get_copy_extra(copycode)? as f32 + model.command_cost(cmdcode)?;
                if cost < nodes.at(pos + len)?.cost() {
                    update_zopfli_node(nodes, pos, start, len, len_code, dist, 0, cost)?;
                    result = result.max(len);
                }
                len += 1;
            }
        }
    }
    Ok(result)
}

/// Links the nodes of the best path from its end to its start. Returns the number of commands on it.
fn compute_shortest_path_from_nodes(num_bytes: usize, nodes: &mut [ZopfliNode]) -> Checked<usize> {
    let mut index = num_bytes;
    let mut num_commands = 0usize;
    // The block ends with the bytes that no command reaches.
    loop {
        let node = nodes.at(index)?;
        if node.insert_length() != 0 || node.length != 1 {
            break;
        }
        index = index.wrapping_sub(1);
    }
    nodes.at_mut(index)?.u = u32::MAX;
    while index != 0 {
        let len = nodes.at(index)?.command_length();
        index = index.wrapping_sub(len as usize);
        nodes.at_mut(index)?.u = len;
        num_commands += 1;
    }
    Ok(num_commands)
}

/// Appends the `num_commands` commands of the path that [`compute_shortest_path_from_nodes`] has linked.
fn zopfli_create_commands(
    num_bytes: usize,
    block_start: usize,
    nodes: &[ZopfliNode],
    num_commands: usize,
    dist_cache: &mut [i32; 16],
    last_insert_len: &mut usize,
    params: &EncoderParams,
    commands: &mut Vec<Command>,
    num_literals: &mut usize,
) -> Fallible {
    let stream_offset = params.stream_offset;
    let max_backward_limit = max_backward_limit(params.lgwin as u32);
    let gap = params.dictionary.total_size;
    let mut pos = 0usize;
    let mut offset = nodes.at(0)?.u;
    let mut first = true;
    commands
        .try_reserve(num_commands)
        .map_err(|_| OutOfMemory)?;
    while offset != u32::MAX {
        let next = nodes.at(pos + offset as usize)?;
        let copy_length = next.copy_length() as usize;
        let mut insert_length = next.insert_length() as usize;
        pos += insert_length;
        offset = next.u;
        if first {
            insert_length += *last_insert_len;
            *last_insert_len = 0;
            first = false;
        }
        let distance = next.distance as usize;
        let len_code = next.length_code() as usize;
        let dictionary_start = (block_start + pos + stream_offset).min(max_backward_limit);
        let is_dictionary = distance > dictionary_start + gap;
        let dist_code = next.distance_code() as usize;
        commands.push(Command::new(
            &params.dist,
            insert_length,
            copy_length,
            (len_code as i32).wrapping_sub(copy_length as i32),
            dist_code,
        ));

        if !is_dictionary && dist_code > 0 {
            dist_cache[3] = dist_cache[2];
            dist_cache[2] = dist_cache[1];
            dist_cache[1] = dist_cache[0];
            dist_cache[0] = distance as i32;
        }

        *num_literals += insert_length;
        pos += copy_length;
    }
    *last_insert_len += num_bytes - pos;
    Ok(())
}

/// Finds the best path given all the matches: `num_matches[i]` of `matches` are for byte `i` of the block. Returns the
/// number of commands.
fn zopfli_iterate(
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &EncoderParams,
    gap: usize,
    dist_cache: &[i32],
    model: &ZopfliCostModel,
    num_matches: &[u32],
    matches: &[BackwardMatch],
    nodes: &mut [ZopfliNode],
) -> Checked<usize> {
    let stream_offset = params.stream_offset;
    let max_backward_limit = max_backward_limit(params.lgwin as u32);
    let max_zopfli_len = params.max_zopfli_len();
    let mut queue = StartPosQueue::default();
    let mut cur_match_pos = 0usize;
    let first = nodes.at_mut(0)?;
    first.length = 0;
    first.u = 0f32.to_bits();
    let mut i = 0usize;
    while i + 3 < num_bytes {
        let count = num_matches.at(i)? as usize;
        let cur_matches = matches.sub(cur_match_pos..cur_match_pos + count)?;
        let mut skip = update_nodes(
            num_bytes,
            position,
            i,
            ringbuffer,
            ringbuffer_mask,
            params,
            max_backward_limit,
            dist_cache,
            cur_matches,
            model,
            &mut queue,
            nodes,
        )?;
        if skip < LONG_COPY_QUICK_STEP {
            skip = 0;
        }
        cur_match_pos += count;
        if let [only] = cur_matches {
            if only.length() > max_zopfli_len {
                skip = only.length().max(skip);
            }
        }
        if skip > 1 {
            skip -= 1;
            while skip != 0 {
                i += 1;
                if i + 3 >= num_bytes {
                    break;
                }
                evaluate_node(
                    position + stream_offset,
                    i,
                    max_backward_limit,
                    gap,
                    dist_cache,
                    model,
                    &mut queue,
                    nodes,
                )?;
                cur_match_pos += num_matches.at(i)? as usize;
                skip -= 1;
            }
        }
        i += 1;
    }
    compute_shortest_path_from_nodes(num_bytes, nodes)
}

/// Merges two lists that are sorted by length. Returns how many there are.
fn merge_matches(
    dst: &mut [BackwardMatch],
    mut src1: &[BackwardMatch],
    mut src2: &[BackwardMatch],
) -> Checked<usize> {
    let total = src1.len() + src2.len();
    for dst in dst.sub_mut(..total)? {
        *dst = match (src1, src2) {
            ([m1, rest1 @ ..], [m2, rest2 @ ..]) => {
                let l1 = m1.length();
                let l2 = m2.length();
                if l1 < l2 || (l1 == l2 && m1.distance < m2.distance) {
                    src1 = rest1;
                    *m1
                } else {
                    src2 = rest2;
                    *m2
                }
            }
            ([m1, rest1 @ ..], []) => {
                src1 = rest1;
                *m1
            }
            ([], [m2, rest2 @ ..]) => {
                src2 = rest2;
                *m2
            }
            ([], []) => return Err(Bug),
        };
    }
    Ok(total)
}

/// Room for the matches at one position.
struct MatchBuffers {
    /// In the window and in the static dictionary.
    lz: [BackwardMatch; MAX_NUM_MATCHES_H10],
    /// In the compound dictionary.
    compound: [BackwardMatch; MAX_NUM_COMPOUND_DICTIONARY_MATCHES],
    merged: [BackwardMatch; MAX_NUM_MATCHES_H10 + MAX_NUM_COMPOUND_DICTIONARY_MATCHES],
}

impl MatchBuffers {
    fn new() -> Self {
        let none = BackwardMatch::default();
        Self {
            lz: [none; MAX_NUM_MATCHES_H10],
            compound: [none; MAX_NUM_COMPOUND_DICTIONARY_MATCHES],
            merged: [none; MAX_NUM_MATCHES_H10 + MAX_NUM_COMPOUND_DICTIONARY_MATCHES],
        }
    }

    /// All the matches of up to `max_length` bytes at `pos`, by increasing length, and adds `pos` to `hasher`.
    fn find_all_matches(
        &mut self,
        hasher: &mut H10,
        ringbuffer: &[u8],
        ringbuffer_mask: usize,
        pos: usize,
        max_length: usize,
        params: &EncoderParams,
    ) -> Checked<&[BackwardMatch]> {
        let max_backward_limit = max_backward_limit(params.lgwin as u32);
        let max_distance = pos.min(max_backward_limit);
        let dictionary_start = (pos + params.stream_offset).min(max_backward_limit);
        let addon = &params.dictionary;
        let gap = addon.total_size;
        let num_matches = hasher.find_all_matches(
            ringbuffer,
            ringbuffer_mask,
            pos,
            max_length,
            max_distance,
            dictionary_start + gap,
            params,
            &mut self.lz,
        )?;
        let lz = self.lz.sub(..num_matches)?;
        if addon.chunks.is_empty() {
            return Ok(lz);
        }
        let cd_matches = lookup_all_compound_dictionary_matches(
            addon,
            ringbuffer,
            ringbuffer_mask,
            pos,
            3,
            max_length,
            dictionary_start,
            params.dist.max_distance,
            &mut self.compound,
        )?;
        let total = merge_matches(&mut self.merged, self.compound.sub(..cd_matches)?, lz)?;
        self.merged.sub(..total)
    }
}

/// Up to where the positions of a block can be added to [`H10`].
fn store_end(position: usize, num_bytes: usize) -> usize {
    if num_bytes >= STORE_LOOKAHEAD_H10 {
        position + num_bytes - STORE_LOOKAHEAD_H10 + 1
    } else {
        position
    }
}

/// Finds the best path with costs that are estimated from the literals. `nodes` has `num_bytes + 1` elements. Returns
/// the number of commands.
fn zopfli_compute_shortest_path(
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    params: &EncoderParams,
    dist_cache: &[i32],
    hasher: &mut H10,
    nodes: &mut [ZopfliNode],
) -> Fallible<usize> {
    let stream_offset = params.stream_offset;
    let max_backward_limit = max_backward_limit(params.lgwin as u32);
    let max_zopfli_len = params.max_zopfli_len();
    let mut queue = StartPosQueue::default();
    let mut buffers = MatchBuffers::new();
    let store_end = store_end(position, num_bytes);
    let gap = params.dictionary.total_size;
    let mut model = ZopfliCostModel::new(&params.dist, num_bytes)?;
    let first = nodes.at_mut(0)?;
    first.length = 0;
    first.u = 0f32.to_bits();
    model.set_from_literal_costs(position, ringbuffer, ringbuffer_mask)?;
    let mut i = 0usize;
    while i + HASH_TYPE_LENGTH_H10 <= num_bytes {
        let pos = position + i;
        let mut matches = buffers.find_all_matches(
            hasher,
            ringbuffer,
            ringbuffer_mask,
            pos,
            num_bytes - i,
            params,
        )?;
        // A long match is taken without looking at the others.
        let mut long_match_len = 0usize;
        if let [.., last] = matches {
            if last.length() > max_zopfli_len {
                long_match_len = last.length();
                matches = core::slice::from_ref(last);
            }
        }
        let mut skip = update_nodes(
            num_bytes,
            position,
            i,
            ringbuffer,
            ringbuffer_mask,
            params,
            max_backward_limit,
            dist_cache,
            matches,
            &model,
            &mut queue,
            nodes,
        )?;
        if skip < LONG_COPY_QUICK_STEP {
            skip = 0;
        }
        skip = skip.max(long_match_len);
        if skip > 1 {
            // Add the rest of the copy to the hasher.
            hasher.store_range(
                ringbuffer,
                ringbuffer_mask,
                pos + 1,
                (pos + skip).min(store_end),
            )?;
            skip -= 1;
            while skip != 0 {
                i += 1;
                if i + HASH_TYPE_LENGTH_H10 > num_bytes {
                    break;
                }
                evaluate_node(
                    position + stream_offset,
                    i,
                    max_backward_limit,
                    gap,
                    dist_cache,
                    &model,
                    &mut queue,
                    nodes,
                )?;
                skip -= 1;
            }
        }
        i += 1;
    }
    Ok(compute_shortest_path_from_nodes(num_bytes, nodes)?)
}

/// Quality 10. Appends the commands for the `num_bytes` bytes at `position` to `commands`. The literals that are left
/// at the end are added to `last_insert_len`, for the first command of the next call.
pub(crate) fn create_zopfli_backward_references(
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    _literal_context_lut: &ContextLut,
    params: &EncoderParams,
    hasher: &mut Hasher,
    dist_cache: &mut [i32; 16],
    last_insert_len: &mut usize,
    commands: &mut Vec<Command>,
    num_literals: &mut usize,
) -> Fallible {
    let mut nodes = try_vec(ZopfliNode::INIT, num_bytes + 1)?;
    let num_commands = zopfli_compute_shortest_path(
        num_bytes,
        position,
        ringbuffer,
        ringbuffer_mask,
        params,
        dist_cache,
        hasher.h10_mut()?,
        &mut nodes,
    )?;
    zopfli_create_commands(
        num_bytes,
        position,
        &nodes,
        num_commands,
        dist_cache,
        last_insert_len,
        params,
        commands,
        num_literals,
    )
}

/// Quality 11. Like [`create_zopfli_backward_references`], but looks for the best path a second time, with costs that
/// come from the commands of the first one.
pub(crate) fn create_hq_zopfli_backward_references(
    num_bytes: usize,
    position: usize,
    ringbuffer: &[u8],
    ringbuffer_mask: usize,
    _literal_context_lut: &ContextLut,
    params: &EncoderParams,
    hasher: &mut Hasher,
    dist_cache: &mut [i32; 16],
    last_insert_len: &mut usize,
    commands: &mut Vec<Command>,
    num_literals: &mut usize,
) -> Fallible {
    let hasher = hasher.h10_mut()?;
    let max_zopfli_len = params.max_zopfli_len();
    let mut num_matches = try_zeroed::<u32>(num_bytes)?;
    let mut matches: Vec<BackwardMatch> = Vec::new();
    matches
        .try_reserve(4 * num_bytes)
        .map_err(|_| OutOfMemory)?;
    let mut buffers = MatchBuffers::new();
    let store_end = store_end(position, num_bytes);
    let gap = params.dictionary.total_size;
    let mut i = 0usize;
    while i + HASH_TYPE_LENGTH_H10 <= num_bytes {
        let pos = position + i;
        let found = buffers.find_all_matches(
            hasher,
            ringbuffer,
            ringbuffer_mask,
            pos,
            num_bytes - i,
            params,
        )?;
        matches.try_reserve(found.len()).map_err(|_| OutOfMemory)?;
        match found {
            [.., last] if last.length() > max_zopfli_len => {
                // A long match is taken without looking at the others, and nothing is looked for at its other bytes.
                let match_len = last.length();
                matches.push(*last);
                num_matches.put(i, 1)?;
                // Add the rest of the copy to the hasher.
                hasher.store_range(
                    ringbuffer,
                    ringbuffer_mask,
                    pos + 1,
                    (pos + match_len).min(store_end),
                )?;
                i += match_len - 1;
            }
            _ => {
                matches.extend_from_slice(found);
                num_matches.put(i, found.len() as u32)?;
            }
        }
        i += 1;
    }

    let orig_num_literals = *num_literals;
    let orig_last_insert_len = *last_insert_len;
    let orig_dist_cache = *dist_cache;
    let orig_num_commands = commands.len();
    let mut nodes = try_vec(ZopfliNode::INIT, num_bytes + 1)?;
    let mut model = ZopfliCostModel::new(&params.dist, num_bytes)?;
    for pass in 0..2 {
        nodes.fill(ZopfliNode::INIT);
        if pass == 0 {
            model.set_from_literal_costs(position, ringbuffer, ringbuffer_mask)?;
        } else {
            model.set_from_commands(
                position,
                ringbuffer,
                ringbuffer_mask,
                commands.sub(orig_num_commands..)?,
                orig_last_insert_len,
            )?;
        }
        commands.truncate(orig_num_commands);
        *num_literals = orig_num_literals;
        *last_insert_len = orig_last_insert_len;
        *dist_cache = orig_dist_cache;
        let num_commands = zopfli_iterate(
            num_bytes,
            position,
            ringbuffer,
            ringbuffer_mask,
            params,
            gap,
            dist_cache,
            &model,
            &num_matches,
            &matches,
            &mut nodes,
        )?;
        zopfli_create_commands(
            num_bytes,
            position,
            &nodes,
            num_commands,
            dist_cache,
            last_insert_len,
            params,
            commands,
            num_literals,
        )?;
    }
    Ok(())
}
