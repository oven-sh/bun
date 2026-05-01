//! macOS ImageIO/CoreGraphics backend.
//!
//! All framework calls live in `src/bun.js/bindings/image_coregraphics_shim.cpp`
//! — see the header comment there for why (Zig→dlsym'd-function-pointer calls
//! into CG segfaulted on x86_64 even after thunking the obvious by-value
//! struct, so the whole dispatch is in C++ where clang owns the ABI). This
//! file just allocates the RGBA/output buffers in `bun.default_allocator` and
//! maps the C status codes back onto `codecs.Error`.

pub const BackendError = codecs.Error || error{BackendUnavailable};

extern fn bun_coregraphics_decode(
    bytes: [*]const u8,
    len: usize,
    max_pixels: u64,
    out_w: *u32,
    out_h: *u32,
    out: ?[*]u8,
) i32;

extern fn bun_coregraphics_encode(
    rgba: [*]const u8,
    width: u32,
    height: u32,
    format: i32,
    quality: i32,
    out: ?[*]u8,
    out_len: *usize,
) i32;

const CG_OK = 0;
const CG_UNAVAILABLE = 1;
const CG_DECODE_FAILED = 2;
const CG_ENCODE_FAILED = 3;
const CG_TOO_MANY_PIXELS = 4;

fn mapErr(rc: i32) BackendError {
    return switch (rc) {
        CG_UNAVAILABLE => error.BackendUnavailable,
        CG_DECODE_FAILED => error.DecodeFailed,
        CG_ENCODE_FAILED => error.EncodeFailed,
        CG_TOO_MANY_PIXELS => error.TooManyPixels,
        else => error.BackendUnavailable,
    };
}

pub fn decode(bytes: []const u8, max_pixels: u64) BackendError!codecs.Decoded {
    var w: u32 = 0;
    var h: u32 = 0;
    // Phase 1: dimensions only (out=null) so we can allocate in
    // bun.default_allocator like every other decode path.
    switch (bun_coregraphics_decode(bytes.ptr, bytes.len, max_pixels, &w, &h, null)) {
        CG_OK => {},
        else => |rc| return mapErr(rc),
    }
    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(out);
    // Phase 2: render. The C side re-creates the CGImageSource (cheap — the
    // header parse is the only repeated work) so we don't have to thread an
    // opaque handle across the boundary.
    switch (bun_coregraphics_decode(bytes.ptr, bytes.len, max_pixels, &w, &h, out.ptr)) {
        CG_OK => {},
        else => |rc| return mapErr(rc),
    }
    return .{ .rgba = out, .width = w, .height = h };
}

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: codecs.EncodeOptions) BackendError![]u8 {
    // ImageIO has no knob for indexed-PNG quantisation or VP8L lossless; let
    // the static codecs handle those so behaviour matches across platforms.
    if (opts.format == .png and opts.palette) return error.BackendUnavailable;
    if (opts.format == .webp and opts.lossless) return error.BackendUnavailable;

    const fmt: i32 = @intFromEnum(opts.format);
    var len: usize = 0;
    // Phase 1: encode into a thread-local CFData inside the shim, return size.
    switch (bun_coregraphics_encode(rgba.ptr, width, height, fmt, opts.quality, null, &len)) {
        CG_OK => {},
        else => |rc| return mapErr(rc),
    }
    const out = try bun.default_allocator.alloc(u8, len);
    errdefer bun.default_allocator.free(out);
    // Phase 2: copy out and release the CFData.
    switch (bun_coregraphics_encode(rgba.ptr, width, height, fmt, opts.quality, out.ptr, &len)) {
        CG_OK => {},
        else => |rc| return mapErr(rc),
    }
    return out[0..len];
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
