//! Thin Zig wrappers over the statically-linked image codecs and the
//! highway resize/rotate kernels. The pipeline is RGBA8 everywhere except
//! the PNG 16-bpc read/write path — decoders emit 8-bit RGBA by default,
//! libspng can also emit 16-bit RGBA when the source PNG is 16 bpc so
//! `PNG 16→PNG 16` with no ops survives at full precision (issue #30462).
//! The geometry kernels (resize/rotate/flip/modulate) and every non-PNG
//! encoder are u8-only, so any op or non-PNG output path downconverts via
//! `downconvertTo8` before touching that code.
//!
//! Memory ownership: decode returns `bun.default_allocator`-owned RGBA. Encode
//! returns `Encoded{bytes, free}` carrying the codec's own deallocator so the
//! JS layer can hand the buffer to `ArrayBuffer.toJSWithContext` without a
//! dupe — see `Encoded` below.

/// Optional OS-native backend. `null` on Linux (and any platform we haven't
/// written one for) so the dispatch in `decode`/`encode` compiles away. The
/// backend module is only `@import`ed inside the matching arm so non-target
/// platforms never see its symbols. Exposed for `Image.fromClipboard()`.
pub const system_backend: ?type = if (bun.Environment.isMac)
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
    /// Decode-only. Static `BI_RGB`/`BI_BITFIELDS` parser everywhere; the
    /// system backend is tried first (covers RLE/JPEG-in-BMP). The Windows
    /// clipboard's `CF_DIB`/`CF_DIBV5` is exactly this.
    bmp,
    /// Decode-only via system backend (ImageIO/WIC); no static codec.
    /// macOS pasteboard's preferred representation for screenshots.
    tiff,
    /// Decode-only, first frame. Static LZW decoder everywhere; system
    /// backend tried first (handles disposal/animation we don't).
    gif,

    pub fn sniff(bytes: []const u8) ?Format {
        if (bytes.len >= 3 and bytes[0] == 0xFF and bytes[1] == 0xD8 and bytes[2] == 0xFF)
            return .jpeg;
        if (bytes.len >= 8 and std.mem.eql(u8, bytes[0..8], "\x89PNG\r\n\x1a\n"))
            return .png;
        if (bytes.len >= 12 and std.mem.eql(u8, bytes[0..4], "RIFF") and std.mem.eql(u8, bytes[8..12], "WEBP"))
            return .webp;
        if (bytes.len >= 2 and bytes[0] == 'B' and bytes[1] == 'M')
            return .bmp;
        if (bytes.len >= 4 and (std.mem.eql(u8, bytes[0..4], "II*\x00") or std.mem.eql(u8, bytes[0..4], "MM\x00*")))
            return .tiff;
        if (bytes.len >= 6 and (std.mem.eql(u8, bytes[0..6], "GIF87a") or std.mem.eql(u8, bytes[0..6], "GIF89a")))
            return .gif;
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

    /// Best-effort extension → format for `.write(path)`'s default. Only the
    /// final dotted segment is considered; case-insensitive. Returns `null`
    /// when there's no extension or it's not one we recognise.
    pub fn fromExtension(path: []const u8) ?Format {
        const dot = std.mem.lastIndexOfScalar(u8, path, '.') orelse return null;
        var buf: [5]u8 = undefined;
        const ext = std.ascii.lowerString(&buf, path[dot + 1 ..][0..@min(path.len - dot - 1, buf.len)]);
        return ExtMap.get(ext);
    }

    const ExtMap = bun.ComptimeStringMap(Format, .{
        .{ "jpg", .jpeg },  .{ "jpeg", .jpeg }, .{ "png", .png },
        .{ "webp", .webp }, .{ "heic", .heic }, .{ "heif", .heic },
        .{ "avif", .avif }, .{ "bmp", .bmp },   .{ "gif", .gif },
        .{ "tif", .tiff },  .{ "tiff", .tiff },
    });

    pub fn mime(self: Format) [:0]const u8 {
        return switch (self) {
            .jpeg => "image/jpeg",
            .png => "image/png",
            .webp => "image/webp",
            .heic => "image/heic",
            .avif => "image/avif",
            .bmp => "image/bmp",
            .tiff => "image/tiff",
            .gif => "image/gif",
        };
    }
};

pub const Decoded = struct {
    rgba: []u8, // bun.default_allocator
    width: u32,
    height: u32,
    /// Bits per channel in `rgba`: 8 (one byte per channel, `width*height*4`
    /// bytes) or 16 (two host-endian bytes per channel, `width*height*8`
    /// bytes). Only libspng's 16-bpc PNG decode path sets this to 16;
    /// every other decoder produces 8. The geometry kernels and non-PNG
    /// encoders are u8-only, so the pipeline calls `downconvertTo8`
    /// before any op or non-PNG encode — PNG→PNG with no ops is the
    /// only path that stays at 16. Issue #30462.
    bit_depth: u8 = 8,
    /// ICC color profile bytes pulled from the source container (JPEG APP2,
    /// PNG iCCP, WebP ICCP), `bun.default_allocator`-owned. `null` when the
    /// source didn't carry one or the decode path doesn't extract it —
    /// BMP/GIF (no ICC chunk) and system backends (which already colour-
    /// manage into sRGB during decode, so the profile is no longer
    /// needed). The image pipeline hands this straight to the matching
    /// encoder — the RGBA buffer is NOT converted to sRGB, so the bytes
    /// only have their intended colour meaning when the profile travels
    /// with them. Dropping it on a Display-P3 / Adobe RGB / XYB source
    /// would reinterpret the values as sRGB and visibly shift the
    /// colours. See issue #30197.
    icc_profile: ?[]u8 = null,

    pub fn deinit(self: *Decoded) void {
        bun.default_allocator.free(self.rgba);
        if (self.icc_profile) |p| bun.default_allocator.free(p);
    }

    /// Convert `rgba` from 16-bpc host-endian to 8-bpc in place, narrowing
    /// each u16 channel to the high byte (equivalent to `>> 8`). A no-op
    /// when `bit_depth` is already 8. Called before any transform (the
    /// geometry kernels are u8-only) and before non-PNG encode (JPEG/WebP
    /// are 8-bpc formats). The buffer is shrunk via `realloc` so the tail
    /// memory is released — mimalloc's shrink is in-place when the new
    /// size stays in the same size class, so this is free in practice.
    /// Infallible: the only operation that could fail is the shrinking
    /// realloc, which is routed through `handleOom` (abort) because a
    /// genuine OOM mid-shrink isn't recoverable in the worker and matches
    /// every other critical path in Bun.
    pub fn downconvertTo8(self: *Decoded) void {
        if (self.bit_depth != 16) return;
        // Treat `rgba` as a u16 slice of host-endian channel samples. The
        // allocator returned 2-byte alignment at minimum (alloc of u8
        // rounds up to the allocator's min align, which is ≥ 2), but PNG
        // decode sizes are always even anyway (`pixels * 8`), so the
        // in-place narrowing walk is safe.
        const pixels: usize = @as(usize, self.width) * self.height;
        const samples: usize = pixels * 4;
        const src16: [*]align(1) const u16 = @ptrCast(self.rgba.ptr);
        var i: usize = 0;
        while (i < samples) : (i += 1) {
            // Narrow by keeping the high byte — same convention as every
            // 16→8 PNG down-converter (libpng `png_set_strip_16`, libvips).
            // A round-then-shift would be slightly less biased but the
            // difference is sub-LSB and not worth the cost on the fast
            // path.
            self.rgba[i] = @intCast(src16[i] >> 8);
        }
        self.bit_depth = 8;
        self.rgba = bun.handleOom(bun.default_allocator.realloc(self.rgba, samples));
    }
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
/// cap is ~1 GiB, which is already past where you'd want to be. 16-bpc PNG
/// decode (issue #30462) doubles bytes-per-pixel, so the guard in
/// `codec_png.decode` and in `probe` halves the effective pixel budget for
/// 16-bpc sources to keep the byte cap at that same ~1 GiB regardless of
/// source depth.
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
        .heic, .avif, .tiff => decodeViaSystem(bytes, max_pixels) catch |e| switch (e) {
            error.BackendUnavailable => error.UnsupportedOnPlatform,
            else => |narrowed| narrowed,
        },
        // BMP/GIF have static decoders so Linux (and `backend == .bun`) work;
        // the system backend is tried first because ImageIO/WIC handle the
        // long tail (RLE BMP, animated GIF disposal, etc.) we don't.
        .bmp => decodeViaSystem(bytes, max_pixels) catch |e| switch (e) {
            error.BackendUnavailable => bmp.decode(bytes, max_pixels),
            else => |narrowed| narrowed,
        },
        .gif => decodeViaSystem(bytes, max_pixels) catch |e| switch (e) {
            error.BackendUnavailable => gif.decode(bytes, max_pixels),
            else => |narrowed| narrowed,
        },
    };
}

fn decodeViaSystem(bytes: []const u8, max_pixels: u64) (Error || error{BackendUnavailable})!Decoded {
    if (system_backend) |b| if (useSystem()) return b.decode(bytes, max_pixels);
    return error.BackendUnavailable;
}

pub inline fn guard(w: u32, h: u32, max_pixels: u64) Error!void {
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
            // sig(8) · IHDR{len(4) type(4) w(4) h(4) bit_depth(1) ...}
            if (bytes.len < 25) return error.DecodeFailed;
            w = std.mem.readInt(u32, bytes[16..20], .big);
            h = std.mem.readInt(u32, bytes[20..24], .big);
            // 16-bpc PNG decode allocates 8 bytes/pixel instead of 4, so
            // the `max_pixels` byte budget (documented ~1 GiB at the cap)
            // has to halve to stay consistent. Keep probe() in lockstep
            // with codec_png.decode()'s guard so `.metadata()` and
            // `.bytes()` agree on what's too big. Issue #30462.
            //
            // Divide the budget rather than multiplying the pixel count —
            // `w` and `h` are unvalidated u32 here (the i32 range reject
            // runs *after* the switch), so `w * h * 2` can overflow u64
            // on a hostile 25-byte IHDR and panic in Debug / ReleaseSafe
            // before the reject gets its turn. Two u32 factors always
            // fit in u64, and `max_pixels / 2` can't overflow either.
            if (bytes[24] == 16) {
                if (@as(u64, w) * @as(u64, h) > max_pixels / 2) return error.TooManyPixels;
            }
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
        .bmp => {
            const ih = try bmp.parseHeader(bytes);
            w = ih.width;
            h = ih.height;
        },
        .gif => {
            // sig(6) · LSD: w(u16le) h(u16le) …
            if (bytes.len < 10) return error.DecodeFailed;
            w = std.mem.readInt(u16, bytes[6..8], .little);
            h = std.mem.readInt(u16, bytes[8..10], .little);
        },
        .tiff => {
            // IFD walk would be a full TIFF parser; defer to whoever
            // actually decodes it (system backend on mac/win, else error).
            return error.UnsupportedOnPlatform;
        },
        .heic, .avif => {
            // System backend handles these; fall through to a full decode if
            // available, otherwise UnsupportedOnPlatform.
            return error.UnsupportedOnPlatform;
        },
    }
    // The PNG/JPEG/BMP specs all cap each dimension at 2³¹−1; a header with
    // a larger u32 value is corrupt regardless of `maxPixels`. Reject here so
    // the i32 `last_width`/`last_height` casts downstream can't trap on a
    // 24-byte hostile IHDR.
    if (w == 0 or h == 0 or w > std.math.maxInt(i32) or h > std.math.maxInt(i32))
        return error.DecodeFailed;
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
    /// JPEG only: emit a progressive scan script (coarse-to-fine render).
    progressive: bool = false,
    /// ICC profile to embed in the output container (JPEG APP2, PNG iCCP,
    /// WebP ICCP). `null` ⇒ no profile chunk/marker is written. The
    /// pipeline forwards this from the decode step so a non-sRGB source
    /// (P3, Adobe RGB, XYB/Jpegli) preserves its colour meaning through
    /// re-encode. Borrowed; the caller retains ownership.
    icc_profile: ?[]const u8 = null,
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

/// `bit_depth` is 8 or 16. Only PNG truecolour encode honours 16; everything
/// else expects 8-bit RGBA. The pipeline in Image.zig downconverts before
/// calling in, so a 16 here on a non-PNG path is a programming error — but
/// the codec arms still assume `rgba.len == w*h*4` and would miscompute, so
/// keep the precondition in the caller, not a runtime check here.
pub fn encode(rgba: []const u8, width: u32, height: u32, bit_depth: u8, opts: EncodeOptions) Error!Encoded {
    return switch (opts.format) {
        .jpeg => jpeg.encode(rgba, width, height, opts.quality, opts.progressive, opts.icc_profile),
        // PNG carries iCCP on both truecolour and indexed images — quantise
        // operates on raw RGB numbers without converting colour spaces, so
        // the palette entries are still in the source space and need the
        // profile to be interpreted correctly (see PNG spec §11.3.3.3).
        // Indexed PNGs are always 8 bpc (palette entries are u8), so the
        // caller must have downconverted before choosing the indexed path.
        .png => if (opts.palette)
            png.encodeIndexed(rgba, width, height, opts.compression_level, opts.colors, opts.dither, opts.icc_profile)
        else
            png.encode(rgba, width, height, bit_depth, opts.compression_level, opts.icc_profile),
        .webp => webp.encode(rgba, width, height, opts.quality, opts.lossless, opts.icc_profile),
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
        // Decode-only formats — no .bmp()/.tiff()/.gif() chain methods, so the
        // pipeline never sets these on EncodeOptions.format. Exhaustiveness
        // arm only.
        .bmp, .tiff, .gif => error.UnsupportedOnPlatform,
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

// ───────────────────────────── format codecs ────────────────────────────────
// Per-format implementations live in their own files; codecs.zig is the
// dispatch surface only.

pub const jpeg = @import("./codec_jpeg.zig");
pub const png = @import("./codec_png.zig");
pub const webp = @import("./codec_webp.zig");
pub const bmp = @import("./codec_bmp.zig");
pub const gif = @import("./codec_gif.zig");

const bun = @import("bun");
const std = @import("std");
