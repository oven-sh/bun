use core::cell::Cell;
use core::ops::ControlFlow::{Break, Continue};

use bun_engine_macros::Trace;
use bun_engine_regexp::{Form, Mode};
use bun_engine_text::Text;

use super::global_search::{Matches, try_push};
use crate::{
    Cx, ElementKind, Field, Gc, JsArray, JsResult, JsString, Match, RegExp, Storage, StringView,
};

/// Past this, the rest is counted before memory is spent on it.
pub(super) const MAX_UNCOUNTED: usize = 100_000;

/// How often an atom occurs in a part of a string, for when a longer part with the same start is next.
#[derive(Trace)]
pub(super) struct AtomCount {
    regexp: Field<Option<Gc<RegExp>>>,
    base: Field<Option<Gc<JsString>>>,
    offset: Cell<u32>,
    length: Cell<usize>,
    count: Cell<usize>,
    last: Cell<Option<Match>>,
}

impl Default for AtomCount {
    fn default() -> AtomCount {
        AtomCount {
            regexp: Field::new(None),
            base: Field::new(None),
            offset: Cell::new(0),
            length: Cell::new(0),
            count: Cell::new(0),
            last: Cell::new(None),
        }
    }
}

impl RegExp {
    /// The text of each match. `None` if there is none.
    pub fn match_all(&self, cx: &Cx, string: Gc<JsString>) -> JsResult<Option<Gc<JsArray>>> {
        let subject = string.view(cx)?;
        let analysis = self.analyze(cx, subject.text(), Mode::MatchOnly)?;
        if let Some(form) = &analysis.form
            && let Some(atom) = form.atom()
        {
            return self.match_all_of_atom(cx, form, atom, string, &subject);
        }
        let mut matches = Matches::new();
        let flow = self.for_each_match(cx, &subject, 0, |found| {
            try_push(cx, &mut matches, found)?;
            Ok(match matches.len() {
                MAX_UNCOUNTED => Break(()),
                _ => Continue(()),
            })
        });
        let Some(&last) = matches.last() else {
            return flow.map(|_| None);
        };
        cx.global().record_match(self, string, last);
        if flow?.is_break() {
            return self.match_many(cx, string, &subject, &matches).map(Some);
        }
        let shape = cx.global().array_shape(ElementKind::Contiguous);
        let array = JsArray::try_from_fn(cx, shape, [], matches.len(), |index| {
            subject.substring(cx, matches[index].range()).into()
        });
        cx.or_out_of_memory(array).map(Some)
    }

    #[cold]
    fn match_many(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        subject: &StringView,
        first: &[Match],
    ) -> JsResult<Gc<JsArray>> {
        let (mut count, mut last) = (first.len(), first[first.len() - 1]);
        let rest = self.start_after(subject.text(), last);
        let flow = self.for_each_match(cx, subject, rest, |found| {
            (count, last) = (count + 1, found);
            Ok(match count > Storage::MAX_VECTOR_LENGTH as usize {
                true => Break(()),
                false => Continue(()),
            })
        });
        cx.global().record_match(self, string, last);
        if flow?.is_break() {
            return Err(cx.throw_out_of_memory());
        }
        let array = cx.new_array_with_capacity(ElementKind::Contiguous, count)?;
        let append = |found: Match| {
            let text = subject.substring(cx, found.range());
            cx.or_out_of_memory(array.append_values(cx, &[text.into()]))
        };
        first.iter().copied().try_for_each(append)?;
        let flow = self.for_each_match(cx, subject, rest, |found| append(found).map(Continue));
        flow.map(|_| array)
    }

    fn match_all_of_atom(
        &self,
        cx: &Cx,
        form: &Form,
        atom: Text<'_>,
        string: Gc<JsString>,
        subject: &StringView,
    ) -> JsResult<Option<Gc<JsArray>>> {
        let (count, last) = if subject.owner().0 == string {
            let Some(first) = self.find(cx, subject.text(), 0)? else {
                return Ok(None);
            };
            let (count, last) = form.count(subject.text(), first.start as usize);
            (count, last.map(Match::from))
        } else {
            self.count_atom_in_substring(cx, form, atom, subject)
        };
        let Some(last) = last else {
            return Ok(None);
        };
        let atom = cx.new_string(atom)?;
        let shape = cx.global().array_shape(ElementKind::Contiguous);
        let array = JsArray::try_from_fn(cx, shape, [], count, |_| atom.into());
        let array = cx.or_out_of_memory(array)?;
        cx.global().record_match(self, string, last);
        Ok(Some(array))
    }

    fn count_atom_in_substring(
        &self,
        cx: &Cx,
        form: &Form,
        atom: Text<'_>,
        subject: &StringView,
    ) -> (usize, Option<Match>) {
        let global = cx.global();
        let known = &global.regexp_state().atom_count;
        let ((base, offset), length) = (subject.owner(), subject.text().len());
        if known.regexp.get() != Some(self.into())
            || known.base.get() != Some(base)
            || known.offset.get() != offset
            || known.length.get() > length
        {
            // SAFETY: a part of the cell.
            unsafe {
                known.regexp.set(&global, Some(self.into()));
                known.base.set(&global, Some(base));
            }
            known.offset.set(offset);
            known.length.set(0);
            known.count.set(0);
            known.last.set(None);
        }
        let reaching_beyond = (known.length.replace(length) + 1).saturating_sub(atom.len());
        let after_last = known.last.get().map_or(0, |last| last.end as usize);
        let (more, last) = form.count(subject.text(), reaching_beyond.max(after_last));
        known.count.update(|count| count + more);
        known.last.update(|before| last.map(Match::from).or(before));
        (known.count.get(), known.last.get())
    }
}
