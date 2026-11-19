use bun_core::MutableString;
use bun_http_types::Encoding::Encoding;
use bun_zlib::inflate::{Container, Status, has_zlib_header};
use bun_zlib::{GZIP_ID, Inflater};

// The streaming decoders below own only their codec state and take
// `(input, output)` per call to [`Decompressor::decompress_chunk`], so no
// borrow of the request's `compressed_body` / `body_out_str` escapes the
// call.
#[derive(Default)]
pub enum Decompressor {
    Zlib(Box<ZlibDecoder>),
    Brotli(Box<bun_brotli::StreamingDecoder>),
    Zstd(Box<bun_zstd::StreamingDecoder>),
    #[default]
    None,
}

pub struct ZlibDecoder {
    inflater: Inflater,
    state: ZlibState,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ZlibState {
    Inflating,
    /// Another gzip member may follow (RFC 1952 §2.2).
    StreamEnd,
    /// Behind an error, or in the stray bytes that some origins append.
    IgnoringRest,
}

impl ZlibDecoder {
    fn decompress(
        &mut self,
        mut input: &[u8],
        out: &mut Vec<u8>,
        max_output: usize,
        is_done: bool,
    ) -> crate::Result<usize> {
        let input_len = input.len();
        loop {
            if self.state == ZlibState::StreamEnd && !input.is_empty() {
                if self.inflater.container() == Container::Gzip && input[0] == GZIP_ID[0] {
                    self.inflater.reset();
                    self.state = ZlibState::Inflating;
                } else {
                    self.state = ZlibState::IgnoringRest;
                }
            }
            if self.state != ZlibState::Inflating {
                return Ok(input_len);
            }
            let room = max_output.saturating_sub(out.len());
            if room == 0 {
                return Ok(input_len - input.len());
            }
            let error = match self.inflater.inflate_to_vec(&mut input, out, room) {
                Ok(Status::StreamEnd) => {
                    self.state = ZlibState::StreamEnd;
                    continue;
                }
                Ok(Status::NeedsInput | Status::NeedsOutput) if out.len() == max_output => continue,
                Ok(Status::NeedsInput) if !is_done => return Err(crate::Error::ShortRead),
                Ok(_) => crate::Error::Zlib,
                Err(error) => error.into(),
            };
            self.state = ZlibState::IgnoringRest;
            return Err(error);
        }
    }
}

impl Decompressor {
    // Note: each variant's `Drop` releases the codec state, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    /// Inside a stream: another `decompress_chunk` may produce output with no new input.
    pub(crate) fn is_mid_stream(&self) -> bool {
        match self {
            Decompressor::Zlib(r) => r.state == ZlibState::Inflating,
            Decompressor::Brotli(r) => r.is_inflating(),
            Decompressor::Zstd(r) => r.is_inflating(),
            Decompressor::None => false,
        }
    }

    fn init(
        &mut self,
        encoding: Encoding,
        body_start: &[u8],
        is_done: bool,
    ) -> crate::Result<bool> {
        match encoding {
            Encoding::Gzip | Encoding::Deflate => {
                let container = if encoding == Encoding::Gzip {
                    Container::Gzip
                } else if body_start.len() < 2 && !is_done {
                    return Ok(false);
                } else if has_zlib_header(body_start) {
                    Container::Zlib
                } else {
                    Container::Raw
                };
                *self = Decompressor::Zlib(Box::new(ZlibDecoder {
                    inflater: Inflater::new(container),
                    state: ZlibState::Inflating,
                }));
            }
            Encoding::Brotli => {
                if bun_removable_features::is_removed(
                    bun_removable_features::Feature::BrotliDecoder,
                ) {
                    return Err(bun_brotli::Error::BrotliFailedToLoad.into());
                }
                *self = Decompressor::Brotli(Box::default());
            }
            Encoding::Zstd => {
                *self = Decompressor::Zstd(Box::new(bun_zstd::StreamingDecoder::new()?));
            }
            _ => unreachable!("Invalid encoding. This code should not be reachable"),
        }
        Ok(true)
    }

    /// Feed one body chunk `buffer` through the decoder, appending the
    /// decompressed output to `body_out_str` until it holds `max_output` bytes. Creates the
    /// decoder on first call. Returns the input bytes consumed. Returns `ShortRead` when more
    /// input is needed and the stream is not yet done.
    /// Returns 0 and creates no decoder while a deflate body is too short to tell zlib from raw.
    pub(crate) fn decompress_chunk(
        &mut self,
        encoding: Encoding,
        buffer: &[u8],
        body_out_str: &mut MutableString,
        max_output: usize,
        is_done: bool,
    ) -> crate::Result<usize> {
        if !encoding.is_compressed() {
            return Ok(buffer.len());
        }
        if matches!(self, Decompressor::None) && !self.init(encoding, buffer, is_done)? {
            return Ok(0);
        }
        let out = &mut body_out_str.list;
        match self {
            Decompressor::Zlib(reader) => reader.decompress(buffer, out, max_output, is_done),
            Decompressor::Brotli(reader) => {
                Ok(reader.decompress(buffer, out, max_output, is_done)?)
            }
            Decompressor::Zstd(reader) => Ok(reader.decompress(buffer, out, max_output, is_done)?),
            Decompressor::None => {
                unreachable!("Invalid encoding. This code should not be reachable")
            }
        }
    }
}
