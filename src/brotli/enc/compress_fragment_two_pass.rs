//! Quality 1: finds the matches of a block in a first pass, and in a second writes them with prefix codes built from
//! their statistics.

use super::bit_cost::bits_entropy;
use super::bit_writer::BitWriter;
use super::brotli_bit_stream::{build_and_store_huffman_tree_fast, store_huffman_tree};
use super::compress_fragment::{rewind_bit_position, store_meta_block_header};
use super::entropy_encode::{HuffmanTree, convert_bit_depths_to_symbols, create_huffman_tree};
use super::fast_log::log2_floor_nonzero;
use super::find_match_length::find_match_length_with_limit;
use super::hash::HASH_MUL_32;
use crate::common::constants::{NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS, WINDOW_GAP, max_backward_limit};
use crate::util::{Checked, SliceExt, load_u32_le, load_u64_le};

const MAX_DISTANCE: usize = max_backward_limit(18);

pub(crate) const COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE: usize = 1 << 17;

pub(crate) struct TwoPassArena {
    lit_histo: [u32; 256],
    lit_depth: [u8; 256],
    lit_bits: [u16; 256],
    /// 64 symbols for commands, in an order of their own, and 64 for distances.
    cmd_histo: [u32; 128],
    cmd_depth: [u8; 128],
    cmd_bits: [u16; 128],

    tmp_tree: [HuffmanTree; 2 * NUM_LITERAL_SYMBOLS + 1],
    tmp_depth: [u8; NUM_COMMAND_SYMBOLS],
    tmp_bits: [u16; 64],
}

impl TwoPassArena {
    pub(crate) fn new() -> Box<Self> {
        Box::new(Self {
            lit_histo: [0; 256],
            lit_depth: [0; 256],
            lit_bits: [0; 256],
            cmd_histo: [0; 128],
            cmd_depth: [0; 128],
            cmd_bits: [0; 128],
            tmp_tree: [HuffmanTree::new(0, 0, 0); 2 * NUM_LITERAL_SYMBOLS + 1],
            tmp_depth: [0; NUM_COMMAND_SYMBOLS],
            tmp_bits: [0; 64],
        })
    }
}

/// A hash of the `length` bytes at `p`.
#[inline(always)]
fn hash(input: &[u8], p: usize, shift: usize, length: usize) -> Checked<usize> {
    Ok(hash_bytes_at_offset(load_u64_le(input, p)?, 0, shift, length))
}

/// A hash of the `length` bytes from byte `offset` of `v` on.
#[inline(always)]
fn hash_bytes_at_offset(v: u64, offset: usize, shift: usize, length: usize) -> usize {
    debug_assert!(offset <= 8 - length);
    let h = ((v >> (8 * offset)) << ((8 - length) * 8)).wrapping_mul(u64::from(HASH_MUL_32));
    (h >> shift) as u32 as usize
}

/// Whether the `length` bytes at `p1` and at `p2` are the same. `length` is 4 or 6.
#[inline(always)]
fn is_match(input: &[u8], p1: usize, p2: usize, length: usize) -> Checked<bool> {
    if load_u32_le(input, p1)? != load_u32_le(input, p2)? {
        return Ok(false);
    }
    if length == 4 {
        return Ok(true);
    }
    Ok(input.at(p1 + 4)? == input.at(p2 + 4)? && input.at(p1 + 5)? == input.at(p2 + 5)?)
}

/// Builds the prefix codes for commands and for distances from `s.cmd_histo` and writes them.
fn build_and_store_command_prefix_code(s: &mut TwoPassArena, bw: &mut BitWriter<'_>) -> Checked {
    let (cmd_histo, dist_histo) = s.cmd_histo.split_at(64);
    let (cmd_depth, dist_depth) = s.cmd_depth.split_at_mut(64);
    let (cmd_bits, dist_bits) = s.cmd_bits.split_at_mut(64);
    let tmp_depth = &mut s.tmp_depth;
    let tmp_bits = &mut s.tmp_bits;
    tmp_depth.fill(0);

    create_huffman_tree(cmd_histo, 15, &mut s.tmp_tree, cmd_depth)?;
    create_huffman_tree(dist_histo, 14, &mut s.tmp_tree, dist_depth)?;
    // The codes depend on the order of the symbols in the full alphabet, which is another one. The order here saves a
    // few branches when commands are created.
    for (to, from, len) in [(0, 24, 24), (24, 0, 8), (32, 48, 8), (40, 8, 8), (48, 56, 8), (56, 16, 8)] {
        tmp_depth.write_at(to, cmd_depth.sub(from..from + len)?)?;
    }
    convert_bit_depths_to_symbols(tmp_depth.sub(..64)?, tmp_bits)?;
    for (to, from, len) in [(0, 24, 8), (8, 40, 8), (16, 56, 8), (24, 0, 24), (48, 32, 8), (56, 48, 8)] {
        cmd_bits.write_at(to, tmp_bits.sub(from..from + len)?)?;
    }
    convert_bit_depths_to_symbols(dist_depth, dist_bits)?;
    // The code lengths of the full alphabet.
    tmp_depth.sub_mut(..64)?.fill(0);
    for (to, from) in [(0, 24), (64, 32), (128, 40), (192, 48), (384, 56)] {
        tmp_depth.write_at(to, cmd_depth.sub(from..from + 8)?)?;
    }
    for i in 0..8 {
        tmp_depth.put(128 + 8 * i, cmd_depth.at(i)?)?;
        tmp_depth.put(256 + 8 * i, cmd_depth.at(8 + i)?)?;
        tmp_depth.put(448 + 8 * i, cmd_depth.at(16 + i)?)?;
    }
    store_huffman_tree(tmp_depth, &mut s.tmp_tree, bw)?;
    store_huffman_tree(dist_depth, &mut s.tmp_tree, bw)
}

// A command is kept as its symbol in the low 8 bits and its extra bits above.

#[inline(always)]
fn emit_insert_len(insertlen: u32, commands: &mut Vec<u32>) {
    commands.push(if insertlen < 6 {
        insertlen
    } else if insertlen < 130 {
        let tail = insertlen - 2;
        let nbits = log2_floor_nonzero(tail as usize) - 1;
        let prefix = tail >> nbits;
        let inscode = (nbits << 1) + prefix + 2;
        let extra = tail - (prefix << nbits);
        inscode | (extra << 8)
    } else if insertlen < 2114 {
        let tail = insertlen - 66;
        let nbits = log2_floor_nonzero(tail as usize);
        let code = nbits + 10;
        let extra = tail - (1 << nbits);
        code | (extra << 8)
    } else if insertlen < 6210 {
        21 | ((insertlen - 2114) << 8)
    } else if insertlen < 22594 {
        22 | ((insertlen - 6210) << 8)
    } else {
        23 | ((insertlen - 22594) << 8)
    });
}

#[inline(always)]
fn emit_copy_len(copylen: usize, commands: &mut Vec<u32>) {
    commands.push(if copylen < 10 {
        copylen + 38
    } else if copylen < 134 {
        let tail = copylen - 6;
        let nbits = log2_floor_nonzero(tail) as usize - 1;
        let prefix = tail >> nbits;
        let code = (nbits << 1) + prefix + 44;
        let extra = tail - (prefix << nbits);
        code | (extra << 8)
    } else if copylen < 2118 {
        let tail = copylen - 70;
        let nbits = log2_floor_nonzero(tail) as usize;
        let code = nbits + 52;
        let extra = tail - (1 << nbits);
        code | (extra << 8)
    } else {
        63 | ((copylen - 2118) << 8)
    } as u32);
}

/// A copy at the distance of the command before, which had copy length 2 and is made longer by this.
#[inline(always)]
fn emit_copy_len_last_distance(copylen: usize, commands: &mut Vec<u32>) {
    if copylen < 12 {
        commands.push((copylen + 20) as u32);
    } else if copylen < 72 {
        let tail = copylen - 8;
        let nbits = log2_floor_nonzero(tail) as usize - 1;
        let prefix = tail >> nbits;
        let code = (nbits << 1) + prefix + 28;
        let extra = tail - (prefix << nbits);
        commands.push((code | (extra << 8)) as u32);
    } else if copylen < 136 {
        let tail = copylen - 8;
        let code = (tail >> 5) + 54;
        let extra = tail & 31;
        commands.push((code | (extra << 8)) as u32);
        commands.push(64);
    } else if copylen < 2120 {
        let tail = copylen - 72;
        let nbits = log2_floor_nonzero(tail) as usize;
        let code = nbits + 52;
        let extra = tail - (1 << nbits);
        commands.push((code | (extra << 8)) as u32);
        commands.push(64);
    } else {
        commands.push((63 | ((copylen - 2120) << 8)) as u32);
        commands.push(64);
    }
}

#[inline(always)]
fn emit_distance(distance: u32, commands: &mut Vec<u32>) {
    let d = distance + 3;
    let nbits = log2_floor_nonzero(d as usize) - 1;
    let prefix = (d >> nbits) & 1;
    let offset = (2 + prefix) << nbits;
    let distcode = 2 * (nbits - 1) + prefix + 80;
    let extra = d - offset;
    commands.push(distcode | (extra << 8));
}

/// Puts some positions within the copy that ended at `ip` into the table, which helps compression, and `ip` itself.
/// Returns what the table held for `ip`.
///
/// After the first copy of a series, a `min_match` of 4 stores `ip - 1` under the hash of `ip - 3`. That is what the
/// reference encoder does, and the output depends on it.
#[inline(always)]
fn update_table(
    input: &[u8],
    ip: usize,
    table: &mut [i32],
    shift: usize,
    min_match: usize,
    first_copy: bool,
) -> Checked<usize> {
    let cur_hash;
    if min_match == 4 {
        let input_bytes = load_u64_le(input, ip - 3)?;
        cur_hash = hash_bytes_at_offset(input_bytes, 3, shift, min_match);
        table.put(hash_bytes_at_offset(input_bytes, 0, shift, min_match), (ip - 3) as i32)?;
        table.put(hash_bytes_at_offset(input_bytes, 1, shift, min_match), (ip - 2) as i32)?;
        table.put(hash_bytes_at_offset(input_bytes, if first_copy { 0 } else { 2 }, shift, min_match), (ip - 1) as i32)?;
    } else {
        let input_bytes = load_u64_le(input, ip - 5)?;
        table.put(hash_bytes_at_offset(input_bytes, 0, shift, min_match), (ip - 5) as i32)?;
        table.put(hash_bytes_at_offset(input_bytes, 1, shift, min_match), (ip - 4) as i32)?;
        table.put(hash_bytes_at_offset(input_bytes, 2, shift, min_match), (ip - 3) as i32)?;
        let input_bytes = load_u64_le(input, ip - 2)?;
        cur_hash = hash_bytes_at_offset(input_bytes, 2, shift, min_match);
        table.put(hash_bytes_at_offset(input_bytes, 0, shift, min_match), (ip - 2) as i32)?;
        table.put(hash_bytes_at_offset(input_bytes, 1, shift, min_match), (ip - 1) as i32)?;
    }
    let candidate = table.at(cur_hash)? as usize;
    table.put(cur_hash, ip as i32)?;
    Ok(candidate)
}

/// Finds the matches in the `block_size` bytes from `input` on. All positions are indices of `all_input`.
#[inline(always)]
fn create_commands(
    all_input: &[u8],
    input: usize,
    block_size: usize,
    table: &mut [i32],
    table_bits: usize,
    min_match: usize,
    literals: &mut Vec<u8>,
    commands: &mut Vec<u32>,
) -> Checked {
    const INPUT_MARGIN_BYTES: usize = WINDOW_GAP;
    let input_size = all_input.len() - input;
    let mut ip = input;
    let shift = 64 - table_bits;
    let ip_end = input + block_size;
    // The first byte that no copy covers yet. What lies between it and the next copy becomes literals.
    let mut next_emit = input;

    let mut last_distance = -1i32;

    'scan: {
        if block_size < INPUT_MARGIN_BYTES {
            break 'scan;
        }
        // The last block keeps a margin of 16 bytes, so that no distance is more than the window size - 16. For the others
        // it is enough to keep a copy from going past the end of the block.
        let len_limit = (block_size - min_match).min(input_size - INPUT_MARGIN_BYTES);
        let ip_limit = input + len_limit;

        ip += 1;
        let mut next_hash = hash(all_input, ip, shift, min_match)?;
        loop {
            // Step 1: look for a match of `min_match` bytes.
            //
            // After 32 bytes without one only every other byte is looked at, after 32 more every third, and so on. This
            // costs little on data that compresses and saves a lot of time on data that does not.
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
                    break 'scan;
                }
                next_hash = hash(all_input, next_ip, shift, min_match)?;
                candidate = ip.wrapping_sub(last_distance as isize as usize);
                let found = if is_match(all_input, ip, candidate, min_match)? && candidate < ip {
                    table.put(hash_now, ip as i32)?;
                    true
                } else {
                    candidate = table.at(hash_now)? as usize;
                    table.put(hash_now, ip as i32)?;
                    is_match(all_input, ip, candidate, min_match)?
                };
                if found && ip - candidate <= MAX_DISTANCE {
                    break;
                }
            }

            // Step 2: take note of the literals up to the match and of the match, and then of more matches for as long as
            // one follows the other.
            {
                let base = ip;
                let matched = min_match
                    + find_match_length_with_limit(
                        all_input.sub(candidate + min_match..)?,
                        all_input.sub(ip + min_match..)?,
                        ip_end - ip - min_match,
                    );
                let distance = (base - candidate) as i32;
                ip += matched;
                emit_insert_len((base - next_emit) as u32, commands);
                literals.extend_from_slice(all_input.sub(next_emit..base)?);
                if distance == last_distance {
                    commands.push(64);
                } else {
                    emit_distance(distance as u32, commands);
                    last_distance = distance;
                }
                emit_copy_len_last_distance(matched, commands);

                next_emit = ip;
                if ip >= ip_limit {
                    break 'scan;
                }
                candidate = update_table(all_input, ip, table, shift, min_match, true)?;
            }

            while ip - candidate <= MAX_DISTANCE && is_match(all_input, ip, candidate, min_match)? {
                // A match right after the last one, with no literals in between.
                let base = ip;
                let matched = min_match
                    + find_match_length_with_limit(
                        all_input.sub(candidate + min_match..)?,
                        all_input.sub(ip + min_match..)?,
                        ip_end - ip - min_match,
                    );
                ip += matched;
                last_distance = (base - candidate) as i32;
                emit_copy_len(matched, commands);
                emit_distance(last_distance as u32, commands);

                next_emit = ip;
                if ip >= ip_limit {
                    break 'scan;
                }
                candidate = update_table(all_input, ip, table, shift, min_match, false)?;
            }

            ip += 1;
            next_hash = hash(all_input, ip, shift, min_match)?;
        }
    }

    if next_emit < ip_end {
        emit_insert_len((ip_end - next_emit) as u32, commands);
        literals.extend_from_slice(all_input.sub(next_emit..ip_end)?);
    }
    Ok(())
}

fn store_commands(s: &mut TwoPassArena, literals: &[u8], commands: &[u32], bw: &mut BitWriter<'_>) -> Checked {
    #[rustfmt::skip]
    static NUM_EXTRA_BITS: [u8; 128] = [
        0,  0,  0,  0,  0,  0,  1,  1,  2,  2,  3,  3,  4,  4,  5,  5,
        6,  7,  8,  9,  10, 12, 14, 24, 0,  0,  0,  0,  0,  0,  0,  0,
        1,  1,  2,  2,  3,  3,  4,  4,  0,  0,  0,  0,  0,  0,  0,  0,
        1,  1,  2,  2,  3,  3,  4,  4,  5,  5,  6,  7,  8,  9,  10, 24,
        0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
        1,  1,  2,  2,  3,  3,  4,  4,  5,  5,  6,  6,  7,  7,  8,  8,
        9,  9,  10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16,
        17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24,
    ];
    static INSERT_OFFSET: [u32; 24] =
        [0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594];

    s.lit_histo.fill(0);
    s.cmd_depth.fill(0);
    s.cmd_bits.fill(0);
    s.cmd_histo.fill(0);
    for &literal in literals {
        *s.lit_histo.at_mut(usize::from(literal))? += 1;
    }
    build_and_store_huffman_tree_fast(
        &mut s.tmp_tree,
        &s.lit_histo,
        literals.len(),
        8,
        &mut s.lit_depth,
        &mut s.lit_bits,
        bw,
    )?;

    for &command in commands {
        *s.cmd_histo.at_mut((command & 0xFF) as usize)? += 1;
    }
    s.cmd_histo[1] += 1;
    s.cmd_histo[2] += 1;
    s.cmd_histo[64] += 1;
    s.cmd_histo[84] += 1;
    build_and_store_command_prefix_code(s, bw)?;

    let mut literals = literals.iter();
    for &command in commands {
        let code = (command & 0xFF) as usize;
        let extra = command >> 8;
        bw.write_bits(usize::from(s.cmd_depth.at(code)?), u64::from(s.cmd_bits.at(code)?))?;
        bw.write_bits(usize::from(NUM_EXTRA_BITS.at(code)?), u64::from(extra))?;
        if let Some(&offset) = INSERT_OFFSET.get(code) {
            for &literal in literals.by_ref().take((offset + extra) as usize) {
                let literal = usize::from(literal);
                bw.write_bits(usize::from(s.lit_depth.at(literal)?), u64::from(s.lit_bits.at(literal)?))?;
            }
        }
    }
    Ok(())
}

/// A loss of 2% is acceptable for the speed gained on data that does not compress.
const MIN_RATIO: f64 = 0.98;
const SAMPLE_RATE: usize = 43;

fn should_compress(s: &mut TwoPassArena, input: &[u8], num_literals: usize) -> Checked<bool> {
    let corpus_size = input.len() as f64;
    if (num_literals as f64) < MIN_RATIO * corpus_size {
        return Ok(true);
    }
    let max_total_bit_cost = corpus_size * 8.0 * MIN_RATIO / SAMPLE_RATE as f64;
    s.lit_histo.fill(0);
    for &byte in input.iter().step_by(SAMPLE_RATE) {
        *s.lit_histo.at_mut(usize::from(byte))? += 1;
    }
    Ok(bits_entropy(&s.lit_histo) < max_total_bit_cost)
}

fn emit_uncompressed_meta_block(input: &[u8], bw: &mut BitWriter<'_>) -> Checked {
    store_meta_block_header(input.len(), true, bw)?;
    bw.pos = (bw.pos + 7) & !7;
    bw.write_bytes(input)?;
    bw.prepare_storage()
}

/// Writes `input`, of at most `1 << 24` bytes, as one or more meta-blocks, and an empty last meta-block if `is_last`.
/// Without that, `input` is not empty.
///
/// `table` is all 0 and its length is a power of 2, from `1 << 8` to `1 << 17`. `command_buf` and `literal_buf` are
/// scratch space. No copy reaches back before `input`.
pub(crate) fn compress_fragment_two_pass(
    s: &mut TwoPassArena,
    input: &[u8],
    is_last: bool,
    command_buf: &mut Vec<u32>,
    literal_buf: &mut Vec<u8>,
    table: &mut [i32],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let initial_storage_ix = bw.pos;
    let table_bits = log2_floor_nonzero(table.len()) as usize;
    let min_match = if table_bits <= 15 { 4 } else { 6 };

    let mut start = 0;
    while start < input.len() {
        let block_size = (input.len() - start).min(COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE);
        let block = input.sub(start..start + block_size)?;
        command_buf.clear();
        literal_buf.clear();
        create_commands(input, start, block_size, table, table_bits, min_match, literal_buf, command_buf)?;
        if should_compress(s, block, literal_buf.len())? {
            store_meta_block_header(block_size, false, bw)?;
            // No block splits, no contexts.
            bw.write_bits(13, 0)?;
            store_commands(s, literal_buf, command_buf, bw)?;
        } else {
            // Few matches and nearly 8 bits of entropy in a byte. Not compressing such data is about 3 times as fast.
            emit_uncompressed_meta_block(block, bw)?;
        }
        start += block_size;
    }

    // If that took more room than the input as it is, write that instead.
    if bw.pos - initial_storage_ix > 31 + (input.len() << 3) {
        rewind_bit_position(initial_storage_ix, bw)?;
        emit_uncompressed_meta_block(input, bw)?;
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
