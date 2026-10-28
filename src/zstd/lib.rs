//! Zstandard (RFC 8878). A port of https://github.com/facebook/zstd v1.5.7 (LICENSE.md): the same bytes out for the
//! same bytes in, in both directions, and the same errors.
#![feature(hint_prefetch, mpmc_channel, vec_push_within_capacity)]
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
mod compress;
mod decompress;
mod error;
mod util;

pub use common::ZSTD_CONTENTSIZE_ERROR;
use common::ZSTD_CONTENTSIZE_UNKNOWN;
use compress::cctx::Output;
pub use compress::internal::Strategy;
pub use compress::params::{ZSTD_CLEVEL_DEFAULT, c_param, compress_bound};
use compress::stream::compress_to;
pub use compress::stream::{CCtx, EndDirective, compress};
use decompress::find_decompressed_size;
pub use decompress::{
    DCtx, DDict, FrameExtent, ZSTD_D_WINDOW_LOG_MAX, frame_extent, get_frame_content_size,
};
pub use error::{Error, Result, ZstdError};

// Callers share contexts between threads behind their own `unsafe impl`s, which should have nothing to vouch for here.
const _: () = {
    const fn shareable<T: Send + Sync>() {}
    shareable::<CCtx>();
    shareable::<DCtx>();
};

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

/// Output at the end of a `Vec`. The codecs write to initialized memory only: this zeroes little more than gets
/// written, however many calls that takes and however much capacity the `Vec` has to spare.
pub struct VecOutput<'a> {
    vec: &'a mut Vec<u8>,
    start: usize,
    /// `vec[..filled]` is output, the rest of it zeros. The `Vec` is cut to it on drop.
    filled: usize,
}

impl<'a> VecOutput<'a> {
    /// Memory that is zeroed and not written stays resident with the output.
    const MOST_STEPS_AT_ONCE: usize = 64;

    pub fn new(vec: &'a mut Vec<u8>) -> Self {
        let filled = vec.len();
        Self {
            vec,
            start: filled,
            filled,
        }
    }

    /// The length of the `Vec` up to the end of the output.
    pub fn filled(&self) -> usize {
        self.filled
    }

    /// Room for one call of a codec: `step` bytes, or more of them after much output, but never past `limit`.
    /// [`advance`](Self::advance) by what it wrote.
    pub fn buffer(&mut self, step: usize, limit: usize) -> Result<OutBuffer<'_>> {
        let room = self.vec.len() - self.filled;
        let budget = limit.saturating_sub(self.filled);
        if room < step.min(budget) {
            let most = step.saturating_mul(Self::MOST_STEPS_AT_ONCE);
            let more = (self.filled - self.start).clamp(step, most).min(budget) - room;
            self.vec
                .try_reserve(more)
                .map_err(|_| Error::MemoryAllocation)?;
            self.vec.resize(self.vec.len() + more, 0);
        }
        let end = self.vec.len().min(limit);
        Ok(OutBuffer {
            dst: self.vec.get_mut(self.filled..end).unwrap_or_default(),
            pos: 0,
        })
    }

    pub fn advance(&mut self, written: usize) {
        self.filled = (self.filled + written).min(self.vec.len());
    }
}

impl Drop for VecOutput<'_> {
    fn drop(&mut self) {
        self.vec.truncate(self.filled);
    }
}

// -----------------------------------

/// [`compress`] to the end of `out`, within its capacity: [`compress_bound`] more than its length is always enough.
/// Returns how many bytes are added.
pub fn compress_append(out: &mut Vec<u8>, src: &[u8], level: i32) -> Result {
    let start = out.len();
    let room = (out.capacity() - start).min(compress_bound(src.len()));
    let result = compress_to(
        &mut Output::Spare {
            vec: out,
            start,
            end: start + room,
        },
        src,
        level,
    );
    out.truncate(start + result.unwrap_or(0));
    result
}

/// [`compress`] to a new buffer.
pub fn compress_alloc(src: &[u8], level: i32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    out.try_reserve_exact(compress_bound(src.len()))
        .map_err(|_| Error::MemoryAllocation)?;
    compress_append(&mut out, src, level)?;
    Ok(out)
}

/// With that much room after its output, a decoder copies in chunks up to the end.
const OUTPUT_SLACK: usize = common::WILDCOPY_OVERLENGTH;

/// How much room to give a decoder that is to write `size` bytes.
fn output_capacity(size: usize) -> usize {
    // Not where it would be most of the buffer: to give that back can take a copy.
    if size >= 2 * OUTPUT_SLACK {
        size + OUTPUT_SLACK
    } else {
        size
    }
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
    DCtx::new()
        .decompress_to_vec(output_capacity(size as usize), src, None)
        .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))
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
    let capacity = output_capacity(size as usize);
    DDict::prefix(prefix)
        .and_then(|prefix| DCtx::new().decompress_to_vec(capacity, src, Some(&prefix)))
        .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))
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

    /// Append decompressed bytes to `out` (growing in steps of 4096 bytes or more) until `input` is
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
        let mut out = VecOutput::new(out);
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

            if out.filled() >= max_output {
                return Ok(in_buf.pos);
            }

            let Ok(mut out_buf) = out.buffer(STREAMING_OUTPUT_STEP, max_output) else {
                self.state = State::Error;
                return Err(ZstdError::OutOfMemory);
            };
            let read_before = in_buf.pos;

            let result = self.stream.decompress_stream(&mut out_buf, &mut in_buf);
            let (bytes_written, window) = (out_buf.pos, out_buf.dst.len());
            out.advance(bytes_written);
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

#[cfg(test)]
mod tests {
    use super::*;
    use util::SliceExt;

    #[test]
    fn a_stream_that_has_failed_goes_on_failing() {
        // 5 bytes are announced, and the last block has 3.
        let frame = [
            0x28, 0xB5, 0x2F, 0xFD, 0x20, 5, 0x19, 0, 0, b'a', b'b', b'c',
        ];
        let mut stream = DCtx::new();
        let mut decompress = |src: &[u8]| {
            let mut dst = [0; 64];
            let (mut output, mut input) = (
                OutBuffer {
                    dst: &mut dst,
                    pos: 0,
                },
                InBuffer { src, pos: 0 },
            );
            stream.decompress_stream(&mut output, &mut input)
        };
        let (start, end) = frame.split_at(9);
        assert_eq!(decompress(start), Ok(3));
        assert_eq!(decompress(end), Err(Error::CorruptionDetected));
        for more in [&b"x"[..], b"", &frame] {
            assert_eq!(decompress(more), Err(Error::CorruptionDetected));
        }
        stream.init_stream();
        let (mut dst, src) = ([0; 64], [&frame[..5], &[3], &frame[6..]].concat());
        let (mut output, mut input) = (
            OutBuffer {
                dst: &mut dst,
                pos: 0,
            },
            InBuffer { src: &src, pos: 0 },
        );
        assert_eq!(stream.decompress_stream(&mut output, &mut input), Ok(0));
        assert_eq!(output.pos, 3);
    }

    #[test]
    fn a_stream_under_way_goes_on_after_what_does_not_concern_its_frame() -> Result<()> {
        let data = Vec::from_iter((0..300u32).map(|i| (i * i % 7) as u8));
        let frame = compress_alloc(&data, 3)?;
        let mut dst = [0; 400];
        let mut stream = DCtx::new();
        let (start, end) = frame.split_at(frame.len() - 5);
        let (mut output, mut input) = (
            OutBuffer {
                dst: &mut dst,
                pos: 0,
            },
            InBuffer { src: start, pos: 0 },
        );
        assert_eq!(stream.decompress_stream(&mut output, &mut input), Ok(5));
        assert_eq!(
            stream.decompress(&mut [0; 400], &frame),
            Err(Error::StageWrong)
        );
        let mut no_input = InBuffer { src: &[], pos: 0 };
        for _ in 0..15 {
            assert_eq!(stream.decompress_stream(&mut output, &mut no_input), Ok(5));
        }
        let result = stream.decompress_stream(&mut output, &mut no_input);
        assert_eq!(result, Err(Error::NoForwardProgressInputEmpty));
        let mut input = InBuffer { src: end, pos: 0 };
        assert_eq!(stream.decompress_stream(&mut output, &mut input), Ok(0));
        assert_eq!(output.pos, data.len());
        assert_eq!(*dst.sub(..data.len())?, *data);
        assert_eq!(stream.decompress(&mut dst, &frame), Ok(data.len()));
        Ok(())
    }

    #[test]
    fn little_more_is_zeroed_than_is_written() {
        const STEP: usize = 16;
        const MOST: usize = STEP * VecOutput::MOST_STEPS_AT_ONCE;
        let mut vec = Vec::new();
        let mut out = VecOutput::new(&mut vec);
        while out.filled() < 4 * MOST {
            let room = out
                .buffer(STEP, usize::MAX)
                .map_or(0, |buffer| buffer.dst.len());
            assert!((STEP..=MOST).contains(&room));
            out.advance(room);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore = "takes over 10 minutes")]
    fn room_that_grows_gives_what_room_that_is_there_gives() -> Result<()> {
        // Blocks that compress well, hardly, and not at all.
        let mut state = 1u32;
        let src: Vec<u8> = (0..400_000u32)
            .map(|i| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                match i >> 17 {
                    0 => (state % 5) as u8 * (i % 7) as u8,
                    1 => (state >> 24) as u8,
                    _ => (state >> 24) as u8 | 1,
                }
            })
            .collect();
        for level in [1, 3, 6, 13, 16] {
            let mut whole = vec![0; compress_bound(src.len())];
            let size = compress(&mut whole, &src, level)?;
            assert!(compress_alloc(&src, level)? == *whole.sub(..size)?);
            for capacity in [whole.len() + 1000, size, size - 1, size / 2, 0] {
                let mut out = Vec::with_capacity(1 + capacity);
                out.push(7);
                let room = (out.capacity() - 1).min(whole.len());
                let appended = compress_append(&mut out, &src, level);
                assert_eq!(appended, compress(whole.sub_mut(..room)?, &src, level));
                assert!(out.split_first() == Some((&7, whole.sub(..appended.unwrap_or(0))?)));
            }
        }
        Ok(())
    }

    /// A frame with a block, or more, for each of `pieces`.
    fn frame_of(cctx: &mut CCtx, pieces: &[&[u8]]) -> Result<Vec<u8>> {
        let mut frame = vec![0; compress_bound(pieces.concat().len()) + 16 * pieces.len()];
        let mut output = OutBuffer {
            dst: &mut frame,
            pos: 0,
        };
        for (index, src) in pieces.iter().enumerate() {
            let end = if index + 1 == pieces.len() {
                EndDirective::End
            } else {
                EndDirective::Flush
            };
            assert_eq!(
                cctx.compress_stream2(&mut output, &mut InBuffer { src, pos: 0 }, end),
                Ok(0)
            );
        }
        let size = output.pos;
        frame.truncate(size);
        Ok(frame)
    }

    #[test]
    fn literals_that_start_and_end_like_noise_are_stored_whatever_the_room() {
        // Long enough for the C library to judge literals without a match by their first and last 4 KB.
        const LEN: usize = 41_000;
        const STORED: usize = 4 + 1 + 2 + 3 + LEN;
        let mut state = 13u32;
        let src: Vec<u8> = (0..LEN)
            .map(|i| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                let byte = (state >> 8) as u8;
                if (4096..LEN - 4096).contains(&i) {
                    byte % 64
                } else {
                    byte
                }
            })
            .collect();
        let cases = [
            (STORED + 7, Ok(STORED)),
            (STORED + 6, Ok(STORED)),
            (STORED, Ok(STORED)),
            (STORED - 1, Err(Error::DstSizeTooSmall)),
        ];
        // Miri takes 15 seconds for a call.
        for (capacity, expected) in cases.into_iter().take(if cfg!(miri) { 1 } else { 4 }) {
            let mut dst = vec![0; capacity];
            assert_eq!(compress(&mut dst, &src, 1), expected);
            let mut out = Vec::with_capacity(capacity);
            assert_eq!(out.capacity(), capacity);
            assert_eq!(compress_append(&mut out, &src, 1), expected);
            if expected.is_ok() {
                assert!(dst.get(..STORED) == Some(&*out));
                assert!(decompress_alloc(&out).as_ref() == Ok(&src));
            }
        }
    }

    #[test]
    fn tables_that_change_size_give_the_same_frames() -> Result<()> {
        let mut state = 11u32;
        let src: Vec<u8> = (0..if cfg!(miri) { 300 } else { 6000 })
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state >> 8) as u8 % 5
            })
            .collect();
        // The tables of the optimal parser are as long as a block.
        let mut cctx = CCtx::new();
        cctx.set_parameter(c_param::COMPRESSION_LEVEL, 19)?;
        let first = frame_of(&mut cctx, &[&src])?;
        frame_of(&mut cctx, &[src.sub(..src.len() / 30)?])?;
        assert_eq!(frame_of(&mut cctx, &[&src])?, first);
        assert_eq!(decompress_alloc(&first), Ok(src));
        Ok(())
    }

    #[test]
    fn long_matches_in_a_dictionary_are_appended() -> Result<()> {
        let mut state = 7u32;
        let mut noise = move |len: usize| -> Vec<u8> {
            (0..len)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    (state >> 8) as u8
                })
                .collect()
        };
        // Miri takes long to load a dictionary. A block that is let to write 4 KB or less has that zeroed at once.
        let unit = if cfg!(miri) { 1000 } else { 4000 };
        let dict = noise(3 * unit);
        // A match in the dictionary, one from there into the output, and one in the output.
        let first = [&noise(20), dict.sub(unit / 2..unit / 2 + unit)?].concat();
        let pieces = [
            &first,
            &[&noise(20), dict.sub(100..100 + unit)?].concat(),
            &[
                &noise(20),
                dict.sub(3 * unit - unit / 2..)?,
                first.sub(..unit / 2)?,
            ]
            .concat(),
            &[&noise(20), first.sub(100..unit)?, &noise(30)].concat(),
        ];
        let src = pieces.map(|piece| &**piece).concat();
        let mut cctx = CCtx::new();
        cctx.load_dictionary(&dict)?;
        let frame = frame_of(&mut cctx, &pieces.map(|piece| &**piece))?;
        assert!(frame.len() < 200);

        let ddict = DDict::by_reference(&dict)?;
        let step = if cfg!(miri) { 997 } else { 1 };
        for capacity in
            (0..src.len())
                .step_by(step)
                .chain([src.len(), src.len() + 32, src.len() + 8192])
        {
            let mut there = vec![0; capacity];
            let written = DCtx::new().decompress_using_ddict(&mut there, &frame, &ddict);
            let appended = DCtx::new().decompress_to_vec(capacity, &frame, Some(&ddict));
            assert_eq!(appended.as_ref().map(Vec::len), written.as_ref().copied());
            assert_eq!(
                appended.is_ok_and(|appended| appended == src),
                capacity >= src.len()
            );
        }
        Ok(())
    }

    #[test]
    fn output_that_is_appended_is_what_output_that_is_there_is() -> Result<()> {
        let mut state = 1u32;
        let mut random = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state >> 8
        };
        let block =
            |last: u32, kind: u32, size: u32| ((size << 3 | kind << 1 | last).to_le_bytes(), 3);
        // Blocks that are stored and blocks of one byte, with a window of 1 KB.
        let mut stored = vec![0x28, 0xB5, 0x2F, 0xFD, 0x00, 0x00];
        for (last, kind, size, content) in
            [(0, 0, 300, 300), (0, 1, 500, 1), (0, 0, 0, 0), (1, 0, 9, 9)]
        {
            let (header, len) = block(last, kind, size);
            stored.extend_from_slice(header.sub(..len)?);
            stored.extend((0..content).map(|_| random() as u8));
        }
        let frame = |src: &[u8]| compress_alloc(src, 3);
        // Miri takes long for literals and sequences, and no time for long matches. A block that is let to write 4 KB or
        // less has that zeroed at once.
        let scale = if cfg!(miri) { 5 } else { 1 };
        let period: Vec<u8> = (0..700 / scale).map(|_| random() as u8).collect();
        let mut periods: Vec<u8> = period.iter().cycle().take(9000).copied().collect();
        periods.extend((0..40).map(|_| random() as u8));
        let few_sequences = frame(&periods)?;
        // The same in blocks of 1 KB, which go on with the offsets of the blocks before.
        let mut cctx = CCtx::new();
        cctx.set_parameter(c_param::WINDOW_LOG, 10)?;
        let small_blocks = frame_of(&mut cctx, &[&periods])?;
        let run = frame(&[b'r'; 9000])?;
        let only_literals = frame(
            &(0..4300)
                .map(|_| (random() % 16 * (random() % 3)) as u8)
                .collect::<Vec<u8>>(),
        )?;
        let words = [&b"one "[..], b"three ", b"four ", b"seven ", b"eleven "];
        let many_sequences = frame(
            &(0..900 / scale)
                .flat_map(|_| *words.get(random() as usize % 5).unwrap_or(&&b""[..]))
                .copied()
                .collect::<Vec<u8>>(),
        )?;

        let same = |frames: &[u8], capacity: usize| {
            let mut there = vec![0; capacity];
            let written = DCtx::new().decompress(&mut there, frames);
            let appended = DCtx::new().decompress_to_vec(capacity, frames, None);
            assert_eq!(
                appended.as_ref().map(Vec::len),
                written.as_ref().copied(),
                "{capacity}"
            );
            assert!(
                appended.is_ok_and(|appended| Some(&*appended) == there.get(..appended.len()))
                    || written.is_err()
            );
            written
        };
        let orders = [
            [
                &many_sequences,
                &stored,
                &few_sequences,
                &run,
                &small_blocks,
                &only_literals,
            ],
            [
                &only_literals,
                &small_blocks,
                &run,
                &stored,
                &many_sequences,
                &few_sequences,
            ],
        ];
        for order in orders.iter().take(if cfg!(miri) { 1 } else { 2 }) {
            let frames = order.map(|frame| &**frame).concat();
            let size = same(&frames, 1 << 16)?;
            let (step, around) = if cfg!(miri) { (size, 1) } else { (7, 40) };
            for capacity in (0..size).step_by(step).chain(size - around..size + around) {
                assert_eq!(same(&frames, capacity).is_ok(), capacity >= size);
            }
            let step = if cfg!(miri) { 8 * frames.len() / 3 } else { 1 };
            for bit in (0..8 * frames.len()).skip(step / 2).step_by(step) {
                let mut damaged = frames.clone();
                if let Some(byte) = damaged.get_mut(bit / 8) {
                    *byte ^= 1 << (bit % 8);
                }
                let _ = same(&damaged, size + OUTPUT_SLACK);
                let _ = same(&damaged, size + 8192);
            }
        }
        Ok(())
    }
}
