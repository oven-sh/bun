//! Lookup tables for decoding prefix codes.

use crate::common::constants::CODE_LENGTH_CODES;
use crate::util::{Bug, Checked, SliceExt};

pub(crate) const HUFFMAN_MAX_CODE_LENGTH: usize = 15;

/// How many bits the first level of a table is indexed with.
pub(crate) const HUFFMAN_TABLE_BITS: u32 = 8;
const ROOT_BITS: usize = HUFFMAN_TABLE_BITS as usize;

/// The largest tables of alphabets of 26, 258 and 272 symbols.
pub(crate) const HUFFMAN_MAX_SIZE_26: usize = 396;
pub(crate) const HUFFMAN_MAX_SIZE_258: usize = 632;
pub(crate) const HUFFMAN_MAX_SIZE_272: usize = 646;

pub(crate) const HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH: usize = 5;

/// An entry of a lookup table. One integer, so that a table of them is cleared at once.
#[derive(Clone, Copy, Default)]
pub(crate) struct HuffmanCode(u32);

impl HuffmanCode {
    #[inline(always)]
    const fn new(bits: u8, value: u16) -> Self {
        Self((value as u32) << 16 | bits as u32)
    }

    /// How many bits the symbol takes.
    #[inline(always)]
    pub(crate) const fn bits(self) -> u8 {
        self.0 as u8
    }

    /// The symbol, or the offset of the second level table.
    #[inline(always)]
    pub(crate) const fn value(self) -> u16 {
        (self.0 >> 16) as u16
    }
}

/// In a symbol list, the heads of the chains come before the symbols: the chain of code length `n` starts at
/// `n` and symbol `i` is at `SYMBOL_LIST_BASE + i`. A link is the index of the next symbol less `SYMBOL_LIST_BASE`.
pub(crate) const SYMBOL_LIST_BASE: usize = HUFFMAN_MAX_CODE_LENGTH + 1;

/// Huffman trees of one alphabet.
#[derive(Default)]
pub(crate) struct HuffmanTreeGroup {
    /// Where in `codes` each tree starts.
    pub(crate) htrees: Vec<u32>,
    pub(crate) codes: Vec<HuffmanCode>,
    /// Decides how many bits a symbol of a simple code takes. Can be more than `alphabet_size_limit`.
    pub(crate) alphabet_size_max: u16,
    pub(crate) alphabet_size_limit: u16,
}

/// A key holds up to 8 bits of a code, the first one in bit 7, so that adding to it gives the next code. A table is
/// indexed with the first bit in bit 0: see [`reverse_bits`].
const KEY_FIRST_BIT: u32 = 1 << 7;

/// The 8 bits of `num` in reverse order.
#[inline(always)]
#[allow(clippy::indexing_slicing, reason = "a u8 is in range of 256 elements")]
fn reverse_bits(num: u32) -> usize {
    // x86 has no instruction for this: with `u8::reverse_bits`, reading the prefix codes of a stream of 1 KB takes 18 %
    // more instructions.
    static REVERSED: [u8; 256] = {
        let mut reversed = [0; 256];
        let mut i = 0;
        while i < 256 {
            reversed[i] = (i as u8).reverse_bits();
            i += 1;
        }
        reversed
    };
    usize::from(REVERSED[num as u8 as usize])
}

/// Stores `code` in `table[start]`, `table[start + step]` and so on, up to `end`.
#[inline(always)]
fn replicate_value(
    table: &mut [HuffmanCode],
    start: usize,
    step: usize,
    end: usize,
    code: HuffmanCode,
) -> Checked {
    for entry in table.sub_mut(start..end)?.iter_mut().step_by(step) {
        *entry = code;
    }
    Ok(())
}

/// How many bits the next second level table is indexed with. `count` is the histogram of the code lengths of the
/// symbols still to place, and `len` the code length of the next one.
#[inline(always)]
fn next_table_bit_size(
    count: &[u16; HUFFMAN_MAX_CODE_LENGTH + 1],
    mut len: usize,
) -> Checked<usize> {
    let mut left = 1i32 << (len - ROOT_BITS);
    while len < HUFFMAN_MAX_CODE_LENGTH {
        left -= i32::from(count.at(len)?);
        if left <= 0 {
            break;
        }
        len += 1;
        left <<= 1;
    }
    Ok(len - ROOT_BITS)
}

/// The table for the code that the code lengths are written in. `count` is the histogram of `code_lengths`.
pub(crate) fn build_code_lengths_huffman_table(
    table: &mut [HuffmanCode; 1 << HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH],
    code_lengths: &[u8; CODE_LENGTH_CODES],
    count: &[u16; HUFFMAN_MAX_CODE_LENGTH + 1],
) -> Checked {
    // Symbols by code length, and by value within one length. Those of length 0 come last.
    let mut sorted = [0u16; CODE_LENGTH_CODES];
    // Where in `sorted` the last symbol of each length goes. One that has run out has wrapped around.
    let mut offset = [0usize; HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH + 1];
    let mut symbol = usize::MAX;
    for (offset, &count) in offset.iter_mut().zip(count).skip(1) {
        symbol = symbol.wrapping_add(usize::from(count));
        *offset = symbol;
    }
    offset[0] = CODE_LENGTH_CODES - 1;

    for (symbol, &code_length) in code_lengths.iter().enumerate().rev() {
        let offset = offset.at_mut(usize::from(code_length))?;
        sorted.put(*offset, symbol as u16)?;
        *offset = offset.wrapping_sub(1);
    }

    // All symbols but one have code length 0.
    if offset[0] == 0 {
        table.fill(HuffmanCode::new(0, sorted[0]));
        return Ok(());
    }

    let table_size = table.len();
    let mut sorted = sorted.iter();
    let mut key = 0u32;
    let mut key_step = KEY_FIRST_BIT;
    let mut step = 2usize;
    for bits in 1..=HUFFMAN_MAX_CODE_LENGTH_CODE_LENGTH {
        for _ in 0..count.at(bits)? {
            let code = HuffmanCode::new(bits as u8, *sorted.next().ok_or(Bug)?);
            replicate_value(table, reverse_bits(key), step, table_size, code)?;
            key += key_step;
        }
        step <<= 1;
        key_step >>= 1;
    }
    Ok(())
}

/// Builds the table of a complete prefix code and returns its size. `count` is the histogram of the code lengths.
pub(crate) fn build_huffman_table(
    root_table: &mut [HuffmanCode],
    symbol_lists: &[u16],
    count: &mut [u16; HUFFMAN_MAX_CODE_LENGTH + 1],
) -> Checked<u32> {
    let mut max_length = HUFFMAN_MAX_CODE_LENGTH;
    while symbol_lists.at(max_length)? == 0xFFFF {
        max_length = max_length.checked_sub(1).ok_or(Bug)?;
    }

    let mut table_bits = ROOT_BITS;
    let mut table_size = 1usize << table_bits;
    let mut total_size = table_size;

    // Fill a root table as small as the code allows, then repeat it.
    if table_bits > max_length {
        table_bits = max_length;
        table_size = 1 << table_bits;
    }
    let mut key = 0u32;
    let mut key_step = KEY_FIRST_BIT;
    let mut step = 2usize;
    for bits in 1..=table_bits {
        let mut link = bits;
        for _ in 0..count.at(bits)? {
            let symbol = symbol_lists.at(link)?;
            link = SYMBOL_LIST_BASE + usize::from(symbol);
            let code = HuffmanCode::new(bits as u8, symbol);
            replicate_value(root_table, reverse_bits(key), step, table_size, code)?;
            key += key_step;
        }
        step <<= 1;
        key_step >>= 1;
    }
    while total_size != table_size {
        root_table.move_within(0, table_size, table_size)?;
        table_size <<= 1;
    }

    // Second level tables, and the links to them in the root table.
    let mut table = 0usize;
    let mut sub_key = KEY_FIRST_BIT << 1;
    let mut sub_key_step = KEY_FIRST_BIT;
    let mut step = 2usize;
    for len in ROOT_BITS + 1..=max_length {
        let mut link = len;
        while count.at(len)? != 0 {
            if sub_key == KEY_FIRST_BIT << 1 {
                table += table_size;
                table_bits = next_table_bit_size(count, len)?;
                table_size = 1 << table_bits;
                total_size += table_size;
                let root_key = reverse_bits(key);
                key += 1;
                root_table.put(
                    root_key,
                    HuffmanCode::new((table_bits + ROOT_BITS) as u8, (table - root_key) as u16),
                )?;
                sub_key = 0;
            }
            let symbol = symbol_lists.at(link)?;
            link = SYMBOL_LIST_BASE + usize::from(symbol);
            let code = HuffmanCode::new((len - ROOT_BITS) as u8, symbol);
            replicate_value(
                root_table.sub_mut(table..)?,
                reverse_bits(sub_key),
                step,
                table_size,
                code,
            )?;
            sub_key += sub_key_step;
            *count.at_mut(len)? -= 1;
        }
        step <<= 1;
        sub_key_step >>= 1;
    }
    Ok(total_size as u32)
}

/// Builds the table of a simple prefix code (3.4) and returns its size. `num_symbols` is one less than the number of
/// symbols, except that 3 stands for four symbols of lengths 2, 2, 2, 2 and 4 for four of lengths 1, 2, 3, 3.
pub(crate) fn build_simple_huffman_table(
    table: &mut [HuffmanCode],
    val: &mut [u16; 4],
    num_symbols: u32,
) -> Checked<u32> {
    let goal_size = 1usize << ROOT_BITS;
    let code = HuffmanCode::new;
    let mut table_size = match num_symbols {
        0 => {
            table.write_at(0, &[code(0, val[0])])?;
            1
        }
        1 => {
            val[..2].sort_unstable();
            table.write_at(0, &[code(1, val[0]), code(1, val[1])])?;
            2
        }
        2 => {
            val[1..3].sort_unstable();
            table.write_at(
                0,
                &[
                    code(1, val[0]),
                    code(2, val[1]),
                    code(1, val[0]),
                    code(2, val[2]),
                ],
            )?;
            4
        }
        3 => {
            val.sort_unstable();
            table.write_at(
                0,
                &[
                    code(2, val[0]),
                    code(2, val[2]),
                    code(2, val[1]),
                    code(2, val[3]),
                ],
            )?;
            4
        }
        4 => {
            val[2..].sort_unstable();
            table.write_at(
                0,
                &[
                    code(1, val[0]),
                    code(2, val[1]),
                    code(1, val[0]),
                    code(3, val[2]),
                    code(1, val[0]),
                    code(2, val[1]),
                    code(1, val[0]),
                    code(3, val[3]),
                ],
            )?;
            8
        }
        _ => return Err(Bug),
    };
    while table_size != goal_size {
        table.move_within(0, table_size, table_size)?;
        table_size <<= 1;
    }
    Ok(goal_size as u32)
}
