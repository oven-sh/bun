//! Quality 1: finds the matches of a block in a first pass, and in a second writes them with prefix codes built from
//! their statistics.

use super::bit_cost::bits_entropy;
use super::bit_stream::{
    MetaBlockKind, build_and_store_huffman_tree_fast, store_empty_last_meta_block,
    store_meta_block_header, store_trivial_splits_and_contexts,
};
use super::bit_writer::BitWriter;
use super::compress_fragment::{
    CommandSink, MAX_DISTANCE, build_and_store_command_prefix_code, emit_literals, hash_low_bytes,
    same_low_bytes,
};
use super::entropy_encode::HuffmanNode;
use super::find_match_length::find_match_length_with_limit;
use crate::common::constants::{NUM_LITERAL_SYMBOLS, WINDOW_GAP};
use crate::util::{Bug, Checked, SliceExt, load_u64_le, try_box};
use bun_core::AllocError;

pub(crate) const COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE: usize = 1 << 17;

pub(crate) struct TwoPassScratch {
    lit_histo: [u32; 256],
    lit_depth: [u8; 256],
    lit_bits: [u16; 256],
    /// 64 symbols for commands and 64 for distances.
    cmd_histo: [u32; 128],
    cmd_depth: [u8; 128],
    cmd_bits: [u16; 128],

    tmp_tree: [HuffmanNode; 2 * NUM_LITERAL_SYMBOLS + 1],
}

impl TwoPassScratch {
    pub(crate) fn new() -> Result<Box<Self>, AllocError> {
        try_box(Self {
            lit_histo: [0; 256],
            lit_depth: [0; 256],
            lit_bits: [0; 256],
            cmd_histo: [0; 128],
            cmd_depth: [0; 128],
            cmd_bits: [0; 128],
            tmp_tree: [HuffmanNode::new(0, 0, 0); 2 * NUM_LITERAL_SYMBOLS + 1],
        })
    }
}

/// The shortest copy that is looked for with a table of `1 << table_bits` entries.
const fn min_match(table_bits: u32) -> usize {
    if table_bits <= 15 { 4 } else { 6 }
}

#[inline(always)]
fn hash<const TABLE_BITS: u32>(v: u64) -> usize {
    hash_low_bytes(v, min_match(TABLE_BITS), TABLE_BITS)
}

#[inline(always)]
fn is_match<const TABLE_BITS: u32>(a: u64, b: u64) -> bool {
    same_low_bytes(a, b, min_match(TABLE_BITS))
}

/// A buffer that is filled from the start.
struct Filling<'a, T> {
    buffer: &'a mut [T],
    len: usize,
}

impl<'a, T: Copy> Filling<'a, T> {
    fn new(buffer: &'a mut [T]) -> Self {
        Self { buffer, len: 0 }
    }

    #[inline(always)]
    fn push(&mut self, value: T) -> Checked {
        self.buffer.put(self.len, value)?;
        self.len += 1;
        Ok(())
    }

    #[inline(always)]
    fn extend(&mut self, values: &[T]) -> Checked {
        self.buffer.write_at(self.len, values)?;
        self.len += values.len();
        Ok(())
    }
}

/// A command is kept as its symbol in the low 8 bits and its extra bits above.
impl CommandSink for Filling<'_, u32> {
    const FIRST_INSERT_SYMBOL: usize = 0;

    #[inline(always)]
    fn emit(&mut self, symbol: usize, _n_extra: usize, extra: usize) -> Checked {
        self.push((symbol | (extra << 8)) as u32)
    }
}

/// Which copy of a series of copies with no literals in between.
#[derive(Clone, Copy, PartialEq)]
enum CopyInSeries {
    First,
    Later,
}

/// Puts some positions within the copy that ended at `ip` into the table, which helps compression, and `ip` itself.
/// Returns what the table held for `ip`, and the bytes at `ip`, of which the low `min_match(TABLE_BITS)` count.
///
/// After the first copy of a series, a shortest copy of 4 stores `ip - 1` under the hash of `ip - 3`. That is what the
/// reference encoder does, and the output depends on it.
#[inline(always)]
fn update_table<const TABLE_BITS: u32, const TABLE_SIZE: usize>(
    input: &[u8],
    ip: usize,
    table: &mut [i32; TABLE_SIZE],
    copy: CopyInSeries,
) -> Checked<(usize, u64)> {
    let hash = hash::<TABLE_BITS>;
    let bytes;
    if min_match(TABLE_BITS) == 4 {
        let input_bytes = load_u64_le(input, ip - 3)?;
        bytes = input_bytes >> 24;
        table.put(hash(input_bytes), (ip - 3) as i32)?;
        table.put(hash(input_bytes >> 8), (ip - 2) as i32)?;
        table.put(
            hash(if copy == CopyInSeries::First {
                input_bytes
            } else {
                input_bytes >> 16
            }),
            (ip - 1) as i32,
        )?;
    } else {
        let around: &[u8; 11] = input.array_at(ip - 5)?;
        let input_bytes = u64::from_le_bytes(*around.first_chunk().ok_or(Bug)?);
        table.put(hash(input_bytes), (ip - 5) as i32)?;
        table.put(hash(input_bytes >> 8), (ip - 4) as i32)?;
        table.put(hash(input_bytes >> 16), (ip - 3) as i32)?;
        let input_bytes = u64::from_le_bytes(*around.last_chunk().ok_or(Bug)?);
        bytes = input_bytes >> 16;
        table.put(hash(input_bytes), (ip - 2) as i32)?;
        table.put(hash(input_bytes >> 8), (ip - 1) as i32)?;
    }
    let entry = table.at_mut(hash(bytes))?;
    let candidate = *entry as usize;
    *entry = ip as i32;
    Ok((candidate, bytes))
}

/// Finds the matches in the `block_size` bytes from `input` on. All positions are indices of `all_input`. Returns how
/// many literals and how many commands there are.
///
/// Not inlined: next to the code for the other table sizes, this came out 5 % slower.
#[inline(never)]
fn create_commands<const TABLE_BITS: u32, const TABLE_SIZE: usize>(
    all_input: &[u8],
    input: usize,
    block_size: usize,
    table: &mut [i32; TABLE_SIZE],
    literals: &mut [u8],
    commands: &mut [u32],
) -> Checked<(usize, usize)> {
    const INPUT_MARGIN_BYTES: usize = WINDOW_GAP;
    let min_match = const { min_match(TABLE_BITS) };
    let mut literals = Filling::new(literals);
    let mut commands = Filling::new(commands);
    let input_size = all_input.len() - input;
    let mut ip = input;
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
        let mut next_bytes = load_u64_le(all_input, ip)?;
        loop {
            // Step 1: look for a match of `min_match` bytes.
            //
            // After 32 bytes without one only every other byte is looked at, after 32 more every third, and so on. This
            // costs little on data that compresses and saves a lot of time on data that does not.
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
                    break 'scan;
                }
                next_bytes = load_u64_le(all_input, next_ip)?;
                candidate = ip.wrapping_sub(last_distance as isize as usize);
                let entry = table.at_mut(hash_now)?;
                let found = if candidate < ip
                    && is_match::<TABLE_BITS>(bytes, load_u64_le(all_input, candidate)?)
                {
                    true
                } else {
                    candidate = *entry as usize;
                    is_match::<TABLE_BITS>(bytes, load_u64_le(all_input, candidate)?)
                };
                *entry = ip as i32;
                if found && ip - candidate <= MAX_DISTANCE {
                    break;
                }
            }

            // Step 2: take note of the literals up to the match and of the match, and then of more matches for as long as
            // one follows the other.
            let mut bytes_at_ip;
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
                commands.emit_insert_len(base - next_emit)?;
                literals.extend(all_input.sub(next_emit..base)?)?;
                if distance == last_distance {
                    commands.emit_last_distance()?;
                } else {
                    commands.emit_distance(distance as usize)?;
                    last_distance = distance;
                }
                commands.emit_copy_len_last_distance(matched)?;

                next_emit = ip;
                if ip >= ip_limit {
                    break 'scan;
                }
                (candidate, bytes_at_ip) = update_table::<TABLE_BITS, TABLE_SIZE>(
                    all_input,
                    ip,
                    table,
                    CopyInSeries::First,
                )?;
            }

            while ip - candidate <= MAX_DISTANCE
                && is_match::<TABLE_BITS>(bytes_at_ip, load_u64_le(all_input, candidate)?)
            {
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
                commands.emit_copy_len(matched)?;
                commands.emit_distance(last_distance as usize)?;

                next_emit = ip;
                if ip >= ip_limit {
                    break 'scan;
                }
                (candidate, bytes_at_ip) = update_table::<TABLE_BITS, TABLE_SIZE>(
                    all_input,
                    ip,
                    table,
                    CopyInSeries::Later,
                )?;
            }

            ip += 1;
            next_bytes = load_u64_le(all_input, ip)?;
        }
    }

    if next_emit < ip_end {
        commands.emit_insert_len(ip_end - next_emit)?;
        literals.extend(all_input.sub(next_emit..ip_end)?)?;
    }
    Ok((literals.len, commands.len))
}

/// Writes the prefix codes for `literals` and `commands`, and then these.
///
/// Not inlined: as a part of its caller, this came out 1 % slower.
#[inline(never)]
fn store_commands(
    s: &mut TwoPassScratch,
    literals: &[u8],
    commands: &[u32],
    bw: &mut BitWriter<'_>,
) -> Checked {
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
    static INSERT_OFFSET: [u32; 24] = [
        0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114,
        6210, 22594,
    ];

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
    build_and_store_command_prefix_code(
        &s.cmd_histo,
        &mut s.cmd_depth,
        &mut s.cmd_bits,
        Filling::FIRST_INSERT_SYMBOL,
        &mut s.tmp_tree,
        bw,
    )?;

    let mut literals = literals;
    for &command in commands {
        let code = (command & 0xFF) as usize;
        let extra = command >> 8;
        let depth = usize::from(s.cmd_depth.at(code)?);
        bw.write_bits(
            depth + usize::from(NUM_EXTRA_BITS.at(code)?),
            u64::from(s.cmd_bits.at(code)?) | (u64::from(extra) << depth),
        )?;
        if let Some(&offset) = INSERT_OFFSET.get(code) {
            let (inserted, rest) = literals
                .split_at_checked((offset + extra) as usize)
                .ok_or(Bug)?;
            literals = rest;
            emit_literals(inserted, &s.lit_depth, &s.lit_bits, bw)?;
        }
    }
    Ok(())
}

/// A loss of 2% is acceptable for the speed gained on data that does not compress.
const MIN_RATIO: f64 = 0.98;
const SAMPLE_RATE: usize = 43;

fn should_compress(s: &mut TwoPassScratch, input: &[u8], num_literals: usize) -> Checked<bool> {
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
    store_meta_block_header(input.len(), MetaBlockKind::Uncompressed, bw)?;
    bw.jump_to_byte_boundary()?;
    bw.write_bytes(input)
}

/// Writes `input`, of at most `1 << 24` bytes, as one or more meta-blocks, and an empty last meta-block if `is_last`.
/// Without that, `input` is not empty.
///
/// `table` is all 0 and its length is a power of 2, from `1 << 8` to `1 << 17`. `command_buf` and `literal_buf` are
/// scratch space, each as long as `input` or [`COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE`] if that is less. No copy reaches
/// back before `input`.
pub(crate) fn compress_fragment_two_pass(
    s: &mut TwoPassScratch,
    input: &[u8],
    is_last: bool,
    command_buf: &mut [u32],
    literal_buf: &mut [u8],
    table: &mut [i32],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let initial_storage_ix = bw.pos();

    let mut start = 0;
    while start < input.len() {
        let block_size = (input.len() - start).min(COMPRESS_FRAGMENT_TWO_PASS_BLOCK_SIZE);
        let block = input.sub(start..start + block_size)?;
        macro_rules! run {
            ($bits:literal) => {
                create_commands::<$bits, { 1 << $bits }>(
                    input,
                    start,
                    block_size,
                    table.try_into().map_err(|_| Bug)?,
                    literal_buf,
                    command_buf,
                )
            };
        }
        let (num_literals, num_commands) = match table.len().trailing_zeros() {
            8 => run!(8),
            9 => run!(9),
            10 => run!(10),
            11 => run!(11),
            12 => run!(12),
            13 => run!(13),
            14 => run!(14),
            15 => run!(15),
            16 => run!(16),
            17 => run!(17),
            _ => Err(Bug),
        }?;
        if should_compress(s, block, num_literals)? {
            store_meta_block_header(block_size, MetaBlockKind::Compressed, bw)?;
            store_trivial_splits_and_contexts(bw)?;
            store_commands(
                s,
                literal_buf.sub(..num_literals)?,
                command_buf.sub(..num_commands)?,
                bw,
            )?;
        } else {
            // Few matches and nearly 8 bits of entropy in a byte. Not compressing such data is about 3 times as fast.
            emit_uncompressed_meta_block(block, bw)?;
        }
        start += block_size;
    }

    // If that took more room than the input as it is, write that instead.
    if bw.pos() - initial_storage_ix > 31 + (input.len() << 3) {
        bw.rewind(initial_storage_ix)?;
        emit_uncompressed_meta_block(input, bw)?;
    }

    if is_last {
        store_empty_last_meta_block(bw)?;
    }
    Ok(())
}
