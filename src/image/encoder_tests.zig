const std = @import("std");
const testing = std.testing;
const encoder = @import("encoder.zig");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;

// Mock testing data creation
fn createTestImage(allocator: std.mem.Allocator, width: usize, height: usize, format: PixelFormat) ![]u8 {
    const bytes_per_pixel = format.getBytesPerPixel();
    const buffer_size = width * height * bytes_per_pixel;

    var buffer = try allocator.alloc(u8, buffer_size);
    errdefer allocator.free(buffer);

    // Fill with a simple gradient pattern
    for (0..height) |y| {
        for (0..width) |x| {
            const pixel_index = (y * width + x) * bytes_per_pixel;

            switch (format) {
                .Gray => {
                    // Simple diagonal gradient
                    buffer[pixel_index] = @as(u8, @intCast((x + y) % 256));
                },
                .GrayAlpha => {
                    // Gray gradient with full alpha
                    buffer[pixel_index] = @as(u8, @intCast((x + y) % 256));
                    buffer[pixel_index + 1] = 255; // Full alpha
                },
                .RGB => {
                    // Red gradient in x, green gradient in y, blue constant
                    buffer[pixel_index] = @as(u8, @intCast(x % 256)); // R
                    buffer[pixel_index + 1] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 2] = 128; // B constant
                },
                .RGBA => {
                    // RGB gradient with full alpha
                    buffer[pixel_index] = @as(u8, @intCast(x % 256)); // R
                    buffer[pixel_index + 1] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 2] = 128; // B constant
                    buffer[pixel_index + 3] = 255; // Full alpha
                },
                .BGR => {
                    // Blue gradient in x, green gradient in y, red constant
                    buffer[pixel_index] = 128; // B constant
                    buffer[pixel_index + 1] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 2] = @as(u8, @intCast(x % 256)); // R
                },
                .BGRA => {
                    // BGR gradient with full alpha
                    buffer[pixel_index] = 128; // B constant
                    buffer[pixel_index + 1] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 2] = @as(u8, @intCast(x % 256)); // R
                    buffer[pixel_index + 3] = 255; // Full alpha
                },
                .ARGB => {
                    // ARGB format
                    buffer[pixel_index] = 255; // A full
                    buffer[pixel_index + 1] = @as(u8, @intCast(x % 256)); // R
                    buffer[pixel_index + 2] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 3] = 128; // B constant
                },
                .ABGR => {
                    // ABGR format
                    buffer[pixel_index] = 255; // A full
                    buffer[pixel_index + 1] = 128; // B constant
                    buffer[pixel_index + 2] = @as(u8, @intCast(y % 256)); // G
                    buffer[pixel_index + 3] = @as(u8, @intCast(x % 256)); // R
                },
            }
        }
    }

    return buffer;
}

// Utility to save an encoded image to a file for visual inspection
fn saveToFile(allocator: std.mem.Allocator, data: []const u8, filename: []const u8) !void {
    const file = try std.fs.cwd().createFile(filename, .{});
    defer file.close();

    try file.writeAll(data);
}

test "Encode JPEG" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create test RGB image
    const width = 256;
    const height = 256;
    const image_format = PixelFormat.RGB;

    const image_data = try createTestImage(allocator, width, height, image_format);

    // Encode to JPEG with quality 80
    const quality = 80;
    const encoded_jpeg = try encoder.encodeJPEG(allocator, image_data, width, height, image_format, quality);

    // Verify we got some data back (simple sanity check)
    try testing.expect(encoded_jpeg.len > 0);

    // Optionally save the file for visual inspection
    // Note: This is normally disabled in automated tests
    if (false) {
        try saveToFile(allocator, encoded_jpeg, "test_output.jpg");
    }
}

test "Encode PNG" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create test RGBA image
    const width = 256;
    const height = 256;
    const image_format = PixelFormat.RGBA;

    const image_data = try createTestImage(allocator, width, height, image_format);

    // Encode to PNG
    const encoded_png = try encoder.encodePNG(allocator, image_data, width, height, image_format);

    // Verify we got some data back
    try testing.expect(encoded_png.len > 0);

    // Optionally save the file for visual inspection
    // Note: This is normally disabled in automated tests
    if (false) {
        try saveToFile(allocator, encoded_png, "test_output.png");
    }
}

// Test various pixel format conversions
test "Encode different pixel formats" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    // Create test images with different pixel formats
    const width = 100;
    const height = 100;
    const formats = [_]PixelFormat{
        .Gray,
        .GrayAlpha,
        .RGB,
        .RGBA,
        .BGR,
        .BGRA,
    };

    for (formats) |format| {
        const image_data = try createTestImage(allocator, width, height, format);

        // Set up encoding options
        const options = encoder.EncodingOptions{
            .format = .JPEG,
            .quality = .{ .quality = 85 },
        };

        // Encode the image
        const encoded_data = try encoder.encode(allocator, image_data, width, height, format, options);

        // Basic validation
        try testing.expect(encoded_data.len > 0);
    }
}
