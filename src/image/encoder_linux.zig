const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const EncodingOptions = @import("encoder.zig").EncodingOptions;
const ImageFormat = @import("encoder.zig").ImageFormat;
const libjpeg = @import("libjpeg.zig");
const libpng = @import("libpng.zig");
const libwebp = @import("libwebp.zig");

// Custom write struct for PNG memory writing
const PngWriteState = struct {
    data: std.ArrayList(u8),
    
    pub fn write(png_ptr: libpng.png_structp, data_ptr: libpng.png_const_bytep, length: usize) callconv(.C) void {
        const write_state = @as(?*PngWriteState, @ptrCast(libpng.png_get_io_ptr(png_ptr))) orelse return;
        write_state.data.appendSlice(data_ptr[0..length]) catch return;
    }

    pub fn flush(png_ptr: libpng.png_structp) callconv(.C) void {
        _ = png_ptr;
        // No flushing needed for memory output
    }
};

// Encode to PNG
fn encodePNG(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    pixel_fmt: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    _ = options; // PNG doesn't use quality settings

    // Initialize libpng
    try libpng.init();
    
    // Create write structure
    const png_ptr = libpng.png_create_write_struct("1.6.37", null, null, null);
    if (png_ptr == null) {
        return error.PngCreateWriteStructFailed;
    }
    
    // Create info structure
    const info_ptr = libpng.png_create_info_struct(png_ptr);
    if (info_ptr == null) {
        libpng.png_destroy_write_struct(&png_ptr, null);
        return error.PngCreateInfoStructFailed;
    }
    
    // Initialize output
    var write_state = PngWriteState{
        .data = std.ArrayList(u8).init(allocator),
    };
    defer write_state.data.deinit();
    
    // Set up custom write function
    libpng.png_set_write_fn(png_ptr, &write_state, PngWriteState.write, PngWriteState.flush);
    
    // Set image info
    const bit_depth: i32 = 8;
    const color_type: i32 = switch (pixel_fmt) {
        .Gray => libpng.PNG_COLOR_TYPE_GRAY,
        .RGB => libpng.PNG_COLOR_TYPE_RGB,
        .RGBA => libpng.PNG_COLOR_TYPE_RGBA,
        else => {
            libpng.png_destroy_write_struct(&png_ptr, &info_ptr);
            return error.UnsupportedPixelFormat;
        },
    };
    
    libpng.png_set_IHDR(
        png_ptr,
        info_ptr,
        @as(u32, @intCast(width)),
        @as(u32, @intCast(height)),
        bit_depth,
        color_type,
        libpng.PNG_INTERLACE_NONE,
        libpng.PNG_COMPRESSION_TYPE_DEFAULT,
        libpng.PNG_FILTER_TYPE_DEFAULT
    );
    
    libpng.png_write_info(png_ptr, info_ptr);
    
    // Create row pointers
    const bytes_per_pixel = pixel_fmt.getBytesPerPixel();
    const bytes_per_row = width * bytes_per_pixel;
    
    var row_pointers = try allocator.alloc([*]u8, height);
    defer allocator.free(row_pointers);
    
    for (0..height) |y| {
        row_pointers[y] = @as([*]u8, @ptrCast(@constCast(&source[y * bytes_per_row])));
    }
    
    // Write image data
    libpng.png_write_image(png_ptr, row_pointers.ptr);
    
    // Finish writing
    libpng.png_write_end(png_ptr, null);
    
    // Clean up
    libpng.png_destroy_write_struct(&png_ptr, &info_ptr);
    
    // Return the encoded data
    return try write_state.data.toOwnedSlice();
}

// Encode to JPEG
fn encodeJPEG(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    pixel_fmt: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    // Initialize libjpeg
    try libjpeg.init();
    
    // Initialize the JPEG compression structure and error manager
    var cinfo: libjpeg.jpeg_compress_struct = undefined;
    var jerr: libjpeg.jpeg_error_mgr = undefined;
    
    cinfo.err = libjpeg.jpeg_std_error(&jerr);
    libjpeg.jpeg_CreateCompress(&cinfo);
    
    // Set up memory destination
    var jpeg_buffer: [*]u8 = null;
    var jpeg_buffer_size: c_ulong = 0;
    libjpeg.jpeg_mem_dest.?(&cinfo, &jpeg_buffer, &jpeg_buffer_size);
    
    // Configure compression parameters
    cinfo.image_width = @as(c_uint, @intCast(width));
    cinfo.image_height = @as(c_uint, @intCast(height));
    
    // Set colorspace based on pixel format
    switch (pixel_fmt) {
        .Gray => {
            cinfo.input_components = 1;
            cinfo.in_color_space = libjpeg.JCS_GRAYSCALE;
        },
        .RGB, .BGR => {
            cinfo.input_components = 3;
            cinfo.in_color_space = libjpeg.JCS_RGB;
        },
        .RGBA, .BGRA => {
            // JPEG doesn't support alpha, we'll need to convert or strip it
            // For now, just try to encode it and let libjpeg handle it
            cinfo.input_components = 4;
            cinfo.in_color_space = libjpeg.JCS_RGB; // Most libjpeg implementations will just use the RGB part
        },
        else => {
            libjpeg.jpeg_destroy_compress(&cinfo);
            return error.UnsupportedPixelFormat;
        },
    }
    
    // Set defaults and quality
    libjpeg.jpeg_set_defaults(&cinfo);
    libjpeg.jpeg_set_quality(&cinfo, @as(c_int, @intCast(options.quality.quality)), true);
    
    // Start compression
    libjpeg.jpeg_start_compress(&cinfo, true);
    
    // Write scanlines
    const bytes_per_pixel = pixel_fmt.getBytesPerPixel();
    const row_stride = width * bytes_per_pixel;
    
    var row_pointer: [1][*]u8 = undefined;
    while (cinfo.next_scanline < cinfo.image_height) {
        const row_offset = cinfo.next_scanline * row_stride;
        row_pointer[0] = @as([*]u8, @ptrCast(@constCast(&source[row_offset])));
        _ = libjpeg.jpeg_write_scanlines(&cinfo, &row_pointer[0], 1);
    }
    
    // Finish compression
    libjpeg.jpeg_finish_compress(&cinfo);
    
    // Copy the JPEG data to our own buffer
    var result = try allocator.alloc(u8, jpeg_buffer_size);
    @memcpy(result, jpeg_buffer[0..jpeg_buffer_size]);
    
    // Clean up
    libjpeg.jpeg_destroy_compress(&cinfo);
    
    return result;
}

// Encode to WebP
fn encodeWebP(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    pixel_fmt: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    // Initialize libwebp
    try libwebp.init();
    
    // Check if we need to convert to BGRA
    var converted_data: ?[]u8 = null;
    defer if (converted_data) |data| allocator.free(data);
    
    var actual_source = source;
    var actual_format = pixel_fmt;
    
    if (pixel_fmt != .BGRA) {
        // Need to convert to BGRA
        converted_data = try pixel_format.convert(allocator, source, width, height, pixel_fmt, .BGRA);
        actual_source = converted_data.?;
        actual_format = .BGRA;
    }
    
    const stride = width * actual_format.getBytesPerPixel();
    var output: [*]u8 = undefined;
    var output_size: usize = 0;
    
    // Check if lossless is requested (quality 100)
    if (options.quality.quality >= 100) {
        // Use lossless encoding
        output_size = libwebp.WebPEncodeLosslessBGRA(
            actual_source.ptr,
            @as(c_int, @intCast(width)),
            @as(c_int, @intCast(height)),
            @as(c_int, @intCast(stride)),
            &output
        );
    } else {
        // Use lossy encoding with specified quality
        const quality = @as(f32, @floatFromInt(options.quality.quality)) * 0.01;
        output_size = libwebp.WebPEncodeBGRA(
            actual_source.ptr,
            @as(c_int, @intCast(width)),
            @as(c_int, @intCast(height)),
            @as(c_int, @intCast(stride)),
            quality,
            &output
        );
    }
    
    if (output_size == 0) {
        return error.WebPEncodingFailed;
    }
    
    // Copy to our own buffer
    var result = try allocator.alloc(u8, output_size);
    @memcpy(result, output[0..output_size]);
    
    // Free WebP's output buffer
    if (libwebp.WebPFree) |free_fn| {
        free_fn(output);
    }
    
    return result;
}

/// Linux implementation using dynamically loaded libraries
pub fn encode(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    return switch (options.format) {
        .PNG => try encodePNG(allocator, source, width, height, format, options),
        .JPEG => try encodeJPEG(allocator, source, width, height, format, options),
        .WEBP => try encodeWebP(allocator, source, width, height, format, options),
        .AVIF => error.NotImplemented, // AVIF not yet implemented
    };
}

/// Transcode directly between image formats 
/// For Linux, this is not directly implemented yet - we need to implement a 
/// decode function first to complete this functionality
pub fn transcode(
    allocator: std.mem.Allocator,
    source_data: []const u8,
    source_format: ImageFormat,
    target_format: ImageFormat,
    options: EncodingOptions,
) ![]u8 {
    // For Linux, we currently need to decode and re-encode
    // since we don't have direct transcoding capabilities.
    // This is a placeholder that will be improved in the future.
    _ = source_format;
    _ = target_format;
    _ = options;
    _ = source_data;
    _ = allocator;
    
    return error.NotImplemented;
}