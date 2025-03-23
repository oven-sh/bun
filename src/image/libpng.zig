const std = @import("std");

/// Library name and path
pub const library_name = "libpng.so";

/// PNG types and callbacks
pub const png_structp = ?*anyopaque;
pub const png_infop = ?*anyopaque;
pub const png_const_bytep = [*]const u8;
pub const png_bytep = [*]u8;
pub const png_bytepp = [*][*]u8;

// PNG constants
pub const PNG_COLOR_TYPE_GRAY = 0;
pub const PNG_COLOR_TYPE_PALETTE = 3;
pub const PNG_COLOR_TYPE_RGB = 2;
pub const PNG_COLOR_TYPE_RGB_ALPHA = 6;
pub const PNG_COLOR_TYPE_GRAY_ALPHA = 4;
pub const PNG_COLOR_TYPE_RGBA = PNG_COLOR_TYPE_RGB_ALPHA;
pub const PNG_COLOR_TYPE_GA = PNG_COLOR_TYPE_GRAY_ALPHA;

pub const PNG_INTERLACE_NONE = 0;
pub const PNG_COMPRESSION_TYPE_DEFAULT = 0;
pub const PNG_FILTER_TYPE_DEFAULT = 0;

pub const PNG_TRANSFORM_IDENTITY = 0;
pub const PNG_TRANSFORM_STRIP_16 = 1;
pub const PNG_TRANSFORM_STRIP_ALPHA = 2;
pub const PNG_TRANSFORM_PACKING = 4;
pub const PNG_TRANSFORM_PACKSWAP = 8;
pub const PNG_TRANSFORM_EXPAND = 16;
pub const PNG_TRANSFORM_INVERT_MONO = 32;
pub const PNG_TRANSFORM_SHIFT = 64;
pub const PNG_TRANSFORM_BGR = 128;
pub const PNG_TRANSFORM_SWAP_ALPHA = 256;
pub const PNG_TRANSFORM_SWAP_ENDIAN = 512;
pub const PNG_TRANSFORM_INVERT_ALPHA = 1024;
pub const PNG_TRANSFORM_STRIP_FILLER = 2048;

// Function pointer types for PNG
pub const PngCreateWriteStructFn = fn ([*:0]const u8, ?*anyopaque, ?*anyopaque, ?*anyopaque) callconv(.C) png_structp;
pub const PngCreateInfoStructFn = fn (png_structp) callconv(.C) png_infop;
pub const PngSetWriteFnFn = fn (png_structp, ?*anyopaque, ?*const fn (png_structp, png_bytep, usize) callconv(.C) void, ?*const fn (png_structp) callconv(.C) void) callconv(.C) void;
pub const PngInitIoFn = fn (png_structp, ?*anyopaque) callconv(.C) void;
pub const PngSetIHDRFn = fn (png_structp, png_infop, u32, u32, i32, i32, i32, i32, i32) callconv(.C) void;
pub const PngWriteInfoFn = fn (png_structp, png_infop) callconv(.C) void;
pub const PngWriteImageFn = fn (png_structp, png_bytepp) callconv(.C) void;
pub const PngWriteEndFn = fn (png_structp, png_infop) callconv(.C) void;
pub const PngDestroyWriteStructFn = fn ([*]png_structp, [*]png_infop) callconv(.C) void;
pub const PngGetIoPtr = fn (png_structp) callconv(.C) ?*anyopaque;

/// Function pointers - will be initialized by init()
pub var png_create_write_struct: PngCreateWriteStructFn = undefined;
pub var png_create_info_struct: PngCreateInfoStructFn = undefined;
pub var png_set_write_fn: PngSetWriteFnFn = undefined;
pub var png_init_io: PngInitIoFn = undefined;
pub var png_set_IHDR: PngSetIHDRFn = undefined;
pub var png_write_info: PngWriteInfoFn = undefined;
pub var png_write_image: PngWriteImageFn = undefined;
pub var png_write_end: PngWriteEndFn = undefined;
pub var png_destroy_write_struct: PngDestroyWriteStructFn = undefined;
pub var png_get_io_ptr: PngGetIoPtr = undefined;

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
    if (loadSymbol(PngCreateWriteStructFn, "png_create_write_struct")) |fn_ptr| {
        png_create_write_struct = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngCreateInfoStructFn, "png_create_info_struct")) |fn_ptr| {
        png_create_info_struct = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngSetWriteFnFn, "png_set_write_fn")) |fn_ptr| {
        png_set_write_fn = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngInitIoFn, "png_init_io")) |fn_ptr| {
        png_init_io = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngSetIHDRFn, "png_set_IHDR")) |fn_ptr| {
        png_set_IHDR = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngWriteInfoFn, "png_write_info")) |fn_ptr| {
        png_write_info = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngWriteImageFn, "png_write_image")) |fn_ptr| {
        png_write_image = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngWriteEndFn, "png_write_end")) |fn_ptr| {
        png_write_end = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngDestroyWriteStructFn, "png_destroy_write_struct")) |fn_ptr| {
        png_destroy_write_struct = fn_ptr;
    } else {
        closeLib();
        return;
    }

    if (loadSymbol(PngGetIoPtr, "png_get_io_ptr")) |fn_ptr| {
        png_get_io_ptr = fn_ptr;
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
        return @ptrCast(T, symbol);
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

/// Deinitialize and free resources
pub fn deinit() void {
    closeLib();
}
