//! How RegExpBuiltinExec gets at `lastIndex`.

use core::marker::PhantomData;
use core::ops::Deref;

use crate::{Cx, Gc, JsResult, JsString, RegExp, RegExpObject};

/// An object for which `is_plain` holds. No script runs while it is alive.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct PlainRegExp<'a>(Gc<RegExpObject>, PhantomData<&'a Cx>);

impl<'a> PlainRegExp<'a> {
    #[inline(always)]
    pub(super) fn new(_: &'a Cx, object: &RegExpObject) -> PlainRegExp<'a> {
        debug_assert!(object.is_plain());
        PlainRegExp(object.into(), PhantomData)
    }

    #[inline(always)]
    pub(crate) fn unchanged_if_it_throws<T>(
        self,
        act: impl FnOnce() -> JsResult<T>,
    ) -> JsResult<T> {
        let before = self.numeric_last_index_value();
        act().inspect_err(|_| self.restore_last_index(before))
    }
}

impl Deref for PlainRegExp<'_> {
    type Target = RegExpObject;

    #[inline(always)]
    fn deref(&self) -> &RegExpObject {
        &self.0
    }
}

pub(super) trait Receiver {
    fn cx(&self) -> &Cx;

    fn regexp(&self) -> Gc<RegExp>;

    fn get_last_index(&mut self) -> JsResult<u64>;

    fn set_last_index(&mut self, index: u32) -> JsResult<()>;

    /// The steps around `search`, which gets the pattern and where to start.
    #[inline(always)]
    fn with_last_index_updated<T>(
        &mut self,
        string: Gc<JsString>,
        search: impl FnOnce(&Cx, &RegExp, u32) -> JsResult<Option<T>>,
        end_of: impl FnOnce(&T) -> u32,
    ) -> JsResult<Option<T>> {
        let last_index = self.get_last_index()?;
        let regexp = self.regexp();
        let uses_last_index = regexp.uses_last_index();
        let start = if uses_last_index { last_index } else { 0 };
        let result = match start <= string.len().into() {
            true => search(self.cx(), &regexp, start as u32)?,
            false => None,
        };
        if uses_last_index {
            self.set_last_index(result.as_ref().map_or(0, end_of))?;
        }
        Ok(result)
    }
}

impl Receiver for (&mut Cx, &RegExpObject) {
    #[inline(always)]
    fn cx(&self) -> &Cx {
        self.0
    }

    #[inline(always)]
    fn regexp(&self) -> Gc<RegExp> {
        self.1.regexp()
    }

    #[inline(always)]
    fn get_last_index(&mut self) -> JsResult<u64> {
        self.1.get_last_index(self.0)
    }

    #[inline(always)]
    fn set_last_index(&mut self, index: u32) -> JsResult<()> {
        self.1.set_last_index(self.0, index.into())
    }
}

impl Receiver for (&Cx, PlainRegExp<'_>) {
    #[inline(always)]
    fn cx(&self) -> &Cx {
        self.0
    }

    #[inline(always)]
    fn regexp(&self) -> Gc<RegExp> {
        self.1.regexp()
    }

    #[inline(always)]
    fn get_last_index(&mut self) -> JsResult<u64> {
        Ok(self.1.numeric_last_index())
    }

    #[inline(always)]
    fn set_last_index(&mut self, index: u32) -> JsResult<()> {
        self.1.store_last_index(index.into());
        Ok(())
    }
}

/// In place of an object whose `lastIndex` does not matter, or is zero before and after.
impl Receiver for (&Cx, &RegExp) {
    #[inline(always)]
    fn cx(&self) -> &Cx {
        self.0
    }

    #[inline(always)]
    fn regexp(&self) -> Gc<RegExp> {
        self.1.into()
    }

    #[inline(always)]
    fn get_last_index(&mut self) -> JsResult<u64> {
        Ok(0)
    }

    #[inline(always)]
    fn set_last_index(&mut self, _: u32) -> JsResult<()> {
        Ok(())
    }
}
