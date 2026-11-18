//! What `Symbol.replace` does with a pristine object and a string.

use core::ops::ControlFlow::Continue;

use bun_engine_regexp::{Mode, Template};
use bun_engine_text::Text;

use super::global_search::{Matches, try_push};
use super::receiver::Receiver;
use super::splice::{Splicer, splice_all, splice_flat};
use crate::{CaptureBuffer, Captures, Cx, Gc, JsResult, JsString, PlainRegExp, RegExp, StringView};

/// Updates `lastIndex` and the record of the last match.
pub(super) fn exec_into<'a>(
    mut receiver: impl Receiver,
    string: Gc<JsString>,
    subject: &StringView,
    buffer: &'a mut CaptureBuffer,
) -> JsResult<Option<Captures<'a>>> {
    let captures = receiver.with_last_index_updated(
        string,
        |cx, regexp, start| regexp.exec(cx, subject, start, buffer),
        |captures| captures.whole().end,
    )?;
    if let Some(captures) = captures {
        (receiver.cx().global()).record_match(&receiver.regexp(), string, captures.whole());
    }
    Ok(captures)
}

fn has_no_dollar(template: Text<'_>) -> bool {
    !template.contains_unit(b'$'.into())
}

#[inline(always)]
fn replace(
    cx: &Cx,
    mut receiver: impl Receiver,
    string: Gc<JsString>,
    replacement: Gc<JsString>,
    is_literal: impl FnOnce(Text<'_>) -> bool,
) -> JsResult<Gc<JsString>> {
    let (subject, template) = (string.view(cx)?, replacement.view(cx)?);
    let (regexp, template) = (receiver.regexp(), template.text());
    let is_literal = is_literal(template);
    let result = if regexp.is_global() {
        receiver.set_last_index(0)?;
        match is_literal {
            true => regexp.replace_all_literally(cx, string, &subject, replacement)?,
            false => regexp.substitute_all(cx, string, &subject, template)?,
        }
    } else if is_literal {
        let found = receiver.with_last_index_updated(
            string,
            |cx, regexp, start| regexp.find(cx, &subject, start),
            |found| found.end,
        )?;
        let Some(found) = found else {
            return Ok(string);
        };
        cx.global().record_match(&regexp, string, found);
        Some(splice_flat(cx, &subject, found, template)?)
    } else {
        substitute_first(cx, receiver, string, &subject, template)?
    };
    Ok(result.unwrap_or(string))
}

fn substitute_first(
    cx: &Cx,
    receiver: impl Receiver,
    string: Gc<JsString>,
    subject: &StringView,
    template: Text<'_>,
) -> JsResult<Option<Gc<JsString>>> {
    let (regexp, mut buffer) = (receiver.regexp(), CaptureBuffer::default());
    let Some(captures) = exec_into(receiver, string, subject, &mut buffer)? else {
        return Ok(None);
    };
    let (text, range) = (subject.text(), captures.whole().range());
    let analysis = regexp.analyze(cx, text, Mode::Captures)?;
    let result = subject.replaced_with(cx, range.clone(), |out| {
        let groups = &captures.offsets()[2..];
        Template::expand(template, &analysis.names, out, text, range, groups);
    });
    result.map(Some)
}

impl PlainRegExp<'_> {
    pub fn replace_with_string(
        self,
        cx: &Cx,
        string: Gc<JsString>,
        replacement: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        replace(cx, (cx, self), string, replacement, has_no_dollar)
    }
}

/// From the start of the string.
impl RegExp {
    pub(crate) fn replace_with_string(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        replacement: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        replace(cx, (cx, self), string, replacement, has_no_dollar)
    }

    /// Nothing in `replacement` is expanded.
    pub(crate) fn replace_literally(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        replacement: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        replace(cx, (cx, self), string, replacement, |_| true)
    }
}

impl RegExp {
    fn replace_all_literally(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        subject: &StringView,
        replacement: Gc<JsString>,
    ) -> JsResult<Option<Gc<JsString>>> {
        let mut matches = Matches::new();
        let result = self.for_each_match(cx, subject, 0, |found| {
            try_push(cx, &mut matches, found).map(Continue)
        });
        let Some(&last) = matches.last() else {
            return result.map(|_| None);
        };
        cx.global().record_match(self, string, last);
        result.and_then(|_| splice_all(cx, subject, &matches, replacement).map(Some))
    }

    fn substitute_all(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        subject: &StringView,
        template: Text<'_>,
    ) -> JsResult<Option<Gc<JsString>>> {
        let analysis = self.analyze(cx, subject.text(), Mode::Captures)?;
        let (mut parsed, mut last) = (Template::default(), None);
        Splicer::lend(subject, |splicer| {
            let result = self.for_each_exec(cx, subject, 0, |captures| {
                let found = captures.whole();
                if last.replace(found).is_none() {
                    let group_count = self.group_count() as u16;
                    cx.or_out_of_memory(parsed.parse(template, group_count, &analysis.names))?;
                }
                let groups = &captures.offsets()[2..];
                let append =
                    |out: &mut _| parsed.append(out, subject.text(), found.range(), groups);
                (splicer.replace_by_appending(cx, found, append)).map(Continue)
            });
            if let Some(last) = last {
                cx.global().record_match(self, string, last);
            }
            result.and_then(|_| splicer.finish(cx))
        })
    }
}
