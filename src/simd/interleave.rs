//! For NEON, LLVM makes `st2`, `ld4` and `st4` of a wide access next to a shuffle.
use crate::swizzle::{EveryFourth, Interleave, Repeat};
use crate::{Int, Isa, Vector};
use core::simd::{Swizzle, u8x16, u8x32, u8x64};

impl<const N: usize, I: Isa> Vector<u8, N, I>
where
    u8: Int<N>,
{
    const IS_ONE_ACCESS: bool = I::HAS_INTERLEAVED_MEMORY && N == 16;

    #[inline(always)]
    pub fn store_interleaved2([a, b]: [Self; 2], to: &mut [[u8; 2]; N]) {
        let to = to.as_flattened_mut();
        if Self::IS_ONE_ACCESS {
            let both: u8x32 = Interleave::<2>::concat_swizzle(a.0.resize::<16>(0), b.0.resize(0));
            return both.copy_to_slice(to);
        }
        let (first, second) = a.interleave(b);
        first.copy_to_slice(to);
        second.copy_to_slice(&mut to[N..]);
    }

    #[inline(always)]
    pub fn load_interleaved4(from: &[[u8; 4]; N]) -> [Self; 4] {
        let from = from.as_flattened();
        if Self::IS_ONE_ACCESS {
            let all = u8x64::from_slice(from);
            let planes: [u8x16; 4] = [
                EveryFourth::<0>::swizzle(all),
                EveryFourth::<1>::swizzle(all),
                EveryFourth::<2>::swizzle(all),
                EveryFourth::<3>::swizzle(all),
            ];
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
    pub fn store_interleaved4(vectors: [Self; 4], to: &mut [[u8; 4]; N]) {
        let to = to.as_flattened_mut();
        if Self::IS_ONE_ACCESS {
            let [a, b, c, d] = vectors.map(|v| v.0.resize::<16>(0));
            let ab: u8x32 = Repeat::<32>::concat_swizzle(a, b);
            let cd: u8x32 = Repeat::<32>::concat_swizzle(c, d);
            let all: u8x64 = Interleave::<4>::concat_swizzle(ab, cd);
            return all.copy_to_slice(to);
        }
        let [a, b, c, d] = vectors;
        let (ac_first, ac_second) = a.interleave(c);
        let (bd_first, bd_second) = b.interleave(d);
        let (first, second) = ac_first.interleave(bd_first);
        let (third, fourth) = ac_second.interleave(bd_second);
        let chunks = to.as_chunks_mut().0;
        for (v, to) in [first, second, third, fourth].into_iter().zip(chunks) {
            v.store(to);
        }
    }
}
