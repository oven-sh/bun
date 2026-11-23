//! The types that a lane can have.

use crate::bf16;
use crate::cast::Widens;
use crate::f16;
use crate::plain::{AsBytes, WriteAs, read_as, write_as};
use crate::raw::{Bits, Raw};
use crate::simd::Fits;
use crate::width::Width;
use core::fmt::Debug;
use core::ops::{Add, BitAnd, BitOr, BitXor, Div, Mul, Neg, Not, Shl, Shr, Sub};

/// The type of one value in a vector: `u8` to `u64`, `i8` to `i64`, `f16`, [`bf16`], `f32` or `f64`.
///
/// Code that is generic over the lane takes this bound, or [`Int`], [`Unsigned`], [`Signed`], [`Float`] or [`HasSign`] for
/// the operations that only those have. Only this crate implements the trait.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// fn largest<T: Lane>(values: &[T]) -> Option<T> {
///     over(values).max()
/// }
/// assert_eq!((largest(b"abc"), largest(&[1.5, 0.5])), (Some(b'c'), Some(1.5)));
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be a type of lane",
    label = "lanes are u8 to u64, i8 to i64, f16, bf16, f32 and f64",
    note = "the order is `Simd<T, W, S>`, `SimdN<T, S>`",
    note = "`select` takes vectors of the width of the mask: `m.cast()` changes that. For masks: `m & a | !m & b`"
)]
pub trait Lane: Copy + Default + PartialEq + PartialOrd + Debug + Send + Sync + 'static + Repr {
    /// The unsigned integer of the same size.
    type Unsigned: Unsigned<Signed = Self::Signed>;
    /// The signed integer of the same size.
    type Signed: Signed<Unsigned = Self::Unsigned>;
    /// The size in bits.
    const BITS: u32 = 8 * size_of::<Self>() as u32;
    /// The lowest value that is finite.
    const MIN: Self;
    /// The highest value that is finite.
    const MAX: Self;
    /// 0.
    const ZERO: Self;
    /// 1.
    const ONE: Self;
    /// Whether this is `f16`, `bf16`, `f32` or `f64`.
    const IS_FLOAT: bool;
    /// Whether there are negative values.
    const IS_SIGNED: bool;
    /// `value as Self`.
    fn from_i64(value: i64) -> Self;
    /// `value as Self`.
    fn from_f64(value: f64) -> Self;
    /// `value as Self`.
    fn from_usize(value: usize) -> Self;
    /// `value as Self`.
    fn from_u64(value: u64) -> Self;
    /// A constant in code that is generic over the lane. It doesn't build if this type can't hold it exactly. [`from_i64`](Self::from_i64) takes what varies.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// fn twice<T: Lane>(v: Simd<T, B16, S>) -> Simd<T, B16, S> {
    ///     v * T::of::<2>()
    /// }
    /// assert_eq!(twice(f32x4::splat(1.5)), [3.0; 4]);
    /// # } example()
    /// ```
    fn of</* else from_i64 */ const VALUE: i64>() -> Self;
}

/// For a message.
struct Value<const IT: i64>;

/// An integer lane.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be an integer lane",
    label = "this is only for u8 to u64 and i8 to i64",
    note = "`to_bits` gives the same bits as integers, and `cast` converts the values"
)]
pub trait Int:
    Lane
    + Ord
    + Not<Output = Self>
    + BitAnd<Output = Self>
    + BitOr<Output = Self>
    + BitXor<Output = Self>
    + Shl<u32, Output = Self>
    + Shr<u32, Output = Self>
    + Add<Output = Self>
    + Sub<Output = Self>
    + Widens<<Self as Int>::Wide>
    + crate::arithmetic::Integer
{
    /// The integer of twice the size and the same signedness. 64 bits are their own double.
    type Wide: Int;
    /// The integer of half the size and the same signedness. 8 bits are their own half.
    type Narrow: Int + Widens<Self>;
    /// `self as u64`.
    fn to_u64(self) -> u64;
}

/// An unsigned integer lane.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be an unsigned integer lane",
    label = "this is only for u8 to u64",
    note = "`cast_unsigned` gives the same bits as unsigned lanes"
)]
pub trait Unsigned: Int<Unsigned = Self> + From<u8> + Into<u64> {}
/// A signed integer lane.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be a signed integer lane",
    label = "this is only for i8 to i64",
    note = "`cast_signed` gives the same bits as signed lanes",
    note = "a mask names the signed integer of the size of its lanes: `Mask<i8, ..>`, or `MaskOf<u8, ..>` and `MaskOf<T, ..>`. For masks alone, take `T: Signed`"
)]
pub trait Signed: Int<Signed = Self> + HasSign + crate::masks::MaskOfLanes<Self, Self> {}
/// A floating-point lane.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be a floating-point lane",
    label = "this is only for f16, bf16, f32 and f64",
    note = "`cast` makes floating-point lanes from integers"
)]
pub trait Float:
    Lane
    + HasSign
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<Output = Self>
    + Div<Output = Self>
    + Neg<Output = Self>
    + crate::elementary::Parts
{
}
/// A signed integer or floating-point lane.
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be a signed lane",
    label = "this is only for i8 to i64, f16, bf16, f32 and f64",
    note = "`cast_signed` gives the same bits as signed lanes",
    note = "a mask names the signed integer of the size of its lanes: `Mask<i8, ..>`, or `MaskOf<u8, ..>` and `MaskOf<T, ..>`. For masks alone, take `T: Signed`"
)]
pub trait HasSign: Lane {}

/// This lane has the size of `T`, which is a signed integer. It holds for each `U: Lane<Signed = T>`.
#[diagnostic::on_unimplemented(
    message = "`{Self}` doesn't have the size of these lanes, which is that of `{T}`",
    note = "a number without a suffix is an `i32` or `f64` if nothing else tells its type: write `1u8`, `1i16` or `1.0f32` for one of them",
    note = "`m.cast()` is a mask for lanes of another size, and `v.cast()` a vector. `zip_scaled` takes a slice of them"
)]
pub trait SameSize<T>: Lane<Signed = T> {}
#[diagnostic::do_not_recommend]
impl<U: Lane> SameSize<U::Signed> for U {}

/// `I` is the only type that fits.
#[diagnostic::on_unimplemented(message = "the result has lanes of `{Self}`, and can't have `{I}`")]
pub trait Is<I> {}
impl<T> Is<T> for T {}

/// The width `W`, scaled from lanes of `T` to as many lanes of `U`: what `cast::<U>()` makes of a `Simd<T, W, S>`.
///
/// `Simd<u8, Scaled<f32, u8, Native<S>>, S>` has as many lanes as `f32xN`. Where the types are known, `Half` and `Twice` of the prelude are shorter: `Scaled<i8, i16, Native<S>>` is `Twice<Native<S>>`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// assert_eq!(Simd::<u8, Scaled<f32, u8, Native<S>>, S>::LANES, f32xN::LANES);
/// assert_eq!(Simd::<u8, Half<Half<Native<S>>>, S>::LANES, f32xN::LANES);
/// #[simd]
/// fn to_floats<W: Width>(v: Simd<u8, W, S>) -> Simd<f32, Scaled<u8, f32, W>, S> {
///     v.cast()
/// }
/// assert_eq!(to_floats(u8x4::splat(1)), [1.0; 4]);
/// # } example()
/// ```
#[doc(alias("Rebind", "Repartition", "Quarter", "Times4", "same_lanes"))]
pub type Scaled<T, U, W> = <<T as Lane>::Signed as Repr>::To<<U as Lane>::Signed, W>;

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Kind {
    Unsigned,
    Signed,
    Float,
}

pub trait Element:
    Lane<Stored = Self> + Fits<1> + Fits<2> + Fits<4> + Fits<8> + Fits<16> + Fits<32> + Fits<64>
{
}
impl<T: Lane<Stored = T> + Fits<1> + Fits<2> + Fits<4> + Fits<8> + Fits<16> + Fits<32> + Fits<64>> Element for T {}

/// The same memory, as bytes in the order of the CPU: [`bitcast_slice`](crate::mem::bitcast_slice) to `u8`.
///
/// ```
/// assert_eq!(bun_simd::mem::as_bytes(&[0x0102u16]), 0x0102u16.to_ne_bytes());
/// ```
#[doc(alias("bytes_of", "as_u8_slice"))]
#[inline(always)]
pub fn as_bytes<T: AsBytes>(values: &[T]) -> &[u8] {
    const { crate::plain::readable::<T, u8>() };
    read_as(values)
}
/// The same for a mutable slice.
#[doc(alias("bytes_of_mut", "as_mut_bytes"))]
#[inline(always)]
pub fn as_bytes_mut<T: WriteAs<u8>>(values: &mut [T]) -> &mut [u8] {
    const { crate::plain::writable::<T, u8>() };
    write_as(values)
}
/// A slice that a loop can read and write: to change several slices in place, or records, or one slice next to several others.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (mut x, mut speed, mut points) = ([0.0; 5], [1.0; 5], [[3.0, 4.0]; 5]);
/// let both = [as_cells(&mut x), as_cells(&mut speed)];
/// f32xN::over_all(both).unzip_into(both, |[x, speed]| [x + speed, speed * 0.5]);
/// let mut all = as_cells(points.as_flattened_mut());
/// f32xN::over(all).interleaved().zip(&x).map_into(&mut all, |([a, b], x)| [b, a + x]);
/// assert_eq!((x, speed, points), ([1.0; 5], [0.5; 5], [[4.0, 4.0]; 5]));
/// # } example()
/// ```
#[doc(alias("as_slice_of_cells", "in_place", "over_all_mut", "zip_mut", "update", "interleaved_mut"))]
#[inline(always)]
pub fn as_cells<T>(values: &mut [T]) -> &[core::cell::Cell<T>] {
    core::cell::Cell::from_mut(values).as_slice_of_cells()
}

/// Not nameable outside of this crate.
pub trait Repr: crate::hints::Folded + crate::half::Soft + crate::plain::Plain {
    const KIND: Kind;
    /// The number of bits below the exponent.
    const FRACTION: u32;
    /// What `crate::simd` holds.
    type Stored: Element;
    /// In the form in which LLVM removes the checks of the tails.
    fn bytes(values: &[Self]) -> &[u8];
    fn unsigned(values: &[Self]) -> &[Self::Unsigned]
    where
        Self: Lane;
    fn unsigned_mut(values: &mut [Self]) -> &mut [Self::Unsigned]
    where
        Self: Lane;
    fn of_unsigned(values: &[Self::Unsigned]) -> &[Self]
    where
        Self: Lane;
    fn of_unsigned_mut(values: &mut [Self::Unsigned]) -> &mut [Self]
    where
        Self: Lane;
    // `Scaled`, by double dispatch.
    type To<U: Lane, W: Width>: Width;
    type From1<W: Width>: Width;
    type From2<W: Width>: Width;
    type From4<W: Width>: Width;
    type From8<W: Width>: Width;
    type Raw<W: Width>: Raw<Lane = Self> + Bits<W>;
}

pub(crate) trait AsBits: Lane {
    fn as_bits(self) -> Self::Unsigned;
    fn of_bits(bits: Self::Unsigned) -> Self;
}

type Half<W> = <W as Width>::Half;
type Twice<W> = <W as Width>::Twice;

/// `W` times the size of this lane, divided by 1, 2, 4 and 8, within the range of `B2` to `B512`.
macro_rules! scaled {
    (From1) => {
        scaled!(W, Half<W>, Half<Half<W>>, Half<Half<Half<W>>>);
    };
    (From2) => {
        scaled!(Twice<W>, W, Half<W>, Half<Half<W>>);
    };
    (From4) => {
        scaled!(Twice<Twice<W>>, Twice<W>, W, Half<W>);
    };
    (From8) => {
        scaled!(Twice<Twice<Twice<W>>>, Twice<Twice<W>>, Twice<W>, W);
    };
    ($one:ty, $two:ty, $four:ty, $eight:ty) => {
        type From1<W: Width> = $one;
        type From2<W: Width> = $two;
        type From4<W: Width> = $four;
        type From8<W: Width> = $eight;
    };
}

macro_rules! lanes {
    (@of f16, $value:expr, $f:ident) => { f16::from_f64($value as _) };
    (@back f16, $value:expr) => { $value.to_f32() as i128 };
    (@of bf16, $value:expr, $f:ident) => { bf16::$f($value as _) };
    (@of $t:ident, $value:expr, $f:ident) => { $value as $t };
    (@back bf16, $value:expr) => { $value.to_f32() as i128 };
    (@back $t:ident, $value:expr) => { $value as i128 };
    (@bits Float $u:ident $value:expr) => { $value.to_bits() };
    (@bits $kind:ident $u:ident $value:expr) => { $value as $u };
    (@from Float $t:ident $bits:expr) => { $t::from_bits($bits) };
    (@from $kind:ident $t:ident $bits:expr) => { $bits as $t };
    ($($t:ident $raw:ident $kind:ident $u:ident $i:ident $from:ident $stored:ident $fraction:literal;)*) => {$(
        impl Lane for $t {
            type Unsigned = $u;
            type Signed = $i;
            const MIN: Self = $t::MIN;
            const MAX: Self = $t::MAX;
            const ZERO: Self = lanes!(@of $t, 0, from_i128);
            const ONE: Self = lanes!(@of $t, 1, from_i128);
            const IS_FLOAT: bool = matches!(Kind::$kind, Kind::Float);
            const IS_SIGNED: bool = !matches!(Kind::$kind, Kind::Unsigned);
            #[inline(always)]
            fn from_i64(value: i64) -> Self { lanes!(@of $t, value, from_i128) }
            #[inline(always)]
            fn from_f64(value: f64) -> Self { lanes!(@of $t, value, from_f64) }
            #[inline(always)]
            fn from_usize(value: usize) -> Self { lanes!(@of $t, value, from_i128) }
            #[inline(always)]
            fn from_u64(value: u64) -> Self { lanes!(@of $t, value, from_i128) }
            #[inline(always)]
            #[track_caller]
            fn of<const VALUE: i64>() -> Self {
                require!(of (Self, Value<VALUE>), "the lane can't hold the value", lanes!(@back $t, lanes!(@of $t, VALUE, from_i128)) == VALUE as i128);
                Self::from_i64(VALUE)
            }
        }
        impl AsBits for $t {
            #[inline(always)] fn as_bits(self) -> $u { lanes!(@bits $kind $u self) }
            #[inline(always)] fn of_bits(bits: $u) -> $t { lanes!(@from $kind $t bits) }
        }
        impl Repr for $t {
            const KIND: Kind = Kind::$kind;
            const FRACTION: u32 = $fraction;
            type Stored = $stored;
            #[inline(always)] fn bytes(values: &[$t]) -> &[u8] { read_as::<[u8; size_of::<$t>()]>(values).as_flattened() }
            #[inline(always)] fn unsigned(values: &[$t]) -> &[$u] { read_as(values) }
            #[inline(always)] fn unsigned_mut(values: &mut [$t]) -> &mut [$u] { write_as(values) }
            #[inline(always)] fn of_unsigned(values: &[$u]) -> &[$t] { read_as(values) }
            #[inline(always)] fn of_unsigned_mut(values: &mut [$u]) -> &mut [$t] { write_as(values) }
            type To<U: Lane, W: Width> = U::$from<W>;
            scaled!($from);
            type Raw<W: Width> = W::$raw;
        }
    )*};
}

lanes! {
    u8 U8 Unsigned u8 i8 From1 u8 0;
    u16 U16 Unsigned u16 i16 From2 u16 0;
    u32 U32 Unsigned u32 i32 From4 u32 0;
    u64 U64 Unsigned u64 i64 From8 u64 0;
    i8 I8 Signed u8 i8 From1 i8 0;
    i16 I16 Signed u16 i16 From2 i16 0;
    i32 I32 Signed u32 i32 From4 i32 0;
    i64 I64 Signed u64 i64 From8 i64 0;
    f16 F16 Float u16 i16 From2 u16 10;
    bf16 Bf16 Float u16 i16 From2 u16 7;
    f32 F32 Float u32 i32 From4 f32 23;
    f64 F64 Float u64 i64 From8 f64 52;
}
macro_rules! kinds { ($($kind:ident: $($t:ident)*;)*) => { $($(impl $kind for $t {})*)* }; }
kinds! { Unsigned: u8 u16 u32 u64; Signed: i8 i16 i32 i64; Float: f16 bf16 f32 f64; HasSign: i8 i16 i32 i64 f16 bf16 f32 f64; }

macro_rules! ints {
    ($($t:ident $narrow:ident $wide:ident;)*) => {$(
        impl Int for $t {
            type Wide = $wide;
            type Narrow = $narrow;
            #[inline(always)]
            fn to_u64(self) -> u64 { self as u64 }
        }
    )*};
}

ints! {
    u8 u8 u16; u16 u8 u32; u32 u16 u64; u64 u32 u64;
    i8 i8 i16; i16 i8 i32; i32 i16 i64; i64 i32 i64;
}
