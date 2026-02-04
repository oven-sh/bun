const std = @import("std");
const testing = std.testing;
const builtin = @import("builtin");
const is_windows = builtin.os.tag == .windows;

pub const EnvStream = struct {
    data: []const u8,
    index: usize,
    length: usize,
    is_good: bool,

    pub fn init(data: []const u8) EnvStream {
        return EnvStream{
            .data = data,
            .index = 0,
            .length = data.len,
            .is_good = data.len > 0,
        };
    }

    pub fn deinit(self: *EnvStream) void {
        _ = self;
    }

    // Read next char and advance (return null on EOF)
    pub fn get(self: *EnvStream) ?u8 {
        if (self.index >= self.length) {
            self.is_good = false;
            return null;
        }

        const char = self.data[self.index];
        self.index += 1;

        // On Windows, skip \r before \n
        if (comptime is_windows) {
            if (char == '\r') {
                // Peek at next char
                if (self.index < self.length and self.data[self.index] == '\n') {
                    // Skip the \r, consume the \n
                    const next_char = self.data[self.index];
                    self.index += 1;
                    self.is_good = self.index < self.length;
                    return next_char;
                }
            }
        }

        self.is_good = self.index < self.length;
        return char;
    }

    // Peek at next char without advancing
    pub fn peek(self: EnvStream) ?u8 {
        if (self.index >= self.length) return null;
        const char = self.data[self.index];

        if (comptime is_windows) {
            if (char == '\r') {
                if (self.index + 1 < self.length and self.data[self.index + 1] == '\n') {
                    return '\n';
                }
            }
        }

        return char;
    }

    // Check if stream is valid
    pub fn good(self: EnvStream) bool {
        return self.is_good;
    }

    // Check if end of stream
    pub fn eof(self: EnvStream) bool {
        return self.index >= self.length;
    }

    pub fn skipToNewline(self: *EnvStream) void {
        while (true) {
            const char_opt = self.get();
            if (char_opt == null) break;
            if (char_opt.? == '\n') break;
        }
    }
};

test "EnvStream basic reading" {
    const data = "test";
    var stream = EnvStream.init(data);

    try testing.expect(stream.good());
    try testing.expect(!stream.eof());

    try testing.expectEqual(@as(?u8, 't'), stream.get());
    try testing.expectEqual(@as(?u8, 'e'), stream.get());
    try testing.expectEqual(@as(?u8, 's'), stream.get());
    try testing.expectEqual(@as(?u8, 't'), stream.get());

    try testing.expect(stream.eof());
    try testing.expectEqual(@as(?u8, null), stream.get());
    try testing.expect(!stream.good());
}

test "EnvStream empty stream" {
    const data = "";
    var stream = EnvStream.init(data);

    try testing.expect(stream.eof());
    try testing.expect(!stream.good()); // Now false initially if empty

    try testing.expectEqual(@as(?u8, null), stream.get());
    try testing.expect(!stream.good());
}

test "EnvStream state tracking" {
    const data = "a";
    var stream = EnvStream.init(data);

    try testing.expect(stream.good());
    _ = stream.get();
    try testing.expect(!stream.good()); // Now false after reading last char
    try testing.expect(stream.eof());

    _ = stream.get();
    try testing.expect(!stream.good());
}

test "EnvStream CRLF handling" {
    // Simulate Windows-style content
    const content = "KEY=value\r\nOTHER=test\r\n";
    var stream = EnvStream.init(content);

    // Read characters
    var result: [32]u8 = undefined;
    var i: usize = 0;
    while (stream.get()) |c| {
        result[i] = c;
        i += 1;
    }

    // On Windows, \r should be stripped before \n
    if (comptime is_windows) {
        try testing.expectEqualStrings("KEY=value\nOTHER=test\n", result[0..i]);
    } else {
        // On non-Windows, both should remain (unless we change the design)
        try testing.expectEqualStrings("KEY=value\r\nOTHER=test\r\n", result[0..i]);
    }
}

test "EnvStream standalone CR not stripped" {
    // Only \r\n pairs should be collapsed, not standalone \r
    const content = "KEY=val\rue\n"; // CR in middle of value
    var stream = EnvStream.init(content);

    var result: [32]u8 = undefined;
    var i: usize = 0;
    while (stream.get()) |c| {
        result[i] = c;
        i += 1;
    }

    // Even on Windows, standalone \r is preserved
    try testing.expectEqualStrings("KEY=val\rue\n", result[0..i]);
}

test "EnvStream mixed line endings" {
    const content = "LF\nCRLF\r\nLF\n";
    var stream = EnvStream.init(content);

    var result: [32]u8 = undefined;
    var i: usize = 0;
    while (stream.get()) |c| {
        result[i] = c;
        i += 1;
    }

    if (comptime is_windows) {
        try testing.expectEqualStrings("LF\nCRLF\nLF\n", result[0..i]);
    } else {
        try testing.expectEqualStrings("LF\nCRLF\r\nLF\n", result[0..i]);
    }
}

test "EnvStream CR at very end" {
    const content = "KEY=\r";
    var stream = EnvStream.init(content);

    var result: [10]u8 = undefined;
    var i: usize = 0;
    while (stream.get()) |c| {
        result[i] = c;
        i += 1;
    }

    // On both Windows and Unix, a standalone \r at the very end should be preserved
    // because it's not followed by \n
    try testing.expectEqualStrings("KEY=\r", result[0..i]);
}
