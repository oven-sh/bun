//! Compile-time layout asserts for `struct_phr_chunked_decoder`.
//!
//! Bun source: src/picohttp_sys/picohttpparser.rs:48-55
//! C header:   picohttpparser.h (vendored from h2o/picohttpparser)
//! Upstream version: commit 066d2b1e9ab820703db0837a7255d92d30f0c9f5
//!                   (pinned in scripts/build/deps/picohttpparser.ts:13)
//!
//! Upstream C definition:
//!
//! ```c
//! struct phr_chunked_decoder {
//!     size_t bytes_left_in_chunk; /* number of bytes left in current chunk */
//!     char consume_trailer;       /* if trailing headers should be consumed */
//!     char _hex_count;
//!     char _state;
//! };
//! ```
//!
//! This struct is the in-place state machine for `phr_decode_chunked()`.
//! `_state` is the enum-like dispatch variable — drift on its offset would
//! make the parser silently mis-route between chunk-size/data/CRLF/trailers
//! states. The Bun Rust mirror uses a `ChunkedEncodingState(u8)` newtype
//! for `_state` to avoid Rust's UB-on-out-of-range-enum-discriminant
//! (`ChunkedEncodingState` has only six declared values but C may write any
//! u8 — see comment at picohttpparser.rs:81-86).
//!
//! Paste this block into `src/picohttp_sys/picohttpparser.rs` after the
//! `struct_phr_chunked_decoder` definition.

use core::mem::{align_of, offset_of, size_of};

#[allow(dead_code)]
const _: () = {
    // Layout on 64-bit (every Bun-supported target):
    //   bytes_left_in_chunk: usize @ 0..8
    //   consume_trailer:     u8    @ 8
    //   _hex_count:          u8    @ 9
    //   _state:              u8    @ 10
    //   tail padding:        5 bytes to align(8)
    //   total:               16 bytes
    #[cfg(target_pointer_width = "64")]
    {
        assert!(
            size_of::<struct_phr_chunked_decoder>() == 16,
            "struct_phr_chunked_decoder size drift on 64-bit target",
        );
        assert!(
            align_of::<struct_phr_chunked_decoder>() == 8,
            "struct_phr_chunked_decoder align drift on 64-bit target",
        );
        assert!(offset_of!(struct_phr_chunked_decoder, bytes_left_in_chunk) == 0);
        assert!(offset_of!(struct_phr_chunked_decoder, consume_trailer) == 8);
        assert!(offset_of!(struct_phr_chunked_decoder, _hex_count) == 9);
        assert!(offset_of!(struct_phr_chunked_decoder, _state) == 10);
    }
    #[cfg(target_pointer_width = "32")]
    {
        // bytes_left_in_chunk @ 0..4, consume_trailer @ 4, _hex_count @ 5, _state @ 6.
        // Total: 8 bytes (align 4, 1 byte trailing pad).
        assert!(size_of::<struct_phr_chunked_decoder>() == 8);
        assert!(align_of::<struct_phr_chunked_decoder>() == 4);
        assert!(offset_of!(struct_phr_chunked_decoder, bytes_left_in_chunk) == 0);
        assert!(offset_of!(struct_phr_chunked_decoder, consume_trailer) == 4);
        assert!(offset_of!(struct_phr_chunked_decoder, _hex_count) == 5);
        assert!(offset_of!(struct_phr_chunked_decoder, _state) == 6);
    }
    // ChunkedEncodingState is `#[repr(transparent)] struct(u8)`; size 1, align 1.
    assert!(size_of::<ChunkedEncodingState>() == 1);
    assert!(align_of::<ChunkedEncodingState>() == 1);
};

// Caveats:
//   - The C upstream uses `char` for the three trailing fields. C `char`
//     signedness is implementation-defined, but it has fixed size 1; the Rust
//     mirror reads them as `u8` (`consume_trailer: u8`, `_hex_count: u8`) and
//     a `repr(transparent) struct ChunkedEncodingState(pub u8)`. Bit-level
//     identical regardless of clang's char signedness.
//   - No bitfields; no `#ifdef`-conditional fields. No platform-conditional
//     layout to worry about.
//   - The trailing-pad bytes (offsets 11..16 on 64-bit) are NOT zeroed by
//     the C parser. Callers MUST zero-init this struct before first use
//     (the `Default` impl in picohttpparser.rs:57 already does this).
