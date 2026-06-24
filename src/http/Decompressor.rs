use bun_core::MutableString;
use bun_http_types::Encoding::Encoding;

/// Compression-bomb guard: cap on bytes the response decoder may write into
/// the body buffer. 0 (via `BUN_CONFIG_MAX_HTTP_DECOMPRESSED_SIZE`) disables
/// the cap; default 2 GB matches the package-install tarball limit.
pub(crate) fn max_decompressed_body_size() -> usize {
    match bun_core::env_var::BUN_CONFIG_MAX_HTTP_DECOMPRESSED_SIZE
        .get()
        .expect("declared with a default")
    {
        0 => usize::MAX,
        n => usize::try_from(n).unwrap_or(usize::MAX),
    }
}

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

impl Decompressor {
    // Note: each variant's `Drop` releases the underlying C state, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    fn init(&mut self, encoding: Encoding, first_chunk: &[u8]) -> Result<(), bun_core::Error> {
        let max_output_size = max_decompressed_body_size();
        match encoding {
            Encoding::Gzip | Encoding::Deflate => {
                // zlib.MAX_WBITS = 15
                // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                let window_bits = if encoding == Encoding::Gzip {
                    bun_zlib::MAX_WBITS | 16
                } else if first_chunk.len() > 1 && first_chunk[0] == 120 {
                    0
                } else {
                    -bun_zlib::MAX_WBITS
                };
                let mut reader = bun_zlib::InflateDecoder::new(window_bits)?;
                reader.max_output_size = max_output_size;
                *self = Decompressor::Zlib(reader);
            }
            Encoding::Brotli => {
                let mut reader = bun_brotli::StreamingDecoder::new(&Default::default())?;
                reader.max_output_size = max_output_size;
                *self = Decompressor::Brotli(Box::new(reader));
            }
            Encoding::Zstd => {
                let mut reader = bun_zstd::StreamingDecoder::new()?;
                reader.max_output_size = max_output_size;
                *self = Decompressor::Zstd(Box::new(reader));
            }
            _ => unreachable!("Invalid encoding. This code should not be reachable"),
        }
        Ok(())
    }

    /// Feed one body chunk `buffer` through the decoder, appending the
    /// decompressed output to `body_out_str`. Creates the decoder on first
    /// call. Returns `ShortRead` when more input is needed and the stream is
    /// not yet done.
    pub fn decompress_chunk(
        &mut self,
        encoding: Encoding,
        buffer: &[u8],
        body_out_str: &mut MutableString,
        is_done: bool,
    ) -> Result<(), bun_core::Error> {
        if !encoding.is_compressed() {
            return Ok(());
        }
        if matches!(self, Decompressor::None) {
            self.init(encoding, buffer)?;
        }
        let out = &mut body_out_str.list;
        match self {
            Decompressor::Zlib(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::Brotli(reader) => reader.decompress(buffer, out, is_done),
            Decompressor::Zstd(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::None => {
                unreachable!("Invalid encoding. This code should not be reachable")
            }
        }
    }
}
