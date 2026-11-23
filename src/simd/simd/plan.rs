// Shuffles of vectors in several registers of 16 bytes.
/// Where register `R` of the result comes from, if the operands are in registers of 16 bytes.
pub(super) struct Plan<B, P, const N: usize, const M: usize, const R: usize>(B, P);
impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize, const R: usize> Plan<B, P, N, M, R> {
    const LANES: usize = 16 / size_of::<B>();
    /// The register and the lane in it.
    const FROM: [(u8, u8); 16] = {
        // Two registers of 8 bytes are joined.
        let (mut from, mut i, per) = ([(0, 0); 16], 0, Self::LANES);
        let (index, full) = (Full::<B, P, N, M>::INDEX, <B as Class<M>>::FULL);
        while i < per {
            let at = index[(R * per + i) % full] as usize;
            from[i] = ((at / per) as u8, (at % per) as u8);
            i += 1;
        }
        from
    };
    /// The registers, in order, and their number. The last one repeats.
    const USED: ([u8; 16], usize) = {
        let (mut seen, mut i, from, lanes) = (0u64, 0, Self::FROM, Self::LANES);
        while i < lanes {
            seen |= 1 << from[i].0;
            i += 1;
        }
        let (mut used, count, mut i) = ([0; 16], seen.count_ones() as usize, 0);
        while i < 16 {
            used[i] = seen.trailing_zeros() as u8;
            if seen.count_ones() > 1 {
                seen &= seen - 1
            }
            i += 1;
        }
        (used, count)
    };
    const fn place(register: u8) -> usize {
        let mut i = 0;
        while Self::USED.0[i] != register {
            i += 1;
        }
        i
    }
    const SAME: bool = {
        let (mut i, from, lanes) = (0, Self::FROM, Self::LANES);
        while i < lanes && from[i].1 as usize == i {
            i += 1;
        }
        i == lanes && Self::USED.1 == 1
    };
    #[inline(always)]
    pub(super) fn register<O: Reg>(a: &<B as Class<N>>::Reg, b: &<B as Class<N>>::Reg) -> O {
        let at = Sources::<B, N>(a, b, const { Self::USED.0 }, P::SINGLE);
        if const { Self::SAME } {
            return start(at.at(0));
        }
        #[cfg(all(bun_simd_unoptimized, target_arch = "aarch64"))]
        if const { size_of::<O>() == 8 && Self::HALF && Self::USED.1 == 1 } {
            return part(&at.at(0), const { (Self::FROM[0].1 != 0) as usize });
        }
        chosen!(fn(Sources<B, N>) -> O: !Self::SAME => Self::moved, _ => |_| unreachable!())(at)
    }
}
struct Sources<'a, B: Class<N>, const N: usize>(&'a B::Reg, &'a B::Reg, [u8; 16], bool);
impl<B: Class<N>, const N: usize> Sources<'_, B, N> {
    #[inline(always)]
    fn at(&self, i: usize) -> Q {
        if const { size_of::<B::Reg>() == 8 } {
            return joined::<B, _>(*self.0, *self.1, self.3);
        }
        let (i, count) = (self.2[i] as usize, size_of::<B::Reg>() / 16);
        if i < count { part(self.0, i) } else { part(self.1, i - count) }
    }
}
// Without optimization, a call is shorter, and as fast.
#[cfg_attr(not(bun_simd_unoptimized), inline(always))]
pub fn shuffle<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    Reg::planned::<B, P, N, M>(&a, &b)
}
