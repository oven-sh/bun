//! libwebp decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_int, c_void};

use super::codecs;

// TODO(port): move to libwebp_sys (or runtime_sys) — extern fns left in place for Phase A.
unsafe extern "C" {
    pub fn WebPGetInfo(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> c_int;
    fn WebPDecodeRGBA(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> *mut u8;
    fn WebPEncodeRGBA(rgba: *const u8, w: c_int, h: c_int, stride: c_int, q: f32, out: *mut *mut u8) -> usize;
    fn WebPEncodeLosslessRGBA(rgba: *const u8, w: c_int, h: c_int, stride: c_int, out: *mut *mut u8) -> usize;
    pub fn WebPFree(ptr: *mut c_void);
}

// ─── libwebpmux / libwebpdemux ──────────────────────────────────────────────
// WebP carries colour profiles (and EXIF/XMP) in a VP8X RIFF container that
// wraps the VP8/VP8L bitstream. `WebPEncodeRGBA` only emits the bare
// bitstream chunk, and `WebPDecodeRGBA` only reads it — neither touches
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
#[derive(Default)]
struct WebPData {
    bytes: *const u8,
    size: usize,
}

/// `struct WebPChunkIterator` — cursor into a VP8X chunk list. Only `chunk`
/// is read; `pad`/`private_` are libwebp-internal bookkeeping that
/// `WebPDemuxReleaseChunkIterator` walks. `chunk.bytes` is a borrowed view
/// INTO the original input buffer — dupe it out before `WebPDemuxDelete`.
#[repr(C)]
struct WebPChunkIterator {
    chunk_num: c_int,
    num_chunks: c_int,
    chunk: WebPData,
    pad: [u32; 6],
    private_: *mut c_void,
}

#[repr(C)]
pub struct WebPDemuxer {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
#[repr(C)]
pub struct WebPMux {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

// `WebPDemux()` and `WebPMuxNew()` are `static inline` in the headers and
// just forward to these version-checked entry points with the ABI constant.
// TODO(port): move to libwebp_sys
unsafe extern "C" {
    fn WebPDemuxInternal(data: *const WebPData, allow_partial: c_int, state: *mut c_int, version: c_int) -> *mut WebPDemuxer;
    fn WebPDemuxDelete(dmux: *mut WebPDemuxer);
    fn WebPDemuxGetI(dmux: *const WebPDemuxer, feature: c_int) -> u32;
    fn WebPDemuxGetChunk(dmux: *const WebPDemuxer, fourcc: *const u8, chunk_number: c_int, iter: *mut WebPChunkIterator) -> c_int;
    fn WebPDemuxReleaseChunkIterator(iter: *mut WebPChunkIterator);

    fn WebPNewInternal(version: c_int) -> *mut WebPMux;
    fn WebPMuxDelete(mux: *mut WebPMux);
    fn WebPMuxSetImage(mux: *mut WebPMux, bitstream: *const WebPData, copy_data: c_int) -> c_int;
    fn WebPMuxSetChunk(mux: *mut WebPMux, fourcc: *const u8, chunk_data: *const WebPData, copy_data: c_int) -> c_int;
    fn WebPMuxAssemble(mux: *mut WebPMux, assembled_data: *mut WebPData) -> c_int;
}

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let mut cw: c_int = 0;
    let mut ch: c_int = 0;
    // Header-only probe first so the pixel guard fires before libwebp
    // allocates the full canvas internally. WebPGetInfo can hand back
    // non-positive on a malformed header; reject before the cast traps.
    // SAFETY: bytes.ptr/len describe a valid readable slice.
    if unsafe { WebPGetInfo(bytes.as_ptr(), bytes.len(), &mut cw, &mut ch) } == 0 || cw <= 0 || ch <= 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    let w: u32 = u32::try_from(cw).unwrap();
    let h: u32 = u32::try_from(ch).unwrap();
    codecs::guard(w, h, max_pixels)?;
    // SAFETY: bytes.ptr/len describe a valid readable slice; cw/ch are valid out-params.
    let ptr = unsafe { WebPDecodeRGBA(bytes.as_ptr(), bytes.len(), &mut cw, &mut ch) };
    if ptr.is_null() {
        return Err(codecs::Error::DecodeFailed);
    }
    let _free_ptr = scopeguard::guard(ptr, |p| unsafe { WebPFree(p.cast::<c_void>()) });
    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so a hostile caller can swap in a smaller
    // WebP between WebPGetInfo and WebPDecodeRGBA. libwebp re-parses on the
    // second call and writes the actual decoded dims back into cw/ch — reject
    // any mismatch instead of trusting the probe and over-reading the
    // smaller allocation. (Same race the CG shim guards at :298.)
    if cw as u32 != w || ch as u32 != h {
        return Err(codecs::Error::DecodeFailed);
    }
    let len: usize = (w as usize) * (h as usize) * 4;
    // SAFETY: WebPDecodeRGBA returns a buffer of w*h*4 bytes on success.
    let out: Box<[u8]> = Box::from(unsafe { core::slice::from_raw_parts(ptr, len) });

    // Extract the ICCP chunk (if any) from the RIFF container. A plain
    // VP8/VP8L WebP with no VP8X wrapper has no ICCP — `WebPDemux` still
    // succeeds, `WEBP_FF_FORMAT_FLAGS` returns 0, and we skip the chunk
    // walk. The chunk iterator hands back a borrowed view into `bytes`;
    // dupe into the global allocator to match JPEG/PNG ownership so the
    // pipeline can free it uniformly. Propagate OutOfMemory on the dupe
    // rather than silently dropping colour management — the pixels may be
    // Display P3 / Adobe RGB / XYB where "no profile" reinterprets them as
    // sRGB and visibly shifts colour, which is the exact bug #30197 is
    // about. A failed demux (malformed container) falls through with
    // `icc_profile = None`; the pixels decoded fine so the image is still
    // usable.
    let icc: Option<Box<[u8]>> = 'blk: {
        let data = WebPData { bytes: bytes.as_ptr(), size: bytes.len() };
        // SAFETY: `data` points to a valid WebPData; null state ptr is allowed.
        let dmux = unsafe { WebPDemuxInternal(&data, 0, core::ptr::null_mut(), WEBP_DEMUX_ABI_VERSION) };
        if dmux.is_null() {
            break 'blk None;
        }
        let _free_dmux = scopeguard::guard(dmux, |d| unsafe { WebPDemuxDelete(d) });
        // SAFETY: dmux is a live demuxer handle.
        if unsafe { WebPDemuxGetI(dmux, WEBP_FF_FORMAT_FLAGS) } & ICCP_FLAG == 0 {
            break 'blk None;
        }
        // SAFETY: all-zero is a valid WebPChunkIterator (#[repr(C)] POD, raw ptr + ints).
        let mut iter: WebPChunkIterator = unsafe { core::mem::zeroed::<WebPChunkIterator>() };
        // SAFETY: dmux is live; fourcc reads exactly 4 bytes; iter is a valid out-param.
        if unsafe { WebPDemuxGetChunk(dmux, b"ICCP".as_ptr(), 1, &mut iter) } == 0 {
            break 'blk None;
        }
        let _free_iter = scopeguard::guard((), |_| unsafe { WebPDemuxReleaseChunkIterator(&mut iter) });
        if iter.chunk.bytes.is_null() {
            break 'blk None;
        }
        if iter.chunk.size == 0 {
            break 'blk None;
        }
        // SAFETY: chunk.bytes points into `bytes` for chunk.size bytes per libwebp contract.
        break 'blk Some(Box::from(unsafe { core::slice::from_raw_parts(iter.chunk.bytes, iter.chunk.size) }));
    };
    Ok(codecs::Decoded { rgba: out, width: w, height: h, icc_profile: icc })
}

pub fn encode(rgba: &[u8], w: u32, h: u32, quality: u8, lossless: bool, icc_profile: Option<&[u8]>) -> Result<codecs::Encoded, codecs::Error> {
    let mut out: *mut u8 = core::ptr::null_mut();
    let stride: c_int = c_int::try_from(w * 4).unwrap();
    // SAFETY: rgba.ptr/len describe a valid readable buffer of stride*h bytes; out is a valid out-param.
    let len = if lossless {
        unsafe { WebPEncodeLosslessRGBA(rgba.as_ptr(), c_int::try_from(w).unwrap(), c_int::try_from(h).unwrap(), stride, &mut out) }
    } else {
        unsafe { WebPEncodeRGBA(rgba.as_ptr(), c_int::try_from(w).unwrap(), c_int::try_from(h).unwrap(), stride, quality as f32, &mut out) }
    };
    if len == 0 || out.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: WebPEncode* returns a buffer of `len` bytes on success.
    let bitstream: &mut [u8] = unsafe { core::slice::from_raw_parts_mut(out, len) };

    // Fast path: no profile to attach, so the bare VP8/VP8L RIFF that
    // `WebPEncodeRGBA` produced is already the final container. Avoids the
    // mux round-trip (and its extra copy) for the common sRGB case.
    let Some(profile) = icc_profile else {
        return Ok(codecs::Encoded { bytes: bitstream, free: codecs::Encoded::wrap(WebPFree) });
    };
    if profile.is_empty() {
        return Ok(codecs::Encoded { bytes: bitstream, free: codecs::Encoded::wrap(WebPFree) });
    }

    // Wrap the bitstream in a VP8X container with an ICCP chunk. libwebpmux
    // builds a new RIFF file from the image + chunk and allocates the
    // assembled output via `WebPMalloc`; hand THAT buffer to JS with
    // `WebPFree` as the finaliser and drop the intermediate encode. With
    // `copy_data = 0` the mux borrows our buffers until `WebPMuxAssemble`
    // returns, so `bitstream`/`profile` must outlive the assemble call
    // (both do — `bitstream` is freed below, `profile` is caller-owned).
    let _free_bitstream = scopeguard::guard(bitstream.as_mut_ptr(), |p| unsafe { WebPFree(p.cast::<c_void>()) });
    // SAFETY: WebPNewInternal has no preconditions.
    let mux = unsafe { WebPNewInternal(WEBP_MUX_ABI_VERSION) };
    if mux.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let _free_mux = scopeguard::guard(mux, |m| unsafe { WebPMuxDelete(m) });
    let img = WebPData { bytes: bitstream.as_ptr(), size: bitstream.len() };
    // SAFETY: mux is live; img points to valid borrowed data.
    if unsafe { WebPMuxSetImage(mux, &img, 0) } != WEBP_MUX_OK {
        return Err(codecs::Error::EncodeFailed);
    }
    let icc = WebPData { bytes: profile.as_ptr(), size: profile.len() };
    // SAFETY: mux is live; fourcc reads exactly 4 bytes; icc points to valid borrowed data.
    if unsafe { WebPMuxSetChunk(mux, b"ICCP".as_ptr(), &icc, 0) } != WEBP_MUX_OK {
        return Err(codecs::Error::EncodeFailed);
    }
    let mut assembled = WebPData::default();
    // SAFETY: mux is live; assembled is a valid out-param.
    if unsafe { WebPMuxAssemble(mux, &mut assembled) } != WEBP_MUX_OK {
        // `WebPMuxAssemble` writes a half-built buffer into `assembled` even
        // on failure; its contract says `WebPDataClear` (i.e. `WebPFree`) is
        // safe to call on any return.
        // SAFETY: WebPFree accepts null; assembled.bytes is WebPMalloc-owned or null.
        unsafe { WebPFree(assembled.bytes as *mut c_void) };
        return Err(codecs::Error::EncodeFailed);
    }
    if assembled.bytes.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    let assembled_ptr = assembled.bytes as *mut u8;
    // SAFETY: WebPMuxAssemble returns a WebPMalloc-owned buffer of assembled.size bytes on WEBP_MUX_OK.
    let assembled_slice = unsafe { core::slice::from_raw_parts_mut(assembled_ptr, assembled.size) };
    Ok(codecs::Encoded { bytes: assembled_slice, free: codecs::Encoded::wrap(WebPFree) })
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/image/codec_webp.zig (168 lines)
//   confidence: medium
//   todos:      2
//   notes:      codecs::Encoded.bytes field type (raw slice w/ custom free fn) and codecs::Error variant names assumed; scopeguard used for all libwebp FFI defer cleanup; extern fns left in-place pending libwebp_sys crate.
// ──────────────────────────────────────────────────────────────────────────
