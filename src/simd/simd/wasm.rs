//! WebAssembly, if the whole program is compiled for vectors. What counts is the code that engines make of it, for x86 and for Arm.
#![allow(unreachable_code)]
use super::{
    SimdElement as E,
    bits::{pod, start},
    convert::one_by_one as converted,
    *,
};
use core::arch::wasm32::*;
use core::hint::select_unpredictable as pick;

pub type Q = v128;
pod!(Q);
pub const fn level(_: &[&str]) -> u8 {
    1
}
macro_rules! plain {
    ($how:tt fn $f:ident<$($g:ident: $bound:ident),*> $args:tt -> $result:ty $body:block) => {
        // The inliner charges for the tests for constants.
        #[cfg_attr(bun_simd_unoptimized, inline)]
        #[cfg_attr(not(bun_simd_unoptimized), inline(always))]
        $how fn $f<$($g: $bound),*> $args -> $result { crate::hints::once(#[inline(always)] move || $body) }
    };
}
within!(1, plain);
macro_rules! registers { ($m:ident) => { $m! {
    u8: 1 16 arch::Q, 2 16 arch::Q, 4 16 arch::Q, 8 16 arch::Q, 16 16 arch::Q, 32 32 [arch::Q; 2], 64 64 [arch::Q; 4];
    u16: 1 8 arch::Q, 2 8 arch::Q, 4 8 arch::Q, 8 8 arch::Q, 16 16 [arch::Q; 2], 32 32 [arch::Q; 4], 64 64 [arch::Q; 8];
    u32: 1 4 arch::Q, 2 4 arch::Q, 4 4 arch::Q, 8 8 [arch::Q; 2], 16 16 [arch::Q; 4], 32 32 [arch::Q; 8], 64 64 [arch::Q; 16];
    u64: 1 2 arch::Q, 2 2 arch::Q, 4 4 [arch::Q; 2], 8 8 [arch::Q; 4], 16 16 [arch::Q; 8], 32 32 [arch::Q; 16], 64 64 [arch::Q; 32];
} }; }
pub(super) use registers;
macro_rules! at {
    ($c:expr => $e:expr) => {
        if const { $c } {
            return $e;
        }
    };
}
macro_rules! bits_of_halves {
    ($v:ident, $h:ty) => {{
        let [a, b]: [$h; 2] = cast($v);
        a.to_bits::<S, T>() | b.to_bits::<S, T>() << const { size_of::<$h>() / T::SIZE % 64 }
    }};
}
include!("halves.rs");
halves! {
    [Q; 2], Q, [0 1]; [Q; 4], [Q; 2], [0 1 2 3]; [Q; 8], [Q; 4], [0 1 2 3 4 5 6 7]; [Q; 16], [Q; 8], [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15];
    [Q; 32], [Q; 16], [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31];
}

/// The same value, which LLVM only sees when it selects instructions. So a constant moves out of loops, in which V8 would make it in each round.
#[inline(always)]
fn late(v: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    i32x4_replace_lane::<0>(v, i32x4_extract_lane::<0>(v) ^ (i64x2_bitmask(Q::ZERO) >> 2) as i32)
}
/// The same, but it stays with `other`, and is seen at once if that is a constant.
#[inline(always)]
fn beside(v: Q, other: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    i32x4_replace_lane::<0>(v, i32x4_extract_lane::<0>(v) ^ nothing(other))
}
#[inline(always)]
fn nothing(other: Q) -> i32 {
    ((i64x2_bitmask(other) >> 2) as i32).wrapping_mul(zero(other))
}
/// Zero, which LLVM only sees for constants.
#[inline(always)]
fn zero(v: Q) -> i32 {
    i32x4_extract_lane::<0>(i8x16_swizzle(Q::ZERO, v))
}
#[inline(always)]
pub fn is_known(v: Q) -> bool {
    crate::hints::combined(zero(v) as u32)
}
#[inline(always)]
fn unless_known(v: Q, other: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    pick(is_known(other), v, late(v))
}
/// Whether it has a bit.
#[inline(always)]
pub fn has_bits(v: Q) -> bool {
    v128_any_true(if PSEUDO { v } else { unless_known(v, v) })
}
/// `late`, if `v` is a constant and `other` isn't. Zero and all ones are cheap.
#[inline(always)]
pub fn hoisted(v: Q, other: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    pick(is_known(v) & !is_known(other) & v128_any_true(v) & v128_any_true(v128_not(v)), late(v), v)
}
/// The same value. Until then, LLVM knows nothing of it, unless it is a constant.
#[inline(always)]
pub fn opaque(v: Q) -> Q {
    at!(!crate::OPTIMIZED && PSEUDO => v);
    v128_or(v, i32x4_splat(nothing(v)))
}
/// LLVM would compare lanes before they are widened, and widen the results one by one.
#[inline(always)]
fn wide<T: E>(v: Q) -> Q {
    if T::SIZE > 1 { opaque(v) } else { v }
}
/// The same value, by an instruction that reads all lanes.
#[inline(always)]
fn whole(v: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    pick(is_known(v), v, u8x16_avgr(v, v))
}
/// For widening products. LLVM would widen a constant by itself, and before a loop what doesn't change in it.
#[inline(always)]
pub fn factor(v: Q, other: Q) -> Q {
    at!(!crate::OPTIMIZED => v);
    v128_or(pick(is_known(v) & !is_known(other), u8x16_avgr(v, v), v), beside(Q::ZERO, other))
}
#[inline(always)]
pub fn dot(a: Q, b: Q) -> Q {
    i32x4_dot_i16x8(hoisted(a, b), pick(is_known(b), late(b), b))
}
#[inline(always)]
fn is_zero(v: Q) -> bool {
    is_known(v) & !v128_any_true(v)
}
/// Two to the power of each lane, or of its complement.
#[inline(always)]
fn powers<T: E>(n: Q, down: bool) -> Q {
    let (first, steps) = const {
        let (mut first, mut steps, mut i) = ([0u8; 16], [0u8; 16], 0);
        while i < 16 {
            (first[i], steps[i]) = ((i - i % T::SIZE) as u8, (i % T::SIZE * 8) as u8);
            i += 1;
        }
        (cast(first), cast(steps))
    };
    let most = unless_known(u8x16_splat(8 * T::SIZE as u8 - 1), n);
    let mut at = if down { v128_andnot(most, n) } else { v128_and(most, n) };
    if const { T::SIZE > 1 } {
        at = v128_xor(looked_up(at, first), unless_known(steps, n));
    }
    i8x16_swizzle(unless_known(u64x2(0x8040_2010_0804_0201, 0), n), at)
}
/// LLVM would make a shuffle of it if the indices are constants.
#[inline(always)]
pub fn looked_up(table: Q, indices: Q) -> Q {
    i8x16_swizzle(table, unless_known(indices, table))
}

/// The operands for that, if they may be constants. Moves of four bytes are good shuffles, also from two tables.
#[inline(always)]
pub fn table(table: Q, indices: Q, many: bool) -> (Q, Q) {
    at!(!crate::OPTIMIZED => (table, indices));
    let words =
        v128_or(i32x4_mul(v128_and(indices, u32x4_splat(12)), u32x4_splat(0x0101_0101)), u32x4_splat(0x0302_0100));
    let none = i32x4_eq(u8x16_ge(indices, u8x16_splat(16)), i32x4_splat(-1));
    let words = i32x4_eq(indices, words);
    let good = if many { i32x4_all_true(words) | i32x4_all_true(none) } else { i32x4_all_true(v128_or(words, none)) };
    let hide = is_known(indices) & !is_known(table) & !good;
    // On x86, V8 then takes the constant as it is.
    (hoisted(table, indices), pick(hide, late(v128_or(indices, u8x16_ge(indices, u8x16_splat(16)))), indices))
}

#[rules]
macro_rules! sized { ($c:expr, $n:ident $args:tt: $($size:literal $t:ident)*) => { $(at!($c && T::SIZE == $size => ${concat($t, "_", $n)} $args);)* }; }
macro_rules! floats { ($n:ident $args:tt) => { sized!(T::FLOAT, $n $args: 4 f32x4 8 f64x2) }; }
macro_rules! bits { ($n:ident $args:tt) => { sized!(!T::FLOAT, $n $args: 1 i8x16 2 i16x8 4 i32x4 8 i64x2) }; }
macro_rules! ints { ($n:ident $args:tt: $($size:literal $i:ident $u:ident)*) => { sized!(!T::FLOAT && T::SIGNED, $n $args: $($size $i)*); sized!(!T::SIGNED, $n $args: $($size $u)*); }; }
macro_rules! two { ($($name:ident($a:ident, $b:ident) { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self, $b: Self) -> Self { let $a = self; $($body)* emulate::$name::<S, T, Self>($a, $b) }
)*}; }
macro_rules! one { ($($name:ident($a:ident) { $($body:tt)* })*) => {$(
    #[inline(always)] fn $name<S: Cpu, T: E>(self) -> Self { let $a = self; $($body)* emulate::$name::<S, T, Self>($a) }
)*}; }
const PSEUDO: bool = cfg!(miri);
/// The same value.
#[inline(always)]
fn float(v: Q) -> Q {
    if PSEUDO { v } else { i16x8_add(v, i16x8_splat(nothing(v) as i16)) }
}
/// The same value, in another way.
#[inline(always)]
fn side(v: Q) -> Q {
    i16x8_sub(v, i16x8_splat(nothing(v) as i16))
}
/// The same number.
#[inline(always)]
fn count(n: u32, v: Q) -> u32 {
    if PSEUDO { n } else { n ^ nothing(v) as u32 }
}
/// Shifts lanes of `u16` to the right.
#[inline(always)]
fn down16(v: Q, n: u32) -> Q {
    let it = u16x8_shr(v, count(n, v));
    at!(!crate::OPTIMIZED => it);
    pick(is_known(u32x4_splat(n)), v128_and(it, u16x8_splat(!0 >> (n % 16))), it)
}
impl Reg for Q {
    const ZERO: Self = cast([0u64; 2]);
    #[inline(always)]
    fn planned<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(
        a: &<B as Class<N>>::Reg,
        b: &<B as Class<N>>::Reg,
    ) -> Self {
        Plan::<B, P, N, M, 0>::register(a, b)
    }
    #[inline(always)]
    fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self {
        O::on::<S, Q>(self, x)
    }
    #[inline(always)]
    fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self {
        O::on::<S, Q>(self, b)
    }
    #[inline(always)]
    fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self {
        O::on::<S, Q>(self, b, c)
    }
    #[inline(always)]
    fn splat<S: Cpu, T: E>(value: T) -> Self {
        Q::set::<S, T>(value)
    }
    #[inline(always)]
    fn to_bits<S: Cpu, T: E>(self) -> u64 {
        self.sign_bits::<S, T>()
    }
    #[inline(always)]
    fn from_bits<S: Cpu, T: E>(bits: u64) -> Self {
        Q::of_bits::<S, T>(bits)
    }
    #[inline(always)]
    fn any<S: Cpu, T: E>(self) -> bool {
        v128_any_true(self)
    }
    #[inline(always)]
    fn all<S: Cpu, T: E>(self) -> bool {
        bits!(all_true(self));
        unreachable!()
    }
}
impl Prim for Q {
    #[inline(always)]
    fn set<S: Cpu, T: E>(value: T) -> Self {
        floats!(splat(cast(value)));
        sized!(true, splat(cast(value)): 1 i8x16 2 i16x8 4 i32x4 8 i64x2);
        unreachable!()
    }
    #[inline(always)]
    fn table<S: Cpu>(self, indices: Self) -> Self {
        looked_up(self, indices)
    }
    #[inline(always)]
    fn sign_bits<S: Cpu, T: E>(self) -> u64 {
        match T::SIZE {
            1 => i8x16_bitmask(self) as u64,
            2 => i16x8_bitmask(self) as u64,
            4 => i32x4_bitmask(self) as u64,
            _ => i64x2_bitmask(self) as u64,
        }
    }
    two! {
        // LLVM would shift to double.
        add(a, b) { floats!(add(a, b)); at!(T::SIZE == 1 => i8x16_add(a, opaque(b))); bits!(add(a, b)); }
        sub(a, b) { floats!(sub(a, b)); bits!(sub(a, b)); }
        mul(a, b) {
            floats!(mul(a, b));
            at!(T::SIZE == 2 && !cfg!(miri) => {
                let (v, more) = (i16x8_mul(a, b), |v| v128_xor(v, i16x8_shr(i16x8_shl(v, 8), 8)));
                at!(!crate::OPTIMIZED => u8x16_avgr(v, v));
                pick(is_zero(v128_or(more(a), more(b))), whole(v), v)
            });
            sized!(!T::FLOAT, mul(a, b): 2 i16x8 4 i32x4 8 i64x2);
            let even = unless_known(u16x8_splat(255), i16x8_mul(a, b));
            return v128_or(v128_and(i16x8_mul(a, b), even), i16x8_mul(u16x8_shr(a, 8), v128_andnot(b, even)));
        }
        div(a, b) { floats!(div(a, b)); }
        and(a, b) { return v128_and(a, b); }
        or(a, b) { return v128_or(a, b); }
        xor(a, b) { return v128_xor(a, b); }
        min(a, b) { if const { PSEUDO || crate::OPTIMIZED } { floats!(pmin(float(b), float(a))); } ints!(min(a, b): 1 i8x16 u8x16 2 i16x8 u16x8 4 i32x4 u32x4); }
        max(a, b) { if const { PSEUDO || crate::OPTIMIZED } { floats!(pmax(float(b), float(a))); } ints!(max(a, b): 1 i8x16 u8x16 2 i16x8 u16x8 4 i32x4 u32x4); }
        eq(a, b) { floats!(eq(a, b)); let b = wide::<T>(b); bits!(eq(a, b)); }
        ne(a, b) { floats!(ne(a, b)); let b = wide::<T>(b); bits!(ne(a, b)); }
        lt(a, b) { at!(T::FLOAT && !PSEUDO => opaque(if T::SIZE == 4 { f32x4_gt(side(b), side(a)) } else { f64x2_gt(side(b), side(a)) })); floats!(lt(a, b)); let b = wide::<T>(b); ints!(lt(a, b): 1 i8x16 u8x16 2 i16x8 u16x8 4 i32x4 u32x4); sized!(T::SIGNED, lt(a, b): 8 i64x2);
            let top = unless_known(i64x2_splat(i64::MIN), v128_xor(a, b));
            return i64x2_lt(v128_xor(a, top), v128_xor(b, top));
        }
        le(a, b) { at!(T::FLOAT && !PSEUDO => opaque(if T::SIZE == 4 { f32x4_ge(side(b), side(a)) } else { f64x2_ge(side(b), side(a)) })); floats!(le(a, b)); let b = wide::<T>(b); ints!(le(a, b): 1 i8x16 u8x16 2 i16x8 u16x8 4 i32x4 u32x4); sized!(T::SIGNED, le(a, b): 8 i64x2); }
        saturating_add(a, b) { ints!(add_sat(a, b): 1 i8x16 u8x16 2 i16x8 u16x8); }
        saturating_sub(a, b) { ints!(sub_sat(a, b): 1 i8x16 u8x16 2 i16x8 u16x8); }
        average(a, b) { sized!(!T::SIGNED, avgr(a, b): 1 u8x16 2 u16x8); }
        abs_diff(a, b) {
            at!(!T::SIGNED && T::SIZE == 1 => v128_or(u8x16_sub_sat(a, b), u8x16_sub_sat(b, a)));
        }
        shl(a, b) {
            at!(T::SIZE == 8 => emulate::lanes::shl::<S, T, Self>(a, b));
            return a.mul::<S, T>(hoisted(powers::<T>(b, false), a));
        }
        shr(a, b) {
            at!(T::SIZE == 8 => emulate::lanes::shr::<S, T, Self>(a, b));
            let (sign, by) = (if T::SIGNED { a.negative::<S, T>() } else { Q::ZERO }, powers::<T>(b, true));
            let a = v128_xor(a, sign);
            let by = if T::SIZE == 1 { hoisted(by, a) } else { factor(by, a) };
            return v128_xor(sign, match T::SIZE {
                1 => {
                    let even = unless_known(u16x8_splat(255), a);
                    let odd = i16x8_mul(u16x8_shr(a, 8), u16x8_shr(by, 8));
                    v128_or(u16x8_shr(i16x8_mul(v128_and(a, even), v128_and(by, even)), 7), v128_andnot(i16x8_add(odd, odd), even))
                }
                2 => u16x8_narrow_i32x4(u32x4_shr(u32x4_extmul_low_u16x8(a, by), 15), u32x4_shr(u32x4_extmul_high_u16x8(a, by), 15)),
                _ => i32x4_shuffle::<0, 2, 4, 6>(u64x2_shr(u64x2_extmul_low_u32x4(a, by), 31), u64x2_shr(u64x2_extmul_high_u32x4(a, by), 31)),
            });
        }
    }
    #[inline(always)]
    fn shl_by<S: Cpu, T: E>(self, n: u32) -> Self {
        // x86 has no shifts of bytes.
        at!(T::SIZE == 1 && crate::OPTIMIZED => {
            let by_words = v128_and(i16x8_shl(self, n), hoisted(u8x16_splat(255 << n), self));
            pick(is_zero(u32x4_splat(n ^ 1)), i8x16_add(self, opaque(self)), by_words)
        });
        bits!(shl(self, n));
        unreachable!()
    }
    #[inline(always)]
    fn shr_by<S: Cpu, T: E>(self, n: u32) -> Self {
        at!(T::SIZE == 1 && !T::SIGNED && crate::OPTIMIZED => v128_and(u16x8_shr(self, count(n, self)), hoisted(u8x16_splat(255 >> n), self)));
        at!(T::SIZE == 2 && !PSEUDO => if T::SIGNED { i16x8_shr(self, count(n, self)) } else { down16(self, n) });
        at!(T::SIGNED && matches!(T::SIZE, 1 | 8) && crate::OPTIMIZED => {
            let shifted = if T::SIZE == 1 { i8x16_shr(self, count(n, self)) } else { i64x2_shr(self, n) };
            pick(is_zero(u32x4_splat(n ^ (8 * T::SIZE as u32 - 1))), self.negative::<S, T>(), shifted)
        });
        let n = if T::SIZE == 1 { count(n, self) } else { n };
        ints!(shr(self, n): 1 i8x16 u8x16 2 i16x8 u16x8 4 i32x4 u32x4 8 i64x2 u64x2);
        unreachable!()
    }
    one! {
        not(a) { return v128_not(a); }
        neg(a) { floats!(neg(a)); }
        // LLVM would shift, which x86 can't.
        negative(a) { at!(matches!(T::SIZE, 1 | 8) => {
                let less = |zero| if T::SIZE == 1 { i8x16_lt(a, zero) } else { i64x2_lt(a, zero) };
                // It may know that all bits of a lane are equal.
                less(beside(Q::ZERO, v128_xor(a, less(Q::ZERO))))
            }); }
        abs(a) { floats!(abs(a)); bits!(abs(a)); }
        swap_bytes(a) { return a.table::<S>(const { let (mut at, mut i) = ([0u8; 16], 0); while i < 16 { at[i] = (i ^ (T::SIZE - 1)) as u8; i += 1; } cast(at) }); }
        count_ones(a) {
            let v = i8x16_popcnt(a);
            at!(T::SIZE == 1 => v);
            let v = u16x8_extadd_pairwise_u8x16(v);
            at!(T::SIZE == 2 => v);
            let v = i32x4_extadd_pairwise_i16x8(v);
            at!(T::SIZE == 4 => v);
            return u64x2_shr(i32x4_add(v, i64x2_shl(v, 32)), 32);
        }
        reverse_bits(a) {
            let (v, low) = (a.swap_bytes::<S, T>(), unless_known(u8x16_splat(15), a));
            let table = u64x2(0x0e06_0a02_0c04_0800, 0x0f07_0b03_0d05_0901);
            let upper = i8x16_swizzle(unless_known(i16x8_shl(table, 4), a), v128_and(v, low));
            return v128_or(upper, i8x16_swizzle(unless_known(table, a), v128_and(u16x8_shr(v, 4), low)));
        }
        sqrt(a) { floats!(sqrt(a)); }
        floor(a) { floats!(floor(a)); }
        ceil(a) { floats!(ceil(a)); }
        trunc(a) { floats!(trunc(a)); }
        round_ties_even(a) { floats!(nearest(a)); }
    }
    #[inline(always)]
    fn select<S: Cpu, T: E>(self, yes: Self, no: Self) -> Self {
        at!(!crate::OPTIMIZED => v128_bitselect(yes, no, self));
        // LLVM sees through this. What it makes of booleans is often done lane by lane.
        let plain = v128_or(v128_and(yes, self), v128_andnot(no, self));
        at!(T::FLOAT && PSEUDO => plain);
        let (a, b, mask) = (hoisted(yes, self), hoisted(no, self), hoisted(self, yes));
        let it = cfg_select! {
            target_feature = "relaxed-simd" => i8x16_relaxed_laneselect(a, b, mask),
            _ => v128_bitselect(a, b, mask),
        };
        let it = pick(is_zero(no), v128_and(a, opaque(self)), pick(is_zero(yes), v128_andnot(b, opaque(self)), it));
        let it = if const { T::FLOAT && T::SIZE >= 4 && crate::OPTIMIZED && !PSEUDO } {
            let (less, more) = (v128_xor(self, yes.lt::<S, T>(no)), v128_xor(self, no.lt::<S, T>(yes)));
            pick(is_zero(less), yes.min::<S, T>(no), pick(is_zero(more), yes.max::<S, T>(no), it))
        } else {
            it
        };
        // Moves of four bytes are good shuffles.
        pick(is_known(self) & (is_known(yes) | i32x4_all_true(i32x4_eq(self, i32x4_shr(self, 31)))), plain, it)
    }
}
include!("wasm_more.rs");
impl<T: Fits<N, Bits: Class<N, Reg = Q>>, const N: usize> From<Simd<T, N>> for Q {
    #[inline(always)]
    fn from(v: Simd<T, N>) -> Q {
        v.0
    }
}
impl<T: Fits<N, Bits: Class<N, Reg = Q>>, const N: usize> From<Q> for Simd<T, N> {
    #[inline(always)]
    fn from(v: Q) -> Self {
        Self::of(v)
    }
}
/// As in x86.rs.
#[inline(always)]
pub fn only_combined(a: [u64; 2], b: [u64; 2]) -> Option<[u64; 2]> {
    Some(cast(v128_xor(i8x16_swizzle(cast([1u64, 2]), cast(a)), cast(b))))
}
