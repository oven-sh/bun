//! `charstr.h`, `bytesinkutil.h`: a `CharString` is a `Vec<u8>`.

use crate::common::arrayvec::ArrayVec;
use crate::common::memory::{Appendable, fail_on_oom, try_extend_from_slice, try_push, try_to_vec};
use crate::common::sink::TextSink;
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::append_invariant_chars;
use crate::common::uresdata::DataString;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};
use std::ffi::CStr;
use std::fmt::NumBuffer;

/// `CharString::append` for the caller's text: `U_ILLEGAL_ARGUMENT_ERROR` if the length with the NUL exceeds `int32_t`.
pub(crate) fn append_chars(chars: &mut Vec<u8>, s: &[u8]) -> Result<(), UErrorCode> {
    if chars.len() + s.len() >= i32::MAX as usize {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        try_extend_from_slice(chars, s)
    }
}

pub(crate) type ByteSink<'a> = dyn TextSink<u8> + 'a;

/// A `CharString` with inline storage.
pub(crate) struct SmallChars {
    inline: [u8; 64],
    /// The text is in `heap` if `len` exceeds the size of `inline`.
    len: usize,
    heap: Vec<u8>,
}

impl SmallChars {
    pub(crate) fn new() -> Self {
        Self {
            inline: [0; _],
            len: 0,
            heap: Vec::new(),
        }
    }

    pub(crate) fn of(text: &[u8]) -> Self {
        let mut chars = Self::new();
        chars.add_all(text);
        chars
    }

    /// Returns false if the length with the NUL exceeds `int32_t`.
    pub(crate) fn is_complete(&self) -> bool {
        self.len < i32::MAX as usize
    }

    fn add_to_heap(&mut self, text: &[u8]) {
        self.heap
            .add_all(self.inline.get(..self.len).unwrap_or_default());
        self.heap.add_all(text);
    }
}

impl Default for SmallChars {
    fn default() -> Self {
        Self::new()
    }
}

impl TextSink<u8> for SmallChars {}

impl Appendable<u8> for SmallChars {
    fn reserve_append(&mut self, additional: usize) -> Result<(), UErrorCode> {
        let length = self.len.saturating_add(additional);
        if length <= self.inline.len() {
            Ok(())
        } else {
            self.heap.reserve_append(length - self.heap.len())
        }
    }

    fn add(&mut self, unit: u8) {
        match self.inline.get_mut(self.len) {
            Some(slot) => *slot = unit,
            None => self.add_to_heap(&[unit]),
        }
        self.len = self.len.saturating_add(1);
    }

    fn add_all(&mut self, text: &[u8]) {
        match self
            .inline
            .get_mut(self.len..)
            .and_then(|spare| spare.get_mut(..text.len()))
        {
            Some(slots) => slots.copy_from_slice(text),
            None => self.add_to_heap(text),
        }
        self.len = self.len.saturating_add(text.len());
    }
}

impl std::ops::Deref for SmallChars {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        self.inline.get(..self.len).unwrap_or(&self.heap)
    }
}

/// The position of a string in a `CharStrings`.
#[derive(Clone, Copy, Default)]
pub(crate) struct Span {
    start: u32,
    end: u32,
}

/// Many short strings in one buffer, each followed by a NUL. Equal strings are stored each time.
#[derive(Default)]
pub(crate) struct CharStrings(Vec<u8>);

impl CharStrings {
    pub(crate) fn add(&mut self, text: &[u8]) -> Result<Span, UErrorCode> {
        let start = self.0.len();
        append_chars(&mut self.0, text)?;
        self.terminate(start)
    }

    /// Adds `text` up to its first NUL.
    pub(crate) fn add_invariant(&mut self, text: DataString) -> Result<Span, UErrorCode> {
        let start = self.0.len();
        append_invariant_chars(&mut self.0, text.until_nul().iter())?;
        self.terminate(start)
    }

    /// Both ways of appending keep the length below `i32::MAX`.
    fn terminate(&mut self, start: usize) -> Result<Span, UErrorCode> {
        let span = Span {
            start: start as u32,
            end: self.0.len() as u32,
        };
        try_push(&mut self.0, 0).map(|()| span)
    }

    pub(crate) fn get(&self, span: Span) -> &[u8] {
        self.0.slice(span.start as usize..span.end as usize)
    }

    pub(crate) fn get_c_str(&self, span: Span) -> &CStr {
        CStr::from_bytes_until_nul(self.0.slice(span.start as usize..)).unwrap_or_default()
    }
}

/// `ByteSinkUtil::viaByteSinkToCharString`
pub(crate) fn via_byte_sink(
    write: impl FnOnce(&mut ByteSink) -> Result<(), UErrorCode>,
) -> Result<Vec<u8>, UErrorCode> {
    fail_on_oom(|| {
        let mut chars = SmallChars::new();
        write(&mut chars)?;
        chars
            .inline
            .get(..chars.len)
            .map_or(Ok(chars.heap), try_to_vec)
    })
}

/// Returns the sign and the decimal digits. The `format_into` of signed types keeps a bounds check.
pub(crate) fn decimal(number: i64) -> ArrayVec<u8, 20> {
    let sign = (number < 0).then_some(b'-');
    ArrayVec::from_iter_truncated(
        sign.into_iter().chain(
            number
                .unsigned_abs()
                .format_into(&mut NumBuffer::new())
                .bytes(),
        ),
    )
}
