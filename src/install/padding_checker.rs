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

/// Assertion that `T` has no uninitialized padding. See module docs.
///
/// In Zig this walked `@typeInfo(T)` at comptime and emitted `@compileError` on gaps,
/// with an `else => return` arm that silently accepted any non-aggregate type and a
/// `.pointer => |ptr| assertNoUninitializedPadding(ptr.child)` arm so callers could
/// pass `@TypeOf(slice)` directly.
///
/// In Rust the actual layout checking lives in `#[derive(AssertNoUninitializedPadding)]`
/// on each serialized struct; this function is a zero-cost call-site marker that
/// documents intent. It takes a type-witness value so call sites can mirror the Zig
/// `assertNoUninitializedPadding(@TypeOf(value))` pattern (pass any value of `T` —
/// or name `T` explicitly via turbofish and reference the fn item without calling).
///
/// The trait bound is intentionally *not* applied here: Zig's `else => return` accepts
/// all leaf types, and bounding the generic would force every `write_array<T>` caller
/// to propagate `T: AssertNoUninitializedPadding` before the derive exists.
#[inline(always)]
#[allow(dropping_copy_types, clippy::needless_pass_by_value)]
pub fn assert_no_uninitialized_padding<T>(_type_witness: T) {
    // Body intentionally empty — the derive on `T` is the check. Matches Zig's
    // runtime behaviour (the Zig version is `comptime`-only and codegens nothing).
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
unsafe impl<T: AssertNoUninitializedPadding, const N: usize> AssertNoUninitializedPadding
    for [T; N]
{
}

// ──────────────────────────────────────────────────────────────────────────
// Cross-runtime layout pins
//
// Every type below is `std.mem.sliceAsBytes`-serialised into either `bun.lockb`
// (the binary lockfile) or the `.npm` manifest cache. Their sizes/alignments
// are therefore an ABI contract with Zig-built Bun: a Zig-written lockfile
// must round-trip through this build and vice versa. The expected values are
// computed by hand from the `extern struct` declarations in the corresponding
// `.zig` files (no `@typeInfo` available in Rust). If any assert fires the
// on-disk format has drifted — either fix the Rust `#[repr(C)]` layout or
// bump the relevant format version (`bun.lockb` `format_version` /
// `PackageManifest::Serializer::VERSION`).
//
// The asserts are gated to 64-bit little-endian targets because that is the
// only ABI the binary formats are defined for (Zig hard-codes `.little` and
// `@alignOf([*]u8) == 8` in the lockfile header).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(all(target_pointer_width = "64", target_endian = "little"))]
pub mod layout_asserts {
    use core::mem::{align_of, size_of};

    macro_rules! pin {
        ($ty:ty, size = $sz:expr, align = $al:expr) => {
            const _: () = assert!(
                size_of::<$ty>() == $sz,
                concat!(
                    "on-disk layout drift: size_of::<",
                    stringify!($ty),
                    ">() != ",
                    stringify!($sz),
                    " (Zig extern-struct spec)",
                ),
            );
            const _: () = assert!(
                align_of::<$ty>() == $al,
                concat!(
                    "on-disk layout drift: align_of::<",
                    stringify!($ty),
                    ">() != ",
                    stringify!($al),
                    " (Zig extern-struct spec)",
                ),
            );
        };
    }

    // ── leaf POD shared by both formats ──────────────────────────────────
    pin!(bun_semver::String, size = 8, align = 1); // [8]u8
    pin!(bun_semver::ExternalString, size = 16, align = 8); // String + u64
    pin!(crate::ExternalSlice<u8>, size = 8, align = 4); // u32 off + u32 len
    pin!(crate::ExternalStringMap, size = 16, align = 4);
    pin!(crate::integrity::Integrity, size = 65, align = 1); // u8 tag + [64]u8
    pin!(crate::repository::Repository, size = 40, align = 1); // 5 × String
    pin!(crate::bin::Value, size = 16, align = 4); // union: [String;2] | ExternalSlice
    pin!(crate::bin::Bin, size = 20, align = 4);
    pin!(bun_semver::Version, size = 56, align = 8); // 3×u64 + Tag(2×ExternalString)

    // ── bun.lockb package-table columns (Package.Serializer) ─────────────
    // Iterated in declaration order by `MultiArrayList::Slice::column_bytes_mut`;
    // each column is written as a raw byte slab, so per-column `size_of` is the
    // load-bearing contract — see `lockfile/Package.rs::serializer::sizes()`.
    pin!(crate::resolution::Value<u64>, size = 64, align = 8); // union: VersionedURL | Repository | String
    pin!(crate::resolution::Resolution, size = 72, align = 8); // u8 tag + [7]u8 + Value
    pin!(crate::lockfile::package::Meta, size = 88, align = 4);
    pin!(crate::lockfile::package::Scripts, size = 49, align = 1);

    // ── .npm manifest cache (PackageManifest.Serializer) ─────────────────
    pin!(crate::npm::PackageVersion, size = 240, align = 8);
    pin!(crate::npm::NpmPackage, size = 120, align = 8);
}

// ported from: src/install/padding_checker.zig
