//! Thin Zig wrappers over the statically-linked image codecs and the
//! highway resize/rotate kernels. Everything works on RGBA8 — decoders are
//! told to emit RGBA, encoders are fed RGBA, so Image.zig never branches on
//! channel layout.
//!
//! Memory ownership: decode returns `bun.default_allocator`-owned RGBA. Encode
//! returns `Encoded{bytes, free}` carrying the codec's own deallocator so the
//! JS layer can hand the buffer to `ArrayBuffer.toJSWithContext` without a
//! dupe — see `Encoded` below.

/// Optional OS-native backend. `null` on Linux (and any platform we haven't
/// written one for) so the dispatch in `decode`/`encode` compiles away. The
/// backend module is only `@import`ed inside the matching arm so non-target
/// platforms never see its symbols.
const system_backend: ?type = if (bun.Environment.isMac)
    @import("./backend_coregraphics.zig")
else if (bun.Environment.isWindows)
    @import("./backend_wic.zig")
else
    null;

/// Process-global selector exposed as `Bun.Image.backend`.
///
/// `.system` (default on darwin/windows) is the perf-optimal hybrid:
///   • jpeg/png/webp decode+encode → static codecs (turbo/spng/libwebp).
///     Profiling on M-series found ImageIO no faster: Huffman/inflate
///     dominate and aren't AMX-amenable, and ImageIO bottoms out in stock
///     libz vs our zlib-ng. Keeping these static also makes output bytes
///     and the `quality` scale match Linux.
///   • lanczos3 resize, rotate90, flip → vImage (AMX, ~3-6× the Highway
///     kernel on the geometry step).
///   • heic/avif decode+encode → ImageIO/WIC (no static codec).
///
/// `.bun` skips the OS layer entirely (Highway geometry, heic/avif throw)
/// so behaviour is byte-identical to a Linux build.
///
/// Unsynchronised: written from JS, read from WorkPool — a torn read of a
/// 1-byte enum is fine and the worst case is one task using the previous
/// mode.
pub const Backend = enum {
    system,
    bun,
    pub const Map = bun.ComptimeEnumMap(Backend);
};
pub var backend: Backend = if (system_backend != null) .system else .bun;

/// Runtime half of the dispatch check; the comptime half is the
/// `if (system_backend) |b|` capture at each call site (types can't be
/// runtime-conditional, so the two stay separate). On platforms with no
/// backend the capture is comptime-dead and this is never referenced.
inline fn useSystem() bool {
    return backend == .system;
}

pub const Format = enum(u8) {
    jpeg,
    png,
    webp,
    /// System-backend-only on macOS/Windows; no static codec.
    heic,
    /// System-backend-only on macOS/Windows; no static codec.
    avif,

    pub fn sniff(bytes: []const u8) ?Format {
        if (bytes.len >= 3 and bytes[0] == 0xFF and bytes[1] == 0xD8 and bytes[2] == 0xFF)
            return .jpeg;
        if (bytes.len >= 8 and std.mem.eql(u8, bytes[0..8], "\x89PNG\r\n\x1a\n"))
            return .png;
        if (bytes.len >= 12 and std.mem.eql(u8, bytes[0..4], "RIFF") and std.mem.eql(u8, bytes[8..12], "WEBP"))
            return .webp;
        // ISO BMFF: u32be box-size · "ftyp" · major-brand · minor-version ·
        // compatible-brands… HEIC and AVIF share this container; the brands
        // distinguish them. `mif1`/`msf1` are codec-agnostic MIAF structural
        // brands that appear in BOTH, so they can't decide on first sight —
        // scan the whole brand list and let a codec-specific brand win.
        if (bytes.len >= 16 and std.mem.eql(u8, bytes[4..8], "ftyp")) {
            const box: usize = @min(bytes.len, @max(16, std.mem.readInt(u32, bytes[0..4], .big)));
            var miaf = false;
            var off: usize = 8;
            while (off + 4 <= box) : (off += 4) {
                if (off == 12) continue; // minor_version
                const b = bytes[off..][0..4];
                if (std.mem.eql(u8, b, "avif") or std.mem.eql(u8, b, "avis"))
                    return .avif;
                if (std.mem.eql(u8, b, "heic") or std.mem.eql(u8, b, "heix") or
                    std.mem.eql(u8, b, "hevc") or std.mem.eql(u8, b, "hevx"))
                    return .heic;
                if (std.mem.eql(u8, b, "mif1") or std.mem.eql(u8, b, "msf1"))
                    miaf = true;
            }
            if (miaf) return .heic; // MIAF with no codec brand → assume HEVC
        }
        return null;
    }

    pub fn mime(self: Format) [:0]const u8 {
        return switch (self) {
            .jpeg => "image/jpeg",
            .png => "image/png",
            .webp => "image/webp",
            .heic => "image/heic",
            .avif => "image/avif",
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
    /// HEIC/AVIF on a platform with no system backend (Linux), or the system
    /// backend declined and there's no static codec to fall back to.
    UnsupportedOnPlatform,
    OutOfMemory,
};

/// Sharp's default: 0x3FFF * 0x3FFF ≈ 268 MP. A single RGBA8 frame at this
/// cap is ~1 GiB, which is already past where you'd want to be.
pub const default_max_pixels: u64 = 0x3FFF * 0x3FFF;

/// Hint from the pipeline about the eventual output size. JPEG can do M/8
/// IDCT scaling for free, so when we know the resize target up front we
/// decode at the smallest factor that still ≥ the target — skipping most of
/// the IDCT work AND shrinking the RGBA buffer the resize pass touches. This
/// is the same trick Sharp/libvips use and is where most of the perf gap was.
pub const DecodeHint = struct {
    /// Final output dims (after rotate). 0 = "no resize, full decode".
    target_w: u32 = 0,
    target_h: u32 = 0,
};

pub fn decode(bytes: []const u8, max_pixels: u64, hint: DecodeHint) Error!Decoded {
    const fmt = Format.sniff(bytes) orelse return error.UnknownFormat;
    return switch (fmt) {
        .jpeg => jpeg.decode(bytes, max_pixels, hint),
        .png => png.decode(bytes, max_pixels),
        .webp => webp.decode(bytes, max_pixels),
        // Static codecs cover everything we ship; profiling on M-series showed
        // ImageIO is no faster (AppleJPEG ≈ libjpeg-turbo since Huffman is the
        // bottleneck and isn't vectorisable; spng+zlib-ng beats ImageIO's
        // system libz). The OS backend is purely a *capability* fallback for
        // containers we don't link a decoder for — and `backend == .bun` opts
        // out of even that so behaviour is identical to Linux.
        .heic, .avif => if (system_backend) |b| if (useSystem())
            b.decode(bytes, max_pixels) catch |e| switch (e) {
                error.BackendUnavailable => error.UnsupportedOnPlatform,
                else => |narrowed| narrowed,
            }
        else
            error.UnsupportedOnPlatform else error.UnsupportedOnPlatform,
    };
}

inline fn guard(w: u32, h: u32, max_pixels: u64) Error!void {
    // u64 mul cannot overflow from two u32 factors.
    if (@as(u64, w) * @as(u64, h) > max_pixels) return error.TooManyPixels;
}

/// Header-only dimensions probe for `.metadata()`. Decoding the full RGBA for
/// a 1920×1080 PNG just to read the IHDR is ~70× slower than Sharp; this reads
/// the few bytes each format needs and stops. Still subject to `max_pixels` so
/// metadata() and bytes() agree on what's "too big".
pub fn probe(bytes: []const u8, max_pixels: u64) Error!struct { format: Format, width: u32, height: u32 } {
    const fmt = Format.sniff(bytes) orelse return error.UnknownFormat;
    var w: u32 = 0;
    var h: u32 = 0;
    switch (fmt) {
        .png => {
            // sig(8) · IHDR{len(4) type(4) w(4) h(4) ...}
            if (bytes.len < 24) return error.DecodeFailed;
            w = std.mem.readInt(u32, bytes[16..20], .big);
            h = std.mem.readInt(u32, bytes[20..24], .big);
        },
        .jpeg => {
            // turbojpeg's header decode is already cheap (no scan data read).
            const handle = jpeg.tj3Init(1) orelse return error.OutOfMemory;
            defer jpeg.tj3Destroy(handle);
            if (jpeg.tj3DecompressHeader(handle, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
            const rw = jpeg.tj3Get(handle, jpeg.TJPARAM_JPEGWIDTH);
            const rh = jpeg.tj3Get(handle, jpeg.TJPARAM_JPEGHEIGHT);
            if (rw <= 0 or rh <= 0) return error.DecodeFailed;
            w = @intCast(rw);
            h = @intCast(rh);
        },
        .webp => {
            var cw: c_int = 0;
            var ch: c_int = 0;
            if (webp.WebPGetInfo(bytes.ptr, bytes.len, &cw, &ch) == 0 or cw <= 0 or ch <= 0)
                return error.DecodeFailed;
            w = @intCast(cw);
            h = @intCast(ch);
        },
        .heic, .avif => {
            // System backend handles these; fall through to a full decode if
            // available, otherwise UnsupportedOnPlatform.
            return error.UnsupportedOnPlatform;
        },
    }
    if (w == 0 or h == 0) return error.DecodeFailed;
    try guard(w, h, max_pixels);
    return .{ .format = fmt, .width = w, .height = h };
}

pub const EncodeOptions = struct {
    format: Format,
    /// 0–100 for JPEG/WebP-lossy. Ignored for PNG.
    quality: u8 = 80,
    /// WebP only: emit lossless VP8L instead of lossy VP8.
    lossless: bool = false,
    /// PNG only: zlib level 0–9. -1 = libspng default.
    compression_level: i8 = -1,
    /// PNG only: quantize to ≤ `colors` and emit an indexed PNG.
    palette: bool = false,
    colors: u16 = 256,
    /// PNG palette only: Floyd–Steinberg error-diffusion dither.
    dither: bool = false,
};

/// Encoded output paired with the free function for its allocator. The C
/// codecs each malloc internally (turbojpeg's allocator, libwebp's, libc for
/// libspng); rather than dupe into `bun.default_allocator` so JS can own it,
/// we hand the original buffer to JS via `ArrayBuffer.toJSWithContext` with
/// the matching free — one allocation, zero copies, for the final output.
///
/// `free` matches `jsc.C.JSTypedArrayBytesDeallocator` (bytes, ctx) so it can
/// be passed straight through; the `ctx` arg is unused.
pub const Encoded = struct {
    bytes: []u8,
    free: *const fn (*anyopaque, *anyopaque) callconv(.c) void,

    pub fn deinit(self: Encoded) void {
        self.free(self.bytes.ptr, undefined);
    }

    /// Adapt a 1-arg C free (`tj3Free`, `WebPFree`, `std.c.free`) to the
    /// 2-arg JSC deallocator signature.
    pub fn wrap(comptime f: anytype) *const fn (*anyopaque, *anyopaque) callconv(.c) void {
        return &struct {
            fn call(p: *anyopaque, _: *anyopaque) callconv(.c) void {
                f(p);
            }
        }.call;
    }

    pub fn fromOwned(bytes: []u8) Encoded {
        return .{ .bytes = bytes, .free = wrap(bun.mimalloc.mi_free) };
    }
};

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: EncodeOptions) Error!Encoded {
    return switch (opts.format) {
        .jpeg => jpeg.encode(rgba, width, height, opts.quality),
        .png => if (opts.palette)
            png.encodeIndexed(rgba, width, height, opts.compression_level, opts.colors, opts.dither)
        else
            png.encode(rgba, width, height, opts.compression_level),
        .webp => webp.encode(rgba, width, height, opts.quality, opts.lossless),
        // Same routing rationale as decode(): the OS encoder is a capability
        // fallback, not a fast path — ImageIO's quality scale doesn't match
        // libjpeg-turbo's, and it can't honour compressionLevel/palette/
        // lossless, so using it for jpeg/png/webp would make output bytes
        // diverge from Linux for no speed win.
        .heic, .avif => if (system_backend) |b| if (useSystem())
            Encoded.fromOwned(b.encode(rgba, width, height, opts) catch |e| switch (e) {
                error.BackendUnavailable => return error.UnsupportedOnPlatform,
                else => |narrowed| return narrowed,
            })
        else
            error.UnsupportedOnPlatform else error.UnsupportedOnPlatform,
    };
}

// ───────────────────────────── highway kernels ──────────────────────────────

pub const Filter = enum(i32) {
    box = 0,
    bilinear = 1,
    lanczos3 = 2,
    mitchell = 3,
    nearest = 4,
    cubic = 5, // Catmull-Rom
    lanczos2 = 6,
    mks2013 = 7, // Magic Kernel Sharp
    mks2021 = 8,

    /// `JSValue.toEnum` lookup table. Hand-listed (not `ComptimeEnumMap`) so
    /// Sharp's `'linear'` alias can map to `.bilinear`; the auto-generated
    /// error message still lists only the canonical tags.
    pub const Map = bun.ComptimeStringMap(Filter, .{
        .{ "box", .box },
        .{ "bilinear", .bilinear },
        .{ "linear", .bilinear },
        .{ "lanczos3", .lanczos3 },
        .{ "mitchell", .mitchell },
        .{ "nearest", .nearest },
        .{ "cubic", .cubic },
        .{ "lanczos2", .lanczos2 },
        .{ "mks2013", .mks2013 },
        .{ "mks2021", .mks2021 },
    });
};

extern fn bun_image_resize_scratch_size(src_w: i32, src_h: i32, dst_w: i32, dst_h: i32, filter: i32) usize;
extern fn bun_image_resize_rgba8(
    src: [*]const u8,
    src_w: i32,
    src_h: i32,
    dst: [*]u8,
    dst_w: i32,
    dst_h: i32,
    filter: i32,
    scratch: [*]u8,
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
    if (system_backend) |b| if (@hasDecl(b, "scale")) if (useSystem()) {
        if (b.scale(src, sw, sh, dw, dh, f)) |out| return out else |e| switch (e) {
            error.BackendUnavailable => {},
            else => |narrowed| return narrowed,
        }
    };
    // ONE allocation for output + the kernel's scratch arena (intermediate
    // dst_w×src_h×4 row buffer + spans/weights tables). Zero mallocs in the
    // C++; mimalloc here is faster than libc, and the over-allocation rounds
    // into the same size class as the row buffer alone.
    const out_sz: usize = @as(usize, dw) * dh * 4;
    const scratch_sz = bun_image_resize_scratch_size(@intCast(sw), @intCast(sh), @intCast(dw), @intCast(dh), @intFromEnum(f));
    const block = try bun.default_allocator.alloc(u8, out_sz + scratch_sz);
    errdefer bun.default_allocator.free(block);
    if (bun_image_resize_rgba8(src.ptr, @intCast(sw), @intCast(sh), block.ptr, @intCast(dw), @intCast(dh), @intFromEnum(f), block.ptr + out_sz) != 0)
        return error.OutOfMemory;
    // Drop the scratch tail; mimalloc's shrink is in-place when the new size
    // fits the same block, so this is free.
    return bun.handleOom(bun.default_allocator.realloc(block, out_sz));
}

pub fn rotate(src: []const u8, w: u32, h: u32, degrees: u32) Error!Decoded {
    const dw: u32, const dh: u32 = if (degrees == 90 or degrees == 270) .{ h, w } else .{ w, h };
    if (system_backend) |b| if (@hasDecl(b, "rotate")) if (useSystem()) {
        if (b.rotate(src, w, h, degrees / 90)) |out|
            return .{ .rgba = out, .width = dw, .height = dh }
        else |e| switch (e) {
            error.BackendUnavailable => {},
            else => |narrowed| return narrowed,
        }
    };
    const out = try bun.default_allocator.alloc(u8, @as(usize, dw) * dh * 4);
    bun_image_rotate_rgba8(src.ptr, @intCast(w), @intCast(h), out.ptr, @intCast(degrees));
    return .{ .rgba = out, .width = dw, .height = dh };
}

pub fn flip(src: []const u8, w: u32, h: u32, horizontal: bool) Error![]u8 {
    if (system_backend) |b| if (@hasDecl(b, "flip")) if (useSystem()) {
        if (b.flip(src, w, h, horizontal)) |out| return out else |e| switch (e) {
            error.BackendUnavailable => {},
            else => |narrowed| return narrowed,
        }
    };
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
    extern fn tj3SetScalingFactor(h: tjhandle, sf: ScalingFactor) c_int;
    extern fn tj3GetScalingFactors(n: *c_int) ?[*]const ScalingFactor;
    pub extern fn tj3Free(ptr: ?*anyopaque) void;
    extern fn tj3GetErrorStr(h: tjhandle) [*:0]const u8;

    const ScalingFactor = extern struct { num: c_int, denom: c_int };
    /// TJSCALED: ceil(dim * num / denom).
    inline fn scaled(dim: u32, sf: ScalingFactor) u32 {
        return @intCast(@divFloor(@as(i64, dim) * sf.num + sf.denom - 1, sf.denom));
    }

    // tjparam / tjpf enum values from turbojpeg.h.
    const TJPARAM_QUALITY = 3;
    const TJPARAM_SUBSAMP = 4;
    const TJPARAM_JPEGWIDTH = 5;
    const TJPARAM_JPEGHEIGHT = 6;
    const TJPF_RGBA = 7;
    const TJSAMP_420 = 2;

    pub fn decode(bytes: []const u8, max_pixels: u64, hint: DecodeHint) Error!Decoded {
        const h = tj3Init(1) orelse return error.OutOfMemory;
        defer tj3Destroy(h);
        if (tj3DecompressHeader(h, bytes.ptr, bytes.len) != 0) return error.DecodeFailed;
        const rw = tj3Get(h, TJPARAM_JPEGWIDTH);
        const rh = tj3Get(h, TJPARAM_JPEGHEIGHT);
        // tj3Get returns -1 on error; treat any non-positive dim as a decode
        // failure rather than letting @intCast trap on hostile input.
        if (rw <= 0 or rh <= 0) return error.DecodeFailed;
        const src_w: u32 = @intCast(rw);
        const src_h: u32 = @intCast(rh);
        try guard(src_w, src_h, max_pixels);

        var w = src_w;
        var ht = src_h;
        // DCT-domain scaling: if the pipeline will downscale, ask libjpeg-turbo
        // for the smallest M/8 IDCT that still ≥ target. The IDCT is where the
        // decode time goes, so this is roughly (8/M)² faster AND the RGBA
        // buffer shrinks by the same factor — both speed and RSS win in one
        // place. The subsequent resize pass takes it the rest of the way.
        if (hint.target_w != 0 and hint.target_h != 0 and
            (hint.target_w < src_w or hint.target_h < src_h))
        {
            var n: c_int = 0;
            if (tj3GetScalingFactors(&n)) |sfs| {
                var best: ScalingFactor = .{ .num = 1, .denom = 1 };
                for (sfs[0..@intCast(n)]) |sf| {
                    // Only consider downscale factors.
                    if (sf.num >= sf.denom) continue;
                    const sw = scaled(src_w, sf);
                    const sh = scaled(src_h, sf);
                    // Never go BELOW target — that would force upscale and
                    // throw away detail the user asked for.
                    if (sw < hint.target_w or sh < hint.target_h) continue;
                    // Pick the smallest output (= largest reduction).
                    if (@as(u64, sw) * sh < @as(u64, scaled(src_w, best)) * scaled(src_h, best))
                        best = sf;
                }
                if (best.num != best.denom) {
                    _ = tj3SetScalingFactor(h, best);
                    w = scaled(src_w, best);
                    ht = scaled(src_h, best);
                }
            }
        }

        const out = try bun.default_allocator.alloc(u8, @as(usize, w) * ht * 4);
        errdefer bun.default_allocator.free(out);
        if (tj3Decompress8(h, bytes.ptr, bytes.len, out.ptr, 0, TJPF_RGBA) != 0)
            return error.DecodeFailed;
        return .{ .rgba = out, .width = w, .height = ht };
    }

    pub fn encode(rgba: []const u8, w: u32, ht: u32, quality: u8) Error!Encoded {
        const h = tj3Init(0) orelse return error.OutOfMemory;
        defer tj3Destroy(h);
        _ = tj3Set(h, TJPARAM_QUALITY, @intCast(@min(@max(quality, 1), 100)));
        _ = tj3Set(h, TJPARAM_SUBSAMP, TJSAMP_420);
        var out_ptr: ?[*]u8 = null;
        var out_len: usize = 0;
        if (tj3Compress8(h, rgba.ptr, @intCast(w), 0, @intCast(ht), TJPF_RGBA, &out_ptr, &out_len) != 0)
            return error.EncodeFailed;
        // tj3Compress8 allocates via libjpeg-turbo's allocator; hand it to JS
        // with `tj3Free` as the finalizer instead of duping.
        return .{ .bytes = out_ptr.?[0..out_len], .free = Encoded.wrap(tj3Free) };
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
    extern fn spng_set_plte(ctx: *spng_ctx, plte: *const Plte) c_int;
    extern fn spng_set_trns(ctx: *spng_ctx, trns: *const Trns) c_int;
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
    const SPNG_COLOR_TYPE_INDEXED = 3;
    const SPNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6;

    const Plte = extern struct {
        n_entries: u32,
        entries: [256][4]u8, // r,g,b,alpha(reserved)
    };
    const Trns = extern struct {
        gray: u16 = 0,
        red: u16 = 0,
        green: u16 = 0,
        blue: u16 = 0,
        n_type3_entries: u32,
        type3_alpha: [256]u8,
    };

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

    pub fn encode(rgba: []const u8, w: u32, h: u32, level: i8) Error!Encoded {
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
        // spng_get_png_buffer transfers ownership (libc malloc); hand to JS
        // with libc `free` as the finalizer instead of duping.
        return .{ .bytes = buf[0..len], .free = Encoded.wrap(std.c.free) };
    }

    /// Quantize RGBA to ≤ `colors` and emit an indexed (colour-type 3) PNG
    /// with PLTE + tRNS. The quantizer is a small median-cut — see
    /// quantize.zig.
    pub fn encodeIndexed(rgba: []const u8, w: u32, h: u32, level: i8, colors: u16, dither: bool) Error!Encoded {
        var q = try quantize.quantize(rgba, w, h, .{ .max_colors = colors, .dither = dither });
        defer q.deinit();

        const ctx = spng_ctx_new(SPNG_CTX_ENCODER) orelse return error.OutOfMemory;
        defer spng_ctx_free(ctx);
        _ = spng_set_option(ctx, SPNG_ENCODE_TO_BUFFER, 1);
        if (level >= 0) _ = spng_set_option(ctx, SPNG_IMG_COMPRESSION_LEVEL, @min(level, 9));

        var ihdr: Ihdr = .{
            .width = w,
            .height = h,
            .bit_depth = 8,
            .color_type = SPNG_COLOR_TYPE_INDEXED,
        };
        if (spng_set_ihdr(ctx, &ihdr) != 0) return error.EncodeFailed;

        var plte: Plte = .{ .n_entries = q.colors, .entries = undefined };
        var trns: Trns = .{ .n_type3_entries = q.colors, .type3_alpha = undefined };
        for (0..q.colors) |i| {
            plte.entries[i] = .{ q.palette[i * 4], q.palette[i * 4 + 1], q.palette[i * 4 + 2], 255 };
            trns.type3_alpha[i] = q.palette[i * 4 + 3];
        }
        if (spng_set_plte(ctx, &plte) != 0) return error.EncodeFailed;
        if (q.has_alpha and spng_set_trns(ctx, &trns) != 0) return error.EncodeFailed;

        if (spng_encode_image(ctx, q.indices.ptr, q.indices.len, SPNG_FMT_PNG, SPNG_ENCODE_FINALIZE) != 0)
            return error.EncodeFailed;

        var len: usize = 0;
        var err: c_int = 0;
        const buf = spng_get_png_buffer(ctx, &len, &err) orelse return error.EncodeFailed;
        return .{ .bytes = buf[0..len], .free = Encoded.wrap(std.c.free) };
    }
};

// ───────────────────────────── libwebp ──────────────────────────────────────

pub const webp = struct {
    extern fn WebPGetInfo(data: [*]const u8, len: usize, w: *c_int, h: *c_int) c_int;
    extern fn WebPDecodeRGBA(data: [*]const u8, len: usize, w: *c_int, h: *c_int) ?[*]u8;
    extern fn WebPEncodeRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, q: f32, out: *?[*]u8) usize;
    extern fn WebPEncodeLosslessRGBA(rgba: [*]const u8, w: c_int, h: c_int, stride: c_int, out: *?[*]u8) usize;
    pub extern fn WebPFree(ptr: ?*anyopaque) void;

    pub fn decode(bytes: []const u8, max_pixels: u64) Error!Decoded {
        var cw: c_int = 0;
        var ch: c_int = 0;
        // Header-only probe first so the pixel guard fires before libwebp
        // allocates the full canvas internally. WebPGetInfo can hand back
        // non-positive on a malformed header; reject before @intCast traps.
        if (WebPGetInfo(bytes.ptr, bytes.len, &cw, &ch) == 0 or cw <= 0 or ch <= 0)
            return error.DecodeFailed;
        const w: u32 = @intCast(cw);
        const h: u32 = @intCast(ch);
        try guard(w, h, max_pixels);
        const ptr = WebPDecodeRGBA(bytes.ptr, bytes.len, &cw, &ch) orelse return error.DecodeFailed;
        defer WebPFree(ptr);
        const len: usize = @as(usize, w) * h * 4;
        const out = try bun.default_allocator.dupe(u8, ptr[0..len]);
        return .{ .rgba = out, .width = w, .height = h };
    }

    pub fn encode(rgba: []const u8, w: u32, h: u32, quality: u8, lossless: bool) Error!Encoded {
        var out: ?[*]u8 = null;
        const stride: c_int = @intCast(w * 4);
        const len = if (lossless)
            WebPEncodeLosslessRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, &out)
        else
            WebPEncodeRGBA(rgba.ptr, @intCast(w), @intCast(h), stride, @floatFromInt(quality), &out);
        if (len == 0 or out == null) return error.EncodeFailed;
        return .{ .bytes = out.?[0..len], .free = Encoded.wrap(WebPFree) };
    }
};

const bun = @import("bun");
const quantize = @import("./quantize.zig");
const std = @import("std");
