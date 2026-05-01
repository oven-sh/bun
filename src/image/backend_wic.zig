//! Windows system codec backend for `Bun.Image`, via the Windows Imaging
//! Component (WIC).
//!
//! WIC is COM: there is no flat C API to dlsym, so "lazy load" here means
//! `CoCreateInstance(CLSID_WICImagingFactory)` on first use. ole32 is a
//! load-time dependency of any process that touches the shell, so linking it
//! is free; `windowscodecs.dll` itself is pulled in by COM when the factory
//! is created. Any HRESULT failure on that first path (nano-server without
//! the WIC feature, sandbox blocking COM, …) yields `error.BackendUnavailable`
//! and the caller falls through to the static codecs.
//!
//! Decode:  factory.CreateStream + InitializeFromMemory(input)
//!          → factory.CreateDecoderFromStream
//!          → decoder.GetFrame(0)
//!          → frame.GetSize → guard(max_pixels)
//!          → WICConvertBitmapSource(GUID_WICPixelFormat32bppRGBA, frame)
//!          → converted.CopyPixels(null, stride, out)
//!
//! Encode:  CreateStreamOnHGlobal(null)      (growable in-memory IStream)
//!          → factory.CreateEncoder(containerGUID)
//!          → encoder.Initialize(stream)
//!          → encoder.CreateNewFrame → frame.Initialize/SetSize/SetPixelFormat
//!          → frame.WritePixels(rgba)
//!          → frame.Commit → encoder.Commit
//!          → GetHGlobalFromStream → GlobalLock/Size → dupe to default_allocator
//!
//! Thread-safety: WIC requires COM to be initialised on the calling thread.
//! Bun's image work runs on `WorkPool` threads with no prior COM init, so we
//! call `CoInitializeEx(COINIT_MULTITHREADED)` once per thread via a
//! threadlocal flag; MTA is fine for WIC and means the factory pointer can be
//! shared across pool threads.

pub const BackendError = codecs.Error || error{BackendUnavailable};

pub fn decode(bytes: []const u8, max_pixels: u64) BackendError!codecs.Decoded {
    const f = try factory();

    var stream: ?*IWICStream = null;
    if (f.vt.CreateStream(f, &stream) < 0 or stream == null) return error.BackendUnavailable;
    defer release(stream);
    if (stream.?.vt.InitializeFromMemory(stream.?, bytes.ptr, @intCast(bytes.len)) < 0)
        return error.DecodeFailed;

    var dec: ?*IWICBitmapDecoder = null;
    // WICDecodeMetadataCacheOnDemand = 0. vendor GUID null = let WIC pick.
    if (f.vt.CreateDecoderFromStream(f, @ptrCast(stream), null, 0, &dec) < 0 or dec == null)
        return error.DecodeFailed;
    defer release(dec);

    var frame: ?*IWICBitmapSource = null;
    if (dec.?.vt.GetFrame(dec.?, 0, &frame) < 0 or frame == null) return error.DecodeFailed;
    defer release(frame);

    var w: u32 = 0;
    var h: u32 = 0;
    if (frame.?.vt.GetSize(frame.?, &w, &h) < 0 or w == 0 or h == 0) return error.DecodeFailed;
    if (@as(u64, w) * @as(u64, h) > max_pixels) return error.TooManyPixels;

    // WIC frames come in whatever pixel format the codec emits; normalise to
    // straight-alpha RGBA8 in one hop.
    const convertFn = wicConvertBitmapSource orelse return error.BackendUnavailable;
    var conv: ?*IWICBitmapSource = null;
    if (convertFn(&GUID_WICPixelFormat32bppRGBA, frame.?, &conv) < 0 or conv == null)
        return error.DecodeFailed;
    defer release(conv);

    const stride: u32 = w * 4;
    const out = try bun.default_allocator.alloc(u8, @as(usize, stride) * h);
    errdefer bun.default_allocator.free(out);
    if (conv.?.vt.CopyPixels(conv.?, null, stride, @intCast(out.len), out.ptr) < 0)
        return error.DecodeFailed;

    return .{ .rgba = out, .width = w, .height = h };
}

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: codecs.EncodeOptions) BackendError![]u8 {
    // Punt to the static codecs for everything WIC can't express the same way:
    //   • palette PNG — WIC's PNG encoder won't quantise for us;
    //   • lossless WebP — Windows ships a WebP *decoder* only, and even where
    //     an encoder exists there's no lossless flag in the property bag;
    //   • JPEG/WebP quality — TODO: thread through IPropertyBag2 "ImageQuality"
    //     (VT_R4 0..1) on the IPropertyBag2* returned by CreateNewFrame. Until
    //     that's wired, defer lossy encodes so quality matches across platforms.
    // That leaves WIC handling PNG (no quality knob needed) for now.
    if (opts.format == .png and opts.palette) return error.BackendUnavailable;
    if (opts.format == .webp) return error.BackendUnavailable;
    if (opts.format == .jpeg) return error.BackendUnavailable;

    const f = try factory();

    var stream: ?*IUnknown = null;
    if (CreateStreamOnHGlobal(null, 1, &stream) < 0 or stream == null) return error.BackendUnavailable;
    defer release(stream);

    var enc: ?*IWICBitmapEncoder = null;
    if (f.vt.CreateEncoder(f, containerGuid(opts.format), null, &enc) < 0 or enc == null)
        return error.EncodeFailed;
    defer release(enc);
    // WICBitmapEncoderNoCache = 2.
    if (enc.?.vt.Initialize(enc.?, stream.?, 2) < 0) return error.EncodeFailed;

    var frame: ?*IWICBitmapFrameEncode = null;
    var props: ?*IUnknown = null;
    if (enc.?.vt.CreateNewFrame(enc.?, &frame, &props) < 0 or frame == null) return error.EncodeFailed;
    defer release(frame);
    defer release(props);

    if (frame.?.vt.Initialize(frame.?, null) < 0) return error.EncodeFailed;
    if (frame.?.vt.SetSize(frame.?, width, height) < 0) return error.EncodeFailed;
    var pf = GUID_WICPixelFormat32bppRGBA;
    // SetPixelFormat is in/out — the codec rewrites `pf` to the closest format
    // it can natively sink (e.g. JPEG → 24bppBGR). WritePixels with our RGBA
    // buffer would then be reinterpreted as that layout and produce garbage.
    // The full fix is CreateBitmapFromMemory(RGBA) → WICConvertBitmapSource(pf)
    // → WriteSource; until that's wired, fall back to the static codec when
    // the format moves so output is always correct.
    if (frame.?.vt.SetPixelFormat(frame.?, &pf) < 0) return error.EncodeFailed;
    if (!std.meta.eql(pf, GUID_WICPixelFormat32bppRGBA)) return error.BackendUnavailable;

    const stride: u32 = width * 4;
    if (frame.?.vt.WritePixels(frame.?, height, stride, @intCast(rgba.len), rgba.ptr) < 0)
        return error.EncodeFailed;
    if (frame.?.vt.Commit(frame.?) < 0) return error.EncodeFailed;
    if (enc.?.vt.Commit(enc.?) < 0) return error.EncodeFailed;

    var hg: ?*anyopaque = null;
    if (GetHGlobalFromStream(stream.?, &hg) < 0 or hg == null) return error.EncodeFailed;
    const len = GlobalSize(hg.?);
    const ptr: [*]const u8 = @ptrCast(GlobalLock(hg.?) orelse return error.EncodeFailed);
    defer _ = GlobalUnlock(hg.?);
    return try bun.default_allocator.dupe(u8, ptr[0..len]);
}

// ───────────────────────────── COM scaffolding ──────────────────────────────
//
// A COM interface pointer is `*{ *const VTable }` — exactly one pointer in the
// object, and the vtable lays out IUnknown's three slots first, then each
// parent interface's slots, then the interface's own. Only slots we call are
// typed; the rest are `*const anyopaque` placeholders so offsets stay correct.

const HRESULT = i32;
const GUID = extern struct { d1: u32, d2: u16, d3: u16, d4: [8]u8 };

const IUnknownVTable = extern struct {
    QueryInterface: *const fn (*IUnknown, *const GUID, *?*anyopaque) callconv(.winapi) HRESULT,
    AddRef: *const fn (*IUnknown) callconv(.winapi) u32,
    Release: *const fn (*IUnknown) callconv(.winapi) u32,
};
const IUnknown = extern struct { vt: *const IUnknownVTable };

/// Generic Release through the IUnknown slots — every COM pointer is
/// layout-compatible with `*IUnknown`.
inline fn release(p: anytype) void {
    if (p) |obj| {
        const unk: *IUnknown = @ptrCast(@alignCast(obj));
        _ = unk.vt.Release(unk);
    }
}

const IWICImagingFactory = extern struct {
    vt: *const VTable,
    const VTable = extern struct {
        unk: IUnknownVTable,
        CreateDecoderFromFilename: *const anyopaque,
        CreateDecoderFromStream: *const fn (*IWICImagingFactory, *IUnknown, ?*const GUID, u32, *?*IWICBitmapDecoder) callconv(.winapi) HRESULT,
        CreateDecoderFromFileHandle: *const anyopaque,
        CreateComponentInfo: *const anyopaque,
        CreateDecoder: *const anyopaque,
        CreateEncoder: *const fn (*IWICImagingFactory, *const GUID, ?*const GUID, *?*IWICBitmapEncoder) callconv(.winapi) HRESULT,
        CreatePalette: *const anyopaque,
        CreateFormatConverter: *const anyopaque,
        CreateBitmapScaler: *const anyopaque,
        CreateBitmapClipper: *const anyopaque,
        CreateBitmapFlipRotator: *const anyopaque,
        CreateStream: *const fn (*IWICImagingFactory, *?*IWICStream) callconv(.winapi) HRESULT,
        // …remaining slots unused.
    };
};

const IWICStream = extern struct {
    vt: *const VTable,
    // IWICStream : IStream(9) : ISequentialStream(2) : IUnknown(3).
    const VTable = extern struct {
        unk: IUnknownVTable,
        seq: [2]*const anyopaque, // Read, Write
        istream: [9]*const anyopaque, // Seek..Clone
        InitializeFromIStream: *const anyopaque,
        InitializeFromFilename: *const anyopaque,
        InitializeFromMemory: *const fn (*IWICStream, [*]const u8, u32) callconv(.winapi) HRESULT,
        InitializeFromIStreamRegion: *const anyopaque,
    };
};

const IWICBitmapDecoder = extern struct {
    vt: *const VTable,
    const VTable = extern struct {
        unk: IUnknownVTable,
        QueryCapability: *const anyopaque,
        Initialize: *const anyopaque,
        GetContainerFormat: *const anyopaque,
        GetDecoderInfo: *const anyopaque,
        CopyPalette: *const anyopaque,
        GetMetadataQueryReader: *const anyopaque,
        GetPreview: *const anyopaque,
        GetColorContexts: *const anyopaque,
        GetThumbnail: *const anyopaque,
        GetFrameCount: *const anyopaque,
        GetFrame: *const fn (*IWICBitmapDecoder, u32, *?*IWICBitmapSource) callconv(.winapi) HRESULT,
    };
};

/// IWICBitmapSource is the lowest common decode interface — both
/// IWICBitmapFrameDecode and IWICFormatConverter expose it as a prefix.
const IWICBitmapSource = extern struct {
    vt: *const VTable,
    const VTable = extern struct {
        unk: IUnknownVTable,
        GetSize: *const fn (*IWICBitmapSource, *u32, *u32) callconv(.winapi) HRESULT,
        GetPixelFormat: *const anyopaque,
        GetResolution: *const anyopaque,
        CopyPalette: *const anyopaque,
        CopyPixels: *const fn (*IWICBitmapSource, ?*const anyopaque, u32, u32, [*]u8) callconv(.winapi) HRESULT,
    };
};

const IWICBitmapEncoder = extern struct {
    vt: *const VTable,
    const VTable = extern struct {
        unk: IUnknownVTable,
        Initialize: *const fn (*IWICBitmapEncoder, *IUnknown, u32) callconv(.winapi) HRESULT,
        GetContainerFormat: *const anyopaque,
        GetEncoderInfo: *const anyopaque,
        SetColorContexts: *const anyopaque,
        SetPalette: *const anyopaque,
        SetThumbnail: *const anyopaque,
        SetPreview: *const anyopaque,
        CreateNewFrame: *const fn (*IWICBitmapEncoder, *?*IWICBitmapFrameEncode, *?*IUnknown) callconv(.winapi) HRESULT,
        Commit: *const fn (*IWICBitmapEncoder) callconv(.winapi) HRESULT,
        // GetMetadataQueryWriter unused.
    };
};

const IWICBitmapFrameEncode = extern struct {
    vt: *const VTable,
    const VTable = extern struct {
        unk: IUnknownVTable,
        Initialize: *const fn (*IWICBitmapFrameEncode, ?*IUnknown) callconv(.winapi) HRESULT,
        SetSize: *const fn (*IWICBitmapFrameEncode, u32, u32) callconv(.winapi) HRESULT,
        SetResolution: *const anyopaque,
        SetPixelFormat: *const fn (*IWICBitmapFrameEncode, *GUID) callconv(.winapi) HRESULT,
        SetColorContexts: *const anyopaque,
        SetPalette: *const anyopaque,
        SetThumbnail: *const anyopaque,
        WritePixels: *const fn (*IWICBitmapFrameEncode, u32, u32, u32, [*]const u8) callconv(.winapi) HRESULT,
        WriteSource: *const anyopaque,
        Commit: *const fn (*IWICBitmapFrameEncode) callconv(.winapi) HRESULT,
        // GetMetadataQueryWriter unused.
    };
};

// ───────────────────────────── GUIDs ────────────────────────────────────────

const CLSID_WICImagingFactory: GUID = .{ .d1 = 0xcacaf262, .d2 = 0x9370, .d3 = 0x4615, .d4 = .{ 0xa1, 0x3b, 0x9f, 0x55, 0x39, 0xda, 0x4c, 0x0a } };
const IID_IWICImagingFactory: GUID = .{ .d1 = 0xec5ec8a9, .d2 = 0xc395, .d3 = 0x4314, .d4 = .{ 0x9c, 0x77, 0x54, 0xd7, 0xa9, 0x35, 0xff, 0x70 } };
const GUID_WICPixelFormat32bppRGBA: GUID = .{ .d1 = 0xf5c7ad2d, .d2 = 0x6a8d, .d3 = 0x43dd, .d4 = .{ 0xa7, 0xa8, 0xa2, 0x99, 0x35, 0x26, 0x1a, 0xe9 } };
const GUID_ContainerFormatJpeg: GUID = .{ .d1 = 0x19e4a5aa, .d2 = 0x5662, .d3 = 0x4fc5, .d4 = .{ 0xa0, 0xc0, 0x17, 0x58, 0x02, 0x8e, 0x10, 0x57 } };
const GUID_ContainerFormatPng: GUID = .{ .d1 = 0x1b7cfaf4, .d2 = 0x713f, .d3 = 0x473c, .d4 = .{ 0xbb, 0xcd, 0x61, 0x37, 0x42, 0x5f, 0xae, 0xaf } };
const GUID_ContainerFormatWebp: GUID = .{ .d1 = 0xe094b0e2, .d2 = 0x67f2, .d3 = 0x45b3, .d4 = .{ 0xb0, 0xea, 0x11, 0x53, 0x37, 0xca, 0x7c, 0xf3 } };

fn containerGuid(f: codecs.Format) *const GUID {
    return switch (f) {
        .jpeg => &GUID_ContainerFormatJpeg,
        .png => &GUID_ContainerFormatPng,
        .webp => &GUID_ContainerFormatWebp,
    };
}

// ───────────────────────────── lazy factory ─────────────────────────────────

extern "ole32" fn CoInitializeEx(reserved: ?*anyopaque, flags: u32) callconv(.winapi) HRESULT;
extern "ole32" fn CoCreateInstance(clsid: *const GUID, outer: ?*anyopaque, ctx: u32, iid: *const GUID, out: *?*anyopaque) callconv(.winapi) HRESULT;
extern "ole32" fn CreateStreamOnHGlobal(hglobal: ?*anyopaque, delete_on_release: c_int, out: *?*IUnknown) callconv(.winapi) HRESULT;
extern "ole32" fn GetHGlobalFromStream(stream: *IUnknown, out: *?*anyopaque) callconv(.winapi) HRESULT;
extern "kernel32" fn GlobalLock(h: *anyopaque) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GlobalUnlock(h: *anyopaque) callconv(.winapi) c_int;
extern "kernel32" fn GlobalSize(h: *anyopaque) callconv(.winapi) usize;

/// `WICConvertBitmapSource` is the one flat export from windowscodecs.dll we
/// need. Loaded lazily (LoadLibraryA inside `loadFactory`) so the binary
/// carries no import-table dependency on windowscodecs — nano-server / stripped
/// containers without the WIC feature still launch and just fall back.
const WICConvertBitmapSourceFn = *const fn (dst_fmt: *const GUID, src: *IWICBitmapSource, out: *?*IWICBitmapSource) callconv(.winapi) HRESULT;
var wicConvertBitmapSource: ?WICConvertBitmapSourceFn = null;

const COINIT_MULTITHREADED: u32 = 0;
const CLSCTX_INPROC_SERVER: u32 = 1;

threadlocal var com_initialised = false;
var factory_ptr: ?*IWICImagingFactory = null;
var factory_once = std.once(loadFactory);

fn factory() error{BackendUnavailable}!*IWICImagingFactory {
    // COM apartment must be entered on the *calling* thread; the factory
    // itself is created once and shared (valid in the MTA).
    if (!com_initialised) {
        // S_OK or S_FALSE (already initialised) are both fine.
        if (CoInitializeEx(null, COINIT_MULTITHREADED) < 0) return error.BackendUnavailable;
        com_initialised = true;
    }
    factory_once.call();
    return factory_ptr orelse error.BackendUnavailable;
}

fn loadFactory() void {
    // Resolve the one flat C export first; if windowscodecs.dll isn't present
    // we never attempt CoCreateInstance and the whole backend stays disabled.
    const dll = bun.windows.LoadLibraryA("windowscodecs.dll") orelse return;
    const sym = bun.windows.GetProcAddressA(dll, "WICConvertBitmapSource") orelse return;
    wicConvertBitmapSource = @ptrCast(@alignCast(sym));

    var out: ?*anyopaque = null;
    if (CoCreateInstance(&CLSID_WICImagingFactory, null, CLSCTX_INPROC_SERVER, &IID_IWICImagingFactory, &out) < 0) return;
    factory_ptr = @ptrCast(@alignCast(out));
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
