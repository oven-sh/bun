pub const Options = extern struct {
    sizeof_options: usize = @sizeOf(Options),
    malloc_func: ?*const fn (usize) callconv(.c) ?*anyopaque = @import("std").mem.zeroes(?*const fn (usize) callconv(.c) ?*anyopaque),
    free_func: ?*const fn (?*anyopaque) callconv(.c) void = @import("std").mem.zeroes(?*const fn (?*anyopaque) callconv(.c) void),
};
pub extern fn libdeflate_alloc_compressor(compression_level: c_int) ?*Compressor;
pub extern fn libdeflate_alloc_compressor_ex(compression_level: c_int, options: ?*const Options) ?*Compressor;
pub extern fn libdeflate_deflate_compress(compressor: *Compressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize) usize;
pub extern fn libdeflate_deflate_compress_bound(compressor: *Compressor, in_nbytes: usize) usize;
pub extern fn libdeflate_zlib_compress(compressor: *Compressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize) usize;
pub extern fn libdeflate_zlib_compress_bound(compressor: *Compressor, in_nbytes: usize) usize;
pub extern fn libdeflate_gzip_compress(compressor: *Compressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize) usize;
pub extern fn libdeflate_gzip_compress_bound(compressor: *Compressor, in_nbytes: usize) usize;
pub extern fn libdeflate_free_compressor(compressor: *Compressor) void;

fn load_once() void {
    libdeflate_set_memory_allocator(bun.mimalloc.mi_malloc, bun.mimalloc.mi_free);
}

var loaded_once = std.once(load_once);

pub fn load() void {
    loaded_once.call();
}

pub const Compressor = opaque {
    pub fn alloc(compression_level: c_int) ?*Compressor {
        return libdeflate_alloc_compressor(compression_level);
    }

    pub fn alloc_ex(compression_level: c_int, options: ?*const Options) ?*Compressor {
        return libdeflate_alloc_compressor_ex(compression_level, options);
    }

    pub fn deinit(this: *Compressor) void {
        return libdeflate_free_compressor(this);
    }

    /// Compresses `input` into `output` and returns the number of bytes written.
    pub fn inflate(this: *Compressor, input: []const u8, output: []u8) Result {
        const written = libdeflate_deflate_compress(this, input.ptr, input.len, output.ptr, output.len);
        return Result{ .read = input.len, .written = written, .status = Status.success };
    }

    pub fn maxBytesNeeded(this: *Compressor, input: []const u8, encoding: Encoding) usize {
        return switch (encoding) {
            Encoding.deflate => return libdeflate_deflate_compress_bound(this, input.len),
            Encoding.zlib => return libdeflate_zlib_compress_bound(this, input.len),
            Encoding.gzip => return libdeflate_gzip_compress_bound(this, input.len),
        };
    }

    pub fn compress(this: *Compressor, input: []const u8, output: []u8, encoding: Encoding) Result {
        switch (encoding) {
            Encoding.deflate => return this.inflate(input, output),
            Encoding.zlib => return this.zlib(input, output),
            Encoding.gzip => return this.gzip(input, output),
        }
    }

    pub fn zlib(this: *Compressor, input: []const u8, output: []u8) Result {
        const result = libdeflate_zlib_compress(this, input.ptr, input.len, output.ptr, output.len);
        return Result{ .read = input.len, .written = result, .status = Status.success };
    }

    pub fn gzip(this: *Compressor, input: []const u8, output: []u8) Result {
        const result = libdeflate_gzip_compress(this, input.ptr, input.len, output.ptr, output.len);
        return Result{ .read = input.len, .written = result, .status = Status.success };
    }
};

pub const Decompressor = opaque {
    pub fn alloc() ?*Decompressor {
        return libdeflate_alloc_decompressor();
    }

    pub fn deinit(this: *Decompressor) void {
        return libdeflate_free_decompressor(this);
    }

    pub fn deflate(this: *Decompressor, input: []const u8, output: []u8) Result {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_deflate_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return Result{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn zlib(this: *Decompressor, input: []const u8, output: []u8) Result {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_zlib_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return Result{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn gzip(this: *Decompressor, input: []const u8, output: []u8) Result {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_gzip_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return Result{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn decompress(this: *Decompressor, input: []const u8, output: []u8, encoding: Encoding) Result {
        switch (encoding) {
            Encoding.deflate => return this.deflate(input, output),
            Encoding.zlib => return this.zlib(input, output),
            Encoding.gzip => return this.gzip(input, output),
        }
    }
};

pub const Result = struct {
    read: usize,
    written: usize,
    status: Status,
};

pub const Encoding = enum {
    deflate,
    zlib,
    gzip,
};

pub extern fn libdeflate_alloc_decompressor() ?*Decompressor;
pub extern fn libdeflate_alloc_decompressor_ex(options: ?*const Options) ?*Decompressor;
pub const LIBDEFLATE_SUCCESS = 0;
pub const LIBDEFLATE_BAD_DATA = 1;
pub const LIBDEFLATE_SHORT_OUTPUT = 2;
pub const LIBDEFLATE_INSUFFICIENT_SPACE = 3;
pub const Status = enum(c_uint) {
    success = LIBDEFLATE_SUCCESS,
    bad_data = LIBDEFLATE_BAD_DATA,
    short_output = LIBDEFLATE_SHORT_OUTPUT,
    insufficient_space = LIBDEFLATE_INSUFFICIENT_SPACE,
};
pub extern fn libdeflate_deflate_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_deflate_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_zlib_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_zlib_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_gzip_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_gzip_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Status;
pub extern fn libdeflate_free_decompressor(decompressor: *Decompressor) void;
pub extern fn libdeflate_adler32(adler: u32, buffer: ?*const anyopaque, len: usize) u32;
pub extern fn libdeflate_crc32(crc: u32, buffer: ?*const anyopaque, len: usize) u32;
pub extern fn libdeflate_set_memory_allocator(malloc_func: ?*const fn (usize) callconv(.c) ?*anyopaque, free_func: ?*const fn (?*anyopaque) callconv(.c) void) void;
pub const libdeflate_compressor = Compressor;
pub const libdeflate_options = Options;
pub const libdeflate_decompressor = Decompressor;

const bun = @import("bun");
const std = @import("std");
