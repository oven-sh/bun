//! Bitfield helper functions. T should be a packed struct of booleans.

use core::ops::{BitAnd, BitOr, Not};

// In Zig these are free functions over `comptime T: type` where T is a
// `packed struct(uN)`. Rust expresses the same constraint via a trait that
// exposes the backing integer and the bitcast in/out.
// TODO(port): @typeInfo(T).@"struct".backing_integer — modeled as associated type.
pub trait Bits: Copy {
    /// The backing integer type (`uN` of the `packed struct(uN)`).
    type Int: Copy
        + PartialEq
        + BitAnd<Output = Self::Int>
        + BitOr<Output = Self::Int>
        + Not<Output = Self::Int>;

    /// Smallest unsigned integer that can hold `0..=bits_of(Self::Int)`.
    /// Mirrors Zig's `LeadingZerosInt(T)`.
    type LeadingZerosInt: Copy;

    const ZERO_INT: Self::Int;

    fn as_int(self) -> Self::Int;
    fn from_int(bits: Self::Int) -> Self;
    fn clz(bits: Self::Int) -> Self::LeadingZerosInt;
}

/// If the right side is known at compile time, you should just perform field accesses
///
///     intersects(a, Flags { flag: true, .. }) --> a.flag
///
#[inline]
pub fn intersects<T: Bits>(lhs: T, rhs: T) -> bool {
    (as_int(lhs) & as_int(rhs)) != T::ZERO_INT
}

#[inline]
pub fn and<T: Bits>(lhs: T, rhs: T) -> T {
    from_int::<T>(as_int(lhs) & as_int(rhs))
}

#[inline]
pub fn or<T: Bits>(lhs: T, rhs: T) -> T {
    from_int::<T>(as_int(lhs) | as_int(rhs))
}

#[inline]
pub fn invert<T: Bits>(value: T) -> T {
    from_int::<T>(!as_int(value))
}

/// Prefer a property assignment when possible
///
///     insert(&mut a, Flags { flag: true, .. }) --> a.flag = true;
///
#[inline]
pub fn insert<T: Bits>(lhs: &mut T, rhs: T) {
    *lhs = or(*lhs, rhs);
}

#[inline]
pub fn contains<T: Bits>(lhs: T, rhs: T) -> bool {
    (as_int(lhs) & as_int(rhs)) != T::ZERO_INT
}

#[inline]
pub fn mask_out<T: Bits>(lhs: &mut T, rhs: T) -> T {
    // PORT NOTE: Zig passes `lhs` (a *T) directly to `@"and"` which expects T;
    // ported as a deref, matching the evident intent.
    and(*lhs, invert(rhs))
}

#[inline]
pub fn remove<T: Bits>(lhs: &mut T, rhs: T) {
    *lhs = and(*lhs, invert(rhs));
}

#[inline]
pub fn leading_zeros<T: Bits>(value: T) -> T::LeadingZerosInt {
    T::clz(as_int(value))
}

// `LeadingZerosInt(comptime T: type) type` → associated type `Bits::LeadingZerosInt`.
// Zig computes `std.math.IntFittingRange(0, @typeInfo(backing_int).int.bits)`;
// each `impl Bits` picks the concrete type (e.g. u8's is u4, u32's is u6).
// TODO(port): no direct type-level fn equivalent; resolved per-impl.

#[inline]
pub fn from_int<T: Bits>(bits: T::Int) -> T {
    T::from_int(bits)
}

#[inline]
pub fn as_int<T: Bits>(value: T) -> T::Int {
    value.as_int()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/meta/bits.zig (60 lines)
//   confidence: medium
//   todos:      2
//   notes:      packed-struct generics modeled via `Bits` trait; bitflags! types should impl it
// ──────────────────────────────────────────────────────────────────────────
