//! Zstandard (RFC 8878). A port of https://github.com/facebook/zstd v1.5.7 (LICENSE.md): the same bytes out for the
//! same bytes in, in both directions, and the same errors.
#![forbid(unsafe_code)]
// Frames come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod common;
mod decompress;
mod error;
mod util;

pub use common::{ZSTD_CONTENTSIZE_ERROR, ZSTD_CONTENTSIZE_UNKNOWN};
pub use decompress::{
    DCtx, DDict, ZSTD_D_WINDOW_LOG_MAX, decompress, find_decompressed_size,
    find_frame_compressed_size, get_frame_content_size,
};
pub use error::ErrorCode;

/// `ZSTD_inBuffer`
pub struct InBuffer<'a> {
    pub src: &'a [u8],
    /// How much of `src` is read.
    pub pos: usize,
}

/// `ZSTD_outBuffer`
pub struct OutBuffer<'a> {
    pub dst: &'a mut [u8],
    /// How much of `dst` is written.
    pub pos: usize,
}

/// `ZSTD_ResetDirective`
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ResetDirective {
    SessionOnly = 1,
    Parameters = 2,
    SessionAndParameters = 3,
}

// -----------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ZstdError {
    /// The output, or the decoder state the frame's window size dictates, could not be allocated.
    OutOfMemory,
    InvalidZstdData,
    DecompressionFailed,
    ZstdDecompressionError,
    ShortRead,
}

impl core::fmt::Display for ZstdError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(self))
    }
}
impl core::error::Error for ZstdError {}

impl ZstdError {
    /// The error for a failed decompression call; `other` is the non-allocation failure.
    fn for_decompression(code: ErrorCode, other: ZstdError) -> ZstdError {
        if code == ErrorCode::MemoryAllocation {
            ZstdError::OutOfMemory
        } else {
            other
        }
    }
}

/// `len` zeros for a decoder to write to.
fn output_buffer(len: usize) -> Result<Vec<u8>, ZstdError> {
    util::try_zeroed(len).map_err(|_| ZstdError::OutOfMemory)
}

/// Decompress data, automatically allocating the output buffer.
/// Handles both frames with known and unknown content sizes.
/// For safety, if the reported decompressed size exceeds 16MB, streaming decompression is used instead.
/// Output allocations fail with [`ZstdError::OutOfMemory`] instead of aborting.
pub fn decompress_alloc(src: &[u8]) -> Result<Vec<u8>, ZstdError> {
    let size = find_decompressed_size(src);

    const MAX_PREALLOCATE_SIZE: usize = 16 * 1024 * 1024; // 16MB safety limit

    if size == ZSTD_CONTENTSIZE_ERROR {
        return Err(ZstdError::InvalidZstdData);
    }

    // Use streaming decompression if:
    // 1. Content size is unknown, OR
    // 2. Reported size exceeds safety limit (to prevent malicious inputs claiming huge sizes)
    if size == ZSTD_CONTENTSIZE_UNKNOWN || size > MAX_PREALLOCATE_SIZE as u64 {
        let initial_capacity = if size == ZSTD_CONTENTSIZE_UNKNOWN {
            // A frame's output is rarely smaller than its input.
            src.len().clamp(STREAMING_OUTPUT_STEP, MAX_PREALLOCATE_SIZE)
        } else {
            // The header size is untrusted: reserve no more than the fast path below would.
            MAX_PREALLOCATE_SIZE
        };
        let mut list: Vec<u8> = Vec::new();
        list.try_reserve_exact(initial_capacity)
            .map_err(|_| ZstdError::OutOfMemory)?;
        StreamingDecoder::new().decompress(src, &mut list, usize::MAX, true)?;
        return Ok(list);
    }

    // Fast path: size is known and within reasonable limits
    let mut output = output_buffer(size as usize)?;
    let written = decompress(&mut output, src)
        .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))?;
    output.truncate(written);
    Ok(output)
}

/// Decompresses one frame that was compressed with `prefix` as its raw content dictionary, which is
/// referenced and not copied. The size has to be in the header of the frame, and at most 16 MB.
pub fn decompress_alloc_with_prefix(src: &[u8], prefix: &[u8]) -> Result<Vec<u8>, ZstdError> {
    const MAX_SIZE: u64 = 16 * 1024 * 1024;
    let size = find_decompressed_size(src);
    // Also if it is unknown or invalid, which are the two largest values.
    if size > MAX_SIZE {
        return Err(ZstdError::InvalidZstdData);
    }
    let mut output = output_buffer(size as usize)?;
    let written = DDict::prefix(prefix)
        .and_then(|prefix| DCtx::new().decompress_using_ddict(&mut output, src, &prefix))
        .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))?;
    output.truncate(written);
    Ok(output)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Uninitialized,
    Inflating,
    End,
    Error,
}

/// Minimum spare output capacity offered to the decoder per call.
const STREAMING_OUTPUT_STEP: usize = 4096;

// ──────────────────────────────────────────────────────────────────────────
// StreamingDecoder
// ──────────────────────────────────────────────────────────────────────────

/// Streaming zstd decoder. Input and output are passed to [`decompress`](Self::decompress)
/// per call, so callers can hold the decoder across multiple body chunks.
pub struct StreamingDecoder {
    stream: DCtx,
    state: State,
    /// The decoder filled its last window and may hold more. `max_output` can end a call there.
    output_full: bool,
}

impl Default for StreamingDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamingDecoder {
    pub fn new() -> Self {
        Self {
            stream: DCtx::new(),
            state: State::Uninitialized,
            output_full: false,
        }
    }

    #[inline]
    pub fn is_inflating(&self) -> bool {
        matches!(self.state, State::Inflating)
    }

    /// Append decompressed bytes to `out` (growing in 4096-byte steps) until `input` is
    /// consumed or `out.len()` reaches `max_output`. Returns the input bytes consumed.
    /// Returns `ShortRead` when more input is required and `is_done` is false.
    pub fn decompress(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max_output: usize,
        is_done: bool,
    ) -> Result<usize, ZstdError> {
        if matches!(self.state, State::End | State::Error) {
            return Ok(input.len());
        }

        let mut in_buf = InBuffer { src: input, pos: 0 };
        while matches!(self.state, State::Uninitialized | State::Inflating) {
            let next_in_len = input.len() - in_buf.pos;

            // Call the decoder again with no input until it leaves the window short.
            if next_in_len == 0 && !self.output_full {
                if is_done {
                    if self.state == State::Inflating {
                        self.state = State::Error;
                        return Err(ZstdError::ZstdDecompressionError);
                    }
                    self.state = State::End;
                }
                return Ok(in_buf.pos);
            }

            if out.len() >= max_output {
                return Ok(in_buf.pos);
            }

            if out.try_reserve(STREAMING_OUTPUT_STEP).is_err() {
                self.state = State::Error;
                return Err(ZstdError::OutOfMemory);
            }
            // The decoder writes to initialized memory only.
            let written_before = out.len();
            let window = (out.capacity() - written_before).min(max_output - written_before);
            out.resize(written_before + window, 0);
            let mut out_buf = OutBuffer {
                dst: out.get_mut(written_before..).unwrap_or_default(),
                pos: 0,
            };
            let read_before = in_buf.pos;

            let result = self.stream.decompress_stream(&mut out_buf, &mut in_buf);
            let bytes_written = out_buf.pos;
            out.truncate(written_before + bytes_written);
            let remaining = match result {
                Ok(remaining) => remaining,
                Err(code) => {
                    self.state = State::Error;
                    return Err(ZstdError::for_decompression(
                        code,
                        ZstdError::ZstdDecompressionError,
                    ));
                }
            };

            self.output_full = bytes_written == window;

            if remaining == 0 {
                // Frame complete, and fully flushed.
                self.state = State::Uninitialized;
                self.output_full = false;
                if in_buf.pos >= input.len() {
                    if is_done {
                        self.state = State::End;
                    }
                    return Ok(in_buf.pos);
                }
                // More input available — reinitialize for the next frame.
                self.stream.init_stream();
                continue;
            }

            self.state = State::Inflating;

            if in_buf.pos - read_before == next_in_len {
                if self.output_full {
                    continue;
                }
                if is_done {
                    self.state = State::Error;
                    return Err(ZstdError::ZstdDecompressionError);
                }
                return Err(ZstdError::ShortRead);
            }
        }
        Ok(in_buf.pos)
    }
}

// ── compressed embedded assets ────────────────────────────────────────────

/// Embed an asset zstd-compressed and inflate it on first use. Only for bytes
/// Bun never executes or parses itself: the shell completion scripts and the
/// JS/CSS bundles that are shipped to a browser (dev-server client runtime,
/// error overlay/page). Anything that runs inside Bun stays uncompressed.
///
/// The exception is text that only `bun lint`, `bun fmt` and `bun check`
/// read. It may be compressed because it isn't on the path of running a program.
///
/// Release (`bun_codegen_embed`) builds include the `.zst` twin that
/// `scripts/build/codegen.ts` (`emitCompressedEmbeds`) writes to
/// `<codegen>/compressed/<name>.zst`; other builds evaluate `$fallback`.
#[macro_export]
macro_rules! embed_compressed {
    // A codegen output (`<codegen>/$sub`); debug builds read it at runtime.
    (codegen $sub:literal) => {
        $crate::embed_compressed!(
            ("codegen/", $sub),
            ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes()
        )
    };
    // Same, with a trailing NUL included in the slice (for C-string consumers).
    (codegen_nul $sub:literal) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded_nul(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/codegen/",
                            $sub,
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                static __COPY: ::std::sync::OnceLock<::std::boxed::Box<[u8]>> = ::std::sync::OnceLock::new();
                &__COPY.get_or_init(|| {
                    let text = ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes();
                    let mut copy = ::std::vec::Vec::with_capacity(text.len() + 1);
                    copy.extend_from_slice(text);
                    copy.push(0);
                    copy.into_boxed_slice()
                })[..]
            }
        };
        __bytes
    }};
    // A file under `src/`; debug builds read it from the source tree at runtime.
    (src $sub:literal) => {
        $crate::embed_compressed!(("src/", $sub), ::bun_core::runtime_embed_file!(Src, $sub).as_bytes())
    };
    ($name:literal, $fallback:expr) => {
        $crate::embed_compressed!(($name), $fallback)
    };
    (($($name:literal),+), $fallback:expr) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/",
                            $($name,)+
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                $fallback
            }
        };
        __bytes
    }};
}

/// Cold, shared body of [`embed_compressed!`]'s release arm.
#[cold]
#[inline(never)]
#[expect(clippy::expect_used, reason = "the build made the frame")]
pub fn inflate_embedded(compressed: &'static [u8]) -> Box<[u8]> {
    decompress_alloc(compressed)
        .expect("embedded asset: invalid zstd frame")
        .into_boxed_slice()
}

/// [`inflate_embedded`] plus a trailing NUL byte.
#[cold]
#[inline(never)]
#[expect(clippy::expect_used, reason = "the build made the frame")]
pub fn inflate_embedded_nul(compressed: &'static [u8]) -> Box<[u8]> {
    let mut inflated = decompress_alloc(compressed).expect("embedded asset: invalid zstd frame");
    inflated.reserve_exact(1);
    inflated.push(0);
    inflated.into_boxed_slice()
}
