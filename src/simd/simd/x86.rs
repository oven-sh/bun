//! SSE2 to AVX-512.
#![allow(unreachable_code)]
use super::{
    SimdElement as E,
    bits::{pod, start},
    moves::{Places, moved},
    *,
};
#[cfg(target_arch = "x86")]
use core::arch::x86::*;
#[cfg(target_arch = "x86_64")]
use core::arch::x86_64::*;

pub type X = __m128i;
pub type Y = __m256i;
pub type Z = __m512i;
pod!(X Y Z __m128 __m256 __m512 __m128d __m256d __m512d __m128h __m256h __m512h __m128bh __m256bh __m512bh);
pub const SSE2: u8 = 1;
pub const SSE4: u8 = 2;
pub const AVX2: u8 = 3;
pub const AVX512: u8 = 4;
pub const ICE: u8 = 5;
macro_rules! levels { ($($level:ident [$($f:literal)*])*) => {
    /// The highest level whose features are listed, or enabled for the whole program.
    pub const fn level(features: &[&str]) -> u8 {
        const fn has(all: &[&str], it: &str) -> bool {
            let mut i = 0;
            while i < all.len() { if all[i].len() == it.len() && crate::detect::same_text(all[i], it) { return true; } i += 1; }
            false
        }
        let mut level = SSE2;
        $(if $((cfg!(all(target_feature = $f, not(miri))) || has(features, $f)))&&* { level = $level } else { return level })*
        level
    }
    struct Has<S>(S);
    impl<S: Cpu> Has<S> { $(const $level: bool = S::LEVEL >= $level;)* }
    levels!(@ [] SSE2 ["sse2"] $($level [$($f)*])*);
};
    // A macro for each level, which gives its features to a function.
    (@ [$($below:literal)*]) => {};
    (@ [$($below:literal)*] $level:ident [$($f:literal)*] $($rest:tt)*) => {
        macro_rules! $level { ($item:item) => { #[inline] $(#[target_feature(enable = $below)])* $(#[target_feature(enable = $f)])* $item }; }
        within!($level, $level);
        levels!(@ [$($below)* $($f)*] $($rest)*);
    };
}
levels! {
    SSE4 ["ssse3" "sse4.1" "sse4.2"] AVX2 ["avx" "avx2" "fma" "f16c"] AVX512 ["avx512f" "avx512bw" "avx512cd" "avx512dq" "avx512vl"]
    ICE ["avx512vbmi" "avx512vbmi2" "avx512bitalg" "avx512vpopcntdq" "gfni"]
}
macro_rules! registers { ($m:ident) => { $m! {
    u8: 1 16 arch::X, 2 16 arch::X, 4 16 arch::X, 8 16 arch::X, 16 16 arch::X, 32 32 arch::Y, 64 64 arch::Z;
    u16: 1 8 arch::X, 2 8 arch::X, 4 8 arch::X, 8 8 arch::X, 16 16 arch::Y, 32 32 arch::Z, 64 64 [arch::Z; 2];
    u32: 1 4 arch::X, 2 4 arch::X, 4 4 arch::X, 8 8 arch::Y, 16 16 arch::Z, 32 32 [arch::Z; 2], 64 64 [arch::Z; 4];
    u64: 1 2 arch::X, 2 2 arch::X, 4 4 arch::Y, 8 8 arch::Z, 16 16 [arch::Z; 2], 32 32 [arch::Z; 4], 64 64 [arch::Z; 8];
} }; }
pub(super) use registers;

/// Calls an intrinsic that the level has.
macro_rules! run {
    ($level:ident $f:ident $(::<$i:literal>)? ($a:expr)) => { at_level!([$level] $f [$($i)?] a = $a) };
    ($level:ident $f:ident $(::<$i:literal>)? ($a:expr, $b:expr)) => { at_level!([$level] $f [$($i)?] a = $a, b = $b) };
    ($level:ident $f:ident $(::<$i:literal>)? ($a:expr, $b:expr, $c:expr)) => { at_level!([$level] $f [$($i)?] a = $a, b = $b, c = $c) };
}
/// The same, for an intrinsic whose name has two parts.
#[rules]
macro_rules! call { ($level:ident $p:ident $n:ident $($rest:tt)*) => { run!($level ${concat($p, $n)} $($rest)*) }; }
/// And with the bits of the operands and of the result as other types.
macro_rules! f { ($level:ident $p:ident $n:ident $(::<$i:literal>)? ($($a:expr),*)) => { cast(call!($level $p $n $(::<$i>)? ($(cast($a)),*))) }; }
/// `at!`, if the condition only has named constants. rustc evaluates these once, and a block for each instance.
macro_rules! named {
    ($level:ident $(if $c:expr)? => f!($($call:tt)*)) => { named!($level $(if $c)? => { f!($level $($call)*) }) };
    ($level:ident $(if $c:expr)? => $e:expr) => { if at_level!(@has $level) $(&& $c)? { return $e; } };
}
macro_rules! at {
    ($level:ident $(if $c:expr)? => f!($($call:tt)*)) => { at!($level $(if $c)? => { f!($level $($call)*) }) };
    ($level:ident $(if $c:expr)? => $e:expr) => { if const { S::LEVEL >= $level $(&& $c)? } { return $e; } };
}

pub mod prefetch {
    use super::*;
    macro_rules! hints { ($($name:ident $hint:literal)*) => { $(#[inline(always)] pub fn $name(line: *const i8) { run!(SSE2 _mm_prefetch::<$hint>(line)) })* }; }
    hints!(t0 3 t1 2 t2 1 nta 0 et0 7);
}
/// The same number.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
#[inline(always)]
pub fn limit<S: Cpu>(n: u64) -> u64 {
    if const { S::LEVEL >= AVX512 } { crate::regs::bound(n) } else { n }
}
/// The same value.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
#[inline(always)]
pub fn accessed<S: Cpu, R: Pod>(v: R) -> R {
    if const { S::LEVEL >= AVX512 && matches!(size_of::<R>(), 16 | 32 | 64) } { kept::<S, R>(v) } else { v }
}
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
#[inline(always)]
pub fn in_mask<S: Cpu>(bits: u64, lanes: usize) -> u64 {
    use crate::regs::{mask8, mask16, mask32};
    at!(AVX512 => if lanes <= 8 { run!(AVX512 mask8(if cfg!(target_arch = "x86") { run!(AVX512 mask16(bits as u16)) as u8 } else { bits as u8 })) as u64 } else if lanes <= 16 { run!(AVX512 mask16(bits as u16)) as u64 } else { run!(AVX512 mask32(bits as u32)) as u64 });
    bits
}
/// One shuffle, if LLVM sees it by itself.
#[inline(always)]
pub fn joined<H: Pod, R: Pod>(a: H, b: H) -> R {
    #[cfg(bun_simd_unoptimized)]
    return cast([a, b]);
    #[inline]
    fn apart<H: Pod, R: Pod>(a: H, b: H) -> R {
        if const { size_of::<H>() == 16 } { cast(<u64 as Class<4>>::every_from(&[a, b], 0, 1)) } else { cast([a, b]) }
    }
    // rustc inlines no call of a pointer.
    (apart as fn(_, _) -> _)(a, b)
}
/// LLVM gives a copy the longest lanes that fit all its accesses. Those of 16 bytes would go to general registers.
#[inline(always)]
fn in_words<T: E, A: Pod, R: Pod>(all: A) -> R {
    if const { cfg!(bun_simd_unoptimized) || T::SIZE > 1 } {
        return typed::<T, _, _, true>(all);
    }
    #[inline(always)]
    fn read<A: Pod, R: Pod>(it: &A) -> R {
        cast(*it)
    }
    let mut it = all;
    super::set_part(&mut it, 1, [0u8; 8]);
    it = all;
    (read::<A, R> as fn(_) -> _)(&it)
}
/// `joined`, by bytes.
#[inline(always)]
fn joined_bytes<H: Pod, R: Pod>(a: H, b: H) -> R {
    #[cfg(bun_simd_unoptimized)]
    return cast([a, b]);
    #[inline]
    fn apart<H: Pod, R: Pod>(a: H, b: H) -> R {
        if const { size_of::<H>() == 16 } {
            cast(<u8 as Class<32>>::every_from(&[a, b], 0, 1))
        } else {
            cast(<u8 as Class<64>>::every_from(&[a, b], 0, 1))
        }
    }
    (apart as fn(_, _) -> _)(a, b)
}
/// Within the registers for masks.
#[inline(always)]
fn united<S: Cpu, T: E, U: E, R: Pod>(all: R) -> u64 {
    macro_rules! short {
        ($i:literal) => {
            X::of_bits::<S, U>(part::<R, Z>(&all, $i).sign_bits::<S, T>())
        };
    }
    let lower: Y = joined_bytes(short!(0), short!(1));
    if const { size_of::<R>() == 128 } {
        return lower.sign_bits::<S, U>();
    }
    joined_bytes::<Y, Z>(lower, joined_bytes(short!(2), short!(3))).sign_bits::<S, U>()
}
/// The same. The sums are below 2^16, which LLVM only knows when it selects instructions.
#[inline(always)]
fn late(v: X) -> X {
    run!(SSE2 _mm_add_epi8(v, run!(SSE2 _mm_srli_epi64::<16>(run!(SSE2 _mm_sad_epu8(v, v))))))
}
/// Zero, in the same way.
#[inline(always)]
pub fn nothing(of: u32) -> u32 {
    let v = run!(SSE2 _mm_cvtsi32_si128(of as i32));
    run!(SSE2 _mm_cvtsi128_si32(run!(SSE2 _mm_srli_epi64::<16>(run!(SSE2 _mm_sad_epu8(v, v)))))) as u32
}
#[inline(always)]
pub fn lowest<A: Pod>(v: X) -> A {
    if const { size_of::<A>() == 8 } { start(late(v)) } else { cast(start::<_, f32>(late(v))) }
}
#[inline(always)]
pub fn of_float<A: Pod>(it: A) -> X {
    if const { size_of::<A>() == 8 } {
        cast(run!(SSE2 _mm_set_sd(cast(it))))
    } else {
        cast(run!(SSE2 _mm_set_ss(cast(it))))
    }
}
/// From memory or to it. By itself, the access keeps the type of the lanes.
#[inline(always)]
fn typed<T: E, A: Pod, B: Pod, const LOAD: bool>(a: A) -> B {
    #[inline(always)]
    fn by<V: Pod, A: Pod, B: Pod, const LOAD: bool>(a: A) -> B {
        if LOAD { cast((cast::<A, V> as fn(_) -> _)(a)) } else { (cast::<V, B> as fn(_) -> _)(cast(a)) }
    }
    macro_rules! rows { ($($bytes:literal $size:literal $t:ident)*) => {
        chosen!(fn(A) -> B: $(T::FLOAT && T::SIZE == $size && size_of::<A>() == $bytes => by::<$t, A, B, LOAD>,)* _ => cast)(a)
    }; }
    rows!(16 4 __m128 32 4 __m256 64 4 __m512 16 8 __m128d 32 8 __m256d 64 8 __m512d)
}
/// From lanes that were written one by one. By itself, it keeps floats from becoming integers, for which LLVM finds worse loads.
#[inline(always)]
pub fn of_each<S: Cpu, T: Fits<N>, const N: usize>(lanes: [T; N]) -> Simd<T, N>
where
    Here: In<S>,
{
    macro_rules! rows { ($($t:ident $r:ident [$($i:literal)*])*) => {$({
        #[inline]
        fn apart(all: &[$t; size_of::<$r>() / size_of::<$t>()]) -> $r { cast([$(all[$i]),*]) }
        lazily!(T::FLOAT && T::SIZE == size_of::<$t>() && N * T::SIZE == size_of::<$r>() => Simd::of(cast((apart as fn(_) -> _)(&cast(lanes)))));
    })*}; }
    rows!(f32 __m128 [0 1 2 3] f32 __m256 [0 1 2 3 4 5 6 7] f32 __m512 [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]
        f64 __m128d [0 1] f64 __m256d [0 1 2 3] f64 __m512d [0 1 2 3 4 5 6 7]);
    if const { N * T::SIZE < 16 } { Simd::from_array(lanes) } else { Simd::joined(lanes) }
}
/// With zeros.
#[inline(always)]
pub fn extended<A: Pod, R: Reg>(a: A) -> R {
    #[inline(always)]
    fn twice<A: Pod, H: Reg, R: Pod>(a: A) -> R {
        joined(a, cast(H::ZERO))
    }
    #[inline(always)]
    fn four_times<A: Pod, R: Pod>(a: A) -> R {
        joined::<Y, R>(twice::<A, X, Y>(a), Y::ZERO)
    }
    chosen!(fn(A) -> R: size_of::<A>() == 16 && size_of::<R>() == 32 => twice::<A, X, R>, size_of::<A>() == 32 && size_of::<R>() == 64 => twice::<A, Y, R>,
        size_of::<A>() == 16 && size_of::<R>() == 64 => four_times, _ => super::bits::widened)(a)
}
/// A byte for each bit, all from one register.
#[inline(always)]
fn spread<S: Cpu, R: Pod>(bits: u64) -> R {
    #[inline(always)]
    fn from<S: Cpu, R: Prim>(bits: u64, first: u64) -> R {
        let (each, at) = (R::set::<S, u64>(0x8040_2010_0804_0201), |i| (first + i) * 0x0101_0101_0101_0101);
        R::set::<S, u64>(bits).table::<S>(start([at(0), at(1), at(2), at(3)])).and::<S, u8>(each).eq::<S, u8>(each)
    }
    if const { S::LEVEL >= AVX2 } {
        return joined::<Y, R>(from::<S, Y>(bits, 0), from::<S, Y>(bits, 4));
    }
    let lower: Y = joined(from::<S, X>(bits, 0), from::<S, X>(bits, 2));
    if const { size_of::<R>() == 32 } {
        cast(lower)
    } else {
        joined::<Y, R>(lower, joined(from::<S, X>(bits, 4), from::<S, X>(bits, 6)))
    }
}
macro_rules! halves { ($r:ty, $h:ty, $whole:tt) => {
    impl Reg for $r {
        const ZERO: Self = cast([<$h>::ZERO; 2]);
        type Unit = halves!(@unit $whole);
        type Singles = halves!(@singles $whole);
        #[inline(always)]
        fn joined<S: Cpu, T: E, A: Pod>(all: A) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E, A: Pod>(all: A) -> $r {
                let [a, b]: [[u8; size_of::<$h>()]; 2] = cast(all);
                halves!(@join $whole, [<$h>::joined::<S, T, _>(a), <$h>::joined::<S, T, _>(b)])
            }
            halves!(@whole $whole, fn(A) -> Self, in_words::<T, _, _>, split::<S, T, A>)(all)
        }
        #[inline(always)]
        fn parted<S: Cpu, T: E, A: Pod>(self) -> A {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E, A: Pod>(v: $r) -> A {
                let [a, b]: [$h; 2] = cast(v);
                cast::<[[u8; size_of::<$h>()]; 2], A>([a.parted::<S, T, _>(), b.parted::<S, T, _>()])
            }
            halves!(@whole $whole, fn(Self) -> A, typed::<T, _, _, false>, split::<S, T, A>)(self)
        }
        #[inline(always)]
        fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, O: Op1>(v: $r, x: u32) -> $r {
                let [a, b]: [$h; 2] = cast(v);
                halves!(@join $whole, [a.map1::<S, O>(x), b.map1::<S, O>(x)])
            }
            halves!(@whole $whole, fn(Self, u32) -> Self, O::on::<S, Self>, split::<S, O>)(self, x)
        }
        #[inline(always)]
        fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, O: Op2>(v: $r, b: $r) -> $r {
                let [a, b]: [[$h; 2]; 2] = [cast(v), cast(b)];
                halves!(@join $whole, [a[0].map2::<S, O>(b[0]), a[1].map2::<S, O>(b[1])])
            }
            halves!(@whole $whole, fn(Self, Self) -> Self, O::on::<S, Self>, split::<S, O>)(self, b)
        }
        #[inline(always)]
        fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, O: Op3>(v: $r, b: $r, c: $r) -> $r {
                let [a, b, c]: [[$h; 2]; 3] = [cast(v), cast(b), cast(c)];
                halves!(@join $whole, [a[0].map3::<S, O>(b[0], c[0]), a[1].map3::<S, O>(b[1], c[1])])
            }
            halves!(@whole $whole, fn(Self, Self, Self) -> Self, O::on::<S, Self>, split::<S, O>)(self, b, c)
        }
        #[inline(always)]
        fn splat<S: Cpu, T: E>(value: T) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E>(value: T) -> $r {
                let half = <$h>::splat::<S, T>(value);
                halves!(@join $whole, [half, half])
            }
            halves!(@whole $whole, fn(T) -> Self, Self::set::<S, T>, split::<S, T>)(value)
        }
        #[inline(always)]
        fn to_bits<S: Cpu, T: E>(self) -> u64 {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E>(v: $r) -> u64 {
                let [a, b]: [$h; 2] = cast(v);
                if const { T::SIZE > 1 && size_of::<$r>() == 32 } {
                    let packed = if T::SIZE == 2 { run!(SSE2 _mm_packs_epi16(start(a), start(b))) } else { run!(SSE2 _mm_packs_epi32(start(a), start(b))) };
                    return if T::SIZE == 2 { packed.sign_bits::<S, u8>() } else if T::SIZE == 4 { packed.sign_bits::<S, u16>() } else { packed.sign_bits::<S, u32>() };
                }
                lazily!(S::LEVEL >= AVX512 && size_of::<$r>() > 64 && T::SIZE == 4 => united::<S, T, u8, $r>(v));
                lazily!(S::LEVEL >= AVX512 && matches!(size_of::<$r>(), 128 | 256) && T::SIZE == 8 => united::<S, T, u16, $r>(v));
                a.to_bits::<S, T>() | b.to_bits::<S, T>() << const { size_of::<$h>() / T::SIZE % 64 }
            }
            halves!(@whole $whole, fn(Self) -> u64, bits_of::<S, T, Self>, split::<S, T>)(self)
        }
        #[inline(always)]
        fn from_bits<S: Cpu, T: E>(bits: u64) -> Self {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E>(bits: u64) -> $r {
                lazily!(T::SIZE == 1 && S::LEVEL >= SSE4 => cast(spread::<S, $r>(bits)));
                halves!(@join $whole, [<$h>::from_bits::<S, T>(bits), <$h>::from_bits::<S, T>(bits >> const { size_of::<$h>() / T::SIZE % 64 })])
            }
            halves!(@whole $whole, fn(u64) -> Self, mask_of::<S, T, Self>, split::<S, T>)(bits)
        }
        #[inline(always)]
        fn any<S: Cpu, T: E>(self) -> bool {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E>(v: $r) -> bool {
                let [a, b]: [$h; 2] = cast(v);
                a.map2::<S, op::or<T::Bits>>(b).any::<S, T>()
            }
            halves!(@whole $whole, fn(Self) -> bool, any::<S, T, Self>, split::<S, T>)(self)
        }
        #[inline(always)]
        fn all<S: Cpu, T: E>(self) -> bool {
            #[bun_simd_macros::op]
            fn split<S: Cpu, T: E>(v: $r) -> bool {
                let [a, b]: [$h; 2] = cast(v);
                a.map2::<S, op::and<T::Bits>>(b).all::<S, T>()
            }
            halves!(@whole $whole, fn(Self) -> bool, all::<S, T, Self>, split::<S, T>)(self)
        }
    }
};
    (@join 0, $both:expr) => { cast($both) };
    (@join $level:ident, [$a:expr, $b:expr]) => { joined($a, $b) };
    (@singles AVX2) => { __m256 };
    (@singles $other:tt) => { __m512 };
    (@unit AVX2) => { Y };
    (@unit $other:tt) => { Z };
    (@whole 0, $t:ty, $whole:expr, $split:expr) => { $split };
    (@whole $level:ident, $t:ty, $whole:expr, $split:expr) => { chosen!($t: S::LEVEL >= $level => $whole, _ => $split) };
}
#[inline(always)]
fn any<S: Cpu, T: E, R: Prim>(m: R) -> bool {
    if const { T::SIZE == 2 && S::LEVEL < AVX512 } { bits_of::<S, u8, R>(m) != 0 } else { bits_of::<S, T, R>(m) != 0 }
}
#[inline(always)]
fn all<S: Cpu, T: E, R: Prim>(m: R) -> bool {
    if const { T::SIZE == 2 && S::LEVEL < AVX512 } {
        return bits_of::<S, u8, R>(m) == !0 >> (64 - size_of::<R>());
    }
    bits_of::<S, T, R>(m) == !0 >> (64 - size_of::<R>() / T::SIZE)
}
impl Reg for X {
    #[inline(always)]
    fn joined<S: Cpu, T: E, A: Pod>(all: A) -> Self {
        typed::<T, _, _, true>(all)
    }
    #[inline(always)]
    fn parted<S: Cpu, T: E, A: Pod>(self) -> A {
        typed::<T, _, _, false>(self)
    }
    const ZERO: Self = cast([0u64; 2]);
    type Unit = X;
    type Singles = __m128;
    #[inline(always)]
    fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self {
        O::on::<S, X>(self, x)
    }
    #[inline(always)]
    fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self {
        O::on::<S, X>(self, b)
    }
    #[inline(always)]
    fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self {
        O::on::<S, X>(self, b, c)
    }
    #[inline(always)]
    fn splat<S: Cpu, T: E>(value: T) -> Self {
        X::set::<S, T>(value)
    }
    #[inline(always)]
    fn to_bits<S: Cpu, T: E>(self) -> u64 {
        bits_of::<S, T, X>(self)
    }
    #[inline(always)]
    fn from_bits<S: Cpu, T: E>(bits: u64) -> Self {
        mask_of::<S, T, X>(bits)
    }
    #[inline(always)]
    fn any<S: Cpu, T: E>(self) -> bool {
        any::<S, T, X>(self)
    }
    #[inline(always)]
    fn all<S: Cpu, T: E>(self) -> bool {
        all::<S, T, X>(self)
    }
}
halves! { Y, X, AVX2 }
halves! { Z, Y, AVX512 }
halves! { [Z; 2], Z, 0 }
halves! { [Z; 4], [Z; 2], 0 }
halves! { [Z; 8], [Z; 4], 0 }

#[inline(always)]
pub fn shuffle<B: E + Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    shuffle_of::<B, B, P, N, M>(a, b)
}
#[inline(always)]
pub fn shuffle_of<T: E, B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
    a: <B as Class<N>>::Reg,
    b: <B as Class<N>>::Reg,
) -> <B as Class<M>>::Reg {
    struct Of<B, P, const N: usize, const M: usize>(B, P);
    impl<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize> Places for Of<B, P, N, M> {
        const FROM: [u16; 256] = full(&P::INDEX, N, <B as Class<N>>::FULL, <B as Class<M>>::FULL);
    }
    #[cfg(all(bun_simd_unoptimized, target_arch = "x86_64", not(miri)))]
    {
        if const {
            super::moves::whole::<B, <B as Class<M>>::Reg, Of<B, P, N, M>>()
                && Of::<B, P, N, M>::FROM[0] as usize + <B as Class<M>>::FULL <= <B as Class<N>>::FULL
        } {
            return *super::bits::view(&a, const { Of::<B, P, N, M>::FROM[0] as usize / <B as Class<M>>::FULL });
        }
        return super::moves::slowly::<B, _, _, Of<B, P, N, M>>(&[a, b], Reg::ZERO);
    }
    const fn is_part(from: &[u16; 256], lanes: usize) -> bool {
        let mut i = 0;
        while i < lanes && from[i] as usize == from[0] as usize / lanes * lanes + i {
            i += 1;
        }
        i == lanes
    }
    if const {
        !T::FLOAT
            && <B as Class<M>>::FULL < <B as Class<N>>::FULL
            && is_part(&Of::<B, P, N, M>::FROM, <B as Class<M>>::FULL)
    } {
        return part(&[a, b], const { Of::<B, P, N, M>::FROM[0] as usize / <B as Class<M>>::FULL });
    }
    /// A function of its own, so that what LLVM makes of it doesn't depend on where the operands come from.
    /// rustc inlines no call of a pointer.
    #[inline]
    fn apart<B: Pod, U: Pod, A: Pod, R: Pod, P: Places>(a: A, b: A) -> R {
        moved::<B, U, _, R, P>(&[a, b], const { start([Z::ZERO; 8]) })
    }
    #[inline(always)]
    fn moved_to<T: E, A: Reg, R: Pod, P: Places>(a: A, b: A) -> R {
        // LLVM chooses other instructions for floats. The x87 would change them.
        chosen!(fn(_, _) -> _: T::FLOAT && T::SIZE == 4 && cfg!(target_arch = "x86_64") => apart::<f32, A::Singles, A, R, P>, _ => apart::<T::Bits, A::Unit, A, R, P>)(
            a, b,
        )
    }
    // Registers that are longer than the operands.
    #[inline(always)]
    fn two<B: E, H: Pod, A: Reg, R: Pod, P: Places>(a: A, b: A) -> R {
        let [a, b] = moved_to::<B, A, [H; 2], P>(a, b);
        joined(a, b)
    }
    #[inline(always)]
    fn four<B: E, A: Reg, R: Pod, P: Places>(a: A, b: A) -> R {
        let [a, b, c, d] = moved_to::<B, A, [X; 4], P>(a, b);
        joined::<Y, _>(joined(a, b), joined(c, d))
    }
    macro_rules! sizes {
        ($from:literal $to:literal) => {
            size_of::<<B as Class<N>>::Reg>() == $from && size_of::<<B as Class<M>>::Reg>() == $to
        };
    }
    chosen!(fn(_, _) -> _: sizes!(16 32) => two::<T, X, _, _, Of<B, P, N, M>>, sizes!(32 64) => two::<T, Y, _, _, Of<B, P, N, M>>,
        sizes!(16 64) => four::<T, _, _, Of<B, P, N, M>>, _ => moved_to::<T, _, _, Of<B, P, N, M>>)(a, b)
}
struct Turns<const K: usize, const N: usize, const STORE: bool>;
impl<const K: usize, const N: usize, const STORE: bool> Places for Turns<K, N, STORE> {
    const FROM: [u16; 256] = {
        let (mut all, mut i) = ([0; 256], 0);
        while i < K * N {
            all[i] = if STORE { i % K * N + i / K } else { i % N * K + i / N } as u16;
            i += 1;
        }
        all
    };
}
/// The same for up to 8 bytes each.
#[inline(always)]
pub fn turned_short<T: Fits<N>, const K: usize, const N: usize, const STORE: bool>(
    mut parts: [[T; N]; K],
) -> [[T; N]; K] {
    #[inline]
    fn apart<B: Pod, P: Places>(a: X, b: X) -> [X; 2] {
        moved::<B, X, _, _, P>(&[a, b], [X::ZERO; 2])
    }
    let mut all = [X::ZERO; 2];
    macro_rules! each {
        ($i:ident => $e:expr) => {{
            let $i = 0;
            $e
        }
        {
            let $i = 1;
            $e
        }
        {
            let $i = 2;
            $e
        }
        if K > 3 {
            let $i = 3;
            $e
        }};
    }
    each!(i => set_part(&mut all, i, parts[i]));
    let all = apart::<T::Bits, Turns<K, N, STORE>>(all[0], all[1]);
    each!(i => parts[i] = part(&all, i));
    parts
}
/// From vectors to the order in memory, or the reverse.
#[inline]
pub fn turned<T: Fits<N>, const K: usize, const N: usize, const STORE: bool>(
    all: [RegOf<T, N>; K],
) -> [RegOf<T, N>; K] {
    moved::<T::Bits, <RegOf<T, N> as Reg>::Unit, _, _, Turns<K, N, STORE>>(&all, [<RegOf<T, N>>::ZERO; K])
}
/// All parts of 16 bytes in one.
#[inline(always)]
fn folded<S: Cpu, O: Op2, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> X {
    if const { N * T::SIZE == 16 } {
        return cast(v.0);
    }
    let all: Z = if const { N * T::SIZE == 128 } { part::<_, Z>(&v.0, 0).map2::<S, O>(part(&v.0, 1)) } else { Z::ZERO };
    let half: Y = if const { N * T::SIZE == 32 } {
        cast(v.0)
    } else if const { N * T::SIZE == 64 } {
        part::<_, Y>(&v.0, 0).map2::<S, O>(part(&v.0, 1))
    } else {
        part::<_, Y>(&all, 0).map2::<S, O>(part(&all, 1))
    };
    O::on::<S, X>(part(&half, 0), part(&half, 1))
}
const fn folds<T: E, const N: usize>() -> bool {
    !T::FLOAT && N * T::SIZE >= 16 && N * T::SIZE <= 128
}
#[inline(always)]
pub fn reduce_sum<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    if const { T::SIZE == 1 && folds::<T, N>() } {
        let sums = run!(SSE2 _mm_sad_epu8(folded::<S, op::add<T>, T, N>(v), X::ZERO));
        return part(&sums.add::<S, u8>(run!(SSE2 _mm_unpackhi_epi64(sums, sums))), 0);
    }
    // LLVM has shorter ways for small numbers.
    at!(AVX512 if !T::FLOAT && T::SIZE == 8 && matches!(N, 4 | 8) => T::of_bits(run!(AVX512 _mm512_reduce_add_epi64(if N == 8 { cast(v.0) } else { extended(v.0) })) as u64));
    chosen!(fn(_) -> T: !(T::SIZE == 1 && folds::<T, N>()) => Simd::reduce::<S, op::add<T>>, _ => |_| unreachable!())(v)
}
/// By the least of unsigned words. The bits of `flip` make it the wanted one.
#[inline(always)]
fn least<S: Cpu, T: E>(v: X, flip: u64) -> T {
    let flip = X::set::<S, T>(T::of_bits(flip));
    let v = v.xor::<S, T>(flip);
    let v = if T::SIZE == 1 { v.min::<S, u8>(v.shr_by::<S, u16>(8)) } else { v };
    part(&run!(SSE4 _mm_minpos_epu16(v)).xor::<S, T>(flip), 0)
}
#[inline(always)]
pub fn reduce_min<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    lazily!(S::LEVEL >= SSE4 && T::SIZE <= 2 && folds::<T, N>() => least::<S, T>(folded::<S, op::min<T>, T, N>(v), (T::SIGNED as u64) << (8 * T::SIZE - 1)));
    chosen!(fn(_) -> T: !(S::LEVEL >= SSE4 && T::SIZE <= 2 && folds::<T, N>()) => Simd::reduce::<S, op::min<T>>, _ => |_| unreachable!())(
        v,
    )
}
#[inline(always)]
pub fn reduce_max<S: Cpu, T: Fits<N>, const N: usize>(v: Simd<T, N>) -> T {
    lazily!(S::LEVEL >= SSE4 && T::SIZE <= 2 && folds::<T, N>() => least::<S, T>(folded::<S, op::max<T>, T, N>(v), !((T::SIGNED as u64) << (8 * T::SIZE - 1))));
    chosen!(fn(_) -> T: !(S::LEVEL >= SSE4 && T::SIZE <= 2 && folds::<T, N>()) => Simd::reduce::<S, op::max<T>>, _ => |_| unreachable!())(
        v,
    )
}
include!("x86_prim.rs");
#[path = "x86_more.rs"]
mod more;
pub use more::*;
macro_rules! from { ($($r:ident: $($v:ident)*;)*) => {$($(
    impl From<$r> for $v { #[inline(always)] fn from(it: $r) -> Self { cast(it) } }
    impl From<$v> for $r { #[inline(always)] fn from(it: $v) -> Self { cast(it) } }
)*)*}; }
from! {
    X: u8x16 i8x16 u16x8 i16x8 u32x4 i32x4 u64x2 i64x2; Y: u8x32 i8x32 u16x16 i16x16 u32x8 i32x8 u64x4 i64x4; Z: u8x64 i8x64 u16x32 i16x32 u32x16 i32x16 u64x8 i64x8;
    __m128: f32x4; __m256: f32x8; __m512: f32x16; __m128d: f64x2; __m256d: f64x4; __m512d: f64x8;
}
/// For hints.rs. The first word of `(a, a)` needs all of `a`.
#[inline(always)]
pub fn only_combined(a: [u64; 2], b: [u64; 2]) -> Option<[u64; 2]> {
    Some(cast(run!(SSE2 _mm_packus_epi16(cast(a), cast(b)))))
}
