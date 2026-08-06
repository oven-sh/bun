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
) -> crate::Result<CompressOutput> {
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
    use bun_libdeflate_sys::libdeflate::{Compressor, OwnedCompressor};

    // Split-borrow so the compressor handle and `shared_buffer` can be used
    // together.
    let LibdeflateState {
        compressor,
        shared_buffer,
        ..
    } = state;
    let cached = compressor.get_or_insert_with(|| {
        OwnedCompressor::new(DEFAULT_DEFLATE_LEVEL).unwrap_or_else(|| bun_core::out_of_memory())
    });

    // Bound is level-independent — use the cached handle so the slow-path
    // bail-out doesn't pay for a temp compressor it never uses.
    if cached.max_bytes_needed(input, enc) > shared_buffer.len() {
        return None;
    }

    // Custom level → allocate a temporary compressor; the cached handle is
    // pinned to DEFAULT_DEFLATE_LEVEL.
    let mut tmp: Option<OwnedCompressor> = None;
    let compressor: &mut Compressor = match level {
        Some(l) if l != DEFAULT_DEFLATE_LEVEL => {
            tmp.insert(OwnedCompressor::new(l).unwrap_or_else(|| bun_core::out_of_memory()))
        }
        _ => cached,
    };

    Some(compressor.compress(input, shared_buffer, enc).written)
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
) -> crate::Result<()> {
    use bun_zlib::{DeflateEncoder, FlushValue, ReturnCode};

    // gzip wrapper: +16; HTTP "deflate" is the zlib-wrapped stream
    // (RFC 9110 §8.4.1.2): plain 15.
    let window_bits = if gzip { 15 + 16 } else { 15 };
    // libdeflate accepts 0..=12; zlib only 0..=9.
    let level = level.unwrap_or(DEFAULT_DEFLATE_LEVEL).min(9);
    let mut encoder = DeflateEncoder::new(level, window_bits, 8, 0)
        .map_err(|_| crate::Error::CompressionFailed)?;

    // `avail_in` is `c_uint`; `step()` clamps to u32::MAX per call so a
    // ≥4 GiB body isn't truncated — we loop until `remaining` is empty.
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
        let (consumed, rc) = encoder.step(remaining, out, reserve, flush);
        remaining = &remaining[consumed..];
        match rc {
            ReturnCode::StreamEnd => return Ok(()),
            ReturnCode::Ok => continue,
            _ => {
                out.clear();
                return Err(crate::Error::CompressionFailed);
            }
        }
    }
}

fn compress_brotli(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    spill: &mut Vec<u8>,
) -> crate::Result<CompressOutput> {
    use bun_brotli::c;
    let quality = level.unwrap_or(DEFAULT_BROTLI_QUALITY);
    let window = c::BROTLI_DEFAULT_WINDOW;
    let mode = c::BrotliEncoderMode::generic;

    let bound = c::BrotliEncoderMaxCompressedSize(input.len());
    // BrotliEncoderMaxCompressedSize returns 0 when the bound would overflow
    // size_t — fall back to a heap buffer in that case.
    if bound != 0 && bound <= state.shared_buffer.len() {
        if let Some(n) = bun_brotli::encode(quality, window, mode, input, &mut state.shared_buffer)
        {
            return Ok(CompressOutput::Shared(n));
        }
    }

    let cap = if bound != 0 {
        bound
    } else {
        input.len() + 1024
    };
    spill.resize(cap, 0);
    match bun_brotli::encode(quality, window, mode, input, spill) {
        Some(n) => {
            spill.truncate(n);
            Ok(CompressOutput::Spilled)
        }
        None => {
            spill.clear();
            Err(crate::Error::CompressionFailed)
        }
    }
}

fn compress_zstd(
    state: &mut LibdeflateState,
    input: &[u8],
    level: Option<i32>,
    spill: &mut Vec<u8>,
) -> crate::Result<CompressOutput> {
    let bound = bun_zstd::compress_bound(input.len());
    if bun_zstd::is_error(bound) {
        return Err(crate::Error::CompressionFailed);
    }
    if bound <= state.shared_buffer.len() {
        return match bun_zstd::compress(&mut state.shared_buffer, input, level) {
            bun_zstd::Result::Success(n) => Ok(CompressOutput::Shared(n)),
            bun_zstd::Result::Err(_) => Err(crate::Error::CompressionFailed),
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
            Err(crate::Error::CompressionFailed)
        }
    }
}
