//! libwebp decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use super::codecs;
use crate::encoded_wrap_free;

// TODO(port): move to libwebp_sys (or runtime_sys); extern fns declared inline here for now.
unsafe extern "C" {
    pub(crate) fn WebPGetInfo(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> c_int;
    fn WebPDecodeRGBA(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> *mut u8;
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
    pub(crate) fn WebPFree(ptr: *mut c_void);
}

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
// TODO(port): move to libwebp_sys
unsafe extern "C" {
    fn WebPDemuxInternal(
        data: *const WebPData,
        allow_partial: c_int,
        state: *mut c_int,
        version: c_int,
    ) -> *mut WebPDemuxer;
    fn WebPDemuxDelete(dmux: *mut WebPDemuxer);
    fn WebPDemuxGetI(dmux: *const WebPDemuxer, feature: c_int) -> u32;
    fn WebPDemuxGetChunk(
        dmux: *const WebPDemuxer,
        fourcc: *const u8,
        chunk_number: c_int,
        iter: *mut WebPChunkIterator,
    ) -> c_int;
    fn WebPDemuxReleaseChunkIterator(iter: *mut WebPChunkIterator);

    fn WebPNewInternal(version: c_int) -> *mut WebPMux;
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

pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
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
    // SAFETY: bytes.ptr/len describe a valid readable slice; cw/ch are valid out-params.
    let ptr = unsafe { WebPDecodeRGBA(bytes.as_ptr(), bytes.len(), &raw mut cw, &raw mut ch) };
    if ptr.is_null() {
        return Err(codecs::Error::DecodeFailed);
    }
    let _free_ptr = scopeguard::guard(ptr, |p| {
        // SAFETY: p was returned by WebPDecodeRGBA above; WebPFree is the matching deallocator.
        unsafe { WebPFree(p.cast::<c_void>()) }
    });
    if u32::try_from(cw).ok() != Some(w) || u32::try_from(ch).ok() != Some(h) {
        return Err(codecs::Error::DecodeFailed);
    }
    let len: usize = (w as usize) * (h as usize) * 4;
    // SAFETY: WebPDecodeRGBA returns a buffer of w*h*4 bytes on success.
    let out: Vec<u8> = unsafe { core::slice::from_raw_parts(ptr, len) }.to_vec();

    let icc: Option<Vec<u8>> = 'blk: {
        let data = WebPData {
            bytes: bytes.as_ptr(),
            size: bytes.len(),
        };
        // SAFETY: `data` points to a valid WebPData; null state ptr is allowed.
        let dmux = unsafe {
            WebPDemuxInternal(
                &raw const data,
                0,
                core::ptr::null_mut(),
                WEBP_DEMUX_ABI_VERSION,
            )
        };
        if dmux.is_null() {
            break 'blk None;
        }
        let _free_dmux = scopeguard::guard(dmux, |d| {
            // SAFETY: d was returned by WebPDemuxInternal above and is non-null; matching destructor.
            unsafe { WebPDemuxDelete(d) }
        });
        // SAFETY: dmux is a live demuxer handle.
        if unsafe { WebPDemuxGetI(dmux, WEBP_FF_FORMAT_FLAGS) } & ICCP_FLAG == 0 {
            break 'blk None;
        }
        // SAFETY: all-zero is a valid WebPChunkIterator (#[repr(C)] POD, raw ptr + ints).
        let mut iter: WebPChunkIterator =
            unsafe { core::mem::MaybeUninit::<WebPChunkIterator>::zeroed().assume_init() };
        // SAFETY: dmux is live; fourcc reads exactly 4 bytes; iter is a valid out-param.
        if unsafe { WebPDemuxGetChunk(dmux, b"ICCP".as_ptr(), 1, &raw mut iter) } == 0 {
            break 'blk None;
        }
        let iter = scopeguard::guard(iter, |mut it| {
            // SAFETY: it was populated by WebPDemuxGetChunk above; matching release call.
            unsafe { WebPDemuxReleaseChunkIterator(&raw mut it) }
        });
        if iter.chunk.bytes.is_null() {
            break 'blk None;
        }
        if iter.chunk.size == 0 {
            break 'blk None;
        }
        // SAFETY: chunk.bytes points into `bytes` for chunk.size bytes per libwebp contract.
        break 'blk Some(
            unsafe { core::slice::from_raw_parts(iter.chunk.bytes, iter.chunk.size) }.to_vec(),
        );
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
    if len == 0 || out.is_null() {
        return Err(codecs::Error::EncodeFailed);
    }
    // SAFETY: WebPEncode* returns a buffer of `len` bytes on success.
    let bitstream: &mut [u8] = unsafe { core::slice::from_raw_parts_mut(out, len) };

    // Fast path: no profile to attach, so the bare VP8/VP8L RIFF that
    // `WebPEncodeRGBA` produced is already the final container. Avoids the
    // mux round-trip (and its extra copy) for the common sRGB case.
    let Some(profile) = icc_profile else {
        return Ok(codecs::Encoded {
            bytes: NonNull::from(bitstream),
            free: encoded_wrap_free!(WebPFree),
        });
    };
    if profile.is_empty() {
        return Ok(codecs::Encoded {
            bytes: NonNull::from(bitstream),
            free: encoded_wrap_free!(WebPFree),
        });
    }

    let _free_bitstream = scopeguard::guard(bitstream.as_mut_ptr(), |p| {
        // SAFETY: p is the buffer returned by WebPEncode*RGBA above; WebPFree is the matching deallocator.
        unsafe { WebPFree(p.cast::<c_void>()) }
    });
    // SAFETY: WebPNewInternal has no preconditions.
    let mux = unsafe { WebPNewInternal(WEBP_MUX_ABI_VERSION) };
    if mux.is_null() {
        return Err(codecs::Error::OutOfMemory);
    }
    let _free_mux = scopeguard::guard(mux, |m| {
        // SAFETY: m was returned by WebPNewInternal above and is non-null; matching destructor.
        unsafe { WebPMuxDelete(m) }
    });
    let img = WebPData {
        bytes: bitstream.as_ptr(),
        size: bitstream.len(),
    };
    // SAFETY: mux is live; img points to valid borrowed data.
    if unsafe { WebPMuxSetImage(mux, &raw const img, 0) } != WEBP_MUX_OK {
        return Err(codecs::Error::EncodeFailed);
    }
    let icc = WebPData {
        bytes: profile.as_ptr(),
        size: profile.len(),
    };
    // SAFETY: mux is live; fourcc reads exactly 4 bytes; icc points to valid borrowed data.
    if unsafe { WebPMuxSetChunk(mux, b"ICCP".as_ptr(), &raw const icc, 0) } != WEBP_MUX_OK {
        return Err(codecs::Error::EncodeFailed);
    }
    let mut assembled = WebPData::default();
    // SAFETY: mux is live; assembled is a valid out-param.
    if unsafe { WebPMuxAssemble(mux, &raw mut assembled) } != WEBP_MUX_OK {
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
    let assembled_ptr = assembled.bytes.cast_mut();
    // SAFETY: WebPMuxAssemble returns a WebPMalloc-owned buffer of assembled.size bytes on WEBP_MUX_OK.
    let assembled_slice = unsafe { core::slice::from_raw_parts_mut(assembled_ptr, assembled.size) };
    Ok(codecs::Encoded {
        bytes: NonNull::from(assembled_slice),
        free: encoded_wrap_free!(WebPFree),
    })
}

// ported from: src/runtime/image/codec_webp.zig
