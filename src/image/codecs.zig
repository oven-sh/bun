//! Thin Zig wrappers over the statically-linked image codecs and the
//! highway resize/rotate kernels. Everything works on RGBA8 — decoders are
//! told to emit RGBA, encoders are fed RGBA, so Image.zig never branches on
//! channel layout.
//!
//! Memory ownership: every decode/encode returns a slice owned by
//! `bun.default_allocator`. Where the C library allocates internally
//! (turbojpeg, libwebp), the wrapper copies into a default_allocator slice
//! and frees the C buffer immediately so the JS layer can hand the bytes to
//! `JSUint8Array.fromBytes` without a custom finalizer.

const std = @import("std");
const bun = @import("bun");

pub const Format = enum(u8) {
    jpeg,
    png,
    webp,

    pub fn sniff(bytes: []const u8) ?Format {
        if (bytes.len >= 3 and bytes[0] == 0xFF and bytes[1] == 0xD8 and bytes[2] == 0xFF)
            return .jpeg;
        if (bytes.len >= 8 and std.mem.eql(u8, bytes[0..8], "\x89PNG\r\n\x1a\n"))
            return .png;
        if (bytes.len >= 12 and std.mem.eql(u8, bytes[0..4], "RIFF") and std.mem.eql(u8, bytes[8..12], "WEBP"))
            return .webp;
        return null;
    }

    pub fn mime(self: Format) [:0]const u8 {
        return switch (self) {
            .jpeg => "image/jpeg",
            .png => "image/png",
            .webp => "image/webp",
        };
    }
};

pub const Decoded = struct {
    rgba: []u8, // bun.default_allocator
    width: u32,
    height: u32,
};

pub const Error = error{
    UnknownFormat,
    DecodeFailed,
    EncodeFailed,
    /// width × height exceeds the caller's `max_pixels` guard. This is the
    /// decompression-bomb defence — checked AFTER reading the header but
    /// BEFORE allocating the full RGBA buffer.
    TooManyPixels,
    OutOfMemory,
};

/// Sharp's default: 0x3FFF * 0x3FFF ≈ 268 MP. A single RGBA8 frame at this
/// cap is ~1 GiB, which is already past where you'd want to be.
pub const default_max_pixels: u64 = 0x3FFF * 0x3FFF;

pub fn decode(bytes: []const u8, max_pixels: u64) Error!Decoded {
    const fmt = Format.sniff(bytes) orelse return error.UnknownFormat;
    return switch (fmt) {
        .jpeg => jpeg.decode(bytes, max_pixels),
        .png => png.decode(bytes, max_pixels),
        .webp => webp.decode(bytes, max_pixels),
    };
}

inline fn guard(w: u32, h: u32, max_pixels: u64) Error!void {
    // u64 mul cannot overflow from two u32 factors.
    if (@as(u64, w) * @as(u64, h) > max_pixels) return error.TooManyPixels;
}

pub const EncodeOptions = struct {
    format: Format,
    /// 0–100 for JPEG/WebP-lossy. Ignored for PNG.
    quality: u8 = 80,
    /// WebP only: emit lossless VP8L instead of lossy VP8.
    lossless: bool = false,
    /// PNG only: zlib level 0–9. -1 = libspng default.
    compression_level: i8 = -1,
};

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: EncodeOptions) Error![]u8 {
    return switch (opts.format) {
        .jpeg => jpeg.encode(rgba, width, height, opts.quality),
        .png => png.encode(rgba, width, height, opts.compression_level),
        .webp => webp.encode(rgba, width, height, opts.quality, opts.lossless),
    };
}

// ───────────────────────────── highway kernels ──────────────────────────────

pub const Filter = enum(i32) { box = 0, bilinear = 1, lanczos3 = 2 };

extern fn bun_image_resize_rgba8(
    src: [*]const u8,
    src_w: i32,
    src_h: i32,
    dst: [*]u8,
    dst_w: i32,
    dst_h: i32,
    filter: i32,
) c_int;
extern fn bun_image_rotate_rgba8(src: [*]const u8, w: i32, h: i32, dst: [*]u8, deg: i32) void;
extern fn bun_image_flip_rgba8(src: [*]const u8, w: i32, h: i32, dst: [*]u8, horiz: i32) void;
extern fn bun_image_modulate_rgba8(buf: [*]u8, len: usize, brightness: f32, saturation: f32) void;

/// In-place brightness/saturation. brightness multiplies V (so 1.0 is
/// identity); saturation linearly interpolates each channel toward the pixel's
/// luma (0 = greyscale, 1 = identity, >1 = boost).
pub fn modulate(rgba: []u8, brightness: f32, saturation: f32) void {
    bun_image_modulate_rgba8(rgba.ptr, rgba.len, brightness, saturation);
}

pub fn resize(src: []const u8, sw: u32, sh: u32, dw: u32, dh: u32, f: Filter) Error![]u8 {
    const out = try bun.default_allocator.alloc(u8, @as(usize, dw) * dh * 4);
    errdefer bun.default_allocator.free(out);
    if (bun_image_resize_rgba8(src.ptr, @intCast(sw), @intCast(sh), out.ptr, @intCast(dw), @intCast(dh), @intFromEnum(f)) != 0)
        return error.OutOfMemory;
    return out;
}

pub fn rotate(src: []const u8, w: u32, h: u32, degrees: u32) Error!Decoded {
    const dw: u32, const dh: u32 = if (degrees == 90 or degrees == 270) .{ h, w } else .{ w, h };
    const out = try bun.default_allocator.alloc(u8, @as(usize, dw) * dh * 4);
    bun_image_rotate_rgba8(src.ptr, @intCast(w), @intCast(h), out.ptr, @intCast(degrees));
    return .{ .rgba = out, .width = dw, .height = dh };
}

pub fn flip(src: []const u8, w: u32, h: u32, horizontal: bool) Error![]u8 {
    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    bun_image_flip_rgba8(src.ptr, @intCast(w), @intCast(h), out.ptr, @intFromBool(horizontal));
    return out;
}

// ───────────────────────────── libjpeg-turbo ────────────────────────────────

pub const jpeg = struct {
    const tjhandle = ?*anyopaque;
    // TurboJPEG 3 API. TJINIT_COMPRESS=0, TJINIT_DECOMPRESS=1.
    extern fn tj3Init(init_type: c_int) tjhandle;
    extern fn tj3Destroy(h: tjhandle) void;
    extern fn tj3Set(h: tjhandle, param: c_int, value: c_int) c_int;
    extern fn tj3Get(h: tjhandle, param: c_int) c_int;
    extern fn tj3DecompressHeader(h: tjhandle, buf: [*]const u8, len: usize) c_int;
    extern fn tj3Decompress8(h: tjhandle, buf: [*]const u8, len: usize, dst: [*]u8, pitch: c_int, pf: c_int) c_int;
    extern fn tj3Compress8(h: tjhandle, src: [*]const u8, w: c_int, pitch: c_int, height: c_int, pf: c_int, out: *?[*]u8, out_len: *usize) c_int;
    extern fn tj3Free(ptr: ?*anyopaque) void;
    extern fn tj3GetErrorStr(h: tjhandle) [*:0]const u8;

    // tjparam / tjpf enum values from turbojpeg.h.
    const TJPARAM_QUALITY = 3;
    const TJPARAM_SUBSAMP = 4;
    const TJPARAM_JPEGWIDTH = 5;
    const TJPARAM_JPEGHEIGHT = 6;
    const TJPF_RGBA = 7;
    const TJSAMP_420 = 2;

    pub fn decode(bytes: []const u8, max_pixels: u64) Error!Decoded {
        const h = tj3Init(1) orelse return error.OutOfMemory;
        defer tj3Destroy(h);
        if (tj3DecompressHeader(h, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
        const rw = tj3Get(h, TJPARAM_JPEGWIDTH);
        const rh = tj3Get(h, TJPARAM_JPEGHEIGHT);
        // tj3Get returns -1 on error; treat any non-positive dim as a decode
        // failure rather than letting @intCast trap on hostile input.
        if (rw <= 0 or rh <= 0) return error.DecodeFailed;
        const w: u32 = @intCast(rw);
        const ht: u32 = @intCast(rh);
        try guard(w, ht, max_pixels);
        const out = try bun.default_allocator.alloc(u8, @as(usize, w) * ht * 4);
        errdefer bun.default_allocator.free(out);
        if (tj3Decompress8(h, bytes.ptr, bytes.len, out.ptr, 0, TJPF_RGBA) != 0)
            return error.DecodeFailed;
        return .{ .rgba = out, .width = w, .height = ht };
    }

    pub fn encode(rgba: []const u8, w: u32, ht: u32, quality: u8) Error![]u8 {
        const h = tj3Init(0) orelse return error.OutOfMemory;
        defer tj3Destroy(h);
        _ = tj3Set(h, TJPARAM_QUALITY, @intCast(@min(@max(quality, 1), 100)));
        _ = tj3Set(h, TJPARAM_SUBSAMP, TJSAMP_420);
        var out_ptr: ?[*]u8 = null;
        var out_len: usize = 0;
        if (tj3Compress8(h, rgba.ptr, @intCast(w), 0, @intCast(ht), TJPF_RGBA, &out_ptr, &out_len) != 0)
            return error.EncodeFailed;
        defer tj3Free(out_ptr);
        // tj3Compress8 allocates via the libjpeg-turbo allocator; copy into
        // default_allocator so JS can own it.
        const dup = try bun.default_allocator.dupe(u8, out_ptr.?[0..out_len]);
        return dup;
    }
};

// ───────────────────────────── libspng ──────────────────────────────────────

pub const png = struct {
    const spng_ctx = opaque {};
    extern fn spng_ctx_new(flags: c_int) ?*spng_ctx;
    extern fn spng_ctx_free(ctx: *spng_ctx) void;
    extern fn spng_set_png_buffer(ctx: *spng_ctx, buf: [*]const u8, len: usize) c_int;
    extern fn spng_decoded_image_size(ctx: *spng_ctx, fmt: c_int, out: *usize) c_int;
    extern fn spng_decode_image(ctx: *spng_ctx, out: [*]u8, len: usize, fmt: c_int, flags: c_int) c_int;
    extern fn spng_get_ihdr(ctx: *spng_ctx, ihdr: *Ihdr) c_int;
    extern fn spng_set_ihdr(ctx: *spng_ctx, ihdr: *const Ihdr) c_int;
    extern fn spng_encode_image(ctx: *spng_ctx, img: [*]const u8, len: usize, fmt: c_int, flags: c_int) c_int;
    extern fn spng_get_png_buffer(ctx: *spng_ctx, len: *usize, err: *c_int) ?[*]u8;
    extern fn spng_set_option(ctx: *spng_ctx, opt: c_int, value: c_int) c_int;

    const Ihdr = extern struct {
        width: u32,
        height: u32,
        bit_depth: u8,
        color_type: u8,
        compression_method: u8 = 0,
        filter_method: u8 = 0,
        interlace_method: u8 = 0,
    };

    const SPNG_CTX_ENCODER = 2;
    const SPNG_FMT_RGBA8 = 1;
    const SPNG_FMT_PNG = 256;
    const SPNG_DECODE_TRNS = 1; // apply tRNS chunk so paletted/grey get real alpha
    const SPNG_ENCODE_FINALIZE = 2;
    // spng_option enum
    const SPNG_IMG_COMPRESSION_LEVEL = 2;
    const SPNG_ENCODE_TO_BUFFER = 12;
    const SPNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6;

    pub fn decode(bytes: []const u8, max_pixels: u64) Error!Decoded {
        const ctx = spng_ctx_new(0) orelse return error.OutOfMemory;
        defer spng_ctx_free(ctx);
        if (spng_set_png_buffer(ctx, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
        var ihdr: Ihdr = undefined;
        if (spng_get_ihdr(ctx, &ihdr) != 0) return error.DecodeFailed;
        try guard(ihdr.width, ihdr.height, max_pixels);
        var size: usize = 0;
        if (spng_decoded_image_size(ctx, SPNG_FMT_RGBA8, &size) != 0) return error.DecodeFailed;
        const out = try bun.default_allocator.alloc(u8, size);
        errdefer bun.default_allocator.free(out);
        if (spng_decode_image(ctx, out.ptr, out.len, SPNG_FMT_RGBA8, SPNG_DECODE_TRNS) != 0)
            return error.DecodeFailed;
        return .{ .rgba = out, .width = ihdr.width, .height = ihdr.height };
    }

    pub fn encode(rgba: []const u8, w: u32, h: u32, level: i8) Error![]u8 {
        const ctx = spng_ctx_new(SPNG_CTX_ENCODER) orelse return error.OutOfMemory;
        defer spng_ctx_free(ctx);
        _ = spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1);
        if (level >= 0) _ = spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, @min(level, 9));
        var ihdr: Ihdr = .{
            .width = w,
            .height = h,
            .bit_depth = 8,
            .color_type = SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
        };
        if (spng_set_ihdr(ctx, &ihdr) != 0) return error.EncodeFailed;
        if (spng_encode_image(ctx, rgba.ptr, rgba.len, SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) != 0)
            return error.EncodeFailed;
        var len: usize = 0;
        var err: c_int = 0;
        const buf = spng_get_png_buffer(ctx, &len, &err) orelse return error.EncodeFailed;
        // spng_get_png_buffer transfers ownership (libc malloc). Copy to
        // default_allocator and free the libc one.
        defer std.c.free(buf);
        return try bun.default_allocator.dupe(u8, buf[0..len]);
    }
};

// ───────────────────────────── libwebp ──────────────────────────────────────

pub const webp = struct {
    extern fn WebPGetInfo(data: [*]const u8, len: usize, w: *c_int, h: *c_int) c_int;
    extern fn WebPDecodeRGBA(data: [*]const u8, len: usize, w: *c_int, h: *c_int) ?[*]u8;
    extern fn WebPEncodeRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, q: f32, out: *?[*]u8) usize;
    extern fn WebPEncodeLosslessRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, out: *?[*]u8) usize;
    extern fn WebPFree(ptr: ?*anyopaque) void;

    pub fn decode(bytes: []const u8, max_pixels: u64) Error!Decoded {
        var w: c_int = 0;
        var h: c_int = 0;
        // Header-only probe first so the pixel guard fires before libwebp
        // allocates the full canvas internally.
        if (WebPGetInfo(bytes.ptr, bytes.len, &w, &h) == 0) return error.DecodeFailed;
        try guard(@intCast(w), @intCast(h), max_pixels);
        const ptr = WebPDecodeRGBA(bytes.ptr, bytes.len, &w, &h) orelse return error.DecodeFailed;
        defer WebPFree(ptr);
        const len: usize = @as(usize, @intCast(w)) * @as(usize, @intCast(h)) * 4;
        const out = try bun.default_allocator.dupe(u8, ptr[0..len]);
        return .{ .rgba = out, .width = @intCast(w), .height = @intCast(h) };
    }

    pub fn encode(rgba: []const u8, w: u32, h: u32, quality: u8, lossless: bool) Error![]u8 {
        var out: ?[*]u8 = null;
        const stride: c_int = @intCast(w * 4);
        const len = if (lossless)
            WebPEncodeLosslessRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, &out)
        else
            WebPEncodeRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, @floatFromInt(quality), &out);
        if (len == 0 or out == null) return error.EncodeFailed;
        defer WebPFree(out);
        return try bun.default_allocator.dupe(u8, out.?[0..len]);
    }
};
