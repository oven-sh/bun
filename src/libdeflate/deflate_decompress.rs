//! DEFLATE decompression (RFC 1951) of a whole stream held in memory. README.md explains the tables and the bit buffer.

use core::cell::Cell;

use crate::constants::*;
use crate::error::{Error, Result};
use crate::output::Output;

/// The bits read from the input and not consumed yet, lowest first.
type BitBuf = u64;

const BITBUF_NBITS: u32 = BitBuf::BITS;
const WORD_BYTES: usize = size_of::<BitBuf>();

/// The most bits that count as consumable: one less than the buffer holds, which makes a refill a plain OR.
const MAX_BITSLEFT: u32 = BITBUF_NBITS - 1;

/// What a refill guarantees to be consumable. Only whole bytes are added.
const CONSUMABLE_NBITS: u32 = MAX_BITSLEFT - 7;

/// What `refill_word!` leaves in the buffer. Bits past `bitsleft` may be looked at, to fetch an entry early.
const FASTLOOP_PRELOADABLE_NBITS: u32 = BITBUF_NBITS;

const PRELOAD_SLACK: u32 = FASTLOOP_PRELOADABLE_NBITS - MAX_BITSLEFT;

const fn can_consume(nbits: u32) -> bool {
    CONSUMABLE_NBITS >= nbits
}

const fn can_consume_and_then_preload(consume_nbits: u32, preload_nbits: u32) -> bool {
    CONSUMABLE_NBITS >= consume_nbits && FASTLOOP_PRELOADABLE_NBITS >= consume_nbits + preload_nbits
}

// Index bits of each main table, and its size with the most subtables (zlib's `enough 19 7 7`, `288 11 15`, `32 8 15`).
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

const LENGTH_MAXBITS: u32 = DEFLATE_MAX_LITLEN_CODEWORD_LEN + DEFLATE_MAX_EXTRA_LENGTH_BITS;
const OFFSET_MAXBITS: u32 = DEFLATE_MAX_OFFSET_CODEWORD_LEN + DEFLATE_MAX_EXTRA_OFFSET_BITS;
const OFFSET_MAXFASTBITS: u32 = OFFSET_TABLEBITS + DEFLATE_MAX_EXTRA_OFFSET_BITS;

/// What one vector load or store moves.
const CHUNK_BYTES: usize = 16;

/// How much of a match the fast loop copies at a time: two chunks and a word.
const COPY_STEP: usize = 2 * CHUNK_BYTES + WORD_BYTES;

/// The most the fast loop writes in one round: two literals, the longest match, and what the copy writes past its end.
const FASTLOOP_MAX_BYTES_WRITTEN: usize = 2 + DEFLATE_MAX_MATCH_LEN as usize + COPY_STEP - 1;

/// The most the fast loop reads in one round: the bits it can refill, and the word a refill loads.
const FASTLOOP_MAX_BYTES_READ: usize =
    (MAX_BITSLEFT + 2 * LITLEN_TABLEBITS + LENGTH_MAXBITS + OFFSET_MAXBITS).div_ceil(8) as usize
        + WORD_BYTES;

// What the decoding loops below take for granted about the size of the bit buffer.
const _: () = {
    assert!(can_consume(1 + 2 + 5 + 5 + 4 + 3));
    assert!(can_consume(3 * (DEFLATE_NUM_PRECODE_SYMS as u32 - 1)));
    assert!(PRECODE_TABLEBITS == DEFLATE_MAX_PRE_CODEWORD_LEN);
    assert!(can_consume_and_then_preload(
        2 * LITLEN_TABLEBITS + LENGTH_MAXBITS,
        OFFSET_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        2 * LITLEN_TABLEBITS + DEFLATE_MAX_LITLEN_CODEWORD_LEN,
        LITLEN_TABLEBITS
    ));
    assert!(can_consume_and_then_preload(
        OFFSET_MAXBITS,
        LITLEN_TABLEBITS
    ));
    assert!(can_consume(LENGTH_MAXBITS + OFFSET_MAXBITS));
};

/// Precode entry: bits 20-16 are the symbol, bits 2-0 the codeword length.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static PRECODE_DECODE_RESULTS: [u32; DEFLATE_NUM_PRECODE_SYMS] = {
    let mut results = [0; DEFLATE_NUM_PRECODE_SYMS];
    let mut sym = 0;
    while sym < DEFLATE_NUM_PRECODE_SYMS {
        results[sym] = (sym as u32) << 16;
        sym += 1;
    }
    results
};

/// The part of a litlen entry that depends on the symbol alone.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static LITLEN_DECODE_RESULTS: [u32; DEFLATE_NUM_LITLEN_SYMS] = {
    let mut results = [0; DEFLATE_NUM_LITLEN_SYMS];
    let mut sym = 0;
    while sym < DEFLATE_NUM_LITERALS {
        results[sym] = HUFFDEC_LITERAL | ((sym as u32) << 16);
        sym += 1;
    }
    results[DEFLATE_END_OF_BLOCK] = HUFFDEC_EXCEPTIONAL | HUFFDEC_END_OF_BLOCK;
    let mut sym = DEFLATE_FIRST_LEN_SYM;
    while sym < DEFLATE_NUM_LITLEN_SYMS {
        // The last two symbols are not valid. They decode like the one before them.
        let slot = if sym - DEFLATE_FIRST_LEN_SYM < 29 {
            sym - DEFLATE_FIRST_LEN_SYM
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
static OFFSET_DECODE_RESULTS: [u32; DEFLATE_NUM_OFFSET_SYMS] = {
    let mut results = [0; DEFLATE_NUM_OFFSET_SYMS];
    let mut sym = 0;
    while sym < DEFLATE_NUM_OFFSET_SYMS {
        // The last two symbols are not valid. They decode like the one before them.
        let slot = if sym < 30 { sym } else { 29 };
        results[sym] = ((OFFSET_SLOT_BASE[slot] as u32) << 16) | EXTRA_OFFSET_BITS[slot] as u32;
        sym += 1;
    }
    results
};

/// The decode tables, kept between calls so that streams of static blocks build the static tables once.
pub(crate) struct Tables {
    precode_lens: [u8; DEFLATE_NUM_PRECODE_SYMS],
    lens: [u8; DEFLATE_NUM_LITLEN_SYMS + DEFLATE_NUM_OFFSET_SYMS + DEFLATE_MAX_LENS_OVERRUN],
    precode_decode_table: [u32; PRECODE_ENOUGH],
    litlen_decode_table: [u32; LITLEN_ENOUGH],
    offset_decode_table: [u32; OFFSET_ENOUGH],
    sorted_syms: [u16; DEFLATE_MAX_NUM_SYMS],
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

/// Builds the table for the code in which symbol `i` has `lens[i]` bits. `None` for lengths this decoder refuses.
fn build_decode_table(
    decode_table: &mut [u32],
    lens: &[u8],
    decode_results: &[u32],
    mut table_bits: u32,
    mut max_codeword_len: u32,
    sorted_syms: &mut [u16; DEFLATE_MAX_NUM_SYMS],
    table_bits_ret: Option<&mut u32>,
) -> Option<()> {
    let mut len_counts = [0u32; DEFLATE_MAX_CODEWORD_LEN + 1];
    let mut offsets = [0u32; DEFLATE_MAX_CODEWORD_LEN + 1];

    for &len in lens {
        *len_counts.get_mut(usize::from(len))? += 1;
    }
    let count_of = |len: u32| len_counts.get(len as usize).copied();

    while max_codeword_len > 1 && count_of(max_codeword_len)? == 0 {
        max_codeword_len -= 1;
    }
    // A caller that can deal with a smaller main table gets one with no more index bits than the longest codeword has.
    if let Some(table_bits_ret) = table_bits_ret {
        table_bits = table_bits.min(max_codeword_len);
        *table_bits_ret = table_bits;
    }

    // Sort the symbols by codeword length, then value, and add up how much of the codespace their codewords use.
    let mut codespace_used = 0u32;
    offsets[1] = len_counts[0];
    for len in 1..max_codeword_len {
        let count = count_of(len)?;
        *offsets.get_mut(len as usize + 1)? = *offsets.get(len as usize)? + count;
        codespace_used = (codespace_used << 1) + count;
    }
    codespace_used = (codespace_used << 1) + count_of(max_codeword_len)?;

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
        // The only incomplete codes allowed: none, and one codeword of one bit. Its symbol (or symbol 0) gets both.
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
        return Some(());
    }

    // Codewords that fit the main table: fill `2^len` entries, and double them by copying each time `len` goes up.
    let mut codeword = 0u32;
    let mut len = 1u32;
    let mut count = count_of(len)?;
    while count == 0 {
        len += 1;
        count = count_of(len)?;
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
                return Some(());
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
            count = count_of(len)?;
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
                codespace_used = (codespace_used << 1) + count_of(table_bits + subtable_bits)?;
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
            return Some(());
        }
        codeword = next_codeword(codeword, len)?;
        count -= 1;
        while count == 0 {
            len += 1;
            count = count_of(len)?;
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
            DEFLATE_MAX_PRE_CODEWORD_LEN,
            &mut self.sorted_syms,
            None,
        )
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
            DEFLATE_MAX_OFFSET_CODEWORD_LEN,
            &mut self.sorted_syms,
            None,
        )?;
        build_decode_table(
            &mut self.litlen_decode_table,
            litlen_lens,
            &LITLEN_DECODE_RESULTS,
            LITLEN_TABLEBITS,
            DEFLATE_MAX_LITLEN_CODEWORD_LEN,
            &mut self.sorted_syms,
            Some(&mut self.litlen_tablebits),
        )
    }
}

#[inline(always)]
fn load_word(input: &[u8], pos: usize) -> Option<BitBuf> {
    Some(BitBuf::from_le_bytes(*input.get(pos..)?.first_chunk()?))
}

#[inline(always)]
fn bitmask(nbits: u32) -> BitBuf {
    (1 as BitBuf).wrapping_shl(nbits).wrapping_sub(1)
}

/// `bitmask` of 0 to 63. Without BMI2, a lookup takes far fewer instructions than computing one, and no register.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static BITMASKS: [BitBuf; BITBUF_NBITS as usize] = {
    let mut masks = [0; BITBUF_NBITS as usize];
    let mut nbits = 0;
    while nbits < BITBUF_NBITS {
        masks[nbits as usize] = (1 << nbits) - 1;
        nbits += 1;
    }
    masks
};

/// Where a subtable pointer and the bits after the main table's lead.
#[inline(always)]
fn subtable_index(entry: u32, bitbuf: BitBuf) -> usize {
    (entry >> 16) as usize + (bitbuf & bitmask((entry >> 8) & 0x3F)) as usize
}

/// The base value of a length or offset entry plus its extra bits, which follow the codeword in `bits`.
#[inline(always)]
fn base_plus_extra_bits(entry: u32, bits: BitBuf) -> Option<usize> {
    let codeword_and_extra_bits = bits & BITMASKS.get((entry % BITBUF_NBITS) as usize)?;
    Some((entry >> 16) as usize + codeword_and_extra_bits.wrapping_shr(entry >> 8) as usize)
}

/// Copies the first `COPY_STEP` bytes of `window` to its last `COPY_STEP`, which may overlap them from a chunk in.
#[inline(always)]
fn copy_step(window: &mut [u8]) -> Option<()> {
    let offset = window.len().checked_sub(COPY_STEP)?;
    let chunk: [u8; CHUNK_BYTES] = *window.first_chunk()?;
    *window.get_mut(offset..)?.first_chunk_mut()? = chunk;
    let chunk: [u8; CHUNK_BYTES] = *window.get(CHUNK_BYTES..)?.first_chunk()?;
    *window.get_mut(offset + CHUNK_BYTES..)?.first_chunk_mut()? = chunk;
    let word: [u8; WORD_BYTES] = *window.get(2 * CHUNK_BYTES..)?.first_chunk()?;
    *window
        .get_mut(offset + 2 * CHUNK_BYTES..)?
        .first_chunk_mut()? = word;
    Some(())
}

/// Writes the first `N` bytes of `window` every `stride` bytes from `stride` on, until `end` is covered.
#[inline(always)]
fn repeat_prefix<const N: usize>(window: &mut [u8], stride: usize, end: usize) -> Option<()> {
    let prefix: [u8; N] = *window.first_chunk()?;
    let mut at = stride;
    while at < end {
        *window.get_mut(at..)?.first_chunk_mut()? = prefix;
        at += stride;
    }
    Some(())
}

/// For 2 to 7 bytes: what to multiply them by for as many whole repeats as fit a word, and how many bytes those are.
static REPEATS_IN_WORD: [(BitBuf, u8); 6] = [
    (0x0001_0001_0001_0001, 8),
    (0x0100_0001, 6),
    (0x0001_0000_0001, 8),
    (1, 5),
    (1, 6),
    (1, 7),
];

/// Copies a match that starts `offset` bytes into `window` from the start of it, and up to `COPY_STEP - 1` bytes more.
#[cold]
#[inline(never)]
fn copy_long_or_overlapping_match(
    mut window: &mut [u8],
    offset: usize,
    length: usize,
) -> Option<()> {
    let end = offset + length;
    if offset == 1 {
        let byte = *window.first()?;
        window
            .get_mut(1..1 + length.next_multiple_of(WORD_BYTES))?
            .fill(byte);
        Some(())
    } else if offset >= COPY_STEP {
        let mut copied = 0;
        while copied < length {
            copy_step(window.get_mut(..offset + COPY_STEP)?)?;
            window = window.get_mut(COPY_STEP..)?;
            copied += COPY_STEP;
        }
        Some(())
    } else if offset > 2 * CHUNK_BYTES {
        // The match repeats its first `offset` bytes. Nothing written is read again, which would wait for the write.
        repeat_prefix::<COPY_STEP>(window, offset, end)
    } else if offset > CHUNK_BYTES {
        repeat_prefix::<{ 2 * CHUNK_BYTES }>(window, offset, end)
    } else if offset >= WORD_BYTES {
        repeat_prefix::<CHUNK_BYTES>(window, offset, end)
    } else {
        let &(multiplier, stride) = REPEATS_IN_WORD.get(offset.checked_sub(2)?)?;
        let first = BitBuf::from_le_bytes(*window.first_chunk()?) & bitmask(8 * offset as u32);
        let word = first.wrapping_mul(multiplier).to_le_bytes();
        let mut at = offset;
        while at < end {
            *window.get_mut(at..)?.first_chunk_mut()? = word;
            at += usize::from(stride);
        }
        Some(())
    }
}

/// Copies a match to `out_pos` byte by byte, and nothing past its end. `None` if its source starts before `out` does.
#[inline(always)]
fn copy_match(out: &mut [u8], out_pos: usize, length: usize, offset: usize) -> Option<()> {
    let window = out.get_mut(out_pos.checked_sub(offset)?..out_pos + length)?;
    let window = Cell::from_mut(window).as_slice_of_cells();
    for (src, dst) in window.iter().zip(window.get(offset..)?) {
        dst.set(src.get());
    }
    Some(())
}

/// How far one stream has been decoded.
struct Decoder<'a> {
    input: &'a [u8],
    in_pos: usize,
    bitbuf: BitBuf,
    /// The low byte is the number of consumable bits in `bitbuf`. The rest is garbage, from subtracting whole entries.
    bitsleft: u32,
    /// How many zero bytes were supplied past the end of the input. An error only if their bits get consumed.
    overread_count: usize,
    out_pos: usize,
}

enum Block {
    /// Of this many bytes.
    Uncompressed(usize),
    /// To be decoded with the litlen and offset tables.
    Huffman,
}

enum Item {
    Literal(u8),
    Match { length: usize, offset: usize },
    EndOfBlock,
}

enum FastloopEnd {
    EndOfBlock,
    /// Another round could go past the end of the input or the output.
    NoRoom,
}

/// Decodes a Huffman block, checking once per round for room for the most a round reads and writes. `None` is bad data.
#[rustc_align(64)]
#[inline(never)]
fn fastloop<const FULL_LITLEN_TABLE: bool>(
    tables: &Tables,
    out: &mut [u8],
    decoder: &mut Decoder<'_>,
) -> Option<FastloopEnd> {
    let Decoder {
        input,
        in_pos,
        mut bitbuf,
        mut bitsleft,
        mut out_pos,
        ..
    } = *decoder;
    let mut rest = input.get(in_pos..)?;
    let litlen_tablemask = bitmask(if FULL_LITLEN_TABLE {
        LITLEN_TABLEBITS
    } else {
        tables.litlen_tablebits
    });

    /// ORs in the next word of input above the bits that are left, and moves on past the bytes that fit whole.
    macro_rules! refill_word {
        () => {
            bitbuf |= BitBuf::from_le_bytes(*rest.first_chunk()?).wrapping_shl(bitsleft);
            rest = rest.get(WORD_BYTES - 1 - ((bitsleft >> 3) & 0x7) as usize..)?;
            bitsleft |= MAX_BITSLEFT & !7;
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
            *tables.litlen_decode_table.get(($index) as usize)?
        };
    }
    macro_rules! offset_entry {
        ($index:expr) => {
            *tables.offset_decode_table.get(($index) as usize)?
        };
    }
    macro_rules! has_room {
        () => {
            rest.len() > FASTLOOP_MAX_BYTES_READ && out_pos + FASTLOOP_MAX_BYTES_WRITTEN < out.len()
        };
    }
    macro_rules! put_literal {
        ($literal:expr) => {
            *out.get_mut(out_pos)? = $literal as u8;
            out_pos += 1;
        };
    }

    let end = 'rounds: {
        if !has_room!() {
            break 'rounds FastloopEnd::NoRoom;
        }
        refill_word!();
        let mut entry = litlen_entry!(bitbuf & litlen_tablemask);
        loop {
            if !has_room!() {
                break 'rounds FastloopEnd::NoRoom;
            }

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
                            refill_word!();
                            put_literal!(literal);
                            break 'item;
                        }
                    }
                }

                if entry & HUFFDEC_EXCEPTIONAL != 0 {
                    if entry & HUFFDEC_END_OF_BLOCK != 0 {
                        break 'rounds FastloopEnd::EndOfBlock;
                    }
                    // A subtable entry can be of any kind but a pointer.
                    entry = litlen_entry!(subtable_index(entry, bitbuf));
                    saved_bitbuf = bitbuf;
                    consume!(entry);
                    if entry & HUFFDEC_LITERAL != 0 {
                        let literal = entry >> 16;
                        entry = litlen_entry!(bitbuf & litlen_tablemask);
                        refill_word!();
                        put_literal!(literal);
                        break 'item;
                    }
                    if entry & HUFFDEC_END_OF_BLOCK != 0 {
                        break 'rounds FastloopEnd::EndOfBlock;
                    }
                }

                let length = base_plus_extra_bits(entry, saved_bitbuf)?;

                // The bits at hand are enough to fetch the offset entry, but maybe not to consume it.
                entry = offset_entry!(bitbuf & bitmask(OFFSET_TABLEBITS));
                if entry & HUFFDEC_EXCEPTIONAL != 0 {
                    if u32::from(bitsleft as u8) < OFFSET_MAXBITS + LITLEN_TABLEBITS - PRELOAD_SLACK
                    {
                        refill_word!();
                    }
                    consume!(OFFSET_TABLEBITS);
                    entry = offset_entry!(subtable_index(entry, bitbuf));
                } else if u32::from(bitsleft as u8)
                    < OFFSET_MAXFASTBITS + LITLEN_TABLEBITS - PRELOAD_SLACK
                {
                    refill_word!();
                }
                saved_bitbuf = bitbuf;
                consume!(entry);
                let offset = base_plus_extra_bits(entry, saved_bitbuf)?;

                entry = litlen_entry!(bitbuf & litlen_tablemask);
                refill_word!();

                let src = out_pos.checked_sub(offset)?;
                if length <= COPY_STEP && offset >= length.min(CHUNK_BYTES) {
                    copy_step(out.get_mut(src..out_pos + COPY_STEP)?)?;
                } else {
                    copy_long_or_overlapping_match(out.get_mut(src..)?, offset, length)?;
                }
                out_pos += length;
            }
        }
    };
    decoder.in_pos = input.len() - rest.len();
    decoder.bitbuf = bitbuf;
    decoder.bitsleft = bitsleft;
    decoder.out_pos = out_pos;
    Some(end)
}

impl Decoder<'_> {
    /// Makes `CONSUMABLE_NBITS` bits consumable. Past the end of the input come up to a word of zeros, then `None`.
    #[inline(always)]
    fn refill_bits(&mut self) -> Option<()> {
        if let Some(word) = load_word(self.input, self.in_pos) {
            self.bitbuf |= word.wrapping_shl(self.bitsleft);
            self.in_pos += WORD_BYTES - 1 - ((self.bitsleft >> 3) & 0x7) as usize;
            self.bitsleft |= MAX_BITSLEFT & !7;
            return Some(());
        }
        while u32::from(self.bitsleft as u8) < CONSUMABLE_NBITS {
            if let Some(&byte) = self.input.get(self.in_pos) {
                self.bitbuf |= BitBuf::from(byte).wrapping_shl(self.bitsleft);
                self.in_pos += 1;
            } else {
                self.overread_count += 1;
                if self.overread_count > WORD_BYTES {
                    return None;
                }
            }
            self.bitsleft = self.bitsleft.wrapping_add(8);
        }
        Some(())
    }

    #[inline(always)]
    fn consume(&mut self, nbits: u32) {
        self.bitbuf = self.bitbuf.wrapping_shr(nbits);
        self.bitsleft = self.bitsleft.wrapping_sub(nbits);
    }

    /// The next `nbits` bits.
    #[inline(always)]
    fn bits(&self, nbits: u32) -> usize {
        (self.bitbuf & bitmask(nbits)) as usize
    }

    #[inline(always)]
    fn take_bits(&mut self, nbits: u32) -> usize {
        let bits = self.bits(nbits);
        self.consume(nbits);
        bits
    }

    /// Un-reads the whole bytes left in the bit buffer and drops the other bits. `None` if made-up bits were consumed.
    fn align_to_byte(&mut self) -> Option<()> {
        let unread_bytes = usize::from(self.bitsleft as u8 >> 3);
        self.in_pos -= unread_bytes.checked_sub(self.overread_count)?;
        self.overread_count = 0;
        self.bitbuf = 0;
        self.bitsleft = 0;
        Some(())
    }

    /// Reads a block's header and builds its tables. Returns its kind and whether it is the last. `None` is bad data.
    fn read_block_header(&mut self, tables: &mut Tables) -> Option<(Block, bool)> {
        self.refill_bits()?;
        let is_final_block = self.take_bits(1) != 0;
        let block = match self.take_bits(2) as u32 {
            DEFLATE_BLOCKTYPE_DYNAMIC_HUFFMAN => {
                let num_litlen_syms = 257 + self.take_bits(5);
                let num_offset_syms = 1 + self.take_bits(5);
                let num_explicit_precode_lens = 4 + self.take_bits(4);

                tables.static_codes_loaded = false;

                // All the precode lengths but one fit a full bit buffer, so the first is taken with the counts.
                tables.precode_lens = [0; _];
                let mut precode_syms = PRECODE_LENS_PERMUTATION
                    .iter()
                    .take(num_explicit_precode_lens);
                let first_sym = usize::from(*precode_syms.next()?);
                *tables.precode_lens.get_mut(first_sym)? = self.take_bits(3) as u8;
                self.refill_bits()?;
                for &sym in precode_syms {
                    *tables.precode_lens.get_mut(usize::from(sym))? = self.take_bits(3) as u8;
                }
                tables.build_precode_decode_table()?;

                // A run may go past the end of the list. `lens` has room for the longest, and it is refused afterwards.
                let num_lens = num_litlen_syms + num_offset_syms;
                let mut i = 0;
                while i < num_lens {
                    if u32::from(self.bitsleft as u8) < DEFLATE_MAX_PRE_CODEWORD_LEN + 7 {
                        self.refill_bits()?;
                    }
                    let entry = *tables
                        .precode_decode_table
                        .get(self.bits(DEFLATE_MAX_PRE_CODEWORD_LEN))?;
                    self.consume(entry);

                    match entry >> 16 {
                        presym @ ..16 => {
                            *tables.lens.get_mut(i)? = presym as u8;
                            i += 1;
                        }
                        16 => {
                            // Repeat the previous length 3 to 6 times.
                            let rep_val = *tables.lens.get(i.checked_sub(1)?)?;
                            let rep_count = 3 + self.take_bits(2);
                            tables.lens.get_mut(i..i + 6)?.fill(rep_val);
                            i += rep_count;
                        }
                        17 => {
                            // Repeat zero 3 to 10 times.
                            let rep_count = 3 + self.take_bits(3);
                            tables.lens.get_mut(i..i + 10)?.fill(0);
                            i += rep_count;
                        }
                        _ => {
                            // Repeat zero 11 to 138 times.
                            let rep_count = 11 + self.take_bits(7);
                            tables.lens.get_mut(i..i + rep_count)?.fill(0);
                            i += rep_count;
                        }
                    }
                }
                if i != num_lens {
                    return None;
                }
                tables.build_litlen_and_offset_decode_tables(num_litlen_syms, num_offset_syms)?;
                Block::Huffman
            }
            DEFLATE_BLOCKTYPE_UNCOMPRESSED => {
                self.align_to_byte()?;
                let &[len0, len1, nlen0, nlen1] = self.input.get(self.in_pos..)?.first_chunk()?;
                let len = u16::from_le_bytes([len0, len1]);
                if len != !u16::from_le_bytes([nlen0, nlen1]) {
                    return None;
                }
                self.in_pos += 4;
                Block::Uncompressed(usize::from(len))
            }
            DEFLATE_BLOCKTYPE_STATIC_HUFFMAN => {
                if !tables.static_codes_loaded {
                    tables.static_codes_loaded = true;
                    let lens = &mut tables.lens;
                    lens.get_mut(..144)?.fill(8);
                    lens.get_mut(144..256)?.fill(9);
                    lens.get_mut(256..280)?.fill(7);
                    lens.get_mut(280..288)?.fill(8);
                    lens.get_mut(288..288 + 32)?.fill(5);
                    tables.build_litlen_and_offset_decode_tables(288, 32)?;
                }
                Block::Huffman
            }
            _ => return None,
        };
        Some((block, is_final_block))
    }

    fn copy_uncompressed_block(&mut self, len: usize, output: &mut Output<'_>) -> Result<()> {
        output.grow_to(self.out_pos + len)?;
        let src = self.input.get(self.in_pos..self.in_pos + len);
        let dst = output.bytes().get_mut(self.out_pos..self.out_pos + len);
        dst.ok_or(Error::BadData)?
            .copy_from_slice(src.ok_or(Error::BadData)?);
        self.in_pos += len;
        self.out_pos += len;
        Ok(())
    }

    /// Decodes one literal, match or end of block, whatever is left of the input. `None` is bad data.
    #[inline(always)]
    fn decode_item(&mut self, tables: &Tables) -> Option<Item> {
        self.refill_bits()?;
        let mut entry = *tables
            .litlen_decode_table
            .get(self.bits(tables.litlen_tablebits))?;
        let mut saved_bitbuf = self.bitbuf;
        self.consume(entry);
        if entry & HUFFDEC_SUBTABLE_POINTER != 0 {
            entry = *tables
                .litlen_decode_table
                .get(subtable_index(entry, self.bitbuf))?;
            saved_bitbuf = self.bitbuf;
            self.consume(entry);
        }
        if entry & HUFFDEC_LITERAL != 0 {
            return Some(Item::Literal((entry >> 16) as u8));
        }
        if entry & HUFFDEC_END_OF_BLOCK != 0 {
            return Some(Item::EndOfBlock);
        }
        let length = base_plus_extra_bits(entry, saved_bitbuf)?;

        entry = *tables
            .offset_decode_table
            .get(self.bits(OFFSET_TABLEBITS))?;
        if entry & HUFFDEC_EXCEPTIONAL != 0 {
            self.consume(OFFSET_TABLEBITS);
            entry = *tables
                .offset_decode_table
                .get(subtable_index(entry, self.bitbuf))?;
        }
        let offset = base_plus_extra_bits(entry, self.bitbuf)?;
        self.consume(entry);
        Some(Item::Match { length, offset })
    }

    fn decode_huffman_block(&mut self, tables: &Tables, output: &mut Output<'_>) -> Result<()> {
        loop {
            let end = if tables.litlen_tablebits == LITLEN_TABLEBITS {
                fastloop::<true>(tables, output.bytes(), self)
            } else {
                fastloop::<false>(tables, output.bytes(), self)
            };
            if let FastloopEnd::EndOfBlock = end.ok_or(Error::BadData)? {
                return Ok(());
            }

            // Where a longer output takes no reallocation, the fast loop gets the room it wants.
            let fastloop_len = self.out_pos + FASTLOOP_MAX_BYTES_WRITTEN + 1;
            let len_in_place = output.len_in_place();
            let mut out = output.bytes();
            if out.len() < fastloop_len.min(len_in_place) {
                output.grow_to(fastloop_len.min(len_in_place))?;
                continue;
            }

            // The same without the assumptions, for the ends of the input and the output, until the output is longer.
            let short_len = out.len();
            while out.len() == short_len {
                match self.decode_item(tables).ok_or(Error::BadData)? {
                    Item::EndOfBlock => return Ok(()),
                    Item::Literal(literal) => {
                        if self.out_pos == out.len() {
                            output.grow_to(self.out_pos + 1)?;
                            out = output.bytes();
                        }
                        *out.get_mut(self.out_pos).ok_or(Error::BadData)? = literal;
                        self.out_pos += 1;
                    }
                    Item::Match { length, offset } => {
                        if length > out.len() - self.out_pos {
                            output.grow_to(self.out_pos + length)?;
                            out = output.bytes();
                        }
                        copy_match(out, self.out_pos, length, offset).ok_or(Error::BadData)?;
                        self.out_pos += length;
                    }
                }
            }
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct ByteCounts {
    /// Where the stream ended in the input. Nothing after that had any effect.
    pub read: usize,
    pub written: usize,
}

/// Decompresses the stream at the start of `input` to the start of `output`.
pub(crate) fn decompress(
    tables: &mut Tables,
    input: &[u8],
    output: &mut Output<'_>,
) -> Result<ByteCounts> {
    let mut decoder = Decoder {
        input,
        in_pos: 0,
        bitbuf: 0,
        bitsleft: 0,
        overread_count: 0,
        out_pos: 0,
    };
    loop {
        let (block, is_final_block) = decoder.read_block_header(tables).ok_or(Error::BadData)?;
        match block {
            Block::Uncompressed(len) => decoder.copy_uncompressed_block(len, output)?,
            Block::Huffman => decoder.decode_huffman_block(tables, output)?,
        }
        if is_final_block {
            break;
        }
    }
    decoder.align_to_byte().ok_or(Error::BadData)?;
    Ok(ByteCounts {
        read: decoder.in_pos,
        written: decoder.out_pos,
    })
}
