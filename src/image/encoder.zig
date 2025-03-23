const std = @import("std");
const builtin = @import("builtin");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;

// Define platform-specific constants
const is_darwin = builtin.os.tag == .macos or builtin.os.tag == .ios;
const is_windows = builtin.os.tag == .windows;
const is_linux = builtin.os.tag == .linux;

/// Supported image formats for encoding
pub const ImageFormat = enum {
    JPEG,
    PNG,
    WEBP,
    AVIF,
    TIFF,
    HEIC,

    /// Get the file extension for this format
    pub fn fileExtension(self: ImageFormat) []const u8 {
        return switch (self) {
            .JPEG => ".jpg",
            .PNG => ".png",
            .WEBP => ".webp",
            .AVIF => ".avif",
            .TIFF => ".tiff",
            .HEIC => ".heic",
        };
    }

    /// Get the MIME type for this format
    pub fn mimeType(self: ImageFormat) []const u8 {
        return switch (self) {
            .JPEG => "image/jpeg",
            .PNG => "image/png",
            .WEBP => "image/webp",
            .AVIF => "image/avif",
            .TIFF => "image/tiff",
            .HEIC => "image/heic",
        };
    }
};

/// Quality options for encoding
pub const EncodingQuality = struct {
    /// Value between 0-100 representing the quality
    quality: u8 = 80,

    /// Create a low quality preset (good for thumbnails)
    pub fn low() EncodingQuality {
        return .{ .quality = 60 };
    }

    /// Create a medium quality preset (default)
    pub fn medium() EncodingQuality {
        return .{ .quality = 80 };
    }

    /// Create a high quality preset
    pub fn high() EncodingQuality {
        return .{ .quality = 90 };
    }

    /// Create a maximum quality preset (larger file size)
    pub fn maximum() EncodingQuality {
        return .{ .quality = 100 };
    }
};

/// Common options for all encoders
pub const EncodingOptions = struct {
    /// Output format
    format: ImageFormat,
    
    /// Quality settings
    quality: EncodingQuality = .{},
    
    /// Whether to optimize the output for size
    optimize: bool = true,
    
    /// Whether to preserve metadata from the input
    preserve_metadata: bool = false,
};

// --- Platform-specific encoder implementations ---

// Forward-declare the platform-specific implementations
// These will be imported conditionally

// macOS implementation
const encoder_darwin = if (is_darwin) @import("encoder_darwin.zig") else struct {
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

    pub fn transcode(
        allocator: std.mem.Allocator,
        source_data: []const u8,
        source_format: ImageFormat,
        target_format: ImageFormat,
        options: EncodingOptions,
    ) ![]u8 {
        _ = allocator;
        _ = source_data;
        _ = source_format;
        _ = target_format;
        _ = options;
        return error.NotImplemented;
    }
};

// Windows implementation
const encoder_windows = if (is_windows) @import("encoder_windows.zig") else struct {
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
    
    pub fn transcode(
        allocator: std.mem.Allocator,
        source_data: []const u8,
        source_format: ImageFormat,
        target_format: ImageFormat,
        options: EncodingOptions,
    ) ![]u8 {
        _ = allocator;
        _ = source_data;
        _ = source_format;
        _ = target_format;
        _ = options;
        return error.NotImplemented;
    }
};

// Linux implementation
const encoder_linux = if (is_linux) @import("encoder_linux.zig") else struct {
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
    
    pub fn transcode(
        allocator: std.mem.Allocator,
        source_data: []const u8,
        source_format: ImageFormat,
        target_format: ImageFormat,
        options: EncodingOptions,
    ) ![]u8 {
        _ = allocator;
        _ = source_data;
        _ = source_format;
        _ = target_format;
        _ = options;
        return error.NotImplemented;
    }
};

// --- Encoder API ---

/// Encode image data to the specified format using the appropriate platform-specific encoder
pub fn encode(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    src_format: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    if (comptime is_darwin) {
        return try encoder_darwin.encode(allocator, source, width, height, src_format, options);
    } else if (comptime is_windows) {
        return try encoder_windows.encode(allocator, source, width, height, src_format, options);
    } else if (comptime is_linux) {
        return try encoder_linux.encode(allocator, source, width, height, src_format, options);
    } else {
        @compileError("Unsupported platform");
    }
}

// Simple JPEG encoding with default options
pub fn encodeJPEG(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    src_format: PixelFormat,
    quality: u8,
) ![]u8 {
    const options = EncodingOptions{
        .format = .JPEG,
        .quality = .{ .quality = quality },
    };
    
    return try encode(allocator, source, width, height, src_format, options);
}

// Simple PNG encoding with default options
pub fn encodePNG(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    src_format: PixelFormat,
) ![]u8 {
    const options = EncodingOptions{
        .format = .PNG,
    };
    
    return try encode(allocator, source, width, height, src_format, options);
}

// Simple TIFF encoding with default options
pub fn encodeTIFF(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    src_format: PixelFormat,
) ![]u8 {
    const options = EncodingOptions{
        .format = .TIFF,
    };
    
    return try encode(allocator, source, width, height, src_format, options);
}

// HEIC encoding with quality setting
pub fn encodeHEIC(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    src_format: PixelFormat,
    quality: u8,
) ![]u8 {
    const options = EncodingOptions{
        .format = .HEIC,
        .quality = .{ .quality = quality },
    };
    
    return try encode(allocator, source, width, height, src_format, options);
}

/// Transcode image data directly from one format to another without decoding to raw pixels
/// This is more efficient than decoding and re-encoding when converting between file formats
pub fn transcode(
    allocator: std.mem.Allocator,
    source_data: []const u8,
    source_format: ImageFormat,
    target_format: ImageFormat,
    options: EncodingOptions,
) ![]u8 {
    // Create options with the target format
    var target_options = options;
    target_options.format = target_format;

    if (comptime is_darwin) {
        return try encoder_darwin.transcode(allocator, source_data, source_format, target_format, target_options);
    } else if (comptime is_windows) {
        return try encoder_windows.transcode(allocator, source_data, source_format, target_format, target_options);
    } else if (comptime is_linux) {
        return try encoder_linux.transcode(allocator, source_data, source_format, target_format, target_options);
    } else {
        @compileError("Unsupported platform");
    }
}

/// Transcode an image file from PNG to JPEG with specified quality
pub fn transcodeToJPEG(
    allocator: std.mem.Allocator,
    png_data: []const u8,
    quality: u8,
) ![]u8 {
    const options = EncodingOptions{
        .format = .JPEG,
        .quality = .{ .quality = quality },
    };
    
    return try transcode(allocator, png_data, .PNG, .JPEG, options);
}

/// Transcode an image file from JPEG to PNG
pub fn transcodeToPNG(
    allocator: std.mem.Allocator,
    jpeg_data: []const u8,
) ![]u8 {
    const options = EncodingOptions{
        .format = .PNG,
    };
    
    return try transcode(allocator, jpeg_data, .JPEG, .PNG, options);
}

/// Transcode an image file to TIFF
pub fn transcodeToTIFF(
    allocator: std.mem.Allocator,
    source_data: []const u8,
    source_format: ImageFormat,
) ![]u8 {
    const options = EncodingOptions{
        .format = .TIFF,
    };
    
    return try transcode(allocator, source_data, source_format, .TIFF, options);
}

/// Transcode an image file to HEIC with specified quality
pub fn transcodeToHEIC(
    allocator: std.mem.Allocator,
    source_data: []const u8,
    source_format: ImageFormat,
    quality: u8,
) ![]u8 {
    const options = EncodingOptions{
        .format = .HEIC,
        .quality = .{ .quality = quality },
    };
    
    return try transcode(allocator, source_data, source_format, .HEIC, options);
}