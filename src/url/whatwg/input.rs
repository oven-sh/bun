use core::mem::MaybeUninit;

use bun_engine_text::{AllocError, Cursor, MAX_LENGTH, StringImpl, StringRef, Text};
use bun_highway::url::narrow_to_latin1;
use bun_simdutf_sys::simdutf;

use crate::Error;
use crate::buffer::Buffer;
use crate::class::{self, CONTROL_SCAN, TAB_OR_NEWLINE};

/// What to parse.
#[derive(Clone, Copy)]
pub enum Input<'a> {
    /// A URL that serializes to the same Latin-1 characters shares the string.
    String(&'a StringImpl),
    Text(Text<'a>),
    /// What is not well formed stands for U+FFFD.
    Utf8(&'a [u8]),
}

impl<'a> From<&'a StringImpl> for Input<'a> {
    #[inline]
    fn from(string: &'a StringImpl) -> Input<'a> {
        Input::String(string)
    }
}

impl<'a> From<&'a StringRef> for Input<'a> {
    #[inline]
    fn from(string: &'a StringRef) -> Input<'a> {
        Input::String(string)
    }
}

impl<'a> From<Text<'a>> for Input<'a> {
    #[inline]
    fn from(text: Text<'a>) -> Input<'a> {
        Input::Text(text)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Encoding {
    Latin1,
    Utf8,
    /// May not be well formed.
    UncheckedUtf8,
}

/// Text of a byte for each ASCII character, which is what the parser reads.
#[derive(Clone, Copy)]
pub(crate) struct Source<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) encoding: Encoding,
}

impl<'a> Source<'a> {
    #[inline]
    pub(crate) fn new(bytes: &'a [u8], encoding: Encoding) -> Source<'a> {
        Source { bytes, encoding }
    }

    #[inline]
    pub(crate) fn with_bytes<'b>(self, bytes: &'b [u8]) -> Source<'b> {
        Source::new(bytes, self.encoding)
    }

    #[inline]
    pub(crate) fn is_well_formed(self) -> bool {
        self.encoding != Encoding::UncheckedUtf8
            || self.bytes.is_ascii()
            || simdutf::validate::utf8(self.bytes)
    }

    /// Without leading and trailing C0 control or space.
    #[inline]
    pub(crate) fn trimmed(self) -> Source<'a> {
        let mut bytes = self.bytes;
        while let [0..=b' ', rest @ ..] | [rest @ .., 0..=b' '] = bytes {
            bytes = rest;
        }
        self.with_bytes(bytes)
    }

    pub(crate) fn has_tab_or_newline(self) -> bool {
        let mut candidates = CONTROL_SCAN.scan(self.bytes, 0);
        candidates.any(|at| class::is_in(TAB_OR_NEWLINE, self.bytes[at]))
    }

    /// Runs what fails on a tab or a newline, and again without them if it has.
    #[inline(always)]
    pub(crate) fn retry_without_tab_or_newline<T>(
        self,
        mut attempt: impl FnMut(Source<'_>) -> crate::Result<T>,
    ) -> crate::Result<T> {
        match attempt(self) {
            Err(Error::Invalid) if self.has_tab_or_newline() => {
                attempt(self.without_tab_or_newline(&mut Buffer::new())?)
            }
            outcome => outcome,
        }
    }

    #[cold]
    pub(crate) fn without_tab_or_newline(
        self,
        storage: &mut Buffer,
    ) -> Result<Source<'_>, AllocError> {
        for &byte in self.bytes {
            if !class::is_in(TAB_OR_NEWLINE, byte) {
                storage.push(byte)?;
            }
        }
        Ok(self.with_bytes(storage))
    }
}

/// Holds what had to be converted to become a [`Source`].
pub(crate) struct Transcoder {
    inline: [MaybeUninit<u8>; Transcoder::INLINE_CAPACITY],
    heap: Vec<u8>,
}

impl Transcoder {
    const INLINE_CAPACITY: usize = 768;

    #[inline]
    pub(crate) fn new() -> Transcoder {
        Transcoder {
            inline: [const { MaybeUninit::uninit() }; Transcoder::INLINE_CAPACITY],
            heap: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn source<'a>(&'a mut self, text: Text<'a>) -> Result<Source<'a>, AllocError> {
        match text {
            Text::Latin1(characters) => Ok(Source::new(characters, Encoding::Latin1)),
            Text::Utf16(units) => self.encode(units),
        }
    }

    /// A lone surrogate becomes U+FFFD.
    #[inline(never)]
    fn encode(&mut self, units: &[u16]) -> Result<Source<'_>, AllocError> {
        if let Some(characters) = narrow_to_latin1(units, &mut self.inline) {
            return Ok(Source::new(characters, Encoding::Latin1));
        }
        let text = Text::Utf16(units);
        let bytes = if text.len() <= Transcoder::INLINE_CAPACITY / 3 {
            Cursor::fill_uninit(&mut self.inline, |cursor| {
                text.write_utf8(cursor);
            })
        } else {
            self.heap = text.try_to_utf8()?;
            self.converted_on_heap()?
        };
        Ok(Source::new(bytes, Encoding::Utf8))
    }

    fn converted_on_heap(&self) -> Result<&[u8], AllocError> {
        if self.heap.len() > MAX_LENGTH {
            return Err(AllocError);
        }
        Ok(&self.heap)
    }

    /// Each maximal invalid sequence becomes U+FFFD.
    pub(crate) fn well_formed<'a>(
        &'a mut self,
        source: Source<'a>,
    ) -> Result<Source<'a>, AllocError> {
        if source.is_well_formed() {
            return Ok(source);
        }
        self.heap = StringRef::try_from_utf8_lossy(source.bytes)?
            .text()
            .try_to_utf8()?;
        Ok(Source::new(self.converted_on_heap()?, Encoding::Utf8))
    }
}
