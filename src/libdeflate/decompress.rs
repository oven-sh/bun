//! DEFLATE decompression (RFC 1951) of a whole stream held in memory. README.md explains the tables and the bit buffer.

use crate::constants::*;
use crate::error::{Error, Result};

/// The bits read from the input and not consumed yet, lowest first.
type BitBuf = u64;

const BITBUF_NBITS: u32 = BitBuf::BITS;
const WORD_BYTES: usize = size_of::<BitBuf>();

/// The most bits that count as consumable: one less than the buffer holds, which makes a refill a plain OR.
const MAX_BITSLEFT: u32 = BITBUF_NBITS - 1;

/// What a refill guarantees to be consumable. Only whole bytes are added.
const CONSUMABLE_NBITS: u32 = MAX_BITSLEFT - 7;

/// What `refill_word!` leaves in the buffer. Bits past `bitsleft` may be looked at, to fetch an entry early, but not consumed.
const FASTLOOP_PRELOADABLE_NBITS: u32 = BITBUF_NBITS;

const PRELOAD_SLACK: u32 = FASTLOOP_PRELOADABLE_NBITS - MAX_BITSLEFT;

const fn can_consume(nbits: u32) -> bool {
    CONSUMABLE_NBITS >= nbits
}

const fn can_consume_and_then_preload(consume_nbits: u32, preload_nbits: u32) -> bool {
    CONSUMABLE_NBITS >= consume_nbits && FASTLOOP_PRELOADABLE_NBITS >= consume_nbits + preload_nbits
}

// Index bits of each main table, and its size with the most subtables possible (`enough 19 7 7`, `288 11 15`, `32 8 15` from zlib).
const PRECODE_TABLEBITS: u32 = 7;
const PRECODE_ENOUGH: usize = 128;
const LITLEN_TABLEBITS: u32 = 11;
const LITLEN_ENOUGH: usize = 2342;
const OFFSET_TABLEBITS: u32 = 8;
const OFFSET_ENOUGH: usize = 402;

const HUFFDEC_LITERAL: u32 = 0x8000_0000;
/// Set together with `HUFFDEC_SUBTABLE_POINTER` or `HUFFDEC_END_OF_BLOCK`.
const HUFFDEC_EXCEPTIONAL: u32 = 0x0000_8000;
const HUFFDEC_SUBTABLE_POINTER: u32 = 0x0000_4000;
const HUFFDEC_END_OF_BLOCK: u32 = 0x0000_2000;

const LENGTH_MAXBITS: u32 = MAX_LITLEN_CODEWORD_LEN + MAX_EXTRA_LENGTH_BITS;
const LENGTH_MAXFASTBITS: u32 = LITLEN_TABLEBITS + MAX_EXTRA_LENGTH_BITS;
const OFFSET_MAXBITS: u32 = MAX_OFFSET_CODEWORD_LEN + MAX_EXTRA_OFFSET_BITS;
const OFFSET_MAXFASTBITS: u32 = OFFSET_TABLEBITS + MAX_EXTRA_OFFSET_BITS;

/// The most the fast loop writes in one round: two literals, the longest match, and what the copy writes past its end.
const FASTLOOP_MAX_BYTES_WRITTEN: usize = 2 + MAX_MATCH_LEN as usize + 5 * WORD_BYTES - 1;

/// The most the fast loop reads in one round: the bits it can refill, and the word a refill loads.
const FASTLOOP_MAX_BYTES_READ: usize =
    (MAX_BITSLEFT + 2 * LITLEN_TABLEBITS + LENGTH_MAXBITS + OFFSET_MAXBITS).div_ceil(8) as usize
        + WORD_BYTES;

// What the decoding loops below take for granted about the size of the bit buffer.
const _: () = {
    assert!(can_consume(1 + 2 + 5 + 5 + 4 + 3));
    assert!(can_consume(3 * (NUM_PRECODE_SYMS as u32 - 1)));
    assert!(PRECODE_TABLEBITS == MAX_PRE_CODEWORD_LEN);
    assert!(can_consume_and_then_preload(
        2 * LITLEN_TABLEBITS + LENGTH_MAXBITS,
        OFFSET_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        2 * LITLEN_TABLEBITS + MAX_LITLEN_CODEWORD_LEN,
        LITLEN_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        MAX_LITLEN_CODEWORD_LEN,
        LITLEN_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        LENGTH_MAXBITS,
        OFFSET_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        LENGTH_MAXFASTBITS,
        OFFSET_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        OFFSET_MAXBITS,
        LITLEN_TABLEBITS
    ));
    assert!(can_consume(LENGTH_MAXBITS + OFFSET_MAXBITS));
};

/// Precode entry: bits 20-16 are the symbol, bits 2-0 the codeword length.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static PRECODE_DECODE_RESULTS: [u32; NUM_PRECODE_SYMS] = {
    let mut results = [0; NUM_PRECODE_SYMS];
    let mut sym = 0;
    while sym < NUM_PRECODE_SYMS {
        results[sym] = (sym as u32) << 16;
        sym += 1;
    }
    results
};

/// The part of a litlen entry that depends on the symbol alone.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static LITLEN_DECODE_RESULTS: [u32; NUM_LITLEN_SYMS] = {
    let mut results = [0; NUM_LITLEN_SYMS];
    let mut sym = 0;
    while sym < NUM_LITERALS {
        results[sym] = HUFFDEC_LITERAL | ((sym as u32) << 16);
        sym += 1;
    }
    results[END_OF_BLOCK] = HUFFDEC_EXCEPTIONAL | HUFFDEC_END_OF_BLOCK;
    let mut sym = FIRST_LEN_SYM;
    while sym < NUM_LITLEN_SYMS {
        // The last two symbols are not valid. They decode like the one before them.
        let slot = if sym - FIRST_LEN_SYM < 29 {
            sym - FIRST_LEN_SYM
        } else {
            28
        };
        results[sym] = ((LENGTH_SLOT_BASE[slot] as u32) << 16) | EXTRA_LENGTH_BITS[slot] as u32;
        sym += 1;
    }
    results
};

/// The part of an offset entry that depends on the symbol alone.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static OFFSET_DECODE_RESULTS: [u32; NUM_OFFSET_SYMS] = {
    let mut results = [0; NUM_OFFSET_SYMS];
    let mut sym = 0;
    while sym < NUM_OFFSET_SYMS {
        // The last two symbols are not valid. They decode like the one before them.
        let slot = if sym < 30 { sym } else { 29 };
        results[sym] = ((OFFSET_SLOT_BASE[slot] as u32) << 16) | EXTRA_OFFSET_BITS[slot] as u32;
        sym += 1;
    }
    results
};

/// The decode tables, kept between calls so that streams of static blocks build the static tables once.
pub(crate) struct Tables {
    precode_lens: [u8; NUM_PRECODE_SYMS],
    lens: [u8; NUM_LITLEN_SYMS + NUM_OFFSET_SYMS + MAX_LENS_OVERRUN],
    precode_decode_table: [u32; PRECODE_ENOUGH],
    litlen_decode_table: [u32; LITLEN_ENOUGH],
    offset_decode_table: [u32; OFFSET_ENOUGH],
    sorted_syms: [u16; MAX_NUM_SYMS],
    static_codes_loaded: bool,
    litlen_tablebits: u32,
}

impl Tables {
    pub(crate) fn new() -> Self {
        Self {
            precode_lens: [0; _],
            lens: [0; _],
            precode_decode_table: [0; _],
            litlen_decode_table: [0; _],
            offset_decode_table: [0; _],
            sorted_syms: [0; _],
            static_codes_loaded: false,
            litlen_tablebits: 0,
        }
    }
}

#[inline(always)]
fn make_decode_table_entry(decode_results: &[u32], sym: u16, len: u32) -> Option<u32> {
    Some(decode_results.get(usize::from(sym))? + (len << 8) + len)
}

/// The bit-reversed codeword after this one among those of `len` bits. `None` after the last, which is all ones.
#[inline(always)]
fn next_codeword(codeword: u32, len: u32) -> Option<u32> {
    let bit = 1 << (codeword ^ ((1 << len) - 1)).checked_ilog2()?;
    Some((codeword & (bit - 1)) | bit)
}

/// Doubles a table of `len` entries by repeating it.
#[inline(always)]
fn double_table(decode_table: &mut [u32], len: usize) -> Option<()> {
    let (filled, rest) = decode_table.split_at_mut_checked(len)?;
    rest.get_mut(..len)?.copy_from_slice(filled);
    Some(())
}

/// Builds the table for the code in which symbol `i` has `lens[i]` bits. Returns the main table's index bits (fewer than `table_bits` only with `shrink`), or `None` for lengths this decoder refuses.
fn build_decode_table(
    decode_table: &mut [u32],
    lens: &[u8],
    decode_results: &[u32],
    mut table_bits: u32,
    max_codeword_len: u32,
    sorted_syms: &mut [u16; MAX_NUM_SYMS],
    shrink: bool,
) -> Option<u32> {
    let mut len_counts = [0u32; MAX_CODEWORD_LEN + 1];
    let mut offsets = [0u32; MAX_CODEWORD_LEN + 1];
    let count_of =
        |len_counts: &[u32; MAX_CODEWORD_LEN + 1], len: u32| len_counts.get(len as usize).copied();

    for &len in lens {
        *len_counts.get_mut(usize::from(len))? += 1;
    }

    let mut max_codeword_len = max_codeword_len;
    while max_codeword_len > 1 && count_of(&len_counts, max_codeword_len)? == 0 {
        max_codeword_len -= 1;
    }
    if shrink {
        table_bits = table_bits.min(max_codeword_len);
    }

    // Sort the symbols by codeword length, then value, and add up how much of the codespace of `2^max_codeword_len` is used.
    let mut codespace_used = 0u32;
    offsets[1] = len_counts[0];
    for len in 1..max_codeword_len {
        let count = count_of(&len_counts, len)?;
        *offsets.get_mut(len as usize + 1)? = *offsets.get(len as usize)? + count;
        codespace_used = (codespace_used << 1) + count;
    }
    codespace_used = (codespace_used << 1) + count_of(&len_counts, max_codeword_len)?;

    for (sym, &len) in lens.iter().enumerate() {
        let slot = offsets.get_mut(usize::from(len))?;
        *sorted_syms.get_mut(*slot as usize)? = sym as u16;
        *slot += 1;
    }
    // `offsets[0]` now counts the symbols without a codeword, which were sorted first.
    let mut sorted_syms = sorted_syms
        .get(offsets[0] as usize..lens.len())?
        .iter()
        .copied();

    if codespace_used > 1 << max_codeword_len {
        return None;
    }

    if codespace_used < 1 << max_codeword_len {
        // Of incomplete codes, only the empty one and a single one-bit codeword are allowed. That symbol (or symbol 0) gets both one-bit codewords.
        let sym = if codespace_used == 0 {
            0
        } else {
            if codespace_used != 1 << (max_codeword_len - 1) || len_counts[1] != 1 {
                return None;
            }
            sorted_syms.next()?
        };
        let entry = make_decode_table_entry(decode_results, sym, 1)?;
        decode_table.get_mut(..1 << table_bits)?.fill(entry);
        return Some(table_bits);
    }

    // Codewords that fit the main table: fill a table of `2^len` entries, and double it by copying each time `len` goes up.
    let mut codeword = 0u32;
    let mut len = 1u32;
    let mut count = count_of(&len_counts, len)?;
    while count == 0 {
        len += 1;
        count = count_of(&len_counts, len)?;
    }
    let mut cur_table_end = 1usize << len;
    while len <= table_bits {
        loop {
            *decode_table.get_mut(codeword as usize)? =
                make_decode_table_entry(decode_results, sorted_syms.next()?, len)?;

            if codeword as usize == cur_table_end - 1 {
                // The last codeword, all ones.
                while len < table_bits {
                    double_table(decode_table, cur_table_end)?;
                    cur_table_end <<= 1;
                    len += 1;
                }
                return Some(table_bits);
            }
            codeword = next_codeword(codeword, len)?;
            count -= 1;
            if count == 0 {
                break;
            }
        }
        loop {
            len += 1;
            if len <= table_bits {
                double_table(decode_table, cur_table_end)?;
                cur_table_end <<= 1;
            }
            count = count_of(&len_counts, len)?;
            if count != 0 {
                break;
            }
        }
    }

    // The longer codewords go into subtables, one for each distinct low `table_bits` bits.
    let main_table_mask = (1u32 << table_bits) - 1;
    cur_table_end = 1 << table_bits;
    let mut subtable_prefix = u32::MAX;
    let mut subtable_start = 0usize;
    loop {
        if codeword & main_table_mask != subtable_prefix {
            subtable_prefix = codeword & main_table_mask;
            subtable_start = cur_table_end;
            // `2^n` entries for codewords of `table_bits + n` bits, or more if too few of those are left to fill them.
            let mut subtable_bits = len - table_bits;
            let mut codespace_used = count;
            while codespace_used < 1 << subtable_bits {
                subtable_bits += 1;
                codespace_used =
                    (codespace_used << 1) + count_of(&len_counts, table_bits + subtable_bits)?;
            }
            cur_table_end = subtable_start + (1 << subtable_bits);

            *decode_table.get_mut(subtable_prefix as usize)? = ((subtable_start as u32) << 16)
                | HUFFDEC_EXCEPTIONAL
                | HUFFDEC_SUBTABLE_POINTER
                | (subtable_bits << 8)
                | table_bits;
        }

        let entry = make_decode_table_entry(decode_results, sorted_syms.next()?, len - table_bits)?;
        decode_table
            .get_mut(subtable_start + (codeword >> table_bits) as usize..cur_table_end)?
            .iter_mut()
            .step_by(1 << (len - table_bits))
            .for_each(|slot| *slot = entry);

        if codeword == (1 << len) - 1 {
            return Some(table_bits);
        }
        codeword = next_codeword(codeword, len)?;
        count -= 1;
        while count == 0 {
            len += 1;
            count = count_of(&len_counts, len)?;
        }
    }
}

impl Tables {
    fn build_precode_decode_table(&mut self) -> Option<()> {
        build_decode_table(
            &mut self.precode_decode_table,
            &self.precode_lens,
            &PRECODE_DECODE_RESULTS,
            PRECODE_TABLEBITS,
            MAX_PRE_CODEWORD_LEN,
            &mut self.sorted_syms,
            false,
        )?;
        Some(())
    }

    fn build_litlen_and_offset_decode_tables(
        &mut self,
        num_litlen_syms: usize,
        num_offset_syms: usize,
    ) -> Option<()> {
        let (litlen_lens, offset_lens) = self.lens.split_at_checked(num_litlen_syms)?;
        build_decode_table(
            &mut self.offset_decode_table,
            offset_lens.get(..num_offset_syms)?,
            &OFFSET_DECODE_RESULTS,
            OFFSET_TABLEBITS,
            MAX_OFFSET_CODEWORD_LEN,
            &mut self.sorted_syms,
            false,
        )?;
        self.litlen_tablebits = build_decode_table(
            &mut self.litlen_decode_table,
            litlen_lens,
            &LITLEN_DECODE_RESULTS,
            LITLEN_TABLEBITS,
            MAX_LITLEN_CODEWORD_LEN,
            &mut self.sorted_syms,
            true,
        )?;
        Some(())
    }
}

/// Where decoding goes on after the caller has made more room for output.
#[derive(Clone, Copy)]
enum Resume {
    BlockHeader,
    /// The header of an uncompressed block of this many bytes has been read.
    Uncompressed(usize),
    /// The decode tables of the current block are built.
    Huffman,
}

/// The state of one stream between calls of [`Inflate::run`].
pub(crate) struct Inflate {
    in_pos: usize,
    bitbuf: BitBuf,
    /// The number of consumable bits in `bitbuf` is the low byte. The rest is garbage, from subtracting whole table entries.
    bitsleft: u32,
    /// How many zero bytes were supplied past the end of the input. An error only if their bits turn out to be consumed.
    overread_count: usize,
    out_pos: usize,
    is_final_block: bool,
    resume: Resume,
}

/// What it takes to get a longer output.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Growth {
    /// There is none to be had.
    None,
    /// Little, so it is asked for while the fast loop still has room.
    Cheap,
    /// A reallocation, so it is asked for only when the next literal or match does not fit.
    Costly,
}

pub(crate) enum Progress {
    /// The final block has ended.
    Done { read: usize, written: usize },
    /// Call again with an output of at least this many bytes, whose start is unchanged.
    NeedsOutput(usize),
}

#[inline(always)]
fn load_word(input: &[u8], pos: usize) -> Option<BitBuf> {
    Some(BitBuf::from_le_bytes(*input.get(pos..)?.first_chunk()?))
}

#[inline(always)]
fn bitmask(nbits: u32) -> BitBuf {
    (1 as BitBuf).wrapping_shl(nbits).wrapping_sub(1)
}

#[inline(always)]
fn copy_word(out: &mut [u8], src: usize, dst: usize) -> Option<()> {
    let word: [u8; WORD_BYTES] = *out.get(src..)?.first_chunk()?;
    *out.get_mut(dst..)?.first_chunk_mut()? = word;
    Some(())
}

/// Copies a match in the fast loop. May write up to `5 * WORD_BYTES - 1` bytes past its end.
#[inline(always)]
fn copy_match_fast(out: &mut [u8], dst: usize, offset: usize, length: usize) -> Option<()> {
    let end = dst + length;
    let (mut src, mut dst) = (dst - offset, dst);
    if offset >= WORD_BYTES {
        loop {
            for _ in 0..5 {
                copy_word(out, src, dst)?;
                src += WORD_BYTES;
                dst += WORD_BYTES;
            }
            if dst >= end {
                break;
            }
        }
    } else if offset == 1 {
        let byte = *out.get(src)?;
        out.get_mut(dst..dst + length.next_multiple_of(4 * WORD_BYTES))?
            .fill(byte);
    } else {
        copy_word(out, src, dst)?;
        src += offset;
        dst += offset;
        copy_word(out, src, dst)?;
        src += offset;
        dst += offset;
        loop {
            copy_word(out, src, dst)?;
            src += offset;
            dst += offset;
            copy_word(out, src, dst)?;
            src += offset;
            dst += offset;
            if dst >= end {
                break;
            }
        }
    }
    Some(())
}

impl Inflate {
    pub(crate) fn new() -> Self {
        Self {
            in_pos: 0,
            bitbuf: 0,
            bitsleft: 0,
            overread_count: 0,
            out_pos: 0,
            is_final_block: false,
            resume: Resume::BlockHeader,
        }
    }

    /// Decodes until the stream ends or `out` is too small, which is an error only if `growth` is `None`.
    pub(crate) fn run(
        &mut self,
        tables: &mut Tables,
        input: &[u8],
        out: &mut [u8],
        growth: Growth,
    ) -> Result<Progress> {
        let in_fastloop_end = input.len().saturating_sub(FASTLOOP_MAX_BYTES_READ);
        let out_fastloop_end = out.len().saturating_sub(FASTLOOP_MAX_BYTES_WRITTEN);

        let Self {
            mut in_pos,
            mut bitbuf,
            mut bitsleft,
            mut overread_count,
            mut out_pos,
            mut is_final_block,
            mut resume,
        } = *self;

        /// An index that the surrounding code keeps in bounds turned out not to be.
        macro_rules! checked {
            ($option:expr) => {
                match $option {
                    Some(value) => value,
                    None => return Err(Error::BadData),
                }
            };
        }
        macro_rules! safety_check {
            ($condition:expr) => {
                if !$condition {
                    return Err(Error::BadData);
                }
            };
        }
        /// ORs in the next word of input above the bits that are left, and moves `in_pos` past the bytes that fit whole.
        macro_rules! refill_word {
            ($word:expr) => {
                bitbuf |= $word.wrapping_shl(bitsleft);
                in_pos += WORD_BYTES - 1;
                in_pos -= ((bitsleft >> 3) & 0x7) as usize;
                bitsleft |= MAX_BITSLEFT & !7;
            };
        }
        /// Makes `CONSUMABLE_NBITS` bits consumable, with up to a word of zero bytes past the end of the input.
        macro_rules! refill_bits {
            () => {
                if let Some(word) = load_word(input, in_pos) {
                    refill_word!(word);
                } else {
                    while u32::from(bitsleft as u8) < CONSUMABLE_NBITS {
                        if let Some(&byte) = input.get(in_pos) {
                            bitbuf |= BitBuf::from(byte).wrapping_shl(bitsleft);
                            in_pos += 1;
                        } else {
                            overread_count += 1;
                            safety_check!(overread_count <= WORD_BYTES);
                        }
                        bitsleft = bitsleft.wrapping_add(8);
                    }
                }
            };
        }
        /// For where `in_pos < in_fastloop_end` was checked at the start of the round.
        macro_rules! refill_bits_in_fastloop {
            () => {
                refill_word!(checked!(load_word(input, in_pos)));
            };
        }
        macro_rules! consume {
            ($nbits:expr) => {
                bitbuf = bitbuf.wrapping_shr($nbits);
                bitsleft = bitsleft.wrapping_sub($nbits);
            };
        }
        macro_rules! litlen_entry {
            ($index:expr) => {
                *checked!(tables.litlen_decode_table.get(($index) as usize))
            };
        }
        macro_rules! offset_entry {
            ($index:expr) => {
                *checked!(tables.offset_decode_table.get(($index) as usize))
            };
        }
        macro_rules! subtable_index {
            ($entry:expr) => {
                BitBuf::from($entry >> 16) + (bitbuf & bitmask(($entry >> 8) & 0x3F))
            };
        }
        /// The base value of a length or offset entry plus its extra bits, which follow the codeword in `$bits`.
        macro_rules! base_plus_extra_bits {
            ($entry:expr, $bits:expr) => {
                ($entry >> 16) as usize
                    + ($bits & bitmask($entry)).wrapping_shr($entry >> 8) as usize
            };
        }
        macro_rules! put_literal {
            ($literal:expr) => {
                *checked!(out.get_mut(out_pos)) = $literal as u8;
                out_pos += 1;
            };
        }
        macro_rules! needs_output {
            ($len:expr) => {
                *self = Self {
                    in_pos,
                    bitbuf,
                    bitsleft,
                    overread_count,
                    out_pos,
                    is_final_block,
                    resume,
                };
                return Ok(Progress::NeedsOutput(out_pos + $len));
            };
        }

        loop {
            if let Resume::BlockHeader = resume {
                refill_bits!();

                is_final_block = bitbuf & 1 != 0;
                let block_type = ((bitbuf >> 1) & 3) as u32;

                if block_type == BLOCKTYPE_DYNAMIC_HUFFMAN {
                    let num_litlen_syms = 257 + ((bitbuf >> 3) & 31) as usize;
                    let num_offset_syms = 1 + ((bitbuf >> 8) & 31) as usize;
                    let num_explicit_precode_lens = 4 + ((bitbuf >> 13) & 15) as usize;

                    tables.static_codes_loaded = false;

                    // All the precode lengths but one fit a full bit buffer, so the first is taken together with the counts.
                    tables.precode_lens = [0; _];
                    let mut precode_syms = PRECODE_LENS_PERMUTATION
                        .iter()
                        .take(num_explicit_precode_lens);
                    if let Some(&sym) = precode_syms.next() {
                        *checked!(tables.precode_lens.get_mut(usize::from(sym))) =
                            ((bitbuf >> 17) & 7) as u8;
                    }
                    consume!(20);
                    refill_bits!();
                    for &sym in precode_syms {
                        *checked!(tables.precode_lens.get_mut(usize::from(sym))) =
                            (bitbuf & 7) as u8;
                        consume!(3);
                    }

                    safety_check!(tables.build_precode_decode_table().is_some());

                    // A run may go past the end of the list: `lens` has room for the longest, and it is an error afterwards.
                    let num_lens = num_litlen_syms + num_offset_syms;
                    let mut i = 0;
                    while i < num_lens {
                        if u32::from(bitsleft as u8) < MAX_PRE_CODEWORD_LEN + 7 {
                            refill_bits!();
                        }

                        let entry = *checked!(
                            tables
                                .precode_decode_table
                                .get((bitbuf & bitmask(MAX_PRE_CODEWORD_LEN)) as usize)
                        );
                        consume!(entry);
                        let presym = entry >> 16;

                        if presym < 16 {
                            *checked!(tables.lens.get_mut(i)) = presym as u8;
                            i += 1;
                        } else if presym == 16 {
                            // Repeat the previous length 3 to 6 times.
                            safety_check!(i != 0);
                            let rep_val = *checked!(tables.lens.get(i - 1));
                            let rep_count = 3 + (bitbuf & 3) as usize;
                            consume!(2);
                            checked!(tables.lens.get_mut(i..i + 6)).fill(rep_val);
                            i += rep_count;
                        } else if presym == 17 {
                            // Repeat zero 3 to 10 times.
                            let rep_count = 3 + (bitbuf & 7) as usize;
                            consume!(3);
                            checked!(tables.lens.get_mut(i..i + 10)).fill(0);
                            i += rep_count;
                        } else {
                            // Repeat zero 11 to 138 times.
                            let rep_count = 11 + (bitbuf & 127) as usize;
                            consume!(7);
                            checked!(tables.lens.get_mut(i..i + rep_count)).fill(0);
                            i += rep_count;
                        }
                    }
                    safety_check!(i == num_lens);

                    safety_check!(
                        tables
                            .build_litlen_and_offset_decode_tables(num_litlen_syms, num_offset_syms)
                            .is_some()
                    );
                    resume = Resume::Huffman;
                } else if block_type == BLOCKTYPE_UNCOMPRESSED {
                    // Back to the byte boundary after the three header bits, giving back the whole bytes in the bit buffer.
                    bitsleft = u32::from(bitsleft.wrapping_sub(3) as u8);
                    let unread_bytes = (bitsleft >> 3) as usize;
                    safety_check!(overread_count <= unread_bytes);
                    in_pos -= unread_bytes - overread_count;
                    overread_count = 0;
                    bitbuf = 0;
                    bitsleft = 0;

                    let Some(&[len0, len1, nlen0, nlen1]) =
                        input.get(in_pos..).and_then(|rest| rest.first_chunk())
                    else {
                        return Err(Error::BadData);
                    };
                    let len = u16::from_le_bytes([len0, len1]);
                    safety_check!(len == !u16::from_le_bytes([nlen0, nlen1]));
                    in_pos += 4;
                    resume = Resume::Uncompressed(usize::from(len));
                } else {
                    safety_check!(block_type == BLOCKTYPE_STATIC_HUFFMAN);
                    consume!(3);

                    if !tables.static_codes_loaded {
                        tables.static_codes_loaded = true;
                        let lens = &mut tables.lens;
                        checked!(lens.get_mut(..144)).fill(8);
                        checked!(lens.get_mut(144..256)).fill(9);
                        checked!(lens.get_mut(256..280)).fill(7);
                        checked!(lens.get_mut(280..288)).fill(8);
                        checked!(lens.get_mut(288..288 + 32)).fill(5);
                        safety_check!(
                            tables
                                .build_litlen_and_offset_decode_tables(288, 32)
                                .is_some()
                        );
                    }
                    resume = Resume::Huffman;
                }
            }

            if let Resume::Uncompressed(len) = resume {
                let Some(dst) = out.get_mut(out_pos..out_pos + len) else {
                    if growth != Growth::None {
                        needs_output!(len);
                    }
                    return Err(Error::InsufficientSpace);
                };
                let Some(src) = input.get(in_pos..in_pos + len) else {
                    return Err(Error::BadData);
                };
                dst.copy_from_slice(src);
                in_pos += len;
                out_pos += len;
            } else {
                'block: {
                    let litlen_tablemask = bitmask(tables.litlen_tablebits);

                    if growth == Growth::Cheap && out_pos >= out_fastloop_end {
                        needs_output!(FASTLOOP_MAX_BYTES_WRITTEN + 1);
                    }

                    // The fast loop checks once per round that there is room for the most a round can read and write.
                    if in_pos < in_fastloop_end && out_pos < out_fastloop_end {
                        refill_bits_in_fastloop!();
                        let mut entry = litlen_entry!(bitbuf & litlen_tablemask);
                        loop {
                            // The extra bits of a length follow its codeword and are consumed with it.
                            let mut saved_bitbuf = bitbuf;
                            consume!(entry);

                            'item: {
                                if entry & HUFFDEC_LITERAL != 0 {
                                    // There are bits enough for two literals on top of the round's main item.
                                    let literal = entry >> 16;
                                    entry = litlen_entry!(bitbuf & litlen_tablemask);
                                    saved_bitbuf = bitbuf;
                                    consume!(entry);
                                    put_literal!(literal);
                                    if entry & HUFFDEC_LITERAL != 0 {
                                        let literal = entry >> 16;
                                        entry = litlen_entry!(bitbuf & litlen_tablemask);
                                        saved_bitbuf = bitbuf;
                                        consume!(entry);
                                        put_literal!(literal);
                                        if entry & HUFFDEC_LITERAL != 0 {
                                            // A third literal is the main item.
                                            let literal = entry >> 16;
                                            entry = litlen_entry!(bitbuf & litlen_tablemask);
                                            refill_bits_in_fastloop!();
                                            put_literal!(literal);
                                            break 'item;
                                        }
                                    }
                                }

                                if entry & HUFFDEC_EXCEPTIONAL != 0 {
                                    if entry & HUFFDEC_END_OF_BLOCK != 0 {
                                        break 'block;
                                    }
                                    // A subtable entry can be of any kind but a pointer.
                                    entry = litlen_entry!(subtable_index!(entry));
                                    saved_bitbuf = bitbuf;
                                    consume!(entry);
                                    if entry & HUFFDEC_LITERAL != 0 {
                                        let literal = entry >> 16;
                                        entry = litlen_entry!(bitbuf & litlen_tablemask);
                                        refill_bits_in_fastloop!();
                                        put_literal!(literal);
                                        break 'item;
                                    }
                                    if entry & HUFFDEC_END_OF_BLOCK != 0 {
                                        break 'block;
                                    }
                                }

                                let length = base_plus_extra_bits!(entry, saved_bitbuf);

                                // The bits at hand are enough to fetch the offset entry, but maybe not to consume it.
                                entry = offset_entry!(bitbuf & bitmask(OFFSET_TABLEBITS));
                                if entry & HUFFDEC_EXCEPTIONAL != 0 {
                                    if u32::from(bitsleft as u8)
                                        < OFFSET_MAXBITS + LITLEN_TABLEBITS - PRELOAD_SLACK
                                    {
                                        refill_bits_in_fastloop!();
                                    }
                                    consume!(OFFSET_TABLEBITS);
                                    entry = offset_entry!(subtable_index!(entry));
                                } else if u32::from(bitsleft as u8)
                                    < OFFSET_MAXFASTBITS + LITLEN_TABLEBITS - PRELOAD_SLACK
                                {
                                    refill_bits_in_fastloop!();
                                }
                                saved_bitbuf = bitbuf;
                                consume!(entry);
                                let offset = base_plus_extra_bits!(entry, saved_bitbuf);

                                safety_check!(offset <= out_pos);
                                let dst = out_pos;
                                out_pos += length;

                                entry = litlen_entry!(bitbuf & litlen_tablemask);
                                refill_bits_in_fastloop!();

                                checked!(copy_match_fast(out, dst, offset, length));
                            }

                            if !(in_pos < in_fastloop_end && out_pos < out_fastloop_end) {
                                break;
                            }
                        }
                        if growth == Growth::Cheap && out_pos >= out_fastloop_end {
                            needs_output!(FASTLOOP_MAX_BYTES_WRITTEN + 1);
                        }
                    }

                    // The same without the assumptions, for the ends of the input and the output.
                    loop {
                        if growth == Growth::Cheap && out.len() - out_pos < MAX_MATCH_LEN as usize {
                            needs_output!(FASTLOOP_MAX_BYTES_WRITTEN + 1);
                        }
                        let before_item = (in_pos, bitbuf, bitsleft, overread_count);
                        /// Goes back to before the item that takes `$len` bytes, to decode it again in a longer output.
                        macro_rules! out_of_space {
                            ($len:expr) => {
                                if growth == Growth::None {
                                    return Err(Error::InsufficientSpace);
                                }
                                (in_pos, bitbuf, bitsleft, overread_count) = before_item;
                                needs_output!($len);
                            };
                        }

                        refill_bits!();
                        let mut entry = litlen_entry!(bitbuf & litlen_tablemask);
                        let mut saved_bitbuf = bitbuf;
                        consume!(entry);
                        if entry & HUFFDEC_SUBTABLE_POINTER != 0 {
                            entry = litlen_entry!(subtable_index!(entry));
                            saved_bitbuf = bitbuf;
                            consume!(entry);
                        }
                        if entry & HUFFDEC_LITERAL != 0 {
                            let Some(slot) = out.get_mut(out_pos) else {
                                out_of_space!(1);
                            };
                            *slot = (entry >> 16) as u8;
                            out_pos += 1;
                            continue;
                        }
                        if entry & HUFFDEC_END_OF_BLOCK != 0 {
                            break 'block;
                        }
                        let length = base_plus_extra_bits!(entry, saved_bitbuf);
                        if length > out.len() - out_pos {
                            out_of_space!(length);
                        }

                        entry = offset_entry!(bitbuf & bitmask(OFFSET_TABLEBITS));
                        if entry & HUFFDEC_EXCEPTIONAL != 0 {
                            consume!(OFFSET_TABLEBITS);
                            entry = offset_entry!(subtable_index!(entry));
                        }
                        let offset = base_plus_extra_bits!(entry, bitbuf);
                        consume!(entry);

                        safety_check!(offset <= out_pos);
                        let window = checked!(out.get_mut(out_pos - offset..out_pos + length));
                        for i in offset..window.len() {
                            *checked!(window.get_mut(i)) = *checked!(window.get(i - offset));
                        }
                        out_pos += length;
                    }
                }
            }

            if is_final_block {
                break;
            }
            resume = Resume::BlockHeader;
        }

        // Whole bytes left in the bit buffer have not been read. Fewer of them than made-up bytes means that made-up bits were consumed.
        let unread_bytes = usize::from(bitsleft as u8 >> 3);
        safety_check!(overread_count <= unread_bytes);
        in_pos -= unread_bytes - overread_count;

        Ok(Progress::Done {
            read: in_pos,
            written: out_pos,
        })
    }
}
