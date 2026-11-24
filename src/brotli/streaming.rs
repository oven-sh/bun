use crate::{DecodeStatus, Decoder, Error, Result};
use bun_core::vec::append_with;

const MIN_OUTPUT_ROOM: usize = 4096;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum State {
    #[default]
    NotStarted,
    Inflating,
    Finished,
    Failed(Error),
}

/// Decodes a body that arrives in chunks.
#[derive(Default)]
pub struct StreamingDecoder {
    decoder: Decoder,
    state: State,
}

impl StreamingDecoder {
    #[inline]
    pub fn is_inflating(&self) -> bool {
        self.state == State::Inflating
    }

    /// Returns how much of `input` it used, which is not all of it only if `out.len()` reached `max_output`.
    pub fn decompress(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max_output: usize,
        is_done: bool,
    ) -> Result<usize> {
        match self.state {
            State::NotStarted | State::Inflating => {}
            State::Finished => return Ok(input.len()),
            State::Failed(error) => return Err(error),
        }
        let mut rest = input;
        let error = loop {
            if out.len() >= max_output {
                return Ok(input.len() - rest.len());
            }
            if out.try_reserve(MIN_OUTPUT_ROOM).is_err() {
                break Error::OutOfMemory;
            }
            let status = append_with(out, max_output - out.len(), |output| {
                self.decoder.decompress(&mut rest, output)
            });
            self.state = State::Inflating;
            match status {
                Ok(DecodeStatus::Finished) => {
                    self.state = State::Finished;
                    return Ok(input.len());
                }
                Ok(DecodeStatus::NeedsOutput) => {}
                Ok(DecodeStatus::NeedsInput) if self.decoder.has_more_output() => {}
                Ok(DecodeStatus::NeedsInput) if !is_done => return Err(Error::ShortRead),
                Err(error) if error.is_out_of_memory() => break Error::OutOfMemory,
                Ok(DecodeStatus::NeedsInput) | Err(_) => break Error::BrotliDecompressionError,
            }
        };
        self.state = State::Failed(error);
        Err(error)
    }
}
