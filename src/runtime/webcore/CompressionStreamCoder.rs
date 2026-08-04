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

use core::ffi::c_int;
use core::ptr::{self, NonNull};

use bun_jsc::ZigStringJsc as _;
use bun_jsc::work_task::{WorkTask, WorkTaskContext};
use bun_jsc::zig_string::ZigString as JscZigString;
use bun_jsc::{ErrorCode, JSGlobalObject, JSUint8Array, JSValue, JsTerminated, Strong};

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
    /// Output buffer for `transform`. Reused across chunks; `transform` clears
    /// it on entry.
    out: Vec<u8>,
}

// SAFETY: the z_stream / Brotli*Instance / ZSTD_*Ctx handles are single-owner
// heap state with no thread affinity; TransformStream serializes writes so at
// most one chunk is ever in flight per coder.
unsafe impl Send for CompressionStreamCoder {}

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
    /// Brotli decoder error; `BrotliDecoderErrorString` (static C string).
    /// Surfaced as TypeError with `.code = "ERR_" + <this>` for node:zlib compat.
    Brotli(&'static str),
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
            out: Vec::new(),
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
    /// codec produces into `self.out` (cleared on entry). `finish` drives the
    /// codec to completion and performs the "unexpected end of file" /
    /// "trailing junk" checks.
    fn transform(&mut self, input: &[u8], finish: bool) -> Result<(), CodecError> {
        let out = &mut self.out;
        out.clear();
        match &mut self.backend {
            Backend::Deflate(s) => {
                // `avail_in` is `uInt`; clamp and refill so a ≥4 GiB chunk
                // isn't silently truncated by the `as u32` cast.
                let mut remaining = input;
                loop {
                    let take = remaining.len().min(u32::MAX as usize);
                    let tail = remaining.len() > take;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    s.next_in = remaining.as_ptr();
                    s.avail_in = take as u32;
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    s.next_out = spare.as_mut_ptr().cast();
                    s.avail_out = spare.len().min(u32::MAX as usize) as u32;
                    let before = s.avail_out;
                    // SAFETY: `s` was initialized by `deflateInit2_`; next_in/
                    // avail_in borrow `remaining`, next_out/avail_out borrow
                    // the Vec's spare capacity for this one call.
                    let rc = unsafe { zlib::deflate(&raw mut **s, flush) };
                    let written = (before - s.avail_out) as usize;
                    // SAFETY: deflate wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    let consumed = take - s.avail_in as usize;
                    remaining = &remaining[consumed..];
                    match rc {
                        zlib::ReturnCode::Ok | zlib::ReturnCode::BufError => {}
                        zlib::ReturnCode::StreamEnd => break,
                        _ => return Err(CodecError::Message("deflate failed")),
                    }
                    if s.avail_out != 0 && remaining.is_empty() {
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
                    return Ok(());
                }
                let mut remaining = input;
                loop {
                    let take = remaining.len().min(u32::MAX as usize);
                    let tail = remaining.len() > take;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    s.next_in = remaining.as_ptr();
                    s.avail_in = take as u32;
                    out.reserve(CHUNK);
                    let spare = out.spare_capacity_mut();
                    s.next_out = spare.as_mut_ptr().cast();
                    s.avail_out = spare.len().min(u32::MAX as usize) as u32;
                    let before = s.avail_out;
                    // SAFETY: `s` was initialized by `inflateInit2_`; buffers
                    // as in the deflate arm.
                    let rc = unsafe { zlib::inflate(&raw mut **s, flush) };
                    let written = (before - s.avail_out) as usize;
                    // SAFETY: inflate wrote exactly `written` bytes.
                    unsafe { out.set_len(out.len() + written) };
                    let consumed = take - s.avail_in as usize;
                    remaining = &remaining[consumed..];
                    match rc {
                        zlib::ReturnCode::Ok => {}
                        zlib::ReturnCode::BufError => {
                            if finish && !tail {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                        }
                        zlib::ReturnCode::StreamEnd => {
                            self.ended = true;
                            if !remaining.is_empty() {
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
                    if s.avail_out != 0 && remaining.is_empty() {
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
                    return Ok(());
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
                            // SAFETY: `p` is a live decoder; the error string is a
                            // static C string owned by the brotli library.
                            let code = unsafe {
                                let ec = brotli::BrotliDecoderGetErrorCode(&*p.as_ptr());
                                core::ffi::CStr::from_ptr(brotli::BrotliDecoderErrorString(ec))
                            };
                            return Err(CodecError::Brotli(
                                code.to_str().unwrap_or("brotli decode failed"),
                            ));
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
        Ok(())
    }
}

/// Input bytes for an off-thread codec step. When the chunk is a pinnable
/// `ArrayBuffer`/view, the backing store is pinned (cannot be detached) and
/// the `JSValue` is `protect()`ed (cannot be collected) so the worker thread
/// reads the bytes in place; otherwise the bytes are copied. `Drop` releases
/// both on the JS thread (the ctx box is reclaimed in `then`).
pub(crate) enum AsyncInput {
    Pinned {
        value: JSValue,
        ptr: *const u8,
        len: usize,
    },
    Owned(Vec<u8>),
}

// SAFETY: `Pinned.ptr` borrows a JS ArrayBuffer backing store that is pinned
// and GC-protected for the lifetime of this value; the worker only reads
// through it. The `JSValue` word is only dereferenced (unpin/unprotect) back
// on the JS thread in `Drop`.
unsafe impl Send for AsyncInput {}

impl AsyncInput {
    /// Pin `chunk`'s backing store and GC-protect it, borrowing its bytes; or
    /// copy `fallback` when `chunk` is not a pinnable BufferSource (the
    /// string → `WTF::CString`-scratch branch of `bufferSourceBytes`).
    pub(crate) fn new(global: &JSGlobalObject, chunk: JSValue, fallback: &[u8]) -> Self {
        if let Some(buf) = chunk.as_pinned_arraybuffer(global) {
            // A resizable non-shared backing can `mprotect()` pages out on
            // `resize()`; pinning does not block that, so spill to a copy.
            if buf.resizable && !buf.shared {
                chunk.unpin_array_buffer();
                return Self::Owned(fallback.to_vec());
            }
            chunk.protect();
            return Self::Pinned {
                value: chunk,
                ptr: buf.ptr,
                len: buf.byte_len,
            };
        }
        Self::Owned(fallback.to_vec())
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Self::Pinned { ptr, len, .. } => {
                if ptr.is_null() {
                    return &[];
                }
                // SAFETY: backing store is pinned + GC-protected for `self`'s
                // lifetime; `(ptr, len)` came from a live `ArrayBuffer` view.
                unsafe { core::slice::from_raw_parts(*ptr, *len) }
            }
            Self::Owned(v) => v.as_slice(),
        }
    }
}

impl Drop for AsyncInput {
    fn drop(&mut self) {
        if let Self::Pinned { value, .. } = *self {
            value.unpin_array_buffer();
            value.unprotect();
        }
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
#[allow(clippy::not_unsafe_ptr_arg_deref)]
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
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn CompressionStreamCoder__transform(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
) -> JSValue {
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    // SAFETY: `this` is the live coder owned by the calling JS cell; it is
    // only driven from the JS thread, so the call-scoped `&mut *this` has no
    // alias. No JS runs between `transform` and `take` below.
    match unsafe { (*this).transform(slice, finish) } {
        Ok(()) => {
            // SAFETY: as above.
            let out = unsafe { core::mem::take(&mut (*this).out) };
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

fn codec_error_to_js(global: &JSGlobalObject, e: &CodecError) -> JSValue {
    match *e {
        CodecError::TrailingJunk => global
            .err(
                ErrorCode::ERR_TRAILING_JUNK_AFTER_STREAM_END,
                format_args!("Trailing junk found after the end of the compressed stream"),
            )
            .to_js(),
        CodecError::Message(msg) => global.create_type_error_instance(format_args!("{msg}")),
        CodecError::Brotli(detail) => {
            let code = format!("ERR_{detail}");
            let err = global.create_type_error_instance(format_args!("brotli decode failed"));
            let code_js = JscZigString::init(code.as_bytes()).to_js(global);
            err.put(global, b"code", code_js);
            let cause = global.create_error_instance(format_args!("{detail}"));
            cause.put(global, b"code", code_js);
            err.put(global, b"cause", cause);
            err
        }
    }
}

fn throw_codec_error(global: &JSGlobalObject, e: CodecError) {
    let _ = global.throw_value(codec_error_to_js(global, &e));
}

/// Runs one transform step and writes the output straight to a native JSSink
/// (`m_sinkPtr`), so the chunk never becomes a `JSUint8Array`. Returns the
/// sink's `write_bytes` result (see nativeSinkWriteIsBackpressure for the
/// backpressure-signal shapes), `undefined` for an empty output, or
/// `JSValue::zero` with an exception pending on `global` on codec failure.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn CompressionStreamCoder__transformInto(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
    sink_id: u8,
    sink_ptr: *mut core::ffi::c_void,
) -> JSValue {
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: as in `__transform`.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    // SAFETY: as in `__transform`.
    match unsafe { (*this).transform(slice, finish) } {
        Ok(()) => {
            // SAFETY: as above; the sink copies before returning.
            let out = unsafe { &(*this).out };
            if out.is_empty() {
                return JSValue::UNDEFINED;
            }
            let Some(sink_ptr) = NonNull::new(sink_ptr) else {
                return JSValue::UNDEFINED;
            };
            // SAFETY: `sink_ptr` is a live JSSink of type `sink_id`; the sink
            // copies what it needs before returning.
            let handle = unsafe { crate::webcore::sink::sink_handle_from_id(sink_id, sink_ptr) };
            if handle.is_none() {
                return JSValue::UNDEFINED;
            }
            handle
                .write(&crate::webcore::streams::Result::Temporary(
                    bun_ptr::RawSlice::new(out),
                ))
                .to_js(global)
        }
        Err(e) => {
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    }
}

// ─── off-thread path (chunks > kAsyncCodecThreshold) ───────────────────────

unsafe extern "C" {
    /// JS-thread completion hook in `JSCompressionStreamShared.cpp`. Copies
    /// `out[..out_len]` into the sink / a fresh Uint8Array before it clears
    /// `m_asyncCodecInFlight` (so a deferred coder release cannot free the
    /// bytes under it), then settles the stream's `m_asyncCodecPromise`.
    fn Bun__CompressionStream__deliverAsync(
        global: &JSGlobalObject,
        stream_cell: JSValue,
        out: *const u8,
        out_len: usize,
        error: JSValue,
    );
}

pub struct CompressionAsyncCtx {
    coder: *mut CompressionStreamCoder,
    input: AsyncInput,
    finish: bool,
    /// GC root for the `JSTransformStream` cell that owns `coder`; its
    /// `m_asyncCodecInFlight` flag defers `m_coder` teardown while this task
    /// holds it, and its `m_asyncCodecPromise` WriteBarrier keeps the pending
    /// transform-algorithm promise alive.
    stream: Strong,
    error: Option<CodecError>,
}

pub type CompressionStreamCoderTask = WorkTask<CompressionAsyncCtx>;

#[allow(clippy::not_unsafe_ptr_arg_deref)]
impl WorkTaskContext for CompressionAsyncCtx {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::CompressionStreamCoderTask;

    fn run(this: *mut Self, task: *mut WorkTask<Self>) {
        // SAFETY: work-pool hand-off; `this`/`task` are live and exclusive.
        // `coder` is kept alive by `m_asyncCodecInFlight` on the rooted stream
        // cell, and TransformStream serializes writes so nothing else aliases it.
        unsafe {
            let ctx = &mut *this;
            ctx.error = (*ctx.coder).transform(ctx.input.slice(), ctx.finish).err();
            WorkTask::on_finish(&mut *task);
        }
    }

    fn then(this: *mut Self, global: &JSGlobalObject) -> Result<(), JsTerminated> {
        // SAFETY: heap-allocated in `__transformAsync`; consumed here so
        // `input` (unpin/unprotect) and `stream` drop on the JS thread.
        let ctx = unsafe { bun_core::heap::take(this) };
        let stream = ctx.stream.get();
        let (out, out_len, err) = match ctx.error {
            None => {
                // SAFETY: `m_asyncCodecInFlight` still holds; `coder` (and its
                // `out` buffer) stay live until `deliverAsync` copies and clears it.
                let coder = unsafe { &*ctx.coder };
                (coder.out.as_ptr(), coder.out.len(), JSValue::ZERO)
            }
            Some(e) => (core::ptr::null(), 0, codec_error_to_js(global, &e)),
        };
        // SAFETY: FFI into `JSCompressionStreamShared.cpp`; the callee copies
        // `out[..out_len]` before releasing the coder.
        unsafe { Bun__CompressionStream__deliverAsync(global, stream, out, out_len, err) };
        Ok(())
    }
}

/// Schedules one transform step on the WorkPool. The caller
/// (`codeAndEnqueue`) has already created the pending `JSPromise`, stored it
/// on `stream_cell->m_asyncCodecPromise`, and set `m_asyncCodecInFlight`;
/// `Bun__CompressionStream__deliverAsync` settles that promise.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn CompressionStreamCoder__transformAsync(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    stream_cell: JSValue,
    chunk: JSValue,
    input: *const u8,
    input_len: usize,
    finish: bool,
) {
    let fallback = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; either pinned (and
        // `fallback` is ignored) or copied into an owned Vec.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    let ctx = bun_core::heap::into_raw(Box::new(CompressionAsyncCtx {
        coder: this,
        input: AsyncInput::new(global, chunk, fallback),
        finish,
        stream: Strong::create(stream_cell, global),
        error: None,
    }));
    let task = WorkTask::<CompressionAsyncCtx>::create_on_js_thread(global, ctx);
    // SAFETY: `task` is a freshly-allocated WorkTask; sole owner until scheduled.
    WorkTask::schedule(unsafe { &mut *task });
}
