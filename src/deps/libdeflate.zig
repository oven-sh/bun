pub const Compressor = opaque {};
const std = @import("std");
const bun = @import("root").bun;
pub const Options = extern struct {
    sizeof_options: usize = @sizeOf(Options),
    malloc_func: ?*const fn (usize) callconv(.C) ?*anyopaque = @import("std").mem.zeroes(?*const fn (usize) callconv(.C) ?*anyopaque),
    free_func: ?*const fn (?*anyopaque) callconv(.C) void = @import("std").mem.zeroes(?*const fn (?*anyopaque) callconv(.C) void),
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
    libdeflate_set_memory_allocator(bun.Mimalloc.mi_malloc, bun.Mimalloc.mi_free);
}

var loaded_once = std.once(load_once);

pub fn load() void {
    loaded_once.call();
}

pub const Decompressor = opaque {
    pub fn alloc() ?*Decompressor {
        return libdeflate_alloc_decompressor();
    }

    pub fn deinit(this: *Decompressor) void {
        return libdeflate_free_decompressor(this);
    }

    pub const DecompressionResult = struct {
        read: usize,
        written: usize,
        status: Result,
    };

    pub fn deflate(this: *Decompressor, input: []const u8, output: []u8) DecompressionResult {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_deflate_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return DecompressionResult{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn zlib(this: *Decompressor, input: []const u8, output: []u8) DecompressionResult {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_zlib_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return DecompressionResult{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn gzip(this: *Decompressor, input: []const u8, output: []u8) DecompressionResult {
        var actual_in_bytes_ret: usize = input.len;
        var actual_out_bytes_ret: usize = output.len;
        const result = libdeflate_gzip_decompress_ex(this, input.ptr, input.len, output.ptr, output.len, &actual_in_bytes_ret, &actual_out_bytes_ret);
        return DecompressionResult{ .read = actual_in_bytes_ret, .written = actual_out_bytes_ret, .status = result };
    }

    pub fn decompress(this: *Decompressor, input: []const u8, output: []u8, encoding: Encoding) DecompressionResult {
        switch (encoding) {
            Encoding.deflate => return this.deflate(input, output),
            Encoding.zlib => return this.zlib(input, output),
            Encoding.gzip => return this.gzip(input, output),
        }
    }
};

pub const Encoding = enum {
    deflate,
    zlib,
    gzip,

    pub fn detect(data: []const u8, default: Encoding) Encoding {
        if (data.len < 2) {
            return default;
        }

        const first = data[0];
        const second = data[1];

        if (first == 0x78) {
            if (second == 0x01) {
                return Encoding.deflate;
            } else if (second == 0x9C) {
                return Encoding.zlib;
            } else if (second == 0xDA) {
                return Encoding.gzip;
            }
        }

        return default;
    }
};

pub extern fn libdeflate_alloc_decompressor() ?*Decompressor;
pub extern fn libdeflate_alloc_decompressor_ex(options: ?*const Options) ?*Decompressor;
pub const LIBDEFLATE_SUCCESS = 0;
pub const LIBDEFLATE_BAD_DATA = 1;
pub const LIBDEFLATE_SHORT_OUTPUT = 2;
pub const LIBDEFLATE_INSUFFICIENT_SPACE = 3;
pub const Result = enum(c_uint) {
    success = LIBDEFLATE_SUCCESS,
    bad_data = LIBDEFLATE_BAD_DATA,
    short_output = LIBDEFLATE_SHORT_OUTPUT,
    insufficient_space = LIBDEFLATE_INSUFFICIENT_SPACE,
};
pub extern fn libdeflate_deflate_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_deflate_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_zlib_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_zlib_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_gzip_decompress(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_gzip_decompress_ex(decompressor: *Decompressor, in: ?*const anyopaque, in_nbytes: usize, out: ?*anyopaque, out_nbytes_avail: usize, actual_in_nbytes_ret: *usize, actual_out_nbytes_ret: *usize) Result;
pub extern fn libdeflate_free_decompressor(decompressor: *Decompressor) void;
pub extern fn libdeflate_adler32(adler: u32, buffer: ?*const anyopaque, len: usize) u32;
pub extern fn libdeflate_crc32(crc: u32, buffer: ?*const anyopaque, len: usize) u32;
pub extern fn libdeflate_set_memory_allocator(malloc_func: ?*const fn (usize) callconv(.C) ?*anyopaque, free_func: ?*const fn (?*anyopaque) callconv(.C) void) void;
pub const libdeflate_compressor = Compressor;
pub const libdeflate_options = Options;
pub const libdeflate_decompressor = Decompressor;
