use core::mem::MaybeUninit;

use bun_engine_text::Text;

use crate::{Error, Result};

/// Room for text in the width that ICU reads.
pub(crate) struct Utf16Buffer {
    stack: [MaybeUninit<u16>; 128],
    heap: Vec<u16>,
}

impl Utf16Buffer {
    #[inline]
    pub(crate) fn new() -> Utf16Buffer {
        Utf16Buffer {
            stack: [MaybeUninit::uninit(); _],
            heap: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn widen<'a>(&'a mut self, text: Text<'a>) -> Result<&'a [u16]> {
        let characters = match text {
            Text::Latin1(characters) => characters,
            Text::Utf16(units) => return Ok(units),
        };
        if let Some(stack) = self.stack.get_mut(..characters.len()) {
            return Ok(stack.write_with(|index| characters[index].into()));
        }
        (self.heap.try_reserve_exact(characters.len())).map_err(|_| Error::OutOfMemory)?;
        (self.heap).extend(characters.iter().map(|&character| u16::from(character)));
        Ok(&self.heap)
    }
}
