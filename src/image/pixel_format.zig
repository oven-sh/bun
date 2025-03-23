const std = @import("std");
const math = std.math;

/// PixelFormat defines supported pixel formats for image operations
pub const PixelFormat = enum {
    /// Grayscale: 1 byte per pixel
    Gray,
    /// Grayscale with alpha: 2 bytes per pixel
    GrayAlpha,
    /// RGB: 3 bytes per pixel
    RGB,
    /// RGBA: 4 bytes per pixel
    RGBA,
    /// BGR: 3 bytes per pixel (common in some image formats)
    BGR,
    /// BGRA: 4 bytes per pixel (common in some image formats)
    BGRA,
    /// ARGB: 4 bytes per pixel (used in some systems)
    ARGB,
    /// ABGR: 4 bytes per pixel
    ABGR,

    /// Get the number of bytes per pixel for this format
    pub fn getBytesPerPixel(self: PixelFormat) u8 {
        return switch (self) {
            .Gray => 1,
            .GrayAlpha => 2,
            .RGB, .BGR => 3,
            .RGBA, .BGRA, .ARGB, .ABGR => 4,
        };
    }

    /// Get the number of color channels (excluding alpha) for this format
    pub fn getColorChannels(self: PixelFormat) u8 {
        return switch (self) {
            .Gray, .GrayAlpha => 1,
            .RGB, .RGBA, .BGR, .BGRA, .ARGB, .ABGR => 3,
        };
    }

    /// Check if this format has an alpha channel
    pub fn hasAlpha(self: PixelFormat) bool {
        return switch (self) {
            .Gray, .RGB, .BGR => false,
            .GrayAlpha, .RGBA, .BGRA, .ARGB, .ABGR => true,
        };
    }
};

/// Represents a single pixel with separate color channels
pub const Pixel = struct {
    r: u8 = 0,
    g: u8 = 0,
    b: u8 = 0,
    a: u8 = 255,

    /// Create a gray pixel
    pub fn gray(value: u8) Pixel {
        return .{
            .r = value,
            .g = value,
            .b = value,
        };
    }

    /// Create a gray pixel with alpha
    pub fn grayAlpha(value: u8, alpha: u8) Pixel {
        return .{
            .r = value,
            .g = value,
            .b = value,
            .a = alpha,
        };
    }

    /// Create an RGB pixel
    pub fn rgb(r: u8, g: u8, b: u8) Pixel {
        return .{
            .r = r,
            .g = g,
            .b = b,
        };
    }

    /// Create an RGBA pixel
    pub fn rgba(r: u8, g: u8, b: u8, a: u8) Pixel {
        return .{
            .r = r,
            .g = g,
            .b = b,
            .a = a,
        };
    }

    /// Convert to grayscale using luminance formula
    pub fn toGray(self: Pixel) u8 {
        // Use standard luminance conversion: Y = 0.2126*R + 0.7152*G + 0.0722*B
        return @intFromFloat(0.2126 * @as(f32, @floatFromInt(self.r)) +
            0.7152 * @as(f32, @floatFromInt(self.g)) +
            0.0722 * @as(f32, @floatFromInt(self.b)));
    }

    /// Read a pixel from a byte array based on the pixel format
    pub fn fromBytes(bytes: []const u8, format: PixelFormat) Pixel {
        return switch (format) {
            .Gray => Pixel.gray(bytes[0]),
            .GrayAlpha => Pixel.grayAlpha(bytes[0], bytes[1]),
            .RGB => Pixel.rgb(bytes[0], bytes[1], bytes[2]),
            .BGR => Pixel.rgb(bytes[2], bytes[1], bytes[0]),
            .RGBA => Pixel.rgba(bytes[0], bytes[1], bytes[2], bytes[3]),
            .BGRA => Pixel.rgba(bytes[2], bytes[1], bytes[0], bytes[3]),
            .ARGB => Pixel.rgba(bytes[1], bytes[2], bytes[3], bytes[0]),
            .ABGR => Pixel.rgba(bytes[3], bytes[2], bytes[1], bytes[0]),
        };
    }

    /// Write this pixel to a byte array based on the pixel format
    pub fn toBytes(self: Pixel, bytes: []u8, format: PixelFormat) void {
        switch (format) {
            .Gray => {
                bytes[0] = self.toGray();
            },
            .GrayAlpha => {
                bytes[0] = self.toGray();
                bytes[1] = self.a;
            },
            .RGB => {
                bytes[0] = self.r;
                bytes[1] = self.g;
                bytes[2] = self.b;
            },
            .BGR => {
                bytes[0] = self.b;
                bytes[1] = self.g;
                bytes[2] = self.r;
            },
            .RGBA => {
                bytes[0] = self.r;
                bytes[1] = self.g;
                bytes[2] = self.b;
                bytes[3] = self.a;
            },
            .BGRA => {
                bytes[0] = self.b;
                bytes[1] = self.g;
                bytes[2] = self.r;
                bytes[3] = self.a;
            },
            .ARGB => {
                bytes[0] = self.a;
                bytes[1] = self.r;
                bytes[2] = self.g;
                bytes[3] = self.b;
            },
            .ABGR => {
                bytes[0] = self.a;
                bytes[1] = self.b;
                bytes[2] = self.g;
                bytes[3] = self.r;
            },
        }
    }
};

/// Convert an image buffer from one pixel format to another
pub fn convert(
    allocator: std.mem.Allocator,
    src: []const u8,
    src_format: PixelFormat,
    dest_format: PixelFormat,
    width: usize,
    height: usize,
) ![]u8 {
    // If formats are the same, just copy the data
    if (src_format == dest_format) {
        return allocator.dupe(u8, src);
    }

    const src_bpp = src_format.getBytesPerPixel();
    const dest_bpp = dest_format.getBytesPerPixel();

    // Calculate buffer sizes
    const src_size = width * height * src_bpp;
    const dest_size = width * height * dest_bpp;

    // Sanity check for input buffer size
    if (src.len < src_size) {
        return error.SourceBufferTooSmall;
    }

    // Allocate destination buffer
    const dest = try allocator.alloc(u8, dest_size);
    errdefer allocator.free(dest);

    // Prepare intermediate pixel for conversion
    var pixel: Pixel = undefined;

    // Convert each pixel
    var i: usize = 0;
    while (i < width * height) : (i += 1) {
        const src_offset = i * src_bpp;
        const dest_offset = i * dest_bpp;

        // Read pixel from source format
        pixel = Pixel.fromBytes(src[src_offset .. src_offset + src_bpp], src_format);

        // Write pixel to destination format
        pixel.toBytes(dest[dest_offset .. dest_offset + dest_bpp], dest_format);
    }

    return dest;
}

/// Convert an image buffer from one pixel format to another, with pre-allocated destination buffer
pub fn convertInto(
    src: []const u8,
    src_format: PixelFormat,
    dest: []u8,
    dest_format: PixelFormat,
    width: usize,
    height: usize,
) !void {
    // If formats are the same, just copy the data
    if (src_format == dest_format) {
        @memcpy(dest[0..@min(dest.len, src.len)], src[0..@min(dest.len, src.len)]);
        return;
    }

    const src_bpp = src_format.getBytesPerPixel();
    const dest_bpp = dest_format.getBytesPerPixel();

    // Calculate buffer sizes
    const src_size = width * height * src_bpp;
    const dest_size = width * height * dest_bpp;

    // Sanity check for buffer sizes
    if (src.len < src_size) {
        return error.SourceBufferTooSmall;
    }
    if (dest.len < dest_size) {
        return error.DestinationBufferTooSmall;
    }

    // Try to use SIMD acceleration if possible
    if (try convertSIMD(src, src_format, dest, dest_format, width, height)) {
        return; // Successfully used SIMD acceleration
    }

    // Prepare intermediate pixel for conversion
    var pixel: Pixel = undefined;

    // Convert each pixel
    var i: usize = 0;
    while (i < width * height) : (i += 1) {
        const src_offset = i * src_bpp;
        const dest_offset = i * dest_bpp;

        // Read pixel from source format
        pixel = Pixel.fromBytes(src[src_offset .. src_offset + src_bpp], src_format);

        // Write pixel to destination format
        pixel.toBytes(dest[dest_offset .. dest_offset + dest_bpp], dest_format);
    }
}

/// Convert a row of pixels from one format to another
pub fn convertRow(
    src: []const u8,
    src_format: PixelFormat,
    dest: []u8,
    dest_format: PixelFormat,
    width: usize,
) !void {
    const src_bpp = src_format.getBytesPerPixel();
    const dest_bpp = dest_format.getBytesPerPixel();

    // Calculate buffer sizes for this row
    const src_size = width * src_bpp;
    const dest_size = width * dest_bpp;

    // Sanity check for buffer sizes
    if (src.len < src_size) {
        return error.SourceBufferTooSmall;
    }
    if (dest.len < dest_size) {
        return error.DestinationBufferTooSmall;
    }

    // If formats are the same, just copy the data
    if (src_format == dest_format) {
        @memcpy(dest[0..src_size], src[0..src_size]);
        return;
    }

    // Prepare intermediate pixel for conversion
    var pixel: Pixel = undefined;

    // Convert each pixel in the row
    var i: usize = 0;
    while (i < width) : (i += 1) {
        const src_offset = i * src_bpp;
        const dest_offset = i * dest_bpp;

        // Read pixel from source format
        pixel = Pixel.fromBytes(src[src_offset .. src_offset + src_bpp], src_format);

        // Write pixel to destination format
        pixel.toBytes(dest[dest_offset .. dest_offset + dest_bpp], dest_format);
    }
}

/// Calculate required destination buffer size for format conversion
pub fn calculateDestSize(
    _: PixelFormat, // src_format (unused)
    dest_format: PixelFormat,
    width: usize,
    height: usize,
) usize {
    const dest_bpp = dest_format.getBytesPerPixel();
    return width * height * dest_bpp;
}

/// Convert a portion of an image buffer from one pixel format to another (streaming operation)
pub fn convertPortion(
    src: []const u8,
    src_format: PixelFormat,
    dest: []u8,
    dest_format: PixelFormat,
    width: usize,
    start_row: usize,
    end_row: usize,
) !void {
    const src_bpp = src_format.getBytesPerPixel();
    const dest_bpp = dest_format.getBytesPerPixel();

    // Calculate row sizes
    const src_row_size = width * src_bpp;
    const dest_row_size = width * dest_bpp;

    // Convert row by row
    var row: usize = start_row;
    while (row < end_row) : (row += 1) {
        const src_offset = row * src_row_size;
        const dest_offset = row * dest_row_size;

        try convertRow(src[src_offset .. src_offset + src_row_size], src_format, dest[dest_offset .. dest_offset + dest_row_size], dest_format, width);
    }
}

/// SIMD acceleration for common conversion patterns
/// Only available for certain format pairs and platforms
pub fn convertSIMD(
    src: []const u8,
    src_format: PixelFormat,
    dest: []u8,
    dest_format: PixelFormat,
    width: usize,
    height: usize,
) !bool {
    // Define supported SIMD conversions
    const can_use_simd = switch (src_format) {
        .RGBA => dest_format == .BGRA or dest_format == .RGB,
        .BGRA => dest_format == .RGBA or dest_format == .BGR,
        .RGB => dest_format == .RGBA or dest_format == .Gray,
        .BGR => dest_format == .BGRA or dest_format == .Gray,
        else => false,
    };

    if (!can_use_simd) {
        return false; // SIMD not supported for this conversion
    }

    // SIMD implementation varies based on the format pair
    // Here we'll only handle some common cases

    // Handle RGBA <-> BGRA conversion (simplest, just swap R and B)
    if ((src_format == .RGBA and dest_format == .BGRA) or
        (src_format == .BGRA and dest_format == .RGBA))
    {
        const pixels = width * height;
        var i: usize = 0;

        // Process pixels individually for simplicity
        while (i < pixels) : (i += 1) {
            const src_offset = i * 4;
            const dest_offset = i * 4;

            if (src_offset + 3 < src.len and dest_offset + 3 < dest.len) {
                // Swap R and B, keep G and A the same
                dest[dest_offset] = src[src_offset + 2]; // R <-> B
                dest[dest_offset + 1] = src[src_offset + 1]; // G stays the same
                dest[dest_offset + 2] = src[src_offset]; // B <-> R
                dest[dest_offset + 3] = src[src_offset + 3]; // A stays the same
            }
        }

        return true;
    }

    // Handle RGB -> Gray conversion
    if ((src_format == .RGB or src_format == .BGR) and dest_format == .Gray) {
        const pixels = width * height;
        var i: usize = 0;
        var dest_idx: usize = 0;

        // For RGB -> Gray, we compute a weighted sum: Y = 0.2126*R + 0.7152*G + 0.0722*B
        // These are scaled to integer weights for SIMD
        const r_weight: i32 = 54; // 0.2126 * 256 = ~54
        const g_weight: i32 = 183; // 0.7152 * 256 = ~183
        const b_weight: i32 = 19; // 0.0722 * 256 = ~19

        while (i < pixels) : (i += 1) {
            const src_offset = i * 3;
            if (src_offset + 2 >= src.len) break;

            const r = src[src_offset + (if (src_format == .RGB) @as(usize, 0) else @as(usize, 2))];
            const g = src[src_offset + 1];
            const b = src[src_offset + (if (src_format == .RGB) @as(usize, 2) else @as(usize, 0))];

            // Apply weighted sum and divide by 256
            const gray_value = @as(u8, @intCast((r_weight * @as(i32, @intCast(r)) +
                g_weight * @as(i32, @intCast(g)) +
                b_weight * @as(i32, @intCast(b))) >> 8));

            if (dest_idx < dest.len) {
                dest[dest_idx] = gray_value;
                dest_idx += 1;
            }
        }

        return true;
    }

    // Handle RGB -> RGBA conversion (adding alpha = 255)
    if (src_format == .RGB and dest_format == .RGBA) {
        const pixels = width * height;
        var i: usize = 0;

        while (i < pixels) : (i += 1) {
            const src_offset = i * 3;
            const dest_offset = i * 4;

            if (src_offset + 2 >= src.len or dest_offset + 3 >= dest.len) break;

            dest[dest_offset] = src[src_offset]; // R
            dest[dest_offset + 1] = src[src_offset + 1]; // G
            dest[dest_offset + 2] = src[src_offset + 2]; // B
            dest[dest_offset + 3] = 255; // A (opaque)
        }

        return true;
    }

    // Handle BGR -> BGRA conversion (adding alpha = 255)
    if (src_format == .BGR and dest_format == .BGRA) {
        const pixels = width * height;
        var i: usize = 0;

        while (i < pixels) : (i += 1) {
            const src_offset = i * 3;
            const dest_offset = i * 4;

            if (src_offset + 2 >= src.len or dest_offset + 3 >= dest.len) break;

            dest[dest_offset] = src[src_offset]; // B
            dest[dest_offset + 1] = src[src_offset + 1]; // G
            dest[dest_offset + 2] = src[src_offset + 2]; // R
            dest[dest_offset + 3] = 255; // A (opaque)
        }

        return true;
    }

    return false; // SIMD not implemented for this conversion
}

/// Premultiply alpha for RGBA/BGRA/ARGB/ABGR formats
pub fn premultiplyAlpha(
    allocator: std.mem.Allocator,
    src: []const u8,
    format: PixelFormat,
    width: usize,
    height: usize,
) ![]u8 {
    // Only formats with alpha channel can be premultiplied
    if (!format.hasAlpha()) {
        return allocator.dupe(u8, src);
    }

    const bpp = format.getBytesPerPixel();
    const size = width * height * bpp;

    // Sanity check for input buffer size
    if (src.len < size) {
        return error.SourceBufferTooSmall;
    }

    // Allocate destination buffer
    const dest = try allocator.alloc(u8, size);
    errdefer allocator.free(dest);

    // Define a struct to hold channel positions
    const ChannelPositions = struct {
        r: usize,
        g: usize,
        b: usize,
        a: usize,
    };

    // Index positions for color and alpha channels
    const positions: ChannelPositions = switch (format) {
        .GrayAlpha => .{ .r = 0, .g = 0, .b = 0, .a = 1 },
        .RGBA => .{ .r = 0, .g = 1, .b = 2, .a = 3 },
        .BGRA => .{ .r = 2, .g = 1, .b = 0, .a = 3 },
        .ARGB => .{ .r = 1, .g = 2, .b = 3, .a = 0 },
        .ABGR => .{ .r = 3, .g = 2, .b = 1, .a = 0 },
        else => unreachable, // Should never happen due to hasAlpha() check
    };

    // Process each pixel
    var i: usize = 0;
    while (i < width * height) : (i += 1) {
        const offset = i * bpp;

        // Copy all bytes first
        @memcpy(dest[offset .. offset + bpp], src[offset .. offset + bpp]);

        // Then premultiply RGB values with alpha
        const alpha: f32 = @as(f32, @floatFromInt(src[offset + positions.a])) / 255.0;

        if (format == .GrayAlpha) {
            // Special case for grayscale+alpha
            dest[offset + positions.r] = @as(u8, @intFromFloat(@round(@as(f32, @floatFromInt(src[offset + positions.r])) * alpha)));
        } else {
            // Regular case for color with alpha
            dest[offset + positions.r] = @as(u8, @intFromFloat(@round(@as(f32, @floatFromInt(src[offset + positions.r])) * alpha)));
            dest[offset + positions.g] = @as(u8, @intFromFloat(@round(@as(f32, @floatFromInt(src[offset + positions.g])) * alpha)));
            dest[offset + positions.b] = @as(u8, @intFromFloat(@round(@as(f32, @floatFromInt(src[offset + positions.b])) * alpha)));
        }
    }

    return dest;
}

/// Unpremultiply alpha for RGBA/BGRA/ARGB/ABGR formats
pub fn unpremultiplyAlpha(
    allocator: std.mem.Allocator,
    src: []const u8,
    format: PixelFormat,
    width: usize,
    height: usize,
) ![]u8 {
    // Only formats with alpha channel can be unpremultiplied
    if (!format.hasAlpha()) {
        return allocator.dupe(u8, src);
    }

    const bpp = format.getBytesPerPixel();
    const size = width * height * bpp;

    // Sanity check for input buffer size
    if (src.len < size) {
        return error.SourceBufferTooSmall;
    }

    // Allocate destination buffer
    const dest = try allocator.alloc(u8, size);
    errdefer allocator.free(dest);

    // Define a struct to hold channel positions
    const ChannelPositions = struct {
        r: usize,
        g: usize,
        b: usize,
        a: usize,
    };

    // Index positions for color and alpha channels
    const positions: ChannelPositions = switch (format) {
        .GrayAlpha => .{ .r = 0, .g = 0, .b = 0, .a = 1 },
        .RGBA => .{ .r = 0, .g = 1, .b = 2, .a = 3 },
        .BGRA => .{ .r = 2, .g = 1, .b = 0, .a = 3 },
        .ARGB => .{ .r = 1, .g = 2, .b = 3, .a = 0 },
        .ABGR => .{ .r = 3, .g = 2, .b = 1, .a = 0 },
        else => unreachable, // Should never happen due to hasAlpha() check
    };

    // Process each pixel
    var i: usize = 0;
    while (i < width * height) : (i += 1) {
        const offset = i * bpp;

        // Copy all bytes first
        @memcpy(dest[offset .. offset + bpp], src[offset .. offset + bpp]);

        // Then unpremultiply RGB values using alpha
        const alpha = src[offset + positions.a];

        // Skip division by zero, leave at 0
        if (alpha > 0) {
            const alpha_f: f32 = 255.0 / @as(f32, @floatFromInt(alpha));

            if (format == .GrayAlpha) {
                // Special case for grayscale+alpha
                const value = @as(u8, @intFromFloat(@min(@as(f32, @floatFromInt(src[offset + positions.r])) * alpha_f, 255.0)));
                dest[offset + positions.r] = value;
            } else {
                // Regular case for color with alpha
                dest[offset + positions.r] = @as(u8, @intFromFloat(@min(@as(f32, @floatFromInt(src[offset + positions.r])) * alpha_f, 255.0)));
                dest[offset + positions.g] = @as(u8, @intFromFloat(@min(@as(f32, @floatFromInt(src[offset + positions.g])) * alpha_f, 255.0)));
                dest[offset + positions.b] = @as(u8, @intFromFloat(@min(@as(f32, @floatFromInt(src[offset + positions.b])) * alpha_f, 255.0)));
            }
        }
    }

    return dest;
}

// Unit Tests
test "PixelFormat bytes per pixel" {
    try std.testing.expectEqual(PixelFormat.Gray.getBytesPerPixel(), 1);
    try std.testing.expectEqual(PixelFormat.GrayAlpha.getBytesPerPixel(), 2);
    try std.testing.expectEqual(PixelFormat.RGB.getBytesPerPixel(), 3);
    try std.testing.expectEqual(PixelFormat.RGBA.getBytesPerPixel(), 4);
    try std.testing.expectEqual(PixelFormat.BGR.getBytesPerPixel(), 3);
    try std.testing.expectEqual(PixelFormat.BGRA.getBytesPerPixel(), 4);
    try std.testing.expectEqual(PixelFormat.ARGB.getBytesPerPixel(), 4);
    try std.testing.expectEqual(PixelFormat.ABGR.getBytesPerPixel(), 4);
}

test "Pixel fromBytes and toBytes" {
    const src_rgba = [_]u8{ 10, 20, 30, 255 };
    var pixel = Pixel.fromBytes(&src_rgba, .RGBA);

    try std.testing.expectEqual(pixel.r, 10);
    try std.testing.expectEqual(pixel.g, 20);
    try std.testing.expectEqual(pixel.b, 30);
    try std.testing.expectEqual(pixel.a, 255);

    var dest_bgra = [_]u8{ 0, 0, 0, 0 };
    pixel.toBytes(&dest_bgra, .BGRA);

    try std.testing.expectEqual(dest_bgra[0], 30); // B comes first in BGRA
    try std.testing.expectEqual(dest_bgra[1], 20); // G
    try std.testing.expectEqual(dest_bgra[2], 10); // R
    try std.testing.expectEqual(dest_bgra[3], 255); // A
}

test "Grayscale conversion" {
    const pixel = Pixel.rgb(82, 127, 42);
    const gray = pixel.toGray();

    // Expected: 0.2126*82 + 0.7152*127 + 0.0722*42 = 110.9
    try std.testing.expectEqual(gray, 111);
}

test "Convert RGB to RGBA" {
    // Create test RGB image
    const width = 2;
    const height = 2;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.RGBA;

    const src = [_]u8{
        255, 0, 0, // Red
        0, 255, 0, // Green
        0,   0,   255, // Blue
        255, 255, 0, // Yellow
    };

    // Allocate and perform conversion
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const dest = try convert(allocator, &src, src_format, dest_format, width, height);

    // Verify the conversion
    try std.testing.expectEqual(dest.len, width * height * dest_format.getBytesPerPixel());

    // Check first pixel (Red)
    try std.testing.expectEqual(dest[0], 255);
    try std.testing.expectEqual(dest[1], 0);
    try std.testing.expectEqual(dest[2], 0);
    try std.testing.expectEqual(dest[3], 255); // Alpha added

    // Check last pixel (Yellow)
    const last_pixel_offset = 3 * 4; // 3rd pixel (0-indexed) * 4 bytes per pixel
    try std.testing.expectEqual(dest[last_pixel_offset], 255);
    try std.testing.expectEqual(dest[last_pixel_offset + 1], 255);
    try std.testing.expectEqual(dest[last_pixel_offset + 2], 0);
    try std.testing.expectEqual(dest[last_pixel_offset + 3], 255); // Alpha added
}

test "Convert RGBA to Gray" {
    // Create test RGBA image
    const width = 2;
    const height = 2;
    const src_format = PixelFormat.RGBA;
    const dest_format = PixelFormat.Gray;

    const src = [_]u8{
        255, 0, 0, 255, // Red
        0, 255, 0, 255, // Green
        0,   0,   255, 255, // Blue
        255, 255, 0,   128, // Yellow with 50% alpha
    };

    // Allocate and perform conversion
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const dest = try convert(allocator, &src, src_format, dest_format, width, height);

    // Verify the conversion
    try std.testing.expectEqual(dest.len, width * height * dest_format.getBytesPerPixel());

    // Check grayscale values (expected values based on luminance formula)
    try std.testing.expectEqual(dest[0], 54); // Red: 0.2126*255 = ~54
    try std.testing.expectEqual(dest[1], 182); // Green: 0.7152*255 = ~182
    try std.testing.expectEqual(dest[2], 18); // Blue: 0.0722*255 = ~18

    // Yellow has both R and G, so should be brighter
    try std.testing.expectEqual(dest[3], 236); // Yellow: 0.2126*255 + 0.7152*255 = ~236
}

test "Convert RGB to BGR" {
    // Create test RGB image
    const width = 2;
    const height = 1;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.BGR;

    const src = [_]u8{
        255, 0, 0, // Red
        0, 255, 0, // Green
    };

    // Allocate and perform conversion
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const dest = try convert(allocator, &src, src_format, dest_format, width, height);

    // Verify the conversion
    try std.testing.expectEqual(dest.len, width * height * dest_format.getBytesPerPixel());

    // Check first pixel (Red becomes B=0, G=0, R=255)
    try std.testing.expectEqual(dest[0], 0);
    try std.testing.expectEqual(dest[1], 0);
    try std.testing.expectEqual(dest[2], 255);

    // Check second pixel (Green becomes B=0, G=255, R=0)
    try std.testing.expectEqual(dest[3], 0);
    try std.testing.expectEqual(dest[4], 255);
    try std.testing.expectEqual(dest[5], 0);
}

test "Convert with pre-allocated buffer" {
    // Create test RGB image
    const width = 2;
    const height = 1;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.RGBA;

    const src = [_]u8{
        255, 0, 0, // Red
        0, 255, 0, // Green
    };

    // Pre-allocate destination buffer
    var dest: [width * height * dest_format.getBytesPerPixel()]u8 = undefined;

    // Perform conversion
    try convertInto(&src, src_format, &dest, dest_format, width, height);

    // Verify the conversion
    try std.testing.expectEqual(dest[0], 255); // R
    try std.testing.expectEqual(dest[1], 0); // G
    try std.testing.expectEqual(dest[2], 0); // B
    try std.testing.expectEqual(dest[3], 255); // A

    try std.testing.expectEqual(dest[4], 0); // R
    try std.testing.expectEqual(dest[5], 255); // G
    try std.testing.expectEqual(dest[6], 0); // B
    try std.testing.expectEqual(dest[7], 255); // A
}

test "Convert row" {
    // Create test RGB row
    const width = 3;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.Gray;

    const src = [_]u8{
        255, 0, 0, // Red
        0, 255, 0, // Green
        0, 0, 255, // Blue
    };

    // Pre-allocate destination buffer
    var dest: [width * dest_format.getBytesPerPixel()]u8 = undefined;

    // Perform row conversion
    try convertRow(&src, src_format, &dest, dest_format, width);

    // Verify the conversion - check grayscale values
    try std.testing.expectEqual(dest[0], 54); // Red: 0.2126*255 = ~54
    try std.testing.expectEqual(dest[1], 182); // Green: 0.7152*255 = ~182
    try std.testing.expectEqual(dest[2], 18); // Blue: 0.0722*255 = ~18
}

test "Premultiply alpha" {
    // Create test RGBA image with varying alpha
    const width = 2;
    const height = 1;
    const format = PixelFormat.RGBA;

    const src = [_]u8{
        255, 128, 64, 128, // 50% alpha
        255, 255, 255, 0, // 0% alpha (transparent)
    };

    // Allocate and perform premultiplication
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const dest = try premultiplyAlpha(allocator, &src, format, width, height);

    // Verify the premultiplication
    try std.testing.expectEqual(dest.len, width * height * format.getBytesPerPixel());

    // First pixel (50% alpha)
    try std.testing.expectEqual(dest[0], 128); // R: 255 * 0.5 = 127.5 → 128 (round up)
    try std.testing.expectEqual(dest[1], 64); // G: 128 * 0.5 = 64
    try std.testing.expectEqual(dest[2], 32); // B: 64 * 0.5 = 32
    try std.testing.expectEqual(dest[3], 128); // Alpha unchanged

    // Second pixel (transparent)
    try std.testing.expectEqual(dest[4], 0); // R: 255 * 0 = 0
    try std.testing.expectEqual(dest[5], 0); // G: 255 * 0 = 0
    try std.testing.expectEqual(dest[6], 0); // B: 255 * 0 = 0
    try std.testing.expectEqual(dest[7], 0); // Alpha unchanged
}

test "Unpremultiply alpha" {
    // Create test premultiplied RGBA image with varying alpha
    const width = 2;
    const height = 1;
    const format = PixelFormat.RGBA;

    const src = [_]u8{
        127, 64, 32, 128, // 50% alpha, premultiplied
        0, 0, 0, 0, // 0% alpha (transparent)
    };

    // Allocate and perform unpremultiplication
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    const dest = try unpremultiplyAlpha(allocator, &src, format, width, height);

    // Verify the unpremultiplication
    try std.testing.expectEqual(dest.len, width * height * format.getBytesPerPixel());

    // First pixel (50% alpha)
    try std.testing.expectEqual(dest[0], 253); // R: 127 / 0.5 = 254 with truncation
    try std.testing.expectEqual(dest[1], 127); // G: 64 / 0.5 = 128 with truncation
    try std.testing.expectEqual(dest[2], 63); // B: 32 / 0.5 = 64 with truncation
    try std.testing.expectEqual(dest[3], 128); // Alpha unchanged

    // Second pixel (transparent) - division by zero, so should remain 0
    try std.testing.expectEqual(dest[4], 0); // R
    try std.testing.expectEqual(dest[5], 0); // G
    try std.testing.expectEqual(dest[6], 0); // B
    try std.testing.expectEqual(dest[7], 0); // Alpha unchanged
}

test "SIMD RGBA to BGRA conversion" {
    // Create a larger test image to trigger SIMD path
    const width = 4;
    const height = 4;
    const src_format = PixelFormat.RGBA;
    const dest_format = PixelFormat.BGRA;

    var src: [width * height * src_format.getBytesPerPixel()]u8 = undefined;
    var dest: [width * height * dest_format.getBytesPerPixel()]u8 = undefined;

    // Fill source with test pattern
    for (0..width * height) |i| {
        const offset = i * 4;
        src[offset] = @as(u8, @intCast(i)); // R
        src[offset + 1] = @as(u8, @intCast(i * 2)); // G
        src[offset + 2] = @as(u8, @intCast(i * 3)); // B
        src[offset + 3] = 255; // A
    }

    // Attempt SIMD conversion
    const used_simd = try convertSIMD(&src, src_format, &dest, dest_format, width, height);

    // Should have used SIMD path
    try std.testing.expect(used_simd);

    // Verify conversions
    for (0..width * height) |i| {
        const offset = i * 4;
        try std.testing.expectEqual(dest[offset], src[offset + 2]); // B = src.B
        try std.testing.expectEqual(dest[offset + 1], src[offset + 1]); // G = src.G
        try std.testing.expectEqual(dest[offset + 2], src[offset]); // R = src.R
        try std.testing.expectEqual(dest[offset + 3], src[offset + 3]); // A = src.A
    }
}
