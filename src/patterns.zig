const bun = @import("root").bun;
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

fn isGlobPattern(pattern: string) bool {
    return std.mem.contains(u8, pattern, '*') or std.mem.contains(u8, pattern, '?');
}

fn matchesGlob(pattern: string, target: string) bool {
    var i = 0;
    var j = 0;

    while (i < pattern.len and j < target.len) {
        switch (pattern[i]) {
            '*' => {
                if (i + 1 < pattern.len and pattern[i + 1] == '*') {
                    // Handle '**' (any directory level)
                    i += 2;
                    while (j < target.len and target[j] != '/') {
                        j += 1;
                    }
                } else {
                    // Handle '*' (any characters except '/')
                    i += 1;
                    while (j < target.len and target[j] != '/') {
                        j += 1;
                    }
                }
            },
            '?' => {
                // Handle '?' (any single character)
                i += 1;
                j += 1;
            },
            else => {
                // Match characters literally
                if (pattern[i] != target[j]) return false;
                i += 1;
                j += 1;
            },
        }
    }

    // Ensure the entire pattern and target are consumed
    return i == pattern.len and j == target.len;
}

pub fn matchesAnyPattern(target: string, patterns: []const string) bool {
    for (patterns) |pattern| {
        if (isGlobPattern(pattern)) {
            if (matchesGlob(target, pattern)) {
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

test "isGlobPattern should correctly identify glob patterns" {
    try testing.expect(isGlobPattern("*.ts"));
    try testing.expect(isGlobPattern("test?.txt"));
    try testing.expect(!isGlobPattern("plain-text"));
    try testing.expect(isGlobPattern("dir/**/*.js"));
}

test "matchesGlob should correctly match glob patterns" {
    try testing.expect(matchesGlob("*.ts", "file.ts"));
    try testing.expect(!matchesGlob("*.ts", "file.js"));
    try testing.expect(matchesGlob("test?.txt", "test1.txt"));
    try testing.expect(!matchesGlob("test?.txt", "test12.txt"));
    try testing.expect(matchesGlob("dir/**/*.js", "dir/subdir/file.js"));
    try testing.expect(!matchesGlob("dir/**/*.js", "other/file.js"));
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