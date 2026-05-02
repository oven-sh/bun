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
//!          → IStream::Seek(0,CUR) for the logical length
//!          → GetHGlobalFromStream → GlobalLock → dupe to default_allocator
//!
//! Thread-safety: WIC requires COM to be initialised on the calling thread.
//! Bun's image work runs on `WorkPool` threads with no prior COM init, so we
//! call `CoInitializeEx(COINIT_MULTITHREADED)` once per thread via a
//! threadlocal flag; MTA is fine for WIC and means the factory pointer can be
//! shared across pool threads.

pub const BackendError = codecs.Error || error{BackendUnavailable};

pub fn decode(bytes: []const u8, max_pixels: u64) BackendError!codecs.Decoded {
    const f = try factory();
    // IWICStream::InitializeFromMemory takes a DWORD count; Windows ships
    // ReleaseSafe so the @intCast below is a process abort, not silent
    // truncation. Drop to BackendUnavailable so codecs.decode() falls
    // through to the static decoder (bmp/gif) or surfaces UnsupportedOn
    // Platform (tiff/heic/avif) instead of crashing on a >4 GiB input.
    if (bytes.len > std.math.maxInt(u32)) return error.BackendUnavailable;

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

    // Compute stride/size in u64 first: with `maxPixels` raised past ~1.07B,
    // `w * 4` can wrap u32 (0x4000_0001×4 → 4) and Windows ships ReleaseSafe
    // so the @intCast below is a process abort, not silent truncation.
    const stride: u64 = @as(u64, w) * 4;
    const out_len: u64 = stride * h;
    // CopyPixels takes UINT byte-count + UINT stride — same DWORD ceiling.
    if (out_len > std.math.maxInt(u32)) return error.TooManyPixels;
    const out = try bun.default_allocator.alloc(u8, @intCast(out_len));
    errdefer bun.default_allocator.free(out);
    if (conv.?.vt.CopyPixels(conv.?, null, @intCast(stride), @intCast(out_len), out.ptr) < 0)
        return error.DecodeFailed;

    return .{ .rgba = out, .width = w, .height = h };
}

pub fn encode(rgba: []const u8, width: u32, height: u32, opts: codecs.EncodeOptions) BackendError![]u8 {
    // Punt to the static codecs for everything WIC can't express the same way:
    //   • palette PNG — WIC's PNG encoder won't quantise for us;
    //   • lossless WebP — Windows ships a WebP *decoder* only, and even where
    //     an encoder exists there's no lossless flag in the property bag;
    //   • JPEG/WebP/HEIC/AVIF quality — TODO: thread through IPropertyBag2
    //     "ImageQuality" (VT_R4 0..1) on the IPropertyBag2* returned by
    //     CreateNewFrame. Until that's wired, defer lossy formats so quality
    //     matches across platforms (JPEG/WebP fall through to the static
    //     codecs; HEIC/AVIF have no static fallback so they encode at WIC's
    //     default quality — that's accepted for now and noted in the docs).
    //   • PNG compressionLevel — WIC has no per-level zlib knob; fall through
    //     to libspng when the user set one.
    // That leaves WIC handling default-level PNG and (default-quality)
    // HEIC/AVIF.
    if (opts.format == .png and (opts.palette or opts.compression_level >= 0))
        return error.BackendUnavailable;
    if (opts.format == .webp or opts.format == .jpeg) return error.BackendUnavailable;
    // WritePixels takes a UINT byte count; encode is only reached for
    // heic/avif so this is the same maxPixels-raised edge as CopyPixels.
    if (rgba.len > std.math.maxInt(u32)) return error.BackendUnavailable;

    const f = try factory();

    var stream: ?*IUnknown = null;
    if (CreateStreamOnHGlobal(null, 1, &stream) < 0 or stream == null) return error.BackendUnavailable;
    defer release(stream);

    var enc: ?*IWICBitmapEncoder = null;
    // WINCODEC_ERR_COMPONENTNOTFOUND when the HEIF/AV1 store extension isn't
    // installed → BackendUnavailable so codecs.encode() falls through to
    // UnsupportedOnPlatform instead of a generic "encode failed".
    const guid = containerGuid(opts.format) orelse return error.BackendUnavailable;
    if (f.vt.CreateEncoder(f, guid, null, &enc) < 0 or enc == null)
        return error.BackendUnavailable;
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
    // SetPixelFormat is in/out — the codec rewrites `pf` to its native sink
    // (the HEIF encoder wants 32bppBGRA, not RGBA). When it doesn't move,
    // WritePixels straight from our buffer; when it does, wrap our RGBA as a
    // WIC bitmap, let WICConvertBitmapSource do the channel swap, and feed
    // the result via WriteSource. This is the documented dance; without it
    // .heic()/.avif() always rejected on Windows.
    var pf = GUID_WICPixelFormat32bppRGBA;
    if (frame.?.vt.SetPixelFormat(frame.?, &pf) < 0) return error.EncodeFailed;
    const stride: u32 = width * 4;
    if (std.meta.eql(pf, GUID_WICPixelFormat32bppRGBA)) {
        if (frame.?.vt.WritePixels(frame.?, height, stride, @intCast(rgba.len), rgba.ptr) < 0)
            return error.EncodeFailed;
    } else {
        var src: ?*IWICBitmapSource = null;
        if (f.vt.CreateBitmapFromMemory(f, width, height, &GUID_WICPixelFormat32bppRGBA, stride, @intCast(rgba.len), rgba.ptr, &src) < 0 or src == null)
            return error.EncodeFailed;
        defer release(src);
        const convertFn = wicConvertBitmapSource orelse return error.BackendUnavailable;
        var conv: ?*IWICBitmapSource = null;
        if (convertFn(&pf, src.?, &conv) < 0 or conv == null) return error.EncodeFailed;
        defer release(conv);
        if (frame.?.vt.WriteSource(frame.?, conv.?, null) < 0) return error.EncodeFailed;
    }
    if (frame.?.vt.Commit(frame.?) < 0) return error.EncodeFailed;
    if (enc.?.vt.Commit(enc.?) < 0) return error.EncodeFailed;

    // Logical length, not allocation size: GlobalSize() returns the HGLOBAL's
    // rounded-up allocation, which is ≥ what the encoder actually wrote and
    // would tack uninitialised heap bytes onto every output. The encoder writes
    // sequentially from offset 0 and never seeks back, so the stream's current
    // position IS the byte count. (MSDN GetHGlobalFromStream: "use IStream::Stat
    // to obtain the actual size".)
    const istream: *IStream = @ptrCast(@alignCast(stream.?));
    var pos: u64 = 0;
    if (istream.vt.Seek(istream, 0, STREAM_SEEK_CUR, &pos) < 0) return error.EncodeFailed;

    var hg: ?*anyopaque = null;
    if (GetHGlobalFromStream(stream.?, &hg) < 0 or hg == null) return error.EncodeFailed;
    const ptr: [*]const u8 = @ptrCast(GlobalLock(hg.?) orelse return error.EncodeFailed);
    defer _ = GlobalUnlock(hg.?);
    return try bun.default_allocator.dupe(u8, ptr[0..@intCast(pos)]);
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

/// Only `Seek` is typed — used to read the encoder stream's logical write
/// position (== bytes emitted) instead of the rounded-up `GlobalSize()`.
const IStream = extern struct {
    vt: *const VTable,
    // IStream : ISequentialStream(Read,Write) : IUnknown.
    const VTable = extern struct {
        unk: IUnknownVTable,
        Read: *const anyopaque,
        Write: *const anyopaque,
        Seek: *const fn (*IStream, dlibMove: i64, dwOrigin: u32, plibNewPosition: ?*u64) callconv(.winapi) HRESULT,
        // SetSize..Clone unused.
    };
};
const STREAM_SEEK_CUR: u32 = 1;

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
        CreateColorContext: *const anyopaque,
        CreateColorTransformer: *const anyopaque,
        CreateBitmap: *const anyopaque,
        CreateBitmapFromSource: *const anyopaque,
        CreateBitmapFromSourceRect: *const anyopaque,
        CreateBitmapFromMemory: *const fn (*IWICImagingFactory, u32, u32, *const GUID, u32, u32, [*]const u8, *?*IWICBitmapSource) callconv(.winapi) HRESULT,
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
        WriteSource: *const fn (*IWICBitmapFrameEncode, *IWICBitmapSource, ?*const anyopaque) callconv(.winapi) HRESULT,
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
const GUID_ContainerFormatHeif: GUID = .{ .d1 = 0xe1e62521, .d2 = 0x6787, .d3 = 0x405b, .d4 = .{ 0xa3, 0x39, 0x50, 0x07, 0x15, 0xb5, 0x76, 0x3f } };

fn containerGuid(f: codecs.Format) ?*const GUID {
    return switch (f) {
        .jpeg => &GUID_ContainerFormatJpeg,
        .png => &GUID_ContainerFormatPng,
        .webp => &GUID_ContainerFormatWebp,
        // WIC routes HEIC and AVIF through the same HEIF container; the
        // installed encoder (HEVC vs AV1) decides the codec. CreateEncoder
        // returns WINCODEC_ERR_COMPONENTNOTFOUND if the extension isn't
        // present, which surfaces as BackendUnavailable.
        .heic, .avif => &GUID_ContainerFormatHeif,
        // Decode-only formats — codecs.encode() short-circuits before this
        // path, so this arm exists for switch exhaustiveness only.
        .bmp, .tiff, .gif => null,
    };
}

// ───────────────────────────── lazy factory ─────────────────────────────────

extern "ole32" fn CoInitializeEx(reserved: ?*anyopaque, flags: u32) callconv(.winapi) HRESULT;
extern "ole32" fn CoCreateInstance(clsid: *const GUID, outer: ?*anyopaque, ctx: u32, iid: *const GUID, out: *?*anyopaque) callconv(.winapi) HRESULT;
extern "ole32" fn CreateStreamOnHGlobal(hglobal: ?*anyopaque, delete_on_release: c_int, out: *?*IUnknown) callconv(.winapi) HRESULT;
extern "ole32" fn GetHGlobalFromStream(stream: *IUnknown, out: *?*anyopaque) callconv(.winapi) HRESULT;
extern "kernel32" fn GlobalLock(h: *anyopaque) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn GlobalUnlock(h: *anyopaque) callconv(.winapi) c_int;

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

// ───────────────────────────── Win32 clipboard ──────────────────────────────
//
// JS-thread only — `OpenClipboard` is process-serialised and the static
// `fromClipboard()` accessor calls this synchronously, so no cross-thread
// HGLOBAL hand-off. We prefer the registered "PNG" format (Chrome/Edge/
// Snipping Tool put it; no transcode loss) and fall back to CF_DIBV5/CF_DIB,
// which we re-wrap as a BMP file by prepending the 14-byte BITMAPFILEHEADER
// the clipboard omits. Either way the result is bytes the regular Bun.Image
// decoder understands; nothing is decoded here.

extern "user32" fn OpenClipboard(hwnd: ?*anyopaque) callconv(.winapi) c_int;
extern "user32" fn CloseClipboard() callconv(.winapi) c_int;
extern "user32" fn IsClipboardFormatAvailable(format: c_uint) callconv(.winapi) c_int;
extern "user32" fn GetClipboardData(format: c_uint) callconv(.winapi) ?*anyopaque;
extern "user32" fn RegisterClipboardFormatA(name: [*:0]const u8) callconv(.winapi) c_uint;
extern "user32" fn GetClipboardSequenceNumber() callconv(.winapi) u32;
extern "kernel32" fn GlobalSize(h: *anyopaque) callconv(.winapi) usize;

const CF_DIB: c_uint = 8;
const CF_DIBV5: c_uint = 17;

/// Registered formats we'll take as-is (already a valid file). Preference
/// order matters: PNG/JFIF/WebP need no header surgery and preserve whatever
/// the source app wrote.
const named_formats = [_][:0]const u8{ "PNG", "image/png", "JFIF", "image/webp" };

pub fn clipboardChangeCount() i64 {
    return GetClipboardSequenceNumber();
}

pub fn hasClipboardImage() bool {
    // IsClipboardFormatAvailable doesn't require OpenClipboard.
    if (IsClipboardFormatAvailable(CF_DIBV5) != 0 or IsClipboardFormatAvailable(CF_DIB) != 0)
        return true;
    for (named_formats) |name| {
        const id = RegisterClipboardFormatA(name);
        if (id != 0 and IsClipboardFormatAvailable(id) != 0) return true;
    }
    return false;
}

pub fn clipboard() error{ BackendUnavailable, OutOfMemory }!?[]u8 {
    // hwnd=null associates the open with the current task; fine for read-only.
    if (OpenClipboard(null) == 0) return error.BackendUnavailable;
    defer _ = CloseClipboard();

    // 1. Registered file-format chunks — copy verbatim.
    for (named_formats) |name| {
        const id = RegisterClipboardFormatA(name);
        if (id != 0) if (GetClipboardData(id)) |h| if (try dupGlobal(h, 0)) |b| return b;
    }
    // 2. Packed DIB — needs a synthetic BITMAPFILEHEADER so the BMP sniffer
    //    and decoder accept it. CF_DIBV5 first (carries alpha mask). The
    //    clipboard is writable by any local process, so treat the payload as
    //    hostile: a 1-byte CF_DIB or a header with biSize≈u32::MAX must drop
    //    the format, not panic the process (Windows ships ReleaseSafe).
    for ([_]c_uint{ CF_DIBV5, CF_DIB }) |cf| {
        if (GetClipboardData(cf)) |h| if (try dupGlobal(h, 14)) |buf| {
            if (buf.len < 14 + 40 or buf.len > std.math.maxInt(u32)) {
                bun.default_allocator.free(buf);
                continue;
            }
            // BITMAPFILEHEADER: 'BM' · u32 file-size · 2×u16 reserved ·
            // u32 bfOffBits. bfOffBits = 14 + biSize + colour-table; for the
            // 24/32-bit DIBs clipboards emit there's no colour table, but a
            // 40-byte header with BI_BITFIELDS appends 12 bytes of masks.
            const ih_size: u64 = std.mem.readInt(u32, buf[14..18], .little);
            const compression = std.mem.readInt(u32, buf[14 + 16 ..][0..4], .little);
            const masks: u64 = if (ih_size == 40 and compression == 3) 12 else 0;
            const off = 14 + ih_size + masks;
            if (ih_size < 40 or off > buf.len) {
                bun.default_allocator.free(buf);
                continue;
            }
            buf[0] = 'B';
            buf[1] = 'M';
            std.mem.writeInt(u32, buf[2..6], @intCast(buf.len), .little);
            std.mem.writeInt(u32, buf[6..10], 0, .little);
            std.mem.writeInt(u32, buf[10..14], @intCast(off), .little);
            return buf;
        };
    }
    return null;
}

/// Copy a clipboard HGLOBAL into bun.default_allocator, optionally leaving
/// `prefix` zero bytes at the front for the caller to fill (BITMAPFILEHEADER).
fn dupGlobal(h: *anyopaque, comptime prefix: usize) error{OutOfMemory}!?[]u8 {
    const size = GlobalSize(h);
    if (size == 0) return null;
    const ptr: [*]const u8 = @ptrCast(GlobalLock(h) orelse return null);
    defer _ = GlobalUnlock(h);
    const out = try bun.default_allocator.alloc(u8, prefix + size);
    @memcpy(out[prefix..], ptr[0..size]);
    return out;
}

const bun = @import("bun");
const codecs = @import("./codecs.zig");
const std = @import("std");
