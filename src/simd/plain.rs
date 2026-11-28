//! Memory of one type, seen as another.

use crate::f16;
use crate::{Aligned, B16, B32, B64, B128, B256, B512, Isa, Lane, Simd, Width, bf16, raw::RawOf};
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::num::{Saturating, Wrapping};

/// Any bytes are a value of this type, and a value has no padding: numbers, and arrays, structs, `Wrapping`, `Saturating` and [`Aligned`] of these.
/// [`bitcast_slice`] and [`bitcast_slice_mut`] turn a slice of one into a slice of another.
///
/// For a struct without parameters it is derived, which checks that the fields are `Plain`, in the order in which they are written, and without gaps.
/// `#[repr(C)]` keeps that order. If the crate has another name, the path shows it: `#[derive(name::mem::Plain)]`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// #[derive(Copy, Clone, Plain)]
/// #[repr(C)]
/// struct Point { x: f32, y: f32 }
///
/// let mut points = [Point { x: 1.0, y: 2.0 }; 5];
/// over_mut(bitcast_slice_mut::<f32>(&mut points)).map(|v| v * 2.0);
/// assert_eq!((points[4].x, points[4].y), (2.0, 4.0));
/// # } example()
/// ```
#[doc(alias("Pod", "AnyBitPattern", "FromBytes", "struct", "newtype", "record"))]
#[diagnostic::on_unimplemented(
    message = "not all bytes are known to be a value of `{Self}`",
    note = "a struct gets `#[derive(Plain)]`. A type of another crate needs a cast of that crate",
    note = "nothing is cast to vectors: keep the numbers, and take `load_at`, `store_at` or `over`, which need no alignment"
)]
pub trait Plain: AsBytes + 'static + Open {}

/// A value has no padding, so it can be read as numbers: what is [`Plain`](trait@Plain), `bool`, `char`, vectors of 16 bytes or more (for others `cargo build` fails, also after an `if`, but not if `pick!` or `#[only]` leaves them out), and what holds these as for `Plain`.
///
/// It is derived for a struct of such fields, by the rules of `Plain`, whose derive includes it, and for an enum without fields that has `#[repr(u8)]` or the like.
/// The derives don't work in a `macro`, as opposed to `macro_rules!`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// #[derive(Copy, Clone, AsBytes)]
/// #[repr(u8)]
/// enum Cell { Dead, Alive }
///
/// let cells = [Cell::Alive, Cell::Dead, Cell::Alive];
/// assert_eq!(over(as_bytes(&cells)).count(|v| v.simd_eq(Cell::Alive as u8)), 2);
/// # } example()
/// ```
#[doc(alias("NoUninit", "IntoBytes", "enum", "bool"))]
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be without padding",
    note = "a struct or an enum gets `#[derive(AsBytes)]` or `#[derive(Plain)]`. A type of another crate needs a cast of that crate",
    note = "`MaybeUninit` can be read after it was written through an `Output`"
)]
pub trait AsBytes: Copy + Filled {}
pub use bun_simd_macros::{AsBytes, Plain};

/// # Safety
/// A value has no padding, if the constant can be evaluated.
#[doc(hidden)]
#[allow(unsafe_code)]
#[diagnostic::on_unimplemented(message = "`AsBytes` is derived: `#[derive(AsBytes)]`")]
pub unsafe trait Filled {
    /// Fails for an `Aligned` with padding, and for a short vector.
    const FILLED: ();
}
/// # Safety
/// All bytes are a value.
#[doc(hidden)]
#[allow(unsafe_code)]
#[diagnostic::on_unimplemented(message = "`Plain` is derived: `#[derive(Plain)]`")]
pub unsafe trait Open {}
const fn check<T: Filled>() {
    T::FILLED
}
macro_rules! listed {
    (read [$($generics:tt)*] $t:ty, $holds:expr) => {
        // SAFETY: these have no padding, if `$holds` can be evaluated.
        #[allow(unsafe_code)]
        unsafe impl<$($generics)*> Filled for $t { const FILLED: () = $holds; }
        impl<$($generics)*> AsBytes for $t {}
    };
    (write [$($generics:tt)*] $t:ty) => {
        // SAFETY: all bytes are a value of these.
        #[allow(unsafe_code)]
        unsafe impl<$($generics)*> Open for $t {}
        impl<$($generics)*> Plain for $t {}
    };
}
/// The alias has no parameters.
/// The derives expand to this.
#[doc(hidden)]
#[macro_export]
macro_rules! derive_plain {
    (struct $name:ident $($field:tt)*) => {
        const _: () = {
            type __Derived = $name;
            // SAFETY: these are all fields, they have no padding, and they cover the value.
            unsafe impl $crate::__plain::Filled for __Derived { const FILLED: () = (); }
            impl $crate::mem::AsBytes for __Derived {}
            let _ = |__Derived { $($field: _),* }: __Derived| ();
            let [] = [(); $crate::__plain::in_a_row::<__Derived>(&[$((
                $crate::__plain::offset_of!(__Derived, $field),
                $crate::__plain::size::<__Derived, _>(|__Derived { $field: it @ _, .. }| $crate::__plain::of(&it)),
            )),*])];
        };
    };
    (enum $name:ident $variant:ident) => {
        const _: () = {
            type __Derived = $name;
            // SAFETY: it is a number and nothing else. All variants have the same layout, and rustc refuses a constant with padding as bytes.
            unsafe impl $crate::__plain::Filled for __Derived { const FILLED: () = (); }
            impl $crate::mem::AsBytes for __Derived {}
            let _ = |it @ _: __Derived| it as $crate::__plain::Number;
            let [] = [(); $crate::__plain::tag::<__Derived>(__Derived::$variant {})];
        };
    };
    (for $name:ident $($field:tt)*) => {
        const _: () = {
            type __Derived = $name;
            // SAFETY: it is made of all values of the fields, which are Plain.
            unsafe impl $crate::__plain::Open for __Derived {}
            impl $crate::mem::Plain for __Derived {}
            let _ = |it @ _: __Derived| -> __Derived { __Derived { $($field: $crate::__plain::any(it.$field)),* } };
            let [] = [(); $crate::__plain::no_niche::<__Derived>()];
        };
    };
}

/// What the derives call.
#[doc(hidden)]
pub mod derived {
    use super::*;
    pub use {super::Filled, super::Open, core::mem::offset_of};
    pub type Number = i128;
    pub fn of<F>(_: &F) -> PhantomData<F> {
        PhantomData
    }
    pub fn any<F: Plain>(it: F) -> F {
        it
    }
    pub const fn size<T, F: AsBytes>(_: fn(T) -> PhantomData<F>) -> usize {
        check::<F>();
        size_of::<F>()
    }
    /// The places and sizes of all fields.
    pub const fn in_a_row<T>(fields: &[(usize, usize)]) -> usize {
        let (mut end, mut i) = (0, 0);
        while i < fields.len() {
            let (at, size) = fields[i];
            assert!(at == end || size == 0, "the fields have to be in order, by `#[repr(C)]`, and without padding");
            (end, i) = (end + size, i + 1);
        }
        assert!(end == size_of::<T>(), "there is padding after the last field");
        0
    }
    pub const fn no_niche<T>() -> usize {
        assert!(size_of::<Option<T>>() > size_of::<T>(), "the type has bit patterns that are not values");
        0
    }
    /// In a constant, reading fails at padding.
    pub const fn tag<T: AsBytes>(value: T) -> usize {
        assert!(
            size_of::<T>() == size_of::<core::mem::Discriminant<T>>(),
            "the enum needs `#[repr(u8)]` or the like, but not `C`, and no padding after the number"
        );
        let (bytes, mut i) = (bitcast_one(&value), 0);
        while i < bytes.len() {
            assert!(bytes[i] as u32 <= 255);
            i += 1
        }
        0
    }
}

/// `as_bytes`, for constants.
const fn bitcast_one<T: AsBytes>(value: &T) -> &[u8] {
    check::<T>();
    // SAFETY: the same bytes, which are valid by the bound.
    #[allow(unsafe_code)]
    unsafe {
        &*core::ptr::slice_from_raw_parts(core::ptr::from_ref(value).cast(), size_of::<T>())
    }
}

macro_rules! plain { ($($t:ty)*) => {$(
    listed!(read [] $t, ());
    listed!(write [] $t);
)*}; }
plain!(u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 bf16);
listed!(read [] bool, ());
listed!(read [] char, ());
listed!(read [] crate::text::Ascii, ());
listed!(read [T: AsBytes, const N: usize] [T; N], check::<T>());
listed!(write [T: Plain, const N: usize] [T; N]);
listed!(read [T: AsBytes] Wrapping<T>, check::<T>());
listed!(write [T: Plain] Wrapping<T>);
listed!(read [T: AsBytes] Saturating<T>, check::<T>());
listed!(write [T: Plain] Saturating<T>);
listed!(read [T: AsBytes] Aligned<T>, {
    assert!(size_of::<T>() == size_of::<Self>(), "an `Aligned` has padding unless its size is a multiple of 64");
    check::<T>()
});
listed!(write [T: Plain] Aligned<T>);
listed!(read [T: Lane, W: Width, S: Isa] Simd<T, W, S>, assert!(
    W::BYTES >= 16 && size_of::<Self>() == W::BYTES,
    "a vector of less than 16 bytes can be more than its lanes: keep numbers, and take `load_at` and `store_at`"
));

// A vector of these widths is its lanes and nothing else, on all targets.
macro_rules! whole { ($lanes:tt $($w:ident)*) => {$( whole!(@ $w $lanes); )*};
    (@ $w:ident [$($t:ty)*]) => {$( const _: () = assert!(size_of::<RawOf<$t, $w>>() == $w::BYTES); )*};
}
whole!([u8 u16 u32 u64 i8 i16 i32 i64 f16 bf16 f32 f64] B16 B32 B64 B128 B256 B512);

/// A value is the bits of as many `U` as fit, and stays a value whatever these become.
#[diagnostic::on_unimplemented(
    message = "a slice of `{Self}` can't be changed as one of `{U}`",
    note = "both have to be `Plain`, or `MaybeUninit` of that. The first can be a vector"
)]
pub trait WriteAs<U> {
    const FILLED: [(); 2];
}
impl<T: Plain, U: Plain> WriteAs<U> for T {
    const FILLED: [(); 2] = [check::<T>(), check::<U>()];
}
impl<T: Lane, W: Width, S: Isa, U: Plain> WriteAs<U> for Simd<T, W, S> {
    const FILLED: [(); 2] = [check::<Self>(), check::<U>()];
}
impl<T: Plain, U: Plain> WriteAs<MaybeUninit<U>> for MaybeUninit<T> {
    const FILLED: [(); 2] = [(); 2];
}
// For constants in the public functions: the error then has the line of their caller.
type Fits<T, U> = PhantomData<(T, U)>;
pub(crate) const fn readable<T: AsBytes, U: Plain>() -> Fits<T, U> {
    const { (check::<T>(), check::<U>()) };
    fits()
}
pub(crate) const fn writable<T: WriteAs<U>, U>() -> Fits<T, U> {
    const { T::FILLED };
    fits()
}
const fn fits<T, U>() -> Fits<T, U> {
    assert!(
        size_of::<U>() > 0 && size_of::<T>().is_multiple_of(size_of::<U>()),
        "the size has to be a multiple of that of the result: `as_chunks` makes larger values, and loads and stores take `[u8; 4]` for `u32` without a cast"
    );
    PhantomData
}

#[inline(always)]
#[track_caller]
fn aligned<T, U>(_: &[T], _: Fits<T, U>) {
    require!(of(T, U), "the result needs more alignment: take try_bitcast_slice", align_of::<T>() >= align_of::<U>());
}
#[inline(always)]
fn is_aligned<T, U>(values: &[T], _: Fits<T, U>) -> bool {
    values.as_ptr().addr().is_multiple_of(align_of::<U>()) || size_of_val(values) == 0
}

/// The number of `U`, or `None` for an empty slice that isn't aligned for them.
#[inline(always)]
#[track_caller]
fn count<T, U>(values: &[T], _: Fits<T, U>) -> Option<usize> {
    if const { align_of::<T>() < align_of::<U>() } && !values.as_ptr().addr().is_multiple_of(align_of::<U>()) {
        assert!(size_of_val(values) == 0, "the slice is not aligned for the result");
        return None;
    }
    Some(size_of_val(values) / size_of::<U>())
}

/// The same memory, as values of another type, in the order of bytes of the CPU. Each value becomes one or more of `U`, or else `cargo build` fails.
///
/// It also fails if `U` needs more alignment than the type of the values has: see [`try_bitcast_slice`]. Loads and stores don't need that: they take `[u8; 4]` for `u32` as it is.
///
/// ```
/// # use bun_simd::{bf16, prelude::*}; #[kernel] fn example() {
/// assert_eq!(bitcast_slice::<u32>(&[1f32]), [0x3f80_0000]);
/// assert_eq!(bitcast_slice::<bf16>(&[0x3f80u16]), [bf16::from_f32(1.0)]);
/// assert_eq!(over(bitcast_slice::<u8>(&[true, false, true])).count(|v| v.simd_ne(0)), 2);
/// assert_eq!(bitcast_slice::<u32>(&[u32x4::splat(1), u32x4::splat(2)]), [1, 1, 1, 1, 2, 2, 2, 2]);
/// # } example()
/// ```
#[doc(alias("cast_slice", "reinterpret_cast", "transmute", "flatten", "usize", "u128"))]
#[inline(always)]
#[track_caller]
pub fn bitcast_slice</* only the result */ U: Plain>(values: &[impl AsBytes]) -> &[U] {
    aligned(values, const { readable::<_, U>() });
    read_as(values)
}

/// [`bitcast_slice`] to a type that needs more alignment. It is `None` if the address lacks that, unless there are no bytes.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let bytes = Aligned([1u8; 64]);
/// assert_eq!(try_bitcast_slice::<u16>(bytes[2..4].as_chunks::<2>().0), Some(&[0x0101][..]));
/// assert_eq!(try_bitcast_slice::<u16>(bytes[1..3].as_chunks::<2>().0), None);
/// # } example()
/// ```
#[doc(alias("try_cast_slice", "align_to"))]
#[inline(always)]
pub fn try_bitcast_slice</* only the result */ U: Plain>(values: &[impl AsBytes]) -> Option<&[U]> {
    if is_aligned(values, const { readable::<_, U>() }) { Some(read_as(values)) } else { None }
}

/// Panics if the slice is not aligned.
#[inline(always)]
#[track_caller]
pub(crate) fn read_as<U: Plain>(values: &[impl AsBytes]) -> &[U] {
    let Some(len) = count(values, const { readable::<_, U>() }) else { return &[] };
    // SAFETY: the same bytes, which are aligned, and valid by the bounds.
    #[allow(unsafe_code)]
    unsafe {
        &*core::ptr::slice_from_raw_parts(values.as_ptr().cast(), len)
    }
}

/// [`bitcast_slice`] for a mutable slice of what is [`Plain`](trait@Plain), of vectors, or of `MaybeUninit`, which stays that.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut lines = vec![Aligned([0u8; 64]); 1000 / 16 + 1]; // A buffer that starts at a cache line.
/// let buffer = &mut bitcast_slice_mut::<f32>(&mut lines)[..1000];
/// assert_eq!(buffer.as_ptr().addr() % 64, 0);
/// # } example()
/// ```
#[doc(alias("cast_slice_mut", "reinterpret_cast_mut", "AlignedVec", "aligned_alloc"))]
#[inline(always)]
#[track_caller]
pub fn bitcast_slice_mut</* only the result */ U>(values: &mut [impl WriteAs<U>]) -> &mut [U] {
    aligned(values, const { writable::<_, U>() });
    write_as(values)
}

/// [`try_bitcast_slice`] for what [`bitcast_slice_mut`] takes.
#[doc(alias("try_cast_slice_mut", "align_to_mut"))]
#[inline(always)]
pub fn try_bitcast_slice_mut</* only the result */ U>(values: &mut [impl WriteAs<U>]) -> Option<&mut [U]> {
    if is_aligned(values, const { writable::<_, U>() }) { Some(write_as(values)) } else { None }
}

/// Panics if the slice is not aligned.
#[inline(always)]
#[track_caller]
pub(crate) fn write_as<U>(values: &mut [impl WriteAs<U>]) -> &mut [U] {
    let Some(len) = count(values, const { writable::<_, U>() }) else { return &mut [] };
    // SAFETY: as above, and what is written is valid by the bound.
    #[allow(unsafe_code)]
    unsafe {
        &mut *core::ptr::slice_from_raw_parts_mut(values.as_mut_ptr().cast(), len)
    }
}
