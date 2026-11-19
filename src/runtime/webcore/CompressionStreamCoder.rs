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

use core::ffi::c_void;

use bun_core::EncodedSlice;
use bun_core::vec::{BorrowedCursor, append_with};
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{
    ErrorCode, JSGlobalObject, JSUint8Array, JSValue, PinnedArrayBuffer, Strong, ThreadIsolated,
    ThreadIsolatedArg,
};

use bun_zlib::{Deflater, Inflater, deflate, inflate};
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
}

/// Growth granularity of a step's output buffer.
const CHUNK: usize = 16 * 1024;

/// Reserves up to [`CHUNK`] in `out`, and returns how much it may grow by.
fn reserve_step(out: &mut Vec<u8>, cap: usize) -> Result<usize, CodecError> {
    debug_assert!(out.len() < cap);
    let budget = cap - out.len();
    out.try_reserve(budget.min(CHUNK))
        .map_err(|_| CodecError::OutOfMemory)?;
    Ok(budget)
}

/// One codec call: lends `step` the spare capacity up to `cap`.
fn append_step<R>(
    out: &mut Vec<u8>,
    cap: usize,
    step: impl FnOnce(BorrowedCursor<'_, u8>) -> R,
) -> Result<R, CodecError> {
    let budget = reserve_step(out, cap)?;
    Ok(append_with(out, budget, step))
}

fn zlib_error(error: bun_zlib::Error, message: &'static str) -> CodecError {
    match error {
        bun_zlib::Error::Alloc(_) => CodecError::OutOfMemory,
        _ => CodecError::Message(message),
    }
}

fn zstd_error(code: bun_zstd::ErrorCode, message: &'static str) -> CodecError {
    if code.is_alloc_failure() {
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
    Deflate(Box<Deflater>),
    Inflate(Box<Inflater>),
    BrotliEncode(Box<bun_brotli::Encoder>),
    BrotliDecode(Box<bun_brotli::Decoder>),
    ZstdEncode(bun_zstd::OwnedCCtx),
    ZstdDecode(bun_zstd::OwnedDCtx),
}

pub(crate) struct CompressionStreamCoder {
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
    /// Surfaced as TypeError with the `.code` that node:zlib has for it.
    Brotli(bun_brotli::DecodeError),
}

impl CompressionStreamCoder {
    fn new(
        format: Format,
        decompress: bool,
        high_water_mark: usize,
        level: Option<i32>,
    ) -> Result<Box<Self>, CodecError> {
        let inflater = |container| Backend::Inflate(Box::new(Inflater::new(container)));
        let backend = match (format, decompress) {
            (Format::Deflate | Format::DeflateRaw | Format::Gzip, false) => {
                let container = match format {
                    Format::DeflateRaw => deflate::Container::Raw,
                    Format::Gzip => deflate::Container::Gzip,
                    _ => deflate::Container::Zlib,
                };
                let deflater = level
                    .map_or(Ok(deflate::Level::DEFAULT), deflate::Level::try_from)
                    .and_then(|level| {
                        let options = deflate::Options {
                            level,
                            ..Default::default()
                        };
                        Deflater::new(container, options)
                    })
                    .map_err(|_| CodecError::Message("failed to initialize deflate"))?;
                Backend::Deflate(deflater)
            }
            (Format::Deflate, true) => inflater(inflate::Container::Zlib),
            (Format::DeflateRaw, true) => inflater(inflate::Container::Raw),
            (Format::Gzip, true) => inflater(inflate::Container::Gzip),
            (Format::Brotli, false) => {
                if bun_removable_features::is_removed(
                    bun_removable_features::Feature::BrotliEncoder,
                ) {
                    return Err(CodecError::Message(
                        "Brotli compression isn't in this executable",
                    ));
                }
                let quality = level.unwrap_or(bun_brotli::MAX_QUALITY);
                Backend::BrotliEncode(Box::new(bun_brotli::Encoder::with_quality(quality)))
            }
            (Format::Brotli, true) => {
                if bun_removable_features::is_removed(
                    bun_removable_features::Feature::BrotliDecoder,
                ) {
                    return Err(CodecError::Message(
                        "Brotli decompression isn't in this executable",
                    ));
                }
                Backend::BrotliDecode(Box::default())
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
                let flush = if finish {
                    deflate::Flush::Finish
                } else {
                    deflate::Flush::None
                };
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let status =
                        append_step(out, cap, |out| s.deflate(&mut remaining, out, flush))?
                            .map_err(|error| zlib_error(error, "deflate failed"))?;
                    if status != deflate::Status::NeedsOutput {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::Inflate(s) => {
                if !continuing && input.is_empty() && (self.ended || !finish) {
                    return Ok(Progress::Done);
                }
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let budget = reserve_step(out, cap)?;
                    let status = s
                        .inflate_to_vec(&mut remaining, out, budget)
                        .map_err(|error| zlib_error(error, "inflate failed"))?;
                    match status {
                        inflate::Status::NeedsOutput | inflate::Status::BlockEnd => {}
                        inflate::Status::NeedsInput if finish => {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        inflate::Status::NeedsInput => return Ok(Progress::Done),
                        inflate::Status::StreamEnd => {
                            self.ended = true;
                            if remaining.is_empty() {
                                return Ok(Progress::Done);
                            }
                            // After a gzip member, it has to be another one (RFC 1952 §2.2).
                            if s.container() != inflate::Container::Gzip {
                                return Err(CodecError::TrailingJunk);
                            }
                            s.reset();
                            self.ended = false;
                        }
                        inflate::Status::NeedsDictionary => {
                            return Err(CodecError::Message("Missing dictionary"));
                        }
                    }
                }
            }
            Backend::BrotliEncode(encoder) => {
                let operation = if finish {
                    bun_brotli::Operation::Finish
                } else {
                    bun_brotli::Operation::Process
                };
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    match append_step(out, cap, |spare| {
                        encoder.compress(operation, &mut remaining, spare)
                    })? {
                        Ok(bun_brotli::EncodeStatus::Done) => return Ok(Progress::Done),
                        Ok(bun_brotli::EncodeStatus::NeedsOutput) => {}
                        Err(bun_brotli::EncodeError::OutOfMemory) => {
                            return Err(CodecError::OutOfMemory);
                        }
                        Err(bun_brotli::EncodeError::InvalidOperation) => {
                            return Err(CodecError::Message("brotli encode failed"));
                        }
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
                    match append_step(out, cap, |spare| decoder.decompress(&mut remaining, spare))?
                    {
                        Ok(bun_brotli::DecodeStatus::Finished) => {
                            self.ended = true;
                            if !remaining.is_empty() {
                                return Err(CodecError::TrailingJunk);
                            }
                            return Ok(Progress::Done);
                        }
                        Ok(bun_brotli::DecodeStatus::NeedsOutput) => {}
                        Ok(bun_brotli::DecodeStatus::NeedsInput) if decoder.has_more_output() => {}
                        Ok(bun_brotli::DecodeStatus::NeedsInput) if finish => {
                            return Err(CodecError::Message("unexpected end of file"));
                        }
                        Ok(bun_brotli::DecodeStatus::NeedsInput) => return Ok(Progress::Done),
                        Err(error) if error.is_out_of_memory() => {
                            return Err(CodecError::OutOfMemory);
                        }
                        Err(error) => return Err(CodecError::Brotli(error)),
                    }
                }
            }
            Backend::ZstdEncode(p) => {
                // ZSTD_EndDirective: 0 = ZSTD_e_continue, 2 = ZSTD_e_end.
                let end: core::ffi::c_uint = if finish { 2 } else { 0 };
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let (consumed, hint) =
                        append_step(out, cap, |spare| p.step(remaining, spare, end))?;
                    remaining = &remaining[consumed..];
                    let hint = hint.map_err(|code| zstd_error(code, "zstd encode failed"))?;
                    if remaining.is_empty() && (!finish || hint == 0) {
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::ZstdDecode(p) => {
                // After a frame completes, whatever follows must be another frame
                // magic (see `zstd_head`); `step` has already re-attached a split one.
                let mut remaining = input;
                loop {
                    if self.ended {
                        if remaining.is_empty() {
                            return Ok(Progress::Done);
                        }
                        let head = &remaining[..remaining.len().min(4)];
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
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let (consumed, hint) = append_step(out, cap, |spare| p.step(remaining, spare))?;
                    remaining = &remaining[consumed..];
                    if hint.map_err(|code| zstd_error(code, "zstd decode failed"))? == 0 {
                        self.ended = true;
                        continue;
                    }
                    let has_room = out.len() < cap.min(out.capacity());
                    if remaining.is_empty() && has_room {
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

/// A chunk's bytes for the pool thread.
enum AsyncInput {
    Pinned(PinnedArrayBuffer),
    Owned(Vec<u8>),
}

// SAFETY: `new` roots what it pins.
unsafe impl ThreadIsolatedArg for AsyncInput {}

impl AsyncInput {
    /// JS thread: pin `chunk` if it is a pinnable ArrayBuffer/view, else copy `fallback`.
    fn new(global: &JSGlobalObject, chunk: JSValue, fallback: &[u8]) -> Self {
        // Continuation steps pass no chunk.
        if chunk.is_cell()
            && let Some(buffer) = PinnedArrayBuffer::root_read_only(global, chunk)
        {
            return Self::Pinned(buffer);
        }
        Self::Owned(fallback.to_vec())
    }

    #[inline]
    fn slice(&self) -> &[u8] {
        match self {
            Self::Pinned(buffer) => buffer.slice(),
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
) -> Option<Box<CompressionStreamCoder>> {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__create
    );
    let format = Format::from_u8(format)?;
    let level = (has_level && !decompress).then_some(level);
    CompressionStreamCoder::new(format, decompress, high_water_mark.max(1), level).ok()
}

#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn CompressionStreamCoder__destroy(
    this: Option<Box<CompressionStreamCoder>>,
) {
    bun_removable_features::removable_definition!(
        CompressionStreams,
        CompressionStreamCoder__destroy
    );
    drop(this);
}

/// One JS-thread [`step`](CompressionStreamCoder::step): returns its output as
/// a fresh (possibly empty) `Uint8Array` and sets `more` if the coder must be
/// stepped again (with `input` null), or throws a `TypeError` and returns zero.
///
/// # Safety
/// `this` is the coder that the calling cell owns. `input` is null, or valid for `input_len` bytes.
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn CompressionStreamCoder__transform(
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
    let rare = global.bun_vm().rare_data();
    let mut out = rare.take_compression_scratch();
    // SAFETY: fn contract. Both borrows end when `step()` returns, and it runs no JavaScript.
    let step = unsafe { (*this).step(bun_core::ffi::slice(input, input_len), finish, &mut out) };
    let result = match step {
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
        CodecError::Brotli(error) => {
            let code = error.code().to_bytes();
            let detail = bstr::BStr::new(code.strip_prefix(b"ERR_").unwrap_or(code));
            let err = global.create_type_error_instance(format_args!("brotli decode failed"));
            let code_js = EncodedSlice::latin1(code).to_js(global);
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
///
/// # Safety
/// As [`CompressionStreamCoder__transform`].
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn CompressionStreamCoder__transformInto(
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
    let rare = global.bun_vm().rare_data();
    let mut out = rare.take_compression_scratch();
    // SAFETY: as in `CompressionStreamCoder__transform`.
    let step = unsafe { (*this).step(bun_core::ffi::slice(input, input_len), finish, &mut out) };
    let result = match step {
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
    /// JS-thread completion in `JSCompressionStreamShared.cpp`. The cell owns `coder` again.
    fn Bun__CompressionStream__deliverAsync(
        global: &JSGlobalObject,
        stream_cell: JSValue,
        coder: *mut c_void,
        out: *const u8,
        out_len: usize,
        more: bool,
        error: JSValue,
    );
}

/// One step of a large `CompressionStream`/`DecompressionStream` chunk, run
/// off the JS thread.
struct CompressionAsyncCtx {
    coder: Box<CompressionStreamCoder>,
    /// Empty on a continuation step: the coder holds the chunk's tail.
    input: ThreadIsolated<AsyncInput>,
    finish: bool,
    out: Vec<u8>,
    more: bool,
    error: Option<CodecError>,
}

impl bun_jsc::JobContext for CompressionAsyncCtx {
    type OffThread = Self;
    /// The `JSTransformStream` cell, whose `m_codecPromise` keeps the pending promise alive.
    type Js = Strong;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        match this
            .coder
            .step(this.input.slice(), this.finish, &mut this.out)
        {
            Ok(more) => this.more = more,
            Err(e) => this.error = Some(e),
        }
        Some(done)
    }

    fn then(this: Self, stream: Strong, cx: &bun_jsc::JsThread<'_>) -> bun_jsc::JsResult<()> {
        let global = cx.global();
        let (out, err) = match &this.error {
            None => (&this.out[..], JSValue::ZERO),
            Some(e) => (&[][..], codec_error_to_js(global, e)),
        };
        // SAFETY: `stream` is the cell that gave the coder up, and `out` outlives the call.
        unsafe {
            Bun__CompressionStream__deliverAsync(
                global,
                stream.get(),
                bun_core::heap::into_raw(this.coder).cast(),
                out.as_ptr(),
                out.len(),
                this.more,
                err,
            )
        };
        Ok(())
    }
}

/// Schedules one off-thread step; a continuation step passes no chunk and no
/// input (the coder kept the tail).
///
/// # Safety
/// `stream_cell` is the cell that owned `this`. `input` is null, or valid for `input_len` bytes.
#[inline(never)]
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn CompressionStreamCoder__transformAsync(
    this: Box<CompressionStreamCoder>,
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
    // SAFETY: fn contract. The job is dropped on the JS thread, and `run` only borrows the bytes.
    let input = unsafe {
        ThreadIsolated::new(AsyncInput::new(
            global,
            chunk,
            bun_core::ffi::slice(input, input_len),
        ))
    };
    // Called by script, the step is that script's; asked for by a native sink, it is the
    // stream's maker's.
    let vm = global.bun_vm();
    let entered = (!vm.jsc_vm().is_entered()).then(|| vm.enter_context(this.context));
    let cx = global.js_thread(match &entered {
        Some(scope) => scope.context(),
        None => vm.context_of_caller(),
    });
    bun_jsc::Job::<CompressionAsyncCtx>::schedule(
        &cx,
        CompressionAsyncCtx {
            coder: this,
            input,
            finish,
            out: Vec::new(),
            more: false,
            error: None,
        },
        Strong::create(stream_cell, global),
    );
}
