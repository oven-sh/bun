//! Quality 0: finds matches and writes them out in one pass over the input.
//!
//! The prefix code for literals is built from a sample of the block it is used for. The ones for commands and distances
//! are built from the statistics of the block before.

use super::bit_stream::{
    MetaBlockKind, build_and_store_huffman_tree_fast, store_empty_last_meta_block,
    store_huffman_tree, store_meta_block_header, store_trivial_splits_and_contexts,
};
use super::bit_writer::BitWriter;
use super::entropy_encode::{HuffmanNode, convert_bit_depths_to_symbols, create_huffman_tree};
use super::fast_log::{fast_log2, log2_floor_nonzero};
use super::find_match_length::find_match_length_with_limit;
use super::hash::HASH_MUL_32;
use super::params::FAST_COMPRESSION_WINDOW_BITS;
use crate::common::constants::{
    NUM_COMMAND_SYMBOLS, NUM_DISTANCE_SHORT_CODES, NUM_LITERAL_SYMBOLS, WINDOW_GAP,
    max_backward_limit,
};
use crate::util::{Bug, Checked, SliceExt, load_u64_le, try_box};
use bun_core::AllocError;

pub(crate) const MAX_DISTANCE: usize = max_backward_limit(FAST_COMPRESSION_WINDOW_BITS as u32);

pub(crate) struct OnePassScratch {
    lit_depth: [u8; 256],
    lit_bits: [u16; 256],

    /// The prefix codes for commands and for distances of the next block, of 64 symbols each.
    cmd_depth: [u8; 128],
    cmd_bits: [u16; 128],
    cmd_histo: [u32; 128],

    /// Those two codes as they are written to the stream.
    cmd_code: [u8; 512],
    cmd_code_numbits: usize,

    tree: [HuffmanNode; 2 * NUM_LITERAL_SYMBOLS + 1],
    histogram: [u32; 256],
}

impl OnePassScratch {
    /// With the command and distance prefix codes of the first block.
    pub(crate) fn new() -> Result<Box<Self>, AllocError> {
        #[rustfmt::skip]
        const DEFAULT_COMMAND_DEPTHS: [u8; 128] = [
            0, 4, 4, 5, 6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8,
            0, 0, 0, 4, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7,
            7, 7, 10, 10, 10, 10, 10, 10, 0, 4, 4, 5, 5, 5, 6, 6,
            7, 8, 8, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
            5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4,
            4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7, 7, 8, 10,
            12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0, 0, 0, 0,
        ];
        #[rustfmt::skip]
        const DEFAULT_COMMAND_BITS: [u16; 128] = [
            0,   0,   8,   9,   3,  35,   7,   71,
            39, 103,  23,  47, 175, 111, 239,   31,
            0,   0,   0,   4,  12,   2,  10,    6,
            13,  29,  11,  43,  27,  59,  87,   55,
            15,  79, 319, 831, 191, 703, 447,  959,
            0,  14,   1,  25,   5,  21,  19,   51,
            119, 159,  95, 223, 479, 991,  63,  575,
            127, 639, 383, 895, 255, 767, 511, 1023,
            14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            27, 59, 7, 39, 23, 55, 30, 1, 17, 9, 25, 5, 0, 8, 4, 12,
            2, 10, 6, 21, 13, 29, 3, 19, 11, 15, 47, 31, 95, 63, 127, 255,
            767, 2815, 1791, 3839, 511, 2559, 1535, 3583, 1023, 3071, 2047, 4095, 0, 0, 0, 0,
        ];
        #[rustfmt::skip]
        const DEFAULT_COMMAND_CODE: [u8; 57] = [
            0xff, 0x77, 0xd5, 0xbf, 0xe7, 0xde, 0xea, 0x9e, 0x51, 0x5d, 0xde, 0xc6,
            0x70, 0x57, 0xbc, 0x58, 0x58, 0x58, 0xd8, 0xd8, 0x58, 0xd5, 0xcb, 0x8c,
            0xea, 0xe0, 0xc3, 0x87, 0x1f, 0x83, 0xc1, 0x60, 0x1c, 0x67, 0xb2, 0xaa,
            0x06, 0x83, 0xc1, 0x60, 0x30, 0x18, 0xcc, 0xa1, 0xce, 0x88, 0x54, 0x94,
            0x46, 0xe1, 0xb0, 0xd0, 0x4e, 0xb2, 0xf7, 0x04, 0x00,
        ];
        const DEFAULT_COMMAND_CODE_NUM_BITS: usize = 448;
        let mut cmd_code = [0; 512];
        cmd_code
            .split_at_mut(DEFAULT_COMMAND_CODE.len())
            .0
            .copy_from_slice(&DEFAULT_COMMAND_CODE);
        try_box(Self {
            lit_depth: [0; 256],
            lit_bits: [0; 256],
            cmd_depth: DEFAULT_COMMAND_DEPTHS,
            cmd_bits: DEFAULT_COMMAND_BITS,
            cmd_histo: [0; 128],
            cmd_code,
            cmd_code_numbits: DEFAULT_COMMAND_CODE_NUM_BITS,
            tree: [HuffmanNode::new(0, 0, 0); 2 * NUM_LITERAL_SYMBOLS + 1],
            histogram: [0; 256],
        })
    }

    fn build_and_store_command_prefix_code(&mut self, bw: &mut BitWriter<'_>) -> Checked {
        build_and_store_command_prefix_code(
            &self.cmd_histo,
            &mut self.cmd_depth,
            &mut self.cmd_bits,
            CommandWriter::FIRST_INSERT_SYMBOL,
            &mut self.tree,
            bw,
        )
    }
}

/// The shortest copy that is looked for.
const MIN_MATCH: usize = 5;

/// A hash of `bits` bits of the low `len` bytes of `v`.
#[inline(always)]
pub(crate) fn hash_low_bytes(v: u64, len: usize, bits: u32) -> usize {
    ((v << ((8 - len) * 8)).wrapping_mul(u64::from(HASH_MUL_32)) >> (64 - bits)) as usize
}

/// Whether the low `len` bytes of `a` and of `b` are the same.
#[inline(always)]
pub(crate) fn same_low_bytes(a: u64, b: u64, len: usize) -> bool {
    (a ^ b) << ((8 - len) * 8) == 0
}

#[inline(always)]
fn hash<const TABLE_BITS: u32>(v: u64) -> usize {
    hash_low_bytes(v, MIN_MATCH, TABLE_BITS)
}

#[inline(always)]
fn is_match(a: u64, b: u64) -> bool {
    same_low_bytes(a, b, MIN_MATCH)
}

/// Builds a prefix code for literals from `input`, which only approximates the literals that are left once the matches
/// are found, and writes it. Returns an estimate of how well it compresses them, in thousandths of a byte for each.
fn build_and_store_literal_prefix_code(
    s: &mut OnePassScratch,
    input: &[u8],
    bw: &mut BitWriter<'_>,
) -> Checked<usize> {
    let histogram = &mut s.histogram;
    let mut histogram_total;
    histogram.fill(0);

    // The first 11 occurrences of a byte count three times, as frequent bytes are more likely to end up in copies.
    if input.len() < (1 << 15) {
        for &byte in input {
            *histogram.at_mut(usize::from(byte))? += 1;
        }
        histogram_total = input.len();
        for count in histogram.iter_mut() {
            let adjust = 2 * (*count).min(11);
            *count += adjust;
            histogram_total += adjust as usize;
        }
    } else {
        const SAMPLE_RATE: usize = 29;
        for &byte in input.iter().step_by(SAMPLE_RATE) {
            *histogram.at_mut(usize::from(byte))? += 1;
        }
        histogram_total = input.len().div_ceil(SAMPLE_RATE);
        for count in histogram.iter_mut() {
            // A byte that is not in the sample can still be in the input, so every byte gets a code.
            let adjust = 1 + 2 * (*count).min(11);
            *count += adjust;
            histogram_total += adjust as usize;
        }
    }
    // A caller may lend memory that changes while it is read. A byte that was not counted then gets no bits at all, not
    // those that an earlier code had for it.
    s.lit_bits.fill(0);
    build_and_store_huffman_tree_fast(
        &mut s.tree,
        histogram,
        histogram_total,
        8,
        &mut s.lit_depth,
        &mut s.lit_bits,
        bw,
    )?;
    let literal_ratio: usize = histogram
        .iter()
        .zip(&s.lit_depth)
        .map(|(&count, &depth)| (count * u32::from(depth)) as usize)
        .sum();
    Ok(literal_ratio * 125 / histogram_total)
}

/// Builds the prefix codes for commands and for distances from `histo` and writes them. A symbol that does not occur
/// keeps the depth it had.
///
/// Each code has 64 symbols. Those for commands are a part of the full alphabet, in an order of their own that saves a
/// few branches when a command is made. It goes around from `first_insert_symbol` on:
/// - 24 symbols for insert length code 0 to 23 and copy length code 0,
/// - 16 for insert length code 0 and copy length code 0 to 15 at the last distance,
/// - 24 for insert length code 0 and copy length code 0 to 23.
///
/// The first symbols of the first and of the last group stand for the same symbol of the full alphabet. Neither is used.
pub(crate) fn build_and_store_command_prefix_code(
    histo: &[u32; 128],
    depth: &mut [u8; 128],
    bits: &mut [u16; 128],
    first_insert_symbol: usize,
    tree: &mut [HuffmanNode],
    bw: &mut BitWriter<'_>,
) -> Checked {
    /// The groups of 8 symbols, counted from `first_insert_symbol`, in the order of the full alphabet.
    const GROUPS: [usize; 8] = [3, 4, 5, 0, 6, 1, 7, 2];
    let (cmd_histo, dist_histo) = histo.split_at(64);
    let (cmd_depth, dist_depth) = depth.split_at_mut(64);
    let (cmd_bits, dist_bits) = bits.split_at_mut(64);
    let start_of_group = |group: usize| (first_insert_symbol + 8 * group) % 64;

    create_huffman_tree(cmd_histo, 15, tree, cmd_depth)?;
    create_huffman_tree(dist_histo, 14, tree, dist_depth)?;
    // The codes depend on the order of the symbols.
    let mut ordered_depth = [0u8; 64];
    let mut ordered_bits = [0u16; 64];
    for (ordered, &group) in ordered_depth.as_chunks_mut::<8>().0.iter_mut().zip(&GROUPS) {
        *ordered = *cmd_depth.array_at(start_of_group(group))?;
    }
    convert_bit_depths_to_symbols(&ordered_depth, &mut ordered_bits)?;
    for (ordered, &group) in ordered_bits.as_chunks::<8>().0.iter().zip(&GROUPS) {
        *cmd_bits.array_at_mut(start_of_group(group))? = *ordered;
    }
    convert_bit_depths_to_symbols(dist_depth, dist_bits)?;

    let mut full_depth = [0u8; NUM_COMMAND_SYMBOLS];
    for (to, group) in [(0, 3), (64, 4), (128, 5), (192, 6), (384, 7)] {
        full_depth.write_at(to, cmd_depth.array_at::<8>(start_of_group(group))?)?;
    }
    for (to, group) in [(128, 0), (256, 1), (448, 2)] {
        for (i, &depth) in cmd_depth
            .array_at::<8>(start_of_group(group))?
            .iter()
            .enumerate()
        {
            full_depth.put(to + 8 * i, depth)?;
        }
    }
    store_huffman_tree(&full_depth, bw)?;
    store_huffman_tree(dist_depth, bw)
}

/// Takes the symbols for commands and distances.
pub(crate) trait CommandSink {
    /// See [`build_and_store_command_prefix_code`].
    const FIRST_INSERT_SYMBOL: usize;
    const FIRST_COPY_AT_LAST_DISTANCE_SYMBOL: usize = (Self::FIRST_INSERT_SYMBOL + 24) % 64;
    const FIRST_COPY_SYMBOL: usize = (Self::FIRST_INSERT_SYMBOL + 40) % 64;
    const FIRST_DISTANCE_SYMBOL: usize = 64;

    /// `symbol` and then the low `n_extra` bits of `extra`, at most 24. The others are 0.
    fn emit(&mut self, symbol: usize, n_extra: usize, extra: usize) -> Checked;

    #[inline(always)]
    fn emit_insert_len(&mut self, insert_len: usize) -> Checked {
        let first = Self::FIRST_INSERT_SYMBOL;
        if insert_len < 6 {
            self.emit(first + insert_len, 0, 0)
        } else if insert_len < 130 {
            let tail = insert_len - 2;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            let code = (nbits << 1) + prefix + 2;
            self.emit(first + code, nbits, tail - (prefix << nbits))
        } else if insert_len < 2114 {
            let tail = insert_len - 66;
            let nbits = log2_floor_nonzero(tail) as usize;
            self.emit(first + nbits + 10, nbits, tail - (1 << nbits))
        } else if insert_len < 6210 {
            self.emit(first + 21, 12, insert_len - 2114)
        } else if insert_len < 22594 {
            self.emit(first + 22, 14, insert_len - 6210)
        } else {
            self.emit(first + 23, 24, insert_len - 22594)
        }
    }

    #[inline(always)]
    fn emit_copy_len(&mut self, copy_len: usize) -> Checked {
        let first = Self::FIRST_COPY_SYMBOL;
        if copy_len < 10 {
            self.emit(first + copy_len - 2, 0, 0)
        } else if copy_len < 134 {
            let tail = copy_len - 6;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            let code = (nbits << 1) + prefix + 4;
            self.emit(first + code, nbits, tail - (prefix << nbits))
        } else if copy_len < 2118 {
            let tail = copy_len - 70;
            let nbits = log2_floor_nonzero(tail) as usize;
            self.emit(first + nbits + 12, nbits, tail - (1 << nbits))
        } else {
            self.emit(first + 23, 24, copy_len - 2118)
        }
    }

    /// A copy at the distance of the command before, which had copy length 2 and is made longer by this.
    #[inline(always)]
    fn emit_copy_len_last_distance(&mut self, copy_len: usize) -> Checked {
        if copy_len < 12 {
            self.emit(
                Self::FIRST_COPY_AT_LAST_DISTANCE_SYMBOL + copy_len - 4,
                0,
                0,
            )
        } else if copy_len < 72 {
            let tail = copy_len - 8;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            let code = (nbits << 1) + prefix + 4;
            self.emit(
                Self::FIRST_COPY_AT_LAST_DISTANCE_SYMBOL + code,
                nbits,
                tail - (prefix << nbits),
            )
        } else {
            // There is no symbol for so long a copy at the last distance.
            self.emit_copy_len(copy_len - 2)?;
            self.emit_last_distance()
        }
    }

    #[inline(always)]
    fn emit_last_distance(&mut self) -> Checked {
        self.emit(Self::FIRST_DISTANCE_SYMBOL, 0, 0)
    }

    #[inline(always)]
    fn emit_distance(&mut self, distance: usize) -> Checked {
        let d = distance + 3;
        let nbits = log2_floor_nonzero(d) as usize - 1;
        let prefix = (d >> nbits) & 1;
        let offset = (2 + prefix) << nbits;
        let code = NUM_DISTANCE_SHORT_CODES as usize + 2 * (nbits - 1) + prefix;
        self.emit(Self::FIRST_DISTANCE_SYMBOL + code, nbits, d - offset)
    }
}

/// Writes commands and distances and counts them.
struct CommandWriter<'a, 'b> {
    depth: &'a [u8; 128],
    bits: &'a [u16; 128],
    histo: &'a mut [u32; 128],
    bw: &'a mut BitWriter<'b>,
}

impl CommandSink for CommandWriter<'_, '_> {
    const FIRST_INSERT_SYMBOL: usize = 40;

    #[inline(always)]
    fn emit(&mut self, symbol: usize, n_extra: usize, extra: usize) -> Checked {
        let depth = usize::from(self.depth.at(symbol)?);
        self.bw.write_bits(
            depth + n_extra,
            u64::from(self.bits.at(symbol)?) | ((extra as u64) << depth),
        )?;
        *self.histo.at_mut(symbol)? += 1;
        Ok(())
    }
}

#[inline(always)]
pub(crate) fn emit_literals(
    literals: &[u8],
    depth: &[u8; 256],
    bits: &[u16; 256],
    bw: &mut BitWriter<'_>,
) -> Checked {
    // No code is longer than 14 bits, so 4 of them fit in one write.
    let (chunks, rest) = literals.as_chunks::<4>();
    for chunk in chunks {
        let (mut n_bits, mut v) = (0, 0);
        for &lit in chunk {
            let lit = usize::from(lit);
            v |= u64::from(bits.at(lit)?) << n_bits;
            n_bits += usize::from(depth.at(lit)?);
        }
        bw.write_bits(n_bits, v)?;
    }
    for &lit in rest {
        let lit = usize::from(lit);
        bw.write_bits(usize::from(depth.at(lit)?), u64::from(bits.at(lit)?))?;
    }
    Ok(())
}

/// Overwrites the `n_bits` bits from bit `pos` of `array` on.
fn update_bits(mut n_bits: usize, mut bits: u32, mut pos: usize, array: &mut [u8]) -> Checked {
    while n_bits > 0 {
        let byte_pos = pos >> 3;
        let n_unchanged_bits = pos & 7;
        let n_changed_bits = n_bits.min(8 - n_unchanged_bits);
        let total_bits = n_unchanged_bits + n_changed_bits;
        let mask = !((1u32 << total_bits) - 1) | ((1u32 << n_unchanged_bits) - 1);
        let unchanged_bits = u32::from(array.at(byte_pos)?) & mask;
        let changed_bits = bits & ((1u32 << n_changed_bits) - 1);
        array.put(
            byte_pos,
            ((changed_bits << n_unchanged_bits) | unchanged_bits) as u8,
        )?;
        n_bits -= n_changed_bits;
        bits >>= n_changed_bits;
        pos += n_changed_bits;
    }
    Ok(())
}

/// Whether the literal code with code lengths `depths` suits `data` well enough to go on with it.
fn should_merge_block(histo: &mut [u32; 256], data: &[u8], depths: &[u8; 256]) -> Checked<bool> {
    const SAMPLE_RATE: usize = 43;
    histo.fill(0);
    for &byte in data.iter().step_by(SAMPLE_RATE) {
        *histo.at_mut(usize::from(byte))? += 1;
    }
    let total = data.len().div_ceil(SAMPLE_RATE);
    let mut r = (fast_log2(total) + 0.5) * total as f64 + 200.0;
    for (&count, &depth) in histo.iter().zip(depths) {
        r -= f64::from(count) * (f64::from(depth) + fast_log2(count as usize));
    }
    Ok(r >= 0.0)
}

/// A loss of 2% is acceptable for the speed gained on data that does not compress.
const MIN_RATIO: usize = 980;

/// `compressed` is how much of the meta-block was already written when `insert_len` literals come up.
#[inline(always)]
fn should_use_uncompressed_mode(
    compressed: usize,
    insert_len: usize,
    literal_ratio: usize,
) -> bool {
    if compressed * 50 > insert_len {
        false
    } else {
        literal_ratio > MIN_RATIO
    }
}

/// Replaces what was written from `storage_ix_start` on by `bytes` as they are.
fn emit_uncompressed_meta_block(
    bytes: &[u8],
    storage_ix_start: usize,
    bw: &mut BitWriter<'_>,
) -> Checked {
    bw.rewind(storage_ix_start)?;
    store_meta_block_header(bytes.len(), MetaBlockKind::Uncompressed, bw)?;
    bw.jump_to_byte_boundary()?;
    bw.write_bytes(bytes)
}

#[rustfmt::skip]
static CMD_HISTO_SEED: [u32; 128] = [
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 0, 0, 0, 0,
];

/// How the search for matches in a block ended.
enum Scan {
    /// At the end of the block.
    EndOfBlock,
    /// At `end`, with so many literals before it that the meta-block is better not compressed.
    Uncompressed { end: usize },
}

fn compress_fragment_fast_impl<const TABLE_BITS: u32, const TABLE_SIZE: usize>(
    s: &mut OnePassScratch,
    all_input: &[u8],
    is_last: bool,
    table: &mut [i32; TABLE_SIZE],
    bw: &mut BitWriter<'_>,
) -> Checked {
    const FIRST_BLOCK_SIZE: usize = 3 << 15;
    const MERGE_BLOCK_SIZE: usize = 1 << 16;
    const INPUT_MARGIN_BYTES: usize = WINDOW_GAP;

    // All positions are indices of `all_input`. `input` is where the current block starts and `input_size` how much there
    // is from there on.
    let mut input = 0usize;
    let mut input_size = all_input.len();
    // The first byte that no copy covers yet. What lies between it and the next copy is written as literals.
    let mut next_emit = 0usize;

    let mut meta_block_start = input;
    let mut block_size = input_size.min(FIRST_BLOCK_SIZE);
    let mut total_block_size = block_size;
    // Where the MLEN field of the meta-block header is, in case the meta-block is made longer.
    let mut mlen_storage_ix = bw.pos() + 3;

    store_meta_block_header(block_size, MetaBlockKind::Compressed, bw)?;
    store_trivial_splits_and_contexts(bw)?;

    let mut literal_ratio =
        build_and_store_literal_prefix_code(s, all_input.sub(input..input + block_size)?, bw)?;

    let mut i = 0;
    while i + 7 < s.cmd_code_numbits {
        bw.write_bits(8, u64::from(s.cmd_code.at(i >> 3)?))?;
        i += 8;
    }
    bw.write_bits(
        s.cmd_code_numbits & 7,
        u64::from(s.cmd_code.at(s.cmd_code_numbits >> 3)?),
    )?;

    loop {
        // The statistics of this block decide on the codes for commands and distances of the next one.
        s.cmd_histo = CMD_HISTO_SEED;
        let mut cmd = CommandWriter {
            depth: &s.cmd_depth,
            bits: &s.cmd_bits,
            histo: &mut s.cmd_histo,
            bw,
        };
        let (lit_depth, lit_bits) = (&s.lit_depth, &s.lit_bits);

        let mut ip = input;
        let mut last_distance = -1i32;
        let ip_end = input + block_size;

        let scan = 'scan: {
            if block_size < INPUT_MARGIN_BYTES {
                break 'scan Scan::EndOfBlock;
            }
            // The last block keeps a margin of 16 bytes, so that no distance is more than the window size - 16. For the
            // others 5 bytes are enough to keep a copy from going past the end of the block.
            let len_limit = (block_size - MIN_MATCH).min(input_size - INPUT_MARGIN_BYTES);
            let ip_limit = input + len_limit;

            ip += 1;
            let mut next_bytes = load_u64_le(all_input, ip)?;
            loop {
                // Step 1: look for a match of `MIN_MATCH` bytes.
                //
                // After 32 bytes without one only every other byte is looked at, after 32 more every third, and so on.
                // This costs little on data that compresses and saves a lot of time on data that does not.
                let mut skip = 32u32;

                let mut next_ip = ip;
                let mut candidate;
                loop {
                    let bytes = next_bytes;
                    let hash_now = hash::<TABLE_BITS>(bytes);
                    let bytes_between_hash_lookups = (skip >> 5) as usize;
                    skip += 1;
                    ip = next_ip;
                    next_ip = ip + bytes_between_hash_lookups;
                    if next_ip > ip_limit {
                        break 'scan Scan::EndOfBlock;
                    }
                    next_bytes = load_u64_le(all_input, next_ip)?;
                    candidate = ip.wrapping_sub(last_distance as isize as usize);
                    let found =
                        if candidate < ip && is_match(bytes, load_u64_le(all_input, candidate)?) {
                            table.put(hash_now, ip as i32)?;
                            true
                        } else {
                            candidate = table.at(hash_now)? as usize;
                            table.put(hash_now, ip as i32)?;
                            is_match(bytes, load_u64_le(all_input, candidate)?)
                        };
                    if found && ip - candidate <= MAX_DISTANCE {
                        break;
                    }
                }

                // Step 2: write the literals up to the match and the match, and then more matches for as long as one
                // follows the other.
                {
                    let base = ip;
                    let matched = MIN_MATCH
                        + find_match_length_with_limit(
                            all_input.sub(candidate + MIN_MATCH..)?,
                            all_input.sub(ip + MIN_MATCH..)?,
                            ip_end - ip - MIN_MATCH,
                        );
                    let distance = (base - candidate) as i32;
                    let insert = base - next_emit;
                    ip += matched;
                    if insert < 6210 {
                        cmd.emit_insert_len(insert)?;
                    } else if should_use_uncompressed_mode(
                        next_emit - meta_block_start,
                        insert,
                        literal_ratio,
                    ) {
                        break 'scan Scan::Uncompressed { end: base };
                    } else {
                        cmd.emit_insert_len(insert)?;
                    }
                    emit_literals(
                        all_input.sub(next_emit..next_emit + insert)?,
                        lit_depth,
                        lit_bits,
                        cmd.bw,
                    )?;
                    if distance == last_distance {
                        cmd.emit_last_distance()?;
                    } else {
                        cmd.emit_distance(distance as usize)?;
                        last_distance = distance;
                    }
                    cmd.emit_copy_len_last_distance(matched)?;

                    next_emit = ip;
                    if ip >= ip_limit {
                        break 'scan Scan::EndOfBlock;
                    }
                }
                loop {
                    // Some positions within the last copy go into the table, which helps compression.
                    let input_bytes = load_u64_le(all_input, ip - 3)?;
                    table.put(hash::<TABLE_BITS>(input_bytes), (ip - 3) as i32)?;
                    table.put(hash::<TABLE_BITS>(input_bytes >> 8), (ip - 2) as i32)?;
                    table.put(hash::<TABLE_BITS>(input_bytes >> 16), (ip - 1) as i32)?;
                    let cur_hash = hash::<TABLE_BITS>(input_bytes >> 24);
                    candidate = table.at(cur_hash)? as usize;
                    table.put(cur_hash, ip as i32)?;

                    if !is_match(input_bytes >> 24, load_u64_le(all_input, candidate)?) {
                        break;
                    }
                    // A match right after the last one, with no literals in between.
                    let base = ip;
                    let matched = MIN_MATCH
                        + find_match_length_with_limit(
                            all_input.sub(candidate + MIN_MATCH..)?,
                            all_input.sub(ip + MIN_MATCH..)?,
                            ip_end - ip - MIN_MATCH,
                        );
                    if ip - candidate > MAX_DISTANCE {
                        break;
                    }
                    ip += matched;
                    last_distance = (base - candidate) as i32;
                    cmd.emit_copy_len(matched)?;
                    cmd.emit_distance(last_distance as usize)?;

                    next_emit = ip;
                    if ip >= ip_limit {
                        break 'scan Scan::EndOfBlock;
                    }
                }

                ip += 1;
                next_bytes = load_u64_le(all_input, ip)?;
            }
        };

        if let Scan::Uncompressed { end } = scan {
            emit_uncompressed_meta_block(
                all_input.sub(meta_block_start..end)?,
                mlen_storage_ix - 3,
                cmd.bw,
            )?;
            input_size -= end - input;
            input = end;
            next_emit = input;
        } else {
            input += block_size;
            input_size -= block_size;
            block_size = input_size.min(MERGE_BLOCK_SIZE);

            // Rather than end the meta-block with a command that only inserts, go on with it if that pays off.
            if input_size > 0
                && total_block_size + block_size <= (1 << 20)
                && should_merge_block(
                    &mut s.histogram,
                    all_input.sub(input..input + block_size)?,
                    lit_depth,
                )?
            {
                // The old and the new size both take 5 nibbles, so the header can be changed in place.
                total_block_size += block_size;
                update_bits(
                    20,
                    (total_block_size - 1) as u32,
                    mlen_storage_ix,
                    cmd.bw.storage(),
                )?;
                continue;
            }

            if next_emit < ip_end {
                let insert = ip_end - next_emit;
                if insert < 6210 {
                    cmd.emit_insert_len(insert)?;
                    emit_literals(
                        all_input.sub(next_emit..ip_end)?,
                        lit_depth,
                        lit_bits,
                        cmd.bw,
                    )?;
                } else if should_use_uncompressed_mode(
                    next_emit - meta_block_start,
                    insert,
                    literal_ratio,
                ) {
                    emit_uncompressed_meta_block(
                        all_input.sub(meta_block_start..ip_end)?,
                        mlen_storage_ix - 3,
                        cmd.bw,
                    )?;
                } else {
                    cmd.emit_insert_len(insert)?;
                    emit_literals(
                        all_input.sub(next_emit..ip_end)?,
                        lit_depth,
                        lit_bits,
                        cmd.bw,
                    )?;
                }
            }
            next_emit = ip_end;
        }

        if input_size == 0 {
            break;
        }
        // A new meta-block, with new prefix codes.
        meta_block_start = input;
        block_size = input_size.min(FIRST_BLOCK_SIZE);
        total_block_size = block_size;
        mlen_storage_ix = bw.pos() + 3;
        store_meta_block_header(block_size, MetaBlockKind::Compressed, bw)?;
        store_trivial_splits_and_contexts(bw)?;
        literal_ratio =
            build_and_store_literal_prefix_code(s, all_input.sub(input..input + block_size)?, bw)?;
        s.build_and_store_command_prefix_code(bw)?;
    }

    if !is_last {
        // The codes for commands and distances of the next call.
        let mut cmd_code = [0u8; 512];
        let mut cmd_code_writer = BitWriter::new(&mut cmd_code, 0)?;
        s.build_and_store_command_prefix_code(&mut cmd_code_writer)?;
        s.cmd_code_numbits = cmd_code_writer.pos();
        s.cmd_code = cmd_code;
    }
    Ok(())
}

/// Writes `input`, of at most `1 << 24` bytes, as one or more meta-blocks, and an empty last meta-block if `is_last`.
/// Without that, `input` is not empty.
///
/// `table` is all 0 and its length is 2 to the power of 9, 11, 13 or 15. No copy reaches back before `input`.
pub(crate) fn compress_fragment_fast(
    s: &mut OnePassScratch,
    input: &[u8],
    is_last: bool,
    table: &mut [i32],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let initial_storage_ix = bw.pos();

    if input.is_empty() {
        debug_assert!(is_last);
        return store_empty_last_meta_block(bw);
    }

    macro_rules! run {
        ($bits:literal) => {
            compress_fragment_fast_impl::<$bits, { 1 << $bits }>(
                s,
                input,
                is_last,
                table.try_into().map_err(|_| Bug)?,
                bw,
            )
        };
    }
    match table.len().trailing_zeros() {
        9 => run!(9),
        11 => run!(11),
        13 => run!(13),
        15 => run!(15),
        _ => Err(Bug),
    }?;

    // If that took more room than the input as it is, write that instead.
    if bw.pos() - initial_storage_ix > 31 + (input.len() << 3) {
        emit_uncompressed_meta_block(input, initial_storage_ix, bw)?;
    }

    if is_last {
        store_empty_last_meta_block(bw)?;
    }
    Ok(())
}
