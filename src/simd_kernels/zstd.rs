//! What the encoder in src/zstd does for each literal. It takes lookups in 128 bytes and the compression of bytes to
//! beat the scalar code there, so on most CPUs these leave the work to the caller.

use bun_simd::prelude::*;
use core::mem::MaybeUninit;

targets!(icelake);

const ON_ALL_CPUS: bool = cfg!(any(test, feature = "test_support"));

#[derive(Default, Debug, PartialEq, Eq)]
pub struct Written {
    /// In bytes.
    pub len: u64,
    /// Those that do not fill a byte.
    pub bits: u64,
    pub bit_count: u64,
}

/// They take vectors of 64 bytes, and a small part of the time.
#[kernel(no_downclock)]
pub(crate) fn are_quicker() -> bool {
    has!(B64)
}

cfg_select! {
    feature = "test_support" => {
        std::thread_local! {
            /// From how many on this thread gets the kernels.
            pub static COUNT_MIN: core::cell::Cell<usize> = const { core::cell::Cell::new(usize::MAX) };
        }

        pub fn are_quicker_for(count: usize) -> bool {
            count >= COUNT_MIN.get()
        }
    }
    _ => {
        #[inline(always)]
        pub fn are_quicker_for(count: usize) -> bool {
            /// After a pause, Intel's cores take 2 microseconds to get ready for them.
            const COUNT_MIN: usize = 4096;
            count >= COUNT_MIN && are_quicker()
        }
    }
}

/// Backwards. Those that come first are in the lower halves of the blocks.
const ORDER: [u8; 64] = {
    let (mut all, mut i) = ([0; 64], 0);
    while i < 64 {
        all[i] = (63 - (i / 16 * 8 + i % 8 + i % 16 / 8 * 32)) as u8;
        i += 1;
    }
    all
};
/// By the length of the first of two codes.
const FACTORS: [u32; 16] = {
    let (mut all, mut len) = ([0; 16], 0);
    while len < 16 {
        all[len] = (0x10000 << len) | 1;
        len += 1;
    }
    all
};

/// By lane: where its codes end, and the bits behind its last whole byte, without and with those of the lane before.
#[simd]
struct Lanes {
    end: u64x8<S>,
    own_rest: u64x8<S>,
    rest: u64x8<S>,
}

#[simd]
impl Lanes<S> {
    /// 32 codes, each right above its length. Returns how many bytes it has written.
    fn write(&mut self, codes: u16x32<S>, to: &mut [u8]) -> usize {
        const FIRST: u64 = 0xFFFF_FFFF;
        let lens = codes & 15;
        let factors = u32x16::from(FACTORS).swizzle_dyn_relaxed(codes.bitcast::<u32>() & 15);
        let pairs = (codes ^ lens)
            .cast_signed()
            .dot::<i32>(factors.bitcast::<i16>());
        let pairs = pairs.bitcast::<u64>();
        let gap = (lens.bitcast::<u64>() & FIRST).bitcast::<u8>();
        let gap = gap.abs_diff_sum::<u64>(u64x8::splat(0x0010_0010).bitcast::<u8>());
        let fours = (pairs & !FIRST).unbounded_shr(gap) | (pairs & FIRST);

        let len = lens.bitcast::<u8>().sum_groups::<u64>();
        // For each lane: the lowest byte of the last end, those of the lanes before, and zeros.
        let before = len
            .bitcast::<u8>()
            .concat_swizzle(self.end.bitcast::<u8>(), |i| {
                let (lane, other) = (i / 8, i % 8);
                if other == 7 {
                    64 + 56
                } else {
                    8 * other + usize::from(other >= lane)
                }
            });
        let start = before.sum_groups::<u64>() & 7;
        self.end = start + len;
        let whole = self.end & !7;
        // The lowest 4 bits were those of the length.
        let own = fours.rotate_left(start - 4);

        // Four codes are at least 4 bits, so that a byte has bits from at most three lanes.
        let with_previous = |earlier: &mut u64x8<S>, current: u64x8<S>| {
            own | current.shift_elements_right::<1>(core::mem::replace(earlier, current))
        };
        let two = with_previous(&mut self.own_rest, own.unbounded_shr(whole));
        let all = with_previous(&mut self.rest, two.unbounded_shr(whole));
        let is_whole = u64x8::splat(!0)
            .unbounded_shl(whole)
            .bitcast::<u8>()
            .simd_eq(0);
        all.bitcast::<u8>().compress_store(to, is_whole)
    }
}

/// Writes the codes for `symbols` from the last on, and the bits from the lowest up. It needs some room to spare.
#[kernel]
pub fn write_codes(
    symbols: &[u8],
    // By symbol: 1 to 12 of the highest bits, whose value is below 2048, and their number in the lowest 4.
    codes: &[u16; 256],
    out: &mut [u8],
) -> Option<Written> {
    if !has!(icelake) && !ON_ALL_CPUS {
        return None;
    }
    let half_of = |symbol: usize| {
        let listed = u16x32::load(&codes[symbol..]);
        let lens = listed & 15;
        ((listed ^ lens).unbounded_shr(u16x32::splat(12) - lens) | lens).bitcast::<u8>()
    };
    let [[low0, high0], [low1, high1], [low2, high2], [low3, high3]] =
        array::from_fn(|i| half_of(64 * i).deinterleave(half_of(64 * i + 32)));

    let zero = u64x8::zero();
    let mut lanes = Lanes {
        end: zero,
        own_rest: zero,
        rest: zero,
    };
    let (order, mut len) = (u8x64::from(ORDER), 0);
    let mut write = |some: u8x64<S>, exists: mask8x64<S>| {
        let to = out.get_mut(len..)?.first_chunk_mut::<128>()?;
        let ordered = some.swizzle_dyn_relaxed(order);
        let index = ordered & 127;
        let mut lows = exists.select(low0.concat_swizzle_dyn_relaxed(low1, index), 0);
        let mut highs = exists.select(high0.concat_swizzle_dyn_relaxed(high1, index), 0);
        let from_128 = ordered.to_mask();
        if from_128.any() {
            lows = from_128.select(low2.concat_swizzle_dyn_relaxed(low3, index), lows);
            highs = from_128.select(high2.concat_swizzle_dyn_relaxed(high3, index), highs);
        }
        let [first, second] = lows.in_blocks().interleave(highs);
        let first_len = lanes.write(first.bitcast(), to);
        len += first_len + lanes.write(second.bitcast(), &mut to[first_len.min(64)..]);
        Some(())
    };
    let (whole, rest) = symbols.as_chunks::<64>();
    if !rest.is_empty() {
        // They follow codes without bits.
        write(
            u8x64::load_or_default(rest),
            order.simd_lt(rest.len() as u8),
        )?;
    }
    for some in whole.iter().rev() {
        write(u8x64::load(some), mask8x64::splat(true))?;
    }
    Some(Written {
        len: len as u64,
        bits: lanes.rest[7],
        bit_count: lanes.end[7] % 8,
    })
}

/// Adds the bits of each position. Returns the carries.
#[simd]
fn add_bits(sum: &mut u64x8<S>, a: u64x8<S>, b: u64x8<S>) -> u64x8<S> {
    let carry = (a ^ b).bit_select(*sum, a);
    *sum = sum.xor3(a, b);
    carry
}

/// For each position in a lane, adds in how many lanes the bit is set.
#[simd]
fn count_bits(bits: u64x8<S>, counts: u8x64<S>) -> u8x64<S> {
    let by_place = bits.bitcast::<u8>().swizzle(|i| i % 8 * 8 + i / 8);
    let by_bit = by_place.bitcast::<u64>().transpose_bits();
    counts + by_bit.bitcast::<u8>().count_ones()
}

#[simd]
fn add_counts(counts: u8x64<S>, shift: u32, to: &mut [u32; 64]) {
    let counts = counts.to_array();
    for (counts, to) in counts
        .as_chunks::<16>()
        .0
        .iter()
        .zip(to.as_chunks_mut::<16>().0)
    {
        (u32x16::load(to) + (u8x16::load(counts).cast::<u32>() << shift)).store(to);
    }
}

const GROUP: usize = 128;
const BATCH: usize = 29 * GROUP;
// A group adds up to 8 to a byte, and one more can come from what was left.
const _: () = assert!(BATCH / GROUP * 8 + 8 <= u8::MAX as usize);
/// Less than a group is left from the batch before, and vectors go beyond the end. Not 4 KB, as processors mistake
/// addresses that are so far apart for the same.
const ROOM: usize = BATCH + 5 * GROUP + 64;

/// What is counted, as far as it is not in multiples of 16: ones, twos, fours and eights.
#[simd]
type Digits = [u64x8<S>; 4];

/// Leaves the rest in `bin`, whose bytes have the same 2 highest bits. The other 6 are the position of a bit in a lane.
#[simd]
#[inline(never)]
fn count_groups(bin: &mut Output<'_, u8>, digits: &mut Digits<S>, counts: &mut [u32; 64]) {
    let len = bin.len();
    bin.push(u8x64::zero());
    bin.push(u8x64::zero());
    let [mut ones, mut twos, mut fours, mut eights] = *digits;
    let mut sixteens = u8x64::zero();
    // Or else the compiler makes shifts of the rotation.
    let one = u64x8::splat(1).black_box();
    let mut left = bin.filled();
    while let Some(group) = left.first_chunk::<{ 2 * GROUP }>() {
        let mut four = |at: usize| {
            // Only the lowest byte of each lane counts.
            let bit = |at: usize| one.rotate_left(u64x8::load_bytes(&group[at..]));
            let a = add_bits(&mut ones, bit(at), bit(at + 1));
            let b = add_bits(&mut ones, bit(at + 2), bit(at + 3));
            add_bits(&mut twos, a, b)
        };
        let mut eight = |at: usize| {
            let (a, b) = (four(at), four(at + 4));
            add_bits(&mut fours, a, b)
        };
        let (a, b) = (eight(0), eight(64));
        sixteens = count_bits(add_bits(&mut eights, a, b), sixteens);
        left = &left[GROUP..];
    }
    add_counts(sixteens, 4, counts);
    *digits = [ones, twos, fours, eights];
    let rest = [u8x64::load(left), u8x64::load(&left[64..])];
    bin.clear();
    bin.push(rest[0]);
    bin.push(rest[1]);
    bin.truncate(len % GROUP);
}

#[simd]
fn count_rest(bin: &mut Output<'_, u8>, digits: &mut Digits<S>, counts: &mut [u32; 64]) {
    counts[0] = counts[0].wrapping_sub((GROUP - bin.len()) as u32);
    bin.push(u8x64::zero());
    bin.push(u8x64::zero());
    bin.truncate(GROUP);
    count_groups(bin, digits, counts);
    let mut few = u8x64::zero();
    for &digit in digits.iter().rev() {
        few = count_bits(digit, few + few);
    }
    add_counts(few, 0, counts);
}

/// Adds how often each byte occurs, by Harold Aptroot's method:
/// https://bitmath.blogspot.com/2024/11/histogramming-bytes-with-positional.html
#[kernel]
pub(crate) fn add_byte_counts(bytes: &[u8], counts: &mut [[u32; 64]; 4]) -> bool {
    if !has!(icelake) && !ON_ALL_CPUS {
        return false;
    }
    let mut room = Aligned([[MaybeUninit::uninit(); ROOM]; 4]);
    let mut bins = room.0.each_mut().map(|it| Output::new(it));
    let mut digits = [[u64x8::zero(); 4]; 4];
    for batch in bytes.chunks(BATCH) {
        {
            let [a, b, c, d] = &mut bins;
            let (mut a, mut b) = (a.limit(BATCH + 64), b.limit(BATCH + 64));
            let (mut c, mut d) = (c.limit(BATCH + 64), d.limit(BATCH + 64));
            let mut sort = |some: u8x64<S>, exists: mask8x64<S>| {
                a.push_with_slack(some.selected(some.simd_lt(64) & exists));
                b.push_with_slack(some.selected(some.cast_signed().simd_ge(64)));
                c.push_with_slack(some.selected(some.cast_signed().simd_lt(-64)));
                d.push_with_slack(some.selected(some.simd_ge(192)));
            };
            let (whole, rest) = u8x64::over(batch).exact();
            for some in whole {
                sort(some, mask8x64::splat(true));
            }
            sort(u8x64::load_or_default(rest), mask8x64::first_n(rest.len()));
        }
        for i in 0..4 {
            count_groups(&mut bins[i], &mut digits[i], &mut counts[i]);
        }
    }
    for i in 0..4 {
        count_rest(&mut bins[i], &mut digits[i], &mut counts[i]);
    }
    true
}

/// How often each byte occurs.
pub fn count_bytes(bytes: &[u8]) -> Option<[u32; 256]> {
    // So that tests see what the caller does then.
    if cfg!(feature = "test_support") && bytes.len() % 2 == 1 {
        return None;
    }
    let mut counts = [0; 256];
    let quarters = counts.as_chunks_mut().0.first_chunk_mut()?;
    add_byte_counts(bytes, quarters).then_some(counts)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Random(u64);

    impl Random {
        fn below(&mut self, limit: usize) -> usize {
            self.0 = self.0.wrapping_mul(0x5851_f42d_4c95_7f2d).wrapping_add(1);
            (self.0 >> 33) as usize % limit
        }
    }

    fn write_slowly(symbols: &[u8], codes: &[u16; 256], out: &mut [u8]) -> Option<Written> {
        let (mut len, mut bits, mut bit_count) = (0, 0, 0);
        for group in symbols.chunks(64).rev() {
            out.get(len..len + 128)?;
            for &symbol in group.iter().rev() {
                let code = u64::from(codes[usize::from(symbol)]);
                bits |= code >> (16 - code % 16) << bit_count;
                bit_count += code % 16;
                while bit_count >= 8 {
                    out[len] = bits as u8;
                    (len, bits, bit_count) = (len + 1, bits >> 8, bit_count - 8);
                }
            }
        }
        Some(Written {
            len: len as u64,
            bits,
            bit_count,
        })
    }

    #[test]
    fn codes_are_written() {
        let mut random = Random(1);
        for _ in 0..if cfg!(miri) { 1 } else { 1000 } {
            let (least, more) = (1 + random.below(12), random.below(12));
            let codes = core::array::from_fn(|_| {
                let len = (least + random.below(more + 1)).min(12);
                (random.below(1 << len.min(11)) << (16 - len) | len) as u16
            });
            let (count, values) = (random.below(320).saturating_sub(20), 1 + random.below(256));
            let symbols: Vec<u8> = (0..count).map(|_| random.below(values) as u8).collect();
            let mut expected = vec![0; random.below(700)];
            let written = write_slowly(&symbols, &codes, &mut expected);
            let len = written.as_ref().map_or(0, |it| it.len as usize);
            for target in write_codes::targets() {
                let mut out = vec![0xAA; expected.len()];
                if let Some(found) = write_codes::to(target, &symbols, &codes, &mut out) {
                    assert_eq!((&found, &out[..len]), (&written, &expected[..len]));
                }
            }
        }
    }

    #[test]
    fn any_codes_are_taken() {
        let mut random = Random(2);
        for room in (0..400).step_by(if cfg!(miri) { 399 } else { 1 }) {
            let all = [0, 0xFFFF, 13, 15, 1 << 16][room % 5];
            let codes = core::array::from_fn(|_| {
                u16::try_from(all).unwrap_or_else(|_| random.below(1 << 16) as u16)
            });
            let symbols: [u8; 150] = core::array::from_fn(|_| random.below(256) as u8);
            for target in write_codes::targets() {
                write_codes::to(target, &symbols, &codes, &mut vec![0; room]);
            }
        }
    }

    #[test]
    fn bytes_are_counted() {
        let mut random = Random(3);
        for round in 0..if cfg!(miri) { 1 } else { 400 } {
            let len = match round % 4 {
                0 => random.below(300),
                batches => batches * BATCH - 130 + random.below(260),
            };
            let values = [1, 64, 256][random.below(3)];
            let first = random.below(257 - values) / values * values;
            let mut bytes: Vec<u8> = (0..len)
                .map(|_| (first + random.below(values)) as u8)
                .collect();
            // The most is left over for the next batch.
            bytes
                .iter_mut()
                .take(round / 4 % 2)
                .for_each(|it| *it ^= 64);
            let before = [[round as u32 % 3; 64]; 4];
            let mut expected = before;
            for &byte in &bytes {
                expected.as_flattened_mut()[usize::from(byte)] += 1;
            }
            for target in add_byte_counts::targets() {
                let mut counts = before;
                if let Some(is_done) = add_byte_counts::to(target, &bytes, &mut counts) {
                    assert!(is_done);
                    assert_eq!(counts, expected);
                }
            }
        }
    }
}
