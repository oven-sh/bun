use core::ops::Range;

use bun_engine_text::{MAX_LENGTH, StringBuilder, StringRef};

use crate::{Cx, Gc, JsResult, JsString, StringView};

/// Below this, a copy takes less memory than a rope and two substrings.
const MIN_ROPE_LENGTH: usize = 28;

/// Makes a string of another one by replacing ranges of it, from the first to the last.
pub struct StringSplicer<'a> {
    source: &'a StringView,
    /// What is before this has been dealt with.
    position: usize,
    state: State,
}

enum State {
    Unchanged,
    /// The range ends at `position`.
    ReplacedOnce {
        start: usize,
        replacement: Option<Gc<JsString>>,
    },
    Copying(StringBuilder),
}

impl<'a> StringSplicer<'a> {
    #[inline(always)]
    pub fn new(source: &'a StringView) -> StringSplicer<'a> {
        StringSplicer {
            source,
            position: 0,
            state: State::Unchanged,
        }
    }

    /// The end of the range that was replaced last.
    #[inline(always)]
    pub fn position(&self) -> usize {
        self.position
    }

    /// Whether `finish` will throw.
    #[inline(always)]
    pub fn has_overflowed(&self) -> bool {
        matches!(&self.state, State::Copying(builder) if builder.has_overflowed())
    }

    #[inline(never)]
    fn start_copying(&mut self) {
        let (mut builder, text) = (StringBuilder::new(), self.source.text());
        let capacity = (text.len() + text.len() / 8 + 16).min(text.len().max(MAX_LENGTH / 2));
        if text.is_latin1() {
            builder.reserve(capacity);
        } else {
            builder.write_utf16(capacity, |_| {});
        }
        if let State::ReplacedOnce { start, replacement } = self.state {
            builder.push_text(text.slice(0..start));
            replacement.inspect(|it| it.append_to(&mut builder));
        }
        self.state = State::Copying(builder);
    }

    /// `write` appends the replacement. Panics unless the range is inside the source and not before `position`.
    #[inline(always)]
    pub fn replace_with(&mut self, range: Range<usize>, write: impl FnOnce(&mut StringBuilder)) {
        if !matches!(self.state, State::Copying(_)) {
            self.start_copying();
        }
        if let State::Copying(builder) = &mut self.state {
            builder.push_text(self.source.text().slice(self.position..range.start));
            write(builder);
        }
        self.position = range.end;
    }

    #[inline(always)]
    fn replace_or_remove(&mut self, range: Range<usize>, replacement: Option<Gc<JsString>>) {
        if let State::Unchanged = self.state {
            let start = range.start;
            self.state = State::ReplacedOnce { start, replacement };
            self.position = range.end;
        } else {
            self.replace_with(range, |builder| {
                replacement.inspect(|it| it.append_to(builder));
            });
        }
    }

    #[inline(always)]
    pub fn replace(&mut self, range: Range<usize>, replacement: Gc<JsString>) {
        self.replace_or_remove(range, Some(replacement));
    }

    #[inline(always)]
    pub fn remove(&mut self, range: Range<usize>) {
        self.replace_or_remove(range, None);
    }

    /// `None` if nothing has been replaced.
    #[inline]
    pub fn finish(self, cx: &Cx) -> JsResult<Option<Gc<JsString>>> {
        match self.state {
            State::Unchanged => Ok(None),
            State::ReplacedOnce { start, replacement } => {
                let replacement = replacement.unwrap_or_else(|| cx.small_strings.empty());
                (self.source.replaced(cx, start..self.position, replacement)).map(Some)
            }
            State::Copying(mut builder) => {
                builder.push_text(self.source.text().slice_from(self.position));
                cx.finish_string(builder).map(Some)
            }
        }
    }
}

impl StringView {
    /// With `replacement` in place of the range. Panics if that is not inside the view.
    #[inline]
    pub fn replaced(
        &self,
        cx: &Cx,
        range: Range<usize>,
        replacement: Gc<JsString>,
    ) -> JsResult<Gc<JsString>> {
        let text = self.text();
        if text.len() - range.len() + (replacement.len() as usize) < MIN_ROPE_LENGTH
            && (range.start != 0 && range.end != text.len())
            && let Some(replacement) = replacement.try_view()
        {
            let (before, after) = (text.slice(0..range.start), text.slice_from(range.end));
            let copy = StringRef::try_concat(&[before, replacement.text(), after]);
            return Ok(JsString::new(cx, cx.or_out_of_memory(copy)?));
        }
        let before = self.substring(cx, 0..range.start);
        let after = self.substring(cx, range.end..text.len());
        JsString::concat3(cx, before, replacement, after)
    }

    /// The same with what `write` appends.
    #[inline(always)]
    pub(crate) fn replaced_with(
        &self,
        cx: &Cx,
        range: Range<usize>,
        write: impl FnOnce(&mut StringBuilder),
    ) -> JsResult<Gc<JsString>> {
        const MAX_COPIED_LENGTH: usize = 512;
        let text = self.text();
        let is_short = text.len() <= MAX_COPIED_LENGTH;
        let written = StringBuilder::on_stack::<MAX_COPIED_LENGTH, _>(|out| {
            if is_short {
                out.push_text(text.slice(0..range.start));
            }
            write(out);
            if is_short {
                out.push_text(text.slice_from(range.end));
            }
            out.take()
        });
        let written = JsString::new(cx, cx.or_out_of_memory(written)?);
        if is_short {
            return Ok(written);
        }
        self.replaced(cx, range, written)
    }
}
