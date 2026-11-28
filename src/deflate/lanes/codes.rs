//! From the header of a block to the tables of the kernels.

use bun_highway::inflate::kind::{DISTANCE, END, LENGTH, LITERALS, MASK, STOP};
use bun_highway::inflate::{Distances, Lists, Litlens, Tables, Tokens, Usual};
use core::hint::select_unpredictable;

use super::word_at;
use crate::format::{
    END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MAX_PRECODE_LEN, OFFSET_SYMBOLS,
    PRECODE_ORDER, PRECODE_SYMBOLS, RESERVED_SYMBOLS, length_slot, offset_slot, repeat_slot,
    static_litlen_codeword,
};
use crate::{chunk_at, chunk_at_mut, wrapped, wrapped_mut};

/// What a token copies without a detour.
const COPIED: u32 = 32;
/// In 256ths.
const USUAL_SHARE: u32 = 180;
const GROUP: usize = 8;
const SYMBOLS: usize = LITLEN_SYMBOLS + OFFSET_SYMBOLS;

const INVALID: u32 = STOP + 2 * ONE_BYTE;
pub(super) const ONE_BYTE: u32 = 1 << 8;

/// `base` is a multiple of the range.
const fn number(base: u32, extra_bits: u32) -> u32 {
    (2 * base + (1 << extra_bits)) << 16 | extra_bits
}

static LITLEN_ENTRIES: [u32; LITLEN_SYMBOLS + GROUP] = table!(|symbol| match symbol {
    ..END_OF_BLOCK => (symbol as u32) << 16 | ONE_BYTE,
    END_OF_BLOCK => END,
    FIRST_LENGTH_SYMBOL..286 => {
        let slot = length_slot(symbol - FIRST_LENGTH_SYMBOL);
        let rest = (slot.base + slot.extra_bits % 3).saturating_sub(COPIED);
        let rest = rest.next_multiple_of(1 << slot.extra_bits);
        LENGTH + (slot.base - rest) * ONE_BYTE + number(rest, slot.extra_bits)
    }
    _ => INVALID,
});
static DISTANCE_ENTRIES: [u32; OFFSET_SYMBOLS + GROUP] = table!(|symbol| match symbol {
    ..30 => DISTANCE | number(offset_slot(symbol).base - 1, offset_slot(symbol).extra_bits),
    _ => INVALID,
});

/// How long the codewords are.
#[derive(Clone, Copy)]
pub struct Lengths {
    /// The distances follow the others.
    pub all: [u8; SYMBOLS + GROUP],
    pub litlens: u16,
    pub distances: u8,
}

impl Lengths {
    pub(super) const STATIC: Self = Self {
        all: table!(|symbol| match symbol {
            ..LITLEN_SYMBOLS => static_litlen_codeword(symbol).len as u8,
            _ => 5,
        }),
        litlens: LITLEN_SYMBOLS as u16,
        distances: OFFSET_SYMBOLS as u8,
    };

    #[inline(always)]
    pub(super) fn of(&self, symbol: usize) -> u32 {
        self.all.get(symbol).map_or(0, |&len| len.into())
    }
}

/// Adds up `values` by how often the symbols from `start` to `end` come up, in 32768ths.
#[inline(always)]
fn weigh(lengths: &Lengths, start: usize, end: usize, values: impl Fn(usize, u32) -> u32) -> u32 {
    let lens = lengths
        .all
        .get(start..end)
        .unwrap_or_default()
        .iter()
        .map(|&len| u32::from(len % 16));
    lens.enumerate()
        .map(|(at, len)| (1 << 15 >> len) % (1 << 15) * values(at, len))
        .sum()
}

/// Of 32768 symbols.
#[inline(always)]
pub(super) fn share_of_matches(lengths: &Lengths) -> u32 {
    let litlens = lengths.litlens.into();
    weigh(lengths, FIRST_LENGTH_SYMBOL, litlens, |_, _| 1)
}

pub(super) struct Sorted {
    litlens: Litlens,
    distances: Distances,
}

impl Default for Sorted {
    fn default() -> Self {
        Self {
            litlens: Lists {
                entries: [[0; _]; _],
                ends: [0; _],
            },
            distances: Lists {
                entries: [[0; _]; _],
                ends: [0; _],
            },
        }
    }
}

#[inline(always)]
fn clear<const N: usize>(lists: &mut Lists<N>) {
    lists.ends = core::array::from_fn(|len| (N * len) as u16);
}

/// No more than a group, unless `len` is 0.
#[inline(always)]
fn push<const N: usize>(lists: &mut Lists<N>, len: u8, entries: &[u32; GROUP], count: usize) {
    let end = wrapped_mut(&mut lists.ends, len.into());
    let at = *end;
    *end += count as u16;
    if let Some(to) = chunk_at_mut(lists.entries.as_flattened_mut(), at.into()) {
        *to = *entries;
    }
}

#[inline(always)]
fn sort<const N: usize>(lists: &mut Lists<N>, lens: &[u8], entries: &[u32]) {
    clear(lists);
    for (&len, entries) in lens.iter().zip(entries.array_windows()) {
        if len != 0 {
            push(lists, len, entries, 1);
        }
    }
}

impl Sorted {
    #[inline(always)]
    pub(super) fn fill_with(&mut self, lengths: &Lengths) {
        let (litlens, rest) = lengths.all.split_at(SYMBOLS.min(lengths.litlens.into()));
        let distances = rest.get(..lengths.distances.into()).unwrap_or_default();
        sort(&mut self.litlens, litlens, &LITLEN_ENTRIES);
        sort(&mut self.distances, distances, &DISTANCE_ENTRIES);
    }

    /// From the counts at `bit` on. Returns where it ends, unless something is wrong or missing.
    #[inline(always)]
    pub(super) fn read(
        &mut self,
        lengths: &mut Lengths,
        input: &[u8],
        bit: usize,
    ) -> Option<usize> {
        const ENTRIES: usize = 1 << MAX_PRECODE_LEN;
        /// Shows how far a word has been shifted.
        const MARK: u64 = 1 << 56;
        static REPEATED: [[u8; GROUP]; 16] = table!(|len| [len as u8; _]);
        #[expect(clippy::indexing_slicing, reason = "runs in the compiler")]
        const SHIFTS: [u8; PRECODE_SYMBOLS] = table!(|symbol| {
            let mut rank = 0;
            while PRECODE_ORDER[rank] as usize != symbol {
                rank += 1;
            }
            3 * rank as u8
        });
        /// How many entries a codeword has, in the byte for its length.
        static RANGES: [u64; 8] = table!(|len| (((ENTRIES >> len) % ENTRIES) as u64) << (8 * len));
        static REVERSED: [i8; ENTRIES] = table!(|index| ((index as u8).reverse_bits() / 2) as i8);

        let header = word_at(input, bit)? as usize;
        let (litlens, distances) = (FIRST_LENGTH_SYMBOL + header % 32, 1 + (header >> 5) % 32);
        if litlens > LITLEN_SYMBOLS - RESERVED_SYMBOLS
            || distances > OFFSET_SYMBOLS - RESERVED_SYMBOLS
        {
            return None;
        }
        let precode_bits = 3 * (4 + (header >> 10) % 16);
        let precode = word_at(input, bit + 14)? & ((1 << precode_bits) - 1);
        let mut bit = bit + 14 + precode_bits;

        let lens = SHIFTS.map(|shift| (precode >> shift) as u8 % 8);
        let (mut ranges, mut space) = (0u64, 0);
        for len in lens {
            ranges = ranges.wrapping_add(*wrapped(&RANGES, len.into()));
            space += (ENTRIES >> len) % ENTRIES;
        }
        if space != ENTRIES {
            return None;
        }
        // The greatest of those whose codeword is not greater than the index.
        let (mut found, mut starts) = ([0u8; ENTRIES], ranges.wrapping_mul(u64::MAX / 0xFF - 1));
        for (symbol, len) in (0..).zip(lens) {
            let (start, key) = ((starts >> (8 * len)) as i8, len << 5 | symbol);
            starts = starts.wrapping_add(*wrapped(&RANGES, len.into()));
            for (to, index) in found.iter_mut().zip(REVERSED) {
                *to = (*to).max(key & u8::from(start <= index).wrapping_neg());
            }
        }
        let slots = |it: u8| repeat_slot((it % 32).into());
        let columns = [
            found.map(|it| (it >> 5) + slots(it).extra_bits as u8),
            found.map(|it| it >> 5),
            found.map(|it| slots(it).base as u8),
            found.map(|it| if it % 32 > 16 { 0 } else { it % 32 }),
        ];
        let table: &[u8; 4 * ENTRIES] = columns.as_flattened().first_chunk()?;
        let mut index = word_at(input, bit)? as usize;
        // Nothing to repeat.
        if *wrapped(&found, index) % 32 == 16 {
            return None;
        }

        *lengths = Lengths {
            all: [0; _],
            litlens: litlens as u16,
            distances: distances as u8,
        };
        let (mut symbol, mut len) = (0, 0);
        macro_rules! read {
            ($lists:expr, $entries:expr, $first:expr, $end:expr) => {
                let mut ends = $lists.ends;
                while symbol < $end {
                    // The index is there already, so that the first lookup does not wait.
                    let mut word = word_at(input, bit)? % MARK + MARK;
                    for _ in 0..3 {
                        let column = |at: usize| *wrapped(table, at + index % ENTRIES);
                        let bits = u32::from(column(0));
                        let rest = word.wrapping_shr(bits);
                        let all = word ^ rest.wrapping_shl(bits);
                        let extra = all.wrapping_shr(column(ENTRIES).into());
                        let count = usize::from(column(2 * ENTRIES)) + extra as usize;
                        let value = usize::from(column(3 * ENTRIES));
                        len = select_unpredictable(value < 16, value, len);
                        (word, index) = (rest, rest as usize);
                        // Longer runs are zeros, which are there already.
                        *chunk_at_mut(&mut lengths.all, symbol)? = *wrapped(&REPEATED, len);
                        let end = wrapped_mut(&mut ends, len);
                        let to = chunk_at_mut($lists.entries.as_flattened_mut(), (*end).into())?;
                        *to = *chunk_at::<_, GROUP>($entries, symbol - $first)?;
                        *end += count as u16;
                        symbol += count;
                        if symbol >= $end {
                            break;
                        }
                    }
                    bit += (word.leading_zeros() - MARK.leading_zeros()) as usize;
                }
                $lists.ends = ends;
            };
        }
        clear(&mut self.litlens);
        clear(&mut self.distances);
        read!(self.litlens, &LITLEN_ENTRIES, 0, litlens);
        // The last run may reach into the distances.
        *wrapped_mut(&mut self.litlens.ends, len) -= (symbol - litlens) as u16;
        push(
            &mut self.distances,
            len as u8,
            DISTANCE_ENTRIES.first_chunk()?,
            symbol - litlens,
        );
        read!(
            self.distances,
            &DISTANCE_ENTRIES,
            litlens,
            litlens + distances
        );
        (symbol == litlens + distances && lengths.of(END_OF_BLOCK) != 0).then_some(bit)
    }

    /// What a byte is likely to stand for.
    #[inline(always)]
    pub(super) fn ratio(&self, lengths: &Lengths) -> f32 {
        static TWICE_MEANS: [u32; 32] =
            table!(|at| 2 * length_slot(at).base + (1 << length_slot(at).extra_bits) - 1);
        let litlens = usize::from(lengths.litlens);
        let of_matches = |values: fn(usize) -> u32| {
            weigh(lengths, FIRST_LENGTH_SYMBOL, litlens, |at, _| values(at)) as f32
        };
        let matches = of_matches(|_| 1);
        let bytes = 32768.0 - matches + of_matches(|at| *wrapped(&TWICE_MEANS, at)) / 2.0;
        let code_bits = (0..)
            .zip(self.litlens.counts())
            .map(|(len, count)| (u32::from(count) << 15 >> len) * len);
        let end = litlens + usize::from(lengths.distances);
        let distance_bits = weigh(lengths, litlens, end, |at, len| {
            len + offset_slot(at).extra_bits
        });
        let extra_bits =
            of_matches(|at| length_slot(at).extra_bits) + matches * distance_bits as f32 / 32768.0;
        8.0 * bytes / (code_bits.sum::<u32>() as f32 + extra_bits)
    }

    /// Literals with codewords of the same length, if there is little else.
    #[inline(always)]
    pub(super) fn usual(&self, lengths: &Lengths) -> Option<Usual> {
        let counts = self.litlens.counts();
        let shares: [_; 16] =
            core::array::from_fn(|len| u32::from(*wrapped(&counts, len)) << 8 >> len);
        let is_usual = |len| *wrapped(&shares, len) >= USUAL_SHARE;
        let len = (1..=8).fold(0, |usual, len| {
            select_unpredictable(is_usual(len), len, usual)
        });
        let shorter: u32 = shares.get(1..len)?.iter().sum();
        let entries = wrapped(&self.litlens.entries, len);
        let coded = entries.get(..(*wrapped(&counts, len)).into())?;
        let literals = coded.partition_point(|it| it & MASK == LITERALS) as u32;
        let mut bytes = entries.first_chunk()?.map(|it| (it >> 16) as u8);
        // The kernel scribbles with them.
        bytes.get_mut(literals as usize..)?.fill(0);
        // Short ones come in pairs.
        let min = if len < 6 { 232 } else { USUAL_SHARE };
        (literals << (8 - len) >= min && share_of_matches(lengths) < 1000).then(|| {
            Usual::new(
                &bytes,
                (literals - 1) as u8,
                (shorter >> (8 - len)) as u8,
                len as u8,
            )
        })
    }

    /// Returns how many bits 8 tokens take on average, unless the codes are wrong or out of the ordinary.
    #[inline(always)]
    pub(super) fn build(
        &mut self,
        lengths: &Lengths,
        input_len: u32,
        draft: &mut Tokens,
        tables: &mut Tables,
    ) -> Option<u32> {
        // One codeword of one bit, or none (RFC 1951 3.2.7).
        if let [_, used @ ..2, longer @ ..] = self.distances.counts()
            && longer == [0; _]
        {
            push(&mut self.distances, 1, &[INVALID; _], (2 - used).into());
        }
        let short: &[u8; 16] = chunk_at(&lengths.all, FIRST_LENGTH_SYMBOL)?;
        let shortest = short
            .iter()
            .fold(u8::MAX, |min, it| it.wrapping_sub(1).min(min));
        let lists = (&self.litlens, &self.distances);
        tables.build(lists, input_len, u32::from(shortest) + 1, draft)
    }
}
