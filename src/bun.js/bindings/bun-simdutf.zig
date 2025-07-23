pub const SIMDUTFResult = extern struct {
    status: Status,
    count: usize = 0,

    pub fn isSuccessful(this: *const SIMDUTFResult) bool {
        return this.status == Status.success;
    }

    pub const Status = enum(i32) {
        success = 0,
        /// Any byte must have fewer than 5 header bits.
        header_bits = 1,

        /// The leading byte must be followed by N-1 continuation bytes, where N is the UTF-8 character length
        /// This is also the error when the input is truncated.
        too_short = 2,

        /// The leading byte must not be a continuation byte.
        too_long = 3,

        /// The decoded character must be above U+7F for two-byte characters, U+7FF for three-byte characters,
        overlong = 4,

        /// and U+FFFF for four-byte characters.
        /// The decoded character must be less than or equal to U+10FFFF OR less than or equal than U+7F for ASCII.
        /// The decoded character must be not be in U+D800...DFFF (UTF-8 or UTF-32) OR
        /// a high surrogate must be followed by a low surrogate and a low surrogate must be preceded by a high surrogate (UTF-16)
        too_large = 5,
        surrogate = 6,

        /// Found a character that cannot be part of a valid base64 string.
        invalid_base64_character = 7,
        /// The base64 input terminates with a single character, excluding padding (=).
        base64_input_remainder = 8,
        /// The provided buffer is too small.
        output_buffer_too_small = 9,
        /// Not related to validation/transcoding.
        _,
    };
};
pub extern fn simdutf__detect_encodings(input: [*]const u8, length: usize) c_int;
pub extern fn simdutf__validate_utf8(buf: [*]const u8, len: usize) bool;
pub extern fn simdutf__validate_utf8_with_errors(buf: [*]const u8, len: usize) SIMDUTFResult;
pub extern fn simdutf__validate_ascii(buf: [*]const u8, len: usize) bool;
pub extern fn simdutf__validate_ascii_with_errors(buf: [*]const u8, len: usize) SIMDUTFResult;
pub extern fn simdutf__validate_utf16le(buf: [*]const u16, len: usize) bool;
pub extern fn simdutf__validate_utf16be(buf: [*]const u16, len: usize) bool;
pub extern fn simdutf__validate_utf16le_with_errors(buf: [*]const u16, len: usize) SIMDUTFResult;
pub extern fn simdutf__validate_utf16be_with_errors(buf: [*]const u16, len: usize) SIMDUTFResult;
pub extern fn simdutf__validate_utf32(buf: [*c]const c_uint, len: usize) bool;
pub extern fn simdutf__validate_utf32_with_errors(buf: [*c]const c_uint, len: usize) SIMDUTFResult;
pub extern fn simdutf__convert_utf8_to_utf16le(buf: [*]const u8, len: usize, utf16_output: [*]u16) usize;
pub extern fn simdutf__convert_utf8_to_utf16be(buf: [*]const u8, len: usize, utf16_output: [*]u16) usize;
pub extern fn simdutf__convert_utf8_to_utf16le_with_errors(buf: [*]const u8, len: usize, utf16_output: [*]u16) SIMDUTFResult;
pub extern fn simdutf__convert_utf8_to_utf16be_with_errors(buf: [*]const u8, len: usize, utf16_output: [*]u16) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf8_to_utf16be(buf: [*]const u8, len: usize, utf16_buffer: [*]u16) usize;
pub extern fn simdutf__convert_utf8_to_utf32(buf: [*]const u8, len: usize, utf32_output: [*]u32) usize;
pub extern fn simdutf__convert_utf8_to_utf32_with_errors(buf: [*]const u8, len: usize, utf32_output: [*]u32) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf8_to_utf32(buf: [*]const u8, len: usize, utf32_buffer: [*]u32) usize;
pub extern fn simdutf__convert_utf16le_to_utf8(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_utf16be_to_utf8(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_utf16le_to_utf8_with_errors(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) SIMDUTFResult;
pub extern fn simdutf__convert_utf16be_to_utf8_with_errors(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf16le_to_utf8(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_valid_utf16be_to_utf8(buf: [*]const u16, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_utf32_to_utf8(buf: [*c]const c_uint, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_utf32_to_utf8_with_errors(buf: [*c]const c_uint, len: usize, utf8_buffer: [*]u8) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf32_to_utf8(buf: [*c]const c_uint, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__convert_utf32_to_utf16le(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) usize;
pub extern fn simdutf__convert_utf32_to_utf16be(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) usize;
pub extern fn simdutf__convert_utf32_to_utf16le_with_errors(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) SIMDUTFResult;
pub extern fn simdutf__convert_utf32_to_utf16be_with_errors(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf32_to_utf16le(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) usize;
pub extern fn simdutf__convert_valid_utf32_to_utf16be(buf: [*c]const c_uint, len: usize, utf16_buffer: [*]u16) usize;
pub extern fn simdutf__convert_utf16le_to_utf32(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) usize;
pub extern fn simdutf__convert_utf16be_to_utf32(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) usize;
pub extern fn simdutf__convert_utf16le_to_utf32_with_errors(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) SIMDUTFResult;
pub extern fn simdutf__convert_utf16be_to_utf32_with_errors(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) SIMDUTFResult;
pub extern fn simdutf__convert_valid_utf16le_to_utf32(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) usize;
pub extern fn simdutf__convert_valid_utf16be_to_utf32(buf: [*]const u16, len: usize, utf32_buffer: [*]u32) usize;
pub extern fn simdutf__convert_latin1_to_utf8(buf: [*]const u8, len: usize, utf8_buffer: [*]u8) usize;
pub extern fn simdutf__change_endianness_utf16(buf: [*]const u16, length: usize, output: [*]u16) void;
pub extern fn simdutf__count_utf16le(buf: [*]const u16, length: usize) usize;
pub extern fn simdutf__count_utf16be(buf: [*]const u16, length: usize) usize;
pub extern fn simdutf__count_utf8(buf: [*]const u8, length: usize) usize;
pub extern fn simdutf__utf8_length_from_utf16le(input: [*]const u16, length: usize) usize;
pub extern fn simdutf__utf8_length_from_utf16be(input: [*]const u16, length: usize) usize;
pub extern fn simdutf__utf32_length_from_utf16le(input: [*]const u16, length: usize) usize;
pub extern fn simdutf__utf32_length_from_utf16be(input: [*]const u16, length: usize) usize;
pub extern fn simdutf__utf16_length_from_utf8(input: [*]const u8, length: usize) usize;
pub extern fn simdutf__utf8_length_from_utf32(input: [*c]const c_uint, length: usize) usize;
pub extern fn simdutf__utf16_length_from_utf32(input: [*c]const c_uint, length: usize) usize;
pub extern fn simdutf__utf32_length_from_utf8(input: [*]const u8, length: usize) usize;
pub extern fn simdutf__utf8_length_from_latin1(input: [*]const u8, length: usize) usize;
pub extern fn simdutf__utf16_length_from_latin1(input: [*]const u8, length: usize) usize;

pub const validate = struct {
    pub const with_errors = struct {
        pub fn utf8(input: []const u8) SIMDUTFResult {
            return simdutf__validate_utf8_with_errors(input.ptr, input.len);
        }
        pub fn ascii(input: []const u8) SIMDUTFResult {
            return simdutf__validate_ascii_with_errors(input.ptr, input.len);
        }
        pub fn utf16le(input: []const u16) SIMDUTFResult {
            return simdutf__validate_utf16le_with_errors(input.ptr, input.len);
        }
        pub fn utf16be(input: []const u16) SIMDUTFResult {
            return simdutf__validate_utf16be_with_errors(input.ptr, input.len);
        }
    };

    pub fn utf8(input: []const u8) bool {
        return simdutf__validate_utf8(input.ptr, input.len);
    }
    pub fn ascii(input: []const u8) bool {
        jsc.markBinding(@src());
        return simdutf__validate_ascii(input.ptr, input.len);
    }
    pub fn utf16le(input: []const u16) bool {
        return simdutf__validate_utf16le(input.ptr, input.len);
    }
    pub fn utf16be(input: []const u16) bool {
        return simdutf__validate_utf16be(input.ptr, input.len);
    }
};

pub const convert = struct {
    pub const latin1 = struct {
        pub const to = struct {
            pub fn utf8(input: []const u8, output: []u8) usize {
                return simdutf__convert_latin1_to_utf8(input.ptr, input.len, output.ptr);
            }
        };
    };

    pub const utf8 = struct {
        pub const to = struct {
            pub const utf16 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u8, output: []u16) SIMDUTFResult {
                        return simdutf__convert_utf8_to_utf16le_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u8, output: []u16) SIMDUTFResult {
                        return simdutf__convert_utf8_to_utf16be_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u8, output: []u16) usize {
                    return simdutf__convert_utf8_to_utf16le(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u8, output: []u16) usize {
                    return simdutf__convert_utf8_to_utf16be(input.ptr, input.len, output.ptr);
                }
            };

            pub const utf32 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u8, output: []u32) SIMDUTFResult {
                        return simdutf__convert_utf8_to_utf32_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u8, output: []u32) SIMDUTFResult {
                        return simdutf__convert_utf8_to_utf32_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u8, output: []u32) usize {
                    return simdutf__convert_valid_utf8_to_utf32(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u8, output: []u32) usize {
                    return simdutf__convert_valid_utf8_to_utf32(input.ptr, input.len, output.ptr);
                }
            };
        };
    };

    pub const utf16 = struct {
        pub const to = struct {
            pub const utf8 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u16, output: []u8) SIMDUTFResult {
                        return simdutf__convert_utf16le_to_utf8_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u16, output: []u8) SIMDUTFResult {
                        return simdutf__convert_utf16be_to_utf8_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u16, output: []u8) usize {
                    return simdutf__convert_valid_utf16le_to_utf8(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u16, output: []u8) usize {
                    return simdutf__convert_valid_utf16be_to_utf8(input.ptr, input.len, output.ptr);
                }
            };

            pub const utf32 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u16, output: []u32) SIMDUTFResult {
                        return simdutf__convert_utf16le_to_utf32_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u16, output: []u32) SIMDUTFResult {
                        return simdutf__convert_utf16be_to_utf32_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u16, output: []u32) usize {
                    return simdutf__convert_valid_utf16le_to_utf32(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u16, output: []u32) usize {
                    return simdutf__convert_valid_utf16be_to_utf32(input.ptr, input.len, output.ptr);
                }
            };
        };
    };

    pub const utf32 = struct {
        pub const to = struct {
            pub const utf8 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u32, output: []u8) SIMDUTFResult {
                        return simdutf__convert_utf32_to_utf8_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u32, output: []u8) SIMDUTFResult {
                        return simdutf__convert_utf32_to_utf8_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u32, output: []u8) usize {
                    return simdutf__convert_valid_utf32_to_utf8(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u32, output: []u8) usize {
                    return simdutf__convert_valid_utf32_to_utf8(input.ptr, input.len, output.ptr);
                }
            };

            pub const utf16 = struct {
                pub const with_errors = struct {
                    pub fn le(input: []const u32, output: []u16) SIMDUTFResult {
                        return simdutf__convert_utf32_to_utf16le_with_errors(input.ptr, input.len, output.ptr);
                    }
                    pub fn be(input: []const u32, output: []u16) SIMDUTFResult {
                        return simdutf__convert_utf32_to_utf16be_with_errors(input.ptr, input.len, output.ptr);
                    }
                };

                pub fn le(input: []const u32, output: []u16) usize {
                    return simdutf__convert_valid_utf32_to_utf16le(input.ptr, input.len, output.ptr);
                }
                pub fn be(input: []const u32, output: []u16) usize {
                    return simdutf__convert_valid_utf32_to_utf16be(input.ptr, input.len, output.ptr);
                }
            };
        };
    };
};

pub const length = struct {
    pub const utf8 = struct {
        pub const from = struct {
            pub const utf16 = struct {
                pub fn le(input: []const u16) usize {
                    jsc.markBinding(@src());
                    return simdutf__utf8_length_from_utf16le(input.ptr, input.len);
                }
                pub fn be(input: []const u16) usize {
                    jsc.markBinding(@src());
                    return simdutf__utf8_length_from_utf16be(input.ptr, input.len);
                }
            };

            pub fn latin1(input: []const u8) usize {
                return simdutf__utf8_length_from_latin1(input.ptr, input.len);
            }

            pub fn utf32(input: []const u32) usize {
                jsc.markBinding(@src());
                return simdutf__utf8_length_from_utf32(input.ptr, input.len);
            }
        };
    };

    pub const utf16 = struct {
        pub const from = struct {
            pub fn utf8(input: []const u8) usize {
                if (@inComptime()) {
                    return @import("std").unicode.utf8CountCodepoints(input) catch @compileError("Invalid UTF-8");
                }
                return simdutf__utf16_length_from_utf8(input.ptr, input.len);
            }

            pub fn utf32(input: []const u32) usize {
                jsc.markBinding(@src());
                return simdutf__utf16_length_from_utf32(input.ptr, input.len);
            }

            pub fn latin1(input: []const u8) usize {
                return simdutf__utf16_length_from_latin1(input.ptr, input.len);
            }
        };
    };

    pub const utf32 = struct {
        pub const from = struct {
            pub const utf8 = struct {
                pub fn le(input: []const u8) usize {
                    jsc.markBinding(@src());
                    return simdutf__utf32_length_from_utf8(input.ptr, input.len);
                }
                pub fn be(input: []const u8) usize {
                    return simdutf__utf32_length_from_utf8(input.ptr, input.len);
                }
            };

            pub const utf16 = struct {
                pub fn le(input: []const u16) usize {
                    jsc.markBinding(@src());
                    return simdutf__utf32_length_from_utf16le(input.ptr, input.len);
                }
                pub fn be(input: []const u16) usize {
                    jsc.markBinding(@src());
                    return simdutf__utf32_length_from_utf16be(input.ptr, input.len);
                }
            };
        };
    };
};

pub const trim = struct {
    pub fn utf8_len(buf: []const u8) usize {
        const len = buf.len;

        if (len < 3) {
            switch (len) {
                2 => {
                    if (buf[len - 1] >= 0b11000000) {
                        return len - 1;
                    } // 2-, 3- and 4-byte characters with only 1 byte left
                    if (buf[len - 2] >= 0b11100000) {
                        return len - 2;
                    } // 3- and 4-byte characters with only 2 bytes left
                    return len;
                },
                1 => {
                    if (buf[len - 1] >= 0b11000000) {
                        return len - 1;
                    } // 2-, 3- and 4-byte characters with only 1 byte left
                    return len;
                },
                0 => return len,
                else => unreachable,
            }
        }

        if (buf[len - 1] >= 0b11000000) {
            return len - 1;
        } // 2-, 3- and 4-byte characters with only 1 byte left
        if (buf[len - 2] >= 0b11100000) {
            return len - 2;
        } // 3- and 4-byte characters with only 1 byte left
        if (buf[len - 3] >= 0b11110000) {
            return len - 3;
        } // 4-byte characters with only 3 bytes left
        return len;
    }

    pub fn utf16_len(buf: []const u16) usize {
        const len = buf.len;

        if (len == 0) {
            return 0;
        }
        if ((buf[len - 1] >= 0xD800) and (buf[len - 1] <= 0xDBFF)) {
            return len - 1;
        }
        return len;
    }

    pub fn utf16(buf: []const u16) []const u16 {
        return buf[0..utf16_len(buf)];
    }

    pub fn utf8(buf: []const u8) []const u8 {
        return buf[0..utf8_len(buf)];
    }
};

pub const base64 = struct {
    extern fn simdutf__base64_encode(input: [*]const u8, length: usize, output: [*]u8, is_urlsafe: c_int) usize;
    extern fn simdutf__base64_decode_from_binary(input: [*]const u8, length: usize, output: [*]u8, outlen: usize, is_urlsafe: c_int) SIMDUTFResult;
    extern fn simdutf__base64_decode_from_binary16(input: [*]const u16, length: usize, output: [*]u8, outlen: usize, is_urlsafe: c_int) SIMDUTFResult;
    extern fn simdutf__base64_length_from_binary(length: usize, options: c_int) usize;

    pub fn encode(input: []const u8, output: []u8, is_urlsafe: bool) usize {
        return simdutf__base64_encode(input.ptr, input.len, output.ptr, @intFromBool(is_urlsafe));
    }

    pub fn encode_len(input: usize, is_urlsafe: bool) usize {
        return simdutf__base64_length_from_binary(input, @intFromBool(is_urlsafe));
    }

    pub fn decode(input: []const u8, output: []u8, is_urlsafe: bool) SIMDUTFResult {
        return simdutf__base64_decode_from_binary(input.ptr, input.len, output.ptr, output.len, @intFromBool(is_urlsafe));
    }

    pub fn decode16(input: []const u16, output: []u8, is_urlsafe: bool) SIMDUTFResult {
        return simdutf__base64_decode_from_binary16(input.ptr, input.len, output.ptr, output.len, @intFromBool(is_urlsafe));
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
