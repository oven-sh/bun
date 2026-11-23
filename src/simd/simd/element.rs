//! The lanes, one by one.
use super::{Pod, Reg, arch, cast};

/// The registers for `N` lanes of the size of this type.
pub trait Class<const N: usize>: Pod {
    type Reg: Reg;
    /// The lanes of the registers.
    const FULL: usize;
    type Both: Pod + core::ops::Index<usize, Output = Self>;
    fn both(a: Self::Reg, b: Self::Reg) -> Self::Both;
    fn pick<const FROM: usize>(from: &<Self as Class<FROM>>::Both, index: &[u8; 64]) -> <Self as Class<N>>::Reg
    where
        Self: Class<FROM>;
    /// The lanes `first`, `first + step`..
    fn every_from<A: Pod>(from: &A, first: usize, step: usize) -> Self::Reg;
}
pub trait Classes: Class<1> + Class<2> + Class<4> + Class<8> + Class<16> + Class<32> + Class<64> {}
macro_rules! pick { ($full:tt |$i:ident| $lane:expr) => { pick!(@$full $i $lane) };
    (@ [$($k:literal)*] $i:ident $lane:expr) => { [$({ let $i: usize = $k; $lane }),*] };
    (@1 $($x:tt)*) => { pick!(@ [0] $($x)*) };
    (@2 $($x:tt)*) => { pick!(@ [0 1] $($x)*) };
    (@4 $($x:tt)*) => { pick!(@ [0 1 2 3] $($x)*) };
    (@8 $($x:tt)*) => { pick!(@ [0 1 2 3 4 5 6 7] $($x)*) };
    (@16 $($x:tt)*) => { pick!(@ [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15] $($x)*) };
    (@32 $($x:tt)*) => { pick!(@ [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31] $($x)*) };
    (@64 $($x:tt)*) => { pick!(@ [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
        32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63] $($x)*) };
}
macro_rules! classes { ($($t:ident: $($n:literal $full:tt $reg:ty),*;)*) => {$(
    impl Classes for $t {}
    $(impl Class<$n> for $t {
        type Reg = $reg;
        const FULL: usize = $full;
        type Both = [$t; 2 * $full];
        #[inline(always)]
        fn both(a: $reg, b: $reg) -> Self::Both { cast([a, b]) }
        #[inline(always)]
        fn pick<const FROM: usize>(from: &<Self as Class<FROM>>::Both, index: &[u8; 64]) -> $reg where Self: Class<FROM> {
            let len = 2 * <Self as Class<FROM>>::FULL;
            cast::<[$t; $full], $reg>(pick!($full |i| from[index[i] as usize % len]))
        }
        #[inline(always)]
        fn every_from<A: Pod>(from: &A, first: usize, step: usize) -> $reg {
            cast::<[$t; $full], $reg>(pick!($full |i| super::part(from, (first + i * step) % (size_of::<A>() / size_of::<$t>()))))
        }
    })*
)*}; }
arch::registers!(classes);

/// What generic code may assume of the other sizes.
pub trait Others {
    type A;
    type B;
    type C;
    type D;
}
impl<T> Others for T {
    type A = u8;
    type B = u16;
    type C = u32;
    type D = u64;
}
pub trait Fits<const N: usize>:
    SimdElement<Bits: Class<N>>
    + Others<A = u8, A: Class<N>, B = u16, B: Class<N>, C = u32, C: Class<N>, D = u64, D: Class<N>>
{
}
impl<T: SimdElement<Bits: Class<N>>, const N: usize> Fits<N> for T
where
    u8: Class<N>,
    u16: Class<N>,
    u32: Class<N>,
    u64: Class<N>,
{
}
pub trait MaskElement: SimdElement<Mask = Self> {}

macro_rules! declare { ($($name:ident($($a:ident),*))*) => { $(#[inline(always)] fn $name(self $(, $a: Self)*) -> Self { $(let _ = $a;)* unreachable!() })* }; }
pub trait SimdElement: Pod + Default + PartialOrd + Send + Sync + 'static {
    type Bits: Classes + SimdElement<Bits = Self::Bits>;
    type Mask: MaskElement<Bits = Self::Bits>;
    const SIZE: usize = size_of::<Self>();
    const SIGNED: bool;
    const FLOAT: bool;
    /// The lowest bits.
    fn of_bits(bits: u64) -> Self;
    /// Extended with zeros.
    fn bits(self) -> u64;
    fn convert<U: SimdElement>(self) -> U;
    fn of_i64(x: i64) -> Self;
    fn of_u64(x: u64) -> Self;
    fn of_f32(x: f32) -> Self;
    fn of_f64(x: f64) -> Self;
    /// NEON on 32-bit Arm and AltiVec take subnormal numbers as zero, and the x87 only rounds what goes to memory.
    #[inline(always)]
    fn apart(self) -> Self {
        self
    }
    /// The result of a comparison.
    #[inline(always)]
    fn told(it: bool) -> Self::Mask {
        Self::Mask::of_i64(-(it as i64))
    }
    declare! { add(b) sub(b) mul(b) div(b) shl(b) shr(b) saturating_add(b) saturating_sub(b) swap_bytes() reverse_bits() count_ones() leading_zeros() trailing_zeros()
    sqrt() floor() ceil() trunc() round() round_ties_even() fma(b, c) }
}
macro_rules! of {
    ($t:ident, $by:ident as $via:ident) => {
        #[inline(always)]
        fn convert<U: SimdElement>(self) -> U {
            U::$by(self as $via)
        }
        #[inline(always)]
        fn of_i64(x: i64) -> Self {
            (x as $t).apart()
        }
        #[inline(always)]
        fn of_u64(x: u64) -> Self {
            (x as $t).apart()
        }
        #[inline(always)]
        fn of_f32(x: f32) -> Self {
            // The same value.
            #[cfg(target_arch = "arm")]
            if const { Self::FLOAT && size_of::<$t>() == 8 } {
                return core::hint::black_box(x as $t);
            }
            (x as $t).apart()
        }
        #[inline(always)]
        fn of_f64(x: f64) -> Self {
            (x as $t).apart()
        }
    };
}
macro_rules! ints { ($($t:ident $bits:ident $mask:ident $signed:literal $by:ident $via:ident;)*) => {$(
    impl SimdElement for $t {
        type Bits = $bits;
        type Mask = $mask;
        const SIGNED: bool = $signed;
        const FLOAT: bool = false;
        #[inline(always)] fn of_bits(bits: u64) -> Self { bits as $t }
        #[inline(always)] fn bits(self) -> u64 { self as $bits as u64 }
        of!($t, $by as $via);
        #[inline(always)] fn add(self, b: Self) -> Self { self.wrapping_add(b) }
        #[inline(always)] fn sub(self, b: Self) -> Self { self.wrapping_sub(b) }
        #[inline(always)] fn mul(self, b: Self) -> Self { self.wrapping_mul(b) }
        #[inline(always)] fn shl(self, b: Self) -> Self { self.wrapping_shl(b as u32) }
        #[inline(always)] fn shr(self, b: Self) -> Self { self.wrapping_shr(b as u32) }
        #[inline(always)] fn saturating_add(self, b: Self) -> Self { self.saturating_add(b) }
        #[inline(always)] fn saturating_sub(self, b: Self) -> Self { self.saturating_sub(b) }
        #[inline(always)] fn swap_bytes(self) -> Self { self.swap_bytes() }
        #[inline(always)] fn reverse_bits(self) -> Self { self.reverse_bits() }
        #[inline(always)] fn count_ones(self) -> Self { self.count_ones() as $t }
        #[inline(always)] fn leading_zeros(self) -> Self { self.leading_zeros() as $t }
        #[inline(always)] fn trailing_zeros(self) -> Self { self.trailing_zeros() as $t }
    }
)*}; }
#[cfg(target_pointer_width = "64")]
type Word = u64;
#[cfg(target_pointer_width = "32")]
type Word = u32;
#[cfg(target_pointer_width = "16")]
type Word = u16;
ints! {
    u8 u8 i8 false of_u64 u64; u16 u16 i16 false of_u64 u64; u32 u32 i32 false of_u64 u64; u64 u64 i64 false of_u64 u64; usize Word isize false of_u64 u64;
    i8 u8 i8 true of_i64 i64; i16 u16 i16 true of_i64 i64; i32 u32 i32 true of_i64 i64; i64 u64 i64 true of_i64 i64; isize Word isize true of_i64 i64;
}
impl MaskElement for i8 {}
impl MaskElement for i16 {}
impl MaskElement for i32 {}
impl MaskElement for i64 {}
impl MaskElement for isize {}
macro_rules! floats { ($($t:ident $bits:ident $mask:ident $by:ident: $($f:ident)*;)*) => {$(
    impl SimdElement for $t {
        type Bits = $bits;
        type Mask = $mask;
        const SIGNED: bool = true;
        const FLOAT: bool = true;
        #[inline(always)] fn of_bits(bits: u64) -> Self { $t::from_bits(bits as $bits) }
        #[inline(always)] fn bits(self) -> u64 { self.to_bits() as u64 }
        of!($t, $by as $t);
        #[inline(always)] fn add(self, b: Self) -> Self { (self.apart() + b).apart() }
        #[inline(always)] fn sub(self, b: Self) -> Self { (self.apart() - b).apart() }
        #[inline(always)] fn mul(self, b: Self) -> Self { (self.apart() * b).apart() }
        #[inline(always)] fn div(self, b: Self) -> Self { (self.apart() / b).apart() }
        #[inline(always)] fn fma(self, b: Self, c: Self) -> Self { let (a, c) = (self.apart(), c.apart()); crate::soft::$t::mul_add(a, b, c).apart() }
        $(#[inline(always)] fn $f(self) -> Self { let a = self.apart(); crate::soft::$t::$f(a).apart() })*
        #[cfg(target_arch = "arm")]
        #[inline(always)] fn apart(self) -> Self { if const { size_of::<$t>() == 4 } { cast(crate::regs::single(cast(self))) } else { self } }
        #[cfg(all(any(target_arch = "powerpc", target_arch = "powerpc64"), target_endian = "big", not(target_feature = "vsx")))]
        #[inline(always)] fn apart(self) -> Self { if const { size_of::<$t>() == 4 } { core::hint::black_box(self) } else { self } }
        #[cfg(any(target_arch = "arm", target_arch = "powerpc", target_arch = "powerpc64"))]
        #[inline(always)] fn told(it: bool) -> $mask { cast(cast::<_, $t>(-(it as $mask)).apart()) }
        #[cfg(all(target_arch = "loongarch64", not(target_feature = "lsx"), not(miri)))]
        #[inline(always)] fn told(it: bool) -> $mask { (crate::regs::chosen(it as u64) as $mask).wrapping_neg() }
        #[cfg(all(target_arch = "x86", not(target_feature = "sse2")))]
        #[inline(always)] fn apart(self) -> Self { core::hint::black_box(self) }
    }
)*}; }
floats! { f32 u32 i32 of_f32: sqrt floor ceil trunc round round_ties_even; f64 u64 i64 of_f64: sqrt floor ceil trunc round round_ties_even; }

/// The bits of a float of half precision. Only targets that have the instructions compute with it.
#[derive(Copy, Clone, Default)]
#[repr(transparent)]
pub struct F16(u16);
super::bits::pod!(F16);
impl PartialEq for F16 {
    #[inline]
    fn eq(&self, _: &Self) -> bool {
        unreachable!()
    }
}
impl PartialOrd for F16 {
    #[inline]
    fn partial_cmp(&self, _: &Self) -> Option<core::cmp::Ordering> {
        unreachable!()
    }
}
macro_rules! never { ($($f:ident $t:ident)*) => { $(#[inline] fn $f(_: $t) -> Self { unreachable!() })* }; }
impl SimdElement for F16 {
    type Bits = u16;
    type Mask = i16;
    const SIGNED: bool = true;
    const FLOAT: bool = true;
    #[inline]
    fn bits(self) -> u64 {
        unreachable!()
    }
    #[inline(always)]
    fn convert<U: SimdElement>(self) -> U {
        U::of_f32(crate::f16::from_bits(self.0).to_f32())
    }
    #[inline(always)]
    fn of_f32(x: f32) -> Self {
        Self(crate::f16::from_f32(x).to_bits())
    }
    never!(of_bits u64 of_i64 i64 of_u64 u64 of_f64 f64);
}
