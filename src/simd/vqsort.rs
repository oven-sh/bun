//! A vectorized quicksort, after the design of `hwy/contrib/sort` (vqsort).

use crate::access::InPage;
use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::Raw;
use crate::{Aligned, B2, B4, B8, B16, B32, B64, Int, Isa, Lane, MaskOf, Scaled, Simd, Tag, Width, kernel, simd};
use core::{cell::Cell, hint::select_unpredictable as select};

/// For each mask of eight lanes: the lanes whose bits are set, and then the others.
static PARTITION: Aligned<[[u8; 8]; 256]> = Aligned(crate::swizzle::order());
/// The same for the bytes of the lanes in 16 bytes.
static PARTITION_8: Aligned<[[u8; 16]; 256]> = Aligned(crate::swizzle::order());
static PARTITION_4: Aligned<[[u8; 16]; 16]> = Aligned(crate::swizzle::order());
/// And for the halves of four lanes of 64 bits.
#[cfg(any(target_arch = "x86", target_arch = "x86_64", bun_simd_all_branches))]
static PAIRS: Aligned<[[u32; 8]; 16]> = Aligned({
    let (mut all, bytes, mut i) = ([[0; 8]; 16], crate::swizzle::order::<8, 16>(), 0);
    while i < 128 {
        (all[i / 8][i % 8], i) = (bytes[i / 8][i % 8] as u32, i + 1);
    }
    all
});

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// In groups of `N / ROWS` lanes.
    #[op]
    fn reverse_groups<const N: usize, const ROWS: usize>(self) -> Self {
        macro_rules! of { ($($k:literal)*) => { match const { N / ROWS } {
            $($k => Simd::new(self.s, self.raw.shuffle::<_, { p::REVERSE_GROUPS }, $k>(self.raw)),)*
            _ => self,
        } }; }
        of!(2 4 8 16 32 64)
    }
}

/// A loop that is unrolled at any level of optimization.
macro_rules! each_row {
    ($r:ident => $body:expr) => { each_row!($r, $body; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15) };
    ($r:ident, $body:expr; $($i:literal)*) => {{ $(if const { $i < ROWS } { const $r: usize = $i; $body })* }};
}

#[op]
fn lower<S: Isa, K: Lane, W: Width>(d: Tag<S, K, W>, distance: usize) -> MaskOf<K, W, S> {
    let d = d.to_signed();
    (d.iota(Default::default()) & d.set(Lane::from_usize(distance))).simd_eq(d.zero()).retype()
}

/// The lesser where `first` is true and the greater elsewhere, and then the other ones.
#[op]
fn order<const XOR: bool, S: Isa, K: Lane, W: Width>(
    first: MaskOf<K, W, S>,
    a: Simd<K, W, S>,
    b: Simd<K, W, S>,
) -> (Simd<K, W, S>, Simd<K, W, S>) {
    return_if!(S::AVX512F && K::BITS == 64, |first: MaskOf<K, W, S> = first, a: Simd<K, W, S> = a, b: Simd<K, W, S> = b| ordered::<XOR, _, _, _>(first, a, b));
    apart!(a.s, ordered::<XOR, _, _, _>(first, a, b))
}
#[inline(always)]
fn ordered<const XOR: bool, S: Isa, K: Lane, W: Width>(
    first: MaskOf<K, W, S>,
    a: Simd<K, W, S>,
    b: Simd<K, W, S>,
) -> (Simd<K, W, S>, Simd<K, W, S>) {
    apart_unoptimized!(a.s, {
        return_if!(K::IS_FLOAT, {
            let (min, max) = (a.simd_min_relaxed(b), a.simd_max_relaxed(b));
            (first.if_then_else(min, max), first.if_then_else(max, min))
        });
        return_if!(K::BITS == 64 && !S::AVX512F, {
            let keep = a.simd_gt(b) ^ first;
            (keep.if_then_else(a, b), keep.if_then_else(b, a))
        });
        let min = a.simd_min(b);
        let max = choose! { K::BITS == 64 && !S::AVX512VBMI2 => a ^ b ^ min, _ => a.simd_max(b) };
        let one = first.if_then_else(min, max);
        // Intel has one port for the minimum and the maximum of 64 bytes, or of 64 bits. For smaller lanes, this is slower on Zen 4 and 5, so `short` asks.
        let by_xor = const { XOR || S::AVX512F && (K::BITS == 64 || W::BYTES == 64 && !S::AVX512VBMI2) };
        (one, if by_xor { a ^ b ^ one } else { first.if_then_else(max, min) })
    })
}

// The time that rustc takes for a function is more than linear in its size, so each part of the network is one.
// Without optimization, their frames would add up to more than a megabyte.
#[inline(always)]
#[allow(clippy::ineffective_bit_mask, reason = "it doesn't know `FLIP`")]
fn exchange<const XOR: bool, S: Isa, K: Lane, W: Width, const ROWS: usize, const FLIP: usize>(
    v: &mut [Simd<K, W, S>; ROWS],
) {
    apart!(v[0].s, |v: &mut [Simd<K, W, S>; ROWS]| {
        each_row!(R => if const { R < R ^ FLIP } {
            let (a, b) = (v[R], v[R ^ FLIP]);
            (v[R], v[R ^ FLIP]) = if crate::X86 || K::IS_FLOAT { order::<XOR, _, _, _>(a.tag().mask_true(), a, b) } else { (a.simd_min(b), a.simd_max(b)) };
        });
    })
}

/// The same. Digit `r` is the row that meets row `r`.
#[inline(always)]
fn meet<const XOR: bool, S: Isa, K: Lane, W: Width, const ROWS: usize, const OTHERS: u64>(
    v: &mut [Simd<K, W, S>; ROWS],
) {
    apart!(v[0].s, |v: &mut [Simd<K, W, S>; ROWS]| {
        each_row!(R => if const { R < (OTHERS >> (4 * R)) as usize % 16 } {
            let other = const { (OTHERS >> (4 * R)) as usize % ROWS };
            let (a, b) = (v[R], v[other]);
            (v[R], v[other]) = if crate::X86 || K::IS_FLOAT { order::<XOR, _, _, _>(a.tag().mask_true(), a, b) } else { (a.simd_min(b), a.simd_max(b)) };
        });
    })
}
/// Those of Batcher, and that of Green for 16. None is known with fewer comparisons.
macro_rules! columns { ($then:ident) => { $then! {
    2: 0x01; 4: 0x1032 0x2301 0x3120; 8: 0x6745_2301 0x5476_1032 0x3560_7124 0x7214_3650 0x7632_5410 0x7563_4120;
    16: 0xefcd_ab89_6745_2301 0xdcfe_98ba_5476_1032 0xba98_fedc_3210_7654 0x7654_3210_fedc_ba98 0xfde3_7564_b9a8_c120
        0xfb7c_e9a2_d561_3840 0xfeb7_da93_c652_8410 0xfeda_bc76_9834_5210 0xfedb_c9a7_8563_4210 0xfedc_ba89_6754_3210;
} }; }

#[inline(always)]
fn step<const XOR: bool, S: Isa, K: Lane, W: Width, const ROWS: usize, const DISTANCE: usize, const TWICE: usize>(
    v: &mut [Simd<K, W, S>; ROWS],
) {
    apart!(v[0].s, |v: &mut [Simd<K, W, S>; ROWS]| {
        return_if!(DISTANCE < ROWS, exchange::<XOR, S, K, W, ROWS, DISTANCE>(v));
        let first = lower(v[0].tag(), DISTANCE / ROWS);
        each_row!(R => {
            let other = v[R].reverse_groups::<TWICE, ROWS>().reverse_groups::<DISTANCE, ROWS>();
            v[R] = order::<XOR, _, _, _>(first, v[R], other).0;
        });
    })
}

#[inline(always)]
fn stage<const XOR: bool, S: Isa, K: Lane, W: Width, const ROWS: usize, const SIZE: usize>(
    v: &mut [Simd<K, W, S>; ROWS],
) {
    apart!(v[0].s, |v: &mut [Simd<K, W, S>; ROWS]| {
        let first = lower(v[0].tag(), SIZE / ROWS / 2);
        each_row!(R => if const { 2 * R < ROWS } {
            let (a, b) = order::<XOR, _, _, _>(first, v[R], v[ROWS - 1 - R].reverse_groups::<SIZE, ROWS>());
            (v[R], v[ROWS - 1 - R]) = (a, b.reverse_groups::<SIZE, ROWS>());
        });
        macro_rules! steps { ($($distance:literal)*) => {$(
            when!(2 * $distance < SIZE, { step::<XOR, S, K, W, ROWS, $distance, { 2 * $distance }>(v); });
        )*}; }
        steps!(128 64 32 16 8 4 2 1);
    })
}

/// The lanes that one instruction interleaves.
const fn reach<S: Isa, K, W: Width>() -> usize {
    (if S::AVX2 && !S::AVX512VL && W::BYTES == 32 { 16 } else { W::BYTES }) / size_of::<K>()
}
/// A bit of the number of the row becomes the lowest of that of the lane, whose highest takes its place. With `HALVES`, these two change places.
#[inline(always)]
fn turn<S: Isa, K: Lane, W: Width, const ROWS: usize, const BIT: usize, const HALVES: bool>(
    v: &mut [Simd<K, W, S>; ROWS],
) {
    apart!(v[0].s, |v: &mut [Simd<K, W, S>; ROWS]| {
        each_row!(R => if const { R / BIT % 2 == 0 } {
            let (a, b) = (v[R], v[R | BIT]);
            (v[R], v[R | BIT]) = choose! {
                HALVES => (a.tag().concat_lower_lower(b, a), a.tag().concat_upper_upper(b, a)),
                reach::<S, K, W>() < Tag::<S, K, W>::LANES => (a.interleave_lower(b), a.interleave_upper(b)),
                _ => (a.interleave_whole_lower(b), a.interleave_whole_upper(b)),
            };
        });
    })
}

/// After that, the bits of the number of a row below this one are the highest.
const fn high<S: Isa, K, W: Width>(rows: usize) -> usize {
    let lanes = W::BYTES / size_of::<K>();
    if rows >= lanes {
        lanes
    } else if rows > 1 {
        lanes / reach::<S, K, W>()
    } else {
        1
    }
}

/// A network for up to 512 values: for the columns, and then bitonic. Before the transposition at the end, the order is down the first lanes, then the second ones.
#[op]
fn network<const XOR: bool, S: Isa, K: Lane, W: Width, const ROWS: usize>(v: &mut [Simd<K, W, S>; ROWS]) {
    macro_rules! sorted { ($($rows:literal: $($others:literal)*;)*) => {$(when!($rows == ROWS, { $(meet::<XOR, S, K, W, ROWS, $others>(v);)* });)*}; }
    columns!(sorted);
    macro_rules! stages { ($($size:literal)*) => {$(
        when!(ROWS < $size && $size <= ROWS * Tag::<S, K, W>::LANES, { stage::<XOR, S, K, W, ROWS, $size>(v); });
    )*}; }
    stages!(2 4 8 16 32 64 128 256 512);
    macro_rules! rounds { ($($bit:literal)*) => {
        $(when!($bit < ROWS && $bit < reach::<S, K, W>(), { turn::<S, K, W, ROWS, $bit, false>(v); });)*
        $(when!($bit < ROWS && 2 * $bit == high::<S, K, W>(ROWS) && reach::<S, K, W>() < Tag::<S, K, W>::LANES, { turn::<S, K, W, ROWS, $bit, true>(v); });)*
    }; }
    rounds!(8 4 2 1);
    let before = *v;
    each_row!(R => v[const { let high = high::<S, K, W>(ROWS); R / high + R % high * (ROWS / high) }] = before[R]);
}

/// Unsigned comparisons of 64 bits take more instructions before AVX-512.
const fn flips<S: Isa, T: Lane>() -> bool {
    matches!(T::KIND, Kind::Unsigned) && T::BITS == 64 && crate::X86 && S::REGISTER < 64
}

/// From the bits of a `T` to an integer in the same order, and back.
#[op]
fn key<S: Isa, T: Lane, K: Int, W: Width>(v: Simd<K, W, S>) -> Simd<K, W, S> {
    choose! {
        flips::<S, T>() => v ^ K::MIN,
        matches!(T::KIND, Kind::Float) => v ^ (v.cast_signed().broadcast_sign_bit().bitcast::<K>() & K::MAX),
        _ => v,
    }
}

static ONES: InPage<[u8; 128]> = InPage({
    let mut all = [0; 128];
    *all.first_chunk_mut().unwrap() = [!0; 64];
    all
});

#[simd]
#[inline(never)]
/// For more than half of `ROWS` vectors. What would reach past the end is moved back, which takes no branch.
fn rows<const XOR: bool, S: Isa, T: Lane, K: Int, W: Width, const ROWS: usize>(s: S, values: &mut [T]) {
    let (d, k) = (s.fixed::<T, W>(), s.fixed::<K, W>());
    let (n, mut v) = (d.lanes(), [k.zero(); ROWS]);
    assert!(values.len() >= ROWS / 2 * n);
    let last = values.len() - n;
    return_if!(
        (S::SSE2 || S::A64 && T::IS_FLOAT)
            && !S::AVX512F
            && K::BITS == 64
            && ROWS > 2
            && (T::IS_FLOAT || !S::SSE42 || ROWS * W::BYTES >= 128),
        rows_as_floats::<S, T, K, W, ROWS>(s, values)
    );
    each_row!(R => {
        let r = R;
        let at = if r < ROWS / 2 { r * n } else { (r * n).min(last) };
        let (seen, keys) = (k.first_n(r * n - at), key::<S, T, K, W>(d.load(&values[at..]).bitcast()));
        v[r] = if r < ROWS / 2 {
            keys
        } else if K::KIND == Kind::Unsigned && W::BYTES == 64 {
            // LLVM makes 64 bytes of ones by an instruction that waits for what was in the register.
            keys | s.fixed::<u8, W>().load(&ONES.0[64 - (r * n - at).min(n) * size_of::<T>()..]).bitcast()
        } else {
            seen.if_then_else(K::MAX, keys)
        };
    });
    network::<XOR, S, K, W, ROWS>(&mut v);
    each_row!(R => {
        let r = ROWS - 1 - R;
        let (at, v) = (if r < ROWS / 2 { r * n } else { (r * n).min(last) }, key::<S, T, K, W>(v[r]));
        (if r < ROWS / 2 { v } else { v.rotate_elements_right_dyn(r * n - at) }).bitcast().store(&mut values[at..]);
    });
}

/// Before AVX-512 and SVE, only floats have a minimum of 64 bits. So an integer becomes the normal number that has its place in their order, if there is one.
#[op]
fn rows_as_floats<S: Isa, T: Lane, K: Int, W: Width, const ROWS: usize>(s: S, values: &mut [T]) {
    const NORMAL: i64 = 1 << 52;
    let (d, k) = (s.fixed::<T, W>(), s.fixed::<i64, W>());
    let (n, mut v, mut odd) = (
        d.lanes(),
        [s.fixed::<f64, W>().zero(); ROWS],
        [s.fixed::<f64, W>().set(if T::IS_FLOAT { 0.0 } else { -0.0 }); 2],
    );
    let last = values.len() - n;
    // Away from the end that is nearer to the first value. What wraps has no place.
    let flip = if const { flips::<S, T>() } { i64::MIN } else { 0 };
    let bias = k.set(flip ^ if bits::<T, i64>(&values[0]) ^ flip < 0 { 2 * NORMAL } else { -2 * NORMAL });
    each_row!(R => {
        let at = if R < ROWS / 2 { R * n } else { (R * n).min(last) };
        let it = d.load(&values[at..]).bitcast::<i64>();
        let it = choose! {
            T::IS_FLOAT => {
                // NaN has no order, and only 0.0 may be equal to zero.
                let ordered = choose! {
                    S::A64 => it.with_bytes(s.abs_greater::<W>(it.bytes(), k.zero().bytes(), 64)),
                    _ => it.bitcast::<f64>().abs().simd_gt(0.0).to_vector(),
                };
                odd[R % 2] = (odd[R % 2].bitcast() | ordered.and_not(it)).bitcast();
                it.bitcast()
            },
            _ => {
                let it = it + bias;
                let size = (it ^ it.broadcast_sign_bit()).bitcast::<i16>().saturating_add(k.set(NORMAL).bitcast());
                odd[R % 2] = size.simd_max(odd[R % 2].bitcast()).bitcast();
                (size.bitcast() | it & i64::MIN).bitcast()
            },
        };
        v[R] = if R < ROWS / 2 { it } else { k.first_n(R * n - at).if_then_else(f64::INFINITY, it) };
    });
    if choose! { T::IS_FLOAT => !(odd[0].bitcast::<i64>() | odd[1].bitcast()).is_zero(), _ => !(odd[0].simd_lt(f64::INFINITY) & odd[1].simd_lt(f64::INFINITY)).all() }
    {
        return rarely::<S, T, K>(s, values);
    }
    network::<false, S, f64, W, ROWS>(&mut v);
    let (up, down) = (bias + NORMAL, k.set(i64::MAX.wrapping_add(NORMAL)) - bias);
    each_row!(R => {
        let r = ROWS - 1 - R;
        let (at, it) = (if r < ROWS / 2 { r * n } else { (r * n).min(last) }, v[r].bitcast::<i64>());
        let it = choose! { T::IS_FLOAT => it, _ => it.is_negative().if_then_else(down - it, it - up) };
        (if r < ROWS / 2 { it } else { it.rotate_elements_right_dyn(r * n - at) }).bitcast().store(&mut values[at..]);
    });
}
#[simd]
#[cold]
#[inline(never)]
fn rarely<S: Isa, T: Lane, K: Int>(s: S, values: &mut [T]) {
    by_keys::<S, T, K, false>(s, values, (0, 0))
}

/// The lower `64 - i` bits.
static LOWER: [u64; 65] = {
    let (mut all, mut i) = ([0; 65], 0);
    while i < 64 {
        (all[i], i) = (!0 >> i, i + 1);
    }
    all
};

/// The lanes whose bits are set, and then the others. For up to eight.
#[op]
fn both_sides<S: Isa, T: Lane, W: Width>(v: Simd<T, W, S>, bits: u64) -> Simd<T, W, S> {
    let bytes = v.tag().repartition::<u8>();
    choose! {
        W::BYTES == 16 && size_of::<T>() == 4 => v.move_by_row(bytes.load(&PARTITION_4[bits as usize & 15])),
        W::BYTES == 16 && size_of::<T>() == 2 => v.move_by_row(bytes.load(&PARTITION_8[bits as u8 as usize])),
        S::AVX2 && S::REGISTER == 32 && W::BYTES == 32 && size_of::<T>() == 8 => v.bitcast::<u32>().swizzle_wrapping(v.tag().repartition().load(&PAIRS[bits as usize & 15])).bitcast(),
        _ => {
            let indices = v.s.fixed::<u8, B8>().load(&PARTITION[bits as u8 as usize]);
            v.swizzle_dyn_relaxed(Simd::new(v.s, crate::raw::Raw::cast(indices.raw)))
        }
    }
}

/// Writes the lanes of `left` to `a` at `*low`, and the others to `b` before `*high`. There is room for a vector at both,
/// and with `PAST`, `b` has a vector after `*high`.
#[op]
fn split<const PAST: bool, S: Isa, T: Lane, W: Width>(
    v: Simd<T, W, S>,
    left: MaskOf<T, W, S>,
    all: u64,
    (a, low): (&mut [T], &mut usize),
    (b, high): (&mut [T], &mut usize),
) {
    let (d, n) = (v.tag(), v.tag().lanes());
    return_if!(W::BYTES > 8 * size_of::<T>() && W::BYTES > S::COMPRESS[size_of::<T>().ilog2() as usize], {
        split::<PAST, _, _, _>(v.lower_half(), left.lower_half(), all, (&mut *a, &mut *low), (&mut *b, &mut *high));
        split::<PAST, _, _, _>(v.upper_half(), left.upper_half(), all, (a, low), (b, high))
    });
    let (bits, count) = choose! {
        S::ARM && W::BYTES == 16 && size_of::<T>() == 4 => {
        let both = (left.to_vector().reinterpret() & d.repartition::<u32>().dup128([17, 18, 20, 24])).reduce_sum();
        (both as u64 & 15, (both as usize >> 4).min(4))
    },
        S::ARM && W::BYTES == 16 && size_of::<T>() == 2 => {
        let weights = d.repartition::<u16>().dup128([257, 258, 260, 264, 272, 288, 320, 384]);
        let both = (left.to_vector().reinterpret() & weights).reduce_sum();
        (both as u64 & 255, (both as usize >> 8).min(8))
    },
        _ => {
        let bits = left.own_bits() & (!0 >> (64 - n));
        (bits, bits.count_ones() as usize)
    }
    };
    if n > 8 {
        v.compress_own(bits).store(&mut a[*low..]);
        if PAST {
            // A mask from memory doesn't take the port that is busiest.
            v.compress_own(bits ^ all)
                .blended_store(d.mask_from_bits(LOWER[64 - n + count]), &mut b[*high - n + count..]);
        } else {
            v.compress_own(!bits).store_n(&mut b[*high - (n - count)..*high]);
        }
    } else {
        let both = both_sides(v, bits);
        both.store(&mut a[*low..]);
        both.store_last(&mut b[..*high]);
    }
    *low += count;
    *high -= n - count;
}

#[op]
fn bits<T: Lane, K: Int>(value: &T) -> K {
    K::from_u64(T::unsigned(core::slice::from_ref(value))[0].to_u64())
}

/// A value in all lanes. The x87 changes signaling NaNs, so it doesn't go as a float.
#[op]
fn splat<S: Isa, T: Lane>(s: S, values: &[T], at: usize) -> Simd<T, S::Native, S> {
    s.full::<T::Unsigned>().set(T::unsigned(values)[at]).bitcast()
}

#[inline(never)]
fn scalar<T: Lane, K: Int>(values: &mut [T]) {
    values.sort_unstable_by_key(bits::<T, K>)
}

#[inline(never)]
fn scalar_part<T: Lane, K: Int>(values: &mut [T], (from, to): (usize, usize)) {
    let key = bits::<T, K>;
    let before = values.select_nth_unstable_by_key(to - 1, key).0;
    if from < before.len() {
        scalar::<T, K>(before.select_nth_unstable_by_key(from, key).2)
    }
}

/// The same as `partition`, which is slower with two lanes.
#[op]
fn one_by_one<T: Lane, K: Int>(values: &mut [T], bound: K) -> usize {
    let flip = if T::IS_FLOAT && bound < K::default() { K::MAX } else { K::default() };
    let (cells, mut low) = (Cell::from_mut(T::unsigned_mut(values)).as_slice_of_cells(), 0);
    let swap = always!(|from: &Cell<T::Unsigned>, to: &Cell<T::Unsigned>| {
        let it = from.replace(to.get());
        to.set(it);
        (K::from_u64(it.to_u64()) ^ flip < bound) as usize
    });
    let (fours, rest) = cells.as_chunks::<4>();
    for [a, b, c, d] in fours {
        let to = &cells[low..][..4];
        let mut more = swap(a, &to[0]);
        more += swap(b, &to[more]);
        more += swap(c, &to[more]);
        low += more + swap(d, &to[more]);
    }
    for it in rest {
        low += swap(it, &cells[low]);
    }
    low
}

const UNROLL: usize = 4;

#[simd]
#[inline(never)]
/// Moves what is less than `bound`, which is not the least key, to the front, and returns how much that is.
fn partition<S: Isa, T: Lane, K: Int>(s: S, values: &mut [T], bound: K) -> usize {
    let (d, k) = (s.full::<T>(), s.full::<K>());
    return_if!(
        S::Native::BYTES == 2 * size_of::<T>(),
        choose! {
            flips::<S, T>() => one_by_one(values, (bound ^ K::MIN).to_u64()),
            _ => one_by_one(values, bound),
        }
    );
    // Before AVX-512, this takes a step less.
    let or_equal = const { crate::X86 && S::REGISTER < 64 && !K::IS_SIGNED };
    // One side of zero is enough to find what is less.
    let (bound, flip) = (
        k.set(bound - K::from_usize(or_equal as usize)),
        k.set(if const { flips::<S, T>() } {
            K::MIN
        } else if T::KIND == Kind::Float && bound < K::default() {
            K::MAX
        } else {
            K::default()
        }),
    );
    let less = always!(|v: Simd<T, S::Native, S>| {
        let v = v.bitcast::<K>() ^ flip;
        if or_equal { v.simd_le(bound) } else { v.simd_lt(bound) }.retype()
    });
    let (n, step) = (d.lanes(), UNROLL * d.lanes());
    macro_rules! load {
        ($from:expr) => {{
            let from: &[T] = $from;
            [d.load(from), d.load(&from[n..]), d.load(&from[2 * n..]), d.load(&from[3 * n..])]
        }};
    }
    // If LLVM knew that all bits are set, it would compare twice.
    let all = if n > 8 { core::hint::black_box(!0) } else { !0 };
    // The bounds are checked once for all of these vectors.
    macro_rules! split { ($past:literal, $low:ident, $high:ident, $room:expr, $($v:expr),*) => {{
        let (a, b) = values[..$high + if $past { n } else { 0 }].split_at_mut($high - $room);
        let (a, mut i, mut j) = (&mut a[$low..][..$room], 0, $room);
        $(split::<$past, _, _, _>($v, less($v), all, (&mut *a, &mut i), (&mut *b, &mut j));)*
        ($low, $high) = ($low + i, $high - $room + j);
    }}; }
    let (mut low, mut high) = (0, values.len());
    let (mut first, last) = (load!(&values[..step]), load!(&values[high - step..]));
    let (mut left, mut right) = (step, high - step);
    while right - left >= step {
        let at = if left - low <= high - right {
            left += step;
            left - step
        } else {
            right -= step;
            right
        };
        // What was loaded before, so that the next choice doesn't wait for this load.
        let [a, b, c, d] = {
            let next = load!(&values[at..at + step]);
            core::mem::replace(&mut first, next)
        };
        if n > 8 && values.len() - high >= n {
            split!(true, low, high, step, a, b, c, d)
        } else {
            split!(false, low, high, step, a, b, c, d)
        }
    }
    while right - left >= n {
        let at;
        (at, left, right) = select(left - low <= high - right, (left, left + n, right), (right - n, left, right - n));
        let v = d.load(&values[at..]);
        split!(false, low, high, n, v);
    }
    // The lanes after the rest count for neither side.
    let (rest, v) = (right - left, d.load(&values[left..]));
    let some = less(v) & d.first_n(rest);
    let more = some.and_not(d.first_n(rest));
    low += v.compress_mask_store(some, &mut values[low..]);
    let count = more.count();
    choose! {
        S::Native::BYTES <= 8 * size_of::<T>() => both_sides(v, (!more).own_bits() & !(!0 << n)).store_last(&mut values[..high]),
        _ => v.compress_mask(more).store_n(&mut values[high - count..high]),
    }
    high -= count;
    // Each time, half of the room is on either side.
    split!(false, low, high, step, first[0], first[1], first[2], first[3]);
    split!(false, low, high, 2 * n, last[0], last[1]);
    split!(false, low, high, n, last[2]);
    let (v, less) = (last[3], less(last[3]));
    let count = less.count();
    choose! {
        S::Native::BYTES <= 8 * size_of::<T>() => both_sides(v, less.own_bits() & !(!0 << n)).store(&mut values[low..high]),
        _ => {
            v.compress_mask(less).store(&mut values[low..high]);
            v.compress_mask(!less).store_n(&mut values[low + count..high]);
        },
    }
    low + count
}

// Without optimization, these had 200 KB of stack in each call of `quicksort`.
#[cfg_attr(any(not(debug_assertions), bun_simd_check), inline(always))]
#[cfg_attr(all(debug_assertions, not(bun_simd_check)), inline)]
fn by_keys<S: Isa, T: Lane, K: Int, const PART: bool>(s: S, values: &mut [T], want: (usize, usize)) {
    return_if!(
        crate::X86 && flips::<S, T>(),
        if PART { scalar_part::<T, u64>(values, want) } else { scalar::<T, u64>(values) }
    );
    // A key can look like a signaling NaN, which the x87 changes.
    let values = T::unsigned_mut(values);
    let keys = always!(|values: &mut [T::Unsigned]| {
        if const { matches!(T::KIND, Kind::Float) } {
            live!(
                matches!(T::KIND, Kind::Float),
                s.full::<T::Unsigned>().transform_in_place(
                    values,
                    #[inline(always)]
                    |v| key::<S, T, K, _>(v.bitcast()).bitcast()
                )
            )
        }
    });
    keys(values);
    if PART {
        scalar_part::<_, K>(values, want)
    } else {
        scalar::<_, K>(values)
    }
    keys(values)
}
/// A bound that leaves neither side empty, and the key of the sample if it has only one. Nothing if all values are equal. The sample leaves out `skip` values at both ends.
#[cfg_attr(any(not(debug_assertions), bun_simd_check), inline(always))]
#[cfg_attr(all(debug_assertions, not(bun_simd_check)), inline)]
fn sample<S: Isa, T: Lane, K: Int>(s: S, values: &[T], skip: usize) -> Option<(K, Option<K>)> {
    let (d, n, middle) = (s.full::<T>(), s.full::<T>().lanes(), &values[skip..values.len() - skip]);
    let stride = (middle.len() - n) / 8;
    macro_rules! at {
        ($i:expr) => {
            key::<S, T, K, _>(d.load(&middle[$i * stride..]).bitcast())
        };
    }
    macro_rules! median {
        ($a:expr, $b:expr, $c:expr) => {{
            let (a, b) = ($a, $b);
            a.simd_min(b).simd_max(a.simd_max(b).simd_min($c))
        }};
    }
    let mut sample =
        [median!(at!(0), at!(3), at!(6)), median!(at!(1), at!(4), at!(7)), median!(at!(2), at!(5), at!(8))];
    sample[0] = median!(sample[0], sample[1], sample[2]);
    network::<false, S, K, _, 1>(sample.first_chunk_mut().unwrap());
    let (least, pivot, mut greatest) = (sample[0].get_lane(), sample[0].lane_dyn(n / 2), sample[0].lane_dyn(n - 1));
    let only = (least == greatest).then_some(pivot);
    if only.is_some() {
        greatest = another::<S, T, K>(s, values, pivot)?;
    }
    Some((if pivot == least && pivot < greatest { pivot + K::from_usize(1) } else { pivot }, only))
}

#[simd]
#[inline(never)]
/// The first key that is not `than`.
fn another<S: Isa, T: Lane, K: Int>(s: S, values: &[T], than: K) -> Option<K> {
    let bits = key::<S, T, K, _>(s.full::<K>().set(than));
    let at = s.full::<T>().find_if(
        values,
        #[inline(always)]
        |v| v.bitcast::<K>().simd_ne(bits).retype(),
    )?;
    Some(key::<S, T, K, _>(splat(s, values, at).bitcast()).get_lane())
}

#[simd]
#[inline(never)]
/// With `PART`, only the places in `want`, which is not empty, have to get their values.
fn quicksort<S: Isa, T: Lane, K: Int, const PART: bool>(
    s: S,
    mut values: &mut [T],
    mut depth: u32,
    mut want: (usize, usize),
) {
    let n = s.full::<T>().lanes();
    let (most, mut enough) = (if n <= 16 { 16 } else { 8 }, usize::MAX);
    while values.len() > most * n {
        // Vectors without a lookup are slower than the partition of `core`. With two lanes, only the networks gain.
        if const { S::PORTABLE && !S::ARM && !S::WASM && !S::SSSE3 || crate::X86 && !S::SSSE3 } && n != 2
            || depth == 0
            || values.len() / 2 > enough
            || n == 2 && (PART || usize::BITS < 64 || !(S::SSE2 || S::A64))
        {
            return by_keys::<S, T, K, PART>(s, values, want);
        }
        // Unless a quarter goes in each round, taken over a few, `core` does the rest.
        enough = enough.min(values.len()) / 4 * 3;
        depth -= 1;
        // The stride changes from round to round.
        let skip = values.len() / 61 * (1 + depth as usize % 8);
        let Some((bound, only)) = sample::<S, T, K>(s, values, skip) else { return };
        let less = partition::<_, T, K>(s, values, bound);
        let (mut a, mut b) = values.split_at_mut(less);
        let (mut lower, mut upper) = (!PART || want.0 < less, !PART || want.1 > less);
        if let Some(it) = only {
            // The side with this key may have nothing else.
            let (side, wanted, end) =
                if it < bound { (&mut a, &mut lower, K::MIN) } else { (&mut b, &mut upper, K::MAX) };
            if *wanted && (it == end || another::<S, T, K>(s, side, it).is_none()) {
                (*side, *wanted) = (&mut [], !PART);
            }
            if !lower && !upper {
                return;
            }
        }
        let (a, b) = ((a, (want.0, want.1.min(less))), (b, (want.0.saturating_sub(less), want.1.saturating_sub(less))));
        let (shorter, longer) = if !lower || upper && a.0.len() < b.0.len() { (a, b) } else { (b, a) };
        if lower && upper {
            quicksort::<_, T, K, PART>(s, shorter.0, depth, shorter.1);
        }
        (values, want) = longer;
    }
    short::<S, T, K>(s, values)
}

#[op]
fn short<S: Isa, T: Lane, K: Int>(s: S, values: &mut [T]) {
    // The first that has no more lanes than a register.
    macro_rules! rows {
        ($xor:literal $lanes:ty, $rows:literal) => { rows::<$xor, _, T, K, Scaled<u8, T, $lanes>, $rows>(s, values) };
        ($lanes:ty, $rows:literal) => { choose! {
            S::AVX512VBMI2 && T::BITS < 64 && $rows >= 8 && <$lanes>::BYTES * size_of::<T>() == 64 => {
                if crate::tuning::one_port() { rows!(true $lanes, $rows) } else { rows!(false $lanes, $rows) }
            },
            _ => rows!(false $lanes, $rows),
        } };
        ($lanes:ty, $rows:literal $(if $when:expr)?; $($rest:tt)*) => {
            choose! { <$lanes>::BYTES * size_of::<T>() <= S::Native::BYTES $(&& $when)? => rows!($lanes, $rows), _ => rows!($($rest)*) }
        };
    }
    match values.len() {
        0..2 => {}
        2..=4 => rows!(B2, 2),
        5..=8 => rows!(B4, 2 if T::BITS < 64 || S::Native::BYTES == 64; B2, 4),
        9..=16 => rows!(B8, 2; B4, 4; B2, 8),
        17..=32 => rows!(B16, 2 if T::BITS <= 16; B8, 4; B4, 8; B2, 16),
        _ if const { S::Native::BYTES / size_of::<T>() == 2 } => {}
        33..=64 => when!(S::Native::BYTES / size_of::<T>() > 2, rows!(B16, 4; B8, 8; B4, 16)),
        _ if const { S::Native::BYTES / size_of::<T>() == 4 } => {}
        65..=128 => when!(S::Native::BYTES / size_of::<T>() > 4, rows!(B32, 4; B16, 8; B8, 16)),
        _ if const { S::Native::BYTES / size_of::<T>() == 8 } => {}
        257.. if const { T::BITS == 8 && S::Native::BYTES >= 32 } => {
            when!(T::BITS == 8 && S::Native::BYTES >= 32, rows!(B64, 8; B32, 16))
        }
        _ => when!(S::Native::BYTES / size_of::<T>() > 8, rows!(B32, 8; B16, 16)),
    }
}

/// Whether it is in order, or was in reverse. Anything else nearly always shows in the first vector.
#[op]
fn in_order<S: Isa, T: Lane, K: Int>(s: S, values: &mut [T]) -> bool {
    let (d, len) = (s.full::<T>(), values.len());
    let key = always!(|v: Simd<T, S::Native, S>| key::<S, T, K, _>(v.bitcast()));
    let reverse = key(splat(s, values, 0)).simd_gt(key(splat(s, values, len - 1)));
    // To swap the slices saves two `^`. But the loads wait for the comparison, which costs more with longer registers.
    let (flip, swap) =
        choose! { S::REGISTER == 16 => (s.full::<K>().zero(), reverse.any()), _ => (reverse.to_simd::<K>(), false) };
    let found = d.find2_if(
        &values[swap as usize..][..len - 1],
        d,
        &values[!swap as usize..][..len - 1],
        #[inline(always)]
        |a, b| (key(a) ^ flip).simd_gt(key(b) ^ flip).retype(),
    );
    if found.is_none() && reverse.any() {
        T::unsigned_mut(values).reverse()
    }
    found.is_none()
}

#[simd]
/// If only this crate is optimized, this is a call, and short slices are spared its 100 KB of stack.
fn bytes_in_order<S: Isa, T: Lane>(s: S, values: &mut [T]) -> bool {
    choose! { T::IS_SIGNED => in_order::<S, T, i8>(s, values), _ => in_order::<S, T, u8>(s, values) }
}

#[op]
fn count_bytes<S: Isa, T: Lane>(s: S, values: &mut [T]) {
    if const { S::LOOKS_UP_IN_REGISTERS && S::Native::BYTES >= 16 } && values.len() <= 16 * S::Native::BYTES.min(32) {
        return live!(
            S::LOOKS_UP_IN_REGISTERS && S::Native::BYTES >= 16,
            choose! { T::IS_SIGNED => short::<S, T, i8>(s, values), _ => short::<S, T, u8>(s, values) }
        );
    }
    if values.len() < 256 {
        return choose! { T::IS_SIGNED => scalar::<T, i8>(values), _ => scalar::<T, u8>(values) };
    }
    if bytes_in_order(s, values) {
        return;
    }
    // With four tables, equal neighbors don't wait for each other.
    let (d, mut counts) = (s.fixed::<T, crate::B4>(), [[0usize; 256]; 4]);
    let (fours, rest) = d.chunks(values);
    for four in fours {
        let [a, b, c, d] = four.bitcast::<u8>().to_array();
        counts[0][a as usize] += 1;
        counts[1][b as usize] += 1;
        counts[2][c as usize] += 1;
        counts[3][d as usize] += 1;
    }
    for &value in rest {
        counts[0][bits::<T, u8>(&value) as usize] += 1;
    }
    let (d, mut rest, first) = (s.full::<T>(), values, if const { T::IS_SIGNED } { 128 } else { 0 });
    for i in 0..256 {
        let byte = i ^ first;
        let count = counts[0][byte] + counts[1][byte] + counts[2][byte] + counts[3][byte];
        // What is too much is overwritten later.
        if count <= d.lanes() && rest.len() >= d.lanes() {
            d.set(T::from_usize(byte)).store(rest);
        } else {
            rest[..count].fill(T::from_usize(byte));
        }
        rest = &mut rest[count..];
    }
}

#[op]
pub(crate) fn sort_on<S: Isa, T: Lane, const PART: bool>(s: S, values: &mut [T], want: (usize, usize)) {
    if const { crate::X86 && size_of::<T>() == 1 && S::COMPRESS[0] == 64 && S::Native::BYTES == 64 }
        && values.len() > 512
        && (values.len() < 1500 || PART && want.1 - want.0 < values.len() / 4)
    {
        return live!(
            crate::X86 && size_of::<T>() == 1 && S::COMPRESS[0] == 64 && S::Native::BYTES == 64,
            choose! { T::IS_SIGNED => quicksort::<S, T, i8, PART>(s, values, 24, want), _ => quicksort::<S, T, u8, PART>(s, values, 24, want) }
        );
    }
    return_if!(PART && size_of::<T>() == 1, |s: S = s, values: &mut [T] = values, want: (usize, usize) = want| {
        if values.len() >= 256 || const { S::LOOKS_UP_IN_REGISTERS && S::Native::BYTES >= 16 } { count_bytes(s, values) } else if const { T::IS_SIGNED } { scalar_part::<T, i8>(values, want) } else { scalar_part::<T, u8>(values, want) }
    });
    return_if!(size_of::<T>() == 1, |s: S = s, values: &mut [T] = values| count_bytes(s, values));
    choose! { matches!(T::KIND, Kind::Unsigned) && !flips::<S, T>() => sort_by::<S, T, T::Unsigned, PART>(s, values, want), _ => sort_by::<S, T, T::Signed, PART>(s, values, want) }
}

#[op]
fn sort_by<S: Isa, T: Lane, K: Int, const PART: bool>(s: S, values: &mut [T], want: (usize, usize)) {
    return_if!(cfg!(all(target_arch = "s390x", not(miri))) && !S::SCALAR, by_keys::<S, T, K, PART>(s, values, want));
    let (d, len) = (s.full::<T>(), values.len());
    if len <= 8 * d.lanes() {
        return short::<S, T, K>(s, values);
    }
    if len > 16 * d.lanes() && in_order::<S, T, K>(s, values) {
        return;
    }
    let mut part = (0, len);
    when!(PART, {
        let most = if len < 256 { 0 } else { len / (64 * d.lanes()) };
        if want.1 <= most && few::<_, T, K, false>(s, values, want.1) {
            part.1 = want.1;
        } else if len - want.0 <= most && few::<_, T, K, true>(s, values, len - want.0) {
            part.0 = want.0;
        }
    });
    quicksort::<_, T, K, PART>(s, &mut values[part.0..part.1], 2 * len.ilog2(), (want.0 - part.0, want.1 - part.0));
}

#[simd]
#[inline(never)]
/// Moves the `count` least values to the start, or the greatest to the end, in a pass that writes little. It gives up if too many values beat those before them.
fn few<S: Isa, T: Lane, K: Int, const END: bool>(s: S, values: &mut [T], count: usize) -> bool {
    let (d, len) = (s.full::<T>(), values.len());
    let (step, room) = (UNROLL * d.lanes(), 2 * count + 16);
    // From the side where the values go: `kept` can still win, and all others of `seen` can't.
    let (mut kept, mut seen) = (room, room);
    let place = always!(|i: usize| if END { len - 1 - i } else { i });
    loop {
        let (part, at) = if END { (&mut values[len - kept..], kept - count) } else { (&mut values[..kept], count - 1) };
        quicksort::<_, T, K, true>(s, part, 2 * kept.ilog2(), (at, at + 1));
        if seen == len {
            return true;
        }
        let bound = key::<S, T, K, _>(splat(s, part, at).bitcast());
        let wins = always!(|v: Simd<T, S::Native, S>| {
            let v = key::<S, T, K, _>(v.bitcast());
            if END { v.simd_gt(bound) } else { v.simd_lt(bound) }
        });
        let before = seen;
        kept = count;
        while kept < room && len - seen >= step {
            let (from, n) = (&values[if END { len - seen - step } else { seen }..][..step], d.lanes());
            let all = [
                wins(d.load(from)),
                wins(d.load(&from[n..])),
                wins(d.load(&from[2 * n..])),
                wins(d.load(&from[3 * n..])),
            ];
            if (all[0] | all[1] | all[2] | all[3]).any() {
                // In order, so that `kept` doesn't get ahead.
                for i in 0..UNROLL {
                    let mut bits = if END {
                        all[UNROLL - 1 - i].to_bitmask().reverse_bits() >> (64 - n)
                    } else {
                        all[i].to_bitmask()
                    };
                    while bits != 0 {
                        T::unsigned_mut(values).swap(place(kept), place(seen + i * n + bits.trailing_zeros() as usize));
                        (kept, bits) = (kept + 1, bits & (bits - 1));
                    }
                }
            }
            seen += step;
        }
        while kept < room && seen < len {
            if wins(splat(s, values, place(seen))).any() {
                T::unsigned_mut(values).swap(place(kept), place(seen));
                kept += 1;
            }
            seen += 1;
        }
        // In random order, a round sees at least as many values as all before it, and no more than half of them win.
        if seen < len && (2 * (seen - before) < before || 4 * (kept - count) > 3 * (seen - before)) {
            return false;
        }
    }
}

const TARGETS: crate::Targets = if crate::X86 || cfg!(target_arch = "aarch64") {
    use crate::{Named::*, Target};
    crate::Targets(&[
        Target::of(icelake, &[]),
        Target::of(avx512, &[]),
        Target::of(avx2, &[]),
        Target::of(sse4, &[]),
        Target::of(sve2, &[]),
        Target::of(neon, &[]),
    ])
} else {
    crate::Targets::DEFAULT
};

#[kernel(targets = TARGETS)]
/// Sorts in ascending order, and floating-point numbers by `total_cmp`. For keys with values, sort `u64` with the key above the index. `VQSort`.
///
/// ```
/// # use bun_simd::sort;
/// let mut values = [3.0, -1.0, 2.5];
/// sort(&mut values);
/// assert_eq!(values, [-1.0, 2.5, 3.0]);
/// ```
pub fn sort<T: Lane>(values: &mut [T]) {
    sort_on::<S, T, false>(S::default(), values, (0, 0))
}

/// What sorts all zeros and ones sorts everything.
#[test]
fn columns_are_sorted() {
    macro_rules! all { ($($rows:literal: $($others:literal)*;)*) => {$(for mut bits in 0u32..1 << $rows {
        for (others, r) in [$($others as u64),*].into_iter().flat_map(|it| (0..$rows).map(move |r| (it, r))) {
            let other = others >> (4 * r) & 15;
            bits ^= if r < other && bits >> r & 1 > bits >> other & 1 { 1 << r | 1 << other } else { 0 };
        }
        assert!(bits == 0 || bits.trailing_zeros() + bits.count_ones() == $rows);
    })*}; }
    columns!(all);
}

/// Few inputs use up the depth.
#[test]
fn out_of_depth() {
    #[kernel(targets = ALL)]
    fn sorted_to<const PART: bool>(values: &mut [i16], depth: u32, want: (usize, usize)) {
        quicksort::<S, i16, i16, PART>(S::default(), values, depth, want)
    }
    const ALL: crate::Targets = crate::Targets::ALL;
    for (depth, &target) in (0..4).flat_map(|depth| crate::Target::ALL.iter().map(move |target| (depth, target))) {
        let mut values: [i16; 4096] = core::array::from_fn(|i| ((i * 40503) >> 2) as i16);
        let mut sorted = values;
        sorted.sort();
        let mut part = values;
        // With 8 more the samples are the same, and the rest has another order if vectors partition at all.
        let [none, some, more] = [0, 1, 9].map(|depth| {
            let mut part = values;
            sorted_to::to::<true>(target, &mut part, depth, (70, 90));
            part
        });
        assert!(none == more || some != more);
        assert!(sorted_to::to::<false>(target, &mut values, depth, (0, 0)).is_none() || values == sorted);
        assert!(sorted_to::to::<true>(target, &mut part, depth, (70, 90)).is_none() || part[70..90] == sorted[70..90]);
        // What is wanted ends where a partition does: after 2560 of the least value, or after 640 of each value.
        let many: [i16; 3200] = core::array::from_fn(|i| if i % 5 == 0 { 1 + (i * 7 % 640) as i16 } else { 0 });
        let few: [i16; 3200] = core::array::from_fn(|i| ((i + i / 5) % 5) as i16);
        // The first partition takes little away.
        let most: [i16; 3200] = core::array::from_fn(|i| if i % 23 == 0 { (i % 7) as i16 - 3 } else { 0 });
        for values in [many, few, most] {
            let mut sorted = values;
            sorted.sort();
            for to in (640..=3200).step_by(640) {
                let mut part = values;
                assert!(
                    sorted_to::to::<true>(target, &mut part, depth, (to - 1, to)).is_none()
                        || part[to - 1] == sorted[to - 1]
                );
            }
        }
    }
}
