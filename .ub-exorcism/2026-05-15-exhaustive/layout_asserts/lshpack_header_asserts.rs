//! Compile-time layout asserts for `lshpack_header`.
//!
//! Bun source: src/http/lshpack.rs:3-11
//! C source:   src/jsc/bindings/c-bindings.cpp:364-371 (Bun's own wrapper,
//!             NOT vendor/ls-hpack header — Bun layers its own type on top
//!             of `lshpack_dec_decode`'s output).
//! Upstream lshpack version: commit 8905c024b6d052f083a3d11d0a169b3c2735c8a1
//!                          (pinned in scripts/build/deps/lshpack.ts:13)
//!
//! C definition (from c-bindings.cpp:364):
//!
//! ```c
//! typedef struct {
//!     const char* name;        // 0  .. 8
//!     size_t name_len;         // 8  .. 16
//!     const char* value;       // 16 .. 24
//!     size_t value_len;        // 24 .. 32
//!     bool never_index;        // 32 .. 33
//!     // 1 byte tail padding to align uint16_t
//!     uint16_t hpack_index;    // 34 .. 36
//!     // 4 bytes trailing padding to align the struct to 8
//! } lshpack_header;            // total = 40
//! ```
//!
//! This struct is written by `lshpack_wrapper_decode` (c-bindings.cpp:412)
//! and read by Rust's `HPACK::decode()` to materialise a header pair. Layout
//! drift would scramble the (name_ptr, name_len, value_ptr, value_len)
//! reads — the same HTTP smuggling / OOB-read hazard as `struct_phr_header`,
//! but for HTTP/2 / HPACK decode.
//!
//! Paste this block into `src/http/lshpack.rs` after the `lshpack_header`
//! definition.

use core::mem::{align_of, offset_of, size_of};

#[allow(dead_code)]
const _: () = {
    #[cfg(target_pointer_width = "64")]
    {
        // C++ on every Bun-supported 64-bit target (clang Linux/macOS/Windows):
        //   sizeof(bool) == 1, alignof(bool) == 1.
        //   sizeof(uint16_t) == 2, alignof(uint16_t) == 2.
        //   sizeof(size_t) == 8, alignof(size_t) == 8.
        //   sizeof(const char*) == 8, alignof(const char*) == 8.
        // Trailing padding to round up to alignof(struct) == 8.
        assert!(
            size_of::<lshpack_header>() == 40,
            "lshpack_header size drift — c-bindings.cpp:364 layout changed",
        );
        assert!(
            align_of::<lshpack_header>() == 8,
            "lshpack_header align drift",
        );
        assert!(offset_of!(lshpack_header, name) == 0);
        assert!(offset_of!(lshpack_header, name_len) == 8);
        assert!(offset_of!(lshpack_header, value) == 16);
        assert!(offset_of!(lshpack_header, value_len) == 24);
        assert!(offset_of!(lshpack_header, never_index) == 32);
        assert!(offset_of!(lshpack_header, hpack_index) == 34);
        // No `offset_of!` for the trailing padding — it doesn't exist as a
        // named field — but the `size_of == 40` assertion above pins it.
    }
    #[cfg(target_pointer_width = "32")]
    {
        // Hypothetical 32-bit target: pointers + size_t shrink to 4. Layout:
        //   name: 0..4, name_len: 4..8, value: 8..12, value_len: 12..16,
        //   never_index: 16..17, pad 1, hpack_index: 18..20.
        //   Struct align is 4 → total = 20 bytes.
        assert!(size_of::<lshpack_header>() == 20);
        assert!(align_of::<lshpack_header>() == 4);
        assert!(offset_of!(lshpack_header, name) == 0);
        assert!(offset_of!(lshpack_header, name_len) == 4);
        assert!(offset_of!(lshpack_header, value) == 8);
        assert!(offset_of!(lshpack_header, value_len) == 12);
        assert!(offset_of!(lshpack_header, never_index) == 16);
        assert!(offset_of!(lshpack_header, hpack_index) == 18);
    }
};

// Caveats:
//   - C++ `bool` is 1 byte on all clang targets Bun supports (Itanium ABI
//     on Linux/macOS, MSVC ABI on Windows). Both agree with Rust `bool`.
//     If anyone ports to a target where `bool` is wider (rare / nonexistent
//     in modern toolchains), the `offset_of!(_, hpack_index) == 34` assertion
//     will fail at compile time — exactly the alarm we want.
//   - The 1-byte gap between `never_index` and `hpack_index` and the 4-byte
//     trailing tail are uninitialised; Rust may store anything there and the
//     C side ignores them. Don't `memcmp` instances of this struct.
//   - No bitfields, no `#ifdef`-conditional fields.
//   - The struct is local to c-bindings.cpp (typedef inside `extern "C" {}`);
//     no third party can perturb the layout without editing Bun itself.
