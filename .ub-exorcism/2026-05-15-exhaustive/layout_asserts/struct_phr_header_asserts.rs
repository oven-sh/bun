//! Compile-time layout asserts for `struct_phr_header`.
//!
//! Bun source: src/picohttp_sys/picohttpparser.rs:4-11
//! C header:   picohttpparser.h (vendored from h2o/picohttpparser)
//! Upstream version: commit 066d2b1e9ab820703db0837a7255d92d30f0c9f5
//!                   (pinned in scripts/build/deps/picohttpparser.ts:13)
//!
//! Upstream C definition:
//!
//! ```c
//! /* should be zero-filled before call */
//! struct phr_header {
//!     const char *name;
//!     size_t name_len;
//!     const char *value;
//!     size_t value_len;
//! };
//! ```
//!
//! This struct is passed via `*mut struct_phr_header` to `phr_parse_request`,
//! `phr_parse_response`, and `phr_parse_headers`. The parser writes
//! `(name, name_len, value, value_len)` for each header found into a
//! caller-supplied array. Layout drift on the Bun side would corrupt
//! every parsed header (length read as pointer, etc.) — a near-certain
//! crash or HTTP smuggling vector.
//!
//! Paste this block into `src/picohttp_sys/picohttpparser.rs` after the
//! `struct_phr_header` definition.

use core::mem::{align_of, offset_of, size_of};

#[allow(dead_code)]
const _: () = {
    // sizeof — 4 pointer-sized fields on every Bun-supported target (LP64 / LLP64).
    // On x86_64 Linux/macOS: 4 * 8 = 32. On Windows x64: 4 * 8 = 32 (size_t is u64).
    // On 32-bit (not currently targeted): 4 * 4 = 16 — guarded by cfg.
    #[cfg(target_pointer_width = "64")]
    {
        assert!(
            size_of::<struct_phr_header>() == 32,
            "struct_phr_header size drift on 64-bit target",
        );
        assert!(
            align_of::<struct_phr_header>() == 8,
            "struct_phr_header align drift on 64-bit target",
        );
        // Per-field offset assertions — pin every field. All four are
        // pointer-or-usize-sized so each starts at the next 8-byte boundary.
        assert!(offset_of!(struct_phr_header, name) == 0);
        assert!(offset_of!(struct_phr_header, name_len) == 8);
        assert!(offset_of!(struct_phr_header, value) == 16);
        assert!(offset_of!(struct_phr_header, value_len) == 24);
    }
    #[cfg(target_pointer_width = "32")]
    {
        assert!(size_of::<struct_phr_header>() == 16);
        assert!(align_of::<struct_phr_header>() == 4);
        assert!(offset_of!(struct_phr_header, name) == 0);
        assert!(offset_of!(struct_phr_header, name_len) == 4);
        assert!(offset_of!(struct_phr_header, value) == 8);
        assert!(offset_of!(struct_phr_header, value_len) == 12);
    }
};

// Caveats: none. The upstream struct has no bitfields, no platform-conditional
// fields, no `#ifdef` body. The Rust mirror uses `*const u8` for `name`/`value`
// where C uses `const char *` — both are pointer-sized and have identical
// layout under `#[repr(C)]`. `usize` mirrors C `size_t` on all Bun targets.
