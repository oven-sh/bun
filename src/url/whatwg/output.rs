use bun_engine_text::{AllocError, MAX_LENGTH};

use crate::buffer::Buffer;

/// A serialization in the making: `head`, then `body`, then the input from `pending` up to where the parser is. What
/// the parser leaves as it is gets copied once, into the result, or not at all.
pub(crate) struct Output<'a> {
    head: &'a [u8],
    body: Buffer,
    input: &'a [u8],
    pending: usize,
}

impl<'a> Output<'a> {
    #[inline]
    pub(crate) fn new(input: &'a [u8]) -> Output<'a> {
        Output {
            head: &[],
            body: Buffer::new(),
            input,
            pending: 0,
        }
    }

    /// Whether `head` and the input are together no longer than a string, or a position might not fit in 32 bits.
    #[inline]
    pub(crate) fn has_room_for(&self, head: &[u8]) -> bool {
        head.len() + self.input.len() <= MAX_LENGTH
    }

    /// Puts `head` in place of the input before `at`. Nothing has been written yet.
    #[inline]
    pub(crate) fn start_with(&mut self, head: &'a [u8], at: usize) {
        debug_assert!(self.body.is_empty());
        self.head = head;
        self.pending = at;
    }

    /// Where the byte at `at` of the input lands if nothing before it changes.
    #[inline]
    pub(crate) fn position(&self, at: usize) -> usize {
        self.head.len() + self.body.len() + (at - self.pending)
    }

    /// The buffer in which to write what stands for the input from `at` up to the next [`Self::resume`].
    #[inline]
    pub(crate) fn interrupt(&mut self, at: usize) -> Result<&mut Buffer, AllocError> {
        if at > self.pending {
            self.body.extend(&self.input[self.pending..at])?;
            self.pending = at;
        }
        Ok(&mut self.body)
    }

    #[inline]
    pub(crate) fn resume(&mut self, at: usize) {
        self.pending = at;
    }

    #[inline]
    pub(crate) fn replace(
        &mut self,
        start: usize,
        end: usize,
        bytes: &[u8],
    ) -> Result<(), AllocError> {
        self.interrupt(start)?.extend(bytes)?;
        self.resume(end);
        Ok(())
    }

    /// The byte at a position that the parser has passed.
    pub(crate) fn byte(&self, position: usize) -> u8 {
        let Some(position) = position.checked_sub(self.head.len()) else {
            return self.head[position];
        };
        match position.checked_sub(self.body.len()) {
            None => self.body[position],
            Some(position) => self.input[self.pending + position],
        }
    }

    /// Of an interrupted output that ends with a slash: drops what follows the slash before that one, if there is one
    /// at or after `floor`.
    pub(crate) fn drop_last_segment(&mut self, floor: usize) {
        let body_floor = floor.saturating_sub(self.head.len());
        if let Some((_, written)) = self.body.split_last() {
            if let Some(slash) = bun_highway::last_index_of_slash(&written[body_floor..]) {
                return self.body.truncate(body_floor + slash + 1);
            }
        }
        let end = self.head.len() - usize::from(self.body.is_empty());
        let segments = self.head.get(floor..end).unwrap_or_default();
        if let Some(slash) = bun_highway::last_index_of_slash(segments) {
            self.body.truncate(0);
            self.head = &self.head[..floor + slash + 1];
        }
    }

    /// Everything up to `at`, in one buffer.
    pub(crate) fn flatten(&mut self, at: usize) -> Result<&mut Buffer, AllocError> {
        let head = core::mem::take(&mut self.head);
        let body = self.interrupt(at)?;
        body.insert(0, head)?;
        Ok(body)
    }

    #[inline]
    pub(crate) fn is_input(&self) -> bool {
        self.pending == 0 && self.head.is_empty() && self.body.is_empty()
    }

    /// What to concatenate once the parser has got to `end`.
    #[inline]
    pub(crate) fn pieces(&self, end: usize) -> [&[u8]; 3] {
        [self.head, &self.body, &self.input[self.pending..end]]
    }
}
