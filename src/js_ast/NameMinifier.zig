//! Name minification utilities
//! Utilities for generating minified names during code optimization

const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;

/// NameMinifier generates minified variable names
/// Used during code minification to create short, valid identifiers
const NameMinifier = @This();

/// First characters that can be used in identifiers
head: std.ArrayList(u8),

/// Subsequent characters that can be used in identifiers
tail: std.ArrayList(u8),

/// Default first characters for identifiers
pub const default_head = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";

/// Default subsequent characters for identifiers
pub const default_tail = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";

/// Character frequency counter maximum range
const char_freq_count = 64;

/// Initialize a new NameMinifier
pub fn init(allocator: std.mem.Allocator) NameMinifier {
    return .{
        .head = std.ArrayList(u8).init(allocator),
        .tail = std.ArrayList(u8).init(allocator),
    };
}

/// Convert a number to a minified name
pub fn numberToMinifiedName(this: *NameMinifier, name: *std.ArrayList(u8), _i: isize) !void {
    name.clearRetainingCapacity();
    var i = _i;
    var j = @as(usize, @intCast(@mod(i, 54)));
    try name.appendSlice(this.head.items[j .. j + 1]);
    i = @divFloor(i, 54);

    while (i > 0) {
        i -= 1;
        j = @as(usize, @intCast(@mod(i, char_freq_count)));
        try name.appendSlice(this.tail.items[j .. j + 1]);
        i = @divFloor(i, char_freq_count);
    }
}

/// Convert a number to a minified name using default character sets
pub fn defaultNumberToMinifiedName(allocator: std.mem.Allocator, _i: isize) !string {
    var i = _i;
    var j = @as(usize, @intCast(@mod(i, 54)));
    var name = std.ArrayList(u8).init(allocator);
    try name.appendSlice(default_head[j .. j + 1]);
    i = @divFloor(i, 54);

    while (i > 0) {
        i -= 1;
        j = @as(usize, @intCast(@mod(i, char_freq_count)));
        try name.appendSlice(default_tail[j .. j + 1]);
        i = @divFloor(i, char_freq_count);
    }

    return name.items;
}