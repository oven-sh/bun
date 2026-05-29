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

/// Marker trait asserting that `Self` is `#[repr(C)]` (or `#[repr(transparent)]`/packed),
/// contains no pointer fields, and has no implicit padding bytes anywhere in its layout
/// (recursively). Implemented by `#[derive(AssertNoUninitializedPadding)]`.
///
/// # Safety
/// Implementing this by hand asserts the layout invariants above without the derive's
/// compile-time checks. Only do so for primitives and manually-audited `#[repr(C)]` types.
pub unsafe trait AssertNoUninitializedPadding {}

#[inline(always)]
#[allow(dropping_copy_types, clippy::needless_pass_by_value)]
pub fn assert_no_uninitialized_padding<T>(_type_witness: T) {
    // Body intentionally empty — the derive on `T` is the check. Matches Zig's
    // runtime behaviour (the Zig version is `comptime`-only and codegens nothing).
}

// Blanket impls for leaf types the Zig version's `else => return` arm accepted.
// SAFETY: u8 is a single value byte; no padding by definition.
unsafe impl AssertNoUninitializedPadding for u8 {}
// SAFETY: u16 is a fixed-width integer; all 2 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for u16 {}
// SAFETY: u32 is a fixed-width integer; all 4 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for u32 {}
// SAFETY: u64 is a fixed-width integer; all 8 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for u64 {}
// SAFETY: usize is a fixed-width integer; all bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for usize {}
// SAFETY: i8 is a single value byte; no padding by definition.
unsafe impl AssertNoUninitializedPadding for i8 {}
// SAFETY: i16 is a fixed-width integer; all 2 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for i16 {}
// SAFETY: i32 is a fixed-width integer; all 4 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for i32 {}
// SAFETY: i64 is a fixed-width integer; all 8 bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for i64 {}
// SAFETY: isize is a fixed-width integer; all bytes are value bytes, no padding.
unsafe impl AssertNoUninitializedPadding for isize {}
// SAFETY: bool occupies exactly one byte (value 0 or 1); no padding.
unsafe impl AssertNoUninitializedPadding for bool {}

// Arrays: Zig's `.array => |a| assertNoUninitializedPadding(a.child)`.
// SAFETY: `[T; N]` has no inter-element padding when `T` itself has none
// (array stride == size_of::<T>() always; any tail padding would be inside T and
// already rejected by T's own impl).
unsafe impl<T: AssertNoUninitializedPadding, const N: usize> AssertNoUninitializedPadding
    for [T; N]
{
}

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

    pin!(crate::resolution::Value<u64>, size = 64, align = 8); // union: VersionedURL | Repository | String
    pin!(crate::resolution::Resolution, size = 72, align = 8); // u8 tag + [7]u8 + Value
    pin!(crate::lockfile::package::Meta, size = 88, align = 4);
    pin!(crate::lockfile::package::Scripts, size = 49, align = 1);

    // ── .npm manifest cache (PackageManifest.Serializer) ─────────────────
    pin!(crate::npm::PackageVersion, size = 240, align = 8);
    pin!(crate::npm::NpmPackage, size = 120, align = 8);
}

// ported from: src/install/padding_checker.zig
