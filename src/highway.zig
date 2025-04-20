const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const string = bun.string;
const Environment = bun.Environment;

/// Result structure for character finding operations
pub const IndexResult = extern struct {
    index: i32, // -1 if not found
    count: i32,
};

/// External C functions from Highway SIMD implementation
extern "c" fn highway_find_chars(
    text: [*]const u8,
    text_len: usize,
    chars: [*]const u8,
    chars_len: usize,
) IndexResult;

extern "c" fn highway_char_frequency(
    text: [*]const u8,
    text_len: usize,
    freqs: [*]i32,
    delta: i32,
) void;

extern "c" fn highway_find_substr_case_insensitive(
    haystack: [*]const u8,
    haystack_len: usize,
    needle: [*]const u8,
    needle_len: usize,
) i32;

extern "c" fn highway_index_of_interesting_char(
    text: [*]const u8,
    text_len: usize,
    quote_type: u8,
) i32;

extern "c" fn highway_index_of_substring(
    haystack: [*]const u8,
    haystack_len: usize,
    needle: [*]const u8,
    needle_len: usize,
) i32;

extern "c" fn highway_index_of_char(
    haystack: [*]const u8,
    haystack_len: usize,
    needle: u8,
) i64;

extern "c" fn highway_index_of_interesting_character_in_string_literal(
    noalias text: [*]const u8,
    text_len: usize,
    quote: u8,
) usize;

/// Find any character from the chars slice in the text slice
/// Returns the position of the first match, or null if not found
pub fn indexOfAnyChar(text: string, chars: string) ?usize {
    if (chars.len == 0 or text.len == 0) {
        return null;
    }

    const result = highway_find_chars(
        text.ptr,
        text.len,
        chars.ptr,
        chars.len,
    );

    if (result.index < 0) {
        return null;
    }

    return @as(usize, @intCast(result.index));
}

/// Count frequencies of [a-zA-Z0-9_$] characters in a string
/// Updates the provided frequency array with counts (adds delta for each occurrence)
pub fn scanCharFrequency(text: string, freqs: *[64]i32, delta: i32) void {
    if (text.len == 0 or delta == 0) {
        return;
    }

    highway_char_frequency(
        text.ptr,
        text.len,
        freqs.ptr,
        delta,
    );
}

/// Find a substring in a string, case-insensitive (ASCII only)
/// Returns the position of the first match, or null if not found
pub fn indexOfCaseInsensitive(haystack: string, needle: string) ?usize {
    if (needle.len == 0) {
        return 0;
    }

    if (haystack.len < needle.len) {
        return null;
    }

    const result = highway_find_substr_case_insensitive(
        haystack.ptr,
        haystack.len,
        needle.ptr,
        needle.len,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

/// Example to replace existing @Vector code in string_immutable.zig's indexOfAny function
/// This would be integrated into that function as an alternative implementation
pub fn indexOfAnyReplacement(slice: string, str: string) ?usize {
    if (slice.len == 0 or str.len == 0) {
        return null;
    }

    return indexOfAnyChar(slice, str);
}

/// Helper wrapper for the most common double-quoted string literals
pub fn indexOfInterestingCharacterInDoubleQuotedString(slice: string) ?usize {
    return indexOfInterestingCharacterInStringLiteral(slice, '"');
}

/// Helper wrapper for the most common single-quoted string literals
pub fn indexOfInterestingCharacterInSingleQuotedString(slice: string) ?usize {
    return indexOfInterestingCharacterInStringLiteral(slice, '\'');
}

/// Helper wrapper for template literals with backticks
pub fn indexOfInterestingCharacterInTemplateLiteral(slice: string) ?usize {
    return indexOfInterestingCharacterInStringLiteral(slice, '`');
}

pub fn indexOfChar(haystack: string, needle: u8) ?usize {
    if (haystack.len == 0) {
        return null;
    }

    const result = highway_index_of_char(
        haystack.ptr,
        haystack.len,
        needle,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

/// Fast substring search (like Zig's std.mem.indexOf but with Highway SIMD optimization)
/// Finds the first occurrence of needle in haystack
/// Returns the position of the first match, or null if not found
pub fn indexOfSubstring(haystack: string, needle: string) ?usize {
    if (needle.len == 0) {
        return 0; // Empty needle always matches at position 0
    }

    if (haystack.len < needle.len) {
        return null; // Needle can't fit in haystack
    }

    const result = highway_index_of_substring(
        haystack.ptr,
        haystack.len,
        needle.ptr,
        needle.len,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

/// Case-insensitive substring search
/// Returns the position of the first case-insensitive match, or null if not found
pub fn indexOfSubstringCaseInsensitive(haystack: string, needle: string) ?usize {
    if (needle.len == 0) {
        return 0; // Empty needle always matches at position 0
    }

    if (haystack.len < needle.len) {
        return null; // Needle can't fit in haystack
    }

    const result = highway_find_substr_case_insensitive(
        haystack.ptr,
        haystack.len,
        needle.ptr,
        needle.len,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

// To replace CharFreq implementation in js_ast.zig:
pub const CharFreq = struct {
    freqs: [64]i32 align(1) = [_]i32{0} ** 64,

    pub fn scan(this: *CharFreq, text: string, delta: i32) void {
        if (delta == 0 or text.len == 0) {
            return;
        }

        scanCharFrequency(text, &this.freqs, delta);
    }

    pub fn include(this: *CharFreq, other: CharFreq) void {
        for (&this.freqs, other.freqs) |*dest, src| {
            dest.* += src;
        }
    }
};

pub fn indexOfInterestingCharacterInStringLiteral(slice: string, quote_type: u8) ?usize {
    if (slice.len == 0) {
        return null;
    }

    const result = highway_index_of_interesting_character_in_string_literal(
        slice.ptr,
        slice.len,
        quote_type,
    );

    if (result == std.math.maxInt(usize)) {
        return null;
    }

    return result;
}
