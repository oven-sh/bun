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

/// Where [`compress_into`] put its output.
pub(crate) enum CompressOutput {
    /// Output is in `LibdeflateState::shared_buffer[..len]`. Valid only until
    /// the next use of `shared_buffer` (i.e. the current synchronous callback).
    Shared(usize),
    /// Output is in the caller's `spill` Vec.
    Spilled,
}

/// One-shot body compression. HTTP-thread-only. Writes into
/// `state.shared_buffer` when the bound fits (returning [`CompressOutput::Shared`]);
/// otherwise allocates into `spill` (cleared first). Callers that need the
/// output to outlive the current callback must copy `Shared` into owned storage.
pub(crate) fn compress_into(
    state: &mut LibdeflateState,
    input: &[u8],
    opt: &CompressOption,
    spill: &mut Vec<u8>,
) -> Result<CompressOutput, bun_core::Error> {
    spill.clear();
    match opt.encoding {
        CompressEncoding::Gzip | CompressEncoding::Deflate => {
            let gzip = opt.encoding == CompressEncoding::Gzip;
            let enc = if gzip {
                bun_libdeflate_sys::libdeflate::Encoding::Gzip
            } else {
                // HTTP "deflate" is the zlib-wrapped DEFLATE stream (RFC 9110
                // §8.4.1.2); libdeflate's `Deflate` is the raw stream.
                bun_libdeflate_sys::libdeflate::Encoding::Zlib
            };
            match compress_libdeflate_fast(state, input, enc, opt.level) {
                Some(n) => Ok(CompressOutput::Shared(n)),
                None => {
                    compress_zlib_streaming(input, gzip, opt.level, spill)?;
                    Ok(CompressOutput::Spilled)
                }
            }
        }
        CompressEncoding::Brotli => compress_brotli(state, input, opt.level, spill),
        CompressEncoding::Zstd => compress_zstd(state, input, opt.level, spill),
    }
}

/// libdeflate one-shot fast path into `state.shared_buffer`. Returns `None`
/// when the worst-case bound exceeds the shared buffer — caller falls back to
/// [`compress_zlib_streaming`].
fn compress_libdeflate_fast(
    state: &mut LibdeflateState,
    input: &[u8],
    enc: bun_libdeflate_sys::libdeflate::Encoding,
    level: Option<i32>,
) -> Option<usize> {
    use bun_libdeflate_sys::libdeflate::Compressor;

    // Bound is level-independent — use the cached handle so the slow-path
    // bail-out doesn't pay for a temp compressor it never uses.
    if state.compressor_mut().max_bytes_needed(input, enc) > state.shared_buffer.len() {
        return None;
    }

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

    Some(
        compressor
            .compress(input, &mut state.shared_buffer, enc)
            .written,
    )
}

/// Slow path for gzip/deflate when the libdeflate one-shot bound exceeds the
/// shared buffer: streaming zlib `deflate(Z_FINISH)` into a Vec that grows in
/// 64 KiB steps so the allocation tracks the actual compressed size, not the
/// worst-case bound.
fn compress_zlib_streaming(
    input: &[u8],
    gzip: bool,
    level: Option<i32>,
    out: &mut Vec<u8>,
) -> Result<(), bun_core::Error> {
    use bun_zlib::{FlushValue, ReturnCode, deflate, deflateEnd, deflateInit2_, zlibVersion};

    let mut strm: bun_zlib::z_stream = bun_core::ffi::zeroed();
    strm.next_in = input.as_ptr();
    strm.avail_in = input.len() as _;
    // gzip wrapper: +16; HTTP "deflate" is the zlib-wrapped stream
    // (RFC 9110 §8.4.1.2): plain 15.
    let window_bits = if gzip { 15 + 16 } else { 15 };
    // libdeflate accepts 0..=12; zlib only 0..=9.
    let level = level.unwrap_or(DEFAULT_DEFLATE_LEVEL).min(9);
    // SAFETY: `strm` is zeroed; version/size match the linked zlib.
    let rc = unsafe {
        deflateInit2_(
            &raw mut strm,
            level,
            8, // Z_DEFLATED
            window_bits,
            8, // default memLevel
            0, // Z_DEFAULT_STRATEGY
            zlibVersion().cast::<u8>(),
            size_of::<bun_zlib::z_stream>() as _,
        )
    };
    if rc != ReturnCode::Ok {
        return Err(bun_core::err!(CompressionFailed));
    }
    // SAFETY: `strm` is stack-pinned for the function's lifetime; the guard
    // runs `deflateEnd` on it at scope exit (before `strm` is dropped). Raw
    // pointer avoids the borrow conflict with the loop body.
    let strm_p: *mut bun_zlib::z_stream = &raw mut strm;
    let _guard = scopeguard::guard(strm_p, |p| unsafe {
        deflateEnd(p);
    });

    loop {
        if out.capacity() == out.len() {
            out.reserve(64 * 1024);
        }
        let spare = out.spare_capacity_mut();
        strm.next_out = spare.as_mut_ptr().cast::<u8>();
        strm.avail_out = spare.len() as _;
        // SAFETY: `strm` initialized; next_in/avail_in/next_out/avail_out are
        // valid for their lengths; `deflate` only reads input and writes the
        // tail of `out`'s spare capacity.
        let rc = unsafe { deflate(&raw mut strm, FlushValue::Finish) };
        let produced = spare.len() - strm.avail_out as usize;
        // SAFETY: zlib has initialized `produced` bytes at the start of
        // `spare`; new len is within capacity.
        unsafe { out.set_len(out.len() + produced) };
        match rc {
            ReturnCode::StreamEnd => return Ok(()),
            ReturnCode::Ok => continue,
            _ => {
                out.clear();
                return Err(bun_core::err!(CompressionFailed));
            }
        }
    }
}

fn compress_brotli(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    spill: &mut Vec<u8>,
) -> Result<CompressOutput, bun_core::Error> {
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
            return Ok(CompressOutput::Shared(out_len));
        }
    }

    let cap = if bound != 0 {
        bound
    } else {
        input.len() + 1024
    };
    spill.resize(cap, 0);
    let mut out_len = spill.len();
    // SAFETY: see above.
    let ok = unsafe {
        c::BrotliEncoderCompress(
            quality,
            c::BROTLI_DEFAULT_WINDOW,
            c::BrotliEncoderMode::generic,
            input.len(),
            input.as_ptr(),
            &raw mut out_len,
            spill.as_mut_ptr(),
        )
    };
    if ok == 0 {
        spill.clear();
        return Err(bun_core::err!(CompressionFailed));
    }
    spill.truncate(out_len);
    Ok(CompressOutput::Spilled)
}

fn compress_zstd(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    spill: &mut Vec<u8>,
) -> Result<CompressOutput, bun_core::Error> {
    let bound = bun_zstd::compress_bound(input.len());
    if bun_zstd::is_error(bound) {
        return Err(bun_core::err!(CompressionFailed));
    }
    if bound <= state.shared_buffer.len() {
        return match bun_zstd::compress(&mut state.shared_buffer, input, level) {
            bun_zstd::Result::Success(n) => Ok(CompressOutput::Shared(n)),
            bun_zstd::Result::Err(_) => Err(bun_core::err!(CompressionFailed)),
        };
    }

    spill.resize(bound, 0);
    match bun_zstd::compress(spill, input, level) {
        bun_zstd::Result::Success(n) => {
            spill.truncate(n);
            Ok(CompressOutput::Spilled)
        }
        bun_zstd::Result::Err(_) => {
            spill.clear();
            Err(bun_core::err!(CompressionFailed))
        }
    }
}
