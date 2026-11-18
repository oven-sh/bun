//! The lanes of a vector. Lane 0 is in the low bits. A scalar is bits, extended with zeros.

use crate::operand::{Sign, Size};

/// An index of [`shuffle`] that gives a zero byte. So does any other from 32 up.
pub const ZERO: u8 = 0x80;

pub const fn count(lanes: Size) -> u8 {
    16 >> lanes.log2_bytes()
}

const fn all_ones(lanes: Size) -> u128 {
    u128::MAX >> (128 - lanes.bits())
}

/// Reads the low bits of `value`.
pub const fn splat(lanes: Size, value: u64) -> u128 {
    (value as u128 & all_ones(lanes)) * (u128::MAX / all_ones(lanes))
}

/// Lanes of 8 and 16 bits are extended to 32.
pub const fn extract(lanes: Size, sign: Sign, vector: u128, lane: u8) -> u64 {
    assert!(lane < count(lanes));
    let bits = vector >> (lane * lanes.bits());
    match (lanes, sign) {
        (Size::S8, Sign::Signed) => bits as i8 as u32 as u64,
        (Size::S16, Sign::Signed) => bits as i16 as u32 as u64,
        _ => (bits & all_ones(lanes)) as u64,
    }
}

/// Reads the low bits of `value`.
pub const fn replace(lanes: Size, vector: u128, lane: u8, value: u64) -> u128 {
    assert!(lane < count(lanes));
    let place = all_ones(lanes) << (lane * lanes.bits());
    vector & !place | splat(lanes, value) & place
}

/// Doubles the size of each lane.
pub fn extend(from: Size, sign: Sign, bits: u64) -> u128 {
    let bits = bits.into();
    match (from, sign) {
        (Size::S8, Sign::Signed) => widen::<i8, i16>(bits, Half::Low),
        (Size::S8, Sign::Unsigned) => widen::<u8, u16>(bits, Half::Low),
        (Size::S16, Sign::Signed) => widen::<i16, i32>(bits, Half::Low),
        (Size::S16, Sign::Unsigned) => widen::<u16, u32>(bits, Half::Low),
        (Size::S32, Sign::Signed) => widen::<i32, i64>(bits, Half::Low),
        (Size::S32, Sign::Unsigned) => widen::<u32, u64>(bits, Half::Low),
        (Size::S64, _) => unreachable!("no lane is larger"),
    }
}

/// Byte `i` of the result is byte `lanes[i]` of the 32 bytes of `lhs` and `rhs`, or zero if there is none.
pub fn shuffle(lhs: u128, rhs: u128, lanes: [u8; 16]) -> u128 {
    build(|i| match usize::from(lanes[i]) {
        index @ 0..16 => u8::get(lhs, index),
        index @ 16..32 => u8::get(rhs, index - 16),
        _ => 0,
    })
}

pub(super) trait Lane: Copy {
    const COUNT: usize = 16 / size_of::<Self>();

    fn get(vector: u128, index: usize) -> Self;
    fn put(self, vector: &mut [u8; 16], index: usize);
}

macro_rules! lanes {
    ($($type:ty),* => |$value:ident| $written:expr) => {
        $(impl Lane for $type {
            #[inline(always)]
            fn get(vector: u128, index: usize) -> Self {
                Self::from_le_bytes(vector.to_le_bytes().as_chunks().0[index])
            }

            #[inline(always)]
            fn put(self, vector: &mut [u8; 16], index: usize) {
                let $value = self;
                vector.as_chunks_mut().0[index] = $written.to_le_bytes();
            }
        })*
    };
}

lanes!(i8, u8, i16, u16, i32, u32, i64, u64 => |value| value);
// A NaN is written as the positive canonical one.
lanes!(f32 => |value| if value.is_nan() { 0x7fc0_0000 } else { value.to_bits() });
lanes!(f64 => |value| if value.is_nan() { 0x7ff8_0000_0000_0000 } else { value.to_bits() });

#[derive(Clone, Copy)]
pub(super) enum Half {
    Low,
    High,
}

/// The first `count` lanes, and zeros.
#[inline(always)]
pub(super) fn build_low<T: Lane>(count: usize, lane: impl Fn(usize) -> T) -> u128 {
    let mut vector = [0; 16];
    for index in 0..count {
        lane(index).put(&mut vector, index);
    }
    u128::from_le_bytes(vector)
}

#[inline(always)]
pub(super) fn build<T: Lane>(lane: impl Fn(usize) -> T) -> u128 {
    build_low(T::COUNT, lane)
}

/// As many lanes as both types have, and zeros.
#[inline(always)]
pub(super) fn map<T: Lane, U: Lane>(a: u128, f: impl Fn(T) -> U) -> u128 {
    build_low(T::COUNT.min(U::COUNT), |i| f(T::get(a, i)))
}

#[inline(always)]
pub(super) fn zip<T: Lane>(a: u128, b: u128, f: impl Fn(T, T) -> T) -> u128 {
    build(|i| f(T::get(a, i), T::get(b, i)))
}

#[inline(always)]
pub(super) fn zip3<T: Lane>(a: u128, b: u128, c: u128, f: impl Fn(T, T, T) -> T) -> u128 {
    build(|i| f(T::get(a, i), T::get(b, i), T::get(c, i)))
}

/// Lanes are all ones where `holds`.
#[inline(always)]
pub(super) fn compare<T: Lane>(a: u128, b: u128, holds: impl Fn(&T, &T) -> bool) -> u128 {
    build(|byte| {
        let i = byte / size_of::<T>();
        -i8::from(holds(&T::get(a, i), &T::get(b, i)))
    })
}

#[inline(always)]
pub(super) fn widen<T: Lane, U: Lane + From<T>>(a: u128, half: Half) -> u128 {
    build(|i| U::from(T::get(a, half as usize * U::COUNT + i)))
}

/// The lanes of `a` and then those of `b`.
#[inline(always)]
pub(super) fn narrow<T: Lane, U: Lane>(a: u128, b: u128, f: impl Fn(T) -> U + Copy) -> u128 {
    map(a, f) | map(b, f) << 64
}

/// `f` gets lanes `2i` and `2i + 1` of `wide`, which widens the lane at an index.
#[inline(always)]
pub(super) fn pairwise<U: Lane>(wide: impl Fn(usize) -> U, f: impl Fn(U, U) -> U) -> u128 {
    build(|i| f(wide(2 * i), wide(2 * i + 1)))
}
