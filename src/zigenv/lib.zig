const std = @import("std");
const read_pair = @import("parser/read_pair.zig");
const finalizer = @import("interpolation/finalizer.zig");
const EnvStream = @import("parser/env_stream.zig").EnvStream;
const memory = @import("buffer/memory_utils.zig");
const file_scanner = @import("parser/file_scanner.zig");
const ReusableBuffer = @import("buffer/reusable_buffer.zig").ReusableBuffer;
const EnvPair = @import("data/env_pair.zig").EnvPair;
const Allocator = std.mem.Allocator;
const Env = @import("data/env.zig").Env;

/// Parser configuration options for controlling parsing behavior.
pub const ParserOptions = @import("data/parser_options.zig").ParserOptions;

/// High-level API to parse a .env file from disk
pub fn parseFile(allocator: Allocator, path: []const u8) !Env {
    return parseFileWithOptions(allocator, path, ParserOptions.defaults(), null, null);
}

/// Parse a .env file with custom options
pub fn parseFileWithOptions(
    allocator: Allocator,
    path: []const u8,
    options: ParserOptions,
    lookup_fn: ?finalizer.LookupFn,
    context: ?*anyopaque,
) !Env {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    const content = try file.readToEndAlloc(allocator, std.math.maxInt(usize));
    defer allocator.free(content);

    return parseStringWithOptions(allocator, content, options, lookup_fn, context);
}

/// Parse .env content from a string
pub fn parseString(allocator: Allocator, content: []const u8) !Env {
    return parseStringWithOptions(allocator, content, ParserOptions.defaults(), null, null);
}

/// Parse .env content from a string with custom options
pub fn parseStringWithOptions(
    allocator: std.mem.Allocator,
    content: []const u8,
    options: ParserOptions,
    lookup_fn: ?finalizer.LookupFn,
    context: ?*anyopaque,
) !Env {
    // Pre-scan for buffer size hints to optimize allocations
    const hints = file_scanner.scanBufferSizes(content);

    var stream = EnvStream.init(content);
    // Use hints to initialize buffers with appropriate capacity
    var pairs = try read_pair.readPairsWithHints(allocator, &stream, hints, options);
    errdefer memory.deletePairs(&pairs);

    try finalizer.finalizeAllValues(allocator, &pairs, lookup_fn, context);

    var env = Env.init(allocator);
    errdefer env.deinit();

    for (pairs.items) |*pair| {
        // Take ownership of buffers
        const key = pair.key.buffer.toOwnedSlice();
        errdefer allocator.free(key);

        const value = pair.value.buffer.toOwnedSlice();
        errdefer allocator.free(value);

        try env.put(key, value);
        allocator.free(key);
        allocator.free(value);
    }

    // Clean up pair structures (interpolations, etc.) but buffers are already emptied by toOwnedSlice
    pairs.deinit();

    return env;
}

/// Parse .env content from a string (alias for parseString)
pub const parse = parseString;

/// Parse from any std.io.Reader
pub fn parseReader(allocator: Allocator, reader_obj: anytype) !Env {
    return parseReaderWithOptions(allocator, reader_obj, ParserOptions.defaults(), null, null);
}

/// Parse from any std.io.Reader with custom options
pub fn parseReaderWithOptions(
    allocator: Allocator,
    reader_obj: anytype,
    options: ParserOptions,
    lookup_fn: ?finalizer.LookupFn,
    context: ?*anyopaque,
) !Env {
    const content = try reader_obj.readAllAlloc(allocator, std.math.maxInt(usize));
    defer allocator.free(content);
    return parseStringWithOptions(allocator, content, options, lookup_fn, context);
}

test "parseString basic" {
    const allocator = std.testing.allocator;
    const content = "KEY=VALUE\nNAME=WORLD";
    var env = try parseString(allocator, content);
    defer env.deinit();

    try std.testing.expectEqualStrings("VALUE", env.get("KEY").?);
    try std.testing.expectEqualStrings("WORLD", env.get("NAME").?);
}

test "parseString with interpolation" {
    const allocator = std.testing.allocator;
    const content = "USER=antigravity\nWELCOME=hello ${USER}";
    var env = try parseString(allocator, content);
    defer env.deinit();

    try std.testing.expectEqualStrings("antigravity", env.get("USER").?);
    try std.testing.expectEqualStrings("hello antigravity", env.get("WELCOME").?);
}

test "parseString with :- interpolation" {
    const allocator = std.testing.allocator;
    const content = "WELCOME=hello ${USER:-world}";
    var env = try parseString(allocator, content);
    defer env.deinit();

    try std.testing.expectEqualStrings("hello world", env.get("WELCOME").?);
}

test "parseString with external lookup" {
    const allocator = std.testing.allocator;
    const content = "WELCOME=hello ${USER}";

    const Context = struct {
        pub fn lookup(_: ?*anyopaque, key: []const u8) ?[]const u8 {
            if (std.mem.eql(u8, key, "USER")) return "external";
            return null;
        }
    };

    var env = try parseStringWithOptions(allocator, content, ParserOptions.defaults(), Context.lookup, null);
    defer env.deinit();

    try std.testing.expectEqualStrings("hello external", env.get("WELCOME").?);
}

test "parseFile basic" {
    const allocator = std.testing.allocator;
    const path = "test_env_file.env";
    const content = "FILE_KEY=FILE_VALUE";

    // Create temp file
    const file = try std.fs.cwd().createFile(path, .{});
    try file.writeAll(content);
    file.close();
    defer std.fs.cwd().deleteFile(path) catch {};

    var env = try parseFile(allocator, path);
    defer env.deinit();

    try std.testing.expectEqualStrings("FILE_VALUE", env.get("FILE_KEY").?);
}

test "Env methods" {
    const allocator = std.testing.allocator;
    var env = Env.init(allocator);
    defer env.deinit();

    const key = try allocator.dupe(u8, "K");
    defer allocator.free(key);
    const val = try allocator.dupe(u8, "V");
    defer allocator.free(val);

    try env.put(key, val);

    try std.testing.expectEqualStrings("V", env.get("K").?);
    try std.testing.expectEqualStrings("V", env.getWithDefault("K", "D"));
    try std.testing.expectEqualStrings("D", env.getWithDefault("MISSING", "D"));
}

test "parsing with pre-scan optimization" {
    const allocator = std.testing.allocator;
    const content =
        \\SMALL=x
        \\MEDIUM_KEY=medium_value
        \\VERY_LONG_KEY_NAME=very_long_value_content_here
    ;

    var env = try parseString(allocator, content);
    defer env.deinit();

    // Should work correctly with pre-scanned sizes
    try std.testing.expectEqualStrings("x", env.get("SMALL").?);
    try std.testing.expectEqualStrings("medium_value", env.get("MEDIUM_KEY").?);
    try std.testing.expectEqualStrings("very_long_value_content_here", env.get("VERY_LONG_KEY_NAME").?);
}

test "parsing with underestimated buffers grows correctly" {
    const allocator = std.testing.allocator;

    // Create content where value is longer than scanner might estimate
    const content =
        \\KEY="""
        \\This is a heredoc with lots of content
        \\that might not be perfectly estimated
        \\by the pre-scanner heuristic
        \\"""
    ;

    var env = try parseString(allocator, content);
    defer env.deinit();

    // Should still parse correctly even if initial size was wrong
    try std.testing.expect(env.get("KEY") != null);
    try std.testing.expect(std.mem.indexOf(u8, env.get("KEY").?, "heredoc") != null);
}

test "large file performance" {
    const allocator = std.testing.allocator;

    // Generate a large env file
    var buffer = ReusableBuffer.init(allocator);
    defer buffer.deinit();

    var i: usize = 0;
    while (i < 1000) : (i += 1) {
        try buffer.writer().print("KEY_{d}=VALUE_{d}\n", .{ i, i });
    }

    var env = try parseString(allocator, buffer.items());
    defer env.deinit();

    try std.testing.expectEqual(@as(usize, 1000), env.map.count());
}
