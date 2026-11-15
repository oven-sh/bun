//! libwebp decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_int, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

use super::codecs;
use crate::encoded_wrap_free;

unsafe extern "C" {
    pub(crate) fn WebPGetInfo(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> c_int;
    fn WebPDecodeRGBAInto(
        data: *const u8,
        len: usize,
        output: *mut u8,
        output_len: usize,
        output_stride: c_int,
    ) -> *mut u8;
    fn WebPEncodeRGBA(
        rgba: *const u8,
        w: c_int,
        h: c_int,
        stride: c_int,
        q: f32,
        out: *mut *mut u8,
    ) -> usize;
    fn WebPEncodeLosslessRGBA(
        rgba: *const u8,
        w: c_int,
        h: c_int,
        stride: c_int,
        out: *mut *mut u8,
    ) -> usize;
    fn WebPFree(ptr: *mut c_void);
}

// ─── libwebpmux / libwebpdemux ──────────────────────────────────────────────
// WebP carries colour profiles (and EXIF/XMP) in a VP8X RIFF container that
// wraps the VP8/VP8L bitstream. `WebPEncodeRGBA` only emits the bare
// bitstream chunk, and `WebPDecodeRGBAInto` only reads it — neither touches
// the surrounding chunks. To pull an ICCP chunk out of an input (decode)
// or to attach one to an output (encode) we go through the separate
// demux/mux APIs, which operate on the whole RIFF file. Both are
// statically linked from the same libwebp checkout.
//
// ABI version constants below are pinned to the libwebp commit in
// `scripts/build/deps/libwebp.ts` (v1.6.0). If that commit is bumped, check
// `src/webp/mux.h` / `demux.h` for `WEBP_{MUX,DEMUX}_ABI_VERSION` — the
// *Internal entry points reject a caller with a different major byte.
const WEBP_DEMUX_ABI_VERSION: c_int = 0x0107;
const WEBP_MUX_ABI_VERSION: c_int = 0x0109;
/// `WebPFormatFeature.WEBP_FF_FORMAT_FLAGS` — selector for `WebPDemuxGetI`
/// that returns the VP8X feature bitmask.
const WEBP_FF_FORMAT_FLAGS: c_int = 0;
/// `WebPFeatureFlags.ICCP_FLAG` — set when an ICCP chunk is present in the
/// VP8X container.
const ICCP_FLAG: u32 = 0x20;
/// `WebPMuxError.WEBP_MUX_OK` — the only non-error return from mux calls.
const WEBP_MUX_OK: c_int = 1;

/// `struct WebPData` — borrowed-bytes view used by both mux and demux.
/// Memory is `WebPMalloc`-owned when libwebp writes to it (e.g.
/// `WebPMuxAssemble` output) and caller-owned when libwebp reads it.
#[repr(C)]
struct WebPData {
    bytes: *const u8,
    size: usize,
}
impl Default for WebPData {
    fn default() -> Self {
        Self {
            bytes: core::ptr::null(),
            size: 0,
        }
    }
}

/// `struct WebPChunkIterator` — cursor into a VP8X chunk list. Only `chunk`
/// is read; the rest is libwebp's. `chunk.bytes` is a borrowed view
/// INTO the original input buffer.
#[repr(C)]
struct WebPChunkIterator {
    chunk_num: c_int,
    num_chunks: c_int,
    chunk: WebPData,
    pad: [u32; 6],
    private_: *mut c_void,
}

bun_opaque::opaque_ffi! {
    pub(crate) struct WebPDemuxer;
    pub(crate) struct WebPMux;
}

// `WebPDemux()` and `WebPMuxNew()` are `static inline` in the headers and
// just forward to these version-checked entry points with the ABI constant.
unsafe extern "C" {
    fn WebPDemuxInternal(
        data: *const WebPData,
        allow_partial: c_int,
        state: *mut c_int,
        version: c_int,
    ) -> *mut WebPDemuxer;
    fn WebPDemuxDelete(dmux: *mut WebPDemuxer);
    safe fn WebPDemuxGetI(dmux: &WebPDemuxer, feature: c_int) -> u32;
    safe fn WebPDemuxGetChunk(
        dmux: &WebPDemuxer,
        fourcc: &[u8; 4],
        chunk_number: c_int,
        iter: &mut WebPChunkIterator,
    ) -> c_int;
    safe fn WebPDemuxReleaseChunkIterator(iter: &mut WebPChunkIterator);

    safe fn WebPNewInternal(version: c_int) -> *mut WebPMux;
    fn WebPMuxDelete(mux: *mut WebPMux);
    fn WebPMuxSetImage(mux: *mut WebPMux, bitstream: *const WebPData, copy_data: c_int) -> c_int;
    fn WebPMuxSetChunk(
        mux: *mut WebPMux,
        fourcc: *const u8,
        chunk_data: *const WebPData,
        copy_data: c_int,
    ) -> c_int;
    fn WebPMuxAssemble(mux: *mut WebPMux, assembled_data: *mut WebPData) -> c_int;
}

impl Drop for WebPChunkIterator {
    fn drop(&mut self) {
        WebPDemuxReleaseChunkIterator(self);
    }
}

struct Demux<'a>(NonNull<WebPDemuxer>, PhantomData<&'a [u8]>);

impl<'a> Demux<'a> {
    fn new(bytes: &'a [u8]) -> Option<Self> {
        let data = WebPData {
            bytes: bytes.as_ptr(),
            size: bytes.len(),
        };
        // SAFETY: the demuxer borrows `bytes`, which outlive it; a null state pointer is allowed.
        let dmux = unsafe {
            WebPDemuxInternal(
                &raw const data,
                0,
                core::ptr::null_mut(),
                WEBP_DEMUX_ABI_VERSION,
            )
        };
        Some(Self(NonNull::new(dmux)?, PhantomData))
    }

    fn icc_profile(&self) -> Option<&'a [u8]> {
        let dmux = WebPDemuxer::opaque_ref(self.0.as_ptr());
        if WebPDemuxGetI(dmux, WEBP_FF_FORMAT_FLAGS) & ICCP_FLAG == 0 {
            return None;
        }
        let mut iter = WebPChunkIterator {
            chunk_num: 0,
            num_chunks: 0,
            chunk: WebPData::default(),
            pad: [0; 6],
            private_: core::ptr::null_mut(),
        };
        if WebPDemuxGetChunk(dmux, b"ICCP", 1, &mut iter) == 0
            || iter.chunk.bytes.is_null()
            || iter.chunk.size == 0
        {
            return None;
        }
        // SAFETY: the chunk is a view into the bytes `new` borrowed.
        Some(unsafe { core::slice::from_raw_parts(iter.chunk.bytes, iter.chunk.size) })
    }
}

impl Drop for Demux<'_> {
    fn drop(&mut self) {
        // SAFETY: from `WebPDemuxInternal`, deleted once.
        unsafe { WebPDemuxDelete(self.0.as_ptr()) }
    }
}

struct Mux(NonNull<WebPMux>);

impl Drop for Mux {
    fn drop(&mut self) {
        // SAFETY: from `WebPNewInternal`, deleted once.
        unsafe { WebPMuxDelete(self.0.as_ptr()) }
    }
}

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let mut cw: c_int = 0;
    let mut ch: c_int = 0;
    // Header-only probe first so the pixel guard fires before libwebp
    // allocates the full canvas internally. WebPGetInfo can hand back
    // non-positive on a malformed header; reject before the cast traps.
    // SAFETY: bytes.ptr/len describe a valid readable slice.
    if unsafe { WebPGetInfo(bytes.as_ptr(), bytes.len(), &raw mut cw, &raw mut ch) } == 0
        || cw <= 0
        || ch <= 0
    {
        return Err(codecs::Error::DecodeFailed);
    }
    let w: u32 = u32::try_from(cw).expect("int cast");
    let h: u32 = u32::try_from(ch).expect("int cast");
    codecs::guard(w, h, max_pixels)?;
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so the decoder can see a different image
    // than the probe did. libwebp fails if that image is bigger than `out`.
    // If it's smaller, the rest of `out` is zero.
    let stride: usize = (w as usize) * 4;
    let mut out: Vec<u8> = vec![0; stride * (h as usize)];
    // SAFETY: `bytes` is a valid readable slice and `out` is a valid writable one.
    let decoded = unsafe {
        WebPDecodeRGBAInto(
            bytes.as_ptr(),
            bytes.len(),
            out.as_mut_ptr(),
            out.len(),
            c_int::try_from(stride).map_err(|_| codecs::Error::DecodeFailed)?,
        )
    };
    if decoded.is_null() {
        return Err(codecs::Error::DecodeFailed);
    }

    // Extract the ICCP chunk (if any) from the RIFF container. A plain
    // VP8/VP8L WebP with no VP8X wrapper has no ICCP, and we skip the chunk
    // walk. The chunk iterator hands back a borrowed view into `bytes`;
    // dupe into the global allocator to match JPEG/PNG ownership so the
    // pipeline can free it uniformly. Propagate OutOfMemory on the dupe
    // rather than silently dropping colour management — the pixels may be
    // Display P3 / Adobe RGB / XYB where "no profile" reinterprets them as
    // sRGB and visibly shifts colour, which is the exact bug #30197 is
    // about. A failed demux (malformed container) falls through with
    // `icc_profile = None`; the pixels decoded fine so the image is still
    // usable.
    let icc: Option<Vec<u8>> = 'blk: {
        // Byte 20 is the flags byte of a leading VP8X chunk.
        if bytes.len() <= 20 || &bytes[12..16] != b"VP8X" || u32::from(bytes[20]) & ICCP_FLAG == 0 {
            break 'blk None;
        }
        // The demuxer reads each chunk tag more than once and crashes if the
        // reads disagree, so give it a copy that JS can't write to.
        let bytes = bytes.to_vec();
        Demux::new(&bytes).and_then(|demux| demux.icc_profile().map(<[u8]>::to_vec))
    };
    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile: icc,
    })
}

pub(crate) fn encode(
    rgba: &[u8],
    w: u32,
    h: u32,
    quality: u8,
    lossless: bool,
    icc_profile: Option<&[u8]>,
) -> Result<codecs::Encoded, codecs::Error> {
    let mut out: *mut u8 = core::ptr::null_mut();
    let stride: c_int = c_int::try_from(w * 4).expect("int cast");
    let len = if lossless {
        // SAFETY: rgba.ptr/len describe a valid readable buffer of stride*h bytes; out is a valid out-param.
        unsafe {
            WebPEncodeLosslessRGBA(
                rgba.as_ptr(),
                c_int::try_from(w).expect("int cast"),
                c_int::try_from(h).expect("int cast"),
                stride,
                &raw mut out,
            )
        }
    } else {
        // SAFETY: rgba.ptr/len describe a valid readable buffer of stride*h bytes; out is a valid out-param.
        unsafe {
            WebPEncodeRGBA(
                rgba.as_ptr(),
                c_int::try_from(w).expect("int cast"),
                c_int::try_from(h).expect("int cast"),
                stride,
                quality as f32,
                &raw mut out,
            )
        }
    };
    if len == 0 {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: libwebp allocated `out` for the caller and wrote `len` bytes.
    let bitstream = unsafe { codecs::Encoded::from_raw(out, len, encoded_wrap_free!(WebPFree)) }
        .ok_or(codecs::Error::EncodeFailed)?;

    // Fast path: no profile to attach, so the bare VP8/VP8L RIFF that
    // `WebPEncodeRGBA` produced is already the final container. Avoids the
    // mux round-trip (and its extra copy) for the common sRGB case.
    let Some(profile) = icc_profile.filter(|profile| !profile.is_empty()) else {
        return Ok(bitstream);
    };

    // Wrap the bitstream in a VP8X container with an ICCP chunk. libwebpmux
    // builds a new RIFF file from the image + chunk and allocates the
    // assembled output via `WebPMalloc`; hand THAT buffer to JS with
    // `WebPFree` as the finaliser and drop the intermediate encode. With
    // `copy_data = 0` the mux borrows our buffers until `WebPMuxAssemble`
    // returns, so `bitstream`/`profile` must outlive the assemble call
    // (both do — `bitstream` drops after `mux`, `profile` is caller-owned).
    let mux = NonNull::new(WebPNewInternal(WEBP_MUX_ABI_VERSION))
        .map(Mux)
        .ok_or(codecs::Error::OutOfMemory)?;
    let img = WebPData {
        bytes: bitstream.as_ptr(),
        size: len,
    };
    // SAFETY: mux is live; img points to valid borrowed data.
    if unsafe { WebPMuxSetImage(mux.0.as_ptr(), &raw const img, 0) } != WEBP_MUX_OK {
        return Err(codecs::Error::EncodeFailed);
    }
    let icc = WebPData {
        bytes: profile.as_ptr(),
        size: profile.len(),
    };
    // SAFETY: mux is live; fourcc reads exactly 4 bytes; icc points to valid borrowed data.
    if unsafe { WebPMuxSetChunk(mux.0.as_ptr(), b"ICCP".as_ptr(), &raw const icc, 0) }
        != WEBP_MUX_OK
    {
        return Err(codecs::Error::EncodeFailed);
    }
    let mut assembled = WebPData::default();
    // SAFETY: mux is live; assembled is a valid out-param.
    let rc = unsafe { WebPMuxAssemble(mux.0.as_ptr(), &raw mut assembled) };
    // SAFETY: the caller owns `bytes` on any return, and it holds `size` bytes on success.
    unsafe {
        codecs::Encoded::from_raw(
            assembled.bytes.cast_mut(),
            assembled.size,
            encoded_wrap_free!(WebPFree),
        )
    }
    .filter(|_| rc == WEBP_MUX_OK)
    .ok_or(codecs::Error::EncodeFailed)
}
