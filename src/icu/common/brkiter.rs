//! The break iterator of a locale. The text is an argument, as in `rbbi.rs`. ICU4C: brkiter.cpp

use crate::common::charstr::SmallChars;
use crate::common::filteredbrk::{Exceptions, load_abbreviations};
use crate::common::locid::Locale;
use crate::common::memory::{Appendable as _, TryClone, fail_on_oom, try_shared};
use crate::common::rbbi::RuleBasedBreakIterator;
use crate::common::rbbidata::{Extras, RBBIData};
use crate::common::slice_ext::SliceExt as _;
use crate::common::udata;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uresimp::{
    U_ICUDATA_BRKITR, ures_get_string_by_key_with_fallback, ures_open_no_default,
};
use crate::common::utypes::{
    U_BUFFER_OVERFLOW_ERROR, U_ILLEGAL_ARGUMENT_ERROR, U_INVALID_FORMAT_ERROR, UErrorCode,
};
use std::sync::Arc;

pub(crate) struct BreakIterator {
    rules: RuleBasedBreakIterator,
    exceptions: Option<Arc<Exceptions>>,
}

impl TryClone for BreakIterator {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        Ok(Self {
            rules: self.rules.try_clone()?,
            exceptions: self.exceptions.as_ref().map(Arc::clone),
        })
    }
}

// ICU4C: brkiter.cpp, BreakIterator::buildInstance
fn load_rules(locale: &Locale, type_: &[u8]) -> Result<(RBBIData, Option<Extras>), UErrorCode> {
    const NAME_CAPACITY: usize = 256;
    const EXTENSION_CAPACITY: usize = 4;
    let bundle = ures_open_no_default(Some(U_ICUDATA_BRKITR), locale.get_name())?;
    let table = bundle.get_by_key_with_fallback(b"boundaries")?;
    let file = ures_get_string_by_key_with_fallback(&table, type_)?;
    if file.len() >= NAME_CAPACITY {
        return Err(U_BUFFER_OVERFLOW_ERROR);
    }
    let dot = (file.iter().take_while(|&unit| unit != 0))
        .position(|unit| unit == u16::from(b'.'))
        .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
    let mut chars = SmallChars::new();
    chars.add_each(invariant_prefix(file.iter().take(dot)));
    let name_length = chars.len();
    chars.add_each(invariant_prefix(file.slice(dot + 1..).iter()).take(EXTENSION_CAPACITY));
    let (name, extension) = chars.split_soft(name_length);
    let item = udata::open(U_ICUDATA_BRKITR, extension, name)?;
    RBBIData::read(&item).ok_or(U_INVALID_FORMAT_ERROR)
}

impl BreakIterator {
    fn build_instance(locale: &Locale, type_: &[u8]) -> Result<Self, UErrorCode> {
        let (data, extras) = load_rules(locale, type_)?;
        Ok(Self {
            rules: RuleBasedBreakIterator::new(&data, extras.as_ref())?,
            exceptions: None,
        })
    }

    pub(crate) fn create_character_rules(
        locale: &Locale,
    ) -> Result<RuleBasedBreakIterator, UErrorCode> {
        Ok(Self::create_character_instance(locale)?.rules)
    }

    pub(crate) fn create_character_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        Self::build_instance(locale, b"grapheme")
    }

    pub(crate) fn create_word_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        Self::build_instance(locale, b"word")
    }

    pub(crate) fn create_sentence_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        fail_on_oom(|| {
            let mut result = Self::build_instance(locale, b"sentence")?;
            if locale
                .get_keyword_value(b"ss")
                .is_ok_and(|value| value == b"standard")
                && let Ok(abbreviations) = load_abbreviations(locale)
            {
                result.exceptions = Some(try_shared(Exceptions::new(abbreviations)?)?);
            }
            Ok(result)
        })
    }

    /// Sets `text` and returns an iterator over its boundaries.
    pub(crate) fn boundaries<'a>(
        &'a mut self,
        text: &'a [u16],
    ) -> Result<Boundaries<'a>, UErrorCode> {
        i32::try_from(text.len()).or(Err(U_ILLEGAL_ARGUMENT_ERROR))?;
        self.reset();
        Ok(Boundaries { iter: self, text })
    }

    pub(crate) fn reset(&mut self) {
        self.rules.reset();
    }

    pub(crate) fn first(&mut self, text: &[u16]) -> i32 {
        self.rules.first(text)
    }

    pub(crate) fn next(&mut self, text: &[u16]) -> i32 {
        let n = self.rules.next(text);
        self.skip_exceptions(text, n, RuleBasedBreakIterator::next)
    }

    pub(crate) fn previous(&mut self, text: &[u16]) -> i32 {
        let n = self.rules.previous(text);
        self.skip_exceptions(text, n, RuleBasedBreakIterator::previous)
    }

    pub(crate) fn following(&mut self, text: &[u16], offset: i32) -> i32 {
        let n = self.rules.following(text, offset);
        self.skip_exceptions(text, n, RuleBasedBreakIterator::next)
    }

    #[inline]
    fn skip_exceptions(
        &mut self,
        text: &[u16],
        mut n: i32,
        step: fn(&mut RuleBasedBreakIterator, &[u16]) -> i32,
    ) -> i32 {
        if let Some(exceptions) = &self.exceptions {
            while exceptions.is_exception_at(text, n) {
                n = step(&mut self.rules, text);
            }
        }
        n
    }

    pub(crate) fn current(&self) -> i32 {
        self.rules.current()
    }

    pub(crate) fn get_rule_status(&self) -> i32 {
        match self.exceptions {
            Some(_) => 0,
            None => self.rules.get_rule_status(),
        }
    }
}

pub(crate) struct Boundaries<'a> {
    iter: &'a mut BreakIterator,
    text: &'a [u16],
}

impl Boundaries<'_> {
    pub(crate) fn first(&mut self) -> i32 {
        self.iter.first(self.text)
    }

    pub(crate) fn next(&mut self) -> i32 {
        self.iter.next(self.text)
    }
}
