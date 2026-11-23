//! What is below the API, for each lane and width. The traits ask all of them for more than the API calls.

use crate::padded::Pad;
use crate::pattern::{INTERLEAVE_WHOLE_LOWER, ODD_EVEN, PART, REVERSE, SORT3_WHOLE, TRANSPOSE_BLOCKS};
use crate::raw::{Bits, Raw, RawMask, RawOf};
use crate::simd::Simd as Core;
use crate::width::*;
use crate::{Isa, Portable as P};
use core::{cell::Cell, mem::MaybeUninit};

mod bits;
mod output;
mod partial;
mod patterns;
mod plans;
mod ranges;
mod repr;
mod small;

fn random(state: &mut u64) -> u64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *state ^ *state >> 29
}

/// One for each level of src/simd/simd.
const LEVELS: crate::Targets = crate::Targets(&{
    use crate::{Named::*, Target};
    [
        Target::of(icelake, &[]),
        Target::of(avx512, &[]),
        Target::of(avx2, &[]),
        Target::of(sse4, &[]),
        Target::of(neon82_fp16, &[]),
    ]
});

macro_rules! lanes { ($($t:ident $kind:ident $($more:ident)?;)*) => {$(
    mod $t {
        use super::*;
        const SIZE: usize = size_of::<$t>();

        #[track_caller]
        fn same(got: impl IntoIterator<Item = $t>, want: impl IntoIterator<Item = $t>) {
            let bytes = |it: $t| if it.partial_cmp(&it).is_none() { [0xff; SIZE] } else { it.to_le_bytes() };
            assert_eq!(got.into_iter().map(bytes).collect::<Vec<_>>(), want.into_iter().map(bytes).collect::<Vec<_>>());
        }
        #[inline(never)]
        fn bools<S: Isa, R: Raw<Lane = $t>>(mask: R::Mask) -> Vec<bool> {
            R::select(mask, R::splat(1 as $t), R::splat(0 as $t)).to_array().into_iter().map(|it| it != 0 as $t).collect()
        }
        fn uninit(n: usize) -> Vec<MaybeUninit<$t>> { vec![MaybeUninit::uninit(); n] }

        #[inline(never)]
        fn memory<S: Isa, R: Raw<Lane = $t, Stored = R>>(x: &[$t; 512], y: &[$t; 512], len: usize) {
            let (n, a, b) = (size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() / SIZE, R::load(x), R::load(y));
            let (zero, len) = (0 as $t, (len % (n + 2)).min(512));
            let first = || x[..n].iter().copied();
            let or = |other: &dyn Fn(usize) -> $t, when: &dyn Fn(usize) -> bool, n| (0..n).map(|i| if when(i) { x[i] } else { other(i) }).collect::<Vec<_>>();
            for v in [a, R::from_stored(a), R::from_array(a.to_array()), R::read(&x[..], 0), R::casted(a), a.cast()] {
                same(v.to_array(), first());
            }
            same(a.lanes().iter().copied(), first());
            same(R::splat(x[3]).to_array(), vec![x[3]; n]);
            same(R::iota().to_array(), (0..n).map(|i| i as $t));
            assert!(R::bools(|i| x[i] < y[i]).into_iter().eq((0..n).map(|i| x[i] < y[i])));
            let mut changed = a;
            changed.lanes_mut()[n - 1] = y[0];
            same(changed.to_array(), or(&|_| y[0], &|i| i + 1 < n, n));

            let after = |f: &dyn Fn(&mut [$t])| { let mut to = *y; f(&mut to); to };
            let up_to = |n| or(&|i| y[i], &move |i| i < n, 512);
            same(after(&|to| a.store(to)), up_to(n));
            same(after(&|mut to| a.write(&mut to, 0)), up_to(n));
            same(after(&|to| a.store_in_parts(&mut to[..len])), up_to(len.min(n)));
            a.store_uninit(&mut uninit(n + 1));
            same(R::load_in_parts(&x[..len]).to_array(), or(&|_| zero, &|i| i < len, n));
            same(a.shuffle::<R, REVERSE, 0>(a).to_array(), first().rev());
            same(a.shuffle::<R, PART, 0>(b).to_array(), first());
            same(a.shuffle::<R, PART, 1>(b).to_array(), y[..n].iter().copied());
            same(a.shuffle::<R, INTERLEAVE_WHOLE_LOWER, 0>(b).to_array(), (0..n).map(|i| [x, y][i % 2][i / 2]));
            same(R::picked::<512, PART, 0>(x, y).to_array(), first());
            same(R::picked::<512, PART, 1>(x, y).to_array(), x.iter().chain(y).copied().skip(n).take(n));
            same(R::picked::<512, ODD_EVEN, 0>(x, y).to_array(), or(&|i| y[i], &|i| i % 2 == 1, n));
            let few = n.min(64);
            assert!(a.cast_part::<i32, S>(0).as_array()[..few].iter().copied().eq(x[..few].iter().map(|&it| it as i32)));
            assert!(a.cast_lanes::<f32, 64, S>().as_array()[..few].iter().copied().eq(x[..few].iter().map(|&it| it as f32)));
            assert_eq!(a.cast_lanes::<u16, 1, S>()[0], x[0] as u16);
            if n > 64 {
                assert!(a.cast_part::<i64, S>(1).as_array().iter().copied().eq(x[64..128].iter().map(|&it| it as i64)));
                return;
            }

            let (mask, set) = (a.lt(b), |i: usize| i < len.min(n) && x[i] < y[i]);
            same(after(&|to| a.store_masked(&mut to[..len], mask)), or(&|i| y[i], &set, 512));
            let (table, at) = (&y[100..], R::load(&x.map(|it| (it as i64 & 0x1f) as $t)));
            let inside = |i: usize| x[i] < y[i] && ((x[i] as i64 & 0x1f) as usize) < len;
            let found = || (0..n).map(|i| if inside(i) { table[(x[i] as i64 & 0x1f) as usize] } else { x[i] });
            let spread = after(&|to| for i in (0..n).filter(|&i| inside(i)) { to[(x[i] as i64 & 0x1f) as usize] = x[i] });
            same(at.gather(a, mask, &table[..len]).to_array(), found());
            same(after(&|to| at.scatter(a, mask, &mut to[..len])), spread);
            same(after(&|to| R::splat(1 as $t).scatter(a, RawMask::splat(true), to)), (0..512).map(|i| if i == 1 { x[n - 1] } else { y[i] }));
            if size_of::<R>() > size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() || size_of::<R>() < 16 {
                return;
            }
            let skip = len % 3 % n;
            let moved = |other: &dyn Fn(usize) -> $t, when: &dyn Fn(usize) -> bool| (0..n).map(|i| if i >= skip && i - skip < len && when(i) { x[i - skip] } else { other(i) }).collect::<Vec<_>>();
            same(R::load_by_bits(S::default(), &x[..len], skip, b).to_array(), moved(&|i| y[i], &|_| true));
            same(R::load_cells(S::default(), &x.map(Cell::new)[..len], skip).to_array(), moved(&|_| zero, &|_| true));
            let stored = || (0..512).map(|i| if i < len.min(n - skip) { x[i + skip] } else { y[i] });
            same(after(&|to| a.store_by_bits(S::default(), Ok(&mut to[..len]), skip)), stored());
            same(after(&|to| a.store_cells(S::default(), Cell::from_mut(&mut to[..len]).as_slice_of_cells(), skip)), stored());
            same(a.fill_by_bits(&mut uninit(len), skip).iter().copied(), stored().take(len.min(n - skip)));
            a.store_by_bits(S::default(), Err(&mut uninit(len)), skip);
        }

        #[inline(never)]
        fn interleaved<S: Isa, R: Raw<Lane = $t>>(x: &[$t; 512], y: &[$t; 512]) {
            let (n, [p, q, r], [s, t, u, v], mut three, mut four) = (size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() / SIZE, R::load3(x), R::load4(x), *y, *y);
            for (k, parts) in [(3, &[p, q, r][..]), (4, &[s, t, u, v])] {
                parts.iter().enumerate().for_each(|(j, it)| same(it.to_array(), (0..n).map(|i| x[k * i + j])));
            }
            R::store3([p, q, r], &mut three);
            R::store4([s, t, u, v], &mut four);
            same(three, x[..3 * n].iter().chain(&y[3 * n..]).copied());
            same(four, x[..4 * n].iter().chain(&y[4 * n..]).copied());
        }

        #[inline(never)]
        fn masks<S: Isa, R: Raw<Lane = $t>>(x: &[$t; 512], y: &[$t; 512], z: &[$t; 512]) {
            let (n, a, b, c) = (size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() / SIZE, R::load(x), R::load(y), R::load(z));
            let check = |mask, f: &dyn Fn($t, $t, $t) -> bool| {
                let want: Vec<bool> = (0..n).map(|i| f(x[i], y[i], z[i])).collect();
                assert_eq!(bools::<S, R>(mask), want);
                assert_eq!((mask.any(), mask.all()), (want.contains(&true), !want.contains(&false)));
                assert!(R::from_mask(mask).to_array().into_iter().map(|it| it.to_le_bytes()).eq(want.iter().map(|&it| [(it as u8).wrapping_neg(); SIZE])));
                assert_eq!(bools::<S, R>(mask.convert::<R::Mask, PART, 0, S>(mask.not())), want);
                // For WebAssembly, mask.rs doesn't ask for more.
                if n <= if cfg!(target_feature = "simd128") { 16 } else { 64 } {
                    let bits = want.iter().rfold(0, |all, &it| all << 1 | it as u64);
                    assert_eq!((mask.to_bits(), bools::<S, R>(RawMask::from_bits(bits)), bools::<S, R>(RawMask::from_parts(|_| mask))), (bits, want.clone(), want));
                }
            };
            check(a.eq(b), &|a, b, _| a == b);
            check(a.ne(b), &|a, b, _| a != b);
            check(a.lt(b), &|a, b, _| a < b);
            check(a.le(b), &|a, b, _| a <= b);
            check(a.top_bits(), &|a, _, _| a.to_le_bytes()[SIZE - 1] >= 128);
            check(a.lt(b).and(a.lt(c)), &|a, b, c| a < b && a < c);
            check(a.lt(b).or(a.lt(c)), &|a, b, c| a < b || a < c);
            check(a.lt(b).xor(a.lt(c)), &|a, b, c| (a < b) != (a < c));
            check(a.lt(b).not(), &|a, b, _| a >= b);
            check(RawMask::splat(true), &|_, _, _| true);
            check(RawMask::splat(false), &|_, _, _| false);
            for i in [0, n / 2, n - 1] {
                let mut one = R::splat(0 as $t);
                one.lanes_mut()[i] = 1 as $t;
                assert!(one.ne(R::splat(0 as $t)).any() && !one.eq(R::splat(0 as $t)).all());
            }
        }

        #[inline(never)]
        fn arithmetic<S: Isa, R: Raw<Lane = $t>>(x: &[$t; 512], y: &[$t; 512], z: &[$t; 512]) {
            let (n, a, b, c) = (size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() / SIZE, R::load(x), R::load(y), R::load(z));
            let check = |v: R, f: &dyn Fn($t, $t, $t) -> $t| same(v.to_array(), (0..n).map(|i| f(x[i], y[i], z[i])));
            let by_bytes = |a: $t, b: $t, f: fn(u8, u8) -> u8| $t::from_le_bytes(core::array::from_fn(|i| f(a.to_le_bytes()[i], b.to_le_bytes()[i])));
            let (min, max) = (|a: $t, b: $t| if a < b { a } else { b }, |a: $t, b: $t| if a > b { a } else { b });
            check(a.min(b), &|a, b, _| min(a, b));
            check(a.max(b), &|a, b, _| max(a, b));
            check(a.and(b), &|a, b, _| by_bytes(a, b, |a, b| a & b));
            check(a.or(b), &|a, b, _| by_bytes(a, b, |a, b| a | b));
            check(a.xor(b), &|a, b, _| by_bytes(a, b, |a, b| a ^ b));
            check(a.not(), &|a, b, _| by_bytes(a, b, |a, _| !a));
            check(R::select(a.lt(b), b, c), &|a, b, c| if a < b { b } else { c });
            same([a.reduce_min(), a.reduce_max()], [x[..n].iter().copied().reduce(min).unwrap(), x[..n].iter().copied().reduce(max).unwrap()]);
            lanes!(@$kind $t check a b c x[..n]);
            $(lanes!(@$more $t check a b);)?
        }

        #[inline(never)]
        fn bytes<S: Isa, W: Width>(x: &[$t; 512]) {
            let (little, native) = (x.map($t::to_le_bytes), x.map($t::to_ne_bytes));
            let (little, native, a) = (&little.as_flattened()[..W::BYTES], &native.as_flattened()[..W::BYTES], RawOf::<$t, W>::load(x));
            let (from_little, from_native) = (RawOf::<$t, W>::from_bytes(Raw::load(little)), RawOf::<$t, W>::from_native(Raw::load(native)));
            assert_eq!((from_little.to_bytes().lanes(), from_native.to_native().lanes()), (little, native));
            assert_eq!((a.to_bytes().lanes(), a.to_native().lanes()), (little, native));
            if W::BYTES >= SIZE {
                same(from_little.to_array(), a.to_array());
                same(from_native.to_array(), a.to_array());
            }
        }

        fn rounds(f: impl Fn(&[$t; 512], &[$t; 512], &[$t; 512], usize)) {
            let mut state = 1;
            for round in 0..if cfg!(miri) { 1 } else { 60 } {
                let mut values = || core::array::from_fn(|_| lanes!(@value $kind $t random(&mut state) >> (round % 4 * 2)));
                let (x, mut y, z) = (values(), values(), values());
                y.iter_mut().zip(x).step_by(3).for_each(|(y, x)| *y = x);
                f(&x, &y, &z, if round < 20 { round } else { random(&mut state) as usize >> 9 });
            }
        }
        fn at<S: Isa, W: Width>() where RawOf<$t, W>: Raw<Stored = RawOf<$t, W>> {
            rounds(|x, y, z, len| {
                for len in [len, W::BYTES / SIZE] {
                    memory::<S, RawOf<$t, W>>(x, y, len);
                }
                masks::<S, RawOf<$t, W>>(x, y, z);
                arithmetic::<S, RawOf<$t, W>>(x, y, z);
            })
        }
        struct On;
        impl crate::Kernel<(usize,)> for On {
            type Output = ();
            const TARGETS: crate::Targets = LEVELS;
            fn run<S: Isa>(_: S, (bytes,): (usize,)) { match bytes { 4 => at::<S, B4>(), 16 => at::<S, B16>(), 64 => at::<S, B64>(), _ => at::<S, B512>() } }
        }
        fn each(bytes: usize) { for &it in LEVELS.0.iter().chain(&[crate::Target::Portable]) { crate::dispatch_to::<On, _>(it, (bytes,)); } }
        #[test] fn part_of_a_register() { each(4) }
        #[test] fn registers() { each(16); each(64) }
        #[test] fn many_registers() { each(512) }
        #[test]
        fn each_size() {
            rounds(|x, y, _, _| {
                bytes::<P, B2>(x); bytes::<P, B4>(x); bytes::<P, B8>(x); bytes::<P, B16>(x); bytes::<P, B32>(x); bytes::<P, B64>(x); bytes::<P, B128>(x); bytes::<P, B256>(x); bytes::<P, B512>(x);
                interleaved::<P, RawOf<$t, B4>>(x, y);
                interleaved::<P, Core<$t, 1>>(x, y); interleaved::<P, Core<$t, 2>>(x, y); interleaved::<P, Core<$t, 4>>(x, y); interleaved::<P, Core<$t, 8>>(x, y); interleaved::<P, Core<$t, 16>>(x, y);
            })
        }
    }
)*};
    (@value int $t:ident $bits:expr) => { $bits as $t };
    // Sums are exact.
    (@value float $t:ident $bits:expr) => { ($bits as i16 >> 4) as $t / 4.0 };
    (@int $t:ident $check:ident $a:ident $b:ident $c:ident $all:expr) => {
        let by = $c.and(Raw::splat($t::BITS as $t - 1));
        $check($a.add($b), &|a, b, _| a.wrapping_add(b));
        $check($a.sub($b), &|a, b, _| a.wrapping_sub(b));
        $check($a.mul($b), &|a, b, _| a.wrapping_mul(b));
        $check($a.shl(by), &|a, _, c| a.wrapping_shl(c as u32));
        $check($a.shr(by), &|a, _, c| a.wrapping_shr(c as u32));
        $check($a.saturating_add($b), &|a, b, _| a.saturating_add(b));
        $check($a.saturating_sub($b), &|a, b, _| a.saturating_sub(b));
        $check($a.abs_diff($b), &|a, b, _| a.abs_diff(b) as $t);
        $check($a.swap_bytes(), &|a, _, _| a.swap_bytes());
        $check($a.reverse_bits(), &|a, _, _| a.reverse_bits());
        $check($a.count_ones(), &|a, _, _| a.count_ones() as $t);
        $check($a.leading_zeros(), &|a, _, _| a.leading_zeros() as $t);
        $check($a.trailing_zeros(), &|a, _, _| a.trailing_zeros() as $t);
        same([$a.reduce_sum()], [$all.iter().fold(0, |sum: $t, &it| sum.wrapping_add(it))]);
    };
    (@float $t:ident $check:ident $a:ident $b:ident $c:ident $all:expr) => {
        $check($a.add($b), &|a, b, _| a + b);
        $check($a.sub($b), &|a, b, _| a - b);
        $check($a.mul($b), &|a, b, _| a * b);
        $check($a.div($b), &|a, b, _| a / b);
        $check($a.fma($b, $c), &|a, b, c| a * b + c);
        $check($a.abs_diff($b), &|a, b, _| (a - b).abs());
        $check($a.neg(), &|a, _, _| -a);
        $check($a.abs(), &|a, _, _| a.abs());
        $check($a.sqrt(), &|a, _, _| a.sqrt());
        $check($a.floor(), &|a, _, _| a.floor());
        $check($a.ceil(), &|a, _, _| a.ceil());
        $check($a.trunc(), &|a, _, _| a.trunc());
        $check($a.round(), &|a, _, _| a.round());
        $check($a.round_ties_even(), &|a, _, _| a.round_ties_even());
        same([$a.reduce_sum()], [$all.iter().sum()]);
        // `simd_clamp` counts on the second one if neither is less.
        let (zero, nan) = ($a.sub($a), $a.sub($a).div($a.sub($a)));
        $check(zero.min(zero.neg()).or(zero.max(zero.neg())), &|_, _, _| -0.0);
        $check(zero.neg().min(zero).or(zero.neg().max(zero)), &|_, _, _| 0.0);
        $check(nan.min($b), &|_, b, _| b);
        $check(nan.max($b), &|_, b, _| b);
    };
    (@signed $t:ident $check:ident $a:ident $b:ident) => {
        $check($a.neg(), &|a, _, _| a.wrapping_neg());
        $check($a.abs(), &|a, _, _| a.wrapping_abs());
    };
    (@average $t:ident $check:ident $a:ident $b:ident) => {
        $check($a.average_round($b), &|a, b, _| (a as u64 + b as u64).div_ceil(2) as $t);
    };
}
lanes! { u8 int average; u16 int average; u32 int average; u64 int; i8 int signed; i16 int signed; i32 int signed; i64 int signed; f32 float; f64 float; }

#[test]
fn other_sizes() {
    fn at<S: Isa, W: Width>() {
        let bytes: [u8; 512] = core::array::from_fn(|i| (i * 37 + 5) as u8);
        let (v, first) = (W::U8::load(&bytes), |n: usize| n.min(W::BYTES));
        assert_eq!(W::to16(v).as_array()[..first(16)], bytes[..first(16)]);
        assert_eq!(W::to32(v).as_array()[..first(32)], bytes[..first(32)]);
        assert_eq!(W::to64(v).as_array()[..first(64)], bytes[..first(64)]);
        assert_eq!(W::from16(Core::from_slice(&bytes)).lanes()[..first(16)], bytes[..first(16)]);
        assert_eq!(W::from32(Core::from_slice(&bytes)).lanes()[..first(32)], bytes[..first(32)]);
        assert_eq!(W::from64(Core::from_slice(&bytes)).lanes()[..first(64)], bytes[..first(64)]);
    }
    at::<P, B2>();
    at::<P, B4>();
    at::<P, B8>();
    at::<P, B16>();
    at::<P, B32>();
    at::<P, B64>();
    at::<P, B128>();
    at::<P, B256>();
    at::<P, B512>();
}

#[test]
fn by_64() {
    fn at<S: Isa, W: Width>() {
        let bytes: [u8; 1536] = core::array::from_fn(|i| ((i * 40503) >> 3) as u8);
        let [a, b, c] = [0, 512, 1024].map(|at| W::U8::load(&bytes[at..]));
        assert_eq!(W::by_64([a], |[a]| a.not::<S>()).lanes(), a.not().lanes());
        assert_eq!(W::by_64([a, b], |[a, b]| a.sub::<S>(b)).lanes(), a.sub(b).lanes());
        assert_eq!(W::by_64([a, b, c], |[a, b, c]| a.sub::<S>(b).and::<S>(c)).lanes(), a.sub(b).and(c).lanes());
    }
    at::<P, B128>();
    at::<P, B512>();
}

#[test]
fn bitcast() {
    let bytes: [u8; 32] = core::array::from_fn(|i| (i * 37 + 5) as u8);
    macro_rules! from { ($($t:ident)*) => { $(to!($t: u8 i16 u32 f32 u64);)* }; }
    macro_rules! to { ($t:ident: $($u:ident)*) => {$(
        let v = crate::raw::bitcast::<$t, $u, B32>(Core::from_array(core::array::from_fn(|i| $t::from_le_bytes(bytes.as_chunks().0[i]))));
        assert_eq!(v.to_array().map($u::to_le_bytes).as_flattened(), bytes);
    )*}; }
    from!(u8 i16 u32 f32 u64);
}

#[test]
fn few_bytes() {
    let bytes: [u8; 20] = core::array::from_fn(|i| (i * 37 + 5) as u8);
    for n in 0..20 {
        let first =
            |lanes: usize, of: usize| (0..of).map(|i| if i < n.min(lanes) { bytes[i] } else { 0 }).collect::<Vec<_>>();
        let mut to = [[0; 20]; 2];
        Core::<u8, 8>::load::<P>(&bytes).store_in_parts::<P>(&mut to[0][..n]);
        Core::<u8, 16>::load::<P>(&bytes).store_in_parts::<P>(&mut to[1][..n]);
        assert_eq!(to, [&first(8, 20)[..], &first(16, 20)]);
        assert_eq!(
            (
                Core::<u8, 8>::load_in_parts::<P>(&bytes[..n]).lanes(),
                Core::<u8, 16>::load_in_parts::<P>(&bytes[..n]).lanes()
            ),
            (&first(8, 8)[..], &first(16, 16)[..])
        );
    }
}

/// The padding stays out.
#[test]
fn from_padded_to_many() {
    let v = crate::raw::resize::<B4, B512>(Raw::splat::<P>(7));
    assert_eq!((&v.lanes()[..4], &v.lanes()[4..]), (&[7; 4][..], &[0; 508][..]));
}

/// NEON on 32-bit Arm takes them for zero.
#[test]
fn subnormal_numbers() {
    fn at<S: Isa, const N: usize>()
    where
        f32: crate::simd::Fits<N>,
        Core<f32, N>: Raw<Mask = crate::simd::Mask<i32, N>>,
    {
        let all = [0, 1, 2, 0x7f_ffff, 0x40_0000, 0x80_0000, 0x3f80_0000, 0x4000_0000, 0x7f80_0000, 0x7fc0_0000]
            .map(|it| [it, it | 1 << 31])
            .concat();
        for (x, y, i, other) in all.iter().flat_map(|&x| {
            all.iter().flat_map(move |&y| {
                [0, N - 1]
                    .into_iter()
                    .flat_map(move |i| [[0; 2], [1; 2], [0x3f80_0000; 2], [x; 2], [x, y]].map(|other| (x, y, i, other)))
            })
        }) {
            let [mut a, mut b] = other.map(|it| Core::<f32, N>::splat(f32::from_bits(it)));
            (a[i], b[i]) = (f32::from_bits(x), f32::from_bits(y));
            let want = |f: fn(&f32, &f32) -> bool| (0..N).rfold(0, |all, i| all << 1 | f(&a[i], &b[i]) as u64);
            let got = [Raw::eq(a, b), Raw::ne(a, b), Raw::lt(a, b), Raw::le(a, b)].map(|it| it.to_bitmask());
            assert_eq!(got, [want(f32::eq), want(f32::ne), want(f32::lt), want(f32::le)], "{x:x} {y:x} {i} {other:x?}");
            assert!(x & 0x7f80_0000 != 0 || y & 0x7f80_0000 != 0 || Raw::add(a, b)[i] == a[i] + b[i]);
        }
    }
    at::<P, 4>();
    if !cfg!(miri) {
        at::<P, 32>()
    }
}

#[test]
fn blocks() {
    let d = crate::Tag::<_, u16, B512>::new(crate::Portable::new());
    assert_eq!((d.blocks_len(), d.lanes_per_block()), (32, 8));
}

#[test]
fn sums_of_floats() {
    fn at<S: Isa, W: Width>() {
        let (x, y): ([f32; 128], [f64; 64]) =
            (core::array::from_fn(|i| (i * i) as f32), core::array::from_fn(|i| (i * i) as f64));
        assert_eq!(
            (W::F32::load(&x).reduce_sum(), W::F64::load(&y).reduce_sum()),
            (x[..W::BYTES / 4].iter().sum(), y[..W::BYTES / 8].iter().sum())
        );
    }
    at::<P, B8>();
    at::<P, B16>();
    at::<P, B32>();
    at::<P, B64>();
    at::<P, B128>();
    at::<P, B256>();
    at::<P, B512>();
}

/// A part of the result comes from 1 to 8 parts of the operands.
#[test]
fn from_many_parts() {
    fn at<S: Isa, W: Width>() {
        let (n, x): (usize, [u16; 256]) = (W::BYTES / 2, core::array::from_fn(|i| (i * 40503) as u16));
        let v = W::U16::load(&x);
        assert!(v.shuffle::<W::U16, SORT3_WHOLE, 1>(v).to_array().into_iter().eq((0..n).map(|i| x[(3 * i + 1) % n])));
        let (n, x): (usize, [u8; 512]) = (W::BYTES, core::array::from_fn(|i| ((i * 40503) >> 3) as u8));
        let v = W::U8::load(&x);
        assert!(v.shuffle::<W::U8, SORT3_WHOLE, 2>(v).to_array().into_iter().eq((0..n).map(|i| x[(3 * i + 2) % n])));
        assert!(
            v.shuffle::<W::U8, TRANSPOSE_BLOCKS, 0>(v)
                .to_array()
                .into_iter()
                .eq((0..n).map(|i| x[i % (n / 16) * 16 + i / (n / 16)]))
        );
    }
    at::<P, B128>();
    at::<P, B256>();
    at::<P, B512>();
    let (a, b): ([u8; 256], [u8; 256]) = (core::array::from_fn(|i| i as u8), core::array::from_fn(|i| !i as u8 ^ 0x55));
    let both = [a, b].concat();
    assert!(
        crate::many::pick::<u8, TRANSPOSE_BLOCKS, 0, 256, 512, 4>(&a, &b)
            .to_array()
            .into_iter()
            .eq((256..320).map(|i| both[i % 16 * 16 + i / 16]))
    );
}

#[test]
fn pad_and_cut() {
    macro_rules! rows { ($($n:literal: $($t:ident)*;)*) => {$($(
        let v = Core::<$t, $n>::from_array(core::array::from_fn(|i| (100 - 9 * i) as $t));
        let padded = <$t as Pad<$n, { 16 / size_of::<$t>() }>>::pad(core::hint::black_box(v));
        assert_eq!((&padded.as_array()[..$n], <$t as Pad<$n, _>>::cut(padded).to_array()), (&v.as_array()[..], v.to_array()));
    )*)*}; }
    rows! { 1: u16 i16 u32 i32 f32 u64 i64 f64; 2: u8 i8 u16 i16 u32 i32 f32; 4: u8 i8 u16 i16; 8: u8 i8; }
}

/// Halves and wholes of masks with more than 64 lanes.
#[test]
fn masks_in_parts() {
    fn at<S: Isa, W: Width>() {
        let x: [i8; 1024] = core::array::from_fn(|i| ((i * 40503) >> 3) as i8);
        let (n, mask) = (W::BYTES, |at: usize| W::I8::load(&x[at..]).top_bits());
        let half = |at: usize| RawOf::<i8, W::Half>::load(&x[at..]).top_bits();
        let want = |at: usize, n: usize| x[at..][..n].iter().map(|&it| it >> 7);
        assert!(
            W::I8::from_mask(half(0).convert::<_, PART, 0, S>(half(300)))
                .to_array()
                .into_iter()
                .eq(want(0, n / 2).chain(want(300, n / 2)))
        );
        assert!(
            RawOf::<i8, W::Half>::from_mask(mask(0).convert::<_, PART, 0, S>(mask(512)))
                .to_array()
                .into_iter()
                .eq(want(0, n / 2))
        );
        assert!(
            RawOf::<i8, W::Half>::from_mask(mask(0).convert::<_, PART, 1, S>(mask(512)))
                .to_array()
                .into_iter()
                .eq(want(n / 2, n / 2))
        );
    }
    at::<P, B128>();
    at::<P, B256>();
    at::<P, B512>();
}

#[test]
#[cfg(panic = "unwind")]
fn same_takes_one_type_only() {
    fn refused<A: Copy + 'static, B: Copy + 'static>(value: A) -> bool {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::raw::same::<A, B>(value);
        }))
        .is_err()
    }
    assert!(
        refused::<u8, i8>(1)
            && refused::<u8, bool>(2)
            && refused::<u8, u64>(3)
            && refused::<Core<u8, 16>, Core<u8, 32>>(Core::repeated(4))
    );
    assert_eq!(crate::raw::same::<_, &[u8]>(&[5_u8][..]), [5]);
}
