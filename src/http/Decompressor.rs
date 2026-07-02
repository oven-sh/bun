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

impl Decompressor {
    // Note: each variant's `Drop` releases the underlying C state, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    fn init(&mut self, encoding: Encoding, first_chunk: &[u8]) -> crate::Result<()> {
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
        if matches!(self, Decompressor::None) {
            self.init(encoding, buffer)?;
        }
        let out = &mut body_out_str.list;
        match self {
            Decompressor::Zlib(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::Brotli(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::Zstd(reader) => Ok(reader.decompress(buffer, out, is_done)?),
            Decompressor::None => {
                unreachable!("Invalid encoding. This code should not be reachable")
            }
        }
    }
}

/// Streaming decoder pipeline for the response's whole `Content-Encoding`
/// chain. `Content-Encoding: br, gzip` means brotli was applied first and
/// gzip last, so the wire bytes are gunzipped first and that output is then
/// brotli-decoded: codings decode in the reverse of the listed order
/// (RFC 9110 section 8.4).
#[derive(Default)]
pub struct DecompressorChain {
    /// One streaming decoder per coding; index 0 decodes the last-listed
    /// (outermost) coding. Each is created lazily by
    /// [`Decompressor::decompress_chunk`] on the first bytes it sees, which
    /// the deflate decoder relies on to sniff raw-vs-zlib framing.
    stages: Vec<Decompressor>,
    /// Ping-pong buffers carrying stage `i`'s output to stage `i + 1` when
    /// there is more than one coding; reused across body chunks.
    scratch: [MutableString; 2],
}

impl DecompressorChain {
    /// Feed one body chunk through every coding, appending the fully decoded
    /// bytes to `body_out_str`. `codings` is the `Content-Encoding` list in
    /// the order the codings were applied; it must be non-empty and the same
    /// on every call for a given response.
    pub fn decompress_chunk(
        &mut self,
        codings: &[Encoding],
        buffer: &[u8],
        body_out_str: &mut MutableString,
        is_done: bool,
    ) -> crate::Result<()> {
        // Callers only decompress when `ContentCodings::is_compressed()`.
        let Some(last) = codings.len().checked_sub(1) else {
            debug_assert!(false, "decompress_chunk requires at least one coding");
            return Ok(());
        };
        if self.stages.is_empty() {
            self.stages
                .resize_with(codings.len(), Decompressor::default);
        }
        debug_assert_eq!(self.stages.len(), codings.len());

        if let ([stage], &[coding]) = (self.stages.as_mut_slice(), codings) {
            return stage.decompress_chunk(coding, buffer, body_out_str, is_done);
        }
        let [ping, pong] = &mut self.scratch;
        let (mut stage_in, mut stage_out): (&mut MutableString, &mut MutableString) = (ping, pong);
        for (i, (&coding, stage)) in codings.iter().rev().zip(self.stages.iter_mut()).enumerate() {
            let input: &[u8] = if i == 0 { buffer } else { &stage_in.list };
            // A stage that never received a byte has produced none for the
            // stages after it either, so there is nothing left to do for
            // this chunk. With `is_done` this is the "response declared a
            // Content-Encoding but the stream decoded to zero bytes" case,
            // which the single-coding path also treats as an empty body
            // rather than a truncated stream.
            if input.is_empty() && matches!(stage, Decompressor::None) {
                return Ok(());
            }
            let result = if i == last {
                stage.decompress_chunk(coding, input, body_out_str, is_done)
            } else {
                stage_out.list.clear();
                stage.decompress_chunk(coding, input, stage_out, is_done)
            };
            match result {
                Ok(()) => {}
                // This layer needs more input before it can make progress.
                // Not an error while the body is still streaming in, and
                // whatever it did decode is already in its output buffer for
                // the next layer to consume.
                Err(crate::Error::ShortRead) if !is_done => {}
                Err(err) => return Err(err),
            }
            if i != last {
                core::mem::swap(&mut stage_in, &mut stage_out);
            }
        }
        Ok(())
    }
}
