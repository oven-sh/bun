//! Automatic request-body compression for `fetch({ compress })`.
//!
//! Runs on the HTTP thread inside `HTTPClient::start()` so it can reuse
//! [`LibdeflateState`]'s 512 KiB scratch buffer and cached libdeflate handle
//! (the same struct that backs the response-decompression fast path).
//! gzip/deflate go through libdeflate; brotli/zstd use their one-shot
//! encoders. Only buffered bodies reach this — streams and sendfile are
//! filtered out on the JS thread.

use crate::http_thread::LibdeflateState;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum CompressEncoding {
    Gzip,
    Deflate,
    Brotli,
    Zstd,
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

/// libdeflate's default level. Reused for the cached compressor so the common
/// `compress: true` / `compress: "gzip"` path never allocates a fresh handle.
pub const DEFAULT_DEFLATE_LEVEL: i32 = 6;
pub const DEFAULT_BROTLI_QUALITY: i32 = 6;
pub const DEFAULT_ZSTD_LEVEL: i32 = 3;

/// One-shot body compression into `out` (cleared first). HTTP-thread-only.
pub(crate) fn compress_into(
    state: &mut LibdeflateState,
    input: &[u8],
    opt: &CompressOption,
    out: &mut Vec<u8>,
) -> Result<(), bun_core::Error> {
    out.clear();
    match opt.encoding {
        CompressEncoding::Gzip | CompressEncoding::Deflate => {
            let enc = if opt.encoding == CompressEncoding::Gzip {
                bun_libdeflate_sys::libdeflate::Encoding::Gzip
            } else {
                // HTTP "deflate" is the zlib-wrapped DEFLATE stream (RFC 9110
                // §8.4.1.2); libdeflate's `Deflate` is the raw stream.
                bun_libdeflate_sys::libdeflate::Encoding::Zlib
            };
            compress_libdeflate(state, input, enc, opt.level, out);
            Ok(())
        }
        CompressEncoding::Brotli => compress_brotli(state, input, opt.level, out),
        CompressEncoding::Zstd => compress_zstd(state, input, opt.level, out),
    }
}

fn compress_libdeflate(
    state: &mut LibdeflateState,
    input: &[u8],
    enc: bun_libdeflate_sys::libdeflate::Encoding,
    level: Option<i32>,
    out: &mut Vec<u8>,
) {
    use bun_libdeflate_sys::libdeflate::Compressor;

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
        out.extend_from_slice(&state.shared_buffer[..result.written]);
        return;
    }

    // Slow path: body is large; allocate the bound up front and compress
    // directly into the Vec's spare capacity.
    out.reserve(bound);
    compressor.compress_to_vec(input, out, enc);
}

fn compress_brotli(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    out: &mut Vec<u8>,
) -> Result<(), bun_core::Error> {
    use bun_brotli::c;
    let quality = level.unwrap_or(DEFAULT_BROTLI_QUALITY);

    let bound = c::BrotliEncoderMaxCompressedSize(input.len());
    // BrotliEncoderMaxCompressedSize returns 0 when the bound would overflow
    // size_t — fall back to a heap buffer in that case.
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
            out.extend_from_slice(&state.shared_buffer[..out_len]);
            return Ok(());
        }
    }

    let cap = if bound != 0 {
        bound
    } else {
        input.len() + 1024
    };
    out.resize(cap, 0);
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
        out.clear();
        return Err(bun_core::err!(CompressionFailed));
    }
    out.truncate(out_len);
    Ok(())
}

fn compress_zstd(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    out: &mut Vec<u8>,
) -> Result<(), bun_core::Error> {
    let bound = bun_zstd::compress_bound(input.len());
    if bun_zstd::is_error(bound) {
        return Err(bun_core::err!(CompressionFailed));
    }
    if bound <= state.shared_buffer.len() {
        return match bun_zstd::compress(&mut state.shared_buffer, input, level) {
            bun_zstd::Result::Success(n) => {
                out.extend_from_slice(&state.shared_buffer[..n]);
                Ok(())
            }
            bun_zstd::Result::Err(_) => Err(bun_core::err!(CompressionFailed)),
        };
    }

    out.resize(bound, 0);
    match bun_zstd::compress(out, input, level) {
        bun_zstd::Result::Success(n) => {
            out.truncate(n);
            Ok(())
        }
        bun_zstd::Result::Err(_) => {
            out.clear();
            Err(bun_core::err!(CompressionFailed))
        }
    }
}
