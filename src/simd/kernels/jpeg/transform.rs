//! The transforms of JPEG, in the arithmetic of libjpeg-turbo (LICENSE.md).
use bun_simd::{Isa, Shuffle, opaque};
use core::array::from_fn;
use core::iter::zip;

pub use simd::inverse_transform;

/// Rows 0 and 4 interleaved, then 2 and 6, 1 and 3, 5 and 7. Columns go 0 2 4 6 1 3 5 7.
#[derive(Clone, Copy)]
#[repr(C, align(64))]
pub struct Block(pub [i16; 64]);

/// The bytes that a kernel may touch past what it needs of a row.
pub const ROW_SLACK: usize = 16;

/// jidctint.c and jidctred.c, multiplied out.
struct Basis<const N: usize>;

impl<const N: usize> Basis<N> {
    /// Row `i` weighs 8 coefficients for sample `i` and, the odd ones negated, for `N - 1 - i`.
    const ROWS: &[[i16; 8]] = match N {
        // The first weight is halved: 32768 does not fit in 16 bits.
        2 => &[[16384, 29692, 0, -10426, 0, 6967, 0, -5906]],
        3 => &[
            [8192, 10033, 5793, 0, 0, 0, 0, 0],
            [8192, 0, -11586, 0, 0, 0, 0, 0],
        ],
        4 => &[
            [16384, 20995, 15137, 7373, 0, -4926, -6270, -4176],
            [16384, 8697, -15137, -17799, 0, 11893, 6270, -1730],
        ],
        5 => &[
            [8192, 11019, 9372, 6810, 3580, 0, 0, 0],
            [8192, 6810, -3580, -11018, -9372, 0, 0, 0],
            [8192, 0, -11584, 0, 11584, 0, 0, 0],
        ],
        6 => &[
            [8192, 11190, 10033, 8192, 5793, 2998, 0, 0],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 0],
            [8192, 2998, -10033, -8192, 5793, 11190, 0, 0],
        ],
        7 => &[
            [8192, 11295, 10438, 9058, 7223, 5027, 2578, 0],
            [8192, 9058, 2578, -5027, -10438, -11295, -7223, 0],
            [8192, 5027, -7223, -11295, -2578, 9058, 10438, 0],
            [8192, 0, -11585, 0, 11585, 0, -11585, 0],
        ],
        8 => &[
            [8192, 11363, 10703, 9633, 8192, 6437, 4433, 2260],
            [8192, 9633, 4433, -2259, -8192, -11362, -10704, -6436],
            [8192, 6437, -4433, -11362, -8192, 2261, 10704, 9633],
            [8192, 2260, -10703, -6436, 8192, 9633, -4433, -11363],
        ],
        10 => &[
            [8192, 11443, 11019, 10322, 9373, 8192, 6810, 5260],
            [8192, 10323, 6810, 1812, -3580, -8192, -11018, -11442],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 8192],
            [8192, 5260, -6810, -11442, -3580, 8192, 11018, 1812],
            [8192, 1812, -11019, -5260, 9373, 8192, -6810, -10322],
        ],
        12 => &[
            [8192, 11487, 11190, 10703, 10033, 9192, 8192, 7053],
            [8192, 10703, 8192, 4433, 0, -4433, -8192, -10703],
            [8192, 9192, 2998, -4433, -10033, -11485, -8192, -1512],
            [8192, 7053, -2998, -10703, -10033, -1512, 8192, 11486],
            [8192, 4433, -8192, -10704, 0, 10704, 8192, -4433],
            [8192, 1513, -11190, -4433, 10033, 7053, -8192, -9191],
        ],
        14 => &[
            [8192, 11513, 11295, 10935, 10438, 9810, 9058, 8192],
            [8192, 10935, 9058, 6164, 2578, -1297, -5026, -8192],
            [8192, 9810, 5027, -1297, -7223, -10934, -11295, -8192],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 8192],
            [8192, 6164, -5027, -11512, -7223, 3826, 11295, 8192],
            [8192, 3826, -9058, -9809, 2578, 11512, 5026, -8192],
            [8192, 1297, -11295, -3826, 10438, 6164, -9058, -8192],
        ],
        _ => panic!("no such size"),
    };
    const HALF: usize = Self::ROWS.len();
    const PADDED: [[i16; 8]; 8] = from_fn(const |i| {
        if i < Self::HALF {
            Self::ROWS[i]
        } else {
            [0; 8]
        }
    });
    /// The weights are scaled by `2^(13 + EXTRA_BITS)`.
    const EXTRA_BITS: u32 = match N {
        2 => 2,
        4 => 1,
        _ => 0,
    };
}

/// Orders 4 samples and their mirrors, twice: of two rows, or the outer and the inner ones of one.
impl<const N: usize> Shuffle<32> for Basis<N> {
    const FROM: [usize; 32] = from_fn(const |i| {
        let x = i % if N <= 8 { 8 } else { 16 };
        if x >= N {
            return 32;
        }
        let (nearer, mirrored) = if 2 * x < N { (x, 0) } else { (N - 1 - x, 4) };
        i - x + nearer / 4 * 8 + nearer % 4 + mirrored
    });
}

/// The coefficient of a row that is in column `x` of a block.
const fn in_column(x: usize) -> usize {
    x % 4 * 2 + x / 4
}

const fn column_of(k: usize) -> usize {
    k % 2 * 4 + k / 2
}

/// For each coefficient in zigzag order: which row of a block it is in, and which column.
const ZIGZAG: [[usize; 2]; 64] = {
    let (mut places, mut k, mut diagonal) = ([[0; 2]; 64], 0, 0);
    while diagonal < 15 {
        let mut i = 0;
        while i <= diagonal {
            let row = if diagonal % 2 == 0 { diagonal - i } else { i };
            if row < 8 && diagonal - row < 8 {
                places[k] = [[0, 4, 2, 5, 1, 6, 3, 7][row], column_of(diagonal - row)];
                k += 1;
            }
            i += 1;
        }
        diagonal += 1;
    }
    places
};

/// From the rows of a block, packed to bytes, to one half of the zigzag order.
struct Zigzag<const HALF: usize>;

impl<const HALF: usize> Shuffle<32> for Zigzag<HALF> {
    const FROM: [usize; 32] = from_fn(const |i| {
        let [row, column] = ZIGZAG[32 * HALF + i];
        row / 4 * 32 + column / 4 * 16 + row / 2 % 2 * 8 + column % 4 * 2 + row % 2
    });
}

/// Of each 8 coefficients in zigzag order, 4 are in the first half of these rows.
const ROW_ORDER: [usize; 8] = [0, 3, 5, 6, 1, 2, 4, 7];

/// For each half of them: where its coefficients are, in zigzag order, and their bits in a byte.
const PLACES_AND_BITS: [[usize; 2]; 64] = {
    let (mut all, mut found, mut k) = ([[0; 2]; 64], [0, 32], 0);
    while k < 64 {
        let ([row, column], mut nth) = (ZIGZAG[k], 0);
        while ROW_ORDER[nth] != row {
            nth += 1;
        }
        all[found[nth / 4]] = [nth % 4 * 8 + column, 1 << (k % 8)];
        found[nth / 4] += 1;
        k += 1;
    }
    all
};

/// Fills each half with its lanes `X` and `X + 1`.
struct Columns<const X: usize>;

impl<const X: usize> Shuffle<16> for Columns<X> {
    const FROM: [usize; 16] = from_fn(const |i| i / 8 * 8 + X + i % 2);
}

struct Gather<const NTH: usize>;

impl<const NTH: usize> Shuffle<16> for Gather<NTH> {
    const FROM: [usize; 16] = from_fn(const |i| PLACES_AND_BITS[16 * NTH + i][0]);
}

/// LLVM sees that no offset in a block overflows.
#[inline(always)]
fn small(stride: usize) -> Option<usize> {
    (stride <= usize::MAX / 16).then_some(stride)
}

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::x256::{I8, I16, I32, U8};
    use isa::{Vector, x128};

    /// Two rows of 8 in an `I16` are its halves. Else they are interleaved, for `pairwise_dot`.
    const IS_PLANAR: bool = isa::Isa::HAS_INTERLEAVED_MEMORY;

    /// `first` in column 0.
    #[inline(always)]
    fn bias(first: i32, others: i32) -> I32 {
        I32::from_first(first - others) + others
    }

    #[inline(always)]
    fn load_rows(block: &Block, nth: usize) -> I16 {
        let both = I16::load(&block.0.as_chunks().0[nth]);
        if !IS_PLANAR {
            return both;
        }
        let (first, second) = both.deinterleave(both);
        I16::from_halves([first.halves()[0], second.halves()[0]])
    }

    #[inline(always)]
    fn store_rows(mut rows: I16, block: &mut Block, nth: usize) {
        if IS_PLANAR {
            let [first, second] = rows.halves();
            rows = I16::from_halves(first.interleave(second).into());
        }
        rows.store(&mut block.0.as_chunks_mut().0[nth]);
    }

    /// Adds two rows, times their weights, to `sums`.
    #[inline(always)]
    fn weigh(rows: I16, [first, second]: [i16; 2], sums: I32) -> I32 {
        if !IS_PLANAR {
            return sums + I32::pairwise_dot(rows, I16::repeat([first, second]));
        }
        let [a, b] = rows.halves();
        sums + a.widening_mul(first.into()) + b.widening_mul(second.into())
    }

    /// The same, without products if it `may_shift` and the weights are multiples of 8192.
    #[inline(always)]
    fn weigh_or_shift(rows: I16, weights: [i16; 2], sums: I32, may_shift: bool) -> I32 {
        if !may_shift || (weights[0] | weights[1]) % 8192 != 0 {
            return weigh(rows, weights, sums);
        }
        let both: I32 = rows.bitcast();
        let [a, b] = match IS_PLANAR {
            true => rows.halves().map(|row| row.cast::<i32>() << 13),
            false => [both << 16 >> 3, (both & !0xFFFF) >> 3],
        };
        sums + a * i32::from(weights[0] / 8192) + b * i32::from(weights[1] / 8192)
    }

    /// The sums have to fit in 16 bits after the shift.
    #[inline(always)]
    fn round_and_pair_up(first: I32, second: I32, shift: u32) -> I16 {
        let [first, second] = [first, second].map(|sums| sums + (1 << (shift - 1)));
        if IS_PLANAR {
            // LLVM would narrow the halves again for each use.
            return I16::from_halves([first, second].map(|it| (it >> shift).cast().opaque()));
        }
        (second << (16 - shift) & !0xFFFF | first >> shift & 0xFFFF).bitcast()
    }

    /// In the order of `pack`.
    #[inline(always)]
    fn high_halves(a: I32, b: I32) -> I16 {
        let [[a, c], [b, d]] = [a, b].map(|it| it.halves().map(|half| (half >> 16).cast()));
        I16::from_halves([[a, b], [c, d]].map(|it| x128::I16::from_halves(it).opaque()))
    }

    /// For a shift by 16 or more.
    #[inline(always)]
    fn shift_and_pack(a: I32, b: I32, shift: u32) -> I16 {
        match IS_PLANAR {
            true => high_halves(a, b) >> (shift - 16),
            false => I16::pack(a >> shift, b >> shift),
        }
    }

    /// NEON multiplies by a lane. LLVM would give each constant a register of its own.
    struct Weights<const N: usize, const IS_FORWARD: bool>([x128::I16; 8]);

    impl<const N: usize, const IS_FORWARD: bool> Weights<N, IS_FORWARD> {
        /// A vector has all columns for one sample, or two columns for 4 samples.
        const fn index_of(sample: usize, k: usize) -> usize {
            match IS_FORWARD {
                true => 8 * sample + column_of(k),
                false => sample / 4 * 32 + 4 * column_of(k) + sample % 4,
            }
        }

        const TABLE: [i16; 64] = {
            let (mut table, mut i) = ([0; 64], 0);
            while i < 64 {
                table[Self::index_of(i / 8, i % 8)] = Basis::<N>::PADDED[i / 8][i % 8];
                i += 1;
            }
            table
        };

        #[inline(always)]
        fn new() -> Self {
            Self(from_fn(|i| x128::I16::load(&Self::TABLE.as_chunks().0[i])))
        }

        /// For each turn of a loop, so that no lane and no half is taken out of it.
        #[inline(always)]
        fn hide(&mut self) {
            #[rustc_unroll(full)]
            for i in 0..if N > 8 { 8 } else { 4 } {
                if IS_PLANAR {
                    self.0[i] = self.0[i].opaque();
                }
            }
        }

        /// The weight of coefficient `k` in `sample`.
        #[inline(always)]
        fn of(&self, sample: usize, k: usize) -> i16 {
            let (weight, at) = (Basis::<N>::PADDED[sample][k], Self::index_of(sample, k));
            match IS_PLANAR && weight != 0 {
                true => self.0[at / 8][at % 8],
                false => weight,
            }
        }

        /// What the columns `X` and `X + 1` of the row in each half add to 4 samples from `FIRST` on.
        #[inline(always)]
        fn spread<const FIRST: usize, const X: usize>(&self, rows: I16, sums: I32) -> I32 {
            if !IS_PLANAR {
                let weights = const {
                    from_fn(const |i| Basis::<N>::PADDED[FIRST + i / 2 % 4][in_column(X + i % 2)])
                };
                let columns = rows.shuffle::<Columns<X>>(rows);
                return sums + I32::pairwise_dot(columns, I16::from_array(weights));
            }
            let add = |row: x128::I16, sums: x128::I32| {
                // A weight that is zero for sample 0 is zero for all.
                let term = |x: usize| match Basis::<N>::PADDED[0][in_column(x)] {
                    0 => x128::I32::zero(),
                    _ => self.0[FIRST + X / 2].widening_mul(row[x].into()).halves()[x % 2],
                };
                sums + term(X) + term(X + 1)
            };
            let ([upper, lower], [to_upper, to_lower]) = (rows.halves(), sums.halves());
            I32::from_halves([add(upper, to_upper), add(lower, to_lower)])
        }
    }

    #[inline(always)]
    fn has_only_dc(block: &Block) -> bool {
        if !IS_PLANAR {
            let [a, b, c, d] = from_fn(|i| load_rows(block, i));
            return (a & !I16::from_first(-1) | b | (c | d)).simd_eq(0).all();
        }
        // The vector units are the bottleneck.
        let mut others = 0;
        #[rustc_unroll(full)]
        for (i, row) in block.0.as_chunks().0.iter().enumerate() {
            let [a, b] = x128::I16::load(row).bitcast::<x128::U64>().to_array();
            others |= opaque(a >> if i == 0 { 16 } else { 0 }) | opaque(b);
        }
        others == 0
    }

    /// For the row in each half: 4 samples from `FIRST` on, then those that mirror them.
    #[inline(always)]
    fn across<const FIRST: usize, const N: usize>(weights: &Weights<N, false>, rows: I16) -> I16 {
        let even = weights.spread::<FIRST, 0>(rows, I32::zero());
        let even = weights.spread::<FIRST, 2>(rows, even) << u32::from(N == 2);
        let odd = weights.spread::<FIRST, 4>(rows, I32::zero());
        let odd = weights.spread::<FIRST, 6>(rows, odd);
        shift_and_pack(even + odd, even - odd, 18 + Basis::<N>::EXTRA_BITS)
    }

    #[inline(never)]
    fn inverse<const N: usize>(
        blocks: &[Block],
        quant: &Block,
        mut out: &mut [u8],
        stride: usize,
    ) -> Option<()> {
        let (half, shift) = (Basis::<N>::HALF, 11 + Basis::<N>::EXTRA_BITS);
        let (stride, piece) = (small(stride)?, if N <= 8 { 8 } else { 16 });
        let span = (N - 1) * stride + ROW_SLACK;
        // This never fails. It spares the checks in the loop.
        #[rustc_unroll(full)]
        for y in 0..N {
            assert!(y * stride + ROW_SLACK <= span);
        }
        let (weights, zero) = (&mut Weights::<N, false>::new(), I32::zero());
        let steps: [_; 4] = from_fn(|i| load_rows(quant, i));
        // Through the weight of column 0 in the second pass, 16 rounds the result and 4096 adds 128.
        let bias = bias(
            ((4096 + 16) << shift) + (1 << (shift - 1)),
            1 << (shift - 1),
        );
        let left_to_right = |a, b| U8::pack(a, b).shuffle::<Basis<N>>(U8::zero());
        // Two more products of 32 bytes in a block, and Cascade Lake lowers its clock rate.
        let saves_products = matches!(N, 6 | 8) && !IS_PLANAR && isa::U8::LEN > 16;

        for block in blocks {
            let window = out.get_mut(..span)?;
            let mut store = |y: usize, bytes: &[u8]| {
                let to = &mut window[y * stride..y * stride + ROW_SLACK][..piece];
                for (to, from) in zip(to.as_chunks_mut::<8>().0, bytes.as_chunks().0) {
                    *to = *from;
                }
            };
            // For small sizes, the check costs as much as the transform.
            if N > 4 && has_only_dc(block) {
                let mean =
                    (x128::I16::splat(block.0[0]) * quant.0[0]).mul_q15((1 << 12).into()) + 128;
                let row = x128::U8::pack(mean, mean).to_array();
                #[rustc_unroll(full)]
                for y in 0..N {
                    store(y, &row[..piece]);
                }
                // LLVM would share the last stores with those below, through general registers.
                out = &mut out[opaque(N as u64) as usize..];
                continue;
            }

            weights.hide();
            let [rows_04, rows_26, rows_13, rows_57] = from_fn(|i| load_rows(block, i) * steps[i]);
            // Row `y`, then row `N - 1 - y`.
            let mut rows = [I16::zero(); 7];
            #[rustc_unroll(full)]
            for y in 0..half {
                let (basis, other) = (Basis::<N>::PADDED, half - 1 - y);
                let of = |y, a, b| [weights.of(y, a), weights.of(y, b)];
                let for_04 = [basis[y][0], basis[y][4]];
                let from_04 = weigh_or_shift(rows_04, for_04, zero, IS_PLANAR || saves_products);
                let even = (from_04 << u32::from(N == 2)) + bias;
                // The products are there already.
                let even =
                    match other < y && [2, 6].map(|k| basis[other][k] + basis[y][k]) == [0; 2] {
                        true => even - weigh(rows_26, of(other, 2, 6), zero),
                        false => even + weigh(rows_26, of(y, 2, 6), zero),
                    };
                let odd = weigh_or_shift(rows_13, of(y, 1, 3), zero, saves_products);
                let odd = weigh_or_shift(rows_57, of(y, 5, 7), odd, saves_products);
                rows[y] = I16::saturating_narrow((even + odd) >> shift, (even - odd) >> shift);
            }

            #[rustc_unroll(full)]
            for y in 0..half {
                if N > 8 {
                    let [outer, inner] = [
                        across::<0, N>(weights, rows[y]),
                        across::<4, N>(weights, rows[y]),
                    ];
                    let [upper, lower] = left_to_right(outer, inner).halves();
                    store(y, &upper.to_array());
                    store(N - 1 - y, &lower.to_array());
                } else if y % 2 == 0 {
                    let next = (y + 1).min(half - 1);
                    let [first, second] = [
                        across::<0, N>(weights, rows[y]),
                        across::<0, N>(weights, rows[next]),
                    ];
                    let [upper, lower] = left_to_right(first, second).halves();
                    let ([a, b], [c, d]) = (upper.halves(), lower.halves());
                    store(y, &a.to_array());
                    store(N - 1 - y, &c.to_array());
                    if next > y {
                        store(next, &b.to_array());
                        store(N - 1 - next, &d.to_array());
                    }
                }
            }
            out = &mut out[N..];
        }
        Some(())
    }

    /// `size` by `size` samples for each block, until one does not fit. 2 to 8, 10, 12 or 14.
    #[export]
    #[must_use]
    pub fn inverse_transform(
        blocks: &[Block],
        quant: &Block,
        size: usize,
        out: &mut [u8],
        stride: usize,
    ) -> Option<()> {
        match size {
            2 => inverse::<2>(blocks, quant, out, stride),
            3 => inverse::<3>(blocks, quant, out, stride),
            4 => inverse::<4>(blocks, quant, out, stride),
            5 => inverse::<5>(blocks, quant, out, stride),
            6 => inverse::<6>(blocks, quant, out, stride),
            7 => inverse::<7>(blocks, quant, out, stride),
            8 => inverse::<8>(blocks, quant, out, stride),
            10 => inverse::<10>(blocks, quant, out, stride),
            12 => inverse::<12>(blocks, quant, out, stride),
            14 => inverse::<14>(blocks, quant, out, stride),
            _ => None,
        }
    }

    /// The DCT of a row: even coefficients from the sums of mirrored samples, odd ones from differences.
    #[inline(always)]
    fn transform_row(weights: &Weights<8, true>, samples: [u8; 8]) -> I32 {
        if IS_PLANAR {
            let bytes = Vector::from_array(samples);
            let (forward, backward) = (bytes.cast::<i16>(), bytes.reverse().cast());
            // LLVM would see that the sums are not negative, and widen them without a sign.
            let (sums, differences) = ((forward + backward).opaque(), forward - backward);
            let (mut even, mut odd) = (x128::I32::zero(), x128::I32::zero());
            #[rustc_unroll(full)]
            for i in 0..4 {
                even += weights.0[i].widening_mul(sums[i].into()).halves()[0];
                odd += weights.0[i].widening_mul(differences[i].into()).halves()[1];
            }
            return I32::from_halves([even, odd]);
        }
        const SIGNS: [i8; 32] = from_fn(const |i| if i >= 16 && i % 2 == 1 { -1 } else { 1 });
        const WEIGHTS: [[i16; 16]; 2] = from_fn(const |pairs| {
            from_fn(const |i| Basis::<8>::ROWS[2 * pairs + i % 2][in_column(i / 2)])
        });
        let bytes = U8::repeat(samples);
        let two_pairs = |mirrored: [u8; 4], weights| {
            let mirrored = bytes.lookup(U8::repeat(mirrored));
            let pairs = I16::saturating_pairwise_dot(mirrored, I8::from_array(SIGNS));
            I32::pairwise_dot(pairs, I16::from_array(weights))
        };
        two_pairs([0, 7, 1, 6], WEIGHTS[0]) + two_pairs([2, 5, 3, 4], WEIGHTS[1])
    }

    /// One mask of the lanes that are not zero, or one each for the bits 0, 1, 2 and 7.
    #[inline(always)]
    fn masks_of<const MASKS: usize>(rows: &[I16; 4]) -> [u64; MASKS] {
        let bits = |plane: usize| {
            if MASKS == 1 {
                0xFF
            } else {
                [1, 2, 4, 0x80][plane]
            }
        };
        let mut masks = [0; MASKS];
        if !IS_PLANAR {
            let [a, b]: [U8; 2] = from_fn(|i| I8::pack(rows[2 * i], rows[2 * i + 1]).bitcast());
            let (first, second) = (a.shuffle::<Zigzag<0>>(b), a.shuffle::<Zigzag<1>>(b));
            #[rustc_unroll(full)]
            for plane in 0..MASKS {
                let mask = |v: U8| (v & bits(plane)).simd_ne(0).to_bitmask();
                masks[plane] = mask(first) | mask(second) << 32;
            }
            return masks;
        }
        const OWN_BITS: [u8; 64] = from_fn(const |i| PLACES_AND_BITS[i][1] as u8);
        let row = |i: usize| rows[ROW_ORDER[i] / 2].halves()[ROW_ORDER[i] % 2];
        let pack = |i| x128::I8::pack(row(i), row(i + 1)).bitcast::<x128::U8>();
        let [a, b, c, d] = [pack(0), pack(2), pack(4), pack(6)];
        let gathered = [
            a.shuffle::<Gather<0>>(b),
            a.shuffle::<Gather<1>>(b),
            c.shuffle::<Gather<2>>(d),
            c.shuffle::<Gather<3>>(d),
        ];
        let add_pairs = |a: x128::U8, b| a.deinterleave(b).0 + a.deinterleave(b).1;
        #[rustc_unroll(full)]
        for plane in 0..MASKS {
            let bit = x128::U8::splat(bits(plane)).opaque();
            let has = |i: usize| (gathered[i] & bit).simd_ne(0).to_vector();
            let own = |i: usize| x128::U8::from_slice(&OWN_BITS[16 * i..]);
            let set = |i| (has(i) & own(i) | has(i + 2) & !own(i)).opaque() & (own(i) | own(i + 2));
            let pairs = add_pairs(set(0), set(1));
            masks[plane] = add_pairs(pairs, pairs).bitcast::<x128::U64>()[0];
        }
        masks
    }

    #[inline(never)]
    fn forward<const MASKS: usize>(
        mut samples: &[u8],
        stride: usize,
        [reciprocals, scales]: &[Block; 2],
        blocks: &mut [Block],
        masks: &mut [[u64; MASKS]],
    ) -> Option<()> {
        let stride = small(stride).filter(|_| blocks.len() == masks.len())?;
        // Subtracting 128 from each sample changes only coefficient 0.
        let centering = bias(-((64 * 128) << 15), 0);
        let (weights, zero) = (&mut Weights::<8, true>::new(), I32::zero());

        for (block, masks) in blocks.iter_mut().zip(masks) {
            let window = samples.get(..7 * stride + 8)?;
            samples = &samples[8..];
            let row = |y: usize| window[y * stride..].first_chunk().unwrap();
            let [a, b, c, d] = [row(0), row(1), row(2), row(3)];
            let [e, f, g, h] = [row(4), row(5), row(6), row(7)];
            weights.hide();
            let mut rows = [I16::zero(); 4];
            #[rustc_unroll(full)]
            for i in 0..4 {
                let [first, second] = [[a, b], [h, g], [d, c], [e, f]][i];
                let first = transform_row(weights, *first);
                rows[i] = round_and_pair_up(first, transform_row(weights, *second), 11);
            }
            let [rows_01, rows_76, rows_32, rows_45] = rows;
            let (sums_01, sums_32) = (rows_01 + rows_76, rows_32 + rows_45);
            let (less_01, less_32) = (rows_01 - rows_76, rows_32 - rows_45);
            let (for_04, for_26) = (sums_01 + sums_32, sums_01 - sums_32);
            let of = |a, b, k| [weights.of(a, k), weights.of(b, k)];
            let even = |k| weigh(for_26, of(0, 1, k), zero);
            let odd = |k| weigh(less_32, of(3, 2, k), weigh(less_01, of(0, 1, k), zero));
            let [row_0, row_4] =
                [8192, -8192].map(|it| weigh_or_shift(for_04, [8192, it], zero, IS_PLANAR));
            rows = [
                round_and_pair_up(row_0 + centering, row_4, 15),
                round_and_pair_up(even(2), even(6), 15),
                round_and_pair_up(odd(1), odd(3), 15),
                round_and_pair_up(odd(5), odd(7), 15),
            ];
            #[rustc_unroll(full)]
            for i in 0..4 {
                let sign = rows[i] >> 15;
                // One less if negative, so that halves round away from 0.
                let doubled = rows[i] + rows[i] + sign;
                let by = |factors| load_rows(factors, i);
                rows[i] = doubled.mul_q15(by(reciprocals)).mul_q15(by(scales));
                store_rows(rows[i], block, i);
                if MASKS == 4 {
                    let magnitude = rows[i].abs();
                    rows[i] = magnitude.simd_min(magnitude & 3 | 4) | sign & -128;
                }
            }
            *masks = masks_of(&rows);
        }
        Some(())
    }

    #[export]
    pub fn forward_transform(
        samples: &[u8],
        stride: usize,
        divisors: &[Block; 2],
        blocks: &mut [Block],
        masks: &mut [u64],
        has_bit_planes: bool,
    ) -> Option<()> {
        match has_bit_planes {
            true => forward::<4>(samples, stride, divisors, blocks, masks.as_chunks_mut().0),
            false => forward::<1>(samples, stride, divisors, blocks, masks.as_chunks_mut().0),
        }
    }
}

/// Fills `blocks` from 8 rows that are `stride` bytes apart, until there are too few samples.
#[inline(always)]
#[must_use]
pub fn forward_transform<const MASKS: usize>(
    samples: &[u8],
    stride: usize,
    // `c` becomes `(2 * c - (c < 0)) * divisors[0] / 2^15 * divisors[1] / 2^15`, rounded after each division.
    divisors: &[Block; 2],
    blocks: &mut [Block],
    // In zigzag order: not zero or, in four masks, magnitude bit 0, bit 1, higher bits, and `c < 0` undivided.
    masks: &mut [[u64; MASKS]],
) -> Option<()> {
    const { assert!(MASKS == 1 || MASKS == 4) };
    let masks = masks.as_flattened_mut();
    simd::forward_transform(samples, stride, divisors, blocks, masks, MASKS == 4)
}
