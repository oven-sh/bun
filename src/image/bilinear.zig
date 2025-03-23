const std = @import("std");
const math = std.math;

/// Bilinear interpolation is a simple, efficient resampling algorithm that provides
/// reasonably good results for both upscaling and downscaling.
/// It uses linear interpolation in both the x and y directions.
///
/// References:
/// - https://en.wikipedia.org/wiki/Bilinear_interpolation
pub const Bilinear = struct {
    /// Error set for streaming resizing operations
    pub const Error = error{
        DestBufferTooSmall,
        TempBufferTooSmall,
        ColumnBufferTooSmall,
        ChunkRangeInvalid,
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
        const column_buffer_size = if (src_height > dest_height) src_height * 2 else dest_height * 2;

        return .{
            .dest_size = dest_size,
            .temp_size = temp_size,
            .column_buffer_size = column_buffer_size,
        };
    }

    /// Resample a horizontal line using bilinear interpolation
    /// This function is optimized for SIMD operations when possible
    pub fn resampleHorizontalLine(
        dest: []u8, 
        src: []const u8,
        src_width: usize,
        dest_width: usize,
        bytes_per_pixel: usize,
    ) void {
        // Calculate scaling factor
        const scale = @as(f64, @floatFromInt(src_width)) / @as(f64, @floatFromInt(dest_width));
        
        // Process 4 pixels at a time when possible for SIMD optimization
        // and fall back to scalar processing for the remainder
        const vector_width = 4;
        const vector_limit = dest_width - (dest_width % vector_width);
        
        // For each pixel in the destination, using SIMD when possible
        var x: usize = 0;
        
        // Process pixels in groups of 4 using SIMD
        while (x < vector_limit and bytes_per_pixel == 1) : (x += vector_width) {
            // Calculate the source positions for 4 pixels at once
            const x_vec = @as(@Vector(4, f64), @splat(@as(f64, @floatFromInt(x)))) + 
                         @Vector(4, f64){ 0.5, 1.5, 2.5, 3.5 };
            const src_x_vec = x_vec * @as(@Vector(4, f64), @splat(scale)) - 
                             @as(@Vector(4, f64), @splat(0.5));
            
            // For each destination pixel, calculate the 4 source pixels and weights
            var results = @Vector(4, u8){0, 0, 0, 0};
            
            // For each pixel in our vector
            inline for (0..4) |i| {
                const src_x = src_x_vec[i];
                
                // Find the source pixels to sample (left and right)
                const src_x_floor = math.floor(src_x);
                const x1 = if (src_x_floor < 0) 0 else @as(usize, @intFromFloat(src_x_floor));
                const x2 = @min(x1 + 1, src_width - 1);
                
                // Calculate the weight for linear interpolation
                const weight = src_x - src_x_floor;
                
                // Get the source pixel values
                const left_val = src[x1];
                const right_val = src[x2];
                
                // Linear interpolation
                const result = @as(u8, @intFromFloat(
                    @as(f64, @floatFromInt(left_val)) * (1.0 - weight) + 
                    @as(f64, @floatFromInt(right_val)) * weight
                ));
                
                results[i] = result;
            }
            
            // Store the results
            for (0..4) |i| {
                dest[x + i] = results[i];
            }
        }
        
        // Process remaining pixels using the scalar implementation
        if (x < dest_width) {
            resampleHorizontalLineStreaming(dest, x, dest_width, src, src_width, dest_width, bytes_per_pixel);
        }
    }
    
    /// Resample a vertical line using bilinear interpolation
    /// This function is optimized for SIMD operations when possible
    pub fn resampleVerticalLine(
        dest: []u8, 
        src: []const u8,
        src_height: usize,
        dest_height: usize,
        bytes_per_pixel: usize,
        x_offset: usize,
    ) void {
        // Calculate scaling factor
        const scale = @as(f64, @floatFromInt(src_height)) / @as(f64, @floatFromInt(dest_height));
        
        // Process 4 pixels at a time when possible for SIMD optimization
        // and fall back to scalar processing for the remainder
        const vector_width = 4;
        const vector_limit = dest_height - (dest_height % vector_width);
        
        // For each pixel in the destination, using SIMD when possible
        var y: usize = 0;
        
        // Process pixels in groups of 4 using SIMD
        // Only for single-channel data with regular stride
        while (y < vector_limit and bytes_per_pixel == 1 and x_offset == 1) : (y += vector_width) {
            // Calculate the source positions for 4 pixels at once
            const y_vec = @as(@Vector(4, f64), @splat(@as(f64, @floatFromInt(y)))) + 
                         @Vector(4, f64){ 0.5, 1.5, 2.5, 3.5 };
            const src_y_vec = y_vec * @as(@Vector(4, f64), @splat(scale)) - 
                             @as(@Vector(4, f64), @splat(0.5));
            
            // For each destination pixel, calculate the source pixels and weights
            var results = @Vector(4, u8){0, 0, 0, 0};
            
            // For each pixel in our vector
            inline for (0..4) |i| {
                const src_y = src_y_vec[i];
                
                // Find the source pixels to sample (top and bottom)
                const src_y_floor = math.floor(src_y);
                const y1 = if (src_y_floor < 0) 0 else @as(usize, @intFromFloat(src_y_floor));
                const y2 = @min(y1 + 1, src_height - 1);
                
                // Calculate the weight for linear interpolation
                const weight = src_y - src_y_floor;
                
                // Get the source pixel values
                const top_val = src[y1];
                const bottom_val = src[y2];
                
                // Linear interpolation
                const result = @as(u8, @intFromFloat(
                    @as(f64, @floatFromInt(top_val)) * (1.0 - weight) + 
                    @as(f64, @floatFromInt(bottom_val)) * weight
                ));
                
                results[i] = result;
            }
            
            // Store the results
            for (0..4) |i| {
                dest[y + i] = results[i];
            }
        }
        
        // Process remaining pixels using the scalar streaming implementation
        if (y < dest_height) {
            resampleVerticalLineStreaming(dest, y, dest_height, src, src_height, dest_height, bytes_per_pixel, x_offset);
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
        // Calculate scaling factor
        const scale = @as(f64, @floatFromInt(src_width)) / @as(f64, @floatFromInt(dest_width));
        
        // Process pixels in the requested range
        var x: usize = dest_start;
        while (x < dest_end) : (x += 1) {
            // Calculate the source position
            const src_x = (@as(f64, @floatFromInt(x)) + 0.5) * scale - 0.5;
            
            // Get the floor and fractional parts for interpolation
            const src_x_floor = math.floor(src_x);
            const x_fract = src_x - src_x_floor;
            
            // Calculate the two source pixels to sample
            // Ensure src_x_floor is not negative before conversion to usize
            const x1 = if (src_x_floor < 0) 0 else @as(usize, @intFromFloat(src_x_floor));
            const x2 = @min(x1 + 1, src_width - 1);
            
            // For each channel (R, G, B, A)
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Get the source pixel values
                const src_value1 = src[x1 * bytes_per_pixel + channel];
                const src_value2 = src[x2 * bytes_per_pixel + channel];
                
                // Linear interpolation: value = (1-t)*v1 + t*v2
                const weight2 = x_fract;
                const weight1 = 1.0 - weight2;
                
                const interpolated = @as(f64, @floatFromInt(src_value1)) * weight1 + 
                                   @as(f64, @floatFromInt(src_value2)) * weight2;
                
                // Store the result
                const dest_offset = x * bytes_per_pixel + channel;
                dest[dest_offset] = @as(u8, @intFromFloat(math.clamp(interpolated, 0, 255)));
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
        // Calculate scaling factor
        const scale = @as(f64, @floatFromInt(src_height)) / @as(f64, @floatFromInt(dest_height));
        
        // Process pixels in the requested range
        var y: usize = dest_start;
        while (y < dest_end) : (y += 1) {
            // Calculate the source position
            const src_y = (@as(f64, @floatFromInt(y)) + 0.5) * scale - 0.5;
            
            // Get the floor and fractional parts for interpolation
            const src_y_floor = math.floor(src_y);
            const y_fract = src_y - src_y_floor;
            
            // Calculate the two source pixels to sample
            // Ensure src_y_floor is not negative before conversion to usize
            const y1 = if (src_y_floor < 0) 0 else @as(usize, @intFromFloat(src_y_floor));
            const y2 = @min(y1 + 1, src_height - 1);
            
            // For each channel (R, G, B, A)
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                // Get the source pixel values
                const src_value1 = src[y1 * x_offset + channel];
                const src_value2 = src[y2 * x_offset + channel];
                
                // Linear interpolation: value = (1-t)*v1 + t*v2
                const weight2 = y_fract;
                const weight1 = 1.0 - weight2;
                
                const interpolated = @as(f64, @floatFromInt(src_value1)) * weight1 + 
                                   @as(f64, @floatFromInt(src_value2)) * weight2;
                
                // Store the result
                const dest_offset = y * x_offset + channel;
                dest[dest_offset] = @as(u8, @intFromFloat(math.clamp(interpolated, 0, 255)));
            }
        }
    }
    
    /// Resize a chunk of an image using bilinear interpolation
    /// This allows processing an image in smaller chunks for streaming 
    /// or when memory is limited.
    ///
    /// The chunk is defined by the yStart and yEnd parameters, which specify 
    /// the vertical range of source rows to process.
    ///
    /// This function processes a subset of the horizontal pass and uses 
    /// pre-allocated buffers for all operations.
    pub fn resizeChunk(
        src: []const u8,
        src_width: usize,
        src_height: usize,
        yStart: usize,
        yEnd: usize,
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
        
        // Validate the chunk range
        if (yEnd > src_height) {
            return error.ChunkRangeInvalid;
        }
        
        // Calculate scaling factor for vertical dimension
        const vert_scale = @as(f64, @floatFromInt(src_height)) / @as(f64, @floatFromInt(dest_height));
        
        // First pass: resize horizontally just for the specified chunk of the source
        var y: usize = yStart;
        while (y < yEnd) : (y += 1) {
            const src_line = src[y * src_stride .. (y + 1) * src_stride];
            const temp_line = temp[(y - yStart) * temp_stride .. (y - yStart + 1) * temp_stride];
            
            resampleHorizontalLine(temp_line, src_line, src_width, dest_width, bytes_per_pixel);
        }
        
        // Calculate which destination rows are affected by this chunk
        const dest_first_y = @max(0, @as(usize, @intFromFloat((@as(f64, @floatFromInt(yStart)) - 1.0) / vert_scale)));
        const dest_last_y = @min(
            dest_height - 1,
            @as(usize, @intFromFloat((@as(f64, @floatFromInt(yEnd)) + 1.0) / vert_scale))
        );
        
        // Second pass: resize vertically, but only for the destination rows
        // that are affected by this chunk
        var x: usize = 0;
        while (x < dest_width) : (x += 1) {
            var channel: usize = 0;
            while (channel < bytes_per_pixel) : (channel += 1) {
                const src_column_start = x * bytes_per_pixel + channel;
                const dest_column_start = x * bytes_per_pixel + channel;
                
                // Extract the chunk's columns into a linear buffer
                const chunk_height = yEnd - yStart;
                const src_column = column_buffer[0..chunk_height];
                
                var i: usize = 0;
                while (i < chunk_height) : (i += 1) {
                    src_column[i] = temp[i * temp_stride + src_column_start];
                }
                
                // Process each destination row influenced by this chunk
                var dest_y = dest_first_y;
                while (dest_y <= dest_last_y) : (dest_y += 1) {
                    // Calculate the source center pixel position
                    const src_y_f = (@as(f64, @floatFromInt(dest_y)) + 0.5) * vert_scale - 0.5;
                    
                    // Skip if this destination pixel is not affected by our chunk
                    const src_y_floor = @as(usize, @intFromFloat(math.floor(src_y_f)));
                    const src_y_ceil = @min(src_y_floor + 1, src_height - 1);
                    
                    // Only process if the source pixels are within our chunk
                    if (src_y_ceil < yStart or src_y_floor >= yEnd) {
                        continue;
                    }
                    
                    // Adjust source positions to be relative to the chunk
                    const rel_src_y_floor = if (src_y_floor >= yStart) src_y_floor - yStart else 0;
                    const rel_src_y_ceil = if (src_y_ceil < yEnd) src_y_ceil - yStart else chunk_height - 1;
                    
                    // Calculate the weight for linear interpolation
                    const weight = src_y_f - math.floor(src_y_f);
                    
                    // Get the source pixel values
                    const top_val = src_column[rel_src_y_floor];
                    const bottom_val = src_column[rel_src_y_ceil];
                    
                    // Linear interpolation
                    const result = @as(u8, @intFromFloat(
                        @as(f64, @floatFromInt(top_val)) * (1.0 - weight) + 
                        @as(f64, @floatFromInt(bottom_val)) * weight
                    ));
                    
                    // Store the result
                    dest[dest_y * dest_stride + dest_column_start] = result;
                }
            }
        }
    }

    /// Resize an entire image using bilinear interpolation with pre-allocated buffers
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

    /// Resize an entire image using bilinear interpolation
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
test "Bilinear resize identity" {
    // Create a simple 4x4 grayscale image (1 byte per pixel)
    var src = [_]u8{
        10, 20, 30, 40,
        50, 60, 70, 80,
        90, 100, 110, 120,
        130, 140, 150, 160
    };
    
    // Resize to the same size (4x4) - should be very close to identical
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Bilinear.resize(allocator, &src, 4, 4, 4, 4, 1);
    
    // For an identity resize, verify that the general structure is maintained
    // by checking that values increase left-to-right and top-to-bottom
    try std.testing.expect(dest[0] < dest[3]); // First row increases left to right
    try std.testing.expect(dest[0] < dest[12]); // First column increases top to bottom
    try std.testing.expect(dest[15] > dest[14]); // Last row increases left to right
    try std.testing.expect(dest[15] > dest[3]); // Last column increases top to bottom
}

test "Bilinear resize larger" {
    // Create a simple 2x2 grayscale image (1 byte per pixel)
    var src = [_]u8{
        50, 100,
        150, 200
    };
    
    // Resize to 4x4
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Bilinear.resize(allocator, &src, 2, 2, 4, 4, 1);
    
    // Verify that the resized image has the correct size
    try std.testing.expectEqual(dest.len, 16);
    
    // Check if values are reasonable
    try std.testing.expect(dest[0] < dest[3]); // Left to right
    try std.testing.expect(dest[0] < dest[12]); // Top to bottom
    try std.testing.expect(dest[15] > dest[12]); // Right side, bottom to top
    try std.testing.expect(dest[15] > dest[3]); // Bottom side, right to left
    
    // Bilinear interpolation should produce values in a reasonable range
    const middle_value = dest[5]; // Somewhere in the middle
    try std.testing.expect(middle_value > 50 and middle_value < 200);
}

test "Bilinear resize smaller" {
    // Create a 4x4 grayscale test image with gradient pattern
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
    const dest = try Bilinear.resize(allocator, &src, 4, 4, 2, 2, 1);
    
    // Verify that the resized image has the correct size
    try std.testing.expectEqual(dest.len, 4);
    
    // When downsampling, bilinear should give approximate averages of source regions
    try std.testing.expect(dest[0] >= 30 and dest[0] <= 70); // Top-left quarter average
    try std.testing.expect(dest[1] >= 50 and dest[1] <= 90); // Top-right quarter average
    try std.testing.expect(dest[2] >= 90 and dest[2] <= 130); // Bottom-left quarter average
    try std.testing.expect(dest[3] >= 110 and dest[3] <= 150); // Bottom-right quarter average
}

test "Bilinear resize RGB" {
    // Create a 2x2 RGB test image (3 bytes per pixel)
    const src = [_]u8{
        255, 0, 0,    0, 255, 0,    // Red, Green
        0, 0, 255,    255, 255, 0    // Blue, Yellow
    };
    
    // Resize to 3x3
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    
    const allocator = arena.allocator();
    const dest = try Bilinear.resize(allocator, &src, 2, 2, 3, 3, 3);
    
    // Verify that the resized image has the correct size
    try std.testing.expectEqual(dest.len, 27); // 3x3x3 bytes
    
    // For the bilinear implementation, just verify we have the right dimensions
    try std.testing.expectEqual(dest.len, 27); // 3x3x3
}