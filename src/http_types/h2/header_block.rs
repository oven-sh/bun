//! Reassembly of a header block from HEADERS or PUSH_PROMISE and its CONTINUATION frames (RFC 9113 §4.3, §6.10).

use super::frame::{FrameHeader, FrameType};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeaderBlockError {
    TooManyContinuations,
    TooLarge,
}

/// At most one block is open per connection. The buffer keeps its capacity between blocks.
#[derive(Default)]
pub struct HeaderBlockAssembler {
    block: Vec<u8>,
    /// The stream whose CONTINUATION has to come next, or 0.
    open_on: u32,
    continuations: u32,
}

impl HeaderBlockAssembler {
    /// Returns false for a frame that can't come next. Call it for every frame, before any other check of it.
    pub fn admits(&self, header: &FrameHeader) -> bool {
        let is_continuation = header.frame_type == FrameType::Continuation as u8;
        if self.open_on == 0 {
            !is_continuation
        } else {
            is_continuation && header.stream_id == self.open_on
        }
    }

    /// Returns true between a frame without END_HEADERS and the CONTINUATION that has it.
    pub fn is_open(&self) -> bool {
        self.open_on != 0
    }

    /// Starts a block with the fragment of a HEADERS or PUSH_PROMISE on `stream_id`. Returns true if it's complete.
    pub fn begin(&mut self, stream_id: u32, fragment: &[u8], end_headers: bool) -> bool {
        debug_assert_eq!(self.open_on, 0);
        self.block.clear();
        self.block.extend_from_slice(fragment);
        self.continuations = 0;
        self.open_on = if end_headers { 0 } else { stream_id };
        end_headers
    }

    /// Appends the fragment of a CONTINUATION that `admits` let through. Returns true if the block is complete.
    pub fn push(
        &mut self,
        fragment: &[u8],
        end_headers: bool,
        max_continuations: u32,
        max_len: usize,
    ) -> Result<bool, HeaderBlockError> {
        self.continuations += 1;
        if self.continuations > max_continuations {
            return Err(HeaderBlockError::TooManyContinuations);
        }
        if self.block.len().saturating_add(fragment.len()) > max_len {
            return Err(HeaderBlockError::TooLarge);
        }
        self.block.extend_from_slice(fragment);
        if end_headers {
            self.open_on = 0;
        }
        Ok(end_headers)
    }

    /// Takes the complete block. Hand the buffer back with `recycle`.
    pub fn take(&mut self) -> Vec<u8> {
        debug_assert_eq!(self.open_on, 0);
        core::mem::take(&mut self.block)
    }

    pub fn recycle(&mut self, mut block: Vec<u8>) {
        block.clear();
        self.block = block;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(frame_type: FrameType, stream_id: u32) -> FrameHeader {
        FrameHeader::new(frame_type, 0, stream_id, 0)
    }

    #[test]
    fn a_block_in_one_frame() {
        let mut assembler = HeaderBlockAssembler::default();
        assert!(assembler.admits(&header(FrameType::Headers, 1)));
        assert!(assembler.begin(1, b"ab", true));
        assert!(assembler.admits(&header(FrameType::Data, 1)));
        assert_eq!(assembler.take(), b"ab");
    }

    #[test]
    fn only_its_continuation_follows_an_open_block() {
        let mut assembler = HeaderBlockAssembler::default();
        assert!(!assembler.admits(&header(FrameType::Continuation, 1)));
        assert!(!assembler.begin(1, b"ab", false));
        assert!(!assembler.admits(&header(FrameType::Headers, 1)));
        assert!(!assembler.admits(&header(FrameType::Ping, 0)));
        assert!(!assembler.admits(&header(FrameType::Continuation, 3)));
        assert!(assembler.admits(&header(FrameType::Continuation, 1)));
        assert_eq!(assembler.push(b"cd", false, 8, 100), Ok(false));
        assert_eq!(assembler.push(b"e", true, 8, 100), Ok(true));
        assert!(!assembler.admits(&header(FrameType::Continuation, 1)));
        assert_eq!(assembler.take(), b"abcde");
    }

    #[test]
    fn caps() {
        let mut assembler = HeaderBlockAssembler::default();
        assembler.begin(1, b"ab", false);
        assert_eq!(assembler.push(b"", false, 1, 100), Ok(false));
        assert_eq!(
            assembler.push(b"", false, 1, 100),
            Err(HeaderBlockError::TooManyContinuations)
        );
        assembler = HeaderBlockAssembler::default();
        assembler.begin(1, b"ab", false);
        assert_eq!(
            assembler.push(b"c", true, 8, 2),
            Err(HeaderBlockError::TooLarge)
        );
    }
}
