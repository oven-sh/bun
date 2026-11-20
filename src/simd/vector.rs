//! The ops that need no intrinsic. LLVM picks the instructions of the function they are inlined into.
use crate::swizzle::{As, DeinterleaveInBlocks, InterleaveInBlocks, Repeat, ShiftRight};
use crate::swizzle::{Shuffle, SwapPairs};
use crate::{Isa, Mask};
use bun_simd_trusted::{from_array, keep16, windows};
use core::array;
use core::marker::PhantomData;
use core::ops::{
    Add, AddAssign, BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Index, Mul,
    Not, RangeInclusive, Shl, Shr, Sub, SubAssign,
};
use core::simd::{self, SimdCast, SimdElement, Swizzle, ToBytes, prelude::*};

/// By value, or LLVM takes the vector of `store_pieces_shared` apart.
#[inline(always)]
pub(crate) fn to_array<T: SimdElement, const N: usize>(lanes: Simd<T, N>) -> [T; N] {
    *lanes.as_array()
}

/// Panics if `lanes` is too short.
#[inline(always)]
pub(crate) fn from_slice<T: SimdElement, const N: usize>(lanes: &[T]) -> Simd<T, N> {
    from_array(*lanes.first_chunk().unwrap())
}

/// The type of a lane.
pub trait Lane: SimdElement + SimdCast + Default {}

/// `core::simd` has `cast` in a trait for each kind of number.
macro_rules! impl_lane {
    ($($T:ty)*) => {$(
        impl Lane for $T {}

        impl<const N: usize, I: Isa> Vector<$T, N, I> {
            /// Converts each lane with `as`.
            #[inline(always)]
            pub fn cast<U: Lane>(self) -> Vector<U, N, I> {
                Vector::new(self.0.cast())
            }
        }
    )*};
}

impl_lane!(u8 i8 u16 i16 u32 i32 u64 i64 f32 f64);

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
        Self::new(from_array(indices).cast())
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
        Self(from_array(lanes), PhantomData)
    }

    #[inline(always)]
    pub fn to_array(self) -> [T; N] {
        to_array(self.0)
    }

    /// Panics if `lanes` is too short.
    #[inline(always)]
    pub fn from_slice(lanes: &[T]) -> Self {
        Self::new(from_slice(lanes))
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

    /// The inverse of `first_bytes`, for integers.
    #[inline(always)]
    pub(crate) fn from_first_bytes<const BYTES: usize>(bytes: Simd<u8, BYTES>) -> Self {
        Self::new(match const { size_of::<T>() } {
            1 => bytes.resize(0).cast(),
            2 => u16x32::from_le_bytes(bytes.resize(0)).resize(0).cast(),
            4 => u32x16::from_le_bytes(bytes.resize(0)).resize(0).cast(),
            _ => u64x8::from_le_bytes(bytes.resize(0)).resize(0).cast(),
        })
    }

    /// Keeps LLVM from putting off the ops before it until after the next call or shared load.
    #[inline(always)]
    pub fn keep(self)
    where
        Simd<T, N>: ToBytes<Bytes = u8x16>,
    {
        keep16(self.0.to_ne_bytes());
    }

    /// The even lanes of both vectors, and the odd lanes of both.
    #[inline(always)]
    pub fn deinterleave(self, other: Self) -> (Self, Self) {
        let (even, odd) = self.0.deinterleave(other.0);
        (Self::new(even), Self::new(odd))
    }

    /// Like `interleave` for each block of 16 bytes.
    #[inline(always)]
    pub fn interleave_in_blocks(self, other: Self) -> (Self, Self) {
        (
            Self::new(InterleaveInBlocks::<T, 0>::concat_swizzle(self.0, other.0)),
            Self::new(InterleaveInBlocks::<T, 1>::concat_swizzle(self.0, other.0)),
        )
    }

    /// Like `deinterleave` for each block of 16 bytes.
    #[inline(always)]
    pub fn deinterleave_in_blocks(self, other: Self) -> (Self, Self) {
        (
            Self::new(DeinterleaveInBlocks::<T, 0>::concat_swizzle(
                self.0, other.0,
            )),
            Self::new(DeinterleaveInBlocks::<T, 1>::concat_swizzle(
                self.0, other.0,
            )),
        )
    }

    #[inline(always)]
    pub fn shuffle<S: Shuffle<N>>(self, other: Self) -> Self {
        Self::new(As::<S>::concat_swizzle(self.0, other.0))
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

/// rustc cannot halve a generic `N`.
macro_rules! impl_halves {
    ($($N:literal $HALF:literal),*) => {$(
        impl<T: Lane, I: Isa> Vector<T, $N, I> {
            #[inline(always)]
            pub fn halves(self) -> [Vector<T, $HALF, I>; 2] {
                [
                    Vector::new(self.0.extract::<0, $HALF>()),
                    Vector::new(self.0.extract::<$HALF, $HALF>()),
                ]
            }

            #[inline(always)]
            pub fn from_halves([first, second]: [Vector<T, $HALF, I>; 2]) -> Self {
                Self::new(Repeat::<$N>::concat_swizzle(first.0, second.0))
            }
        }
    )*};
}

impl_halves!(64 32, 32 16, 16 8, 8 4, 4 2, 2 1);

impl<I: Isa> Vector<u32, 4, I> {
    /// For each lane, the `K` items from that index on, or else the last `K`. `None` if there are fewer.
    #[inline(always)]
    pub fn windows<T, const K: usize>(self, from: &[T]) -> Option<[&[T; K]; 4]> {
        windows(from, self.0)
    }
}

impl<T: Lane, const N: usize, I: Isa> Vector<T, N, I>
where
    Simd<T, N>: SimdPartialOrd<Mask = simd::Mask<T::Mask, N>>,
{
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
}

impl<T: Int<N>, const N: usize, I: Isa> Vector<T, N, I> {
    /// Fills every `K` lanes with `lanes`.
    #[inline(always)]
    pub fn repeat<const K: usize>(lanes: [T; K]) -> Self
    where
        T: Int<K>,
    {
        const { assert!(K <= N && matches!(size_of::<[T; K]>(), 2 | 4 | 8 | 16)) };
        // LLVM does not merge a `splat` of wider lanes with the shuffles after it.
        let lanes = Vector::<T, K, I>::from_array(lanes);
        Self::from_first_bytes(match size_of_val(&lanes) {
            2 => u16x32::splat(u16::from_le_bytes(to_array(lanes.first_bytes()))).to_le_bytes(),
            4 => u32x16::splat(u32::from_le_bytes(to_array(lanes.first_bytes()))).to_le_bytes(),
            8 => u64x8::splat(u64::from_le_bytes(to_array(lanes.first_bytes()))).to_le_bytes(),
            _ => Repeat::<16>::swizzle(lanes.first_bytes::<16>()),
        })
    }

    /// Panics if the vector has fewer than `BYTES` bytes.
    #[inline(always)]
    pub(crate) fn first_bytes<const BYTES: usize>(self) -> Simd<u8, BYTES> {
        from_slice(self.0.to_le_bytes().as_ref())
    }

    /// `a0 b0 a1 b1 ..`, split into two halves.
    #[inline(always)]
    pub fn interleave(self, other: Self) -> (Self, Self) {
        I::interleave(self, other)
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

macro_rules! impl_narrow {
    ($($T:ty)*) => {$(
        impl<const N: usize, I: Isa> Vector<$T, N, I> {
            #[inline(always)]
            pub fn saturating_add(self, other: impl Into<Self>) -> Self {
                Self::new(self.0.saturating_add(other.into().0))
            }

            #[inline(always)]
            pub fn saturating_sub(self, other: impl Into<Self>) -> Self {
                Self::new(self.0.saturating_sub(other.into().0))
            }

            #[inline(always)]
            pub fn reduce_max(self) -> $T {
                self.0.reduce_max()
            }
        }
    )*};
}

impl_narrow!(u8 i8 u16 i16);

impl<const N: usize, I: Isa> Vector<u8, N, I> {
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
        // Each takes fewer shuffles than the other would.
        Self::new(match N {
            32 => Repeat::<N>::concat_swizzle(first.0, second.0).cast(),
            _ => first.0.to_le_bytes().deinterleave(second.0.to_le_bytes()).0,
        })
    }
}

impl<const N: usize, I: Isa> Vector<u16, N, I> {
    /// Zero-extends the first half of the lanes.
    #[inline(always)]
    pub fn widen_lower<const M: usize>(bytes: Vector<u8, M, I>) -> Self
    where
        Simd<u16, N>: ToBytes<Bytes = Simd<u8, M>>,
    {
        Self::new(bytes.0.extract::<0, N>().cast())
    }
}

impl<I: Isa> Vector<i16, 8, I> {
    #[inline(always)]
    pub(crate) fn full_products(self, other: Self) -> Vector<i32, 8, I> {
        self.cast() * other.cast()
    }
}

impl<const N: usize, I: Isa> Vector<i16, N, I> {
    #[inline(always)]
    pub fn abs(self) -> Self {
        Self::new(self.0.abs())
    }

    /// The lanes of `first`, then of `second`, clamped.
    #[inline(always)]
    pub fn saturating_narrow<const M: usize>(
        first: Vector<i32, M, I>,
        second: Vector<i32, M, I>,
    ) -> Self
    where
        Simd<i32, M>: ToBytes<Bytes = <Simd<i16, N> as ToBytes>::Bytes>,
        Simd<i16, N>: ToBytes,
    {
        let [min, max] = [i16::MIN, i16::MAX].map(|it| Simd::splat(it.into()));
        let all = Repeat::<N>::concat_swizzle(first.0, second.0);
        Self::new(all.simd_max(min).simd_min(max).cast())
    }
}

impl<const N: usize, I: Isa> Vector<i32, N, I> {
    #[inline(always)]
    pub fn abs(self) -> Self {
        Self::new(self.0.abs())
    }

    #[inline(always)]
    pub fn reduce_sum(self) -> i32 {
        self.0.reduce_sum()
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
    #[inline(always)]
    pub fn reduce_sum(self) -> u64 {
        self.0.reduce_sum()
    }

    /// The full product of the low 32 bits of each lane.
    #[inline(always)]
    pub fn mul_low32(self, other: Self) -> Self {
        let [a, b] = [self, other].map(|v| v.0.cast::<u32>().cast::<u64>());
        Self::new(a * b)
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

impl<T: Lane, const N: usize, I: Isa> From<Simd<T, N>> for Vector<T, N, I> {
    #[inline(always)]
    fn from(lanes: Simd<T, N>) -> Self {
        Self::new(lanes)
    }
}

impl<T: Lane, const N: usize, I: Isa> From<Vector<T, N, I>> for Simd<T, N> {
    #[inline(always)]
    fn from(vector: Vector<T, N, I>) -> Self {
        vector.0
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

/// Each lane by its own bits, modulo those of a lane. AVX2 has it from 32 bits on, AVX-512 from 16.
impl<T: Int<N>, const N: usize, I: Isa> Shl for Vector<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn shl(self, bits: Self) -> Self {
        Self::new(self.0 << bits.0)
    }
}

impl<T: Int<N>, const N: usize, I: Isa> Shr for Vector<T, N, I> {
    type Output = Self;

    #[inline(always)]
    fn shr(self, bits: Self) -> Self {
        Self::new(self.0 >> bits.0)
    }
}

/// The others are slow to multiply on most targets.
pub trait Factor: Lane {}

impl Factor for u16 {}
impl Factor for i16 {}
impl Factor for u32 {}
impl Factor for i32 {}
impl Factor for f32 {}
impl Factor for f64 {}

impl<T: Factor, const N: usize, I: Isa, R: Into<Self>> Mul<R> for Vector<T, N, I>
where
    Simd<T, N>: Mul<Output = Simd<T, N>>,
{
    type Output = Self;

    #[inline(always)]
    fn mul(self, rhs: R) -> Self {
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
