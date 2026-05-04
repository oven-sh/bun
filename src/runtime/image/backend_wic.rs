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

#![cfg(windows)]
#![allow(non_snake_case, non_upper_case_globals)]

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void, CStr};
use core::ptr;
use std::sync::Once;

use bun_runtime::image::codecs;
// TODO(port): move to runtime_sys / bun_sys::windows
use bun_sys::windows;

/// `codecs::Error || error{BackendUnavailable}`
// TODO(port): narrow error set — Zig flat-unions codecs::Error with BackendUnavailable;
// variants used in this file are inlined here. Phase B should reconcile with codecs::Error.
#[derive(Debug, Copy, Clone, Eq, PartialEq, thiserror::Error, strum::IntoStaticStr)]
pub enum BackendError {
    #[error("BackendUnavailable")]
    BackendUnavailable,
    #[error("DecodeFailed")]
    DecodeFailed,
    #[error("EncodeFailed")]
    EncodeFailed,
    #[error("TooManyPixels")]
    TooManyPixels,
    #[error("OutOfMemory")]
    OutOfMemory,
}
use BackendError::*;

impl From<BackendError> for bun_core::Error {
    fn from(e: BackendError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, BackendError> {
    let f = factory()?;
    // IWICStream::InitializeFromMemory takes a DWORD count; Windows ships
    // ReleaseSafe so the @intCast below is a process abort, not silent
    // truncation. Drop to BackendUnavailable so codecs.decode() falls
    // through to the static decoder (bmp/gif) or surfaces UnsupportedOn
    // Platform (tiff/heic/avif) instead of crashing on a >4 GiB input.
    if bytes.len() as u64 > u32::MAX as u64 {
        return Err(BackendUnavailable);
    }

    let mut stream: *mut IWICStream = ptr::null_mut();
    // SAFETY: f is a live COM factory from factory(); out-param is a valid *mut *mut.
    if unsafe { ((*(*f).vt).CreateStream)(f, &mut stream) } < 0 || stream.is_null() {
        return Err(BackendUnavailable);
    }
    scopeguard::defer! { release(stream); }
    // SAFETY: stream is non-null (checked above); bytes outlives this call.
    if unsafe {
        ((*(*stream).vt).InitializeFromMemory)(stream, bytes.as_ptr(), u32::try_from(bytes.len()).unwrap())
    } < 0
    {
        return Err(DecodeFailed);
    }

    let mut dec: *mut IWICBitmapDecoder = ptr::null_mut();
    // WICDecodeMetadataCacheOnDemand = 0. vendor GUID null = let WIC pick.
    // SAFETY: f and stream are live COM ptrs; stream upcasts to IUnknown by layout.
    if unsafe {
        ((*(*f).vt).CreateDecoderFromStream)(f, stream as *mut IUnknown, ptr::null(), 0, &mut dec)
    } < 0
        || dec.is_null()
    {
        return Err(DecodeFailed);
    }
    scopeguard::defer! { release(dec); }

    let mut frame: *mut IWICBitmapSource = ptr::null_mut();
    // SAFETY: dec is non-null (checked above).
    if unsafe { ((*(*dec).vt).GetFrame)(dec, 0, &mut frame) } < 0 || frame.is_null() {
        return Err(DecodeFailed);
    }
    scopeguard::defer! { release(frame); }

    let mut w: u32 = 0;
    let mut h: u32 = 0;
    // SAFETY: frame is non-null; out-params are valid.
    if unsafe { ((*(*frame).vt).GetSize)(frame, &mut w, &mut h) } < 0 || w == 0 || h == 0 {
        return Err(DecodeFailed);
    }
    if (w as u64) * (h as u64) > max_pixels {
        return Err(TooManyPixels);
    }

    // WIC frames come in whatever pixel format the codec emits; normalise to
    // straight-alpha RGBA8 in one hop.
    // SAFETY: read-only after FACTORY_ONCE has run (factory() returned Ok).
    let convert_fn = unsafe { wicConvertBitmapSource }.ok_or(BackendUnavailable)?;
    let mut conv: *mut IWICBitmapSource = ptr::null_mut();
    // SAFETY: convert_fn resolved from windowscodecs.dll; frame is non-null.
    if unsafe { convert_fn(&GUID_WICPixelFormat32bppRGBA, frame, &mut conv) } < 0 || conv.is_null()
    {
        return Err(DecodeFailed);
    }
    scopeguard::defer! { release(conv); }

    // Compute stride/size in u64 first: with `maxPixels` raised past ~1.07B,
    // `w * 4` can wrap u32 (0x4000_0001×4 → 4) and Windows ships ReleaseSafe
    // so the @intCast below is a process abort, not silent truncation.
    let stride: u64 = (w as u64) * 4;
    let out_len: u64 = stride * (h as u64);
    // CopyPixels takes UINT byte-count + UINT stride — same DWORD ceiling.
    if out_len > u32::MAX as u64 {
        return Err(TooManyPixels);
    }
    // PERF(port): was uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; usize::try_from(out_len).unwrap()];
    // (errdefer free(out) deleted — Vec drops on `?`/early return)
    // SAFETY: conv is non-null; out has out_len bytes of capacity.
    if unsafe {
        ((*(*conv).vt).CopyPixels)(
            conv,
            ptr::null(),
            u32::try_from(stride).unwrap(),
            u32::try_from(out_len).unwrap(),
            out.as_mut_ptr(),
        )
    } < 0
    {
        return Err(DecodeFailed);
    }

    Ok(codecs::Decoded { rgba: out, width: w, height: h })
}

pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    opts: codecs::EncodeOptions,
) -> Result<Vec<u8>, BackendError> {
    // Punt to the static codecs for everything WIC can't express the same way:
    //   • palette PNG — WIC's PNG encoder won't quantise for us;
    //   • lossless WebP — Windows ships a WebP *decoder* only, and even where
    //     an encoder exists there's no lossless flag in the property bag;
    // codecs.encode() only routes .heic/.avif here; jpeg/png/webp use the
    // static codecs unconditionally so output (and the quality scale) is
    // identical across platforms.
    debug_assert!(opts.format == codecs::Format::Heic || opts.format == codecs::Format::Avif);
    // WritePixels/WriteSource take a UINT byte count — same DWORD ceiling
    // as CopyPixels (maxPixels-raised edge).
    if rgba.len() as u64 > u32::MAX as u64 {
        return Err(BackendUnavailable);
    }

    let f = factory()?;

    let mut stream: *mut IUnknown = ptr::null_mut();
    // SAFETY: out-param is valid; null hglobal = let COM allocate.
    if unsafe { CreateStreamOnHGlobal(ptr::null_mut(), 1, &mut stream) } < 0 || stream.is_null() {
        return Err(BackendUnavailable);
    }
    scopeguard::defer! { release(stream); }

    let mut enc: *mut IWICBitmapEncoder = ptr::null_mut();
    // WINCODEC_ERR_COMPONENTNOTFOUND when the HEIF/AV1 store extension isn't
    // installed → BackendUnavailable so codecs.encode() falls through to
    // UnsupportedOnPlatform instead of a generic "encode failed".
    let guid = container_guid(opts.format).ok_or(BackendUnavailable)?;
    // SAFETY: f is live; guid points to static; out-param valid.
    if unsafe { ((*(*f).vt).CreateEncoder)(f, guid, ptr::null(), &mut enc) } < 0 || enc.is_null() {
        return Err(BackendUnavailable);
    }
    scopeguard::defer! { release(enc); }
    // WICBitmapEncoderNoCache = 2.
    // SAFETY: enc and stream are non-null.
    if unsafe { ((*(*enc).vt).Initialize)(enc, stream, 2) } < 0 {
        return Err(EncodeFailed);
    }

    let mut frame: *mut IWICBitmapFrameEncode = ptr::null_mut();
    let mut props: *mut IUnknown = ptr::null_mut();
    // SAFETY: enc is non-null; out-params valid.
    if unsafe { ((*(*enc).vt).CreateNewFrame)(enc, &mut frame, &mut props) } < 0 || frame.is_null()
    {
        return Err(EncodeFailed);
    }
    scopeguard::defer! { release(frame); }
    scopeguard::defer! { release(props); }

    // Thread `quality` and the HEIF sub-codec through the IPropertyBag2 the
    // encoder hands back. Both go via the C++ shim so the SDK's own VARIANT/
    // PROPBAG2 layout is authoritative. ImageQuality (VT_R4 [0,1]) is best-
    // effort; HeifCompressionMethod is load-bearing — see the comment on the
    // constant — so a Write failure on it means the codec doesn't recognise
    // the option (pre-21H2 encoder, or AV1 extension missing) and we surface
    // BackendUnavailable → UnsupportedOnPlatform instead of risking the
    // wrong container.
    // SAFETY: props may be null (shim must tolerate); name is static NUL-terminated UTF-16.
    let _ = unsafe {
        bun_wic_propbag_write_f32(
            props as *mut c_void,
            bun_str::w!("ImageQuality").as_ptr(),
            (opts.quality as f32) / 100.0,
        )
    };
    let method: u8 = if opts.format == codecs::Format::Avif {
        WICHeifCompressionAV1
    } else {
        WICHeifCompressionHEVC
    };
    // SAFETY: same as above.
    if unsafe {
        bun_wic_propbag_write_u8(
            props as *mut c_void,
            bun_str::w!("HeifCompressionMethod").as_ptr(),
            method,
        )
    } == 0
    {
        return Err(BackendUnavailable);
    }
    // SAFETY: frame is non-null; props may be null.
    if unsafe { ((*(*frame).vt).Initialize)(frame, props) } < 0 {
        return Err(EncodeFailed);
    }
    // SAFETY: frame is non-null.
    if unsafe { ((*(*frame).vt).SetSize)(frame, width, height) } < 0 {
        return Err(EncodeFailed);
    }
    // SetPixelFormat is in/out — the codec rewrites `pf` to its native sink
    // (the HEIF encoder wants 32bppBGRA, not RGBA). When it doesn't move,
    // WritePixels straight from our buffer; when it does, wrap our RGBA as a
    // WIC bitmap, let WICConvertBitmapSource do the channel swap, and feed
    // the result via WriteSource. This is the documented dance; without it
    // .heic()/.avif() always rejected on Windows.
    let mut pf = GUID_WICPixelFormat32bppRGBA;
    // SAFETY: frame is non-null; pf is a valid in/out GUID.
    if unsafe { ((*(*frame).vt).SetPixelFormat)(frame, &mut pf) } < 0 {
        return Err(EncodeFailed);
    }
    let stride: u32 = width * 4;
    if pf == GUID_WICPixelFormat32bppRGBA {
        // SAFETY: frame is non-null; rgba.len() fits u32 (checked above).
        if unsafe {
            ((*(*frame).vt).WritePixels)(frame, height, stride, u32::try_from(rgba.len()).unwrap(), rgba.as_ptr())
        } < 0
        {
            return Err(EncodeFailed);
        }
    } else {
        let mut src: *mut IWICBitmapSource = ptr::null_mut();
        // SAFETY: f is live; rgba outlives the bitmap (released below before return).
        if unsafe {
            ((*(*f).vt).CreateBitmapFromMemory)(
                f,
                width,
                height,
                &GUID_WICPixelFormat32bppRGBA,
                stride,
                u32::try_from(rgba.len()).unwrap(),
                rgba.as_ptr(),
                &mut src,
            )
        } < 0
            || src.is_null()
        {
            return Err(EncodeFailed);
        }
        scopeguard::defer! { release(src); }
        // SAFETY: read-only after FACTORY_ONCE has run.
        let convert_fn = unsafe { wicConvertBitmapSource }.ok_or(BackendUnavailable)?;
        let mut conv: *mut IWICBitmapSource = ptr::null_mut();
        // SAFETY: convert_fn resolved; src is non-null; pf is the codec's chosen format.
        if unsafe { convert_fn(&pf, src, &mut conv) } < 0 || conv.is_null() {
            return Err(EncodeFailed);
        }
        scopeguard::defer! { release(conv); }
        // SAFETY: frame and conv are non-null.
        if unsafe { ((*(*frame).vt).WriteSource)(frame, conv, ptr::null()) } < 0 {
            return Err(EncodeFailed);
        }
    }
    // SAFETY: frame is non-null.
    if unsafe { ((*(*frame).vt).Commit)(frame) } < 0 {
        return Err(EncodeFailed);
    }
    // SAFETY: enc is non-null.
    if unsafe { ((*(*enc).vt).Commit)(enc) } < 0 {
        return Err(EncodeFailed);
    }

    // Logical length, not allocation size: GlobalSize() returns the HGLOBAL's
    // rounded-up allocation, which is ≥ what the encoder actually wrote and
    // would tack uninitialised heap bytes onto every output. The encoder writes
    // sequentially from offset 0 and never seeks back, so the stream's current
    // position IS the byte count. (MSDN GetHGlobalFromStream: "use IStream::Stat
    // to obtain the actual size".)
    let istream = stream as *mut IStream;
    let mut pos: u64 = 0;
    // SAFETY: stream is a live IStream (CreateStreamOnHGlobal); same object, vtable-prefix cast.
    if unsafe { ((*(*istream).vt).Seek)(istream, 0, STREAM_SEEK_CUR, &mut pos) } < 0 {
        return Err(EncodeFailed);
    }

    let mut hg: *mut c_void = ptr::null_mut();
    // SAFETY: stream is non-null.
    if unsafe { GetHGlobalFromStream(stream, &mut hg) } < 0 || hg.is_null() {
        return Err(EncodeFailed);
    }
    // SAFETY: hg is non-null.
    let ptr_ = unsafe { GlobalLock(hg) };
    if ptr_.is_null() {
        return Err(EncodeFailed);
    }
    let ptr_ = ptr_ as *const u8;
    scopeguard::defer! {
        // SAFETY: hg is a locked HGLOBAL.
        let _ = unsafe { GlobalUnlock(hg) };
    }
    // SAFETY: ptr_ points to `pos` valid bytes inside the locked HGLOBAL.
    let slice = unsafe { core::slice::from_raw_parts(ptr_, usize::try_from(pos).unwrap()) };
    Ok(slice.to_vec())
}

// ───────────────────────────── COM scaffolding ──────────────────────────────
//
// A COM interface pointer is `*{ *const VTable }` — exactly one pointer in the
// object, and the vtable lays out IUnknown's three slots first, then each
// parent interface's slots, then the interface's own. Only slots we call are
// typed; the rest are `*const c_void` placeholders so offsets stay correct.

type HRESULT = i32;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct GUID {
    d1: u32,
    d2: u16,
    d3: u16,
    d4: [u8; 8],
}

#[repr(C)]
struct IUnknownVTable {
    QueryInterface:
        unsafe extern "system" fn(*mut IUnknown, *const GUID, *mut *mut c_void) -> HRESULT,
    AddRef: unsafe extern "system" fn(*mut IUnknown) -> u32,
    Release: unsafe extern "system" fn(*mut IUnknown) -> u32,
}

#[repr(C)]
struct IUnknown {
    vt: *const IUnknownVTable,
}

/// VARIANT/PROPBAG2 layout is fiddly enough (union padding, BRECORD/DECIMAL
/// arms) that hand-rolling it as `extern struct` is asking for an ABI drift.
/// The C++ shim uses the SDK's own headers; we just hand it the bag pointer.
// TODO(port): move to runtime_sys
unsafe extern "C" {
    fn bun_wic_propbag_write_f32(props: *mut c_void, name: *const u16, value: f32) -> i32;
    fn bun_wic_propbag_write_u8(props: *mut c_void, name: *const u16, value: u8) -> i32;
}

/// WICHeifCompressionOption — the encoder defaults to `DontCare` (= picks
/// whichever codec extension is installed), so without this `.avif()` could
/// silently emit HEIC on a machine with only the HEVC extension.
const WICHeifCompressionHEVC: u8 = 2;
const WICHeifCompressionAV1: u8 = 3;

/// Only `Seek` is typed — used to read the encoder stream's logical write
/// position (== bytes emitted) instead of the rounded-up `GlobalSize()`.
#[repr(C)]
struct IStream {
    vt: *const IStreamVTable,
}
// IStream : ISequentialStream(Read,Write) : IUnknown.
#[repr(C)]
struct IStreamVTable {
    unk: IUnknownVTable,
    Read: *const c_void,
    Write: *const c_void,
    Seek: unsafe extern "system" fn(
        *mut IStream,
        dlibMove: i64,
        dwOrigin: u32,
        plibNewPosition: *mut u64,
    ) -> HRESULT,
    // SetSize..Clone unused.
}
const STREAM_SEEK_CUR: u32 = 1;

/// Generic Release through the IUnknown slots — every COM pointer is
/// layout-compatible with `*IUnknown`.
#[inline]
fn release<T>(p: *mut T) {
    if !p.is_null() {
        let unk = p as *mut IUnknown;
        // SAFETY: every COM interface vtable begins with IUnknownVTable;
        // p was returned by a COM creation call and not yet released.
        unsafe {
            let _ = ((*(*unk).vt).Release)(unk);
        }
    }
}

#[repr(C)]
struct IWICImagingFactory {
    vt: *const IWICImagingFactoryVTable,
}
#[repr(C)]
struct IWICImagingFactoryVTable {
    unk: IUnknownVTable,
    CreateDecoderFromFilename: *const c_void,
    CreateDecoderFromStream: unsafe extern "system" fn(
        *mut IWICImagingFactory,
        *mut IUnknown,
        *const GUID,
        u32,
        *mut *mut IWICBitmapDecoder,
    ) -> HRESULT,
    CreateDecoderFromFileHandle: *const c_void,
    CreateComponentInfo: *const c_void,
    CreateDecoder: *const c_void,
    CreateEncoder: unsafe extern "system" fn(
        *mut IWICImagingFactory,
        *const GUID,
        *const GUID,
        *mut *mut IWICBitmapEncoder,
    ) -> HRESULT,
    CreatePalette: *const c_void,
    CreateFormatConverter: *const c_void,
    CreateBitmapScaler: *const c_void,
    CreateBitmapClipper: *const c_void,
    CreateBitmapFlipRotator: *const c_void,
    CreateStream:
        unsafe extern "system" fn(*mut IWICImagingFactory, *mut *mut IWICStream) -> HRESULT,
    CreateColorContext: *const c_void,
    CreateColorTransformer: *const c_void,
    CreateBitmap: *const c_void,
    CreateBitmapFromSource: *const c_void,
    CreateBitmapFromSourceRect: *const c_void,
    CreateBitmapFromMemory: unsafe extern "system" fn(
        *mut IWICImagingFactory,
        u32,
        u32,
        *const GUID,
        u32,
        u32,
        *const u8,
        *mut *mut IWICBitmapSource,
    ) -> HRESULT,
    // …remaining slots unused.
}

#[repr(C)]
struct IWICStream {
    vt: *const IWICStreamVTable,
}
// IWICStream : IStream(9) : ISequentialStream(2) : IUnknown(3).
#[repr(C)]
struct IWICStreamVTable {
    unk: IUnknownVTable,
    seq: [*const c_void; 2],     // Read, Write
    istream: [*const c_void; 9], // Seek..Clone
    InitializeFromIStream: *const c_void,
    InitializeFromFilename: *const c_void,
    InitializeFromMemory: unsafe extern "system" fn(*mut IWICStream, *const u8, u32) -> HRESULT,
    InitializeFromIStreamRegion: *const c_void,
}

#[repr(C)]
struct IWICBitmapDecoder {
    vt: *const IWICBitmapDecoderVTable,
}
#[repr(C)]
struct IWICBitmapDecoderVTable {
    unk: IUnknownVTable,
    QueryCapability: *const c_void,
    Initialize: *const c_void,
    GetContainerFormat: *const c_void,
    GetDecoderInfo: *const c_void,
    CopyPalette: *const c_void,
    GetMetadataQueryReader: *const c_void,
    GetPreview: *const c_void,
    GetColorContexts: *const c_void,
    GetThumbnail: *const c_void,
    GetFrameCount: *const c_void,
    GetFrame: unsafe extern "system" fn(
        *mut IWICBitmapDecoder,
        u32,
        *mut *mut IWICBitmapSource,
    ) -> HRESULT,
}

/// IWICBitmapSource is the lowest common decode interface — both
/// IWICBitmapFrameDecode and IWICFormatConverter expose it as a prefix.
#[repr(C)]
struct IWICBitmapSource {
    vt: *const IWICBitmapSourceVTable,
}
#[repr(C)]
struct IWICBitmapSourceVTable {
    unk: IUnknownVTable,
    GetSize: unsafe extern "system" fn(*mut IWICBitmapSource, *mut u32, *mut u32) -> HRESULT,
    GetPixelFormat: *const c_void,
    GetResolution: *const c_void,
    CopyPalette: *const c_void,
    CopyPixels:
        unsafe extern "system" fn(*mut IWICBitmapSource, *const c_void, u32, u32, *mut u8) -> HRESULT,
}

#[repr(C)]
struct IWICBitmapEncoder {
    vt: *const IWICBitmapEncoderVTable,
}
#[repr(C)]
struct IWICBitmapEncoderVTable {
    unk: IUnknownVTable,
    Initialize: unsafe extern "system" fn(*mut IWICBitmapEncoder, *mut IUnknown, u32) -> HRESULT,
    GetContainerFormat: *const c_void,
    GetEncoderInfo: *const c_void,
    SetColorContexts: *const c_void,
    SetPalette: *const c_void,
    SetThumbnail: *const c_void,
    SetPreview: *const c_void,
    CreateNewFrame: unsafe extern "system" fn(
        *mut IWICBitmapEncoder,
        *mut *mut IWICBitmapFrameEncode,
        *mut *mut IUnknown,
    ) -> HRESULT,
    Commit: unsafe extern "system" fn(*mut IWICBitmapEncoder) -> HRESULT,
    // GetMetadataQueryWriter unused.
}

#[repr(C)]
struct IWICBitmapFrameEncode {
    vt: *const IWICBitmapFrameEncodeVTable,
}
#[repr(C)]
struct IWICBitmapFrameEncodeVTable {
    unk: IUnknownVTable,
    Initialize: unsafe extern "system" fn(*mut IWICBitmapFrameEncode, *mut IUnknown) -> HRESULT,
    SetSize: unsafe extern "system" fn(*mut IWICBitmapFrameEncode, u32, u32) -> HRESULT,
    SetResolution: *const c_void,
    SetPixelFormat: unsafe extern "system" fn(*mut IWICBitmapFrameEncode, *mut GUID) -> HRESULT,
    SetColorContexts: *const c_void,
    SetPalette: *const c_void,
    SetThumbnail: *const c_void,
    WritePixels:
        unsafe extern "system" fn(*mut IWICBitmapFrameEncode, u32, u32, u32, *const u8) -> HRESULT,
    WriteSource: unsafe extern "system" fn(
        *mut IWICBitmapFrameEncode,
        *mut IWICBitmapSource,
        *const c_void,
    ) -> HRESULT,
    Commit: unsafe extern "system" fn(*mut IWICBitmapFrameEncode) -> HRESULT,
    // GetMetadataQueryWriter unused.
}

// ───────────────────────────── GUIDs ────────────────────────────────────────

const CLSID_WICImagingFactory: GUID = GUID {
    d1: 0xcacaf262,
    d2: 0x9370,
    d3: 0x4615,
    d4: [0xa1, 0x3b, 0x9f, 0x55, 0x39, 0xda, 0x4c, 0x0a],
};
const IID_IWICImagingFactory: GUID = GUID {
    d1: 0xec5ec8a9,
    d2: 0xc395,
    d3: 0x4314,
    d4: [0x9c, 0x77, 0x54, 0xd7, 0xa9, 0x35, 0xff, 0x70],
};
const GUID_WICPixelFormat32bppRGBA: GUID = GUID {
    d1: 0xf5c7ad2d,
    d2: 0x6a8d,
    d3: 0x43dd,
    d4: [0xa7, 0xa8, 0xa2, 0x99, 0x35, 0x26, 0x1a, 0xe9],
};
const GUID_ContainerFormatJpeg: GUID = GUID {
    d1: 0x19e4a5aa,
    d2: 0x5662,
    d3: 0x4fc5,
    d4: [0xa0, 0xc0, 0x17, 0x58, 0x02, 0x8e, 0x10, 0x57],
};
const GUID_ContainerFormatPng: GUID = GUID {
    d1: 0x1b7cfaf4,
    d2: 0x713f,
    d3: 0x473c,
    d4: [0xbb, 0xcd, 0x61, 0x37, 0x42, 0x5f, 0xae, 0xaf],
};
const GUID_ContainerFormatWebp: GUID = GUID {
    d1: 0xe094b0e2,
    d2: 0x67f2,
    d3: 0x45b3,
    d4: [0xb0, 0xea, 0x11, 0x53, 0x37, 0xca, 0x7c, 0xf3],
};
const GUID_ContainerFormatHeif: GUID = GUID {
    d1: 0xe1e62521,
    d2: 0x6787,
    d3: 0x405b,
    d4: [0xa3, 0x39, 0x50, 0x07, 0x15, 0xb5, 0x76, 0x3f],
};

fn container_guid(f: codecs::Format) -> Option<*const GUID> {
    use codecs::Format::*;
    match f {
        Jpeg => Some(&GUID_ContainerFormatJpeg),
        Png => Some(&GUID_ContainerFormatPng),
        Webp => Some(&GUID_ContainerFormatWebp),
        // WIC routes HEIC and AVIF through the same HEIF container; the
        // installed encoder (HEVC vs AV1) decides the codec. CreateEncoder
        // returns WINCODEC_ERR_COMPONENTNOTFOUND if the extension isn't
        // present, which surfaces as BackendUnavailable.
        Heic | Avif => Some(&GUID_ContainerFormatHeif),
        // Decode-only formats — codecs.encode() short-circuits before this
        // path, so this arm exists for switch exhaustiveness only.
        Bmp | Tiff | Gif => None,
    }
}

// ───────────────────────────── lazy factory ─────────────────────────────────

// TODO(port): move to runtime_sys
#[link(name = "ole32")]
unsafe extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> HRESULT;
    fn CoCreateInstance(
        clsid: *const GUID,
        outer: *mut c_void,
        ctx: u32,
        iid: *const GUID,
        out: *mut *mut c_void,
    ) -> HRESULT;
    fn CreateStreamOnHGlobal(
        hglobal: *mut c_void,
        delete_on_release: c_int,
        out: *mut *mut IUnknown,
    ) -> HRESULT;
    fn GetHGlobalFromStream(stream: *mut IUnknown, out: *mut *mut c_void) -> HRESULT;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalLock(h: *mut c_void) -> *mut c_void;
    fn GlobalUnlock(h: *mut c_void) -> c_int;
}

/// `WICConvertBitmapSource` is the one flat export from windowscodecs.dll we
/// need. Loaded lazily (LoadLibraryA inside `loadFactory`) so the binary
/// carries no import-table dependency on windowscodecs — nano-server / stripped
/// containers without the WIC feature still launch and just fall back.
type WICConvertBitmapSourceFn = unsafe extern "system" fn(
    dst_fmt: *const GUID,
    src: *mut IWICBitmapSource,
    out: *mut *mut IWICBitmapSource,
) -> HRESULT;
// SAFETY: written once under FACTORY_ONCE, read-only thereafter.
static mut wicConvertBitmapSource: Option<WICConvertBitmapSourceFn> = None;

const COINIT_MULTITHREADED: u32 = 0;
const CLSCTX_INPROC_SERVER: u32 = 1;

thread_local! {
    static COM_INITIALISED: Cell<bool> = const { Cell::new(false) };
}
// SAFETY: written once under FACTORY_ONCE, read-only thereafter.
static mut FACTORY_PTR: *mut IWICImagingFactory = ptr::null_mut();
static FACTORY_ONCE: Once = Once::new();

fn factory() -> Result<*mut IWICImagingFactory, BackendError> {
    // COM apartment must be entered on the *calling* thread; the factory
    // itself is created once and shared (valid in the MTA).
    if !COM_INITIALISED.get() {
        // S_OK or S_FALSE (already initialised) are both fine.
        // SAFETY: COINIT_MULTITHREADED with null reserved is the documented form.
        if unsafe { CoInitializeEx(ptr::null_mut(), COINIT_MULTITHREADED) } < 0 {
            return Err(BackendUnavailable);
        }
        COM_INITIALISED.set(true);
    }
    FACTORY_ONCE.call_once(load_factory);
    // SAFETY: FACTORY_PTR is only written inside FACTORY_ONCE; happens-before via call_once.
    let p = unsafe { FACTORY_PTR };
    if p.is_null() {
        Err(BackendUnavailable)
    } else {
        Ok(p)
    }
}

fn load_factory() {
    // Resolve the one flat C export first; if windowscodecs.dll isn't present
    // we never attempt CoCreateInstance and the whole backend stays disabled.
    // SAFETY: literal C string; LoadLibraryA is safe to call from any thread.
    let Some(dll) = (unsafe { windows::LoadLibraryA(c"windowscodecs.dll".as_ptr()) }) else {
        return;
    };
    // SAFETY: dll is a valid HMODULE.
    let Some(sym) = (unsafe { windows::GetProcAddressA(dll, c"WICConvertBitmapSource".as_ptr()) })
    else {
        return;
    };
    // SAFETY: write under FACTORY_ONCE; sym is the export of WICConvertBitmapSource.
    unsafe {
        wicConvertBitmapSource = Some(core::mem::transmute::<_, WICConvertBitmapSourceFn>(sym));
    }

    let mut out: *mut c_void = ptr::null_mut();
    // SAFETY: GUIDs are static; out is a valid out-param.
    if unsafe {
        CoCreateInstance(
            &CLSID_WICImagingFactory,
            ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_IWICImagingFactory,
            &mut out,
        )
    } < 0
    {
        return;
    }
    // SAFETY: write under FACTORY_ONCE.
    unsafe {
        FACTORY_PTR = out as *mut IWICImagingFactory;
    }
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

// TODO(port): move to runtime_sys
#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(hwnd: *mut c_void) -> c_int;
    fn CloseClipboard() -> c_int;
    fn IsClipboardFormatAvailable(format: c_uint) -> c_int;
    fn GetClipboardData(format: c_uint) -> *mut c_void;
    fn RegisterClipboardFormatA(name: *const core::ffi::c_char) -> c_uint;
    fn GetClipboardSequenceNumber() -> u32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalSize(h: *mut c_void) -> usize;
}

const CF_DIB: c_uint = 8;
const CF_DIBV5: c_uint = 17;

/// Registered formats we'll take as-is (already a valid file). Preference
/// order matters: PNG/JFIF/WebP need no header surgery and preserve whatever
/// the source app wrote.
const NAMED_FORMATS: [&CStr; 4] = [c"PNG", c"image/png", c"JFIF", c"image/webp"];

pub fn clipboard_change_count() -> i64 {
    // SAFETY: GetClipboardSequenceNumber has no preconditions.
    unsafe { GetClipboardSequenceNumber() as i64 }
}

pub fn has_clipboard_image() -> bool {
    // IsClipboardFormatAvailable doesn't require OpenClipboard.
    // SAFETY: no preconditions.
    if unsafe { IsClipboardFormatAvailable(CF_DIBV5) } != 0
        || unsafe { IsClipboardFormatAvailable(CF_DIB) } != 0
    {
        return true;
    }
    for name in NAMED_FORMATS {
        // SAFETY: name is a static NUL-terminated C string.
        let id = unsafe { RegisterClipboardFormatA(name.as_ptr()) };
        // SAFETY: no preconditions.
        if id != 0 && unsafe { IsClipboardFormatAvailable(id) } != 0 {
            return true;
        }
    }
    false
}

// TODO(port): narrow error set — Zig: error{BackendUnavailable, OutOfMemory}!?[]u8
pub fn clipboard() -> Result<Option<Vec<u8>>, BackendError> {
    // hwnd=null associates the open with the current task; fine for read-only.
    // SAFETY: null hwnd is documented as valid.
    if unsafe { OpenClipboard(ptr::null_mut()) } == 0 {
        return Err(BackendUnavailable);
    }
    scopeguard::defer! {
        // SAFETY: clipboard is open.
        let _ = unsafe { CloseClipboard() };
    }

    // 1. Registered file-format chunks — copy verbatim.
    for name in NAMED_FORMATS {
        // SAFETY: name is a static NUL-terminated C string.
        let id = unsafe { RegisterClipboardFormatA(name.as_ptr()) };
        if id != 0 {
            // SAFETY: clipboard is open.
            let h = unsafe { GetClipboardData(id) };
            if !h.is_null() {
                if let Some(b) = dup_global::<0>(h)? {
                    return Ok(Some(b));
                }
            }
        }
    }
    // 2. Packed DIB — needs a synthetic BITMAPFILEHEADER so the BMP sniffer
    //    and decoder accept it. CF_DIBV5 first (carries alpha mask). The
    //    clipboard is writable by any local process, so treat the payload as
    //    hostile: a 1-byte CF_DIB or a header with biSize≈u32::MAX must drop
    //    the format, not panic the process (Windows ships ReleaseSafe).
    for cf in [CF_DIBV5, CF_DIB] {
        // SAFETY: clipboard is open.
        let h = unsafe { GetClipboardData(cf) };
        if h.is_null() {
            continue;
        }
        let Some(mut buf) = dup_global::<14>(h)? else {
            continue;
        };
        if buf.len() < 14 + 40 || buf.len() as u64 > u32::MAX as u64 {
            // (free(buf) deleted — Vec drops on continue)
            continue;
        }
        // BITMAPFILEHEADER: 'BM' · u32 file-size · 2×u16 reserved ·
        // u32 bfOffBits. bfOffBits = 14 + biSize + colour-table; for the
        // 24/32-bit DIBs clipboards emit there's no colour table, but a
        // 40-byte header with BI_BITFIELDS appends 12 bytes of masks.
        let ih_size: u64 = u32::from_le_bytes(buf[14..18].try_into().unwrap()) as u64;
        let compression =
            u32::from_le_bytes(buf[14 + 16..14 + 16 + 4].try_into().unwrap());
        let masks: u64 = if ih_size == 40 && compression == 3 { 12 } else { 0 };
        let off = 14 + ih_size + masks;
        if ih_size < 40 || off > buf.len() as u64 {
            continue;
        }
        buf[0] = b'B';
        buf[1] = b'M';
        buf[2..6].copy_from_slice(&u32::try_from(buf.len()).unwrap().to_le_bytes());
        buf[6..10].copy_from_slice(&0u32.to_le_bytes());
        buf[10..14].copy_from_slice(&u32::try_from(off).unwrap().to_le_bytes());
        return Ok(Some(buf));
    }
    Ok(None)
}

/// Copy a clipboard HGLOBAL into the global allocator, optionally leaving
/// `PREFIX` zero bytes at the front for the caller to fill (BITMAPFILEHEADER).
fn dup_global<const PREFIX: usize>(h: *mut c_void) -> Result<Option<Vec<u8>>, bun_alloc::AllocError> {
    // SAFETY: h is a non-null HGLOBAL from GetClipboardData.
    let size = unsafe { GlobalSize(h) };
    if size == 0 {
        return Ok(None);
    }
    // SAFETY: h is a non-null HGLOBAL.
    let ptr_ = unsafe { GlobalLock(h) };
    if ptr_.is_null() {
        return Ok(None);
    }
    let ptr_ = ptr_ as *const u8;
    scopeguard::defer! {
        // SAFETY: h is locked.
        let _ = unsafe { GlobalUnlock(h) };
    }
    // PERF(port): was uninitialized alloc — profile in Phase B
    let mut out = vec![0u8; PREFIX + size];
    // SAFETY: ptr_ points to `size` valid bytes inside the locked HGLOBAL.
    out[PREFIX..].copy_from_slice(unsafe { core::slice::from_raw_parts(ptr_, size) });
    Ok(Some(out))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/backend_wic.zig (514 lines)
//   confidence: medium
//   todos:      6
//   notes:      Heavy COM FFI; defer→scopeguard for Release; static mut globals guarded by Once; BackendError flattened from codecs::Error union (Phase B reconcile); bun_str::w! used for UTF-16 literals; bun_sys::windows::{LoadLibraryA,GetProcAddressA} signatures assumed Option-returning.
// ──────────────────────────────────────────────────────────────────────────
