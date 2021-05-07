const std = @import("std");

pub var out_buffer: []u8 = &([_]u8{});
pub var Stream: ?std.io.FixedBufferStream([]u8) = null;
pub var writer = if (Stream) |stream| stream.writer() else null;
