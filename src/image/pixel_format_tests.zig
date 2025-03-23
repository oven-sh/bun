const std = @import("std");
const testing = std.testing;
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const Pixel = pixel_format.Pixel;
const lanczos3 = @import("lanczos3.zig");
const bicubic = @import("bicubic.zig");

test "basic format conversion" {
    // Create a test RGB image
    const width = 4;
    const height = 3;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.RGBA;
    
    var src = [_]u8{
        // Row 1: Red, Green, Blue, Yellow
        255, 0, 0,    0, 255, 0,    0, 0, 255,    255, 255, 0,
        // Row 2: Cyan, Magenta, Black, White
        0, 255, 255,    255, 0, 255,    0, 0, 0,    255, 255, 255,
        // Row 3: Gray scale
        50, 50, 50,    100, 100, 100,    150, 150, 150,    200, 200, 200
    };
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Convert from RGB to RGBA
    const dest = try pixel_format.convert(
        allocator, 
        &src, 
        src_format, 
        dest_format, 
        width, 
        height
    );
    
    // Verify the output buffer size
    try testing.expectEqual(dest.len, width * height * dest_format.getBytesPerPixel());
    
    // Check that the first pixel (Red) was converted correctly
    try testing.expectEqual(dest[0], 255);  // R
    try testing.expectEqual(dest[1], 0);    // G
    try testing.expectEqual(dest[2], 0);    // B
    try testing.expectEqual(dest[3], 255);  // A (added, full opacity)
    
    // Check that the last pixel (200 gray) was converted correctly
    const last_pixel_idx = (width * height - 1) * dest_format.getBytesPerPixel();
    try testing.expectEqual(dest[last_pixel_idx], 200);     // R
    try testing.expectEqual(dest[last_pixel_idx + 1], 200); // G
    try testing.expectEqual(dest[last_pixel_idx + 2], 200); // B
    try testing.expectEqual(dest[last_pixel_idx + 3], 255); // A (added, full opacity)
}

test "convert to grayscale" {
    // Create a test RGB image
    const width = 2;
    const height = 2;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.Gray;
    
    var src = [_]u8{
        // Red, Green
        255, 0, 0,    0, 255, 0,
        // Blue, White
        0, 0, 255,    255, 255, 255
    };
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Convert from RGB to Gray
    const dest = try pixel_format.convert(
        allocator, 
        &src, 
        src_format, 
        dest_format, 
        width, 
        height
    );
    
    // Verify the output buffer size
    try testing.expectEqual(dest.len, width * height * dest_format.getBytesPerPixel());
    
    // Expected grayscale values using standard luminance formula:
    // Y = 0.2126*R + 0.7152*G + 0.0722*B
    
    // Red: 0.2126*255 + 0 + 0 ≈ 54
    try testing.expectEqual(dest[0], 54);
    
    // Green: 0 + 0.7152*255 + 0 ≈ 182
    try testing.expectEqual(dest[1], 182);
    
    // Blue: 0 + 0 + 0.0722*255 ≈ 18
    try testing.expectEqual(dest[2], 18);
    
    // White: 0.2126*255 + 0.7152*255 + 0.0722*255 = 255
    try testing.expectEqual(dest[3], 255);
}

test "premultiply and unpremultiply alpha" {
    // Create a test RGBA image with varying alpha values
    const width = 2;
    const height = 2;
    const format = PixelFormat.RGBA;
    
    var src = [_]u8{
        // Red at 50% opacity, Green at 25% opacity
        255, 0, 0, 128,    0, 255, 0, 64,
        // Blue at 75% opacity, Transparent white
        0, 0, 255, 192,    255, 255, 255, 0
    };
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Premultiply alpha
    const premultiplied = try pixel_format.premultiplyAlpha(
        allocator, 
        &src, 
        format, 
        width, 
        height
    );
    
    // Check premultiplied values
    
    // Red at 50% opacity: (255*0.5, 0*0.5, 0*0.5, 128) = (128, 0, 0, 128)
    try testing.expectEqual(premultiplied[0], 128);
    try testing.expectEqual(premultiplied[1], 0);
    try testing.expectEqual(premultiplied[2], 0);
    try testing.expectEqual(premultiplied[3], 128); // Alpha unchanged
    
    // Green at 25% opacity: (0*0.25, 255*0.25, 0*0.25, 64) = (0, 64, 0, 64)
    try testing.expectEqual(premultiplied[4], 0);
    try testing.expectEqual(premultiplied[5], 64);
    try testing.expectEqual(premultiplied[6], 0);
    try testing.expectEqual(premultiplied[7], 64); // Alpha unchanged
    
    // Blue at 75% opacity: (0*0.75, 0*0.75, 255*0.75, 192) = (0, 0, 192, 192)
    try testing.expectEqual(premultiplied[8], 0);
    try testing.expectEqual(premultiplied[9], 0);
    try testing.expectEqual(premultiplied[10], 192); // 255 * 0.75 = 191.25, rounds to 192
    try testing.expectEqual(premultiplied[11], 192); // Alpha unchanged
    
    // Transparent white: (255*0, 255*0, 255*0, 0) = (0, 0, 0, 0)
    try testing.expectEqual(premultiplied[12], 0);
    try testing.expectEqual(premultiplied[13], 0);
    try testing.expectEqual(premultiplied[14], 0);
    try testing.expectEqual(premultiplied[15], 0); // Alpha unchanged
    
    // Now unpremultiply alpha
    const unpremultiplied = try pixel_format.unpremultiplyAlpha(
        allocator, 
        premultiplied, 
        format, 
        width, 
        height
    );
    
    // Check original values were restored
    // Note: There might be some small rounding errors due to the conversions
    
    // Red
    try testing.expectEqual(unpremultiplied[0], 255);
    try testing.expectEqual(unpremultiplied[1], 0);
    try testing.expectEqual(unpremultiplied[2], 0);
    try testing.expectEqual(unpremultiplied[3], 128);
    
    // Green
    try testing.expectEqual(unpremultiplied[4], 0);
    try testing.expectEqual(unpremultiplied[5], 255);
    try testing.expectEqual(unpremultiplied[6], 0);
    try testing.expectEqual(unpremultiplied[7], 64);
    
    // Blue
    try testing.expectEqual(unpremultiplied[8], 0);
    try testing.expectEqual(unpremultiplied[9], 0);
    try testing.expectEqual(unpremultiplied[10], 255);
    try testing.expectEqual(unpremultiplied[11], 192);
    
    // Transparent white - Alpha is 0, so RGB values might be any value
    try testing.expectEqual(unpremultiplied[15], 0); // Only checking alpha
}

test "convert row streaming operation" {
    // Create a test RGB row
    const width = 4;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.BGRA;
    
    const src = [_]u8{
        // Red, Green, Blue, Yellow
        255, 0, 0,    0, 255, 0,    0, 0, 255,    255, 255, 0
    };
    
    // Create destination buffer
    var dest = [_]u8{0} ** (width * dest_format.getBytesPerPixel());
    
    // Convert the row
    try pixel_format.convertRow(&src, src_format, &dest, dest_format, width);
    
    // Verify conversion
    
    // First pixel (Red -> BGRA)
    try testing.expectEqual(dest[0], 0);    // B
    try testing.expectEqual(dest[1], 0);    // G
    try testing.expectEqual(dest[2], 255);  // R
    try testing.expectEqual(dest[3], 255);  // A (added)
    
    // Last pixel (Yellow -> BGRA)
    const last_pixel_idx = (width - 1) * dest_format.getBytesPerPixel();
    try testing.expectEqual(dest[last_pixel_idx], 0);      // B
    try testing.expectEqual(dest[last_pixel_idx + 1], 255); // G
    try testing.expectEqual(dest[last_pixel_idx + 2], 255); // R
    try testing.expectEqual(dest[last_pixel_idx + 3], 255); // A (added)
}

test "convert portion streaming operation" {
    // Create a test RGB image with multiple rows
    const width = 3;
    const height = 4;
    const src_format = PixelFormat.RGB;
    const dest_format = PixelFormat.RGBA;
    
    var src = [_]u8{
        // Row 0: Red, Green, Blue
        255, 0, 0,    0, 255, 0,    0, 0, 255,
        // Row 1: Yellow, Cyan, Magenta
        255, 255, 0,    0, 255, 255,    255, 0, 255,
        // Row 2: Black, Gray, White
        0, 0, 0,    128, 128, 128,    255, 255, 255,
        // Row 3: Dark Red, Dark Green, Dark Blue
        128, 0, 0,    0, 128, 0,    0, 0, 128
    };
    
    // Create destination buffer
    var dest = [_]u8{0} ** (width * height * dest_format.getBytesPerPixel());
    
    // Convert only the middle portion (rows 1 and 2)
    try pixel_format.convertPortion(
        &src, 
        src_format, 
        &dest, 
        dest_format, 
        width, 
        1, // start_row
        3  // end_row
    );
    
    // Verify first row wasn't converted (still all zeros)
    for (0..width * dest_format.getBytesPerPixel()) |i| {
        try testing.expectEqual(dest[i], 0);
    }
    
    // Verify row 1 was converted (Yellow, Cyan, Magenta)
    const row1_start = width * dest_format.getBytesPerPixel();
    
    // Yellow
    try testing.expectEqual(dest[row1_start], 255);
    try testing.expectEqual(dest[row1_start + 1], 255);
    try testing.expectEqual(dest[row1_start + 2], 0);
    try testing.expectEqual(dest[row1_start + 3], 255); // Alpha added
    
    // Cyan
    try testing.expectEqual(dest[row1_start + 4], 0);
    try testing.expectEqual(dest[row1_start + 5], 255);
    try testing.expectEqual(dest[row1_start + 6], 255);
    try testing.expectEqual(dest[row1_start + 7], 255); // Alpha added
    
    // Verify row 2 was converted (Black, Gray, White)
    const row2_start = 2 * width * dest_format.getBytesPerPixel();
    
    // Black
    try testing.expectEqual(dest[row2_start], 0);
    try testing.expectEqual(dest[row2_start + 1], 0);
    try testing.expectEqual(dest[row2_start + 2], 0);
    try testing.expectEqual(dest[row2_start + 3], 255); // Alpha added
    
    // White
    try testing.expectEqual(dest[row2_start + 8], 255);
    try testing.expectEqual(dest[row2_start + 9], 255);
    try testing.expectEqual(dest[row2_start + 10], 255);
    try testing.expectEqual(dest[row2_start + 11], 255); // Alpha added
    
    // Verify row 3 wasn't converted (still all zeros)
    const row3_start = 3 * width * dest_format.getBytesPerPixel();
    for (0..width * dest_format.getBytesPerPixel()) |i| {
        try testing.expectEqual(dest[row3_start + i], 0);
    }
}

test "SIMD accelerated conversions" {
    // Create a test image large enough to trigger SIMD paths
    const width = 8;
    const height = 4;
    const src_format = PixelFormat.RGBA;
    const dest_format = PixelFormat.BGRA;
    
    var src: [width * height * src_format.getBytesPerPixel()]u8 = undefined;
    var dest: [width * height * dest_format.getBytesPerPixel()]u8 = undefined;
    
    // Fill source with a test pattern
    for (0..width*height) |i| {
        const offset = i * 4;
        src[offset] = @as(u8, @intCast(i)); // R
        src[offset+1] = @as(u8, @intCast(i * 2)); // G
        src[offset+2] = @as(u8, @intCast(i * 3)); // B
        src[offset+3] = 255; // A
    }
    
    // Try SIMD conversion
    const used_simd = try pixel_format.convertSIMD(
        &src, 
        src_format, 
        &dest, 
        dest_format, 
        width, 
        height
    );
    
    // Should use SIMD for this conversion pair
    try testing.expect(used_simd);
    
    // Verify the conversion was correct
    for (0..width*height) |i| {
        const offset = i * 4;
        try testing.expectEqual(dest[offset], src[offset+2]); // B = src.B
        try testing.expectEqual(dest[offset+1], src[offset+1]); // G = src.G
        try testing.expectEqual(dest[offset+2], src[offset]); // R = src.R
        try testing.expectEqual(dest[offset+3], src[offset+3]); // A = src.A
    }
    
    // Test a conversion that shouldn't use SIMD
    const used_simd2 = try pixel_format.convertSIMD(
        &src, 
        src_format, 
        &dest, 
        PixelFormat.GrayAlpha, // Not supported for SIMD
        width, 
        height
    );
    
    // Should not use SIMD for this conversion pair
    try testing.expect(!used_simd2);
}

test "resize and convert in sequence" {
    // Create a test grayscale image
    const src_width = 2;
    const src_height = 2;
    const src_format = PixelFormat.Gray;
    
    var src = [_]u8{
        50, 100,
        150, 200
    };
    
    // Target size is 4x4
    const dest_width = 4;
    const dest_height = 4;
    const dest_format = PixelFormat.RGB;
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // First, resize the grayscale image
    const resized = try lanczos3.Lanczos3.resize(
        allocator,
        &src,
        src_width,
        src_height,
        dest_width,
        dest_height,
        src_format.getBytesPerPixel()
    );
    
    // Then convert from grayscale to RGB
    const dest = try pixel_format.convert(
        allocator,
        resized,
        src_format,
        dest_format,
        dest_width,
        dest_height
    );
    
    // Verify the final result has the right size
    try testing.expectEqual(dest.len, dest_width * dest_height * dest_format.getBytesPerPixel());
    
    // Check conversion correctness for a couple of pixels
    
    // For grayscale->RGB, each RGB channel gets the gray value
    
    // First pixel
    try testing.expectEqual(dest[0], resized[0]); // R = gray
    try testing.expectEqual(dest[1], resized[0]); // G = gray
    try testing.expectEqual(dest[2], resized[0]); // B = gray
    
    // Last pixel
    const last_pixel_index = dest_width * dest_height - 1;
    const last_dest_index = last_pixel_index * dest_format.getBytesPerPixel();
    try testing.expectEqual(dest[last_dest_index], resized[last_pixel_index]); // R = gray
    try testing.expectEqual(dest[last_dest_index + 1], resized[last_pixel_index]); // G = gray
    try testing.expectEqual(dest[last_dest_index + 2], resized[last_pixel_index]); // B = gray
}

test "format conversion chaining" {
    // Create a test grayscale image
    const width = 2;
    const height = 2;
    const src_format = PixelFormat.Gray;
    
    var src = [_]u8{
        50, 100,
        150, 200
    };
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Chain of conversions:
    // Gray -> RGB -> RGBA -> BGRA -> ABGR -> Gray
    
    // Gray -> RGB
    const rgb = try pixel_format.convert(
        allocator,
        &src,
        src_format,
        PixelFormat.RGB,
        width,
        height
    );
    
    // RGB -> RGBA
    const rgba = try pixel_format.convert(
        allocator,
        rgb,
        PixelFormat.RGB,
        PixelFormat.RGBA,
        width,
        height
    );
    
    // RGBA -> BGRA
    const bgra = try pixel_format.convert(
        allocator,
        rgba,
        PixelFormat.RGBA,
        PixelFormat.BGRA,
        width,
        height
    );
    
    // BGRA -> ABGR
    const abgr = try pixel_format.convert(
        allocator,
        bgra,
        PixelFormat.BGRA,
        PixelFormat.ABGR,
        width,
        height
    );
    
    // ABGR -> Gray (back to where we started)
    const gray = try pixel_format.convert(
        allocator,
        abgr,
        PixelFormat.ABGR,
        PixelFormat.Gray,
        width,
        height
    );
    
    // Verify we get back to the original values
    // Some small rounding differences are possible due to the conversions
    for (0..width*height) |i| {
        const diff = if (gray[i] > src[i]) gray[i] - src[i] else src[i] - gray[i];
        try testing.expect(diff <= 1); // Allow 1 unit tolerance for rounding
    }
}

test "integration with different scaling algorithms" {
    // Create a test RGB image
    const src_width = 2;
    const src_height = 2;
    const src_format = PixelFormat.RGB;
    
    var src = [_]u8{
        255, 0, 0,    0, 255, 0,    // Red, Green
        0, 0, 255,    255, 255, 0    // Blue, Yellow
    };
    
    // Target size is 4x4
    const dest_width = 4;
    const dest_height = 4;
    const dest_format = PixelFormat.RGBA;
    
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    
    // Test with Lanczos3 algorithm
    const lanczos_resized = try lanczos3.Lanczos3.resize(
        allocator,
        &src,
        src_width,
        src_height,
        dest_width,
        dest_height,
        src_format.getBytesPerPixel()
    );
    
    // Test with Bicubic algorithm
    const bicubic_resized = try bicubic.Bicubic.resize(
        allocator,
        &src,
        src_width,
        src_height,
        dest_width,
        dest_height,
        src_format.getBytesPerPixel()
    );
    
    // Convert Lanczos3 result from RGB to RGBA
    const lanczos_converted = try pixel_format.convert(
        allocator,
        lanczos_resized,
        src_format,
        dest_format,
        dest_width,
        dest_height
    );
    
    // Convert Bicubic result from RGB to RGBA
    const bicubic_converted = try pixel_format.convert(
        allocator,
        bicubic_resized,
        src_format,
        dest_format,
        dest_width,
        dest_height
    );
    
    // Verify both results have correct sizes
    try testing.expectEqual(lanczos_converted.len, dest_width * dest_height * dest_format.getBytesPerPixel());
    try testing.expectEqual(bicubic_converted.len, dest_width * dest_height * dest_format.getBytesPerPixel());
    
    // Both algorithms should preserve general color patterns, though details might differ
    
    // Red component should dominate in the top-left corner for both
    try testing.expect(lanczos_converted[0] > lanczos_converted[1] and lanczos_converted[0] > lanczos_converted[2]);
    try testing.expect(bicubic_converted[0] > bicubic_converted[1] and bicubic_converted[0] > bicubic_converted[2]);
    
    // Alpha should be 255 in all pixels
    for (0..dest_width*dest_height) |i| {
        const lanczos_alpha_idx = i * 4 + 3;
        const bicubic_alpha_idx = i * 4 + 3;
        
        try testing.expectEqual(lanczos_converted[lanczos_alpha_idx], 255);
        try testing.expectEqual(bicubic_converted[bicubic_alpha_idx], 255);
    }
}