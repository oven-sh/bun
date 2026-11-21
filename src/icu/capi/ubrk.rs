//! `unicode/ubrk.h`

use crate::capi::ffi::{self, CallerMem, ErrorCode, NonNullHandle, NulStr, Retained, Text, UChar};
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

/// The caller keeps the text alive for each call that reads it, also through a clone.
pub(crate) struct UBreakIterator {
    iter: BreakIterator,
    text: Retained<Text<'static, UChar>>,
}

fn step(
    cx: &CallerMem,
    bi: Option<&mut UBreakIterator>,
    step: impl FnOnce(&mut BreakIterator, &[u16]) -> i32,
) -> i32 {
    let Some(bi) = bi else {
        return UBRK_DONE;
    };
    let text = cx.text_or_empty(bi.text.get());
    // If allocation fails, a run of a dictionary script stays undivided.
    ffi::ignore_oom(|| step(&mut bi.iter, text))
}

/// Accepts `UBRK_CHARACTER`, `UBRK_WORD` and `UBRK_SENTENCE`.
#[capi]
fn ubrk_open(
    type_: UBreakIteratorType,
    locale: NulStr<u8>,
    (text, _): Retained<Text<'static, UChar>>,
    status: ErrorCode,
) -> Option<Box<UBreakIterator>> {
    status.open(|cx, _| {
        let create = match type_ {
            UBRK_CHARACTER => BreakIterator::create_character_instance,
            UBRK_WORD => BreakIterator::create_word_instance,
            UBRK_SENTENCE => BreakIterator::create_sentence_instance,
            _ => return Err(U_UNSUPPORTED_ERROR),
        };
        Ok(UBreakIterator {
            iter: create(&Locale::new(cx.c_str(locale)))?,
            text: text.measured(cx)?,
        })
    })
}

#[capi]
fn ubrk_clone(bi: Option<&UBreakIterator>, status: ErrorCode) -> Option<Box<UBreakIterator>> {
    status.open(|_, _| {
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
fn ubrk_setText(
    bi: Option<&mut UBreakIterator>,
    (text, _): Retained<Text<'static, UChar>>,
    status: ErrorCode,
) {
    status.run((), |cx, _| {
        let bi = bi.non_null()?;
        bi.text = text.measured(cx)?;
        bi.iter.reset();
        Ok(())
    });
}

#[capi]
fn ubrk_current(bi: Option<&UBreakIterator>) -> i32 {
    bi.map_or(0, |bi| bi.iter.current())
}

#[capi]
fn ubrk_next(cx: &CallerMem, bi: Option<&mut UBreakIterator>) -> i32 {
    step(cx, bi, BreakIterator::next)
}

#[capi]
fn ubrk_previous(cx: &CallerMem, bi: Option<&mut UBreakIterator>) -> i32 {
    step(cx, bi, BreakIterator::previous)
}

#[capi]
fn ubrk_first(cx: &CallerMem, bi: Option<&mut UBreakIterator>) -> i32 {
    step(cx, bi, BreakIterator::first)
}

#[capi]
fn ubrk_following(cx: &CallerMem, bi: Option<&mut UBreakIterator>, offset: i32) -> i32 {
    step(cx, bi, |bi, text| bi.following(text, offset))
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
