const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const EncodingOptions = @import("encoder.zig").EncodingOptions;
const ImageFormat = @import("encoder.zig").ImageFormat;

// Import the required macOS frameworks
const c = @cImport({
    @cInclude("CoreFoundation/CoreFoundation.h");
    @cInclude("CoreGraphics/CoreGraphics.h");
    @cInclude("ImageIO/ImageIO.h");
});

/// Helper to create a CoreFoundation string
fn CFSTR(str: []const u8) c.CFStringRef {
    return c.CFStringCreateWithBytes(
        null,
        str.ptr,
        @as(c_long, @intCast(str.len)),
        c.kCFStringEncodingUTF8,
        @as(u8, 0), // Boolean false (0) for isExternalRepresentation
    );
}

/// Create a UTI for the specified format
fn getUTIForFormat(format: ImageFormat) c.CFStringRef {
    return switch (format) {
        .JPEG => CFSTR("public.jpeg"),
        .PNG => CFSTR("public.png"),
        .WEBP => CFSTR("org.webmproject.webp"), // WebP type
        .AVIF => CFSTR("public.avif"), // AVIF type
    };
}

/// Transcode an image directly from one format to another without decoding to raw pixels
/// This is more efficient than decoding and re-encoding when converting between file formats
pub fn transcode(
    allocator: std.mem.Allocator,
    source_data: []const u8,
    source_format: ImageFormat,
    target_format: ImageFormat,
    options: EncodingOptions,
) ![]u8 {
    // Create a data provider from our input buffer
    const data_provider = c.CGDataProviderCreateWithData(
        null, // Info parameter (unused)
        source_data.ptr,
        source_data.len,
        null, // Release callback (we manage the memory ourselves)
    );
    defer c.CGDataProviderRelease(data_provider);

    // Create an image source from the data provider
    const source_type_id = getUTIForFormat(source_format);
    defer c.CFRelease(source_type_id);
    
    const image_source = c.CGImageSourceCreateWithDataProvider(data_provider, null);
    if (image_source == null) {
        return error.InvalidSourceImage;
    }
    defer c.CFRelease(image_source);

    // Get the image from the source
    const cg_image = c.CGImageSourceCreateImageAtIndex(image_source, 0, null);
    if (cg_image == null) {
        return error.ImageCreationFailed;
    }
    defer c.CGImageRelease(cg_image);

    // Create a mutable data object to hold the output
    const data = c.CFDataCreateMutable(null, 0);
    if (data == null) {
        return error.MemoryAllocationFailed;
    }
    defer c.CFRelease(data);

    // Create a CGImageDestination for the requested format
    const type_id = getUTIForFormat(target_format);
    defer c.CFRelease(type_id);
    
    const destination = c.CGImageDestinationCreateWithData(
        data,
        type_id,
        1, // Number of images (just one)
        null, // Options (none)
    );
    if (destination == null) {
        return error.DestinationCreationFailed;
    }
    defer c.CFRelease(destination);

    // Create properties dictionary with quality setting
    const properties = c.CFDictionaryCreateMutable(
        null,
        0,
        &c.kCFTypeDictionaryKeyCallBacks,
        &c.kCFTypeDictionaryValueCallBacks,
    );
    defer c.CFRelease(properties);

    // Set compression quality
    const quality_value = @as(f32, @floatFromInt(options.quality.quality)) / 100.0;
    const quality_number = c.CFNumberCreate(null, c.kCFNumberFloat32Type, &quality_value);
    defer c.CFRelease(quality_number);
    c.CFDictionarySetValue(properties, c.kCGImageDestinationLossyCompressionQuality, quality_number);

    // Add the image with properties
    c.CGImageDestinationAddImage(destination, cg_image, properties);

    // Finalize the destination
    if (!c.CGImageDestinationFinalize(destination)) {
        return error.EncodingFailed;
    }

    // Get the encoded data
    const cf_data_len = c.CFDataGetLength(data);
    const cf_data_ptr = c.CFDataGetBytePtr(data);

    // Copy to a Zig-managed buffer
    const output = try allocator.alloc(u8, @as(usize, @intCast(cf_data_len)));
    @memcpy(output, cf_data_ptr[0..@as(usize, @intCast(cf_data_len))]);

    return output;
}

/// MacOS implementation using CoreGraphics and ImageIO
pub fn encode(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    // Early return if dimensions are invalid
    if (width == 0 or height == 0) {
        return error.InvalidDimensions;
    }

    // Calculate bytes per pixel and row bytes
    const bytes_per_pixel = format.getBytesPerPixel();
    const bytes_per_row = width * bytes_per_pixel;

    // Create the color space
    const color_space = switch (format.getColorChannels()) {
        1 => c.CGColorSpaceCreateDeviceGray(),
        3 => c.CGColorSpaceCreateDeviceRGB(),
        else => return error.UnsupportedColorSpace,
    };
    defer c.CGColorSpaceRelease(color_space);

    // Determine bitmap info based on pixel format
    var bitmap_info: c_uint = 0;
    
    switch (format) {
        .RGB => bitmap_info = c.kCGImageAlphaNone | c.kCGBitmapByteOrderDefault,
        .RGBA => bitmap_info = c.kCGImageAlphaPremultipliedLast | c.kCGBitmapByteOrderDefault,
        .BGR => bitmap_info = c.kCGImageAlphaNone | c.kCGBitmapByteOrder32Little,
        .BGRA => bitmap_info = c.kCGImageAlphaPremultipliedFirst | c.kCGBitmapByteOrder32Little,
        .Gray => bitmap_info = c.kCGImageAlphaNone | c.kCGBitmapByteOrderDefault,
        .GrayAlpha => bitmap_info = c.kCGImageAlphaPremultipliedLast | c.kCGBitmapByteOrderDefault,
        .ARGB => bitmap_info = c.kCGImageAlphaPremultipliedFirst | c.kCGBitmapByteOrderDefault,
        .ABGR => bitmap_info = c.kCGImageAlphaPremultipliedFirst | c.kCGBitmapByteOrder32Big,
    }

    // Create a data provider from our buffer
    const data_provider = c.CGDataProviderCreateWithData(
        null, // Info parameter (unused)
        source.ptr,
        source.len,
        null, // Release callback (we manage the memory ourselves)
    );
    defer c.CGDataProviderRelease(data_provider);

    // Create the CGImage
    const cg_image = c.CGImageCreate(
        @as(usize, @intCast(width)),
        @as(usize, @intCast(height)),
        8, // Bits per component
        8 * bytes_per_pixel, // Bits per pixel
        bytes_per_row,
        color_space,
        bitmap_info,
        data_provider,
        null, // No decode array
        false, // Should interpolate
        c.kCGRenderingIntentDefault,
    );
    if (cg_image == null) {
        return error.ImageCreationFailed;
    }
    defer c.CGImageRelease(cg_image);

    // Create a CFMutableData to hold the output
    const data = c.CFDataCreateMutable(null, 0);
    if (data == null) {
        return error.MemoryAllocationFailed;
    }
    defer c.CFRelease(data);

    // Create a CGImageDestination for the requested format
    const type_id = getUTIForFormat(options.format);
    const destination = c.CGImageDestinationCreateWithData(
        data,
        type_id,
        1, // Number of images (just one)
        null, // Options (none)
    );
    if (destination == null) {
        return error.DestinationCreationFailed;
    }
    defer c.CFRelease(destination);

    // Create properties dictionary with quality setting
    const properties = c.CFDictionaryCreateMutable(
        null,
        0,
        &c.kCFTypeDictionaryKeyCallBacks,
        &c.kCFTypeDictionaryValueCallBacks,
    );
    defer c.CFRelease(properties);

    // Set compression quality
    const quality_value = @as(f32, @floatFromInt(options.quality.quality)) / 100.0;
    const quality_number = c.CFNumberCreate(null, c.kCFNumberFloat32Type, &quality_value);
    defer c.CFRelease(quality_number);
    c.CFDictionarySetValue(properties, c.kCGImageDestinationLossyCompressionQuality, quality_number);

    // Add the image with properties
    c.CGImageDestinationAddImage(destination, cg_image, properties);

    // Finalize the destination
    if (!c.CGImageDestinationFinalize(destination)) {
        return error.EncodingFailed;
    }

    // Get the encoded data
    const cf_data_len = c.CFDataGetLength(data);
    const cf_data_ptr = c.CFDataGetBytePtr(data);

    // Copy to a Zig-managed buffer
    const output = try allocator.alloc(u8, @as(usize, @intCast(cf_data_len)));
    @memcpy(output, cf_data_ptr[0..@as(usize, @intCast(cf_data_len))]);

    return output;
}