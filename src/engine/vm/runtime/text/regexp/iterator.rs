use core::cell::Cell;
use core::marker::PhantomData;
use core::mem::offset_of;
use core::ops::Deref;

use bun_engine_macros::cell;
use bun_engine_text::names;

use super::exec::exec_with_range;
use crate::{
    Cx, Gc, JsArray, JsObject, JsObjectInit, JsResult, JsString, PlainRegExp, RegExp, RegExpObject,
    advance_string_index, regexp_exec,
};

#[cell(name = "RegExpStringIterator", cell_type = RegExpStringIterator)]
pub struct RegExpStringIterator {
    base: JsObject,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    is_global: bool,
    is_unicode_aware: bool,
    is_done: Cell<bool>,
}

impl RegExpStringIterator {
    /// An object of any kind. Never changes.
    pub const OFFSET_OF_MATCHER: usize = offset_of!(RegExpStringIterator, regexp);
    /// A byte that is 0 or 1.
    pub const OFFSET_OF_IS_DONE: usize = offset_of!(RegExpStringIterator, is_done);

    /// CreateRegExpStringIterator
    pub fn create(
        cx: &Cx,
        regexp: Gc<JsObject>,
        string: Gc<JsString>,
        is_global: bool,
        is_unicode_aware: bool,
    ) -> Gc<RegExpStringIterator> {
        cx.allocate::<RegExpStringIterator>(RegExpStringIteratorInit {
            base: JsObjectInit::new(cx, cx.regexp_string_iterator_shape()),
            regexp,
            string,
            is_global,
            is_unicode_aware,
            is_done: Cell::new(false),
        })
    }

    /// What `Symbol.matchAll` does with an object that is pristine, species included.
    pub fn for_pristine(
        cx: &Cx,
        object: PlainRegExp<'_>,
        string: Gc<JsString>,
    ) -> Gc<RegExpStringIterator> {
        Self::for_pattern(cx, object.regexp(), object.numeric_last_index(), string)
    }

    pub(crate) fn for_pattern(
        cx: &Cx,
        regexp: Gc<RegExp>,
        last_index: u64,
        string: Gc<JsString>,
    ) -> Gc<RegExpStringIterator> {
        let matcher = RegExpObject::create(cx, regexp);
        matcher.store_last_index(last_index);
        let (is_global, is_unicode_aware) = (regexp.is_global(), regexp.flags().is_unicode_aware());
        Self::create(cx, matcher.upcast(), string, is_global, is_unicode_aware)
    }

    #[inline(always)]
    pub(crate) fn matcher(&self) -> Gc<JsObject> {
        self.regexp
    }

    #[cfg(debug_assertions)]
    pub(crate) fn is_done(&self) -> bool {
        self.is_done.get()
    }

    /// `None` at the end.
    pub fn next_match(&self, cx: &mut Cx) -> JsResult<Option<Gc<JsObject>>> {
        let (regexp, string) = (self.regexp, self.string);
        if (regexp.downcast::<RegExpObject>()).is_some_and(|it| it.is_pristine(cx)) {
            let next = PlainMatchIterator(self.into(), PhantomData).next_match(cx)?;
            return Ok(next.map(Gc::upcast));
        }
        self.step(
            cx,
            |cx| match regexp_exec(cx, regexp, string)? {
                Some(result) if self.is_global => {
                    let is_empty = result.get_index(cx, 0)?.to_string(cx)?.is_empty();
                    Ok(Some((result, is_empty)))
                }
                result => Ok(result.map(|result| (result, false))),
            },
            |cx| advance_last_index(cx, regexp, string, self.is_unicode_aware),
        )
    }

    /// `exec` also says whether the match is empty, in which case `advance` follows.
    #[inline(always)]
    fn step<C, T>(
        &self,
        mut cx: C,
        exec: impl FnOnce(&mut C) -> JsResult<Option<(T, bool)>>,
        advance: impl FnOnce(&mut C) -> JsResult<()>,
    ) -> JsResult<Option<T>> {
        if self.is_done.get() {
            return Ok(None);
        }
        let Some((result, is_empty)) = exec(&mut cx)? else {
            self.is_done.set(true);
            return Ok(None);
        };
        if !self.is_global {
            self.is_done.set(true);
        } else if is_empty {
            advance(&mut cx)?;
        }
        Ok(Some(result))
    }
}

/// One whose matcher is pristine. No script runs while it is alive.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub(crate) struct PlainMatchIterator<'a>(Gc<RegExpStringIterator>, PhantomData<&'a Cx>);

impl Deref for PlainMatchIterator<'_> {
    type Target = RegExpStringIterator;

    #[inline(always)]
    fn deref(&self) -> &RegExpStringIterator {
        &self.0
    }
}

impl PlainMatchIterator<'_> {
    pub(crate) fn next_match(self, cx: &Cx) -> JsResult<Option<Gc<JsArray>>> {
        let (matcher, string) = (self.regexp.cast::<RegExpObject>(), self.string);
        self.step(
            cx,
            |&mut cx| {
                let result = exec_with_range((cx, PlainRegExp::new(cx, &matcher)), string)?;
                Ok(result.map(|(array, found)| (array, found.is_empty())))
            },
            |&mut cx| {
                let (subject, index) = (string.view(cx)?, matcher.numeric_last_index());
                let next = advance_string_index(subject.text(), index, self.is_unicode_aware);
                matcher.store_last_index(next);
                Ok(())
            },
        )
    }
}

/// After an empty match.
pub fn advance_last_index(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
    is_unicode_aware: bool,
) -> JsResult<()> {
    let index = regexp.get(cx, names::lastIndex)?.to_length(cx)?;
    let next = advance_string_index(string.view(cx)?.text(), index, is_unicode_aware);
    regexp
        .set(cx, names::lastIndex, next.into(), true)
        .map(drop)
}
