//! Both sides of the limits of types: what just fits has to be right.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::generic::*;
#[path = "framework/misfits.rs"]
#[macro_use]
#[allow(unused_macros)]
mod misfits;

#[kernel]
fn narrow(x: u8) {
    let (v, one) = (u8x16::iota(x), u64x1::splat(x as u64));
    assert_eq!([v.lane::<0>(), v.lane::<5>(), v.lane::<15>()], [x, x + 5, x + 15]);
    assert_eq!((one.to_lanes(), one.simd_eq(one).to_lanes(), u64x1::from_lanes([x as u64])), ([x as u64], [true], one));
    assert_eq!([Simd::transpose([one]), Simd::transpose_in_blocks([one])], [[one]; 2]);
    assert_eq!(Simd::transpose_blocks([v]), [v]);
    assert_eq!([v.as_u128s().swizzle(|_| 0), v.as_u128s().concat_swizzle(!v, |_| 1)], [v, !v]);
    let mut sums = [0; 2];
    over(&[x; 17]).by::<B8>().pad(0).map_into(&mut sums, |v| v.sum_groups::<u64>());
    assert_eq!(sums, [8 * x as u64; 2]);
    let (four, reverse) = (u8x4::iota(x), 0x8040_2010_0804_0201);
    assert_eq!(four.galois_affine(reverse), four.reverse_bits());
    assert_eq!(four.galois_affine_inverse(reverse).reverse_bits().galois_mul(four), 1);
    let (half, brain) = (f16x8::splat(f16::from_f32(x as f32)), bf16x8::splat(bf16::from_f32(x as f32)));
    assert_eq!(brain.mat_mul_add_relaxed::<f32>(brain, 1.0), (4 * x * x + 1) as f32);
    assert_eq!([half.cast::<f32>(), brain.cast()], [f32x8::splat(x as f32); 2]);
    assert_eq!((f32x8::splat(x as f32).cast(), u8x8::splat(x).cast(), half.cast()), (half, brain, u8x8::splat(x)));
    assert_eq!((half.widen(), f32x8::splat(x as f32).saturating_cast()), ([f32x4::splat(x as f32); 2], half));
    assert_eq!(f32x4::splat(x as f32).narrow(x as f32), half);
    let many = vec![x as u16; 8 << 16];
    assert_eq!(over(&many).by::<B16>().zip(&many).count(|(a, b)| a.simd_eq(b)), many.len());
    let rows = |width| u8x16::load_row(Rows::new(&[x; 6], 3, width, 2), 1).reduce_sum();
    assert_eq!([rows(0), rows(1), rows(3)], [0, x, 3 * x]);
    let (least, n) = (bf16x8::splat(bf16::from_bits(1)), i16x8::from([0, 1, 133, 260, 261, i16::MAX, -2, i16::MIN]));
    assert_eq!(least.ldexp(n).to_bits(), [1, 2, 0x3f80, 0x7f00, 0x7f80, 0x7f80, 0, 0]);
    let most = bf16x8::splat(bf16::from_bits(0x7f00));
    assert_eq!(most.ldexp(!n).to_bits(), [0x7e80, 0x7e00, 0x3c00, 0, 0, 0, 0x7f80, 0x7f80]);
}

#[kernel]
fn wide(x: u8) {
    let (v, words) = (Simd::<u8, B256, S>::iota(x), Simd::<u16, B128, S>::iota(0x100 + x as u16));
    assert_eq!(v.concat(!v).split(), [v, !v]);
    assert_eq!(v.simd_eq(x).concat(v.simd_ne(x)).split(), [v.simd_eq(x), v.simd_ne(x)]);
    assert_eq!(v.cast_mul::<u16>(255), v.cast::<u16>() * 255);
    assert_eq!(Simd::<i16, B256, S>::splat(x as i16).cast_mul_q15_add(3, 1), 6 * x as i32 + 1);
    assert_eq!(Simd::<f64, B512, S>::splat(x as f64).cast_relaxed::<i32>(), x as i32);
    assert_eq!(Simd::<u8, B128, S>::splat(0x3c).from_minifloat::<f32>(Minifloat::E5M2), 1.0);
    assert_eq!([v.as_u128s().shift_elements_left::<16>(!v), v.as_u128s().shift_elements_right::<16>(!v)], [!v; 2]);
    let mut bytes = [0; 128];
    assert_eq!(words.store_low_bytes(&mut bytes, 1 << 63), 65);
    assert_eq!(
        Simd::load_low_bytes(&bytes, 1 << 63),
        (words.with_lane::<63>(0) & 255 | words.shift_elements_left::<63>(0).reverse(), 65)
    );
    for n in [x as u32, 16] {
        let want = words.to_array().as_ref().iter().map(|it| it.rotate_left(n)).collect::<Vec<_>>();
        assert_eq!([words.funnel_shl(words, n), words.funnel_shr(words, 16 - n)], [Simd::load(&want); 2]);
    }
    assert_eq!([words.funnel_shl(!words, 8), words.funnel_shr(!words, 8)], [words << 8 | 0xfe; 2]);
}

#[kernel(icelake, avx512, avx2, sse4, neon)]
fn places(n: usize) {
    assert_eq!((u8x64::iota(1).lane_dyn(n), u16x32::iota(257).lane_dyn(n / 2)), (1 + n as u8, 257 + n as u16 / 2));
    let (mut table, at) = ([0; 16], u32x16::iota(n as u32) & 15);
    (at + 1).scatter(&mut table, at);
    assert_eq!(u32x16::iota(1), table);
    let mut all = [1u8; 64];
    let mut cells = as_cells(&mut all[..n]);
    over(cells).by::<B16>().zip(cells).map_into(&mut cells, |(a, b)| a + b);
    assert_eq!(all[..n], [2; 64][..n]);
    assert_eq!((set_bit_positions(1 << n, 0, &mut all[..]), all[0]), (1, n as u8));
}

#[test]
fn all_places() {
    for it in places::targets() {
        (0..64).for_each(|n| places::to(it, n).unwrap());
    }
}

#[test]
fn just_fits() {
    for it in narrow::targets() {
        (narrow::to(it, 3), wide::to(it, 3)).0.unwrap();
    }
    let mut all = [0; 4];
    *all.sub_array_mut::<1, 2>() = [1, 2];
    assert_eq!(all, [0, 1, 2, 0]);
    let bytes = Aligned([0u8; 6]);
    assert_eq!(try_bitcast_slice(bytes[2..].as_chunks::<4>().0), Some(&[[0u16; 2]][..]));
}

#[test]
fn too_many() {
    type V = u32x4<Baseline>;
    type Bytes<W> = Simd<u8, W, Baseline>;
    let (v, more) = (V::zero(), u32x8::<Baseline>::zero());
    misfits! {
        "one index for each lane": V::gather_interleaved::<2, _>(&[0; 9], more), V::gather_bytes(&[0; 9], more);
        "as many lanes": Bytes::<B512>::over(&[0u8; 9]).enumerate::<u16>(), V::over(&[0u32; 9]).selected(&[1u64]).map_into(&mut [0; 9], |_| more),
            V::over(&[0u32; 9]).map_until(&mut [0; 9], |v| v.simd_eq(1), |_| more), V::over(&[0u32; 9]).filter_map_into(&mut [0; 9], |v| (v.simd_eq(0), more)),
            V::over(&[0u32; 9]).stream_into(&mut [0; 9], |_| more), V::over(&[0u32; 9]).zip(&[0u32; 9]).stream_into(&mut [0; 9], |(_, _)| more),
            Bytes::<B128>::zero().lookup_or(&[0u64; 2], 0);
        "as many rows": Simd::transpose([v; 5]);
        "too short": v.simd_eq(0).store_bitmask(&mut [0; 0]);
        "": V::gather_or_default(&[0], more), v.scatter(&mut [0], more), v.to_lanes::<5>(), V::from_lanes([0; 3]), v.simd_eq(0).to_lanes::<5>();
    }
}
