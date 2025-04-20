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

extern "c" fn highway_char_frequency(
    text: [*]const u8,
    text_len: usize,
    freqs: [*]i32,
    delta: i32,
) void;

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

extern "c" fn highway_index_of_newline_or_non_ascii(
    noalias haystack: [*]const u8,
    haystack_len: usize,
) i64;

extern "c" fn highway_index_of_newline_or_non_ascii_or_ansi(
    noalias haystack: [*]const u8,
    haystack_len: usize,
) i64;

extern "c" fn highway_contains_newline_or_non_ascii_or_quote(
    noalias text: [*]const u8,
    text_len: usize,
) bool;

extern "c" fn highway_index_of_needs_escape_for_javascript_string(
    noalias text: [*]const u8,
    text_len: usize,
    quote_char: u8,
) usize;

extern "c" fn highway_index_of_any_char(
    noalias text: [*]const u8,
    text_len: usize,
    noalias chars: [*]const u8,
    chars_len: usize,
) usize;

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

pub fn indexOfNewlineOrNonASCII(haystack: string) ?usize {
    bun.debugAssert(haystack.len > 0);

    const result = highway_index_of_newline_or_non_ascii(
        haystack.ptr,
        haystack.len,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

pub fn indexOfNewlineOrNonASCIIOrANSI(haystack: string) ?usize {
    bun.debugAssert(haystack.len > 0);

    const result = highway_index_of_newline_or_non_ascii_or_ansi(
        haystack.ptr,
        haystack.len,
    );

    if (result < 0) {
        return null;
    }

    return @as(usize, @intCast(result));
}

/// Checks if the string contains any newlines, non-ASCII characters, or quotes
pub fn containsNewlineOrNonASCIIOrQuote(text: string) bool {
    if (text.len == 0) {
        return false;
    }

    return highway_contains_newline_or_non_ascii_or_quote(
        text.ptr,
        text.len,
    );
}

/// Finds the first character that needs escaping in a JavaScript string
/// Looks for characters above ASCII (> 127), control characters (< 0x20),
/// backslash characters (`\`), the quote character itself, and for backtick
/// strings also the dollar sign (`$`)
pub fn indexOfNeedsEscapeForJavaScriptString(slice: string, quote_char: u8) ?u32 {
    if (slice.len == 0) {
        return null;
    }

    const result = highway_index_of_needs_escape_for_javascript_string(
        slice.ptr,
        slice.len,
        quote_char,
    );

    if (result == slice.len) {
        return null;
    }

    return @truncate(result);
}

pub fn indexOfAnyChar(haystack: string, chars: string) ?usize {
    if (haystack.len == 0 or chars.len == 0) {
        return null;
    }

    return highway_index_of_any_char(haystack.ptr, haystack.len, chars.ptr, chars.len);
}
