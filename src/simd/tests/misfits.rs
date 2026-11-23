//! Each check of types in src/ fails once, with its own message.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{crypto::*, mem::*, target::*, *};
#[path = "framework/misfits.rs"]
#[macro_use]
mod misfits;
#[path = "framework/on.rs"]
mod on;
use on::*;

#[test]
fn types_that_dont_fit() {
    let s = Portable::new();
    let (d, v, bytes, one, two) = (d!(s u16 B16), v!(s u16 B16), v!(s u8 B16), v!(s u64 B8), v!(s u8 B2));
    let (short, wide) = (v!(s u8 B8), v!(s u32 B16));
    misfits! {
        "wider than the vector": v!(s u64 B4), two.bitcast::<u32>(), two.abs_diff_sum::<u64>(two), v!(s u32 B2);
        "as many lanes of that type": v!(s u16 B512).cast::<u32>(), v!(s u16 B512).saturating_cast::<u32>(), v!(s u16 B2).cast::<u8>(),
            v!(s f32 B4).to_minifloat(math::Minifloat::E5M2), v!(s u8 B256).from_minifloat::<f32>(math::Minifloat::E5M2),
            v!(s f32 B512).cast_relaxed::<i64>(), v!(s f32 B512).round_cast::<i64>(), v!(s f32 B512).round_cast_relaxed::<i64>();
        "times four rounds": Sha1::new([0; 5]).rounds4::<20>(wide), Sm3::new([0; 8]).rounds4::<16>(wide, wide);
        "too short": Simd::aes_encrypt([bytes], &[[0; 16]]), Simd::aes_decrypt_and([bytes], &[], || {});
        "hold the value": f16::of::<-65536>(), f16::of::<{ i64::MAX }>(), f16::of::<{ i64::MIN }>(), u8::of::<256>(), u8::of::<-1>(), i8::of::<128>(), u64::of::<-1>(), f32::of::<0x100_0001>(), f64::of::<{ i64::MAX }>(),
            bun_simd::f16::of::<2049>(), bun_simd::f16::of::<65536>(), bun_simd::f16::of::<-70000>(), bf16::of::<257>();
        "less than 2 bytes": two.split(), two.simd_eq(0).split();
        "up to 32 bits": d!(s u64 B32).load_3_of_4(&[0; 4]), v!(s u64 B32).store_3_of_4(&mut [0; 4]);
        "a part is wider": s.from_parts::<u8, B8, B16>(|_| bytes), short.for_each_part(|_, _: Simd<u8, B16, _>| ());
        "more than 512 bytes": v!(s u8 B512).concat(v!(s u8 B512)), v!(s u8 B512).cast_mul::<u16>(1), v!(s i16 B512).cast_mul_q15_add(1, 1);
        "more than 64 lanes": v!(s u8 B128).simd_eq(0).to_bitmask(), v!(s u8 B128).compress(1), v!(s u8 B128).compress(v!(s u8 B128).simd_eq(0)), v!(s u16 B256).simd_eq(0).iter(),
            v!(s u8 B128).bit_planes::<1>(), d!(s u8 B128).from_bit_planes([1]);
        "a multiple of the blocks": Simd::transpose_blocks([v!(s u8 B32); 3]);
        "has no halves": one.split(), one.simd_eq(0).split(), d!(s u8 B2).from_halves([two; 2]);
        "twice as wide": bytes.saturating_narrow::<u8>(bytes), bytes.in_blocks().saturating_narrow::<u8>(bytes), bytes.wrapping_narrow::<u8>(bytes),
            bytes.simd_eq(0).narrow(bytes.simd_eq(0)), bytes.in_blocks().widen::<u8>();
        "half as wide": bytes.widen::<u8>(), v.cast_mul::<u16>(v);
        "more than a block": short.in_blocks().shift_elements_left::<9>(short), v.in_blocks().shift_elements_left::<9>(v),
            short.in_blocks().shift_elements_left::<9>(short), short.in_blocks().shift_elements_right::<9>(0), short.in_blocks().shift_elements_left::<9>(0),
            v.in_blocks().shift_elements_right::<9>(0), v.in_blocks().shift_elements_left::<9>(0);
        "more than the number of lanes": v.shift_elements_left::<9>(v), v.shift_elements_right::<9>(v),
            v.to_mask().shift_elements_left::<9>(v.to_mask()), v.to_mask().shift_elements_right::<9>(v.to_mask());
        "too few bits": Output::overwrite(&mut [0; 256]).push((v!(s u32 B256)).low_bytes(0)), v!(s u32 B256).first_n(1).low_bytes(0);
        "up to 512 values": Output::overwrite(&mut [0; 600]).push([bytes; 33].first_n(1)), ([bytes; 32], 0).first_n(1), [&[[0u8; 9]]].first_n(1);
        "no block": v.block::<1>(), v.with_block::<1>(v), v.as_u128s().splat_lane::<1>(), v!(s u8 B64).block::<4>();
        "no lane": v.in_blocks().splat_lane::<8>(), v.splat_lane::<8>(), v.lane::<8>(), v!(s u8 B64).with_lane::<64>(0);
        "too few lanes": one.swap_pairs(), two.swizzle_groups([3, 2, 1, 0]), wide.swizzle_groups([7, 6, 5, 4, 3, 2, 1, 0]), two.swizzle_groups([2, 3, 0, 1]), two.swizzle_groups([1, 2, 3, 0]), two.swizzle_groups([3, 0, 1, 2]),
            two.swizzle_groups([0, 0, 0, 0]), one.swizzle_groups([1, 0]), one.swizzle_groups([0, 0]), one.swizzle_groups([1, 1]), one.concat_halves::<0, 0>(one), one.concat_halves::<1, 0>(one);
        "16 bytes or more": short.in_blocks().concat_lookup_bytes_relaxed(short, short), short.aes_round(0), short.aes_last_round(0), short.aes_round_inv(0),
            short.aes_last_round_inv(0), short.aes_inv_mix_columns(), short.aes_key_gen_assist::<1>(), Simd::aes_encrypt([short], &[[0; 16]; 2]), one.carryless_mul_odd(one);
        "two lanes or more": v!(s u16 B2).sum_groups::<u32>();
        "four lanes or more": two.sum_groups::<u32>();
        "": d.gather_or_default(&[0], wide), v.scatter(&mut [0], wide), bytes.widen_even::<u8>(), bytes.widen_odd::<u8>(),
            short.mat_mul_add::<u32>(short, 0),
            one.widening_mul_even(one), one.widening_mul_odd(one), v!(s u16 B2).dot::<u32>(1),
            v!(s u16 B4).dot_add::<u64>(1, 1),
            short.in_blocks().sliding_abs_diff_sum::<0, 0>(short), short.in_blocks().is_in(short), short.in_blocks().is_in_relaxed(short), short.in_blocks().count_in(short), short.is_in(1), short.is_in_relaxed([1]),
            Sha256::schedule([v!(s u32 B8); 4]), v!(s u32 B8).sm4_rounds4(v!(s u32 B8)), v!(s u32 B8).sm4_next_keys(v!(s u32 B8)),
            two.concat_swizzle_groups(two, [0; 4]), Simd::transpose_in_blocks([v; 4]),
            Simd::transpose([v; 4]);
    }
}

#[test]
fn more_that_dont_fit() {
    let s = Portable::new();
    let (d, short, wide, huge) = (d!(s u16 B16), v!(s u8 B8), v!(s u32 B16), v!(s u8 B512).simd_eq(0));
    misfits! {
        "one index for each lane": d.gather_interleaved::<2, _>(&[0; 9], wide);
        "one index for each lane": d.gather_bytes(&[0; 9], wide);
        "as many lanes of that type": v!(s u8 B128).lookup(&[0u64; 2]), v!(s u16 B2).lookup_relaxed(&[0u8; 2]), v!(s u16 B2).lookup_or(&[0u8; 2], 0);
        "one window for each lane": wide.gather_windows::<u8, 1, 3>(&[0; 9]), wide.gather_windows::<u8, 1, 5>(&[0; 9]);
        "as wide as the map": math::LinearMap::new(v!(s u8 B16), v!(s u8 B16)).of(short), math::LinearMap::new(v!(s u8 B32), v!(s u8 B32)).of(v!(s u8 B64));
        "16 bytes or more": math::LinearMap::new(short, short), v!(s bf16 B8).mat_mul_add_relaxed(v!(s bf16 B8), 0.0);
        "too few bits": s.load_low_bytes::<u32, B256>(&[0; 256], 0u64), v!(s u32 B256).store_low_bytes(&mut [0; 256], 0u64);
        "as many lanes of that type": huge.cast::<i16>(), v!(s u16 B2).simd_eq(0).cast::<i8>();
        "more than 512 bytes": huge.concat(huge);
        "two lanes or more": v!(s u32 B4).widening_mul_even_odd(v!(s u32 B4));
        "four lanes or more": v!(s u8 B2).swizzle_groups([0, 2, 1, 3]), v!(s u16 B4).dot::<u64>(1);
        "8 bytes or more": math::AbsDiffSums::<B4, bun_simd::target::Baseline>::new().total();
        "has no halves": d!(s u16 B2).from_halves([v!(s u16 B2); 2]);
        "more than a block": v!(s u16 B32).in_blocks().shift_elements_left::<9>(0), v!(s u16 B32).in_blocks().shift_elements_right::<9>(0);
        "16 bytes or more": d!(s u8 B8).load_3_of_4(&[0; 8]), short.store_3_of_4(&mut [0; 8]);
        "more than 64 lanes": d!(s u8 B128).over(&[0u8; 9]).bitmask(|v| v.simd_eq(0)), drop(d!(s u8 B128).over(&[0u8; 9]).padded());
        "as many lanes": d!(s u32 B4).over(&[0u32; 9]).enumerate::<u8>(), d.over(&[0u16; 9]).selected(&[1u64]).map_into(&mut [0; 9], |_| wide),
            d!(s u32 B4).over(&[0u32; 9]).zip_scaled(&[0u8; 9]), d.over(&[0u16; 9]).map_until(&mut [0; 9], |v| v.simd_eq(1), |_| wide), d.over(&[0u16; 9]).filter_map_into(&mut [0; 9], |v| (v.simd_eq(0), wide)),
            d.over(&[0u16; 9]).filter_map_into((&mut [0; 99],), |v| (v.simd_eq(0), ([v, v],))),
            d.over(&[0u16; 9]).stream_into(&mut [0; 9], |_| wide),
            d.over(&[0u16; 9]).zip(&[0u16; 9]).stream_into(&mut [0; 9], |(_, _)| wide),
            d!(s u8 B512).over(&[0u8; 9]).windows::<1>().zip_scaled(&[0u16; 9]);
        "no lane": d.zero().with_lane::<8>(0);
        "less than 2 bytes": v!(s u8 B2).in_blocks().widen::<u16>();
        "more than 64 lanes": v!(s u8 B512).compress_relaxed(huge), v!(s u8 B512).compress_store(&mut [0; 512], huge), Output::overwrite(&mut [0; 512]).push((v!(s u8 B512)).selected(huge)),
            drop(d!(s u32 B512).over(&[1]).positions(|v| v.simd_eq(v)));
        "wider than the vector": baseline().zero::<u64, B4>(), s.over(&[0u64; 64]).by::<B4>();
        "row": Simd::transpose([wide; 0]), Simd::transpose_in_blocks([wide; 0]), Simd::transpose_blocks([wide; 0]), Simd::<u64, B2, Baseline>::transpose([]);
        "": Simd::<u64, B2, Baseline>::from_lanes([]), s.over(&[0u8]).map_into(&mut [0], |_| -> Simd<u64, B2, _> { panic!() }),
            s.over(&[0u8]).pad(0).map_into(&mut [0], |_| -> Simd<u64, B2, _> { panic!() }), v!(s u8 B4).galois_affine(math::Divisor::new(1u64).unwrap());
        "16 bytes or more": short.as_u128s().swizzle(|_| 0), short.as_u128s().concat_swizzle(short, |_| 0);
        "": wide.to_lanes::<3>(), Simd::<u32, B16, Baseline>::from_lanes([0; 5]), wide.simd_eq(0).to_lanes::<3>(),
            wide.to_lanes::<0>(), Simd::<u64, B4, Baseline>::from_lanes([]), wide.simd_eq(0).to_lanes::<0>();
        "": math::PairSums::new().mul_add(v!(s u64 B16), 1);
    }
}

/// The first argument that is too much.
#[test]
fn beyond_the_limits() {
    let s = Portable::new();
    let (b2, b4, b8, b16, b512) = (v!(s u8 B2), v!(s u8 B4), v!(s u8 B8), v!(s u8 B16), v!(s u8 B512));
    let (h2, h4, h8, h16, h32) = (v!(s i16 B2), v!(s i16 B4), v!(s i16 B8), v!(s i16 B16), v!(s i16 B32));
    let (w4, w8, w16) = (v!(s u32 B4), v!(s u32 B8), v!(s u32 B16));
    let q8 = v!(s u64 B8);
    misfits! {
        "": b8.in_blocks().shift_elements_left::<9>(b8),
            b8.in_blocks().shift_elements_right::<9>(0),
            h8.in_blocks().shift_elements_left::<5>(h8), h32.in_blocks().shift_elements_left::<9>(h32),
            h8.in_blocks().shift_elements_right::<5>(0), h32.in_blocks().shift_elements_right::<9>(0), h8.in_blocks().shift_elements_left::<5>(0), h32.in_blocks().shift_elements_left::<9>(0),
            h32.shift_elements_right::<17>(0), h32.shift_elements_left::<17>(0), h32.in_blocks().splat_lane::<8>(), h8.in_blocks().splat_lane::<4>(), h32.splat_lane::<16>(),
            h32.as_u128s().splat_lane::<2>(), h8.as_u128s().splat_lane::<1>(), h32.block::<2>(), h8.block::<0>(),
            h32.with_block::<2>(h16), h8.with_block::<0>(h16),
            w8.swizzle_groups([0, 0, 0, 0]), w4.swap_pairs(), w8.swizzle_groups([3, 2, 1, 0]), w16.swizzle_groups([7, 6, 5, 4, 3, 2, 1, 0]), w8.swizzle_groups([2, 3, 0, 1]), w8.swizzle_groups([1, 2, 3, 0]), w8.swizzle_groups([3, 0, 1, 2]),
            b2.split()[0], b2.split()[1], w4.split()[0], w4.split()[1],
            b2.bitcast::<u32>(), w4.bitcast::<u64>(),
            b8.in_blocks().concat_lookup_bytes_relaxed(b8, b8), h2.sum_groups::<i32>(), b4.sum_groups::<u64>(), b4.abs_diff_sum::<u64>(b4),
            w4.widening_mul_even(w4), w4.widening_mul_odd(w4), h2.widening_mul_even(h2), h2.widening_mul_odd(h2), h2.dot::<i32>(h2),
            b8.in_blocks().sliding_abs_diff_sum::<0, 0>(b8),
            b512.cast::<u16>(), h2.cast::<u8>(), h2.saturating_cast::<u8>(), b512.bitcast::<u32>().cast::<u64>(), b512.concat(b512),
            b16.in_blocks().saturating_narrow::<u8>(b16),
            b16.wrapping_narrow::<u8>(b16),
            b16.cast_signed().is_negative().narrow(b16.cast_signed().is_negative()),
            b8.cast_mul::<u8>(b8),
            b16.widen::<u8>()[0], b16.widen::<u8>()[1],
            b8.mat_mul_add::<u32>(b8, 0u32), w8.sm4_rounds4(w8), b2.dot_add::<u32>(b2, 0), h4.dot_add::<i64>(h4, 0i64),
            q8.carryless_mul_even(q8).bitcast::<u8>().split()[0].bitcast::<u64>();
    }
}
