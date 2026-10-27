//! Quality 0: finds matches and writes them out in one pass over the input.
//!
//! The prefix code for literals is built from a sample of the block it is used for. The ones for commands and distances
//! are built from the statistics of the block before.

use super::bit_writer::BitWriter;
use super::brotli_bit_stream::{build_and_store_huffman_tree_fast, store_huffman_tree};
use super::entropy_encode::{HuffmanTree, convert_bit_depths_to_symbols, create_huffman_tree};
use super::fast_log::{fast_log2, log2_floor_nonzero};
use super::find_match_length::find_match_length_with_limit;
use super::hash::HASH_MUL_32;
use crate::common::constants::{NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS, WINDOW_GAP, max_backward_limit};
use crate::util::{Checked, SliceExt, load_u32_le, load_u64_le};

const MAX_DISTANCE: usize = max_backward_limit(18);

pub(crate) struct OnePassArena {
    lit_depth: [u8; 256],
    lit_bits: [u16; 256],

    /// The prefix codes for commands and for distances of the next block, of 64 symbols each. The symbols for commands
    /// are a part of the full alphabet, in an order of their own:
    /// - 0 to 15: insert length code 0, copy length code 0 to 15, same distance
    /// - 16 to 39: insert length code 0, copy length code 0 to 23
    /// - 40 to 63: insert length code 0 to 23, copy length code 0
    ///
    /// 16 and 40 stand for the same symbol of the full alphabet. Neither is used.
    pub(crate) cmd_depth: [u8; 128],
    pub(crate) cmd_bits: [u16; 128],
    cmd_histo: [u32; 128],

    /// Those two codes as they are written to the stream.
    pub(crate) cmd_code: [u8; 512],
    pub(crate) cmd_code_numbits: usize,

    tree: [HuffmanTree; 2 * NUM_LITERAL_SYMBOLS + 1],
    histogram: [u32; 256],
    tmp_depth: [u8; NUM_COMMAND_SYMBOLS],
    tmp_bits: [u16; 64],
}

impl OnePassArena {
    pub(crate) fn new() -> Box<Self> {
        Box::new(Self {
            lit_depth: [0; 256],
            lit_bits: [0; 256],
            cmd_depth: [0; 128],
            cmd_bits: [0; 128],
            cmd_histo: [0; 128],
            cmd_code: [0; 512],
            cmd_code_numbits: 0,
            tree: [HuffmanTree::new(0, 0, 0); 2 * NUM_LITERAL_SYMBOLS + 1],
            histogram: [0; 256],
            tmp_depth: [0; NUM_COMMAND_SYMBOLS],
            tmp_bits: [0; 64],
        })
    }
}

/// A hash of the 5 bytes at `p`.
#[inline(always)]
fn hash(input: &[u8], p: usize, shift: usize) -> Checked<usize> {
    let h = (load_u64_le(input, p)? << 24).wrapping_mul(u64::from(HASH_MUL_32));
    Ok((h >> shift) as u32 as usize)
}

/// A hash of the 5 bytes from byte `offset` of `v` on. `offset` is at most 3.
#[inline(always)]
fn hash_bytes_at_offset(v: u64, offset: u32, shift: usize) -> usize {
    let h = ((v >> (8 * offset)) << 24).wrapping_mul(u64::from(HASH_MUL_32));
    (h >> shift) as u32 as usize
}

/// Whether the 5 bytes at `p1` and at `p2` are the same.
#[inline(always)]
fn is_match(input: &[u8], p1: usize, p2: usize) -> Checked<bool> {
    Ok(load_u32_le(input, p1)? == load_u32_le(input, p2)? && input.at(p1 + 4)? == input.at(p2 + 4)?)
}

/// Builds a prefix code for literals from `input`, which only approximates the literals that are left once the matches
/// are found, and writes it. Returns an estimate of how well it compresses them, in thousandths of a byte for each.
fn build_and_store_literal_prefix_code(s: &mut OnePassArena, input: &[u8], bw: &mut BitWriter<'_>) -> Checked<usize> {
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
    build_and_store_huffman_tree_fast(
        &mut s.tree,
        histogram,
        histogram_total,
        8,
        &mut s.lit_depth,
        &mut s.lit_bits,
        bw,
    )?;
    let literal_ratio: usize =
        histogram.iter().zip(&s.lit_depth).map(|(&count, &depth)| (count * u32::from(depth)) as usize).sum();
    Ok(literal_ratio * 125 / histogram_total)
}

/// Builds the prefix codes for commands and for distances from `s.cmd_histo` and writes them. A symbol that does not
/// occur keeps the depth it had.
fn build_and_store_command_prefix_code(s: &mut OnePassArena, bw: &mut BitWriter<'_>) -> Checked {
    let (cmd_histo, dist_histo) = s.cmd_histo.split_at(64);
    let (cmd_depth, dist_depth) = s.cmd_depth.split_at_mut(64);
    let (cmd_bits, dist_bits) = s.cmd_bits.split_at_mut(64);
    let tmp_depth = &mut s.tmp_depth;
    let tmp_bits = &mut s.tmp_bits;
    tmp_depth.fill(0);

    create_huffman_tree(cmd_histo, 15, &mut s.tree, cmd_depth)?;
    create_huffman_tree(dist_histo, 14, &mut s.tree, dist_depth)?;
    // The codes depend on the order of the symbols in the full alphabet, which is another one. The order here saves a
    // few branches when commands are written.
    for (to, from, len) in [(0, 0, 24), (24, 40, 8), (32, 24, 8), (40, 48, 8), (48, 32, 8), (56, 56, 8)] {
        tmp_depth.write_at(to, cmd_depth.sub(from..from + len)?)?;
    }
    convert_bit_depths_to_symbols(tmp_depth.sub(..64)?, tmp_bits)?;
    for (to, from, len) in [(0, 0, 24), (24, 32, 8), (32, 48, 8), (40, 24, 8), (48, 40, 8), (56, 56, 8)] {
        cmd_bits.write_at(to, tmp_bits.sub(from..from + len)?)?;
    }
    convert_bit_depths_to_symbols(dist_depth, dist_bits)?;
    // The code lengths of the full alphabet.
    tmp_depth.sub_mut(..64)?.fill(0);
    for (to, from) in [(0, 0), (64, 8), (128, 16), (192, 24), (384, 32)] {
        tmp_depth.write_at(to, cmd_depth.sub(from..from + 8)?)?;
    }
    for i in 0..8 {
        tmp_depth.put(128 + 8 * i, cmd_depth.at(40 + i)?)?;
        tmp_depth.put(256 + 8 * i, cmd_depth.at(48 + i)?)?;
        tmp_depth.put(448 + 8 * i, cmd_depth.at(56 + i)?)?;
    }
    store_huffman_tree(tmp_depth, &mut s.tree, bw)?;
    store_huffman_tree(dist_depth, &mut s.tree, bw)
}

/// Writes commands and distances and counts them.
struct CommandWriter<'a> {
    depth: &'a [u8; 128],
    bits: &'a [u16; 128],
    histo: &'a mut [u32; 128],
}

impl CommandWriter<'_> {
    #[inline(always)]
    fn emit(&mut self, code: usize, bw: &mut BitWriter<'_>) -> Checked {
        bw.write_bits(usize::from(self.depth.at(code)?), u64::from(self.bits.at(code)?))?;
        *self.histo.at_mut(code)? += 1;
        Ok(())
    }

    /// `insertlen` is less than 6210.
    #[inline(always)]
    fn emit_insert_len(&mut self, insertlen: usize, bw: &mut BitWriter<'_>) -> Checked {
        if insertlen < 6 {
            self.emit(insertlen + 40, bw)
        } else if insertlen < 130 {
            let tail = insertlen - 2;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            self.emit((nbits << 1) + prefix + 42, bw)?;
            bw.write_bits(nbits, (tail - (prefix << nbits)) as u64)
        } else if insertlen < 2114 {
            let tail = insertlen - 66;
            let nbits = log2_floor_nonzero(tail) as usize;
            self.emit(nbits + 50, bw)?;
            bw.write_bits(nbits, (tail - (1 << nbits)) as u64)
        } else {
            self.emit(61, bw)?;
            bw.write_bits(12, (insertlen - 2114) as u64)
        }
    }

    #[inline(always)]
    fn emit_long_insert_len(&mut self, insertlen: usize, bw: &mut BitWriter<'_>) -> Checked {
        if insertlen < 22594 {
            self.emit(62, bw)?;
            bw.write_bits(14, (insertlen - 6210) as u64)
        } else {
            self.emit(63, bw)?;
            bw.write_bits(24, (insertlen - 22594) as u64)
        }
    }

    #[inline(always)]
    fn emit_copy_len(&mut self, copylen: usize, bw: &mut BitWriter<'_>) -> Checked {
        if copylen < 10 {
            self.emit(copylen + 14, bw)
        } else if copylen < 134 {
            let tail = copylen - 6;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            self.emit((nbits << 1) + prefix + 20, bw)?;
            bw.write_bits(nbits, (tail - (prefix << nbits)) as u64)
        } else if copylen < 2118 {
            let tail = copylen - 70;
            let nbits = log2_floor_nonzero(tail) as usize;
            self.emit(nbits + 28, bw)?;
            bw.write_bits(nbits, (tail - (1 << nbits)) as u64)
        } else {
            self.emit(39, bw)?;
            bw.write_bits(24, (copylen - 2118) as u64)
        }
    }

    /// A copy at the distance of the command before, which had copy length 2 and is made longer by this.
    #[inline(always)]
    fn emit_copy_len_last_distance(&mut self, copylen: usize, bw: &mut BitWriter<'_>) -> Checked {
        if copylen < 12 {
            self.emit(copylen - 4, bw)
        } else if copylen < 72 {
            let tail = copylen - 8;
            let nbits = log2_floor_nonzero(tail) as usize - 1;
            let prefix = tail >> nbits;
            self.emit((nbits << 1) + prefix + 4, bw)?;
            bw.write_bits(nbits, (tail - (prefix << nbits)) as u64)
        } else if copylen < 136 {
            let tail = copylen - 8;
            self.emit((tail >> 5) + 30, bw)?;
            bw.write_bits(5, (tail & 31) as u64)?;
            self.emit(64, bw)
        } else if copylen < 2120 {
            let tail = copylen - 72;
            let nbits = log2_floor_nonzero(tail) as usize;
            self.emit(nbits + 28, bw)?;
            bw.write_bits(nbits, (tail - (1 << nbits)) as u64)?;
            self.emit(64, bw)
        } else {
            self.emit(39, bw)?;
            bw.write_bits(24, (copylen - 2120) as u64)?;
            self.emit(64, bw)
        }
    }

    #[inline(always)]
    fn emit_distance(&mut self, distance: usize, bw: &mut BitWriter<'_>) -> Checked {
        let d = distance + 3;
        let nbits = log2_floor_nonzero(d) as usize - 1;
        let prefix = (d >> nbits) & 1;
        let offset = (2 + prefix) << nbits;
        self.emit(2 * (nbits - 1) + prefix + 80, bw)?;
        bw.write_bits(nbits, (d - offset) as u64)
    }
}

#[inline(always)]
fn emit_literals(literals: &[u8], depth: &[u8; 256], bits: &[u16; 256], bw: &mut BitWriter<'_>) -> Checked {
    for &lit in literals {
        let lit = usize::from(lit);
        bw.write_bits(usize::from(depth.at(lit)?), u64::from(bits.at(lit)?))?;
    }
    Ok(())
}

/// `len` is at most `1 << 24`.
pub(crate) fn store_meta_block_header(len: usize, is_uncompressed: bool, bw: &mut BitWriter<'_>) -> Checked {
    let nibbles = if len <= (1 << 16) {
        4
    } else if len <= (1 << 20) {
        5
    } else {
        6
    };
    // ISLAST
    bw.write_bits(1, 0)?;
    bw.write_bits(2, nibbles - 4)?;
    bw.write_bits(nibbles as usize * 4, len as u64 - 1)?;
    // ISUNCOMPRESSED
    bw.write_bits(1, u64::from(is_uncompressed))
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
        array.put(byte_pos, ((changed_bits << n_unchanged_bits) | unchanged_bits) as u8)?;
        n_bits -= n_changed_bits;
        bits >>= n_changed_bits;
        pos += n_changed_bits;
    }
    Ok(())
}

pub(crate) fn rewind_bit_position(new_storage_ix: usize, bw: &mut BitWriter<'_>) -> Checked {
    let bitpos = new_storage_ix & 7;
    let mask = (1u32 << bitpos) - 1;
    *bw.storage.at_mut(new_storage_ix >> 3)? &= mask as u8;
    bw.pos = new_storage_ix;
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

/// `compressed` is how much of the meta-block was already written when `insertlen` literals come up.
#[inline(always)]
fn should_use_uncompressed_mode(compressed: usize, insertlen: usize, literal_ratio: usize) -> bool {
    if compressed * 50 > insertlen { false } else { literal_ratio > MIN_RATIO }
}

/// Replaces what was written from `storage_ix_start` on by `bytes` as they are.
fn emit_uncompressed_meta_block(bytes: &[u8], storage_ix_start: usize, bw: &mut BitWriter<'_>) -> Checked {
    rewind_bit_position(storage_ix_start, bw)?;
    store_meta_block_header(bytes.len(), true, bw)?;
    bw.pos = (bw.pos + 7) & !7;
    bw.write_bytes(bytes)?;
    bw.prepare_storage()
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
    EmitRemainder,
    /// With the meta-block replaced by an uncompressed one.
    NextBlock,
}

fn compress_fragment_fast_impl(
    s: &mut OnePassArena,
    all_input: &[u8],
    is_last: bool,
    table: &mut [i32],
    table_bits: usize,
    bw: &mut BitWriter<'_>,
) -> Checked {
    const FIRST_BLOCK_SIZE: usize = 3 << 15;
    const MERGE_BLOCK_SIZE: usize = 1 << 16;
    const INPUT_MARGIN_BYTES: usize = WINDOW_GAP;
    const MIN_MATCH_LEN: usize = 5;

    // All positions are indices of `all_input`. `input` is where the current block starts and `input_size` how much there
    // is from there on.
    let mut input = 0usize;
    let mut input_size = all_input.len();
    // The first byte that no copy covers yet. What lies between it and the next copy is written as literals.
    let mut next_emit = 0usize;

    let mut metablock_start = input;
    let mut block_size = input_size.min(FIRST_BLOCK_SIZE);
    let mut total_block_size = block_size;
    // Where the MLEN field of the meta-block header is, in case the meta-block is made longer.
    let mut mlen_storage_ix = bw.pos + 3;

    let shift = 64 - table_bits;

    store_meta_block_header(block_size, false, bw)?;
    // No block splits, no contexts.
    bw.write_bits(13, 0)?;

    let mut literal_ratio = build_and_store_literal_prefix_code(s, all_input.sub(input..input + block_size)?, bw)?;

    let mut i = 0;
    while i + 7 < s.cmd_code_numbits {
        bw.write_bits(8, u64::from(s.cmd_code.at(i >> 3)?))?;
        i += 8;
    }
    bw.write_bits(s.cmd_code_numbits & 7, u64::from(s.cmd_code.at(s.cmd_code_numbits >> 3)?))?;

    loop {
        // The statistics of this block decide on the codes for commands and distances of the next one.
        s.cmd_histo = CMD_HISTO_SEED;
        let mut cmd = CommandWriter { depth: &s.cmd_depth, bits: &s.cmd_bits, histo: &mut s.cmd_histo };
        let (lit_depth, lit_bits) = (&s.lit_depth, &s.lit_bits);

        let mut ip = input;
        let mut last_distance = -1i32;
        let ip_end = input + block_size;

        let scan = 'scan: {
            if block_size < INPUT_MARGIN_BYTES {
                break 'scan Scan::EmitRemainder;
            }
            // The last block keeps a margin of 16 bytes, so that no distance is more than the window size - 16. For the
            // others 5 bytes are enough to keep a copy from going past the end of the block.
            let len_limit = (block_size - MIN_MATCH_LEN).min(input_size - INPUT_MARGIN_BYTES);
            let ip_limit = input + len_limit;

            ip += 1;
            let mut next_hash = hash(all_input, ip, shift)?;
            loop {
                // Step 1: look for a match of 5 bytes.
                //
                // After 32 bytes without one only every other byte is looked at, after 32 more every third, and so on.
                // This costs little on data that compresses and saves a lot of time on data that does not.
                let mut skip = 32u32;

                let mut next_ip = ip;
                let mut candidate;
                loop {
                    let hash_now = next_hash;
                    let bytes_between_hash_lookups = (skip >> 5) as usize;
                    skip += 1;
                    ip = next_ip;
                    next_ip = ip + bytes_between_hash_lookups;
                    if next_ip > ip_limit {
                        break 'scan Scan::EmitRemainder;
                    }
                    next_hash = hash(all_input, next_ip, shift)?;
                    candidate = ip.wrapping_sub(last_distance as isize as usize);
                    let found = if is_match(all_input, ip, candidate)? && candidate < ip {
                        table.put(hash_now, ip as i32)?;
                        true
                    } else {
                        candidate = table.at(hash_now)? as usize;
                        table.put(hash_now, ip as i32)?;
                        is_match(all_input, ip, candidate)?
                    };
                    if found && ip - candidate <= MAX_DISTANCE {
                        break;
                    }
                }

                // Step 2: write the literals up to the match and the match, and then more matches for as long as one
                // follows the other.
                {
                    let base = ip;
                    let matched = 5
                        + find_match_length_with_limit(
                            all_input.sub(candidate + 5..)?,
                            all_input.sub(ip + 5..)?,
                            ip_end - ip - 5,
                        );
                    let distance = (base - candidate) as i32;
                    let insert = base - next_emit;
                    ip += matched;
                    if insert < 6210 {
                        cmd.emit_insert_len(insert, bw)?;
                    } else if should_use_uncompressed_mode(next_emit - metablock_start, insert, literal_ratio) {
                        emit_uncompressed_meta_block(all_input.sub(metablock_start..base)?, mlen_storage_ix - 3, bw)?;
                        input_size -= base - input;
                        input = base;
                        next_emit = input;
                        break 'scan Scan::NextBlock;
                    } else {
                        cmd.emit_long_insert_len(insert, bw)?;
                    }
                    emit_literals(all_input.sub(next_emit..next_emit + insert)?, lit_depth, lit_bits, bw)?;
                    if distance == last_distance {
                        cmd.emit(64, bw)?;
                    } else {
                        cmd.emit_distance(distance as usize, bw)?;
                        last_distance = distance;
                    }
                    cmd.emit_copy_len_last_distance(matched, bw)?;

                    next_emit = ip;
                    if ip >= ip_limit {
                        break 'scan Scan::EmitRemainder;
                    }
                }
                loop {
                    // Some positions within the last copy go into the table, which helps compression.
                    let input_bytes = load_u64_le(all_input, ip - 3)?;
                    table.put(hash_bytes_at_offset(input_bytes, 0, shift), (ip - 3) as i32)?;
                    table.put(hash_bytes_at_offset(input_bytes, 1, shift), (ip - 2) as i32)?;
                    table.put(hash_bytes_at_offset(input_bytes, 2, shift), (ip - 1) as i32)?;
                    let cur_hash = hash_bytes_at_offset(input_bytes, 3, shift);
                    candidate = table.at(cur_hash)? as usize;
                    table.put(cur_hash, ip as i32)?;

                    if !is_match(all_input, ip, candidate)? {
                        break;
                    }
                    // A match right after the last one, with no literals in between.
                    let base = ip;
                    let matched = 5
                        + find_match_length_with_limit(
                            all_input.sub(candidate + 5..)?,
                            all_input.sub(ip + 5..)?,
                            ip_end - ip - 5,
                        );
                    if ip - candidate > MAX_DISTANCE {
                        break;
                    }
                    ip += matched;
                    last_distance = (base - candidate) as i32;
                    cmd.emit_copy_len(matched, bw)?;
                    cmd.emit_distance(last_distance as usize, bw)?;

                    next_emit = ip;
                    if ip >= ip_limit {
                        break 'scan Scan::EmitRemainder;
                    }
                }

                ip += 1;
                next_hash = hash(all_input, ip, shift)?;
            }
        };

        if let Scan::EmitRemainder = scan {
            input += block_size;
            input_size -= block_size;
            block_size = input_size.min(MERGE_BLOCK_SIZE);

            // Rather than end the meta-block with a command that only inserts, go on with it if that pays off.
            if input_size > 0
                && total_block_size + block_size <= (1 << 20)
                && should_merge_block(&mut s.histogram, all_input.sub(input..input + block_size)?, lit_depth)?
            {
                // The old and the new size both take 5 nibbles, so the header can be changed in place.
                total_block_size += block_size;
                update_bits(20, (total_block_size - 1) as u32, mlen_storage_ix, bw.storage)?;
                continue;
            }

            if next_emit < ip_end {
                let insert = ip_end - next_emit;
                if insert < 6210 {
                    cmd.emit_insert_len(insert, bw)?;
                    emit_literals(all_input.sub(next_emit..ip_end)?, lit_depth, lit_bits, bw)?;
                } else if should_use_uncompressed_mode(next_emit - metablock_start, insert, literal_ratio) {
                    emit_uncompressed_meta_block(all_input.sub(metablock_start..ip_end)?, mlen_storage_ix - 3, bw)?;
                } else {
                    cmd.emit_long_insert_len(insert, bw)?;
                    emit_literals(all_input.sub(next_emit..ip_end)?, lit_depth, lit_bits, bw)?;
                }
            }
            next_emit = ip_end;
        }

        if input_size == 0 {
            break;
        }
        // A new meta-block, with new prefix codes.
        metablock_start = input;
        block_size = input_size.min(FIRST_BLOCK_SIZE);
        total_block_size = block_size;
        mlen_storage_ix = bw.pos + 3;
        store_meta_block_header(block_size, false, bw)?;
        // No block splits, no contexts.
        bw.write_bits(13, 0)?;
        literal_ratio = build_and_store_literal_prefix_code(s, all_input.sub(input..input + block_size)?, bw)?;
        build_and_store_command_prefix_code(s, bw)?;
    }

    if !is_last {
        // The codes for commands and distances of the next call.
        let mut cmd_code = [0u8; 512];
        let mut cmd_code_writer = BitWriter { storage: &mut cmd_code, pos: 0 };
        build_and_store_command_prefix_code(s, &mut cmd_code_writer)?;
        s.cmd_code_numbits = cmd_code_writer.pos;
        s.cmd_code = cmd_code;
    }
    Ok(())
}

/// Writes `input`, of at most `1 << 24` bytes, as one or more meta-blocks, and an empty last meta-block if `is_last`.
/// Without that, `input` is not empty.
///
/// `table` is all 0 and its length is 2 to the power of 9, 11, 13 or 15. No copy reaches back before `input`.
pub(crate) fn compress_fragment_fast(
    s: &mut OnePassArena,
    input: &[u8],
    is_last: bool,
    table: &mut [i32],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let initial_storage_ix = bw.pos;
    let table_bits = log2_floor_nonzero(table.len()) as usize;

    if input.is_empty() {
        debug_assert!(is_last);
        // ISLAST
        bw.write_bits(1, 1)?;
        // ISLASTEMPTY
        bw.write_bits(1, 1)?;
        bw.pos = (bw.pos + 7) & !7;
        return Ok(());
    }

    compress_fragment_fast_impl(s, input, is_last, table, table_bits, bw)?;

    // If that took more room than the input as it is, write that instead.
    if bw.pos - initial_storage_ix > 31 + (input.len() << 3) {
        emit_uncompressed_meta_block(input, initial_storage_ix, bw)?;
    }

    if is_last {
        // ISLAST
        bw.write_bits(1, 1)?;
        // ISLASTEMPTY
        bw.write_bits(1, 1)?;
        bw.pos = (bw.pos + 7) & !7;
    }
    Ok(())
}
