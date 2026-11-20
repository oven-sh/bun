//! For the zstd encoder. Without `avx512_icl`, these leave the work to the caller.
pub use quicker_simd::are_quicker_for;
pub use simd::{count_bytes, write_codes};

pub struct Written {
    /// In bytes.
    pub len: usize,
    /// Those that do not fill a byte.
    pub bits: u64,
    pub bit_count: u64,
}

fn never(_: usize) -> bool {
    false
}

fn write_none(_: &[u8], _: &[u16; 256], _: &mut [u8]) -> Option<Written> {
    None
}

fn count_none(_: &[u8]) -> Option<[u32; 256]> {
    None
}

// From Zen 4 and Sapphire Rapids on. The clock of Ice Lake goes down for 512 bits, and it has no BF16.
#[bun_simd::foreach_target(avx512_icl + "avx512bf16", portable64)]
mod quicker_simd {
    /// After a pause, Intel's cores take 2 microseconds to get ready. The copy for tests takes any count.
    #[export(or = never)]
    pub fn are_quicker_for(count: usize) -> bool {
        count >= 4096 || MORE_FEATURES.is_empty()
    }
}

#[bun_simd::foreach_target(avx512_icl, portable64)]
mod simd {
    use bun_simd::{Out, Shuffle};
    use core::array::from_fn;
    use core::mem::MaybeUninit;
    use isa::{I8, I16, I32, U8, U16, U32, U64};

    /// Those that are written first go to the lower halves of the blocks.
    struct Backwards;

    impl Shuffle<64> for Backwards {
        const FROM: [usize; 64] = from_fn(const |i| 63 - (i / 16 * 8 + i % 8 + i % 16 / 8 * 32));
    }

    /// For each lane: the lowest bytes of those before, zeros, and that of the last lane of the other vector.
    struct Before;

    impl Shuffle<64> for Before {
        const FROM: [usize; 64] = from_fn(const |i| match (i / 8, i % 8) {
            (_, 7) => 64 + 56,
            (lane, other) => 8 * other + (other >= lane) as usize,
        });
    }

    /// By lane: where its codes end, and the bits after its last whole byte.
    struct Ends {
        at: U64,
        own_rest: U64,
        /// From the lane before.
        earlier_rest: U64,
    }

    /// Four in each lane, each right above its length. Returns the number of whole bytes.
    #[inline(always)]
    fn write_32(codes: U8, ends: &mut Ends, to: &mut [u8; 64]) -> usize {
        let factors = U32::from_array(const { from_fn(const |len| 0x10000 << len | 1) });
        let factors: I16 = factors.lookup_across(codes.bitcast()).bitcast();
        let values: I16 = (codes.bitcast::<U16>() >> 4).bitcast();
        let pairs: U32 = I32::pairwise_dot(values, factors).bitcast();
        // 32 minus the length of the first pair, which moves up to the second.
        let gap = U64::sums_of_8((!codes.bitcast::<U64>() & 0x000F_000F | 2 << 8).bitcast());
        let fours: U64 = pairs.rotate_left(gap.bitcast()).bitcast();

        let len = U64::sums_of_8((codes.bitcast::<U16>() & 15).bitcast());
        let before = len.bitcast::<U8>().shuffle::<Before>(ends.at.bitcast());
        let start = U64::sums_of_8(before) & 7;
        ends.at = start + len;
        let (own, whole) = (fours.rotate_left(start - gap), ends.at & !7);

        // Four codes are at least 4 bits, so that a byte has bits from at most three lanes.
        let own_rest = own >> whole;
        let earlier = own_rest.shift_in::<1>(ends.own_rest);
        let earlier_rest = earlier >> whole;
        let all: U8 = (own | earlier | earlier_rest.shift_in::<1>(ends.earlier_rest)).bitcast();
        (ends.own_rest, ends.earlier_rest) = (own_rest, earlier_rest);
        let kept = (!U64::zero() << whole).bitcast::<U8>().simd_eq(0);
        all.compress(kept.to_bitmask()).store(to);
        kept.count()
    }

    /// Of the first `count` symbols.
    #[inline(always)]
    fn write_64(
        symbols: U8,
        count: usize,
        [low, high]: &[[U8; 4]; 2],
        ends: &mut Ends,
        to: &mut [u8; 128],
    ) -> Option<usize> {
        let symbols = symbols.shuffle::<Backwards>(symbols);
        let mut lows = low[0].lookup2_across(low[1], symbols);
        let mut highs = high[0].lookup2_across(high[1], symbols);
        let from_128 = symbols.simd_ge(128);
        if from_128.any() {
            lows = from_128.select(low[2].lookup2_across(low[3], symbols), lows);
            highs = from_128.select(high[2].lookup2_across(high[3], symbols), highs);
        }
        let exists = U8::iota().simd_lt(count as u8).select(255, 0);
        let exists = exists.shuffle::<Backwards>(exists);
        let (first, second) = (lows & exists).interleave_in_blocks(highs & exists);
        let len = write_32(first, ends, to.first_chunk_mut()?);
        Some(len + write_32(second, ends, to[len..].first_chunk_mut()?))
    }

    /// From the last symbol on, and from the lowest bit up. `None` unless there is room to spare.
    #[export(or = write_none)]
    pub fn write_codes(
        symbols: &[u8],
        // By symbol: 1 to 12 of the highest bits, and their number in the lowest 4.
        codes: &[u16; 256],
        out: &mut [u8],
    ) -> Option<Written> {
        let mut tables = [[U8::zero(); 4]; 2];
        for (i, pair) in codes.as_chunks().0.as_chunks::<2>().0.iter().enumerate() {
            let above_len = |codes| {
                let (codes, lens) = (U16::load(codes), U16::load(codes) & 15);
                ((codes ^ lens) >> (U16::splat(12) - lens) | lens).bitcast::<U8>()
            };
            (tables[0][i], tables[1][i]) = above_len(&pair[0]).deinterleave(above_len(&pair[1]));
        }
        let mut ends = Ends {
            at: U64::zero(),
            own_rest: U64::zero(),
            earlier_rest: U64::zero(),
        };
        let (mut len, (groups, last)) = (0, symbols.as_chunks());
        if !last.is_empty() {
            let ([some], to) = (U8::load_or_zero(last), out.first_chunk_mut()?);
            len = write_64(some, last.len(), &tables, &mut ends, to)?;
        }
        for group in groups.iter().rev() {
            let to = out.get_mut(len..)?.first_chunk_mut()?;
            len += write_64(U8::load(group), 64, &tables, &mut ends, to)?;
        }
        Some(Written {
            len,
            bits: ends.own_rest[7] | ends.earlier_rest[7],
            bit_count: ends.at[7] % 8,
        })
    }

    const GROUP: usize = 128;
    /// A group adds up to 8 to a byte.
    const BATCH: usize = 255 / 8 * GROUP;
    /// With the rest of the lanes that start in a group.
    const SPAN: usize = GROUP + 7;
    const PADDING: usize = SPAN - 1;

    /// Adds the lowest bytes of the lanes from 8 places. Returns the eights.
    #[inline(always)]
    fn add_64([ones, twos, fours]: &mut [U64; 3], bytes: &[u8]) -> U64 {
        let bit = |at: usize| U64::splat(1).rotate_left(U8::from_slice(&bytes[at..]).bitcast());
        let (a, b) = (ones.add_bits(bit(0), bit(1)), ones.add_bits(bit(2), bit(3)));
        let first = twos.add_bits(a, b);
        let (a, b) = (ones.add_bits(bit(4), bit(5)), ones.add_bits(bit(6), bit(7)));
        let second = twos.add_bits(a, b);
        fours.add_bits(first, second)
    }

    /// Counts by the lowest 6 bits, as positions of bits in a lane. The last `PADDING` bytes are zeros.
    #[inline(never)]
    fn count_padded(mut bytes: &[u8], counts: &mut [u32; 64]) {
        let (mut below_8, mut eights, mut sixteens) = ([U64::zero(); 3], U64::zero(), U8::zero());
        while let Some(group) = bytes.first_chunk::<SPAN>() {
            let first = add_64(&mut below_8, group);
            let second = add_64(&mut below_8, &group[64..]);
            sixteens += U8::count_by_position(eights.add_bits(first, second));
            bytes = &bytes[GROUP..];
        }
        let ([ones, twos, fours], mut few) = (below_8, U8::zero());
        for digit in [eights, fours, twos, ones] {
            few = few + few + U8::count_by_position(digit);
        }
        let (sixteens, few) = (sixteens.to_array(), few.to_array());
        for (i, to) in counts.as_chunks_mut().0.iter_mut().enumerate() {
            let widen = |from: &[u8]| isa::x128::U8::from_slice(&from[16 * i..]).cast();
            (U32::load(to) + (widen(&sixteens) << 4) + widen(&few)).store(to);
        }
        counts[0] -= (PADDING - bytes.len()) as u32;
    }

    /// By Harold Aptroot's method: https://bitmath.blogspot.com/2024/11/histogramming-bytes-with-positional.html
    #[export(or = count_none)]
    pub fn count_bytes(bytes: &[u8]) -> Option<[u32; 256]> {
        let mut rooms = [[MaybeUninit::uninit(); BATCH + PADDING]; 4];
        let mut counts = [0; 256];
        let (whole, rest) = bytes.as_chunks();
        for batch in whole.chunks(BATCH / 64) {
            let [a, b, c, d] = &mut rooms;
            let mut sorted = [a, b, c, d].map(|it| Out::from(&mut it[..]).into_writer());
            for some in batch {
                let some = U8::load(some);
                let top_bits = |of: U8| of.bitcast::<I8>().simd_lt(0).to_bitmask();
                let (bit7, bit6) = (top_bits(some), top_bits(some + some));
                let kept = [!(bit7 | bit6), !bit7 & bit6, bit7 & !bit6, bit7 & bit6];
                for (to, kept) in sorted.iter_mut().zip(kept) {
                    to.push_first(some.compress(kept).to_array(), kept.count_ones() as usize);
                }
            }
            for (mut to, counts) in sorted.into_iter().zip(counts.as_chunks_mut().0) {
                to.push([0; PADDING]);
                count_padded(to.finish(), counts);
            }
        }
        for &byte in rest {
            counts[usize::from(byte)] += 1;
        }
        Some(counts)
    }
}
