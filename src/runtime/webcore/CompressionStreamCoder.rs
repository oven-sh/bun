//! Native backing for `CompressionStream` / `DecompressionStream`.
//!
//! The WHATWG Compression Streams spec defines five formats (`deflate`,
//! `deflate-raw`, `gzip`, plus Bun's `brotli` / `zstd` extensions), each a
//! `TransformStream` whose transform step feeds bytes into a codec and
//! enqueues whatever comes out. The C++ `JSCompressionStream` /
//! `JSDecompressionStream` cells own one `CompressionStreamCoder` via a
//! `void*` and drive it per chunk through the three `extern "C"` fns at the
//! bottom of this file; the TransformStream machinery already handles
//! backpressure, so this layer is a pure `bytes in → bytes out` pump.

#![allow(clippy::not_unsafe_ptr_arg_deref)]

use core::ffi::c_int;
use core::ptr::{self, NonNull};

use bun_jsc::{ErrorCode, JSGlobalObject, JSUint8Array, JSValue};

use bun_brotli::c as brotli;
use bun_zlib as zlib;
use bun_zstd::c as zstd;

/// Matches `Bun::WebStreams::CompressionFormat` in `StreamsForward.h`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Deflate = 0,
    DeflateRaw = 1,
    Gzip = 2,
    Brotli = 3,
    Zstd = 4,
}

impl Format {
    fn from_u8(n: u8) -> Option<Self> {
        Some(match n {
            0 => Self::Deflate,
            1 => Self::DeflateRaw,
            2 => Self::Gzip,
            3 => Self::Brotli,
            4 => Self::Zstd,
            _ => return None,
        })
    }

    fn window_bits(self) -> c_int {
        match self {
            Self::Deflate => zlib::MAX_WBITS,
            Self::DeflateRaw => -zlib::MAX_WBITS,
            Self::Gzip => zlib::MAX_WBITS + 16,
            Self::Brotli | Self::Zstd => unreachable!(),
        }
    }
}

const CHUNK: usize = 16 * 1024;

enum Backend {
    Deflate(Box<zlib::z_stream>),
    Inflate {
        state: Box<zlib::z_stream>,
        /// Gzip only: after the first member ends, any further bytes must be
        /// another gzip member (RFC 1952 §2.2) — the decoder resets and
        /// continues. Deflate/deflate-raw have no such concatenation, so
        /// leftover input is the spec's "trailing junk" TypeError.
        gzip: bool,
    },
    BrotliEncode(NonNull<brotli::BrotliEncoder>),
    BrotliDecode(NonNull<brotli::BrotliDecoder>),
    ZstdEncode(NonNull<zstd::ZSTD_CCtx>),
    ZstdDecode(NonNull<zstd::ZSTD_DStream>),
}

pub struct CompressionStreamCoder {
    backend: Backend,
    /// DecompressionStream only: the codec has reported end-of-stream. Any
    /// further input is the spec's "trailing junk" TypeError.
    ended: bool,
    /// Zstd decode only: bytes of a split frame magic carried across chunks.
    /// A zstd stream is one or more concatenated frames (RFC 8878 §3.1), but
    /// anything else after a completed frame is trailing junk; when a chunk
    /// ends with <4 bytes after frame-complete we cannot tell which yet.
    zstd_head: [u8; 4],
    zstd_head_len: u8,
}

impl Drop for CompressionStreamCoder {
    fn drop(&mut self) {
        // SAFETY: each pointer was created by the matching `*_create`/`*Init`
        // below and has not been freed (the field is consumed exactly once,
        // here).
        unsafe {
            match &mut self.backend {
                Backend::Deflate(s) => {
                    zlib::deflateEnd(&raw mut **s);
                }
                Backend::Inflate { state, .. } => {
                    zlib::inflateEnd(&raw mut **state);
                }
                Backend::BrotliEncode(p) => brotli::BrotliEncoderDestroyInstance(p.as_ptr()),
                Backend::BrotliDecode(p) => brotli::BrotliDecoderDestroyInstance(p.as_ptr()),
                Backend::ZstdEncode(p) => {
                    zstd::ZSTD_freeCCtx(p.as_ptr());
                }
                Backend::ZstdDecode(p) => {
                    zstd::ZSTD_freeDCtx(p.as_ptr());
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
enum CodecError {
    TrailingJunk,
    Message(&'static str),
}

impl CompressionStreamCoder {
    fn new(format: Format, decompress: bool) -> Result<Box<Self>, CodecError> {
        let backend = match (format, decompress) {
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, false) => {
                let mut s = Box::new(bun_core::ffi::zeroed::<zlib::z_stream>());
                // Spec: "default compression level". Z_DEFAULT_COMPRESSION = -1.
                // SAFETY: `s` is a zeroed, #[repr(C)] z_stream; zlibVersion() is
                // a static C string.
                let rc = unsafe {
                    zlib::deflateInit2_(
                        &raw mut *s,
                        -1,
                        8, // Z_DEFLATED
                        format.window_bits(),
                        8, // default mem_level
                        0, // Z_DEFAULT_STRATEGY
                        zlib::zlibVersion().cast(),
                        core::mem::size_of::<zlib::z_stream>() as c_int,
                    )
                };
                if rc != zlib::ReturnCode::Ok {
                    return Err(CodecError::Message("failed to initialize deflate"));
                }
                Backend::Deflate(s)
            }
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, true) => {
                let mut s = Box::new(bun_core::ffi::zeroed::<zlib::z_stream>());
                // SAFETY: as above.
                let rc = unsafe {
                    zlib::inflateInit2_(
                        &raw mut *s,
                        format.window_bits(),
                        zlib::zlibVersion().cast(),
                        core::mem::size_of::<zlib::z_stream>() as c_int,
                    )
                };
                if rc != zlib::ReturnCode::Ok {
                    return Err(CodecError::Message("failed to initialize inflate"));
                }
                Backend::Inflate {
                    state: s,
                    gzip: format == Format::Gzip,
                }
            }
            (Format::Brotli, false) => {
                // SAFETY: FFI — the default-allocator instance (all nulls).
                let p = NonNull::new(unsafe {
                    brotli::BrotliEncoderCreateInstance(None, None, ptr::null_mut())
                })
                .ok_or(CodecError::Message("failed to initialize brotli encoder"))?;
                Backend::BrotliEncode(p)
            }
            (Format::Brotli, true) => {
                // SAFETY: FFI — the default-allocator instance (all nulls).
                let p = NonNull::new(unsafe {
                    brotli::BrotliDecoderCreateInstance(None, None, ptr::null_mut())
                })
                .ok_or(CodecError::Message("failed to initialize brotli decoder"))?;
                Backend::BrotliDecode(p)
            }
            (Format::Zstd, false) => {
                let p = NonNull::new(zstd::ZSTD_createCCtx())
                    .ok_or(CodecError::Message("failed to initialize zstd encoder"))?;
                Backend::ZstdEncode(p)
            }
            (Format::Zstd, true) => {
                let p = NonNull::new(zstd::ZSTD_createDCtx())
                    .ok_or(CodecError::Message("failed to initialize zstd decoder"))?;
                Backend::ZstdDecode(p)
            }
        };
        Ok(Box::new(Self {
            backend,
            ended: false,
            zstd_head: [0; 4],
            zstd_head_len: 0,
        }))
    }

    const ZSTD_MAGIC: [u8; 4] = 0xFD2F_B528u32.to_le_bytes();
    const ZSTD_MAGIC_SKIPPABLE: [u8; 3] = [0x2A, 0x4D, 0x18];

    /// True when `head` (1..=4 bytes) is a prefix of a zstd or skippable
    /// frame magic.
    fn is_zstd_frame_prefix(head: &[u8]) -> bool {
        head.iter().zip(Self::ZSTD_MAGIC).all(|(a, b)| *a == b)
            || ((head[0] & 0xF0) == 0x50
                && head[1..]
                    .iter()
                    .zip(Self::ZSTD_MAGIC_SKIPPABLE)
                    .all(|(a, b)| *a == b))
    }

    /// Feed one chunk (or the final empty flush) and collect every byte the
    /// codec produces into a fresh `Vec`. `finish` drives the codec to
    /// completion and performs the "unexpected end of file" / "trailing junk"
    /// checks.
    fn transform(&mut self, input: &[u8], finish: bool) -> Result<Vec<u8>, CodecError> {
        let mut out = Vec::<u8>::new();
        match &mut self.backend {
            Backend::Deflate(s) => {
                let flush = if finish {
                    zlib::FlushValue::Finish
                } else {
                    zlib::FlushValue::NoFlush
                };
                s.next_in = input.as_ptr();
                s.avail_in = input.len() as u32;
                loop {
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    s.next_out = spare.as_mut_ptr().cast();
                    s.avail_out = spare.len() as u32;
                    let before = s.avail_out;
                    // SAFETY: `s` was initialized by `deflateInit2_`; next_in/
                    // avail_in borrow `input`, next_out/avail_out borrow the
                    // Vec's spare capacity for this one call.
                    let rc = unsafe { zlib::deflate(&raw mut **s, flush) };
                    let written = (before - s.avail_out) as usize;
                    // SAFETY: deflate wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    match rc {
                        zlib::ReturnCode::Ok | zlib::ReturnCode::BufError => {}
                        zlib::ReturnCode::StreamEnd => break,
                        _ => return Err(CodecError::Message("deflate failed")),
                    }
                    if s.avail_out != 0 {
                        // All input consumed and the codec has no more output
                        // for this chunk.
                        debug_assert_eq!(s.avail_in, 0);
                        break;
                    }
                }
            }
            Backend::Inflate { state: s, gzip } => {
                let gzip = *gzip;
                // `self.ended` = "the last inflate returned StreamEnd" = "at a
                // member boundary". For gzip, a following chunk starts the next
                // member; for deflate/deflate-raw it is trailing junk.
                if self.ended && !input.is_empty() {
                    if !gzip {
                        return Err(CodecError::TrailingJunk);
                    }
                    // SAFETY: `s` is an initialized inflate stream.
                    if unsafe { zlib::inflateReset(&raw mut **s) } != zlib::ReturnCode::Ok {
                        return Err(CodecError::Message("inflate failed"));
                    }
                    self.ended = false;
                }
                if input.is_empty() && (self.ended || !finish) {
                    return Ok(out);
                }
                let flush = if finish {
                    zlib::FlushValue::Finish
                } else {
                    zlib::FlushValue::NoFlush
                };
                s.next_in = input.as_ptr();
                s.avail_in = input.len() as u32;
                loop {
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    s.next_out = spare.as_mut_ptr().cast();
                    s.avail_out = spare.len() as u32;
                    let before = s.avail_out;
                    // SAFETY: `s` was initialized by `inflateInit2_`; buffers
                    // as in the deflate arm.
                    let rc = unsafe { zlib::inflate(&raw mut **s, flush) };
                    let written = (before - s.avail_out) as usize;
                    // SAFETY: inflate wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    match rc {
                        zlib::ReturnCode::Ok => {}
                        zlib::ReturnCode::BufError => {
                            if finish {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                        }
                        zlib::ReturnCode::StreamEnd => {
                            self.ended = true;
                            if s.avail_in != 0 {
                                if gzip {
                                    // SAFETY: `s` is an initialized inflate stream.
                                    if unsafe { zlib::inflateReset(&raw mut **s) }
                                        != zlib::ReturnCode::Ok
                                    {
                                        return Err(CodecError::Message("inflate failed"));
                                    }
                                    self.ended = false;
                                    continue;
                                }
                                return Err(CodecError::TrailingJunk);
                            }
                            break;
                        }
                        zlib::ReturnCode::NeedDict => {
                            return Err(CodecError::Message("Missing dictionary"));
                        }
                        _ => return Err(CodecError::Message("inflate failed")),
                    }
                    if s.avail_out != 0 {
                        debug_assert_eq!(s.avail_in, 0);
                        if finish && !self.ended {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        break;
                    }
                }
            }
            Backend::BrotliEncode(p) => {
                let op = if finish {
                    brotli::BrotliEncoderOperation::finish
                } else {
                    brotli::BrotliEncoderOperation::process
                };
                let mut next_in: *const u8 = input.as_ptr();
                let mut avail_in: usize = input.len();
                loop {
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    let mut next_out: *mut u8 = spare.as_mut_ptr().cast();
                    let mut avail_out: usize = spare.len();
                    let before = avail_out;
                    // SAFETY: `p` is a live encoder; the four ptrs borrow the
                    // locals / spare for this one call.
                    let ok = unsafe {
                        brotli::BrotliEncoderCompressStream(
                            p.as_ptr(),
                            op,
                            &raw mut avail_in,
                            &raw mut next_in,
                            &raw mut avail_out,
                            &raw mut next_out,
                            ptr::null_mut(),
                        )
                    };
                    let written = before - avail_out;
                    // SAFETY: the encoder wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    if ok == 0 {
                        return Err(CodecError::Message("brotli encode failed"));
                    }
                    if avail_in == 0 && avail_out != 0 {
                        break;
                    }
                }
            }
            Backend::BrotliDecode(p) => {
                if self.ended {
                    if !input.is_empty() {
                        return Err(CodecError::TrailingJunk);
                    }
                    return Ok(out);
                }
                let mut next_in: *const u8 = input.as_ptr();
                let mut avail_in: usize = input.len();
                loop {
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    let mut next_out: *mut u8 = spare.as_mut_ptr().cast();
                    let mut avail_out: usize = spare.len();
                    let before = avail_out;
                    // SAFETY: `p` is a live decoder; buffers as above.
                    let result = unsafe {
                        brotli::BrotliDecoderDecompressStream(
                            p.as_ptr(),
                            &raw mut avail_in,
                            &raw mut next_in,
                            &raw mut avail_out,
                            &raw mut next_out,
                            ptr::null_mut(),
                        )
                    };
                    let written = before - avail_out;
                    // SAFETY: the decoder wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    match result {
                        brotli::BrotliDecoderResult::success => {
                            self.ended = true;
                            if avail_in != 0 {
                                return Err(CodecError::TrailingJunk);
                            }
                            break;
                        }
                        brotli::BrotliDecoderResult::needs_more_input => {
                            if finish {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                            break;
                        }
                        brotli::BrotliDecoderResult::needs_more_output => continue,
                        brotli::BrotliDecoderResult::err => {
                            return Err(CodecError::Message("brotli decode failed"));
                        }
                    }
                }
            }
            Backend::ZstdEncode(p) => {
                // ZSTD_EndDirective: 0 = ZSTD_e_continue, 2 = ZSTD_e_end.
                let end: core::ffi::c_uint = if finish { 2 } else { 0 };
                let mut input_buf = zstd::ZSTD_inBuffer {
                    src: input.as_ptr().cast(),
                    size: input.len(),
                    pos: 0,
                };
                loop {
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    let mut output_buf = zstd::ZSTD_outBuffer {
                        dst: spare.as_mut_ptr().cast(),
                        size: spare.len(),
                        pos: 0,
                    };
                    // SAFETY: `p` is a live CCtx; the buffers borrow locals /
                    // spare for this one call.
                    let remaining = unsafe {
                        zstd::ZSTD_compressStream2(
                            p.as_ptr(),
                            &raw mut output_buf,
                            &raw mut input_buf,
                            end,
                        )
                    };
                    // SAFETY: compressStream2 wrote exactly `output_buf.pos`
                    // bytes.
                    unsafe { out.set_len(out.len() + output_buf.pos) };
                    if zstd::ZSTD_isError(remaining) != 0 {
                        return Err(CodecError::Message("zstd encode failed"));
                    }
                    if input_buf.pos == input_buf.size && (!finish || remaining == 0) {
                        break;
                    }
                }
            }
            Backend::ZstdDecode(p) => {
                // A zstd stream is one or more concatenated frames (RFC 8878
                // §3.1, including skippable frames). After a frame completes,
                // the next bytes must be another frame magic; a chunk boundary
                // may fall inside that 4-byte magic, which `zstd_head` carries.
                let joined;
                let bytes: &[u8] = if self.zstd_head_len > 0 {
                    joined = [&self.zstd_head[..self.zstd_head_len as usize], input].concat();
                    self.zstd_head_len = 0;
                    &joined
                } else {
                    input
                };
                let mut input_buf = zstd::ZSTD_inBuffer {
                    src: bytes.as_ptr().cast(),
                    size: bytes.len(),
                    pos: 0,
                };
                loop {
                    if self.ended {
                        let rest = &bytes[input_buf.pos..];
                        if rest.is_empty() {
                            break;
                        }
                        let head = &rest[..rest.len().min(4)];
                        if !Self::is_zstd_frame_prefix(head) {
                            return Err(CodecError::TrailingJunk);
                        }
                        if head.len() < 4 {
                            if finish {
                                return Err(CodecError::TrailingJunk);
                            }
                            self.zstd_head[..head.len()].copy_from_slice(head);
                            self.zstd_head_len = head.len() as u8;
                            break;
                        }
                        // SAFETY: `p` is a live DCtx.
                        unsafe {
                            zstd::ZSTD_DCtx_reset(
                                p.as_ptr(),
                                zstd::ZSTD_reset_session_and_parameters,
                            )
                        };
                        self.ended = false;
                    }
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    let mut output_buf = zstd::ZSTD_outBuffer {
                        dst: spare.as_mut_ptr().cast(),
                        size: spare.len(),
                        pos: 0,
                    };
                    // SAFETY: `p` is a live DCtx; buffers borrow locals / spare
                    // for this one call.
                    let remaining = unsafe {
                        zstd::ZSTD_decompressStream(
                            p.as_ptr(),
                            &raw mut output_buf,
                            &raw mut input_buf,
                        )
                    };
                    // SAFETY: decompressStream wrote exactly `output_buf.pos`
                    // bytes.
                    unsafe { out.set_len(out.len() + output_buf.pos) };
                    if zstd::ZSTD_isError(remaining) != 0 {
                        return Err(CodecError::Message("zstd decode failed"));
                    }
                    if remaining == 0 {
                        self.ended = true;
                        continue;
                    }
                    if input_buf.pos == input_buf.size && output_buf.pos < output_buf.size {
                        if finish {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        break;
                    }
                }
            }
        }
        Ok(out)
    }
}

// ─── extern "C" surface (called from JSCompressionStream.cpp) ──────────────

#[unsafe(no_mangle)]
pub extern "C" fn CompressionStreamCoder__create(
    format: u8,
    decompress: bool,
) -> *mut CompressionStreamCoder {
    let Some(format) = Format::from_u8(format) else {
        return ptr::null_mut();
    };
    match CompressionStreamCoder::new(format, decompress) {
        Ok(b) => Box::into_raw(b),
        Err(_) => ptr::null_mut(),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn CompressionStreamCoder__destroy(this: *mut CompressionStreamCoder) {
    if !this.is_null() {
        // SAFETY: `this` was returned by `CompressionStreamCoder__create` and
        // has not been freed (the C++ cell clears its pointer before calling).
        drop(unsafe { Box::from_raw(this) });
    }
}

/// Runs one transform step. Returns a fresh `Uint8Array` on success, or
/// `JSValue::zero` with a `TypeError` thrown on `global` on failure.
/// `input` may be null iff `input_len == 0`.
#[unsafe(no_mangle)]
pub extern "C" fn CompressionStreamCoder__transform(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
) -> JSValue {
    // SAFETY: `this` is the live coder owned by the calling JS cell; it is
    // only driven from the JS thread, so `&mut *this` has no alias.
    let this = unsafe { &mut *this };
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    match this.transform(slice, finish) {
        Ok(out) => {
            if out.is_empty() {
                JSUint8Array::create_empty(global)
            } else {
                JSUint8Array::from_bytes(global, out.into())
            }
        }
        Err(e) => {
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    }
}

fn throw_codec_error(global: &JSGlobalObject, e: CodecError) {
    match e {
        CodecError::TrailingJunk => {
            let _ = global
                .err(
                    ErrorCode::ERR_TRAILING_JUNK_AFTER_STREAM_END,
                    format_args!("Trailing junk found after the end of the compressed stream"),
                )
                .throw();
        }
        CodecError::Message(msg) => {
            let _ = global.throw_type_error(format_args!("{msg}"));
        }
    }
}

unsafe extern "C" {
    fn Bun__JSSink__writeBytesById(
        sink_id: u8,
        sink_ptr: *mut core::ffi::c_void,
        global: &JSGlobalObject,
        ptr: *const u8,
        len: usize,
    ) -> JSValue;
}

/// Runs one transform step and writes the output straight to a native JSSink
/// (`m_sinkPtr`), so the chunk never becomes a `JSUint8Array`. Returns the
/// sink's `write_bytes` result (a number; negative means backpressure),
/// `undefined` for an empty output, or `JSValue::zero` with an exception
/// pending on `global` on codec failure.
#[unsafe(no_mangle)]
pub extern "C" fn CompressionStreamCoder__transformInto(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
    sink_id: u8,
    sink_ptr: *mut core::ffi::c_void,
) -> JSValue {
    // SAFETY: as in `__transform`.
    let this = unsafe { &mut *this };
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: as in `__transform`.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    match this.transform(slice, finish) {
        Ok(out) if out.is_empty() => JSValue::UNDEFINED,
        Ok(out) => {
            // SAFETY: `sink_ptr` is a live JSSink of type `sink_id` (the C++
            // caller null-checks it before attaching). `out` is owned here and
            // drops on return; the sink copies what it needs.
            unsafe {
                Bun__JSSink__writeBytesById(sink_id, sink_ptr, global, out.as_ptr(), out.len())
            }
        }
        Err(e) => {
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    }
}
