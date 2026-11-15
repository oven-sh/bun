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
use core::ffi::{CStr, c_int, c_uint, c_void};
use core::ptr;
use std::sync::Once;

use crate::image::codecs;
use bun_sys::windows;

/// `codecs::Error` plus `BackendUnavailable`; the variants used in this file
/// are inlined here and `split()`
/// below maps them back onto `codecs::Error` for the caller.
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

impl BackendError {
    /// Reshape into the
    /// caller's `Result<Option<T>, codecs::Error>` convention used by
    /// `codecs.rs` (`Ok(None)` = BackendUnavailable → fall through to the
    /// pure-Rust codec path).
    #[inline]
    pub(crate) fn split<T>(r: Result<T, Self>) -> Result<Option<T>, codecs::Error> {
        match r {
            Ok(v) => Ok(Some(v)),
            Err(Self::BackendUnavailable) => Ok(None),
            Err(Self::DecodeFailed) => Err(codecs::Error::DecodeFailed),
            Err(Self::EncodeFailed) => Err(codecs::Error::EncodeFailed),
            Err(Self::TooManyPixels) => Err(codecs::Error::TooManyPixels),
            Err(Self::OutOfMemory) => Err(codecs::Error::OutOfMemory),
        }
    }
}

bun_core::oom_from_alloc!(BackendError);

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, BackendError> {
    let f = factory()?;
    // IWICStream::InitializeFromMemory takes a DWORD count; the checked cast
    // below is a process abort, not silent truncation.
    // Drop to BackendUnavailable so codecs.decode() falls
    // through to the static decoder (bmp/gif) or surfaces UnsupportedOn
    // Platform (tiff/heic/avif) instead of crashing on a >4 GiB input.
    if bytes.len() as u64 > u32::MAX as u64 {
        return Err(BackendUnavailable);
    }

    let stream = f.create_stream().ok_or(BackendUnavailable)?;
    // SAFETY: `bytes` outlives this call, which releases the stream and what it creates from it.
    if unsafe { stream.initialize_from_memory(bytes) } < 0 {
        return Err(DecodeFailed);
    }

    // WICDecodeMetadataCacheOnDemand = 0. vendor GUID null = let WIC pick.
    let dec = f
        .create_decoder_from_stream(&stream, 0)
        .ok_or(DecodeFailed)?;

    let frame = dec.get_frame(0).ok_or(DecodeFailed)?;

    let mut w: u32 = 0;
    let mut h: u32 = 0;
    if frame.get_size(&mut w, &mut h) < 0 || w == 0 || h == 0 {
        return Err(DecodeFailed);
    }
    if (w as u64) * (h as u64) > max_pixels {
        return Err(TooManyPixels);
    }

    // WIC frames come in whatever pixel format the codec emits; normalise to
    // straight-alpha RGBA8 in one hop.
    let conv = convert_bitmap_source(&GUID_WICPixelFormat32bppRGBA, &frame).ok_or(DecodeFailed)?;

    // Compute stride/size in u64 first: with `maxPixels` raised past ~1.07B,
    // `w * 4` can wrap u32 (0x4000_0001×4 → 4); the checked cast below is a
    // process abort, not silent truncation.
    let stride: u64 = (w as u64) * 4;
    let out_len: u64 = stride * (h as u64);
    // CopyPixels takes UINT byte-count + UINT stride — same DWORD ceiling.
    if out_len > u32::MAX as u64 {
        return Err(TooManyPixels);
    }
    let mut out = vec![0u8; usize::try_from(out_len).expect("int cast")];
    if conv.copy_pixels(u32::try_from(stride).expect("int cast"), &mut out) < 0 {
        return Err(DecodeFailed);
    }

    // System backends colour-manage into sRGB during decode (WICConvertBitmapSource
    // → 32bppRGBA), so the source ICC profile is consumed, not forwarded.
    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile: None,
    })
}

pub(crate) fn encode(
    rgba: codecs::RgbaImage<'_>,
    opts: &codecs::EncodeOptions,
) -> Result<Vec<u8>, BackendError> {
    let (width, height) = (rgba.width(), rgba.height());
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
    let stream = unsafe {
        let hr = CreateStreamOnHGlobal(ptr::null_mut(), 1, &mut stream);
        ComPtr::new(hr, stream.cast::<IStream>())
    }
    .ok_or(BackendUnavailable)?;

    // WINCODEC_ERR_COMPONENTNOTFOUND when the HEIF/AV1 store extension isn't
    // installed → BackendUnavailable so codecs.encode() falls through to
    // UnsupportedOnPlatform instead of a generic "encode failed".
    let guid = container_guid(opts.format).ok_or(BackendUnavailable)?;
    let enc = f.create_encoder(guid).ok_or(BackendUnavailable)?;
    // WICBitmapEncoderNoCache = 2.
    if enc.initialize(&stream, 2) < 0 {
        return Err(EncodeFailed);
    }

    let (frame, bag) = enc.create_new_frame().ok_or(EncodeFailed)?;
    let props = bag.as_ref().map_or(ptr::null_mut(), ComPtr::as_ptr);

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
            bun_core::wstr!("ImageQuality").as_ptr(),
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
            bun_core::wstr!("HeifCompressionMethod").as_ptr(),
            method,
        )
    } == 0
    {
        return Err(BackendUnavailable);
    }
    if frame.initialize(bag.as_ref()) < 0 {
        return Err(EncodeFailed);
    }
    if frame.set_size(width, height) < 0 {
        return Err(EncodeFailed);
    }
    // SetPixelFormat is in/out — the codec rewrites `pf` to its native sink
    // (the HEIF encoder wants 32bppBGRA, not RGBA). When it doesn't move,
    // WritePixels straight from our buffer; when it does, wrap our RGBA as a
    // WIC bitmap, let WICConvertBitmapSource do the channel swap, and feed
    // the result via WriteSource. This is the documented dance; without it
    // .heic()/.avif() always rejected on Windows.
    let mut pf = GUID_WICPixelFormat32bppRGBA;
    if frame.set_pixel_format(&mut pf) < 0 {
        return Err(EncodeFailed);
    }
    let stride: u32 = width * 4;
    if pf == GUID_WICPixelFormat32bppRGBA {
        if frame.write_pixels(height, stride, &rgba) < 0 {
            return Err(EncodeFailed);
        }
    } else {
        let src = f
            .create_bitmap_from_memory(width, height, &GUID_WICPixelFormat32bppRGBA, stride, &rgba)
            .ok_or(EncodeFailed)?;
        let conv = convert_bitmap_source(&pf, &src).ok_or(EncodeFailed)?;
        if frame.write_source(&conv) < 0 {
            return Err(EncodeFailed);
        }
    }
    if frame.commit() < 0 {
        return Err(EncodeFailed);
    }
    if enc.commit() < 0 {
        return Err(EncodeFailed);
    }

    // Logical length, not allocation size: GlobalSize() returns the HGLOBAL's
    // rounded-up allocation, which is ≥ what the encoder actually wrote and
    // would tack uninitialised heap bytes onto every output. The encoder writes
    // sequentially from offset 0 and never seeks back, so the stream's current
    // position IS the byte count. (MSDN GetHGlobalFromStream: "use IStream::Stat
    // to obtain the actual size".)
    let mut pos: u64 = 0;
    if stream.seek(0, STREAM_SEEK_CUR, &mut pos) < 0 {
        return Err(EncodeFailed);
    }

    let mut hg: *mut c_void = ptr::null_mut();
    // SAFETY: stream is non-null.
    if unsafe { GetHGlobalFromStream(stream.as_ptr().cast(), &mut hg) } < 0 || hg.is_null() {
        return Err(EncodeFailed);
    }
    // SAFETY: the stream's memory, which outlives the lock.
    let locked = unsafe { LockedGlobal::new(hg) }.ok_or(EncodeFailed)?;
    let len = usize::try_from(pos).expect("int cast");
    // SAFETY: the stream wrote `pos` bytes.
    let slice = unsafe { bun_core::ffi::slice(locked.bytes, len) };
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

// VARIANT/PROPBAG2 layout is fiddly enough (union padding, BRECORD/DECIMAL
// arms) that hand-rolling it as `extern struct` is asking for an ABI drift.
// The C++ shim uses the SDK's own headers; we just hand it the bag pointer.
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

/// Owns one reference to a COM interface.
struct ComPtr<T>(ptr::NonNull<T>);

impl<T> ComPtr<T> {
    /// Takes the reference that a creation call returned.
    ///
    /// SAFETY: a call that returned `hr` stored `p`, which nothing else releases.
    #[inline]
    unsafe fn new(hr: HRESULT, p: *mut T) -> Option<Self> {
        if hr < 0 {
            return None;
        }
        ptr::NonNull::new(p).map(Self)
    }
    #[inline]
    fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}

impl<T> Drop for ComPtr<T> {
    fn drop(&mut self) {
        let unk = self.as_ptr().cast::<IUnknown>();
        // SAFETY: every COM vtable begins with IUnknownVTable, and `self` owns a reference.
        unsafe { ((*(*unk).vt).Release)(unk) };
    }
}

/// The process's factory, which is never released.
struct Factory(ptr::NonNull<IWICImagingFactory>);

// SAFETY for every `Factory` and `ComPtr<I*>` method body below: `self.0` is a non-null
// live COM interface pointer (the contract of `ComPtr::new`), and each
// vtable slot is typed to match the Windows SDK signature. Out-params are
// stack locals, and WIC checks a stride and a line count against the size of the buffer.
// The single `unsafe` per method is the raw vtable dispatch and `ComPtr::new`;
// no `&`/`&mut` to the COM object is ever materialised — only raw-pointer
// reads of the (immutable) `vt` field — so there is no aliasing assertion.

impl Factory {
    fn as_ptr(&self) -> *mut IWICImagingFactory {
        self.0.as_ptr()
    }
    #[inline]
    fn create_stream(&self) -> Option<ComPtr<IWICStream>> {
        let mut out = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).CreateStream)(self.as_ptr(), &mut out);
            ComPtr::new(hr, out)
        }
    }
    #[inline]
    fn create_decoder_from_stream(
        &self,
        stream: &ComPtr<IWICStream>,
        opts: u32,
    ) -> Option<ComPtr<IWICBitmapDecoder>> {
        let mut out = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).CreateDecoderFromStream)(
                self.as_ptr(),
                stream.as_ptr().cast(),
                ptr::null(),
                opts,
                &mut out,
            );
            ComPtr::new(hr, out)
        }
    }
    #[inline]
    fn create_encoder(&self, container: &GUID) -> Option<ComPtr<IWICBitmapEncoder>> {
        let mut out = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).CreateEncoder)(
                self.as_ptr(),
                container,
                ptr::null(),
                &mut out,
            );
            ComPtr::new(hr, out)
        }
    }
    #[inline]
    fn create_bitmap_from_memory(
        &self,
        width: u32,
        height: u32,
        fmt: &GUID,
        stride: u32,
        buf: &[u8],
    ) -> Option<ComPtr<IWICBitmapSource>> {
        let size = u32::try_from(buf.len()).expect("int cast");
        let mut out = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).CreateBitmapFromMemory)(
                self.as_ptr(),
                width,
                height,
                fmt,
                stride,
                size,
                buf.as_ptr(),
                &mut out,
            );
            ComPtr::new(hr, out)
        }
    }
}

impl ComPtr<IWICStream> {
    /// SAFETY: `buf` outlives the stream and what is created from it, and nothing writes to the stream.
    #[inline]
    unsafe fn initialize_from_memory(&self, buf: &[u8]) -> HRESULT {
        let len = u32::try_from(buf.len()).expect("int cast");
        unsafe { ((*(*self.as_ptr()).vt).InitializeFromMemory)(self.as_ptr(), buf.as_ptr(), len) }
    }
}

impl ComPtr<IWICBitmapDecoder> {
    #[inline]
    fn get_frame(&self, index: u32) -> Option<ComPtr<IWICBitmapSource>> {
        let mut out = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).GetFrame)(self.as_ptr(), index, &mut out);
            ComPtr::new(hr, out)
        }
    }
}

impl ComPtr<IWICBitmapSource> {
    #[inline]
    fn get_size(&self, w: &mut u32, h: &mut u32) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).GetSize)(self.as_ptr(), w, h) }
    }
    #[inline]
    fn copy_pixels(&self, stride: u32, out: &mut [u8]) -> HRESULT {
        let size = u32::try_from(out.len()).expect("int cast");
        unsafe {
            ((*(*self.as_ptr()).vt).CopyPixels)(
                self.as_ptr(),
                ptr::null(),
                stride,
                size,
                out.as_mut_ptr(),
            )
        }
    }
}

impl ComPtr<IWICBitmapEncoder> {
    #[inline]
    fn initialize(&self, stream: &ComPtr<IStream>, cache: u32) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).Initialize)(self.as_ptr(), stream.as_ptr().cast(), cache) }
    }
    #[inline]
    fn create_new_frame(
        &self,
    ) -> Option<(ComPtr<IWICBitmapFrameEncode>, Option<ComPtr<IUnknown>>)> {
        let mut frame = ptr::null_mut();
        let mut props = ptr::null_mut();
        unsafe {
            let hr = ((*(*self.as_ptr()).vt).CreateNewFrame)(self.as_ptr(), &mut frame, &mut props);
            let props = ComPtr::new(hr, props);
            ComPtr::new(hr, frame).map(|f| (f, props))
        }
    }
    #[inline]
    fn commit(&self) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).Commit)(self.as_ptr()) }
    }
}

impl ComPtr<IWICBitmapFrameEncode> {
    #[inline]
    fn initialize(&self, props: Option<&ComPtr<IUnknown>>) -> HRESULT {
        let props = props.map_or(ptr::null_mut(), ComPtr::as_ptr);
        unsafe { ((*(*self.as_ptr()).vt).Initialize)(self.as_ptr(), props) }
    }
    #[inline]
    fn set_size(&self, w: u32, h: u32) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).SetSize)(self.as_ptr(), w, h) }
    }
    #[inline]
    fn set_pixel_format(&self, pf: &mut GUID) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).SetPixelFormat)(self.as_ptr(), pf) }
    }
    #[inline]
    fn write_pixels(&self, lines: u32, stride: u32, buf: &[u8]) -> HRESULT {
        let size = u32::try_from(buf.len()).expect("int cast");
        unsafe {
            ((*(*self.as_ptr()).vt).WritePixels)(self.as_ptr(), lines, stride, size, buf.as_ptr())
        }
    }
    #[inline]
    fn write_source(&self, src: &ComPtr<IWICBitmapSource>) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).WriteSource)(self.as_ptr(), src.as_ptr(), ptr::null()) }
    }
    #[inline]
    fn commit(&self) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).Commit)(self.as_ptr()) }
    }
}

impl ComPtr<IStream> {
    #[inline]
    fn seek(&self, dlib_move: i64, origin: u32, new_pos: &mut u64) -> HRESULT {
        unsafe { ((*(*self.as_ptr()).vt).Seek)(self.as_ptr(), dlib_move, origin, new_pos) }
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
    CopyPixels: unsafe extern "system" fn(
        *mut IWICBitmapSource,
        *const c_void,
        u32,
        u32,
        *mut u8,
    ) -> HRESULT,
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

fn container_guid(f: codecs::Format) -> Option<&'static GUID> {
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

struct LockedGlobal {
    handle: *mut c_void,
    bytes: *const u8,
}

impl LockedGlobal {
    /// SAFETY: `handle` is an HGLOBAL that outlives the lock.
    unsafe fn new(handle: *mut c_void) -> Option<Self> {
        // SAFETY: fn contract.
        let bytes = unsafe { GlobalLock(handle) }.cast_const().cast::<u8>();
        (!bytes.is_null()).then(|| Self { handle, bytes })
    }
}

impl Drop for LockedGlobal {
    fn drop(&mut self) {
        // SAFETY: locked in `new`.
        unsafe { GlobalUnlock(self.handle) };
    }
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
// PORTING.md §Global mutable state: written once under `FACTORY_ONCE`,
// read-only thereafter. Fn pointers are `Send + Sync + Copy`, so a plain
// `OnceLock` gives a safe write-once slot.
static wicConvertBitmapSource: std::sync::OnceLock<WICConvertBitmapSourceFn> =
    std::sync::OnceLock::new();

fn convert_bitmap_source(
    dst_fmt: &GUID,
    src: &ComPtr<IWICBitmapSource>,
) -> Option<ComPtr<IWICBitmapSource>> {
    let convert_fn = wicConvertBitmapSource.get()?;
    let mut out = ptr::null_mut();
    // SAFETY: convert_fn resolved from windowscodecs.dll; src is live; out is a valid out-param.
    unsafe {
        let hr = convert_fn(dst_fmt, src.as_ptr(), &mut out);
        ComPtr::new(hr, out)
    }
}

const COINIT_MULTITHREADED: u32 = 0;
const CLSCTX_INPROC_SERVER: u32 = 1;

thread_local! {
    static COM_INITIALISED: Cell<bool> = const { Cell::new(false) };
}
// PORTING.md §Global mutable state: written once under `FACTORY_ONCE`,
// read-only thereafter → AtomicPtr (Once provides the happens-before).
static FACTORY_PTR: core::sync::atomic::AtomicPtr<IWICImagingFactory> =
    core::sync::atomic::AtomicPtr::new(ptr::null_mut());
static FACTORY_ONCE: Once = Once::new();

fn factory() -> Result<Factory, BackendError> {
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
    // FACTORY_PTR is only written inside FACTORY_ONCE; happens-before via call_once.
    ptr::NonNull::new(FACTORY_PTR.load(core::sync::atomic::Ordering::Relaxed))
        .map(Factory)
        .ok_or(BackendUnavailable)
}

fn load_factory() {
    // Resolve the one flat C export first; if windowscodecs.dll isn't present
    // we never attempt CoCreateInstance and the whole backend stays disabled.
    // SAFETY: literal C string; LoadLibraryA is safe to call from any thread.
    let dll = unsafe { windows::LoadLibraryA(c"windowscodecs.dll".as_ptr()) };
    if dll.is_null() {
        return;
    }
    // SAFETY: `dll` is loaded.
    let Some(sym) =
        (unsafe { windows::GetProcAddressA(Some(dll), bun_core::zstr!("WICConvertBitmapSource")) })
    else {
        return;
    };
    // SAFETY: sym is the export of WICConvertBitmapSource — fn-ptr transmute.
    let _ = wicConvertBitmapSource
        .set(unsafe { core::mem::transmute::<_, WICConvertBitmapSourceFn>(sym) });

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
    FACTORY_PTR.store(
        out as *mut IWICImagingFactory,
        core::sync::atomic::Ordering::Relaxed,
    );
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

#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(hwnd: *mut c_void) -> c_int;
    fn CloseClipboard() -> c_int;
    safe fn IsClipboardFormatAvailable(format: c_uint) -> c_int;
    fn GetClipboardData(format: c_uint) -> *mut c_void;
    fn RegisterClipboardFormatA(name: *const core::ffi::c_char) -> c_uint;
    safe fn GetClipboardSequenceNumber() -> u32;
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

fn register_clipboard_format(name: &CStr) -> c_uint {
    // SAFETY: name is a NUL-terminated C string.
    unsafe { RegisterClipboardFormatA(name.as_ptr()) }
}

pub(crate) fn clipboard_change_count() -> i64 {
    GetClipboardSequenceNumber() as i64
}

pub(crate) fn has_clipboard_image() -> bool {
    // IsClipboardFormatAvailable doesn't require OpenClipboard.
    if IsClipboardFormatAvailable(CF_DIBV5) != 0 || IsClipboardFormatAvailable(CF_DIB) != 0 {
        return true;
    }
    for name in NAMED_FORMATS {
        let id = register_clipboard_format(name);
        if id != 0 && IsClipboardFormatAvailable(id) != 0 {
            return true;
        }
    }
    false
}

struct Clipboard(());

impl Clipboard {
    fn open() -> Option<Self> {
        // SAFETY: a null hwnd associates the open with the current task; fine for read-only.
        (unsafe { OpenClipboard(ptr::null_mut()) } != 0).then(|| Self(()))
    }

    fn data(&self, format: c_uint) -> *mut c_void {
        // SAFETY: the clipboard is open.
        unsafe { GetClipboardData(format) }
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        // SAFETY: the clipboard is open.
        unsafe { CloseClipboard() };
    }
}

// The wider `BackendError` type matches the macOS backend so the caller in
// Image.rs handles both identically.
pub(crate) fn clipboard() -> Result<Option<Vec<u8>>, BackendError> {
    let clipboard = Clipboard::open().ok_or(BackendUnavailable)?;

    // 1. Registered file-format chunks — copy verbatim.
    for name in NAMED_FORMATS {
        let id = register_clipboard_format(name);
        if id != 0 {
            if let Some(b) = dup_global::<0>(&clipboard, id)? {
                return Ok(Some(b));
            }
        }
    }
    // 2. Packed DIB — needs a synthetic BITMAPFILEHEADER so the BMP sniffer
    //    and decoder accept it. CF_DIBV5 first (carries alpha mask). The
    //    clipboard is writable by any local process, so treat the payload as
    //    hostile: a 1-byte CF_DIB or a header with biSize≈u32::MAX must drop
    //    the format, not panic the process.
    for cf in [CF_DIBV5, CF_DIB] {
        let Some(mut buf) = dup_global::<14>(&clipboard, cf)? else {
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
        let ih_size: u64 =
            u32::from_le_bytes(buf[14..18].try_into().expect("infallible: size matches")) as u64;
        let compression = u32::from_le_bytes(
            buf[14 + 16..14 + 16 + 4]
                .try_into()
                .expect("infallible: size matches"),
        );
        let masks: u64 = if ih_size == 40 && compression == 3 {
            12
        } else {
            0
        };
        let off = 14 + ih_size + masks;
        if ih_size < 40 || off > buf.len() as u64 {
            continue;
        }
        let file_size = u32::try_from(buf.len()).expect("int cast");
        buf[0] = b'B';
        buf[1] = b'M';
        buf[2..6].copy_from_slice(&file_size.to_le_bytes());
        buf[6..10].copy_from_slice(&0u32.to_le_bytes());
        buf[10..14].copy_from_slice(&u32::try_from(off).expect("int cast").to_le_bytes());
        return Ok(Some(buf));
    }
    Ok(None)
}

/// Copy a clipboard HGLOBAL into the global allocator, optionally leaving
/// `PREFIX` zero bytes at the front for the caller to fill (BITMAPFILEHEADER).
fn dup_global<const PREFIX: usize>(
    clipboard: &Clipboard,
    format: c_uint,
) -> Result<Option<Vec<u8>>, bun_alloc::AllocError> {
    let h = clipboard.data(format);
    if h.is_null() {
        return Ok(None);
    }
    // SAFETY: h is a non-null HGLOBAL from GetClipboardData.
    let size = unsafe { GlobalSize(h) };
    if size == 0 {
        return Ok(None);
    }
    // SAFETY: h is a non-null HGLOBAL, and the clipboard is open.
    let Some(locked) = (unsafe { LockedGlobal::new(h) }) else {
        return Ok(None);
    };
    let mut out = vec![0u8; PREFIX + size];
    // SAFETY: `size` valid bytes inside the locked HGLOBAL.
    out[PREFIX..].copy_from_slice(unsafe { bun_core::ffi::slice(locked.bytes, size) });
    Ok(Some(out))
}
