//! One match after the other, as with the flag `g`.

use core::ops::ControlFlow;

use bun_engine_regexp::Mode;
use bun_engine_text::Text;
use smallvec::SmallVec;

use crate::{
    CaptureBuffer, Captures, Cx, JsResult, Match, RegExp, StringView, advance_string_index,
};

pub(super) type Matches = SmallVec<[Match; 32]>;

#[inline(always)]
pub(super) fn check_termination(cx: &Cx) -> JsResult<()> {
    if cx.is_termination_requested() {
        return Err(cx.throw_termination());
    }
    Ok(())
}

#[inline(always)]
pub(super) fn try_push<A: smallvec::Array>(
    cx: &Cx,
    list: &mut SmallVec<A>,
    element: A::Item,
) -> JsResult<()> {
    const MAX_SIZE: usize = 1 << 31;
    if list.len() == list.capacity()
        && (2 * size_of_val(&**list) > MAX_SIZE || list.try_reserve(1).is_err())
    {
        return Err(cx.throw_out_of_memory());
    }
    list.push(element);
    Ok(())
}

impl RegExp {
    /// Where to look for the next one, which can be past the end.
    #[inline(always)]
    pub(super) fn start_after(&self, subject: Text<'_>, found: Match) -> u32 {
        if !found.is_empty() {
            return found.end;
        }
        let is_unicode_aware = self.flags().is_unicode_aware();
        advance_string_index(subject, found.end.into(), is_unicode_aware) as u32
    }

    /// From `start` on, until `visit` breaks or throws.
    #[inline(always)]
    pub(super) fn for_each_match(
        &self,
        cx: &Cx,
        subject: &StringView,
        start: u32,
        mut visit: impl FnMut(Match) -> JsResult<ControlFlow<()>>,
    ) -> JsResult<ControlFlow<()>> {
        let analysis = self.analyze(cx, subject.text(), Mode::MatchOnly)?;
        if let Some(form) = self.form_for_all_matches(cx, &analysis, subject.text()) {
            let mut result = Ok(ControlFlow::Continue(()));
            form.for_each(subject.text(), start as usize, |found| {
                result = visit(found.into());
                match result {
                    Ok(flow) => flow,
                    Err(_) => ControlFlow::Break(()),
                }
            });
            return result;
        }
        let mut start = start;
        while let Some(found) = self.find(cx, subject, start)? {
            if visit(found)?.is_break() {
                return Ok(ControlFlow::Break(()));
            }
            start = self.start_after(subject.text(), found);
            check_termination(cx)?;
        }
        Ok(ControlFlow::Continue(()))
    }

    /// The same, with the groups.
    #[inline(always)]
    pub(super) fn for_each_exec(
        &self,
        cx: &Cx,
        subject: &StringView,
        start: u32,
        mut visit: impl FnMut(Captures<'_>) -> JsResult<ControlFlow<()>>,
    ) -> JsResult<ControlFlow<()>> {
        self.analyze(cx, subject.text(), Mode::Captures)?;
        if self.group_count() == 0 {
            return self.for_each_match(cx, subject, start, |found| {
                visit(Captures::new(&[found.start, found.end]))
            });
        }
        let (mut start, mut buffer) = (start, CaptureBuffer::default());
        while let Some(captures) = self.exec(cx, subject, start, &mut buffer)? {
            if visit(captures)?.is_break() {
                return Ok(ControlFlow::Break(()));
            }
            start = self.start_after(subject.text(), captures.whole());
            check_termination(cx)?;
        }
        Ok(ControlFlow::Continue(()))
    }
}
