//! `unicode/ubrk.h`

use crate::capi::ffi::raw::ubrk::{KeptText, WithText};
use crate::capi::ffi::{self, ErrorCode, NonNullHandle, NulStr, Text, UChar};
use crate::common::brkiter::BreakIterator;
use crate::common::locid::Locale;
use crate::common::memory::TryClone;
use crate::common::rbbi::UBRK_DONE;
use crate::common::utypes::*;
use bun_icu_macros::capi;
use std::ffi::c_char;

type UBreakIteratorType = i32;
const UBRK_CHARACTER: UBreakIteratorType = 0;
const UBRK_WORD: UBreakIteratorType = 1;
const UBRK_SENTENCE: UBreakIteratorType = 3;

pub(crate) struct UBreakIterator {
    pub(crate) iter: BreakIterator,
    pub(crate) text: KeptText,
}

fn step(bi: WithText<'_>, step: impl FnOnce(&mut BreakIterator, &[u16]) -> i32) -> i32 {
    let Some((iter, text)) = bi.get() else {
        return UBRK_DONE;
    };
    // If allocation fails, a run of a dictionary script stays undivided.
    ffi::ignore_oom(|| step(iter, text))
}

/// Accepts `UBRK_CHARACTER`, `UBRK_WORD` and `UBRK_SENTENCE`.
#[capi]
fn ubrk_open(
    type_: UBreakIteratorType,
    locale: NulStr<u8>,
    (text, _): Text<UChar>,
    status: ErrorCode,
) -> Option<Box<UBreakIterator>> {
    status.open(|| {
        let create = match type_ {
            UBRK_CHARACTER => BreakIterator::create_character_instance,
            UBRK_WORD => BreakIterator::create_word_instance,
            UBRK_SENTENCE => BreakIterator::create_sentence_instance,
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        Ok(UBreakIterator {
            iter: create(&Locale::new(locale.get()))?,
            text: text.keep()?,
        })
    })
}

#[capi]
fn ubrk_clone(bi: Option<&UBreakIterator>, status: ErrorCode) -> Option<Box<UBreakIterator>> {
    status.open(|| {
        let bi = bi.non_null()?;
        Ok(UBreakIterator {
            iter: bi.iter.try_clone()?,
            text: bi.text,
        })
    })
}

#[capi]
fn ubrk_close(bi: Option<Box<UBreakIterator>>) {
    drop(bi);
}

#[capi]
fn ubrk_setText(bi: Option<&mut UBreakIterator>, (text, _): Text<UChar>, status: ErrorCode) {
    status.run((), |_| {
        let bi = bi.non_null()?;
        bi.text = text.keep()?;
        bi.iter.reset();
        Ok(())
    });
}

#[capi]
fn ubrk_current(bi: Option<&UBreakIterator>) -> i32 {
    bi.map_or(0, |bi| bi.iter.current())
}

#[capi]
fn ubrk_next(bi: WithText) -> i32 {
    step(bi, BreakIterator::next)
}

#[capi]
fn ubrk_previous(bi: WithText) -> i32 {
    step(bi, BreakIterator::previous)
}

#[capi]
fn ubrk_first(bi: WithText) -> i32 {
    step(bi, BreakIterator::first)
}

#[capi]
fn ubrk_following(bi: WithText, offset: i32) -> i32 {
    step(bi, |bi, text| bi.following(text, offset))
}

#[capi]
fn ubrk_getAvailable(index: i32) -> *const c_char {
    crate::capi::uloc::get_available(index)
}

#[capi]
fn ubrk_countAvailable() -> i32 {
    crate::capi::uloc::count_available()
}

#[capi]
fn ubrk_getRuleStatus(bi: Option<&UBreakIterator>) -> i32 {
    bi.map_or(0, |bi| bi.iter.get_rule_status())
}
