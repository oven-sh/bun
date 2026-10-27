//! Writes meta-blocks.

use super::Fallible;
use super::bit_writer::BitWriter;
use super::command::{
    Command, get_copy_base, get_copy_extra, get_copy_length_code, get_insert_base,
    get_insert_extra, get_insert_length_code,
};
use super::entropy_encode::{
    HuffmanTree, HuffmanTreeCode, convert_bit_depths_to_symbols, create_huffman_tree, set_depth,
    sort_huffman_tree_items,
};
use super::entropy_encode_static::{
    CODE_LENGTH_BITS, CODE_LENGTH_DEPTH, NON_ZERO_REPS, STATIC_COMMAND_CODE_BITS,
    STATIC_COMMAND_CODE_DEPTH, STATIC_DISTANCE_CODE_BITS, STATIC_DISTANCE_CODE_DEPTH, ZERO_REPS,
    store_static_code_length_code, store_static_command_huffman_tree,
    store_static_distance_huffman_tree,
};
use super::fast_log::log2_floor_nonzero;
use super::histogram::{Histogram, HistogramCommand, HistogramDistance, HistogramLiteral};
use super::meta_block::MetaBlockSplit;
use super::params::DistanceParams;
use crate::common::constants::{
    BLOCK_LENGTH_PREFIX_CODE, CODE_LENGTH_CODES, DISTANCE_CONTEXT_BITS, LARGE_MAX_DISTANCE_BITS,
    LITERAL_CONTEXT_BITS, MAX_BLOCK_TYPE_SYMBOLS, MAX_CONTEXT_MAP_SYMBOLS, NUM_BLOCK_LEN_SYMBOLS,
    NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS, REPEAT_PREVIOUS_CODE_LENGTH, REPEAT_ZERO_CODE_LENGTH,
    distance_alphabet_size,
};
use crate::common::context::{ContextType, context_lut};
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_zeroed};
use bun_core::AllocError;

pub(crate) const MAX_HUFFMAN_TREE_SIZE: usize = 2 * NUM_COMMAND_SYMBOLS + 1;

/// The size of the distance alphabet with `NPOSTFIX` = 0 and `NDIRECT` = 0.
const MAX_SIMPLE_DISTANCE_ALPHABET_SIZE: usize =
    distance_alphabet_size(0, 0, LARGE_MAX_DISTANCE_BITS) as usize;

#[inline(always)]
fn block_length_prefix_code(len: u32) -> usize {
    let mut code = if len >= 177 {
        if len >= 753 { 20 } else { 14 }
    } else if len >= 41 {
        7
    } else {
        0
    };
    while let Some(next) = BLOCK_LENGTH_PREFIX_CODE.get(code + 1) {
        if len < u32::from(next.offset) {
            break;
        }
        code += 1;
    }
    code
}

/// The symbol for a block count, the number of its extra bits, and the extra bits.
#[inline(always)]
fn get_block_length_prefix_code(len: u32) -> Checked<(usize, u32, u32)> {
    let code = block_length_prefix_code(len);
    let range = BLOCK_LENGTH_PREFIX_CODE.at(code)?;
    Ok((code, u32::from(range.nbits), len - u32::from(range.offset)))
}

#[derive(Clone, Copy)]
struct BlockTypeCodeCalculator {
    last_type: usize,
    second_last_type: usize,
}

impl BlockTypeCodeCalculator {
    const fn new() -> Self {
        Self {
            last_type: 1,
            second_last_type: 0,
        }
    }

    #[inline(always)]
    fn next_block_type_code(&mut self, type_: u8) -> usize {
        let type_ = usize::from(type_);
        let type_code = if type_ == self.last_type + 1 {
            1
        } else if type_ == self.second_last_type {
            0
        } else {
            type_ + 2
        };
        self.second_last_type = self.last_type;
        self.last_type = type_;
        type_code
    }
}

/// Writes `MNIBBLES` and `MLEN - 1`. `length` is from 1 to `1 << 24`.
fn store_mlen(length: usize, bw: &mut BitWriter<'_>) -> Checked {
    let lg = if length == 1 {
        1
    } else {
        log2_floor_nonzero(length - 1) as usize + 1
    };
    let mnibbles = (if lg < 16 { 16 } else { lg + 3 }) / 4;
    debug_assert!(length > 0 && length <= 1 << 24);
    bw.write_bits(2, (mnibbles - 4) as u64)?;
    bw.write_bits(mnibbles * 4, (length - 1) as u64)
}

#[inline(always)]
fn store_command_extra(cmd: &Command, bw: &mut BitWriter<'_>) -> Checked {
    let copylen_code = cmd.copy_len_code();
    let inscode = get_insert_length_code(cmd.insert_len as usize);
    let copycode = get_copy_length_code(copylen_code as usize);
    let insnumextra = get_insert_extra(inscode)?;
    let insextraval = u64::from(cmd.insert_len - get_insert_base(inscode)?);
    let copyextraval = u64::from(copylen_code - get_copy_base(copycode)?);
    let bits = (copyextraval << insnumextra) | insextraval;
    bw.write_bits((insnumextra + get_copy_extra(copycode)?) as usize, bits)
}

/// What it takes to write the block switch commands of one category.
struct BlockSplitCode {
    type_code_calculator: BlockTypeCodeCalculator,
    type_depths: [u8; MAX_BLOCK_TYPE_SYMBOLS],
    type_bits: [u16; MAX_BLOCK_TYPE_SYMBOLS],
    length_depths: [u8; NUM_BLOCK_LEN_SYMBOLS],
    length_bits: [u16; NUM_BLOCK_LEN_SYMBOLS],
}

/// Stores a number from 0 to 255.
fn store_var_len_uint8(n: usize, bw: &mut BitWriter<'_>) -> Checked {
    if n == 0 {
        bw.write_bits(1, 0)
    } else {
        let nbits = log2_floor_nonzero(n) as usize;
        bw.write_bits(1, 1)?;
        bw.write_bits(3, nbits as u64)?;
        bw.write_bits(nbits, (n - (1 << nbits)) as u64)
    }
}

fn store_compressed_meta_block_header(
    is_final_block: bool,
    length: usize,
    bw: &mut BitWriter<'_>,
) -> Checked {
    // ISLAST
    bw.write_bits(1, u64::from(is_final_block))?;
    if is_final_block {
        // ISLASTEMPTY
        bw.write_bits(1, 0)?;
    }

    store_mlen(length, bw)?;

    if !is_final_block {
        // ISUNCOMPRESSED
        bw.write_bits(1, 0)?;
    }
    Ok(())
}

fn store_uncompressed_meta_block_header(length: usize, bw: &mut BitWriter<'_>) -> Checked {
    // ISLAST. An uncompressed meta-block cannot be the last one.
    bw.write_bits(1, 0)?;
    store_mlen(length, bw)?;
    // ISUNCOMPRESSED
    bw.write_bits(1, 1)
}

fn store_huffman_tree_of_huffman_tree_to_bit_mask(
    num_codes: i32,
    code_length_bitdepth: &[u8; CODE_LENGTH_CODES],
    bw: &mut BitWriter<'_>,
) -> Checked {
    static STORAGE_ORDER: [u8; CODE_LENGTH_CODES] =
        [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    // The fixed code that the code lengths 0 to 5 are written in: 00, 1110, 110, 01, 10, 1111.
    static HUFFMAN_BIT_LENGTH_HUFFMAN_CODE_SYMBOLS: [u8; 6] = [0, 7, 3, 2, 1, 15];
    static HUFFMAN_BIT_LENGTH_HUFFMAN_CODE_BIT_LENGTHS: [u8; 6] = [2, 4, 3, 2, 2, 4];

    let in_order = |i: usize| code_length_bitdepth.at(usize::from(STORAGE_ORDER.at(i)?));

    // The zeros at the end are not written.
    let mut codes_to_store = CODE_LENGTH_CODES;
    if num_codes > 1 {
        while codes_to_store > 0 && in_order(codes_to_store - 1)? == 0 {
            codes_to_store -= 1;
        }
    }
    let mut skip_some = 0;
    if in_order(0)? == 0 && in_order(1)? == 0 {
        skip_some = 2;
        if in_order(2)? == 0 {
            skip_some = 3;
        }
    }
    bw.write_bits(2, skip_some as u64)?;
    for i in skip_some..codes_to_store {
        let l = usize::from(in_order(i)?);
        bw.write_bits(
            usize::from(HUFFMAN_BIT_LENGTH_HUFFMAN_CODE_BIT_LENGTHS.at(l)?),
            u64::from(HUFFMAN_BIT_LENGTH_HUFFMAN_CODE_SYMBOLS.at(l)?),
        )?;
    }
    Ok(())
}

fn store_huffman_tree_to_bit_mask(
    huffman_tree: &[u8],
    huffman_tree_extra_bits: &[u8],
    code_length_bitdepth: &[u8; CODE_LENGTH_CODES],
    code_length_bitdepth_symbols: &[u16; CODE_LENGTH_CODES],
    bw: &mut BitWriter<'_>,
) -> Checked {
    for (&code, &extra_bits) in huffman_tree.iter().zip(huffman_tree_extra_bits) {
        let ix = usize::from(code);
        bw.write_bits(
            usize::from(code_length_bitdepth.at(ix)?),
            u64::from(code_length_bitdepth_symbols.at(ix)?),
        )?;
        match ix {
            REPEAT_PREVIOUS_CODE_LENGTH => bw.write_bits(2, u64::from(extra_bits))?,
            REPEAT_ZERO_CODE_LENGTH => bw.write_bits(3, u64::from(extra_bits))?,
            _ => {}
        }
    }
    Ok(())
}

/// Puts the first `num_symbols` of `symbols` in the order of their depths. Symbols of the same depth end up in an order
/// that the output depends on.
fn sort_symbols_by_depth(depths: &[u8], symbols: &mut [usize; 4], num_symbols: usize) -> Checked {
    for i in 0..num_symbols {
        for j in i + 1..num_symbols {
            if depths.at(symbols.at(j)?)? < depths.at(symbols.at(i)?)? {
                symbols.swap(j, i);
            }
        }
    }
    Ok(())
}

/// 3.4. Simple prefix codes, of 2 to 4 symbols.
fn store_simple_huffman_tree(
    depths: &[u8],
    symbols: &mut [usize; 4],
    num_symbols: usize,
    max_bits: usize,
    bw: &mut BitWriter<'_>,
) -> Checked {
    // 1 announces a simple prefix code.
    bw.write_bits(2, 1)?;
    // NSYM - 1
    bw.write_bits(2, num_symbols as u64 - 1)?;
    sort_symbols_by_depth(depths, symbols, num_symbols)?;
    for &symbol in symbols.sub(..num_symbols)? {
        bw.write_bits(max_bits, symbol as u64)?;
    }
    if num_symbols == 4 {
        // tree-select
        bw.write_bits(1, u64::from(depths.at(symbols[0])? == 1))?;
    }
    Ok(())
}

/// 3.5. Complex prefix codes. `depths` are the code lengths of all symbols of the alphabet.
pub(crate) fn store_huffman_tree(
    depths: &[u8],
    tree: &mut [HuffmanTree],
    bw: &mut BitWriter<'_>,
) -> Checked {
    // No alphabet is larger than that of the commands.
    let mut huffman_tree = [0u8; NUM_COMMAND_SYMBOLS];
    let mut huffman_tree_extra_bits = [0u8; NUM_COMMAND_SYMBOLS];
    let mut code_length_bitdepth = [0u8; CODE_LENGTH_CODES];
    let mut code_length_bitdepth_symbols = [0u16; CODE_LENGTH_CODES];
    let mut huffman_tree_histogram = [0u32; CODE_LENGTH_CODES];

    let mut code = HuffmanTreeCode {
        size: 0,
        tree: &mut huffman_tree,
        extra_bits_data: &mut huffman_tree_extra_bits,
    };
    code.write_huffman_tree(depths)?;
    let huffman_tree_size = code.size;
    let huffman_tree = huffman_tree.sub(..huffman_tree_size)?;

    for &code in huffman_tree {
        *huffman_tree_histogram.at_mut(usize::from(code))? += 1;
    }

    let mut used = huffman_tree_histogram
        .iter()
        .enumerate()
        .filter(|&(_, &count)| count != 0);
    let first_code = used.next().map(|(i, _)| i);
    let num_codes = i32::from(first_code.is_some()) + i32::from(used.next().is_some());

    // The code that the code lengths are written in.
    create_huffman_tree(&huffman_tree_histogram, 5, tree, &mut code_length_bitdepth)?;
    convert_bit_depths_to_symbols(&code_length_bitdepth, &mut code_length_bitdepth_symbols)?;

    store_huffman_tree_of_huffman_tree_to_bit_mask(num_codes, &code_length_bitdepth, bw)?;

    if num_codes == 1 {
        code_length_bitdepth.put(first_code.ok_or(Bug)?, 0)?;
    }

    store_huffman_tree_to_bit_mask(
        huffman_tree,
        &huffman_tree_extra_bits,
        &code_length_bitdepth,
        &code_length_bitdepth_symbols,
        bw,
    )
}

/// Builds a prefix code for `histogram`, stores its code lengths in `depth` and its codes in `bits`, and writes it.
fn build_and_store_huffman_tree(
    histogram: &[u32],
    alphabet_size: usize,
    tree: &mut [HuffmanTree],
    depth: &mut [u8],
    bits: &mut [u16],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let histogram_length = histogram.len();
    let mut count = 0usize;
    let mut s4 = [0usize; 4];
    for (i, _) in histogram.iter().enumerate().filter(|&(_, &n)| n != 0) {
        if let Some(slot) = s4.get_mut(count) {
            *slot = i;
        } else if count > 4 {
            break;
        }
        count += 1;
    }

    let max_bits = (usize::BITS - (alphabet_size - 1).leading_zeros()) as usize;

    if count <= 1 {
        bw.write_bits(4, 1)?;
        bw.write_bits(max_bits, s4[0] as u64)?;
        depth.put(s4[0], 0)?;
        bits.put(s4[0], 0)?;
        return Ok(());
    }

    let depth = depth.sub_mut(..histogram_length)?;
    depth.fill(0);
    create_huffman_tree(histogram, 15, tree, depth)?;
    convert_bit_depths_to_symbols(depth, bits)?;

    if count <= 4 {
        store_simple_huffman_tree(depth, &mut s4, count, max_bits, bw)
    } else {
        store_huffman_tree(depth, tree, bw)
    }
}

/// [`build_and_store_huffman_tree`] in less time: the code lengths are written in a fixed code. `histogram_total` is the
/// sum of `histogram`, and a symbol takes `max_bits` in a simple code.
pub(crate) fn build_and_store_huffman_tree_fast(
    tree: &mut [HuffmanTree],
    histogram: &[u32],
    histogram_total: usize,
    max_bits: usize,
    depth: &mut [u8],
    bits: &mut [u16],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let mut count = 0usize;
    let mut symbols = [0usize; 4];
    let mut length = 0usize;
    let mut total = histogram_total;
    while total != 0 {
        let n = histogram.at(length)?;
        if n != 0 {
            if let Some(slot) = symbols.get_mut(count) {
                *slot = length;
            }
            count += 1;
            total = total.checked_sub(n as usize).ok_or(Bug)?;
        }
        length += 1;
    }

    if count <= 1 {
        bw.write_bits(4, 1)?;
        bw.write_bits(max_bits, symbols[0] as u64)?;
        depth.put(symbols[0], 0)?;
        bits.put(symbols[0], 0)?;
        return Ok(());
    }

    let histogram = histogram.sub(..length)?;
    let depth = depth.sub_mut(..length)?;
    depth.fill(0);
    let sentinel = HuffmanTree::new(u32::MAX, -1, -1);
    let mut count_limit = 1u32;
    loop {
        let mut n = 0usize;
        for (l, &count) in histogram.iter().enumerate().rev() {
            if count != 0 {
                tree.put(n, HuffmanTree::new(count.max(count_limit), -1, l as i16))?;
                n += 1;
            }
        }
        sort_huffman_tree_items(tree.sub_mut(..n)?, |v0, v1| v0.total_count < v1.total_count)?;
        // See `create_huffman_tree`.
        tree.put(n, sentinel)?;
        tree.put(n + 1, sentinel)?;
        let mut i = 0usize;
        let mut j = n + 1;
        for node in n + 2..2 * n + 1 {
            let mut take_smaller = |tree: &[HuffmanTree]| -> Checked<usize> {
                if tree.at(i)?.total_count <= tree.at(j)?.total_count {
                    i += 1;
                    Ok(i - 1)
                } else {
                    j += 1;
                    Ok(j - 1)
                }
            };
            let left = take_smaller(tree)?;
            let right = take_smaller(tree)?;
            let total_count = tree
                .at(left)?
                .total_count
                .wrapping_add(tree.at(right)?.total_count);
            tree.put(
                node - 1,
                HuffmanTree::new(total_count, left as i16, right as i16),
            )?;
            tree.put(node, sentinel)?;
        }
        if set_depth(2 * n - 1, tree, depth, 14)? {
            break;
        }
        count_limit = count_limit.wrapping_mul(2);
    }
    convert_bit_depths_to_symbols(depth, bits)?;
    if count <= 4 {
        return store_simple_huffman_tree(depth, &mut symbols, count, max_bits, bw);
    }

    store_static_code_length_code(bw)?;
    let write_code_length = |bw: &mut BitWriter<'_>, value: u8| -> Checked {
        let value = usize::from(value);
        bw.write_bits(
            usize::from(CODE_LENGTH_DEPTH.at(value)?),
            u64::from(CODE_LENGTH_BITS.at(value)?),
        )
    };
    let mut previous_value = 8u8;
    let mut i = 0;
    while i < length {
        let value = depth.at(i)?;
        let mut reps = depth.sub(i..)?.iter().take_while(|&&d| d == value).count();
        i += reps;
        if value == 0 {
            let code = ZERO_REPS.at(reps)?;
            bw.write_bits(usize::from(code.depth), u64::from(code.bits))?;
        } else {
            if previous_value != value {
                write_code_length(bw, value)?;
                reps -= 1;
            }
            if reps < 3 {
                for _ in 0..reps {
                    write_code_length(bw, value)?;
                }
            } else {
                let code = NON_ZERO_REPS.at(reps - 3)?;
                bw.write_bits(usize::from(code.depth), u64::from(code.bits))?;
            }
            previous_value = value;
        }
    }
    Ok(())
}

/// 7.3. Replaces each value by its index in a list, which starts as 0, 1, 2, ..., and moves it to the front of the list.
fn move_to_front_transform(v_in: &[u32], v_out: &mut [u32]) -> Checked {
    let Some(&max_value) = v_in.iter().max() else {
        return Ok(());
    };
    let mut mtf = [0u8; 256];
    let mtf = mtf.sub_mut(..=max_value as usize)?;
    for (i, value) in mtf.iter_mut().enumerate() {
        *value = i as u8;
    }
    for (&value, out) in v_in.iter().zip(v_out) {
        let index = mtf.iter().position(|&m| u32::from(m) == value).ok_or(Bug)?;
        *out = index as u32;
        mtf.move_within(0, 1, index)?;
        mtf.put(0, value as u8)?;
    }
    Ok(())
}

const SYMBOL_BITS: u32 = 9;
const SYMBOL_MASK: u32 = (1 << SYMBOL_BITS) - 1;

/// Replaces each run of zeros in `v` by the floor of `log2` of its length, which is at most `max_run_length_prefix`, in
/// the low [`SYMBOL_BITS`] and as many extra bits above. Other values grow by the largest such symbol in use, which
/// is returned after the new length of `v`.
fn run_length_code_zeros(v: &mut [u32], max_run_length_prefix: u32) -> Checked<(usize, u32)> {
    let in_size = v.len();
    let max_reps = v
        .split(|&value| value != 0)
        .map(<[u32]>::len)
        .max()
        .unwrap_or(0);
    let max_prefix = if max_reps > 0 {
        log2_floor_nonzero(max_reps)
    } else {
        0
    }
    .min(max_run_length_prefix);
    let mut out_size = 0usize;
    let mut i = 0usize;
    while i < in_size {
        let value = v.at(i)?;
        if value != 0 {
            v.put(out_size, value + max_prefix)?;
            i += 1;
            out_size += 1;
        } else {
            let mut reps = v.sub(i..)?.iter().take_while(|&&value| value == 0).count() as u32;
            i += reps as usize;
            while reps != 0 {
                if reps < (2 << max_prefix) {
                    let run_length_prefix = log2_floor_nonzero(reps as usize);
                    let extra_bits = reps - (1 << run_length_prefix);
                    v.put(out_size, run_length_prefix + (extra_bits << SYMBOL_BITS))?;
                    out_size += 1;
                    break;
                }
                let extra_bits = (1 << max_prefix) - 1;
                v.put(out_size, max_prefix + (extra_bits << SYMBOL_BITS))?;
                reps -= (2 << max_prefix) - 1;
                out_size += 1;
            }
        }
    }
    Ok((out_size, max_prefix))
}

struct EncodeContextMapArena {
    histogram: [u32; MAX_CONTEXT_MAP_SYMBOLS],
    depths: [u8; MAX_CONTEXT_MAP_SYMBOLS],
    bits: [u16; MAX_CONTEXT_MAP_SYMBOLS],
}

/// 7.3. Encoding of the context map.
fn encode_context_map(
    arena: &mut EncodeContextMapArena,
    context_map: &[u32],
    num_clusters: usize,
    tree: &mut [HuffmanTree],
    bw: &mut BitWriter<'_>,
) -> Fallible {
    store_var_len_uint8(num_clusters - 1, bw)?;

    if num_clusters == 1 {
        return Ok(());
    }

    let mut rle_symbols = try_zeroed::<u32>(context_map.len())?;
    move_to_front_transform(context_map, &mut rle_symbols)?;
    let (num_rle_symbols, max_run_length_prefix) = run_length_code_zeros(&mut rle_symbols, 6)?;
    let rle_symbols = rle_symbols.sub(..num_rle_symbols)?;
    arena.histogram.fill(0);
    for &symbol in rle_symbols {
        *arena.histogram.at_mut((symbol & SYMBOL_MASK) as usize)? += 1;
    }
    let use_rle = max_run_length_prefix > 0;
    bw.write_bits(1, u64::from(use_rle))?;
    if use_rle {
        bw.write_bits(4, u64::from(max_run_length_prefix - 1))?;
    }
    let alphabet_size = num_clusters + max_run_length_prefix as usize;
    build_and_store_huffman_tree(
        arena.histogram.sub(..alphabet_size)?,
        alphabet_size,
        tree,
        &mut arena.depths,
        &mut arena.bits,
        bw,
    )?;
    for &symbol in rle_symbols {
        let rle_symbol = symbol & SYMBOL_MASK;
        let extra_bits_val = symbol >> SYMBOL_BITS;
        bw.write_bits(
            usize::from(arena.depths.at(rle_symbol as usize)?),
            u64::from(arena.bits.at(rle_symbol as usize)?),
        )?;
        if rle_symbol > 0 && rle_symbol <= max_run_length_prefix {
            bw.write_bits(rle_symbol as usize, u64::from(extra_bits_val))?;
        }
    }
    // IMTF
    bw.write_bits(1, 1)?;
    Ok(())
}

impl BlockSplitCode {
    /// Writes a block switch command.
    #[inline(always)]
    fn store_block_switch(
        &mut self,
        block_len: u32,
        block_type: u8,
        is_first_block: bool,
        bw: &mut BitWriter<'_>,
    ) -> Checked {
        let typecode = self.type_code_calculator.next_block_type_code(block_type);
        if !is_first_block {
            bw.write_bits(
                usize::from(self.type_depths.at(typecode)?),
                u64::from(self.type_bits.at(typecode)?),
            )?;
        }
        let (lencode, len_nextra, len_extra) = get_block_length_prefix_code(block_len)?;
        bw.write_bits(
            usize::from(self.length_depths.at(lencode)?),
            u64::from(self.length_bits.at(lencode)?),
        )?;
        bw.write_bits(len_nextra as usize, u64::from(len_extra))
    }

    /// Builds the codes for the block types and block counts given, and writes them.
    fn build_and_store(
        &mut self,
        types: &[u8],
        lengths: &[u32],
        num_types: usize,
        tree: &mut [HuffmanTree],
        bw: &mut BitWriter<'_>,
    ) -> Checked {
        let mut type_histo = [0u32; MAX_BLOCK_TYPE_SYMBOLS];
        let mut length_histo = [0u32; NUM_BLOCK_LEN_SYMBOLS];
        let mut type_code_calculator = BlockTypeCodeCalculator::new();
        for (i, (&type_, &length)) in types.iter().zip(lengths).enumerate() {
            let type_code = type_code_calculator.next_block_type_code(type_);
            if i != 0 {
                *type_histo.at_mut(type_code)? += 1;
            }
            *length_histo.at_mut(block_length_prefix_code(length))? += 1;
        }
        store_var_len_uint8(num_types - 1, bw)?;
        if num_types > 1 {
            build_and_store_huffman_tree(
                type_histo.sub(..num_types + 2)?,
                num_types + 2,
                tree,
                &mut self.type_depths,
                &mut self.type_bits,
                bw,
            )?;
            build_and_store_huffman_tree(
                &length_histo,
                NUM_BLOCK_LEN_SYMBOLS,
                tree,
                &mut self.length_depths,
                &mut self.length_bits,
                bw,
            )?;
            self.store_block_switch(lengths.at(0)?, types.at(0)?, true, bw)?;
        }
        Ok(())
    }
}

/// Writes a context map in which every block type has a histogram of its own, whatever the context.
fn store_trivial_context_map(
    arena: &mut EncodeContextMapArena,
    num_types: usize,
    context_bits: usize,
    tree: &mut [HuffmanTree],
    bw: &mut BitWriter<'_>,
) -> Checked {
    store_var_len_uint8(num_types - 1, bw)?;
    if num_types > 1 {
        let repeat_code = context_bits - 1;
        let repeat_bits = (1u64 << repeat_code) - 1;
        let alphabet_size = num_types + repeat_code;
        let histogram = arena.histogram.sub_mut(..alphabet_size)?;
        histogram.fill(0);
        // RLEMAX
        bw.write_bits(1, 1)?;
        bw.write_bits(4, repeat_code as u64 - 1)?;
        histogram.put(repeat_code, num_types as u32)?;
        histogram.put(0, 1)?;
        histogram.sub_mut(context_bits..)?.fill(1);
        build_and_store_huffman_tree(
            histogram,
            alphabet_size,
            tree,
            &mut arena.depths,
            &mut arena.bits,
            bw,
        )?;
        for i in 0..num_types {
            let code = if i == 0 { 0 } else { i + context_bits - 1 };
            bw.write_bits(
                usize::from(arena.depths.at(code)?),
                u64::from(arena.bits.at(code)?),
            )?;
            bw.write_bits(
                usize::from(arena.depths.at(repeat_code)?),
                u64::from(arena.bits.at(repeat_code)?),
            )?;
            bw.write_bits(repeat_code, repeat_bits)?;
        }
        // IMTF
        bw.write_bits(1, 1)?;
    }
    Ok(())
}

/// Writes the symbols of one category: literals, commands or distances.
struct BlockEncoder<'a> {
    histogram_length: usize,
    num_block_types: usize,
    block_types: &'a [u8],
    block_lengths: &'a [u32],
    block_split_code: BlockSplitCode,
    block_ix: usize,
    block_len: usize,
    entropy_ix: usize,
    depths: Vec<u8>,
    bits: Vec<u16>,
}

impl<'a> BlockEncoder<'a> {
    fn new(
        histogram_length: usize,
        num_block_types: usize,
        block_types: &'a [u8],
        block_lengths: &'a [u32],
    ) -> Self {
        Self {
            histogram_length,
            num_block_types,
            block_types,
            block_lengths,
            block_split_code: BlockSplitCode {
                type_code_calculator: BlockTypeCodeCalculator::new(),
                type_depths: [0; MAX_BLOCK_TYPE_SYMBOLS],
                type_bits: [0; MAX_BLOCK_TYPE_SYMBOLS],
                length_depths: [0; NUM_BLOCK_LEN_SYMBOLS],
                length_bits: [0; NUM_BLOCK_LEN_SYMBOLS],
            },
            block_ix: 0,
            block_len: block_lengths.first().map_or(0, |&length| length as usize),
            entropy_ix: 0,
            depths: Vec::new(),
            bits: Vec::new(),
        }
    }

    fn build_and_store_block_switch_entropy_codes(
        &mut self,
        tree: &mut [HuffmanTree],
        bw: &mut BitWriter<'_>,
    ) -> Checked {
        self.block_split_code.build_and_store(
            self.block_types,
            self.block_lengths,
            self.num_block_types,
            tree,
            bw,
        )
    }

    /// At the end of a block, writes the switch to the next one and returns its type.
    #[inline(always)]
    fn next_block(&mut self, bw: &mut BitWriter<'_>) -> Checked<usize> {
        self.block_ix += 1;
        let block_len = self.block_lengths.at(self.block_ix)?;
        let block_type = self.block_types.at(self.block_ix)?;
        self.block_len = block_len as usize;
        self.block_split_code
            .store_block_switch(block_len, block_type, false, bw)?;
        Ok(usize::from(block_type))
    }

    /// Writes `symbol` in the code of the current block type.
    #[inline(always)]
    fn store_symbol(&mut self, symbol: usize, bw: &mut BitWriter<'_>) -> Checked {
        if self.block_len == 0 {
            self.entropy_ix = self.next_block(bw)? * self.histogram_length;
        }
        self.block_len = self.block_len.wrapping_sub(1);
        let ix = self.entropy_ix + symbol;
        bw.write_bits(
            usize::from(self.depths.at(ix)?),
            u64::from(self.bits.at(ix)?),
        )
    }

    /// Writes `symbol` in the code of the current block type and of `context`.
    #[inline(always)]
    fn store_symbol_with_context(
        &mut self,
        symbol: usize,
        context: usize,
        context_map: &[u32],
        bw: &mut BitWriter<'_>,
        context_bits: u32,
    ) -> Checked {
        if self.block_len == 0 {
            self.entropy_ix = self.next_block(bw)? << context_bits;
        }
        self.block_len = self.block_len.wrapping_sub(1);
        let histo_ix = context_map.at(self.entropy_ix + context)? as usize;
        let ix = histo_ix * self.histogram_length + symbol;
        bw.write_bits(
            usize::from(self.depths.at(ix)?),
            u64::from(self.bits.at(ix)?),
        )
    }

    /// Builds a code for each of `histograms` and writes them.
    fn build_and_store_entropy_codes<const N: usize>(
        &mut self,
        histograms: &[Histogram<N>],
        alphabet_size: usize,
        tree: &mut [HuffmanTree],
        bw: &mut BitWriter<'_>,
    ) -> Fallible {
        let table_size = histograms.len() * self.histogram_length;
        self.depths = try_zeroed(table_size)?;
        self.bits = try_zeroed(table_size)?;
        for (i, histogram) in histograms.iter().enumerate() {
            let ix = i * self.histogram_length;
            build_and_store_huffman_tree(
                histogram.data.sub(..self.histogram_length)?,
                alphabet_size,
                tree,
                self.depths.sub_mut(ix..)?,
                self.bits.sub_mut(ix..)?,
                bw,
            )?;
        }
        Ok(())
    }
}

/// Writes a meta-block of `length` bytes, from 1 to `1 << 24`, with the block splits, context maps and histograms of `mb`.
pub(crate) fn store_meta_block(
    input: &[u8],
    start_pos: usize,
    length: usize,
    mask: usize,
    mut prev_byte: u8,
    mut prev_byte2: u8,
    is_last: bool,
    dist: &DistanceParams,
    literal_context_mode: ContextType,
    commands: &[Command],
    mb: &MetaBlockSplit,
    bw: &mut BitWriter<'_>,
) -> Fallible {
    let mut pos = start_pos;
    let num_distance_symbols = dist.alphabet_size_max as usize;
    let num_effective_distance_symbols = dist.alphabet_size_limit as usize;
    let literal_context_lut = context_lut(literal_context_mode);

    store_compressed_meta_block_header(is_last, length, bw)?;

    let mut tree = try_vec(HuffmanTree::default(), MAX_HUFFMAN_TREE_SIZE)?;
    let mut context_map_arena = EncodeContextMapArena {
        histogram: [0; MAX_CONTEXT_MAP_SYMBOLS],
        depths: [0; MAX_CONTEXT_MAP_SYMBOLS],
        bits: [0; MAX_CONTEXT_MAP_SYMBOLS],
    };
    let mut literal_enc = BlockEncoder::new(
        NUM_LITERAL_SYMBOLS,
        mb.literal_split.num_types,
        mb.literal_split.types.sub(..mb.literal_split.num_blocks)?,
        mb.literal_split
            .lengths
            .sub(..mb.literal_split.num_blocks)?,
    );
    let mut command_enc = BlockEncoder::new(
        NUM_COMMAND_SYMBOLS,
        mb.command_split.num_types,
        mb.command_split.types.sub(..mb.command_split.num_blocks)?,
        mb.command_split
            .lengths
            .sub(..mb.command_split.num_blocks)?,
    );
    let mut distance_enc = BlockEncoder::new(
        num_effective_distance_symbols,
        mb.distance_split.num_types,
        mb.distance_split
            .types
            .sub(..mb.distance_split.num_blocks)?,
        mb.distance_split
            .lengths
            .sub(..mb.distance_split.num_blocks)?,
    );

    literal_enc.build_and_store_block_switch_entropy_codes(&mut tree, bw)?;
    command_enc.build_and_store_block_switch_entropy_codes(&mut tree, bw)?;
    distance_enc.build_and_store_block_switch_entropy_codes(&mut tree, bw)?;

    bw.write_bits(2, u64::from(dist.distance_postfix_bits))?;
    bw.write_bits(
        4,
        u64::from(dist.num_direct_distance_codes >> dist.distance_postfix_bits),
    )?;
    for _ in 0..mb.literal_split.num_types {
        bw.write_bits(2, literal_context_mode as u64)?;
    }

    if mb.literal_context_map.is_empty() {
        store_trivial_context_map(
            &mut context_map_arena,
            mb.literal_histograms.len(),
            LITERAL_CONTEXT_BITS as usize,
            &mut tree,
            bw,
        )?;
    } else {
        encode_context_map(
            &mut context_map_arena,
            &mb.literal_context_map,
            mb.literal_histograms.len(),
            &mut tree,
            bw,
        )?;
    }

    if mb.distance_context_map.is_empty() {
        store_trivial_context_map(
            &mut context_map_arena,
            mb.distance_histograms.len(),
            DISTANCE_CONTEXT_BITS as usize,
            &mut tree,
            bw,
        )?;
    } else {
        encode_context_map(
            &mut context_map_arena,
            &mb.distance_context_map,
            mb.distance_histograms.len(),
            &mut tree,
            bw,
        )?;
    }

    literal_enc.build_and_store_entropy_codes(
        &mb.literal_histograms,
        NUM_LITERAL_SYMBOLS,
        &mut tree,
        bw,
    )?;
    command_enc.build_and_store_entropy_codes(
        &mb.command_histograms,
        NUM_COMMAND_SYMBOLS,
        &mut tree,
        bw,
    )?;
    distance_enc.build_and_store_entropy_codes(
        &mb.distance_histograms,
        num_distance_symbols,
        &mut tree,
        bw,
    )?;
    drop(tree);

    for cmd in commands {
        command_enc.store_symbol(usize::from(cmd.cmd_prefix), bw)?;
        store_command_extra(cmd, bw)?;
        if mb.literal_context_map.is_empty() {
            for _ in 0..cmd.insert_len {
                literal_enc.store_symbol(usize::from(input.at(pos & mask)?), bw)?;
                pos += 1;
            }
        } else {
            for _ in 0..cmd.insert_len {
                let context = usize::from(literal_context_lut.context(prev_byte, prev_byte2));
                let literal = input.at(pos & mask)?;
                literal_enc.store_symbol_with_context(
                    usize::from(literal),
                    context,
                    &mb.literal_context_map,
                    bw,
                    LITERAL_CONTEXT_BITS,
                )?;
                prev_byte2 = prev_byte;
                prev_byte = literal;
                pos += 1;
            }
        }
        pos += cmd.copy_len() as usize;
        if cmd.copy_len() != 0 {
            prev_byte2 = input.at(pos.wrapping_sub(2) & mask)?;
            prev_byte = input.at(pos.wrapping_sub(1) & mask)?;
            if cmd.has_distance_symbol() {
                let dist_code = cmd.dist_prefix.symbol();
                let distnumextra = cmd.dist_prefix.num_extra_bits() as usize;
                if mb.distance_context_map.is_empty() {
                    distance_enc.store_symbol(dist_code, bw)?;
                } else {
                    distance_enc.store_symbol_with_context(
                        dist_code,
                        cmd.distance_context() as usize,
                        &mb.distance_context_map,
                        bw,
                        DISTANCE_CONTEXT_BITS,
                    )?;
                }
                bw.write_bits(distnumextra, u64::from(cmd.dist_extra))?;
            }
        }
    }
    if is_last {
        bw.jump_to_byte_boundary()?;
    }
    Ok(())
}

fn build_histograms(
    input: &[u8],
    start_pos: usize,
    mask: usize,
    commands: &[Command],
    lit_histo: &mut HistogramLiteral,
    cmd_histo: &mut HistogramCommand,
    dist_histo: &mut HistogramDistance,
) -> Checked {
    let mut pos = start_pos;
    for cmd in commands {
        cmd_histo.add(usize::from(cmd.cmd_prefix))?;
        for _ in 0..cmd.insert_len {
            lit_histo.add(usize::from(input.at(pos & mask)?))?;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.has_distance_symbol() {
            dist_histo.add(cmd.dist_prefix.symbol())?;
        }
    }
    Ok(())
}

fn store_data_with_huffman_codes(
    input: &[u8],
    start_pos: usize,
    mask: usize,
    commands: &[Command],
    lit_depth: &[u8],
    lit_bits: &[u16],
    cmd_depth: &[u8],
    cmd_bits: &[u16],
    dist_depth: &[u8],
    dist_bits: &[u16],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let mut pos = start_pos;
    for cmd in commands {
        let cmd_code = usize::from(cmd.cmd_prefix);
        bw.write_bits(
            usize::from(cmd_depth.at(cmd_code)?),
            u64::from(cmd_bits.at(cmd_code)?),
        )?;
        store_command_extra(cmd, bw)?;
        for _ in 0..cmd.insert_len {
            let literal = usize::from(input.at(pos & mask)?);
            bw.write_bits(
                usize::from(lit_depth.at(literal)?),
                u64::from(lit_bits.at(literal)?),
            )?;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.has_distance_symbol() {
            let dist_code = cmd.dist_prefix.symbol();
            let distnumextra = cmd.dist_prefix.num_extra_bits() as usize;
            bw.write_bits(
                usize::from(dist_depth.at(dist_code)?),
                u64::from(dist_bits.at(dist_code)?),
            )?;
            bw.write_bits(distnumextra, u64::from(cmd.dist_extra))?;
        }
    }
    Ok(())
}

struct MetaBlockArena {
    lit_histo: HistogramLiteral,
    cmd_histo: HistogramCommand,
    dist_histo: HistogramDistance,
    lit_depth: [u8; NUM_LITERAL_SYMBOLS],
    lit_bits: [u16; NUM_LITERAL_SYMBOLS],
    cmd_depth: [u8; NUM_COMMAND_SYMBOLS],
    cmd_bits: [u16; NUM_COMMAND_SYMBOLS],
    dist_depth: [u8; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
    dist_bits: [u16; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
    tree: [HuffmanTree; MAX_HUFFMAN_TREE_SIZE],
}

impl MetaBlockArena {
    fn new() -> Result<Box<Self>, AllocError> {
        try_box(Self {
            lit_histo: Histogram::new(),
            cmd_histo: Histogram::new(),
            dist_histo: Histogram::new(),
            lit_depth: [0; NUM_LITERAL_SYMBOLS],
            lit_bits: [0; NUM_LITERAL_SYMBOLS],
            cmd_depth: [0; NUM_COMMAND_SYMBOLS],
            cmd_bits: [0; NUM_COMMAND_SYMBOLS],
            dist_depth: [0; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
            dist_bits: [0; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
            tree: [HuffmanTree::new(0, 0, 0); MAX_HUFFMAN_TREE_SIZE],
        })
    }
}

/// Writes a meta-block of `length` bytes, from 1 to `1 << 24`, with one block type and one histogram for each category.
pub(crate) fn store_meta_block_trivial(
    input: &[u8],
    start_pos: usize,
    length: usize,
    mask: usize,
    is_last: bool,
    dist: &DistanceParams,
    commands: &[Command],
    bw: &mut BitWriter<'_>,
) -> Fallible {
    let arena = &mut *MetaBlockArena::new()?;
    let num_distance_symbols = dist.alphabet_size_max as usize;

    store_compressed_meta_block_header(is_last, length, bw)?;

    build_histograms(
        input,
        start_pos,
        mask,
        commands,
        &mut arena.lit_histo,
        &mut arena.cmd_histo,
        &mut arena.dist_histo,
    )?;

    bw.write_bits(13, 0)?;

    build_and_store_huffman_tree(
        &arena.lit_histo.data,
        NUM_LITERAL_SYMBOLS,
        &mut arena.tree,
        &mut arena.lit_depth,
        &mut arena.lit_bits,
        bw,
    )?;
    build_and_store_huffman_tree(
        &arena.cmd_histo.data,
        NUM_COMMAND_SYMBOLS,
        &mut arena.tree,
        &mut arena.cmd_depth,
        &mut arena.cmd_bits,
        bw,
    )?;
    build_and_store_huffman_tree(
        arena
            .dist_histo
            .data
            .sub(..MAX_SIMPLE_DISTANCE_ALPHABET_SIZE)?,
        num_distance_symbols,
        &mut arena.tree,
        &mut arena.dist_depth,
        &mut arena.dist_bits,
        bw,
    )?;
    store_data_with_huffman_codes(
        input,
        start_pos,
        mask,
        commands,
        &arena.lit_depth,
        &arena.lit_bits,
        &arena.cmd_depth,
        &arena.cmd_bits,
        &arena.dist_depth,
        &arena.dist_bits,
        bw,
    )?;
    if is_last {
        bw.jump_to_byte_boundary()?;
    }
    Ok(())
}

/// [`store_meta_block_trivial`] in less time: with fixed codes where there are few commands, and with the code lengths
/// written in a fixed code elsewhere.
pub(crate) fn store_meta_block_fast(
    input: &[u8],
    start_pos: usize,
    length: usize,
    mask: usize,
    is_last: bool,
    dist: &DistanceParams,
    commands: &[Command],
    bw: &mut BitWriter<'_>,
) -> Fallible {
    let arena = &mut *MetaBlockArena::new()?;
    let num_distance_symbols = dist.alphabet_size_max as usize;
    let distance_alphabet_bits = log2_floor_nonzero(num_distance_symbols - 1) as usize + 1;

    store_compressed_meta_block_header(is_last, length, bw)?;

    bw.write_bits(13, 0)?;

    if commands.len() <= 128 {
        let mut histogram = [0u32; NUM_LITERAL_SYMBOLS];
        let mut pos = start_pos;
        let mut num_literals = 0usize;
        for cmd in commands {
            for _ in 0..cmd.insert_len {
                *histogram.at_mut(usize::from(input.at(pos & mask)?))? += 1;
                pos += 1;
            }
            num_literals += cmd.insert_len as usize;
            pos += cmd.copy_len() as usize;
        }
        build_and_store_huffman_tree_fast(
            &mut arena.tree,
            &histogram,
            num_literals,
            8,
            &mut arena.lit_depth,
            &mut arena.lit_bits,
            bw,
        )?;
        store_static_command_huffman_tree(bw)?;
        store_static_distance_huffman_tree(bw)?;
        store_data_with_huffman_codes(
            input,
            start_pos,
            mask,
            commands,
            &arena.lit_depth,
            &arena.lit_bits,
            &STATIC_COMMAND_CODE_DEPTH,
            &STATIC_COMMAND_CODE_BITS,
            &STATIC_DISTANCE_CODE_DEPTH,
            &STATIC_DISTANCE_CODE_BITS,
            bw,
        )?;
    } else {
        build_histograms(
            input,
            start_pos,
            mask,
            commands,
            &mut arena.lit_histo,
            &mut arena.cmd_histo,
            &mut arena.dist_histo,
        )?;
        build_and_store_huffman_tree_fast(
            &mut arena.tree,
            &arena.lit_histo.data,
            arena.lit_histo.total_count,
            8,
            &mut arena.lit_depth,
            &mut arena.lit_bits,
            bw,
        )?;
        build_and_store_huffman_tree_fast(
            &mut arena.tree,
            &arena.cmd_histo.data,
            arena.cmd_histo.total_count,
            10,
            &mut arena.cmd_depth,
            &mut arena.cmd_bits,
            bw,
        )?;
        build_and_store_huffman_tree_fast(
            &mut arena.tree,
            &arena.dist_histo.data,
            arena.dist_histo.total_count,
            distance_alphabet_bits,
            &mut arena.dist_depth,
            &mut arena.dist_bits,
            bw,
        )?;
        store_data_with_huffman_codes(
            input,
            start_pos,
            mask,
            commands,
            &arena.lit_depth,
            &arena.lit_bits,
            &arena.cmd_depth,
            &arena.cmd_bits,
            &arena.dist_depth,
            &arena.dist_bits,
            bw,
        )?;
    }

    if is_last {
        bw.jump_to_byte_boundary()?;
    }
    Ok(())
}

/// Writes `len` bytes, from 1 to `1 << 24`, as they are.
pub(crate) fn store_uncompressed_meta_block(
    is_final_block: bool,
    input: &[u8],
    position: usize,
    mask: usize,
    mut len: usize,
    bw: &mut BitWriter<'_>,
) -> Checked {
    let mut masked_pos = position & mask;
    store_uncompressed_meta_block_header(len, bw)?;
    bw.jump_to_byte_boundary()?;

    if masked_pos + len > mask + 1 {
        let len1 = mask + 1 - masked_pos;
        bw.write_bytes(input.sub(masked_pos..masked_pos + len1)?)?;
        len -= len1;
        masked_pos = 0;
    }
    bw.write_bytes(input.sub(masked_pos..masked_pos + len)?)?;

    // An uncompressed meta-block cannot be the last one, so an empty one follows.
    if is_final_block {
        // ISLAST
        bw.write_bits(1, 1)?;
        // ISLASTEMPTY
        bw.write_bits(1, 1)?;
        bw.jump_to_byte_boundary()?;
    }
    Ok(())
}
