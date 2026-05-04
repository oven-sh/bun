//! Comptime type-trait predicates.
//!
//! The Zig original (`src/meta/traits.zig`) is a set of `inline fn(comptime T: type) bool`
//! helpers built on `@typeInfo(T)`. Rust has no `@typeInfo` reflection, so each predicate
//! is ported as a **marker trait**: call sites that did `if (bun.meta.isNumber(T)) { ... }`
//! become a trait bound `T: IsNumber` (or `where T: IsNumber`), and the `else` branch
//! becomes the absence of the bound / a separate impl.
//!
//! Where a `const fn ...<T>() -> bool` shim is expressible on stable Rust it is provided,
//! but in general callers should migrate to the trait bound directly.
//!
//! See PORTING.md §"Comptime reflection".

// TODO(port): every predicate here relied on `@typeInfo`. The trait-based encoding below
// is a reshape, not a 1:1 translation. Phase B must audit each call site of
// `bun.meta.is*` and confirm the trait bound (or specialization) matches the Zig branch.

// ──────────────────────────────────────────────────────────────────────────────
// isZigString
// ──────────────────────────────────────────────────────────────────────────────

/// Returns true if the passed type will coerce to `[]const u8`.
/// Any of the following are considered strings:
/// ```text
/// []const u8, [:S]const u8, *const [N]u8, *const [N:S]u8,
/// []u8, [:S]u8, *[:S]u8, *[N:S]u8.
/// ```
/// These types are not considered strings:
/// ```text
/// u8, [N]u8, [*]const u8, [*:0]const u8,
/// [*]const [N]u8, []const u16, []const i8,
/// *const u8, ?[]const u8, ?*const [N]u8.
/// ```
///
/// In Rust the closest equivalent of "coerces to `[]const u8`" is "derefs/unsizes to
/// `[u8]`". Implemented for `&[u8]`, `&mut [u8]`, `&[u8; N]`, `&mut [u8; N]`, and the
/// `bun_str` NUL-terminated slice types. **Not** implemented for `Option<_>`, `*const u8`,
/// bare `[u8; N]`, or non-`u8` element types — matching the Zig exclusion list.
pub trait IsZigString {}

// Only pointer types can be strings, no optionals
// Check for CV qualifiers that would prevent coercion to []const u8
//   (Rust references are never volatile/allowzero, so no check needed.)

// If it's already a slice, simple check.
impl IsZigString for &[u8] {}
impl IsZigString for &mut [u8] {}

// Otherwise check if it's an array type that coerces to slice.
impl<const N: usize> IsZigString for &[u8; N] {}
impl<const N: usize> IsZigString for &mut [u8; N] {}

// Sentinel-terminated slices ([:S]const u8 / [:S]u8) — bun_str::ZStr carries len+NUL.
impl IsZigString for &bun_str::ZStr {}
impl IsZigString for &mut bun_str::ZStr {}

#[inline]
pub const fn is_zig_string<T: IsZigString>() -> bool {
    // TODO(port): Zig callers used this as a runtime-evaluable comptime bool to branch.
    // Stable Rust cannot express `false` for `T: !IsZigString` without specialization;
    // call sites must use the trait bound directly instead of branching on this fn.
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isSlice
// ──────────────────────────────────────────────────────────────────────────────

/// `@typeInfo(T) == .pointer and .pointer.size == .slice`
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

/// `.int | .float | .comptime_int | .comptime_float`
///
/// Rust has no `comptime_int`/`comptime_float`; integer and float literals are already
/// inferred to a concrete primitive, so only the concrete primitives are listed.
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

/// `.struct | .enum | .opaque | .union`
///
/// Rust cannot reflect "is this a struct/enum/union" on an arbitrary `T`.
// TODO(port): no sound stable-Rust encoding. Call sites of `isContainer` in Zig are
// almost always guarding `@hasDecl(T, "...")` — port those call sites to a trait bound
// on the decl they actually need (per PORTING.md §Comptime reflection) and drop this check.
pub trait IsContainer {}

#[inline]
pub const fn is_container<T: IsContainer>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isSingleItemPtr
// ──────────────────────────────────────────────────────────────────────────────

/// `@typeInfo(T) == .pointer and .pointer.size == .One`
// PORT NOTE: the Zig source has a typo (`.pointer.size` instead of `info.pointer.size`)
// which would not compile; preserving the intended semantics here.
pub trait IsSingleItemPtr {
    type Pointee: ?Sized;
}
impl<T: ?Sized> IsSingleItemPtr for &T {
    type Pointee = T;
}
impl<T: ?Sized> IsSingleItemPtr for &mut T {
    type Pointee = T;
}
impl<T: ?Sized> IsSingleItemPtr for *const T {
    type Pointee = T;
}
impl<T: ?Sized> IsSingleItemPtr for *mut T {
    type Pointee = T;
}

#[inline]
pub const fn is_single_item_ptr<T: IsSingleItemPtr>() -> bool {
    true
}

// ──────────────────────────────────────────────────────────────────────────────
// isExternContainer
// ──────────────────────────────────────────────────────────────────────────────

/// `.struct => |s| s.layout == .extern` / `.union => |u| u.layout == .extern`
///
/// i.e. "is `T` `#[repr(C)]`". Rust exposes no reflection for `repr`.
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

/// `@typeInfo(T) == .pointer and info.pointer.is_const`
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

/// ```text
/// .pointer => |ptr| switch (ptr.size) {
///     .One => @typeInfo(ptr.child) == .array,
///     else => true,
/// },
/// .array, .vector => true,
/// .struct => |s| s.is_tuple,
/// else => false,
/// ```
///
/// In Rust this is approximately `T: core::ops::Index<usize>` plus arrays, slices, and
/// tuples. There is no single std trait that exactly matches Zig's definition (Zig
/// includes raw many-pointers and SIMD vectors; Rust tuples are not `Index`).
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

// ──────────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/meta/traits.zig (89 lines)
//   confidence: low
//   todos:      4
//   notes:      pure @typeInfo reflection helpers; reshaped to marker traits — Phase B must rewrite each call site to use trait bounds (no bool-returning generic fn is sound on stable Rust without specialization)
// ──────────────────────────────────────────────────────────────────────────────
