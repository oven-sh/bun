//! `crate::simd` behind traits, so that code can be generic over the lane type and the width.
//! LLVM picks the instructions for the function that this is inlined into.

use crate::endian::ToBytes;
use crate::lane::{Element, Lane};
use crate::memory::{Place, Source};
use crate::partial::To;
use crate::pattern::{self, Pattern};
#[allow(unused_imports)]
use crate::simd::{Cpu, Here, In};
use crate::simd::{Fits, Mask as CoreMask, MaskElement, Simd as Core, Swizzle, u8x16, u64x2};
use crate::width::{Repr, Width};
use core::cell::Cell;
use core::mem::MaybeUninit;

/// `crate::simd` copies by `copy_nonoverlapping`. With `-Zub-checks` that compares addresses, and so takes vectors through the stack.
pub(crate) mod copy {
    use crate::simd::{Cpu, Fits, Here, In, Simd};
    /// 32-bit x86.
    pub(crate) const X87: bool = cfg!(target_arch = "x86");
    #[inline(always)]
    pub(crate) fn from_array<T: Fits<N>, const N: usize>(array: [T; N]) -> Simd<T, N> {
        if const { cfg!(not(debug_assertions)) && !(X87 && N == 1) } {
            return Simd::of_lanes(array);
        }
        let mut v = Simd::default();
        *v.as_mut_array() = array;
        v
    }
    #[inline(always)]
    pub(crate) fn to_array<T: Fits<N>, const N: usize>(v: Simd<T, N>) -> [T; N] {
        if cfg!(debug_assertions) { *v.as_array() } else { v.to_array() }
    }
    /// Register by register.
    #[inline(always)]
    pub(crate) fn joined<S: Cpu, T: Fits<N>, const N: usize>(array: [T; N]) -> Simd<T, N>
    where
        Here: In<S>,
    {
        if const { cfg!(bun_simd_unoptimized) || N * size_of::<T>() < 16 } {
            from_array(array)
        } else {
            Simd::joined(array)
        }
    }
    #[inline(always)]
    pub(crate) fn parted<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> [T; N]
    where
        Here: In<S>,
    {
        if const { cfg!(bun_simd_unoptimized) || N * size_of::<T>() < 16 } { to_array(v) } else { v.parted() }
    }
    /// The same, for a store.
    #[inline(always)]
    pub(crate) fn stored<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> [T; N]
    where
        Here: In<S>,
    {
        if const { cfg!(all(target_arch = "aarch64", not(bun_simd_unoptimized))) && N * size_of::<T>() >= 32 } {
            v.stored()
        } else {
            parted(v)
        }
    }
    #[inline(always)]
    #[track_caller]
    pub(crate) fn from_slice<T: Fits<N>, const N: usize>(from: &[T]) -> Simd<T, N> {
        if const { cfg!(debug_assertions) || X87 && N == 1 }
            && let Some(array) = from.first_chunk()
        {
            let mut v = Simd::default();
            *v.as_mut_array() = *array;
            return v;
        }
        Simd::of_lanes(*from.first_chunk().expect("the slice is too short"))
    }
    #[inline(always)]
    #[track_caller]
    pub(crate) fn to_slice<T: Fits<N>, const N: usize>(v: Simd<T, N>, to: &mut [T]) {
        if cfg!(debug_assertions)
            && let Some(array) = to.first_chunk_mut()
        {
            *array = *v.as_array()
        } else {
            v.copy_to_slice(to)
        }
    }
    /// Not by `write_copy_of_slice`, which is a call if generics are shared, as at opt-level s.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn to_uninit<T, const N: usize>(values: [T; N], to: &mut [core::mem::MaybeUninit<T>]) {
        *to[..N].as_mut_array().unwrap() = core::mem::MaybeUninit::new(values).into();
    }
    #[inline(always)]
    pub(crate) fn to_start<const N: usize>(bytes: [u8; N], to: &mut [u8]) {
        *to.first_chunk_mut().unwrap() = bytes;
    }
}

pub trait Bits<W: Repr>: Sized {
    /// Little-endian on all CPUs.
    fn to_bytes(self) -> W::U8;
    fn from_bytes(bytes: W::U8) -> Self;
    /// In the order of the CPU, for what doesn't look into the lanes.
    fn to_native(self) -> W::U8;
    fn from_native(bytes: W::U8) -> Self;
}

pub trait RawMask: Copy + Send + Sync + 'static {
    /// See many.rs.
    const PARTS: usize = 1;
    #[inline(always)]
    fn from_parts<Q: RawMask, S: Cpu>(part: impl Fn(usize) -> Q) -> Self
    where
        Here: In<S>,
    {
        part(0).convert::<Self, { pattern::REPEAT }, 0, _>(part(0))
    }
    fn splat<S: Cpu>(value: bool) -> Self
    where
        Here: In<S>;
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>;
    fn any<S: Cpu>(self) -> bool
    where
        Here: In<S>;
    fn all<S: Cpu>(self) -> bool
    where
        Here: In<S>;
    fn to_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>;
    fn from_bits<S: Cpu>(bits: u64) -> Self
    where
        Here: In<S>;
    /// Those after the lanes are unspecified.
    #[inline(always)]
    fn to_more_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        self.to_bits()
    }
    /// Changes the size of the lanes, and then takes the lanes of `R` from `self` and `other`.
    fn convert<R: RawMask, const OP: u8, const K: usize, S: Cpu>(self, other: Self) -> R
    where
        Here: In<S>;
    fn converted<E: MaskElement + Fits<P>, const N: usize, const P: usize, const OP: u8, const K: usize, S: Cpu>(
        a: CoreMask<E, P>,
        b: CoreMask<E, P>,
    ) -> Self
    where
        Here: In<S>;
}

impl<T: MaskElement + Lane + Fits<M>, const M: usize> RawMask for CoreMask<T, M> {
    #[inline(always)]
    fn splat<S: Cpu>(value: bool) -> Self
    where
        Here: In<S>,
    {
        Self::splat(value)
    }
    #[inline(always)]
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        self.join::<S, false>(other).filled()
    }
    #[inline(always)]
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        self.join::<S, true>(other).filled()
    }
    #[inline(always)]
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        self.xor(other).filled()
    }
    #[inline(always)]
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        self.not()
    }
    #[inline(always)]
    fn any<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        self.any()
    }
    #[inline(always)]
    fn all<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        self.all()
    }
    #[inline(always)]
    fn to_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        // Else LLVM joins the parts of a wide mask again, and takes its lanes one by one.
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        if const { M * size_of::<T>() == 16 } {
            use core::arch::wasm32::*;
            let lanes = self.to_simd();
            return match size_of::<T>() {
                1 => i8x16_bitmask(same::<_, Core<i8, 16>>(lanes).into()) as u64,
                2 => i16x8_bitmask(same::<_, Core<i16, 8>>(lanes).into()) as u64,
                4 => i32x4_bitmask(same::<_, Core<i32, 4>>(lanes).into()) as u64,
                _ => i64x2_bitmask(same::<_, Core<i64, 2>>(lanes).into()) as u64,
            };
        }
        self.to_bitmask()
    }
    #[inline(always)]
    fn from_bits<S: Cpu>(bits: u64) -> Self
    where
        Here: In<S>,
    {
        Self::from_bitmask(bits)
    }
    #[inline(always)]
    fn convert<R: RawMask, const OP: u8, const K: usize, S: Cpu>(self, other: Self) -> R
    where
        Here: In<S>,
    {
        R::converted::<T, M, M, OP, K, _>(self, other)
    }
    #[inline(always)]
    fn converted<E: MaskElement + Fits<P>, const N: usize, const P: usize, const OP: u8, const K: usize, S: Cpu>(
        a: CoreMask<E, P>,
        b: CoreMask<E, P>,
    ) -> Self
    where
        Here: In<S>,
    {
        macro_rules! by { ($($t:ident)*) => {$(
            crate::simd::lazily!(size_of::<T>() == size_of::<$t>() => {
                let both: CoreMask<$t, M> = <Pattern<OP, K, N, P, M, 16> as Swizzle<M>>::concat_swizzle_mask::<$t, P>(a.cast::<$t, S>(), b.cast::<$t, S>());
                both.cast::<T, S>()
            });
        )*}; }
        by!(i8 i16 i32 i64);
        unreachable!()
    }
}

/// How a mask is kept. LLVM takes apart a mask that is wider than a register if it lives across a branch.
pub trait Parts<M>: Copy + Send + Sync + 'static {
    fn split<S: Cpu>(mask: M) -> Self
    where
        Here: In<S>;
    fn join<S: Cpu>(self) -> M
    where
        Here: In<S>;
    // `Q` is how the halves are kept. The compiler can't see that in generic code.
    #[inline(always)]
    fn halves<Q: Copy + 'static>(self) -> (Q, Q) {
        unreachable!()
    }
    #[inline(always)]
    fn from_halves<Q: Copy + 'static>(_lower: Q, _upper: Q) -> Self {
        unreachable!()
    }
}

pub use crate::same::same;

impl<M: RawMask> Parts<M> for M {
    #[inline(always)]
    fn split<S: Cpu>(mask: M) -> M
    where
        Here: In<S>,
    {
        mask
    }
    #[inline(always)]
    fn join<S: Cpu>(self) -> M
    where
        Here: In<S>,
    {
        self
    }
}

/// In the mask registers of AVX-512.
#[derive(Copy, Clone)]
pub struct AsBits(pub u64);

impl<M: RawMask> Parts<M> for AsBits {
    #[inline(always)]
    fn split<S: Cpu>(mask: M) -> Self
    where
        Here: In<S>,
    {
        Self(mask.to_bits())
    }
    #[inline(always)]
    fn join<S: Cpu>(self) -> M
    where
        Here: In<S>,
    {
        M::from_bits(self.0)
    }
}

/// The same, and other ways to it.
#[derive(Copy, Clone)]
pub struct AsBoth<R> {
    pub bits: u64,
    /// Whether the highest bits of these lanes are the same or the opposite, and whether the other bits are like them.
    pub in_lanes: bool,
    pub lanes: R,
    pub opposite: bool,
    pub whole: bool,
    /// Made in general registers.
    pub number: Option<u64>,
}

impl<M: RawMask, R: Raw<Lane = u8>> Parts<M> for AsBoth<R> {
    #[inline(always)]
    fn split<S: Cpu>(mask: M) -> Self
    where
        Here: In<S>,
    {
        Self { bits: mask.to_bits(), in_lanes: false, lanes: R::splat(0), opposite: false, whole: false, number: None }
    }
    #[inline(always)]
    fn join<S: Cpu>(self) -> M
    where
        Here: In<S>,
    {
        M::from_bits(self.bits)
    }
}

/// All bits of a lane are equal.
#[derive(Copy, Clone)]
pub struct AsVector<R>(pub R);

impl<R: Raw> Parts<R::Mask> for AsVector<R> {
    #[inline(always)]
    fn split<S: Cpu>(mask: R::Mask) -> Self
    where
        Here: In<S>,
    {
        Self(R::from_mask(mask))
    }
    #[inline(always)]
    fn join<S: Cpu>(self) -> R::Mask
    where
        Here: In<S>,
    {
        self.0.full_lanes()
    }
}

#[derive(Copy, Clone)]
pub struct Halves<H, P>(P, P, core::marker::PhantomData<H>);

impl<M: RawMask, H: RawMask, P: Parts<H>> Parts<M> for Halves<H, P> {
    #[inline(always)]
    fn split<S: Cpu>(mask: M) -> Self
    where
        Here: In<S>,
    {
        let (lower, upper) =
            (mask.convert::<H, { pattern::PART }, 0, _>(mask), mask.convert::<H, { pattern::PART }, 1, _>(mask));
        Self(P::split(lower), P::split(upper), core::marker::PhantomData)
    }
    #[inline(always)]
    fn join<S: Cpu>(self) -> M
    where
        Here: In<S>,
    {
        self.0.join().convert::<M, { pattern::PART }, 0, _>(self.1.join())
    }
    #[inline(always)]
    fn halves<Q: Copy + 'static>(self) -> (Q, Q) {
        (same(self.0), same(self.1))
    }
    #[inline(always)]
    fn from_halves<Q: Copy + 'static>(lower: Q, upper: Q) -> Self {
        Self(same(lower), same(upper), core::marker::PhantomData)
    }
}

macro_rules! not_for_this_lane {
    ($(fn $name:ident(self $(, $arg:ident)*);)*) => {$(
        #[inline(always)]
        fn $name<S: Cpu>(self $(, $arg: Self)*) -> Self where Here: In<S> {
            $(let _ = $arg;)*
            unreachable!()
        }
    )*};
}

#[inline(always)]
pub fn bools<const N: usize>(mut lane: impl FnMut(usize) -> bool) -> [bool; N] {
    let (mut all, mut i) = ([false; N], 0);
    while i < N {
        all[i] = lane(i);
        i += 1;
    }
    all
}

pub trait Raw: Copy + Send + Sync + 'static {
    type Lane: Lane;
    type Mask: RawMask;
    /// The names are for messages.
    type ArrayWhoseSliceIsAsRefOrAsMut: Copy
        + Send
        + Sync
        + PartialEq
        + core::fmt::Debug
        + crate::array::Lanes<Self::Lane>
        + IntoIterator<Item = Self::Lane, IntoIter: ExactSizeIterator + DoubleEndedIterator>;

    type BoolsWhoseSliceIsAsRefOrAsMut: Copy
        + Send
        + Sync
        + Eq
        + core::fmt::Debug
        + crate::array::Lanes<bool>
        + IntoIterator<Item = bool, IntoIter: ExactSizeIterator + DoubleEndedIterator>;
    fn bools(lane: impl FnMut(usize) -> bool) -> Self::BoolsWhoseSliceIsAsRefOrAsMut;

    /// The same in lanes that `crate::simd` has.
    type Stored: Raw<Lane = <Self::Lane as crate::lane::Repr>::Stored>;

    fn from_stored(v: Self::Stored) -> Self;
    fn zero() -> Self {
        unreachable!()
    }
    fn unordered<S: Cpu>(self, _: Self) -> Self::Mask
    where
        Here: In<S>,
    {
        unreachable!()
    }
    #[inline(always)]
    fn shl_by<S: Cpu>(self, _count: u32) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    #[inline(always)]
    fn shr_by<S: Cpu>(self, _count: u32) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn splat<S: Cpu>(value: Self::Lane) -> Self
    where
        Here: In<S>;
    fn iota<S: Cpu>() -> Self
    where
        Here: In<S>;
    fn to_array<S: Cpu>(self) -> Self::ArrayWhoseSliceIsAsRefOrAsMut
    where
        Here: In<S>;
    fn lanes(&self) -> &[Self::Lane];
    fn lanes_mut(&mut self) -> &mut [Self::Lane];
    fn from_array<S: Cpu>(array: Self::ArrayWhoseSliceIsAsRefOrAsMut) -> Self
    where
        Here: In<S>;
    /// The same, if the lanes were written one by one.
    #[inline(always)]
    fn of_each<S: Cpu>(array: Self::ArrayWhoseSliceIsAsRefOrAsMut) -> Self
    where
        Here: In<S>,
    {
        Self::from_array(array)
    }
    fn load<S: Cpu>(from: &[Self::Lane]) -> Self
    where
        Here: In<S>;
    fn store<S: Cpu>(self, to: &mut [Self::Lane])
    where
        Here: In<S>;
    fn store_masked<S: Cpu>(self, to: &mut [Self::Lane], mask: Self::Mask)
    where
        Here: In<S>;
    // Only for whole registers.
    fn load_by_bits<S: crate::Isa>(_s: S, _from: &[Self::Lane], _skip: usize, _no: Self) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn store_by_bits<S: crate::Isa>(
        self,
        _s: S,
        _to: Result<&mut [Self::Lane], &mut [MaybeUninit<Self::Lane>]>,
        _skip: usize,
    ) where
        Here: In<S>,
    {
        unreachable!()
    }
    fn load_cells<S: crate::Isa>(_s: S, _from: &[Cell<Self::Lane>], _skip: usize) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn store_cells<S: crate::Isa>(self, _s: S, _to: &[Cell<Self::Lane>], _skip: usize)
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn fill_by_bits<S: Cpu>(self, _to: &mut [MaybeUninit<Self::Lane>], _skip: usize) -> &mut [Self::Lane]
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn load_in_parts<S: Cpu>(from: &[Self::Lane]) -> Self
    where
        Here: In<S>;
    fn store_in_parts<S: Cpu>(self, to: &mut [Self::Lane])
    where
        Here: In<S>;
    fn store_uninit<S: Cpu>(self, to: &mut [MaybeUninit<Self::Lane>])
    where
        Here: In<S>;
    fn read<F: Source<Self::Lane>, S: Cpu>(from: F, at: usize) -> Self
    where
        Here: In<S>;
    fn write<F: Place<Self::Lane>, S: Cpu>(self, to: &mut F, at: usize)
    where
        Here: In<S>;
    fn load3(from: &[Self::Lane]) -> [Self; 3];
    fn load4(from: &[Self::Lane]) -> [Self; 4];
    /// Only for whole registers of NEON.
    fn store2(_vectors: [Self; 2], _to: &mut [Self::Lane]) {
        unreachable!()
    }
    fn store3(vectors: [Self; 3], to: &mut [Self::Lane]);
    fn store4(vectors: [Self; 4], to: &mut [Self::Lane]);

    fn add<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn sub<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn mul<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn min<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn max<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>;
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>;
    fn eq<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>;
    fn ne<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>;
    fn lt<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>;
    fn le<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>;
    fn select<S: Cpu>(mask: Self::Mask, yes: Self, no: Self) -> Self
    where
        Here: In<S>;
    fn from_mask(mask: Self::Mask) -> Self;
    fn top_bits<S: Cpu>(self) -> Self::Mask
    where
        Here: In<S>;
    /// The same, if all bits of a lane are equal.
    #[inline(always)]
    fn full_lanes<S: Cpu>(self) -> Self::Mask
    where
        Here: In<S>,
    {
        self.top_bits()
    }
    fn reduce_sum<S: Cpu>(self) -> Self::Lane
    where
        Here: In<S>;
    fn reduce_min<S: Cpu>(self) -> Self::Lane
    where
        Here: In<S>;
    fn reduce_max<S: Cpu>(self) -> Self::Lane
    where
        Here: In<S>;

    not_for_this_lane! {
        fn neg(self); fn abs(self);
        fn shl(self, by); fn shr(self, by); fn saturating_add(self, other); fn saturating_sub(self, other);
        fn abs_diff(self, other); fn average_round(self, other); fn swap_bytes(self); fn reverse_bits(self);
        fn count_ones(self); fn leading_zeros(self); fn trailing_zeros(self);
        fn div(self, other); fn sqrt(self); fn fma(self, mul, add);
        fn floor(self); fn ceil(self); fn trunc(self); fn round(self); fn round_ties_even(self);
    }

    /// `as` for each lane. The number of lanes has to be equal.
    #[inline(always)]
    fn cast<R: Raw, S: Cpu>(self) -> R
    where
        Here: In<S>,
    {
        R::casted(self)
    }
    fn casted<R: Raw, S: Cpu>(from: R) -> Self
    where
        Here: In<S>;
    #[inline(always)]
    fn cast_part<T: Element, S: Cpu>(self, _part: usize) -> Core<T, 64>
    where
        Here: In<S>,
    {
        self.cast_lanes()
    }
    fn picked<const N: usize, const OP: u8, const K: usize>(a: &[Self::Lane; N], b: &[Self::Lane; N]) -> Self;
    fn cast_lanes<T: Element + Fits<Q>, const Q: usize, S: Cpu>(self) -> Core<T, Q>
    where
        Here: In<S>;
    fn shuffle<R: Raw<Lane = Self::Lane>, const OP: u8, const K: usize>(self, other: Self) -> R;
    /// From the first `N` lanes of each operand.
    fn shuffled<const N: usize, const P: usize, const OP: u8, const K: usize, const JOINED: bool>(
        a: Core<<Self::Lane as crate::lane::Repr>::Stored, P>,
        b: Core<<Self::Lane as crate::lane::Repr>::Stored, P>,
    ) -> Self
    where
        <Self::Lane as crate::lane::Repr>::Stored: Fits<P>;
    /// `self` has the indices.
    fn gather<R: Raw, S: Cpu>(self, no: R, mask: R::Mask, table: &[R::Lane]) -> R
    where
        Here: In<S>;
    fn scatter<R: Raw, S: Cpu>(self, lanes: R, mask: R::Mask, table: &mut [R::Lane])
    where
        Here: In<S>;
    fn gathered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &[Self::Lane], indices: Core<usize, M>) -> Self
    where
        usize: Fits<M>,
        Here: In<S>;
    fn scattered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &mut [Self::Lane], indices: Core<usize, M>)
    where
        usize: Fits<M>,
        Here: In<S>;
    // Only on x86-64, for whole registers, indices that are `u32`, and the first 2^31 values.
    #[cfg(target_arch = "x86_64")]
    fn gathered32<R: Raw, S: Cpu>(self, _mask: Self::Mask, _table: &[Self::Lane], _indices: R) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    #[cfg(target_arch = "x86_64")]
    fn scattered32<R: Raw, S: Cpu>(self, _mask: Self::Mask, _table: &mut [Self::Lane], _indices: R)
    where
        Here: In<S>,
    {
        unreachable!()
    }
}

/// The first `min(from.len(), 16)` bytes, with two loads that overlap.
#[cfg(target_endian = "little")]
#[inline(always)]
fn load_up_to_16(from: &[u8]) -> u8x16 {
    let n = from.len();
    if let Some(all) = from.first_chunk::<16>() {
        copy::from_array::<u8, 16>(*all)
    } else if let (Some(first), Some(last)) = (from.first_chunk::<8>(), from.last_chunk::<8>()) {
        let last = u64::from_le_bytes(*last) >> 1 >> (127 - 8 * n);
        copy::from_array::<u64, 2>([u64::from_le_bytes(*first), last]).to_le_bytes()
    } else if let (Some(first), Some(last)) = (from.first_chunk::<4>(), from.last_chunk::<4>()) {
        let both = u32::from_le_bytes(*first) as u64 | (u32::from_le_bytes(*last) as u64) << (8 * n - 32);
        copy::from_array::<u64, 2>([both, 0]).to_le_bytes()
    } else if n > 0 {
        let all = from[0] as u64 | (from[n / 2] as u64) << (n / 2 * 8) | (from[n - 1] as u64) << (8 * n - 8);
        copy::from_array::<u64, 2>([all, 0]).to_le_bytes()
    } else {
        u8x16::zero()
    }
}

#[cfg(target_endian = "little")]
#[inline(always)]
fn store_up_to_15(v: u8x16, to: &mut [u8]) {
    let n = to.len();
    let [low, high] = copy::to_array(u64x2::from_le_bytes(v));
    if n >= 8 {
        let last = low >> (8 * n - 64) | high << 1 << (127 - 8 * n);
        copy::to_start(last.to_le_bytes(), &mut to[n - 8..]);
        copy::to_start(low.to_le_bytes(), to);
    } else if n >= 4 {
        copy::to_start((low as u32).to_le_bytes(), to);
        copy::to_start(((low >> (8 * n - 32)) as u32).to_le_bytes(), &mut to[n - 4..]);
    } else if n > 0 {
        to[0] = low as u8;
        to[n / 2] = (low >> (n / 2 * 8)) as u8;
        to[n - 1] = (low >> (8 * n - 8)) as u8;
    }
}

#[cfg(target_endian = "big")]
#[inline(always)]
fn load_up_to_16(from: &[u8]) -> u8x16 {
    let n = from.len();
    if let Some(all) = from.first_chunk::<16>() {
        u8x16::from_array(*all)
    } else if let (Some(first), Some(last)) = (from.first_chunk::<8>(), from.last_chunk::<8>()) {
        u64x2::from_array([u64::from_be_bytes(*first), u64::from_be_bytes(*last) << 1 << (127 - 8 * n)]).to_be_bytes()
    } else if let (Some(first), Some(last)) = (from.first_chunk::<4>(), from.last_chunk::<4>()) {
        u64x2::from_array([
            (u32::from_be_bytes(*first) as u64) << 32 | (u32::from_be_bytes(*last) as u64) << (64 - 8 * n),
            0,
        ])
        .to_be_bytes()
    } else if n > 0 {
        u64x2::from_array([
            (from[0] as u64) << 56 | (from[n / 2] as u64) << (56 - n / 2 * 8) | (from[n - 1] as u64) << (64 - 8 * n),
            0,
        ])
        .to_be_bytes()
    } else {
        u8x16::zero()
    }
}

#[cfg(target_endian = "big")]
#[inline(always)]
fn store_up_to_15(v: u8x16, to: &mut [u8]) {
    let n = to.len();
    let [first, second] = u64x2::from_be_bytes(v).to_array();
    if n >= 8 {
        let last = first << (8 * n - 64) | second >> 1 >> (127 - 8 * n);
        to[n - 8..].copy_from_slice(&last.to_be_bytes());
        to[..8].copy_from_slice(&first.to_be_bytes());
    } else if n >= 4 {
        to[..4].copy_from_slice(&((first >> 32) as u32).to_be_bytes());
        to[n - 4..].copy_from_slice(&((first >> (64 - 8 * n)) as u32).to_be_bytes());
    } else if n > 0 {
        to[0] = (first >> 56) as u8;
        to[n / 2] = (first >> (56 - n / 2 * 8)) as u8;
        to[n - 1] = (first >> (64 - 8 * n)) as u8;
    }
}

/// The lanes in 16 bytes, as a literal.
macro_rules! block {
    (u8) => {
        16
    };
    (i8) => {
        16
    };
    (u16) => {
        8
    };
    (i16) => {
        8
    };
    (u32) => {
        4
    };
    (i32) => {
        4
    };
    (f32) => {
        4
    };
    (u64) => {
        2
    };
    (i64) => {
        2
    };
    (f64) => {
        2
    };
}

macro_rules! in_parts {
    (u8) => {
        #[inline(always)]
        fn load_in_parts<S: Cpu>(from: &[u8]) -> Self
        where
            Here: In<S>,
        {
            if const { N <= 16 } {
                return load_up_to_16(&from[..from.len().min(N)]).resize();
            }
            let (whole, rest) = from[..from.len().min(N)].as_chunks::<16>();
            let rest = load_up_to_16(rest);
            let block = |i: usize| match whole.get(i) {
                Some(block) => copy::from_array::<u8, 16>(*block),
                None if i == whole.len() => rest,
                None => u8x16::zero(),
            };
            let pair =
                |i: usize| -> Core<u8, 32> { block(i).shuffle::<Core<u8, 32>, { pattern::PART }, 0>(block(i + 1)) };
            if const { N <= 32 } { pair(0).resize() } else { pair(0).shuffle::<_, { pattern::PART }, 0>(pair(2)) }
        }
        #[inline(always)]
        fn store_in_parts<S: Cpu>(self, to: &mut [u8])
        where
            Here: In<S>,
        {
            if const { N < 16 } {
                let n = to.len().min(N);
                return store_up_to_15(self.resize::<16>(), &mut to[..n]);
            }
            if let Some(all) = to.first_chunk_mut() {
                return *all = copy::to_array(self);
            }
            let (mut v, mut to) = (self, to);
            macro_rules! take {
                ($bytes:literal) => {
                    if const { $bytes < N } && to.len() >= $bytes {
                        copy::to_slice(v.resize::<$bytes>(), to);
                        (v, to) = (v.shuffle::<_, { pattern::SLIDE_DOWN }, $bytes>(v), &mut to[$bytes..]);
                    }
                };
            }
            take!(32);
            take!(16);
            store_up_to_15(v.resize::<16>(), to);
        }
    };
    ($t:ident) => {
        #[inline(always)]
        fn load_in_parts<S: Cpu>(from: &[$t]) -> Self
        where
            Here: In<S>,
        {
            Lanes::<$t, N, { block!($t) }>::load_in_parts(from)
        }
        #[inline(always)]
        fn store_in_parts<S: Cpu>(self, to: &mut [$t])
        where
            Here: In<S>,
        {
            Lanes::<$t, N, { block!($t) }>::store_in_parts(self, to)
        }
    };
}

/// What is long, and the same for all lanes, is compiled once. 16 bytes have `BLOCK` lanes.
struct Lanes<T, const N: usize, const BLOCK: usize>(T);

/// LLVM turns one wide load and strided shuffles of it into `ld3` and `ld4`. `$lanes` lists the values of `N`.
macro_rules! interleaved {
    ($load:ident, $store:ident, $k:literal, [$($i:literal)*], [$($lanes:literal)*]) => {
        #[inline(always)]
        fn $load(from: &[T]) -> [Core<T, N>; $k] {
            crate::simd::interleaved::$load(from)
        }
        #[inline(always)]
        fn $store(vectors: [Core<T, N>; $k], to: &mut [T]) {
            crate::simd::interleaved::$store(vectors, to)
        }
    };
}

impl<T: Element + Fits<N>, const N: usize, const BLOCK: usize> Lanes<T, N, BLOCK> {
    #[inline(always)]
    fn load_in_parts<S: Cpu>(from: &[T]) -> Core<T, N>
    where
        Core<T, N>: Raw<Lane = T>,
        Here: In<S>,
    {
        let n = from.len();
        if n >= N {
            return Raw::load(from);
        }
        let mut v = Core::zero();
        macro_rules! prepend {
            ($lanes:literal) => {
                if const { $lanes < N } && n & $lanes != 0 {
                    let part = copy::from_slice::<T, $lanes>(&from[n & !(2 * $lanes - 1)..]).resize();
                    v = Pattern::<{ pattern::PREPEND }, $lanes, N, N, N, BLOCK>::concat_swizzle(v, part);
                }
            };
        }
        prepend!(1);
        prepend!(2);
        prepend!(4);
        prepend!(8);
        prepend!(16);
        prepend!(32);
        v
    }
    #[inline(always)]
    fn store_in_parts<S: Cpu>(mut v: Core<T, N>, to: &mut [T])
    where
        Here: In<S>,
    {
        let n = to.len();
        if n >= N {
            return copy::to_slice(v, to);
        }
        macro_rules! take {
            ($lanes:literal) => {
                if const { $lanes < N } && n & $lanes != 0 {
                    let to = &mut to[n & !(2 * $lanes - 1)..];
                    if const { $lanes == 1 && copy::X87 } {
                        to[0] = v[0]
                    } else {
                        copy::to_slice(v.resize::<$lanes>(), to)
                    }
                    v = Pattern::<{ pattern::SLIDE_DOWN }, $lanes, N, N, N, BLOCK>::concat_swizzle(v, v);
                }
            };
        }
        take!(32);
        take!(16);
        take!(8);
        take!(4);
        take!(2);
        take!(1);
        let _ = v;
    }
    interleaved!(load3, store3, 3, [0 1 2], [1 2 4 8 16]);
    interleaved!(load4, store4, 4, [0 1 2 3], [1 2 4 8 16]);
}

macro_rules! interleaved_lanes {
    (@load f32, $($rest:tt)*) => { interleaved_lanes!(@bits u32, $($rest)*) };
    (@load f64, $($rest:tt)*) => { interleaved_lanes!(@bits u64, $($rest)*) };
    (@load $t:ident, $load:ident($from:ident), $($i:literal)*) => { Lanes::<$t, N, { block!($t) }>::$load($from) };
    // What comes out is cast to integers, and LLVM would put that between the load and the shuffles.
    (@bits $u:ident, $load:ident($from:ident), $($i:literal)*) => {{
        if const { copy::X87 && N == 1 } {
            return [$(copy::from_slice(&$from[$i..])),*];
        }
        let all = Lanes::<$u, N, { block!($u) }>::$load(crate::lane::Repr::unsigned($from));
        [$(all[$i].bits()),*]
    }};
    ($t:ident, $load:ident, $store:ident, $k:literal, $($i:literal)*) => {
        #[inline(always)]
        fn $load(from: &[$t]) -> [Self; $k] { interleaved_lanes!(@load $t, $load(from), $($i)*) }
        #[inline(always)]
        fn $store(vectors: [Self; $k], to: &mut [$t]) { Lanes::<$t, N, { block!($t) }>::$store(vectors, to) }
    };
}

macro_rules! raw {
    ($t:ident, $mask:ident, $($by_kind:tt)*) => {
        impl<const N: usize> Raw for Core<$t, N> where $t: Fits<N> {
            type Lane = $t;
            type Mask = CoreMask<$mask, N>;
            type ArrayWhoseSliceIsAsRefOrAsMut = [$t; N];
            type BoolsWhoseSliceIsAsRefOrAsMut = [bool; N];
            #[inline(always)] fn bools(lane: impl FnMut(usize) -> bool) -> [bool; N] { crate::raw::bools(lane) }
            type Stored = Self;

            #[inline(always)] fn from_stored(v: Self) -> Self { v }
            #[inline(always)] fn zero() -> Self { Self::zero() }
            #[inline(always)] fn shl_by<S: Cpu>(self, count: u32) -> Self { self.shl_by(count) }
            #[inline(always)] fn shr_by<S: Cpu>(self, count: u32) -> Self { self.shr_by(count) }
            #[inline(always)] fn splat<S: Cpu>(value: $t) -> Self where Here: In<S> { Self::splat(value) }
            #[inline(always)]
            fn iota<S: Cpu>() -> Self where Here: In<S> {
                const {
                    let (mut lanes, mut i) = ([0 as $t; N], 0);
                    while i < N { lanes[i] = i as $t; i += 1; }
                    Self::from_array(lanes)
                }
            }
            #[inline(always)] fn to_array<S: Cpu>(self) -> [$t; N] where Here: In<S> { copy::parted(self) }
            #[inline(always)] fn lanes(&self) -> &[$t] { self.as_array() }
            #[inline(always)] fn lanes_mut(&mut self) -> &mut [$t] { self.as_mut_array() }
            #[inline(always)]
            fn from_array<S: Cpu>(array: [$t; N]) -> Self where Here: In<S> { copy::joined(array) }
            #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(bun_simd_unoptimized)))]
            #[inline(always)]
            fn of_each<S: Cpu>(array: [$t; N]) -> Self where Here: In<S> { crate::simd::of_each(array) }
            #[inline(always)]
            #[track_caller]
            fn load<S: Cpu>(from: &[$t]) -> Self where Here: In<S> {
                copy::joined(*from.first_chunk().expect("the slice is too short"))
            }
            #[inline(always)] #[track_caller] fn store<S: Cpu>(self, to: &mut [$t]) where Here: In<S> {
                *to.first_chunk_mut().expect("the slice is too short") = copy::stored(self) }
            #[inline(always)]
            fn store_masked<S: Cpu>(self, to: &mut [$t], mask: Self::Mask) where Here: In<S> { crate::partial::store::<S, _, N>(None::<crate::Portable>, self, To::Values(to), 0, Some(mask)) }
            #[inline(always)]
            fn load_by_bits<S: crate::Isa>(s: S, from: &[$t], skip: usize, no: Self) -> Self where Here: In<S> { crate::partial::load::<S, _, N>(crate::tag::with_low_bits(s), Ok(from), skip, None, no) }
            #[inline(always)]
            fn load_cells<S: crate::Isa>(s: S, from: &[Cell<$t>], skip: usize) -> Self where Here: In<S> { crate::partial::load::<S, _, N>(crate::tag::with_low_bits(s), Err(from), skip, None, Self::zero()) }
            #[inline(always)]
            fn store_cells<S: crate::Isa>(self, s: S, to: &[Cell<$t>], skip: usize) where Here: In<S> { crate::partial::store::<S, _, N>(crate::tag::with_low_bits(s), self, To::Cells(to), skip, None) }
            #[inline(always)]
            fn store_by_bits<S: crate::Isa>(self, s: S, to: Result<&mut [$t], &mut [MaybeUninit<$t>]>, skip: usize) where Here: In<S> {
                crate::partial::store::<S, _, N>(crate::tag::with_low_bits(s), self, match to { Ok(to) => To::Values(to), Err(to) => To::Room(to) }, skip, None)
            }
            #[inline(always)]
            fn fill_by_bits<S: Cpu>(self, to: &mut [MaybeUninit<$t>], skip: usize) -> &mut [$t] where Here: In<S> { crate::partial::fill::<S, _, N>(self, to, skip) }
            in_parts!($t);
            #[inline(always)]
            #[track_caller]
            fn store_uninit<S: Cpu>(self, to: &mut [MaybeUninit<$t>]) where Here: In<S> { copy::to_uninit(copy::stored(self), to) }
            #[inline(always)]
            fn read<F: Source<$t>, S: Cpu>(from: F, at: usize) -> Self where Here: In<S> { Raw::from_array(from.read(at)) }
            #[inline(always)]
            fn write<F: Place<$t>, S: Cpu>(self, to: &mut F, at: usize) where Here: In<S> { to.write(at, copy::stored(self)) }
            #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
            #[inline(always)]
            fn store2(vectors: [Self; 2], to: &mut [$t]) { crate::simd::interleaved::store2(vectors, to) }
            interleaved_lanes!($t, load3, store3, 3, 0 1 2);
            interleaved_lanes!($t, load4, store4, 4, 0 1 2 3);

            #[inline(always)] fn add<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.add(other) }
            #[inline(always)] fn sub<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.sub(other) }
            // LLVM doesn't see that after a comparison of floats.
            #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
            #[inline(always)]
            fn full_lanes<S: Cpu>(self) -> Self::Mask where Here: In<S> {
                if const { size_of::<$t>() == 8 && S::LEVEL < crate::simd::AVX512 } { CoreMask::of(self.0) } else { self.top_bits() }
            }
            #[cfg(not(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")))]
            #[inline(always)]
            fn full_lanes<S: Cpu>(self) -> Self::Mask where Here: In<S> {
                if const { crate::simd::ARRAYS || crate::WASM || cfg!(all(target_arch = "aarch64", target_endian = "little")) } { CoreMask::of(self.0) } else { self.top_bits() }
            }
            #[inline(always)] fn mul<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.mul(other) }
            #[inline(always)] fn eq<S: Cpu>(self, other: Self) -> Self::Mask where Here: In<S> { self.simd_eq(other) }
            #[inline(always)] fn ne<S: Cpu>(self, other: Self) -> Self::Mask where Here: In<S> { self.simd_ne(other) }
            #[inline(always)] fn lt<S: Cpu>(self, other: Self) -> Self::Mask where Here: In<S> { self.simd_lt(other) }
            #[inline(always)] fn le<S: Cpu>(self, other: Self) -> Self::Mask where Here: In<S> { self.simd_le(other) }
            #[inline(always)] fn select<S: Cpu>(mask: Self::Mask, yes: Self, no: Self) -> Self where Here: In<S> { mask.select(yes, no) }

            #[inline(always)]
            fn casted<R: Raw, S: Cpu>(from: R) -> Self where Here: In<S> { from.cast_lanes() }
            #[inline(always)]
            fn cast_lanes<T: Element + Fits<Q>, const Q: usize, S: Cpu>(self) -> Core<T, Q> where Here: In<S> {
                self.cast_padded::<T, S, Q>()
            }
            #[inline(always)]
            fn shuffle<R: Raw<Lane = $t>, const OP: u8, const K: usize>(self, other: Self) -> R {
                R::shuffled::<N, N, OP, K, false>(self, other)
            }
            #[inline(always)]
            fn shuffled<const FROM: usize, const P: usize, const OP: u8, const K: usize, const JOINED: bool>(
                a: Core<$t, P>,
                b: Core<$t, P>,
            ) -> Self where $t: Fits<P> {
                Pattern::<OP, K, FROM, P, N, { block!($t) }, JOINED>::concat_swizzle(a, b)
            }
            #[inline(always)]
            fn picked<const FROM: usize, const OP: u8, const K: usize>(a: &[$t; FROM], b: &[$t; FROM]) -> Self {
                crate::many::pick::<$t, OP, K, FROM, N, 0>(a, b).resize()
            }
            #[inline(always)]
            fn gather<R: Raw, S: Cpu>(self, no: R, mask: R::Mask, table: &[R::Lane]) -> R where Here: In<S> {
                no.gathered(mask, table, raw!(@cast self, Usize, $($by_kind)*))
            }
            #[inline(always)]
            fn scatter<R: Raw, S: Cpu>(self, lanes: R, mask: R::Mask, table: &mut [R::Lane]) where Here: In<S> {
                lanes.scattered(mask, table, raw!(@cast self, Usize, $($by_kind)*))
            }
            #[inline(always)]
            fn gathered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &[$t], indices: Core<usize, M>) -> Self where usize: Fits<M>, Here: In<S> {
                crate::indexed::gather::<S, _, usize, N>(table, mask.cast::<isize, S>(), crate::raw::resized::<M, N, S>(indices), self)
            }
            #[inline(always)]
            fn scattered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &mut [$t], indices: Core<usize, M>) where usize: Fits<M>, Here: In<S> {
                crate::indexed::scatter::<S, _, usize, N>(self, table, mask.cast::<isize, S>(), crate::raw::resized::<M, N, S>(indices))
            }
            #[cfg(target_arch = "x86_64")]
            #[inline(always)]
            fn gathered32<R: Raw, S: Cpu>(self, mask: Self::Mask, table: &[$t], indices: R) -> Self where Here: In<S> { crate::indexed::gather::<S, _, u32, N>(table, mask.cast(), indices.cast_lanes(), self) }
            #[cfg(target_arch = "x86_64")]
            #[inline(always)]
            fn scattered32<R: Raw, S: Cpu>(self, mask: Self::Mask, table: &mut [$t], indices: R) where Here: In<S> { crate::indexed::scatter::<S, _, u32, N>(self, table, mask.cast(), indices.cast_lanes()) }
            raw!(@kind $t, $mask, $($by_kind)*);
        }
    };
    (@cast $self:ident, Usize, $trait:ident $($rest:tt)*) => { $self.cast::<usize, _>() };
    (@cast $self:ident, $r:ident, $trait:ident $($rest:tt)*) => { $self.cast::<$r, _>() };
    (@kind $t:ident, $mask:ident, SimdUint $($wide:ident)?) => {
        // LLVM mostly makes one instruction of this, but not of a chain: the targets use intrinsics.
        $(#[inline(always)]
        fn average_round<S: Cpu>(self, other: Self) -> Self where Here: In<S> {
            let _: $wide; self.average(other)
        })?
        raw!(@int $t, $mask, SimdUint);
        #[inline(always)] fn from_mask(mask: Self::Mask) -> Self { bits_or!((mask), mask.to_simd().bits()) }
        #[inline(always)] fn top_bits<S: Cpu>(self) -> Self::Mask where Here: In<S> { self.is_negative() }
        #[inline(always)] fn abs_diff<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.abs_diff(other) }
        #[inline(always)] fn count_ones<S: Cpu>(self) -> Self where Here: In<S> { self.count_ones() }
        #[inline(always)] fn leading_zeros<S: Cpu>(self) -> Self where Here: In<S> { self.leading_zeros() }
        #[inline(always)] fn trailing_zeros<S: Cpu>(self) -> Self where Here: In<S> { self.trailing_zeros() }
    };
    (@kind $t:ident, $mask:ident, SimdInt) => {
        raw!(@int $t, $mask, SimdInt);
        #[inline(always)] fn from_mask(mask: Self::Mask) -> Self { bits_or!((mask), mask.to_simd()) }
        #[inline(always)] fn top_bits<S: Cpu>(self) -> Self::Mask where Here: In<S> { self.is_negative() }
        #[inline(always)] fn neg<S: Cpu>(self) -> Self where Here: In<S> { self.neg() }
        #[inline(always)] fn abs<S: Cpu>(self) -> Self where Here: In<S> { self.abs() }
        #[inline(always)] fn abs_diff<S: Cpu>(self, other: Self) -> Self where Here: In<S> {
            self.abs_diff(other)
        }
        #[inline(always)] fn count_ones<S: Cpu>(self) -> Self where Here: In<S> { self.count_ones() }
        #[inline(always)] fn leading_zeros<S: Cpu>(self) -> Self where Here: In<S> { self.leading_zeros() }
        #[inline(always)] fn trailing_zeros<S: Cpu>(self) -> Self where Here: In<S> { self.trailing_zeros() }
    };
    (@int $t:ident, $mask:ident, $trait:ident) => {
        #[inline(always)] fn min<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.simd_min(other) }
        #[inline(always)] fn max<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.simd_max(other) }
        #[inline(always)] fn and<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.and(other) }
        #[inline(always)] fn or<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.or(other) }
        #[inline(always)] fn xor<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.xor(other) }
        #[inline(always)] fn not<S: Cpu>(self) -> Self where Here: In<S> { self.not() }
        #[inline(always)] fn shl<S: Cpu>(self, by: Self) -> Self where Here: In<S> {
            // LLVM doesn't evaluate the conversion from floats that makes the powers of two.
            #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
            if const { S::LEVEL < crate::simd::AVX2 && matches!(size_of::<Self::Lane>(), 2 | 4) } && are_known!(by) {
                let mut powers = by.to_array();
                unrolled!(64, for i in 0..N { powers[i] = <Self::Lane as crate::Lane>::ONE.wrapping_shl(powers[i] as u32) });
                return self.mul(Core::from_array(powers));
            }
            self.shl(by)
        }
        #[inline(always)] fn shr<S: Cpu>(self, by: Self) -> Self where Here: In<S> { self.shr(by) }
        #[inline(always)] fn saturating_add<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.saturating_add(other) }
        #[inline(always)] fn saturating_sub<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.saturating_sub(other) }
        #[inline(always)] fn swap_bytes<S: Cpu>(self) -> Self where Here: In<S> { self.swap_bytes() }
        #[inline(always)] fn reverse_bits<S: Cpu>(self) -> Self where Here: In<S> { self.reverse_bits() }
        #[inline(always)] fn reduce_sum<S: Cpu>(self) -> $t where Here: In<S> { self.reduce_sum() }
        #[inline(always)] fn reduce_min<S: Cpu>(self) -> $t where Here: In<S> { self.reduce_min() }
        #[inline(always)] fn reduce_max<S: Cpu>(self) -> $t where Here: In<S> { self.reduce_max() }
    };
    (@kind $t:ident, $mask:ident, SimdFloat) => {
        #[inline(always)] fn min<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.simd_min(other) }
        #[inline(always)] fn max<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.simd_max(other) }
        #[inline(always)] fn and<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.and(other) }
        #[inline(always)] fn or<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.or(other) }
        #[inline(always)] fn xor<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.xor(other) }
        #[inline(always)] fn not<S: Cpu>(self) -> Self where Here: In<S> { self.not() }
        #[inline(always)] fn from_mask(mask: Self::Mask) -> Self { bits_or!((mask), mask.to_simd().bits()) }
        #[inline(always)] fn top_bits<S: Cpu>(self) -> Self::Mask where Here: In<S> { self.is_negative() }
        #[inline(always)] fn neg<S: Cpu>(self) -> Self where Here: In<S> { self.neg() }
        #[inline(always)] fn abs<S: Cpu>(self) -> Self where Here: In<S> { self.abs() }
        #[inline(always)] fn abs_diff<S: Cpu>(self, other: Self) -> Self where Here: In<S> { Raw::sub(self, other).abs() }
        #[inline(always)] fn div<S: Cpu>(self, other: Self) -> Self where Here: In<S> { self.div(other) }
        #[inline(always)] fn unordered<S: Cpu>(self, other: Self) -> Self::Mask { self.unordered(other) }
        #[inline(always)] fn sqrt<S: Cpu>(self) -> Self where Here: In<S> { self.sqrt() }
        #[inline(always)] fn fma<S: Cpu>(self, mul: Self, add: Self) -> Self where Here: In<S> { self.mul_add(mul, add) }
        #[inline(always)] fn floor<S: Cpu>(self) -> Self where Here: In<S> { self.floor() }
        #[inline(always)] fn ceil<S: Cpu>(self) -> Self where Here: In<S> { self.ceil() }
        #[inline(always)] fn trunc<S: Cpu>(self) -> Self where Here: In<S> { self.trunc() }
        #[inline(always)] fn round<S: Cpu>(self) -> Self where Here: In<S> { self.round() }
        #[inline(always)] fn round_ties_even<S: Cpu>(self) -> Self where Here: In<S> { self.round_ties_even() }
        #[inline(always)] fn reduce_sum<S: Cpu>(self) -> $t where Here: In<S> { raw!(@tree self, $t, add) }
        #[inline(always)] fn reduce_min<S: Cpu>(self) -> $t where Here: In<S> { raw!(@tree self, $t, min) }
        #[inline(always)] fn reduce_max<S: Cpu>(self) -> $t where Here: In<S> { raw!(@tree self, $t, max) }
    };
    // `SimdFloat::reduce_sum` adds the lanes one after the other.
    (@tree $self:ident, $t:ident, $op:ident) => {{
        let mut v = $self;
        if const { N > 32 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 32>(v)); }
        if const { N > 16 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 16>(v)); }
        if const { N > 8 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 8>(v)); }
        if const { N > 4 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 4>(v)); }
        if const { N > 2 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 2>(v)); }
        if const { N > 1 } { v = Raw::$op(v, v.shuffle::<_, { pattern::SLIDE_DOWN }, 1>(v)); }
        copy::parted(v)[0]
    }};
}

raw!(u8, i8, SimdUint u16);
raw!(u16, i16, SimdUint u32);
raw!(u32, i32, SimdUint u64);
raw!(u64, i64, SimdUint);
raw!(i8, i8, SimdInt);
raw!(i16, i16, SimdInt);
raw!(i32, i32, SimdInt);
raw!(i64, i64, SimdInt);
raw!(f32, i32, SimdFloat);
raw!(f64, i64, SimdFloat);

/// The indices that are new are out of bounds.
#[inline(always)]
pub fn resized<const M: usize, const N: usize, S: Cpu>(v: Core<usize, M>) -> Core<usize, N>
where
    usize: Fits<M> + Fits<N>,
    Here: In<S>,
{
    if const { N <= M } {
        return v.resize();
    }
    CoreMask::<isize, N>::from_bitmask(!(!0 << (M % 64))).select(v.resize(), Core::splat(usize::MAX))
}
pub type RawOf<T, W> = <T as crate::lane::Repr>::Raw<W>;
pub type MaskOf<T, W> = <RawOf<T, W> as Raw>::Mask;

/// Cuts, or extends with zeros. In lanes as wide as the narrower vector, this is one move or nothing.
#[inline(always)]
pub fn resize<From: Width, To: Width>(v: From::U8) -> To::U8 {
    macro_rules! by {
        ($t:ident) => {
            RawOf::<$t, From>::from_native(v).shuffle::<RawOf<$t, To>, { pattern::RESIZE }, 0>(Raw::zero()).to_native()
        };
    }
    choose! {
        From::BYTES == 2 || To::BYTES == 2 => by!(u16),
        From::BYTES == 4 || To::BYTES == 4 => by!(u32),
        _ => by!(u64),
    }
}

#[inline(always)]
pub fn bitcast<T: Lane, U: Lane, W: Width>(v: RawOf<T, W>) -> RawOf<U, W> {
    if const { cfg!(target_endian = "big") && size_of::<T>() == size_of::<U>() } {
        return Bits::from_native(v.to_native());
    }
    // One shuffle of the narrower lanes.
    #[cfg(target_endian = "big")]
    if const { size_of::<T>() > 1 && size_of::<U>() > 1 } {
        macro_rules! turned {
            ($t:ty, $v:expr, $k:expr) => {{
                let v: RawOf<$t, W> = $v;
                if const { $k == 2 } {
                    v.shuffle::<RawOf<$t, W>, { pattern::REVERSE_GROUPS }, 2>(v)
                } else {
                    v.shuffle::<RawOf<$t, W>, { pattern::REVERSE_GROUPS }, 4>(v)
                }
            }};
        }
        return if const { size_of::<T>() < size_of::<U>() } {
            Bits::from_native(turned!(T, v, size_of::<U>() / size_of::<T>()).to_native())
        } else {
            turned!(U, Bits::from_native(v.to_native()), size_of::<T>() / size_of::<U>())
        };
    }
    Bits::from_bytes(v.to_bytes())
}
