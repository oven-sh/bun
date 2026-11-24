//! Tables that tell what the next bits of a block stand for.

use crate::bit_reader::{BITS_IN_REFILL, Bits, Input};
use crate::format::{
    Codeword, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MAX_CODEWORD_LEN, MAX_PRECODE_LEN,
    OFFSET_SYMBOLS, PRECODE_ORDER, PRECODE_SYMBOLS, RESERVED_SYMBOLS, Slot, length_slot,
    offset_slot, repeat_slot, static_litlen_codeword, static_offset_codeword,
};
use crate::{Error, Result, copy_prefix, wrapped, wrapped_mut};
use core::hint::select_unpredictable;

// An entry has the number of bits to consume in bits 0-7, how many of them are the codeword's in 8-11, and a value in 16-30.
pub(crate) const LITERAL: u32 = 1 << 31;
/// Set along with [`SUBTABLE`] or [`END`].
pub(crate) const EXCEPTIONAL: u32 = 1 << 15;
/// Bits 8-11 are how many bits index the subtable, and the value is where it starts.
pub(crate) const SUBTABLE: u32 = 1 << 14;
pub(crate) const END: u32 = 1 << 13;
const REPEAT_PREVIOUS: u32 = 1 << 31;
/// For bits that stand for nothing. See [`check_end`].
const NO_ENTRY: u32 = EXCEPTIONAL | END | (1 << 16);

pub(crate) const LITLEN_BITS: u32 = 11;
pub(crate) const OFFSET_BITS: u32 = 8;
/// zlib's examples/enough.c finds that subtables take at most 294 and 146 entries, after 11 and 8 bits.
const SUBTABLE_ENTRIES: usize = 512;

const fn slot_entry(slot: Slot) -> u32 {
    (slot.base << 16) | slot.extra_bits
}

const fn literal_entry(symbol: usize) -> u32 {
    LITERAL | ((symbol as u32) << 16)
}

const fn with_len(entry: u32, len: u32) -> u32 {
    entry + len * 0x101
}

/// From [`END_OF_BLOCK`] on, a multiple of 32, so that [`wrapped`] takes the symbol as it is.
const LENGTH_ENTRIES: [u32; 32] = table!(|index| match index {
    0 => EXCEPTIONAL | END,
    1..30 => slot_entry(length_slot(index - 1)),
    _ => NO_ENTRY,
});
const OFFSET_ENTRIES: [u32; OFFSET_SYMBOLS] = table!(|symbol| match symbol {
    ..30 => slot_entry(offset_slot(symbol)),
    _ => NO_ENTRY,
});
/// The length that is repeated is in the high byte.
const PRECODE_ENTRIES: [u32; 32] = table!(|symbol| {
    slot_entry(repeat_slot(symbol))
        | match symbol {
            ..16 => (symbol as u32) << 24,
            16 => REPEAT_PREVIOUS,
            _ => 0,
        }
});

#[expect(clippy::indexing_slicing, reason = "runs in the compiler")]
pub(crate) static STATIC_TABLES: Tables<{ 1 << 9 }> = {
    const fn fill(table: &mut [u32], Codeword { bits, len }: Codeword, entry: u32) {
        let mut at = bits as usize;
        while at < table.len() {
            table[at] = with_len(entry, len);
            at += 1 << len;
        }
    }
    let mut tables = Tables::new();
    let mut symbol = 0;
    while symbol < LITLEN_SYMBOLS {
        let entry = match symbol {
            ..END_OF_BLOCK => literal_entry(symbol),
            _ => LENGTH_ENTRIES[symbol - END_OF_BLOCK],
        };
        fill(&mut tables.litlens, static_litlen_codeword(symbol), entry);
        if symbol < OFFSET_SYMBOLS {
            let entry = OFFSET_ENTRIES[symbol];
            fill(&mut tables.offsets, static_offset_codeword(symbol), entry);
        }
        symbol += 1;
    }
    tables
};

/// Tells the end of a block from [`NO_ENTRY`].
#[inline(always)]
pub(crate) fn check_end(entry: u32) -> Result<()> {
    match entry >> 16 {
        0 => Ok(()),
        _ => Err(Error::BadData),
    }
}

/// The value of `entry` plus its extra bits, out of the `buffer` that it was looked up with.
#[inline(always)]
pub(crate) fn value(entry: u32, buffer: u64) -> usize {
    let consumed = buffer ^ buffer.wrapping_shr(entry).wrapping_shl(entry);
    ((entry >> 16) + consumed.wrapping_shr(entry >> 8) as u32) as usize
}

const LINKS: usize = 512;

/// For each length, a list of the symbols that have a codeword of it, linked through an array of [`LINKS`].
struct SymbolLists {
    counts: [u16; 32],
    tails: [u16; 32],
    /// The list for `len` starts at what `heads + len` links to.
    heads: usize,
}

impl SymbolLists {
    fn new(heads: usize) -> Self {
        Self {
            counts: [0; _],
            tails: core::array::from_fn(|len| (heads + len) as u16),
            heads,
        }
    }

    /// `links` starts with each symbol linking to the next, so a run takes one store.
    #[inline(always)]
    fn append(&mut self, links: &mut [u16; LINKS], len: usize, first: usize, count: usize) {
        let tail = wrapped_mut(&mut self.tails, len);
        *wrapped_mut(links, (*tail).into()) = first as u16;
        *tail = (first + count).wrapping_sub(1) as u16;
        *wrapped_mut(&mut self.counts, len) += count as u16;
    }

    /// Fills `table`, and subtables from `subtables_end` on, which it advances.
    #[inline(always)]
    fn fill<const N: usize>(
        &self,
        links: &[u16; LINKS],
        entry_of: impl Fn(usize) -> u32,
        may_be_incomplete: bool,
        table: &mut [u32; N],
        subtables: &mut [u32; SUBTABLE_ENTRIES],
        subtables_end: &mut usize,
    ) -> Result<()> {
        let count = |len: u32| u32::from(*wrapped(&self.counts, len as usize));
        let first = |len: u32| usize::from(*wrapped(links, self.heads + len as usize));
        let used = (1..=MAX_CODEWORD_LEN)
            .fold(0u32, |used, len| used | (u32::from(count(len) != 0) << len));
        let (bits, longest) = (N.ilog2(), (used | 1).ilog2());
        let space = (1..=MAX_CODEWORD_LEN).fold(0, |space, len| 2 * space + count(len));

        if space != 1 << MAX_CODEWORD_LEN {
            // One codeword of one bit, or none (RFC 1951 3.2.7).
            let only = match (used, count(1)) {
                (0, _) if may_be_incomplete => NO_ENTRY,
                (2, 1) if may_be_incomplete => entry_of(first(1)),
                _ => return Err(Error::BadData),
            };
            let pair = [only, NO_ENTRY].map(|entry| with_len(entry, 1));
            table.as_chunks_mut().0.fill(pair);
            return Ok(());
        }

        // With its first bit at the top of 16.
        let mut code = 0u16;
        let shortest = used.trailing_zeros();
        for len in shortest..=bits {
            // The table has `1 << len` entries so far, so a codeword of `len` bits has one of them.
            if len != shortest {
                let (filled, rest) = table.split_at_mut(N.min(1 << (len - 1)));
                copy_prefix(rest, filled);
            }
            let mut symbol = first(len);
            for _ in 0..count(len) {
                *wrapped_mut(table, code.reverse_bits().into()) = with_len(entry_of(symbol), len);
                code = code.wrapping_add(0x8000 >> (len - 1));
                symbol = usize::from(*wrapped(links, symbol));
            }
        }

        let (mut prefix, mut start) = (usize::MAX, 0);
        for len in bits + 1..=longest {
            let mut symbol = first(len);
            for left in (1..=count(len)).rev() {
                let reversed = usize::from(code.reverse_bits());
                if prefix != reversed % N {
                    prefix = reversed % N;
                    start = *subtables_end;
                    // The subtable has to hold the longest codeword with this prefix.
                    let (mut last_len, mut space) = (len, left);
                    while space < 1 << (last_len - bits) {
                        last_len += 1;
                        space = 2 * space + count(last_len);
                    }
                    *subtables_end += 1 << (last_len - bits);
                    *wrapped_mut(table, prefix) = ((start as u32) << 16)
                        | EXCEPTIONAL
                        | SUBTABLE
                        | ((last_len - bits) << 8)
                        | bits;
                }
                let entry = with_len(entry_of(symbol), len - bits);
                for at in (start + reversed / N..*subtables_end).step_by(1 << (len - bits)) {
                    *wrapped_mut(subtables, at) = entry;
                }
                code = code.wrapping_add(0x8000 >> (len - 1));
                symbol = usize::from(*wrapped(links, symbol));
            }
        }
        Ok(())
    }
}

pub(crate) struct Tables<const LITLENS: usize> {
    offsets: [u32; 1 << OFFSET_BITS],
    litlens: [u32; LITLENS],
    subtables: [u32; SUBTABLE_ENTRIES],
}

pub(crate) type DynamicTables = Tables<{ 1 << LITLEN_BITS }>;

impl<const LITLENS: usize> Tables<LITLENS> {
    pub(crate) const fn new() -> Self {
        Self {
            offsets: [0; _],
            litlens: [0; _],
            subtables: [0; _],
        }
    }

    #[inline(always)]
    pub(crate) fn litlen_entry(&self, buffer: u64) -> u32 {
        *wrapped(&self.litlens, buffer as usize)
    }

    #[inline(always)]
    pub(crate) fn offset_entry(&self, buffer: u64) -> u32 {
        *wrapped(&self.offsets, buffer as usize)
    }

    /// `buffer` starts after the bits that `pointer` was looked up with.
    #[inline(always)]
    pub(crate) fn subtable_entry(&self, pointer: u32, buffer: u64) -> u32 {
        let index = buffer & (1u64.wrapping_shl(pointer >> 8) - 1);
        *wrapped(&self.subtables, (pointer >> 16) as usize + index as usize)
    }
}

impl DynamicTables {
    /// Reads a block's header. `bits` is at its start, and refilled.
    #[inline(never)]
    pub(crate) fn read_header(&mut self, mut bits: Bits, input: &Input<'_>) -> Result<Bits> {
        const PRECODE_HEADS: usize = 32;
        /// Past where a run can reach. The lists for 0 and [`NO_LEN`] are not followed, so their heads may be overwritten.
        const LITLEN_HEADS: usize = LINKS - 32;
        const OFFSET_HEADS: usize = LINKS - 16;
        /// The previous length of the first symbol, which has none to repeat.
        const NO_LEN: u32 = 16;

        let Self {
            offsets: offset_table,
            litlens: litlen_table,
            subtables,
        } = self;

        // All 19 lengths are one bit more than a refill promises, so the first comes with the counts.
        let header = bits.consume(3 + 5 + 5 + 4 + 3);
        let litlen_symbols = FIRST_LENGTH_SYMBOL + (header as usize >> 3) % 32;
        let offset_symbols = 1 + (header as usize >> 8) % 32;
        if litlen_symbols > LITLEN_SYMBOLS - RESERVED_SYMBOLS
            || offset_symbols > OFFSET_SYMBOLS - RESERVED_SYMBOLS
        {
            return Err(Error::BadData);
        }
        let symbols = litlen_symbols + offset_symbols;
        let precode_bits = 3 * (4 + (header as u32 >> 13) % 16);
        bits.refill(input)?;
        let precode_lens = (bits.consume(precode_bits - 3) << 3) | ((header >> 17) % 8);
        let precode_lens = precode_lens & ((1 << precode_bits) - 1);

        let mut links: [u16; LINKS] = core::array::from_fn(|symbol| symbol as u16 + 1);
        let mut lens = [0u8; 32];
        for (at, &symbol) in PRECODE_ORDER.iter().enumerate() {
            *wrapped_mut(&mut lens, symbol.into()) = (precode_lens >> (3 * at)) as u8 % 8;
        }
        let mut precode = SymbolLists::new(PRECODE_HEADS);
        let mut precode_links = [0u16; LINKS];
        for (symbol, &len) in lens.iter().enumerate().take(PRECODE_SYMBOLS) {
            precode.append(&mut precode_links, len.into(), symbol, 1);
        }
        // The precode is done with when the offset table is filled.
        let precode_table = &mut *offset_table;
        precode.fill(
            &precode_links,
            |symbol| *wrapped(&PRECODE_ENTRIES, symbol),
            false,
            precode_table,
            subtables,
            &mut 0,
        )?;

        let (mut symbol, mut len) = (0, NO_LEN);
        let mut read_lens = |lists: &mut SymbolLists,
                             links: &mut [u16; LINKS],
                             symbol: &mut usize,
                             len: &mut u32,
                             end: usize|
         -> Result<()> {
            while *symbol < end {
                bits.refill(input)?;
                for _ in 0..BITS_IN_REFILL / (MAX_PRECODE_LEN + 7) {
                    let entry = *wrapped(precode_table, bits.buffer as usize);
                    let count = value(entry, bits.consume(entry)) as u8;
                    *len = select_unpredictable(entry & REPEAT_PREVIOUS != 0, *len, entry >> 24);
                    lists.append(links, *len as usize, *symbol, count.into());
                    *symbol += usize::from(count);
                    if *symbol >= end {
                        break;
                    }
                }
            }
            Ok(())
        };
        let mut litlens = SymbolLists::new(LITLEN_HEADS);
        read_lens(
            &mut litlens,
            &mut links,
            &mut symbol,
            &mut len,
            litlen_symbols,
        )?;
        let mut offsets = SymbolLists::new(OFFSET_HEADS);
        // The last run may reach into the offsets.
        if symbol > litlen_symbols {
            let excess = symbol - litlen_symbols;
            *wrapped_mut(&mut litlens.counts, len as usize) -= excess as u16;
            offsets.append(&mut links, len as usize, litlen_symbols, excess);
        }
        read_lens(&mut offsets, &mut links, &mut symbol, &mut len, symbols)?;
        if symbol != symbols || *wrapped(&litlens.counts, NO_LEN as usize) != 0 {
            return Err(Error::BadData);
        }

        let mut subtables_end = 0;
        offsets.fill(
            &links,
            |symbol| *wrapped(&OFFSET_ENTRIES, symbol.saturating_sub(litlen_symbols)),
            true,
            offset_table,
            subtables,
            &mut subtables_end,
        )?;
        litlens.fill(
            &links,
            |symbol| {
                let other = *wrapped(&LENGTH_ENTRIES, symbol);
                select_unpredictable(symbol < END_OF_BLOCK, literal_entry(symbol), other)
            },
            true,
            litlen_table,
            subtables,
            &mut subtables_end,
        )?;
        Ok(bits)
    }
}
