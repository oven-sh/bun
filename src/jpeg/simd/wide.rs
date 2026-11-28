//! The same with vectors of 64 bytes, of which a block fills two.

use super::*;

/// Two weights that alternate in the lower half, and two in the upper half.
#[simd]
fn halves(lower: [i16; 2], upper: [i16; 2]) -> i16x32<S> {
    i16x16::repeat(&lower).concat(i16x16::repeat(&upper))
}

#[simd]
fn swapped(v: i16x32<S>) -> i16x32<S> {
    v.rotate_elements_left::<16>()
}

/// In each half the sum over the four rows in `pairs`, by `weight(half, row)`.
#[simd]
fn weigh_four(
    pairs: i16x32<S>,
    sums: i32x16<S>,
    weight: impl Fn(usize, usize) -> i16,
) -> i32x16<S> {
    let two = |half, row| [weight(half, row), weight(half, row + 1)];
    let sums = pairs.dot_add_relaxed(halves(two(0, 0), two(1, 2)), sums);
    swapped(pairs).dot_add_relaxed(halves(two(0, 2), two(1, 0)), sums)
}

#[simd]
fn load(block: &Block) -> [i16x32<S>; 2] {
    [i16x32::load(&block.0), i16x32::load_last(&block.0)]
}

/// Row `y` of the samples and row `N - 1 - y`, for each `y`. `N` is 3 to 8, and `bias` is for the first pass.
/// `None` on other targets.
#[simd]
pub(super) fn inverse<const N: usize>(
    block: &Block,
    quant: &Block,
    bias: Sums<S>,
) -> Option<[[u8x8<S>; 2]; 4]> {
    if const { !S::WIDE } {
        return None;
    }
    let (from, steps) = (load(block), load(quant));
    let [even, odd] = array::from_fn(|i| from[i] * steps[i]);
    // Those for `y` and for `y + 1`, one in each block.
    let four_rows = |y: usize| {
        let even = weigh_four(even, bias.concat(bias), |i, row| {
            weight_of(N, y + i, [0, 4, 2, 6][row])
        });
        let odd = weigh_four(odd, Simd::zero(), |i, row| weight_of(N, y + i, 2 * row + 1));
        let rows = shift_and_pack(even + odd, even - odd, 11 + extra_bits(N)).bitcast::<i32>();
        let add_columns = |x: usize, sums: i32x16<S>| {
            if N % 2 == 1 && in_column(x) >= N {
                // Their weights are zero. Size 4 has some there.
                return sums;
            }
            let pair = rows.swizzle(|i| i / 8 * 8 + i / 4 % 2 * 2 + x / 4 * 4 + x / 2 % 2);
            let weights = i16x32::from_fn(|i| weight_of(N, i / 2 % 4, in_column(x + i % 2)));
            pair.bitcast::<i16>().dot_add_relaxed::<i32>(weights, sums)
        };
        let [even, odd] = array::map([0, 4], |x| add_columns(x + 2, add_columns(x, Simd::zero())));
        shift_and_pack(even + odd, even - odd, 18 + extra_bits(N))
    };
    let rows = left_to_right::<N, _, S>(four_rows(0), four_rows(if N > 4 { 2 } else { 0 }));
    let halves = array::map(rows.split(), |it| array::map(it.split(), |it| it.split()));
    Some(array::from_fn(|y| {
        array::map(halves[y % 2], |it| it[y / 2])
    }))
}

/// As the loop of `forward_transform`.
#[simd]
pub(super) fn forward<const MASKS: usize>(
    rows: [[u8; 8]; 8],
    divisors: &[Block; 2],
    block: &mut Block,
    masks: &mut [u64; MASKS],
) {
    let two = |a: usize, b: usize| {
        transform_rows_in(u8x32::repeat(&rows[a]).concat(u8x32::repeat(&rows[b])))
    };
    let upper = round_and_pair_up(two(0, 3), two(1, 2), 11);
    let lower = round_and_pair_up(two(7, 4), two(6, 5), 11);
    let (sums, centering) = (upper + lower, bias(CENTERING, 0).concat(Simd::zero()));
    let for_even = mask16x32::first_n(16).select(swapped(sums) + sums, swapped(sums) - sums);
    let even = |[a, b]: [usize; 2]| {
        let [a, b] = array::map([a, b], |k| [weight_of(8, 0, k), weight_of(8, 1, k)]);
        for_even.dot::<i32>(halves(a, b))
    };
    let odd = |k: [usize; 2]| {
        weigh_four(upper - lower, i32x16::zero(), |i, row| {
            weight_of(8, [0, 1, 3, 2][row], k[i])
        })
    };
    let pairs = [
        round_and_pair_up(even([0, 2]) + centering, even([4, 6]), 15),
        round_and_pair_up(odd([1, 5]), odd([3, 7]), 15),
    ];
    let (reciprocals, scales) = (load(&divisors[0]), load(&divisors[1]));
    let [first, second] = array::from_fn(|i| {
        let [levels, bits] = quantize::<MASKS, _, S>(pairs[i], reciprocals[i], scales[i]);
        levels.store(&mut block.0[32 * i..]);
        bits
    });
    let zigzag = first
        .in_blocks()
        .saturating_narrow::<i8>(second)
        .swizzle(|k| {
            let [row, column] = ZIGZAG[k];
            row / 2 % 2 * 32 + column / 4 * 16 + row / 4 * 8 + column % 4 * 2 + row % 2
        });
    *masks = array::from_fn(|i| {
        zigzag
            .any_bits(if MASKS == 1 { -1 } else { [1, 2, 4, -128][i] })
            .to_bitmask()
    });
}

#[simd]
pub(super) fn split_rows(
    rgba: [&[u8; 4 * STEP]; 2],
    luma: [&mut [u8; STEP]; 2],
    cb: &mut [u8; STEP / 2],
    cr: &mut [u8; STEP / 2],
) {
    let mut chroma = [i16x32::zero(); 2];
    unroll!(for row in 0..2 {
        let [first, second] = array::from_fn(|i| {
            split(u8x64::load(&rgba[row][64 * i..]), &mut chroma[i]).bitcast::<u8>()
        });
        first.concat_swizzle(second, |i| i % 32 * 4 + 2).split()[0].store(luma[row]);
    });
    let [left, right] = chroma[0].bitcast::<i32>().deinterleave(chroma[1].bitcast());
    let both = ((left + right).bitcast() + i16x32::repeat(&[1, 1, 2, 2])) >> 2;
    let both = both
        .bitcast::<u8>()
        .swizzle(|i| i % 16 * 4 + i / 16 % 2 * 2);
    both.block::<0>().store(cb);
    both.block::<1>().store(cr);
}
