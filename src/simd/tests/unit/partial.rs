//! The masked accesses stay in the slice for each `skip` and length, also those that no caller passes.

use crate::ops::Portable;
use crate::partial::{To, fill, load, store};
use crate::simd::{Fits, Simd};
use core::{cell::Cell, mem::MaybeUninit};

fn each<const N: usize>(s: Option<Portable>)
where
    u8: Fits<N>,
{
    let v = Simd::<u8, N>::from_array(core::array::from_fn(|i| i as u8 + 1));
    for skip in (0..67).chain([127, 128, 129, 130, usize::MAX]) {
        for len in (0..67).chain([254, 255, 256, 257, 320]) {
            let first = skip % 64;
            let mut all = [0xee; 500];
            let lanes: [u8; N] =
                core::array::from_fn(|i| if i >= first && i - first < len { 0xee } else { i as u8 + 1 });
            assert_eq!(load::<Portable, _, N>(s, Ok(&all[90..][..len]), skip, None, v).to_array(), lanes);
            assert_eq!(
                load::<Portable, _, N>(
                    s,
                    Err(Cell::from_mut(&mut all[90..][..len]).as_slice_of_cells()),
                    skip,
                    None,
                    v
                )
                .to_array(),
                lanes
            );
            let n = len.min(N.saturating_sub(first));
            let mut want = all;
            want[90..][..n].copy_from_slice(&v.as_array()[first.min(N)..][..n]);
            let mut cells = all;
            store::<Portable, _, N>(s, v, To::Values(&mut all[90..][..len]), skip, None);
            store::<Portable, _, N>(
                s,
                v,
                To::Cells(Cell::from_mut(&mut cells[90..][..len]).as_slice_of_cells()),
                skip,
                None,
            );
            assert_eq!((all, cells), (want, want));
            let mut room = [MaybeUninit::new(0xee); 500];
            assert_eq!(fill::<Portable, _, N>(v, &mut room[90..][..len], skip), &want[90..][..n]);
        }
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn any_skip() {
    for s in [None, Some(Portable::new())] {
        each::<2>(s);
        each::<16>(s);
        each::<64>(s);
    }
}
