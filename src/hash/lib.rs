//! Non-cryptographic hash functions for `Bun.hash` (`HashObject`).
//!
//! Each algorithm is a 1:1 port of the version Bun's Zig runtime uses
//! (`std.hash.*` from `vendor/zig/lib/std/hash/` plus `bun.deprecated.RapidHash`),
//! so JS-visible output stays bit-identical across the Zig→Rust boundary.
//!
//! Surface mirrored from `src/runtime/api/HashObject.zig`:
//!
//! | JS name        | Rust entry point                              | seed → output |
//! |----------------|-----------------------------------------------|---------------|
//! | `adler32`      | [`Adler32::hash`] (no seed)                   | — → u32       |
//! | `cityHash32`   | [`CityHash32::hash`] (no seed)                | — → u32       |
//! | `cityHash64`   | [`CityHash64::hash_with_seed`]                | u64 → u64     |
//! | `xxHash32`     | [`XxHash32::hash`]                            | u32 → u32     |
//! | `xxHash64`     | [`XxHash64::hash`]                            | u64 → u64     |
//! | `xxHash3`      | [`XxHash3::hash`]                             | u64 → u64     |
//! | `murmur32v2`   | [`Murmur2_32::hash_with_seed`]                | u32 → u32     |
//! | `murmur32v3`   | [`Murmur3_32::hash_with_seed`]                | u32 → u32     |
//! | `murmur64v2`   | [`Murmur2_64::hash_with_seed`]                | u64 → u64     |
//! | `rapidhash`    | [`RapidHash::hash`]                           | u64 → u64     |
//!
//! `wyhash` lives in `bun_wyhash`; `crc32` is provided by `bun_zlib`.

#![allow(clippy::many_single_char_names)]

#![warn(unreachable_pub)]
pub mod adler32;
pub mod cityhash;
pub mod murmur;
pub mod rapidhash;
pub mod xxhash;

pub use adler32::Adler32;
pub use cityhash::{CityHash32, CityHash64};
pub use murmur::{Murmur2_32, Murmur2_64, Murmur3_32};
pub use rapidhash::RapidHash;
pub use xxhash::{XxHash3, XxHash32, XxHash64, XxHash64Streaming};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/HashObject.zig (hash algorithm surface)
//               vendor/zig/lib/std/hash/{Adler32,cityhash,murmur,xxhash}.zig
//               src/bun_core/deprecated.zig (RapidHash)
//   confidence: high — adler32/cityhash/murmur/rapidhash are line-for-line
//               ports verified against Zig's smhasher constants; xxhash is
//               twox-hash 2.x verified against Zig's reference vectors.
//   todos:      0
// ──────────────────────────────────────────────────────────────────────────
