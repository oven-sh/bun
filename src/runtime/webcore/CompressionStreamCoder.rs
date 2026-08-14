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
//! TransformStream backpressure only applies between input chunks, and one
//! chunk can expand without bound (a few hundred bytes of brotli or zstd
//! decode to gigabytes), so a chunk is transformed in *steps*: each step
//! collects at most [`STEP_OUTPUT`] (or [`STEP_OUTPUT_OFF_THREAD`]) bytes, or
//! the chunk's own size if that is larger, and reports whether the codec
//! stopped short. The C++ arm
//! (`JSCompressionStreamShared.cpp`) delivers each step's output and steps
//! again only once the readable side or native sink has room, so a chunk's
//! expansion is never materialized at once; between steps the coder holds the
//! chunk's unconsumed input itself ([`Pending`]).

use core::ffi::c_int;
use core::ptr::{self, NonNull};

use bun_jsc::ZigStringJsc as _;
use bun_jsc::zig_string::ZigString as JscZigString;
use bun_jsc::{ErrorCode, JSGlobalObject, JSUint8Array, JSValue, Strong};

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

/// Granularity in which a step's output buffer grows.
const CHUNK: usize = 16 * 1024;

/// Output bound of one step on the JS thread, and so the largest piece a
/// consumer of the readable side sees per `read()` for ordinary chunk sizes.
/// A chunk larger than this may produce up to its own size per step (see
/// [`CompressionStreamCoder::step`]): the bound is on *expansion*, and a big
/// chunk's caller has already materialized that much.
pub const STEP_OUTPUT: usize = 64 * 1024;
/// The same bound for steps run on the thread pool (chunks over the C++
/// `kAsyncCodecThreshold`): every step there costs a pool round trip, so each
/// one is allowed to do more work.
pub const STEP_OUTPUT_OFF_THREAD: usize = 1024 * 1024;

/// Spare room for one codec call: grows `out` by up to [`CHUNK`] but never
/// lets the step pass `cap`. The caller has checked `out.len() < cap`.
fn spare(out: &mut Vec<u8>, cap: usize) -> &mut [core::mem::MaybeUninit<u8>] {
    let budget = cap - out.len();
    out.reserve(budget.min(CHUNK));
    let spare = out.spare_capacity_mut();
    let len = spare.len().min(budget);
    &mut spare[..len]
}

/// The rest of a chunk (or flush) whose last step stopped at the output cap.
/// The unconsumed input is copied rather than borrowed: user code runs between
/// steps (the consumer's reads) and may detach or resize the chunk's buffer.
struct Pending {
    input: Vec<u8>,
    pos: usize,
    finish: bool,
    /// The chunk's per-step output bound, fixed by its first step.
    cap: usize,
}

enum Progress {
    /// The chunk (or flush) has been fully transformed.
    Done,
    /// Stopped at the output cap with the codec mid-chunk; the first
    /// `consumed` bytes of this step's input are no longer needed.
    More { consumed: usize },
}

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

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub struct CompressionStreamCoder {
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
    /// Set while a chunk's transform spans steps; `None` between chunks.
    pending: Option<Pending>,
    /// Output of the latest `step`. Reused across steps; `step` clears it on
    /// entry.
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
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            ended: false,
            zstd_head: [0; 4],
            zstd_head_len: 0,
            pending: None,
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

    /// Runs one step of the chunk (or final empty flush, `finish`) being
    /// transformed, collecting at most `max(min_cap, chunk length)` bytes into
    /// `self.out` (cleared on entry). Returns `true` when the codec stopped at
    /// that cap: the caller delivers `out` and, once there is room for more,
    /// steps again with no input; only then may the next chunk be fed.
    /// `input` / `finish` / `min_cap` are read on a chunk's first step only.
    /// `finish` drives the codec to completion and performs the "unexpected
    /// end of file" / "trailing junk" checks.
    fn step(&mut self, input: &[u8], finish: bool, min_cap: usize) -> Result<bool, CodecError> {
        self.out.clear();
        if let Some(mut pending) = self.pending.take() {
            debug_assert!(input.is_empty());
            return match self.run(
                &pending.input[pending.pos..],
                pending.finish,
                true,
                pending.cap,
            )? {
                Progress::Done => Ok(false),
                Progress::More { consumed } => {
                    pending.pos += consumed;
                    self.pending = Some(pending);
                    Ok(true)
                }
            };
        }
        // Zstd decode: the frame-magic bytes the previous chunk ended inside of
        // (`zstd_head`) belong in front of this one.
        let joined;
        let bytes: &[u8] = if self.zstd_head_len > 0 {
            joined = [&self.zstd_head[..self.zstd_head_len as usize], input].concat();
            self.zstd_head_len = 0;
            &joined
        } else {
            input
        };
        let cap = min_cap.max(input.len());
        match self.run(bytes, finish, false, cap)? {
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

    /// Drives the codec over `input` until the chunk is done or `self.out`
    /// holds `cap` bytes. `continuing` is set for every step of a chunk after
    /// its first: the codec is then mid-chunk and must be called even with no
    /// input left, to drain the output it is holding.
    fn run(
        &mut self,
        input: &[u8],
        finish: bool,
        continuing: bool,
        cap: usize,
    ) -> Result<Progress, CodecError> {
        let out = &mut self.out;
        match &mut self.backend {
            Backend::Deflate(s) => {
                // `avail_in` is `uInt`; clamp and refill so a ≥4 GiB chunk
                // isn't silently truncated by the `as u32` cast.
                let mut remaining = input;
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - remaining.len(),
                        });
                    }
                    let take = remaining.len().min(u32::MAX as usize);
                    let tail = remaining.len() > take;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    s.next_in = remaining.as_ptr();
                    s.avail_in = take as u32;
                    let spare = spare(out, cap);
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
                        zlib::ReturnCode::StreamEnd => return Ok(Progress::Done),
                        _ => return Err(CodecError::Message("deflate failed")),
                    }
                    if s.avail_out != 0 && remaining.is_empty() {
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
                        // SAFETY: `s` is an initialized inflate stream.
                        if unsafe { zlib::inflateReset(&raw mut **s) } != zlib::ReturnCode::Ok {
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
                    let take = remaining.len().min(u32::MAX as usize);
                    let tail = remaining.len() > take;
                    let flush = if finish && !tail {
                        zlib::FlushValue::Finish
                    } else {
                        zlib::FlushValue::NoFlush
                    };
                    s.next_in = remaining.as_ptr();
                    s.avail_in = take as u32;
                    let spare = spare(out, cap);
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
                            if remaining.is_empty() {
                                return Ok(Progress::Done);
                            }
                            if !gzip {
                                return Err(CodecError::TrailingJunk);
                            }
                            // SAFETY: `s` is an initialized inflate stream.
                            if unsafe { zlib::inflateReset(&raw mut **s) } != zlib::ReturnCode::Ok {
                                return Err(CodecError::Message("inflate failed"));
                            }
                            self.ended = false;
                            continue;
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
                let mut next_in: *const u8 = input.as_ptr();
                let mut avail_in: usize = input.len();
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - avail_in,
                        });
                    }
                    let spare = spare(out, cap);
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
                let mut next_in: *const u8 = input.as_ptr();
                let mut avail_in: usize = input.len();
                loop {
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input.len() - avail_in,
                        });
                    }
                    let spare = spare(out, cap);
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
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_input => {
                            if finish {
                                return Err(CodecError::Message("unexpected end of file"));
                            }
                            return Ok(Progress::Done);
                        }
                        brotli::BrotliDecoderResult::needs_more_output => {}
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
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input_buf.pos,
                        });
                    }
                    let spare = spare(out, cap);
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
                        return Ok(Progress::Done);
                    }
                }
            }
            Backend::ZstdDecode(p) => {
                // A zstd stream is one or more concatenated frames (RFC 8878
                // §3.1, including skippable frames). After a frame completes,
                // the next bytes must be another frame magic; a chunk may end
                // inside that 4-byte magic, which `zstd_head` carries over to
                // the next chunk (`step` joins it back on).
                let mut input_buf = zstd::ZSTD_inBuffer {
                    src: input.as_ptr().cast(),
                    size: input.len(),
                    pos: 0,
                };
                loop {
                    if self.ended {
                        let rest = &input[input_buf.pos..];
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
                        // SAFETY: `p` is a live DCtx.
                        unsafe {
                            zstd::ZSTD_DCtx_reset(
                                p.as_ptr(),
                                zstd::ZSTD_reset_session_and_parameters,
                            )
                        };
                        self.ended = false;
                    }
                    if out.len() >= cap {
                        return Ok(Progress::More {
                            consumed: input_buf.pos,
                        });
                    }
                    let spare = spare(out, cap);
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
                        return Ok(Progress::Done);
                    }
                }
            }
        }
    }
}

/// A chunk's bytes for the pool thread: a pinned ArrayBuffer's backing
/// store (its pin/protect is the paired [`PinnedChunk`] on the JS side) or an
/// owned copy.
pub(crate) enum AsyncInput {
    Pinned { ptr: *const u8, len: usize },
    Owned(Vec<u8>),
}
// SAFETY: `Pinned.ptr` is a backing store pinned + protected by the paired
// `PinnedChunk` for as long as the job lives; read only under the pool borrow.
unsafe impl Send for AsyncInput {}

/// The pin + GC protection on a chunk whose bytes went to the pool; released
/// on drop (JS thread, with the job's Js side).
pub(crate) struct PinnedChunk(JSValue);
// SAFETY: pin/protect on a heap cell; gone with the heap.
unsafe impl bun_jsc::job::JsAffine for PinnedChunk {}
impl Drop for PinnedChunk {
    fn drop(&mut self) {
        self.0.unpin_array_buffer();
        self.0.unprotect();
    }
}

impl AsyncInput {
    /// JS thread: pin `chunk` if it is a pinnable ArrayBuffer/view, else copy `fallback`.
    pub(crate) fn new(
        global: &JSGlobalObject,
        chunk: JSValue,
        fallback: &[u8],
    ) -> (Self, Option<PinnedChunk>) {
        if let Some(buf) = chunk.as_pinned_arraybuffer(global) {
            // A resizable non-shared backing can `mprotect()` pages out on
            // `resize()`; pinning does not block that, so spill to a copy.
            if buf.resizable && !buf.shared {
                chunk.unpin_array_buffer();
                return (Self::Owned(fallback.to_vec()), None);
            }
            chunk.protect();
            return (
                Self::Pinned {
                    ptr: buf.ptr,
                    len: buf.byte_len,
                },
                Some(PinnedChunk(chunk)),
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
                // SAFETY: see the `Send` note.
                unsafe { core::slice::from_raw_parts(*ptr, *len) }
            }
            Self::Owned(v) => v.as_slice(),
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

/// Releases the C++ cell's reference; see [`CompressionStreamCoder::ref_count`].
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn CompressionStreamCoder__destroy(this: *mut CompressionStreamCoder) {
    if !this.is_null() {
        // SAFETY: `this` was returned by `CompressionStreamCoder__create` and
        // the cell's reference has not been released yet.
        unsafe { bun_ptr::ThreadSafeRefCount::<CompressionStreamCoder>::deref(this) };
    }
}

/// Runs one step (see [`CompressionStreamCoder::step`]) on the JS thread.
/// Returns a fresh `Uint8Array` (possibly empty) on success, setting `more`
/// when the coder stopped at the cap and must be stepped again with no input;
/// or `JSValue::zero` with a `TypeError` thrown on `global` on failure.
/// `input` may be null iff `input_len == 0`, and is ignored on a continuation
/// step.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn CompressionStreamCoder__transform(
    this: *mut CompressionStreamCoder,
    global: &JSGlobalObject,
    input: *const u8,
    input_len: usize,
    finish: bool,
    more: &mut bool,
) -> JSValue {
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: the caller passes a BufferSource's bytes; `slice` does not
        // escape this call (`step` copies whatever it leaves unconsumed).
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    // SAFETY: `this` is the live coder owned by the calling JS cell; it is
    // only driven from the JS thread, so the call-scoped `&mut *this` has no
    // alias. No JS runs between `step` and `take` below.
    match unsafe { (*this).step(slice, finish, STEP_OUTPUT) } {
        Ok(has_more) => {
            *more = has_more;
            // SAFETY: as above.
            let out = unsafe { core::mem::take(&mut (*this).out) };
            if out.is_empty() {
                JSUint8Array::create_empty(global)
            } else {
                JSUint8Array::from_bytes(global, out.into())
            }
        }
        Err(e) => {
            *more = false;
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

/// [`CompressionStreamCoder__transform`], but the step's output goes straight
/// to a native JSSink (`m_sinkPtr`) instead of becoming a `JSUint8Array`.
/// Returns the sink's `write_bytes` result (see nativeSinkWriteIsBackpressure
/// for the backpressure-signal shapes), `undefined` for an empty output, or
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
    more: &mut bool,
) -> JSValue {
    let slice = if input.is_null() {
        &[][..]
    } else {
        // SAFETY: as in `CompressionStreamCoder__transform`.
        unsafe { core::slice::from_raw_parts(input, input_len) }
    };
    // SAFETY: as in `CompressionStreamCoder__transform`.
    match unsafe { (*this).step(slice, finish, STEP_OUTPUT) } {
        Ok(has_more) => {
            *more = has_more;
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
            *more = false;
            throw_codec_error(global, e);
            JSValue::ZERO
        }
    }
}

// ─── off-thread path (chunks > kAsyncCodecThreshold) ───────────────────────

unsafe extern "C" {
    /// JS-thread completion hook in `JSCompressionStreamShared.cpp`. Copies
    /// `out[..out_len]` into the sink / a fresh Uint8Array before it clears
    /// `m_asyncCodecInFlight`, then either settles the stream's
    /// `m_codecPromise` or, when `more` is set, arranges the chunk's next step
    /// (another `CompressionStreamCoder__transformAsync` with no input, once
    /// the consumer has room).
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
pub struct CompressionAsyncCtx {
    /// Holds one coder reference (taken in `CompressionStreamCoder__transformAsync`,
    /// released by `Drop`); see [`CompressionStreamCoder::ref_count`]. TransformStream
    /// serializes writes, so nothing else touches it while the pool has it.
    coder: *mut CompressionStreamCoder,
    /// Empty on a continuation step: the coder holds the chunk's tail.
    input: AsyncInput,
    finish: bool,
    more: bool,
    error: Option<CodecError>,
}

impl Drop for CompressionAsyncCtx {
    fn drop(&mut self) {
        // SAFETY: `coder` was ref'd in `CompressionStreamCoder__transformAsync`; this ctx owns that
        // reference and drops it exactly once (in `then`, or when the job is
        // released unrun).
        unsafe { bun_ptr::ThreadSafeRefCount::<CompressionStreamCoder>::deref(self.coder) };
    }
}

// SAFETY: the coder is `ThreadSafeRefCounted` and only touched by whoever holds
// the transform (pool thread, then JS thread); `AsyncInput` owns or pins its bytes.
unsafe impl Send for CompressionAsyncCtx {}

#[derive(bun_jsc::JsAffine)]
pub struct CompressionAsyncJs {
    /// GC root for the `JSTransformStream` cell; its `m_asyncCodecInFlight`
    /// flag defers the eager ClearAlgorithms release while this task holds it,
    /// and its `m_codecPromise` WriteBarrier keeps the pending
    /// transform-algorithm promise alive.
    stream: Strong,
    _pin: Option<PinnedChunk>,
}

impl bun_jsc::JobContext for CompressionAsyncCtx {
    type OffThread = Self;
    type Js = CompressionAsyncJs;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // SAFETY: `coder` is kept alive by the reference this ctx holds (the
        // cell's finalizer only releases its own); see the field doc.
        match unsafe { (*this.coder).step(this.input.slice(), this.finish, STEP_OUTPUT_OFF_THREAD) }
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
            None => {
                // SAFETY: `this` holds a coder reference until it drops at the
                // end of this fn, so `coder` (and its `out` buffer) stay live
                // while `Bun__CompressionStream__deliverAsync` copies; it copies
                // before it can schedule the next step, which is what would
                // touch `out` again.
                let coder = unsafe { &*this.coder };
                (coder.out.as_ptr(), coder.out.len(), JSValue::ZERO)
            }
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

/// Schedules one off-thread step. The first step of a chunk gets the chunk's
/// bytes; a continuation step (the previous one stopped at the cap) is called
/// with no chunk and no input, and the coder works from the tail it kept.
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
    let (input, pin) = AsyncInput::new(global, chunk, fallback);
    // SAFETY: `this` is the live coder owned by the calling JS cell; the ctx
    // takes its own reference (see `CompressionStreamCoder::ref_count`).
    unsafe { bun_ptr::ThreadSafeRefCount::<CompressionStreamCoder>::ref_(this) };
    let cx = global.js_thread();
    bun_jsc::Job::<CompressionAsyncCtx>::schedule(
        &cx,
        CompressionAsyncCtx {
            coder: this,
            input,
            finish,
            more: false,
            error: None,
        },
        CompressionAsyncJs {
            stream: Strong::create(stream_cell, global),
            _pin: pin,
        },
    );
}
