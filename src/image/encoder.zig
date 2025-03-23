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

    /// Get the file extension for this format
    pub fn fileExtension(self: ImageFormat) []const u8 {
        return switch (self) {
            .JPEG => ".jpg",
            .PNG => ".png",
            .WEBP => ".webp",
            .AVIF => ".avif",
        };
    }

    /// Get the MIME type for this format
    pub fn mimeType(self: ImageFormat) []const u8 {
        return switch (self) {
            .JPEG => "image/jpeg",
            .PNG => "image/png",
            .WEBP => "image/webp",
            .AVIF => "image/avif",
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