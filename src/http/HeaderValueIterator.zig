const HeaderValueIterator = @This();

iterator: std.mem.TokenIterator(u8, .scalar),

pub fn init(input: []const u8) HeaderValueIterator {
    return HeaderValueIterator{
        .iterator = std.mem.tokenizeScalar(u8, std.mem.trim(u8, input, " \t"), ','),
    };
}

pub fn next(self: *HeaderValueIterator) ?[]const u8 {
    const slice = std.mem.trim(u8, self.iterator.next() orelse return null, " \t");
    if (slice.len == 0) return self.next();

    return slice;
}

const std = @import("std");
