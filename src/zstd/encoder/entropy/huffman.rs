//! Huffman codes for literals.

use bun_highway::with_bmi2;
use bun_highway::zstd::{Written, are_quicker_for, write_codes};
use bun_zstd_decoder::array::At;
use bun_zstd_decoder::bounded::Bounded;
use bun_zstd_decoder::format::HUFFMAN_TABLE_LOG_MAX;
use bun_zstd_decoder::{Error, Result};

use super::bit_writer::WordWriter;
use super::fse::{self, Normalized};
use super::histogram::Histogram;
use crate::bytes::{highest_bit, likely, put};

/// In front of four streams.
pub(super) const JUMP_TABLE_LEN: usize = 6;
const DESCRIPTION_LEN_MAX: usize = 128;
const CODE_LEN_MAX: u32 = 11;
const RANKS: usize = 16;

#[derive(Clone, Copy, Default)]
struct Leaf {
    count: u32,
    symbol: u8,
    bits: u8,
}

/// From the most frequent on, after one that stands for none.
type Leaves = [Leaf; 257];
const FIRST_LEAF: usize = 1;

/// The code is in the highest bits, and its length in the lowest byte.
#[derive(Clone, Copy)]
struct Code(u64);

impl Code {
    const END_MARK: Self = Self::new(1, 1);

    const fn new(value: u16, bits: u8) -> Self {
        Self((value as u64).unbounded_shl(64 - bits as u32) | bits as u64)
    }

    /// The same in 16 bits.
    #[inline(always)]
    fn short(self) -> u16 {
        (self.0 >> 48 | self.0) as u16
    }
}

#[derive(Clone, Copy)]
pub(crate) struct Table {
    codes: [Code; 256],
    /// 0 for symbols without a code.
    lens: [u8; 256],
    /// How many codes have that length.
    per_len: [u16; RANKS],
    log: u32,
    max_symbol: usize,
}

/// The order that this leaves equal counts in decides which of them get the shorter codes.
fn quicksort(mut nodes: &mut [Leaf]) {
    if nodes.len() <= 8 {
        for end in 1..nodes.len() {
            if let Some([sorted @ .., next]) = nodes.get(..=end) {
                let smaller = sorted.iter().rev().take_while(|it| it.count < next.count);
                let start = end - smaller.count();
                nodes
                    .get_mut(start..=end)
                    .unwrap_or_default()
                    .rotate_right(1);
            }
        }
        return;
    }
    while let [.., pivot] = *nodes
        && nodes.len() > 1
    {
        let last = nodes.len() - 1;
        let mut larger = 0;
        for index in 0..last {
            if nodes.get(index).is_some_and(|it| it.count > pivot.count) {
                nodes.swap(larger, index);
                larger += 1;
            }
        }
        nodes.swap(larger, last);
        let (before, rest) = nodes.split_at_mut(larger);
        let after = rest.get_mut(1..).unwrap_or_default();
        nodes = if before.len() < after.len() {
            quicksort(before);
            after
        } else {
            quicksort(after);
            before
        };
    }
}

/// The symbols that occur, with the lengths that their codes have without a limit.
struct Tree {
    leaves: Leaves,
    last_leaf: usize,
}

impl Tree {
    /// At least two of `counts` are not 0.
    fn new(counts: &[u32]) -> Self {
        let mut tree = Self {
            leaves: [Leaf::default(); _],
            last_leaf: 0,
        };
        tree.sort(counts);
        tree.measure();
        tree
    }

    fn sort(&mut self, counts: &[u32]) {
        const LOG_BUCKETS_FROM: u32 = 158;
        const DISTINCT_BELOW: u32 = LOG_BUCKETS_FROM + LOG_BUCKETS_FROM.ilog2();
        let bucket = |count: u32| {
            if count < DISTINCT_BELOW {
                count as usize
            } else {
                (highest_bit(count) + LOG_BUCKETS_FROM) as usize
            }
        };

        let (mut present, mut largest) = ([0u8; 256], 0);
        for (symbol, &count) in counts.iter().enumerate() {
            *present.at_mut(self.last_leaf % 256) = symbol as u8;
            self.last_leaf += usize::from(count != 0);
            largest = largest.max(count);
        }
        let present = present.iter().take(self.last_leaf).filter_map(|&symbol| {
            let &count = counts.get(usize::from(symbol))?;
            Some(Leaf {
                count,
                symbol,
                bits: 0,
            })
        });

        let mut starts = [0u16; 256];
        for leaf in present.clone() {
            *starts.at_mut(bucket(leaf.count)) += 1;
        }
        let used = starts.get_mut(..=bucket(largest)).unwrap_or_default();
        let mut start = FIRST_LEAF as u16;
        for entry in used.iter_mut().rev() {
            start += core::mem::replace(entry, start);
        }
        let mut ends = starts;
        for leaf in present {
            let end = ends.at_mut(bucket(leaf.count));
            *self.leaves.at_mut(usize::from(*end)) = leaf;
            *end += 1;
        }

        for bucket in DISTINCT_BELOW as usize - 1..=bucket(largest) {
            let range = usize::from(*starts.at(bucket))..usize::from(*ends.at(bucket));
            quicksort(self.leaves.get_mut(range).unwrap_or_default());
        }
    }

    fn measure(&mut self) {
        let root = self.last_leaf.saturating_sub(2);
        let mut counts = [1u32 << 30; 256];
        let (mut parent_of_leaf, mut parent_of_node) = ([0u8; 512], [0u8; 256]);
        self.leaves.at_mut(0).count = 1 << 31;

        let (mut leaf, mut node) = (self.last_leaf, 0);
        for parent in 0..=root {
            let mut sum = 0;
            for _ in 0..2 {
                let (of_leaf, of_node) = (self.leaves.at(leaf).count, *counts.at(node));
                // The one that is not taken gets its parent later.
                *parent_of_leaf.at_mut(leaf) = parent as u8;
                *parent_of_node.at_mut(node) = parent as u8;
                let takes_leaf = of_leaf < of_node;
                sum += of_leaf.min(of_node);
                leaf -= usize::from(takes_leaf);
                node += usize::from(!takes_leaf);
            }
            *counts.at_mut(parent) = sum;
        }

        let mut depths = [0u8; 256];
        for node in (0..root).rev() {
            *depths.at_mut(node) = depths.at(usize::from(*parent_of_node.at(node))) + 1;
        }
        let leaves = self.leaves.iter_mut().zip(parent_of_leaf).skip(FIRST_LEAF);
        for (leaf, parent) in leaves.take(self.last_leaf) {
            leaf.bits = depths.at(usize::from(parent)) + 1;
        }
    }
}

/// Returns the length of the longest code.
fn limit_code_len(nodes: &mut Leaves, last_leaf: usize, limit: u32) -> u32 {
    const NONE: usize = 0;
    let bits = |nodes: &Leaves, node: usize| u32::from(nodes.at(node).bits);
    let longest = bits(nodes, last_leaf);
    if longest <= limit {
        return longest;
    }

    let mut debt = 0i32;
    let mut node = last_leaf;
    while bits(nodes, node) > limit {
        debt += (1 << (longest - limit)) - (1 << (longest - bits(nodes, node)));
        nodes.at_mut(node).bits = limit as u8;
        node -= 1;
    }
    while bits(nodes, node) == limit {
        node -= 1;
    }
    debt >>= longest - limit;

    // The rarest leaf whose code is that many bits shorter than the limit.
    let mut rarest = [NONE; RANKS];
    let mut current = limit;
    for leaf in (FIRST_LEAF..=node).rev() {
        if bits(nodes, leaf) < current {
            current = bits(nodes, leaf);
            *rarest.at_mut((limit - current) as usize) = leaf;
        }
    }

    while debt > 0 {
        let mut rank = highest_bit(debt as u32) as usize + 1;
        while rank > 1 {
            let (high, low) = (*rarest.at(rank), *rarest.at(rank - 1));
            if high != NONE && (low == NONE || nodes.at(high).count <= 2 * nodes.at(low).count) {
                break;
            }
            rank -= 1;
        }
        while rank <= HUFFMAN_TABLE_LOG_MAX as usize && *rarest.at(rank) == NONE {
            rank += 1;
        }
        debt -= 1 << (rank - 1);
        let leaf = *rarest.at(rank);
        nodes.at_mut(leaf).bits += 1;
        if *rarest.at(rank - 1) == NONE {
            *rarest.at_mut(rank - 1) = leaf;
        }
        let before = leaf.saturating_sub(1);
        let is_in_rank = bits(nodes, before) + rank as u32 == limit;
        *rarest.at_mut(rank) = if is_in_rank { before } else { NONE };
    }

    while debt < 0 {
        if *rarest.at(1) == NONE {
            while bits(nodes, node) == limit {
                node -= 1;
            }
            *rarest.at_mut(1) = node;
        }
        *rarest.at_mut(1) += 1;
        nodes.at_mut(*rarest.at(1)).bits -= 1;
        debt += 1;
    }
    limit
}

/// `None` if there is nothing to gain, or no room.
fn compress_weights(
    weights: &[u8],
    histogram: &Histogram<RANKS>,
    out: &mut [u8],
) -> Result<Option<usize>> {
    if histogram.largest_count == weights.len() || histogram.largest_count == 1 {
        return Ok(None);
    }
    let log = fse::table_log_for(6, weights.len(), histogram.max_symbol, 2);
    let normalized = Normalized::new(histogram.used(), weights.len(), log, false)?;
    let header_len = normalized.write(out)?;
    let out = out.get_mut(header_len..).unwrap_or_default();
    let mut table = fse::Tables::<64, 16>::EMPTY;
    let shape = table.build(0, &normalized);
    let len = with_bmi2(
        #[inline(always)]
        || table.compress(shape, weights, out),
    );
    Ok(len.map(|len| header_len + len))
}

/// Bits enter at the top. Only the lowest byte of `count` counts.
#[derive(Clone, Copy, Default)]
struct Pending {
    bits: u64,
    count: u64,
}

impl Pending {
    /// Leaves the length of the code in the lowest 4 bits, which have to be free.
    #[inline(always)]
    fn add_if_roomy(&mut self, code: Code) {
        self.bits = self.bits.wrapping_shr(code.0 as u32) | code.0;
        self.count = self.count.wrapping_add(code.0);
    }

    #[inline(always)]
    fn add(&mut self, code: Code) {
        self.bits = self.bits.wrapping_shr(code.0 as u32) | (code.0 & !0xFF);
        self.count = self.count.wrapping_add(code.0);
    }

    #[inline(always)]
    fn append(&mut self, other: Self) {
        self.bits = self.bits.wrapping_shr(other.count as u32) | other.bits;
        self.count = self.count.wrapping_add(other.count);
    }

    /// A word, and how many of its bytes are complete.
    #[inline(always)]
    fn take(&mut self) -> (u64, u32) {
        let count = u32::from(self.count as u8);
        self.count &= 7;
        (self.bits.wrapping_shr(count.wrapping_neg()), count / 8)
    }

    #[inline(always)]
    fn flush(&mut self, writer: &mut WordWriter<'_>) -> Option<()> {
        let (word, len) = self.take();
        writer.put(word, len)
    }
}

/// Returns the length of the stream.
fn finish_written(written: &Written, out: &mut [u8]) -> Option<usize> {
    let mut writer = WordWriter::new(out)?;
    writer.advance(written.len as u32);
    let mut pending = Pending {
        bits: written.bits.rotate_right(written.bit_count as u32),
        count: written.bit_count,
    };
    pending.add(Code::END_MARK);
    pending.flush(&mut writer)?;
    writer.finish(pending.count > 0)
}

#[inline(always)]
fn compress_4_streams(
    symbols: &[u8],
    out: &mut [u8],
    compress_1_stream: impl Fn(&[u8], &mut [u8]) -> Option<usize>,
) -> Option<usize> {
    if out.len() < JUMP_TABLE_LEN + 3 + 8 || symbols.len() < 12 {
        return None;
    }
    let (jump_table, streams) = out.split_first_chunk_mut::<JUMP_TABLE_LEN>()?;
    let mut jumps = jump_table.as_chunks_mut().0.iter_mut();
    let mut position = 0;
    for segment in symbols.chunks(symbols.len().div_ceil(4)) {
        let len = compress_1_stream(segment, streams.get_mut(position..)?)?;
        let short_len = u16::try_from(len).ok()?;
        if let Some(jump) = jumps.next() {
            *jump = short_len.to_le_bytes();
        }
        position += len;
    }
    Some(JUMP_TABLE_LEN + position)
}

impl Table {
    pub(super) const EMPTY: Self = Self {
        codes: [Code(0); 256],
        lens: [0; 256],
        per_len: [0; RANKS],
        log: 0,
        max_symbol: 0,
    };

    /// Gives symbols the codes that follow from their lengths.
    fn assign_codes(&mut self) {
        let mut next_value = [0u16; RANKS];
        let mut first = 0;
        for len in (1..=self.log as usize).rev() {
            *next_value.at_mut(len) = first;
            first = (first + self.per_len.at(len)) >> 1;
        }
        let symbols = self.codes.iter_mut().zip(self.lens);
        for (code, len) in symbols.take(self.max_symbol + 1) {
            let value = next_value.at_mut(usize::from(len));
            *code = Code::new(*value, len);
            *value += 1;
        }
    }

    fn set_lens(&mut self, lens: impl Iterator<Item = (u8, u8)>, log: u32, symbol_count: usize) {
        (self.lens, self.per_len) = ([0; _], [0; _]);
        for (symbol, len) in lens {
            *self.lens.at_mut(usize::from(symbol)) = len;
            *self.per_len.at_mut(usize::from(len)) += 1;
        }
        (self.log, self.max_symbol) = (log, symbol_count.saturating_sub(1));
    }

    /// `weights` are those of a valid description.
    pub(super) fn build_from_weights(&mut self, weights: &[u8], log: u32) {
        let present = (0..=u8::MAX)
            .zip(weights)
            .filter(|&(_, &weight)| weight != 0);
        let lens = present.map(|(symbol, weight)| (symbol, log as u8 + 1 - weight));
        self.set_lens(lens, log, weights.len());
        self.assign_codes();
    }

    fn set_limited_lens(&mut self, tree: &mut Tree, limit: u32, symbol_count: usize) {
        let log = limit_code_len(&mut tree.leaves, tree.last_leaf, limit);
        let leaves = tree.leaves.iter().skip(FIRST_LEAF).take(tree.last_leaf);
        self.set_lens(leaves.map(|it| (it.symbol, it.bits)), log, symbol_count);
    }

    /// For `len` symbols. `counts` end with one that occurs, and have another one.
    pub(super) fn build(&mut self, counts: &[u32], len: usize, tries_limits: bool) {
        let mut tree = Tree::new(counts);
        let limit = if tries_limits {
            self.best_limit(&tree, counts)
        } else {
            fse::table_log_for(CODE_LEN_MAX, len, counts.len().saturating_sub(1), 1)
        };
        self.set_limited_lens(&mut tree, limit, counts.len());
        self.assign_codes();
    }

    fn best_limit(&mut self, tree: &Tree, counts: &[u32]) -> u32 {
        let shortest = highest_bit(tree.last_leaf as u32) + 1;
        let (mut best, mut best_len) = (CODE_LEN_MAX, usize::MAX - 1);
        for limit in shortest..=CODE_LEN_MAX {
            self.set_limited_lens(&mut Tree { ..*tree }, limit, counts.len());
            if self.log < limit && limit > shortest {
                break;
            }
            let Ok(description_len) = self.describe(&mut [0; 2 * DESCRIPTION_LEN_MAX]) else {
                continue;
            };
            let len = self.compressed_len(counts) + description_len;
            if len > best_len + 1 {
                break;
            }
            if len < best_len {
                (best, best_len) = (limit, len);
            }
        }
        best
    }

    /// Returns the length of the description.
    pub(super) fn describe(&self, out: &mut [u8]) -> Result<usize> {
        let weight = |len: u8| {
            if len == 0 {
                0
            } else {
                (self.log as u8 + 1).minus(len)
            }
        };
        // `map()` goes byte by byte in hardened builds.
        let mut weights = self.lens;
        for len in &mut weights {
            *len = weight(*len);
        }
        // The last one follows from the others.
        let described = self.max_symbol;
        let last = core::mem::take(weights.at_mut(described));
        let mut per_weight = [0; RANKS];
        for len in 1..=self.log as u8 {
            *per_weight.at_mut(usize::from(weight(len))) =
                u32::from(*self.per_len.at(usize::from(len)));
        }
        *per_weight.at_mut(usize::from(last)) -= 1;
        *per_weight.at_mut(0) = described as u32 - per_weight.iter().sum::<u32>();

        let (header, out) = out.split_first_mut().ok_or(Error::DstSizeTooSmall)?;
        let used = weights.get(..described).unwrap_or_default();
        if let Some(len) = compress_weights(used, &Histogram::new(per_weight), out)?
            && len < described / 2
        {
            *header = len as u8;
            return Ok(1 + len);
        }

        if described > 128 {
            return Err(Error::Internal);
        }
        let len = described.div_ceil(2);
        let out = out.get_mut(..len).ok_or(Error::DstSizeTooSmall)?;
        *header = (127 + described) as u8;
        for (byte, [high, low]) in out.iter_mut().zip(weights.as_chunks().0) {
            *byte = (high << 4) + low;
        }
        Ok(1 + len)
    }

    /// 0 if there is no code for it.
    pub(crate) fn code_len(&self, symbol: usize) -> u32 {
        u32::from(*self.lens.at(symbol))
    }

    pub(super) fn compressed_len(&self, counts: &[u32]) -> usize {
        let pairs = counts.iter().zip(&self.lens);
        let bits = pairs.map(|(&count, &len)| count.times(len.into()));
        (bits.fold(0, u32::plus) / 8) as usize
    }

    pub(super) fn has_codes_for(&self, counts: &[u32]) -> bool {
        let pairs = counts.iter().zip(&self.lens);
        !pairs.fold(false, |misses, (&count, &len)| {
            misses | ((count != 0) & (len == 0))
        })
    }

    /// `N` codes, 7 pending bits and, if `IS_ROOMY`, 4 more bits fit in 64.
    #[inline(always)]
    fn encode<const N: usize, const IS_ROOMY: bool>(
        &self,
        symbols: &[u8],
        writer: &mut WordWriter<'_>,
    ) -> Option<Pending> {
        let code = |symbol: u8| *self.codes.at(usize::from(symbol));
        let add_group = |pending: &mut Pending, group: &[u8; N]| {
            for (index, &symbol) in group.iter().enumerate().rev() {
                if index > 0 || IS_ROOMY {
                    pending.add_if_roomy(code(symbol));
                } else {
                    pending.add(code(symbol));
                }
            }
        };

        let mut pending = Pending::default();
        let (groups, rest) = symbols.as_chunks::<N>();
        if !rest.is_empty() {
            for &symbol in rest.iter().rev() {
                pending.add(code(symbol));
            }
            pending.flush(writer)?;
        }
        let (mut pairs, single) = groups.as_chunks::<2>();
        if let [group] = single {
            add_group(&mut pending, group);
            pending.flush(writer)?;
        }
        // With a check in the middle, the compiler would load all codes first, and run out of registers.
        while let [before @ .., [first, second]] = pairs
            && let Some(room) = likely(writer.two_words())
        {
            add_group(&mut pending, second);
            let (word, len) = pending.take();
            *room.first_chunk_mut()? = word.to_le_bytes();
            // Does not wait for the bits above.
            let mut more = Pending::default();
            add_group(&mut more, first);
            pending.append(more);
            let (word, more_len) = pending.take();
            *room.get_mut(len as usize % 8..)?.first_chunk_mut()? = word.to_le_bytes();
            writer.advance(len + more_len);
            pairs = before;
        }
        for &symbol in pairs.as_flattened().as_flattened().iter().rev() {
            pending.add(code(symbol));
            pending.flush(writer)?;
        }
        Some(pending)
    }

    #[inline(always)]
    fn compress_stream(&self, symbols: &[u8], out: &mut [u8]) -> Option<usize> {
        let mut writer = WordWriter::new(out)?;
        let mut pending = match self.log {
            12.. => self.encode::<4, false>(symbols, &mut writer),
            11 => self.encode::<5, false>(symbols, &mut writer),
            10 => self.encode::<5, true>(symbols, &mut writer),
            9 => self.encode::<6, false>(symbols, &mut writer),
            8 => self.encode::<7, false>(symbols, &mut writer),
            7 => self.encode::<8, false>(symbols, &mut writer),
            _ => self.encode::<9, true>(symbols, &mut writer),
        }?;
        pending.add(Code::END_MARK);
        pending.flush(&mut writer)?;
        writer.finish(pending.count > 0)
    }

    fn compress_1_stream(&self, symbols: &[u8], out: &mut [u8]) -> Option<usize> {
        with_bmi2(
            #[inline(always)]
            move || self.compress_stream(symbols, out),
        )
    }

    #[inline(never)]
    fn compress_in_vectors(&self, symbols: &[u8], out: &mut [u8]) -> Option<usize> {
        let codes = self.codes.map(Code::short);
        compress_4_streams(symbols, out, |symbols, out| {
            match write_codes(symbols, &codes, out) {
                Some(written) => finish_written(&written, out),
                None => self.compress_1_stream(symbols, out),
            }
        })
    }

    /// `None` if there is no room, or too little to compress.
    pub(super) fn compress(
        &self,
        symbols: &[u8],
        out: &mut [u8],
        is_single_stream: bool,
    ) -> Option<usize> {
        if is_single_stream {
            self.compress_1_stream(symbols, out)
        } else if are_quicker_for(symbols.len()) {
            self.compress_in_vectors(symbols, out)
        } else {
            compress_4_streams(symbols, out, |symbols, out| {
                self.compress_1_stream(symbols, out)
            })
        }
    }
}

/// The description of a table that is yet to be written.
pub(crate) struct Description {
    bytes: [u8; DESCRIPTION_LEN_MAX],
    pub(super) len: usize,
}

impl Description {
    pub(super) const EMPTY: Self = Self {
        bytes: [0; DESCRIPTION_LEN_MAX],
        len: 0,
    };

    pub(super) fn of(table: &Table) -> Result<Self> {
        let mut description = Self::EMPTY;
        description.len = table.describe(&mut description.bytes)?;
        Ok(description)
    }

    pub(super) fn write(&self, out: &mut [u8]) -> Option<()> {
        put(out, self.bytes.get(..self.len)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_all_lengths() -> (Table, Vec<u8>) {
        let mut table = Table::EMPTY;
        table.build_from_weights(&[1, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 12);
        (table, (0..300).map(|it| (it * it / 7 % 13) as u8).collect())
    }

    #[test]
    fn a_code_of_one_bit_is_counted_among_the_weights() {
        // One symbol takes half of everything, so its code is a single bit.
        let counts: Vec<u32> = (0..129)
            .map(|it| if it == 0 { 1 << 20 } else { 1 + it % 9 })
            .collect();
        let mut table = Table::EMPTY;
        table.build(&counts, counts.iter().sum::<u32>() as usize, true);
        assert_eq!(
            (table.log, table.code_len(0), table.max_symbol),
            (8, 1, 128)
        );
        let mut out = [0; 2 * DESCRIPTION_LEN_MAX];
        assert_eq!(table.describe(&mut out), Ok(8));
        assert!(out[..8] == [7, 16, 240, 219, 1, 128, 24, 41]);
    }

    #[test]
    fn what_the_kernel_refuses_is_written_without_it() {
        let (table, symbols) = with_all_lengths();
        let mut expected = [0; 400];
        assert_eq!(table.compress(&symbols, &mut expected, false), Some(268));
        for room in 260..400 {
            let mut out = vec![0; room];
            let len = table.compress_in_vectors(&symbols, &mut out);
            assert_eq!(len, table.compress(&symbols, &mut vec![0; room], false));
            assert!(len.is_none_or(|len| out.get(..len) == expected.get(..len)));
        }
    }

    #[test]
    fn what_the_kernel_writes_is_finished() {
        let (table, symbols) = with_all_lengths();
        for count in 0..40 {
            let (symbols, mut out) = (symbols.split_at(300 - count).1, [0; 128]);
            let written = write_codes(symbols, &table.codes.map(Code::short), &mut out);
            let written = written.unwrap_or_default();
            for more in 0..12 {
                let out = out.split_at_mut(written.len as usize + more).0;
                let mut expected = vec![0; out.len()];
                let len = table.compress(symbols, &mut expected, true);
                assert_eq!(finish_written(&written, out), len);
                assert!(len.is_none_or(|len| out.get(..len) == expected.get(..len)));
            }
        }
    }

    #[test]
    fn four_streams_take_12_symbols_and_18_bytes() {
        let (table, _) = with_all_lengths();
        let len = |count, room| table.compress(&vec![1; count], &mut vec![0; room], false);
        assert_eq!([len(11, 99), len(12, 99)], [None, Some(10)]);
        assert_eq!([len(12, 17), len(12, 18)], [None, Some(10)]);
    }

    #[test]
    fn the_length_of_a_stream_fits_in_16_bits() {
        let (table, _) = with_all_lengths();
        let len = |count| table.compress(&vec![0; count], &mut vec![0; 1 << 19], false);
        assert_eq!(len(4 * 43_689), Some(JUMP_TABLE_LEN + 4 * 65_534));
        assert_eq!(len(4 * 43_690), None);
    }
}
