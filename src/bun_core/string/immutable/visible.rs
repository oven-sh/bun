//! Terminal visible-width helpers (`bun.strings.visible`).
//!
//! The implementation (ANSI-escape handling, grapheme clustering, East Asian
//! Width and the SIMD ASCII fast paths) lives in C++:
//! `src/jsc/bindings/stringWidth.cpp`. This module is the thin FFI surface
//! for the remaining Rust callers — console.table column sizing
//! (`ConsoleObject.rs`) and the markdown ANSI renderer (`md/ansi_renderer.rs`).

pub mod visible {
    pub mod width {
        pub mod exclude_ansi_colors {
            unsafe extern "C" {
                fn Bun__visibleWidthExcludeANSI_latin1(
                    ptr: *const u8,
                    len: usize,
                    ambiguous_as_wide: bool,
                ) -> usize;
                fn Bun__visibleWidthExcludeANSI_utf8(ptr: *const u8, len: usize) -> usize;
                fn Bun__visibleWidthExcludeANSI_utf16(
                    ptr: *const u16,
                    len: usize,
                    ambiguous_as_wide: bool,
                ) -> usize;
                fn Bun__visibleWidthExcludeANSI_utf8IndexAtWidth(
                    ptr: *const u8,
                    len: usize,
                    max_width: usize,
                ) -> usize;
            }

            /// Visible terminal width of Latin-1 bytes, treating ANSI escape
            /// sequences as zero-width.
            pub(crate) fn latin1(input: &[u8], ambiguous_as_wide: bool) -> usize {
                // SAFETY: `input` is a live slice for the duration of the call.
                unsafe {
                    Bun__visibleWidthExcludeANSI_latin1(
                        input.as_ptr(),
                        input.len(),
                        ambiguous_as_wide,
                    )
                }
            }

            /// Visible terminal width of a UTF-8 string, treating ANSI escape
            /// sequences as zero-width.
            pub fn utf8(input: &[u8]) -> usize {
                // SAFETY: `input` is a live slice for the duration of the call.
                unsafe { Bun__visibleWidthExcludeANSI_utf8(input.as_ptr(), input.len()) }
            }

            /// Visible terminal width of a UTF-16 string, treating ANSI escape
            /// sequences as zero-width.
            pub fn utf16(input: &[u16], ambiguous_as_wide: bool) -> usize {
                // SAFETY: `input` is a live slice for the duration of the call.
                unsafe {
                    Bun__visibleWidthExcludeANSI_utf16(
                        input.as_ptr(),
                        input.len(),
                        ambiguous_as_wide,
                    )
                }
            }

            /// Byte index of the longest prefix of `input` whose visible
            /// width is <= `max_width`. ANSI escapes count as zero-width
            /// and are always included in the prefix. Never splits a
            /// multi-byte UTF-8 codepoint.
            pub fn utf8_index_at_width(input: &[u8], max_width: usize) -> usize {
                // SAFETY: `input` is a live slice for the duration of the call.
                unsafe {
                    Bun__visibleWidthExcludeANSI_utf8IndexAtWidth(
                        input.as_ptr(),
                        input.len(),
                        max_width,
                    )
                }
            }
        }
    }
}
