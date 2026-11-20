//! Every op of every target against plain code.
#![cfg(not(miri))]
#![forbid(unsafe_code)]
mod common;

use bun_simd::{Int, Lane, Out, Shuffle};
use common::on_each_target;
use std::array::from_fn;
use std::fmt::Debug;
use std::hint::black_box;

trait Number: Lane + Ord + Debug + Into<i128> + TryFrom<i128> {
    const BITS: u32 = 8 * size_of::<Self>() as u32;

    /// `as`
    fn wrapping_from(value: i128) -> Self {
        let value = value.rem_euclid(1 << Self::BITS);
        let negative = |_| Self::try_from(value - (1 << Self::BITS));
        Self::try_from(value).or_else(negative).ok().unwrap()
    }
}

impl<T: Lane + Ord + Debug + Into<i128> + TryFrom<i128>> Number for T {}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// Mostly close to a power of two.
    fn lanes<T: Number, const N: usize>(&mut self) -> [T; N] {
        black_box(from_fn(|_| {
            let bits = self.next();
            let near = (1 << (bits >> 8 & 63)) + i128::from(bits >> 16 & 3) - 2;
            T::wrapping_from(match bits & 7 {
                0 | 1 => self.next().into(),
                2..5 => near,
                _ => !near,
            })
        }))
    }
}

impl Random {
    /// Often equal, neighbors, or zero with either sign.
    fn doubles<const N: usize>(&mut self) -> [f64; N] {
        black_box(from_fn(|_| match self.next() % 8 {
            few @ ..5 => [0.0, -0.0, 0f64.next_up(), 3.0, -1e99][few as usize],
            _ => self.next() as i64 as f64 / 1e12,
        }))
    }
}

fn saturating_dot(a: [u8; 2], b: [i8; 2]) -> i16 {
    let [first, second] = [0, 1].map(|i| i16::from(a[i]) * i16::from(b[i]));
    first.saturating_add(second)
}

struct Mixed;

impl<const N: usize> Shuffle<N> for Mixed {
    const FROM: [usize; N] = {
        let (mut from, mut i) = ([0; N], 0);
        while i < N {
            from[i] = if i % 3 == 0 { 2 * N - 1 - i } else { i / 2 };
            i += 1;
        }
        from
    };
}

/// Where lane `i` of `pack` comes from, in the lanes of both arguments.
fn packed_from(i: usize, len: usize, block: usize) -> usize {
    i / (block / 2) % 2 * (len / 2) + i / block * (block / 2) + i % (block / 2)
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{Mask, U8, Vector};

    fn lanewise<T: Number + Int<N>, const N: usize>(a: [T; N], b: [T; N]) {
        let (x, y) = (Vector::from_array(a), Vector::from_array(b));
        let is = |name: &str, got: Vector<T, N>, want: fn(i128, i128) -> i128| {
            let want = from_fn(|i| T::wrapping_from(want(a[i].into(), b[i].into())));
            assert_eq!(got.to_array(), want, "{name} {a:?} {b:?}");
        };
        is("add", x + y, |a, b| a + b);
        is("sub", x - y, |a, b| a - b);
        is("and", x & y, |a, b| a & b);
        is("or", x | y, |a, b| a | b);
        is("xor", x ^ y, |a, b| a ^ b);
        is("not", !x, |a, _| !a);
        is("neg", x.wrapping_neg(), |a, _| -a);
        let mut assigned = x;
        assigned += y;
        assigned ^= x;
        assigned -= y;
        assigned |= x;
        assigned &= y;
        is("assign", assigned, |a, b| ((((a + b) ^ a) - b) | a) & b);
        is("min", x.simd_min(y), i128::min);
        is("max", x.simd_max(y), i128::max);

        let holds = |name: &str, got: Mask<T, N>, want: fn(i128, i128) -> bool| {
            let want: [bool; N] = from_fn(|i| want(a[i].into(), b[i].into()));
            let bits = (0..N).map(|i| u64::from(want[i]) << i).sum();
            let first = want.iter().position(|&it| it);
            let (any, all) = (first.is_some(), !want.contains(&false));
            let vector = want.map(|it| T::wrapping_from(-i128::from(it)));
            let selected = from_fn(|i| if want[i] { a[i] } else { b[i] });
            assert_eq!(got.to_bitmask(), bits, "{name} {a:?} {b:?}");
            assert_eq!(got.first_set(), first, "{name}");
            assert_eq!(
                [got.any(), got.none(), got.all()],
                [any, !any, all],
                "{name}"
            );
            assert_eq!(got.count(), u64::count_ones(bits) as usize, "{name}");
            for lane in (0..=N).chain([usize::MAX / 2 + 1]) {
                let before = want.iter().take(lane).filter(|&&it| it).count();
                assert_eq!(got.count_before(lane), before, "{name}");
            }
            assert_eq!(got.to_vector().to_array(), vector, "{name}");
            assert_eq!(got.select(x, y).to_array(), selected, "{name}");
        };
        holds("eq", x.simd_eq(y), |a, b| a == b);
        holds("ne", x.simd_ne(y), |a, b| a != b);
        holds("lt", x.simd_lt(y), |a, b| a < b);
        holds("le", x.simd_le(y), |a, b| a <= b);
        holds("gt", x.simd_gt(y), |a, b| a > b);
        holds("ge", x.simd_ge(y), |a, b| a >= b);
        let three = T::wrapping_from(3);
        let (p, q) = (x.simd_gt(three), y.simd_gt(three));
        holds("and", p & q, |a, b| a > 3 && b > 3);
        holds("or", p | q, |a, b| a > 3 || b > 3);
        holds("xor", p ^ q, |a, b| (a > 3) != (b > 3));
        holds("not", !p, |a, _| a <= 3);
    }

    fn shifts<T: Number + Int<N>, const N: usize>(a: [T; N], b: [T; N]) {
        let (x, y) = (Vector::from_array(a), Vector::from_array(b));
        let bits = |i: usize| b[i].into().rem_euclid(T::BITS.into());
        let left = from_fn(|i| T::wrapping_from(a[i].into() << bits(i)));
        assert_eq!((x << y).to_array(), left);
        let right = from_fn(|i| T::wrapping_from(a[i].into() >> bits(i)));
        assert_eq!((x >> y).to_array(), right);

        for bits in 0..T::BITS {
            let (v, opaque) = (Vector::from_array(a), black_box(bits));
            let left = a.map(|a| T::wrapping_from(a.into().wrapping_shl(bits)));
            assert_eq!((v << opaque).to_array(), left);
            let right = a.map(|a| T::wrapping_from(a.into() >> bits));
            assert_eq!((v >> opaque).to_array(), right);
        }
    }

    fn moves<T: Number + Int<N>, const N: usize>(a: [T; N], b: [T; N]) {
        let (x, y, zero) = (Vector::load(&a), Vector::from_slice(&b), T::default());
        let joined = |(first, second): (Vector<T, N>, Vector<T, N>)| {
            [first.to_array(), second.to_array()].concat()
        };
        let in_turns: Vec<T> = a.iter().zip(&b).flat_map(|(&a, &b)| [a, b]).collect();
        assert_eq!(joined(x.interleave(y)), in_turns);
        let every_other = |first| a.iter().chain(&b).copied().skip(first).step_by(2);
        let even_then_odd: Vec<T> = every_other(0).chain(every_other(1)).collect();
        assert_eq!(joined(x.deinterleave(y)), even_then_odd);
        let want = from_fn(|i| if i % 3 == 0 { b[N - 1 - i] } else { a[i / 2] });
        assert_eq!(x.shuffle::<Mixed>(y).to_array(), want);
        let slid = |by| from_fn(|i: usize| i.checked_sub(by).map_or(zero, |i| a[i]));
        assert_eq!(x.shift_elements_right::<1>(zero).to_array(), slid(1));
        assert_eq!(x.shift_elements_right::<2>(zero).to_array(), slid(2));
        assert_eq!(x.shift_elements_right::<65>(b[0]).to_array(), [b[0]; N]);
        let after_last = from_fn(|i| if i == 0 { b[N - 1] } else { a[i - 1] });
        assert_eq!(x.shift_in::<1>(y).to_array(), after_last);
        assert_eq!(x.reverse().to_array(), from_fn(|i| a[N - 1 - i]));
        assert_eq!(x.swap_pairs().to_array(), from_fn(|i| a[i ^ 1]));
        assert_eq!(Vector::splat(a[0]).to_array(), [a[0]; N]);
        assert_eq!(Vector::<T, N>::zero().to_array(), [zero; N]);
        let first = from_fn::<T, N, _>(|i| if i == 0 { a[0] } else { zero });
        assert_eq!(Vector::from_first(a[0]).to_array(), first);
        let iota = from_fn::<T, N, _>(|i| T::wrapping_from(i as i128));
        assert_eq!(Vector::<T, N>::iota().to_array(), iota);
        assert_eq!(x[black_box(N - 1)], a[N - 1]);
        let mut longer = vec![zero; N + 1];
        y.copy_to_slice(&mut longer);
        assert_eq!(longer, [&b[..], &[zero]].concat());
    }

    fn moves_in_blocks<T: Number + Int<N>, const N: usize>(random: &mut Random) {
        let [a, b] = [(); 2].map(|()| random.lanes::<T, N>());
        let (x, y, block) = (Vector::load(&a), Vector::load(&b), 16 / size_of::<T>());
        let blocks = |(first, second): (Vector<T, N>, Vector<T, N>), i: usize| {
            [
                &first.to_array()[i..][..block],
                &second.to_array()[i..][..block],
            ]
            .concat()
        };
        for i in (0..N).step_by(block) {
            let (a, b) = (&a[i..][..block], &b[i..][..block]);
            let in_turns: Vec<T> = a.iter().zip(b).flat_map(|(&a, &b)| [a, b]).collect();
            assert_eq!(blocks(x.interleave_in_blocks(y), i), in_turns);
            let every_other = |first| a.iter().chain(b).copied().skip(first).step_by(2);
            let even_then_odd: Vec<T> = every_other(0).chain(every_other(1)).collect();
            assert_eq!(blocks(x.deinterleave_in_blocks(y), i), even_then_odd);
        }
    }

    fn any_lanes<T: Number + Int<N>, const N: usize>(random: &mut Random) {
        let (a, b) = (random.lanes::<T, N>(), random.lanes());
        lanewise(a, b);
        lanewise(a, a);
        shifts(a, b);
        moves(a, b);
    }

    #[bun_simd::foreach_width(full, x128, x256)]
    mod width {
        use isa::{F32, F64, I8, I16, I32, I64, Mask, U8, U16, U32, U64, Vector};
        const N: usize = U8::LEN;

        pub fn pairs_of_bytes() {
            for (first, from) in (0..=255).flat_map(|a| (0..=255).step_by(N).map(move |b| (a, b))) {
                let a: [u8; N] = black_box([first; N]);
                let b: [u8; N] = black_box(from_fn(|i| from + i as u8));
                lanewise(a, b);
                lanewise(a.map(|a| a as i8), b.map(|b| b as i8));
                let (x, y) = (U8::load(&a), U8::load(&b));
                let each = |f: fn(u8, u8) -> u8| from_fn(|i| f(a[i], b[i]));
                assert_eq!(x.saturating_add(y).to_array(), each(u8::saturating_add));
                assert_eq!(x.saturating_sub(y).to_array(), each(u8::saturating_sub));
                let (p, q): (I8, I8) = (x.bitcast(), y.bitcast());
                let signed = |f: fn(i8, i8) -> i8| from_fn(|i| f(a[i] as i8, b[i] as i8));
                assert_eq!(p.saturating_add(q).to_array(), signed(i8::saturating_add));
                assert_eq!(p.saturating_sub(q).to_array(), signed(i8::saturating_sub));
                assert_eq!(x.abs_diff(y).to_array(), each(u8::abs_diff));
                let average = each(|a, b| (u16::from(a) + u16::from(b)).div_ceil(2) as u8);
                assert_eq!(x.average_round(y).to_array(), average);
                let (pairs, more) = x.interleave(y);
                let sums = [pairs, more].map(|it| U16::sums_of_2(it).to_array());
                assert_eq!(sums.concat(), b.map(|b| u16::from(first) + u16::from(b)));
                for last in first..=255 {
                    let want = b.map(|b| if (first..=last).contains(&b) { 255 } else { 0 });
                    let got = y.in_range(black_box(first..=last));
                    assert_eq!(got.to_vector().to_array(), want);
                }
            }
        }

        pub fn all_inputs() {
            let distinct: [u8; N] = from_fn(|i| 100 + i as u8);
            for by in 0..N {
                let want = from_fn(|i| i.checked_sub(by).map_or(0, |i| distinct[i]));
                let got = U8::load(&distinct).slide_up(black_box(by));
                assert_eq!(got.to_array(), want);
            }
            for index in (0..16).chain(128..=255) {
                for lane in 0..N {
                    let indices = from_fn(|i| if i == lane { index } else { 3 });
                    let want = from_fn(|i| match usize::from(indices[i]) {
                        index @ ..16 => distinct[i / 16 * 16 + index],
                        _ => 0,
                    });
                    let got = U8::load(&distinct).lookup(U8::load(black_box(&indices)));
                    assert_eq!(got.to_array(), want);
                }
            }
            for (index, lane) in (0..32).flat_map(|index| (0..N).map(move |lane| (index, lane))) {
                let indices = from_fn(|i| if i == lane { index } else { 31 - index });
                let want = from_fn(|i| match usize::from(indices[i]) {
                    index @ ..16 => distinct[i / 16 * 16 + index],
                    index => !distinct[i / 16 * 16 + index - 16],
                });
                let (lower, indices) = (U8::load(&distinct), U8::load(black_box(&indices)));
                assert_eq!(lower.lookup2(!lower, indices).to_array(), want);
            }
            for from in (0..=u16::MAX).step_by(N) {
                let all: [u16; N] = black_box(from_fn(|i| from + i as u16));
                let (a, b) = (U16::from_slice(&all), U16::from_slice(&all[N / 2..]));
                assert_eq!(U8::narrow(a, b).to_array(), all.map(|it| it as u8));
                let clamped = all.map(|it| (it as i16).clamp(0, 255) as u8);
                let got = U8::saturating_narrow(a.bitcast::<I16>(), b.bitcast());
                assert_eq!(got.to_array(), clamped);
                let packed = from_fn(|i| all[packed_from(i, N, 16)] as i16);
                let want = packed.map(|it| it.clamp(0, 255) as u8);
                assert_eq!(U8::pack(a.bitcast::<I16>(), b.bitcast()).to_array(), want);
                let want = packed.map(|it| it.clamp(-128, 127) as i8);
                assert_eq!(I8::pack(a.bitcast::<I16>(), b.bitcast()).to_array(), want);
                let want = a.to_array().map(|it| (it as i16).wrapping_abs());
                assert_eq!(a.bitcast::<I16>().abs().to_array(), want);
            }
            for (bits, at) in
                (0..1u64 << 16).flat_map(|it| (0..N).step_by(16).map(move |at| (it, at)))
            {
                let bits = bits << at;
                let bytes = black_box(from_fn(|i| (bits >> i & 1) as u8));
                let mask = U8::from_array(bytes).simd_eq(1);
                assert_eq!(mask.to_bitmask(), bits);
                assert_eq!(mask.first_set(), bits.lowest_one().map(|it| it as usize));
                let last = U8::rposition_near([&bytes], |[v]| v.simd_eq(1));
                assert_eq!(last, bits.highest_one().map(|it| it as usize));
                assert_eq!(
                    [mask.any(), mask.all()],
                    [bits != 0, bits.count_ones() == N as u32]
                );
            }
        }

        pub fn random_inputs(random: &mut Random) {
            any_lanes::<u8, { U8::LEN }>(random);
            any_lanes::<i8, { I8::LEN }>(random);
            any_lanes::<u16, { U16::LEN }>(random);
            any_lanes::<i16, { I16::LEN }>(random);
            any_lanes::<u32, { U32::LEN }>(random);
            any_lanes::<i32, { I32::LEN }>(random);
            any_lanes::<u64, { U64::LEN }>(random);
            any_lanes::<i64, { I64::LEN }>(random);
            moves_in_blocks::<u8, { U8::LEN }>(random);
            moves_in_blocks::<i16, { I16::LEN }>(random);
            moves_in_blocks::<u32, { U32::LEN }>(random);
            moves_in_blocks::<u64, { U64::LEN }>(random);

            let (a, b) = (random.lanes::<u8, N>(), random.lanes::<i8, N>());
            let (x, y) = (U8::load(&a), I8::load(&b));
            let words = from_fn(|i| u64::from_le_bytes(a.as_chunks().0[i]));
            assert_eq!(x.bitcast::<U64>().to_array(), words);
            let sums = from_fn(|i| a[8 * i..][..8].iter().copied().map(u64::from).sum());
            assert_eq!(U64::sums_of_8(x).to_array(), sums);
            let dots = from_fn(|i| saturating_dot(a.as_chunks().0[i], b.as_chunks().0[i]));
            assert_eq!(I16::saturating_pairwise_dot(x, y).to_array(), dots);
            assert_eq!(U16::widen_lower(x).to_array(), from_fn(|i| a[i].into()));
            assert_eq!(Some(x.reduce_max()), a.into_iter().max());
            assert_eq!(Some(y.reduce_max()), b.into_iter().max());
            let repeated = U8::repeat::<16>(*a.first_chunk().unwrap());
            assert_eq!(repeated.to_array(), from_fn(|i| a[i % 16]));
            assert_eq!(U8::repeat([a[0], a[1]]).to_array(), from_fn(|i| a[i % 2]));
            let (four, eight): ([u8; 4], [u8; 8]) = (from_fn(|i| a[i]), from_fn(|i| a[i]));
            assert_eq!(U8::repeat(four).to_array(), from_fn(|i| a[i % 4]));
            assert_eq!(U8::repeat(eight).to_array(), from_fn(|i| a[i % 8]));
            let [first, second] = x.halves();
            let swapped = U8::from_halves([second, first]);
            assert_eq!(swapped.to_array(), from_fn(|i| a[(i + N / 2) % N]));
            let [first, second] = x.bitcast::<U64>().halves();
            let got: U8 = U64::from_halves([second, first]).bitcast();
            assert_eq!(got.to_array(), swapped.to_array());
            let widened: I32 = Vector::from_slice(&a).cast();
            assert_eq!(widened.to_array(), from_fn(|i| a[i].into()));
            let is_negative = y.simd_lt(0).cast::<u8>().select(1, 0);
            assert_eq!(is_negative.to_array(), b.map(|b| u8::from(b < 0)));

            let (a, b) = (random.lanes::<i16, _>(), random.lanes::<i16, _>());
            let (x, y) = (I16::load(&a), I16::load(&b));
            assert_eq!((x * y).to_array(), from_fn(|i| a[i].wrapping_mul(b[i])));
            let product = |i: usize| i32::from(a[i]) * i32::from(b[i]);
            let dots = from_fn(|i| product(2 * i).wrapping_add(product(2 * i + 1)));
            assert_eq!(I32::pairwise_dot(x, y).to_array(), dots);
            let each = |f: fn(i16, i16) -> i16| from_fn(|i| f(a[i], b[i]));
            assert_eq!(x.saturating_add(y).to_array(), each(i16::saturating_add));
            assert_eq!(x.saturating_sub(y).to_array(), each(i16::saturating_sub));
            let (p, q): (U16, U16) = (x.bitcast(), y.bitcast());
            let got = y.simd_eq(0).select(0, x).mul_sign(y);
            assert_eq!(got.to_array(), each(|a, b| a.wrapping_mul(b.signum())));
            assert_eq!(Some(x.reduce_max()), a.into_iter().max());
            assert_eq!(Some(p.reduce_max()), p.to_array().into_iter().max());
            let each = |f: fn(u16, u16) -> u16| from_fn(|i| f(a[i] as u16, b[i] as u16));
            assert_eq!(p.saturating_add(q).to_array(), each(u16::saturating_add));
            assert_eq!(p.saturating_sub(q).to_array(), each(u16::saturating_sub));
            let b = b.map(|b| b.max(-i16::MAX));
            let want = from_fn(|i| ((i32::from(a[i]) * i32::from(b[i])) >> 16) as i16);
            assert_eq!(x.mul_high(I16::load(&b)).to_array(), want);
            let want = from_fn(|i| ((i32::from(a[i]) * i32::from(b[i]) + (1 << 14)) >> 15) as i16);
            assert_eq!(x.mul_q15(I16::load(&b)).to_array(), want);
            let [first, second] = x.halves();
            assert_eq!([first.to_array(), second.to_array()].concat(), a);
            assert_eq!(I16::from_halves([first, second]).to_array(), a);

            let all: [i32; N / 2] = random.lanes();
            let (x, y) = (I32::from_slice(&all), I32::from_slice(&all[N / 4..]));
            let clamped = all.map(|it| it.clamp(-32768, 32767) as i16);
            assert_eq!(I16::saturating_narrow(x, y).to_array(), clamped);
            let packed = from_fn(|i| clamped[packed_from(i, N / 2, 8)]);
            assert_eq!(I16::pack(x, y).to_array(), packed);

            let (a, [p, q]) = (random.lanes::<u16, _>(), random.lanes::<u16, 2>());
            let range = p.min(q)..=p.max(q);
            let want = a.map(|a| u16::from(range.contains(&a)));
            assert_eq!(U16::load(&a).in_range(range).select(1, 0).to_array(), want);

            let a = random.lanes();
            let clamped = a.map(|a: i32| a.clamp(0, 255) as u8);
            assert_eq!(I32::load(&a).saturating_cast_u8().to_array(), clamped);
            assert_eq!(Some(I32::load(&a).reduce_min()), a.into_iter().min());
            assert_eq!(I32::load(&a).abs().to_array(), a.map(i32::wrapping_abs));

            let (a, b) = (a.map(|a| a >> 12), random.lanes().map(|b: i32| b >> 20));
            let (x, y): (F32, F32) = (I32::load(&a).cast(), I32::load(&b).cast());
            let each = |f: fn(f32, f32) -> f32| from_fn(|i| f(a[i] as f32, b[i] as f32));
            assert_eq!((x + y).to_array(), each(|a, b| a + b));
            assert_eq!((x - y).to_array(), each(|a, b| a - b));
            assert_eq!((x * 0.333).to_array(), each(|a, _| a * 0.333));
            let clamped = each(|a, _| a.clamp(-5.5, 300.25));
            assert_eq!(x.simd_clamp(-5.5, 300.25).to_array(), clamped);
            let got = x.mul_add(F32::splat(0.333), y).to_array();
            let rounded = [each(|a, b| a.mul_add(0.333, b)), each(|a, b| a * 0.333 + b)];
            assert!(rounded.contains(&got));
            let truncated = a.map(|a| (a as f32 * 0.333) as i32);
            assert_eq!((x * 0.333).to_i32().to_array(), truncated);
            let want = from_fn(|i| a[i].min(b[i]) as f32);
            assert_eq!(x.simd_lt(y).select(x, y).to_array(), want);

            let [a, b]: [[f64; F64::LEN]; 2] = from_fn(|_| random.doubles());
            let (x, y) = (F64::load(&a), F64::load(&b));
            let each = |f: fn(f64, f64) -> f64| from_fn(|i| f(a[i], b[i]));
            assert_eq!((x + y).to_array(), each(|a, b| a + b));
            assert_eq!((x - y).to_array(), each(|a, b| a - b));
            assert_eq!((x * y).to_array(), each(|a, b| a * b));
            assert_eq!(x.min(y).to_array(), each(f64::min));
            let (even, odd) = x.interleave_in_blocks(y);
            assert_eq!(even.to_array(), from_fn(|i| [a, b][i % 2][i & !1]));
            assert_eq!(odd.to_array(), from_fn(|i| [a, b][i % 2][i | 1]));
            let a = a.map(|a| if a == 3.0 { f64::NAN } else { a });
            let x = F64::load(&a);
            let holds = |got: Mask<f64, { F64::LEN }>, want: fn(&f64, &f64) -> bool| {
                let want: [bool; F64::LEN] = from_fn(|i| want(&a[i], &b[i]));
                let bits = (0..F64::LEN).map(|i| u64::from(want[i]) << i).sum();
                assert_eq!(got.to_bitmask(), bits, "{a:?} {b:?}");
                assert_eq!(got.select(1.0, 0.0).to_array(), want.map(f64::from));
                let bytes = got.cast::<u8>();
                assert_eq!(bytes.select(1, 0).to_array(), want.map(u8::from));
                assert_eq!(
                    bytes.cast::<i64>().select(1, 0).to_array(),
                    want.map(i64::from)
                );
            };
            holds(x.simd_eq(y), f64::eq);
            holds(x.simd_ne(y), f64::ne);
            holds(x.simd_lt(y), f64::lt);
            holds(x.simd_le(y), f64::le);
            holds(x.simd_gt(y), f64::gt);
            holds(x.simd_ge(y), f64::ge);
            holds(x.simd_lt(y) | x.simd_eq(y), f64::le);
            holds(x.simd_le(y) & !x.simd_eq(y), f64::lt);
            holds(x.simd_ge(y) ^ x.simd_gt(y), f64::eq);

            let (a, b) = (random.lanes::<u64, _>(), random.lanes::<u64, _>());
            let (x, y) = (U64::load(&a), U64::load(&b));
            let products = from_fn(|i| (a[i] & 0xFFFF_FFFF) * (b[i] & 0xFFFF_FFFF));
            assert_eq!(x.mul_low32(y).to_array(), products);
            assert_eq!(x.reduce_sum(), a.into_iter().fold(0, u64::wrapping_add));
            assert_eq!(x.cast::<i8>().to_array(), a.map(|a| a as i8));

            let bits = random.next();
            let parities = (0..64).fold(0, |parities, shift| parities ^ bits << shift);
            assert_eq!(isa::prefix_xor(bits), parities);

            let block = random.lanes();
            let bits = |test: fn(u8) -> bool| (0..64).map(|i| u64::from(test(block[i])) << i).sum();
            let got = U8::bitmasks(&block, |v| [v.simd_gt(100), (v & 3).simd_eq(0)]);
            assert_eq!(got, [bits(|b| b > 100), bits(|b| b & 3 == 0)]);
            let pairs = block.map(|byte| [byte, 0]);
            let first = |pairs: &[[u8; 2]; N]| U8::from_array(pairs.map(|[first, _]| first));
            let got = U8::bitmasks_of_chunks(&pairs, |pairs| [first(pairs).simd_gt(100)]);
            assert_eq!(got, [bits(|b| b > 100)]);
        }
    }

    fn planes<const N: usize>(quads: &[[u8; 4]; N]) -> [Vector<u8, N>; 4]
    where
        u8: Int<N>,
    {
        let planes = Vector::load_interleaved4(quads);
        for (i, plane) in planes.iter().enumerate() {
            assert_eq!(plane.to_array(), quads.map(|quad| quad[i]));
        }
        let pairs = Vector::to_interleaved2([planes[0], planes[3]]);
        assert_eq!(pairs, quads.map(|[a, .., d]| [a, d]));
        planes
    }

    fn interleaved<const N: usize>(random: &mut Random)
    where
        u8: Int<N>,
    {
        let quads: [_; N] = from_fn(|_| random.lanes());
        assert_eq!(Vector::to_interleaved4(planes(&quads)), quads);
    }

    fn bit_indices(random: &mut Random) {
        let [a, b, c, d] = random.lanes::<u64, 4>();
        for bits in [
            0,
            a & b & c & d & a >> 7,
            a & b & c,
            a & b,
            a,
            a | b,
            a | b | c,
            !0,
        ] {
            let base = u32::MAX - 63;
            let want: Vec<u32> = (0..64)
                .filter(|i| bits >> i & 1 != 0)
                .map(|i| base + i)
                .collect();
            let mut room = [0; 65];
            let mut out = Out::from(&mut room[..]).into_writer();
            out.push([7]);
            isa::bit_indices(black_box(bits)).push_to(&mut out, base);
            assert_eq!(out.finish()[1..], want);
        }
    }

    #[export]
    pub fn no_bit_indices(room: &mut [u32]) {
        isa::bit_indices(0).push_to(&mut Out::from(room).into_writer(), 0);
    }

    #[export]
    pub fn pairs_of_bytes() {
        width::full::pairs_of_bytes();
        width::x128::pairs_of_bytes();
        width::x256::pairs_of_bytes();
    }

    #[export]
    pub fn all_inputs() {
        width::full::all_inputs();
        width::x128::all_inputs();
        width::x256::all_inputs();
    }

    #[export]
    pub fn slide_out() {
        U8::zero().slide_up(U8::LEN);
    }

    #[export]
    pub fn random_inputs(rounds: usize) {
        let random = &mut Random(88172645463325252);
        for _ in 0..rounds {
            width::full::random_inputs(random);
            width::x128::random_inputs(random);
            width::x256::random_inputs(random);
            let [a, b] = [(); 2].map(|()| random.lanes::<i16, 8>());
            let products = from_fn(|i| i32::from(a[i]) * i32::from(b[i]));
            let got = isa::x128::I16::load(&a).widening_mul(Vector::load(&b));
            assert_eq!(got.to_array(), products);
            bit_indices(random);
            let (word, lanes) = (random.next(), from_fn(|_| random.next() as i16));
            assert_eq!(bun_simd::opaque(word), word);
            assert_eq!(isa::x128::I16::load(&lanes).opaque().to_array(), lanes);
            assert_eq!(U8::iota().opaque().to_array(), U8::iota().to_array());
            isa::x128::I16::load(&lanes).keep();
            let (a, b) = (random.lanes::<u8, 16>(), random.lanes::<u8, 16>());
            let b = from_fn(|i| if i & 4 == 0 { b[i] } else { a[i] });
            let sum = |i: usize| {
                (4 * i..4 * i + 4)
                    .map(|i| u32::from(a[i].abs_diff(b[i])))
                    .sum()
            };
            let got = isa::x128::U32::sums_of_4_abs_diffs(Vector::load(&a), Vector::load(&b));
            assert_eq!(got.to_array(), from_fn(sum));
            let a: [i32; 4] = random.lanes();
            let doubles: isa::x256::F64 = Vector::load(&a).cast();
            assert_eq!(doubles.to_array(), a.map(f64::from));
            let truncated = a.map(|a| (f64::from(a) * 0.999) as i32);
            assert_eq!((doubles * 0.999).to_i32().to_array(), truncated);
            let a: [u64; 4] = random.lanes();
            for bits in 0..16 {
                let want: Vec<u64> = (0..4)
                    .filter(|i| bits >> i & 1 != 0)
                    .map(|i| a[i])
                    .collect();
                let got = Vector::load(&a).compress(black_box(bits)).to_array();
                assert_eq!(got[..want.len()], want);
            }
            let (all, starts): ([u16; 9], [u32; 4]) = (random.lanes(), random.lanes());
            let want = starts.map(|at| all[at.min(6) as usize..].first_chunk::<3>().unwrap());
            assert_eq!(Vector::load(&starts).windows(&all), Some(want));
            any_lanes::<u8, 8>(random);
            any_lanes::<u8, 64>(random);
            any_lanes::<i32, 16>(random);
            planes::<8>(&from_fn(|_| random.lanes()));
            interleaved::<16>(random);
            interleaved::<32>(random);
            interleaved::<64>(random);
        }
    }

    #[export]
    pub fn all_dots() {
        for a in (0..=u16::MAX).map(u16::to_le_bytes) {
            for from in (0..=u16::MAX).step_by(U8::LEN / 2) {
                let (x, y) = (
                    isa::U16::splat(u16::from_le_bytes(a)),
                    isa::U16::iota() + from,
                );
                let got = isa::I16::saturating_pairwise_dot(x.bitcast::<U8>(), y.bitcast());
                let bytes = |b: u16| b.to_le_bytes().map(|b| b as i8);
                let want = y.to_array().map(|b| saturating_dot(a, bytes(b)));
                assert!(black_box(got.to_array()) == want, "{a:?} {from}");
            }
        }
    }
}

#[test]
fn pairs_of_bytes() {
    on_each_target(simd::pairs_of_bytes);
}

#[test]
fn all_inputs() {
    on_each_target(simd::all_inputs);
}

#[test]
fn random_inputs() {
    on_each_target(|| simd::random_inputs(300));
}

#[test]
#[should_panic = "by < N"]
fn slide_out() {
    simd::slide_out();
}

#[test]
#[should_panic = "remaining() >= 64"]
fn bit_indices_without_room() {
    simd::no_bit_indices(&mut [0; 63]);
}

#[test]
#[cfg(debug_assertions)]
fn portable_ops_check_their_input() {
    use bun_simd::portable::{I32, U32, Vector};
    fn last<T: Lane + Default, const N: usize>(lane: T) -> Vector<T, N> {
        Vector::from_array(from_fn(|i| [T::default(), lane][(i + 1) / N]))
    }
    let calls: [fn(); _] = [
        || _ = last::<_, 4>(f64::NAN).min(last(0.0)),
        || _ = last::<_, 4>(0.0).min(last(f64::NAN)),
        || _ = last::<_, 4>(f64::NAN).min(last(f64::NAN)),
        || _ = last::<f64, 4>(2147483648.0).to_i32(),
        || _ = last::<f64, 4>(-2147483649.0).to_i32(),
        || _ = last::<_, 4>(f64::NAN).to_i32(),
        || _ = last::<f32, 4>(2147483648.0).to_i32(),
        || _ = last::<f32, 4>(-3e9).to_i32(),
        || _ = last::<u64, 4>(0).compress(16),
        || _ = last::<u64, 4>(0).compress(17),
        || _ = last::<u8, 16>(0).lookup(last(16)),
        || _ = last::<u8, 16>(0).lookup(last(127)),
        || _ = last::<u8, 16>(0).lookup2(last(0), last(32)),
        || _ = last::<u8, 16>(0).lookup2(last(0), last(33)),
        || _ = last::<_, 8>(i16::MIN).mul_q15(last(i16::MIN)),
        || _ = last::<_, 8>(i16::MIN).mul_high(last(i16::MIN)),
        || _ = last::<i16, 8>(1).mul_sign(last(0)),
        || _ = last::<i16, 8>(-1).reverse().mul_sign(last(0)),
        || _ = I32::zero().add_dot::<16>(last(0), last(-1)),
        || _ = U32::sums_of_4_abs_diffs(last(0), last(1)),
        || _ = U32::sums_of_4_abs_diffs(last(0), U32::from_array([0, 1, 0, 0]).bitcast()),
        || _ = U32::sums_of_4_abs_diffs(last(0), U32::from_array([0, 1, 0, 1]).bitcast()),
    ];
    for (i, call) in calls.into_iter().enumerate() {
        assert!(std::panic::catch_unwind(call).is_err(), "{i}");
    }
    let largest = 2147483648f32.next_down();
    assert_eq!(
        last::<_, 4>(largest).to_i32().to_array(),
        [0, 0, 0, largest as i32]
    );
}

#[test]
#[ignore = "slow"]
fn more_random_inputs() {
    on_each_target(|| simd::random_inputs(50_000));
}

#[test]
#[ignore = "slow"]
fn all_dots() {
    on_each_target(simd::all_dots);
}

#[bun_simd::foreach_target(
    avx512_icl,
    avx2 + "vpclmulqdq",
    sse4 + "pclmulqdq",
    neon + "aes",
    portable
)]
mod carryless_simd {
    use isa::U64;

    #[export]
    pub fn products() {
        let product = |a: u64, b: u64| {
            let shifted = (0..64).map(|bit| u128::from(a * (b >> bit & 1)) << bit);
            shifted.fold(0, |all, it| all ^ it).to_le_bytes()
        };
        let random = &mut Random(1);
        for _ in 0..if cfg!(miri) { 2 } else { 1000 } {
            let [a, b]: [[u64; U64::LEN]; 2] = [random.lanes(), random.lanes()];
            let (x, y) = (U64::from_array(a), U64::from_array(b));
            for (at, got) in [(0, x.carryless_mul_lower(y)), (1, x.carryless_mul_upper(y))] {
                let want: [_; U64::LEN / 2] = from_fn(|i| product(a[2 * i + at], b[2 * i + at]));
                assert_eq!(got.bitcast::<isa::U8>().to_array(), want.as_flattened());
            }
        }
    }
}

#[bun_simd::foreach_target(avx512_icl, avx2, sse4, neon + "dotprod", portable)]
mod dot_simd {
    use isa::{I8, I32, U8};

    #[export]
    pub fn sums() {
        let random = &mut Random(1);
        for _ in 0..if cfg!(miri) { 2 } else { 1000 } {
            let (sums, a): ([i32; I32::LEN], [u8; U8::LEN]) = (random.lanes(), random.lanes());
            let b: [i8; I8::LEN] = random.lanes();
            let b = b.map(|it| if I8::LEN == 16 { it & 127 } else { it });
            let product = |i: usize| i32::from(a[i]) * i32::from(b[i]);
            let want = from_fn(|i| sums[i].wrapping_add((4 * i..4 * i + 4).map(product).sum()));
            let got = I32::from_array(sums).add_dot(U8::from_array(a), I8::from_array(b));
            assert_eq!(got.to_array(), want);
        }
    }
}

#[bun_simd::foreach_target(sse4, neon + "crc", portable)]
mod crc_simd {
    #[export]
    pub fn states() {
        let step = |crc, word: &[u8; 8]| isa::crc32_u64(crc, u64::from_le_bytes(*word));
        let words = black_box([b"The quic", b"k brown ", b"fox jump"]);
        assert_eq!(!words.into_iter().fold(!0, step), 0x8E59_80B4);
    }
}

fn nothing() {}

#[bun_simd::foreach_target(avx512_icl, portable64)]
mod icl_simd {
    use isa::{U8, U64};

    #[export(or = nothing)]
    pub fn bytes() {
        let random = &mut Random(1);
        for _ in 0..1000 {
            let [a, b, c]: [[u8; 64]; 3] = from_fn(|_| from_fn(|_| random.next() as u8));
            let got = U8::from_array(a).lookup2_across(U8::from_array(b), U8::from_array(c));
            let want = c.map(|index| [a, b].as_flattened()[usize::from(index % 128)]);
            assert_eq!(got.to_array(), want);

            let [bits] = random.lanes::<u64, 1>();
            let want = Vec::from_iter((0..64).filter(|i| bits & 1 << i != 0).map(|i| a[i]));
            assert!(
                U8::from_array(a)
                    .compress(bits)
                    .to_array()
                    .starts_with(&want)
            );

            let (lanes, mut want) = (random.lanes::<u64, 8>(), [0; 64]);
            for bit in 0..512 {
                want[bit % 64] += u8::from(lanes[bit / 64] & 1 << (bit % 64) != 0);
            }
            let got = U8::count_by_position(U64::from_array(lanes));
            assert_eq!(got.to_array(), want);
        }
    }
}

#[bun_simd::foreach_target(avx512_icl, avx512_skx, portable64)]
mod zmm_simd {
    use isa::{U32, U64};

    #[export(or = nothing)]
    pub fn words() {
        let random = &mut Random(1);
        for _ in 0..1000 {
            let [a, b]: [[u32; 16]; 2] = [random.lanes(), random.lanes()];
            let (x, y) = (U32::from_array(a), U32::from_array(b));
            assert_eq!(x.lookup_across(y).to_array(), b.map(|i| a[i as usize & 15]));
            let twice = |i: usize| u64::from(a[i]) * 0x1_0000_0001;
            let want = from_fn(|i| (twice(i) >> (32 - b[i] % 32)) as u32);
            assert_eq!(x.rotate_left(y).to_array(), want);

            let [a, b, c]: [[u64; 8]; 3] = from_fn(|_| random.lanes());
            let (mut x, y) = (U64::from_array(a), U64::from_array(b));
            let twice = |i: usize| u128::from(a[i]) << 64 | u128::from(a[i]);
            let want = from_fn(|i| (twice(i) >> (64 - b[i] % 64)) as u64);
            assert_eq!(x.rotate_left(y).to_array(), want);
            let carries = x.add_bits(y, U64::from_array(c));
            for at in 0..512 {
                let bit = |of: [u64; 8]| of[at / 64] >> (at % 64) & 1;
                let got = bit(x.to_array()) + 2 * bit(carries.to_array());
                assert_eq!(got, bit(a) + bit(b) + bit(c));
            }
        }
    }
}

#[test]
fn ops_of_512_bits() {
    on_each_target(icl_simd::bytes);
    on_each_target(zmm_simd::words);
}

#[test]
fn ops_with_further_features() {
    on_each_target(crc_simd::states);
    on_each_target(carryless_simd::products);
    on_each_target(dot_simd::sums);
}
