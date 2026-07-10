//! Native symbols shimmed for this crate's `cargo test` binary only. The
//! shared set lives in `bun_test_native_link`; the two simdutf entry points
//! below are excluded there because bun_paths defines its own copies in-crate
//! (both crates' test binaries would otherwise carry duplicate definitions).

// Pulls the shared shim crate (+ its prebuilt-libuv archive) into the link.
use bun_test_native_link as _;

use bun_simdutf_sys::simdutf::{SIMDUTFResult, Status};

/// Scalar `simdutf::convert::utf8::to::utf16::with_errors::le`: writes the
/// UTF-16LE form of the valid prefix and returns SUCCESS + units written, or
/// a nonzero status + the input position of the first invalid sequence.
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(
    buf: *const u8,
    len: usize,
    utf16_output: *mut u16,
) -> SIMDUTFResult {
    // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
    let input = unsafe { core::slice::from_raw_parts(buf, len) };
    let mut written = 0usize;
    let mut i = 0usize;
    while i < len {
        let b = input[i];
        let cont = |off: usize| i + off < len && input[i + off] & 0xC0 == 0x80;
        let (cp, adv): (u32, usize) = if b < 0x80 {
            (b as u32, 1)
        } else if (0xC2..0xE0).contains(&b) && cont(1) {
            (
                (u32::from(b & 0x1F) << 6) | u32::from(input[i + 1] & 0x3F),
                2,
            )
        } else if (0xE0..0xF0).contains(&b) && cont(1) && cont(2) {
            let cp = (u32::from(b & 0x0F) << 12)
                | (u32::from(input[i + 1] & 0x3F) << 6)
                | u32::from(input[i + 2] & 0x3F);
            if (0xD800..=0xDFFF).contains(&cp) {
                return SIMDUTFResult {
                    status: Status::SURROGATE,
                    count: i,
                };
            }
            (cp, 3)
        } else if (0xF0..0xF5).contains(&b) && cont(1) && cont(2) && cont(3) {
            (
                (u32::from(b & 0x07) << 18)
                    | (u32::from(input[i + 1] & 0x3F) << 12)
                    | (u32::from(input[i + 2] & 0x3F) << 6)
                    | u32::from(input[i + 3] & 0x3F),
                4,
            )
        } else {
            return SIMDUTFResult {
                status: Status::TOO_SHORT,
                count: i,
            };
        };
        // SAFETY: test stub mirroring simdutf — the caller guarantees
        // capacity for the full conversion before calling.
        unsafe {
            if cp <= 0xFFFF {
                utf16_output.add(written).write(cp as u16);
                written += 1;
            } else {
                let v = cp - 0x10000;
                utf16_output.add(written).write(0xD800 + (v >> 10) as u16);
                utf16_output
                    .add(written + 1)
                    .write(0xDC00 + (v & 0x3FF) as u16);
                written += 2;
            }
        }
        i += adv;
    }
    SIMDUTFResult {
        status: Status::SUCCESS,
        count: written,
    }
}

/// Scalar `simdutf::length::utf16::from::utf8`: one unit per non-continuation
/// byte plus one more per 4-byte lead (undercounts on invalid input, like the
/// real implementation).
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize {
    // SAFETY: test stub; callers pass a valid (ptr, len) input pair.
    let input = unsafe { core::slice::from_raw_parts(input, length) };
    input
        .iter()
        .map(|&b| {
            if b & 0xC0 == 0x80 {
                0
            } else if b >= 0xF0 {
                2
            } else {
                1
            }
        })
        .sum()
}
