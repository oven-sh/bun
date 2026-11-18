//! UAX #29, with dictionaries for the words of scripts that have no spaces.

use core::ffi::{CStr, c_char};
use core::ptr;
use std::sync::Arc;

use crate::argument::{MAX_EXPANDABLE_LENGTH, locale_id};
use crate::error::Status;
use crate::ffi::{call, length, open};
use crate::{Error, Result};

bun_opaque::opaque_ffi! { struct UBreakIterator; }

icu_functions! {
    fn ubrk_open(kind: Kind, locale: *const c_char, text: *const u16, length: i32, status: &mut Status) -> *mut UBreakIterator;
    fn ubrk_clone(iterator: *const UBreakIterator, status: &mut Status) -> *mut UBreakIterator;
    fn ubrk_close(iterator: *mut UBreakIterator);
    fn ubrk_setText(iterator: *mut UBreakIterator, text: *const u16, length: i32, status: &mut Status);
    fn ubrk_next(iterator: *mut UBreakIterator) -> i32;
    fn ubrk_previous(iterator: *mut UBreakIterator) -> i32;
    fn ubrk_following(iterator: *mut UBreakIterator, offset: i32) -> i32;
    fn ubrk_getRuleStatus(iterator: *mut UBreakIterator) -> i32;
}

const UBRK_WORD_NONE_LIMIT: i32 = 100;
pub const MAX_TEXT_LENGTH: usize = 1 << 28;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(i32)]
pub enum Kind {
    Grapheme = 0,
    Word = 1,
    Sentence = 3,
}

icu_handle! {
    /// Never has a text: it is what iterators are copied from.
    pub struct BreakRules(UBreakIterator), ubrk_close
}

impl BreakRules {
    pub fn open(kind: Kind, locale: &CStr) -> Result<BreakRules> {
        let locale = locale_id(locale)?;
        // SAFETY: `locale` is terminated, and the text is optional.
        open(|status| unsafe { ubrk_open(kind, locale, ptr::null(), 0, status) }).map(BreakRules)
    }

    /// Starts at the start of `text`.
    pub fn iterate(&self, text: Arc<Vec<u16>>) -> Result<BreakIterator> {
        if text.len() > MAX_TEXT_LENGTH || has_overlong_phrase(&text) {
            return Err(Error::MEMORY_ALLOCATION);
        }
        let length = length(&text)?;
        // SAFETY: the object is open.
        let iterator = open(|status| unsafe { ubrk_clone(self.0.as_ptr(), status) }).map(Handle)?;
        // SAFETY: the copy is open, and the result holds the `length` units, which nothing can change while they are shared.
        call(|status| unsafe { ubrk_setText(iterator.0.as_ptr(), text.as_ptr(), length, status) })?;
        Ok(BreakIterator { iterator, text })
    }
}

/// A dictionary divides all the text between two characters of other scripts at once. Thai is the first script with one.
fn has_overlong_phrase(text: &[u16]) -> bool {
    text.len() > MAX_EXPANDABLE_LENGTH
        && (text.split(|&unit| unit < 0xe00)).any(|phrase| phrase.len() > MAX_EXPANDABLE_LENGTH)
}

icu_handle! {
    struct Handle(UBreakIterator), ubrk_close
}

/// Stands on a boundary. The start and the end of the text are boundaries.
pub struct BreakIterator {
    iterator: Handle,
    text: Arc<Vec<u16>>,
}

impl BreakIterator {
    pub fn next(&mut self) -> Option<usize> {
        // SAFETY: the iterator is open and its text is alive.
        usize::try_from(unsafe { ubrk_next(self.iterator.0.as_ptr()) }).ok()
    }

    pub fn previous(&mut self) -> Option<usize> {
        // SAFETY: the iterator is open and its text is alive.
        usize::try_from(unsafe { ubrk_previous(self.iterator.0.as_ptr()) }).ok()
    }

    /// Moves to the first boundary after the start of the code point at `offset`.
    pub fn following(&mut self, offset: usize) -> Option<usize> {
        let offset = i32::try_from(offset.min(self.text.len())).ok()?;
        // SAFETY: the iterator is open, its text is alive, and `offset` is inside it.
        usize::try_from(unsafe { ubrk_following(self.iterator.0.as_ptr(), offset) }).ok()
    }

    /// Of `Kind::Word`: whether letters, digits or ideographs end at this boundary.
    pub fn follows_word(&mut self) -> bool {
        // SAFETY: the iterator is open.
        unsafe { ubrk_getRuleStatus(self.iterator.0.as_ptr()) >= UBRK_WORD_NONE_LIMIT }
    }
}
