use core::io::BorrowedCursor;

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
    fn simdutf__convert_utf8_to_utf16le_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult;
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

/// UTF-16 or Latin-1 text with an upper bound of the UTF-8 bytes that simdutf writes for it.
#[derive(Copy, Clone)]
pub struct WithUtf8Len<'a, T> {
    slice: &'a [T],
    utf8_len: usize,
}

impl<'a, T> WithUtf8Len<'a, T> {
    pub fn slice(self) -> &'a [T] {
        self.slice
    }

    pub fn utf8_len(self) -> usize {
        self.utf8_len
    }
}

impl<'a> WithUtf8Len<'a, u16> {
    pub fn utf16(slice: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le(slice);
        Self { slice, utf8_len }
    }

    pub fn utf16_with_replacement(slice: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le_with_replacement(slice);
        Self { slice, utf8_len }
    }

    /// `None` if the worst case does not fit in `capacity` bytes.
    pub fn utf16_worst_case(slice: &'a [u16], capacity: usize) -> Option<Self> {
        let utf8_len = slice.len() * 3;
        (utf8_len <= capacity).then_some(Self { slice, utf8_len })
    }
}

impl<'a> WithUtf8Len<'a, u8> {
    pub fn latin1(slice: &'a [u8]) -> Self {
        let utf8_len = length::utf8::from::latin1(slice);
        Self { slice, utf8_len }
    }
}

/// UTF-8 text with an upper bound of the UTF-16 units that simdutf writes for it.
#[derive(Copy, Clone)]
pub struct WithUtf16Len<'a> {
    slice: &'a [u8],
    utf16_len: usize,
}

impl<'a> WithUtf16Len<'a> {
    pub fn utf8(slice: &'a [u8]) -> Self {
        let utf16_len = length::utf16::from::utf8(slice);
        Self { slice, utf16_len }
    }

    /// `None` if the worst case does not fit in `capacity` units.
    pub fn utf8_worst_case(slice: &'a [u8], capacity: usize) -> Option<Self> {
        let utf16_len = slice.len();
        (utf16_len <= capacity).then_some(Self { slice, utf16_len })
    }

    pub fn utf16_len(self) -> usize {
        self.utf16_len
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
                pub mod with_errors {
                    use super::*;

                    /// Appends nothing to `output` if the result is an error.
                    pub fn le(
                        input: WithUtf16Len<'_>,
                        mut output: BorrowedCursor<'_, u16>,
                    ) -> SIMDUTFResult {
                        assert!(input.utf16_len <= output.capacity());
                        // SAFETY: simdutf writes at most `utf16_len` units, valid or not, and on
                        // success `count` is the number of units it wrote.
                        unsafe {
                            let result = simdutf__convert_utf8_to_utf16le_with_errors(
                                input.slice.as_ptr(),
                                input.slice.len(),
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

    pub mod utf16 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf8 {
                use super::*;
                pub mod with_errors {
                    use super::*;

                    /// Appends nothing to `output` if the result is an error.
                    pub fn le(
                        input: WithUtf8Len<'_, u16>,
                        mut output: BorrowedCursor<'_, u8>,
                    ) -> SIMDUTFResult {
                        assert!(input.utf8_len <= output.capacity());
                        // SAFETY: simdutf writes at most `utf8_len` bytes, valid or not, and on
                        // success `count` is the number of bytes it wrote.
                        unsafe {
                            let result = simdutf__convert_utf16le_to_utf8_with_errors(
                                input.slice.as_ptr(),
                                input.slice.len(),
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

            pub fn utf8(input: WithUtf8Len<'_, u8>, mut output: BorrowedCursor<'_, u8>) {
                assert!(input.utf8_len <= output.capacity());
                // SAFETY: simdutf writes `utf8_len` bytes and returns that count.
                unsafe {
                    let written = simdutf__convert_latin1_to_utf8(
                        input.slice.as_ptr(),
                        input.slice.len(),
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
                pub(crate) fn le(input: &[u16]) -> usize {
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

    /// Panics if `output` is shorter than [`encode_len`].
    pub fn encode(input: &[u8], mut output: BorrowedCursor<'_, u8>, is_urlsafe: bool) {
        assert!(encode_len(input.len(), is_urlsafe) <= output.capacity());
        // SAFETY: simdutf writes exactly `encode_len` bytes and returns that count.
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
