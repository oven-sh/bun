const std = @import("std");

/// Library name and path
pub const library_name = "libjpeg.so";

/// JPEG types and callbacks
pub const jpeg_compress_struct = extern struct {
    err: ?*jpeg_error_mgr,
    mem: ?*anyopaque,
    progress: ?*anyopaque,
    client_data: ?*anyopaque,
    is_decompressor: bool,
    // Note: we access the remaining fields through function calls
    // instead of directly defining them all here
    // Fields like next_scanline, image_width, etc. are accessed via pointers
    next_scanline: c_uint = 0,  // Allow simple access to this common field
    image_width: c_uint = 0,    // Allow simple access to this common field
    image_height: c_uint = 0,   // Allow simple access to this common field
    input_components: c_int = 0, // Allow simple access to this common field
    in_color_space: c_int = 0,   // Allow simple access to this common field
};

pub const jpeg_error_mgr = extern struct {
    error_exit: ?*const fn(?*jpeg_error_mgr) callconv(.C) void,
    emit_message: ?*const fn(?*jpeg_error_mgr, c_int) callconv(.C) void,
    output_message: ?*const fn(?*jpeg_error_mgr) callconv(.C) void,
    format_message: ?*const fn(?*jpeg_error_mgr, [*]u8) callconv(.C) void,
    reset_error_mgr: ?*const fn(?*jpeg_error_mgr) callconv(.C) void,
    msg_code: c_int,
    msg_parm: extern union {
        i: [8]c_int,
        s: [80]u8,
    },
    trace_level: c_int,
    num_warnings: c_long,
    jpeg_message_table: [*][*]u8,
    last_jpeg_message: c_int,
    addon_message_table: [*][*]u8,
    first_addon_message: c_int,
    last_addon_message: c_int,
};

// JPEG constants
pub const JCS_UNKNOWN = 0;
pub const JCS_GRAYSCALE = 1;
pub const JCS_RGB = 2;
pub const JCS_YCbCr = 3;
pub const JCS_CMYK = 4;
pub const JCS_YCCK = 5;
pub const JCS_EXT_RGB = 6;
pub const JCS_EXT_RGBX = 7;
pub const JCS_EXT_BGR = 8;
pub const JCS_EXT_BGRX = 9;
pub const JCS_EXT_XBGR = 10;
pub const JCS_EXT_XRGB = 11;
pub const JCS_EXT_RGBA = 12;
pub const JCS_EXT_BGRA = 13;
pub const JCS_EXT_ABGR = 14;
pub const JCS_EXT_ARGB = 15;
pub const JCS_RGB565 = 16;

/// JPEG function pointer types
pub const JpegStdErrorFn = fn ([*]jpeg_error_mgr) callconv(.C) [*]jpeg_error_mgr;
pub const JpegCreateCompressFn = fn ([*]jpeg_compress_struct) callconv(.C) void;
pub const JpegStdioDestFn = fn ([*]jpeg_compress_struct, ?*anyopaque) callconv(.C) void;
pub const JpegMemDestFn = fn ([*]jpeg_compress_struct, [*][*]u8, [*]c_ulong) callconv(.C) void;
pub const JpegSetDefaultsFn = fn ([*]jpeg_compress_struct) callconv(.C) void;
pub const JpegSetQualityFn = fn ([*]jpeg_compress_struct, c_int, bool) callconv(.C) void;
pub const JpegStartCompressFn = fn ([*]jpeg_compress_struct, bool) callconv(.C) void;
pub const JpegWriteScanlinesFn = fn ([*]jpeg_compress_struct, [*][*]u8, c_uint) callconv(.C) c_uint;
pub const JpegFinishCompressFn = fn ([*]jpeg_compress_struct) callconv(.C) void;
pub const JpegDestroyCompressFn = fn ([*]jpeg_compress_struct) callconv(.C) void;

/// Function pointers - will be initialized by init()
pub var jpeg_std_error: JpegStdErrorFn = undefined;
pub var jpeg_CreateCompress: JpegCreateCompressFn = undefined;
pub var jpeg_stdio_dest: JpegStdioDestFn = undefined;
pub var jpeg_mem_dest: ?JpegMemDestFn = null; // Optional, not all implementations have this
pub var jpeg_set_defaults: JpegSetDefaultsFn = undefined;
pub var jpeg_set_quality: JpegSetQualityFn = undefined;
pub var jpeg_start_compress: JpegStartCompressFn = undefined;
pub var jpeg_write_scanlines: JpegWriteScanlinesFn = undefined;
pub var jpeg_finish_compress: JpegFinishCompressFn = undefined;
pub var jpeg_destroy_compress: JpegDestroyCompressFn = undefined;

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

    // Load all required function pointers
    if (loadSymbol(JpegStdErrorFn, "jpeg_std_error")) |fn_ptr| {
        jpeg_std_error = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegCreateCompressFn, "jpeg_CreateCompress")) |fn_ptr| {
        jpeg_CreateCompress = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegStdioDestFn, "jpeg_stdio_dest")) |fn_ptr| {
        jpeg_stdio_dest = fn_ptr;
    } else {
        closeLib();
        return;
    }

    // mem_dest is optional, so we don't fail if it's missing
    jpeg_mem_dest = loadSymbol(JpegMemDestFn, "jpeg_mem_dest");

    if (loadSymbol(JpegSetDefaultsFn, "jpeg_set_defaults")) |fn_ptr| {
        jpeg_set_defaults = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegSetQualityFn, "jpeg_set_quality")) |fn_ptr| {
        jpeg_set_quality = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegStartCompressFn, "jpeg_start_compress")) |fn_ptr| {
        jpeg_start_compress = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegWriteScanlinesFn, "jpeg_write_scanlines")) |fn_ptr| {
        jpeg_write_scanlines = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegFinishCompressFn, "jpeg_finish_compress")) |fn_ptr| {
        jpeg_finish_compress = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(JpegDestroyCompressFn, "jpeg_destroy_compress")) |fn_ptr| {
        jpeg_destroy_compress = fn_ptr;
    } else {
        closeLib();
        return;
    }

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
    
    // Check for required mem_dest function
    if (jpeg_mem_dest == null) {
        return error.JpegMemoryDestinationNotSupported;
    }
}

/// Check if the library is initialized
pub fn isInitialized() bool {
    return is_initialized;
}

/// Deinitialize and free resources
pub fn deinit() void {
    closeLib();
}