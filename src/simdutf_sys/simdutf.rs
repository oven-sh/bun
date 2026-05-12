use core::ffi::{c_int, c_uint};

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

// Zig: `enum(i32) { ..., _ }` — the `_` arm means *any* i32 is a valid bit
// pattern (C++ may return values outside the named set). A `#[repr(i32)] enum`
// in Rust would be UB on unknown discriminants, so we use a transparent newtype
// with associated consts instead.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Status(pub i32);

impl Status {
    pub const SUCCESS: Status = Status(0);
    /// Any byte must have fewer than 5 header bits.
    pub const HEADER_BITS: Status = Status(1);
    /// The leading byte must be followed by N-1 continuation bytes, where N is the UTF-8 character length.
    /// This is also the error when the input is truncated.
    pub const TOO_SHORT: Status = Status(2);
    /// The leading byte must not be a continuation byte.
    pub const TOO_LONG: Status = Status(3);
    /// The decoded character must be above U+7F for two-byte characters, U+7FF for three-byte characters,
    pub const OVERLONG: Status = Status(4);
    /// and U+FFFF for four-byte characters.
    /// The decoded character must be less than or equal to U+10FFFF OR less than or equal than U+7F for ASCII.
    /// The decoded character must be not be in U+D800...DFFF (UTF-8 or UTF-32) OR
    /// a high surrogate must be followed by a low surrogate and a low surrogate must be preceded by a high surrogate (UTF-16)
    pub const TOO_LARGE: Status = Status(5);
    pub const SURROGATE: Status = Status(6);
    /// Found a character that cannot be part of a valid base64 string.
    pub const INVALID_BASE64_CHARACTER: Status = Status(7);
    /// The base64 input terminates with a single character, excluding padding (=).
    pub const BASE64_INPUT_REMAINDER: Status = Status(8);
    /// The provided buffer is too small.
    pub const OUTPUT_BUFFER_TOO_SMALL: Status = Status(9);
    // `_` => any other i32: not related to validation/transcoding.
}

unsafe extern "C" {
    pub fn simdutf__detect_encodings(input: *const u8, length: usize) -> c_int;
    pub fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool;
    pub fn simdutf__validate_utf8_with_errors(buf: *const u8, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool;
    pub fn simdutf__validate_ascii_with_errors(buf: *const u8, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_utf16le(buf: *const u16, len: usize) -> bool;
    pub fn simdutf__validate_utf16be(buf: *const u16, len: usize) -> bool;
    pub fn simdutf__validate_utf16le_with_errors(buf: *const u16, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_utf16be_with_errors(buf: *const u16, len: usize) -> SIMDUTFResult;
    pub fn simdutf__validate_utf32(buf: *const c_uint, len: usize) -> bool;
    pub fn simdutf__validate_utf32_with_errors(buf: *const c_uint, len: usize) -> SIMDUTFResult;
    pub fn simdutf__convert_utf8_to_utf16le(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf8_to_utf16be(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf8_to_utf16le_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_utf8_to_utf16be_with_errors(
        buf: *const u8,
        len: usize,
        utf16_output: *mut u16,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf8_to_utf16be(
        buf: *const u8,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf8_to_utf32(
        buf: *const u8,
        len: usize,
        utf32_output: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_utf8_to_utf32_with_errors(
        buf: *const u8,
        len: usize,
        utf32_output: *mut u32,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf8_to_utf32(
        buf: *const u8,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_utf16le_to_utf8(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_utf16be_to_utf8(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_utf16le_to_utf8_with_errors(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_utf16be_to_utf8_with_errors(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf16le_to_utf8(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_valid_utf16be_to_utf8(
        buf: *const u16,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_utf32_to_utf8(
        buf: *const c_uint,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_utf32_to_utf8_with_errors(
        buf: *const c_uint,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf32_to_utf8(
        buf: *const c_uint,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__convert_utf32_to_utf16le(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf32_to_utf16be(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf32_to_utf16le_with_errors(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_utf32_to_utf16be_with_errors(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf32_to_utf16le(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_valid_utf32_to_utf16be(
        buf: *const c_uint,
        len: usize,
        utf16_buffer: *mut u16,
    ) -> usize;
    pub fn simdutf__convert_utf16le_to_utf32(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_utf16be_to_utf32(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_utf16le_to_utf32_with_errors(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_utf16be_to_utf32_with_errors(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> SIMDUTFResult;
    pub fn simdutf__convert_valid_utf16le_to_utf32(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_valid_utf16be_to_utf32(
        buf: *const u16,
        len: usize,
        utf32_buffer: *mut u32,
    ) -> usize;
    pub fn simdutf__convert_latin1_to_utf8(
        buf: *const u8,
        len: usize,
        utf8_buffer: *mut u8,
    ) -> usize;
    pub fn simdutf__change_endianness_utf16(buf: *const u16, length: usize, output: *mut u16);
    pub fn simdutf__count_utf16le(buf: *const u16, length: usize) -> usize;
    pub fn simdutf__count_utf16be(buf: *const u16, length: usize) -> usize;
    pub fn simdutf__count_utf8(buf: *const u8, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_utf16be(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf32_length_from_utf16le(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf32_length_from_utf16be(input: *const u16, length: usize) -> usize;
    pub fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_utf32(input: *const c_uint, length: usize) -> usize;
    pub fn simdutf__utf16_length_from_utf32(input: *const c_uint, length: usize) -> usize;
    pub fn simdutf__utf32_length_from_utf8(input: *const u8, length: usize) -> usize;
    pub fn simdutf__utf8_length_from_latin1(input: *const u8, length: usize) -> usize;
    pub fn simdutf__utf16_length_from_latin1(input: *const u8, length: usize) -> usize;
}

pub mod validate {
    use super::*;

    pub mod with_errors {
        use super::*;

        pub fn utf8(input: &[u8]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len bytes.
            unsafe { simdutf__validate_utf8_with_errors(input.as_ptr(), input.len()) }
        }
        pub fn ascii(input: &[u8]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len bytes.
            unsafe { simdutf__validate_ascii_with_errors(input.as_ptr(), input.len()) }
        }
        pub fn utf16le(input: &[u16]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len u16s.
            unsafe { simdutf__validate_utf16le_with_errors(input.as_ptr(), input.len()) }
        }
        pub fn utf16be(input: &[u16]) -> SIMDUTFResult {
            // SAFETY: input is a valid slice; FFI reads exactly len u16s.
            unsafe { simdutf__validate_utf16be_with_errors(input.as_ptr(), input.len()) }
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
    pub fn utf16be(input: &[u16]) -> bool {
        // SAFETY: input is a valid slice; FFI reads exactly len u16s.
        unsafe { simdutf__validate_utf16be(input.as_ptr(), input.len()) }
    }
}

pub mod convert {
    use super::*;

    pub mod latin1 {
        use super::*;
        pub mod to {
            use super::*;
            pub fn utf8(input: &[u8], output: &mut [u8]) -> usize {
                // SAFETY: caller guarantees output.len() is sufficient (>= utf8_length_from_latin1).
                unsafe {
                    simdutf__convert_latin1_to_utf8(
                        input.as_ptr(),
                        input.len(),
                        output.as_mut_ptr(),
                    )
                }
            }
        }
    }

    pub mod utf8 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf16 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    pub fn le(input: &[u8], output: &mut [u16]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf8_to_utf16le_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u8], output: &mut [u16]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf8_to_utf16be_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u8], output: &mut [u16]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_utf8_to_utf16le(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u8], output: &mut [u16]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_utf8_to_utf16be(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
            }

            pub mod utf32 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    pub fn le(input: &[u8], output: &mut [u32]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf8_to_utf32_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u8], output: &mut [u32]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf8_to_utf32_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u8], output: &mut [u32]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf8_to_utf32(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u8], output: &mut [u32]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf8_to_utf32(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
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
                    pub fn le(input: &[u16], output: &mut [u8]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf16le_to_utf8_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u16], output: &mut [u8]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf16be_to_utf8_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u16], output: &mut [u8]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf16le_to_utf8(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u16], output: &mut [u8]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf16be_to_utf8(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
            }

            pub mod utf32 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    pub fn le(input: &[u16], output: &mut [u32]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf16le_to_utf32_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u16], output: &mut [u32]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf16be_to_utf32_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u16], output: &mut [u32]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf16le_to_utf32(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u16], output: &mut [u32]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf16be_to_utf32(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
            }
        }
    }

    pub mod utf32 {
        use super::*;
        pub mod to {
            use super::*;
            pub mod utf8 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    pub fn le(input: &[u32], output: &mut [u8]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf32_to_utf8_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u32], output: &mut [u8]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf32_to_utf8_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u32], output: &mut [u8]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf32_to_utf8(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u32], output: &mut [u8]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf32_to_utf8(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
            }

            pub mod utf16 {
                use super::*;
                pub mod with_errors {
                    use super::*;
                    pub fn le(input: &[u32], output: &mut [u16]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf32_to_utf16le_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                    pub fn be(input: &[u32], output: &mut [u16]) -> SIMDUTFResult {
                        // SAFETY: caller guarantees output capacity is sufficient.
                        unsafe {
                            simdutf__convert_utf32_to_utf16be_with_errors(
                                input.as_ptr(),
                                input.len(),
                                output.as_mut_ptr(),
                            )
                        }
                    }
                }

                pub fn le(input: &[u32], output: &mut [u16]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf32_to_utf16le(
                            input.as_ptr(),
                            input.len(),
                            output.as_mut_ptr(),
                        )
                    }
                }
                pub fn be(input: &[u32], output: &mut [u16]) -> usize {
                    // SAFETY: caller guarantees output capacity is sufficient.
                    unsafe {
                        simdutf__convert_valid_utf32_to_utf16be(
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
                pub fn be(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf8_length_from_utf16be(input.as_ptr(), input.len()) }
                }
            }

            pub fn latin1(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf8_length_from_latin1(input.as_ptr(), input.len()) }
            }

            pub fn utf32(input: &[u32]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len u32s.
                unsafe { simdutf__utf8_length_from_utf32(input.as_ptr(), input.len()) }
            }
        }
    }

    pub mod utf16 {
        use super::*;
        pub mod from {
            use super::*;
            pub fn utf8(input: &[u8]) -> usize {
                // TODO(port): Zig had `if (@inComptime())` branch using std.unicode.utf8CountCodepoints
                // for compile-time evaluation; Rust has no equivalent — runtime path only.
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf16_length_from_utf8(input.as_ptr(), input.len()) }
            }

            pub fn utf32(input: &[u32]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len u32s.
                unsafe { simdutf__utf16_length_from_utf32(input.as_ptr(), input.len()) }
            }

            pub fn latin1(input: &[u8]) -> usize {
                // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                unsafe { simdutf__utf16_length_from_latin1(input.as_ptr(), input.len()) }
            }
        }
    }

    pub mod utf32 {
        use super::*;
        pub mod from {
            use super::*;
            pub mod utf8 {
                use super::*;
                pub fn le(input: &[u8]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                    unsafe { simdutf__utf32_length_from_utf8(input.as_ptr(), input.len()) }
                }
                pub fn be(input: &[u8]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len bytes.
                    unsafe { simdutf__utf32_length_from_utf8(input.as_ptr(), input.len()) }
                }
            }

            pub mod utf16 {
                use super::*;
                pub fn le(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf32_length_from_utf16le(input.as_ptr(), input.len()) }
                }
                pub fn be(input: &[u16]) -> usize {
                    // SAFETY: input is a valid slice; FFI reads exactly len u16s.
                    unsafe { simdutf__utf32_length_from_utf16be(input.as_ptr(), input.len()) }
                }
            }
        }
    }
}

pub mod trim {
    pub fn utf8_len(buf: &[u8]) -> usize {
        let len = buf.len();

        if len < 3 {
            match len {
                2 => {
                    if buf[len - 1] >= 0b11000000 {
                        return len - 1;
                    } // 2-, 3- and 4-byte characters with only 1 byte left
                    if buf[len - 2] >= 0b11100000 {
                        return len - 2;
                    } // 3- and 4-byte characters with only 2 bytes left
                    return len;
                }
                1 => {
                    if buf[len - 1] >= 0b11000000 {
                        return len - 1;
                    } // 2-, 3- and 4-byte characters with only 1 byte left
                    return len;
                }
                0 => return len,
                _ => unreachable!(),
            }
        }

        if buf[len - 1] >= 0b11000000 {
            return len - 1;
        } // 2-, 3- and 4-byte characters with only 1 byte left
        if buf[len - 2] >= 0b11100000 {
            return len - 2;
        } // 3- and 4-byte characters with only 1 byte left
        if buf[len - 3] >= 0b11110000 {
            return len - 3;
        } // 4-byte characters with only 3 bytes left
        len
    }

    pub fn utf16_len(buf: &[u16]) -> usize {
        let len = buf.len();

        if len == 0 {
            return 0;
        }
        if (buf[len - 1] >= 0xD800) && (buf[len - 1] <= 0xDBFF) {
            return len - 1;
        }
        len
    }

    pub fn utf16(buf: &[u16]) -> &[u16] {
        &buf[0..utf16_len(buf)]
    }

    pub fn utf8(buf: &[u8]) -> &[u8] {
        &buf[0..utf8_len(buf)]
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
        fn simdutf__base64_decode_from_binary16(
            input: *const u16,
            length: usize,
            output: *mut u8,
            outlen: usize,
            is_urlsafe: c_int,
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

    pub fn decode16(input: &[u16], output: &mut [u8], is_urlsafe: bool) -> SIMDUTFResult {
        // SAFETY: input/output are valid slices; FFI honors outlen bound.
        unsafe {
            simdutf__base64_decode_from_binary16(
                input.as_ptr(),
                input.len(),
                output.as_mut_ptr(),
                output.len(),
                is_urlsafe as c_int,
            )
        }
    }
}

// ported from: src/simdutf_sys/simdutf.zig
