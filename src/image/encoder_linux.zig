const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const EncodingOptions = @import("encoder.zig").EncodingOptions;

/// Linux implementation using appropriate libraries
pub fn encode(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    _ = allocator;
    _ = source;
    _ = width;
    _ = height;
    _ = format;
    _ = options;
    return error.NotImplemented;
}