//! In some parts of lockfile serialization, Bun will use the equivalent of `std.mem.sliceAsBytes` to convert a
//! struct into raw bytes to write. This makes lockfile serialization/deserialization much simpler/faster, at the
//! cost of not having any pointers within these structs.
//!
//! One major caveat of this is that if any of these structs have uninitialized memory, then that can leak
//! garbage memory into the lockfile. See https://github.com/oven-sh/bun/issues/4319
//!
//! The obvious way to introduce undefined memory into a struct is via `.field = MaybeUninit::uninit()`, but a
//! much more subtle way is to have implicit padding in a `#[repr(C)]` struct. For example:
//! ```ignore
//! #[repr(C)]
//! struct Demo {
//!     a: u8,  // size_of == 1, offset_of == 0
//!     b: u64, // size_of == 8, offset_of == 8
//! }
//! ```
//!
//! `a` is only one byte long, but due to the alignment of `b`, there is 7 bytes of padding between `a` and `b`,
//! which is considered *undefined memory*.
//!
//! The solution is to have it explicitly initialized to zero bytes, like:
//! ```ignore
//! #[repr(C)]
//! struct Demo {
//!     a: u8,
//!     _padding: [u8; 7], // = [0; 7] in Default
//!     b: u64,            // same offset as before
//! }
//! ```
//!
//! There is one other way to introduce undefined memory into a struct, which this does not check for, and that is
//! a union with unequal size fields.

// TODO(port): The Zig implementation is pure `comptime` reflection over `@typeInfo(T)` —
// it walks struct/union/array/optional/pointer field trees, recurses into children, and
// `@compileError`s on any gap between `@offsetOf(T, field) + @sizeOf(field)` and the next
// field's offset (and between the last field's end and `@sizeOf(T)`).
//
// Rust has no `@typeInfo` equivalent. Phase B should provide this as a proc-macro derive
// (`#[derive(AssertNoUninitializedPadding)]`) that emits the `const _: () = assert!(...)`
// checks below per-field, plus a marker trait so `assert_no_uninitialized_padding::<T>()`
// is bounded on it. The free function here is kept as the call-site-compatible entry point.

/// Marker trait asserting that `Self` is `#[repr(C)]` (or `#[repr(transparent)]`/packed),
/// contains no pointer fields, and has no implicit padding bytes anywhere in its layout
/// (recursively). Implemented by `#[derive(AssertNoUninitializedPadding)]`.
///
/// # Safety
/// Implementing this by hand asserts the layout invariants above without the derive's
/// compile-time checks. Only do so for primitives and manually-audited `#[repr(C)]` types.
pub unsafe trait AssertNoUninitializedPadding {}

/// Compile-time assertion that `T` has no uninitialized padding. See module docs.
///
/// In Zig this walked `@typeInfo(T)` at comptime and emitted `@compileError` on gaps.
/// In Rust the actual checking lives in the `#[derive(AssertNoUninitializedPadding)]`
/// proc-macro; this function is a zero-cost call-site marker bounded on the trait so
/// existing `assertNoUninitializedPadding(Foo)` call sites translate 1:1.
pub const fn assert_no_uninitialized_padding<T: AssertNoUninitializedPadding>() {
    // The trait bound IS the check. Body intentionally empty.
}

// TODO(port): proc-macro — the derive should expand roughly to the following per type
// (shown as a declarative helper for Phase-B reference; not invoked anywhere yet):
//
// For each adjacent field pair (prev, field) in declaration order:
//   const _: () = assert!(
//       core::mem::offset_of!(T, field)
//           == core::mem::offset_of!(T, prev) + core::mem::size_of::<PrevTy>(),
//       concat!(
//           "Expected no possibly uninitialized bytes of memory in '", stringify!(T),
//           "', but found a byte gap between fields '", stringify!(prev), "' and '",
//           stringify!(field), "'. This can be fixed by adding a padding field to the ",
//           "struct like `_padding: [u8; N] = [0; N],` between these fields. For more ",
//           "information, look at `padding_checker.rs`",
//       ),
//   );
//
// And for the trailing gap:
//   const _: () = assert!(
//       core::mem::offset_of!(T, last) + core::mem::size_of::<LastTy>()
//           == core::mem::size_of::<T>(),
//       concat!(
//           "Expected no possibly uninitialized bytes of memory in '", stringify!(T),
//           "', but found a byte gap at the end of the struct. This can be fixed by ",
//           "adding a padding field to the struct like `_padding: [u8; N] = [0; N],` ",
//           "at the end. For more information, look at `padding_checker.rs`",
//       ),
//   );
//
// Recursion rules (mirroring the Zig `switch (@typeInfo(...))`):
//   - struct / union field  → require `FieldTy: AssertNoUninitializedPadding`
//   - [T; N] field          → require `T: AssertNoUninitializedPadding`
//   - Option<T> field       → require `T: AssertNoUninitializedPadding`
//   - pointer field         → compile_error!("Expected no pointer types in ...")
//   - anything else         → ok
//
// Unions: recurse into field types but skip the offset-gap scan (matches Zig's
// `if (info_ == .@"union") return;` before the offset loop).

// Blanket impls for leaf types the Zig version's `else => return` arm accepted.
// SAFETY: scalar primitives have no padding by definition.
unsafe impl AssertNoUninitializedPadding for u8 {}
unsafe impl AssertNoUninitializedPadding for u16 {}
unsafe impl AssertNoUninitializedPadding for u32 {}
unsafe impl AssertNoUninitializedPadding for u64 {}
unsafe impl AssertNoUninitializedPadding for usize {}
unsafe impl AssertNoUninitializedPadding for i8 {}
unsafe impl AssertNoUninitializedPadding for i16 {}
unsafe impl AssertNoUninitializedPadding for i32 {}
unsafe impl AssertNoUninitializedPadding for i64 {}
unsafe impl AssertNoUninitializedPadding for isize {}
unsafe impl AssertNoUninitializedPadding for bool {}

// Arrays: Zig's `.array => |a| assertNoUninitializedPadding(a.child)`.
// SAFETY: `[T; N]` has no inter-element padding when `T` itself has none
// (array stride == size_of::<T>() always; any tail padding would be inside T and
// already rejected by T's own impl).
unsafe impl<T: AssertNoUninitializedPadding, const N: usize> AssertNoUninitializedPadding for [T; N] {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/padding_checker.zig (108 lines)
//   confidence: medium
//   todos:      2
//   notes:      Zig comptime @typeInfo walk → trait + proc-macro derive; fn is now a bounded marker, derive does the offset_of!/size_of gap checks (sketched in comments).
// ──────────────────────────────────────────────────────────────────────────
