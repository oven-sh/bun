const std = @import("std");
const math = std.math;

/// Box is a simple and very fast image resampling algorithm that uses area averaging.
/// It's particularly effective for downscaling images, where it provides good
/// anti-aliasing by averaging all pixels in a box region.
/// 
/// References:
/// - https://entropymine.com/imageworsener/bicubic/
pub const Box = struct {
    /// Error set for streaming resizing operations
    pub const Error = error{
        DestBufferTooSmall,
        TempBufferTooSmall,
        ColumnBufferTooSmall,
    };

    /// Calculate required buffer sizes for resize operation
    /// Returns sizes for the destination and temporary buffers
    pub fn calculateBufferSizes(
        _: usize, // src_width, unused
        src_height: usize,
        dest_width: usize,
        dest_height: usize,
        bytes_per_pixel: usize,
    ) struct { dest_size: usize, temp_size: usize, column_buffer_size: usize } {
        const dest_size = dest_width * dest_height * bytes_per_pixel;
        const temp_size = dest_width * src_height * bytes_per_pixel;
        // Need buffers for the temporary columns during vertical resize
        const column_buffer_size = @max(src_height, dest_height) * 2;
        
        return .{
            .dest_size = dest_size,
            .temp_size = temp_size,
            .column_buffer_size = column_buffer_size,
        };
    }

    /// Resample a horizontal line using the Box algorithm
    /// The box algorithm averages all pixels that contribute to each output pixel
    pub fn resampleHorizontalLine(
        dest: []u8, 
        src: []const u8,
        src_width: usize,
        dest_width: usize,
        bytes_per_pixel: usize,
    ) void {
        // Special case: if src_width == dest_width, perform a direct copy
        if (src_width == dest_width) {
            @memcpy(dest, src);
            return;
        }
        
        // Process each destination pixel
        var x_dest: usize = 0;
        while (x_dest < dest_width) : (x_dest += 1) {
            // For each channel
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Calculate the source region that contributes to this output pixel
                const scale = @as(f64, @floatFromInt(src_width)) / @as(f64, @floatFromInt(dest_width));
                const src_left = @as(f64, @floatFromInt(x_dest)) * scale;
                const src_right = @as(f64, @floatFromInt(x_dest + 1)) * scale;
                
                // Convert to integer coordinates, clamping to valid range
                const src_start = @max(0, @as(usize, @intFromFloat(src_left)));
                const src_end = @min(src_width, @as(usize, @intFromFloat(@ceil(src_right))));
                
                // Sum all contributing pixels and calculate average
                var sum: u32 = 0;
                var count: u32 = 0;
                
                var x_src = src_start;
                while (x_src < src_end) : (x_src += 1) {
                    const src_offset = x_src * bytes_per_pixel + channel;
                    sum += src[src_offset];
                    count += 1;
                }
                
                // Calculate average and store result
                const avg = if (count > 0) sum / count else 0;
                const dest_offset = x_dest * bytes_per_pixel + channel;
                dest[dest_offset] = @as(u8, @intCast(avg));
            }
        }
    }
    
    /// Resample a vertical line using the Box algorithm
    pub fn resampleVerticalLine(
        dest: []u8, 
        src: []const u8,
        src_height: usize,
        dest_height: usize,
        bytes_per_pixel: usize,
        x_offset: usize,
    ) void {
        // Special case: if src_height == dest_height, perform a direct copy
        if (src_height == dest_height) {
            for (0..src_height) |y| {
                dest[y * x_offset] = src[y * x_offset];
            }
            return;
        }
        
        // Process each destination pixel
        var y_dest: usize = 0;
        while (y_dest < dest_height) : (y_dest += 1) {
            // For each channel
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Calculate the source region that contributes to this output pixel
                const scale = @as(f64, @floatFromInt(src_height)) / @as(f64, @floatFromInt(dest_height));
                const src_top = @as(f64, @floatFromInt(y_dest)) * scale;
                const src_bottom = @as(f64, @floatFromInt(y_dest + 1)) * scale;
                
                // Convert to integer coordinates, clamping to valid range
                const src_start = @max(0, @as(usize, @intFromFloat(src_top)));
                const src_end = @min(src_height, @as(usize, @intFromFloat(@ceil(src_bottom))));
                
                // Sum all contributing pixels and calculate average
                var sum: u32 = 0;
                var count: u32 = 0;
                
                var y_src = src_start;
                while (y_src < src_end) : (y_src += 1) {
                    const src_offset = y_src * x_offset + channel;
                    sum += src[src_offset];
                    count += 1;
                }
                
                // Calculate average and store result
                const avg = if (count > 0) sum / count else 0;
                const dest_offset = y_dest * x_offset + channel;
                dest[dest_offset] = @as(u8, @intCast(avg));
            }
        }
    }

    /// Resample a single horizontal line with control over which parts of the line to process
    /// This is useful for streaming processing where you only want to process a subset of the line
    pub fn resampleHorizontalLineStreaming(
        dest: []u8,
        dest_start: usize,
        dest_end: usize,
        src: []const u8, 
        src_width: usize,
        dest_width: usize,
        bytes_per_pixel: usize,
    ) void {
        // Special case: if src_width == dest_width, perform a direct copy
        if (src_width == dest_width) {
            @memcpy(
                dest[dest_start * bytes_per_pixel..dest_end * bytes_per_pixel],
                src[dest_start * bytes_per_pixel..dest_end * bytes_per_pixel]
            );
            return;
        }
        
        // Process pixels in the requested range
        var x_dest: usize = dest_start;
        while (x_dest < dest_end) : (x_dest += 1) {
            // For each channel
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Calculate the source region that contributes to this output pixel
                const scale = @as(f64, @floatFromInt(src_width)) / @as(f64, @floatFromInt(dest_width));
                const src_left = @as(f64, @floatFromInt(x_dest)) * scale;
                const src_right = @as(f64, @floatFromInt(x_dest + 1)) * scale;
                
                // Convert to integer coordinates, clamping to valid range
                const src_start = @max(0, @as(usize, @intFromFloat(src_left)));
                const src_end = @min(src_width, @as(usize, @intFromFloat(@ceil(src_right))));
                
                // Sum all contributing pixels and calculate average
                var sum: u32 = 0;
                var count: u32 = 0;
                
                var x_src = src_start;
                while (x_src < src_end) : (x_src += 1) {
                    const src_offset = x_src * bytes_per_pixel + channel;
                    sum += src[src_offset];
                    count += 1;
                }
                
                // Calculate average and store result
                const avg = if (count > 0) sum / count else 0;
                const dest_offset = x_dest * bytes_per_pixel + channel;
                dest[dest_offset] = @as(u8, @intCast(avg));
            }
        }
    }
    
    /// Resample a single vertical line with control over which parts of the line to process
    /// This is useful for streaming processing where you only want to process a subset of the line
    pub fn resampleVerticalLineStreaming(
        dest: []u8,
        dest_start: usize,
        dest_end: usize, 
        src: []const u8,
        src_height: usize,
        dest_height: usize,
        bytes_per_pixel: usize,
        x_offset: usize,
    ) void {
        // Special case: if src_height == dest_height, perform a direct copy
        if (src_height == dest_height) {
            for (dest_start..dest_end) |y| {
                dest[y * x_offset] = src[y * x_offset];
            }
            return;
        }
        
        // Process pixels in the requested range
        var y_dest: usize = dest_start;
        while (y_dest < dest_end) : (y_dest += 1) {
            // For each channel
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Calculate the source region that contributes to this output pixel
                const scale = @as(f64, @floatFromInt(src_height)) / @as(f64, @floatFromInt(dest_height));
                const src_top = @as(f64, @floatFromInt(y_dest)) * scale;
                const src_bottom = @as(f64, @floatFromInt(y_dest + 1)) * scale;
                
                // Convert to integer coordinates, clamping to valid range
                const src_start = @max(0, @as(usize, @intFromFloat(src_top)));
                const src_end = @min(src_height, @as(usize, @intFromFloat(@ceil(src_bottom))));
                
                // Sum all contributing pixels and calculate average
                var sum: u32 = 0;
                var count: u32 = 0;
                
                var y_src = src_start;
                while (y_src < src_end) : (y_src += 1) {
                    const src_offset = y_src * x_offset + channel;
                    sum += src[src_offset];
                    count += 1;
                }
                
                // Calculate average and store result
                const avg = if (count > 0) sum / count else 0;
                const dest_offset = y_dest * x_offset + channel;
                dest[dest_offset] = @as(u8, @intCast(avg));
            }
        }
    }
    
    /// Resize an entire image using the Box algorithm with pre-allocated buffers
    /// This implementation uses a two-pass approach:
    /// 1. First resize horizontally to a temporary buffer
    /// 2. Then resize vertically to the destination buffer
    /// 
    /// The dest, temp, and column_buffer parameters must be pre-allocated with sufficient size.
    /// Use calculateBufferSizes() to determine the required buffer sizes.
    pub fn resizeWithBuffers(
        src: []const u8,
        src_width: usize,
        src_height: usize,
        dest: []u8,
        dest_width: usize,
        dest_height: usize,
        temp: []u8,
        column_buffer: []u8,
        bytes_per_pixel: usize,
    ) !void {
        const src_stride = src_width * bytes_per_pixel;
        const dest_stride = dest_width * bytes_per_pixel;
        const temp_stride = dest_width * bytes_per_pixel;
        
        // Verify buffer sizes
        const required_sizes = calculateBufferSizes(src_width, src_height, dest_width, dest_height, bytes_per_pixel);
        if (dest.len < required_sizes.dest_size) {
            return error.DestBufferTooSmall;
        }
        if (temp.len < required_sizes.temp_size) {
            return error.TempBufferTooSmall;
        }
        if (column_buffer.len < required_sizes.column_buffer_size) {
            return error.ColumnBufferTooSmall;
        }
        
        // Special case: if src_width == dest_width and src_height == dest_height, perform a direct copy
        if (src_width == dest_width and src_height == dest_height) {
            @memcpy(dest, src);
            return;
        }
        
        // First pass: resize horizontally into temp buffer
        var y: usize = 0;
        while (y < src_height) : (y += 1) {
            const src_line = src[y * src_stride .. (y + 1) * src_stride];
            const temp_line = temp[y * temp_stride .. (y + 1) * temp_stride];
            
            resampleHorizontalLine(temp_line, src_line, src_width, dest_width, bytes_per_pixel);
        }
        
        // Second pass: resize vertically from temp buffer to destination
        var x: usize = 0;
        while (x < dest_width) : (x += 1) {
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                const src_column_start = x * bytes_per_pixel + channel;
                const dest_column_start = x * bytes_per_pixel + channel;
                
                // Extract src column into a linear buffer
                const src_column = column_buffer[0..src_height];
                
                var i: usize = 0;
                while (i < src_height) : (i += 1) {
                    src_column[i] = temp[i * temp_stride + src_column_start];
                }
                
                // Resize vertically
                const dest_column = column_buffer[src_height..][0..dest_height];
                
                resampleVerticalLine(
                    dest_column, 
                    src_column, 
                    src_height, 
                    dest_height, 
                    1, // bytes_per_pixel for a single column is 1
                    1  // stride for a single column is 1
                );
                
                // Copy back to destination
                i = 0;
                while (i < dest_height) : (i += 1) {
                    dest[i * dest_stride + dest_column_start] = dest_column[i];
                }
            }
        }
    }

    /// Resize an entire image using the Box algorithm
    /// This implementation uses a two-pass approach:
    /// 1. First resize horizontally to a temporary buffer
    /// 2. Then resize vertically to the destination buffer
    /// 
    /// This is a convenience wrapper that allocates the required buffers
    pub fn resize(
        allocator: std.mem.Allocator,
        src: []const u8,
        src_width: usize,
        src_height: usize,
        dest_width: usize,
        dest_height: usize,
        bytes_per_pixel: usize,
    ) ![]u8 {
        // Special case: if src_width == dest_width and src_height == dest_height, perform a direct copy
        if (src_width == dest_width and src_height == dest_height) {
            const dest = try allocator.alloc(u8, src.len);
            @memcpy(dest, src);
            return dest;
        }
        
        // Calculate buffer sizes
        const buffer_sizes = calculateBufferSizes(
            src_width, 
            src_height, 
            dest_width, 
            dest_height, 
            bytes_per_pixel
        );
        
        // Allocate destination buffer
        const dest = try allocator.alloc(u8, buffer_sizes.dest_size);
        errdefer allocator.free(dest);
        
        // Allocate a temporary buffer for the horizontal pass
        const temp = try allocator.alloc(u8, buffer_sizes.temp_size);
        defer allocator.free(temp);
        
        // Allocate a buffer for columns during vertical processing
        const column_buffer = try allocator.alloc(u8, buffer_sizes.column_buffer_size);
        defer allocator.free(column_buffer);
        
        // Perform the resize
        try resizeWithBuffers(
            src,
            src_width,
            src_height,
            dest,
            dest_width,
            dest_height,
            temp,
            column_buffer,
            bytes_per_pixel
        );
        
        return dest;
    }
};

// Unit Tests
test "Box resize identity" {
    // Create a simple 4x4 grayscale image (1 byte per pixel)
    var src = [_]u8{
        10, 20, 30, 40,
        50, 60, 70, 80,
        90, 100, 110, 120,
        130, 140, 150, 160
    };
    
    // Resize to the same size (4x4) - should be identical since we do direct copy
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, &src, 4, 4, 4, 4, 1);
    
    // For an identity resize with box method, we should get exactly the same values
    for (src, 0..) |value, i| {
        try std.testing.expectEqual(value, dest[i]);
    }
}

test "Box resize downscale" {
    // Create a simple 4x4 grayscale image (1 byte per pixel)
    var src = [_]u8{
        10, 20, 30, 40,
        50, 60, 70, 80,
        90, 100, 110, 120,
        130, 140, 150, 160
    };
    
    // Resize to 2x2
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, &src, 4, 4, 2, 2, 1);
    
    // Verify size
    try std.testing.expectEqual(dest.len, 4);
    
    // With box downscaling, each output pixel should be the average of a 2x2 region
    // Top-left: average of [10, 20, 50, 60]
    const top_left_expected = @divTrunc(10 + 20 + 50 + 60, 4);
    try std.testing.expectEqual(top_left_expected, dest[0]);
    
    // Top-right: average of [30, 40, 70, 80]
    const top_right_expected = @divTrunc(30 + 40 + 70 + 80, 4);
    try std.testing.expectEqual(top_right_expected, dest[1]);
    
    // Bottom-left: average of [90, 100, 130, 140]
    const bottom_left_expected = @divTrunc(90 + 100 + 130 + 140, 4);
    try std.testing.expectEqual(bottom_left_expected, dest[2]);
    
    // Bottom-right: average of [110, 120, 150, 160]
    const bottom_right_expected = @divTrunc(110 + 120 + 150 + 160, 4);
    try std.testing.expectEqual(bottom_right_expected, dest[3]);
}

test "Box resize upscale" {
    // Create a simple 2x2 grayscale image (1 byte per pixel)
    var src = [_]u8{
        50, 100,
        150, 200
    };
    
    // Resize to 4x4
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, &src, 2, 2, 4, 4, 1);
    
    // Verify size
    try std.testing.expectEqual(dest.len, 16);
    
    // For box upscaling, each output pixel should match its corresponding input region
    // The first row should all be 50 or 100 (or something in between due to averaging)
    try std.testing.expect(dest[0] >= 50 and dest[0] <= 100);
    try std.testing.expect(dest[3] >= 50 and dest[3] <= 100);
    
    // The last row should all be 150 or 200 (or something in between due to averaging)
    try std.testing.expect(dest[12] >= 150 and dest[12] <= 200);
    try std.testing.expect(dest[15] >= 150 and dest[15] <= 200);
}

test "Box resize RGB" {
    // Create a 2x2 RGB image (3 bytes per pixel)
    var src = [_]u8{
        255, 0, 0,    0, 255, 0,    // Red, Green
        0, 0, 255,    255, 255, 0    // Blue, Yellow
    };
    
    // Resize to 3x3
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, &src, 2, 2, 3, 3, 3);
    
    // Verify size
    try std.testing.expectEqual(dest.len, 27); // 3x3x3 bytes
    
    // Print all pixel values for debugging
    for (0..3) |y| {
        for (0..3) |x| {
            const i = y * 3 + x;
            const r = dest[i * 3];
            const g = dest[i * 3 + 1];
            const b = dest[i * 3 + 2];
            std.debug.print("Pixel ({d},{d}): R={d}, G={d}, B={d}\n", .{x, y, r, g, b});
        }
    }
    
    // For the box implementation, just verify we have the right dimensions
    try std.testing.expectEqual(dest.len, 27); // 3x3x3
}

test "Box resize extreme aspect ratio" {
    // Create a 20x2 grayscale image (1 byte per pixel)
    var src = try std.testing.allocator.alloc(u8, 20 * 2);
    defer std.testing.allocator.free(src);
    
    // Fill with a pattern
    for (0..20*2) |i| {
        src[i] = @as(u8, @intCast(i % 256));
    }
    
    // Resize to 5x8 (changing aspect ratio significantly)
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, src, 20, 2, 5, 8, 1);
    
    // Verify size
    try std.testing.expectEqual(dest.len, 5 * 8);
}

test "Box resize with all dimensions equal to 1" {
    // Create a 1x1 grayscale image (1 byte per pixel)
    var src = [_]u8{128};
    
    // Resize to 1x1 (identity)
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Box.resize(allocator, &src, 1, 1, 1, 1, 1);
    
    // Verify size and value
    try std.testing.expectEqual(dest.len, 1);
    try std.testing.expectEqual(dest[0], 128);
}

// The main resize function
// Usage example: 
// var resized = try Box.resize(allocator, source_buffer, src_width, src_height, dest_width, dest_height, bytes_per_pixel);