const std = @import("std");
const bun = @import("../bun.zig");
const strings = bun.strings;
const js_lexer = bun.js_lexer;

pub const ParsedGlobalName = struct {
    /// List of identifiers in the global name path
    /// e.g., "window.MyLib.v1" -> ["window", "MyLib", "v1"]
    parts: []const []const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *ParsedGlobalName) void {
        for (self.parts) |part| {
            self.allocator.free(part);
        }
        self.allocator.free(self.parts);
    }

    /// Generate the variable declaration part
    /// e.g., "window.MyLib.v1" -> "var window;"
    pub fn generateVarDeclaration(self: ParsedGlobalName, writer: anytype, minify: bool) !void {
        if (self.parts.len > 0) {
            try writer.writeAll("var ");
            try writer.writeAll(self.parts[0]);
            try writer.writeAll(if (minify) ";" else ";\n");
        }
    }

    /// Generate the assignment expression
    /// e.g., "window.MyLib.v1" -> "(((window ||= {}).MyLib ||= {}).v1 = "
    pub fn generateAssignment(self: ParsedGlobalName, writer: anytype, minify: bool) !void {
        if (self.parts.len == 0) return;
        
        if (self.parts.len == 1) {
            // Simple case: just "globalName"
            try writer.writeAll(self.parts[0]);
            if (minify) {
                try writer.writeAll("=");
            } else {
                try writer.writeAll(" = ");
            }
            return;
        }

        // Complex case: "a.b.c" -> "(((a ||= {}).b ||= {}).c = "
        for (self.parts, 0..) |part, i| {
            if (i < self.parts.len - 1) {
                if (i == 0) {
                    try writer.writeAll("(");
                    try writer.writeAll(part);
                    if (minify) {
                        try writer.writeAll("||={})");
                    } else {
                        try writer.writeAll(" ||= {})");
                    }
                } else {
                    try writer.writeAll(".");
                    try writer.writeAll(part);
                    if (minify) {
                        try writer.writeAll("||={})");
                    } else {
                        try writer.writeAll(" ||= {})");
                    }
                }
            } else {
                // Last part
                try writer.writeAll(".");
                try writer.writeAll(part);
                if (minify) {
                    try writer.writeAll("=");
                } else {
                    try writer.writeAll(" = ");
                }
            }
        }
    }
};

/// Parse a global name that may contain dot expressions
/// e.g., "myLib", "window.myLib", "globalThis.my.lib"
/// Returns null if the global name is invalid
pub fn parseGlobalName(allocator: std.mem.Allocator, text: []const u8) !?ParsedGlobalName {
    if (text.len == 0) return null;

    var parts = std.ArrayList([]const u8).init(allocator);
    defer parts.deinit();

    var iter = std.mem.tokenizeScalar(u8, text, '.');
    
    while (iter.next()) |part| {
        // Each part must be a valid identifier
        if (!js_lexer.isIdentifier(part)) {
            // Clean up allocated parts
            for (parts.items) |p| {
                allocator.free(p);
            }
            return null;
        }

        const part_copy = try allocator.dupe(u8, part);
        try parts.append(part_copy);
    }

    if (parts.items.len == 0) return null;

    return ParsedGlobalName{
        .parts = try parts.toOwnedSlice(),
        .allocator = allocator,
    };
}

test "parseGlobalName" {
    const allocator = std.testing.allocator;
    
    // Simple identifier
    {
        var parsed = try parseGlobalName(allocator, "myLib");
        defer if (parsed) |*p| p.deinit();
        try std.testing.expect(parsed != null);
        try std.testing.expectEqual(@as(usize, 1), parsed.?.parts.len);
        try std.testing.expectEqualStrings("myLib", parsed.?.parts[0]);
    }
    
    // Dot expression
    {
        var parsed = try parseGlobalName(allocator, "window.myLib");
        defer if (parsed) |*p| p.deinit();
        try std.testing.expect(parsed != null);
        try std.testing.expectEqual(@as(usize, 2), parsed.?.parts.len);
        try std.testing.expectEqualStrings("window", parsed.?.parts[0]);
        try std.testing.expectEqualStrings("myLib", parsed.?.parts[1]);
    }
    
    // Nested dot expression
    {
        var parsed = try parseGlobalName(allocator, "globalThis.my.lib.v1");
        defer if (parsed) |*p| p.deinit();
        try std.testing.expect(parsed != null);
        try std.testing.expectEqual(@as(usize, 4), parsed.?.parts.len);
        try std.testing.expectEqualStrings("globalThis", parsed.?.parts[0]);
        try std.testing.expectEqualStrings("my", parsed.?.parts[1]);
        try std.testing.expectEqualStrings("lib", parsed.?.parts[2]);
        try std.testing.expectEqualStrings("v1", parsed.?.parts[3]);
    }
    
    // Invalid: starts with number
    {
        const parsed = try parseGlobalName(allocator, "123invalid");
        try std.testing.expect(parsed == null);
    }
    
    // Invalid: contains invalid identifier
    {
        const parsed = try parseGlobalName(allocator, "window.123");
        try std.testing.expect(parsed == null);
    }
    
    // Invalid: empty parts
    {
        const parsed = try parseGlobalName(allocator, "window..lib");
        try std.testing.expect(parsed == null);
    }
}