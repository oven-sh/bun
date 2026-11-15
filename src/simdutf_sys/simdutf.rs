use std::io::BorrowedCursor;

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
    fn simdutf__convert_utf8_to_utf16le(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> usize;
    fn simdutf__convert_utf16le_to_utf8_with_errors(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> SIMDUTFResult;
    pub(crate) fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize;
    pub(crate) fn simdutf__utf8_length_from_utf16le_with_replacement(
        input: *const u16,
        length: usize,
    ) -> usize;
    pub fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_latin1(input: *const u8, length: usize) -> usize;
    fn simdutf__convert_latin1_to_utf8(
        input: *const u8,
        length: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
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

/// Text, and a number of bytes that is enough for it as UTF-8.
#[derive(Copy, Clone)]
pub struct Measured<'a, T> {
    input: &'a [T],
    utf8_len: usize,
}

impl<'a, T> Measured<'a, T> {
    pub fn input(self) -> &'a [T] {
        self.input
    }

    pub fn utf8_len(self) -> usize {
        self.utf8_len
    }
}

impl<'a> Measured<'a, u16> {
    pub fn utf16(input: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le(input);
        Self { input, utf8_len }
    }

    pub fn utf16_with_replacement(input: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le_with_replacement(input);
        Self { input, utf8_len }
    }

    pub fn utf16_worst_case(input: &'a [u16]) -> Self {
        let utf8_len = input.len() * 3;
        Self { input, utf8_len }
    }
}

impl<'a> Measured<'a, u8> {
    pub fn latin1(input: &'a [u8]) -> Self {
        let utf8_len = length::utf8::from::latin1(input);
        Self { input, utf8_len }
    }

    /// The only measure that holds for bytes that another thread or process can write to.
    pub fn latin1_worst_case(input: &'a [u8]) -> Self {
        let utf8_len = input.len() * 2;
        Self { input, utf8_len }
    }
}

pub mod convert {
    use super::*;

    pub mod utf8 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf16 {
                use super::*;

                /// Appends `input` to `output`. Returns false, and appends nothing, if `input` is
                /// empty or is not valid UTF-8. `output` needs room for one unit per input byte.
                pub fn le(input: &[u8], mut output: BorrowedCursor<'_, u16>) -> bool {
                    assert!(input.len() <= output.capacity());
                    // SAFETY: the icelake, haswell, westmere, arm64 and fallback kernels of this
                    // function never advance the output by more units than they advance the input
                    // by bytes, and keep their stores inside the first `len` units, whatever they
                    // read and even if `input` changes while they run. They store no undefined
                    // value and have stored every unit below the count they return. The
                    // `_with_errors` and `convert_valid_` variants do not have these properties.
                    unsafe {
                        let written = simdutf__convert_utf8_to_utf16le(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut().as_mut_ptr().cast(),
                        );
                        output.advance(written);
                        written != 0
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

                    /// Appends `input` to `output`, or nothing if the result is an error.
                    pub fn le(
                        input: Measured<'_, u16>,
                        mut output: BorrowedCursor<'_, u8>,
                    ) -> SIMDUTFResult {
                        assert!(input.utf8_len <= output.capacity());
                        // SAFETY: simdutf stores no more than any of the three measures of
                        // `input`, valid or not. On success `count` is the number of bytes it wrote.
                        unsafe {
                            let result = simdutf__convert_utf16le_to_utf8_with_errors(
                                input.input.as_ptr(),
                                input.input.len(),
                                output.as_mut().as_mut_ptr().cast(),
                            );
                            if result.is_successful() {
                                output.advance(result.count);
                            }
                            result
                        }
                    }
                }
            }
        }
    }

    pub mod latin1 {
        use super::*;
        pub mod to {
            use super::*;

            /// Appends `input` to `output`.
            pub fn utf8(input: Measured<'_, u8>, mut output: BorrowedCursor<'_, u8>) {
                assert!(input.utf8_len <= output.capacity());
                // SAFETY: simdutf stores no more than either measure of `input`, and returns the
                // number of bytes it wrote. No kernel stores past `2 * len`, whatever it reads.
                unsafe {
                    let written = simdutf__convert_latin1_to_utf8(
                        input.input.as_ptr(),
                        input.input.len(),
                        output.as_mut().as_mut_ptr().cast(),
                    );
                    output.advance(written);
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
}

pub mod base64 {
    use super::{BorrowedCursor, SIMDUTFResult};
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
        safe fn simdutf__base64_length_from_binary(length: usize, options: c_int) -> usize;
    }

    /// Appends the [`encode_len`] characters of `input` to `output`.
    pub fn encode(input: &[u8], mut output: BorrowedCursor<'_, u8>, is_urlsafe: bool) {
        assert!(encode_len(input.len(), is_urlsafe) <= output.capacity());
        // SAFETY: simdutf writes exactly `encode_len` bytes, whatever it reads, and returns that count.
        unsafe {
            let written = simdutf__base64_encode(
                input.as_ptr(),
                input.len(),
                output.as_mut().as_mut_ptr().cast(),
                is_urlsafe as c_int,
            );
            output.advance(written);
        }
    }

    pub fn encode_len(input: usize, is_urlsafe: bool) -> usize {
        simdutf__base64_length_from_binary(input, is_urlsafe as c_int)
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

/// Returns false if this CPU can't run any compiled-in kernel. simdutf then falls back to a stub
/// that returns false for every query.
pub fn has_any_implementation() -> bool {
    validate::ascii(b"a")
}
