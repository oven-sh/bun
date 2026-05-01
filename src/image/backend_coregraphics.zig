//! macOS system codec backend for `Bun.Image`, via ImageIO + CoreGraphics.
//!
//! This is an *optimisation* over the static codecs in codecs.zig — the
//! frameworks are dlopen'd lazily on first use, and any failure (missing
//! framework, missing symbol, sandboxed process) yields
//! `error.BackendUnavailable`, which the dispatch in codecs.zig swallows and
//! falls through to libjpeg-turbo / libspng / libwebp. The static path is the
//! correctness baseline; this path is "use the OS's tuned codecs when we can".
//!
//! Decode:  CFDataCreateWithBytesNoCopy(input)
//!          → CGImageSourceCreateWithData
//!          → CGImageSourceCreateImageAtIndex(0)
//!          → guard(width × height ≤ max_pixels)
//!          → CGBitmapContextCreate(RGBA8, premultipliedLast)
//!          → CGContextDrawImage   (CG does the colourspace + format convert)
//!          → memcpy bitmap → bun.default_allocator slice
//!
//! Encode:  CGBitmapContextCreate around our RGBA8 buffer
//!          → CGBitmapContextCreateImage
//!          → CFDataCreateMutable + CGImageDestinationCreateWithData(uti)
//!          → CGImageDestinationAddImage(+ kCGImageDestinationLossyCompressionQuality)
//!          → CGImageDestinationFinalize
//!          → CFDataGetBytePtr/Length → dupe to bun.default_allocator
//!
//! All CFTypeRef releases are scoped with `defer` so the early-return error
//! paths don't leak. ImageIO formats we don't sniff (HEIC/TIFF/…) are still
//! refused upstream by `Format.sniff` so the fallback story stays uniform.

pub const BackendError = codecs.Error || error{BackendUnavailable};

pub fn decode(bytes: []const u8, max_pixels: u64) BackendError!codecs.Decoded {
    const s = try syms();

    const data = s.CFDataCreateWithBytesNoCopy(null, bytes.ptr, @intCast(bytes.len), s.kCFAllocatorNull.*) orelse
        return error.BackendUnavailable;
    defer s.CFRelease(data);

    const src = s.CGImageSourceCreateWithData(data, null) orelse return error.DecodeFailed;
    defer s.CFRelease(src);

    const img = s.CGImageSourceCreateImageAtIndex(src, 0, null) orelse return error.DecodeFailed;
    defer s.CGImageRelease(img);

    const w: u32 = @intCast(s.CGImageGetWidth(img));
    const h: u32 = @intCast(s.CGImageGetHeight(img));
    if (w == 0 or h == 0) return error.DecodeFailed;
    if (@as(u64, w) * @as(u64, h) > max_pixels) return error.TooManyPixels;

    const out = try bun.default_allocator.alloc(u8, @as(usize, w) * h * 4);
    errdefer bun.default_allocator.free(out);

    const cs = s.CGColorSpaceCreateDeviceRGB() orelse return error.BackendUnavailable;
    defer s.CGColorSpaceRelease(cs);

    // kCGImageAlphaPremultipliedLast (1) | kCGBitmapByteOrderDefault (0).
    // CG's bitmap contexts refuse to render to a non-premultiplied target
    // (kCGImageAlphaLast → CGBitmapContextCreate returns null), so we draw
    // premultiplied and undo it below to match the straight-alpha contract the
    // rest of the pipeline (and the static codecs) work in.
    const ctx = s.CGBitmapContextCreate(out.ptr, w, h, 8, @as(usize, w) * 4, cs, kCGImageAlphaPremultipliedLast) orelse
        return error.DecodeFailed;
    defer s.CGContextRelease(ctx);

    s.CGContextDrawImage(ctx, .{ .origin = .{ .x = 0, .y = 0 }, .size = .{ .width = @floatFromInt(w), .height = @floatFromInt(h) } }, img);

    // Un-premultiply: c = round(c * 255 / a). a==0 leaves RGB as drawn (zero);
    // a==255 is the identity. Integer divide with +a/2 for round-to-nearest.
    var i: usize = 0;
    while (i + 4 <= out.len) : (i += 4) {
        const a: u32 = out[i + 3];
        if (a != 0 and a != 255) {
            inline for (0..3) |c| out[i + c] = @intCast(@min(255, (@as(u32, out[i + c]) * 255 + a / 2) / a));
        }
    }

    return .{ .rgba = out, .width = w, .height = h };
}

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: codecs.EncodeOptions) BackendError![]u8 {
    // ImageIO has no knob for indexed-PNG quantisation or VP8L lossless; let
    // the static codecs handle those so behaviour matches across platforms.
    if (opts.format == .png and opts.palette) return error.BackendUnavailable;
    if (opts.format == .webp and opts.lossless) return error.BackendUnavailable;

    const s = try syms();

    const cs = s.CGColorSpaceCreateDeviceRGB() orelse return error.BackendUnavailable;
    defer s.CGColorSpaceRelease(cs);

    // Wrap the caller's buffer directly — CGBitmapContextCreate doesn't copy.
    // constCast is safe: we never draw into this context, only snapshot it.
    const ctx = s.CGBitmapContextCreate(@constCast(rgba.ptr), width, height, 8, @as(usize, width) * 4, cs, kCGImageAlphaPremultipliedLast) orelse
        return error.EncodeFailed;
    defer s.CGContextRelease(ctx);

    const img = s.CGBitmapContextCreateImage(ctx) orelse return error.EncodeFailed;
    defer s.CGImageRelease(img);

    const uti = s.CFStringCreateWithCString(null, utiFor(opts.format), kCFStringEncodingUTF8) orelse
        return error.BackendUnavailable;
    defer s.CFRelease(uti);

    const sink = s.CFDataCreateMutable(null, 0) orelse return error.OutOfMemory;
    defer s.CFRelease(sink);

    const dest = s.CGImageDestinationCreateWithData(sink, uti, 1, null) orelse return error.EncodeFailed;
    defer s.CFRelease(dest);

    // Optional quality dictionary for JPEG / lossy WebP. PNG ignores it.
    var props: CFRef = null;
    defer if (props) |p| s.CFRelease(p);
    if (opts.format == .jpeg or (opts.format == .webp and !opts.lossless)) {
        const q: f64 = @as(f64, @floatFromInt(opts.quality)) / 100.0;
        const num = s.CFNumberCreate(null, kCFNumberDoubleType, &q) orelse return error.BackendUnavailable;
        defer s.CFRelease(num);
        var key = s.kCGImageDestinationLossyCompressionQuality.*;
        var val: CFRef = num;
        props = s.CFDictionaryCreate(null, @ptrCast(&key), @ptrCast(&val), 1, null, null);
    }

    s.CGImageDestinationAddImage(dest, img, props);
    if (!s.CGImageDestinationFinalize(dest)) return error.EncodeFailed;

    const len: usize = @intCast(s.CFDataGetLength(sink));
    const ptr = s.CFDataGetBytePtr(sink) orelse return error.EncodeFailed;
    return try bun.default_allocator.dupe(u8, ptr[0..len]);
}

// ───────────────────────────── lazy symbol table ────────────────────────────

const CFRef = ?*anyopaque;
const CGFloat = f64;
const CGRect = extern struct {
    origin: extern struct { x: CGFloat, y: CGFloat },
    size: extern struct { width: CGFloat, height: CGFloat },
};

const kCGImageAlphaPremultipliedLast: u32 = 1;
const kCFStringEncodingUTF8: u32 = 0x08000100;
const kCFNumberDoubleType: c_int = 13;

fn utiFor(f: codecs.Format) [:0]const u8 {
    // UTType identifiers — ImageIO accepts both legacy "public.*" and the
    // newer org.webmproject for WebP (10.14+).
    return switch (f) {
        .jpeg => "public.jpeg",
        .png => "public.png",
        .webp => "org.webmproject.webp",
    };
}

/// Function-pointer table populated once. Any dlopen/dlsym miss flips
/// `available = false` and every subsequent call short-circuits to
/// `error.BackendUnavailable`.
const Syms = struct {
    // CoreFoundation
    CFRelease: *const fn (CFRef) callconv(.c) void,
    CFDataCreateWithBytesNoCopy: *const fn (CFRef, [*]const u8, isize, CFRef) callconv(.c) CFRef,
    CFDataCreateMutable: *const fn (CFRef, isize) callconv(.c) CFRef,
    CFDataGetLength: *const fn (CFRef) callconv(.c) isize,
    CFDataGetBytePtr: *const fn (CFRef) callconv(.c) ?[*]const u8,
    CFStringCreateWithCString: *const fn (CFRef, [*:0]const u8, u32) callconv(.c) CFRef,
    CFNumberCreate: *const fn (CFRef, c_int, *const anyopaque) callconv(.c) CFRef,
    CFDictionaryCreate: *const fn (CFRef, [*]const CFRef, [*]const CFRef, isize, ?*const anyopaque, ?*const anyopaque) callconv(.c) CFRef,
    kCFAllocatorNull: *const CFRef, // data symbol

    // CoreGraphics
    CGColorSpaceCreateDeviceRGB: *const fn () callconv(.c) CFRef,
    CGColorSpaceRelease: *const fn (CFRef) callconv(.c) void,
    CGBitmapContextCreate: *const fn (?*anyopaque, usize, usize, usize, usize, CFRef, u32) callconv(.c) CFRef,
    CGBitmapContextCreateImage: *const fn (CFRef) callconv(.c) CFRef,
    CGContextDrawImage: *const fn (CFRef, CGRect, CFRef) callconv(.c) void,
    CGContextRelease: *const fn (CFRef) callconv(.c) void,
    CGImageGetWidth: *const fn (CFRef) callconv(.c) usize,
    CGImageGetHeight: *const fn (CFRef) callconv(.c) usize,
    CGImageRelease: *const fn (CFRef) callconv(.c) void,

    // ImageIO
    CGImageSourceCreateWithData: *const fn (CFRef, CFRef) callconv(.c) CFRef,
    CGImageSourceCreateImageAtIndex: *const fn (CFRef, usize, CFRef) callconv(.c) CFRef,
    CGImageDestinationCreateWithData: *const fn (CFRef, CFRef, usize, CFRef) callconv(.c) CFRef,
    CGImageDestinationAddImage: *const fn (CFRef, CFRef, CFRef) callconv(.c) void,
    CGImageDestinationFinalize: *const fn (CFRef) callconv(.c) bool,
    kCGImageDestinationLossyCompressionQuality: *const CFRef, // data symbol
};

var table: Syms = undefined;
var available: bool = false;
var once = std.once(load);

fn syms() error{BackendUnavailable}!*const Syms {
    once.call();
    if (!available) return error.BackendUnavailable;
    return &table;
}

fn load() void {
    // RTLD_NOW|RTLD_GLOBAL — CoreFoundation symbols are reachable from the
    // ImageIO handle on macOS, but we open all three explicitly to be robust
    // against future framework re-layering.
    const flags: std.c.RTLD = .{ .NOW = true };
    const cf = bun.sys.dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", flags) orelse return;
    const cg = bun.sys.dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", flags) orelse return;
    const io = bun.sys.dlopen("/System/Library/Frameworks/ImageIO.framework/ImageIO", flags) orelse return;

    inline for (@typeInfo(Syms).@"struct".fields) |f| {
        // Field name == symbol name. Data symbols (the two k* constants) live
        // in their owning framework; function symbols are looked up across all
        // three handles so we don't hard-code which framework owns what.
        const sym = bun.sys.dlsymImpl(io, f.name ++ "") orelse
            bun.sys.dlsymImpl(cg, f.name ++ "") orelse
            bun.sys.dlsymImpl(cf, f.name ++ "") orelse return;
        @field(table, f.name) = @ptrCast(@alignCast(sym));
    }
    available = true;
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
