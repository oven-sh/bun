//! What whole vectors are loaded from and stored to.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{prelude::*, target::*};
use std::{borrow::Cow, cell::*, mem::MaybeUninit, rc::Rc, sync::Arc};
#[path = "framework/misfits.rs"]
#[macro_use]
#[allow(unused_macros)]
mod misfits;

#[kernel(targets = Targets::ALL)]
fn all_kinds() {
    let all: [u8; 20] = core::array::from_fn(|i| i as u8);
    let (first, last) = (u8x16::iota(0), u8x16::iota(4));
    macro_rules! read { ($($it:expr),*) => {$(
        assert_eq!([u8x16::load($it), u8x16::load_last($it), u8x16::load_bytes($it), u8x16::load_block($it)], [first, last, first, first]);
    )*}; }
    read!(
        &all,
        &&all,
        &all[..],
        &&all[..],
        &&mut { all },
        &all.to_vec(),
        &Box::new(all),
        &Box::<[u8]>::from(all),
        &Aligned(all)
    );
    read!(
        &Rc::new(all),
        &Rc::<[u8]>::from(all),
        &Arc::new(all),
        &Arc::new(all.to_vec()),
        &Cow::Borrowed(&all[..]),
        &Cow::Borrowed(&all)
    );
    read!(&RefCell::new(all).borrow(), &RefCell::new(all).borrow_mut(), &all.map(Cell::new));
    macro_rules! write { ($($it:expr),*) => {$(
        let mut to = $it;
        last.store_last(&mut to);
        assert_eq!(to[..5], [9, 9, 9, 9, 4]);
        first.store(&mut to);
        assert_eq!(to[..], all);
    )*}; }
    let cell = RefCell::new([9; 20]);
    write!(
        [9; 20],
        &mut [9; 20],
        &mut [9; 20][..],
        vec![9; 20],
        Box::new([9; 20]),
        Aligned([9; 20]),
        cell.borrow_mut()
    );
    first.store(&mut [MaybeUninit::uninit(); 16]);
    let mut lanes = u8xN::zero().to_array();
    u8xN::iota(1).store(&mut lanes);
    assert_eq!(u8xN::load(&lanes), u8xN::iota(1));
}

#[simd]
fn copy(from: &(impl Slice<Item = u8> + ?Sized), to: &mut (impl SliceMut<Item = u8> + ?Sized)) {
    u8x4::load(from).store(to)
}

#[kernel(targets = Targets::ALL)]
fn just_enough() {
    let [] = u8x16::<S>::aes_encrypt([], &[[0; 16]; 2]);
    let mut four = [0; 4];
    copy(b"abcd", &mut four);
    assert_eq!(&four, b"abcd");
    let (v, at) = (u16x8::splat(0x0101), u32x8::zero());
    assert_eq!(
        [
            u16x8::load(&[257; 8]),
            u16x8::load_last(&[257; 8]),
            u16x8::load_bytes(&[1; 16]),
            u16x8::gather_bytes(&[1; 2], at)
        ],
        [v; 4]
    );
    assert_eq!([u16x8::load_interleaved(&[257; 24]), u16x8::gather_interleaved(&[257; 3], at)], [[v; 3]; 2]);
    assert_eq!(u16x32::load_block(&[257; 8]), [257; 32]);
    assert_eq!(u16x8::load_3_of_4(&[1; 6]), [1, 1, 1, 0, 1, 1, 1, 0]);
    assert_eq!(u16x8::load_block(&[257; 8].map(Cell::new)).bitcast(), u8x16::load_block(&[1; 16].map(Cell::new)));
    assert_eq!(u8x16::load_3_of_4(&[1; 12].map(Cell::new)), u8x16::load_3_of_4(&[1; 12]));
    assert_eq!(u16x8::load_low_bytes(&[1; 16], !0u64), (v, 16));
    assert!(mask8x16::load_bitmask(&[255; 2]).all() && mask32x4::load_bitmask(&[15]).all());
    v.store(&mut [0; 8]);
    v.store_last(&mut [0; 8]);
    v.store_bytes(&mut [0; 16]);
    v.store_select(&mut [0; 8], 1);
    v.store_3_of_4(&mut [0; 6]);
    u16x8::store_interleaved([v; 3], &mut [0; 24]);
    mask8x16::splat(true).store_bitmask(&mut [0; 2]);
    assert_eq!(
        [
            v.compress_store(&mut [0; 8], 1),
            v.store_low_bytes(&mut [0; 16], 0u64),
            set_bit_positions(1, 0u8, &mut [0; 64])
        ],
        [1, 8, 1]
    );
}

#[kernel(targets = Targets::ALL)]
fn guarded(all: &[u8; 32]) -> [u8; 3] {
    let (mut sum, mut at) = (u8xN::zero(), 0);
    while at + u8xN::LANES <= all.len() {
        (sum, at) = (sum + u8xN::load_at(all, at), at + u8xN::LANES);
    }
    [
        (sum + u8xN::load_or_default(&all[at..])).reduce_sum(),
        if const { u8xN::<S>::LANES <= 32 } { u8xN::load(all)[0] } else { 1 },
        if all.len() >= u8xN::LANES { u8xN::load(&all[..])[0] } else { 1 },
    ]
}

#[test]
fn on_all_targets() {
    for &it in Target::ALL {
        _ = (all_kinds::to(it), just_enough::to(it));
        assert!(guarded::to(it, &[1; 32]).is_none_or(|it| it == [32, 1, 1]));
    }
}

#[test]
fn parts() {
    let mut all = [1, 2, 3, 4, 5];
    *SubArray::sub_array_mut::<3, 2>(&mut all) = [8, 9];
    assert_eq!((all.sub_array::<1, 4>(), all.sub_array::<0, 5>(), all.sub_array::<5, 0>()), (&[2, 3, 8, 9], &all, &[]));
    assert_eq!(Aligned(all).sub_array::<2, 1>(), &[3]);
    let mut two = [[1, 2, 3], [4, 5, 6]];
    FlatArray::flat_array_mut::<6>(&mut two)[3] = 9;
    assert_eq!((two.flat_array(), [two].flat_array::<2>().flat_array::<6>()[5]), (&[1, 2, 3, 9, 5, 6], 6));
}

#[test]
fn too_short() {
    type V = u16x8<Baseline>;
    let (v, at, m) = (V::zero(), u32x8::<Baseline>::zero(), mask8x16::<Baseline>::splat(true));
    misfits! {
        "too short": V::load(&[0; 7]), V::load_last(&[0; 7]), V::load_bytes(&[0; 15]), V::load_block(&[0; 7]), V::load_interleaved::<3>(&[0; 23]), V::load_3_of_4(&[0; 5]),
            V::load_low_bytes(&[0; 15], 0u64), V::gather_interleaved::<3, _>(&[0; 2], at), V::gather_bytes(&[0; 1], at),
            v.store(&mut [0; 7]), v.store_last(&mut [0; 7]), v.store_bytes(&mut [0; 15]), v.store_select(&mut [0; 7], 1), V::store_interleaved([v; 3], &mut [0; 23]),
            v.store_3_of_4(&mut [0; 5]), v.store_low_bytes(&mut [0; 15], 0u64), v.compress_store(&mut [0; 7], 1), m.store_bitmask(&mut [0; 1]),
            V::load(&&[0; 7]), V::load(&&mut [0; 7]), V::load(&Box::new([0; 7])), V::load(&Aligned([0; 7])), V::load(&Rc::new([0; 7])), V::load(&Arc::new([0; 7])),
            V::load(&Cow::Borrowed(&[0; 7])), V::load(&RefCell::new([0; 7]).borrow()), v.store(&mut RefCell::new([0; 7]).borrow_mut()), V::load(&v.split()[0].to_array());
        "": mask8x16::<Baseline>::load_bitmask(&[0; 1]), set_bit_positions::<u8, Baseline>(1, 0, &mut [0; 63]), set_bit_positions::<u8, Baseline>(1, 0, &mut Aligned([0; 63])),
            set_bit_positions::<u8, Baseline>(1, 0, &mut &[const { Cell::new(0) }; 63]);
        "too short": V::load([0; 9].sub_array::<2, 7>()), V::load(&[0; 14].as_chunks::<7>().0[0]), V::load([0; 9].chunk_at::<7>(0).unwrap());
        "ends after": [0; 5].sub_array::<2, 4>(), [0; 5].sub_array::<0, 6>(), [0; 5].sub_array::<{ usize::MAX }, 2>(), [0; 5].sub_array_mut::<2, 4>(), [0; 5].sub_array_mut::<0, 6>();
        "another number": [[0; 2]; 3].flat_array::<5>(), [[0; 2]; 3].flat_array::<7>(), [[0; 2]; 3].flat_array_mut::<5>(), [[0; 2]; 3].flat_array_mut::<7>();
        "more alignment": bitcast_slice::<u16>(&[[0u8; 2]]), bitcast_slice_mut::<u32>(&mut [[0u16; 2]]);
    }
}
