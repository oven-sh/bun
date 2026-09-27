//! libwebp decode/encode for `Bun.Image`.
//! Dispatch lives in codecs.rs; this file is the codec body.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use super::codecs;
use crate::encoded_wrap_free;

unsafe extern "C" {
    pub(crate) fn WebPGetInfo(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> c_int;
    fn WebPInitDecoderConfigInternal(config: *mut WebPDecoderConfig, version: c_int) -> c_int;
    fn WebPGetFeaturesInternal(
        data: *const u8,
        len: usize,
        features: *mut WebPBitstreamFeatures,
        version: c_int,
    ) -> c_int;
    fn WebPDecode(data: *const u8, len: usize, config: *mut WebPDecoderConfig) -> c_int;
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

// ─── libwebp advanced decoding API ──────────────────────────────────────────
// `WebPDecodeRGBA` is not usable on input that can change under it. It parses
// the header twice: `Decode` (webp_dec.c) reports the dimensions of its own
// `WebPGetInfo`, then `DecodeInto` parses again and allocates the output by
// what THAT parse finds. The caller gets a pointer and two dimensions that
// need not describe it. `WebPDecode` takes the output buffer from the caller
// instead: libwebp refuses a picture that does not fit the `size` and
// `stride` it was given (`CheckDecBuffer`, buffer_dec.c) and stores the
// dimensions it decoded in `output.width`/`output.height`.
//
// The structs below mirror `src/webp/decode.h` at the libwebp commit in
// `scripts/build/deps/libwebp.ts` (v1.6.0). If that commit is bumped, check
// them and `WEBP_DECODER_ABI_VERSION` against the header — the *Internal
// entry point rejects a caller with a different major byte.
const WEBP_DECODER_ABI_VERSION: c_int = 0x0210;
/// `WEBP_CSP_MODE.MODE_RGBA` — 4 bytes per pixel, straight alpha.
const MODE_RGBA: c_int = 1;
/// `VP8StatusCode.VP8_STATUS_OK` — the only status of a completed decode.
const VP8_STATUS_OK: c_int = 0;

/// `struct WebPRGBABuffer` — the caller's buffer, as libwebp sees it.
#[repr(C)]
#[derive(Clone, Copy)]
struct WebPRGBABuffer {
    rgba: *mut u8,
    stride: c_int,
    size: usize,
}

/// `struct WebPYUVABuffer` — unused (we never ask for YUV), but it is the
/// larger arm of the union in `WebPDecBuffer` and so sets that struct's size.
#[repr(C)]
#[derive(Clone, Copy)]
struct WebPYUVABuffer {
    y: *mut u8,
    u: *mut u8,
    v: *mut u8,
    a: *mut u8,
    y_stride: c_int,
    u_stride: c_int,
    v_stride: c_int,
    a_stride: c_int,
    y_size: usize,
    u_size: usize,
    v_size: usize,
    a_size: usize,
}

#[repr(C)]
union WebPDecBufferPlanes {
    rgba: WebPRGBABuffer,
    yuva: WebPYUVABuffer,
}

/// `struct WebPDecBuffer` — `width`/`height` are OUT fields: libwebp writes
/// the dimensions it decoded, whoever owns the memory.
#[repr(C)]
struct WebPDecBuffer {
    colorspace: c_int,
    width: c_int,
    height: c_int,
    /// Non-zero: the memory is the caller's, libwebp neither allocates nor frees.
    is_external_memory: c_int,
    u: WebPDecBufferPlanes,
    pad: [u32; 4],
    private_memory: *mut u8,
}

/// `struct WebPBitstreamFeatures` — what a header parse found.
#[repr(C)]
struct WebPBitstreamFeatures {
    width: c_int,
    height: c_int,
    has_alpha: c_int,
    has_animation: c_int,
    /// 1 lossy, 2 lossless, 0 when the parse did not reach a VP8/VP8L chunk.
    format: c_int,
    pad: [u32; 5],
}

/// `struct WebPDecoderOptions` — left all-zero: no crop, no scale, no flip.
#[repr(C)]
struct WebPDecoderOptions {
    bypass_filtering: c_int,
    no_fancy_upsampling: c_int,
    use_cropping: c_int,
    crop_left: c_int,
    crop_top: c_int,
    crop_width: c_int,
    crop_height: c_int,
    use_scaling: c_int,
    scaled_width: c_int,
    scaled_height: c_int,
    use_threads: c_int,
    dithering_strength: c_int,
    flip: c_int,
    alpha_dithering_strength: c_int,
    pad: [u32; 5],
}

/// `struct WebPDecoderConfig`
#[repr(C)]
struct WebPDecoderConfig {
    input: WebPBitstreamFeatures,
    output: WebPDecBuffer,
    options: WebPDecoderOptions,
}
// SAFETY: integers, raw pointers and arrays of integers only; all-zero is valid.
unsafe impl bun_core::Zeroable for WebPDecoderConfig {}

// `WebPInitDecoderConfigInternal` clears `sizeof(WebPDecoderConfig)` bytes, so
// a struct that came out smaller than libwebp's would be written past its end.
#[cfg(target_pointer_width = "64")]
const _: () = {
    assert!(size_of::<WebPRGBABuffer>() == 24);
    assert!(size_of::<WebPYUVABuffer>() == 80);
    assert!(size_of::<WebPDecBuffer>() == 120 && align_of::<WebPDecBuffer>() == 8);
    assert!(size_of::<WebPBitstreamFeatures>() == 40);
    assert!(size_of::<WebPDecoderOptions>() == 76);
    assert!(size_of::<WebPDecoderConfig>() == 240);
    assert!(core::mem::offset_of!(WebPDecBuffer, u) == 16);
    assert!(core::mem::offset_of!(WebPDecoderConfig, output) == 40);
    assert!(core::mem::offset_of!(WebPDecoderConfig, options) == 160);
};

// ─── libwebpmux ─────────────────────────────────────────────────────────────
// WebP carries colour profiles (and EXIF/XMP) in a VP8X RIFF container that
// wraps the VP8/VP8L bitstream. `WebPEncodeRGBA` only emits the bare
// bitstream chunk, and the decoder only reads it — neither touches the
// surrounding chunks. To attach an ICCP chunk to an output we go through the
// separate mux API, which operates on the whole RIFF file. Reading one out of
// an input is `iccp_chunk` below: libwebp's demuxer re-reads the caller's
// buffer on every lookup, which an input that changes under it turns into a
// NULL dereference.
//
// The ABI version constant is pinned to the libwebp commit in
// `scripts/build/deps/libwebp.ts` (v1.6.0). If that commit is bumped, check
// `src/webp/mux.h` for `WEBP_MUX_ABI_VERSION` — the *Internal entry point
// rejects a caller with a different major byte.
const WEBP_MUX_ABI_VERSION: c_int = 0x0109;
/// `WebPFeatureFlags` — the VP8X feature bitmask. `ICCP_FLAG` is set when the
/// container carries an ICCP chunk.
const ANIMATION_FLAG: u32 = 0x02;
const ALPHA_FLAG: u32 = 0x10;
const ICCP_FLAG: u32 = 0x20;
const ALL_VALID_FLAGS: u32 = 0x3e;
/// `WebPMuxError.WEBP_MUX_OK` — the only non-error return from mux calls.
const WEBP_MUX_OK: c_int = 1;

/// `struct WebPData` — borrowed-bytes view the mux API reads and writes.
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

bun_opaque::opaque_ffi! {
    pub(crate) struct WebPMux;
}

// `WebPMuxNew()` is `static inline` in the header and just forwards to this
// version-checked entry point with the ABI constant.
unsafe extern "C" {
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

pub(crate) fn decode(bytes: &[u8], max_pixels: u64) -> Result<codecs::Decoded, codecs::Error> {
    let mut config: WebPDecoderConfig = bun_core::ffi::zeroed();
    // SAFETY: config is a live WebPDecoderConfig of the size libwebp clears.
    if unsafe { WebPInitDecoderConfigInternal(&raw mut config, WEBP_DECODER_ABI_VERSION) } == 0 {
        return Err(codecs::Error::DecodeFailed);
    }
    // Header-only probe first so the pixel guard fires before the canvas is
    // allocated. The probe answers with the VP8X canvas for input it cannot
    // decode: an animation, and a file that ends before its VP8/VP8L chunk
    // (`format` stays 0). Refuse those here, before they cost a canvas.
    // SAFETY: bytes.ptr/len describe a valid readable slice; config.input is a valid out-param.
    let probed = unsafe {
        WebPGetFeaturesInternal(
            bytes.as_ptr(),
            bytes.len(),
            &raw mut config.input,
            WEBP_DECODER_ABI_VERSION,
        )
    };
    let (cw, ch) = (config.input.width, config.input.height);
    if probed != VP8_STATUS_OK
        || cw <= 0
        || ch <= 0
        || config.input.has_animation != 0
        || config.input.format == 0
    {
        return Err(codecs::Error::DecodeFailed);
    }
    let w: u32 = u32::try_from(cw).expect("int cast");
    let h: u32 = u32::try_from(ch).expect("int cast");
    codecs::guard(w, h, max_pixels)?;

    // `bytes` is a borrowed view of a JS ArrayBuffer the user can still WRITE
    // (the pin only blocks detach), so each parse libwebp makes can see a
    // different header than the probe did. The canvas is ours and is sized by
    // the probe: libwebp refuses a picture that does not fit it, and a smaller
    // one is rejected below, because it leaves part of the canvas unwritten.
    // (Same rule as the CG shim's TOCTOU guard and codec_jpeg's post-check.)
    let stride: usize = (w as usize) * 4;
    let len: usize = stride * (h as usize);
    let mut out: Vec<u8> = Vec::new();
    // Up to ~1 GiB at the default pixel limit: fail the decode, not the process.
    out.try_reserve_exact(len)
        .map_err(|_| codecs::Error::OutOfMemory)?;
    config.output.colorspace = MODE_RGBA;
    config.output.is_external_memory = 1;
    config.output.u.rgba = WebPRGBABuffer {
        rgba: out.as_mut_ptr(),
        stride: c_int::try_from(stride).map_err(|_| codecs::Error::DecodeFailed)?,
        size: len,
    };
    // SAFETY: bytes.ptr/len describe a valid readable slice. The output is
    // `out`'s exclusive `len` bytes of capacity: libwebp checks the dimensions
    // it is about to decode against `size` and `stride` before it writes.
    let status = unsafe { WebPDecode(bytes.as_ptr(), bytes.len(), &raw mut config) };
    if status != VP8_STATUS_OK || config.output.width != cw || config.output.height != ch {
        return Err(codecs::Error::DecodeFailed);
    }
    // SAFETY: a completed decode of `h` rows of `w` pixels at this stride
    // wrote every one of `out`'s first `len` bytes.
    unsafe { bun_core::vec::commit_spare(&mut out, len) };

    // The ICCP payload is duped into the global allocator to match JPEG/PNG
    // ownership so the pipeline can free it uniformly. Propagate OutOfMemory
    // on the dupe rather than silently dropping colour management — the pixels
    // may be Display P3 / Adobe RGB / XYB where "no profile" reinterprets them
    // as sRGB and visibly shifts colour, which is the exact bug #30197 is
    // about. A container we cannot walk leaves `icc_profile = None`; the
    // pixels decoded fine so the image is still usable.
    let icc: Option<Vec<u8>> = match iccp_chunk(bytes) {
        Some(profile) => {
            let mut owned: Vec<u8> = Vec::new();
            owned
                .try_reserve_exact(profile.len())
                .map_err(|_| codecs::Error::OutOfMemory)?;
            owned.extend_from_slice(profile);
            Some(owned)
        }
        None => None,
    };
    Ok(codecs::Decoded {
        rgba: out,
        width: w,
        height: h,
        icc_profile: icc,
    })
}

/// The colour profile a WebP container carries, or `None`.
///
/// Reads every tag and length once, so an input that JS rewrites under us
/// yields a profile, a `None`, or the bytes of whatever chunk now claims that
/// offset, and never a read outside `bytes`. libwebp's demuxer cannot promise
/// that: it records chunk OFFSETS and re-reads each tag from the caller's
/// buffer on every lookup, so `WebPDemuxGetChunk` counts the matching chunks
/// in one walk (`ChunkCount`, demux.c:905) and finds the Nth in a second
/// (`GetChunk`, demux.c:912). A tag that changes in between leaves the count
/// non-zero and the lookup NULL, which `SetChunk` (demux.c:938) dereferences.
///
/// For input that does not change, the answer is the one that demuxer gave
/// with `allow_partial = 0`: the profile of a container it accepts, `None`
/// for one it refuses, even where the decoder is more lenient and the pixels
/// decode. The rules below are its rules (`ParseVP8X`, `ParseVP8XChunks`,
/// `StoreFrame`, `IsValidExtendedFormat`), less the ones a completed decode of
/// the same bytes already implies.
///
/// RIFF layout: `"RIFF"`, the length of what follows, `"WEBP"`, then chunks of
/// a 4-byte tag, a little-endian length, the payload, and a pad byte to an
/// even length. A colour profile lives in a VP8X container: that chunk comes
/// first and flags what follows it.
fn iccp_chunk(bytes: &[u8]) -> Option<&[u8]> {
    const RIFF_HEADER_SIZE: usize = 12;
    const CHUNK_HEADER_SIZE: usize = 8;
    const VP8X_CHUNK_SIZE: usize = 10;
    const ANIM_CHUNK_SIZE: usize = 6;

    if bytes.len() < RIFF_HEADER_SIZE || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    // Bytes after the RIFF chunk are not part of the file. A RIFF chunk that
    // runs past the buffer is a truncated file.
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().expect("infallible: size matches"));
    let riff_end = (riff_size as usize).checked_add(CHUNK_HEADER_SIZE)?;
    let rest = bytes.get(RIFF_HEADER_SIZE..riff_end)?;

    let ((tag, vp8x), mut rest) = split_chunk(rest)?;
    if tag != *b"VP8X" || vp8x.len() < VP8X_CHUNK_SIZE {
        return None;
    }
    // One byte of flags; the three after it are reserved and not looked at.
    let flags = u32::from(vp8x[0]);
    if flags & ICCP_FLAG == 0 || flags & !ALL_VALID_FLAGS != 0 || flags & ANIMATION_FLAG != 0 {
        return None;
    }

    let mut profile: Option<&[u8]> = None;
    let mut seen_picture = false;
    let mut seen_anim = false;
    while !rest.is_empty() {
        let ((tag, payload), mut after) = split_chunk(rest)?;
        match &tag {
            b"VP8X" => return None,
            b"ANIM" => {
                if payload.len() + (payload.len() & 1) < ANIM_CHUNK_SIZE {
                    return None;
                }
                seen_anim = true;
            }
            // A frame in a container whose animation flag is clear. The
            // demuxer's answer depends on what the frame holds, so take the
            // cautious one: the container is inconsistent, drop the profile.
            b"ANMF" => return None,
            // The one picture: `VP8L`, or `VP8 ` with its alpha plane before it.
            b"ALPH" | b"VP8 " | b"VP8L" => {
                if seen_picture || seen_anim {
                    return None;
                }
                let mut alpha_before = false;
                if tag == *b"ALPH" {
                    let ((next, _), after_picture) = split_chunk(after)?;
                    if next != *b"VP8 " {
                        return None;
                    }
                    after = after_picture;
                    alpha_before = true;
                }
                // An alpha plane AFTER the picture is dropped when the
                // container does not flag alpha, and is an error when it does.
                if !alpha_before
                    && let Some(((next, _), after_alpha)) = split_chunk(after)
                    && next == *b"ALPH"
                {
                    if flags & ALPHA_FLAG != 0 {
                        return None;
                    }
                    after = after_alpha;
                }
                seen_picture = true;
            }
            // The first one is the profile, whatever follows it.
            b"ICCP" if profile.is_none() => profile = Some(payload),
            _ => {}
        }
        rest = after;
    }
    if !seen_picture {
        return None;
    }
    profile.filter(|p| !p.is_empty())
}

/// One chunk off the front: its tag and payload, and what follows it. `None`
/// when the header, the payload or the pad byte of an odd payload does not fit.
fn split_chunk(rest: &[u8]) -> Option<(([u8; 4], &[u8]), &[u8])> {
    let (header, body) = rest.split_at_checked(8)?;
    let tag: [u8; 4] = header[0..4].try_into().expect("infallible: size matches");
    let size =
        u32::from_le_bytes(header[4..8].try_into().expect("infallible: size matches")) as usize;
    let payload = body.get(..size)?;
    let next = body.get(size.checked_add(size & 1)?..)?;
    Some(((tag, payload), next))
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

    // Wrap the bitstream in a VP8X container with an ICCP chunk. libwebpmux
    // builds a new RIFF file from the image + chunk and allocates the
    // assembled output via `WebPMalloc`; hand THAT buffer to JS with
    // `WebPFree` as the finaliser and drop the intermediate encode. With
    // `copy_data = 0` the mux borrows our buffers until `WebPMuxAssemble`
    // returns, so `bitstream`/`profile` must outlive the assemble call
    // (both do — `bitstream` is freed below, `profile` is caller-owned).
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
