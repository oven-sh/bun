//! Constructors. Each table makes functions of the type, and methods of the tokens.
//!
//! A row is `name[generics](arguments) -> result where [bounds] = |d| body;`. `d` is the tag, and `$S` the token.
//! `= const check; |d| body` evaluates a constant in the function that is called, since rustc names the line that calls that, unless it has inlined it.

use crate::raw::same;
use crate::{B2, B4, B8, B16, B32, B64, B128, B256, B512, Isa, Lane, Operand, Simd, Tag, Width, bf16, f16};

/// What fits no width. These don't depend on the target, so an error is reported once.
pub(crate) struct Fits<const N: usize, T = ()>(T);
impl<const N: usize, T> Fits<N, T> {
    pub const GROUP: () = assert!(
        (N * size_of::<T>()).is_power_of_two() && N * size_of::<T>() <= 64,
        "the group of `repeat` has 1, 2, 4 and so on up to 64 bytes: `from_fn(|i| group[i % N])` takes the others"
    );
    pub const RECORDS: usize = crate::records::check(N);
    pub const PLANES: () = assert!(N <= 8 * size_of::<T>(), "there are more planes than bits in a lane");
    pub const NEIGHBORS: () = assert!(1 <= N && N <= 4, "this is for 1 to 4 vectors");
    pub const SHIFT: () = assert!(N <= 16, "`K` is more than a block");
    pub const SLICES: () = assert!(N > 0, "there has to be a slice");
}
impl<T, U> Fits<0, (T, U)> {
    pub const TWICE: () = assert!(
        size_of::<U>() == 2 * size_of::<T>() || size_of::<U>() == size_of::<T>(),
        "the lanes of the arguments have to be half as wide as those of the result"
    );
}

/// Defines the macro that writes them in `native.rs`.
#[rules]
macro_rules! on_type {
    ($table:ident; $($(#[$m:meta])* $name:ident[$($g:tt)*]($($a:ident: $t:ty),*) -> $out:ty $(where [$($w:tt)*])? = $(const $check:expr;)? |$d:ident| $body:expr;)*) => {
        crate::make::enabled! { $table $([$(#[$m])*] {
            #[track_caller]
            pub fn $name<$($g)*>($($a: $t),*) -> $out where crate::Code: crate::At<S>, $($($w)*)? { $(const { $check };)? W::${concat(make_, $name)}(crate::make::Own(S::here()), $($a),*) }
        })* }
    };
}
#[rules]
macro_rules! enabled { ($table:ident $([$($docs:tt)*] { $($item:tt)* })*) => {
    macro_rules! $table {
        () => { $($($docs)* #[inline(always)] $($item)*)* };
    }
    pub(crate) use $table;
}; }
/// In `Makers`.
#[rules]
macro_rules! on_width {
    ($unused:ident; $($(#[$m:meta])* $name:ident[$($g:tt)*]($($a:ident: $t:ty),*) -> $out:ty $(where [$($w:tt)*])? = $(const $check:expr;)? |$d:ident| $body:expr;)*) => {$(
        #[op] #[track_caller]
        fn ${concat(make_, $name)}<S: Isa, T: Lane, W: Width, $($g)*>(s: Own<S>, $($a: $t),*) -> $out $(where $($w)*)? { let $d = Tag::<S, T, W>::new(s.0); $body }
    )*};
}
/// In `WithToken`.
#[rules]
macro_rules! on_token {
    ($unused:ident; $($(#[$m:meta])* $name:ident[$($g:tt)*]($($a:ident: $t:ty),*) -> $out:ty $(where [$($w:tt)*])? = $(const $check:expr;)? |$d:ident| $body:expr;)*) => {$(
        #[inline(always)] #[track_caller]
        fn $name<T: crate::Lane, W: crate::Width, $($g)*>(self, $($a: $t),*) -> $out $(where $($w)*)? { $(const { $check };)? let $d = crate::Tag::<Self, T, W>::new(self); $body }
    )*};
}
macro_rules! tables { ($then:ident $target:ident $S:ty) => {
    crate::make::makers!($then $target $S);
    crate::load::makers!($then $target $S);
    crate::over::makers!($then $target $S);
    crate::cast::makers!($then $target $S);
    crate::low_bytes::makers!($then $target $S);
    crate::planes::makers!($then $target $S);
}; }

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// `value` in each lane.
    #[doc(alias("Set", "set1", "broadcast", "dup"))]
    splat[](value: T) -> crate::Simd<T, W, $S> = |d| d.set(value);
    /// Zero in each lane.
    #[doc(alias("Zero", "default"))]
    zero[]() -> crate::Simd<T, W, $S> = |d| d.zero();
    /// `first`, `first + 1` and so on.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::iota(5), [5, 6, 7, 8]);
    /// # } example()
    /// ```
    #[doc(alias("Iota", "range", "indices"))]
    iota[](first: T) -> crate::Simd<T, W, $S> = |d| d.iota(first);
    /// From an array, a reference to one, a register of `core::arch`, or a vector whose lanes convert without loss.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"abcd"), u8x4::from([97, 98, 99, 100]));
    /// assert_eq!(u32x4::from(u8x4::splat(7)), [7; 4]);
    /// # } example()
    /// ```
    #[doc(alias("from_arch", "new"))]
    from[](value: impl crate::IntoSimd<T, W, $S>) -> crate::Simd<T, W, $S> = |d| value.into_simd(d.simd());
    /// From `[T; LANES]`, also where `T` or `W` is generic.
    from_array[](lanes: crate::Array<T, W>) -> crate::Simd<T, W, $S> = |d| d.from_array(lanes);
    /// Lane `i` is `lane(i)`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u32x4::from_fn(|i| 1 << i), [1, 2, 4, 8]);
    /// # } example()
    /// ```
    from_fn[](lane: impl FnMut(usize) -> T) -> crate::Simd<T, W, $S> = |d| on_x86!(d.from_fn(lane), made());
    /// `group` again and again. Its size is a power of two up to 64 bytes. A shorter vector has its start.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x8::repeat(b"ab"), *b"abababab");
    /// # } example()
    /// ```
    #[doc(alias("LoadDup128", "Dup128VecFromValues", "load_dup"))]
    repeat[const N: usize](/* a vector: from_parts */ group: &[T; N]) -> crate::Simd<T, W, $S> = const crate::make::Fits::<N, T>::GROUP; |d| d.load_dup(group);
    /// Only the highest bit of each lane.
    #[doc(alias("SignBit"))]
    sign_bit[]() -> crate::Simd<T, W, $S> = |d| d.sign_bit();
} }; }

/// The names of the prelude that have to do with the target.
#[doc(hidden)]
#[macro_export]
macro_rules! target_names { ($vis:vis use $($from:ident)::+) => {
    $vis use $($from)::+::{
        Half, MaskN, SimdN, Native, Twice, Upto, crc32, crc32c, deposit_bits, extract_bits, isa, over, over_mut, prefix_xor, set_bit_positions,
        u8xN, u16xN, u32xN, u64xN, i8xN, i16xN, i32xN, i64xN, f16xN, bf16xN, f32xN, f64xN,
        f16x1, f16x2, f16x4, f16x8, f16x16, f16x32, bf16x1, bf16x2, bf16x4, bf16x8, bf16x16, bf16x32,
        mask8xN, mask8x2, mask8x4, mask8x8, mask8x16, mask8x32, mask8x64,
        mask16xN, mask16x1, mask16x2, mask16x4, mask16x8, mask16x16, mask16x32, mask16x64,
        mask32xN, mask32x1, mask32x2, mask32x4, mask32x8, mask32x16, mask32x32, mask32x64,
        mask64xN, mask64x1, mask64x2, mask64x4, mask64x8, mask64x16, mask64x32, mask64x64,
        u8x2, u8x4, u8x8, u8x16, u8x32, u8x64, i8x2, i8x4, i8x8, i8x16, i8x32, i8x64,
        u16x1, u16x2, u16x4, u16x8, u16x16, u16x32, i16x1, i16x2, i16x4, i16x8, i16x16, i16x32,
        u32x1, u32x2, u32x4, u32x8, u32x16, i32x1, i32x2, i32x4, i32x8, i32x16, f32x1, f32x2, f32x4, f32x8, f32x16,
        u64x1, u64x2, u64x4, u64x8, i64x1, i64x2, i64x4, i64x8, f64x1, f64x2, f64x4, f64x8,
        u16x64, i16x64, f16x64, bf16x64, u32x32, u32x64, i32x32, i32x64, f32x32, f32x64,
        u64x16, u64x32, u64x64, i64x16, i64x32, i64x64, f64x16, f64x32, f64x64,
    };
}; }

/// Calls a macro with each lane, width, number of lanes and alias.
macro_rules! shapes { ($($then:ident)::+) => { $($then)::+! {
    u8 u8xN: B2 2 u8x2, B4 4 u8x4, B8 8 u8x8, B16 16 u8x16, B32 32 u8x32, B64 64 u8x64;
    i8 i8xN: B2 2 i8x2, B4 4 i8x4, B8 8 i8x8, B16 16 i8x16, B32 32 i8x32, B64 64 i8x64;
    u16 u16xN: B2 1 u16x1, B4 2 u16x2, B8 4 u16x4, B16 8 u16x8, B32 16 u16x16, B64 32 u16x32, B128 64 u16x64;
    i16 i16xN: B2 1 i16x1, B4 2 i16x2, B8 4 i16x4, B16 8 i16x8, B32 16 i16x16, B64 32 i16x32, B128 64 i16x64;
    u32 u32xN: B4 1 u32x1, B8 2 u32x2, B16 4 u32x4, B32 8 u32x8, B64 16 u32x16, B128 32 u32x32, B256 64 u32x64;
    i32 i32xN: B4 1 i32x1, B8 2 i32x2, B16 4 i32x4, B32 8 i32x8, B64 16 i32x16, B128 32 i32x32, B256 64 i32x64;
    f32 f32xN: B4 1 f32x1, B8 2 f32x2, B16 4 f32x4, B32 8 f32x8, B64 16 f32x16, B128 32 f32x32, B256 64 f32x64;
    u64 u64xN: B8 1 u64x1, B16 2 u64x2, B32 4 u64x4, B64 8 u64x8, B128 16 u64x16, B256 32 u64x32, B512 64 u64x64;
    i64 i64xN: B8 1 i64x1, B16 2 i64x2, B32 4 i64x4, B64 8 i64x8, B128 16 i64x16, B256 32 i64x32, B512 64 i64x64;
    f64 f64xN: B8 1 f64x1, B16 2 f64x2, B32 4 f64x4, B64 8 f64x8, B128 16 f64x16, B256 32 f64x32, B512 64 f64x64;
    f16 f16xN: B2 1 f16x1, B4 2 f16x2, B8 4 f16x4, B16 8 f16x8, B32 16 f16x16, B64 32 f16x32, B128 64 f16x64;
    bf16 bf16xN: B2 1 bf16x1, B4 2 bf16x2, B8 4 bf16x4, B16 8 bf16x8, B32 16 bf16x16, B64 32 bf16x32, B128 64 bf16x64;
} }; }
pub(crate) use {enabled, makers, on_token, on_type, on_width, shapes, tables};

makers!(on_type of_make S);
crate::load::makers!(on_type of_load S);
crate::over::makers!(on_type of_over S);
crate::cast::makers!(on_type of_cast S);
crate::low_bytes::makers!(on_type of_low_bytes S);
crate::planes::makers!(on_type of_planes S);

/// The bodies of the functions of the types. rustc can't look into a method of `W` until `W` is known. Otherwise it follows
/// the calls of each constructor for each target when it builds this crate, which takes seconds.
pub trait Makers {
    tables!(on_width none S);
    crate::masks::makers!(widths none);
    #[op]
    fn make_xoshiro<S: Isa, W: Width>(s: Own<S>, seed: u64) -> crate::Xoshiro<W, S> {
        crate::Xoshiro::on(s.0, seed)
    }
}

/// Other crates can't make this, and so can't call the methods of `Makers`.
pub struct Own<S>(pub(crate) S);

/// What `from` takes.
#[diagnostic::on_unimplemented(
    message = "a vector of `{T}` of the width `{W}` can't be made from `{Self}`",
    note = "`from` takes an array of as many lanes, a register of `core::arch` of that width, or a vector whose lanes convert without loss",
    note = "`load` takes a slice, `splat` a number, `from_parts(|_| v)` repeats a vector, and `cast` converts as `as` does"
)]
pub trait IntoSimd<T: Lane, W: Width, S: Isa> {
    #[doc(hidden)]
    fn into_simd(self, s: S) -> Simd<T, W, S>;
}

/// An array, and the width of the vector with as many lanes, up to 64.
pub(crate) trait Fills {}
macro_rules! arrays { ($($t:ident $native:ident: $($w:ident $n:literal $alias:ident),+;)*) => {
    $($(impl Fills for ([$t; $n], $w) where crate::Array<$t, $w>: crate::lane::Is<[$t; $n]> {})+)*
}; }
shapes!(arrays);
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> Operand<T, W, S> for [T; N]
where
    ([T; N], W): Fills,
{
    #[inline(always)]
    fn vector(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.from_array(same(self))
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> Operand<T, W, S> for &[T; N]
where
    ([T; N], W): Fills,
{
    #[op]
    fn vector(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.from_array(same(*self))
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> IntoSimd<T, W, S> for [T; N]
where
    ([T; N], W): Fills,
{
    #[op]
    fn into_simd(self, s: S) -> Simd<T, W, S> {
        s.fixed().from_array(same(self))
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> IntoSimd<T, W, S> for &[T; N]
where
    ([T; N], W): Fills,
{
    #[op]
    fn into_simd(self, s: S) -> Simd<T, W, S> {
        s.fixed().from_array(same(*self))
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> From<Simd<T, W, S>> for [T; N]
where
    ([T; N], W): Fills,
{
    #[inline(always)]
    fn from(v: Simd<T, W, S>) -> Self {
        same(v.to_array())
    }
}

#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width, const N: usize> From<[T; N]> for Simd<T, W, S>
where
    ([T; N], W): Fills,
{
    #[op]
    fn from(lanes: [T; N]) -> Self {
        lanes.into_simd(S::default())
    }
}

/// A vector in which each 16 bytes are a vector of their own. x86 has many instructions only in this form.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = u32x8::iota(0);
/// assert_eq!(v.reverse(), [7, 6, 5, 4, 3, 2, 1, 0]);
/// assert_eq!(v.in_blocks().reverse(), [3, 2, 1, 0, 7, 6, 5, 4]);
/// # } example()
/// ```
pub struct InBlocks<T: Lane, W: Width, S: Isa>(pub(crate) Simd<T, W, S>);
impl<T: Lane, W: Width, S: Isa> Copy for InBlocks<T, W, S> {}
impl<T: Lane, W: Width, S: Isa> Clone for InBlocks<T, W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[doc(hidden)]
    #[inline(always)]
    pub fn isa(self) -> S {
        self.s
    }
    /// A view whose operations stay within each block.
    #[inline(always)]
    pub fn in_blocks(self) -> InBlocks<T, W, S> {
        InBlocks(self)
    }
}
