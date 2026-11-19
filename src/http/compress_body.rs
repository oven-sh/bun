//! Automatic request-body compression for `fetch({ compress })`.
//!
//! Runs on the HTTP thread inside `HTTPClient::compress_body_for_send()` so it can reuse
//! [`LibdeflateState`]'s 512 KiB scratch buffer and cached compressor
//! (the same struct that backs the response-decompression fast path).
//! gzip/deflate go through `bun_deflate`; brotli/zstd take one call of their
//! encoders. Only buffered bodies reach this — streams and sendfile are
//! filtered out on the JS thread.

use crate::http_thread::LibdeflateState;
use bun_deflate::{Compressor, Format, Level, Output};

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

/// The level of the cached compressor, so the common `compress: true` / `compress: "gzip"` path reuses its memory.
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
            // HTTP "deflate" is the zlib-wrapped DEFLATE stream (RFC 9110 §8.4.1.2).
            let format = if gzip { Format::Gzip } else { Format::Zlib };
            match compress_libdeflate_fast(state, input, format, opt.level) {
                Some(n) => Ok(CompressOutput::Shared(n)),
                None => {
                    compress_zlib_streaming(input, gzip, opt.level, spill)?;
                    Ok(CompressOutput::Spilled)
                }
            }
        }
        CompressEncoding::Brotli
            if bun_removable_features::is_removed(
                bun_removable_features::Feature::BrotliEncoder,
            ) =>
        {
            Err(crate::Error::CompressionFailed)
        }
        CompressEncoding::Brotli => compress_brotli(state, input, opt.level, spill),
        CompressEncoding::Zstd => compress_zstd(state, input, opt.level, spill),
    }
}

/// One-shot fast path into `state.shared_buffer`. Returns `None`
/// when the bound exceeds the shared buffer, the compressor can't be allocated,
/// or the output doesn't fit. The caller falls back to
/// [`compress_zlib_streaming`].
fn compress_libdeflate_fast(
    state: &mut LibdeflateState,
    input: &[u8],
    format: Format,
    level: Option<i32>,
) -> Option<usize> {
    if bun_deflate::compress_bound(input.len(), format) > state.shared_buffer.len() {
        return None;
    }

    // Other levels can take megabytes, which the thread should not hold on to.
    let level = level.unwrap_or(DEFAULT_DEFLATE_LEVEL);
    let compressor = match level {
        DEFAULT_DEFLATE_LEVEL => &mut state.compressor,
        _ => &mut Compressor::default(),
    };
    let output = Output::Slice(&mut state.shared_buffer[..]);
    compressor
        .compress(input, format, Level::new(level)?, output)
        .ok()
}

/// Slow path for gzip/deflate when the one-shot bound exceeds the
/// shared buffer: streaming deflate into a Vec that grows as needed, so the
/// allocation tracks the actual compressed size, not the worst-case bound.
fn compress_zlib_streaming(
    input: &[u8],
    gzip: bool,
    level: Option<i32>,
    out: &mut Vec<u8>,
) -> crate::Result<()> {
    use bun_zlib::deflate::{Container, Deflater, Flush, Options};

    // HTTP "deflate" is the zlib-wrapped stream (RFC 9110 §8.4.1.2).
    let container = if gzip {
        Container::Gzip
    } else {
        Container::Zlib
    };
    // `bun_deflate` accepts 0..=12; zlib only 0..=9.
    let level = level.unwrap_or(DEFAULT_DEFLATE_LEVEL).min(9);
    let result = level.try_into().and_then(|level| {
        let options = Options {
            level,
            ..Default::default()
        };
        Deflater::new(container, options)?.deflate_to_vec(input, out, Flush::Finish)
    });
    result.map_err(|error| {
        out.clear();
        match error {
            bun_zlib::Error::Alloc(error) => crate::Error::Alloc(error),
            _ => crate::Error::CompressionFailed,
        }
    })
}

fn compress_brotli(
    state: &mut LibdeflateState,
    mut input: &[u8],
    level: Option<i32>,
    spill: &mut Vec<u8>,
) -> crate::Result<CompressOutput> {
    use bun_brotli::{EncodeError, EncodeStatus, Encoder, Operation};
    use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
    let bound = bun_brotli::max_compressed_size(input.len());
    let mut encoder = Encoder::with_quality(level.unwrap_or(DEFAULT_BROTLI_QUALITY));
    let mut compress =
        |output: BorrowedCursor<'_, u8>| encoder.compress(Operation::Finish, &mut input, output);
    let (result, output) = if bound <= state.shared_buffer.len() {
        let mut shared = BorrowedBuf::from(&mut state.shared_buffer[..]);
        let result = compress(shared.unfilled());
        (result, CompressOutput::Shared(shared.len()))
    } else {
        spill
            .try_reserve_exact(bound)
            .map_err(|_| bun_alloc::AllocError)?;
        (append_with(spill, bound, compress), CompressOutput::Spilled)
    };
    match result {
        Ok(EncodeStatus::Done) => Ok(output),
        Err(EncodeError::OutOfMemory) => Err(bun_alloc::AllocError.into()),
        _ => Err(crate::Error::CompressionFailed),
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
        return match bun_zstd::compress(&mut state.shared_buffer[..], input, level) {
            bun_zstd::Result::Success(n) => Ok(CompressOutput::Shared(n)),
            bun_zstd::Result::Err(_) => Err(crate::Error::CompressionFailed),
        };
    }

    spill
        .try_reserve_exact(bound)
        .map_err(|_| bun_alloc::AllocError)?;
    match bun_zstd::compress_append(spill, input, level) {
        bun_zstd::Result::Success(_) => Ok(CompressOutput::Spilled),
        bun_zstd::Result::Err(_) => Err(crate::Error::CompressionFailed),
    }
}
