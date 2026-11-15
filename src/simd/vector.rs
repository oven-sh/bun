//! The ops that need no intrinsic. LLVM picks the instructions of the function they are inlined into.
use crate::swizzle::{Repeat, ShiftRight, SwapPairs};
use crate::{Isa, Mask};
use bun_simd_trusted::opaque16;
use core::array;
use core::marker::PhantomData;
use core::ops::{
    Add, AddAssign, BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Index, Mul,
    Not, RangeInclusive, Shl, Shr, Sub, SubAssign,
};
use core::simd::{self, SimdCast, SimdElement, Swizzle, ToBytes, prelude::*};

/// The type of a lane.
pub trait Lane: SimdElement + SimdCast + Default {}

impl Lane for u8 {}
impl Lane for i8 {}
impl Lane for u16 {}
impl Lane for i16 {}
impl Lane for u32 {}
impl Lane for i32 {}
impl Lane for u64 {}
impl Lane for i64 {}
impl Lane for f32 {}

/// An integer lane of a vector with `N` lanes: the bound for code that is generic over lanes.
pub trait Int<const N: usize> = Lane
where
    Simd<Self, N>: Add<Output = Simd<Self, N>>
        + Sub<Output = Simd<Self, N>>
        + Mul<Output = Simd<Self, N>>
        + BitAnd<Output = Simd<Self, N>>
        + BitOr<Output = Simd<Self, N>>
        + BitXor<Output = Simd<Self, N>>
        + Not<Output = Simd<Self, N>>
        + Shl<Output = Simd<Self, N>>
        + Shr<Output = Simd<Self, N>>
        + SimdOrd
        + SimdPartialOrd<Mask = simd::Mask<<Self as SimdElement>::Mask, N>>
        + ToBytes;

/// `N` lanes of type `T`, for the instruction set `I`.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct Vector<T: Lane, const N: usize, I>(pub(crate) Simd<T, N>, PhantomData<I>);

impl<T: Lane, const N: usize, I: Isa> Vector<T, N, I> {
    pub const LEN: usize = N;

    #[inline(always)]
    pub(crate) fn new(lanes: impl Into<Simd<T, N>>) -> Self {
        Self(lanes.into(), PhantomData)
    }

    #[inline(always)]
    pub const fn splat(lane: T) -> Self {
        Self(Simd::splat(lane), PhantomData)
    }

    #[inline(always)]
    pub fn zero() -> Self {
        Self::splat(T::default())
    }

    /// 0, 1, 2, ..
    #[inline(always)]
    pub fn iota() -> Self {
        let indices = const { array::from_fn(const |i| i as u8) };
        Self::new(Simd::from_array(indices).cast())
    }

    /// `lane` followed by zeros.
    #[inline(always)]
    pub fn from_first(lane: T) -> Self {
        let mut lanes = Self::zero();
        lanes.0[0] = lane;
        lanes
    }

    #[inline(always)]
    pub const fn from_array(lanes: [T; N]) -> Self {
        Self(Simd::from_array(lanes), PhantomData)
    }

    #[inline(always)]
    pub fn to_array(self) -> [T; N] {
        self.0.to_array()
    }

    /// Panics if `lanes` is too short.
    #[inline(always)]
    pub fn from_slice(lanes: &[T]) -> Self {
        Self::from_array(*lanes.first_chunk().unwrap())
    }

    /// Panics if `lanes` is too short.
    #[inline(always)]
    pub fn copy_to_slice(self, lanes: &mut [T]) {
        self.store(lanes.first_chunk_mut().unwrap());
    }

    #[inline(always)]
    pub fn store(self, lanes: &mut [T; N]) {
        *lanes = self.to_array();
    }

    /// Reinterprets the bytes, which are in little-endian order on every target.
    #[inline(always)]
    pub fn bitcast<V: Bitcast<I, Bytes = <Simd<T, N> as ToBytes>::Bytes>>(self) -> V
    where
        Simd<T, N>: ToBytes,
    {
        V::from_bytes(self.0.to_le_bytes())
    }

    /// Keeps LLVM from merging the ops before it with those after it.
    #[inline(always)]
    pub fn opaque(self) -> Self
    where
        Simd<T, N>: ToBytes<Bytes = u8x16>,
    {
        Self::new(Simd::from_ne_bytes(opaque16(self.0.to_ne_bytes())))
    }

    /// The even lanes of both vectors, and the odd lanes of both.
    #[inline(always)]
    pub fn deinterleave(self, other: Self) -> (Self, Self) {
        let (even, odd) = self.0.deinterleave(other.0);
        (Self::new(even), Self::new(odd))
    }

    /// Moves lane `i` to `i + OFFSET`.
    #[inline(always)]
    pub fn shift_elements_right<const OFFSET: usize>(self, padding: T) -> Self {
        self.shift_in::<OFFSET>(Self::splat(padding))
    }

    /// The same, after the last `OFFSET` lanes of `before`.
    #[inline(always)]
    pub fn shift_in<const OFFSET: usize>(self, before: Self) -> Self {
        Self::new(ShiftRight::<OFFSET>::concat_swizzle(before.0, self.0))
    }

    #[inline(always)]
    pub fn reverse(self) -> Self {
        Self::new(self.0.reverse())
    }

    #[inline(always)]
    pub fn swap_pairs(self) -> Self {
        Self::new(SwapPairs::swizzle(self.0))
    }
}

impl<T: Int<N>, const N: usize, I: Isa> Vector<T, N, I> {
    /// Panics if the vector has fewer than `BYTES` bytes.
    #[inline(always)]
    pub(crate) fn first_bytes<const BYTES: usize>(self) -> Simd<u8, BYTES> {
        Simd::from_slice(self.0.to_ne_bytes().as_ref())
    }

    /// Panics if the vector has more than `BYTES` bytes.
    #[inline(always)]
    pub(crate) fn from_first_bytes<const BYTES: usize>(bytes: Simd<u8, BYTES>) -> Self {
        let mut first = Self::zero().0.to_ne_bytes();
        first.as_mut().copy_from_slice(&bytes[..size_of::<Self>()]);
        Self::new(Simd::from_ne_bytes(first))
    }

    /// `a0 b0 a1 b1 ..`, split into two halves.
    #[inline(always)]
    pub fn interleave(self, other: Self) -> (Self, Self) {
        I::interleave(self, other)
    }

    #[inline(always)]
    pub fn simd_eq(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_eq(other.into().0))
    }

    #[inline(always)]
    pub fn simd_ne(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_ne(other.into().0))
    }

    #[inline(always)]
    pub fn simd_lt(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_lt(other.into().0))
    }

    #[inline(always)]
    pub fn simd_le(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_le(other.into().0))
    }

    #[inline(always)]
    pub fn simd_gt(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_gt(other.into().0))
    }

    #[inline(always)]
    pub fn simd_ge(self, other: impl Into<Self>) -> Mask<T, N, I> {
        Mask::new(self.0.simd_ge(other.into().0))
    }

    #[inline(always)]
    pub fn simd_min(self, other: impl Into<Self>) -> Self {
        Self::new(self.0.simd_min(other.into().0))
    }

    #[inline(always)]
    pub fn simd_max(self, other: impl Into<Self>) -> Self {
        Self::new(self.0.simd_max(other.into().0))
    }

    #[inline(always)]
    pub fn wrapping_neg(self) -> Self {
        Self::zero() - self
    }

    /// For unsigned lanes and a range that is not empty.
    #[inline(always)]
    pub fn in_range(self, range: RangeInclusive<T>) -> Mask<T, N, I>
    where
        Simd<T, N>: SimdUint<Cast<T::Mask> = Simd<T::Mask, N>>,
        Simd<T::Mask, N>: SimdPartialOrd<Mask = simd::Mask<T::Mask, N>>,
    {
        let (start, end) = (Self::splat(*range.start()), Self::splat(*range.end()));
        debug_assert!(start.simd_le(end).all());
        if I::HAS_UNSIGNED_COMPARE {
            return (self - start).simd_le(end - start);
        }
        let to_signed_min = !(!Self::zero() >> 1) - start;
        let [lanes, end] = [self, end].map(|v| (v + to_signed_min).0.cast::<T::Mask>());
        Mask::new(lanes.simd_le(end))
    }
}

impl<const N: usize, I: Isa> Vector<u8, N, I> {
    /// Fills every 16 bytes with `block`.
    #[inline(always)]
    pub fn repeat_16(block: [u8; 16]) -> Self {
        Self::new(Repeat::<16>::swizzle(Simd::from_array(block)))
    }

    /// Converts each lane with `as`.
    #[inline(always)]
    pub fn cast<U: Lane>(self) -> Vector<U, N, I> {
        Vector::new(self.0.cast())
    }

    #[inline(always)]
    pub fn saturating_add(self, other: impl Into<Self>) -> Self {
        Self::new(self.0.saturating_add(other.into().0))
    }

    #[inline(always)]
    pub fn saturating_sub(self, other: impl Into<Self>) -> Self {
        Self::new(self.0.saturating_sub(other.into().0))
    }

    #[inline(always)]
    pub fn abs_diff(self, other: Self) -> Self {
        Self::new(self.0.abs_diff(other.0))
    }

    /// `(a + b + 1) / 2`
    #[inline(always)]
    pub fn average_round(self, other: Self) -> Self {
        let sum = self.0.cast::<u16>() + other.0.cast() + Simd::splat(1);
        Self::new((sum >> 1).cast())
    }

    /// The low byte of each lane of `first`, then of `second`.
    #[inline(always)]
    pub fn narrow<const M: usize>(first: Vector<u16, M, I>, second: Vector<u16, M, I>) -> Self
    where
        Simd<u16, M>: ToBytes<Bytes = Simd<u8, N>>,
    {
        Self::new(first.0.to_le_bytes().deinterleave(second.0.to_le_bytes()).0)
    }
}

impl<const N: usize, I: Isa> Vector<u16, N, I> {
    /// Converts each lane with `as`.
    #[inline(always)]
    pub fn cast<U: Lane>(self) -> Vector<U, N, I> {
        Vector::new(self.0.cast())
    }

    /// Zero-extends the first half of the lanes.
    #[inline(always)]
    pub fn widen_lower<const M: usize>(bytes: Vector<u8, M, I>) -> Self
    where
        Simd<u16, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        Self::new(bytes.0.extract::<0, N>().cast())
    }

    /// The full products of the first half of the lanes, and of the second half.
    #[inline(always)]
    pub fn widening_mul<const M: usize>(a: Vector<u8, M, I>, b: Vector<u8, M, I>) -> (Self, Self)
    where
        Simd<u16, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        let products = a.0.cast::<u16>() * b.0.cast();
        (
            Self::new(products.extract::<0, N>()),
            Self::new(products.extract::<N, N>()),
        )
    }
}

impl<const N: usize, I: Isa> Vector<i16, N, I> {
    /// Converts each lane with `as`.
    #[inline(always)]
    pub fn cast<U: Lane>(self) -> Vector<U, N, I> {
        Vector::new(self.0.cast())
    }
}

impl<const N: usize, I: Isa> Vector<i32, N, I> {
    /// Converts each lane with `as`.
    #[inline(always)]
    pub fn cast<U: Lane>(self) -> Vector<U, N, I> {
        Vector::new(self.0.cast())
    }

    #[inline(always)]
    pub fn reduce_min(self) -> i32 {
        self.0.reduce_min()
    }

    #[inline(always)]
    pub fn saturating_cast_u8(self) -> Vector<u8, N, I> {
        I::saturating_cast_u8(self)
    }
}

impl<const N: usize, I: Isa> Vector<u64, N, I> {
    /// The full product of the low 32 bits of each lane.
    #[inline(always)]
    pub fn mul_low32(self, other: Self) -> Self {
        let [a, b] = [self, other].map(|v| v.0.cast::<u32>().cast::<u64>());
        Self::new(a * b)
    }

    #[inline(always)]
    pub fn reduce_sum(self) -> u64 {
        self.0.reduce_sum()
    }
}

impl<const N: usize, I: Isa> Vector<f32, N, I> {
    /// The result for NaN is unspecified.
    #[inline(always)]
    pub fn simd_clamp(self, min: f32, max: f32) -> Self {
        Self::new(self.0.simd_max(Simd::splat(min)).simd_min(Simd::splat(max)))
    }
}

/// A type that `Vector::bitcast` can return.
pub trait Bitcast<I> {
    type Bytes;
    fn from_bytes(bytes: Self::Bytes) -> Self;
}

impl<T: Lane, const N: usize, I: Isa> Bitcast<I> for Vector<T, N, I>
where
    Simd<T, N>: ToBytes,
{
    type Bytes = <Simd<T, N> as ToBytes>::Bytes;

    #[inline(always)]
    fn from_bytes(bytes: Self::Bytes) -> Self {
        Self::new(Simd::from_le_bytes(bytes))
    }
}

impl<T: Lane, const N: usize, I: Isa> From<T> for Vector<T, N, I> {
    #[inline(always)]
    fn from(lane: T) -> Self {
        Self::splat(lane)
    }
}

impl<T: Lane, const N: usize, I: Isa> Index<usize> for Vector<T, N, I> {
    type Output = T;

    #[inline(always)]
    fn index(&self, lane: usize) -> &T {
        &self.0[lane]
    }
}

macro_rules! impl_operator {
    ($Op:ident::$op:ident, $OpAssign:ident::$op_assign:ident) => {
        impl<T: Lane, const N: usize, I: Isa, R: Into<Self>> $Op<R> for Vector<T, N, I>
        where
            Simd<T, N>: $Op<Output = Simd<T, N>>,
        {
            type Output = Self;

            #[inline(always)]
            fn $op(self, rhs: R) -> Self {
                Self::new(self.0.$op(rhs.into().0))
            }
        }

        impl<T: Lane, const N: usize, I: Isa, R: Into<Self>> $OpAssign<R> for Vector<T, N, I>
        where
            Simd<T, N>: $Op<Output = Simd<T, N>>,
        {
            #[inline(always)]
            fn $op_assign(&mut self, rhs: R) {
                *self = self.$op(rhs);
            }
        }
    };
}

impl_operator!(Add::add, AddAssign::add_assign);
impl_operator!(Sub::sub, SubAssign::sub_assign);
impl_operator!(BitAnd::bitand, BitAndAssign::bitand_assign);
impl_operator!(BitOr::bitor, BitOrAssign::bitor_assign);
impl_operator!(BitXor::bitxor, BitXorAssign::bitxor_assign);

impl<T: Int<N>, const N: usize, I: Isa> Shl<u32> for Vector<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn shl(self, bits: u32) -> Self {
        debug_assert!((bits as usize) < 8 * size_of::<T>());
        Self::new(self.0 << Simd::splat(bits).cast())
    }
}

impl<T: Int<N>, const N: usize, I: Isa> Shr<u32> for Vector<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn shr(self, bits: u32) -> Self {
        debug_assert!((bits as usize) < 8 * size_of::<T>());
        Self::new(self.0 >> Simd::splat(bits).cast())
    }
}

impl<T: Lane, const N: usize, I: Isa, R: Into<Self>> Mul<R> for Vector<T, N, I>
where
    Simd<T, N>: Mul<Output = Simd<T, N>>,
{
    type Output = Self;

    #[inline(always)]
    fn mul(self, rhs: R) -> Self {
        const { assert!(matches!(size_of::<T>(), 2 | 4), "slow on most targets") };
        Self::new(self.0 * rhs.into().0)
    }
}

impl<T: Int<N>, const N: usize, I: Isa> Not for Vector<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn not(self) -> Self {
        Self::new(!self.0)
    }
}
