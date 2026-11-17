//! For NEON, LLVM makes `st2`, `ld4` and `st4` of a wide access next to a shuffle.
use crate::swizzle::{EveryFourth, Interleave, Repeat};
use crate::vector::{from_slice, to_array};
use crate::{Int, Isa, Vector};
use bun_simd_trusted::keep16;
use core::simd::{Swizzle, u8x16, u8x32, u8x64};

impl<const N: usize, I: Isa> Vector<u8, N, I>
where
    u8: Int<N>,
{
    const IS_ONE_ACCESS: bool = I::HAS_INTERLEAVED_MEMORY && N == 16;

    #[inline(always)]
    pub fn to_interleaved2([a, b]: [Self; 2]) -> [[u8; 2]; N] {
        let mut pairs = [[0; 2]; N];
        let to = pairs.as_flattened_mut();
        if Self::IS_ONE_ACCESS {
            let both: u8x32 = Interleave::<2>::concat_swizzle(a.0.resize::<16>(0), b.0.resize(0));
            *to.first_chunk_mut().unwrap() = to_array(both);
        } else {
            let (first, second) = a.interleave(b);
            first.copy_to_slice(to);
            second.copy_to_slice(&mut to[N..]);
        }
        pairs
    }

    #[inline(always)]
    pub fn load_interleaved4(from: &[[u8; 4]; N]) -> [Self; 4] {
        let from = from.as_flattened();
        if Self::IS_ONE_ACCESS {
            let all: u8x64 = from_slice(from);
            let planes: [u8x16; 4] = [
                EveryFourth::<0>::swizzle(all),
                EveryFourth::<1>::swizzle(all),
                EveryFourth::<2>::swizzle(all),
                EveryFourth::<3>::swizzle(all),
            ];
            // There is no `ld4` unless all of them are used.
            planes.into_iter().for_each(keep16);
            return planes.map(|plane| Self::new(plane.resize(0)));
        }
        let load = |i: usize| Self::from_slice(&from[i * N..]);
        let (ac_first, bd_first) = load(0).deinterleave(load(1));
        let (ac_second, bd_second) = load(2).deinterleave(load(3));
        let (a, c) = ac_first.deinterleave(ac_second);
        let (b, d) = bd_first.deinterleave(bd_second);
        [a, b, c, d]
    }

    #[inline(always)]
    pub fn to_interleaved4([a, b, c, d]: [Self; 4]) -> [[u8; 4]; N] {
        const { assert!(N.is_multiple_of(16)) };
        let mut quads = [[0; 4]; N];
        let to = quads.as_flattened_mut();
        if Self::IS_ONE_ACCESS {
            let [a, b, c, d] = [a, b, c, d].map(|v| v.0.resize::<16>(0));
            let ab: u8x32 = Repeat::<32>::concat_swizzle(a, b);
            let cd: u8x32 = Repeat::<32>::concat_swizzle(c, d);
            let all: u8x64 = Interleave::<4>::concat_swizzle(ab, cd);
            *to.first_chunk_mut().unwrap() = to_array(all);
            return quads;
        }
        let (ac_first, ac_second) = a.interleave_in_blocks(c);
        let (bd_first, bd_second) = b.interleave_in_blocks(d);
        let (first, second) = ac_first.interleave_in_blocks(bd_first);
        let (third, fourth) = ac_second.interleave_in_blocks(bd_second);
        for (i, to) in to.as_chunks_mut::<16>().0.iter_mut().enumerate() {
            let from = [first, second, third, fourth][i % 4];
            *to = *from.0[i / 4 * 16..].first_chunk().unwrap();
        }
        quads
    }
}
