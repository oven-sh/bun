//! DEFLATE compression (RFC 1951) of a whole buffer: choosing blocks, writing them, and the faster parsers.

use crate::constants::*;
use crate::hc_matchfinder::HcMatchfinder;
use crate::ht_matchfinder::{self, HtMatchfinder};
use crate::huffman::{MAX_TOTAL_FREQ, make_huffman_code};
use crate::near_optimal::{NearOptimal, OPTIMUM_LEN_MASK, OPTIMUM_OFFSET_SHIFT, OptimumNode};

/// No block but the last is shorter than this. [`compress_bound`] depends on it.
pub(crate) const MIN_BLOCK_LENGTH: usize = 5000;

/// Blocks end at about this length at the latest.
pub(crate) const SOFT_MAX_BLOCK_LENGTH: usize = 300_000;

/// The most matches in a block of the greedy and lazy parsers.
const SEQ_STORE_LENGTH: usize = 50_000;

const FAST_SOFT_MAX_BLOCK_LENGTH: usize = 65535;
const FAST_SEQ_STORE_LENGTH: usize = 8192;

/// One bit under the format's limit, so that four literals fit the bit buffer at once.
const MAX_LITLEN_CODEWORD_LEN_USED: u32 = 14;

/// Reached by a last block, or by two literals and the longest match from just under the soft maximum.
pub(crate) const MAX_BLOCK_LENGTH: usize = {
    let last_block = SOFT_MAX_BLOCK_LENGTH + MIN_BLOCK_LENGTH - 1;
    let lazy2_block = SOFT_MAX_BLOCK_LENGTH + 1 + MAX_MATCH_LEN as usize;
    if last_block > lazy2_block {
        last_block
    } else {
        lazy2_block
    }
};

const _: () = {
    assert!(SOFT_MAX_BLOCK_LENGTH >= MIN_BLOCK_LENGTH);
    assert!(FAST_SOFT_MAX_BLOCK_LENGTH >= MIN_BLOCK_LENGTH);
    assert!(SEQ_STORE_LENGTH * MIN_MATCH_LEN as usize >= MIN_BLOCK_LENGTH);
    assert!(FAST_SEQ_STORE_LENGTH * ht_matchfinder::MIN_MATCH_LEN as usize >= MIN_BLOCK_LENGTH);
    assert!(FAST_SOFT_MAX_BLOCK_LENGTH <= SOFT_MAX_BLOCK_LENGTH);
    assert!(MAX_LITLEN_CODEWORD_LEN_USED <= MAX_LITLEN_CODEWORD_LEN);
    assert!(MAX_BLOCK_LENGTH <= MAX_TOTAL_FREQ);
    assert!(MAX_BLOCK_LENGTH <= SEQ_LITRUNLEN_MASK as usize);
    assert!(2 * MIN_BLOCK_LENGTH <= u16::MAX as usize);
};

/// Length to length slot.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
pub(crate) static LENGTH_SLOT: [u8; MAX_MATCH_LEN as usize + 1] = {
    let mut slots = [0; _];
    let mut slot = 0;
    let mut len = MIN_MATCH_LEN as usize;
    while len < slots.len() {
        if slot + 1 < LENGTH_SLOT_BASE.len() && len >= LENGTH_SLOT_BASE[slot + 1] as usize {
            slot += 1;
        }
        slots[len] = slot as u8;
        len += 1;
    }
    slots
};

/// `offset - 1` to offset slot, for offsets up to 256.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static OFFSET_SLOT: [u8; 256] = {
    let mut slots = [0; _];
    let mut slot = 0;
    let mut offset = 1;
    while offset <= slots.len() {
        if offset >= OFFSET_SLOT_BASE[slot + 1] as usize {
            slot += 1;
        }
        slots[offset - 1] = slot as u8;
        offset += 1;
    }
    slots
};

const EXTRA_PRECODE_BITS: [u8; NUM_PRECODE_SYMS] =
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7];

/// An empty `Vec` with room for `capacity` elements, or `None` if there is no memory for them.
pub(crate) fn new_vec<T>(capacity: usize) -> Option<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity).ok()?;
    Some(vec)
}

#[inline(always)]
pub(crate) fn at<T: Copy>(slice: &[T], index: usize) -> Option<T> {
    slice.get(index).copied()
}

pub(crate) struct Freqs {
    pub(crate) litlen: [u32; NUM_LITLEN_SYMS],
    pub(crate) offset: [u32; NUM_OFFSET_SYMS],
}

impl Freqs {
    pub(crate) fn reset(&mut self) {
        *self = Self {
            litlen: [0; _],
            offset: [0; _],
        };
    }
}

/// The codeword lengths of the litlen code, then those of the offset code.
pub(crate) struct Lens([u8; NUM_LITLEN_SYMS + NUM_OFFSET_SYMS]);

impl Lens {
    #[inline(always)]
    pub(crate) fn litlen(&self, sym: usize) -> Option<u32> {
        Some(u32::from(
            *self.0.first_chunk::<NUM_LITLEN_SYMS>()?.get(sym)?,
        ))
    }
    #[inline(always)]
    pub(crate) fn offset(&self, sym: usize) -> Option<u32> {
        Some(u32::from(
            *self.0.last_chunk::<NUM_OFFSET_SYMS>()?.get(sym)?,
        ))
    }
}

pub(crate) struct Codes {
    litlen_codewords: [u32; NUM_LITLEN_SYMS],
    offset_codewords: [u32; NUM_OFFSET_SYMS],
    pub(crate) lens: Lens,
}

impl Codes {
    fn new() -> Self {
        Self {
            litlen_codewords: [0; _],
            offset_codewords: [0; _],
            lens: Lens([0; _]),
        }
    }

    pub(crate) fn make(&mut self, freqs: &Freqs) -> Option<()> {
        let (litlen_lens, offset_lens) = self.lens.0.split_at_mut_checked(NUM_LITLEN_SYMS)?;
        make_huffman_code(
            MAX_LITLEN_CODEWORD_LEN_USED as usize,
            &freqs.litlen,
            litlen_lens,
            &mut self.litlen_codewords,
        )?;
        make_huffman_code(
            MAX_OFFSET_CODEWORD_LEN as usize,
            &freqs.offset,
            offset_lens,
            &mut self.offset_codewords,
        )
    }
}

/// A run of literals, which are read from the input, then a match or the end of the block.
#[derive(Clone, Copy, Default)]
pub(crate) struct Sequence {
    /// The number of literals in the low 23 bits. Above them the length of the match, 0 at the end of the block.
    litrunlen_and_length: u32,
    offset: u16,
    offset_slot: u16,
}

const SEQ_LENGTH_SHIFT: u32 = 23;
const SEQ_LITRUNLEN_MASK: u32 = (1 << SEQ_LENGTH_SHIFT) - 1;

impl Sequence {
    pub(crate) fn literals_only(count: u32) -> Self {
        Self {
            litrunlen_and_length: count,
            offset: 0,
            offset_slot: 0,
        }
    }
}

const NUM_LITERAL_OBSERVATION_TYPES: usize = 8;
const NUM_MATCH_OBSERVATION_TYPES: usize = 2;
pub(crate) const NUM_OBSERVATION_TYPES: usize =
    NUM_LITERAL_OBSERVATION_TYPES + NUM_MATCH_OBSERVATION_TYPES;
const NUM_OBSERVATIONS_PER_BLOCK_CHECK: u32 = 512;

/// Rough statistics of a block so far and of its latest part. A block ends where the two differ enough.
#[derive(Default)]
pub(crate) struct BlockSplitStats {
    new_observations: [u32; NUM_OBSERVATION_TYPES],
    pub(crate) observations: [u32; NUM_OBSERVATION_TYPES],
    num_new_observations: u32,
    pub(crate) num_observations: u32,
}

impl BlockSplitStats {
    #[inline(always)]
    pub(crate) fn observe_literal(&mut self, literal: u8) {
        let kind = usize::from(((literal >> 5) & 0x6) | (literal & 1));
        if let Some(count) = self.new_observations.get_mut(kind) {
            *count += 1;
        }
        self.num_new_observations += 1;
    }

    #[inline(always)]
    pub(crate) fn observe_match(&mut self, length: u32) {
        let kind = NUM_LITERAL_OBSERVATION_TYPES + usize::from(length >= 9);
        if let Some(count) = self.new_observations.get_mut(kind) {
            *count += 1;
        }
        self.num_new_observations += 1;
    }

    pub(crate) fn merge_new_observations(&mut self) {
        for (total, new) in self.observations.iter_mut().zip(&mut self.new_observations) {
            *total += core::mem::take(new);
        }
        self.num_observations += core::mem::take(&mut self.num_new_observations);
    }

    pub(crate) fn do_end_block_check(&mut self, block_length: u32) -> bool {
        if self.num_observations > 0 {
            // Sum of the differences in probability, all scaled by both observation counts to stay in integers.
            let mut total_delta = 0u32;
            for (&old, &new) in self.observations.iter().zip(&self.new_observations) {
                let expected = old.wrapping_mul(self.num_new_observations);
                let actual = new.wrapping_mul(self.num_observations);
                total_delta = total_delta.wrapping_add(actual.abs_diff(expected));
            }

            let num_items = self.num_observations + self.num_new_observations;
            let mut cutoff = (self.num_new_observations.wrapping_mul(200) / 512)
                .wrapping_mul(self.num_observations);
            // The codes of a very short block cost a lot for what they save.
            if block_length < 10000 && num_items < 8192 {
                cutoff = cutoff
                    .wrapping_add((u64::from(cutoff) * u64::from(8192 - num_items) / 8192) as u32);
            }

            let length_bias = (block_length / 4096).wrapping_mul(self.num_observations);
            if total_delta.wrapping_add(length_bias) >= cutoff {
                return true;
            }
        }
        self.merge_new_observations();
        false
    }

    #[inline(always)]
    pub(crate) fn ready_to_check_block(
        &self,
        in_block_begin: usize,
        in_next: usize,
        in_end: usize,
    ) -> bool {
        self.num_new_observations >= NUM_OBSERVATIONS_PER_BLOCK_CHECK
            && in_next - in_block_begin >= MIN_BLOCK_LENGTH
            && in_end - in_next >= MIN_BLOCK_LENGTH
    }

    #[inline(always)]
    fn should_end_block(&mut self, in_block_begin: usize, in_next: usize, in_end: usize) -> bool {
        self.ready_to_check_block(in_block_begin, in_next, in_end)
            && self.do_end_block_check((in_next - in_block_begin) as u32)
    }
}

type BitBuf = u64;

/// One less than the bit buffer holds, so that shifting out all whole bytes is never a shift by its full width.
const BITBUF_NBITS: u32 = BitBuf::BITS - 1;

/// Whether this many bits can be added after a flush, which leaves up to seven.
const fn can_buffer(nbits: u32) -> bool {
    7 + nbits <= BITBUF_NBITS
}

const _: () = {
    assert!(can_buffer(1 + 2 + 5 + 5 + 4 + 3));
    assert!(can_buffer(3 * (NUM_PRECODE_SYMS as u32 - 1)));
    assert!(can_buffer(MAX_PRE_CODEWORD_LEN + 7));
    assert!(can_buffer(4 * MAX_LITLEN_CODEWORD_LEN_USED));
    assert!(can_buffer(
        MAX_LITLEN_CODEWORD_LEN_USED
            + MAX_EXTRA_LENGTH_BITS
            + MAX_OFFSET_CODEWORD_LEN
            + MAX_EXTRA_OFFSET_BITS
    ));
};

/// Where the stream goes.
pub(crate) enum Sink<'a> {
    Fixed(&'a mut [u8]),
    /// Up to `limit` bytes of a `Vec`'s capacity from `start` on. It is lengthened block by block, so that reserved memory the stream does not reach stays untouched.
    Spare {
        vec: &'a mut Vec<u8>,
        start: usize,
        limit: usize,
    },
}

impl Sink<'_> {
    /// The stream so far and room for it to reach `len` bytes, or `None` if there is no such room.
    fn bytes_with_room(&mut self, len: usize) -> Option<&mut [u8]> {
        match self {
            Sink::Fixed(bytes) => (len <= bytes.len()).then_some(&mut **bytes),
            Sink::Spare { vec, start, limit } => {
                let limit = (*limit).min(vec.capacity() - *start);
                if len > limit {
                    return None;
                }
                // A few bytes more let the last bits of a block be written a word at a time.
                let wanted = *start + (len + size_of::<BitBuf>()).min(limit);
                if wanted > vec.len() {
                    vec.resize(wanted, 0);
                }
                vec.get_mut(*start..)
            }
        }
    }
}

/// The state of the stream between blocks.
pub(crate) struct OutputBitstream<'a> {
    sink: Sink<'a>,
    pos: usize,
    bitbuf: BitBuf,
    bitcount: u32,
    /// The output did not fit.
    pub(crate) overflow: bool,
}

impl<'a> OutputBitstream<'a> {
    fn new(sink: Sink<'a>) -> Self {
        Self {
            sink,
            pos: 0,
            bitbuf: 0,
            bitcount: 0,
            overflow: false,
        }
    }

    /// A writer for `nbytes` more bytes. Without room for them, sets `overflow` and returns `None`.
    fn writer(&mut self, nbytes: usize) -> Option<BitWriter<'_>> {
        let Some(out) = self.sink.bytes_with_room(self.pos + nbytes) else {
            self.overflow = true;
            return None;
        };
        Some(BitWriter {
            out,
            pos: self.pos,
            bitbuf: self.bitbuf,
            bitcount: self.bitcount,
            overflow: false,
        })
    }
}

/// What a [`BitWriter`] hands back to its [`OutputBitstream`].
#[derive(Clone, Copy)]
struct Written {
    pos: usize,
    bitbuf: BitBuf,
    bitcount: u32,
    overflow: bool,
}

impl OutputBitstream<'_> {
    fn commit(&mut self, written: Written) {
        let Written {
            pos,
            bitbuf,
            bitcount,
            overflow,
        } = written;
        (self.pos, self.bitbuf, self.bitcount, self.overflow) = (pos, bitbuf, bitcount, overflow);
    }
}

struct BitWriter<'a> {
    out: &'a mut [u8],
    pos: usize,
    bitbuf: BitBuf,
    bitcount: u32,
    overflow: bool,
}

impl BitWriter<'_> {
    fn finish(self) -> Written {
        let Self {
            pos,
            bitbuf,
            bitcount,
            overflow,
            ..
        } = self;
        Written {
            pos,
            bitbuf,
            bitcount,
            overflow,
        }
    }

    /// The caller flushes often enough for the bits to fit.
    #[inline(always)]
    fn add_bits(&mut self, bits: u32, nbits: u32) {
        self.bitbuf |= BitBuf::from(bits) << self.bitcount;
        self.bitcount += nbits;
        debug_assert!(self.bitcount <= BITBUF_NBITS);
    }

    /// Writes out the whole bytes in the bit buffer.
    #[inline(always)]
    fn flush_bits(&mut self) {
        if let Some(word) = self
            .out
            .get_mut(self.pos..)
            .and_then(|rest| rest.first_chunk_mut())
        {
            *word = self.bitbuf.to_le_bytes();
            self.bitbuf >>= self.bitcount & !7;
            self.pos += (self.bitcount >> 3) as usize;
            self.bitcount &= 7;
        } else {
            while self.bitcount >= 8 {
                self.put_byte(self.bitbuf as u8);
                self.bitcount -= 8;
                self.bitbuf >>= 8;
            }
        }
    }

    #[inline(always)]
    fn put_byte(&mut self, byte: u8) {
        match self.out.get_mut(self.pos) {
            Some(slot) => {
                *slot = byte;
                self.pos += 1;
            }
            None => self.overflow = true,
        }
    }

    fn put_bytes(&mut self, bytes: &[u8]) {
        match self
            .out
            .get_mut(self.pos..)
            .and_then(|rest| rest.get_mut(..bytes.len()))
        {
            Some(slot) => {
                slot.copy_from_slice(bytes);
                self.pos += bytes.len();
            }
            None => self.overflow = true,
        }
    }

    /// An uncompressed block of at most 65535 bytes, after the bits of the previous block.
    fn put_uncompressed_block(&mut self, bytes: &[u8], is_final_block: bool) {
        self.put_byte((u8::from(is_final_block) << self.bitcount) | self.bitbuf as u8);
        if self.bitcount > 5 {
            self.put_byte(0);
        }
        self.bitbuf = 0;
        self.bitcount = 0;
        let len = bytes.len() as u16;
        self.put_bytes(&len.to_le_bytes());
        self.put_bytes(&(!len).to_le_bytes());
        self.put_bytes(bytes);
    }
}

/// What it takes to write the two codes of a dynamic block, themselves coded with the precode.
struct Precode {
    freqs: [u32; NUM_PRECODE_SYMS],
    codewords: [u32; NUM_PRECODE_SYMS],
    lens: [u8; NUM_PRECODE_SYMS],
    /// A precode symbol in the low five bits, its extra bits above them.
    items: [u32; NUM_LITLEN_SYMS + NUM_OFFSET_SYMS],
    num_litlen_syms: usize,
    num_offset_syms: usize,
    num_explicit_lens: usize,
    num_items: usize,
}

/// For each match length, its litlen codeword joined with its extra bits.
struct LengthCodewords {
    codewords: [u32; MAX_MATCH_LEN as usize + 1],
    lens: [u8; MAX_MATCH_LEN as usize + 1],
}

/// The literals and matches of a block.
#[derive(Clone, Copy)]
pub(crate) enum Items<'a> {
    Sequences(&'a [Sequence]),
    /// The minimum-cost path, and the map from offset to offset slot.
    Path(&'a [OptimumNode], &'a [u8; MAX_MATCH_OFFSET + 1]),
}

/// The part of a compressor that does not depend on the parser.
pub(crate) struct Common {
    pub(crate) max_search_depth: u32,
    pub(crate) nice_match_length: u32,
    pub(crate) freqs: Freqs,
    pub(crate) split_stats: BlockSplitStats,
    pub(crate) codes: Codes,
    pub(crate) static_codes: Codes,
    precode: Precode,
    length: LengthCodewords,
}

#[inline(always)]
fn get_offset_slot(offset: u32) -> Option<u32> {
    // Each slot from 16 on is 128 times as wide as the slot 14 below it.
    let shift = 256u32.wrapping_sub(offset) >> 29;
    Some(
        u32::from(at(
            &OFFSET_SLOT,
            (offset.wrapping_sub(1) >> shift) as usize,
        )?) + (shift << 1),
    )
}

fn compute_precode_items(
    lens: &[u8],
    precode_freqs: &mut [u32; NUM_PRECODE_SYMS],
    precode_items: &mut [u32; NUM_LITLEN_SYMS + NUM_OFFSET_SYMS],
) -> Option<usize> {
    *precode_freqs = [0; _];
    let mut num_items = 0;
    let mut emit = |sym: usize, extra_bits: usize| {
        *precode_freqs.get_mut(sym)? += 1;
        *precode_items.get_mut(num_items)? = sym as u32 | ((extra_bits as u32) << 5);
        num_items += 1;
        Some(())
    };

    let mut run_start = 0;
    while run_start != lens.len() {
        let len = at(lens, run_start)?;
        let mut run_end = run_start + 1;
        while run_end != lens.len() && len == at(lens, run_end)? {
            run_end += 1;
        }

        if len == 0 {
            // Symbol 18: 11 to 138 zeroes.
            while run_end - run_start >= 11 {
                let extra_bits = (run_end - run_start - 11).min(0x7F);
                emit(18, extra_bits)?;
                run_start += 11 + extra_bits;
            }
            // Symbol 17: 3 to 10 zeroes.
            if run_end - run_start >= 3 {
                let extra_bits = (run_end - run_start - 3).min(0x7);
                emit(17, extra_bits)?;
                run_start += 3 + extra_bits;
            }
        } else if run_end - run_start >= 4 {
            // Symbol 16: the previous length 3 to 6 times more.
            emit(usize::from(len), 0)?;
            run_start += 1;
            loop {
                let extra_bits = (run_end - run_start - 3).min(0x3);
                emit(16, extra_bits)?;
                run_start += 3 + extra_bits;
                if run_end - run_start < 3 {
                    break;
                }
            }
        }

        while run_start != run_end {
            emit(usize::from(len), 0)?;
            run_start += 1;
        }
    }
    Some(num_items)
}

impl Common {
    fn new(max_search_depth: u32, nice_match_length: u32) -> Option<Self> {
        let mut common = Self {
            max_search_depth,
            nice_match_length,
            freqs: Freqs {
                litlen: [0; _],
                offset: [0; _],
            },
            split_stats: BlockSplitStats::default(),
            codes: Codes::new(),
            static_codes: Codes::new(),
            precode: Precode {
                freqs: [0; _],
                codewords: [0; _],
                lens: [0; _],
                items: [0; _],
                num_litlen_syms: 0,
                num_offset_syms: 0,
                num_explicit_lens: 0,
                num_items: 0,
            },
            length: LengthCodewords {
                codewords: [0; _],
                lens: [0; _],
            },
        };

        // The code builder arrives at the static codes' lengths of 8, 9, 7, 8 and 5 bits from these frequencies.
        let litlen = &mut common.freqs.litlen;
        litlen.get_mut(..144)?.fill(2);
        litlen.get_mut(144..256)?.fill(1);
        litlen.get_mut(256..280)?.fill(4);
        litlen.get_mut(280..288)?.fill(2);
        common.freqs.offset.fill(1);
        common.static_codes.make(&common.freqs)?;
        Some(common)
    }

    /// Works out how `self.codes` will be written in the header of a dynamic block.
    fn precompute_huffman_header(&mut self) -> Option<()> {
        let precode = &mut self.precode;
        let lens = &mut self.codes.lens;

        precode.num_litlen_syms = NUM_LITLEN_SYMS;
        while precode.num_litlen_syms > 257 && lens.litlen(precode.num_litlen_syms - 1)? == 0 {
            precode.num_litlen_syms -= 1;
        }
        precode.num_offset_syms = NUM_OFFSET_SYMS;
        while precode.num_offset_syms > 1 && lens.offset(precode.num_offset_syms - 1)? == 0 {
            precode.num_offset_syms -= 1;
        }

        // The lengths in use are written as one list, so for a while the offset lengths move down next to the others.
        let moved = precode.num_litlen_syms != NUM_LITLEN_SYMS;
        if moved {
            let offset_lens = NUM_LITLEN_SYMS..NUM_LITLEN_SYMS + precode.num_offset_syms;
            lens.0.copy_within(offset_lens, precode.num_litlen_syms);
        }

        precode.num_items = compute_precode_items(
            lens.0
                .get(..precode.num_litlen_syms + precode.num_offset_syms)?,
            &mut precode.freqs,
            &mut precode.items,
        )?;

        make_huffman_code(
            MAX_PRE_CODEWORD_LEN as usize,
            &precode.freqs,
            &mut precode.lens,
            &mut precode.codewords,
        )?;

        precode.num_explicit_lens = NUM_PRECODE_SYMS;
        while precode.num_explicit_lens > 4 {
            let sym = at(&PRECODE_LENS_PERMUTATION, precode.num_explicit_lens - 1)?;
            if at(&precode.lens, usize::from(sym))? != 0 {
                break;
            }
            precode.num_explicit_lens -= 1;
        }

        if moved {
            let offset_lens =
                precode.num_litlen_syms..precode.num_litlen_syms + precode.num_offset_syms;
            lens.0.copy_within(offset_lens, NUM_LITLEN_SYMS);
        }
        Some(())
    }

    /// The bits that the header computed by [`Self::precompute_huffman_header`] takes, after the block type.
    fn huffman_header_cost(&self) -> u32 {
        let precode = &self.precode;
        let mut cost = 5 + 5 + 4 + 3 * precode.num_explicit_lens as u32;
        for ((&freq, &len), &extra) in precode
            .freqs
            .iter()
            .zip(&precode.lens)
            .zip(&EXTRA_PRECODE_BITS)
        {
            cost += freq * (u32::from(extra) + u32::from(len));
        }
        cost
    }

    /// The exact bits a dynamic block takes for `self.freqs` coded with `self.codes`, without the three of its type.
    pub(crate) fn compute_true_cost(&mut self) -> Option<u32> {
        self.precompute_huffman_header()?;
        self.codes
            .lens
            .0
            .get_mut(self.precode.num_litlen_syms..NUM_LITLEN_SYMS)?
            .fill(0);

        let lens = &self.codes.lens;
        let mut cost = self.huffman_header_cost();
        for (sym, &freq) in self.freqs.litlen.iter().enumerate().take(FIRST_LEN_SYM) {
            cost += freq * lens.litlen(sym)?;
        }
        for (slot, &extra) in EXTRA_LENGTH_BITS.iter().enumerate() {
            let sym = FIRST_LEN_SYM + slot;
            cost += at(&self.freqs.litlen, sym)? * (lens.litlen(sym)? + u32::from(extra));
        }
        for (sym, &extra) in EXTRA_OFFSET_BITS.iter().enumerate() {
            cost += at(&self.freqs.offset, sym)? * (lens.offset(sym)? + u32::from(extra));
        }
        Some(cost)
    }

    /// Writes a block as the cheapest of the three types. `self.freqs` and `self.codes` describe `items` and the end-of-block symbol.
    pub(crate) fn flush_block(
        &mut self,
        os: &mut OutputBitstream<'_>,
        block: &[u8],
        items: Items<'_>,
        is_final_block: bool,
    ) -> Option<()> {
        self.precompute_huffman_header()?;

        let mut dynamic_cost = 3 + self.huffman_header_cost();
        let mut static_cost = 3u32;
        let mut uncompressed_cost = 3u32;

        let freqs = &self.freqs;
        let lens = &self.codes.lens;
        for (sym, &freq) in freqs.litlen.iter().enumerate().take(NUM_LITERALS) {
            dynamic_cost += freq * lens.litlen(sym)?;
            static_cost += freq * if sym < 144 { 8 } else { 9 };
        }
        dynamic_cost += lens.litlen(END_OF_BLOCK)?;
        static_cost += 7;
        for (slot, &extra) in EXTRA_LENGTH_BITS.iter().enumerate() {
            let sym = FIRST_LEN_SYM + slot;
            let (freq, extra) = (at(&freqs.litlen, sym)?, u32::from(extra));
            dynamic_cost += freq * (extra + lens.litlen(sym)?);
            static_cost += freq * (extra + self.static_codes.lens.litlen(sym)?);
        }
        for (sym, &extra) in EXTRA_OFFSET_BITS.iter().enumerate() {
            let (freq, extra) = (at(&freqs.offset, sym)?, u32::from(extra));
            dynamic_cost += freq * (extra + lens.offset(sym)?);
            static_cost += freq * (extra + 5);
        }

        let block_length = block.len() as u32;
        uncompressed_cost += (0u32.wrapping_sub(os.bitcount + 3) & 7)
            + 32
            + 40 * (block_length.div_ceil(u32::from(u16::MAX)) - 1)
            + 8 * block_length;

        // In a tie, uncompressed comes before static, and static before dynamic.
        let best_cost = dynamic_cost.min(static_cost).min(uncompressed_cost);

        let stream = os;
        let Some(mut writer) = stream.writer((stream.bitcount + best_cost).div_ceil(8) as usize)
        else {
            return Some(());
        };
        let os = &mut writer;

        if best_cost == uncompressed_cost {
            // An uncompressed block holds 65535 bytes at most, so there may be several.
            let mut chunks = block.chunks(usize::from(u16::MAX)).peekable();
            while let Some(chunk) = chunks.next() {
                os.put_uncompressed_block(chunk, is_final_block && chunks.peek().is_none());
            }
            let written = writer.finish();
            stream.commit(written);
            return Some(());
        }

        let codes = if best_cost == static_cost {
            os.add_bits(u32::from(is_final_block), 1);
            os.add_bits(BLOCKTYPE_STATIC_HUFFMAN, 2);
            os.flush_bits();
            &self.static_codes
        } else {
            let precode = &self.precode;
            os.add_bits(u32::from(is_final_block), 1);
            os.add_bits(BLOCKTYPE_DYNAMIC_HUFFMAN, 2);
            os.add_bits(precode.num_litlen_syms as u32 - 257, 5);
            os.add_bits(precode.num_offset_syms as u32 - 1, 5);
            os.add_bits(precode.num_explicit_lens as u32 - 4, 4);

            // All the precode lengths but one fit the bit buffer at once, so the first goes with the counts.
            let mut explicit_syms = PRECODE_LENS_PERMUTATION
                .iter()
                .take(precode.num_explicit_lens);
            os.add_bits(
                u32::from(at(&precode.lens, usize::from(*explicit_syms.next()?))?),
                3,
            );
            os.flush_bits();
            for &sym in explicit_syms {
                os.add_bits(u32::from(at(&precode.lens, usize::from(sym))?), 3);
            }
            os.flush_bits();

            for &item in precode.items.get(..precode.num_items)? {
                let sym = (item & 0x1F) as usize;
                os.add_bits(
                    at(&precode.codewords, sym)?,
                    u32::from(at(&precode.lens, sym)?),
                );
                os.add_bits(item >> 5, u32::from(at(&EXTRA_PRECODE_BITS, sym)?));
                os.flush_bits();
            }
            &self.codes
        };

        let length = &mut self.length;
        for len in MIN_MATCH_LEN as usize..=MAX_MATCH_LEN as usize {
            let slot = usize::from(at(&LENGTH_SLOT, len)?);
            let sym = FIRST_LEN_SYM + slot;
            let extra_bits = len as u32 - u32::from(at(&LENGTH_SLOT_BASE, slot)?);
            let sym_len = codes.lens.litlen(sym)?;
            *length.codewords.get_mut(len)? =
                at(&codes.litlen_codewords, sym)? | (extra_bits << sym_len);
            *length.lens.get_mut(len)? = sym_len as u8 + at(&EXTRA_LENGTH_BITS, slot)?;
        }
        let length = &self.length;

        let add_literal = |os: &mut BitWriter<'_>, literal: usize| {
            os.add_bits(
                at(&codes.litlen_codewords, literal)?,
                codes.lens.litlen(literal)?,
            );
            Some(())
        };
        let write_match = |os: &mut BitWriter<'_>, len: usize, offset: u32, slot: usize| {
            os.add_bits(
                at(&length.codewords, len)?,
                u32::from(at(&length.lens, len)?),
            );
            os.add_bits(at(&codes.offset_codewords, slot)?, codes.lens.offset(slot)?);
            os.add_bits(
                offset.wrapping_sub(u32::from(at(&OFFSET_SLOT_BASE, slot)?)),
                u32::from(at(&EXTRA_OFFSET_BITS, slot)?),
            );
            os.flush_bits();
            Some(())
        };

        match items {
            Items::Path(nodes, offset_slot_full) => {
                let mut cur = 0;
                while cur != block.len() {
                    let item = nodes.get(cur)?.item;
                    let len = (item & OPTIMUM_LEN_MASK) as usize;
                    let offset = item >> OPTIMUM_OFFSET_SHIFT;
                    if len == 0 {
                        return None;
                    }
                    if len == 1 {
                        add_literal(os, offset as usize)?;
                        os.flush_bits();
                    } else {
                        let slot = at(offset_slot_full, offset as usize)?;
                        write_match(os, len, offset, usize::from(slot))?;
                    }
                    cur += len;
                }
            }
            Items::Sequences(sequences) => {
                let mut rest = block;
                for seq in sequences {
                    let litrunlen = (seq.litrunlen_and_length & SEQ_LITRUNLEN_MASK) as usize;
                    let len = (seq.litrunlen_and_length >> SEQ_LENGTH_SHIFT) as usize;

                    let (literals, after) = rest.split_at_checked(litrunlen)?;
                    let (fours, tail) = literals.as_chunks::<4>();
                    for four in fours {
                        for &literal in four {
                            add_literal(os, usize::from(literal))?;
                        }
                        os.flush_bits();
                    }
                    if !tail.is_empty() {
                        for &literal in tail {
                            add_literal(os, usize::from(literal))?;
                        }
                        os.flush_bits();
                    }

                    if len == 0 {
                        break;
                    }
                    write_match(os, len, u32::from(seq.offset), usize::from(seq.offset_slot))?;
                    rest = after.get(len..)?;
                }
            }
        }

        add_literal(os, END_OF_BLOCK)?;
        os.flush_bits();
        let written = writer.finish();
        stream.commit(written);
        Some(())
    }

    fn finish_block(
        &mut self,
        os: &mut OutputBitstream<'_>,
        block: &[u8],
        sequences: &[Sequence],
        is_final_block: bool,
    ) -> Option<()> {
        *self.freqs.litlen.get_mut(END_OF_BLOCK)? += 1;
        self.codes.make(&self.freqs)?;
        self.flush_block(os, block, Items::Sequences(sequences), is_final_block)
    }
}

/// The sequences of the block being parsed.
struct SequenceWriter<'a> {
    sequences: &'a mut Vec<Sequence>,
    litrunlen: u32,
}

impl<'a> SequenceWriter<'a> {
    fn begin(common: &mut Common, sequences: &'a mut Vec<Sequence>) -> Self {
        common.freqs.reset();
        sequences.clear();
        Self {
            sequences,
            litrunlen: 0,
        }
    }

    #[inline(always)]
    fn len(&self) -> usize {
        self.sequences.len()
    }

    #[inline(always)]
    fn choose_literal<const SPLIT_STATS: bool>(&mut self, common: &mut Common, literal: u8) {
        if let Some(freq) = common.freqs.litlen.get_mut(usize::from(literal)) {
            *freq += 1;
        }
        if SPLIT_STATS {
            common.split_stats.observe_literal(literal);
        }
        self.litrunlen += 1;
    }

    #[inline(always)]
    fn choose_match<const SPLIT_STATS: bool>(
        &mut self,
        common: &mut Common,
        length: u32,
        offset: u32,
    ) -> Option<()> {
        let length_slot = usize::from(at(&LENGTH_SLOT, length as usize)?);
        let offset_slot = get_offset_slot(offset)?;

        *common.freqs.litlen.get_mut(FIRST_LEN_SYM + length_slot)? += 1;
        *common.freqs.offset.get_mut(offset_slot as usize)? += 1;
        if SPLIT_STATS {
            common.split_stats.observe_match(length);
        }

        self.sequences.push(Sequence {
            litrunlen_and_length: self.litrunlen | (length << SEQ_LENGTH_SHIFT),
            offset: offset as u16,
            offset_slot: offset_slot as u16,
        });
        self.litrunlen = 0;
        Some(())
    }

    fn finish(self) -> &'a [Sequence] {
        self.sequences.push(Sequence::literals_only(self.litrunlen));
        self.sequences
    }
}

/// Matches cannot go past the end of the input.
#[inline(always)]
pub(crate) fn adjust_max_and_nice_len(max_len: &mut u32, nice_len: &mut u32, remaining: usize) {
    if remaining < MAX_MATCH_LEN as usize {
        *max_len = remaining as u32;
        *nice_len = (*nice_len).min(*max_len);
    }
}

/// With few distinct literals, literals are cheap and short matches are not worth it.
pub(crate) fn choose_min_match_len(num_used_literals: u32, max_search_depth: u32) -> u32 {
    const MIN_LENS: [u8; 80] = [
        9, 9, 9, 9, 9, 9, 8, 8, 7, 7, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
        4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    ];
    let Some(&min_len) = MIN_LENS.get(num_used_literals as usize) else {
        return 3;
    };
    let min_len = u32::from(min_len);
    // A shallow search finds few long matches.
    match max_search_depth {
        0..5 => min_len.min(4),
        5..10 => min_len.min(5),
        10..16 => min_len.min(7),
        _ => min_len,
    }
}

pub(crate) fn calculate_min_match_len(data: &[u8], max_search_depth: u32) -> u32 {
    // A very short input is likely to use the static codes, where short matches pay.
    if data.len() < 512 {
        return MIN_MATCH_LEN;
    }
    let mut used = [false; 256];
    for &byte in data.iter().take(4096) {
        if let Some(used) = used.get_mut(usize::from(byte)) {
            *used = true;
        }
    }
    let num_used_literals = used.iter().filter(|&&used| used).count() as u32;
    choose_min_match_len(num_used_literals, max_search_depth)
}

fn recalculate_min_match_len(freqs: &Freqs, max_search_depth: u32) -> u32 {
    let literal_freqs = freqs.litlen.iter().take(NUM_LITERALS);
    let literal_freq: u32 = literal_freqs.clone().sum();
    let cutoff = literal_freq >> 10;
    let num_used_literals = literal_freqs.filter(|&&freq| freq > cutoff).count() as u32;
    choose_min_match_len(num_used_literals, max_search_depth)
}

#[inline(always)]
pub(crate) fn choose_max_block_end(
    in_block_begin: usize,
    in_end: usize,
    soft_max_len: usize,
) -> usize {
    if in_end - in_block_begin < soft_max_len + MIN_BLOCK_LENGTH {
        in_end
    } else {
        in_block_begin + soft_max_len
    }
}

/// Level 0, and inputs too short to bother with: uncompressed blocks only.
fn compress_none(input: &[u8], os: &mut OutputBitstream<'_>) {
    let mut chunks = input.chunks(usize::from(u16::MAX)).peekable();
    // An empty input still takes a block.
    let mut next = Some(chunks.next().unwrap_or_default());
    while let Some(chunk) = next {
        let Some(mut writer) = os.writer(5 + chunk.len()) else {
            return;
        };
        next = chunks.next();
        writer.put_uncompressed_block(chunk, next.is_none());
        let written = writer.finish();
        os.commit(written);
    }
}

/// Level 1: the longest of two candidates, and blocks of a fixed length.
fn compress_fastest(
    common: &mut Common,
    mf: &mut HtMatchfinder,
    sequences: &mut Vec<Sequence>,
    input: &[u8],
    os: &mut OutputBitstream<'_>,
) -> Option<()> {
    let in_end = input.len();
    let mut in_next = 0;
    let mut in_cur_base = 0;
    let mut max_len = MAX_MATCH_LEN;
    let mut nice_len = common.nice_match_length.min(max_len);
    let mut next_hash = 0;

    mf.init();

    loop {
        let in_block_begin = in_next;
        let in_max_block_end = choose_max_block_end(in_next, in_end, FAST_SOFT_MAX_BLOCK_LENGTH);
        let mut seq = SequenceWriter::begin(common, sequences);

        loop {
            let remaining = in_end - in_next;
            if remaining < MAX_MATCH_LEN as usize {
                max_len = remaining as u32;
                if max_len < ht_matchfinder::REQUIRED_NBYTES {
                    for &literal in input.get(in_next..)? {
                        seq.choose_literal::<false>(common, literal);
                    }
                    in_next = in_end;
                    break;
                }
                nice_len = nice_len.min(max_len);
            }
            let (length, offset) = mf.longest_match(
                input,
                &mut in_cur_base,
                in_next,
                max_len,
                nice_len,
                &mut next_hash,
            )?;
            if length != 0 {
                seq.choose_match::<false>(common, length, offset)?;
                mf.skip_bytes(
                    input,
                    &mut in_cur_base,
                    in_next + 1,
                    length - 1,
                    &mut next_hash,
                )?;
                in_next += length as usize;
            } else {
                seq.choose_literal::<false>(common, at(input, in_next)?);
                in_next += 1;
            }

            if !(in_next < in_max_block_end && seq.len() < FAST_SEQ_STORE_LENGTH) {
                break;
            }
        }

        let block = input.get(in_block_begin..in_next)?;
        common.finish_block(os, block, seq.finish(), in_next == in_end)?;
        if in_next == in_end || os.overflow {
            return Some(());
        }
    }
}

/// Levels 2 to 4: always the longest match.
fn compress_greedy(
    common: &mut Common,
    mf: &mut HcMatchfinder,
    sequences: &mut Vec<Sequence>,
    input: &[u8],
    os: &mut OutputBitstream<'_>,
) -> Option<()> {
    let in_end = input.len();
    let mut in_next = 0;
    let mut in_cur_base = 0;
    let mut max_len = MAX_MATCH_LEN;
    let mut nice_len = common.nice_match_length.min(max_len);
    let mut next_hashes = [0, 0];
    let max_search_depth = common.max_search_depth;

    mf.init();

    loop {
        let in_block_begin = in_next;
        let in_max_block_end = choose_max_block_end(in_next, in_end, SOFT_MAX_BLOCK_LENGTH);

        common.split_stats = BlockSplitStats::default();
        let mut seq = SequenceWriter::begin(common, sequences);
        let min_len =
            calculate_min_match_len(input.get(in_next..in_max_block_end)?, max_search_depth);

        loop {
            adjust_max_and_nice_len(&mut max_len, &mut nice_len, in_end - in_next);
            let (length, offset) = mf.longest_match(
                input,
                &mut in_cur_base,
                in_next,
                min_len - 1,
                max_len,
                nice_len,
                max_search_depth,
                &mut next_hashes,
            )?;

            if length >= min_len && (length > MIN_MATCH_LEN || offset <= 4096) {
                seq.choose_match::<true>(common, length, offset)?;
                mf.skip_bytes(
                    input,
                    &mut in_cur_base,
                    in_next + 1,
                    length - 1,
                    &mut next_hashes,
                )?;
                in_next += length as usize;
            } else {
                seq.choose_literal::<true>(common, at(input, in_next)?);
                in_next += 1;
            }

            if !(in_next < in_max_block_end
                && seq.len() < SEQ_STORE_LENGTH
                && !common
                    .split_stats
                    .should_end_block(in_block_begin, in_next, in_end))
            {
                break;
            }
        }

        let block = input.get(in_block_begin..in_next)?;
        common.finish_block(os, block, seq.finish(), in_next == in_end)?;
        if in_next == in_end || os.overflow {
            return Some(());
        }
    }
}

/// Whether a match found later is enough better than the current one to give that up for literals.
#[inline(always)]
fn is_better_match(cur: (u32, u32), next: (u32, u32), threshold: i32) -> Option<bool> {
    let ((cur_len, cur_offset), (next_len, next_offset)) = (cur, next);
    Some(
        next_len >= cur_len
            && 4 * (next_len - cur_len) as i32
                + (cur_offset.checked_ilog2()? as i32 - next_offset.checked_ilog2()? as i32)
                > threshold,
    )
}

/// Levels 5 to 9: before taking a match, see whether the next position (with `LAZY2`, the next two) has a better one.
fn compress_lazy<const LAZY2: bool>(
    common: &mut Common,
    mf: &mut HcMatchfinder,
    sequences: &mut Vec<Sequence>,
    input: &[u8],
    os: &mut OutputBitstream<'_>,
) -> Option<()> {
    let in_end = input.len();
    let mut in_next = 0;
    let mut in_cur_base = 0;
    let mut max_len = MAX_MATCH_LEN;
    let mut nice_len = common.nice_match_length.min(max_len);
    let mut next_hashes = [0, 0];
    let max_search_depth = common.max_search_depth;

    mf.init();

    loop {
        let in_block_begin = in_next;
        let in_max_block_end = choose_max_block_end(in_next, in_end, SOFT_MAX_BLOCK_LENGTH);
        let mut next_recalc_min_len = in_next + (in_end - in_next).min(10000);

        common.split_stats = BlockSplitStats::default();
        let mut seq = SequenceWriter::begin(common, sequences);
        let mut min_len =
            calculate_min_match_len(input.get(in_next..in_max_block_end)?, max_search_depth);

        loop {
            'item: {
                if in_next >= next_recalc_min_len {
                    min_len = recalculate_min_match_len(&common.freqs, max_search_depth);
                    next_recalc_min_len +=
                        (in_end - next_recalc_min_len).min(in_next - in_block_begin);
                }

                adjust_max_and_nice_len(&mut max_len, &mut nice_len, in_end - in_next);
                let mut cur = mf.longest_match(
                    input,
                    &mut in_cur_base,
                    in_next,
                    min_len - 1,
                    max_len,
                    nice_len,
                    max_search_depth,
                    &mut next_hashes,
                )?;
                if cur.0 < min_len || (cur.0 == MIN_MATCH_LEN && cur.1 > 8192) {
                    seq.choose_literal::<true>(common, at(input, in_next)?);
                    in_next += 1;
                    break 'item;
                }
                in_next += 1;

                // `cur` is a match at `in_next - 1`.
                loop {
                    let (cur_len, cur_offset) = cur;
                    if cur_len >= nice_len {
                        seq.choose_match::<true>(common, cur_len, cur_offset)?;
                        mf.skip_bytes(
                            input,
                            &mut in_cur_base,
                            in_next,
                            cur_len - 1,
                            &mut next_hashes,
                        )?;
                        in_next += cur_len as usize - 1;
                        break 'item;
                    }

                    // With a match in hand, the search for a better one can be shallower.
                    adjust_max_and_nice_len(&mut max_len, &mut nice_len, in_end - in_next);
                    let next = mf.longest_match(
                        input,
                        &mut in_cur_base,
                        in_next,
                        cur_len - 1,
                        max_len,
                        nice_len,
                        max_search_depth >> 1,
                        &mut next_hashes,
                    )?;
                    in_next += 1;
                    if is_better_match(cur, next, 2)? {
                        seq.choose_literal::<true>(common, at(input, in_next - 2)?);
                        cur = next;
                        continue;
                    }

                    if LAZY2 {
                        adjust_max_and_nice_len(&mut max_len, &mut nice_len, in_end - in_next);
                        let next = mf.longest_match(
                            input,
                            &mut in_cur_base,
                            in_next,
                            cur_len - 1,
                            max_len,
                            nice_len,
                            max_search_depth >> 2,
                            &mut next_hashes,
                        )?;
                        in_next += 1;
                        if is_better_match(cur, next, 6)? {
                            seq.choose_literal::<true>(common, at(input, in_next - 3)?);
                            seq.choose_literal::<true>(common, at(input, in_next - 2)?);
                            cur = next;
                            continue;
                        }
                        seq.choose_match::<true>(common, cur_len, cur_offset)?;
                        if cur_len > 3 {
                            mf.skip_bytes(
                                input,
                                &mut in_cur_base,
                                in_next,
                                cur_len - 3,
                                &mut next_hashes,
                            )?;
                            in_next += cur_len as usize - 3;
                        }
                    } else {
                        seq.choose_match::<true>(common, cur_len, cur_offset)?;
                        mf.skip_bytes(
                            input,
                            &mut in_cur_base,
                            in_next,
                            cur_len - 2,
                            &mut next_hashes,
                        )?;
                        in_next += cur_len as usize - 2;
                    }
                    break 'item;
                }
            }

            if !(in_next < in_max_block_end
                && seq.len() < SEQ_STORE_LENGTH
                && !common
                    .split_stats
                    .should_end_block(in_block_begin, in_next, in_end))
            {
                break;
            }
        }

        let block = input.get(in_block_begin..in_next)?;
        common.finish_block(os, block, seq.finish(), in_next == in_end)?;
        if in_next == in_end || os.overflow {
            return Some(());
        }
    }
}

enum Parser {
    None,
    Fastest(HtMatchfinder, Vec<Sequence>),
    Greedy(HcMatchfinder, Vec<Sequence>),
    Lazy(HcMatchfinder, Vec<Sequence>),
    Lazy2(HcMatchfinder, Vec<Sequence>),
    NearOptimal(Box<NearOptimal>),
}

pub(crate) struct Deflate {
    pub(crate) level: u32,
    /// Inputs up to this size are not worth trying to compress.
    max_passthrough_size: usize,
    common: Common,
    parser: Parser,
}

impl Deflate {
    /// `None` if `level` is over 12 or there is not enough memory.
    pub(crate) fn new(level: u32) -> Option<Box<Self>> {
        let (max_search_depth, nice_match_length) = match level {
            0 => (0, 0),
            1 => (0, 32),
            2 => (6, 10),
            3 => (12, 14),
            4 | 5 => (16, 30),
            6 => (35, 65),
            7 => (100, 130),
            8 => (300, MAX_MATCH_LEN),
            9 => (600, MAX_MATCH_LEN),
            10 => (35, 75),
            11 => (100, 150),
            12 => (300, MAX_MATCH_LEN),
            _ => return None,
        };
        let parser = match level {
            0 => Parser::None,
            1 => Parser::Fastest(HtMatchfinder::new()?, new_vec(FAST_SEQ_STORE_LENGTH + 1)?),
            2..=4 => Parser::Greedy(HcMatchfinder::new()?, new_vec(SEQ_STORE_LENGTH + 1)?),
            5..=7 => Parser::Lazy(HcMatchfinder::new()?, new_vec(SEQ_STORE_LENGTH + 1)?),
            8 | 9 => Parser::Lazy2(HcMatchfinder::new()?, new_vec(SEQ_STORE_LENGTH + 1)?),
            10 => Parser::NearOptimal(NearOptimal::new(2, 32, 32, 0)?),
            11 => Parser::NearOptimal(NearOptimal::new(4, 16, 16, 1000)?),
            _ => Parser::NearOptimal(NearOptimal::new(10, 1, 1, 10000)?),
        };
        Some(Box::new(Self {
            level,
            max_passthrough_size: if level == 0 {
                usize::MAX
            } else {
                55 - level as usize * 4
            },
            common: Common::new(max_search_depth, nice_match_length)?,
            parser,
        }))
    }

    /// The size of the stream written to `sink`, or `None` if it does not fit.
    pub(crate) fn compress(&mut self, input: &[u8], sink: Sink<'_>) -> Option<usize> {
        let mut os = OutputBitstream::new(sink);
        let common = &mut self.common;
        match &mut self.parser {
            _ if input.len() <= self.max_passthrough_size => compress_none(input, &mut os),
            Parser::None => return None,
            Parser::Fastest(mf, sequences) => {
                compress_fastest(common, mf, sequences, input, &mut os)?
            }
            Parser::Greedy(mf, sequences) => {
                compress_greedy(common, mf, sequences, input, &mut os)?
            }
            Parser::Lazy(mf, sequences) => {
                compress_lazy::<false>(common, mf, sequences, input, &mut os)?
            }
            Parser::Lazy2(mf, sequences) => {
                compress_lazy::<true>(common, mf, sequences, input, &mut os)?
            }
            Parser::NearOptimal(parser) => parser.compress(common, input, &mut os)?,
        }

        if !os.overflow && os.bitcount != 0 {
            let mut writer = os.writer(1)?;
            writer.put_byte(writer.bitbuf as u8);
            let written = writer.finish();
            os.commit(written);
        }
        (!os.overflow).then_some(os.pos)
    }
}

/// The most that [`Deflate::compress`] writes for an input of this size, at any level.
pub(crate) fn compress_bound(in_nbytes: usize) -> usize {
    // A block is never larger than it would be uncompressed, which costs five bytes for each.
    let max_blocks = in_nbytes.div_ceil(MIN_BLOCK_LENGTH).max(1);
    5 * max_blocks + in_nbytes
}
