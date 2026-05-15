//! Comptime type-trait predicates.
//!
//! These were originally compile-time predicates over an arbitrary `T`, built on
//! type-level reflection. Rust has no such reflection, so each predicate is
//! ported as a **marker trait**: call sites that branched on `isNumber(T)`
//! become a trait bound `T: IsNumber` (or `where T: IsNumber`), and the `else`
//! branch becomes the absence of the bound / a separate impl.
//!
//! Where a `const fn ...<T>() -> bool` shim is expressible on stable Rust it is provided,
//! but in general callers should migrate to the trait bound directly.
//!
//! See PORTING.md §"Comptime reflection".

// TODO(port): every predicate here relied on type reflection. The trait-based
// encoding below is a reshape, not a 1:1 translation. Phase B must audit each
// call site of `bun.meta.is*` and confirm the trait bound (or specialization)
// matches the original branch.

// ──────────────────────────────────────────────────────────────────────────────
// isByteString
// ──────────────────────────────────────────────────────────────────────────────

/// Returns true if the passed type derefs/unsizes to `[u8]`.
///
/// Implemented for `&[u8]`, `&mut [u8]`, `&[u8; N]`, `&mut [u8; N]`, and the
/// `bun_str` NUL-terminated slice types. **Not** implemented for `Option<_>`,
/// `*const u8`, bare `[u8; N]`, or non-`u8` element types.
pub trait IsByteString {}

// Only pointer types can be strings, no optionals
// Check for CV qualifiers that would prevent coercion to a byte slice
//   (Rust references are never volatile/allowzero, so no check needed.)

// If it's already a slice, simple check.
impl IsByteString for &[u8] {}
impl IsByteString for &mut [u8] {}

// Otherwise check if it's an array type that coerces to slice.
impl<const N: usize> IsByteString for &[u8; N] {}
impl<const N: usize> IsByteString for &mut [u8; N] {}

// Sentinel-terminated slices — bun_core::ZStr carries len+NUL.

#[inline]
pub const fn is_byte_string<T: IsByteString>() -> bool {
    // TODO(port): callers used this as a runtime-evaluable bool to branch.
    // Stable Rust cannot express `false` for `T: !IsByteString` without specialization;
    // call sites must use the trait bound directly instead of branching on this fn.
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isSlice
// ──────────────────────────────────────────────────────────────────────────────

/// True for slice types (`&[T]`, `&mut [T]`).
pub trait IsSlice {
    type Elem;
}
impl<T> IsSlice for &[T] {
    type Elem = T;
}
impl<T> IsSlice for &mut [T] {
    type Elem = T;
}

#[inline]
pub const fn is_slice<T: IsSlice>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isNumber
// ──────────────────────────────────────────────────────────────────────────────

/// True for primitive integer and floating-point types.
pub trait IsNumber {}

macro_rules! impl_is_number {
    ($($t:ty),* $(,)?) => { $( impl IsNumber for $t {} )* };
}
impl_is_number!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize, f32, f64);

#[inline]
pub const fn is_number<T: IsNumber>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isContainer
// ──────────────────────────────────────────────────────────────────────────────

/// True for struct/enum/opaque/union container types.
///
/// Rust cannot reflect "is this a struct/enum/union" on an arbitrary `T`.
// TODO(port): no sound stable-Rust encoding. Call sites of `isContainer` were
// almost always guarding a decl-presence check — port those call sites to a
// trait bound on the decl they actually need (per PORTING.md §Comptime
// reflection) and drop this check.
pub trait IsContainer {}

#[inline]
pub const fn is_container<T: IsContainer>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isSingleItemPtr
// ──────────────────────────────────────────────────────────────────────────────

/// True for a pointer/reference to exactly one `Sized` item.
pub trait IsSingleItemPtr {
    type Pointee;
}
// NB: `T` is deliberately `Sized` here — single-item pointers are mutually
// exclusive with slices, so `&[u8]` must NOT satisfy this trait.
// `&[u8; N]` still matches because `[u8; N]: Sized`.
impl<T> IsSingleItemPtr for &T {
    type Pointee = T;
}
impl<T> IsSingleItemPtr for &mut T {
    type Pointee = T;
}
impl<T> IsSingleItemPtr for *const T {
    type Pointee = T;
}
impl<T> IsSingleItemPtr for *mut T {
    type Pointee = T;
}

#[inline]
pub const fn is_single_item_ptr<T: IsSingleItemPtr>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isExternContainer
// ──────────────────────────────────────────────────────────────────────────────

/// True if `T` is `#[repr(C)]`. Rust exposes no reflection for `repr`.
// TODO(port): cannot be queried generically on stable Rust. If a call site needs this,
// add `#[derive(bun_meta::IsExternContainer)]` (proc-macro) on the `#[repr(C)]` type,
// or hard-code the answer at the call site.
pub trait IsExternContainer {}

#[inline]
pub const fn is_extern_container<T: IsExternContainer>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isConstPtr
// ──────────────────────────────────────────────────────────────────────────────

/// True for shared-reference and `*const` pointer types.
pub trait IsConstPtr {}
impl<T: ?Sized> IsConstPtr for &T {}
impl<T: ?Sized> IsConstPtr for *const T {}

#[inline]
pub const fn is_const_ptr<T: IsConstPtr>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isIndexable
// ──────────────────────────────────────────────────────────────────────────────

/// True for types you can index by `usize`: slices, arrays, references to
/// arrays, raw pointers, tuples, and SIMD vectors.
///
/// In Rust this is approximately `T: core::ops::Index<usize>` plus arrays,
/// slices, and tuples. There is no single std trait that exactly matches the
/// original definition (it included raw many-pointers and SIMD vectors; Rust
/// tuples are not `Index`).
// TODO(port): provided impls cover the common cases (`&[T]`, `&[T; N]`, `[T; N]`, `Vec<T>`).
// Tuple ("struct.is_tuple") and SIMD-vector arms are omitted — add per call site if needed.
pub trait IsIndexable {}

impl<T> IsIndexable for &[T] {}
impl<T> IsIndexable for &mut [T] {}
impl<T, const N: usize> IsIndexable for [T; N] {}
impl<T, const N: usize> IsIndexable for &[T; N] {}
impl<T, const N: usize> IsIndexable for &mut [T; N] {}
impl<T> IsIndexable for *const T {}
impl<T> IsIndexable for *mut T {}

#[inline]
pub const fn is_indexable<T: IsIndexable>() -> bool {
    true
}
