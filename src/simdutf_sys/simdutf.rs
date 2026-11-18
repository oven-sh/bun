use core::io::BorrowedCursor;

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SIMDUTFResult {
    pub status: Status,
    pub count: usize,
}

impl SIMDUTFResult {
    #[inline]
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
    pub fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool;
    pub fn simdutf__validate_ascii_with_errors(buf: *const u8, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_utf16le(buf: *const u16, len: usize) -> bool;
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
    fn simdutf__latin1_length_from_utf8(input: *const u8, length: usize) -> usize;
    fn simdutf__validate_utf16le_with_errors(buf: *const u16, len: usize) -> SIMDUTFResult;
    fn simdutf__to_well_formed_utf16le(input: *const u16, length: usize, output: *mut u16);
}

pub mod validate {
    use super::*;

    pub mod with_errors {
        use super::*;

        #[inline]
        pub fn utf16le(input: &[u16]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len u16s.
            unsafe { simdutf__validate_utf16le_with_errors(input.as_ptr(), input.len()) }
        }
    }

    #[inline]
    pub fn utf8(input: &[u8]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len bytes.
        unsafe { simdutf__validate_utf8(input.as_ptr(), input.len()) }
    }
    /// Where the first invalid sequence starts.
    #[inline]
    pub fn first_invalid_utf8(input: &[u8]) -> Option<usize> {
        let valid = |chunk: core::str::Utf8Chunk<'_>| chunk.valid().len();
        (!utf8(input)).then(|| input.utf8_chunks().next().map_or(0, valid))
    }
    #[inline]
    pub fn ascii(input: &[u8]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len bytes.
        unsafe { simdutf__validate_ascii(input.as_ptr(), input.len()) }
    }
    #[inline]
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
    #[inline]
    pub fn slice(self) -> &'a [T] {
        self.slice
    }

    #[inline]
    pub fn utf8_len(self) -> usize {
        self.utf8_len
    }
}

impl<'a> WithUtf8Len<'a, u16> {
    #[inline]
    pub fn utf16(slice: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le(slice);
        Self { slice, utf8_len }
    }

    #[inline]
    pub fn utf16_with_replacement(slice: &'a [u16]) -> Self {
        let utf8_len = length::utf8::from::utf16::le_with_replacement(slice);
        Self { slice, utf8_len }
    }

    /// `None` if the worst case does not fit in `capacity` bytes.
    #[inline]
    pub fn utf16_worst_case(slice: &'a [u16], capacity: usize) -> Option<Self> {
        let utf8_len = slice.len() * 3;
        (utf8_len <= capacity).then_some(Self { slice, utf8_len })
    }
}

impl<'a> WithUtf8Len<'a, u8> {
    #[inline]
    pub fn latin1(slice: &'a [u8]) -> Self {
        let utf8_len = length::utf8::from::latin1(slice);
        Self { slice, utf8_len }
    }

    #[inline]
    pub fn latin1_worst_case(slice: &'a [u8]) -> Self {
        let utf8_len = slice.len() * 2;
        Self { slice, utf8_len }
    }
}

pub mod convert {
    use super::*;

    pub mod utf16 {
        use super::*;
        pub mod to {
            use super::*;

            /// Each unpaired surrogate becomes U+FFFD. Panics if `output` is shorter than `input`.
            #[inline]
            pub fn well_formed_le(input: &[u16], mut output: BorrowedCursor<'_, u16>) {
                assert!(input.len() <= output.capacity());
                // SAFETY: simdutf writes a unit for each unit of `input`.
                unsafe {
                    simdutf__to_well_formed_utf16le(
                        input.as_ptr(),
                        input.len(),
                        output.as_mut().as_mut_ptr().cast(),
                    );
                    output.advance(input.len());
                }
            }

            pub mod utf8 {
                use super::*;
                pub mod with_errors {
                    use super::*;

                    /// Appends nothing to `output` if the result is an error.
                    #[inline]
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

            #[inline]
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
                #[inline]
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

            #[inline]
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
            #[inline]
            pub fn utf8(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf16_length_from_utf8(input.as_ptr(), input.len()) }
            }
        }
    }

    pub mod latin1 {
        use super::*;
        pub mod from {
            use super::*;
            #[inline]
            pub fn utf8(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__latin1_length_from_utf8(input.as_ptr(), input.len()) }
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
        fn simdutf__base64_decode_whole_chunks(
            input: *const u8,
            length: usize,
            output: *mut u8,
            written: *mut usize,
            is_urlsafe: c_int,
        ) -> SIMDUTFResult;
        fn simdutf__base64_decode_whole_chunks16(
            input: *const u16,
            length: usize,
            output: *mut u8,
            written: *mut usize,
            is_urlsafe: c_int,
        ) -> SIMDUTFResult;
        safe fn simdutf__base64_length_from_binary(length: usize, options: c_int) -> usize;
    }

    /// Panics if `output` is shorter than [`encode_len`].
    #[inline]
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

    #[inline]
    pub fn encode_len(input: usize, is_urlsafe: bool) -> usize {
        simdutf__base64_length_from_binary(input, is_urlsafe as c_int)
    }

    #[inline]
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

    type WholeChunks<T> =
        unsafe extern "C" fn(*const T, usize, *mut u8, *mut usize, c_int) -> SIMDUTFResult;

    #[inline(always)]
    fn whole_chunks<T>(
        decode: WholeChunks<T>,
        input: &[T],
        mut output: BorrowedCursor<'_, u8>,
        is_urlsafe: bool,
    ) -> Option<usize> {
        assert!(input.len().div_ceil(4) * 3 <= output.capacity());
        let mut written = 0;
        // SAFETY: simdutf writes no more than that, and on success `written` is the number of bytes it decoded.
        unsafe {
            let result = decode(
                input.as_ptr(),
                input.len(),
                output.as_mut().as_mut_ptr().cast(),
                &raw mut written,
                is_urlsafe as c_int,
            );
            result.is_successful().then(|| {
                output.advance(written);
                result.count
            })
        }
    }

    /// Decodes the chunks of four characters, skipping white space, and leaves a last one that has fewer. Returns
    /// how many characters it has read, or `None`, having appended nothing. It may write past what it appends.
    /// Panics unless `output` has room for 3 bytes for every 4 characters, whole or not.
    #[inline]
    pub fn decode_whole_chunks(
        input: &[u8],
        output: BorrowedCursor<'_, u8>,
        is_urlsafe: bool,
    ) -> Option<usize> {
        whole_chunks(
            simdutf__base64_decode_whole_chunks,
            input,
            output,
            is_urlsafe,
        )
    }

    /// [`decode_whole_chunks`] of UTF-16.
    #[inline]
    pub fn decode_whole_chunks16(
        input: &[u16],
        output: BorrowedCursor<'_, u8>,
        is_urlsafe: bool,
    ) -> Option<usize> {
        whole_chunks(
            simdutf__base64_decode_whole_chunks16,
            input,
            output,
            is_urlsafe,
        )
    }

    /// Lenient decode matching Node.js `Buffer` semantics
    /// (`simdutf::base64_default_or_url_accept_garbage` + loose last chunk):
    /// accepts both the standard and URL-safe alphabets, skips whitespace and
    /// any other non-alphabet characters, and stops at the first `'='`.
    /// On success, `count` is the number of bytes written to `output`.
    #[inline]
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
#[inline]
pub fn has_any_implementation() -> bool {
    validate::ascii(b"a")
}
