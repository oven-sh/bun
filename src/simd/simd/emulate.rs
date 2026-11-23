//! What a target has no instruction for, by way of other operations, or lane by lane.
use super::{Cpu, Prim, SimdElement as E, bits::start, part, set_part};

macro_rules! by_lanes { ($($name:ident($($a:ident),*))*) => {$(
    #[inline(always)]
    pub fn $name<S: Cpu, T: E, R: Prim>(mut v: R $(, $a: R)*) -> R {
        for i in 0..size_of::<R>() / size_of::<T>() {
            let lane = T::$name(part(&v, i) $(, part(&$a, i))*);
            set_part(&mut v, i, lane);
        }
        v
    }
)*}; }
by_lanes! { add(b) sub(b) mul(b) div(b) sqrt() floor() ceil() trunc() round() round_ties_even() fma(b, c) }
pub mod lanes {
    use super::*;
    by_lanes! { shl(b) shr(b) }
}
macro_rules! tests { ($($name:ident $op:tt)*) => {$(
    #[inline(always)]
    pub fn $name<S: Cpu, T: E, R: Prim>(mut v: R, b: R) -> R {
        for i in 0..size_of::<R>() / size_of::<T>() {
            let lane = T::told(part::<R, T>(&v, i).apart() $op part(&b, i));
            set_part(&mut v, i, lane);
        }
        v
    }
)*}; }
tests! { eq == }
macro_rules! logic { ($($name:ident $op:tt)*) => {$(
    #[inline(always)]
    pub fn $name<S: Cpu, T: E, R: Prim>(mut v: R, b: R) -> R {
        for i in 0..size_of::<R>() / size_of::<T>() {
            let lane = T::Bits::of_bits(part::<R, T::Bits>(&v, i).bits() $op part::<R, T::Bits>(&b, i).bits());
            set_part(&mut v, i, lane);
        }
        v
    }
)*}; }
logic! { and & or | xor ^ }

#[inline(always)]
fn of<S: Cpu, T: E, R: Prim>(bits: u64) -> R {
    R::set::<S, T::Bits>(T::Bits::of_bits(bits))
}
#[inline(always)]
fn top<S: Cpu, T: E, R: Prim>() -> R {
    of::<S, T, R>(1 << (8 * T::SIZE - 1))
}

macro_rules! emulate { ($($name:ident($($a:ident: $t:ty),*) $body:block)*) => {$(
    #[inline(always)] pub fn $name<S: Cpu, T: E, R: Prim>($($a: $t),*) -> R $body
)*}; }
emulate! {
    not(a: R) { a.xor::<S, T>(of::<S, T, R>(!0)) }
    and_not(a: R, b: R) { a.not::<S, T>().and::<S, T>(b) }
    neg(a: R) { if T::FLOAT { a.xor::<S, T::Bits>(top::<S, T, R>()) } else { R::ZERO.sub::<S, T>(a) } }
    abs(a: R) { if T::FLOAT { a.and::<S, T::Bits>(of::<S, T, R>(!(1 << (8 * T::SIZE - 1)))) } else { a.negative::<S, T>().select::<S, T>(a.neg::<S, T>(), a) } }
    negative(a: R) { a.lt::<S, T::Mask>(R::ZERO) }
    unordered(a: R, b: R) { a.ne::<S, T>(a).or::<S, T::Bits>(b.ne::<S, T>(b)) }
    ne(a: R, b: R) { a.eq::<S, T>(b).not::<S, T::Bits>() }
    // Of unsigned lanes, from those of signed ones.
    lt(a: R, b: R) {
        if const { T::SIGNED } { unreachable!() }
        a.xor::<S, T>(top::<S, T, R>()).lt::<S, T::Mask>(b.xor::<S, T>(top::<S, T, R>()))
    }
    le(a: R, b: R) { b.lt::<S, T>(a).not::<S, T>() }
    select(m: R, yes: R, no: R) { m.and::<S, T::Bits>(yes).or::<S, T::Bits>(m.and_not::<S, T::Bits>(no)) }
    min(a: R, b: R) { a.lt::<S, T>(b).select::<S, T>(a, b) }
    max(a: R, b: R) { b.lt::<S, T>(a).select::<S, T>(a, b) }
    abs_diff(a: R, b: R) { a.max::<S, T>(b).sub::<S, T>(a.min::<S, T>(b)) }
    average(a: R, b: R) { a.or::<S, T>(b).sub::<S, T>(a.xor::<S, T>(b).shr_by::<S, T>(1)) }
    saturating_add(a: R, b: R) {
        if const { !T::SIGNED } { return a.min::<S, T>(b.not::<S, T>()).add::<S, T>(b); }
        let sum = a.add::<S, T>(b);
        let over = sum.lt::<S, T>(a).xor::<S, T>(b.negative::<S, T>());
        over.select::<S, T>(sum.shr_by::<S, T>(8 * T::SIZE as u32 - 1).xor::<S, T>(top::<S, T, R>()), sum)
    }
    saturating_sub(a: R, b: R) {
        if const { !T::SIGNED } { return a.max::<S, T>(b).sub::<S, T>(b); }
        let sum = a.sub::<S, T>(b);
        let over = a.xor::<S, T>(b).and::<S, T>(a.xor::<S, T>(sum)).negative::<S, T>();
        over.select::<S, T>(sum.negative::<S, T>().xor::<S, T>(top::<S, T, R>()), sum)
    }
    // Of bytes.
    shl_by(a: R, n: u32) { a.shl_by::<S, u16>(n).and::<S, u8>(R::set::<S, u8>(0xff << n)) }
    // Of bytes, or signed lanes.
    shr_by(a: R, n: u32) {
        if const { T::SIGNED } {
            let sign = of::<S, T, R>(1 << (8 * T::SIZE - 1) >> n);
            return a.shr_by::<S, T::Bits>(n).xor::<S, T>(sign).sub::<S, T>(sign);
        }
        a.shr_by::<S, u16>(n).and::<S, u8>(R::set::<S, u8>(0xff >> n))
    }
    shl(a: R, by: R) { steps::<S, T, R, true>(a, by) }
    shr(a: R, by: R) { steps::<S, T, R, false>(a, by) }
    swap_bytes(a: R) {
        let mut v = a;
        if const { T::SIZE > 1 } { v = v.shl_by::<S, u16>(8).or::<S, u16>(v.shr_by::<S, u16>(8)); }
        if const { T::SIZE > 2 } { v = v.shl_by::<S, u32>(16).or::<S, u32>(v.shr_by::<S, u32>(16)); }
        if const { T::SIZE > 4 } { v = v.shl_by::<S, u64>(32).or::<S, u64>(v.shr_by::<S, u64>(32)); }
        v
    }
    reverse_bits(a: R) {
        let mut v = a.swap_bytes::<S, T>();
        macro_rules! swap { ($($n:literal $mask:literal)*) => {$(
            let mask = R::set::<S, u8>($mask);
            v = v.and::<S, u8>(mask).shl_by::<S, u16>($n).or::<S, u8>(v.shr_by::<S, u16>($n).and::<S, u8>(mask));
        )*}; }
        swap!(4 0x0f 2 0x33 1 0x55);
        v
    }
    count_ones(a: R) {
        let v = a.sub::<S, u8>(a.shr_by::<S, u16>(1).and::<S, u8>(R::set::<S, u8>(0x55)));
        let v = v.and::<S, u8>(R::set::<S, u8>(0x33)).add::<S, u8>(v.shr_by::<S, u16>(2).and::<S, u8>(R::set::<S, u8>(0x33)));
        sums::<S, T, R>(v.add::<S, u8>(v.shr_by::<S, u16>(4)).and::<S, u8>(R::set::<S, u8>(0x0f)))
    }
    // Of the bytes of each lane, which are at most 8.
    sums(a: R) {
        let mut v = a;
        if const { T::SIZE > 1 } { v = v.add::<S, u16>(v.shr_by::<S, u16>(8)); }
        if const { T::SIZE > 2 } { v = v.add::<S, u32>(v.shr_by::<S, u32>(16)); }
        if const { T::SIZE > 4 } { v = v.add::<S, u64>(v.shr_by::<S, u64>(32)); }
        if const { T::SIZE > 1 } { v = v.and::<S, T>(of::<S, T, R>(0xff)); }
        v
    }
    leading_zeros(a: R) {
        let mut v = a.or::<S, T>(a.shr_by::<S, T::Bits>(1));
        v = v.or::<S, T>(v.shr_by::<S, T::Bits>(2));
        v = v.or::<S, T>(v.shr_by::<S, T::Bits>(4));
        if const { T::SIZE > 1 } { v = v.or::<S, T>(v.shr_by::<S, T::Bits>(8)); }
        if const { T::SIZE > 2 } { v = v.or::<S, T>(v.shr_by::<S, T::Bits>(16)); }
        if const { T::SIZE > 4 } { v = v.or::<S, T>(v.shr_by::<S, T::Bits>(32)); }
        v.not::<S, T>().count_ones::<S, T>()
    }
    trailing_zeros(a: R) { a.and_not::<S, T>(a.sub::<S, T>(of::<S, T, R>(1))).count_ones::<S, T>() }
    // For little-endian targets.
    of_bits(bits: u64) {
        let each: R = const {
            let (mut all, mut i) = ([0u8; 64], 0);
            while i < size_of::<R>() / T::SIZE {
                let bit = i % (8 * T::SIZE);
                all[i * T::SIZE + bit / 8] = 1 << (bit % 8);
                i += 1;
            }
            start(all)
        };
        let all = if const { T::SIZE == 1 } {
            let from: R = const { let (mut all, mut i) = ([0u8; 64], 0); while i < 64 { all[i] = i as u8 / 8; i += 1; } start(all) };
            R::set::<S, u64>(bits).table::<S>(from)
        } else { of::<S, T, R>(bits) };
        all.and::<S, T::Bits>(each).eq::<S, T::Bits>(each)
    }
}
/// For lanes of up to 16 bits.
#[inline(always)]
fn steps<S: Cpu, T: E, R: Prim, const LEFT: bool>(mut a: R, by: R) -> R {
    macro_rules! step { ($($k:literal)*) => {$(
        if const { 1 << $k < 8 * T::SIZE } {
            let moved = if LEFT { a.shl_by::<S, T>(1 << $k) } else { a.shr_by::<S, T>(1 << $k) };
            let bit = if const { T::SIZE == 1 } { by.shl_by::<S, u16>(7 - $k) } else { by.shl_by::<S, T>(8 * T::SIZE as u32 - 1 - $k) };
            a = bit.negative::<S, T>().select::<S, T>(moved, a);
        }
    )*}; }
    step!(3 2 1 0);
    a
}
macro_rules! in_pairs { ($($name:ident<$w:ident, $i:ident>($a:ident, $even:ident, $odd:ident, $low:ident, $half:ident) $body:block)*) => {$(
    /// In lanes of twice the size. The counts are less than the bits of a lane.
    #[inline(always)]
    pub fn $name<S: Cpu, T: E, R: Prim>(a: R, n: R) -> R {
        #[inline(always)]
        fn of<S: Cpu, T: E, R: Prim, $w: E, $i: E>($a: R, n: R) -> R {
            let $half = 8 * T::SIZE as u32;
            let $low = R::set::<S, $w>($w::of_bits(!(!0 << $half)));
            let ($even, $odd) = (n.and::<S, $w>($low), n.shr_by::<S, $w>($half));
            $body
        }
        if const { T::SIZE == 1 } { of::<S, T, R, u16, i16>(a, n) } else { of::<S, T, R, u32, i32>(a, n) }
    }
)*}; }
in_pairs! {
    shl_in_pairs<W, I>(a, even, odd, low, half) { a.shl::<S, W>(even).and::<S, W>(low).or::<S, W>(low.and_not::<S, W>(a).shl::<S, W>(odd)) }
    shr_in_pairs<W, I>(a, even, odd, low, half) {
        if T::SIGNED { return a.shl_by::<S, W>(half).shr::<S, I>(even).shr_by::<S, W>(half).or::<S, W>(low.and_not::<S, W>(a.shr::<S, I>(odd))); }
        a.and::<S, W>(low).shr::<S, W>(even).or::<S, W>(low.and_not::<S, W>(a.shr::<S, W>(odd)))
    }
}
