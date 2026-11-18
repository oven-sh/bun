use crate::{Int, Isa, Lane, Vector};
use core::marker::PhantomData;
use core::ops::{BitAnd, BitOr, BitXor, Not};
use core::simd::{self, Select};

/// The result of comparing two `Vector<T, N, I>`.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Mask<T: Lane, const N: usize, I>(pub(crate) simd::Mask<T::Mask, N>, PhantomData<I>);

impl<T: Lane, const N: usize, I: Isa> Mask<T, N, I> {
    #[inline(always)]
    pub(crate) fn new(mask: simd::Mask<T::Mask, N>) -> Self {
        Self(mask, PhantomData)
    }

    #[inline(always)]
    pub fn cast<U: Lane>(self) -> Mask<U, N, I> {
        Mask::new(self.0.cast())
    }

    /// One bit per lane.
    #[inline(always)]
    pub fn to_bitmask(self) -> u64 {
        I::to_bitmask(self)
    }

    #[inline(always)]
    pub fn select(
        self,
        if_set: impl Into<Vector<T, N, I>>,
        if_unset: impl Into<Vector<T, N, I>>,
    ) -> Vector<T, N, I> {
        Vector::new(self.0.select(if_set.into().0, if_unset.into().0))
    }
}

impl<T: Int<N>, const N: usize, I: Isa> Mask<T, N, I> {
    #[inline(always)]
    pub fn any(self) -> bool {
        I::any(self)
    }

    #[inline(always)]
    pub fn none(self) -> bool {
        !self.any()
    }

    #[inline(always)]
    pub fn all(self) -> bool {
        let (bits, bits_per_lane) = I::movemask(self);
        bits == u64::MAX >> (64 - N * bits_per_lane)
    }

    #[inline(always)]
    pub fn first_set(self) -> Option<usize> {
        let (bits, bits_per_lane) = I::movemask(self);
        (bits != 0).then(|| bits.trailing_zeros() as usize / bits_per_lane)
    }

    /// The number of lanes that are set.
    #[inline(always)]
    pub fn count(self) -> usize {
        I::count_before(self, N)
    }

    /// The number of lanes before `lane` that are set.
    #[inline(always)]
    pub fn count_before(self, lane: usize) -> usize {
        I::count_before(self, lane.min(N))
    }

    /// Each lane is all ones or all zeros.
    #[inline(always)]
    pub fn to_vector(self) -> Vector<T, N, I> {
        self.select(!Vector::zero(), Vector::zero())
    }
}

impl<T: Lane, const N: usize, I: Isa> BitAnd for Mask<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn bitand(self, rhs: Self) -> Self {
        Self::new(self.0 & rhs.0)
    }
}

impl<T: Lane, const N: usize, I: Isa> BitOr for Mask<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn bitor(self, rhs: Self) -> Self {
        Self::new(self.0 | rhs.0)
    }
}

impl<T: Lane, const N: usize, I: Isa> BitXor for Mask<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn bitxor(self, rhs: Self) -> Self {
        Self::new(self.0 ^ rhs.0)
    }
}

impl<T: Lane, const N: usize, I: Isa> Not for Mask<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn not(self) -> Self {
        Self::new(!self.0)
    }
}
