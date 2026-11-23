//! Vectors in the registers of `core::arch`. What moves lanes or bits is the same on all targets. What computes takes the target `S`,
//! which rustc infers from the bounds of the caller.
#![allow(non_camel_case_types, dead_code, clippy::should_implement_trait)]

/// The same bits in two forms. The first is shorter in builds without optimization.
macro_rules! bits_or {
    ($(<$($g:ty),+>)? ($a:expr), $usual:expr) => { cfg_select! { bun_simd_unoptimized => crate::simd::start $(::<$($g),+>)? ($a), _ => $usual } };
}
macro_rules! within {
    ($level:expr, $with:ident) => {
        #[allow(unsafe_code)]
        impl Within for At<{ $level }> {
            $with! { unsafe fn one<O: Op1, R: Prim>(a: R, x: u32) -> R { O::run::<Self, R>(a, x) } }
            $with! { unsafe fn two<O: Op2, R: Prim>(a: R, b: R) -> R { O::run::<Self, R>(a, b) } }
            $with! { unsafe fn three<O: Op3, R: Prim>(a: R, b: R, c: R) -> R { O::run::<Self, R>(a, b, c) } }
            $with! { unsafe fn bits<T: SimdElement, R: Prim>(a: R) -> u64 { a.sign_bits::<Self, T>() } }
            $with! { unsafe fn mask<T: SimdElement, R: Prim>(bits: u64) -> R { R::of_bits::<Self, T>(bits) } }
        }
    };
}
/// Calls a function with features that the first of the levels has.
#[allow(unused_macros)]
macro_rules! at_level {
    ([$level:ident $($default:ident)?] $f:ident [$($i:literal)?] $($name:ident = $value:expr),+) => {{
        // rustc only accepts this if the function is safe but for its features, and these are enabled.
        $level! { fn check() { let _: fn($(at_level!(@any $name)),+) -> _ = $f$(::<$i>)?; } }
        let ($($name,)+) = ($($value,)+);
        // SAFETY: an instance that names S runs on a CPU with the features of its level. The lowest is what the program is compiled for.
        if at_level!(@has $level) { #[allow(unsafe_code, unused_unsafe)] let it = unsafe { $f$(::<$i>)?($($name),+) }; it } else { unreachable!() }
    }};
    (@any $name:ident) => { _ };
    (@has SSE2) => { true };
    (@has NEON) => { true };
    (@has $level:ident) => { Has::<S>::$level };
}
/// The first function whose condition holds. rustc walks through all that a dead branch calls, but not through a constant.
macro_rules! chosen {
    ($t:ty: $($arms:tt)*) => { (const { let it: $t = chosen!(@ $($arms)*); it }) };
    (@ _ => $f:expr $(,)?) => { $f };
    (@ $c:expr => $f:expr, $($rest:tt)*) => { if $c { $f } else { chosen!(@ $($rest)*) } };
}
/// `if const { live } { return body }`, in the same way.
macro_rules! lazily {
    ($live:expr => $body:expr) => {
        if const { $live } {
            return (const { crate::simd::caller($live) })({
                let once = crate::simd::Once;
                (
                    #[inline(always)]
                    || {
                        let _once = once;
                        $body
                    },
                )
                    .0
            });
        }
    };
}
pub(crate) use lazily;
pub(crate) struct Once;
pub(crate) const fn caller<F: FnOnce() -> R, R>(live: bool) -> fn(F) -> R {
    #[inline(always)]
    fn call<F: FnOnce() -> R, R>(f: F) -> R {
        f()
    }
    fn dead<F, R>(_: F) -> R {
        unreachable!()
    }
    if live { call } else { dead }
}
/// For each number below a constant, which is zero or a power of two up to 32.
#[allow(unused_macros)]
macro_rules! each {
    ($i:ident < $n:expr => $body:expr) => {
        (const { crate::simd::rounds($n) })(
            (
                #[inline(always)]
                |$i: usize| {
                    $body;
                },
            )
                .0,
        )
    };
}
const fn rounds<F: FnMut(usize)>(n: usize) -> fn(F) {
    macro_rules! rounds { ($($n:literal $name:ident [$($k:literal)*])*) => {
        $(#[inline(always)] #[allow(unused_mut, unused_variables)] fn $name<F: FnMut(usize)>(mut f: F) { $(f($k);)* })*
        $(if n <= $n { return $name; })*
    }; }
    rounds!(0 none [] 1 one [0] 2 two [0 1] 4 four [0 1 2 3] 8 eight [0 1 2 3 4 5 6 7] 16 sixteen [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]);
    rounds!(0xffff all [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31]);
    unreachable!()
}
struct Size<T, const N: usize>(T);
impl<T, const N: usize> Size<T, N> {
    const IS: bool = size_of::<T>() == N;
}
mod bits;
#[forbid(unsafe_code)]
mod convert;
mod element;
#[forbid(unsafe_code)]
mod emulate;
#[forbid(unsafe_code)]
mod moves;
#[forbid(unsafe_code)]
pub mod interleaved;
cfg_select! {
    // Miri knows few intrinsics of NEON.
    all(miri, target_arch = "aarch64") => {
        mod scalar;
        use scalar as arch;
    }
    all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
        mod x86;
        use x86 as arch;
        #[allow(unused_imports)]
        pub use x86::{AVX2, AVX512, nothing, of_each, prefetch, saturated};
    }
    all(target_arch = "aarch64", target_feature = "neon", target_endian = "little") => {
        mod neon;
        use neon as arch;
        #[cfg(bun_simd_unoptimized)]
        pub use neon::nibbles;
    }
    all(target_arch = "wasm32", target_feature = "simd128") => {
        mod wasm;
        use wasm as arch;
        #[allow(unused_imports)]
        pub use wasm::{dot, factor, has_bits, hoisted, is_known, looked_up, opaque, table};
    }
    _ => {
        mod scalar;
        use scalar as arch;
    }
}
#[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
mod neon_types;
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
pub(crate) use arch::accessed;
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
pub(crate) use arch::{in_mask, limit};
pub use arch::{level, only_combined};
/// Whether the form is scalar.rs.
pub const ARRAYS: bool = align_of::<u8x16>() == 8;
/// Lanes of up to this size share general registers, on the targets where the tests run. Where the program has vectors, LLVM joins lanes. Some CPUs load what may not be aligned byte by byte.
#[allow(clippy::erasing_op, clippy::identity_op)]
pub const PACKED: usize = ARRAYS as usize
    * cfg_select! {
        any(
            target_feature = "neon",
            target_feature = "lsx",
            target_feature = "vector",
            target_feature = "simd128",
            target_feature = "zve32x",
            all(target_os = "none", not(target_arch = "wasm32"))
        ) => 0,
        any(
            target_arch = "wasm32",
            target_arch = "s390x",
            all(target_arch = "riscv64", target_feature = "unaligned-scalar-mem")
        ) => 2,
        any(
            target_arch = "riscv64",
            target_arch = "loongarch64",
            all(target_arch = "arm", target_endian = "little", target_has_atomic = "64")
        ) => 1,
        _ => 0,
    };
cfg_select! {
    any(target_pointer_width = "64", target_arch = "wasm32") => {
        pub type Word = u64;
    }
    _ => {
        pub type Word = u32;
    }
}
#[inline(always)]
#[allow(clippy::unnecessary_cast)]
pub fn sum_of_8(v: u8x8) -> u64 {
    let (words, even): ([Word; 8 / size_of::<Word>()], Word) = (cast(v.to_array()), !0 / 257);
    let pairs = words.into_iter().fold(0, |all, it| all + (it & even) + (it >> 8 & even));
    (pairs.wrapping_mul(!0 / 0xffff) >> (Word::BITS - 16)) as u64
}
#[allow(unused_imports)]
pub(crate) use bits::start;
pub(crate) use bits::{Pod, cast, part, set_part};
use core::marker::PhantomData;
pub use element::{Class, F16, Fits, MaskElement, SimdElement};

/// `Here: In<S>` always holds. A bound `S: Cpu` of the caller implies it, and so tells which `S` is meant.
pub struct Here;
pub trait In<S> {}
impl<S> In<S> for Here {}
pub trait Ambient {
    type It;
}
/// A token. An instance that names it runs on a CPU with the features of the level: see point 4 at the top of `gate.rs`.
pub trait Cpu: Copy + 'static + Ambient<It = Here, It: In<Self>> {
    const LEVEL: u8;
    /// It stands for all tokens of the level.
    type At: Within;
}
#[derive(Copy, Clone)]
pub struct At<const LEVEL: u8>(());
impl<const L: u8> Ambient for At<L> {
    type It = Here;
}
impl<const L: u8> Cpu for At<L>
where
    Self: Within,
{
    const LEVEL: u8 = L;
    type At = Self;
}
/// Functions with the features of the level. LLVM simplifies an operation once, and then inlines what is left.
#[allow(unsafe_code)]
pub trait Within: Cpu {
    unsafe fn one<O: Op1, R: Prim>(a: R, x: u32) -> R;
    unsafe fn two<O: Op2, R: Prim>(a: R, b: R) -> R;
    unsafe fn three<O: Op3, R: Prim>(a: R, b: R, c: R) -> R;
    unsafe fn bits<T: SimdElement, R: Prim>(a: R) -> u64;
    unsafe fn mask<T: SimdElement, R: Prim>(bits: u64) -> R;
}
macro_rules! enter { ($f:ident::<$g:ty, $r:ty>($($a:ident),*)) => {{
    // SAFETY: `within!` makes these safe but for the features of the level of S, which the CPU has: see `Cpu`.
    #[allow(unsafe_code)]
    let it = unsafe { <S::At as Within>::$f::<$g, $r>($($a),*) };
    it
}}; }
#[inline(always)]
fn bits_of<S: Cpu, T: SimdElement, R: Prim>(a: R) -> u64 {
    enter!(bits::<T::Bits, R>(a))
}
#[inline(always)]
fn mask_of<S: Cpu, T: SimdElement, R: Prim>(bits: u64) -> R {
    enter!(mask::<T::Bits, R>(bits))
}

pub type RegOf<T, const N: usize> = <<T as SimdElement>::Bits as Class<N>>::Reg;
/// If a register is longer than the lanes, the rest is unspecified.
#[repr(transparent)]
pub struct Simd<T: Fits<N>, const N: usize>(pub(crate) RegOf<T, N>, PhantomData<T>);
/// All bits of a lane are equal. Nothing unsafe relies on it.
#[repr(transparent)]
pub struct Mask<T: Fits<N>, const N: usize>(pub(crate) RegOf<T, N>, PhantomData<T>);
macro_rules! copy { ($($t:ident)*) => {$(
    impl<T: Fits<N>, const N: usize> Copy for $t<T, N> {}
    impl<T: Fits<N>, const N: usize> Clone for $t<T, N> { #[inline(always)] fn clone(&self) -> Self { *self } }
    impl<T: Fits<N>, const N: usize> $t<T, N> { #[inline(always)] pub(crate) const fn of(reg: RegOf<T, N>) -> Self { Self(reg, PhantomData) } }
)*}; }
copy!(Simd Mask);

/// One register, or several.
pub trait Reg: Pod + Send + Sync + 'static {
    const ZERO: Self;
    /// The registers that it consists of.
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    type Unit: Pod;
    /// The same, for `f32`.
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    type Singles: Pod;
    /// LLVM makes poor code if memory is accessed both in registers and in a piece that is longer.
    #[inline(always)]
    fn joined<S: Cpu, T: SimdElement, A: Pod>(all: A) -> Self {
        cast(all)
    }
    #[inline(always)]
    fn parted<S: Cpu, T: SimdElement, A: Pod>(self) -> A {
        cast(self)
    }
    /// See plan.rs. rustc also visits what is named in code that is left out, so each type names its own registers only.
    #[inline(always)]
    fn planned<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
        _: &<B as Class<N>>::Reg,
        _: &<B as Class<N>>::Reg,
    ) -> Self {
        unreachable!()
    }
    fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self;
    fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self;
    fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self;
    fn splat<S: Cpu, T: SimdElement>(value: T) -> Self;
    fn to_bits<S: Cpu, T: SimdElement>(self) -> u64;
    fn from_bits<S: Cpu, T: SimdElement>(bits: u64) -> Self;
    /// Of all lanes of the registers.
    fn any<S: Cpu, T: SimdElement>(self) -> bool;
    fn all<S: Cpu, T: SimdElement>(self) -> bool;
}
/// By itself, LLVM would take this as an operation on bytes, which is the type of the registers of NEON.
macro_rules! logic {
    (and) => {
        logic!()
    };
    (or) => {
        logic!()
    };
    (xor) => {
        logic!()
    };
    (not) => {
        logic!()
    };
    (select) => {
        logic!()
    };
    () => {
        cfg!(target_arch = "aarch64")
    };
    ($other:ident) => {
        false
    };
}
pub trait Op1: Sized {
    const LOGIC: bool = false;
    fn run<S: Cpu, R: Prim>(a: R, x: u32) -> R;
    #[inline(always)]
    fn on<S: Cpu, R: Prim>(a: R, x: u32) -> R {
        if const { Self::LOGIC } {
            return Self::run::<S, R>(a, x);
        }
        enter!(one::<Self, R>(a, x))
    }
}
pub trait Op2: Sized {
    const LOGIC: bool = false;
    fn run<S: Cpu, R: Prim>(a: R, b: R) -> R;
    #[inline(always)]
    fn on<S: Cpu, R: Prim>(a: R, b: R) -> R {
        if const { Self::LOGIC } {
            return Self::run::<S, R>(a, b);
        }
        enter!(two::<Self, R>(a, b))
    }
}
pub trait Op3: Sized {
    const LOGIC: bool = false;
    fn run<S: Cpu, R: Prim>(a: R, b: R, c: R) -> R;
    #[inline(always)]
    fn on<S: Cpu, R: Prim>(a: R, b: R, c: R) -> R {
        if const { Self::LOGIC } {
            return Self::run::<S, R>(a, b, c);
        }
        enter!(three::<Self, R>(a, b, c))
    }
}

macro_rules! prims { (
    one { $($one:ident)* } count { $($count:ident)* } two { $($two:ident)* } three { $($three:ident)* }
) => {
    /// A register. Its methods are only called for targets that have its width. What a target has no instruction for is in emulate.rs.
    pub trait Prim: Reg {
        fn set<S: Cpu, T: SimdElement>(value: T) -> Self;
        fn sign_bits<S: Cpu, T: SimdElement>(self) -> u64;
        #[inline(always)] fn of_bits<S: Cpu, T: SimdElement>(bits: u64) -> Self { emulate::of_bits::<S, T, Self>(bits) }
        /// Within 16 bytes, if `S` has it.
        fn table<S: Cpu>(self, _: Self) -> Self { unreachable!() }
        /// The 16 bytes in each block.
        fn repeat<S: Cpu>(_: [u8; 16]) -> Self { unreachable!() }
        $(#[inline(always)] fn $one<S: Cpu, T: SimdElement>(self) -> Self { emulate::$one::<S, T, Self>(self) })*
        $(#[inline(always)] fn $count<S: Cpu, T: SimdElement>(self, x: u32) -> Self { emulate::$count::<S, T, Self>(self, x) })*
        $(#[inline(always)] fn $two<S: Cpu, T: SimdElement>(self, b: Self) -> Self { emulate::$two::<S, T, Self>(self, b) })*
        $(#[inline(always)] fn $three<S: Cpu, T: SimdElement>(self, b: Self, c: Self) -> Self { emulate::$three::<S, T, Self>(self, b, c) })*
    }
    pub mod op {
        use super::*;
        $(pub struct $one<T>(T); impl<T: SimdElement> Op1 for $one<T> { const LOGIC: bool = logic!($one); #[inline(always)] fn run<S: Cpu, R: Prim>(a: R, _: u32) -> R { a.$one::<S, T>() } })*
        $(pub struct $count<T>(T); impl<T: SimdElement> Op1 for $count<T> { #[inline(always)] fn run<S: Cpu, R: Prim>(a: R, x: u32) -> R { a.$count::<S, T>(x) } })*
        $(pub struct $two<T>(T); impl<T: SimdElement> Op2 for $two<T> { const LOGIC: bool = logic!($two); #[inline(always)] fn run<S: Cpu, R: Prim>(a: R, b: R) -> R { a.$two::<S, T>(b) } })*
        $(pub struct $three<T>(T); impl<T: SimdElement> Op3 for $three<T> { const LOGIC: bool = logic!($three); #[inline(always)] fn run<S: Cpu, R: Prim>(a: R, b: R, c: R) -> R { a.$three::<S, T>(b, c) } })*
    }
}; }
prims! {
    one { not neg abs negative swap_bytes reverse_bits count_ones leading_zeros trailing_zeros sqrt floor ceil trunc round round_ties_even }
    count { shl_by shr_by }
    two { add sub mul div and or xor and_not min max eq ne lt le unordered shl shr saturating_add saturating_sub abs_diff average }
    three { select fma }
}

macro_rules! forward { ($($n:tt $map:ident -> $out:ty, $of:ident, $t:ty: $($name:ident = $op:ident($($a:ident),*)),*;)*) => {$($(
    #[inline(always)]
    pub(crate) fn $name<S: Cpu>(self $(, $a: Self)*) -> $out where Here: In<S> { $of::of(forward!(@$n self, $map, $t, $op $(, $a)*)) }
)*)*};
    (@1 $self:ident, $map:ident, $t:ty, $op:ident) => { $self.0.$map::<S::At, op::$op<$t>>(0) };
    (@$n:tt $self:ident, $map:ident, $t:ty, $op:ident $(, $a:ident)*) => { $self.0.$map::<S::At, op::$op<$t>>($($a.0),*) };
}

impl<T: Fits<N>, const N: usize> Simd<T, N> {
    pub const LEN: usize = N;
    const WHOLE: bool = size_of::<Self>() == N * size_of::<T>();
    #[inline(always)]
    pub(crate) const fn from_array(array: [T; N]) -> Self {
        Self::of(bits::widened(array))
    }
    #[inline(always)]
    #[allow(unreachable_code)]
    pub(crate) const fn to_array(self) -> [T; N] {
        // As one lane.
        if const { N * size_of::<T>() == 2 } {
            return cast(bits::start::<_, u16>(self.0));
        }
        if const { N * size_of::<T>() == 4 } {
            return cast(bits::start::<_, u32>(self.0));
        }
        bits::start(self.0)
    }
    /// `from_array`, where it need not be constant.
    #[inline(always)]
    pub(crate) fn of_lanes(array: [T; N]) -> Self {
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { T::FLOAT && N * T::SIZE == 4 && N == 1 } {
            return Self::of(bits::start(arch::one_single(cast(array[0]))));
        }
        Self::from_array(array)
    }
    /// `to_array` for a store. LLVM would do the logic before it in general registers.
    #[inline(always)]
    pub(crate) fn stored(self) -> [T; N] {
        #[cfg(all(
            target_arch = "aarch64",
            target_feature = "neon",
            target_endian = "little",
            not(any(miri, bun_simd_unoptimized))
        ))]
        lazily!(N * T::SIZE >= 32 && T::SIZE <= 4 => arch::united(self));
        #[cfg(all(target_arch = "x86_64", target_feature = "sse2"))]
        if const { !Self::WHOLE && N * size_of::<T>() >= 4 } {
            return arch::lowest(cast(self.0));
        }
        self.to_array()
    }
    /// The same for the logic after a load.
    #[inline(always)]
    pub(crate) fn loaded(array: [T; N]) -> Self {
        #[cfg(all(target_arch = "x86_64", target_feature = "sse2"))]
        if const { N > 1 && matches!(N * size_of::<T>(), 4 | 8) } {
            return Self::of(cast(arch::of_float(array)));
        }
        Self::of_lanes(array)
    }
    /// For 16 bytes or more.
    #[inline(always)]
    pub(crate) fn joined<S: Cpu>(array: [T; N]) -> Self
    where
        Here: In<S>,
    {
        Self::of(Reg::joined::<S, T, _>(array))
    }
    #[inline(always)]
    pub(crate) fn parted<S: Cpu>(self) -> [T; N]
    where
        Here: In<S>,
    {
        self.0.parted::<S, T, _>()
    }
    #[inline(always)]
    pub(crate) const fn as_array(&self) -> &[T; N] {
        bits::view(&self.0, 0)
    }
    #[inline(always)]
    pub(crate) const fn as_mut_array(&mut self) -> &mut [T; N] {
        bits::view_mut(&mut self.0, 0)
    }
    #[inline(always)]
    #[track_caller]
    pub(crate) fn from_slice(from: &[T]) -> Self {
        let from = from.first_chunk::<N>().expect("the slice is too short");
        Self::from_array(*from)
    }
    #[inline(always)]
    #[track_caller]
    pub(crate) fn copy_to_slice(self, to: &mut [T]) {
        // rustc would take both as an integer.
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { T::FLOAT && T::SIZE == 4 && N <= 2 } {
            let (to, [a, b]) = (&mut to[..N], [arch::single_of::<0>(cast(self.0)), arch::single_of::<1>(cast(self.0))]);
            to[N - 1] = cast(b);
            return to[0] = cast(a);
        }
        let to = to.first_chunk_mut::<N>().expect("the slice is too short");
        *to = self.stored()
    }
    #[inline(always)]
    pub(crate) const fn zero() -> Self {
        Self::of(<RegOf<T, N>>::ZERO)
    }
    #[inline(always)]
    pub(crate) fn splat<S: Cpu>(value: T) -> Self
    where
        Here: In<S>,
    {
        Self::of(Reg::splat::<S::At, T>(value))
    }
    /// The same bits.
    #[inline(always)]
    pub(crate) const fn bits<U: Fits<M>, const M: usize>(self) -> Simd<U, M> {
        Simd::of(cast(self.0))
    }
    /// Cuts, or extends with zeros.
    #[inline(always)]
    pub(crate) fn resize<const M: usize>(self) -> Simd<T, M>
    where
        T: Fits<M>,
    {
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { T::FLOAT && T::SIZE == 4 && N != M } {
            if const { N == 1 && M <= 4 } {
                return Simd::of(bits::start(arch::one_single(cast(self.as_array()[0]))));
            }
            if const { N >= 4 && M == 2 } {
                return Simd::of(cast(arch::lower_singles(bits::start(self.0))));
            }
            if const { N >= 4 && M == 1 } {
                return Simd::of(bits::start(arch::one_single(arch::first_single(bits::start(self.0)))));
            }
        }
        if const { M <= N } {
            return Simd::of(bits::start(self.0));
        }
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        lazily!(M > N && Self::WHOLE => Simd::of(arch::extended(self.0)));
        #[cfg(not(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2")))]
        lazily!(M > N && Self::WHOLE => Simd::of(bits::widened(self.0)));
        #[cfg(any(target_arch = "aarch64", all(target_arch = "wasm32", target_feature = "simd128")))]
        lazily!(M > N && !Self::WHOLE && M * size_of::<T>() <= 16 => Simd::of(bits::widened(self.to_array())));
        struct Resize<const N: usize>;
        impl<const N: usize, const M: usize> Swizzle<M> for Resize<N> {
            const INDEX: [usize; M] = {
                let (mut index, mut i) = ([N; M], 0);
                while i < N && i < M {
                    index[i] = i;
                    i += 1;
                }
                index
            };
        }
        lazily!(M > N && !Self::WHOLE && !(cfg!(any(target_arch = "aarch64", all(target_arch = "wasm32", target_feature = "simd128"))) && M * size_of::<T>() <= 16) => Resize::<N>::concat_swizzle(self, Self::zero()));
        unreachable!()
    }
    forward! {
        1 map1 -> Self, Simd, T: not = not(), neg = neg(), abs = abs(), swap_bytes = swap_bytes(), reverse_bits = reverse_bits(), count_ones = count_ones(),
            leading_zeros = leading_zeros(), trailing_zeros = trailing_zeros(), sqrt = sqrt(), floor = floor(), ceil = ceil(), trunc = trunc(), round = round(),
            round_ties_even = round_ties_even();
        1 map1 -> Mask<T::Mask, N>, Mask, T: is_negative = negative();
        2 map2 -> Self, Simd, T: add = add(b), sub = sub(b), mul = mul(b), div = div(b), and = and(b), or = or(b), xor = xor(b), simd_min = min(b), simd_max = max(b),
            shl = shl(b), shr = shr(b), saturating_add = saturating_add(b), saturating_sub = saturating_sub(b), abs_diff = abs_diff(b), average = average(b);
        2 map2 -> Mask<T::Mask, N>, Mask, T: simd_eq = eq(b), simd_ne = ne(b), simd_lt = lt(b), simd_le = le(b), unordered = unordered(b);
        3 map3 -> Self, Simd, T: mul_add = fma(b, c);
    }
    #[inline(always)]
    pub(crate) fn simd_gt<S: Cpu>(self, b: Self) -> Mask<T::Mask, N>
    where
        Here: In<S>,
    {
        b.simd_lt(self)
    }
    #[inline(always)]
    pub(crate) fn simd_ge<S: Cpu>(self, b: Self) -> Mask<T::Mask, N>
    where
        Here: In<S>,
    {
        b.simd_le(self)
    }
    #[inline(always)]
    pub(crate) fn simd_clamp<S: Cpu>(self, low: Self, high: Self) -> Self
    where
        Here: In<S>,
    {
        self.simd_max(low).simd_min(high)
    }
    #[inline(always)]
    pub(crate) const fn repeated(value: T) -> Self {
        Self::from_array([value; N])
    }
    #[inline(always)]
    pub(crate) fn extract<const AT: usize, const M: usize>(self) -> Simd<T, M>
    where
        T: Fits<M>,
    {
        struct From<const AT: usize>;
        impl<const AT: usize, const M: usize> Swizzle<M> for From<AT> {
            const INDEX: [usize; M] = {
                let (mut index, mut i) = ([0; M], 0);
                while i < M {
                    index[i] = AT + i;
                    i += 1;
                }
                index
            };
        }
        <From<AT> as Swizzle<M>>::swizzle::<T, N>(self)
    }
    /// The count is less than the bits of a lane.
    #[inline(always)]
    pub(crate) fn shl_by<S: Cpu>(self, count: u32) -> Self
    where
        Here: In<S>,
    {
        Self::of(self.0.map1::<S::At, op::shl_by<T>>(count))
    }
    #[inline(always)]
    pub(crate) fn shr_by<S: Cpu>(self, count: u32) -> Self
    where
        Here: In<S>,
    {
        Self::of(self.0.map1::<S::At, op::shr_by<T>>(count))
    }
    #[inline(always)]
    fn reduce<S: Cpu, O: Op2>(self) -> T {
        struct Down<const K: usize, const N: usize>;
        impl<const K: usize, const N: usize, const M: usize> Swizzle<M> for Down<K, N> {
            const INDEX: [usize; M] = {
                let (mut index, mut i) = ([0; M], 0);
                while i < M {
                    index[i] = (i + K) % N;
                    i += 1;
                }
                index
            };
        }
        #[inline(always)]
        fn halved<S: Cpu, O: Op2, T: Fits<K> + Fits<M>, const K: usize, const M: usize>(v: Simd<T, M>) -> Simd<T, K> {
            lazily!(K * size_of::<T>() >= 16 => Simd::<T, K>::of(v.resize::<K>().0.map2::<S, O>(part(&v.0, 1))));
            lazily!(K * size_of::<T>() < 16 => Simd::<T, K>::of(v.resize::<K>().0.map2::<S, O>(<Down<K, M> as Swizzle<K>>::swizzle::<T, M>(v).0)));
            unreachable!()
        }
        macro_rules! halve { ($v:ident: $($k:literal $n:literal)*) => {$(
            let $v: Simd<T, $k> = if const { N > $k } {
                chosen!(fn(_) -> _: N > $k => halved::<S::At, O, T, $k, $n>, _ => |_| unreachable!())($v)
            } else if const { N == $k } { Simd::of(cast(self.0)) } else { Simd::zero() };
        )*}; }
        let v: Simd<T, 64> = if const { N == 64 } { Simd::of(cast(self.0)) } else { Simd::zero() };
        halve!(v: 32 64 16 32 8 16 4 8 2 4 1 2);
        v.to_array()[0]
    }
    #[inline(always)]
    pub(crate) fn reduce_sum<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        arch::reduce_sum::<S, T, N>(self)
    }
    #[inline(always)]
    pub(crate) fn reduce_min<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        arch::reduce_min::<S, T, N>(self)
    }
    #[inline(always)]
    pub(crate) fn reduce_max<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        arch::reduce_max::<S, T, N>(self)
    }
}
impl u8x16 {
    /// Zero for an index that is too large.
    #[inline(always)]
    pub(crate) fn swizzle_dyn(self, indices: Self) -> Self {
        let (table, mut all): ([u8; 32], _) = (cast([self, Self::zero()]), indices.to_array());
        for it in &mut all {
            *it = table[(*it).min(16) as usize];
        }
        Self::from_array(all)
    }
}
impl<T: Fits<N>, const N: usize> core::ops::Index<usize> for Simd<T, N> {
    type Output = T;
    #[inline(always)]
    fn index(&self, i: usize) -> &T {
        &self.as_array()[i]
    }
}
impl<T: Fits<N>, const N: usize> core::ops::IndexMut<usize> for Simd<T, N> {
    #[inline(always)]
    fn index_mut(&mut self, i: usize) -> &mut T {
        &mut self.as_mut_array()[i]
    }
}
impl<T: Fits<N>, const N: usize> Default for Simd<T, N> {
    #[inline(always)]
    fn default() -> Self {
        Self::zero()
    }
}
impl<T: Fits<N>, const N: usize> From<[T; N]> for Simd<T, N> {
    #[inline(always)]
    fn from(array: [T; N]) -> Self {
        Self::from_array(array)
    }
}

// See `packs` in scalar.rs.
cfg_select! {
    any(target_feature = "sse2", target_feature = "neon", target_feature = "simd128") => {
        macro_rules! truth {
            () => {
                T
            };
        }
    }
    _ => {
        macro_rules! truth {
            () => {
                T::Bits
            };
        }
    }
}
impl<T: Fits<N>, const N: usize> Mask<T, N> {
    const WHOLE: bool = Simd::<T, N>::WHOLE;
    const ALL: u64 = !0 >> (64 - N);
    #[inline(always)]
    pub(crate) fn splat<S: Cpu>(value: bool) -> Self
    where
        Here: In<S>,
    {
        Self::of(Reg::splat::<S::At, i8>(-(value as i8)))
    }
    #[inline(always)]
    pub(crate) const fn to_simd(self) -> Simd<T, N> {
        Simd::of(self.0)
    }
    /// `or` if `OR`, else `and`.
    #[inline(always)]
    pub(crate) fn join<S: Cpu, const OR: bool>(self, b: Self) -> Self
    where
        Here: In<S>,
    {
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        if const { T::SIGNED && T::SIZE < 4 && (S::LEVEL == AVX2 || S::LEVEL == AVX2 - 1) } {
            return Self::of(if OR {
                self.0.map2::<S::At, op::min<T>>(b.0)
            } else {
                self.0.map2::<S::At, op::max<T>>(b.0)
            });
        }
        if OR { self.or::<S>(b) } else { self.and::<S>(b) }
    }
    forward! {
        1 map1 -> Self, Mask, truth!(): not = not();
        2 map2 -> Self, Mask, truth!(): and = and(b), or = or(b), xor = xor(b);
    }
    /// The same. Of the operands of logic with bytes in words, only the highest bits are needed then.
    #[inline(always)]
    pub(crate) fn filled<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        lazily!(PACKED != 0 && T::SIZE == 1 => Self::of(self.0.map1::<S::At, op::negative<T>>(0)));
        self
    }
    #[inline(always)]
    pub(crate) fn to_bitmask<S: Cpu>(self) -> u64
    where
        Here: In<S>,
    {
        let bits = self.0.to_bits::<S::At, T>();
        if const { Self::WHOLE } { bits } else { bits & Self::ALL }
    }
    #[inline(always)]
    pub(crate) fn from_bitmask<S: Cpu>(bits: u64) -> Self
    where
        Here: In<S>,
    {
        Self::of(Reg::from_bits::<S::At, T>(bits))
    }
    #[inline(always)]
    pub(crate) fn any<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        if const { Self::WHOLE } { self.0.any::<S::At, T>() } else { self.to_bitmask() != 0 }
    }
    #[inline(always)]
    pub(crate) fn all<S: Cpu>(self) -> bool
    where
        Here: In<S>,
    {
        if const { Self::WHOLE } { self.0.all::<S::At, T>() } else { self.to_bitmask() == Self::ALL }
    }
    #[inline(always)]
    pub(crate) fn select<S: Cpu, U: SimdElement<Bits = T::Bits>>(self, yes: Simd<U, N>, no: Simd<U, N>) -> Simd<U, N>
    where
        Here: In<S>,
    {
        Simd::of(self.0.map3::<S::At, op::select<U>>(yes.0, no.0))
    }
    #[inline(always)]
    pub(crate) fn cast<U: Fits<N>, S: Cpu>(self) -> Mask<U, N>
    where
        Here: In<S>,
    {
        if const { size_of::<T>() == size_of::<U>() } {
            return Mask::of(cast(self.0));
        }
        chosen!(fn(_) -> _: size_of::<T>() != size_of::<U>() => arch::cast_mask::<S, T, U, N>, _ => |_| unreachable!())(
            self,
        )
    }
}

/// What the whole program is compiled for. Operators can't infer a target.
type Base = crate::Portable;
/// No target has better registers for these.
pub trait OfBase {}
cfg_select! {
    all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(bun_simd_all_branches)) => {
        impl OfBase for arch::X {}
    }
    _ => {
        impl<R> OfBase for R {}
    }
}
macro_rules! operators { ($($t:ident: $($tr:ident $f:ident $tra:ident $fa:ident $by:ident)*;)*) => {$($(
    impl<T: Fits<N>, const N: usize> core::ops::$tr for $t<T, N> where RegOf<T, N>: OfBase { type Output = Self; #[inline(always)] fn $f(self, b: Self) -> Self { self.$by::<Base>(b) } }
    impl<T: Fits<N>, const N: usize> core::ops::$tra for $t<T, N> where RegOf<T, N>: OfBase { #[inline(always)] fn $fa(&mut self, b: Self) { *self = self.$by::<Base>(b) } }
)*
    impl<T: Fits<N>, const N: usize> core::ops::Not for $t<T, N> where RegOf<T, N>: OfBase { type Output = Self; #[inline(always)] fn not(self) -> Self { $t::not::<Base>(self) } }
)*}; }
operators! {
    Simd: Add add AddAssign add_assign add Sub sub SubAssign sub_assign sub Mul mul MulAssign mul_assign mul Div div DivAssign div_assign div
        BitAnd bitand BitAndAssign bitand_assign and BitOr bitor BitOrAssign bitor_assign or BitXor bitxor BitXorAssign bitxor_assign xor;
    Mask: BitAnd bitand BitAndAssign bitand_assign and BitOr bitor BitOrAssign bitor_assign or BitXor bitxor BitXorAssign bitxor_assign xor;
}
impl<T: Fits<N>, const N: usize> core::ops::Shl<T> for Simd<T, N>
where
    RegOf<T, N>: OfBase,
{
    type Output = Self;
    #[inline(always)]
    fn shl(self, n: T) -> Self {
        self.shl_by::<Base>(n.bits() as u32)
    }
}
impl<T: Fits<N>, const N: usize> core::ops::Shr<T> for Simd<T, N>
where
    RegOf<T, N>: OfBase,
{
    type Output = Self;
    #[inline(always)]
    fn shr(self, n: T) -> Self {
        self.shr_by::<Base>(n.bits() as u32)
    }
}
impl<T: Fits<N>, const N: usize> PartialEq for Simd<T, N> {
    #[inline(always)]
    fn eq(&self, b: &Self) -> bool {
        self.simd_eq::<Base>(*b).all::<Base>()
    }
}
macro_rules! moves { ($($name:ident $by:ident($i:ident, $k:ident, $n:ident) = $from:expr;)*) => {
    $(struct $by<const K: usize>;
    impl<const $k: usize, const $n: usize> Swizzle<$n> for $by<$k> {
        const INDEX: [usize; $n] = { let (mut index, mut $i) = ([0; $n], 0); while $i < $n { index[$i] = $from; $i += 1; } index };
    })*
}; }
moves! {
    a RotateLeft(i, K, N) = (i + K) % N; c ShiftLeft(i, K, N) = if i + K < N { i + K } else { N + (i + K) % N };
    d ShiftRight(i, K, N) = if i >= K { i - K } else { N + (i + N - K % N) % N }; e Zip(i, K, N) = (K * N + i) / 2 + (K * N + i) % 2 * N;
}
impl<T: Fits<N>, const N: usize> Simd<T, N> {
    #[inline(always)]
    pub(crate) fn rotate_elements_left<const K: usize>(self) -> Self {
        RotateLeft::<K>::swizzle(self)
    }
    /// Zeros come in.
    #[inline(always)]
    pub(crate) fn shift_elements_left<const K: usize>(self) -> Self {
        ShiftLeft::<K>::concat_swizzle(self, Self::zero())
    }
    #[inline(always)]
    pub(crate) fn shift_elements_right<const K: usize>(self) -> Self {
        ShiftRight::<K>::concat_swizzle(self, Self::zero())
    }
    #[inline(always)]
    pub(crate) fn interleave(self, b: Self) -> (Self, Self) {
        (Zip::<0>::concat_swizzle(self, b), Zip::<1>::concat_swizzle(self, b))
    }
}
macro_rules! simd_swizzle {
    ($a:expr, $index:expr $(,)?) => {{ simd_swizzle!(@ $index); <Index as crate::simd::Swizzle<{ $index.len() }>>::swizzle($a) }};
    ($a:expr, $b:expr, $index:expr $(,)?) => {{ simd_swizzle!(@ $index); <Index as crate::simd::Swizzle<{ $index.len() }>>::concat_swizzle($a, $b) }};
    (@ $index:expr) => { struct Index; impl crate::simd::Swizzle<{ $index.len() }> for Index { const INDEX: [usize; { $index.len() }] = $index; } };
}

struct Typed<P, T>(P, T);
impl<P: Swizzle<M>, T: SimdElement, const M: usize> Swizzle<M> for Typed<P, T> {
    const INDEX: [usize; M] = P::INDEX;
    const SINGLE: bool = T::FLOAT && T::SIZE == 4;
    const SIGNED: bool = T::SIGNED;
}
cfg_select! {
    not(any(target_feature = "sse2", target_feature = "simd128")) => {
        macro_rules! typed { () => { Typed<Self, T> }; }
    }
    _ => {
        macro_rules! typed {
            () => {
                Self
            };
        }
    }
}
/// A shuffle whose indices are constants.
pub trait Swizzle<const M: usize>: Sized {
    const INDEX: [usize; M];
    /// LLVM sees more through shuffles of lanes of the same type.
    const SINGLE: bool = false;
    const SIGNED: bool = false;
    /// The lanes from here on are unspecified.
    const END: usize = M;
    #[inline(always)]
    fn swizzle<T: Fits<N> + Fits<M>, const N: usize>(a: Simd<T, N>) -> Simd<T, M> {
        Self::concat_swizzle(a, a)
    }
    #[inline(always)]
    fn concat_swizzle<T: Fits<N> + Fits<M>, const N: usize>(a: Simd<T, N>, b: Simd<T, N>) -> Simd<T, M> {
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        return Simd::of(arch::shuffle_of::<T, T::Bits, Self, N, M>(a.0, b.0));
        #[allow(unreachable_code)]
        Simd::of(arch::shuffle::<T::Bits, typed!(), N, M>(a.0, b.0))
    }
    #[inline(always)]
    fn concat_swizzle_mask<T: Fits<N> + Fits<M>, const N: usize>(a: Mask<T, N>, b: Mask<T, N>) -> Mask<T, M> {
        Mask::of(arch::shuffle::<T::Bits, Self, N, M>(a.0, b.0))
    }
}
const fn full(index: &[usize], n: usize, full: usize, lanes: usize) -> [u16; 256] {
    let (mut all, mut i, m) = ([0; 256], 0, index.len());
    while i < m {
        let at = index[i];
        all[i] = if at < n { at } else { at - n + full } as u16;
        i += 1;
    }
    // The rest goes on as the lanes do.
    while i < lanes {
        let at = all[i - m] as usize;
        all[i] = (at / full * full + (at + m) % full) as u16;
        i += 1;
    }
    all
}
/// For all lanes of the registers: the lanes of the second operand start at `B::FULL`.
struct Full<B, P, const N: usize, const M: usize>(B, P);
impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize> Full<B, P, N, M> {
    const INDEX: &[u8; 64] = &{
        let (from, mut all, mut i) = (full(&P::INDEX, N, <B as Class<N>>::FULL, <B as Class<M>>::FULL), [0; 64], 0);
        while i < 64 {
            all[i] = from[i] as u8;
            i += 1;
        }
        all
    };
}
/// LLVM makes one shuffle of this. It is a function of its own, so that this doesn't depend on where the operands come from.
#[inline]
fn by_lanes<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    <B as Class<M>>::pick::<N>(&<B as Class<N>>::both(a, b), Full::<B, P, N, M>::INDEX)
}

/// The bytes in the order of the CPU.
pub trait ToBytes: Sized {
    type Bytes;
    fn to_ne_bytes(self) -> Self::Bytes;
    fn from_ne_bytes(bytes: Self::Bytes) -> Self;
    #[cfg(target_endian = "little")]
    #[inline(always)]
    fn to_le_bytes(self) -> Self::Bytes {
        self.to_ne_bytes()
    }
    #[cfg(target_endian = "little")]
    #[inline(always)]
    fn from_le_bytes(bytes: Self::Bytes) -> Self {
        Self::from_ne_bytes(bytes)
    }
}
macro_rules! shapes {
    (@bytes $t:ident $n:literal $bytes:literal) => {
        impl ToBytes for Simd<$t, $n> {
            type Bytes = Simd<u8, $bytes>;
            #[inline(always)]
            fn to_ne_bytes(self) -> Self::Bytes {
                self.bits()
            }
            #[inline(always)]
            fn from_ne_bytes(bytes: Self::Bytes) -> Self {
                bytes.bits()
            }
        }
    };
}
macro_rules! to_bytes { ($($t:ident: $($n:literal $bytes:literal)*;)*) => { $($(shapes!(@bytes $t $n $bytes);)*)* }; }
#[rules]
macro_rules! aliases { ($($t:ident)*) => { pub mod prelude { use super::Simd as V; #[allow(unused_imports)] pub use super::{Mask, Simd};
    $(pub type ${concat($t, x1)} = V<$t, 1>; pub type ${concat($t, x2)} = V<$t, 2>; pub type ${concat($t, x4)} = V<$t, 4>; pub type ${concat($t, x8)} = V<$t, 8>;
    pub type ${concat($t, x16)} = V<$t, 16>; pub type ${concat($t, x32)} = V<$t, 32>; pub type ${concat($t, x64)} = V<$t, 64>;)*
} }; }
aliases!(u8 i8 u16 i16 u32 i32 f32 u64 i64 f64);
pub use prelude::*;
to_bytes! {
    u8: 1 1 2 2 4 4 8 8 16 16 32 32 64 64; i8: 1 1 2 2 4 4 8 8 16 16 32 32 64 64;
    u16: 1 2 2 4 4 8 8 16 16 32 32 64; i16: 1 2 2 4 4 8 8 16 16 32 32 64;
    u32: 1 4 2 8 4 16 8 32 16 64; i32: 1 4 2 8 4 16 8 32 16 64; f32: 1 4 2 8 4 16 8 32 16 64;
    u64: 1 8 2 16 4 32 8 64; i64: 1 8 2 16 4 32 8 64; f64: 1 8 2 16 4 32 8 64;
}
