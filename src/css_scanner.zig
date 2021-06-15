const Fs = @import("fs.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const options = @import("./options.zig");
const logger = @import("./logger.zig");

// This is not a CSS parser.
// All this does is scan for URLs and @import statements
// Once found, it resolves & rewrites them
// Eventually, there will be a real CSS parser in here.
// But, no time yet.
pub const Chunk = struct {
    // Entire chunk
    range: logger.Range,

    pub const Content = union(Tag) {
        t_url: TextContent,
        t_import: Import,
        t_verbatim: Verbatim,
    };

    pub const TextContent = struct {
        quote: Quote = .none,
        utf8: string,

        pub const Quote = enum {
            none,
            double,
            single,
        };
    };
    pub const Import = struct {
        url: bool = false,
        text: TextContent,
    };
    pub const Verbatim = struct {};

    pub const Tag = enum {
        t_url,
        t_verbatim,
        t_import,
    };
};

pub const Token = enum {
    t_end_of_file,
    t_semicolon,
    t_whitespace,
    t_at_import,
    t_url,
    t_verbatim,
};

pub fn NewScanner(
    comptime ReaderType: type,
    comptime WriterType: type,
    comptime ResolverType: type,
    comptime buffer_size: usize,
) type {
    return struct {
        const Scanner = @This();
        buffer: [buffer_size]u8 = undefined,
        current: usize = 0,
        start: usize = 0,
        end: usize = 0,
        log: *logger.Log,

        has_newline_before: bool = false,

        token: Token,

        reader: ReaderType,
        writer: WriterType,
        resolver: ResolverType,

        pub fn step(scanner: *Scanner) !void {}
        pub fn raw(scanner: *Scanner) string {}
        pub fn next(scanner: *Scanner) !void {
            scanner.has_newline_before = scanner.end == 0;

            while (true) {
                scanner.start = scanner.end;
                scanner.token = .t_end_of_file;

                switch (scanner.nextCodepoint()) {
                    ' ', '\t', '\n', '\r', 0x0C => {},
                    '@' => {},
                    '\'', '"' => {},
                    '/' => {},
                }
            }
        }
        pub fn eat(scanner: *Scanner) !Result {}

        inline fn nextCodepointSlice(it: *Scanner) []const u8 {
            @setRuntimeSafety(false);

            const cp_len = utf8ByteSequenceLength(it.source.contents[it.current]);
            it.end = it.current;
            it.current += cp_len;

            return if (!(it.current > it.source.contents.len)) it.source.contents[it.current - cp_len .. it.current] else "";
        }

        pub fn nextCodepoint(it: *Scanner) CodePoint {
            const slice = it.nextCodepointSlice();
            @setRuntimeSafety(false);

            return switch (slice.len) {
                0 => -1,
                1 => @intCast(CodePoint, slice[0]),
                2 => @intCast(CodePoint, std.unicode.utf8Decode2(slice) catch unreachable),
                3 => @intCast(CodePoint, std.unicode.utf8Decode3(slice) catch unreachable),
                4 => @intCast(CodePoint, std.unicode.utf8Decode4(slice) catch unreachable),
                else => unreachable,
            };
        }
    };
}
