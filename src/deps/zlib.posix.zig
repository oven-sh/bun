const uInt = c_uint;
const uLong = c_ulong;
pub const struct_internal_state = extern struct {
    dummy: c_int,
};

// https://zlib.net/manual.html#Stream
const Byte = u8;
const Bytef = Byte;
const charf = u8;
const intf = c_int;
const uIntf = uInt;
const uLongf = uLong;
const voidpc = ?*const anyopaque;
const voidpf = ?*anyopaque;
const voidp = ?*anyopaque;
const z_crc_t = c_uint;

// typedef voidpf (*alloc_func) OF((voidpf opaque, uInt items, uInt size));
// typedef void   (*free_func)  OF((voidpf opaque, voidpf address));

pub const z_alloc_fn = ?*const fn (*anyopaque, uInt, uInt) callconv(.C) voidpf;
pub const z_free_fn = ?*const fn (*anyopaque, *anyopaque) callconv(.C) void;

pub const zStream_struct = extern struct {
    /// next input byte
    next_in: [*c]const u8,
    /// number of bytes available at next_in
    avail_in: uInt,
    /// total number of input bytes read so far
    total_in: uLong,

    /// next output byte will go here
    next_out: [*c]u8,
    /// remaining free space at next_out
    avail_out: uInt,
    /// total number of bytes output so far
    total_out: uLong,

    /// last error message, NULL if no error
    err_msg: ?[*:0]const u8,
    /// not visible by applications
    internal_state: ?*struct_internal_state,

    /// used to allocate the internal state
    alloc_func: z_alloc_fn,
    /// used to free the internal state
    free_func: z_free_fn,
    /// private data object passed to zalloc and zfree
    user_data: *anyopaque,

    /// best guess about the data type: binary or text for deflate, or the decoding state for inflate
    data_type: DataType,

    ///Adler-32 or CRC-32 value of the uncompressed data
    adler: uLong,
    /// reserved for future use
    reserved: uLong,
};

pub const z_stream = zStream_struct;
pub const z_streamp = *z_stream;

pub const DataType = @import("./zlib.shared.zig").DataType;
pub const FlushValue = @import("./zlib.shared.zig").FlushValue;
pub const ReturnCode = @import("./zlib.shared.zig").ReturnCode;
pub extern fn zlibVersion() [*c]const u8;

pub extern fn deflateInit_(strm: z_streamp, level: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateInit_(strm: z_streamp, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn deflateInit2_(strm: z_streamp, level: c_int, method: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateInit2_(strm: z_streamp, windowBits: c_int, version: [*c]const u8, stream_size: c_int) ReturnCode;
pub extern fn inflateBackInit_(strm: z_streamp, windowBits: c_int, window: [*c]u8, version: [*c]const u8, stream_size: c_int) ReturnCode;

pub inline fn deflateInit(strm: anytype, level: anytype) ReturnCode {
    return deflateInit_(strm, level, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateInit(strm: anytype) ReturnCode {
    return inflateInit_(strm, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn deflateInit2(strm: anytype, level: anytype, method: anytype, windowBits: anytype, memLevel: anytype, strategy: anytype) ReturnCode {
    return deflateInit2_(strm, level, method, windowBits, memLevel, strategy, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateInit2(strm: anytype, windowBits: anytype) ReturnCode {
    return inflateInit2_(strm, windowBits, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
pub inline fn inflateBackInit(strm: anytype, windowBits: anytype, window: anytype) ReturnCode {
    return inflateBackInit_(strm, windowBits, window, zlibVersion(), @import("std").zig.c_translation.cast(c_int, @import("std").zig.c_translation.sizeof(z_stream)));
}
