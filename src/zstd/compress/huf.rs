//! `huf_compress.c`: Huffman coding of literals.

use super::fse::{self, FseCTable};
use super::hist;
use super::internal::Strategy;
use crate::common::entropy::huf_read_stats;
use crate::common::{HUF_SYMBOLVALUE_MAX, HUF_TABLELOG_MAX};
use crate::error::{Error, Result};
use crate::util::{BUG, SliceExt, highbit32, write_le16};

pub(crate) const HUF_BLOCKSIZE_MAX: usize = 128 * 1024;
pub(crate) const HUF_TABLELOG_DEFAULT: u32 = 11;
/// The strategies from this one on look for the best depth of the tree.
pub(crate) const HUF_OPTIMAL_DEPTH_THRESHOLD: Strategy = Strategy::BtUltra;

/// `HUF_flags_e`
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct HufFlags {
    /// Try every depth of the tree and keep the one that gives the smallest output, instead of a guess.
    pub(crate) optimal_depth: bool,
    /// Use the previous table again whenever it is possible, without looking for a better one.
    pub(crate) prefer_repeat: bool,
    /// Sample the input first, and give up at once if it looks like it cannot be compressed.
    pub(crate) suspect_uncompressible: bool,
}

/// `HUF_repeat`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum HufRepeat {
    /// The table cannot be used again.
    None,
    /// It can, if it has a code for every symbol to encode.
    Check,
    /// It can.
    Valid,
}

/// `HUF_CElt[HUF_CTABLE_SIZE_ST(255)]`. The first element is the header: the table log in its lowest byte, and the
/// largest symbol value in the next. Element `symbol + 1` has the number of bits in its lowest byte, and the code in
/// its highest bits.
#[derive(Clone)]
pub(crate) struct HufCTable(pub(crate) [u64; HUF_SYMBOLVALUE_MAX as usize + 2]);

impl HufCTable {
    pub(crate) const fn new() -> Self {
        Self([0; HUF_SYMBOLVALUE_MAX as usize + 2])
    }

    /// The elements, by symbol.
    #[inline(always)]
    fn elements(&self) -> &[u64; HUF_SYMBOLVALUE_MAX as usize + 1] {
        let [_, elements @ ..] = &self.0;
        elements
    }

    #[inline(always)]
    fn elements_mut(&mut self) -> &mut [u64; HUF_SYMBOLVALUE_MAX as usize + 1] {
        let [_, elements @ ..] = &mut self.0;
        elements
    }

    /// `HUF_writeCTableHeader`
    fn write_header(&mut self, table_log: u32, max_symbol_value: u32) {
        let [header, ..] = &mut self.0;
        *header = u64::from(table_log as u8) | (u64::from(max_symbol_value as u8) << 8);
    }

    /// `HUF_getNbBitsFromCTable`: 0 if the table has no code for `symbol_value`.
    #[inline]
    pub(crate) fn get_nb_bits(&self, symbol_value: u32) -> u32 {
        let [header, elements @ ..] = &self.0;
        let max_symbol_value = (header >> 8) as u8;
        if symbol_value > u32::from(max_symbol_value) {
            return 0;
        }
        (elements.at(symbol_value as usize).unwrap_or(0) & 0xFF) as u32
    }
}

/// `HUF_CTableHeader`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct HufCTableHeader {
    pub(crate) table_log: u8,
    pub(crate) max_symbol_value: u8,
}

/// `HUF_readCTableHeader`
#[inline]
pub(crate) fn read_ctable_header(ctable: &HufCTable) -> HufCTableHeader {
    let [header, ..] = ctable.0;
    HufCTableHeader {
        table_log: header as u8,
        max_symbol_value: (header >> 8) as u8,
    }
}

/// `HUF_getNbBits`
#[inline(always)]
const fn get_nb_bits(elt: u64) -> u64 {
    elt & 0xFF
}

/// `HUF_setValue`: `elt` has its number of bits, and nothing else.
#[inline(always)]
fn set_value(elt: &mut u64, value: u64) {
    let nb_bits = get_nb_bits(*elt) as u32;
    if nb_bits > 0 {
        *elt |= value.wrapping_shl(u64::BITS.wrapping_sub(nb_bits));
    }
}

/// The first code of each number of bits up to `table_log`, given how many symbols there are of each: the longest codes
/// have the lowest values.
fn first_values<const RANKS: usize>(
    nb_per_rank: &[u16; RANKS],
    table_log: u32,
) -> Result<[u16; RANKS]> {
    let mut val_per_rank = [0u16; RANKS];
    let mut min = 0u16;
    for n in (1..=table_log as usize).rev() {
        val_per_rank.put(n, min)?;
        min = min.wrapping_add(nb_per_rank.at(n)?) >> 1;
    }
    Ok(val_per_rank)
}

/// Gives `elt`, which has its number of bits, the next code of that many bits.
#[inline(always)]
fn set_next_value(elt: &mut u64, val_per_rank: &mut [u16]) -> Result<()> {
    let value = val_per_rank.at_mut(get_nb_bits(*elt) as usize)?;
    set_value(elt, u64::from(*value));
    *value = value.wrapping_add(1);
    Ok(())
}

const MAX_FSE_TABLELOG_FOR_HUFF_HEADER: u32 = 6;

/// `HUF_compressWeights`: returns 0 if the weights cannot be compressed, and 1 if they are all the same.
fn compress_weights(dst: &mut [u8], weight_table: &[u8]) -> Result<usize> {
    let mut max_symbol_value = HUF_TABLELOG_MAX;
    let mut count = [0u32; HUF_TABLELOG_MAX as usize + 1];
    let mut norm = [0i16; HUF_TABLELOG_MAX as usize + 1];
    let wt_size = weight_table.len();

    if wt_size <= 1 {
        return Ok(0);
    }

    let max_count = hist::count_simple(&mut count, &mut max_symbol_value, weight_table)?;
    if max_count as usize == wt_size {
        return Ok(1);
    }
    if max_count == 1 {
        return Ok(0);
    }

    let table_log =
        fse::optimal_table_log(MAX_FSE_TABLELOG_FOR_HUFF_HEADER, wt_size, max_symbol_value);
    fse::normalize_count(
        &mut norm,
        table_log,
        &count,
        wt_size,
        max_symbol_value,
        false,
    )?;

    let h_size = fse::write_ncount(dst, &norm, max_symbol_value, table_log)?;

    let mut ctable = FseCTable::new();
    ctable.build(&norm, max_symbol_value, table_log)?;
    let c_size = fse::compress_using_ctable(dst.sub_mut(h_size..)?, weight_table, &ctable);
    if c_size == 0 {
        return Ok(0);
    }
    Ok(h_size + c_size)
}

/// `HUF_writeCTable_wksp`: writes the header that [`huf_read_stats`] reads, and returns its size. `max_symbol_value`
/// and `huff_log` are those of `ctable`.
pub(crate) fn write_ctable(
    dst: &mut [u8],
    ctable: &HufCTable,
    max_symbol_value: u32,
    huff_log: u32,
) -> Result<usize> {
    let mut bits_to_weight = [0u8; HUF_TABLELOG_MAX as usize + 1];
    let mut huff_weight = [0u8; HUF_SYMBOLVALUE_MAX as usize];

    if max_symbol_value > HUF_SYMBOLVALUE_MAX {
        return Err(Error::MaxSymbolValueTooLarge);
    }
    // The weight of the last symbol is not stored.
    let nb_weights = max_symbol_value as usize;

    for n in 1..=huff_log {
        bits_to_weight.put(n as usize, (huff_log + 1 - n) as u8)?;
    }
    let weights = huff_weight.sub_mut(..nb_weights)?;
    for (weight, &elt) in weights.iter_mut().zip(ctable.elements()) {
        *weight = bits_to_weight.at(get_nb_bits(elt) as usize)?;
    }

    let max_dst_size = dst.len();
    let Some((first, rest)) = dst.split_first_mut() else {
        return Err(Error::DstSizeTooSmall);
    };
    let h_size = compress_weights(rest, weights)?;
    if h_size > 1 && h_size < nb_weights / 2 {
        *first = h_size as u8;
        return Ok(h_size + 1);
    }

    // Not compressed: 4 bits to a weight.
    if max_symbol_value > 256 - 128 {
        return Err(Error::Generic);
    }
    let raw_size = nb_weights.div_ceil(2);
    if raw_size + 1 > max_dst_size {
        return Err(Error::DstSizeTooSmall);
    }
    *first = 128u32.wrapping_add(max_symbol_value.wrapping_sub(1)) as u8;
    // An odd number of weights is completed with a 0, which `huff_weight` still has there.
    let (pairs, _) = huff_weight.sub(..raw_size * 2)?.as_chunks::<2>();
    for (out, &[high, low]) in rest.iter_mut().zip(pairs) {
        *out = (high << 4).wrapping_add(low);
    }
    Ok(raw_size + 1)
}

/// What [`read_ctable`] found besides the table.
pub(crate) struct HufCTableStats {
    /// How many bytes of the input the header takes.
    pub(crate) size: usize,
    pub(crate) max_symbol_value: u32,
    /// Some symbol up to `max_symbol_value` has no code.
    pub(crate) has_zero_weights: bool,
}

/// `HUF_readCTable`: [`Error::MaxSymbolValueTooSmall`] if the table has symbols above `max_symbol_value`.
pub(crate) fn read_ctable(
    ctable: &mut HufCTable,
    max_symbol_value: u32,
    src: &[u8],
) -> Result<HufCTableStats> {
    let mut huff_weight = [0u8; HUF_SYMBOLVALUE_MAX as usize + 1];
    let mut rank_val = [0u32; HUF_TABLELOG_MAX as usize + 1];

    let stats = huf_read_stats(&mut huff_weight, &mut rank_val, src)?;
    let table_log = stats.table_log;
    let [zero_weights, ..] = rank_val;

    if table_log > HUF_TABLELOG_MAX {
        return Err(Error::TableLogTooLarge);
    }
    if stats.nb_symbols > max_symbol_value.wrapping_add(1) {
        return Err(Error::MaxSymbolValueTooSmall);
    }
    let max_symbol_value = stats.nb_symbols - 1;
    ctable.write_header(table_log, max_symbol_value);

    let mut nb_per_rank = [0u16; HUF_TABLELOG_MAX as usize + 2];
    let ct = ctable.elements_mut().sub_mut(..stats.nb_symbols as usize)?;
    for (elt, &weight) in ct.iter_mut().zip(&huff_weight) {
        let nb_bits = if weight != 0 {
            (table_log + 1).wrapping_sub(u32::from(weight)) as u8
        } else {
            0
        };
        *elt = u64::from(nb_bits);
        *nb_per_rank.at_mut(usize::from(nb_bits))? += 1;
    }
    let mut val_per_rank = first_values(&nb_per_rank, table_log)?;
    for elt in ct {
        set_next_value(elt, &mut val_per_rank)?;
    }

    Ok(HufCTableStats {
        size: stats.size,
        max_symbol_value,
        has_zero_weights: zero_weights > 0,
    })
}

/// `nodeElt`
#[derive(Clone, Copy, Default)]
struct NodeElt {
    count: u32,
    parent: u16,
    byte: u8,
    nb_bits: u8,
}

/// The leaves of `huffNodeTable`, sorted from the most frequent symbol to the rarest. What there is at -1, or anywhere
/// else out of the table, is all zeros.
struct HuffNodes([NodeElt; HUF_SYMBOLVALUE_MAX as usize + 1]);

impl HuffNodes {
    #[inline(always)]
    fn get(&self, n: i32) -> NodeElt {
        self.0.get(n as usize).copied().unwrap_or_default()
    }

    #[inline(always)]
    fn set(&mut self, n: i32, node: NodeElt) {
        if let Some(slot) = self.0.get_mut(n as usize) {
            *slot = node;
        }
    }

    #[inline(always)]
    fn count(&self, n: i32) -> u32 {
        self.get(n).count
    }

    #[inline(always)]
    fn nb_bits(&self, n: i32) -> u32 {
        u32::from(self.get(n).nb_bits)
    }

    #[inline(always)]
    fn set_nb_bits(&mut self, n: i32, nb_bits: u32) {
        if let Some(node) = self.0.get_mut(n as usize) {
            node.nb_bits = nb_bits as u8;
        }
    }
}

/// `HUF_setMaxHeight`: makes no code longer than `target_nb_bits`, which is not 0 and is enough for a code for every
/// symbol. `last_non_null` is the rarest symbol, which has the longest code. Returns the length of the longest code.
fn set_max_height(
    huff_node: &mut HuffNodes,
    last_non_null: u32,
    target_nb_bits: u32,
) -> Result<u32> {
    let largest_bits = huff_node.nb_bits(last_non_null as i32);
    if largest_bits <= target_nb_bits {
        return Ok(largest_bits);
    }

    // The unit of cost is the share of the code space that a code of `largest_bits` takes.
    let cost_of = |nb_bits: u32| 1u32.wrapping_shl(largest_bits.wrapping_sub(nb_bits));
    let mut total_cost = 0i32;
    let base_cost = cost_of(target_nb_bits);
    let mut n = last_non_null as i32;

    // Shorten the codes that are too long. `total_cost` is how much more than the whole code space is taken then.
    while huff_node.nb_bits(n) > target_nb_bits {
        let cost = base_cost.wrapping_sub(cost_of(huff_node.nb_bits(n)));
        total_cost = total_cost.wrapping_add(cost as i32);
        huff_node.set_nb_bits(n, target_nb_bits);
        n -= 1;
    }
    // `n` ends at the rarest symbol with a code shorter than `target_nb_bits`, or at the sentinel.
    while huff_node.nb_bits(n) == target_nb_bits {
        n -= 1;
    }

    // From here on the unit is the share of a code of `target_nb_bits`.
    total_cost = total_cost.wrapping_shr(largest_bits - target_nb_bits);

    // Repay the cost by making other codes longer.
    const NO_SYMBOL: u32 = 0xF0F0_F0F0;
    // The rarest symbol whose code is that many bits shorter than `target_nb_bits`.
    let mut rank_last = [NO_SYMBOL; HUF_TABLELOG_MAX as usize + 2];

    let mut current_nb_bits = target_nb_bits;
    for pos in (0..=n).rev() {
        let nb_bits = huff_node.nb_bits(pos);
        if nb_bits >= current_nb_bits {
            continue;
        }
        current_nb_bits = nb_bits;
        rank_last.put((target_nb_bits - current_nb_bits) as usize, pos as u32)?;
    }

    while total_cost > 0 {
        // One more bit on a code that is `n_bits_to_decrease` shorter repays `1 << (n_bits_to_decrease - 1)`.
        let mut n_bits_to_decrease = highbit32(total_cost as u32) as usize + 1;
        while n_bits_to_decrease > 1 {
            let high_pos = rank_last.at(n_bits_to_decrease)?;
            let low_pos = rank_last.at(n_bits_to_decrease - 1)?;
            if high_pos != NO_SYMBOL {
                if low_pos == NO_SYMBOL {
                    break;
                }
                // It is cheaper to lengthen this one than two of the rank below.
                let high_total = huff_node.count(high_pos as i32);
                let low_total = huff_node.count(low_pos as i32).wrapping_mul(2);
                if high_total <= low_total {
                    break;
                }
            }
            n_bits_to_decrease -= 1;
        }
        while n_bits_to_decrease <= HUF_TABLELOG_MAX as usize
            && rank_last.at(n_bits_to_decrease)? == NO_SYMBOL
        {
            n_bits_to_decrease += 1;
        }
        let pos = rank_last.at(n_bits_to_decrease)?;
        if pos == NO_SYMBOL {
            return Err(BUG);
        }
        total_cost -= 1 << (n_bits_to_decrease - 1);
        huff_node.set_nb_bits(pos as i32, huff_node.nb_bits(pos as i32) + 1);

        // The symbol is now of the rank below, where it is the rarest only if there was none.
        let below = rank_last.at_mut(n_bits_to_decrease - 1)?;
        if *below == NO_SYMBOL {
            *below = pos;
        }
        // The next symbol takes its place, if it is of the same rank.
        let same_rank = target_nb_bits.wrapping_sub(n_bits_to_decrease as u32);
        let next = if pos != 0 && huff_node.nb_bits(pos as i32 - 1) == same_rank {
            pos - 1
        } else {
            NO_SYMBOL
        };
        rank_last.put(n_bits_to_decrease, next)?;
    }

    // Too much may have been repaid: shorten codes of `target_nb_bits`, the most frequent symbols first.
    let [_, rank_last_1, ..] = &mut rank_last;
    while total_cost < 0 {
        if *rank_last_1 == NO_SYMBOL {
            while huff_node.nb_bits(n) == target_nb_bits {
                n -= 1;
            }
            *rank_last_1 = n as u32;
        }
        *rank_last_1 = rank_last_1.wrapping_add(1);
        let pos = *rank_last_1 as i32;
        huff_node.set_nb_bits(pos, huff_node.nb_bits(pos).wrapping_sub(1));
        total_cost += 1;
    }

    Ok(target_nb_bits)
}

/// `rankPos`
#[derive(Clone, Copy, Default)]
struct RankPos {
    base: u16,
    curr: u16,
}

/// How many buckets [`sort`] has.
const RANK_POSITION_TABLE_SIZE: usize = 192;
const RANK_POSITION_MAX_COUNT_LOG: u32 = 32;
const RANK_POSITION_LOG_BUCKETS_BEGIN: u32 =
    (RANK_POSITION_TABLE_SIZE as u32 - 1) - RANK_POSITION_MAX_COUNT_LOG - 1;
/// The counts below this one have a bucket each. The others share one with the counts of the same binary logarithm.
const RANK_POSITION_DISTINCT_COUNT_CUTOFF: u32 =
    RANK_POSITION_LOG_BUCKETS_BEGIN + highbit32(RANK_POSITION_LOG_BUCKETS_BEGIN);

/// `HUF_getIndex`: the bucket of a count.
#[inline(always)]
fn get_index(count: u32) -> usize {
    if count < RANK_POSITION_DISTINCT_COUNT_CUTOFF {
        count as usize
    } else {
        (highbit32(count) + RANK_POSITION_LOG_BUCKETS_BEGIN) as usize
    }
}

/// `HUF_swapNodes`
#[inline(always)]
fn swap_nodes(arr: &mut HuffNodes, a: i32, b: i32) {
    let tmp = arr.get(a);
    arr.set(a, arr.get(b));
    arr.set(b, tmp);
}

/// `HUF_insertionSort`: by decreasing count, from `low` to `high` included.
#[inline]
fn insertion_sort(huff_node: &mut HuffNodes, low: i32, high: i32) {
    for i in low + 1..=high {
        let key = huff_node.get(i);
        let mut j = i - 1;
        while j >= low && huff_node.count(j) < key.count {
            huff_node.set(j + 1, huff_node.get(j));
            j -= 1;
        }
        huff_node.set(j + 1, key);
    }
}

/// `HUF_quickSortPartition`: the pivot is the last element. Returns where it ends up.
fn quick_sort_partition(arr: &mut HuffNodes, low: i32, high: i32) -> i32 {
    let pivot = arr.count(high);
    let mut i = low - 1;
    for j in low..high {
        if arr.count(j) > pivot {
            i += 1;
            swap_nodes(arr, i, j);
        }
    }
    swap_nodes(arr, i + 1, high);
    i + 1
}

/// `HUF_simpleQuickSort`: by decreasing count, from `low` to `high` included. It recurses into the smaller part only,
/// which bounds the depth. The order it leaves symbols of the same count in decides their codes.
fn simple_quick_sort(arr: &mut HuffNodes, mut low: i32, mut high: i32) {
    const INSERTION_SORT_THRESHOLD: i32 = 8;
    if high - low < INSERTION_SORT_THRESHOLD {
        insertion_sort(arr, low, high);
        return;
    }
    while low < high {
        let idx = quick_sort_partition(arr, low, high);
        if idx - low < high - idx {
            simple_quick_sort(arr, low, idx - 1);
            low = idx + 1;
        } else {
            simple_quick_sort(arr, idx + 1, high);
            high = idx - 1;
        }
    }
}

/// The symbols whose count is not 0, from the lowest to the highest.
struct PresentSymbols {
    symbols: [u8; HUF_SYMBOLVALUE_MAX as usize + 1],
    len: usize,
}

impl PresentSymbols {
    fn get(&self) -> &[u8] {
        self.symbols.get(..self.len).unwrap_or_default()
    }
}

/// `HUF_sort`: makes the first nodes, which are all zeros, the symbols by decreasing count, but for those whose count
/// is 0, which would come last. At most 256 counts.
fn sort(huff_node: &mut HuffNodes, count: &[u32]) -> Result<PresentSymbols> {
    let mut rank_position = [RankPos::default(); RANK_POSITION_TABLE_SIZE];
    let mut present = PresentSymbols {
        symbols: [0; _],
        len: 0,
    };

    // A bucket starts after the symbols of all the buckets above it.
    let mut highest = 0;
    for (symbol, &c) in count.iter().enumerate() {
        present.symbols.put(present.len, symbol as u8)?;
        present.len += usize::from(c != 0);
        let index = get_index(c);
        rank_position.at_mut(index)?.base += 1;
        highest = highest.max(index);
    }
    let mut above = 0u16;
    for rank in rank_position.sub_mut(..=highest)?.iter_mut().rev() {
        rank.base += above;
        rank.curr = rank.base;
        above = rank.base;
    }

    for &symbol in present.get() {
        let c = count.at(usize::from(symbol))?;
        let rank = rank_position.at_mut(get_index(c) + 1)?;
        let node = NodeElt {
            count: c,
            byte: symbol,
            ..NodeElt::default()
        };
        huff_node.set(i32::from(rank.curr), node);
        rank.curr += 1;
    }

    let shared = RANK_POSITION_DISTINCT_COUNT_CUTOFF as usize..RANK_POSITION_TABLE_SIZE - 1;
    for rank in rank_position
        .sub(shared)?
        .iter()
        .take_while(|rank| rank.curr != 0)
    {
        if rank.curr > rank.base + 1 {
            simple_quick_sort(huff_node, i32::from(rank.base), i32::from(rank.curr) - 1);
        }
    }
    Ok(present)
}

/// `HUF_buildTree`: sets the depth of `leaves`, which are sorted by decreasing count. There are at most 256.
fn build_tree(leaves: &mut [NodeElt]) {
    /// The count of a parent that is not made yet, which is more than any count,
    const NO_PARENT: u32 = 1 << 30;
    /// and what there is past the last leaf, which is more than that.
    const NO_LEAF: u32 = 1 << 31;
    type PerParent<T> = [T; HUF_SYMBOLVALUE_MAX as usize + 1];
    #[inline(always)]
    fn at<T: Copy + Default>(table: &PerParent<T>, n: u8) -> T {
        table.get(usize::from(n)).copied().unwrap_or_default()
    }
    #[inline(always)]
    fn put<T>(table: &mut PerParent<T>, n: u8, value: T) {
        if let Some(slot) = table.get_mut(usize::from(n)) {
            *slot = value;
        }
    }

    // The parents, in the order they are made, which is by increasing count.
    let nb_parents = leaves.len().saturating_sub(1) as u8;
    let mut counts: PerParent<u32> = [NO_PARENT; _];
    let mut parents: PerParent<u8> = [0; _];

    // Join the two nodes of the lowest counts, which are among the next two leaves and the next two parents. With the
    // same count, a parent goes first.
    let mut low_s = leaves.len().wrapping_sub(1);
    let mut low_n = 0u8;
    for parent in 0..nb_parents {
        let leaf = |n: usize| leaves.get(n).map_or(NO_LEAF, |leaf| leaf.count);
        let (s0, s1) = (leaf(low_s), leaf(low_s.wrapping_sub(1)));
        let (n0, n1) = (at(&counts, low_n), at(&counts, low_n.wrapping_add(1)));
        let first_is_leaf = s0 < n0;
        let second_is_leaf = if first_is_leaf { s1 < n0 } else { s0 < n1 };
        let first = if first_is_leaf { s0 } else { n0 };
        let second = match (first_is_leaf, second_is_leaf) {
            (true, true) => s1,
            (true, false) => n0,
            (false, true) => s0,
            (false, false) => n1,
        };
        put(&mut counts, parent, first.wrapping_add(second));
        // The nodes that are not taken this time get their parent when they are.
        for n in [low_s, low_s.wrapping_sub(1)] {
            if let Some(leaf) = leaves.get_mut(n) {
                leaf.parent = u16::from(parent);
            }
        }
        put(&mut parents, low_n, parent);
        put(&mut parents, low_n.wrapping_add(1), parent);
        let nb_leaves = u8::from(first_is_leaf) + u8::from(second_is_leaf);
        low_s = low_s.wrapping_sub(usize::from(nb_leaves));
        low_n = low_n.wrapping_add(2 - nb_leaves);
    }

    // The parents come after their children, so that this goes from the root down.
    let mut depths: PerParent<u8> = [0; _];
    for n in (0..nb_parents.saturating_sub(1)).rev() {
        let depth = at(&depths, at(&parents, n)).wrapping_add(1);
        put(&mut depths, n, depth);
    }
    for leaf in leaves {
        leaf.nb_bits = at(&depths, leaf.parent as u8).wrapping_add(1);
    }
}

/// `HUF_buildCTableFromTree`: `leaves` are the symbols `present`, none deeper than `max_nb_bits`, which is at most 12.
fn build_ctable_from_tree(
    ctable: &mut HufCTable,
    leaves: &[NodeElt],
    present: &[u8],
    max_symbol_value: u32,
    max_nb_bits: u32,
) -> Result<()> {
    let ct = ctable.elements_mut();
    ct.sub_mut(..=max_symbol_value as usize)?.fill(0);
    let mut nb_per_rank = [0u16; HUF_TABLELOG_MAX as usize + 1];
    for node in leaves {
        *nb_per_rank.at_mut(usize::from(node.nb_bits))? += 1;
        ct.put(usize::from(node.byte), u64::from(node.nb_bits))?;
    }
    let mut val_per_rank = first_values(&nb_per_rank, max_nb_bits)?;
    for &symbol in present {
        set_next_value(ct.at_mut(usize::from(symbol))?, &mut val_per_rank)?;
    }
    ctable.write_header(max_nb_bits, max_symbol_value);
    Ok(())
}

/// `HUF_buildCTable_wksp`: some count up to `max_symbol_value` is not 0, and `max_nb_bits` is enough for a code for
/// each that is not, or 0 for the default. Returns the length of the longest code.
pub(crate) fn build_ctable(
    ctable: &mut HufCTable,
    count: &[u32],
    max_symbol_value: u32,
    mut max_nb_bits: u32,
) -> Result<usize> {
    if max_nb_bits == 0 {
        max_nb_bits = HUF_TABLELOG_DEFAULT;
    }
    if max_symbol_value > HUF_SYMBOLVALUE_MAX {
        return Err(Error::MaxSymbolValueTooLarge);
    }
    let mut huff_node = HuffNodes([NodeElt::default(); _]);

    let present = sort(&mut huff_node, count.sub(..=max_symbol_value as usize)?)?;
    let non_null_rank = present.len.checked_sub(1).ok_or(BUG)?;
    build_tree(huff_node.0.sub_mut(..present.len)?);
    max_nb_bits = set_max_height(&mut huff_node, non_null_rank as u32, max_nb_bits)?;
    if max_nb_bits > HUF_TABLELOG_MAX {
        return Err(Error::Generic);
    }
    build_ctable_from_tree(
        ctable,
        huff_node.0.sub(..present.len)?,
        present.get(),
        max_symbol_value,
        max_nb_bits,
    )?;
    Ok(max_nb_bits as usize)
}

/// `HUF_estimateCompressedSize`: how many bytes the symbols counted in `count` take, without the last partial one.
pub(crate) fn estimate_compressed_size(
    ctable: &HufCTable,
    count: &[u32],
    max_symbol_value: u32,
) -> usize {
    let nb_bits: usize = (ctable.elements().iter().zip(count))
        .take(max_symbol_value as usize + 1)
        .map(|(&elt, &count)| get_nb_bits(elt) as usize * count as usize)
        .sum();
    nb_bits >> 3
}

/// `HUF_validateCTable`: whether the table has a code for every symbol whose count is not 0.
pub(crate) fn validate_ctable(ctable: &HufCTable, count: &[u32], max_symbol_value: u32) -> bool {
    if u32::from(read_ctable_header(ctable).max_symbol_value) < max_symbol_value {
        return false;
    }
    (ctable.elements().iter().zip(count))
        .take(max_symbol_value as usize + 1)
        .all(|(&elt, &count)| count == 0 || get_nb_bits(elt) != 0)
}

/// One `bitContainer` of `HUF_CStream_t` and its `bitPos`.
#[derive(Clone, Copy, Default)]
struct BitContainer {
    /// The bits are at the top. The lowest bits can be dirty.
    bits: u64,
    /// The number of bits is in the lowest byte. The rest is dirty.
    pos: u64,
}

impl BitContainer {
    /// `HUF_addBits`: there is room for the code of `elt`. With `FAST`, the lowest byte of `elt` is not cleared
    /// first, which takes that there is room for 4 bits more.
    #[inline(always)]
    fn add_bits<const FAST: bool>(&mut self, elt: u64) {
        self.bits >>= get_nb_bits(elt) & 63;
        self.bits |= if FAST { elt } else { elt & !0xFF };
        self.pos = self.pos.wrapping_add(elt);
    }

    #[inline(always)]
    const fn nb_bits(self) -> u64 {
        self.pos & 0xFF
    }
}

/// `HUF_CStream_t`. Its second container is a local variable of the loop that uses it.
struct HufCStream<'a> {
    container: BitContainer,
    dst: &'a mut [u8],
    pos: usize,
    /// The last position a whole container can be written to.
    end: usize,
}

impl<'a> HufCStream<'a> {
    /// `HUF_initCStream`
    #[inline]
    fn new(dst: &'a mut [u8]) -> Result<Self> {
        if dst.len() <= size_of::<u64>() {
            return Err(Error::DstSizeTooSmall);
        }
        let end = dst.len() - size_of::<u64>();
        Ok(Self {
            container: BitContainer::default(),
            dst,
            pos: 0,
            end,
        })
    }

    /// `HUF_mergeIndex1`: there is room for the bits of `second`, which come after those the stream has.
    #[inline(always)]
    fn merge(&mut self, second: BitContainer) {
        self.container.bits >>= second.nb_bits() & 63;
        self.container.bits |= second.bits;
        self.container.pos = self.container.pos.wrapping_add(second.pos);
    }

    /// `HUF_flushBits`: writes the whole bytes. At the end of the output the stream stops advancing, which
    /// [`Self::close`] reports. The C code has a variant without that limit for when the output is known to be large
    /// enough, but here the limit is what spares a check on the write.
    #[inline(always)]
    fn flush_bits(&mut self) {
        let nb_bits = self.container.nb_bits();
        let nb_bytes = (nb_bits >> 3) as usize;
        let bits = self.container.bits >> (u64::from(u64::BITS).wrapping_sub(nb_bits) & 63);
        self.container.pos &= 7;
        let pos = self.pos.min(self.end);
        if let Ok(out) = self.dst.array_at_mut(pos) {
            *out = bits.to_le_bytes();
        }
        self.pos = pos + nb_bytes;
    }

    /// `HUF_closeCStream`: the size of the stream, or 0 if it did not fit.
    #[inline]
    fn close(mut self) -> usize {
        /// `HUF_endMark`: one bit, set.
        const END_MARK: u64 = 1 | (1 << 63);
        self.container.add_bits::<false>(END_MARK);
        self.flush_bits();
        if self.pos >= self.end {
            return 0;
        }
        self.pos + usize::from(self.container.nb_bits() > 0)
    }
}

type Elements = [u64; HUF_SYMBOLVALUE_MAX as usize + 1];

/// `HUF_encodeSymbol`
#[inline(always)]
fn encode_symbol<const FAST: bool>(container: &mut BitContainer, symbol: u8, ct: &Elements) {
    container.add_bits::<FAST>(ct.get(usize::from(symbol)).copied().unwrap_or(0));
}

/// Encodes `symbols` from the last to the first.
#[inline(always)]
fn encode_symbols<const UNROLL: usize, const LAST_FAST: bool>(
    container: &mut BitContainer,
    symbols: &[u8; UNROLL],
    ct: &Elements,
) {
    if let Some((&last, symbols)) = symbols.split_first() {
        for &symbol in symbols.iter().rev() {
            encode_symbol::<true>(container, symbol, ct);
        }
        encode_symbol::<LAST_FAST>(container, last, ct);
    }
}

/// `HUF_compress1X_usingCTable_internal_body_loop`: a container has room for `UNROLL` symbols on top of the 7 bits
/// that a flush can leave, and, with `LAST_FAST`, for 4 bits more.
#[inline(always)]
fn compress_1x_body_loop<const UNROLL: usize, const LAST_FAST: bool>(
    bit_c: &mut HufCStream<'_>,
    src: &[u8],
    ct: &Elements,
) {
    let (groups, rem) = src.as_chunks::<UNROLL>();
    if !rem.is_empty() {
        for &symbol in rem.iter().rev() {
            encode_symbol::<false>(&mut bit_c.container, symbol, ct);
        }
        bit_c.flush_bits();
    }
    let (pairs, odd) = groups.as_chunks::<2>();
    if let [group] = odd {
        encode_symbols::<UNROLL, LAST_FAST>(&mut bit_c.container, group, ct);
        bit_c.flush_bits();
    }
    for [second, first] in pairs.iter().rev() {
        encode_symbols::<UNROLL, LAST_FAST>(&mut bit_c.container, first, ct);
        bit_c.flush_bits();
        // The second group does not depend on the flush, since it has a container of its own.
        let mut container = BitContainer::default();
        encode_symbols::<UNROLL, LAST_FAST>(&mut container, second, ct);
        bit_c.merge(container);
        bit_c.flush_bits();
    }
}

/// `HUF_tightCompressBound`: no output is larger, given the longest code.
const fn tight_compress_bound(src_size: usize, table_log: usize) -> usize {
    ((src_size * table_log) >> 3) + 8
}

/// `HUF_compress1X_usingCTable`: the table has a code for every symbol in `src`. Returns the size of the output, or 0
/// if `dst` is too small.
pub(crate) fn compress_1x_using_ctable(
    dst: &mut [u8],
    src: &[u8],
    ctable: &HufCTable,
) -> Result<usize> {
    let table_log = read_ctable_header(ctable).table_log;
    let ct = ctable.elements();
    let dst_size = dst.len();

    let Ok(mut bit_c) = HufCStream::new(dst) else {
        return Ok(0);
    };
    let bit_c_ref = &mut bit_c;

    if dst_size < tight_compress_bound(src.len(), usize::from(table_log)) || table_log > 11 {
        compress_1x_body_loop::<4, false>(bit_c_ref, src, ct);
    } else {
        match table_log {
            11 => compress_1x_body_loop::<5, false>(bit_c_ref, src, ct),
            10 => compress_1x_body_loop::<5, true>(bit_c_ref, src, ct),
            9 => compress_1x_body_loop::<6, false>(bit_c_ref, src, ct),
            8 => compress_1x_body_loop::<7, false>(bit_c_ref, src, ct),
            7 => compress_1x_body_loop::<8, false>(bit_c_ref, src, ct),
            _ => compress_1x_body_loop::<9, true>(bit_c_ref, src, ct),
        }
    }
    Ok(bit_c.close())
}

/// `HUF_compress4X_usingCTable`: four streams, after the sizes of the first three. The table has a code for every
/// symbol in `src`. Returns the size of the output, or 0 if `src` is too small for it, `dst` is, or a stream is too
/// large.
pub(crate) fn compress_4x_using_ctable(
    dst: &mut [u8],
    src: &[u8],
    ctable: &HufCTable,
) -> Result<usize> {
    let segment_size = src.len().div_ceil(4);
    if dst.len() < 6 + 1 + 1 + 1 + 8 {
        return Ok(0);
    }
    if src.len() < 12 {
        return Ok(0);
    }
    let mut op = 6usize;
    for (stream, segment) in src.chunks(segment_size).enumerate() {
        let c_size = compress_1x_using_ctable(dst.sub_mut(op..)?, segment, ctable)?;
        if c_size == 0 || c_size > 65535 {
            return Ok(0);
        }
        if stream < 3 {
            write_le16(dst, stream * 2, c_size as u16)?;
        }
        op += c_size;
    }
    Ok(op)
}

/// `HUF_nbStreams_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum NbStreams {
    Single,
    Four,
}

/// `HUF_compressCTable_internal`: writes from `op` on. Returns how much of `dst` is used, or 0 if that saves nothing.
fn compress_ctable_internal(
    dst: &mut [u8],
    op: usize,
    src: &[u8],
    nb_streams: NbStreams,
    ctable: &HufCTable,
) -> Result<usize> {
    let out = dst.sub_mut(op..)?;
    let c_size = match nb_streams {
        NbStreams::Single => compress_1x_using_ctable(out, src, ctable)?,
        NbStreams::Four => compress_4x_using_ctable(out, src, ctable)?,
    };
    if c_size == 0 {
        return Ok(0);
    }
    if op + c_size >= src.len().wrapping_sub(1) {
        return Ok(0);
    }
    Ok(op + c_size)
}

const SUSPECT_INCOMPRESSIBLE_SAMPLE_SIZE: usize = 4096;
const SUSPECT_INCOMPRESSIBLE_SAMPLE_RATIO: usize = 10;

/// `HUF_cardinality`: how many counts up to `max_symbol_value` are not 0.
pub(crate) fn cardinality(count: &[u32], max_symbol_value: u32) -> u32 {
    let counts = count.iter().take(max_symbol_value as usize + 1);
    counts.filter(|&&count| count != 0).count() as u32
}

/// `HUF_minTableLog`: the shortest that the longest code can be. `symbol_cardinality` is not 0.
pub(crate) fn min_table_log(symbol_cardinality: u32) -> u32 {
    highbit32(symbol_cardinality) + 1
}

/// `HUF_optimalTableLog`: the limit to put on the length of the codes. `src_size` is more than 1. With
/// `flags.optimal_depth`, `table` is overwritten.
pub(crate) fn optimal_table_log(
    max_table_log: u32,
    src_size: usize,
    max_symbol_value: u32,
    table: &mut HufCTable,
    count: &[u32],
    flags: HufFlags,
) -> u32 {
    if !flags.optimal_depth {
        return fse::optimal_table_log_internal(max_table_log, src_size, max_symbol_value, 1);
    }

    // Large enough that no step of `write_ctable` is short of room.
    let mut dst = [0u8; 512];
    let symbol_cardinality = cardinality(count, max_symbol_value);
    let min_table_log = min_table_log(symbol_cardinality);
    let mut opt_size = usize::MAX - 1;
    let mut opt_log = max_table_log;

    // Search until the size increases.
    for opt_log_guess in min_table_log..=max_table_log {
        let Ok(max_bits) = build_ctable(table, count, max_symbol_value, opt_log_guess) else {
            continue;
        };
        if max_bits < opt_log_guess as usize && opt_log_guess > min_table_log {
            break;
        }
        let Ok(h_size) = write_ctable(&mut dst, table, max_symbol_value, max_bits as u32) else {
            continue;
        };
        let new_size = estimate_compressed_size(table, count, max_symbol_value) + h_size;
        if new_size > opt_size + 1 {
            break;
        }
        if new_size < opt_size {
            opt_size = new_size;
            opt_log = opt_log_guess;
        }
    }
    opt_log
}

/// `HUF_compress_internal`
fn compress_internal(
    dst: &mut [u8],
    src: &[u8],
    mut max_symbol_value: u32,
    mut huff_log: u32,
    nb_streams: NbStreams,
    old_huf_table: &mut HufCTable,
    repeat: &mut HufRepeat,
    flags: HufFlags,
) -> Result<usize> {
    let src_size = src.len();
    let Some(&first_byte) = src.first() else {
        return Ok(0);
    };
    if dst.is_empty() {
        return Ok(0);
    }
    if src_size > HUF_BLOCKSIZE_MAX {
        return Err(Error::SrcSizeWrong);
    }
    if huff_log > HUF_TABLELOG_MAX {
        return Err(Error::TableLogTooLarge);
    }
    if max_symbol_value > HUF_SYMBOLVALUE_MAX {
        return Err(Error::MaxSymbolValueTooLarge);
    }
    if max_symbol_value == 0 {
        max_symbol_value = HUF_SYMBOLVALUE_MAX;
    }
    if huff_log == 0 {
        huff_log = HUF_TABLELOG_DEFAULT;
    }

    if flags.prefer_repeat && *repeat == HufRepeat::Valid {
        return compress_ctable_internal(dst, 0, src, nb_streams, old_huf_table);
    }

    let mut count = [0u32; HUF_SYMBOLVALUE_MAX as usize + 1];

    // If the input may well be incompressible, look at its start and its end before all of it.
    if flags.suspect_uncompressible
        && src_size >= SUSPECT_INCOMPRESSIBLE_SAMPLE_SIZE * SUSPECT_INCOMPRESSIBLE_SAMPLE_RATIO
    {
        let mut largest_total = 0usize;
        for sample in [
            src.sub(..SUSPECT_INCOMPRESSIBLE_SAMPLE_SIZE)?,
            src.sub(src_size - SUSPECT_INCOMPRESSIBLE_SAMPLE_SIZE..)?,
        ] {
            let mut max_symbol_value_sample = max_symbol_value;
            largest_total +=
                hist::count_simple(&mut count, &mut max_symbol_value_sample, sample)? as usize;
        }
        if largest_total <= ((2 * SUSPECT_INCOMPRESSIBLE_SAMPLE_SIZE) >> 7) + 4 {
            return Ok(0);
        }
    }

    let largest = hist::count_wksp(&mut count, &mut max_symbol_value, src)?;
    if largest == src_size {
        // A single symbol: run-length encoding.
        dst.put(0, first_byte)?;
        return Ok(1);
    }
    if largest <= (src_size >> 7) + 4 {
        // Probably not compressible enough.
        return Ok(0);
    }

    if *repeat == HufRepeat::Check && !validate_ctable(old_huf_table, &count, max_symbol_value) {
        *repeat = HufRepeat::None;
    }
    if flags.prefer_repeat && *repeat != HufRepeat::None {
        return compress_ctable_internal(dst, 0, src, nb_streams, old_huf_table);
    }

    let mut ctable = HufCTable::new();
    huff_log = optimal_table_log(
        huff_log,
        src_size,
        max_symbol_value,
        &mut ctable,
        &count,
        flags,
    );
    huff_log = build_ctable(&mut ctable, &count, max_symbol_value, huff_log)? as u32;

    let h_size = write_ctable(dst, &ctable, max_symbol_value, huff_log)?;
    // Is the previous table the better choice, since it takes no header?
    if *repeat != HufRepeat::None {
        let old_size = estimate_compressed_size(old_huf_table, &count, max_symbol_value);
        let new_size = estimate_compressed_size(&ctable, &count, max_symbol_value);
        if old_size <= h_size + new_size || h_size + 12 >= src_size {
            return compress_ctable_internal(dst, 0, src, nb_streams, old_huf_table);
        }
    }

    if h_size + 12 >= src_size {
        return Ok(0);
    }
    *repeat = HufRepeat::None;
    old_huf_table.clone_from(&ctable);
    compress_ctable_internal(dst, h_size, src, nb_streams, &ctable)
}

/// `HUF_compress1X_repeat`: one stream, after the header of its table, or without one if `huf_table` is used again,
/// which `repeat` says is allowed. If it is not used again, `repeat` becomes [`HufRepeat::None`] and `huf_table` the
/// new table. Returns the size of the output, 0 if `src` is not compressible, or 1 if it is one byte repeated, which
/// is then the output.
pub(crate) fn compress_1x_repeat(
    dst: &mut [u8],
    src: &[u8],
    max_symbol_value: u32,
    huff_log: u32,
    huf_table: &mut HufCTable,
    repeat: &mut HufRepeat,
    flags: HufFlags,
) -> Result<usize> {
    compress_internal(
        dst,
        src,
        max_symbol_value,
        huff_log,
        NbStreams::Single,
        huf_table,
        repeat,
        flags,
    )
}

/// `HUF_compress4X_repeat`: as [`compress_1x_repeat`], with four streams.
pub(crate) fn compress_4x_repeat(
    dst: &mut [u8],
    src: &[u8],
    max_symbol_value: u32,
    huff_log: u32,
    huf_table: &mut HufCTable,
    repeat: &mut HufRepeat,
    flags: HufFlags,
) -> Result<usize> {
    compress_internal(
        dst,
        src,
        max_symbol_value,
        huff_log,
        NbStreams::Four,
        huf_table,
        repeat,
        flags,
    )
}
