//! What doesn't fit the types is refused on all targets: no path of a target returns before the check.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{crypto::*, mem::*, target::*, *};
#[path = "framework/misfits.rs"]
#[macro_use]
mod misfits;
#[path = "framework/on.rs"]
mod on;
use on::*;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn operations() {
    let s: S = bun_simd::prelude::isa();
    let (d, v, bytes, one, two) = (d!(s u16 B16), v!(s u16 B16), v!(s u8 B16), v!(s u64 B8), v!(s u8 B2));
    let (short, wide) = (v!(s u8 B8), v!(s u32 B16));
    misfits! { "":
        v!(s u64 B4), two.bitcast::<u32>(), two.abs_diff_sum::<u64>(two), v!(s u32 B2),
        v!(s u16 B512).cast::<u32>(), v!(s u16 B512).saturating_cast::<u32>(), v!(s u16 B2).cast::<u8>(),
            v!(s f32 B512).cast_relaxed::<i64>(), v!(s f32 B512).round_cast::<i64>(), v!(s f32 B512).round_cast_relaxed::<i64>(),
        two.widen::<u16>(), two.widen_even::<f16>(), two.widen_odd::<bf16>(),
        two.split(), two.simd_eq(0).split(), one.simd_eq(0).split(), v!(s u32 B4).simd_eq(0).split(),
        d!(s u64 B32).load_3_of_4(&[0; 4]), v!(s u64 B32).store_3_of_4(&mut [0; 4]),
        s.from_parts::<u8, B8, B16>(|_| bytes), short.for_each_part(|_, _: Simd<u8, B16, _>| ()),
        v!(s u8 B512).concat(v!(s u8 B512)), v!(s u8 B512).cast_mul::<u16>(1), v!(s i16 B512).cast_mul_q15_add(1, 1),
        v!(s u8 B128).simd_eq(0).to_bitmask(), v!(s u8 B128).compress(1), v!(s u8 B128).compress(v!(s u8 B128).simd_eq(0)), v!(s u16 B256).simd_eq(0).iter(),
        one.split(), d!(s u8 B2).from_halves([two; 2]),
        bytes.saturating_narrow::<u8>(bytes), bytes.in_blocks().saturating_narrow::<u8>(bytes), bytes.wrapping_narrow::<u8>(bytes),
            bytes.simd_eq(0).narrow(bytes.simd_eq(0)), bytes.in_blocks().widen::<u8>(),
        bytes.widen::<u8>(), v.cast_mul::<u16>(v),
        short.in_blocks().shift_elements_left::<9>(short), v.in_blocks().shift_elements_left::<9>(v),
            short.in_blocks().shift_elements_left::<9>(short), short.in_blocks().shift_elements_right::<9>(0), short.in_blocks().shift_elements_left::<9>(0),
            v.in_blocks().shift_elements_right::<9>(0), v.in_blocks().shift_elements_left::<9>(0),
        v.shift_elements_left::<9>(v), v.shift_elements_right::<9>(v),
            v.to_mask().shift_elements_left::<9>(v.to_mask()), v.to_mask().shift_elements_right::<9>(v.to_mask()),
        Output::overwrite(&mut [0; 256]).push((v!(s u32 B256)).low_bytes(0)),
        v.block::<1>(), v.with_block::<1>(v), v.as_u128s().splat_lane::<1>(),
        v.in_blocks().splat_lane::<8>(), v.splat_lane::<8>(),
        one.swap_pairs(), two.swizzle_groups([3, 2, 1, 0]), wide.swizzle_groups([7, 6, 5, 4, 3, 2, 1, 0]), two.swizzle_groups([2, 3, 0, 1]), two.swizzle_groups([1, 2, 3, 0]), two.swizzle_groups([3, 0, 1, 2]),
            two.swizzle_groups([0, 0, 0, 0]), one.swizzle_groups([1, 0]), one.swizzle_groups([0, 0]), one.swizzle_groups([1, 1]), one.concat_halves::<0, 0>(one), one.concat_halves::<1, 0>(one),
        short.in_blocks().concat_lookup_bytes_relaxed(short, short), short.aes_round(0), short.aes_last_round(0), short.aes_round_inv(0),
            short.aes_last_round_inv(0), short.aes_inv_mix_columns(), short.aes_key_gen_assist::<1>(), Simd::aes_encrypt([short], &[[0; 16]; 2]), one.carryless_mul_odd(one),
        v!(s u16 B2).sum_groups::<u32>(),
        d.gather_or_default(&[0], wide), v.scatter(&mut [0], wide), bytes.widen_even::<u8>(), bytes.widen_odd::<u8>(),
            short.mat_mul_add::<u32>(short, 0),
            one.widening_mul_even(one), one.widening_mul_odd(one), v!(s u16 B2).dot::<u32>(1),
            v!(s u16 B4).dot_add::<u64>(1, 1),
            short.in_blocks().sliding_abs_diff_sum::<0, 0>(short), short.in_blocks().is_in(short), short.in_blocks().is_in_relaxed(short), short.in_blocks().count_in(short),
            Sha256::schedule([v!(s u32 B8); 4]), v!(s u32 B8).sm4_rounds4(v!(s u32 B8)), v!(s u32 B8).sm4_next_keys(v!(s u32 B8)),
            two.concat_swizzle_groups(two, [0; 4]), Simd::transpose_in_blocks([v; 4]),
            Simd::transpose([v; 4]),
        two.sum_groups::<u32>(), two.cast_signed().sum_groups::<i32>(), v!(s u16 B4).sum_groups::<u64>(), v!(s i16 B4).sum_groups::<i64>(), v!(s u8 B4).sum_groups::<u64>(), v!(s i8 B4).sum_groups::<i64>(),
        v!(s i16 B2).sum_groups::<i32>(), v!(s u32 B4).sum_groups::<u64>(), v!(s i32 B4).sum_groups::<i64>(), v!(s f32 B4).sum_groups::<f64>(), v!(s f16 B2).sum_groups::<f32>(), v!(s bf16 B2).sum_groups::<f32>(),
        two.abs_diff_sum::<u32>(1), v!(s i8 B2).abs_diff_sum::<i32>(1), v!(s i8 B4).abs_diff_sum::<i64>(1), v!(s u16 B4).abs_diff_sum::<u64>(1), v!(s u16 B2).abs_diff_sum::<u32>(1), v!(s f32 B4).abs_diff_sum::<f64>(1.0),
        two.dot::<u32>(1), two.dot::<i32>(1), v!(s i8 B2).dot::<i32>(1), v!(s i16 B2).dot::<i32>(1), v!(s u32 B4).dot::<u64>(1), v!(s i32 B4).dot::<i64>(1), v!(s i16 B4).dot::<i64>(1),
        v!(s f16 B2).dot::<f32>(f16::MAX), v!(s bf16 B2).dot::<f32>(bf16::MAX), v!(s i16 B2).dot_add::<i32>(1, 1), v!(s u16 B2).dot_add::<u32>(1, 1), v!(s u32 B4).dot_add::<u64>(1, 1),
        two.dot_add_relaxed::<i32>(1, 1), two.dot_add_relaxed::<u32>(1, 1), v!(s i8 B2).dot_add_relaxed(v!(s i8 B2), 1), v!(s i16 B2).dot_add_relaxed(1, 1), v!(s bf16 B2).dot_add_relaxed(bf16::MAX, 1.0), v!(s i16 B2).saturating_dot_add(1, 1),
        v!(s i8 B8).mat_mul_add::<i32>(1, 1), short.mat_mul_add::<i32>(1, 1), v!(s bf16 B8).mat_mul_add_relaxed(bf16::MAX, 1.0),
        v!(s u16 B2).widening_mul_even(1), v!(s i16 B2).widening_mul_odd(1), v!(s u32 B4).widening_mul_even(1), v!(s i32 B4).widening_mul_odd(1), v!(s u16 B2).widening_mul(1), v!(s i32 B4).widening_mul(1),
        v!(s u64 B16).widening_mul_add(1, [v!(s u64 B16); 2]), v!(s i64 B32).widening_mul_add(1, [v!(s i64 B32); 2]), v!(s u64 B8).cast_mul::<u64>(1), v!(s u32 B16).cast_mul::<u32>(1),
        math::PairSums::new().mul_add(v!(s u64 B16), 1), math::PairSums::new().mul_add(v!(s i64 B32), 1), math::PairSums::new().mul_add(one, 1), math::PairSums::new().mul_add(v!(s u16 B2), 1),
        math::AbsDiffSums::<B4, S>::new().total(), v!(s i8 B8).in_blocks().sliding_abs_diff_sum::<1, 3>(1), short.in_blocks().shuffled_abs_diff_sum::<0>(1),
        v!(s u16 B2).widen::<u32>(), v!(s i16 B2).widen_even::<i32>(), v!(s i32 B4).widen_odd::<i64>(), v!(s f32 B4).widen::<f64>(), v!(s f32 B4).widen_even::<i64>(), v!(s bf16 B2).widen_even::<f32>(), v!(s f16 B2).widen_odd::<f32>(),
        v!(s u64 B16).widen::<u64>(), v!(s i64 B32).widen_even::<i64>(), v!(s u64 B32).in_blocks().widen::<u64>(), v!(s u16 B2).in_blocks().widen::<u32>(),
        v!(s i64 B16).saturating_narrow::<i64>(1), v!(s u64 B32).wrapping_narrow::<u64>(1), v!(s i64 B32).in_blocks().saturating_narrow::<i64>(1), v!(s i8 B32).saturating_narrow::<i8>(1),
        v!(s f16 B2).widening_mul_add(f16::MAX, [v!(s f32 B2); 2]), v!(s f16 B512).cast::<f32>(), v!(s f32 B4).cast::<u8>(), v!(s f32 B4).round_cast::<i8>(), v!(s f64 B8).cast_relaxed::<u8>(), v!(s f64 B8).round_cast_relaxed::<i8>(),
        v!(s i32 B4).saturating_cast::<u8>(), v!(s u8 B128).cast::<f64>(), v!(s bf16 B256).round_cast::<i64>(), v!(s u8 B512).concat(1);
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn more() {
    let s: S = bun_simd::prelude::isa();
    let (a, b) = (v!(s f32 B4), v!(s f64 B8));
    misfits! {
        "": a.complex_mul(a), a.complex_mul_conj(a), a.complex_mul_relaxed(a), a.complex_mul_conj_relaxed(a), a.complex_mul_add_relaxed(a, a),
            a.complex_mul_conj_add_relaxed(a, a), a.add_times_i(a), a.sub_times_i(a), b.complex_mul(b), b.sub_times_i(b), b.to_bits().carryless_dot_add(1, 1);
    }
    misfits! {
        "half as wide": v!(s u64 B16).widening_mul(1), v!(s i64 B16).widening_mul(1), v!(s u64 B32).widening_mul(1), v!(s i64 B64).widening_mul(1);
        "more than the number of lanes": v!(s u8 B2).simd_eq(0).shift_elements_left::<3>(false), v!(s u8 B2).simd_eq(0).shift_elements_left::<3>(true), v!(s u8 B2).simd_eq(0).shift_elements_left::<3>(v!(s u8 B2).simd_eq(1)), v!(s u8 B2).simd_eq(0).shift_elements_right::<3>(false), v!(s u8 B2).simd_eq(0).shift_elements_right::<3>(true), v!(s u8 B2).simd_eq(0).shift_elements_right::<3>(v!(s u8 B2).simd_eq(1)),
            v!(s u8 B4).simd_eq(0).shift_elements_left::<5>(false), v!(s u8 B4).simd_eq(0).shift_elements_left::<5>(true), v!(s u8 B4).simd_eq(0).shift_elements_left::<5>(v!(s u8 B4).simd_eq(1)), v!(s u8 B4).simd_eq(0).shift_elements_right::<5>(false), v!(s u8 B4).simd_eq(0).shift_elements_right::<5>(true), v!(s u8 B4).simd_eq(0).shift_elements_right::<5>(v!(s u8 B4).simd_eq(1)),
            v!(s u16 B4).simd_eq(0).shift_elements_left::<3>(false), v!(s u16 B4).simd_eq(0).shift_elements_left::<3>(true), v!(s u16 B4).simd_eq(0).shift_elements_left::<3>(v!(s u16 B4).simd_eq(1)), v!(s u16 B4).simd_eq(0).shift_elements_right::<3>(false), v!(s u16 B4).simd_eq(0).shift_elements_right::<3>(true), v!(s u16 B4).simd_eq(0).shift_elements_right::<3>(v!(s u16 B4).simd_eq(1)),
            v!(s u8 B8).simd_eq(0).shift_elements_left::<9>(false), v!(s u8 B8).simd_eq(0).shift_elements_left::<9>(true), v!(s u8 B8).simd_eq(0).shift_elements_left::<9>(v!(s u8 B8).simd_eq(1)), v!(s u8 B8).simd_eq(0).shift_elements_right::<9>(false), v!(s u8 B8).simd_eq(0).shift_elements_right::<9>(true), v!(s u8 B8).simd_eq(0).shift_elements_right::<9>(v!(s u8 B8).simd_eq(1)),
            v!(s u8 B16).simd_eq(0).shift_elements_left::<17>(false), v!(s u8 B16).simd_eq(0).shift_elements_left::<17>(true), v!(s u8 B16).simd_eq(0).shift_elements_left::<17>(v!(s u8 B16).simd_eq(1)), v!(s u8 B16).simd_eq(0).shift_elements_right::<17>(false), v!(s u8 B16).simd_eq(0).shift_elements_right::<17>(true), v!(s u8 B16).simd_eq(0).shift_elements_right::<17>(v!(s u8 B16).simd_eq(1)),
            v!(s u32 B32).simd_eq(0).shift_elements_left::<9>(false), v!(s u32 B32).simd_eq(0).shift_elements_left::<9>(true), v!(s u32 B32).simd_eq(0).shift_elements_left::<9>(v!(s u32 B32).simd_eq(1)), v!(s u32 B32).simd_eq(0).shift_elements_right::<9>(false), v!(s u32 B32).simd_eq(0).shift_elements_right::<9>(true), v!(s u32 B32).simd_eq(0).shift_elements_right::<9>(v!(s u32 B32).simd_eq(1)),
            v!(s u64 B64).simd_eq(0).shift_elements_left::<9>(false), v!(s u64 B64).simd_eq(0).shift_elements_left::<9>(true), v!(s u64 B64).simd_eq(0).shift_elements_left::<9>(v!(s u64 B64).simd_eq(1)), v!(s u64 B64).simd_eq(0).shift_elements_right::<9>(false), v!(s u64 B64).simd_eq(0).shift_elements_right::<9>(true), v!(s u64 B64).simd_eq(0).shift_elements_right::<9>(v!(s u64 B64).simd_eq(1));
        "": v!(s u8 B128).compress_relaxed(true), v!(s u8 B128).compress_store(&mut [0; 128], true), Output::overwrite(&mut [0; 128]).push((v!(s u8 B128)).selected(true)),
            v!(s u32 B8).is_in([0; 4]), v!(s u32 B8).is_in_relaxed([1; 4]), v!(s u8 B128).simd_eq(1).iter().count(), (!v!(s u64 B8).simd_eq(0).split()[0]).any();
    }
}

#[test]
fn on_all_targets() {
    Target::ALL.iter().for_each(|&it| _ = (operations::to(it), more::to(it)));
}
