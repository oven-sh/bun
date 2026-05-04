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
    // codecs.encode only routes heic/avif here, so the "knob ImageIO can't
    // express" bailouts (palette/compressionLevel/lossless) are dead — kept
    // only as a guard if a future caller passes png/webp directly.
    bun.debugAssert(opts.format == .heic or opts.format == .avif);
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

// ── vImage geometry ────────────────────────────────────────────────────────
// AMX-backed kernels for the common pipeline ops. Signatures mirror the
// Highway path in `codecs.zig` so the dispatch site is `system_backend.x()
// catch fallback.x()`.

extern fn bun_coregraphics_scale(src: [*]const u8, sw: u32, sh: u32, dst: [*]u8, dw: u32, dh: u32) i32;
extern fn bun_coregraphics_rotate90(src: [*]const u8, w: u32, h: u32, dst: [*]u8, quarters: u32) i32;
extern fn bun_coregraphics_reflect(src: [*]const u8, w: u32, h: u32, dst: [*]u8, horizontal: i32) i32;

/// vImageScale's default kernel is Lanczos-3 (the HQ flag widens to L5), so
/// we only take this path for the `.lanczos3` default — explicit non-Lanczos
/// filters fall through to the Highway kernel which honours them exactly.
pub fn scale(src: []const u8, sw: u32, sh: u32, dw: u32, dh: u32, filter: codecs.Filter) BackendError![]u8 {
    if (filter != .lanczos3) return error.BackendUnavailable;
    const out = try bun.default_allocator.alloc(u8, @as(usize, dw) * dh * 4);
    errdefer bun.default_allocator.free(out);
    if (bun_coregraphics_scale(src.ptr, sw, sh, out.ptr, dw, dh) != CG_OK)
        return error.BackendUnavailable;
    return out;
}

pub fn rotate(src: []const u8, w: u32, h: u32, quarters: u32) BackendError![]u8 {
    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(out);
    if (bun_coregraphics_rotate90(src.ptr, w, h, out.ptr, quarters) != CG_OK)
        return error.BackendUnavailable;
    return out;
}

pub fn flip(src: []const u8, w: u32, h: u32, horizontal: bool) BackendError![]u8 {
    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(out);
    if (bun_coregraphics_reflect(src.ptr, w, h, out.ptr, @intFromBool(horizontal)) != CG_OK)
        return error.BackendUnavailable;
    return out;
}

// ── NSPasteboard ───────────────────────────────────────────────────────────
// JS-thread only (NSPasteboard is documented main-thread-safe to *read*, and
// the static `Bun.Image.fromClipboard()` accessor calls this synchronously
// before constructing the Image — the heavy decode still goes to WorkPool).

extern fn bun_coregraphics_clipboard(out: ?[*]u8, out_len: *usize, probe_only: i32) i32;

/// `null` ⇔ no image on the pasteboard. Returned bytes are an opaque container
/// (PNG/TIFF/HEIC/…); feed straight to `new Bun.Image(…)`.
pub fn clipboard() error{ BackendUnavailable, OutOfMemory }!?[]u8 {
    var len: usize = 0;
    if (bun_coregraphics_clipboard(null, &len, 0) != CG_OK) return error.BackendUnavailable;
    if (len == 0) return null;
    const out = try bun.default_allocator.alloc(u8, len);
    errdefer bun.default_allocator.free(out);
    if (bun_coregraphics_clipboard(out.ptr, &len, 0) != CG_OK) return error.BackendUnavailable;
    return out[0..len];
}

pub fn hasClipboardImage() bool {
    var len: usize = 0;
    return bun_coregraphics_clipboard(null, &len, 1) == CG_OK and len > 0;
}

extern fn bun_coregraphics_clipboard_change_count() i64;
pub const clipboardChangeCount = bun_coregraphics_clipboard_change_count;

const bun = @import("bun");
const codecs = @import("./codecs.zig");
