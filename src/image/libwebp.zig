const std = @import("std");

/// Library name and path
pub const library_name = "libwebp.so";

/// WebP function pointer types
pub const WebPEncodeBGRAFn = fn([*]const u8, c_int, c_int, c_int, f32, [*][*]u8) callconv(.C) usize;
pub const WebPEncodeLosslessBGRAFn = fn([*]const u8, c_int, c_int, c_int, [*][*]u8) callconv(.C) usize;
pub const WebPEncodeRGBAFn = fn([*]const u8, c_int, c_int, c_int, f32, [*][*]u8) callconv(.C) usize;
pub const WebPEncodeLosslessRGBAFn = fn([*]const u8, c_int, c_int, c_int, [*][*]u8) callconv(.C) usize;
pub const WebPEncodeRGBFn = fn([*]const u8, c_int, c_int, c_int, f32, [*][*]u8) callconv(.C) usize;
pub const WebPEncodeLosslessRGBFn = fn([*]const u8, c_int, c_int, c_int, [*][*]u8) callconv(.C) usize;
pub const WebPGetEncoderVersionFn = fn() callconv(.C) c_int;
pub const WebPFreeFn = fn(?*anyopaque) callconv(.C) void;

/// Function pointers - will be initialized by init()
pub var WebPEncodeBGRA: WebPEncodeBGRAFn = undefined;
pub var WebPEncodeLosslessBGRA: WebPEncodeLosslessBGRAFn = undefined;
pub var WebPEncodeRGBA: ?WebPEncodeRGBAFn = null;  // Optional, may not be in all versions
pub var WebPEncodeLosslessRGBA: ?WebPEncodeLosslessRGBAFn = null;  // Optional
pub var WebPEncodeRGB: ?WebPEncodeRGBFn = null;  // Optional
pub var WebPEncodeLosslessRGB: ?WebPEncodeLosslessRGBFn = null;  // Optional
pub var WebPGetEncoderVersion: WebPGetEncoderVersionFn = undefined;
pub var WebPFree: ?WebPFreeFn = null;  // Optional, older versions may not have this

/// Library handle
var lib_handle: ?*anyopaque = null;
var init_guard = std.once(initialize);
var is_initialized = false;

/// Initialize the library - called once via std.once
fn initialize() void {
    lib_handle = std.c.dlopen(library_name, std.c.RTLD_NOW);
    if (lib_handle == null) {
        // Library not available, leave is_initialized as false
        return;
    }

    // Load required function pointers (core functions that must be present)
    if (loadSymbol(WebPEncodeBGRAFn, "WebPEncodeBGRA")) |fn_ptr| {
        WebPEncodeBGRA = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(WebPEncodeLosslessBGRAFn, "WebPEncodeLosslessBGRA")) |fn_ptr| {
        WebPEncodeLosslessBGRA = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(WebPGetEncoderVersionFn, "WebPGetEncoderVersion")) |fn_ptr| {
        WebPGetEncoderVersion = fn_ptr;
    } else {
        closeLib();
        return;
    }

    // Load optional function pointers (don't fail if these aren't present)
    WebPEncodeRGBA = loadSymbol(WebPEncodeRGBAFn, "WebPEncodeRGBA");
    WebPEncodeLosslessRGBA = loadSymbol(WebPEncodeLosslessRGBAFn, "WebPEncodeLosslessRGBA");
    WebPEncodeRGB = loadSymbol(WebPEncodeRGBFn, "WebPEncodeRGB");
    WebPEncodeLosslessRGB = loadSymbol(WebPEncodeLosslessRGBFn, "WebPEncodeLosslessRGB");
    WebPFree = loadSymbol(WebPFreeFn, "WebPFree");

    // All required functions loaded successfully
    is_initialized = true;
}

/// Helper to load a symbol from the library
fn loadSymbol(comptime T: type, name: [:0]const u8) ?T {
    if (lib_handle) |handle| {
        const symbol = std.c.dlsym(handle, name.ptr);
        if (symbol == null) return null;
        return @as(T, @ptrCast(symbol));
    }
    return null;
}

/// Close the library handle
fn closeLib() void {
    if (lib_handle) |handle| {
        _ = std.c.dlclose(handle);
        lib_handle = null;
    }
    is_initialized = false;
}

/// Initialize the library if not already initialized
pub fn init() !void {
    // Call once-guard to ensure initialization happens only once
    init_guard.call();
    
    // Check if initialization was successful
    if (!is_initialized) {
        return error.LibraryNotFound;
    }
}

/// Check if the library is initialized
pub fn isInitialized() bool {
    return is_initialized;
}

/// Get WebP encoder version
pub fn getEncoderVersion() !c_int {
    if (!is_initialized) return error.LibraryNotInitialized;
    return WebPGetEncoderVersion();
}

/// Deinitialize and free resources
pub fn deinit() void {
    closeLib();
}