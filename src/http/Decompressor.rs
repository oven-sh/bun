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
    /// `Content-Encoding: deflate` with only one body byte delivered so far.
    /// Holds that byte until a second arrives so the RFC 1950 zlib-header
    /// sniff (which needs both CMF and FLG) can decide zlib-wrapped vs raw.
    PendingDeflate(u8),
    #[default]
    None,
}

/// RFC 1950 §2.2 zlib header: CMF low nibble = 8 (deflate), high nibble <= 7
/// (window), and big-endian CMF|FLG is a multiple of 31. RFC 9110 §8.4.1.2
/// says `Content-Encoding: deflate` is zlib-wrapped; some origins send raw.
fn is_zlib_header(chunk: &[u8]) -> bool {
    match *chunk {
        [b0, b1, ..] => {
            (b0 & 0x0f) == 8 && (b0 >> 4) <= 7 && ((u16::from(b0) << 8) | u16::from(b1)) % 31 == 0
        }
        _ => false,
    }
}

impl Decompressor {
    // Note: each variant's `Drop` releases the underlying C state, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    fn init(&mut self, encoding: Encoding, first_chunk: &[u8]) -> crate::Result<()> {
        match encoding {
            Encoding::Gzip | Encoding::Deflate => {
                // zlib.MAX_WBITS = 15
                // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                // to (de-)compress deflate format with headers we use wbits = 0 (auto-detect window from header)
                // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                let window_bits = if encoding == Encoding::Gzip {
                    bun_zlib::MAX_WBITS | 16
                } else if is_zlib_header(first_chunk) {
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
    ) -> crate::Result<()> {
        if !encoding.is_compressed() {
            return Ok(());
        }

        // If the first deflate body segment was a single byte, it was stashed
        // in PendingDeflate; prepend it now so init() can sniff the 2-byte
        // zlib header. This path runs at most once per response.
        let mut prefixed;
        let buffer = if let Decompressor::PendingDeflate(b0) = *self {
            prefixed = Vec::with_capacity(1 + buffer.len());
            prefixed.push(b0);
            prefixed.extend_from_slice(buffer);
            *self = Decompressor::None;
            prefixed.as_slice()
        } else {
            buffer
        };

        if matches!(self, Decompressor::None) {
            if encoding == Encoding::Deflate && buffer.len() < 2 && !is_done {
                if let &[b0] = buffer {
                    *self = Decompressor::PendingDeflate(b0);
                }
                return Err(bun_core::err!("ShortRead"));
            }
            self.init(encoding, buffer)?;
        }
        let out = &mut body_out_str.list;
        match self {
            Decompressor::Zlib(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::Brotli(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::Zstd(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::None | Decompressor::PendingDeflate(_) => {
                unreachable!("Invalid encoding. This code should not be reachable")
            }
        }
    }
}
