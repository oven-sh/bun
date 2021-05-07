const std = @import("std");

pub var out_buffer = [_]u8{0} ** 1024;
pub var Stream = std.io.fixedBufferStream(&out_buffer);
pub var writer = Stream.writer();
