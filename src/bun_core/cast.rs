//! Safe zero-cost reinterpretation between plain-data types.
//!
//! In-tree replacement for the subset of the `bytemuck` crate Bun uses: four
//! marker traits plus a handful of slice/value casts. Everything here is
//! `core`-only so the freestanding `#![no_std]` Windows shim can reuse the
//! same source via its local `bun_core` stand-in.
//!
//! The trait hierarchy matches upstream so existing `unsafe impl` sites keep
//! their documented safety contracts unchanged:
//!
//! ```text
//!   Zeroable            NoUninit
//!       ^                   ^
//!       |                   |
//!   AnyBitPattern <──────── Pod
//! ```

use core::mem::{align_of, size_of};

// ── Marker traits ───────────────────────────────────────────────────────────

/// Marker: the all-zero bit pattern is a valid value of `Self`.
///
/// # Safety
/// `Self` must be inhabited at the all-zero bit pattern: no `NonNull`/
/// `NonZero*`/references/fn pointers, no niche-optimised enums.
pub unsafe trait Zeroable: Sized {
    /// All-bits-zero value of `Self`. Do not override.
    #[inline(always)]
    fn zeroed() -> Self {
        // SAFETY: trait contract guarantees all-zero is a valid `Self`.
        unsafe { core::mem::zeroed() }
    }
}

/// Marker: every bit pattern is a valid `Self` (padding bytes permitted).
///
/// # Safety
/// `Self` must be inhabited for *every* bit pattern of its backing storage,
/// contain no interior mutability, and be `Copy + 'static`. `#[repr(C)]`
/// structs with padding qualify; enums do not.
pub unsafe trait AnyBitPattern: Zeroable + Copy + 'static {}

/// Marker: `Self` has no uninitialized (padding) bytes.
///
/// # Safety
/// Every byte of `Self`'s storage must be initialized: no padding, no
/// `MaybeUninit`. `#[repr(Int)]` enums and padding-free `#[repr(C)]` structs
/// qualify. Interior mutability is forbidden.
pub unsafe trait NoUninit: Copy + Sized + 'static {}

/// Marker: plain old data. Implies both [`NoUninit`] and [`AnyBitPattern`].
///
/// # Safety
/// The union of the [`NoUninit`] and [`AnyBitPattern`] contracts: `Self` must
/// be `Copy + 'static`, have no padding, allow every bit pattern, and contain
/// no interior mutability.
pub unsafe trait Pod: Zeroable + Copy + 'static {}

// SAFETY: `Pod`'s contract is a superset of `NoUninit`'s.
unsafe impl<T: Pod> NoUninit for T {}
// SAFETY: `Pod`'s contract is a superset of `AnyBitPattern`'s.
unsafe impl<T: Pod> AnyBitPattern for T {}

/// Marker: `Self` is `#[repr(transparent)]` over `Inner`.
///
/// # Safety
/// `Self` must be `#[repr(transparent)]` with `Inner` as its single non-ZST
/// field, so the two have identical size, alignment, and ABI.
pub unsafe trait TransparentWrapper<Inner: ?Sized> {
    /// View `&[Self]` as `&[Inner]`.
    #[inline]
    fn peel_slice(s: &[Self]) -> &[Inner]
    where
        Self: Sized,
        Inner: Sized,
    {
        assert!(size_of::<Self>() == size_of::<Inner>());
        assert!(align_of::<Self>() == align_of::<Inner>());
        // SAFETY: `#[repr(transparent)]` per trait contract ⇒ identical layout.
        unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<Inner>(), s.len()) }
    }
}

// ── Primitive impls ─────────────────────────────────────────────────────────

macro_rules! impl_pod {
    ($($t:ty),* $(,)?) => { $(
        // SAFETY: primitive numeric/unit type — zero is valid.
        unsafe impl Zeroable for $t {}
        // SAFETY: primitive numeric/unit type — no padding, every bit pattern valid.
        unsafe impl Pod for $t {}
    )* };
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

// SAFETY: array of `Zeroable` is `Zeroable`.
unsafe impl<T: Zeroable, const N: usize> Zeroable for [T; N] {}
// SAFETY: array of `Pod` has no padding between elements and every bit pattern is valid.
unsafe impl<T: Pod, const N: usize> Pod for [T; N] {}

// SAFETY: `Wrapping` is `#[repr(transparent)]` over `T`.
unsafe impl<T: Zeroable> Zeroable for core::num::Wrapping<T> {}
// SAFETY: `Wrapping` is `#[repr(transparent)]` over `T`.
unsafe impl<T: Pod> Pod for core::num::Wrapping<T> {}

// SAFETY: `PhantomData` is a ZST; trivially zero-valid.
unsafe impl<T: ?Sized> Zeroable for core::marker::PhantomData<T> {}
// SAFETY: `PhantomData` is a ZST; trivially `Pod`.
unsafe impl<T: ?Sized + 'static> Pod for core::marker::PhantomData<T> {}

// `bool` / `char` / `NonZero*`: every byte is initialized, but not every bit
// pattern is valid ⇒ `NoUninit` only.
macro_rules! impl_nouninit {
    ($($t:ty),* $(,)?) => { $(
        // SAFETY: type has no padding bytes; every byte is initialized.
        unsafe impl NoUninit for $t {}
    )* };
}
impl_nouninit!(
    bool,
    char,
    core::num::NonZeroU8,
    core::num::NonZeroU16,
    core::num::NonZeroU32,
    core::num::NonZeroU64,
    core::num::NonZeroU128,
    core::num::NonZeroUsize,
    core::num::NonZeroI8,
    core::num::NonZeroI16,
    core::num::NonZeroI32,
    core::num::NonZeroI64,
    core::num::NonZeroI128,
    core::num::NonZeroIsize,
);

// ── Error type ──────────────────────────────────────────────────────────────

/// Reason a checked cast was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PodCastError {
    /// Target alignment exceeds source alignment and the input pointer is misaligned.
    TargetAlignmentGreaterAndInputNotAligned,
    /// Input byte length is not a multiple of the target element size.
    OutputSliceWouldHaveSlop,
    /// Source and target sizes differ for a `&T`/`T` cast.
    SizeMismatch,
}

impl core::fmt::Display for PodCastError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Debug::fmt(self, f)
    }
}

#[cold]
#[inline(never)]
#[track_caller]
fn cast_panic(which: &str, e: PodCastError) -> ! {
    panic!("cast::{which}: {e:?}")
}

#[inline(always)]
fn is_aligned_to(p: *const (), align: usize) -> bool {
    (p as usize).is_multiple_of(align)
}

// ── Value / reference casts ─────────────────────────────────────────────────

/// View `&T` as `&[u8]`. Never panics (`align_of::<u8>() == 1`).
#[inline(always)]
#[track_caller]
pub fn bytes_of<T: NoUninit>(t: &T) -> &[u8] {
    // SAFETY: `NoUninit` ⇒ every byte initialized; `u8` has align 1.
    unsafe { core::slice::from_raw_parts(core::ptr::from_ref(t).cast::<u8>(), size_of::<T>()) }
}

/// View `&mut T` as `&mut [u8]`. Never panics.
#[inline(always)]
#[track_caller]
pub fn bytes_of_mut<T: Pod>(t: &mut T) -> &mut [u8] {
    // SAFETY: `Pod` ⇒ no padding and every bit pattern valid; `u8` has align 1.
    unsafe { core::slice::from_raw_parts_mut(core::ptr::from_mut(t).cast::<u8>(), size_of::<T>()) }
}

/// View `&A` as `&B`. Panics if sizes differ or `a` is misaligned for `B`.
#[inline]
#[track_caller]
pub fn cast_ref<A: NoUninit, B: AnyBitPattern>(a: &A) -> &B {
    if size_of::<A>() != size_of::<B>() {
        cast_panic("cast_ref", PodCastError::SizeMismatch)
    }
    let p = core::ptr::from_ref(a);
    if align_of::<B>() > align_of::<A>() && !is_aligned_to(p.cast::<()>(), align_of::<B>()) {
        cast_panic(
            "cast_ref",
            PodCastError::TargetAlignmentGreaterAndInputNotAligned,
        )
    }
    // SAFETY: size matches, alignment verified, `NoUninit` source ⇒ every byte
    // initialized, `AnyBitPattern` target ⇒ every byte pattern valid.
    unsafe { &*p.cast::<B>() }
}

/// Copy a `T` out of a byte slice without requiring alignment.
/// Panics if `bytes.len() != size_of::<T>()`.
#[inline]
#[track_caller]
pub fn pod_read_unaligned<T: AnyBitPattern>(bytes: &[u8]) -> T {
    if bytes.len() != size_of::<T>() {
        cast_panic("pod_read_unaligned", PodCastError::SizeMismatch)
    }
    // SAFETY: length checked; `AnyBitPattern` ⇒ every byte pattern valid;
    // `read_unaligned` has no alignment requirement.
    unsafe { bytes.as_ptr().cast::<T>().read_unaligned() }
}

// ── Slice casts ─────────────────────────────────────────────────────────────

/// Try to view `&[A]` as `&[B]` (length recomputed from byte size).
#[inline]
pub fn try_cast_slice<A: NoUninit, B: AnyBitPattern>(a: &[A]) -> Result<&[B], PodCastError> {
    let input_bytes = core::mem::size_of_val(a);
    if align_of::<B>() > align_of::<A>() && !is_aligned_to(a.as_ptr().cast::<()>(), align_of::<B>())
    {
        Err(PodCastError::TargetAlignmentGreaterAndInputNotAligned)
    } else if size_of::<B>() == size_of::<A>() {
        // SAFETY: same element size ⇒ same length; alignment verified above;
        // `NoUninit`/`AnyBitPattern` discharge the value-validity obligations.
        Ok(unsafe { core::slice::from_raw_parts(a.as_ptr().cast::<B>(), a.len()) })
    } else if size_of::<B>() == 0 {
        if input_bytes == 0 {
            // SAFETY: empty ZST slice; dangling pointer is valid for ZSTs.
            Ok(unsafe { core::slice::from_raw_parts(core::ptr::NonNull::dangling().as_ptr(), 0) })
        } else {
            Err(PodCastError::OutputSliceWouldHaveSlop)
        }
    } else if input_bytes.is_multiple_of(size_of::<B>()) {
        let new_len = input_bytes / size_of::<B>();
        // SAFETY: byte length divides evenly; alignment verified; trait bounds
        // discharge value-validity.
        Ok(unsafe { core::slice::from_raw_parts(a.as_ptr().cast::<B>(), new_len) })
    } else {
        Err(PodCastError::OutputSliceWouldHaveSlop)
    }
}

/// View `&[A]` as `&[B]`. Panics on misalignment or size slop.
#[inline]
#[track_caller]
pub fn cast_slice<A: NoUninit, B: AnyBitPattern>(a: &[A]) -> &[B] {
    match try_cast_slice(a) {
        Ok(b) => b,
        Err(e) => cast_panic("cast_slice", e),
    }
}

/// View `&mut [A]` as `&mut [B]`. Panics on misalignment or size slop.
///
/// Both bounds are `NoUninit + AnyBitPattern` (i.e. effectively `Pod`): the
/// mutable view lets bytes flow either way, so both directions must be valid.
#[inline]
#[track_caller]
pub fn cast_slice_mut<A: NoUninit + AnyBitPattern, B: NoUninit + AnyBitPattern>(
    a: &mut [A],
) -> &mut [B] {
    let input_bytes = core::mem::size_of_val::<[A]>(a);
    if align_of::<B>() > align_of::<A>() && !is_aligned_to(a.as_ptr().cast::<()>(), align_of::<B>())
    {
        cast_panic(
            "cast_slice_mut",
            PodCastError::TargetAlignmentGreaterAndInputNotAligned,
        )
    }
    if size_of::<B>() == size_of::<A>() {
        // SAFETY: same element size; alignment verified; `Pod`-equivalent bounds.
        return unsafe { core::slice::from_raw_parts_mut(a.as_mut_ptr().cast::<B>(), a.len()) };
    }
    if size_of::<B>() == 0 {
        if input_bytes == 0 {
            // SAFETY: empty ZST slice.
            return unsafe {
                core::slice::from_raw_parts_mut(core::ptr::NonNull::dangling().as_ptr(), 0)
            };
        }
        cast_panic("cast_slice_mut", PodCastError::OutputSliceWouldHaveSlop)
    }
    if !input_bytes.is_multiple_of(size_of::<B>()) {
        cast_panic("cast_slice_mut", PodCastError::OutputSliceWouldHaveSlop)
    }
    let new_len = input_bytes / size_of::<B>();
    // SAFETY: byte length divides evenly; alignment verified; `Pod`-equivalent bounds.
    unsafe { core::slice::from_raw_parts_mut(a.as_mut_ptr().cast::<B>(), new_len) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_u16_to_u8_roundtrip() {
        let src: [u16; 3] = [0x0201, 0x0403, 0x0605];
        let bytes: &[u8] = cast_slice(&src);
        assert_eq!(bytes, &[1, 2, 3, 4, 5, 6]);
        let back: &[u16] = cast_slice(bytes);
        assert_eq!(back, &src);
    }

    #[test]
    fn bytes_of_struct() {
        #[repr(C)]
        #[derive(Clone, Copy)]
        struct P {
            a: u16,
            b: u16,
        }
        // SAFETY: two `u16` fields, `#[repr(C)]`, no padding.
        unsafe impl Zeroable for P {}
        // SAFETY: two `u16` fields, `#[repr(C)]`, no padding.
        unsafe impl Pod for P {}
        let p = P {
            a: 0x0201,
            b: 0x0403,
        };
        assert_eq!(bytes_of(&p), &[1, 2, 3, 4]);
    }

    #[test]
    fn cast_ref_array() {
        let a: [u64; 2] = [1, 2];
        let b: &[u8; 16] = cast_ref(&a);
        assert_eq!(b[0], 1);
        assert_eq!(b[8], 2);
    }

    #[test]
    fn read_unaligned() {
        let bytes = [0u8, 1, 2, 3, 4];
        let v: u32 = pod_read_unaligned(&bytes[1..5]);
        assert_eq!(v, u32::from_ne_bytes([1, 2, 3, 4]));
    }

    // `#[repr(C, align(2))]` guarantees an even base address *and* field offset
    // 0, so `&a.0` is spec-2-aligned and the alignment branch of
    // `try_cast_slice` is deterministic in both tests below.
    #[repr(C, align(2))]
    struct Aligned2<const N: usize>([u8; N]);

    #[test]
    fn try_cast_rejects_slop() {
        let a = Aligned2([0u8; 3]);
        assert_eq!(
            try_cast_slice::<u8, u16>(&a.0).unwrap_err(),
            PodCastError::OutputSliceWouldHaveSlop
        );
    }

    #[test]
    fn try_cast_rejects_misalign() {
        let a = Aligned2([0u8; 6]);
        let odd = &a.0[1..5];
        assert_eq!(
            try_cast_slice::<u8, u16>(odd).unwrap_err(),
            PodCastError::TargetAlignmentGreaterAndInputNotAligned
        );
    }

    #[test]
    fn empty_slices() {
        let e: &[u32] = &[];
        let b: &[u8] = cast_slice(e);
        assert!(b.is_empty());
        let back: &[u32] = cast_slice(b);
        assert!(back.is_empty());
    }

    #[test]
    fn transparent_peel() {
        #[repr(transparent)]
        struct W(u32);
        // SAFETY: `#[repr(transparent)]` over `u32`.
        unsafe impl TransparentWrapper<u32> for W {}
        let ws = [W(1), W(2), W(3)];
        let inner: &[u32] = W::peel_slice(&ws);
        assert_eq!(inner, &[1, 2, 3]);
    }
}
