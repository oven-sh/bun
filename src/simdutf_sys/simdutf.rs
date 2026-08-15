#[repr(C)]
#[derive(Copy, Clone)]
pub struct SIMDUTFResult {
    pub status: Status,
    pub count: usize,
}

impl SIMDUTFResult {
    pub fn is_successful(&self) -> bool {
        self.status == Status::SUCCESS
    }
}

// Any i32 is a valid bit
// pattern (C++ may return values outside the named set). A `#[repr(i32)] enum`
// in Rust would be UB on unknown discriminants, so we use a transparent newtype
// with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Status(pub i32);

impl Status {
    pub const SUCCESS: Status = Status(0);
    /// The leading byte must be followed by N-1 continuation bytes, where N is the UTF-8 character length.
    /// This is also the error when the input is truncated.
    pub const TOO_SHORT: Status = Status(2);
    pub const SURROGATE: Status = Status(6);
    /// Found a character that cannot be part of a valid base64 string.
    pub const INVALID_BASE64_CHARACTER: Status = Status(7);
    // `_` => any other i32: not related to validation/transcoding.
}

unsafe extern "C" {
    pub(crate) fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool;
    pub(crate) fn simdutf__validate_utf8_with_errors(buf: *const u8, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool;
    pub fn simdutf__validate_ascii_with_errors(buf: *const u8, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_utf16le(buf: *const u16, len: usize) -> bool;
    pub fn simdutf__convert_utf8_to_utf16le_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_utf16le_to_utf8_with_errors(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> SIMDUTFResult;
    pub(crate) fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize;
    pub(crate) fn simdutf__utf8_length_from_utf16le_with_replacement(
        input: *const u16,
        length: usize,
    ) -> usize;
    pub fn simdutf__utf8_length_from_utf16be(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf32_length_from_utf16be(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize;
    pub(crate) fn simdutf__utf32_length_from_utf8(input: *const u8, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_latin1(input: *const u8, length: usize) -> usize;
}

pub mod validate {
    use super::*;

    pub mod with_errors {
        use super::*;

        pub fn utf8(input: &[u8]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len bytes.
            unsafe { simdutf__validate_utf8_with_errors(input.as_ptr(), input.len()) }
        }
    }

    pub fn utf8(input: &[u8]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len bytes.
        unsafe { simdutf__validate_utf8(input.as_ptr(), input.len()) }
    }
    pub fn ascii(input: &[u8]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len bytes.
        unsafe { simdutf__validate_ascii(input.as_ptr(), input.len()) }
    }
    pub fn utf16le(input: &[u16]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len u16s.
        unsafe { simdutf__validate_utf16le(input.as_ptr(), input.len()) }
    }
}

/// Slice wrappers over simdutf's transcoders.
///
/// simdutf takes only an output *pointer* and writes however many code units
/// the input transcodes to; `output.len()` never reaches C++. Every function
/// here is therefore `unsafe`, and its `# Safety` section names the bound the
/// caller has to establish first, either with the matching [`length`] scan of
/// the same input or with the worst-case multiple of `input.len()`. Debug
/// builds re-check that bound.
pub mod convert {
    use super::*;

    pub mod utf8 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf16 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    /// Transcodes `input` up to its first invalid sequence. On
                    /// success `count` is the number of code units written; on
                    /// error it is the byte offset of the error, and only the
                    /// valid prefix's code units have been written.
                    ///
                    /// # Safety
                    /// `output.len()` must be at least `input.len()` (no code
                    /// unit comes from less than one byte) or at least
                    /// [`length::utf16::from::utf8`]`(input)`, which is exact
                    /// for valid input and still covers the prefix written
                    /// before an error, because the scan charges every lead
                    /// byte whether or not what follows it is valid.
                    pub unsafe fn le(input: &[u8], output: &mut [u16]) -> SIMDUTFResult {
                        debug_assert!(
                            output.len() >= input.len()
                                || output.len() >= length::utf16::from::utf8(input),
                            "utf8 -> utf16 output too small: {} u16 for {} bytes",
                            output.len(),
                            input.len(),
                        );
                        // SAFETY: `input` is a valid slice, read for exactly
                        // `len` bytes; the caller's contract above makes
                        // `output` hold every code unit simdutf writes.
                        unsafe {
                            simdutf__convert_utf8_to_utf16le_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }
            }
        }
    }

    pub mod utf16 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf8 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    /// Transcodes `input` up to its first unpaired surrogate.
                    /// On success `count` is the number of bytes written; on
                    /// error it is the code unit offset of the surrogate, and
                    /// only the valid prefix's bytes have been written.
                    ///
                    /// # Safety
                    /// `output.len()` must be at least
                    /// [`length::utf8::from::utf16::le`]`(input)`. That is exact
                    /// for valid input and still covers the prefix written
                    /// before an error, because the scan charges every code
                    /// unit at least as many bytes as transcoding it writes and
                    /// nothing is written for the surrogate the conversion
                    /// stops at.
                    /// [`length::utf8::from::utf16::le_with_replacement`]`(input)`
                    /// and `3 * input.len()` are never smaller, so sizing by
                    /// either of those satisfies the bound too.
                    pub unsafe fn le(input: &[u16], output: &mut [u8]) -> SIMDUTFResult {
                        debug_assert!(
                            output.len() >= input.len().saturating_mul(3)
                                || output.len() >= length::utf8::from::utf16::le(input),
                            "utf16 -> utf8 output too small: {} bytes for {} u16",
                            output.len(),
                            input.len(),
                        );
                        // SAFETY: `input` is a valid slice, read for exactly
                        // `len` code units; the caller's contract above makes
                        // `output` hold every byte simdutf writes.
                        unsafe {
                            simdutf__convert_utf16le_to_utf8_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }
            }
        }
    }
}

pub mod length {
    use super::*;

    pub mod utf8 {
        use super::*;
        pub mod from {
            use super::*;
            pub mod utf16 {
                use super::*;
                pub fn le(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf8_length_from_utf16le(input.as_ptr(), input.len()) }
                }
                /// Like [`le`], but charges 3 bytes (U+FFFD) per unpaired
                /// surrogate instead of assuming valid UTF-16. This is the
                /// exact byte count produced by the replacement encoder.
                pub fn le_with_replacement(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe {
                        simdutf__utf8_length_from_utf16le_with_replacement(
                            input.as_ptr(),
                            input.len(),
                        )
                    }
                }
                pub fn be(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf8_length_from_utf16be(input.as_ptr(), input.len()) }
                }
            }

            pub fn latin1(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf8_length_from_latin1(input.as_ptr(), input.len()) }
            }
        }
    }

    pub mod utf16 {
        use super::*;
        pub mod from {
            use super::*;
            pub fn utf8(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf16_length_from_utf8(input.as_ptr(), input.len()) }
            }
        }
    }

    pub mod utf32 {
        use super::*;
        pub mod from {
            use super::*;
            pub mod utf8 {
                use super::*;
                pub fn be(input: &[u8]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                    unsafe { simdutf__utf32_length_from_utf8(input.as_ptr(), input.len()) }
                }
            }

            pub mod utf16 {
                use super::*;
                pub fn be(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf32_length_from_utf16be(input.as_ptr(), input.len()) }
                }
            }
        }
    }
}

pub mod base64 {
    use super::SIMDUTFResult;
    use core::ffi::c_int;

    unsafe extern "C" {
        fn simdutf__base64_encode(
            input: *const u8,
            length: usize,
            output: *mut u8,
            is_urlsafe: c_int,
        ) -> usize;
        fn simdutf__base64_decode_from_binary(
            input: *const u8,
            length: usize,
            output: *mut u8,
            outlen: usize,
            is_urlsafe: c_int,
        ) -> SIMDUTFResult;
        fn simdutf__base64_decode_from_binary_lenient(
            input: *const u8,
            length: usize,
            output: *mut u8,
            outlen: usize,
        ) -> SIMDUTFResult;
        fn simdutf__base64_length_from_binary(length: usize, options: c_int) -> usize;
    }

    pub fn encode(input: &[u8], output: &mut [u8], is_urlsafe: bool) -> usize {
        // SAFETY: caller guarantees output.len() >= encode_len(input.len(), is_urlsafe).
        unsafe {
            simdutf__base64_encode(
                input.as_ptr(),
                input.len(),
                output.as_mut_ptr(),
                is_urlsafe as c_int,
            )
        }
    }

    /// Raw-pointer variant of [`encode`] for writing into uninitialised
    /// storage (e.g. `Vec::spare_capacity_mut`). Writes exactly
    /// [`encode_len(input.len(), is_urlsafe)`] bytes to `output` and returns
    /// that count.
    ///
    /// # Safety
    /// `output` must be valid for writes of at least
    /// `encode_len(input.len(), is_urlsafe)` bytes and must not overlap
    /// `input`.
    pub unsafe fn encode_raw(input: &[u8], output: *mut u8, is_urlsafe: bool) -> usize {
        // SAFETY: caller contract guarantees `output` is valid for
        // `encode_len(input.len(), is_urlsafe)` bytes and disjoint from `input`.
        unsafe { simdutf__base64_encode(input.as_ptr(), input.len(), output, is_urlsafe as c_int) }
    }

    pub fn encode_len(input: usize, is_urlsafe: bool) -> usize {
        // SAFETY: pure length computation; no pointers dereferenced.
        unsafe { simdutf__base64_length_from_binary(input, is_urlsafe as c_int) }
    }

    pub fn decode(input: &[u8], output: &mut [u8], is_urlsafe: bool) -> SIMDUTFResult {
        // SAFETY: input/output are valid slices; FFI honors outlen bound.
        unsafe {
            simdutf__base64_decode_from_binary(
                input.as_ptr(),
                input.len(),
                output.as_mut_ptr(),
                output.len(),
                is_urlsafe as c_int,
            )
        }
    }

    /// Lenient decode matching Node.js `Buffer` semantics
    /// (`simdutf::base64_default_or_url_accept_garbage` + loose last chunk):
    /// accepts both the standard and URL-safe alphabets, skips whitespace and
    /// any other non-alphabet characters, and stops at the first `'='`.
    /// On success, `count` is the number of bytes written to `output`.
    pub fn decode_lenient(input: &[u8], output: &mut [u8]) -> SIMDUTFResult {
        // SAFETY: input/output are valid slices; FFI honors outlen bound.
        unsafe {
            simdutf__base64_decode_from_binary_lenient(
                input.as_ptr(),
                input.len(),
                output.as_mut_ptr(),
                output.len(),
            )
        }
    }
}
