//! zstd as Bun uses it. The codec is in `decoder/` and `encoder/`.
#![forbid(unsafe_code)]
#![warn(unused_must_use)]
#![feature(maybe_uninit_fill)]

mod embed;
mod streaming_decoder;

use core::mem::MaybeUninit;

use bun_zstd_decoder::{ContentSize, Dictionary, FrameLen};

pub use bun_zstd_decoder::{Decoder, Error, Output, SpareTables, Status, may_start_frame};
pub use bun_zstd_encoder::{DEFAULT_LEVEL, Encoder, EndDirective, compress, compress_bound};
pub use embed::{inflate_embedded, inflate_embedded_nul};
pub use streaming_decoder::StreamingDecoder;

/// [`compress`] to the end of `out`.
pub fn compress_append(out: &mut Vec<u8>, bytes: &[u8], level: i32) -> Result<(), Error> {
    let bound = compress_bound(bytes.len()).ok_or(Error::SrcSizeWrong)?;
    out.try_reserve_exact(bound)?;
    compress(bytes, &mut Output::spare_capacity(out, bound), level)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ZstdError {
    /// The output, or the decoder state the frame's window size dictates, could not be allocated.
    OutOfMemory,
    InvalidZstdData,
    DecompressionFailed,
    ZstdDecompressionError,
    ShortRead,
}

bun_core::impl_tag_error!(ZstdError);

impl ZstdError {
    /// The error for a failed decompression call; `other` is the non-allocation failure.
    fn for_decompression(error: Error, other: ZstdError) -> ZstdError {
        match error {
            Error::MemoryAllocation => ZstdError::OutOfMemory,
            _ => other,
        }
    }
}

/// The content size in a header gets no more memory than this before anything is written.
const MAX_PREALLOCATE_SIZE: usize = 16 * 1024 * 1024;

fn with_capacity(capacity: usize) -> Result<Vec<u8>, ZstdError> {
    let mut output = Vec::new();
    output
        .try_reserve_exact(capacity)
        .map_err(|_| ZstdError::OutOfMemory)?;
    Ok(output)
}

fn decompress_sized(
    spare: &mut SpareTables,
    src: &[u8],
    size: usize,
    dictionary: Option<&Dictionary<'_>>,
) -> Result<Vec<u8>, ZstdError> {
    let mut output = with_capacity(size)?;
    bun_zstd_decoder::decompress_with(
        spare,
        src,
        &mut Output::spare_capacity(&mut output, size),
        dictionary,
    )
    .map_err(|error| ZstdError::for_decompression(error, ZstdError::DecompressionFailed))?;
    Ok(output)
}

/// Decompresses one or more frames.
pub fn decompress_alloc(src: &[u8]) -> Result<Vec<u8>, ZstdError> {
    decompress_alloc_with(&mut SpareTables::default(), src)
}

/// [`decompress_alloc`] with the memory that an earlier call left in `spare`.
pub fn decompress_alloc_with(spare: &mut SpareTables, src: &[u8]) -> Result<Vec<u8>, ZstdError> {
    let mut output = match bun_zstd_decoder::decompressed_size(src) {
        ContentSize::Invalid => return Err(ZstdError::InvalidZstdData),
        ContentSize::Known(size) if size <= MAX_PREALLOCATE_SIZE as u64 => {
            return decompress_sized(spare, src, size as usize, None);
        }
        ContentSize::Known(_) => with_capacity(MAX_PREALLOCATE_SIZE)?,
        // A frame's output is rarely smaller than its input.
        ContentSize::Unknown => with_capacity(src.len().clamp(4096, MAX_PREALLOCATE_SIZE))?,
    };
    let mut stream = StreamingDecoder::new();
    stream.decoder.swap_tables(spare);
    let result = stream.decompress(src, &mut output, usize::MAX, true);
    stream.decoder.swap_tables(spare);
    result.map(|_| output)
}

/// One frame that has `prefix` as its raw dictionary, and a size of at most 16 MB in its header.
pub fn decompress_alloc_with_prefix(src: &[u8], prefix: &[u8]) -> Result<Vec<u8>, ZstdError> {
    match bun_zstd_decoder::decompressed_size(src) {
        ContentSize::Known(size) if size <= MAX_PREALLOCATE_SIZE as u64 => {
            let (spare, prefix) = (&mut SpareTables::default(), Dictionary::raw(prefix));
            decompress_sized(spare, src, size as usize, Some(&prefix))
        }
        _ => Err(ZstdError::InvalidZstdData),
    }
}

/// Of the whole frames that `src` consists of, if their headers have it.
pub fn decompressed_size(src: &[u8]) -> Option<usize> {
    match bun_zstd_decoder::decompressed_size(src) {
        ContentSize::Known(size) => size.try_into().ok(),
        ContentSize::Unknown | ContentSize::Invalid => None,
    }
}

/// The first frame of `src`, and what follows it.
pub fn split_first_frame(src: &[u8]) -> Option<(&[u8], &[u8])> {
    match bun_zstd_decoder::frame_len(src).ok()? {
        FrameLen::Complete(len) => src.split_at_checked(len),
        FrameLen::AtLeast(_) => None,
    }
}

/// Initializes `out`, and returns whether `src` decompresses to all of it.
pub fn decompress_exact(out: &mut [MaybeUninit<u8>], src: &[u8]) -> bool {
    let mut out = Output::slice(out.write_default());
    bun_zstd_decoder::decompress(src, &mut out, None).is_ok() && out.room() == 0
}
