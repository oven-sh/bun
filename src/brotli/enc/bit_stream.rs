//! Writes meta-blocks.

use super::Fallible;
use super::bit_writer::BitWriter;
use super::block_splitter::BlockSplit;
use super::command::{Command, copy_length_code, insert_length_code};
use super::entropy_encode::{
    CodeLengthSymbols, HuffmanNode, convert_bit_depths_to_symbols, create_huffman_tree,
    create_huffman_tree_fast,
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
    BLOCK_LENGTH_PREFIX_CODE, CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, COPY_LENGTH_PREFIX_CODE,
    DISTANCE_CONTEXT_BITS, INITIAL_REPEATED_CODE_LENGTH, INSERT_LENGTH_PREFIX_CODE,
    LARGE_MAX_DISTANCE_BITS, LITERAL_CONTEXT_BITS, MAX_BLOCK_TYPE_SYMBOLS, MAX_CONTEXT_MAP_SYMBOLS,
    NUM_BLOCK_LEN_SYMBOLS, NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS, REPEAT_PREVIOUS_CODE_LENGTH,
    REPEAT_ZERO_CODE_LENGTH, distance_alphabet_size, simple_code_symbol_bits,
};
use crate::common::context::{ContextType, context_lut};
use crate::util::{Bug, Checked, SliceExt, try_box, try_vec, try_zeroed};
use bun_core::AllocError;

const MAX_HUFFMAN_TREE_SIZE: usize = 2 * NUM_COMMAND_SYMBOLS + 1;

/// The size of the distance alphabet with `NPOSTFIX` = 0 and `NDIRECT` = 0.
const MAX_SIMPLE_DISTANCE_ALPHABET_SIZE: usize =
    distance_alphabet_size(0, 0, LARGE_MAX_DISTANCE_BITS) as usize;

/// The symbol for a block count.
fn block_length_symbol(len: u32) -> usize {
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

    fn next_block_type_code(&mut self, block_type: u8) -> usize {
        let block_type = usize::from(block_type);
        let type_code = if block_type == self.last_type + 1 {
            1
        } else if block_type == self.second_last_type {
            0
        } else {
            block_type + 2
        };
        self.second_last_type = self.last_type;
        self.last_type = block_type;
        type_code
    }
}

#[inline(always)]
fn store_command_extra(cmd: &Command, bw: &mut BitWriter<'_>) -> Checked {
    let copy_len_code = cmd.copy_len_code();
    let insert_code = insert_length_code(cmd.insert_len as usize);
    let copy_code = copy_length_code(copy_len_code as usize);
    let insert = INSERT_LENGTH_PREFIX_CODE.at(usize::from(insert_code))?;
    let copy = COPY_LENGTH_PREFIX_CODE.at(usize::from(copy_code))?;
    let insert_extra = u64::from(cmd.insert_len - u32::from(insert.offset));
    let copy_extra = u64::from(copy_len_code - u32::from(copy.offset));
    let bits = (copy_extra << insert.nbits) | insert_extra;
    bw.write_bits(usize::from(insert.nbits + copy.nbits), bits)
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

/// What the header of a meta-block that is not empty says about it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum MetaBlockKind {
    Compressed,
    /// Compressed as well: an uncompressed meta-block cannot be the last one.
    Last,
    Uncompressed,
}

/// 9.2. The header of a meta-block of `length` bytes, from 1 to `1 << 24`, up to `ISUNCOMPRESSED`.
// The loop of `compress_fragment_fast` takes fewer instructions with this as a part of the function.
#[inline(always)]
pub(crate) fn store_meta_block_header(
    length: usize,
    kind: MetaBlockKind,
    bw: &mut BitWriter<'_>,
) -> Checked {
    let nibbles = match length {
        1..=0x1_0000 => 4,
        0x1_0001..=0x10_0000 => 5,
        0x10_0001..=0x100_0000 => 6,
        _ => return Err(Bug),
    };
    let is_last = kind == MetaBlockKind::Last;
    // ISLAST
    bw.write_bits(1, u64::from(is_last))?;
    if is_last {
        // ISLASTEMPTY
        bw.write_bits(1, 0)?;
    }
    // MNIBBLES
    bw.write_bits(2, nibbles - 4)?;
    // MLEN - 1
    bw.write_bits(nibbles as usize * 4, length as u64 - 1)?;
    if !is_last {
        // ISUNCOMPRESSED
        bw.write_bits(1, u64::from(kind == MetaBlockKind::Uncompressed))?;
    }
    Ok(())
}

fn store_compressed_meta_block_header(
    length: usize,
    is_last: bool,
    bw: &mut BitWriter<'_>,
) -> Checked {
    let kind = if is_last {
        MetaBlockKind::Last
    } else {
        MetaBlockKind::Compressed
    };
    store_meta_block_header(length, kind, bw)
}

/// 9.2. What follows in the header of a compressed meta-block that has one block type and one prefix code for each
/// category: 1 as `NBLTYPESL`, `NBLTYPESI` and `NBLTYPESD` (a bit each), 0 as `NPOSTFIX` and `NDIRECT` (6 bits) and as the
/// context mode of the literals (2 bits), 1 as `NTREESL` and `NTREESD` (a bit each).
#[inline(always)]
pub(crate) fn store_trivial_splits_and_contexts(bw: &mut BitWriter<'_>) -> Checked {
    bw.write_bits(13, 0)
}

pub(crate) fn store_empty_last_meta_block(bw: &mut BitWriter<'_>) -> Checked {
    // ISLAST
    bw.write_bits(1, 1)?;
    // ISLASTEMPTY
    bw.write_bits(1, 1)?;
    bw.jump_to_byte_boundary()
}

/// Writes the code lengths `depths` of the code that code lengths are written in. The zeros at the end are left out if
/// `trim` is set.
fn store_code_length_code(
    depths: &[u8; CODE_LENGTH_CODES],
    trim: bool,
    bw: &mut BitWriter<'_>,
) -> Checked {
    // The fixed code for the lengths 0 to 5: 00, 1110, 110, 01, 10, 1111.
    static FIXED_CODE_BITS: [u8; 6] = [0, 7, 3, 2, 1, 15];
    static FIXED_CODE_DEPTHS: [u8; 6] = [2, 4, 3, 2, 2, 4];

    let in_order = |i: usize| depths.at(usize::from(CODE_LENGTH_CODE_ORDER.at(i)?));

    let mut codes_to_store = CODE_LENGTH_CODES;
    if trim {
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
            usize::from(FIXED_CODE_DEPTHS.at(l)?),
            u64::from(FIXED_CODE_BITS.at(l)?),
        )?;
    }
    Ok(())
}

/// Writes `code_lengths` in the code given by `depths` and `bits`.
fn store_code_lengths(
    code_lengths: &CodeLengthSymbols,
    depths: &[u8; CODE_LENGTH_CODES],
    bits: &[u16; CODE_LENGTH_CODES],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let (symbols, extra_bits) = code_lengths.get()?;
    for (&symbol, &extra_bits) in symbols.iter().zip(extra_bits) {
        let symbol = usize::from(symbol);
        bw.write_bits(usize::from(depths.at(symbol)?), u64::from(bits.at(symbol)?))?;
        match symbol {
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
pub(crate) fn store_huffman_tree(depths: &[u8], bw: &mut BitWriter<'_>) -> Checked {
    let mut code_lengths = CodeLengthSymbols::new();
    code_lengths.append(depths)?;

    let mut histogram = [0u32; CODE_LENGTH_CODES];
    for &symbol in code_lengths.get()?.0 {
        *histogram.at_mut(usize::from(symbol))? += 1;
    }
    let mut used = histogram.iter().enumerate().filter(|&(_, &n)| n != 0);
    let only_symbol = match (used.next(), used.next()) {
        (Some((symbol, _)), None) => Some(symbol),
        _ => None,
    };

    // The code that the code lengths are written in.
    let mut tree = [HuffmanNode::default(); 2 * CODE_LENGTH_CODES + 1];
    let mut code_depths = [0u8; CODE_LENGTH_CODES];
    let mut code_bits = [0u16; CODE_LENGTH_CODES];
    create_huffman_tree(&histogram, 5, &mut tree, &mut code_depths)?;
    convert_bit_depths_to_symbols(&code_depths, &mut code_bits)?;

    store_code_length_code(&code_depths, only_symbol.is_none(), bw)?;

    if let Some(symbol) = only_symbol {
        code_depths.put(symbol, 0)?;
    }
    store_code_lengths(&code_lengths, &code_depths, &code_bits, bw)
}

/// Builds a prefix code for `histogram`, stores its code lengths in `depth` and its codes in `bits`, and writes it.
fn build_and_store_huffman_tree(
    histogram: &[u32],
    alphabet_size: usize,
    tree: &mut [HuffmanNode],
    depth: &mut [u8],
    bits: &mut [u16],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let histogram_length = histogram.len();
    let mut count = 0usize;
    let mut symbols = [0usize; 4];
    for (i, _) in histogram.iter().enumerate().filter(|&(_, &n)| n != 0) {
        if let Some(slot) = symbols.get_mut(count) {
            *slot = i;
        } else if count > 4 {
            break;
        }
        count += 1;
    }

    let max_bits = simple_code_symbol_bits(alphabet_size as u32) as usize;

    if count <= 1 {
        bw.write_bits(4, 1)?;
        bw.write_bits(max_bits, symbols[0] as u64)?;
        depth.put(symbols[0], 0)?;
        bits.put(symbols[0], 0)?;
        return Ok(());
    }

    let depth = depth.sub_mut(..histogram_length)?;
    depth.fill(0);
    create_huffman_tree(histogram, 15, tree, depth)?;
    convert_bit_depths_to_symbols(depth, bits)?;

    if count <= 4 {
        store_simple_huffman_tree(depth, &mut symbols, count, max_bits, bw)
    } else {
        store_huffman_tree(depth, bw)
    }
}

/// [`build_and_store_huffman_tree`] in less time: the code lengths are written in a fixed code. `histogram_total` is the
/// sum of `histogram`, and a symbol takes `max_bits` in a simple code.
pub(crate) fn build_and_store_huffman_tree_fast(
    tree: &mut [HuffmanNode],
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
    create_huffman_tree_fast(histogram, 14, tree, depth)?;
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
    let mut previous_value = INITIAL_REPEATED_CODE_LENGTH as u8;
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

/// Replaces each run of zeros in `v` by the floor of `log2` of its length, which is at most `MAX_RUN_LENGTH_PREFIX`, in
/// the low [`SYMBOL_BITS`] and as many extra bits above. Other values grow by the largest such symbol in use, which
/// is returned after the new length of `v`.
fn run_length_code_zeros(v: &mut [u32]) -> Checked<(usize, u32)> {
    const MAX_RUN_LENGTH_PREFIX: u32 = 6;
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
    .min(MAX_RUN_LENGTH_PREFIX);
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

/// 7.3. Encoding of the context map.
fn encode_context_map(
    context_map: &[u32],
    num_clusters: usize,
    tree: &mut [HuffmanNode],
    bw: &mut BitWriter<'_>,
) -> Fallible {
    store_var_len_uint8(num_clusters - 1, bw)?;

    if num_clusters == 1 {
        return Ok(());
    }

    let mut rle_symbols = try_zeroed::<u32>(context_map.len())?;
    move_to_front_transform(context_map, &mut rle_symbols)?;
    let (num_rle_symbols, max_run_length_prefix) = run_length_code_zeros(&mut rle_symbols)?;
    let rle_symbols = rle_symbols.sub(..num_rle_symbols)?;
    let mut histogram = [0u32; MAX_CONTEXT_MAP_SYMBOLS];
    let mut depths = [0u8; MAX_CONTEXT_MAP_SYMBOLS];
    let mut bits = [0u16; MAX_CONTEXT_MAP_SYMBOLS];
    for &symbol in rle_symbols {
        *histogram.at_mut((symbol & SYMBOL_MASK) as usize)? += 1;
    }
    let use_rle = max_run_length_prefix > 0;
    bw.write_bits(1, u64::from(use_rle))?;
    if use_rle {
        bw.write_bits(4, u64::from(max_run_length_prefix - 1))?;
    }
    let alphabet_size = num_clusters + max_run_length_prefix as usize;
    build_and_store_huffman_tree(
        histogram.sub(..alphabet_size)?,
        alphabet_size,
        tree,
        &mut depths,
        &mut bits,
        bw,
    )?;
    for &symbol in rle_symbols {
        let rle_symbol = symbol & SYMBOL_MASK;
        let extra_bits_val = symbol >> SYMBOL_BITS;
        bw.write_bits(
            usize::from(depths.at(rle_symbol as usize)?),
            u64::from(bits.at(rle_symbol as usize)?),
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
    fn store_block_switch(
        &mut self,
        block_len: u32,
        block_type: u8,
        is_first_block: bool,
        bw: &mut BitWriter<'_>,
    ) -> Checked {
        let type_code = self.type_code_calculator.next_block_type_code(block_type);
        if !is_first_block {
            bw.write_bits(
                usize::from(self.type_depths.at(type_code)?),
                u64::from(self.type_bits.at(type_code)?),
            )?;
        }
        let length_symbol = block_length_symbol(block_len);
        let range = BLOCK_LENGTH_PREFIX_CODE.at(length_symbol)?;
        bw.write_bits(
            usize::from(self.length_depths.at(length_symbol)?),
            u64::from(self.length_bits.at(length_symbol)?),
        )?;
        bw.write_bits(
            usize::from(range.nbits),
            u64::from(block_len - u32::from(range.offset)),
        )
    }

    /// Builds the codes for the block types and block counts of `split`, and writes them.
    fn build_and_store(
        &mut self,
        split: &BlockSplit,
        tree: &mut [HuffmanNode],
        bw: &mut BitWriter<'_>,
    ) -> Checked {
        let num_types = split.num_types;
        let mut type_histogram = [0u32; MAX_BLOCK_TYPE_SYMBOLS];
        let mut length_histogram = [0u32; NUM_BLOCK_LEN_SYMBOLS];
        let mut type_code_calculator = BlockTypeCodeCalculator::new();
        for (i, (&block_type, &length)) in split.types.iter().zip(&split.lengths).enumerate() {
            let type_code = type_code_calculator.next_block_type_code(block_type);
            if i != 0 {
                *type_histogram.at_mut(type_code)? += 1;
            }
            *length_histogram.at_mut(block_length_symbol(length))? += 1;
        }
        store_var_len_uint8(num_types - 1, bw)?;
        if num_types > 1 {
            build_and_store_huffman_tree(
                type_histogram.sub(..num_types + 2)?,
                num_types + 2,
                tree,
                &mut self.type_depths,
                &mut self.type_bits,
                bw,
            )?;
            build_and_store_huffman_tree(
                &length_histogram,
                NUM_BLOCK_LEN_SYMBOLS,
                tree,
                &mut self.length_depths,
                &mut self.length_bits,
                bw,
            )?;
            self.store_block_switch(split.lengths.at(0)?, split.types.at(0)?, true, bw)?;
        }
        Ok(())
    }
}

/// Writes a context map in which every block type has a histogram of its own, whatever the context.
fn store_trivial_context_map(
    num_types: usize,
    context_bits: usize,
    tree: &mut [HuffmanNode],
    bw: &mut BitWriter<'_>,
) -> Checked {
    store_var_len_uint8(num_types - 1, bw)?;
    if num_types > 1 {
        let repeat_code = context_bits - 1;
        let repeat_bits = (1u64 << repeat_code) - 1;
        let alphabet_size = num_types + repeat_code;
        let mut histogram = [0u32; MAX_CONTEXT_MAP_SYMBOLS];
        let mut depths = [0u8; MAX_CONTEXT_MAP_SYMBOLS];
        let mut bits = [0u16; MAX_CONTEXT_MAP_SYMBOLS];
        let histogram = histogram.sub_mut(..alphabet_size)?;
        // RLEMAX
        bw.write_bits(1, 1)?;
        bw.write_bits(4, repeat_code as u64 - 1)?;
        histogram.put(repeat_code, num_types as u32)?;
        histogram.put(0, 1)?;
        histogram.sub_mut(context_bits..)?.fill(1);
        build_and_store_huffman_tree(histogram, alphabet_size, tree, &mut depths, &mut bits, bw)?;
        for i in 0..num_types {
            let code = if i == 0 { 0 } else { i + context_bits - 1 };
            bw.write_bits(usize::from(depths.at(code)?), u64::from(bits.at(code)?))?;
            bw.write_bits(
                usize::from(depths.at(repeat_code)?),
                u64::from(bits.at(repeat_code)?),
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
    split: &'a BlockSplit,
    block_split_code: BlockSplitCode,
    block_ix: usize,
    block_len: usize,
    entropy_ix: usize,
    depths: Vec<u8>,
    bits: Vec<u16>,
}

impl<'a> BlockEncoder<'a> {
    fn new(histogram_length: usize, split: &'a BlockSplit) -> Self {
        Self {
            histogram_length,
            split,
            block_split_code: BlockSplitCode {
                type_code_calculator: BlockTypeCodeCalculator::new(),
                type_depths: [0; MAX_BLOCK_TYPE_SYMBOLS],
                type_bits: [0; MAX_BLOCK_TYPE_SYMBOLS],
                length_depths: [0; NUM_BLOCK_LEN_SYMBOLS],
                length_bits: [0; NUM_BLOCK_LEN_SYMBOLS],
            },
            block_ix: 0,
            block_len: split.lengths.first().map_or(0, |&length| length as usize),
            entropy_ix: 0,
            depths: Vec::new(),
            bits: Vec::new(),
        }
    }

    /// At the end of a block, writes the switch to the next one and returns its type.
    #[cold]
    fn next_block(&mut self, bw: &mut BitWriter<'_>) -> Checked<usize> {
        self.block_ix += 1;
        let block_len = self.split.lengths.at(self.block_ix)?;
        let block_type = self.split.types.at(self.block_ix)?;
        if block_len == 0 {
            return Err(Bug);
        }
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
        self.block_len -= 1;
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
        self.block_len -= 1;
        let histogram_ix = context_map.at(self.entropy_ix + context)? as usize;
        let ix = histogram_ix * self.histogram_length + symbol;
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
        tree: &mut [HuffmanNode],
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
// Its loop takes more instructions as a part of the caller.
#[inline(never)]
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

    store_compressed_meta_block_header(length, is_last, bw)?;

    let mut tree = try_vec(HuffmanNode::default(), MAX_HUFFMAN_TREE_SIZE)?;
    let mut literal_enc = BlockEncoder::new(NUM_LITERAL_SYMBOLS, &mb.literal_split);
    let mut command_enc = BlockEncoder::new(NUM_COMMAND_SYMBOLS, &mb.command_split);
    let mut distance_enc = BlockEncoder::new(num_effective_distance_symbols, &mb.distance_split);

    for enc in [&mut literal_enc, &mut command_enc, &mut distance_enc] {
        enc.block_split_code
            .build_and_store(enc.split, &mut tree, bw)?;
    }

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
            mb.literal_histograms.len(),
            LITERAL_CONTEXT_BITS as usize,
            &mut tree,
            bw,
        )?;
    } else {
        encode_context_map(
            &mb.literal_context_map,
            mb.literal_histograms.len(),
            &mut tree,
            bw,
        )?;
    }

    if mb.distance_context_map.is_empty() {
        store_trivial_context_map(
            mb.distance_histograms.len(),
            DISTANCE_CONTEXT_BITS as usize,
            &mut tree,
            bw,
        )?;
    } else {
        encode_context_map(
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
                let distance_symbol = cmd.dist_prefix.symbol();
                let num_extra_bits = cmd.dist_prefix.num_extra_bits() as usize;
                if mb.distance_context_map.is_empty() {
                    distance_enc.store_symbol(distance_symbol, bw)?;
                } else {
                    distance_enc.store_symbol_with_context(
                        distance_symbol,
                        cmd.distance_context() as usize,
                        &mb.distance_context_map,
                        bw,
                        DISTANCE_CONTEXT_BITS,
                    )?;
                }
                bw.write_bits(num_extra_bits, u64::from(cmd.dist_extra))?;
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
    literal_histogram: &mut HistogramLiteral,
    command_histogram: &mut HistogramCommand,
    distance_histogram: &mut HistogramDistance,
) -> Checked {
    let mut pos = start_pos;
    for cmd in commands {
        command_histogram.add(usize::from(cmd.cmd_prefix))?;
        for _ in 0..cmd.insert_len {
            literal_histogram.add(usize::from(input.at(pos & mask)?))?;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.has_distance_symbol() {
            distance_histogram.add(cmd.dist_prefix.symbol())?;
        }
    }
    Ok(())
}

fn store_data_with_huffman_codes(
    input: &[u8],
    start_pos: usize,
    mask: usize,
    commands: &[Command],
    literal_depths: &[u8],
    literal_bits: &[u16],
    command_depths: &[u8],
    command_bits: &[u16],
    distance_depths: &[u8],
    distance_bits: &[u16],
    bw: &mut BitWriter<'_>,
) -> Checked {
    let mut pos = start_pos;
    for cmd in commands {
        let command_symbol = usize::from(cmd.cmd_prefix);
        bw.write_bits(
            usize::from(command_depths.at(command_symbol)?),
            u64::from(command_bits.at(command_symbol)?),
        )?;
        store_command_extra(cmd, bw)?;
        for _ in 0..cmd.insert_len {
            let literal = usize::from(input.at(pos & mask)?);
            bw.write_bits(
                usize::from(literal_depths.at(literal)?),
                u64::from(literal_bits.at(literal)?),
            )?;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.has_distance_symbol() {
            let distance_symbol = cmd.dist_prefix.symbol();
            let num_extra_bits = cmd.dist_prefix.num_extra_bits() as usize;
            bw.write_bits(
                usize::from(distance_depths.at(distance_symbol)?),
                u64::from(distance_bits.at(distance_symbol)?),
            )?;
            bw.write_bits(num_extra_bits, u64::from(cmd.dist_extra))?;
        }
    }
    Ok(())
}

/// What it takes to write a meta-block with one prefix code for each category.
struct MetaBlockScratch {
    literal_histogram: HistogramLiteral,
    command_histogram: HistogramCommand,
    distance_histogram: HistogramDistance,
    literal_depths: [u8; NUM_LITERAL_SYMBOLS],
    literal_bits: [u16; NUM_LITERAL_SYMBOLS],
    command_depths: [u8; NUM_COMMAND_SYMBOLS],
    command_bits: [u16; NUM_COMMAND_SYMBOLS],
    distance_depths: [u8; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
    distance_bits: [u16; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
    tree: Vec<HuffmanNode>,
}

impl MetaBlockScratch {
    fn new() -> Result<Box<Self>, AllocError> {
        try_box(Self {
            literal_histogram: Histogram::new(),
            command_histogram: Histogram::new(),
            distance_histogram: Histogram::new(),
            literal_depths: [0; NUM_LITERAL_SYMBOLS],
            literal_bits: [0; NUM_LITERAL_SYMBOLS],
            command_depths: [0; NUM_COMMAND_SYMBOLS],
            command_bits: [0; NUM_COMMAND_SYMBOLS],
            distance_depths: [0; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
            distance_bits: [0; MAX_SIMPLE_DISTANCE_ALPHABET_SIZE],
            tree: try_vec(HuffmanNode::default(), MAX_HUFFMAN_TREE_SIZE)?,
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
    let s = &mut *MetaBlockScratch::new()?;
    let num_distance_symbols = dist.alphabet_size_max as usize;

    store_compressed_meta_block_header(length, is_last, bw)?;

    build_histograms(
        input,
        start_pos,
        mask,
        commands,
        &mut s.literal_histogram,
        &mut s.command_histogram,
        &mut s.distance_histogram,
    )?;

    store_trivial_splits_and_contexts(bw)?;

    build_and_store_huffman_tree(
        &s.literal_histogram.data,
        NUM_LITERAL_SYMBOLS,
        &mut s.tree,
        &mut s.literal_depths,
        &mut s.literal_bits,
        bw,
    )?;
    build_and_store_huffman_tree(
        &s.command_histogram.data,
        NUM_COMMAND_SYMBOLS,
        &mut s.tree,
        &mut s.command_depths,
        &mut s.command_bits,
        bw,
    )?;
    build_and_store_huffman_tree(
        s.distance_histogram
            .data
            .sub(..MAX_SIMPLE_DISTANCE_ALPHABET_SIZE)?,
        num_distance_symbols,
        &mut s.tree,
        &mut s.distance_depths,
        &mut s.distance_bits,
        bw,
    )?;
    store_data_with_huffman_codes(
        input,
        start_pos,
        mask,
        commands,
        &s.literal_depths,
        &s.literal_bits,
        &s.command_depths,
        &s.command_bits,
        &s.distance_depths,
        &s.distance_bits,
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
    let s = &mut *MetaBlockScratch::new()?;
    let num_distance_symbols = dist.alphabet_size_max as usize;
    let distance_alphabet_bits = log2_floor_nonzero(num_distance_symbols - 1) as usize + 1;

    store_compressed_meta_block_header(length, is_last, bw)?;

    store_trivial_splits_and_contexts(bw)?;

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
            &mut s.tree,
            &histogram,
            num_literals,
            8,
            &mut s.literal_depths,
            &mut s.literal_bits,
            bw,
        )?;
        store_static_command_huffman_tree(bw)?;
        store_static_distance_huffman_tree(bw)?;
        store_data_with_huffman_codes(
            input,
            start_pos,
            mask,
            commands,
            &s.literal_depths,
            &s.literal_bits,
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
            &mut s.literal_histogram,
            &mut s.command_histogram,
            &mut s.distance_histogram,
        )?;
        build_and_store_huffman_tree_fast(
            &mut s.tree,
            &s.literal_histogram.data,
            s.literal_histogram.total_count,
            8,
            &mut s.literal_depths,
            &mut s.literal_bits,
            bw,
        )?;
        build_and_store_huffman_tree_fast(
            &mut s.tree,
            &s.command_histogram.data,
            s.command_histogram.total_count,
            10,
            &mut s.command_depths,
            &mut s.command_bits,
            bw,
        )?;
        build_and_store_huffman_tree_fast(
            &mut s.tree,
            &s.distance_histogram.data,
            s.distance_histogram.total_count,
            distance_alphabet_bits,
            &mut s.distance_depths,
            &mut s.distance_bits,
            bw,
        )?;
        store_data_with_huffman_codes(
            input,
            start_pos,
            mask,
            commands,
            &s.literal_depths,
            &s.literal_bits,
            &s.command_depths,
            &s.command_bits,
            &s.distance_depths,
            &s.distance_bits,
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
    store_meta_block_header(len, MetaBlockKind::Uncompressed, bw)?;
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
        store_empty_last_meta_block(bw)?;
    }
    Ok(())
}
