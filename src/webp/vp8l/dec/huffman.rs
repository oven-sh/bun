//! `huffman_utils.c`: two-level lookup tables for decoding prefix codes.

use crate::DecodeError;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt};
use crate::vp8l::format_constants::{
    CODE_LENGTH_CODES, HUFFMAN_CODES_PER_META_CODE, MAX_ALLOWED_CODE_LENGTH, MAX_CACHE_BITS,
    NUM_LENGTH_CODES, NUM_LITERAL_CODES,
};

pub(super) const HUFFMAN_TABLE_BITS: u32 = 8;
pub(super) const HUFFMAN_TABLE_MASK: u32 = (1 << HUFFMAN_TABLE_BITS) - 1;

pub(super) const LENGTHS_TABLE_BITS: u32 = 7;
pub(super) const LENGTHS_TABLE_MASK: u32 = (1 << LENGTHS_TABLE_BITS) - 1;

pub(super) const HUFFMAN_PACKED_BITS: u32 = 6;
pub(super) const HUFFMAN_PACKED_TABLE_SIZE: usize = 1 << HUFFMAN_PACKED_BITS;

/// The largest alphabet: green, with the largest colour cache.
pub(super) const MAX_CODE_LENGTHS_SIZE: usize =
    (1 << MAX_CACHE_BITS) + NUM_LITERAL_CODES + NUM_LENGTH_CODES;

/// `bits` in the low half and `value` in the high half, so that it takes one load.
#[derive(Clone, Copy, Default)]
pub(super) struct HuffmanCode(u32);

impl HuffmanCode {
    #[inline(always)]
    fn new(bits: u8, value: u16) -> Self {
        Self(u32::from(bits) | (u32::from(value) << 16))
    }

    /// How many bits the symbol takes. In the first level, more than the bits of that level if `value` is an offset.
    #[inline(always)]
    pub(super) fn bits(self) -> u32 {
        self.0 & 0xff
    }

    /// The symbol, or the offset from this entry to its second-level table.
    #[inline(always)]
    pub(super) fn value(self) -> u32 {
        self.0 >> 16
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct HuffmanCode32 {
    /// How many bits the pixel takes, or `BITS_SPECIAL_MARKER` more than the symbol takes if it is not a literal.
    pub(super) bits: u32,
    /// The ARGB value of a literal, or the green symbol.
    pub(super) value: u32,
}

/// The five codes of a meta code.
#[derive(Clone)]
pub(super) struct HTreeGroup {
    /// Where the table of each code starts in `Metadata::huffman_tables`.
    pub(super) htrees: [usize; HUFFMAN_CODES_PER_META_CODE],
    /// Whether red, blue and alpha have a single symbol each.
    pub(super) is_trivial_literal: bool,
    /// If so, the pixel, with a green of 0.
    pub(super) literal_arb: u32,
    /// Whether green has a single symbol too, which `literal_arb` then includes.
    pub(super) is_trivial_code: bool,
    pub(super) use_packed_table: bool,
    /// From the next bits to a whole pixel, if it is short.
    pub(super) packed_table: [HuffmanCode32; HUFFMAN_PACKED_TABLE_SIZE],
}

impl Default for HTreeGroup {
    fn default() -> Self {
        Self {
            htrees: [0; HUFFMAN_CODES_PER_META_CODE],
            is_trivial_literal: false,
            literal_arb: 0,
            is_trivial_code: false,
            use_packed_table: false,
            packed_table: [HuffmanCode32::default(); HUFFMAN_PACKED_TABLE_SIZE],
        }
    }
}

/// The bit-reversed increment of `key`, which has `len` bits.
#[inline]
fn get_next_key(key: u32, len: u32) -> u32 {
    let mut step = 1 << (len - 1);
    while key & step != 0 {
        step >>= 1;
    }
    if step != 0 {
        (key & (step - 1)) + step
    } else {
        key
    }
}

/// Stores `code` in `table[0]`, `table[step]`, `table[2 * step]`... below `end`.
#[inline]
fn replicate_value(
    table: &mut [HuffmanCode],
    step: usize,
    end: usize,
    code: HuffmanCode,
) -> Checked {
    for entry in table.sub_mut(..end)?.iter_mut().step_by(step) {
        *entry = code;
    }
    Ok(())
}

/// The bits of the second-level table that starts with a code of `len` bits.
#[inline]
fn next_table_bit_size(
    count: &[i32; MAX_ALLOWED_CODE_LENGTH + 1],
    mut len: usize,
    root_bits: usize,
) -> Checked<usize> {
    let mut left = 1 << (len - root_bits);
    while len < MAX_ALLOWED_CODE_LENGTH {
        left -= count.at(len)?;
        if left <= 0 {
            break;
        }
        len += 1;
        left <<= 1;
    }
    Ok(len - root_bits)
}

/// The size of the table, or `None` for an incomplete code. Fills `root_table` if given. `sorted` is scratch space.
fn build_huffman_table(
    mut root_table: Option<&mut [HuffmanCode]>,
    root_bits: usize,
    code_lengths: &[u8],
    sorted: &mut [u16],
) -> Checked<Option<usize>> {
    let mut total_size = 1 << root_bits;
    let mut count = [0i32; MAX_ALLOWED_CODE_LENGTH + 1];
    let mut offset = [0usize; MAX_ALLOWED_CODE_LENGTH + 1];

    for &len in code_lengths {
        *count.at_mut(len.into())? += 1;
    }
    let [zeros, lengths @ ..] = &count;
    if *zeros as usize == code_lengths.len() {
        return Ok(None);
    }

    let mut next_offset = 0;
    for ((len, &count), offset) in (1..).zip(lengths).zip(offset.iter_mut().skip(1)) {
        *offset = next_offset;
        if len < MAX_ALLOWED_CODE_LENGTH && count > 1 << len {
            return Ok(None);
        }
        next_offset += count as usize;
    }
    let num_symbols = next_offset;

    if root_table.is_some() {
        for (symbol, &len) in (0..).zip(code_lengths) {
            if len > 0 {
                let offset = offset.at_mut(len.into())?;
                sorted.put(*offset, symbol)?;
                *offset += 1;
            }
        }
    }

    if num_symbols == 1 {
        if let Some(table) = root_table {
            let code = HuffmanCode::new(0, sorted.at(0)?);
            replicate_value(table, 1, total_size, code)?;
        }
        return Ok(Some(total_size));
    }

    let mut sorted = sorted.iter().copied();
    let mut low = u32::MAX;
    let mask = total_size as u32 - 1;
    let mut key = 0u32;
    let mut num_nodes = 1i32;
    let mut num_open = 1i32;
    let mut table_size = 1usize << root_bits;
    let mut table = 0usize;

    let mut step = 2;
    for len in 1..=root_bits {
        let count = count.at_mut(len)?;
        num_open <<= 1;
        num_nodes += num_open;
        num_open -= *count;
        if num_open < 0 {
            return Ok(None);
        }
        if let Some(root_table) = root_table.as_deref_mut() {
            while *count > 0 {
                let code = HuffmanCode::new(len as u8, sorted.next().ok_or(Bug)?);
                let table = root_table.sub_mut(key as usize..)?;
                replicate_value(table, step, table_size - key as usize, code)?;
                key = get_next_key(key, len as u32);
                *count -= 1;
            }
        }
        step <<= 1;
    }

    let mut step = 2;
    for len in root_bits + 1..=MAX_ALLOWED_CODE_LENGTH {
        num_open <<= 1;
        num_nodes += num_open;
        num_open -= count.at(len)?;
        if num_open < 0 {
            return Ok(None);
        }
        while count.at(len)? > 0 {
            if key & mask != low {
                table += table_size;
                let table_bits = next_table_bit_size(&count, len, root_bits)?;
                table_size = 1 << table_bits;
                total_size += table_size;
                low = key & mask;
                if let Some(root_table) = root_table.as_deref_mut() {
                    let entry = HuffmanCode::new(
                        (table_bits + root_bits) as u8,
                        (table - low as usize) as u16,
                    );
                    root_table.put(low as usize, entry)?;
                }
            }
            if let Some(root_table) = root_table.as_deref_mut() {
                let code = HuffmanCode::new((len - root_bits) as u8, sorted.next().ok_or(Bug)?);
                let start = (key >> root_bits) as usize;
                let table = root_table.sub_mut(table + start..)?;
                replicate_value(table, step, table_size - start, code)?;
            }
            key = get_next_key(key, len as u32);
            *count.at_mut(len)? -= 1;
        }
        step <<= 1;
    }

    if num_nodes as usize != 2 * num_symbols - 1 {
        return Ok(None);
    }
    Ok(Some(total_size))
}

/// `VP8LBuildHuffmanTable` without a table: whether the lengths make a complete code.
pub(super) fn is_valid_huffman_code(code_lengths: &[u8]) -> Checked<bool> {
    Ok(build_huffman_table(None, HUFFMAN_TABLE_BITS as usize, code_lengths, &mut [])?.is_some())
}

/// `VP8LBuildHuffmanTable`: appends the table for the code to `tables` and returns where it starts.
pub(super) fn append_huffman_table(
    tables: &mut Vec<HuffmanCode>,
    code_lengths: &[u8],
    sorted: &mut [u16; MAX_CODE_LENGTHS_SIZE],
) -> Result<usize, DecodeError> {
    let root_bits = HUFFMAN_TABLE_BITS as usize;
    let size = build_huffman_table(None, root_bits, code_lengths, &mut [])?
        .ok_or(DecodeError::BitstreamError)?;
    let start = tables.len();
    tables.try_reserve(size).map_err(|_| OutOfMemory)?;
    tables.resize(start + size, HuffmanCode::default());
    build_huffman_table(
        Some(tables.sub_mut(start..)?),
        root_bits,
        code_lengths,
        sorted,
    )?;
    Ok(start)
}

/// `VP8LBuildHuffmanTable` for the code of the code lengths, which has no second level. `None` if it is incomplete.
pub(super) fn build_lengths_table(
    code_lengths: &[u8; CODE_LENGTH_CODES],
) -> Checked<Option<[HuffmanCode; 1 << LENGTHS_TABLE_BITS]>> {
    let mut table = [HuffmanCode::default(); 1 << LENGTHS_TABLE_BITS];
    let mut sorted = [0; CODE_LENGTH_CODES];
    let root_bits = LENGTHS_TABLE_BITS as usize;
    let size = build_huffman_table(Some(&mut table), root_bits, code_lengths, &mut sorted)?;
    Ok(size.map(|_| table))
}
