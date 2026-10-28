//! `fetch({ compress })`: parse the option, compress the buffered body before
//! the HTTP thread sees it (inline when small, else on the work pool).

use core::cell::RefCell;
use core::ptr::NonNull;

use super::fetch_tasklet::{FetchOptions, FetchTasklet, HTTPRequestBody};
use crate::webcore::blob;
use crate::webcore::jsc::{self, JSGlobalObject, JSValue, JsResult};
use bun_jsc::ComptimeStringMapExt as _;
use bun_libdeflate_sys::libdeflate;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum CompressEncoding {
    Gzip,
    Deflate,
    Brotli,
    Zstd,
}

impl CompressEncoding {
    pub(crate) fn header_value(self) -> &'static [u8] {
        match self {
            CompressEncoding::Gzip => b"gzip",
            CompressEncoding::Deflate => b"deflate",
            CompressEncoding::Brotli => b"br",
            CompressEncoding::Zstd => b"zstd",
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct CompressOption {
    pub(crate) encoding: CompressEncoding,
    pub(crate) level: Option<i32>,
}

pub(crate) const DEFAULT_DEFLATE_LEVEL: i32 = 6;
pub(crate) const DEFAULT_BROTLI_QUALITY: i32 = 6;
pub(crate) const DEFAULT_ZSTD_LEVEL: i32 = 3;

/// Inline limit: gzip-6 or zstd-3 on 64 KiB is 0.3 to 0.6 ms on the JS thread.
const INLINE_MAX_LEN: usize = 64 * 1024;

bun_core::comptime_string_map! {
    static COMPRESS_ENCODING_MAP: CompressEncoding = {
        b"gzip" => CompressEncoding::Gzip,
        b"deflate" => CompressEncoding::Deflate,
        b"br" => CompressEncoding::Brotli,
        b"zstd" => CompressEncoding::Zstd,
    };
}

/// Parses `compress?: boolean | "gzip" | "deflate" | "br" | "zstd" | { encoding, level? }`.
/// Returns `Ok(None)` for `false` / `undefined` / `null`.
pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<CompressOption>> {
    if value.is_undefined_or_null() {
        return Ok(None);
    }
    if value.is_boolean() {
        return Ok(if value.as_boolean() {
            Some(CompressOption {
                encoding: CompressEncoding::Gzip,
                level: None,
            })
        } else {
            None
        });
    }
    if value.is_string() {
        return match COMPRESS_ENCODING_MAP.from_js(global, value)? {
            Some(encoding) => Ok(Some(CompressOption {
                encoding,
                level: None,
            })),
            None => Err(global.throw_invalid_arguments(format_args!(
                "fetch: 'compress' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
            ))),
        };
    }
    if value.is_object() {
        let encoding = match value.get(global, "encoding")? {
            Some(enc) if enc.is_string() => match COMPRESS_ENCODING_MAP.from_js(global, enc)? {
                Some(e) => e,
                None => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "fetch: 'compress.encoding' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
                    )));
                }
            },
            other => {
                return Err(global.throw_invalid_argument_type_value(
                    b"compress.encoding",
                    b"string",
                    other.unwrap_or(JSValue::UNDEFINED),
                ));
            }
        };
        let level = match value.get(global, "level")? {
            Some(lvl) if !lvl.is_undefined_or_null() => {
                let (min, max, default) = match encoding {
                    CompressEncoding::Gzip | CompressEncoding::Deflate => (
                        libdeflate::MIN_COMPRESSION_LEVEL,
                        libdeflate::MAX_COMPRESSION_LEVEL,
                        DEFAULT_DEFLATE_LEVEL,
                    ),
                    CompressEncoding::Brotli => (
                        bun_brotli::c::BROTLI_MIN_QUALITY,
                        bun_brotli::c::BROTLI_MAX_QUALITY,
                        DEFAULT_BROTLI_QUALITY,
                    ),
                    CompressEncoding::Zstd => (1, 22, DEFAULT_ZSTD_LEVEL),
                };
                Some(global.validate_integer_range::<i32>(
                    lvl,
                    default,
                    bun_jsc::IntegerRange {
                        min: i128::from(min),
                        max: i128::from(max),
                        field_name: b"compress.level",
                    },
                )?)
            }
            _ => None,
        };
        return Ok(Some(CompressOption { encoding, level }));
    }
    Err(global.throw_invalid_argument_type_value(b"compress", b"boolean, string, or object", value))
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum CompressError {
    OutOfMemory,
    Failed,
}

impl From<bun_alloc::AllocError> for CompressError {
    fn from(_: bun_alloc::AllocError) -> Self {
        CompressError::OutOfMemory
    }
}

impl CompressError {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        match self {
            CompressError::OutOfMemory => global.create_out_of_memory_error(),
            CompressError::Failed => global
                .create_error_instance(format_args!("fetch: failed to compress the request body")),
        }
    }
}

/// Levels 10 to 12 allocate an 8.6 MiB compressor; levels 1 to 9 up to 668 KiB.
const MAX_CACHED_DEFLATE_LEVEL: i32 = 9;

thread_local! {
    /// The libdeflate compressor this thread used last, with its level.
    static DEFLATE_COMPRESSOR: RefCell<Option<(i32, libdeflate::OwnedCompressor)>> =
        const { RefCell::new(None) };
}

/// One-shot compression of `input`, on any thread. The output is trimmed.
pub(crate) fn compress(input: &[u8], opt: &CompressOption) -> Result<Vec<u8>, CompressError> {
    let mut out = match opt.encoding {
        CompressEncoding::Gzip | CompressEncoding::Deflate => {
            let gzip = opt.encoding == CompressEncoding::Gzip;
            let level = opt.level.unwrap_or(DEFAULT_DEFLATE_LEVEL);
            if bun_core::feature_flags::is_libdeflate_enabled() {
                compress_libdeflate(input, gzip, level)?
            } else {
                compress_zlib(input, gzip, level)?
            }
        }
        CompressEncoding::Brotli => compress_brotli(input, opt.level)?,
        CompressEncoding::Zstd => compress_zstd(input, opt.level)?,
    };
    if out.capacity() - out.len() > 4096 {
        out.shrink_to_fit();
    }
    Ok(out)
}

fn compress_libdeflate(input: &[u8], gzip: bool, level: i32) -> Result<Vec<u8>, CompressError> {
    let encoding = if gzip {
        libdeflate::Encoding::Gzip
    } else {
        // HTTP "deflate" is the zlib-wrapped stream (RFC 9110 8.4.1.2).
        libdeflate::Encoding::Zlib
    };
    let run = |compressor: &mut libdeflate::Compressor| {
        let mut out = Vec::new();
        let result = compressor.compress_to_vec(input, &mut out, encoding)?;
        if result.status != libdeflate::Status::Success {
            return Err(CompressError::Failed);
        }
        Ok(out)
    };
    if level > MAX_CACHED_DEFLATE_LEVEL {
        let mut compressor =
            libdeflate::OwnedCompressor::new(level).ok_or(CompressError::OutOfMemory)?;
        return run(&mut compressor);
    }
    DEFLATE_COMPRESSOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        let compressor = match &mut *slot {
            Some((cached_level, compressor)) if *cached_level == level => compressor,
            _ => {
                *slot = None;
                let compressor =
                    libdeflate::OwnedCompressor::new(level).ok_or(CompressError::OutOfMemory)?;
                &mut slot.insert((level, compressor)).1
            }
        };
        run(compressor)
    })
}

/// The `BUN_FEATURE_FLAG_NO_LIBDEFLATE=1` path: zlib `deflate(Z_FINISH)`.
fn compress_zlib(input: &[u8], gzip: bool, level: i32) -> Result<Vec<u8>, CompressError> {
    use bun_zlib::{DeflateEncoder, FlushValue, ReturnCode};

    // +16 selects the gzip wrapper; 15 alone is the zlib-wrapped stream.
    let window_bits = if gzip { 15 + 16 } else { 15 };
    // zlib stops at 9 where libdeflate goes to 12.
    let level = level.min(9);
    let mut encoder = DeflateEncoder::new(level, window_bits, 8, 0).map_err(|err| match err {
        bun_zlib::ZlibError::OutOfMemory => CompressError::OutOfMemory,
        _ => CompressError::Failed,
    })?;

    // `step()` consumes at most u32::MAX per call, so loop.
    let mut out = Vec::new();
    let mut remaining = input;
    loop {
        let flush = if remaining.len() <= u32::MAX as usize {
            FlushValue::Finish
        } else {
            FlushValue::NoFlush
        };
        let reserve = if out.capacity() == out.len() {
            64 * 1024
        } else {
            0
        };
        let (consumed, rc) = encoder.step(remaining, &mut out, reserve, flush);
        remaining = &remaining[consumed..];
        match rc {
            ReturnCode::StreamEnd => return Ok(out),
            ReturnCode::Ok => continue,
            ReturnCode::MemError => return Err(CompressError::OutOfMemory),
            _ => return Err(CompressError::Failed),
        }
    }
}

fn compress_brotli(input: &[u8], level: Option<i32>) -> Result<Vec<u8>, CompressError> {
    if bun_removable_features::is_removed(bun_removable_features::Feature::BrotliEncoder) {
        return Err(CompressError::Failed);
    }
    use bun_brotli::c;
    let quality = level.unwrap_or(DEFAULT_BROTLI_QUALITY);
    let window = c::BROTLI_DEFAULT_WINDOW;
    let mode = c::BrotliEncoderMode::generic;

    // A bound of 0 means overflow; `encode_append` then grows the output.
    let bound = c::BrotliEncoderMaxCompressedSize(input.len());
    let cap = if bound != 0 {
        bound
    } else {
        input.len() + 1024
    };
    let mut out = Vec::new();
    out.try_reserve_exact(cap)
        .map_err(|_| CompressError::OutOfMemory)?;
    match bun_brotli::encode_append(quality, window, mode, input, &mut out) {
        Some(_) => Ok(out),
        None => Err(CompressError::Failed),
    }
}

fn compress_zstd(input: &[u8], level: Option<i32>) -> Result<Vec<u8>, CompressError> {
    let bound = bun_zstd::compress_bound(input.len());
    if bun_zstd::is_error(bound) {
        return Err(CompressError::Failed);
    }
    let mut out = Vec::new();
    out.try_reserve_exact(bound)
        .map_err(|_| CompressError::OutOfMemory)?;
    match bun_zstd::compress_append(&mut out, input, level) {
        bun_zstd::Result::Success(_) => Ok(out),
        bun_zstd::Result::Err(_) => Err(CompressError::Failed),
    }
}

/// Cheap enough for the JS thread. Brotli never is: 1.2 ms at 64 KiB.
fn is_cheap_inline(len: usize, opt: &CompressOption) -> bool {
    if len > INLINE_MAX_LEN {
        return false;
    }
    match opt.encoding {
        CompressEncoding::Gzip | CompressEncoding::Deflate => {
            opt.level.unwrap_or(DEFAULT_DEFLATE_LEVEL) <= DEFAULT_DEFLATE_LEVEL
        }
        CompressEncoding::Zstd => opt.level.unwrap_or(DEFAULT_ZSTD_LEVEL) <= DEFAULT_ZSTD_LEVEL,
        CompressEncoding::Brotli => false,
    }
}

/// The fetch that waits for its body. Owns the bytes the pool reads in place.
pub(crate) struct PendingFetch {
    fetch_options: FetchOptions,
    promise: jsc::JSPromiseStrong,
    global: jsc::GlobalRef,
    /// Follows the signal during the hop; the tasklet follows it after.
    abort_handle: jsc::AbortHandle,
}

// SAFETY: every field is used and dropped on the owning JS thread only.
unsafe impl bun_jsc::job::JsAffine for PendingFetch {}

jsc::impl_abort_handle_owner!(PendingFetch, abort_handle, |this, cause| {
    // SAFETY: trait contract: `this` is live; JS thread.
    if let jsc::AbortCause::Signal(reason) = cause {
        unsafe { (*this).reject_aborted(reason) }
    }
});

impl PendingFetch {
    /// The body stays in place for the pool; `then` finds the promise settled.
    fn reject_aborted(&mut self, reason: JSValue) {
        self.abort_handle.unfollow();
        if !self.promise.has_value() {
            return;
        }
        let _dispatch = self.fetch_options.tracker.dispatch(&self.global);
        crate::dispatch::fold(self.promise.reject(&self.global, Ok(reason)));
    }
}

/// Work pool half of the job: the input bytes and the result.
pub(crate) struct CompressRequestBody {
    /// `fetch_options.body.slice()`, owned by the `Js` half of the same job.
    input: bun_jsc::JsPtr<[u8]>,
    opt: CompressOption,
    out: Result<Vec<u8>, CompressError>,
}

impl jsc::JobContext for CompressRequestBody {
    type OffThread = Self;
    type Js = Box<PendingFetch>;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        if done.ticket().script_allowed() {
            // SAFETY: the `Js` half keeps the body alive; the bytes are only read.
            let input: &[u8] = unsafe { &*this.input.as_ptr() };
            this.out = compress(input, &this.opt);
        }
        Some(done)
    }

    fn then(this: Self, js: Box<PendingFetch>, cx: &jsc::JsThread<'_>) -> JsResult<()> {
        let PendingFetch {
            fetch_options,
            promise,
            abort_handle,
            ..
        } = *js;
        abort_handle.unfollow();
        // Rejected by the signal during the hop.
        if !promise.has_value() {
            return Ok(());
        }
        finish(cx, fetch_options, promise, this.out)
    }
}

/// Swap the compressed bytes in and queue, or reject the fetch.
fn finish(
    cx: &jsc::JsThread<'_>,
    mut fetch_options: FetchOptions,
    mut promise: jsc::JSPromiseStrong,
    out: Result<Vec<u8>, CompressError>,
) -> JsResult<()> {
    fetch_options.body.detach();
    match out {
        Ok(compressed) => {
            fetch_options.body = HTTPRequestBody::AnyBlob(blob::Any::from_owned_slice(compressed));
            // `queue` aborts on OOM.
            let _ = FetchTasklet::queue(cx, fetch_options, promise);
            Ok(())
        }
        Err(err) => {
            let _dispatch = fetch_options.tracker.dispatch(cx.global());
            promise.reject_with_async_stack(cx.global(), Ok(err.to_js(cx.global())))
        }
    }
}

/// Compress `fetch_options.body` with `opt`, inline or on the pool, then queue.
pub(crate) fn compress_then_queue(
    cx: &jsc::JsThread<'_>,
    opt: CompressOption,
    fetch_options: FetchOptions,
    promise: jsc::JSPromiseStrong,
) -> JsResult<()> {
    let input = fetch_options.body.slice();
    if is_cheap_inline(input.len(), &opt) {
        let out = compress(input, &opt);
        return finish(cx, fetch_options, promise, out);
    }
    // SAFETY: `PendingFetch` owns the body for the job's whole lifetime.
    let input = unsafe { bun_jsc::JsPtr::new(NonNull::from(input)) };
    let signal = fetch_options.signal.clone();
    let mut pending = Box::new(PendingFetch {
        fetch_options,
        promise,
        global: jsc::GlobalRef::from(cx.global()),
        abort_handle: jsc::AbortHandle::for_owner::<PendingFetch>(),
    });
    if let Some(signal) = signal {
        // SAFETY: boxed, so the address holds until `then` or the release drops it.
        unsafe { jsc::AbortHandle::follow_owner(&mut *pending as *mut PendingFetch, signal) };
        if !pending.promise.has_value() {
            return Ok(());
        }
    }
    jsc::Job::<CompressRequestBody>::schedule(
        cx,
        CompressRequestBody {
            input,
            opt,
            out: Err(CompressError::Failed),
        },
        pending,
    );
    Ok(())
}
