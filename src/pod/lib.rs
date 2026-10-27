#![doc = include_str!("README.md")]
#![no_std]
#![feature(transmutability)]

#[cfg(any(test, feature = "alloc"))]
extern crate alloc;

use core::mem::{align_of, size_of, size_of_val};

mod foreign;

/// The all-zero byte pattern is a valid `Self`.
pub unsafe trait Zeroable: Sized {}

/// Every byte of every `Self` is initialized: no padding, no `MaybeUninit`, no pointers.
pub unsafe trait NoUninit: Copy + 'static {}

/// Every byte pattern is a valid `Self`, and safe code relies on no invariant between its fields.
pub unsafe trait AnyBitPattern: Zeroable + Copy + 'static {}

/// Bytes and values convert both ways, which is what a `&mut` view needs.
pub trait Pod: NoUninit + AnyBitPattern {}
impl<T: NoUninit + AnyBitPattern> Pod for T {}

/// What the `impl_*!` macros make rustc prove. Each function is a bound and nothing else.
#[doc(hidden)]
pub mod proof {
    use core::mem::{Assume, TransmuteFrom, size_of};

    /// A byte that can only be zero.
    #[repr(u8)]
    #[derive(Clone, Copy)]
    pub enum Zero {
        Zero = 0,
    }

    /// Fails while the array type is still being formed, before the analysis can overflow rustc's stack.
    pub const fn len<T>() -> usize {
        assert!(
            size_of::<T>() <= 4096,
            "too large for rustc to analyze: write an `unsafe impl`",
        );
        size_of::<T>()
    }

    // `Assume::SAFETY` waives library invariants, which rustc cannot see: README, "What the proof leaves to you".
    pub const fn no_uninit<T, Bytes>()
    where
        Bytes: TransmuteFrom<T, { Assume::SAFETY }>,
    {
    }
    pub const fn any_bit_pattern<T, Bytes>()
    where
        T: TransmuteFrom<Bytes, { Assume::SAFETY }>,
    {
    }
    pub const fn zeroable<T, Zeros>()
    where
        T: TransmuteFrom<Zeros, { Assume::SAFETY }>,
    {
    }
}

/// Implements [`NoUninit`] for each type, or fails to compile if a byte of it can be uninitialized.
#[macro_export]
macro_rules! impl_no_uninit {
    ($($T:ty),+ $(,)?) => {$(
        const _: () = $crate::proof::no_uninit::<$T, [u8; $crate::proof::len::<$T>()]>();
        // SAFETY: proven by the line above.
        unsafe impl $crate::NoUninit for $T {}
    )+};
}

/// Implements [`AnyBitPattern`] and [`Zeroable`] for each type, or fails to compile if some byte pattern is not a value of it.
#[macro_export]
macro_rules! impl_any_bit_pattern {
    ($($T:ty),+ $(,)?) => {$(
        const _: () = $crate::proof::any_bit_pattern::<$T, [u8; $crate::proof::len::<$T>()]>();
        // SAFETY: all-zero is one of the byte patterns proven valid above.
        unsafe impl $crate::Zeroable for $T {}
        // SAFETY: proven by the `const` above.
        unsafe impl $crate::AnyBitPattern for $T {}
    )+};
}

/// [`impl_no_uninit!`] and [`impl_any_bit_pattern!`], which together make each type [`Pod`].
#[macro_export]
macro_rules! impl_pod {
    ($($T:ty),+ $(,)?) => {
        $crate::impl_no_uninit!($($T),+);
        $crate::impl_any_bit_pattern!($($T),+);
    };
}

/// Implements [`Zeroable`] for each pointer-free type, or fails to compile if all-zero is not a value of it.
#[macro_export]
macro_rules! impl_zeroable {
    ($($T:ty),+ $(,)?) => {$(
        const _: () =
            $crate::proof::zeroable::<$T, [$crate::proof::Zero; $crate::proof::len::<$T>()]>();
        // SAFETY: proven by the line above.
        unsafe impl $crate::Zeroable for $T {}
    )+};
}

impl_pod!(
    (),
    u8,
    u16,
    u32,
    u64,
    u128,
    usize,
    i8,
    i16,
    i32,
    i64,
    i128,
    isize,
    f32,
    f64
);
impl_no_uninit!(bool, char);
impl_zeroable!(bool, char);

// SAFETY: null is a valid raw pointer.
unsafe impl<T> Zeroable for *const T {}
// SAFETY: null is a valid raw pointer.
unsafe impl<T> Zeroable for *mut T {}
// SAFETY: an array holds nothing but its elements.
unsafe impl<T: Zeroable, const N: usize> Zeroable for [T; N] {}
// SAFETY: an array holds nothing but its elements, with no padding between them.
unsafe impl<T: NoUninit, const N: usize> NoUninit for [T; N] {}
// SAFETY: an array holds nothing but its elements.
unsafe impl<T: AnyBitPattern, const N: usize> AnyBitPattern for [T; N] {}

/// A `T` with alignment 1, for bytes whose address Bun does not control.
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct Unaligned<T: Copy>(T);

impl<T: Copy> Unaligned<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(value)
    }
    #[inline(always)]
    pub const fn get(self) -> T {
        self.0
    }
}

impl<T: AnyBitPattern> Unaligned<T> {
    /// The whole `T`s in `bytes`, leaving out a trailing partial one. Cannot fail.
    #[inline]
    pub fn slice_of(bytes: &[u8]) -> &[Self] {
        cast_slice(&bytes[..bytes.len() - bytes.len() % size_of::<T>()])
    }
}

impl<T: Pod> Unaligned<T> {
    /// [`Self::slice_of`], writable.
    #[inline]
    pub fn slice_of_mut(bytes: &mut [u8]) -> &mut [Self] {
        let whole = bytes.len() - bytes.len() % size_of::<T>();
        cast_slice_mut(&mut bytes[..whole])
    }
}

// SAFETY: same bytes as `T`.
unsafe impl<T: Zeroable + Copy> Zeroable for Unaligned<T> {}
// SAFETY: same bytes as `T`; one packed field leaves no padding.
unsafe impl<T: NoUninit> NoUninit for Unaligned<T> {}
// SAFETY: same bytes as `T`.
unsafe impl<T: AnyBitPattern> AnyBitPattern for Unaligned<T> {}

/// The all-zero `T`.
#[inline(always)]
pub const fn zeroed<T: Zeroable>() -> T {
    // SAFETY: `T: Zeroable`.
    unsafe { core::mem::zeroed() }
}

/// The bytes of `value`.
#[inline(always)]
pub const fn bytes_of<T: NoUninit>(value: &T) -> &[u8] {
    slice_as_bytes(core::slice::from_ref(value))
}

/// The bytes of `value`, writable.
#[inline(always)]
pub const fn bytes_of_mut<T: Pod>(value: &mut T) -> &mut [u8] {
    slice_as_bytes_mut(core::slice::from_mut(value))
}

/// Copies a `T` out of the front of `bytes`, whatever their alignment. `None` if there are too few.
#[inline(always)]
pub const fn read_prefix<T: AnyBitPattern>(bytes: &[u8]) -> Option<T> {
    if bytes.len() < size_of::<T>() {
        return None;
    }
    // SAFETY: `size_of::<T>()` initialized bytes are readable at `bytes`, and
    // any such bytes are a valid `T`.
    Some(unsafe { bytes.as_ptr().cast::<T>().read_unaligned() })
}

/// The bytes of `slice`. Cannot fail: `u8` has alignment 1 and size 1.
#[inline(always)]
pub const fn slice_as_bytes<T: NoUninit>(slice: &[T]) -> &[u8] {
    // SAFETY: same allocation and extent; every byte is initialized.
    unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<u8>(), size_of_val(slice)) }
}

/// The bytes of `slice`, writable. Cannot fail.
#[inline(always)]
pub const fn slice_as_bytes_mut<T: Pod>(slice: &mut [T]) -> &mut [u8] {
    let len = size_of_val(slice);
    // SAFETY: same allocation and extent; every byte is initialized, and any
    // bytes written back are a valid `T`.
    unsafe { core::slice::from_raw_parts_mut(slice.as_mut_ptr().cast::<u8>(), len) }
}

/// Why `&[A]` cannot be viewed as `&[B]`.
#[derive(Clone, Copy)]
enum CastError {
    Misaligned { address: usize, align: usize },
    PartialElement { bytes: usize, size: usize },
}

/// The pointer and length of `&[B]` over the `len` elements of `A` at `ptr`.
#[inline]
fn cast_parts<A, B>(ptr: *mut A, len: usize) -> Result<(*mut B, usize), CastError> {
    const {
        assert!(
            size_of::<A>() != 0 && size_of::<B>() != 0,
            "cast_slice: zero-sized element"
        );
    }
    if align_of::<B>() > align_of::<A>() && !ptr.cast::<B>().is_aligned() {
        // Often a dangling pointer, which says nothing about the data it stands for.
        if len == 0 {
            return Ok((core::ptr::dangling_mut(), 0));
        }
        return Err(CastError::Misaligned {
            address: ptr.addr(),
            align: align_of::<B>(),
        });
    }
    // Cannot overflow: the slice exists, so its size fits in `isize`.
    let bytes = len * size_of::<A>();
    if !size_of::<A>().is_multiple_of(size_of::<B>()) && !bytes.is_multiple_of(size_of::<B>()) {
        return Err(CastError::PartialElement {
            bytes,
            size: size_of::<B>(),
        });
    }
    Ok((ptr.cast::<B>(), bytes / size_of::<B>()))
}

/// One copy for every `A` and `B`; `#[track_caller]` names the cast.
#[cold]
#[inline(never)]
#[track_caller]
fn cast_failed(error: CastError) -> ! {
    match error {
        CastError::Misaligned { address, align } => {
            panic!("cast_slice: {address:#x} is not aligned to {align}")
        }
        CastError::PartialElement { bytes, size } => {
            panic!("cast_slice: {bytes} bytes are not a whole number of {size}-byte elements")
        }
    }
}

#[inline]
fn cast_ref<A: NoUninit, B: AnyBitPattern>(a: &[A]) -> Result<&[B], CastError> {
    let (ptr, len) = cast_parts::<A, B>(a.as_ptr().cast_mut(), a.len())?;
    // SAFETY: aligned and within `a` (or empty) per `cast_parts`; every byte
    // is initialized, and any initialized bytes are valid `B`s.
    Ok(unsafe { core::slice::from_raw_parts(ptr, len) })
}

#[inline]
fn cast_mut<A: Pod, B: Pod>(a: &mut [A]) -> Result<&mut [B], CastError> {
    let (ptr, len) = cast_parts::<A, B>(a.as_mut_ptr(), a.len())?;
    // SAFETY: as `cast_ref`; `Pod` on both sides makes what is written through
    // either view valid for the other.
    Ok(unsafe { core::slice::from_raw_parts_mut(ptr, len) })
}

/// `&[A]` as `&[B]`. `None` if the data is misaligned for `B` or does not divide into whole `B`s.
#[inline]
pub fn try_cast_slice<A: NoUninit, B: AnyBitPattern>(a: &[A]) -> Option<&[B]> {
    cast_ref(a).ok()
}

/// `&mut [A]` as `&mut [B]`. `None` as for [`try_cast_slice`].
#[inline]
pub fn try_cast_slice_mut<A: Pod, B: Pod>(a: &mut [A]) -> Option<&mut [B]> {
    cast_mut(a).ok()
}

/// `&[A]` as `&[B]`, for a layout the caller has established. Panics where [`try_cast_slice`] returns `None`.
#[inline]
#[track_caller]
pub fn cast_slice<A: NoUninit, B: AnyBitPattern>(a: &[A]) -> &[B] {
    match cast_ref(a) {
        Ok(b) => b,
        Err(error) => cast_failed(error),
    }
}

/// `&mut [A]` as `&mut [B]`. Panics where [`try_cast_slice_mut`] returns `None`.
#[inline]
#[track_caller]
pub fn cast_slice_mut<A: Pod, B: Pod>(a: &mut [A]) -> &mut [B] {
    match cast_mut(a) {
        Ok(b) => b,
        Err(error) => cast_failed(error),
    }
}

/// Copies `bytes` into a `Vec<T>`, whatever their alignment. `None` if they do not divide into whole `T`s.
#[cfg(any(test, feature = "alloc"))]
pub fn vec_from_bytes<T: AnyBitPattern>(bytes: &[u8]) -> Option<alloc::vec::Vec<T>> {
    let elements: &[Unaligned<T>] = try_cast_slice(bytes)?;
    Some(elements.iter().map(|element| element.get()).collect())
}

#[cfg(test)]
mod tests;
