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

use crate::node::node_zlib_binding::{Loan, OutputScratch, SpareCodecMemory};
use bun_zlib::{Deflater, Inflater, deflate, inflate};
use bun_zstd::{EndDirective, Status};

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

/// [`append_step`] for zstd. Returns the input consumed.
fn append_zstd_step(
    out: &mut Vec<u8>,
    cap: usize,
    failure: &'static str,
    step: impl FnOnce(&mut bun_zstd::Output<'_>) -> (usize, Result<Status, bun_zstd::Error>),
) -> Result<(usize, Status), CodecError> {
    let budget = reserve_step(out, cap)?;
    match step(&mut bun_zstd::Output::spare_capacity(out, budget)) {
        (consumed, Ok(status)) => Ok((consumed, status)),
        (_, Err(bun_zstd::Error::MemoryAllocation)) => Err(CodecError::OutOfMemory),
        (_, Err(_)) => Err(CodecError::Message(failure)),
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
    ZstdEncode(Box<bun_zstd::Encoder>),
    ZstdDecode(Box<bun_zstd::Decoder>),
}

pub(crate) struct CompressionStreamCoder {
    backend: Backend,
    loan: Option<Loan>,
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
            (Format::Zstd, false) => Backend::ZstdEncode(Box::new(bun_zstd::Encoder::new(
                level.unwrap_or(bun_zstd::DEFAULT_LEVEL),
            ))),
            (Format::Zstd, true) => Backend::ZstdDecode(Box::new(bun_zstd::Decoder::new())),
        };
        Ok(Box::new(Self {
            backend,
            loan: None,
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

    /// When it is new, and again when it is done.
    fn swap_memory(&mut self, spare: &mut SpareCodecMemory) {
        match &mut self.backend {
            Backend::BrotliEncode(encoder) => encoder.swap_memory(&mut spare.brotli_encoder),
            Backend::BrotliDecode(decoder) => decoder.swap_tables(&mut spare.brotli_decoder),
            Backend::ZstdEncode(encoder) => encoder.swap_memory(&mut spare.zstd_encoder),
            Backend::ZstdDecode(decoder) => decoder.swap_tables(&mut spare.zstd_decoder),
            Backend::Deflate(_) | Backend::Inflate(_) => {}
        }
    }

    /// About what the next step of a decoder comes to.
    fn expected_output(&self, input: &[u8]) -> usize {
        match (&self.backend, &self.pending) {
            (Backend::Deflate(_) | Backend::BrotliEncode(_) | Backend::ZstdEncode(_), _) => 0,
            (_, Some(pending)) => pending.cap,
            (_, None) => (self.high_water_mark).clamp(input.len(), input.len().saturating_mul(4)),
        }
    }

    /// One step of the chunk (or, with `finish`, the final flush) in progress:
    /// collects at most `max(high_water_mark, chunk length)` bytes into `out` and
    /// returns `true` if the codec stopped at that cap, in which case the caller
    /// must step again (with no input) before feeding the next chunk.
    fn step(&mut self, input: &[u8], finish: bool, out: &mut Vec<u8>) -> Result<bool, CodecError> {
        out.clear();
        // It grows in steps if that is too much.
        let _ = out.try_reserve_exact(self.expected_output(input));
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
                    match decoder.decompress_appending(&mut remaining, out, cap) {
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
                let end = if finish {
                    EndDirective::End
                } else {
                    EndDirective::Continue
                };
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let (consumed, status) =
                        append_zstd_step(out, cap, "zstd encode failed", |spare| {
                            p.step(remaining, spare, end)
                        })?;
                    remaining = &remaining[consumed..];
                    if remaining.is_empty() && (!finish || status == Status::Complete) {
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
                        if !bun_zstd::may_start_frame(head) {
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
                        self.ended = false;
                    }
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let (consumed, status) =
                        append_zstd_step(out, cap, "zstd decode failed", |spare| {
                            p.step(remaining, spare)
                        })?;
                    remaining = &remaining[consumed..];
                    if status == Status::Complete {
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
    let mut coder =
        CompressionStreamCoder::new(format, decompress, high_water_mark.max(1), level).ok()?;
    if !matches!(coder.backend, Backend::Deflate(_) | Backend::Inflate(_)) {
        coder.loan = SpareCodecMemory::lend(|spare| coder.swap_memory(spare));
    }
    Some(coder)
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
    // The last cells are destroyed after the state.
    if let (Some(mut this), Some(state)) = (this, crate::jsc_hooks::try_runtime_state())
        && this.loan.is_some()
    {
        (state.spare_codec_memory).with_mut(|spare| this.swap_memory(spare));
    }
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
    // SAFETY: fn contract. Both borrows end when `step()` returns, and it runs no JavaScript.
    let (this, input) = unsafe { (&mut *this, bun_core::ffi::slice(input, input_len)) };
    let mut out = match this.expected_output(input) {
        ..CHUNK => OutputScratch::for_encoder(),
        _ => OutputScratch(Vec::new()),
    };
    match this.step(input, finish, &mut out.0) {
        Ok(has_more) => {
            *more = has_more;
            output_to_js(global, out)
        }
        Err(e) => {
            *more = false;
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    }
}

fn output_to_js(global: &JSGlobalObject, out: OutputScratch) -> JSValue {
    let chunk = out.finish(
        |bytes| match bytes {
            [] => JSUint8Array::create_empty(global),
            _ => JSUint8Array::from_bytes_copy(global, bytes),
        },
        |bytes| JSUint8Array::from_bytes(global, bytes),
    );
    bun_jsc::to_js_host_fn_result(global, chunk)
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
        out_owner: *mut c_void,
        more: bool,
        error: JSValue,
    );
}

/// The output as a `Uint8Array`. Zero if it throws.
///
/// # Safety
/// `out_owner` is that of the running `Bun__CompressionStream__deliverAsync`, which is done with `out`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn CompressionStreamCoder__takeOutput(
    global: &JSGlobalObject,
    out_owner: *mut c_void,
) -> JSValue {
    // SAFETY: fn contract.
    let out = core::mem::take(unsafe { &mut *out_owner.cast::<Vec<u8>>() });
    output_to_js(global, OutputScratch(out))
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
        let (mut out, err) = match &this.error {
            None => (this.out, JSValue::ZERO),
            Some(e) => (Vec::new(), codec_error_to_js(global, e)),
        };
        // SAFETY: `stream` is the cell that gave the coder up, and `out` outlives the call.
        unsafe {
            Bun__CompressionStream__deliverAsync(
                global,
                stream.get(),
                bun_core::heap::into_raw(this.coder).cast(),
                out.as_ptr(),
                out.len(),
                (&raw mut out).cast(),
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
