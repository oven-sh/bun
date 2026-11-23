//! NEON, which the whole program is compiled for.
#![allow(unreachable_code)]
use super::{SimdElement as E, bits::start, *};
use core::arch::aarch64::*;

pub type D = uint8x8_t;
pub type Q = uint8x16_t;
const FP16: u8 = 2;
const SVE2: u8 = 3;
pub const fn level(features: &[&str]) -> u8 {
    let mut i = 0;
    // It implies `fp16`.
    while i < features.len() {
        if features[i].eq_ignore_ascii_case("sve2") {
            return SVE2;
        }
        i += 1;
    }
    i = 0;
    while i < features.len() {
        if features[i].eq_ignore_ascii_case("fp16") {
            return FP16;
        }
        i += 1;
    }
    if cfg!(target_feature = "fp16") { FP16 } else { 1 }
}
struct Has<S>(S);
impl<S: Cpu> Has<S> {
    const FP16: bool = S::LEVEL >= FP16;
    const SVE2: bool = S::LEVEL >= SVE2;
}
macro_rules! plain {
    ($item:item) => {
        #[inline]
        $item
    };
}
within!(1, plain);
// A macro for each level, which gives its features to a function.
macro_rules! levels { ($($level:ident $features:literal)*) => {$(
    macro_rules! $level { ($item:item) => { #[inline] #[target_feature(enable = $features)] $item }; }
)*}; }
levels!(NEON "neon" FP16 "neon,fp16" SVE2 "neon,sve2");
within!(FP16, FP16);
within!(SVE2, SVE2);
macro_rules! registers { ($m:ident) => { $m! {
    u8: 1 8 arch::D, 2 8 arch::D, 4 8 arch::D, 8 8 arch::D, 16 16 arch::Q, 32 32 [arch::Q; 2], 64 64 [arch::Q; 4];
    u16: 1 4 arch::D, 2 4 arch::D, 4 4 arch::D, 8 8 arch::Q, 16 16 [arch::Q; 2], 32 32 [arch::Q; 4], 64 64 [arch::Q; 8];
    u32: 1 2 arch::D, 2 2 arch::D, 4 4 arch::Q, 8 8 [arch::Q; 2], 16 16 [arch::Q; 4], 32 32 [arch::Q; 8], 64 64 [arch::Q; 16];
    u64: 1 1 arch::D, 2 2 arch::Q, 4 4 [arch::Q; 2], 8 8 [arch::Q; 4], 16 16 [arch::Q; 8], 32 32 [arch::Q; 16], 64 64 [arch::Q; 32];
} }; }
pub(super) use registers;

/// Calls an intrinsic of NEON, or a function for a higher level.
macro_rules! run {
    ($([$half:ident])? $f:ident $(::<$i:literal>)? ($a:expr)) => { at_level!([$($half)? NEON] $f [$($i)?] a = $a) };
    ($([$half:ident])? $f:ident $(::<$i:literal>)? ($a:expr, $b:expr)) => { at_level!([$($half)? NEON] $f [$($i)?] a = $a, b = $b) };
    ($([$half:ident])? $f:ident $(::<$i:literal>)? ($a:expr, $b:expr, $c:expr)) => { at_level!([$($half)? NEON] $f [$($i)?] a = $a, b = $b, c = $c) };
}
macro_rules! at {
    ($c:expr => $e:expr) => {
        if const { $c } {
            return $e;
        }
    };
}

#[path = "neon_more.rs"]
mod more;
use more::Plan;
pub use more::*;

/// Four bits of each byte.
#[cfg(bun_simd_unoptimized)]
#[inline(always)]
pub fn nibbles(v: u8x16) -> u64 {
    start(run!(vshrn_n_u16::<4>(start(v))))
}
/// The even lanes of half the size of `T`.
#[inline(always)]
fn narrowed<T: E>(a: Q, b: Q) -> Q {
    at!(T::SIZE == 2 => run!(vuzp1q_u8(a, b)));
    at!(T::SIZE == 4 => cast(run!(vuzp1q_u16(cast(a), cast(b)))));
    cast(run!(vuzp1q_u32(cast(a), cast(b))))
}
/// By halves, of which LLVM drops those that are zero. With SVE, it makes one instruction of the multiplication of each lane.
#[inline(always)]
fn mul64(a: uint64x2_t, b: uint64x2_t) -> uint64x2_t {
    let (low_a, low_b, high_a, high_b) =
        (run!(vmovn_u64(a)), run!(vmovn_u64(b)), run!(vshrn_n_u64::<32>(a)), run!(vshrn_n_u64::<32>(b)));
    let cross = run!(vadd_u32(run!(vmul_u32(low_a, high_b)), run!(vmul_u32(high_a, low_b))));
    run!(vaddq_u64(run!(vmull_u32(low_a, low_b)), run!(vshlq_n_u64::<32>(run!(vmovl_u32(cross))))))
}
const WEIGHTS: Q = cast([1u8, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
trait Halves: Reg {
    type Half: Reg;
    fn narrowed<T: E>(self) -> Self::Half;
}
impl Halves for [Q; 2] {
    type Half = Q;
    #[inline(always)]
    fn narrowed<T: E>(self) -> Q {
        narrowed::<T>(self[0], self[1])
    }
}
macro_rules! deeper { ($($r:ty, $h:ty;)*) => {$(
    impl Halves for $r {
        type Half = $h;
        #[inline(always)]
        fn narrowed<T: E>(self) -> $h { let [a, b]: [$h; 2] = cast(self); cast([a.narrowed::<T>(), b.narrowed::<T>()]) }
    }
)*}; }
deeper! { [Q; 4], [Q; 2]; [Q; 8], [Q; 4]; [Q; 16], [Q; 8]; [Q; 32], [Q; 16]; }
macro_rules! bits_of_halves { ($v:ident, $h:ty) => {{
            if const { T::SIZE > 1 } {
                let half = $v.narrowed::<T>();
                return match T::SIZE { 2 => half.to_bits::<S, u8>(), 4 => half.to_bits::<S, u16>(), _ => half.to_bits::<S, u32>() };
            }
            let at = |i| run!(vandq_u8(part(&$v, i), WEIGHTS));
            at!(size_of::<Self>() == 32 => { let v = run!(vpaddq_u8(at(0), at(1))); let v = run!(vpaddq_u8(v, v)); part::<Q, u32>(&run!(vpaddq_u8(v, v)), 0) as u64 });
            { let v = run!(vpaddq_u8(run!(vpaddq_u8(at(0), at(1))), run!(vpaddq_u8(at(2), at(3))))); part(&run!(vpaddq_u8(v, v)), 0) }
}}; }
include!("halves.rs");
halves! {
    [Q; 2], Q, [0 1]; [Q; 4], [Q; 2], [0 1 2 3]; [Q; 8], [Q; 4], [0 1 2 3 4 5 6 7]; [Q; 16], [Q; 8], [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15];
    [Q; 32], [Q; 16], [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31];
}

#[rules]
macro_rules! f {
    ($n:ident $q:literal f16 ($($a:expr),*)) => { cast(run!([FP16] ${concat($n, $q, f16)}($(cast($a)),*))) };
    ($n:ident $q:literal $t:ident ($($a:expr),*)) => { cast(run!(${concat($n, $q, $t)}($(cast($a)),*))) }; }
/// By the size of the lanes.
macro_rules! sized { ($c:expr, $n:ident $q:literal $args:tt: $($size:literal $t:ident)*) => { $(if $c && Size::<T, $size>::IS { return f!($n $q $t $args); })* }; }
macro_rules! bits { ($n:ident $q:literal $args:tt) => { sized!(true, $n $q $args: 1 u8 2 u16 4 u32 8 u64) }; }
macro_rules! floats { ($n:ident $q:literal $args:tt) => { sized!(T::FLOAT, $n $q $args: 4 f32 8 f64) }; }
/// With half precision.
macro_rules! halfs { ($n:ident $q:literal ($($a:expr),*)) => {
    floats!($n $q ($($a),*)); sized!(T::FLOAT, $n $q ($($a),*): 2 f16);
}; }
macro_rules! ints { ($n:ident $q:literal $args:tt $(, $s:ident $u:ident)?) => {
    sized!(T::SIGNED, $n $q $args: 1 s8 2 s16 4 s32 $(8 $s)?); sized!(!T::SIGNED, $n $q $args: 1 u8 2 u16 4 u32 $(8 $u)?);
}; }
macro_rules! two { ($($name:ident($a:ident, $b:ident) { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self, $b: Self) -> Self { { let $a = self; $($body)* emulate::$name::<S, T, Self>($a, $b) } }
)*}; }
macro_rules! one { ($($name:ident($a:ident) { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self) -> Self { let $a = self; $($body)* emulate::$name::<S, T, Self>($a) }
)*}; }
#[rules]
macro_rules! prim { ($r:ident $q:literal $dup:literal $table:ident) => {
    impl Reg for $r {
        const ZERO: Self = start([0u64; 2]);
        #[inline(always)] fn planned<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(a: &<B as Class<N>>::Reg, b: &<B as Class<N>>::Reg) -> Self { Plan::<B, P, N, M, 0>::register(a, b) }
        #[inline(always)] fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self { O::on::<S, $r>(self, x) }
        #[inline(always)] fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self { O::on::<S, $r>(self, b) }
        #[inline(always)] fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self { O::on::<S, $r>(self, b, c) }
        #[inline(always)] fn splat<S: Cpu, T: E>(value: T) -> Self { $r::set::<S, T>(value) }
        #[inline(always)] fn to_bits<S: Cpu, T: E>(self) -> u64 { self.sign_bits::<S, T>() }
        #[inline(always)] fn from_bits<S: Cpu, T: E>(bits: u64) -> Self { $r::of_bits::<S, T>(bits) }
        #[inline(always)]
        fn any<S: Cpu, T: E>(self) -> bool {
            at!(size_of::<Self>() == 8 => cast::<Self, u64>(self) != 0);
            run!(vmaxvq_u32(cast(self))) != 0
        }
        #[inline(always)]
        fn all<S: Cpu, T: E>(self) -> bool {
            at!(size_of::<Self>() == 8 => cast::<Self, u64>(self) == !0);
            run!(vminvq_u32(cast(self))) == !0
        }
    }
    impl Prim for $r {
        #[inline(always)]
        fn set<S: Cpu, T: E>(value: T) -> Self { floats!(vdup $dup (value)); bits!(vdup $dup (value)); unreachable!() }
        #[inline(always)]
        fn table<S: Cpu>(self, indices: Self) -> Self { run!($table(self, indices)) }
        #[inline(always)]
        fn sign_bits<S: Cpu, T: E>(self) -> u64 {
            let weights: Self = const {
                let (mut all, mut i) = ([0u8; 16], 0);
                while i < 16 / T::SIZE { all[i * T::SIZE] = 1 << (i % 8); i += 1; }
                start(all)
            };
            let v = self.and::<S, T::Bits>(weights);
            at!(T::SIZE == 1 && size_of::<Self>() == 16 => { let v = run!(vpaddq_u8(cast(v), cast(v))); let v = run!(vpaddq_u8(v, v)); part::<Q, u16>(&run!(vpaddq_u8(v, v)), 0) as u64 });
            at!(T::SIZE == 1 => run!(vaddv_u8(cast(v))) as u64);
            at!(T::SIZE == 2 => run!(${concat(vaddv, $q, u16)}(cast(v))) as u64);
            at!(T::SIZE == 4 => run!(${concat(vaddv, $q, u32)}(cast(v))) as u64);
            at!(size_of::<Self>() == 16 => run!(vaddvq_u64(cast(v))));
            cast(v)
        }
        two! {
            add(a, b) { halfs!(vadd $q (a, b)); bits!(vadd $q (a, b)); }
            sub(a, b) { halfs!(vsub $q (a, b)); bits!(vsub $q (a, b)); }
            mul(a, b) { halfs!(vmul $q (a, b)); sized!(true, vmul $q (a, b): 1 u8 2 u16 4 u32); at!(size_of::<Self>() == 16 && S::LEVEL < SVE2 => cast(mul64(cast(a), cast(b)))); }
            div(a, b) { halfs!(vdiv $q (a, b)); }
            and(a, b) { bits!(vand $q (a, b)); }
            or(a, b) { bits!(vorr $q (a, b)); }
            xor(a, b) { bits!(veor $q (a, b)); }
            min(a, b) { if !T::FLOAT { ints!(vmin $q (a, b)); } }
            max(a, b) { if !T::FLOAT { ints!(vmax $q (a, b)); } }
            eq(a, b) { halfs!(vceq $q (a, b)); bits!(vceq $q (a, b)); }
            lt(a, b) { halfs!(vclt $q (a, b)); ints!(vclt $q (a, b), s64 u64); }
            le(a, b) { halfs!(vcle $q (a, b)); ints!(vcle $q (a, b), s64 u64); }
            saturating_add(a, b) { ints!(vqadd $q (a, b), s64 u64); }
            saturating_sub(a, b) { ints!(vqsub $q (a, b), s64 u64); }
            abs_diff(a, b) { ints!(vabd $q (a, b)); }
            average(a, b) { sized!(true, vrhadd $q (a, b): 1 u8 2 u16 4 u32); }
            shl(a, b) { let n = b.and::<S, T>(Self::set::<S, T>(T::of_bits(8 * T::SIZE as u64 - 1))); bits!(vshl $q (a, n)); }
            shr(a, b) { let n = b.and::<S, T>(Self::set::<S, T>(T::of_bits(8 * T::SIZE as u64 - 1))).neg::<S, T>(); ints!(vshl $q (a, n), s64 u64); }
        }
        #[inline(always)]
        fn shl_by<S: Cpu, T: E>(self, n: u32) -> Self { let n = Self::set::<S, T::Bits>(E::of_bits(n as u64)); bits!(vshl $q (self, n)); unreachable!() }
        #[inline(always)]
        fn shr_by<S: Cpu, T: E>(self, n: u32) -> Self {
            let n = Self::set::<S, T::Bits>(E::of_bits((n as u64).wrapping_neg()));
            ints!(vshl $q (self, n), s64 u64);
            unreachable!()
        }
        one! {
            neg(a) { floats!(vneg $q (a)); }
            abs(a) { floats!(vabs $q (a)); sized!(!T::FLOAT, vabs $q (a): 1 s8 2 s16 4 s32 8 s64); }
            swap_bytes(a) { at!(T::SIZE == 1 => a); sized!(true, vrev16 $q (a): 2 u8); sized!(true, vrev32 $q (a): 4 u8); sized!(true, vrev64 $q (a): 8 u8); }
            reverse_bits(a) { at!(true => f!(vrbit $q u8 (a.swap_bytes::<S, T>()))); }
            count_ones(a) {
                let v = run!(${concat(vcnt, $q, u8)}(a));
                at!(T::SIZE == 1 => v);
                let v = run!(${concat(vpaddl, $q, u8)}(v));
                at!(T::SIZE == 2 => cast(v));
                let v = run!(${concat(vpaddl, $q, u16)}(v));
                at!(T::SIZE == 4 => cast(v));
                at!(true => f!(vpaddl $q u32 (v)));
            }
            leading_zeros(a) {
                sized!(true, vclz $q (a): 1 u8 2 u16 4 u32);
                at!(S::LEVEL >= SVE2 && size_of::<Self>() == 16 => { use crate::sve::leading_zeros_64; cast(run!([SVE2] leading_zeros_64(Simd::of(cast(a))))) });
            }
            trailing_zeros(a) { if const { T::SIZE < 8 || S::LEVEL >= SVE2 && size_of::<Self>() == 16 } { return a.reverse_bits::<S, T>().leading_zeros::<S, T>(); } }
            sqrt(a) { halfs!(vsqrt $q (a)); }
            floor(a) { halfs!(vrndm $q (a)); }
            ceil(a) { halfs!(vrndp $q (a)); }
            trunc(a) { halfs!(vrnd $q (a)); }
            round(a) { halfs!(vrnda $q (a)); }
            round_ties_even(a) { halfs!(vrndn $q (a)); }
        }
        #[inline(always)]
        fn select<S: Cpu, T: E>(self, yes: Self, no: Self) -> Self { bits!(vbsl $q (self, yes, no)); unreachable!() }
        #[inline(always)]
        fn fma<S: Cpu, T: E>(self, b: Self, c: Self) -> Self { floats!(vfma $q (c, self, b)); unreachable!() }
    }
}; }
prim! { D "_" "_n_" vtbl1_u8 }
prim! { Q "q_" "q_n_" vqtbl1q_u8 }
/// As in x86.rs.
#[inline(always)]
pub fn only_combined(a: [u64; 2], b: [u64; 2]) -> Option<[u64; 2]> {
    Some(cast(run!(veorq_u8(run!(vqtbl1q_u8(cast([1u64, 2]), cast(a))), cast(b)))))
}
