const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const EncodingOptions = @import("encoder.zig").EncodingOptions;
const ImageFormat = @import("encoder.zig").ImageFormat;

// Import the required macOS frameworks for type definitions only
const c = @cImport({
    @cInclude("CoreFoundation/CoreFoundation.h");
    @cInclude("CoreGraphics/CoreGraphics.h");
    @cInclude("ImageIO/ImageIO.h");
    @cInclude("dlfcn.h");
});

// Function pointer types for dynamically loaded functions
const CoreFrameworkFunctions = struct {
    // CoreFoundation functions
    CFStringCreateWithBytes: *const @TypeOf(c.CFStringCreateWithBytes),
    CFRelease: *const @TypeOf(c.CFRelease),
    CFDataCreateMutable: *const @TypeOf(c.CFDataCreateMutable),
    CFDataGetLength: *const @TypeOf(c.CFDataGetLength),
    CFDataGetBytePtr: *const @TypeOf(c.CFDataGetBytePtr),
    CFDictionaryCreateMutable: *const @TypeOf(c.CFDictionaryCreateMutable),
    CFDictionarySetValue: *const @TypeOf(c.CFDictionarySetValue),
    CFNumberCreate: *const @TypeOf(c.CFNumberCreate),

    // CoreGraphics functions
    CGDataProviderCreateWithData: *const @TypeOf(c.CGDataProviderCreateWithData),
    CGDataProviderRelease: *const @TypeOf(c.CGDataProviderRelease),
    CGImageSourceCreateWithDataProvider: *const @TypeOf(c.CGImageSourceCreateWithDataProvider),
    CGImageSourceCreateImageAtIndex: *const @TypeOf(c.CGImageSourceCreateImageAtIndex),
    CGImageRelease: *const @TypeOf(c.CGImageRelease),
    CGImageDestinationCreateWithData: *const @TypeOf(c.CGImageDestinationCreateWithData),
    CGImageDestinationAddImage: *const @TypeOf(c.CGImageDestinationAddImage),
    CGImageDestinationFinalize: *const @TypeOf(c.CGImageDestinationFinalize),
    CGColorSpaceCreateDeviceRGB: *const @TypeOf(c.CGColorSpaceCreateDeviceRGB),
    CGColorSpaceCreateDeviceGray: *const @TypeOf(c.CGColorSpaceCreateDeviceGray),
    CGColorSpaceRelease: *const @TypeOf(c.CGColorSpaceRelease),
    CGImageCreate: *const @TypeOf(c.CGImageCreate),

    kCFTypeDictionaryKeyCallBacks: *const @TypeOf(c.kCFTypeDictionaryKeyCallBacks),
    kCFTypeDictionaryValueCallBacks: *const @TypeOf(c.kCFTypeDictionaryValueCallBacks),
    kCGImageDestinationLossyCompressionQuality: *const anyopaque,
};

// Global instance of function pointers
var cf: CoreFrameworkFunctions = undefined;

// Framework handles
var core_foundation_handle: ?*anyopaque = null;
var core_graphics_handle: ?*anyopaque = null;
var image_io_handle: ?*anyopaque = null;
var failed_to_init_frameworks = false;

// Function to load a symbol from a library
fn loadSymbol(handle: ?*anyopaque, name: [*:0]const u8) ?*anyopaque {
    const symbol = c.dlsym(handle, name);
    if (symbol == null) {
        std.debug.print("Failed to load symbol: {s}\n", .{name});
    }
    return symbol;
}

// Function to initialize the dynamic libraries and load all required symbols
fn _initFrameworks() void {

    // Load frameworks
    core_foundation_handle = c.dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", c.RTLD_LAZY);
    if (core_foundation_handle == null) @panic("Failed to load CoreFoundation");

    core_graphics_handle = c.dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", c.RTLD_LAZY);
    if (core_graphics_handle == null) @panic("Failed to load CoreGraphics");

    image_io_handle = c.dlopen("/System/Library/Frameworks/ImageIO.framework/ImageIO", c.RTLD_LAZY);
    if (image_io_handle == null) @panic("Failed to load ImageIO");

    // Initialize function pointers
    cf.CFStringCreateWithBytes = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFStringCreateWithBytes").?));
    cf.CFRelease = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFRelease").?));
    cf.CFDataCreateMutable = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFDataCreateMutable").?));
    cf.CFDataGetLength = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFDataGetLength").?));
    cf.CFDataGetBytePtr = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFDataGetBytePtr").?));
    cf.CFDictionaryCreateMutable = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFDictionaryCreateMutable").?));
    cf.CFDictionarySetValue = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFDictionarySetValue").?));
    cf.CFNumberCreate = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "CFNumberCreate").?));
    cf.CGDataProviderCreateWithData = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGDataProviderCreateWithData").?));
    cf.CGDataProviderRelease = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGDataProviderRelease").?));
    cf.CGImageSourceCreateWithDataProvider = @alignCast(@ptrCast(loadSymbol(image_io_handle, "CGImageSourceCreateWithDataProvider").?));
    cf.CGImageSourceCreateImageAtIndex = @alignCast(@ptrCast(loadSymbol(image_io_handle, "CGImageSourceCreateImageAtIndex").?));
    cf.CGImageRelease = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGImageRelease").?));
    cf.CGImageDestinationCreateWithData = @alignCast(@ptrCast(loadSymbol(image_io_handle, "CGImageDestinationCreateWithData").?));
    cf.CGImageDestinationAddImage = @alignCast(@ptrCast(loadSymbol(image_io_handle, "CGImageDestinationAddImage").?));
    cf.CGImageDestinationFinalize = @alignCast(@ptrCast(loadSymbol(image_io_handle, "CGImageDestinationFinalize").?));
    cf.CGColorSpaceCreateDeviceRGB = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGColorSpaceCreateDeviceRGB").?));
    cf.CGColorSpaceCreateDeviceGray = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGColorSpaceCreateDeviceGray").?));
    cf.CGColorSpaceRelease = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGColorSpaceRelease").?));
    cf.CGImageCreate = @alignCast(@ptrCast(loadSymbol(core_graphics_handle, "CGImageCreate").?));
    cf.kCFTypeDictionaryKeyCallBacks = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "kCFTypeDictionaryKeyCallBacks").?));
    cf.kCFTypeDictionaryValueCallBacks = @alignCast(@ptrCast(loadSymbol(core_foundation_handle, "kCFTypeDictionaryValueCallBacks").?));
    const kCGImageDestinationLossyCompressionQuality: *const *const anyopaque = @alignCast(@ptrCast(loadSymbol(image_io_handle, "kCGImageDestinationLossyCompressionQuality").?));
    cf.kCGImageDestinationLossyCompressionQuality = kCGImageDestinationLossyCompressionQuality.*;
}

var init_frameworks_once = std.once(_initFrameworks);
fn initFrameworks() void {
    init_frameworks_once.call();
}

/// Helper to create a CoreFoundation string
fn CFSTR(str: []const u8) c.CFStringRef {
    return cf.CFStringCreateWithBytes(
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
        .TIFF => CFSTR("public.tiff"), // TIFF type
        .HEIC => CFSTR("public.heic"), // HEIC type
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
    // Initialize the frameworks if not already loaded
    initFrameworks();

    // Create a data provider from our input buffer
    const data_provider = cf.CGDataProviderCreateWithData(
        null, // Info parameter (unused)
        source_data.ptr,
        source_data.len,
        null, // Release callback (we manage the memory ourselves)
    );
    defer cf.CGDataProviderRelease(data_provider);

    // Create an image source from the data provider
    const source_type_id = getUTIForFormat(source_format);
    if (source_type_id == null) return error.CFStringCreationFailed;
    defer cf.CFRelease(source_type_id);

    const image_source = cf.CGImageSourceCreateWithDataProvider(data_provider, null);
    if (image_source == null) {
        return error.InvalidSourceImage;
    }
    defer cf.CFRelease(image_source);

    // Get the image from the source
    const cg_image = cf.CGImageSourceCreateImageAtIndex(image_source, 0, null);
    if (cg_image == null) {
        return error.ImageCreationFailed;
    }
    defer cf.CGImageRelease(cg_image);

    // Create a mutable data object to hold the output
    const data = cf.CFDataCreateMutable(null, 0);
    if (data == null) {
        return error.MemoryAllocationFailed;
    }
    defer cf.CFRelease(data);

    // Create a CGImageDestination for the requested format
    const type_id = getUTIForFormat(target_format);
    if (type_id == null) return error.CFStringCreationFailed;
    defer cf.CFRelease(type_id);

    const destination = cf.CGImageDestinationCreateWithData(
        data,
        type_id,
        1, // Number of images (just one)
        null, // Options (none)
    );
    if (destination == null) {
        return error.DestinationCreationFailed;
    }
    defer cf.CFRelease(destination);

    // Create properties dictionary with quality setting
    const properties = cf.CFDictionaryCreateMutable(
        null,
        0,
        cf.kCFTypeDictionaryKeyCallBacks,
        cf.kCFTypeDictionaryValueCallBacks,
    );
    defer cf.CFRelease(properties);

    // Set compression quality
    const quality_value = @as(f32, @floatFromInt(options.quality.quality)) / 100.0;
    const quality_number = cf.CFNumberCreate(null, c.kCFNumberFloat32Type, &quality_value);
    defer cf.CFRelease(quality_number);
    cf.CFDictionarySetValue(properties, cf.kCGImageDestinationLossyCompressionQuality, quality_number);

    // Add the image with properties
    cf.CGImageDestinationAddImage(destination, cg_image, properties);

    // Finalize the destination
    if (!cf.CGImageDestinationFinalize(destination)) {
        return error.EncodingFailed;
    }

    // Get the encoded data
    const cf_data_len = cf.CFDataGetLength(data);
    const cf_data_ptr = cf.CFDataGetBytePtr(data);

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
    // Initialize the frameworks if not already loaded
    initFrameworks();

    // Early return if dimensions are invalid
    if (width == 0 or height == 0) {
        return error.InvalidDimensions;
    }

    // Calculate bytes per pixel and row bytes
    const bytes_per_pixel = format.getBytesPerPixel();
    const bytes_per_row = width * bytes_per_pixel;

    // Create the color space
    const color_space = switch (format.getColorChannels()) {
        1 => cf.CGColorSpaceCreateDeviceGray(),
        3 => cf.CGColorSpaceCreateDeviceRGB(),
        else => return error.UnsupportedColorSpace,
    };
    defer cf.CGColorSpaceRelease(color_space);

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
    const data_provider = cf.CGDataProviderCreateWithData(
        null, // Info parameter (unused)
        source.ptr,
        source.len,
        null, // Release callback (we manage the memory ourselves)
    );
    defer cf.CGDataProviderRelease(data_provider);

    // Create the CGImage
    const cg_image = cf.CGImageCreate(
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
    defer cf.CGImageRelease(cg_image);

    // Create a CFMutableData to hold the output
    const data = cf.CFDataCreateMutable(null, 0);
    if (data == null) {
        return error.MemoryAllocationFailed;
    }
    defer cf.CFRelease(data);

    // Create a CGImageDestination for the requested format
    const type_id = getUTIForFormat(options.format);
    if (type_id == null) return error.CFStringCreationFailed;
    defer cf.CFRelease(type_id);

    const destination = cf.CGImageDestinationCreateWithData(
        data,
        type_id,
        1, // Number of images (just one)
        null, // Options (none)
    );
    if (destination == null) {
        return error.DestinationCreationFailed;
    }
    defer cf.CFRelease(destination);

    // Create properties dictionary with quality setting
    const properties = cf.CFDictionaryCreateMutable(
        null,
        0,
        cf.kCFTypeDictionaryKeyCallBacks,
        cf.kCFTypeDictionaryValueCallBacks,
    );
    defer cf.CFRelease(properties);

    // Set compression quality
    const quality_value = @as(f32, @floatFromInt(options.quality.quality)) / 100.0;
    const quality_number = cf.CFNumberCreate(null, c.kCFNumberFloat32Type, &quality_value);
    defer cf.CFRelease(quality_number);
    cf.CFDictionarySetValue(properties, cf.kCGImageDestinationLossyCompressionQuality, quality_number);

    // Add the image with properties
    cf.CGImageDestinationAddImage(destination, cg_image, properties);

    // Finalize the destination
    if (!cf.CGImageDestinationFinalize(destination)) {
        return error.EncodingFailed;
    }

    // Get the encoded data
    const cf_data_len = cf.CFDataGetLength(data);
    const cf_data_ptr = cf.CFDataGetBytePtr(data);

    // Copy to a Zig-managed buffer
    const output = try allocator.alloc(u8, @as(usize, @intCast(cf_data_len)));
    @memcpy(output, cf_data_ptr[0..@as(usize, @intCast(cf_data_len))]);

    return output;
}
