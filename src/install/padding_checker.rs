//! In some parts of lockfile serialization, Bun will convert a
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
//! `bun_core::impl_no_uninit!(Demo)` compiles only for the second `Demo`, and both `write_array`s take `T: NoUninit`. It also rejects a union with unequal size fields, so what holds a `bin::Value` or a `resolution::Value` is still written through an `unsafe` byte view.

// ──────────────────────────────────────────────────────────────────────────
// Cross-version layout pins
//
// Every type below is byte-serialised into either `bun.lockb` (the binary
// lockfile) or the `.npm` manifest cache. Their sizes/alignments are
// therefore an ABI contract with previously released Bun versions: an
// older-written lockfile must round-trip through this build and vice versa.
// The expected values are computed by hand. If any assert fires the on-disk
// format has drifted — either fix the Rust `#[repr(C)]` layout or bump the
// relevant format version (`bun.lockb` `format_version` /
// `PackageManifest::Serializer::VERSION`).
//
// The asserts are gated to 64-bit little-endian targets because that is the
// only ABI the binary formats are defined for (the lockfile header hard-codes
// little-endian and 8-byte pointer alignment).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(all(target_pointer_width = "64", target_endian = "little"))]
mod layout_asserts {
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
    pin!(crate::npm::PackageVersion, size = 248, align = 8);
    pin!(crate::npm::NpmPackage, size = 120, align = 8);
}
