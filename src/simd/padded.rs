//! Vectors that are narrower than a register. Left to itself, LLVM widens their lanes on AArch64, and clears the rest of
//! the register for each intrinsic.

use crate::lane::{Element, Lane};
use crate::memory::{Place, Source};
use crate::pattern::{self, Pattern};
use crate::raw::{Raw, RawMask, RawOf, copy};
#[allow(unused_imports)]
use crate::simd::{Cpu, Fits, Here, In};
use crate::simd::{Mask as CoreMask, MaskElement, Simd as Core, Swizzle, ToBytes};
use crate::width::B16;
use core::mem::MaybeUninit;

/// `N` lanes in a register of `P` lanes. The others are unspecified.
#[derive(Copy, Clone)]
pub struct Padded<T: Element + Fits<P>, const N: usize, const P: usize>(pub Core<T, P>);

#[derive(Copy, Clone)]
pub struct PaddedMask<M, const N: usize>(M);

/// These move all lanes as one integer.
pub trait Pad<const N: usize, const P: usize>: Element + Fits<N> + Fits<P> {
    fn pad(v: Core<Self, N>) -> Core<Self, P>;
    fn cut(v: Core<Self, P>) -> Core<Self, N>;
}

macro_rules! pad {
    ($($lanes:literal as $word:ident: $($t:ident)*;)*) => {$($(
        impl Pad<$lanes, { 16 / size_of::<$t>() }> for $t {
            #[op]
            fn pad(v: Core<$t, $lanes>) -> RawOf<$t, B16> {
                if const { cfg!(target_arch = "aarch64") && <$t as crate::simd::SimdElement>::FLOAT } {
                    return v.resize();
                }
                let word = Core::<$word, 1>::from_ne_bytes(v.to_ne_bytes());
                let word: RawOf<$word, B16> = word.resize();
                ToBytes::from_ne_bytes(word.to_ne_bytes())
            }
            #[op]
            fn cut(v: RawOf<$t, B16>) -> Core<$t, $lanes> {
                if const { $lanes == 1 && copy::X87 } {
                    return copy::from_array([v[0]; $lanes]);
                }
                if cfg!(not(target_arch = "aarch64")) {
                    // LLVM would move the operation before this one to an integer register.
                    return v.resize();
                }
                ToBytes::from_ne_bytes(RawOf::<$word, B16>::from_ne_bytes(v.to_ne_bytes()).resize::<1>().to_ne_bytes())
            }
        }
    )*)*};
}
pad! {
    2 as u16: u8 i8; 1 as u16: u16 i16;
    4 as u32: u8 i8; 2 as u32: u16 i16; 1 as u32: u32 i32 f32;
    1 as u64: u64 i64 f64;
}
pad! { 8 as u64: u8 i8; 4 as u64: u16 i16; 2 as u64: u32 i32 f32; }

macro_rules! delegate {
    ($($name:ident($($arg:ident),*))*) => {$(
        #[op] fn $name<S: Cpu>(self $(, $arg: Self)*) -> Self where Here: In<S> { Self(Raw::$name(self.0 $(, $arg.0)*)) }
    )*};
}

impl<T: MaskElement + Lane + Fits<P>, const N: usize, const P: usize> RawMask for PaddedMask<CoreMask<T, P>, N> {
    #[op]
    fn splat<S: Cpu>(value: bool) -> Self
    where
        Here: In<S>,
    {
        Self(CoreMask::splat(value))
    }
    #[op]
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self(self.0.and(other.0))
    }
    #[inline(always)]
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self(self.0.or(other.0))
    }
    #[op]
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self(self.0.xor(other.0))
    }
    #[inline(always)]
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        Self(self.0.not())
    }
    #[op]
    fn any<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        self.to_bits() != 0
    }
    #[inline(always)]
    fn all<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        self.to_bits() == (1 << N) - 1
    }
    #[op]
    fn to_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        self.0.to_bits() & ((1 << N) - 1)
    }
    #[inline(always)]
    fn to_more_bits<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        self.0.to_bits()
    }
    #[op]
    fn from_bits<S: Cpu>(bits: u64) -> Self
    where
        Here: In<S>,
    {
        Self(CoreMask::from_bitmask(bits))
    }
    #[op]
    fn convert<R: RawMask, const OP: u8, const K: usize, S: Cpu>(self, other: Self) -> R
    where
        Here: In<S>,
    {
        R::converted::<T, N, P, OP, K, _>(self.0, other.0)
    }
    #[op]
    fn converted<E: MaskElement + Fits<Q>, const FROM: usize, const Q: usize, const OP: u8, const K: usize, S: Cpu>(
        a: CoreMask<E, Q>,
        b: CoreMask<E, Q>,
    ) -> Self
    where
        Here: In<S>,
    {
        macro_rules! by { ($($t:ident)*) => {$(
            crate::simd::lazily!(size_of::<$t>() == if crate::X86 && size_of::<T>() < size_of::<E>() { size_of::<T>() } else { size_of::<E>() } => {
                let both: CoreMask<$t, P> = <Pattern<OP, K, FROM, Q, N, 16> as Swizzle<P>>::concat_swizzle_mask::<$t, Q>(a.cast::<$t, S>(), b.cast::<$t, S>());
                Self(both.cast::<T, S>())
            });
        )*}; }
        by!(i8 i16 i32 i64);
        unreachable!()
    }
}

impl<T: Pad<N, P>, const N: usize, const P: usize> Padded<T, N, P> {
    #[inline(always)]
    fn pad(v: Core<T, N>) -> Self {
        Self(T::pad(v))
    }
    #[inline(always)]
    fn cut(self) -> Core<T, N> {
        T::cut(self.0)
    }
}

impl<T: Pad<N, P>, const N: usize, const P: usize> Raw for Padded<T, N, P>
where
    Core<T, N>: Raw<Lane = T, ArrayWhoseSliceIsAsRefOrAsMut = [T; N]>,
    Core<T, P>: Raw<Lane = T>,
    PaddedMask<<Core<T, P> as Raw>::Mask, N>: RawMask,
{
    type Lane = T;
    type Mask = PaddedMask<<Core<T, P> as Raw>::Mask, N>;
    type ArrayWhoseSliceIsAsRefOrAsMut = [T; N];
    type BoolsWhoseSliceIsAsRefOrAsMut = [bool; N];
    #[inline(always)]
    fn bools(lane: impl FnMut(usize) -> bool) -> [bool; N] {
        crate::raw::bools(lane)
    }
    type Stored = Self;

    #[inline(always)]
    fn zero() -> Self {
        Self(Core::zero())
    }
    #[inline(always)]
    fn shl_by<S: Cpu>(self, n: u32) -> Self {
        Self(self.0.shl_by(n))
    }
    #[inline(always)]
    fn shr_by<S: Cpu>(self, n: u32) -> Self {
        Self(self.0.shr_by(n))
    }
    #[inline(always)]
    fn from_stored(v: Self) -> Self {
        v
    }
    #[inline(always)]
    fn splat<S: Cpu>(value: T) -> Self
    where
        Here: In<S>,
    {
        Self(Raw::splat(value))
    }
    #[inline(always)]
    fn iota<S: Cpu>() -> Self
    where
        Here: In<S>,
    {
        Self(Raw::iota())
    }
    #[op]
    fn to_array<S: Cpu>(self) -> [T; N]
    where
        Here: In<S>,
    {
        copy::to_array(self.cut())
    }
    #[inline(always)]
    fn lanes(&self) -> &[T] {
        &self.0.as_array()[..N]
    }
    #[op]
    fn lanes_mut(&mut self) -> &mut [T] {
        &mut self.0.as_mut_array()[..N]
    }
    #[op]
    fn from_array<S: Cpu>(array: [T; N]) -> Self
    where
        Here: In<S>,
    {
        Self::pad(if const { crate::OPTIMIZED && !copy::X87 } { Core::loaded(array) } else { Raw::from_array(array) })
    }
    #[op]
    fn of_each<S: Cpu>(array: [T; N]) -> Self
    where
        Here: In<S>,
    {
        // As one number, LLVM puts the lanes together in general registers.
        if const { crate::OPTIMIZED && crate::X86 && size_of::<T>() <= 2 && N * size_of::<T>() == 8 } {
            let mut all = Core::<T, P>::zero();
            macro_rules! each { ($($i:literal)*) => { $(if const { $i < N } { all[$i] = array[$i % N]; })* }; }
            each!(0 1 2 3 4 5 6 7);
            return Self(all);
        }
        Self::from_array(array)
    }
    #[op]
    #[track_caller]
    fn load<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        if const { crate::OPTIMIZED } {
            return Self::from_array(*from.first_chunk().expect("the slice is too short"));
        }
        Self::pad(copy::from_slice(from))
    }
    #[op]
    #[track_caller]
    fn store<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        if const { crate::OPTIMIZED } {
            return *to.first_chunk_mut().expect("the slice is too short") = self.cut().stored();
        }
        copy::to_slice(self.cut(), to)
    }
    #[op]
    fn store_masked<S: Cpu>(self, to: &mut [T], mask: Self::Mask)
    where
        Here: In<S>,
    {
        let n = to.len().min(N);
        self.0.store_masked(&mut to[..n], mask.0)
    }
    #[op]
    fn load_in_parts<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        if size_of::<T>() > 1 {
            return Self::pad(Raw::load_in_parts(from));
        }
        Self(Raw::load_in_parts(&from[..from.len().min(N)]))
    }
    #[op]
    fn store_in_parts<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        let n = to.len().min(N);
        self.0.store_in_parts(&mut to[..n])
    }
    #[op]
    #[track_caller]
    fn store_uninit<S: Cpu>(self, to: &mut [MaybeUninit<T>])
    where
        Here: In<S>,
    {
        copy::to_uninit(self.cut().stored(), to)
    }
    #[op]
    fn read<F: Source<T>, S: Cpu>(from: F, at: usize) -> Self
    where
        Here: In<S>,
    {
        Self::from_array(from.read(at))
    }
    #[op]
    fn write<F: Place<T>, S: Cpu>(self, to: &mut F, at: usize)
    where
        Here: In<S>,
    {
        to.write(at, self.cut().stored())
    }
    #[op]
    fn load3(from: &[T]) -> [Self; 3] {
        let [a, b, c] = Raw::load3(from);
        [Self::pad(a), Self::pad(b), Self::pad(c)]
    }
    #[op]
    fn load4(from: &[T]) -> [Self; 4] {
        let [a, b, c, d] = Raw::load4(from);
        [Self::pad(a), Self::pad(b), Self::pad(c), Self::pad(d)]
    }
    #[op]
    fn store3([a, b, c]: [Self; 3], to: &mut [T]) {
        Raw::store3([a.cut(), b.cut(), c.cut()], to)
    }
    #[op]
    fn store4([a, b, c, d]: [Self; 4], to: &mut [T]) {
        Raw::store4([a.cut(), b.cut(), c.cut(), d.cut()], to)
    }

    delegate! {
        add(other) sub(other) mul(other) min(other) max(other) and(other) or(other) xor(other) not() neg() abs()
        shl(by) shr(by) saturating_add(other) saturating_sub(other) abs_diff(other) average_round(other)
        swap_bytes() reverse_bits() count_ones() leading_zeros() trailing_zeros()
        div(other) sqrt() fma(mul, add) floor() ceil() trunc() round() round_ties_even()
    }
    #[op]
    fn eq<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(Raw::eq(self.0, other.0))
    }
    #[op]
    fn ne<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(Raw::ne(self.0, other.0))
    }
    #[op]
    fn lt<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(Raw::lt(self.0, other.0))
    }
    #[op]
    fn le<S: Cpu>(self, other: Self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(Raw::le(self.0, other.0))
    }
    #[op]
    fn top_bits<S: Cpu>(self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(self.0.top_bits())
    }
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    #[op]
    fn full_lanes<S: Cpu>(self) -> Self::Mask
    where
        Here: In<S>,
    {
        PaddedMask(self.0.full_lanes())
    }
    #[op]
    fn select<S: Cpu>(mask: Self::Mask, yes: Self, no: Self) -> Self
    where
        Here: In<S>,
    {
        Self(Raw::select(mask.0, yes.0, no.0))
    }
    #[op]
    fn from_mask(mask: Self::Mask) -> Self {
        Self(Raw::from_mask(mask.0))
    }
    #[op]
    fn reduce_sum<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        Raw::reduce_sum(self.cut())
    }
    #[op]
    fn reduce_min<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        Raw::reduce_min(self.cut())
    }
    #[op]
    fn reduce_max<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        Raw::reduce_max(self.cut())
    }

    #[inline(always)]
    fn casted<R: Raw, S: Cpu>(from: R) -> Self
    where
        Here: In<S>,
    {
        Self(from.cast_lanes())
    }
    #[inline(always)]
    fn cast_lanes<U: Element + Fits<Q>, const Q: usize, S: Cpu>(self) -> Core<U, Q>
    where
        Here: In<S>,
    {
        self.0.cast_lanes()
    }
    #[op]
    fn shuffle<R: Raw<Lane = T>, const OP: u8, const K: usize>(self, other: Self) -> R {
        choose! {
            N > 1 && matches!(OP, pattern::INTERLEAVE_UPPER | pattern::INTERLEAVE_WHOLE_UPPER) => {
                let all = self.0.shuffle::<Core<T, P>, { pattern::INTERLEAVE_LOWER }, 0>(other.0);
                R::shuffled::<P, P, { pattern::PART }, 1, false>(all, all)
            },
            Pattern::<OP, K, N, P, N, P>::JOIN && size_of::<R::ArrayWhoseSliceIsAsRefOrAsMut>() == size_of::<[T; N]>() => {
                let both = Pattern::<{ pattern::JOIN }, N, P, P, P, 16>::concat_swizzle(self.0, other.0);
                R::shuffled::<N, P, OP, K, true>(both, both)
            },
            _ => R::shuffled::<N, P, OP, K, false>(self.0, other.0),
        }
    }
    #[op]
    fn shuffled<const FROM: usize, const Q: usize, const OP: u8, const K: usize, const JOINED: bool>(
        a: Core<T, Q>,
        b: Core<T, Q>,
    ) -> Self
    where
        T: Fits<Q>,
    {
        Self(Pattern::<OP, K, FROM, Q, N, P, JOINED>::concat_swizzle(a, b))
    }
    #[op]
    fn picked<const FROM: usize, const OP: u8, const K: usize>(a: &[T; FROM], b: &[T; FROM]) -> Self {
        Self(crate::many::pick::<T, OP, K, FROM, N, 0>(a, b).resize())
    }
    // The unspecified lanes take no part.
    #[op]
    fn gather<R: Raw, S: Cpu>(self, no: R, mask: R::Mask, table: &[R::Lane]) -> R
    where
        Here: In<S>,
    {
        Raw::gather(self.cut(), no, mask, table)
    }
    #[op]
    fn scatter<R: Raw, S: Cpu>(self, lanes: R, mask: R::Mask, table: &mut [R::Lane])
    where
        Here: In<S>,
    {
        Raw::scatter(self.cut(), lanes, mask, table)
    }
    #[op]
    fn gathered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &[T], indices: Core<usize, M>) -> Self
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        Self(self.0.gathered::<N, S>(mask.0, table, crate::raw::resized::<M, N, _>(indices)))
    }
    #[op]
    fn scattered<const M: usize, S: Cpu>(self, mask: Self::Mask, table: &mut [T], indices: Core<usize, M>)
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        self.0.scattered::<N, S>(mask.0, table, crate::raw::resized::<M, N, _>(indices))
    }
}
