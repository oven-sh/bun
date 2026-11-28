//! The same as misfits_targets.rs for loops, at lengths that take each path.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{target::*, *};
#[path = "framework/misfits.rs"]
#[macro_use]
#[allow(unused_macros)]
mod misfits;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn too_many_lanes(x: &[u8], bits: &[u64]) {
    let s: S = bun_simd::prelude::isa();
    let wide = s.over(x).by::<B128>();
    misfits! {
        "": drop(wide.padded()), drop(wide.zip(x).padded()), drop(wide.positions(|v| v.simd_eq(v))), drop(wide.zip(x).positions(|(v, _)| v.simd_eq(v))),
            wide.bitmask_into(&mut [0; 4], |v| v.simd_eq(v)), wide.selected(bits).count(), wide.selected(bits).sum(), wide.zip_bits(bits).len(),
            wide.expand_into(&mut [0u8; 128][..x.len()], bits, 0), s.over(x).by::<B512>().zip_scaled(&[0u16; 9]).len();
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn other_numbers_of_lanes(x: &[u8]) {
    let s: S = bun_simd::prelude::isa();
    let (narrow, wide) = (s.over(x).by::<B16>(), s.over(x).by::<B32>());
    misfits! {
        "as many lanes": narrow.filter_map_into(&mut [0u16; 200], |v| (v.simd_eq(v), v.sum_groups::<u16>())),
            wide.filter_map_into(&mut [0u16; 200], |v| (v.simd_eq(v), v.sum_groups::<u16>())),
            narrow.filter_map_into((&mut [0u8; 200],), |v| (v.simd_eq(v), ([v, v],))), wide.filter_map_into((&mut [0u8; 200],), |v| (v.simd_eq(v), ([v, v],)));
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn no_lanes(x: &[u64]) {
    let s: S = bun_simd::prelude::isa();
    misfits! {
        "wider than the vector": s.over(x).by::<B4>().selected(&[1u64]).map_into(&mut [0u64; 9], |v| v), s.over(x).by::<B4>().selected(&[1u64]).max(),
            s.over(x).by::<B4>().expand_into(&mut [0u64; 9], &[1u64], 0), s.over(x).by::<B4>().bitmask_into(&mut [0; 2], |v| v.simd_eq(0)),
            s.over(x).by::<B4>().bitmask(|v| v.simd_eq(0));
        "": Simd::<u64, B4, S>::over(x).bitmask(|v| v.simd_eq(1));
    }
}

#[test]
fn on_all_targets() {
    for &target in Target::ALL {
        for len in [0, 1, 9, 64, 65, 128] {
            too_many_lanes::to(target, &[1; 128][..len], &[1; 2][..len.div_ceil(64)]);
        }
        for len in [1, 8, 9, 15, 16, 17, 31, 32, 33, 64] {
            other_numbers_of_lanes::to(target, &[1; 64][..len]);
        }
        for len in [9, 64, 70] {
            no_lanes::to(target, &[1; 70][..len]);
        }
    }
}
