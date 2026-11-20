//! Header blocks (RFC 9113 §4.3): reassembly from HEADERS or PUSH_PROMISE and CONTINUATION frames, and outbound staging.

use super::frame::{FrameHeader, FrameType};
use super::settings::DEFAULT_MAX_FRAME_SIZE;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeaderBlockError {
    TooManyContinuations,
    TooLarge,
}

/// At most one block is open per connection. A small buffer keeps its capacity between blocks.
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

    pub fn capacity(&self) -> usize {
        self.block.capacity()
    }

    /// Takes the complete block. Hand the buffer back with `recycle`.
    pub fn take(&mut self) -> Vec<u8> {
        debug_assert_eq!(self.open_on, 0);
        core::mem::take(&mut self.block)
    }

    /// Drops a buffer that outgrew one frame of the default size, so a large block doesn't keep its size for the life of the connection.
    pub fn recycle(&mut self, mut block: Vec<u8>) {
        if block.capacity() <= DEFAULT_MAX_FRAME_SIZE as usize {
            block.clear();
            self.block = block;
        }
    }
}

/// The fields of an outbound header block, staged until all of them are known.
#[derive(Default)]
pub struct HeaderFields {
    /// Each name followed by its value, in field order.
    bytes: Vec<u8>,
    /// Two entries per field: the name length with `never_index` in bit 31, then the value length.
    fields: Vec<u32>,
}

impl HeaderFields {
    const NEVER_INDEX: u32 = 1 << 31;

    pub fn push(
        &mut self,
        name: &[u8],
        value: &[u8],
        never_index: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        // Treat a length that overflows its entry like a failed allocation.
        let (Ok(name_len), Ok(value_len)) = (u32::try_from(name.len()), u32::try_from(value.len()))
        else {
            return Err(bun_alloc::AllocError);
        };
        if name_len >= Self::NEVER_INDEX {
            return Err(bun_alloc::AllocError);
        }
        self.bytes
            .try_reserve(name.len() + value.len())
            .map_err(|_| bun_alloc::AllocError)?;
        self.fields
            .try_reserve(2)
            .map_err(|_| bun_alloc::AllocError)?;
        self.bytes.extend_from_slice(name);
        self.bytes.extend_from_slice(value);
        self.fields.push(if never_index {
            name_len | Self::NEVER_INDEX
        } else {
            name_len
        });
        self.fields.push(value_len);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.bytes.clear();
        self.fields.clear();
    }

    /// Name, value and `never_index`.
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8], bool)> {
        let mut rest = self.bytes.as_slice();
        let fields = self.fields.as_chunks::<2>().0;
        fields.iter().map(move |&[name_len, value_len]| {
            let (name, value);
            (name, rest) = rest.split_at((name_len & !Self::NEVER_INDEX) as usize);
            (value, rest) = rest.split_at(value_len as usize);
            (name, value, name_len & Self::NEVER_INDEX != 0)
        })
    }

    /// Value of the first field named `name`.
    pub fn get(&self, name: &[u8]) -> Option<&[u8]> {
        self.iter()
            .find_map(|(field_name, value, _)| (field_name == name).then_some(value))
    }

    /// Number of fields.
    pub fn len(&self) -> usize {
        self.fields.len() / 2
    }

    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    /// Heap bytes retained after `clear()`.
    pub fn capacity(&self) -> usize {
        self.bytes.capacity() + self.fields.capacity() * core::mem::size_of::<u32>()
    }

    /// https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_hd.c#L1578-L1603
    pub fn deflate_bound(&self) -> usize {
        12 + 12 * self.len() + self.bytes.len()
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
    fn only_a_small_buffer_is_kept() {
        let mut assembler = HeaderBlockAssembler::default();
        assembler.begin(1, &[0; 100], true);
        let block = assembler.take();
        assembler.recycle(block);
        assert!(assembler.capacity() >= 100);
        assembler.begin(3, &[0; DEFAULT_MAX_FRAME_SIZE as usize + 1], true);
        let block = assembler.take();
        assembler.recycle(block);
        assert_eq!(assembler.capacity(), 0);
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
