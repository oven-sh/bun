use bun_core::MutableString;
use bun_http_types::Encoding::Encoding;

// The streaming decoders below own only their C-side state and take
// `(input, output)` per call to [`Decompressor::decompress_chunk`], so no
// borrow of the request's `compressed_body` / `body_out_str` escapes the
// call.
#[derive(Default)]
pub enum Decompressor {
    Zlib(bun_zlib::InflateDecoder),
    Brotli(Box<bun_brotli::StreamingDecoder>),
    Zstd(Box<bun_zstd::StreamingDecoder>),
    #[default]
    None,
}

pub(crate) fn has_zlib_header(buffer: &[u8]) -> bool {
    let &[cmf, flg, ..] = buffer else {
        return false;
    };
    (cmf & 0x0f) == 8 && (cmf >> 4) <= 7 && u16::from_be_bytes([cmf, flg]).is_multiple_of(31)
}

impl Decompressor {
    // Note: each variant's `Drop` releases the underlying C state, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    /// Inside a stream: another `decompress_chunk` may produce output with no new input.
    pub(crate) fn is_mid_stream(&self) -> bool {
        match self {
            Decompressor::Zlib(r) => r.is_inflating(),
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
                let window_bits = if encoding == Encoding::Gzip {
                    bun_zlib::MAX_WBITS | 16
                } else if body_start.len() < 2 && !is_done {
                    return Ok(false);
                } else if has_zlib_header(body_start) {
                    0
                } else {
                    -bun_zlib::MAX_WBITS
                };
                *self = Decompressor::Zlib(bun_zlib::InflateDecoder::new(window_bits)?);
            }
            Encoding::Brotli => {
                *self = Decompressor::Brotli(Box::new(bun_brotli::StreamingDecoder::new(
                    &Default::default(),
                )?));
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
            Decompressor::Zlib(reader) => Ok(reader.decompress(buffer, out, max_output, is_done)?),
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
