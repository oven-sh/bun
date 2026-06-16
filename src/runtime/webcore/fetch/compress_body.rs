//! Automatic request-body compression for `fetch()`.
//!
//! Mirrors the response-decompression fast path in `bun_http::InternalState`:
//! a thread-local libdeflate compressor + fixed 512 KiB scratch buffer reused
//! across calls. gzip/deflate go through libdeflate; brotli/zstd use their
//! one-shot encoders. Only buffered bodies are handled here — streams and
//! sendfile are skipped by the caller.

use core::cell::UnsafeCell;

use crate::webcore::jsc::{self, JSGlobalObject, JSValue, JsResult};
use bun_jsc::ComptimeStringMapExt as _;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CompressEncoding {
    Gzip,
    Deflate,
    Brotli,
    Zstd,
}

bun_core::comptime_string_map! {
    static COMPRESS_ENCODING_MAP: CompressEncoding = {
        b"gzip" => CompressEncoding::Gzip,
        b"deflate" => CompressEncoding::Deflate,
        b"br" => CompressEncoding::Brotli,
        b"zstd" => CompressEncoding::Zstd,
    };
}

impl CompressEncoding {
    pub fn header_value(self) -> &'static [u8] {
        match self {
            CompressEncoding::Gzip => b"gzip",
            CompressEncoding::Deflate => b"deflate",
            CompressEncoding::Brotli => b"br",
            CompressEncoding::Zstd => b"zstd",
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct CompressOption {
    pub encoding: CompressEncoding,
    pub level: Option<i32>,
}

impl CompressOption {
    /// Parses `compress?: boolean | "gzip" | "deflate" | "br" | "zstd" | { encoding, level? }`.
    /// Returns `Ok(None)` for `false` / `undefined` / `null`.
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
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
                Some(enc) if enc.is_string() => {
                    match COMPRESS_ENCODING_MAP.from_js(global, enc)? {
                        Some(e) => e,
                        None => {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "fetch: 'compress.encoding' must be \"gzip\", \"deflate\", \"br\", or \"zstd\""
                            )));
                        }
                    }
                }
                _ => {
                    return Err(global.throw_invalid_argument_type_value(
                        b"compress.encoding",
                        b"string",
                        value,
                    ));
                }
            };
            let level = match value.get(global, "level")? {
                Some(lvl) if !lvl.is_undefined_or_null() => {
                    if !lvl.is_number() {
                        return Err(global.throw_invalid_argument_type_value(
                            b"compress.level",
                            b"number",
                            lvl,
                        ));
                    }
                    let n = lvl.to_int32();
                    let (min, max) = match encoding {
                        CompressEncoding::Gzip | CompressEncoding::Deflate => (0, 12),
                        CompressEncoding::Brotli => (
                            bun_brotli::c::BROTLI_MIN_QUALITY,
                            bun_brotli::c::BROTLI_MAX_QUALITY,
                        ),
                        CompressEncoding::Zstd => (1, 22),
                    };
                    if n < min || n > max {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "fetch: 'compress.level' for \"{}\" must be between {} and {}",
                            bstr::BStr::new(encoding.header_value()),
                            min,
                            max,
                        )));
                    }
                    Some(n)
                }
                _ => None,
            };
            return Ok(Some(CompressOption { encoding, level }));
        }
        Err(global.throw_invalid_argument_type_value(
            b"compress",
            b"boolean, string, or object",
            value,
        ))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Thread-local compressor state (mirrors `LibdeflateState` on the HTTP thread)
// ──────────────────────────────────────────────────────────────────────────

/// libdeflate's default level. Reused for the cached compressor so the common
/// `compress: true` / `compress: "gzip"` path never allocates a fresh handle.
const DEFAULT_DEFLATE_LEVEL: i32 = 6;
const DEFAULT_BROTLI_QUALITY: i32 = 6;

const SHARED_BUFFER_SIZE: usize = 512 * 1024;

struct CompressorState {
    compressor: *mut bun_libdeflate_sys::libdeflate::Compressor,
    shared_buffer: [u8; SHARED_BUFFER_SIZE],
}

// SAFETY: `*mut T` (null) and `[u8; N]` are both valid at the all-zero bit pattern.
unsafe impl bun_core::Zeroable for CompressorState {}

impl CompressorState {
    #[inline]
    fn compressor_mut<'a>(&self) -> &'a mut bun_libdeflate_sys::libdeflate::Compressor {
        // SAFETY: `compressor` is set once in `with_state` from
        // `libdeflate_alloc_compressor` (panics on null) and never freed for
        // the thread's lifetime. The handle is a separate C heap allocation
        // disjoint from `self`, so the returned `&mut` does not alias
        // `shared_buffer`. Thread-local — sole live borrow.
        unsafe { &mut *self.compressor }
    }
}

thread_local! {
    static LAZY_COMPRESSOR: UnsafeCell<Option<Box<CompressorState>>> =
        const { UnsafeCell::new(None) };
}

fn with_state<R>(f: impl FnOnce(&mut CompressorState) -> R) -> R {
    LAZY_COMPRESSOR.with(|cell| {
        // SAFETY: thread-local; sole accessor; no re-entrance from `f` back into
        // this function.
        let slot = unsafe { &mut *cell.get() };
        if slot.is_none() {
            let compressor =
                bun_libdeflate_sys::libdeflate::Compressor::alloc(DEFAULT_DEFLATE_LEVEL);
            if compressor.is_null() {
                bun_core::out_of_memory();
            }
            let mut state: Box<CompressorState> = bun_core::boxed_zeroed();
            state.compressor = compressor;
            *slot = Some(state);
        }
        f(slot.as_deref_mut().unwrap())
    })
}

// ──────────────────────────────────────────────────────────────────────────
// One-shot body compression
// ──────────────────────────────────────────────────────────────────────────

pub fn compress_request_body(
    global: &JSGlobalObject,
    input: &[u8],
    opt: &CompressOption,
) -> JsResult<Vec<u8>> {
    match opt.encoding {
        CompressEncoding::Gzip | CompressEncoding::Deflate => {
            let enc = if opt.encoding == CompressEncoding::Gzip {
                bun_libdeflate_sys::libdeflate::Encoding::Gzip
            } else {
                // HTTP "deflate" is the zlib-wrapped DEFLATE stream (RFC 9110
                // §8.4.1.2); libdeflate's `Deflate` is the raw stream.
                bun_libdeflate_sys::libdeflate::Encoding::Zlib
            };
            Ok(compress_libdeflate(input, enc, opt.level))
        }
        CompressEncoding::Brotli => compress_brotli(global, input, opt.level),
        CompressEncoding::Zstd => compress_zstd(global, input, opt.level),
    }
}

fn compress_libdeflate(
    input: &[u8],
    enc: bun_libdeflate_sys::libdeflate::Encoding,
    level: Option<i32>,
) -> Vec<u8> {
    use bun_libdeflate_sys::libdeflate::Compressor;

    with_state(|state| {
        // Custom level → allocate a temporary compressor; the cached handle is
        // pinned to DEFAULT_DEFLATE_LEVEL.
        let mut tmp: *mut Compressor = core::ptr::null_mut();
        let compressor: &mut Compressor = match level {
            Some(l) if l != DEFAULT_DEFLATE_LEVEL => {
                tmp = Compressor::alloc(l);
                if tmp.is_null() {
                    bun_core::out_of_memory();
                }
                // SAFETY: just allocated, non-null, exclusive.
                unsafe { &mut *tmp }
            }
            _ => state.compressor_mut(),
        };
        let _guard = scopeguard::guard(tmp, |tmp| {
            if !tmp.is_null() {
                // SAFETY: `tmp` was returned by `Compressor::alloc` above and is
                // not used after this call.
                unsafe { Compressor::destroy(tmp) };
            }
        });

        // Fast path: compress into the shared buffer, then copy out.
        let bound = compressor.max_bytes_needed(input, enc);
        if bound <= state.shared_buffer.len() {
            let result = compressor.compress(input, &mut state.shared_buffer, enc);
            return state.shared_buffer[..result.written].to_vec();
        }

        // Slow path: body is large; allocate the bound up front and compress
        // directly into the Vec's spare capacity.
        let mut out = Vec::with_capacity(bound);
        compressor.compress_to_vec(input, &mut out, enc);
        out
    })
}

fn compress_brotli(global: &JSGlobalObject, input: &[u8], level: Option<i32>) -> JsResult<Vec<u8>> {
    use bun_brotli::c;
    let quality = level.unwrap_or(DEFAULT_BROTLI_QUALITY);

    with_state(|state| {
        let bound = c::BrotliEncoderMaxCompressedSize(input.len());
        // BrotliEncoderMaxCompressedSize returns 0 when the bound would
        // overflow size_t — fall back to a heap buffer in that case.
        if bound != 0 && bound <= state.shared_buffer.len() {
            let mut out_len = state.shared_buffer.len();
            // SAFETY: input/output slices are valid for their lengths;
            // BrotliEncoderCompress only reads `input` and writes `out_len`
            // bytes to `shared_buffer`, updating `out_len` to bytes written.
            let ok = unsafe {
                c::BrotliEncoderCompress(
                    quality,
                    c::BROTLI_DEFAULT_WINDOW,
                    c::BrotliEncoderMode::generic,
                    input.len(),
                    input.as_ptr(),
                    &raw mut out_len,
                    state.shared_buffer.as_mut_ptr(),
                )
            };
            if ok != 0 {
                return Ok(state.shared_buffer[..out_len].to_vec());
            }
        }

        let cap = if bound != 0 {
            bound
        } else {
            input.len() + 1024
        };
        let mut out = vec![0u8; cap];
        let mut out_len = out.len();
        // SAFETY: see above.
        let ok = unsafe {
            c::BrotliEncoderCompress(
                quality,
                c::BROTLI_DEFAULT_WINDOW,
                c::BrotliEncoderMode::generic,
                input.len(),
                input.as_ptr(),
                &raw mut out_len,
                out.as_mut_ptr(),
            )
        };
        if ok == 0 {
            return Err(global
                .err(
                    jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                    format_args!("brotli compression failed"),
                )
                .throw());
        }
        out.truncate(out_len);
        Ok(out)
    })
}

fn compress_zstd(global: &JSGlobalObject, input: &[u8], level: Option<i32>) -> JsResult<Vec<u8>> {
    with_state(|state| {
        let bound = bun_zstd::compress_bound(input.len());
        if bun_zstd::is_error(bound) {
            return Err(global
                .err(
                    jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                    format_args!("zstd compression failed: input too large"),
                )
                .throw());
        }
        if bound <= state.shared_buffer.len() {
            match bun_zstd::compress(&mut state.shared_buffer, input, level) {
                bun_zstd::Result::Success(n) => {
                    return Ok(state.shared_buffer[..n].to_vec());
                }
                bun_zstd::Result::Err(msg) => {
                    return Err(global
                        .err(
                            jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                            format_args!(
                                "zstd compression failed: {}",
                                bstr::BStr::new(msg.as_bytes())
                            ),
                        )
                        .throw());
                }
            }
        }

        let mut out = vec![0u8; bound];
        match bun_zstd::compress(&mut out, input, level) {
            bun_zstd::Result::Success(n) => {
                out.truncate(n);
                Ok(out)
            }
            bun_zstd::Result::Err(msg) => Err(global
                .err(
                    jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                    format_args!(
                        "zstd compression failed: {}",
                        bstr::BStr::new(msg.as_bytes())
                    ),
                )
                .throw()),
        }
    })
}
