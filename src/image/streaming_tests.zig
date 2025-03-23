const std = @import("std");
const testing = std.testing;
const streaming = @import("streaming.zig");
const encoder = @import("encoder.zig");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const ImageChunk = streaming.ImageChunk;
const StreamProcessor = streaming.StreamProcessor;
const StreamingEncoder = streaming.StreamingEncoder;
const StreamingResizer = streaming.StreamingResizer;
const ImagePipeline = streaming.ImagePipeline;
const ChunkIterator = streaming.ChunkIterator;
const ResizeAlgorithm = streaming.ResizeAlgorithm;
const ImageFormat = encoder.ImageFormat;
const EncodingOptions = encoder.EncodingOptions;
const EncodingQuality = encoder.EncodingQuality;

// Helper function to create a test image
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
                else => {
                    // Default to grayscale for other formats
                    for (0..bytes_per_pixel) |i| {
                        buffer[pixel_index + i] = @as(u8, @intCast((x + y) % 256));
                    }
                },
            }
        }
    }
    
    return buffer;
}

// Test the ImageChunk structure
test "ImageChunk basic functionality" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    const width: usize = 100;
    const rows: usize = 10;
    const start_row = 0;
    const format = PixelFormat.RGB;
    const is_last = false;
    
    var chunk = try ImageChunk.init(allocator, width, rows, start_row, format, is_last);
    defer chunk.deinit();
    
    // Check basic properties
    try testing.expectEqual(width, chunk.width);
    try testing.expectEqual(rows, chunk.rows);
    try testing.expectEqual(start_row, chunk.start_row);
    try testing.expectEqual(format, chunk.format);
    try testing.expectEqual(is_last, chunk.is_last);
    
    // Check data size
    const expected_size: usize = width * rows * format.getBytesPerPixel();
    try testing.expectEqual(expected_size, chunk.data.len);
    
    // Test pixelOffset
    const bytes_per_pixel = format.getBytesPerPixel();
    const expected_offset = (5 * width + 10) * bytes_per_pixel;
    try testing.expectEqual(expected_offset, chunk.pixelOffset(10, 5 + start_row));
    
    // Test rowSize
    const expected_row_size = width * bytes_per_pixel;
    try testing.expectEqual(expected_row_size, chunk.rowSize());
}

// Test the ChunkIterator
test "ChunkIterator splits image into chunks" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    const width: usize = 100;
    const height: usize = 32;
    const format = PixelFormat.RGB;
    const bytes_per_pixel = format.getBytesPerPixel();
    
    // Create a test image
    const image_data = try createTestImage(allocator, width, height, format);
    defer allocator.free(image_data);
    
    // Create iterator with 8 rows per chunk (should produce 4 chunks)
    const rows_per_chunk: usize = 8;
    var iterator = ChunkIterator.init(allocator, image_data, width, height, format, rows_per_chunk);
    
    // Collect chunks and verify
    var chunks = std.ArrayList(ImageChunk).init(allocator);
    defer {
        for (chunks.items) |*chunk| {
            chunk.deinit();
        }
        chunks.deinit();
    }
    
    while (try iterator.next()) |chunk| {
        try chunks.append(chunk);
    }
    
    // Should have produced 4 chunks
    try testing.expectEqual(@as(usize, 4), chunks.items.len);
    
    // Check chunk properties
    for (chunks.items, 0..) |chunk, i| {
        const expected_start_row = i * rows_per_chunk;
        const expected_is_last = i == chunks.items.len - 1;
        
        try testing.expectEqual(width, chunk.width);
        try testing.expectEqual(rows_per_chunk, chunk.rows);
        try testing.expectEqual(expected_start_row, chunk.start_row);
        try testing.expectEqual(format, chunk.format);
        try testing.expectEqual(expected_is_last, chunk.is_last);
        
        // Check that the chunk data matches the original image
        const start_offset = expected_start_row * width * bytes_per_pixel;
        const chunk_size: usize = width * rows_per_chunk * bytes_per_pixel;
        try testing.expectEqualSlices(u8, image_data[start_offset..start_offset + chunk_size], chunk.data);
    }
}

// Test the StreamingEncoder
test "StreamingEncoder basic functionality" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    const width: usize = 100;
    const height: usize = 32;
    const format = PixelFormat.RGB;
    
    // Create a test image
    const image_data = try createTestImage(allocator, width, height, format);
    defer allocator.free(image_data);
    
    // Create encoding options for a JPEG
    const options = EncodingOptions{
        .format = .JPEG,
        .quality = EncodingQuality.high(),
    };
    
    // Create the encoder
    var encoder_instance = try StreamingEncoder.init(
        allocator,
        width,
        height,
        format,
        options,
    );
    defer encoder_instance.deinit();
    
    // Split the image into chunks and process
    const rows_per_chunk: usize = 8;
    var iterator = ChunkIterator.init(allocator, image_data, width, height, format, rows_per_chunk);
    
    while (try iterator.next()) |chunk_orig| {
        var chunk = chunk_orig;
        try encoder_instance.processor.processChunk(&chunk);
        chunk.deinit();
    }
    
    // Finalize and get the encoded image
    const encoded_data = encoder_instance.processor.finalize() catch |err| {
        // If encoding fails, it may be due to platform-specific implementation not available
        // This makes the test more flexible across platforms
        if (err == error.NotImplemented) {
            std.debug.print("Encoder not implemented on this platform, skipping validation\n", .{});
            return;
        }
        return err;
    };
    defer allocator.free(encoded_data);
    
    // Basic validation of encoded image
    // JPEG header starts with FF D8 FF
    try testing.expect(encoded_data.len > 0);
    try testing.expect(encoded_data[0] == 0xFF);
    try testing.expect(encoded_data[1] == 0xD8);
    try testing.expect(encoded_data[2] == 0xFF);
}

// Test a simpler pipeline: just the encoder
test "Image streaming encode" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Image dimensions
    const width: usize = 100;
    const height: usize = 64;
    const format = PixelFormat.RGB;
    
    // Create a test image
    const image_data = try createTestImage(allocator, width, height, format);
    defer allocator.free(image_data);
    
    // Create encoding options
    const options = EncodingOptions{
        .format = .JPEG,
        .quality = EncodingQuality.medium(),
    };
    
    // Create an encoder processor
    var encoder_instance = try StreamingEncoder.init(
        allocator, 
        width, 
        height, 
        format, 
        options
    );
    defer encoder_instance.deinit();
    
    // Split the image into chunks and process sequentially
    const rows_per_chunk: usize = 16; // Process in 4 chunks
    var iterator = ChunkIterator.init(allocator, image_data, width, height, format, rows_per_chunk);
    
    while (try iterator.next()) |chunk_orig| {
        var chunk = chunk_orig;
        try encoder_instance.processor.processChunk(&chunk);
        chunk.deinit();
    }
    
    // Finalize and get the result
    const result = encoder_instance.processor.finalize() catch |err| {
        // If encoding fails, it may be due to platform-specific implementation not available
        if (err == error.NotImplemented) {
            std.debug.print("Encoder not implemented on this platform, skipping validation\n", .{});
            return;
        }
        return err;
    };
    defer allocator.free(result);
    
    // Basic validation of encoded image
    // JPEG header starts with FF D8 FF
    try testing.expect(result.len > 0);
    try testing.expect(result[0] == 0xFF);
    try testing.expect(result[1] == 0xD8);
    try testing.expect(result[2] == 0xFF);
}

// Test direct encoding with different formats
test "Encoder with different formats" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    const width: usize = 100;
    const height: usize = 100;
    const format = PixelFormat.RGBA;
    
    // Create a test image
    const image_data = try createTestImage(allocator, width, height, format);
    defer allocator.free(image_data);
    
    // Test JPEG encoding
    {
        const jpeg_options = EncodingOptions{
            .format = .JPEG,
            .quality = EncodingQuality.high(),
        };
        
        const jpeg_data_opt = encoder.encode(
            allocator,
            image_data,
            width,
            height,
            format,
            jpeg_options,
        ) catch |err| {
            if (err == error.NotImplemented) {
                std.debug.print("JPEG encoder not implemented on this platform, skipping\n", .{});
                return;
            }
            return err;
        };
        
        defer allocator.free(jpeg_data_opt);
        
        // Verify JPEG signature (FF D8 FF)
        try testing.expect(jpeg_data_opt.len > 0);
        try testing.expect(jpeg_data_opt[0] == 0xFF);
        try testing.expect(jpeg_data_opt[1] == 0xD8);
        try testing.expect(jpeg_data_opt[2] == 0xFF);
    }
    
    // Test PNG encoding
    {
        const png_options = EncodingOptions{
            .format = .PNG,
        };
        
        const png_data_opt = encoder.encode(
            allocator,
            image_data,
            width,
            height,
            format,
            png_options,
        ) catch |err| {
            if (err == error.NotImplemented) {
                std.debug.print("PNG encoder not implemented on this platform, skipping\n", .{});
                return;
            }
            return err;
        };
        
        defer allocator.free(png_data_opt);
        
        // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
        try testing.expect(png_data_opt.len > 0);
        try testing.expectEqual(@as(u8, 0x89), png_data_opt[0]);
        try testing.expectEqual(@as(u8, 0x50), png_data_opt[1]); // P
        try testing.expectEqual(@as(u8, 0x4E), png_data_opt[2]); // N
        try testing.expectEqual(@as(u8, 0x47), png_data_opt[3]); // G
    }
    
    // Test shorthand API for JPEG
    {
        const jpeg_data_opt = encoder.encodeJPEG(
            allocator,
            image_data,
            width,
            height,
            format,
            90, // Quality
        ) catch |err| {
            if (err == error.NotImplemented) {
                std.debug.print("JPEG shorthand encoder not implemented on this platform, skipping\n", .{});
                return;
            }
            return err;
        };
        
        defer allocator.free(jpeg_data_opt);
        
        // Verify JPEG signature
        try testing.expect(jpeg_data_opt.len > 0);
        try testing.expect(jpeg_data_opt[0] == 0xFF);
        try testing.expect(jpeg_data_opt[1] == 0xD8);
    }
    
    // Test shorthand API for PNG
    {
        const png_data_opt = encoder.encodePNG(
            allocator,
            image_data,
            width,
            height,
            format,
        ) catch |err| {
            if (err == error.NotImplemented) {
                std.debug.print("PNG shorthand encoder not implemented on this platform, skipping\n", .{});
                return;
            }
            return err;
        };
        
        defer allocator.free(png_data_opt);
        
        // Verify PNG signature
        try testing.expect(png_data_opt.len > 0);
        try testing.expectEqual(@as(u8, 0x89), png_data_opt[0]);
        try testing.expectEqual(@as(u8, 0x50), png_data_opt[1]); // P
        try testing.expectEqual(@as(u8, 0x4E), png_data_opt[2]); // N
        try testing.expectEqual(@as(u8, 0x47), png_data_opt[3]); // G
    }
}