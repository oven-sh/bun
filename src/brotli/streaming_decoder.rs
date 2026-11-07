use bun_core::compress::State;

use crate::{Decoder, DecoderResult, Error, SpareCapacity};

/// A [`Decoder`] that appends to a `Vec`. It refuses large windows, which `Content-Encoding: br` does not have.
pub struct StreamingDecoder {
    decoder: Decoder,
    state: State,
}

impl Default for StreamingDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamingDecoder {
    pub fn new() -> Self {
        Self {
            decoder: Decoder::new(),
            state: State::Uninitialized,
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
    ) -> crate::Result<usize> {
        if matches!(self.state, State::End | State::Error) {
            return Ok(input.len());
        }

        let mut rest = input;
        loop {
            if out.len() >= max_output {
                return Ok(input.len() - rest.len());
            }
            if out.try_reserve(4096).is_err() {
                self.state = State::Error;
                return Err(Error::OutOfMemory);
            }
            let before = out.len();
            match self
                .decoder
                .decompress_stream(&mut rest, &mut SpareCapacity::new(out, max_output))
            {
                DecoderResult::Success => {
                    self.state = State::End;
                    return Ok(input.len());
                }
                DecoderResult::Error => {
                    self.state = State::Error;
                    return Err(if self.decoder.error_code().is_alloc_failure() {
                        Error::OutOfMemory
                    } else {
                        Error::BrotliDecompressionError
                    });
                }
                DecoderResult::NeedsMoreInput => {
                    self.state = State::Inflating;
                    // That is the result even with output left in the ring buffer.
                    if out.len() > before && self.decoder.has_more_output() {
                        continue;
                    }
                    if is_done {
                        self.state = State::Error;
                        return Err(Error::BrotliDecompressionError);
                    }
                    return Err(Error::ShortRead);
                }
                DecoderResult::NeedsMoreOutput => self.state = State::Inflating,
            }
        }
    }
}
