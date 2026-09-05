//! Native backing for `CompressionStream` / `DecompressionStream`.
//!
//! The WHATWG Compression Streams spec defines five formats (`deflate`,
//! `deflate-raw`, `gzip`, plus Bun's `brotli` / `zstd` extensions), each a
//! `TransformStream` whose transform step feeds bytes into a codec and
//! enqueues whatever comes out. The C++ `JSCompressionStream` /
//! `JSDecompressionStream` cells own one `CompressionStreamCoder` (a `Box`
//! they release through `CompressionStreamCoder__destroy`) and drive it
//! through the exports at the bottom of this file (thunks in
//! `generated_host_exports.rs`).
//!
//! TransformStream backpressure only applies between chunks, and one chunk can
//! expand without bound (a few hundred bytes of brotli decode to gigabytes), so
//! a chunk is transformed in steps of bounded output ([`Codec::step`]). The
//! C++ arm (`JSCompressionStreamShared.cpp`) delivers each step's output and
//! steps again once the consumer has room; in between, the codec keeps the
//! chunk's unconsumed input ([`Pending`]).

use core::ffi::c_int;

use bun_core::EncodedSlice;
use bun_core::ffi::FfiSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{ErrorCode, JSGlobalObject, JSUint8Array, JSValue, JobPinnedArrayBuffer, Strong};

use bun_brotli::c as brotli;
use bun_zlib as zlib;

use crate::webcore::SinkHandle;

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

/// Growth granularity of a step's output buffer.
const CHUNK: usize = 16 * 1024;

/// Room for one codec call: grows `out`'s spare capacity by up to [`CHUNK`],
/// and returns how much of it the codec may use so `out` stays within `cap`.
fn reserve(out: &mut Vec<u8>, cap: usize) -> Result<usize, CodecError> {
    debug_assert!(out.len() < cap);
    let budget = cap - out.len();
    out.try_reserve(budget.min(CHUNK))
        .map_err(|_| CodecError::OutOfMemory)?;
    Ok(budget)
}

/// `CodecError` for a `ZSTD_isError` return value.
fn zstd_error(rc: usize, message: &'static str) -> CodecError {
    if bun_zstd::c::ZSTD_getErrorCode(rc) == bun_zstd::c::ZSTD_error_memory_allocation {
        CodecError::OutOfMemory
    } else {
        CodecError::Message(message)
    }
}

/// The rest of a chunk (or flush) whose last step stopped at the output cap.
/// Copied, not borrowed: user code runs between steps and may detach the chunk.
struct Pending {
    input: Vec<u8>,
    pos: usize,
    finish: bool,
    /// Per-step output bound, fixed by the chunk's first step.
    cap: usize,
}

enum Progress {
    Done,
    /// Stopped at the output cap; `consumed` bytes of this step's input are used up.
    More {
        consumed: usize,
    },
}

enum Backend {
    Deflate(zlib::DeflateEncoder),
    Inflate {
        state: zlib::InflateDecoder,
        /// Gzip only: after the first member ends, any further bytes must be
        /// another gzip member (RFC 1952 §2.2) — the decoder resets and
        /// continues. Deflate/deflate-raw have no such concatenation, so
        /// leftover input is the spec's "trailing junk" TypeError.
        gzip: bool,
    },
    BrotliEncode(bun_brotli::EncoderStream),
    BrotliDecode(bun_brotli::DecoderStream),
    ZstdEncode(bun_zstd::CompressStream),
    ZstdDecode(bun_zstd::DecompressStream),
}

/// What the C++ cell holds. The codec itself moves into an off-thread step
/// for its duration ([`CompressionAsyncCtx`]) and back when it completes;
/// TransformStream serializes transforms, so nothing asks for it meanwhile.
pub struct CompressionStreamCoder {
    codec: Option<Box<Codec>>,
}

/// The codec state and the bookkeeping a chunk's steps share.
pub struct Codec {
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
    /// The stream's `highWaterMark`: output bound of one step. A chunk larger
    /// than this may produce up to its own size per step (the bound is on
    /// expansion), so a big chunk still finishes in a step or two.
    high_water_mark: usize,
    /// Set while a chunk's transform spans steps; `None` between chunks.
    pending: Option<Pending>,
}

#[derive(Clone, Copy)]
enum CodecError {
    TrailingJunk,
    /// The output buffer or the codec's own state could not be allocated.
    OutOfMemory,
    Message(&'static str),
    /// Brotli decoder error; `BrotliDecoderErrorString` (static C string).
    /// Surfaced as TypeError with `.code = "ERR_" + <this>` for node:zlib compat.
    Brotli(&'static str),
    /// A step was asked for while another still has the codec.
    Busy,
}

impl Codec {
    fn new(format: Format, decompress: bool, high_water_mark: usize) -> Result<Self, CodecError> {
        let backend = match (format, decompress) {
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, false) => {
                // Spec: "default compression level" (Z_DEFAULT_COMPRESSION = -1),
                // default mem_level 8, Z_DEFAULT_STRATEGY.
                let s = zlib::DeflateEncoder::new(-1, format.window_bits(), 8, 0)
                    .map_err(|_| CodecError::Message("failed to initialize deflate"))?;
                Backend::Deflate(s)
            }
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, true) => {
                let s = zlib::InflateDecoder::new(format.window_bits())
                    .map_err(|_| CodecError::Message("failed to initialize inflate"))?;
                Backend::Inflate {
                    state: s,
                    gzip: format == Format::Gzip,
                }
            }
            (Format::Brotli, false) => Backend::BrotliEncode(
                bun_brotli::EncoderStream::new()
                    .ok_or(CodecError::Message("failed to initialize brotli encoder"))?,
            ),
            (Format::Brotli, true) => Backend::BrotliDecode(
                bun_brotli::DecoderStream::new()
                    .ok_or(CodecError::Message("failed to initialize brotli decoder"))?,
            ),
            (Format::Zstd, false) => Backend::ZstdEncode(
                bun_zstd::CompressStream::new()
                    .ok_or(CodecError::Message("failed to initialize zstd encoder"))?,
            ),
            (Format::Zstd, true) => Backend::ZstdDecode(
                bun_zstd::DecompressStream::new()
                    .ok_or(CodecError::Message("failed to initialize zstd decoder"))?,
            ),
        };
        Ok(Self {
            backend,
            ended: false,
            zstd_head: [0; 4],
            zstd_head_len: 0,
            high_water_mark,
            pending: None,
        })
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

    /// One step of the chunk (or, with `finish`, the final flush) in progress:
    /// collects at most `max(high_water_mark, chunk length)` bytes into `out` and
    /// returns `true` if the codec stopped at that cap, in which case the caller
    /// must step again (with no input) before feeding the next chunk.
    fn step(
        &mut self,
        input: FfiSlice<'_>,
        finish: bool,
        out: &mut Vec<u8>,
    ) -> Result<bool, CodecError> {
        out.clear();
        if let Some(mut pending) = self.pending.take() {
            debug_assert!(input.is_empty());
            return match self.run(
                FfiSlice::new(&pending.input[pending.pos..]),
                pending.finish,
                true,
                pending.cap,
                out,
            )? {
                Progress::Done => Ok(false),
                Progress::More { consumed } => {
                    pending.pos += consumed;
                    self.pending = Some(pending);
                    Ok(true)
                }
            };
        }
        // Zstd decode: re-attach the frame magic the previous chunk ended inside of.
        let joined;
        let bytes = if self.zstd_head_len > 0 {
            joined = input.to_vec_with_prefix(&self.zstd_head[..self.zstd_head_len as usize]);
            self.zstd_head_len = 0;
            FfiSlice::new(&joined)
        } else {
            input
        };
        let cap = self.high_water_mark.max(input.len());
        match self.run(bytes, finish, false, cap, out)? {
            Progress::Done => Ok(false),
            Progress::More { consumed } => {
                self.pending = Some(Pending {
                    input: bytes.skip(consumed).to_vec(),
                    pos: 0,
                    finish,
                    cap,
                });
                Ok(true)
            }
        }
    }

    /// Drives the codec until the chunk is done or `out` holds `cap` bytes.
    /// A `continuing` step (not the chunk's first) calls the codec even with no
    /// input left, to drain the output it is holding.
    fn run(
        &mut self,
        input: FfiSlice<'_>,
        finish: bool,
        continuing: bool,
        cap: usize,
        out: &mut Vec<u8>,
    ) -> Result<Progress, CodecError> {
        match &mut self.backend {
            Backend::Deflate(s) => {
                // `avail_in` is `uInt`; `step_into_spare` clamps a ≥4 GiB
                // chunk and reports what it consumed, so refill until done.
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let tail = remaining.len() > u32::MAX as usize;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    let limit = reserve(out, cap)?;
                    let (consumed, rc) = s.step_into_spare(remaining, out, limit, flush);
                    remaining = remaining.skip(consumed);
                    match rc {
                        zlib::ReturnCode::Ok | zlib::ReturnCode::BufError => {}
                        zlib::ReturnCode::StreamEnd => return Ok(Progress::Done),
                        zlib::ReturnCode::MemError => return Err(CodecError::OutOfMemory),
                        _ => return Err(CodecError::Message("deflate failed")),
                    }
                    if s.avail_out() != 0 && remaining.is_empty() {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::Inflate { state: s, gzip } => {
                let gzip = *gzip;
                if !continuing {
                    // `self.ended` = "the last inflate returned StreamEnd" = "at
                    // a member boundary". For gzip, a following chunk starts the
                    // next member; for deflate/deflate-raw it is trailing junk.
                    if self.ended && !input.is_empty() {
                        if !gzip {
                            return Err(CodecError::TrailingJunk);
                        }
                        if s.reset() != zlib::ReturnCode::Ok {
                            return Err(CodecError::Message("inflate failed"));
                        }
                        self.ended = false;
                    }
                    if input.is_empty() && (self.ended || !finish) {
                        return Ok(Progress::Done);
                    }
                }
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let tail = remaining.len() > u32::MAX as usize;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    let limit = reserve(out, cap)?;
                    let (consumed, rc) = s.step_into_spare(remaining, out, limit, flush);
                    remaining = remaining.skip(consumed);
                    match rc {
                        zlib::ReturnCode::Ok => {}
                        zlib::ReturnCode::BufError => {
                            if finish && !tail {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                        }
                        zlib::ReturnCode::StreamEnd => {
                            self.ended = true;
                            if remaining.is_empty() {
                                return Ok(Progress::Done);
                            }
                            if !gzip {
                                return Err(CodecError::TrailingJunk);
                            }
                            if s.reset() != zlib::ReturnCode::Ok {
                                return Err(CodecError::Message("inflate failed"));
                            }
                            self.ended = false;
                            continue;
                        }
                        zlib::ReturnCode::NeedDict => {
                            return Err(CodecError::Message("Missing dictionary"));
                        }
                        zlib::ReturnCode::MemError => return Err(CodecError::OutOfMemory),
                        _ => return Err(CodecError::Message("inflate failed")),
                    }
                    if s.avail_out() != 0 && remaining.is_empty() {
                        if finish && !self.ended {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::BrotliEncode(encoder) => {
                let op = if finish {
                    brotli::BrotliEncoderOperation::finish
                } else {
                    brotli::BrotliEncoderOperation::process
                };
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let limit = reserve(out, cap)?;
                    let step = encoder.step(op, remaining, out, limit);
                    remaining = remaining.skip(step.consumed);
                    if !step.result {
                        return Err(CodecError::Message("brotli encode failed"));
                    }
                    if remaining.is_empty() && step.avail_out != 0 {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::BrotliDecode(decoder) => {
                if self.ended {
                    if !input.is_empty() {
                        return Err(CodecError::TrailingJunk);
                    }
                    return Ok(Progress::Done);
                }
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let limit = reserve(out, cap)?;
                    let step = decoder.step(remaining, out, limit);
                    remaining = remaining.skip(step.consumed);
                    match step.result {
                        brotli::BrotliDecoderResult::success => {
                            self.ended = true;
                            if !remaining.is_empty() {
                                return Err(CodecError::TrailingJunk);
                            }
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_input => {
                            // Brotli reports `needs_more_input` even with output left in its ring buffer.
                            // SAFETY: `p` is a live decoder.
                            let decoder = unsafe { &*p.as_ptr() };
                            if written > 0 && brotli::BrotliDecoder::has_more_output(decoder) {
                                continue;
                            }
                            if finish {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_output => {}
                        brotli::BrotliDecoderResult::err => {
                            let ec = decoder.error_code();
                            if ec.is_alloc_failure() {
                                return Err(CodecError::OutOfMemory);
                            }
                            return Err(CodecError::Brotli(
                                bun_brotli::decoder_error_string(ec)
                                    .to_str()
                                    .unwrap_or("brotli decode failed"),
                            ));
                        }
                    }
                }
            }
            Backend::ZstdEncode(cctx) => {
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let limit = reserve(out, cap)?;
                    let step = cctx.step(remaining, out, limit, finish);
                    remaining = remaining.skip(step.consumed);
                    if bun_zstd::c::ZSTD_isError(step.code) != 0 {
                        return Err(zstd_error(step.code, "zstd encode failed"));
                    }
                    if remaining.is_empty() && (!finish || step.code == 0) {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::ZstdDecode(dctx) => {
                // After a frame completes, whatever follows must be another frame
                // magic (see `zstd_head`); `step` has already re-attached a split one.
                let mut remaining = input;
                loop {
                    if self.ended {
                        if remaining.is_empty() {
                            return Ok(Progress::Done);
                        }
                        let mut head_buf = [0u8; 4];
                        let head_len = remaining.copy_to(&mut head_buf);
                        let head = &head_buf[..head_len];
                        if !Self::is_zstd_frame_prefix(head) {
                            return Err(CodecError::TrailingJunk);
                        }
                        if head.len() < 4 {
                            if finish {
                                return Err(CodecError::TrailingJunk);
                            }
                            self.zstd_head = head_buf;
                            self.zstd_head_len = head_len as u8;
                            return Ok(Progress::Done);
                        }
                        dctx.reset();
                        self.ended = false;
                    }
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let limit = reserve(out, cap)?;
                    let step = dctx.step(remaining, out, limit);
                    remaining = remaining.skip(step.consumed);
                    if bun_zstd::c::ZSTD_isError(step.code) != 0 {
                        return Err(zstd_error(step.code, "zstd decode failed"));
                    }
                    if step.code == 0 {
                        self.ended = true;
                        continue;
                    }
                    if remaining.is_empty() && step.written < step.offered {
                        if finish {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        return Ok(Progress::Done);
                    }
                }
            }
        }
    }
}

impl CompressionStreamCoder {
    /// One JS-thread step with the codec this coder holds (the C++ side never
    /// steps while an off-thread step has it: `m_asyncCodecInFlight`).
    fn step(&mut self, input: &[u8], finish: bool, out: &mut Vec<u8>) -> Result<bool, CodecError> {
        debug_assert!(self.codec.is_some(), "codec stepped while off-thread");
        match &mut self.codec {
            Some(codec) => codec.step(FfiSlice::new(input), finish, out),
            None => Err(CodecError::Busy),
        }
    }
}

/// A chunk's bytes for the pool thread: the pinned ArrayBuffer they live in
/// (fed to the codec in place), or a copy made up front.
pub(crate) enum AsyncInput {
    Pinned(JobPinnedArrayBuffer),
    Owned(Vec<u8>),
}

impl AsyncInput {
    /// JS thread: pin `chunk` if it is a pinnable ArrayBuffer/view, else copy `fallback`.
    pub(crate) fn new(global: &JSGlobalObject, chunk: JSValue, fallback: &[u8]) -> Self {
        match JobPinnedArrayBuffer::root(global, chunk) {
            Some(pinned) => Self::Pinned(pinned),
            None => Self::Owned(fallback.to_vec()),
        }
    }

    /// Pool thread, under the job's ticket: the bytes to feed the codec.
    pub(crate) fn ffi_slice<'a>(&'a self, ticket: &'a bun_jsc::Ticket) -> FfiSlice<'a> {
        match self {
            Self::Pinned(pinned) => pinned.ffi_slice(ticket),
            Self::Owned(v) => FfiSlice::new(v),
        }
    }
}

// ─── exports (called from JSCompressionStream.cpp) ─────────────────────────

// HOST_EXPORT(CompressionStreamCoder__create, c)
pub fn create(
    format: u8,
    decompress: bool,
    high_water_mark: usize,
) -> Option<Box<crate::webcore::compression_stream_coder::CompressionStreamCoder>> {
    let format = Format::from_u8(format)?;
    let codec = Codec::new(format, decompress, high_water_mark.max(1)).ok()?;
    Some(Box::new(CompressionStreamCoder {
        codec: Some(Box::new(codec)),
    }))
}

/// The C++ cell (its finalizer or `nativeTransformReleaseState`) gives up the
/// coder; a step still on the pool owns the codec and drops it itself.
// HOST_EXPORT(CompressionStreamCoder__destroy, c)
pub fn destroy(
    this: Option<Box<crate::webcore::compression_stream_coder::CompressionStreamCoder>>,
) {
    drop(this);
}

/// One JS-thread [`step`](Codec::step): returns its output as a fresh
/// (possibly empty) `Uint8Array` and sets `more` if the coder must be stepped
/// again (with empty `input`), or throws a `TypeError` and returns zero.
// HOST_EXPORT(CompressionStreamCoder__transform, c)
pub fn transform(
    this: &mut crate::webcore::compression_stream_coder::CompressionStreamCoder,
    global: &JSGlobalObject,
    input: &[u8],
    finish: bool,
    more: &mut bool,
) -> JSValue {
    let rare = global.bun_vm().as_mut().rare_data();
    let mut out = rare.take_compression_scratch();
    let result = match this.step(input, finish, &mut out) {
        Ok(has_more) => {
            *more = has_more;
            let chunk = if out.is_empty() {
                JSUint8Array::create_empty(global)
            } else {
                JSUint8Array::from_bytes_copy(global, &out)
            };
            bun_jsc::to_js_host_fn_result(global, chunk)
        }
        Err(e) => {
            *more = false;
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    };
    rare.put_back_compression_scratch(out);
    result
}

fn codec_error_to_js(global: &JSGlobalObject, e: &CodecError) -> JSValue {
    match *e {
        CodecError::TrailingJunk => global
            .err(
                ErrorCode::ERR_TRAILING_JUNK_AFTER_STREAM_END,
                format_args!("Trailing junk found after the end of the compressed stream"),
            )
            .to_js(),
        CodecError::OutOfMemory => global.create_out_of_memory_error(),
        CodecError::Message(msg) => global.create_type_error_instance(format_args!("{msg}")),
        CodecError::Brotli(detail) => {
            let code = format!("ERR_{detail}");
            let err = global.create_type_error_instance(format_args!("brotli decode failed"));
            let code_js = EncodedSlice::latin1(code.as_bytes()).to_js(global);
            err.put(global, b"code", code_js);
            let cause = global.create_error_instance(format_args!("{detail}"));
            cause.put(global, b"code", code_js);
            err.put(global, b"cause", cause);
            err
        }
        CodecError::Busy => global.create_type_error_instance(format_args!(
            "compression stream is busy with another chunk"
        )),
    }
}

fn throw_codec_error(global: &JSGlobalObject, e: CodecError) {
    let _ = global.throw_value(codec_error_to_js(global, &e));
}

/// [`CompressionStreamCoder__transform`], but the output is written to the
/// stream's native `sink`: returns the sink's `write` result (see
/// nativeSinkWriteIsBackpressure), `undefined` when there was no output.
// HOST_EXPORT(CompressionStreamCoder__transformInto, c)
pub fn transform_into(
    this: &mut crate::webcore::compression_stream_coder::CompressionStreamCoder,
    global: &JSGlobalObject,
    input: &[u8],
    finish: bool,
    sink: SinkHandle,
    more: &mut bool,
) -> JSValue {
    let rare = global.bun_vm().as_mut().rare_data();
    let mut out = rare.take_compression_scratch();
    let result = match this.step(input, finish, &mut out) {
        Ok(has_more) => {
            *more = has_more;
            if out.is_empty() || sink.is_none() {
                JSValue::UNDEFINED
            } else {
                // The sink copies what it needs before returning.
                sink.write(&crate::webcore::streams::Result::Temporary(
                    bun_ptr::RawSlice::new(&out),
                ))
                .to_js(global)
            }
        }
        Err(e) => {
            *more = false;
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    };
    rare.put_back_compression_scratch(out);
    result
}

// ─── off-thread path (chunks > kAsyncCodecThreshold) ───────────────────────

#[allow(improper_ctypes)] // `Codec` is opaque to C++: handed straight back to `CompressionStreamCoder__restore`
unsafe extern "C" {
    /// JS-thread completion in `JSCompressionStreamShared.cpp`: hands `codec`
    /// back to the stream's coder (`CompressionStreamCoder__restore`), then
    /// consumes `out` before anything may release or re-dispatch the coder.
    safe fn Bun__CompressionStream__deliverAsync(
        global: &JSGlobalObject,
        stream_cell: JSValue,
        codec: Option<Box<Codec>>,
        out: FfiSlice<'_>,
        more: bool,
        error: JSValue,
    );
}

/// The codec an off-thread step took comes back to the coder the stream
/// still holds (`None` if the stream has none, which drops it).
// HOST_EXPORT(CompressionStreamCoder__restore, c)
pub fn restore(
    this: Option<&mut crate::webcore::compression_stream_coder::CompressionStreamCoder>,
    codec: Option<Box<crate::webcore::compression_stream_coder::Codec>>,
) {
    if let Some(this) = this {
        debug_assert!(this.codec.is_none());
        this.codec = codec;
    }
}

/// One step of a large `CompressionStream`/`DecompressionStream` chunk, run
/// off the JS thread. It owns the codec for its duration; TransformStream
/// serializes writes, so nothing else asks for it meanwhile.
pub struct CompressionAsyncCtx {
    codec: Option<Box<Codec>>,
    /// Empty on a continuation step: the codec holds the chunk's tail.
    input: AsyncInput,
    finish: bool,
    out: Vec<u8>,
    more: bool,
    error: Option<CodecError>,
}

#[derive(bun_jsc::JsAffine)]
pub struct CompressionAsyncJs {
    /// GC root for the `JSTransformStream` cell; its `m_asyncCodecInFlight`
    /// flag defers the eager ClearAlgorithms release while this task holds it,
    /// and its `m_codecPromise` WriteBarrier keeps the pending
    /// transform-algorithm promise alive.
    stream: Strong,
}

impl bun_jsc::JobContext for CompressionAsyncCtx {
    type OffThread = Self;
    type Js = CompressionAsyncJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        let result = match &mut this.codec {
            Some(codec) => codec.step(
                this.input.ffi_slice(done.ticket()),
                this.finish,
                &mut this.out,
            ),
            None => Err(CodecError::Busy),
        };
        match result {
            Ok(more) => this.more = more,
            Err(e) => this.error = Some(e),
        }
        Some(done)
    }

    fn then(
        this: Self,
        js: CompressionAsyncJs,
        cx: &bun_jsc::JsThread<'_>,
    ) -> bun_jsc::JsResult<()> {
        let global = cx.global();
        let (out, err) = match &this.error {
            None => (&this.out[..], JSValue::ZERO),
            Some(e) => (&[][..], codec_error_to_js(global, e)),
        };
        Bun__CompressionStream__deliverAsync(
            global,
            js.stream.get(),
            this.codec,
            FfiSlice::new(out),
            this.more,
            err,
        );
        Ok(())
    }
}

/// Schedules one off-thread step; a continuation step passes no chunk and no
/// input (the codec kept the tail). `input` is `chunk`'s bytes: pinned and
/// read in place when `chunk` allows it, else copied.
// HOST_EXPORT(CompressionStreamCoder__transformAsync, c)
pub fn transform_async(
    this: &mut crate::webcore::compression_stream_coder::CompressionStreamCoder,
    global: &JSGlobalObject,
    stream_cell: JSValue,
    chunk: JSValue,
    input: &[u8],
    finish: bool,
) {
    let input = AsyncInput::new(global, chunk, input);
    let cx = global.js_thread();
    bun_jsc::Job::<CompressionAsyncCtx>::schedule(
        &cx,
        CompressionAsyncCtx {
            codec: this.codec.take(),
            input,
            finish,
            out: Vec::new(),
            more: false,
            error: None,
        },
        CompressionAsyncJs {
            stream: Strong::create(stream_cell, global),
        },
    );
}
