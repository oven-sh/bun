//! Native backing for `CompressionStream` / `DecompressionStream`.
//!
//! The WHATWG Compression Streams spec defines five formats (`deflate`,
//! `deflate-raw`, `gzip`, plus Bun's `brotli` / `zstd` extensions), each a
//! `TransformStream` whose transform step feeds bytes into a codec and
//! enqueues whatever comes out. The C++ `JSCompressionStream` /
//! `JSDecompressionStream` cells own one `CompressionStreamCoder` via a
//! `void*` and drive it through the `extern "C"` fns at the bottom of this
//! file.
//!
//! TransformStream backpressure only applies between chunks, and one chunk can
//! expand without bound (a few hundred bytes of brotli decode to gigabytes), so
//! a chunk is transformed in steps of bounded output
//! ([`CompressionStreamCoder::step`]). The C++ arm
//! (`JSCompressionStreamShared.cpp`) delivers each step's output and steps
//! again once the consumer has room; in between, the coder keeps the chunk's
//! unconsumed input ([`Pending`]).

use core::ffi::c_int;
use core::ptr;

use bun_core::EncodedSlice;
use bun_core::vec::{BorrowedCursor, append_with};
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{ErrorCode, JSGlobalObject, JSUint8Array, JSValue, PinnedArrayBuffer, Strong};

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

/// Growth granularity of a step's output buffer.
const CHUNK: usize = 16 * 1024;

/// One codec call: grows `out` by up to [`CHUNK`], clamped to `cap`. Also returns whether `step` left room.
fn append_step<R>(
    out: &mut Vec<u8>,
    cap: usize,
    step: impl FnOnce(BorrowedCursor<'_, u8>) -> R,
) -> Result<(R, bool), CodecError> {
    debug_assert!(out.len() < cap);
    let budget = cap - out.len();
    out.try_reserve(budget.min(CHUNK))
        .map_err(|_| CodecError::OutOfMemory)?;
    Ok(append_with(out, budget, |mut spare| {
        let result = step(spare.reborrow());
        (result, spare.capacity() != 0)
    }))
}

fn zstd_error(code: bun_zstd::ErrorCode, message: &'static str) -> CodecError {
    if code.0 == zstd::ZSTD_error_memory_allocation {
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
    Inflate(zlib::InflateDecoder),
    BrotliEncode(bun_brotli::OwnedEncoder),
    BrotliDecode(bun_brotli::OwnedDecoder),
    ZstdEncode(bun_zstd::OwnedCCtx),
    ZstdDecode(bun_zstd::OwnedDCtx),
}

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct CompressionStreamCoder {
    backend: Backend,
    /// Shared-ownership count: 1 for the JS cell (released by its finalizer /
    /// `nativeTransformReleaseState` via `CompressionStreamCoder__destroy`), plus 1 per in-flight
    /// `CompressionAsyncCtx`. VM teardown (`lastChanceToFinalize`) runs the
    /// cell's finalizer even while a pool thread is inside `transform` — the
    /// ctx's reference is what keeps the coder alive through that.
    ref_count: bun_ptr::ThreadSafeRefCount<CompressionStreamCoder>,
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
    /// The context of the script that made the stream: its off-thread steps belong to it, also
    /// the ones a native sink asks for.
    context: bun_jsc::ContextId,
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
}

impl CompressionStreamCoder {
    fn new(
        format: Format,
        decompress: bool,
        high_water_mark: usize,
        level: Option<i32>,
    ) -> Result<Box<Self>, CodecError> {
        let backend = match (format, decompress) {
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, false) => {
                // Spec: "default compression level". Z_DEFAULT_COMPRESSION = -1.
                let s = zlib::DeflateEncoder::new(
                    level.unwrap_or(-1),
                    format.window_bits(),
                    8, // default mem_level
                    0, // Z_DEFAULT_STRATEGY
                )
                .map_err(|_| CodecError::Message("failed to initialize deflate"))?;
                Backend::Deflate(s)
            }
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, true) => Backend::Inflate(
                zlib::InflateDecoder::new(format.window_bits())
                    .map_err(|_| CodecError::Message("failed to initialize inflate"))?,
            ),
            (Format::Brotli, false) => {
                if bun_removable_features::is_removed(
                    bun_removable_features::Feature::BrotliEncoder,
                ) {
                    return Err(CodecError::Message(
                        "Brotli compression isn't in this executable",
                    ));
                }
                let mut p = bun_brotli::OwnedEncoder::new(bun_brotli::Allocator::Libc)
                    .ok_or(CodecError::Message("failed to initialize brotli encoder"))?;
                if let Some(quality) = level {
                    if !p.set_parameter(brotli::BROTLI_PARAM_QUALITY, quality as u32) {
                        return Err(CodecError::Message("failed to set brotli quality"));
                    }
                }
                Backend::BrotliEncode(p)
            }
            (Format::Brotli, true) => {
                if bun_removable_features::is_removed(
                    bun_removable_features::Feature::BrotliDecoder,
                ) {
                    return Err(CodecError::Message(
                        "Brotli decompression isn't in this executable",
                    ));
                }
                let p = bun_brotli::OwnedDecoder::new(bun_brotli::Allocator::Libc)
                    .ok_or(CodecError::Message("failed to initialize brotli decoder"))?;
                Backend::BrotliDecode(p)
            }
            (Format::Zstd, false) => {
                let mut p = bun_zstd::OwnedCCtx::new()
                    .ok_or(CodecError::Message("failed to initialize zstd encoder"))?;
                if let Some(lvl) = level {
                    if p.set_parameter(zstd::ZSTD_c_compressionLevel, lvl).is_err() {
                        return Err(CodecError::Message("failed to set zstd level"));
                    }
                }
                Backend::ZstdEncode(p)
            }
            (Format::Zstd, true) => {
                let p = bun_zstd::OwnedDCtx::new()
                    .ok_or(CodecError::Message("failed to initialize zstd decoder"))?;
                Backend::ZstdDecode(p)
            }
        };
        Ok(Box::new(Self {
            backend,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            ended: false,
            zstd_head: [0; 4],
            zstd_head_len: 0,
            high_water_mark,
            pending: None,
            context: bun_jsc::virtual_machine::VirtualMachine::get()
                .context_of_caller()
                .id(),
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

    /// One step of the chunk (or, with `finish`, the final flush) in progress:
    /// collects at most `max(high_water_mark, chunk length)` bytes into `out` and
    /// returns `true` if the codec stopped at that cap, in which case the caller
    /// must step again (with no input) before feeding the next chunk.
    fn step(&mut self, input: &[u8], finish: bool, out: &mut Vec<u8>) -> Result<bool, CodecError> {
        out.clear();
        if let Some(mut pending) = self.pending.take() {
            debug_assert!(input.is_empty());
            return match self.run(
                &pending.input[pending.pos..],
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
        let bytes: &[u8] = if self.zstd_head_len > 0 {
            joined = [&self.zstd_head[..self.zstd_head_len as usize], input].concat();
            self.zstd_head_len = 0;
            &joined
        } else {
            input
        };
        let cap = self.high_water_mark.max(input.len());
        match self.run(bytes, finish, false, cap, out)? {
            Progress::Done => Ok(false),
            Progress::More { consumed } => {
                self.pending = Some(Pending {
                    input: bytes[consumed..].to_vec(),
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
        input: &[u8],
        finish: bool,
        continuing: bool,
        cap: usize,
        out: &mut Vec<u8>,
    ) -> Result<Progress, CodecError> {
        match &mut self.backend {
            Backend::Deflate(s) => {
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    // A step takes at most `u32::MAX` bytes.
                    let tail = remaining.len() > u32::MAX as usize;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    let budget = cap - out.len();
                    let (consumed, rc) =
                        s.step_up_to(remaining, out, budget.min(CHUNK), budget, flush);
                    remaining = &remaining[consumed..];
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
            Backend::Inflate(s) => {
                // After a gzip member ends, further bytes must be another member (RFC 1952 §2.2).
                let gzip = s.is_gzip_only();
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
                    // A step takes at most `u32::MAX` bytes.
                    let tail = remaining.len() > u32::MAX as usize;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    let budget = cap - out.len();
                    let (consumed, rc) =
                        s.step_up_to(remaining, out, budget.min(CHUNK), budget, flush);
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
            Backend::BrotliEncode(p) => {
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
                    let ((consumed, ok), has_room) =
                        append_step(out, cap, |spare| p.step(remaining, spare, op))?;
                    remaining = &remaining[consumed..];
                    if !ok {
                        return Err(CodecError::Message("brotli encode failed"));
                    }
                    if remaining.is_empty() && has_room {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::BrotliDecode(p) => {
                if self.ended {
                    if !input.is_empty() {
                        return Err(CodecError::TrailingJunk);
                    }
                    return Ok(Progress::Done);
                }
                let mut remaining = input;
                loop {
                    let len_before = out.len();
                    if len_before >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let ((consumed, result), _) =
                        append_step(out, cap, |spare| p.step(remaining, spare))?;
                    remaining = &remaining[consumed..];
                    match result {
                        brotli::BrotliDecoderResult::success => {
                            self.ended = true;
                            if !remaining.is_empty() {
                                return Err(CodecError::TrailingJunk);
                            }
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_input => {
                            // Brotli reports `needs_more_input` even with output left in its ring buffer.
                            if out.len() > len_before && p.has_more_output() {
                                continue;
                            }
                            if finish {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_output => {}
                        brotli::BrotliDecoderResult::err => {
                            let ec = p.error_code();
                            if ec.is_alloc_failure() {
                                return Err(CodecError::OutOfMemory);
                            }
                            return Err(CodecError::Brotli(
                                ec.name().to_str().unwrap_or("brotli decode failed"),
                            ));
                        }
                    }
                }
            }
            Backend::ZstdEncode(p) => {
                // ZSTD_EndDirective: 0 = ZSTD_e_continue, 2 = ZSTD_e_end.
                let end: core::ffi::c_uint = if finish { 2 } else { 0 };
                let mut rest = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - rest.len(),
                        });
                    }
                    let ((consumed, remaining), _) =
                        append_step(out, cap, |spare| p.step(rest, spare, end))?;
                    rest = &rest[consumed..];
                    let remaining =
                        remaining.map_err(|code| zstd_error(code, "zstd encode failed"))?;
                    if rest.is_empty() && (!finish || remaining == 0) {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::ZstdDecode(p) => {
                // After a frame completes, whatever follows must be another frame
                // magic (see `zstd_head`); `step` has already re-attached a split one.
                let mut rest = input;
                loop {
                    if self.ended {
                        if rest.is_empty() {
                            return Ok(Progress::Done);
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
                            return Ok(Progress::Done);
                        }
                        p.reset();
                        self.ended = false;
                    }
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - rest.len(),
                        });
                    }
                    let ((consumed, remaining), has_room) =
                        append_step(out, cap, |spare| p.step(rest, spare))?;
                    rest = &rest[consumed..];
                    if remaining.map_err(|code| zstd_error(code, "zstd decode failed"))? == 0 {
                        self.ended = true;
                        continue;
                    }
                    if rest.is_empty() && has_room {
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

/// A chunk's bytes for the pool thread: what the paired [`PinnedArrayBuffer`] on the JS side keeps valid, or an owned copy.
pub(crate) enum AsyncInput {
    Pinned { ptr: *const u8, len: usize },
    Owned(Vec<u8>),
}

impl AsyncInput {
    /// JS thread: pin `chunk` if it is a pinnable ArrayBuffer/view, else copy `fallback`.
    pub(crate) fn new(
        global: &JSGlobalObject,
        chunk: JSValue,
        fallback: &[u8],
    ) -> (Self, Option<PinnedArrayBuffer>) {
        // Continuation steps pass no chunk.
        if !chunk.is_cell() {
            return (Self::Owned(fallback.to_vec()), None);
        }
        if let Some(buf) = PinnedArrayBuffer::root_read_only(global, chunk) {
            return (
                Self::Pinned {
                    ptr: buf.ptr,
                    len: buf.byte_len,
                },
                Some(buf),
            );
        }
        (Self::Owned(fallback.to_vec()), None)
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Self::Pinned { ptr, len } => {
                if ptr.is_null() {
                    return &[];
                }
                // SAFETY: `ptr` points at bytes the paired `PinnedArrayBuffer` keeps
                // valid for as long as the job lives.
                unsafe { core::slice::from_raw_parts(*ptr, *len) }
            }
            Self::Owned(v) => v.as_slice(),
        }
    }
}

// ─── extern "C" surface (called from JSCompressionStream.cpp) ──────────────

/// `level` (present when `has_level`) is range-checked by the caller; ignored for decompression.
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__create(
    format: u8,
    decompress: bool,
    high_water_mark: usize,
    has_level: bool,
    level: i32,
) -> *mut CompressionStreamCoder {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__create
    );
    let Some(format) = Format::from_u8(format) else {
        return ptr::null_mut();
    };
    let level = (has_level && !decompress).then_some(level);
    match CompressionStreamCoder::new(format, decompress, high_water_mark.max(1), level) {
        Ok(b) => Box::into_raw(b),
        Err(_) => ptr::null_mut(),
    }
}

/// Releases the C++ cell's reference; see [`CompressionStreamCoder::ref_count`].
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__destroy(this: *mut CompressionStreamCoder) {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__destroy
    );
    if !this.is_null() {
        // SAFETY: `this` was returned by `CompressionStreamCoder__create` and
        // the cell's reference has not been released yet.
        unsafe { bun_ptr::ThreadSafeRefCount::<CompressionStreamCoder>::deref(this) };
    }
}

/// One JS-thread [`step`](CompressionStreamCoder::step): returns its output as
/// a fresh (possibly empty) `Uint8Array` and sets `more` if the coder must be
/// stepped again (with `input` null), or throws a `TypeError` and returns zero.
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__transform(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
    more: &mut bool,
) -> JSValue {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__transform
    );
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call (`step` copies whatever it leaves unconsumed).
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    let rare = global.bun_vm().rare_data();
    let mut out = rare.take_compression_scratch();
    // SAFETY: `this` is the live coder owned by the calling JS cell; it is
    // only driven from the JS thread, so the call-scoped `&mut *this` has no
    // alias.
    let result = match unsafe { (*this).step(slice, finish, &mut out) } {
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
    }
}

fn throw_codec_error(global: &JSGlobalObject, e: CodecError) {
    let _ = global.throw_value(codec_error_to_js(global, &e));
}

/// [`CompressionStreamCoder__transform`], but the output is written to the
/// native sink of `controller`: returns the sink's `write` result (see
/// nativeSinkWriteIsBackpressure), `undefined` when there was no output.
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__transformInto(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
    controller: &crate::webcore::sink::ReadableSinkController,
    more: &mut bool,
) -> JSValue {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__transformInto
    );
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: as in `CompressionStreamCoder__transform`.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    let rare = global.bun_vm().rare_data();
    let mut out = rare.take_compression_scratch();
    // SAFETY: as in `CompressionStreamCoder__transform`.
    let result = match unsafe { (*this).step(slice, finish, &mut out) } {
        Ok(has_more) => {
            *more = has_more;
            'write: {
                // The sink copies what it needs before returning.
                let handle = controller.sink_handle();
                if out.is_empty() || handle.is_none() {
                    break 'write JSValue::UNDEFINED;
                }
                handle
                    .write(&crate::webcore::streams::Result::Temporary(&out))
                    .to_js(&global.js_thread_of_caller())
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

unsafe extern "C" {
    /// JS-thread completion in `JSCompressionStreamShared.cpp`: consumes
    /// `out[..out_len]` before anything may release or re-dispatch the coder.
    fn Bun__CompressionStream__deliverAsync(
        global: &JSGlobalObject,
        stream_cell: JSValue,
        out: *const u8,
        out_len: usize,
        more: bool,
        error: JSValue,
    );
}

/// One step of a large `CompressionStream`/`DecompressionStream` chunk, run
/// off the JS thread.
pub(crate) struct CompressionAsyncCtx {
    /// See [`CompressionStreamCoder::ref_count`]. TransformStream serializes
    /// writes, so nothing else touches the coder while the pool has it.
    coder: bun_ptr::RefPtr<CompressionStreamCoder>,
    /// Empty on a continuation step: the coder holds the chunk's tail.
    input: AsyncInput,
    finish: bool,
    out: Vec<u8>,
    more: bool,
    error: Option<CodecError>,
}

// SAFETY: the coder is `ThreadSafeRefCounted` and only touched by whoever holds
// the transform (pool thread, then JS thread); its z_stream / Brotli*Instance /
// ZSTD_*Ctx handle is heap state with no thread affinity; `AsyncInput` owns or pins its bytes.
unsafe impl Send for CompressionAsyncCtx {}

#[derive(bun_jsc::JsAffine)]
pub(crate) struct CompressionAsyncJs {
    /// GC root for the `JSTransformStream` cell; its `m_asyncCodecInFlight`
    /// flag defers the eager ClearAlgorithms release while this task holds it,
    /// and its `m_codecPromise` WriteBarrier keeps the pending
    /// transform-algorithm promise alive.
    stream: Strong,
    _pin: Option<PinnedArrayBuffer>,
}

impl bun_jsc::JobContext for CompressionAsyncCtx {
    type OffThread = Self;
    type Js = CompressionAsyncJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // SAFETY: `coder` is kept alive by the reference this ctx holds (the
        // cell's finalizer only releases its own); see the field doc.
        match unsafe { (*this.coder.as_ptr()).step(this.input.slice(), this.finish, &mut this.out) }
        {
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
        let (out, out_len, err) = match &this.error {
            None => (this.out.as_ptr(), this.out.len(), JSValue::ZERO),
            Some(e) => (core::ptr::null(), 0, codec_error_to_js(global, e)),
        };
        // SAFETY: FFI into `JSCompressionStreamShared.cpp`; see above.
        unsafe {
            Bun__CompressionStream__deliverAsync(
                global,
                js.stream.get(),
                out,
                out_len,
                this.more,
                err,
            )
        };
        Ok(())
    }
}

/// Schedules one off-thread step; a continuation step passes no chunk and no
/// input (the coder kept the tail).
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__transformAsync(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    stream_cell: JSValue,
    chunk: JSValue,
    input: *const u8,
    input_len: usize,
    finish: bool,
) {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__transformAsync
    );
    let fallback = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; either pinned (and
        // `fallback` is ignored) or copied into an owned Vec.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    let (input, pin) = AsyncInput::new(global, chunk, fallback);
    // Called by script, the step is that script's; asked for by a native sink, it is the
    // stream's maker's.
    let vm = global.bun_vm();
    let entered = if vm.jsc_vm().is_entered() {
        None
    } else {
        // SAFETY: `this` is the live coder owned by the calling JS cell.
        Some(vm.enter_context(unsafe { (*this).context }))
    };
    let cx = global.js_thread(match &entered {
        Some(scope) => scope.context(),
        None => vm.context_of_caller(),
    });
    bun_jsc::Job::<CompressionAsyncCtx>::schedule(
        &cx,
        CompressionAsyncCtx {
            // SAFETY: `this` is the live coder owned by the calling JS cell.
            coder: unsafe { bun_ptr::RefPtr::init_ref(this) },
            input,
            finish,
            out: Vec::new(),
            more: false,
            error: None,
        },
        CompressionAsyncJs {
            stream: Strong::create(stream_cell, global),
            _pin: pin,
        },
    );
}
