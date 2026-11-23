//! Small helpers, with what their callers never give them.

use crate::Portable as P;
use crate::raw::{Halves, MaskOf, Parts, Raw, RawMask, RawOf, copy, resize, resized, same};
use crate::simd::{Mask, Simd};
use crate::width::*;

#[test]
#[should_panic]
fn same_refuses_another_type_of_the_size() {
    let _: f32 = same(1u32);
}

#[test]
fn new_indices_are_out_of_bounds() {
    const NONE: usize = usize::MAX;
    assert_eq!(resized::<1, 2, P>(Simd::from_array([5])).to_array(), [5, NONE]);
    assert_eq!(resized::<2, 8, P>(Simd::from_array([5, 6])).to_array(), [5, 6, NONE, NONE, NONE, NONE, NONE, NONE]);
    assert_eq!(resized::<4, 2, P>(Simd::from_array([5, 6, 7, 8])).to_array(), [5, 6]);
    let all: [usize; 64] = core::array::from_fn(|i| i);
    assert_eq!(resized::<64, 64, P>(Simd::from_array(all)).to_array(), all);
}

#[test]
fn a_mask_of_one_part_is_the_first() {
    let parts = [<Mask<i8, 16> as RawMask>::from_bits::<P>(0x1234)];
    assert_eq!(<Mask<i16, 16> as RawMask>::from_parts::<_, P>(|i| parts[i]).to_bits::<P>(), 0x1234);
}

#[test]
fn copies_from_the_start() {
    assert_eq!(copy::from_slice::<u16, 2>(&[1, 2, 3]).to_array(), [1, 2]);
}

#[test]
fn from_each_width_to_each() {
    let bytes: [u8; 512] = core::array::from_fn(|i| (i % 251 + 1) as u8);
    macro_rules! from { ($($w:ident)*) => { $(to!($w: B2 B4 B8 B16 B32 B64 B128 B256 B512);)* }; }
    macro_rules! to { ($w:ident: $($x:ident)*) => {$(
        let v = resize::<$w, $x>(Raw::load::<P>(&bytes));
        assert!(v.lanes().iter().copied().eq((0..$x::BYTES).map(|i| if i < $w::BYTES { bytes[i] } else { 0 })));
    )*}; }
    from!(B2 B4 B8 B16 B32 B64 B128 B256 B512);
}

#[test]
fn halves_of_many_lanes_join() {
    type M = MaskOf<i8, B256>;
    type H = MaskOf<i8, B128>;
    let lanes: [i8; 256] = core::array::from_fn(|i| -((i * i % 7 < 2) as i8));
    let halves = <Halves<H, H> as Parts<M>>::split::<P>(RawOf::<i8, B256>::load::<P>(&lanes).top_bits::<P>());
    assert_eq!(RawOf::<i8, B256>::from_mask(halves.join::<P>()).lanes(), lanes);
}

#[test]
fn many_subnormal_numbers_are_not_zero() {
    let v = Simd::<f32, 32>::from_array(core::hint::black_box([f32::from_bits(1); 32]));
    assert_eq!(Raw::eq::<P>(Raw::neg::<P>(v), Raw::zero()).to_bits::<P>(), 0);
}

/// Only speed depends on it, and a new compiler can change it.
#[test]
#[cfg(all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri), not(bun_simd_no_known)))]
fn constants_are_known() {
    assert_eq!(is_known!(7u32), crate::OPTIMIZED);
    assert!(!is_known!(core::hint::black_box(7u32)));
}
