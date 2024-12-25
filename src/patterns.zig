const bun = @import("root").bun;
const glob = @import("./glob.zig");
const string = bun.string;
const std = @import("std");
const c_size_t = std.c_size_t;

fn matchesRegex(target: string, pattern: string) bool {
    const allocator = std.heap.c_allocator;

    // Import the PCRE2 library
    const pcre2 = @cImport({
        @cInclude("pcre2.h");
    });

    const _options = pcre2.PCRE2_ZERO_TERMINATED;
    const error_code: *c_int = undefined;
    const error_offset: *c_size_t = undefined;

    // Compile the regex pattern
    const re = pcre2.pcre2_compile(
        pattern.ptr,
        pattern.len,
        _options,
        error_code,
        error_offset,
        null,
    );

    if (re == null) {
        std.debug.warn("Failed to compile regex: {}\n", .{pattern});
        return false;
    }

    const match_data = pcre2.pcre2_match_data_create_from_pattern(re, allocator);
    if (match_data == null) {
        pcre2.pcre2_code_free(re);
        return false;
    }

    const result = pcre2.pcre2_match(
        re,
        target.ptr,
        target.len,
        0,
        0,
        match_data,
        null,
    );

    pcre2.pcre2_match_data_free(match_data);
    pcre2.pcre2_code_free(re);

    return result >= 0;
}

pub fn matchesAnyPattern(target: string, patterns: []const string) bool {
    for (patterns) |pattern| {
        if (glob.detectGlobSyntax(pattern)) {
            if (glob.matchImpl(pattern, target)) {
                return true;
            }
        } else {
            if (matchesRegex(target, pattern)) {
                return true;
            }
        }
    }
    return false;
}

test "matchesRegex should correctly match valid regex patterns" {
    try testing.expect(matchesRegex("hello", "h.*o"));
    try testing.expect(!matchesRegex("hello", "^world$"));
    try testing.expect(matchesRegex("12345", "\\d+"));
    try testing.expect(!matchesRegex("abc", "\\d+"));
}

test "matchesAnyPattern should correctly match against multiple patterns" {
    const patternsList = &[_][]const u8{
        "*.ts",
        "\\d+",
        "file?.txt",
    };

    try testing.expect(matchesAnyPattern("file.ts", patternsList));
    try testing.expect(matchesAnyPattern("12345", patternsList));
    try testing.expect(matchesAnyPattern("file1.txt", patternsList));
    try testing.expect(!matchesAnyPattern("file.jpg", patternsList));
    try testing.expect(!matchesAnyPattern("abcdef", patternsList));