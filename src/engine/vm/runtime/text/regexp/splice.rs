//! Puts the result of a replacement together.

use bun_alloc::AllocError;
use bun_engine_text::{CodeUnit, MAX_LENGTH, StringBuilder, StringRef, StringWriter, Text};

use crate::{Cx, Gc, JsResult, JsString, Match, StringView};

/// From here on, three cells are cheaper than a copy.
const MIN_ROPE_LENGTH: usize = 64;
const BYTES_ON_STACK: usize = 512;

/// A copy, unless a part of the subject is all that is left.
#[inline]
pub(super) fn splice_flat(
    cx: &Cx,
    subject: &StringView,
    found: Match,
    replacement: Text<'_>,
) -> JsResult<Gc<JsString>> {
    let text = subject.text();
    let (before, after) = (0..found.start as usize, found.end as usize..text.len());
    if replacement.is_empty() && (before.is_empty() || after.is_empty()) {
        return Ok(subject.substring(cx, if before.is_empty() { after } else { before }));
    }
    cx.new_string_from_parts(&[text.slice(before), replacement, text.slice(after)])
}

fn splice_one(
    cx: &Cx,
    subject: &StringView,
    found: Match,
    replacement: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    let length = subject.text().len();
    if length - found.range().len() + (replacement.len() as usize) < MIN_ROPE_LENGTH {
        return splice_flat(cx, subject, found, replacement.view(cx)?.text());
    }
    let before = subject.substring(cx, 0..found.start as usize);
    let after = subject.substring(cx, found.end as usize..length);
    JsString::concat3(cx, before, replacement, after)
}

/// Puts the same text in the place of each match, of which there is one at least.
pub(super) fn splice_all(
    cx: &Cx,
    subject: &StringView,
    matches: &[Match],
    replacement: Gc<JsString>,
) -> JsResult<Gc<JsString>> {
    let inserted = replacement.view(cx)?;
    let (text, inserted) = (subject.text(), inserted.text());
    let removed: usize = matches.iter().map(|found| found.range().len()).sum();
    let kept = text.len() - removed;
    if inserted.is_empty() {
        let mut start = 0;
        let adjacent = matches.iter().take_while(|found| {
            let is_adjacent = found.start == start;
            if is_adjacent {
                start = found.end;
            }
            is_adjacent
        });
        let next = adjacent.count();
        let end = matches.get(next).map_or(text.len(), |it| it.start as usize);
        if end - start as usize == kept {
            return Ok(subject.substring(cx, start as usize..end));
        }
    } else if let [only] = *matches {
        return splice_one(cx, subject, only, replacement);
    }
    let length = kept as u64 + matches.len() as u64 * inserted.len() as u64;
    if length > MAX_LENGTH as u64 {
        return Err(cx.throw_out_of_memory());
    }
    let length = length as usize;
    let result = match (text, inserted) {
        (Text::Latin1(units), Text::Latin1(inserted)) => {
            write(length, units, matches, StringWriter::push_slice, |out| {
                out.push_slice(inserted);
            })
        }
        (Text::Latin1(units), Text::Utf16([])) => {
            write(length, units, matches, StringWriter::push_slice, |_| {})
        }
        (Text::Latin1(units), Text::Utf16(inserted)) => write(
            length,
            units,
            matches,
            |out: &mut StringWriter<u16>, units| out.push_mapped(units, u16::from),
            |out| out.push_slice(inserted),
        ),
        (Text::Utf16(units), _) => write(length, units, matches, StringWriter::push_slice, |out| {
            out.push_text(inserted);
        }),
    };
    Ok(JsString::new(cx, cx.or_out_of_memory(result)?))
}

#[inline(always)]
fn write<S, T: CodeUnit>(
    length: usize,
    subject: &[S],
    matches: &[Match],
    keep: impl Fn(&mut StringWriter<T>, &[S]),
    insert: impl Fn(&mut StringWriter<T>),
) -> Result<StringRef, AllocError> {
    let mut out = StringWriter::try_new(length)?;
    let mut start = 0;
    for found in matches {
        keep(&mut out, &subject[start..found.start as usize]);
        insert(&mut out);
        start = found.end as usize;
    }
    keep(&mut out, &subject[start..]);
    Ok(out.finish())
}

/// For replacements that differ. The matches come in order.
pub(super) struct Splicer<'a> {
    subject: &'a StringView,
    /// Waits, since it may be the only one.
    first: Option<(Match, Gc<JsString>)>,
    out: &'a mut StringBuilder,
    /// How far into the subject `out` goes, once it is in use.
    written: Option<usize>,
}

impl Splicer<'_> {
    #[inline(always)]
    pub(super) fn lend<R>(subject: &StringView, body: impl FnOnce(&mut Splicer<'_>) -> R) -> R {
        StringBuilder::on_stack::<BYTES_ON_STACK, _>(|out| {
            body(&mut Splicer {
                subject,
                first: None,
                out,
                written: None,
            })
        })
    }

    #[inline(always)]
    pub(super) fn replace(
        &mut self,
        cx: &Cx,
        found: Match,
        replacement: Gc<JsString>,
    ) -> JsResult<()> {
        if self.first.is_none() {
            self.first = Some((found, replacement));
            return Ok(());
        }
        replacement.append_to(self.skip(cx, found)?);
        Ok(())
    }

    #[inline]
    pub(super) fn replace_by_appending(
        &mut self,
        cx: &Cx,
        found: Match,
        append: impl FnOnce(&mut StringBuilder),
    ) -> JsResult<()> {
        if self.first.is_none() && self.subject.text().len() > BYTES_ON_STACK {
            append(self.out);
            let replacement = cx.or_out_of_memory(self.out.take())?;
            self.first = Some((found, JsString::new(cx, replacement)));
            return Ok(());
        }
        append(self.skip(cx, found)?);
        Ok(())
    }

    /// Where to append what takes the place of a match that does not wait.
    #[inline(always)]
    fn skip(&mut self, cx: &Cx, found: Match) -> JsResult<&mut StringBuilder> {
        let written = match self.written {
            Some(written) => written,
            None => self.write_first(),
        };
        if self.out.has_overflowed() {
            return Err(cx.throw_out_of_memory());
        }
        let kept = self.subject.text().slice(written..found.start as usize);
        self.out.push_text(kept);
        self.written = Some(found.end as usize);
        Ok(self.out)
    }

    #[inline(never)]
    fn write_first(&mut self) -> usize {
        let Some((found, replacement)) = self.first else {
            return 0;
        };
        let text = self.subject.text();
        if text.len() > BYTES_ON_STACK {
            let slack = (text.len() / 4).min(1 << 16);
            self.out.reserve_if_possible(text.len() + slack);
        }
        self.out.push_text(text.slice(0..found.start as usize));
        replacement.append_to(self.out);
        found.end as usize
    }

    /// `None` if nothing has been replaced.
    #[inline(always)]
    pub(super) fn finish(&mut self, cx: &Cx) -> JsResult<Option<Gc<JsString>>> {
        match (self.written, self.first) {
            (Some(written), _) => {
                self.out.push_text(self.subject.text().slice_from(written));
                let result = cx.or_out_of_memory(self.out.take())?;
                Ok(Some(JsString::new(cx, result)))
            }
            (None, Some((found, replacement))) => {
                splice_one(cx, self.subject, found, replacement).map(Some)
            }
            (None, None) => Ok(None),
        }
    }
}
