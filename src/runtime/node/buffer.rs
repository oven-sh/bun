use core::ffi::c_void;

use bun_jsc::node::Encoding;
use bun_jsc::web_core::encoding as encoder;
use bun_str::ZigString;

pub struct BufferVectorized;

impl BufferVectorized {
    #[unsafe(export_name = "Bun__Buffer_fill")]
    pub extern "C" fn fill(
        str: *const ZigString,
        buf_ptr: *mut u8,
        fill_length: usize,
        encoding: Encoding,
    ) -> bool {
        // SAFETY: caller (C++) passes a valid ZigString pointer.
        let str = unsafe { &*str };
        if str.len == 0 {
            return true;
        }

        // SAFETY: caller guarantees buf_ptr[0..fill_length] is a valid writable buffer.
        let buf = unsafe { core::slice::from_raw_parts_mut(buf_ptr, fill_length) };

        let result = match encoding {
            Encoding::Utf8 => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Utf8, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Utf8)
                }
            }
            Encoding::Ascii => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Ascii, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Ascii)
                }
            }
            Encoding::Latin1 => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Latin1, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Latin1)
                }
            }
            Encoding::Buffer => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Buffer, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Buffer)
                }
            }
            Encoding::Utf16le | Encoding::Ucs2 => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Utf16le, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Utf16le)
                }
            }
            Encoding::Base64 => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Base64, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Base64)
                }
            }
            Encoding::Base64url => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Base64url, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Base64url)
                }
            }
            Encoding::Hex => {
                if str.is_16_bit() {
                    let s = str.utf16_slice_aligned();
                    encoder::write_u16(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Hex, true)
                } else {
                    let s = str.slice();
                    encoder::write_u8(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(), Encoding::Hex)
                }
            }
        };
        // Zig writeU8/writeU16 return `!usize`; Rust port returns `Result<usize, _>` so `written` is already usize.
        let Ok(written) = result else { return false; };

        if written == 0 && str.length() > 0 {
            return false;
        }

        match written {
            0 => return true,
            1 => {
                let b = buf[0];
                buf.fill(b);
                return true;
            }
            #[cfg(target_os = "macos")]
            4 => {
                let (pattern, rest) = buf.split_at_mut(4);
                // SAFETY: macOS libc memset_pattern4; pattern is 4 bytes, rest is the remaining buffer.
                unsafe {
                    bun_sys::c::memset_pattern4(
                        rest.as_mut_ptr().cast::<c_void>(),
                        pattern.as_ptr().cast::<c_void>(),
                        rest.len(),
                    );
                }
                return true;
            }
            #[cfg(target_os = "macos")]
            8 => {
                let (pattern, rest) = buf.split_at_mut(8);
                // SAFETY: macOS libc memset_pattern8; pattern is 8 bytes, rest is the remaining buffer.
                unsafe {
                    bun_sys::c::memset_pattern8(
                        rest.as_mut_ptr().cast::<c_void>(),
                        pattern.as_ptr().cast::<c_void>(),
                        rest.len(),
                    );
                }
                return true;
            }
            #[cfg(target_os = "macos")]
            16 => {
                let (pattern, rest) = buf.split_at_mut(16);
                // SAFETY: macOS libc memset_pattern16; pattern is 16 bytes, rest is the remaining buffer.
                unsafe {
                    bun_sys::c::memset_pattern16(
                        rest.as_mut_ptr().cast::<c_void>(),
                        pattern.as_ptr().cast::<c_void>(),
                        rest.len(),
                    );
                }
                return true;
            }
            _ => {}
        }

        // PORT NOTE: reshaped for borrowck — Zig grew two slices (`contents`, `buf`) into the
        // same underlying buffer and mutated `contents.len` in place. Here we track offsets
        // and use copy_within (src/dst share `buf`).
        // PERF(port): was memcpy (non-overlapping) — profile in Phase B if memmove-vs-memcpy matters.
        let mut contents_len = written;
        let mut buf_offset = written;

        while fill_length - buf_offset >= contents_len {
            buf.copy_within(0..contents_len, buf_offset);
            buf_offset += contents_len;
            contents_len *= 2;
        }

        let remaining = fill_length - buf_offset;
        if remaining > 0 {
            buf.copy_within(0..remaining, buf_offset);
        }

        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/buffer.zig (90 lines)
//   confidence: medium
//   todos:      0
//   notes:      doubling-fill loop reshaped to offset-tracked copy_within for borrowck; encoder fn paths need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
