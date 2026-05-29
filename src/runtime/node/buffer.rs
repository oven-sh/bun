pub(crate) struct BufferVectorized;

mod _impl {
    use super::*;
    #[cfg(target_os = "macos")]
    use core::ffi::c_void;

    use crate::node::Encoding;
    use crate::webcore::encoding::{self as encoder, dispatch_encoding};
    use bun_core::ZigString;

    impl BufferVectorized {
        /// # Safety
        /// `str` must point to a valid `ZigString` and `buf_ptr` must point to a writable
        /// buffer of at least `fill_length` bytes.
        #[unsafe(export_name = "Bun__Buffer_fill")]
        pub(crate) unsafe extern "C" fn fill(
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

            let encoding = if matches!(encoding, Encoding::Ascii) {
                Encoding::Latin1
            } else {
                encoding
            };

            // PORT NOTE: encoder::write_u8/write_u16 take the encoding as a const-generic
            // `u8` (stable-Rust workaround for `adt_const_params`) — `dispatch_encoding!`
            // expands the runtime `encoding` into nine monomorphized arms.
            // SAFETY: `s` and `buf` are valid slices derived above; the source/destination
            // pointers and lengths passed to the encoder are exactly those slice bounds.
            let result = if str.is_16_bit() {
                let s = str.utf16_slice_aligned();
                dispatch_encoding!(encoding, {
                    // SAFETY: caller (`extern "C"` fill) guarantees `s`/`buf` are valid disjoint buffers per the Buffer.fill contract.
                    Encoding::Ucs2 => unsafe { encoder::write_u16::<{ Encoding::Utf16le as u8 }, true>(
                        s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(),
                    ) },
                // SAFETY: caller (`extern "C"` fill) guarantees `s`/`buf` are valid disjoint buffers per the Buffer.fill contract.
                }, |E| unsafe { encoder::write_u16::<E, true>(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len()) })
            } else {
                let s = str.slice();
                dispatch_encoding!(encoding, {
                    // SAFETY: caller (`extern "C"` fill) guarantees `s`/`buf` are valid disjoint buffers per the Buffer.fill contract.
                    Encoding::Ucs2 => unsafe { encoder::write_u8::<{ Encoding::Utf16le as u8 }>(
                        s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len(),
                    ) },
                // SAFETY: caller (`extern "C"` fill) guarantees `s`/`buf` are valid disjoint buffers per the Buffer.fill contract.
                }, |E| unsafe { encoder::write_u8::<E>(s.as_ptr(), s.len(), buf.as_mut_ptr(), buf.len()) })
            };
            // Zig writeU8/writeU16 return `!usize`; Rust port returns `Result<usize, _>` so `written` is already usize.
            let Ok(written) = result else {
                return false;
            };

            if written == 0 && str.len > 0 {
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
} // mod _impl

// ported from: src/runtime/node/buffer.zig
