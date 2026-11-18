//! What `Symbol.split` does with a pristine object.

use core::ops::ControlFlow::{self, Break, Continue};

use bun_engine_regexp::program::UNSET;
use bun_engine_regexp::{Flags, Mode};
use bun_engine_text::{Atom, CodeUnit, StringImpl};

use super::global_search::{Matches, check_termination, try_push};
use super::match_all::MAX_UNCOUNTED;
use crate::{
    CaptureBuffer, Cx, ElementKind, Gc, ImmutableArray, JsArray, JsResult, JsString, Match, RegExp,
    Storage, StringView, Value, advance_string_index,
};

/// The pieces of a short list are likely to be used as keys.
const MAX_PIECES_AS_ATOMS: usize = 100;

const UNDEFINED: Match = Match {
    start: UNSET,
    end: UNSET,
};

#[derive(Clone, Copy)]
struct Splitter<'a> {
    /// Not sticky.
    separator: &'a RegExp,
    subject: &'a StringView,
    /// A search comes upon a match there, but trying at each index in turn stops short of it.
    records_match_at_end: bool,
    /// Where the next piece starts.
    start: u32,
    room: u32,
    last: Option<Match>,
}

impl Splitter<'_> {
    /// Gives `visit` the range of each element, until there are as many as the limit or `pause` says so after a
    /// separator. Continues if it has paused.
    #[inline(always)]
    fn run(
        &mut self,
        cx: &Cx,
        mut visit: impl FnMut(Match) -> JsResult<()>,
        mut pause: impl FnMut(u32) -> bool,
    ) -> JsResult<ControlFlow<()>> {
        let (separator, subject) = (self.separator, self.subject.text());
        let length = subject.len() as u32;
        let analysis = separator.analyze(cx, subject, Mode::Captures)?;
        if analysis.form.is_some() {
            let flow = separator.for_each_match(cx, self.subject, self.start, |found| {
                self.last = Some(found);
                let start = core::mem::replace(&mut self.start, found.end);
                visit(Match {
                    start,
                    end: found.start,
                })?;
                self.room -= 1;
                Ok(match self.room == 0 || pause(self.room) {
                    true => Break(()),
                    false => Continue(()),
                })
            })?;
            if flow.is_break() {
                return Ok(if self.room == 0 {
                    Break(())
                } else {
                    Continue(())
                });
            }
        } else {
            let is_unicode_aware = separator.flags().is_unicode_aware();
            let (mut buffer, mut from) = (CaptureBuffer::default(), self.start);
            while from < length
                && let Some(captures) = separator.exec(cx, self.subject, from, &mut buffer)?
            {
                let found = captures.whole();
                if found.start == length && !self.records_match_at_end {
                    break;
                }
                self.last = Some(found);
                if found.start == length {
                    break;
                }
                if found.end == self.start {
                    let index = found.start.into();
                    from = advance_string_index(subject, index, is_unicode_aware) as u32;
                    continue;
                }
                let before = Match {
                    start: self.start,
                    end: found.start,
                };
                (self.start, from) = (found.end, found.end);
                for index in 0..captures.count() {
                    visit(match index {
                        0 => before,
                        _ => captures.get(index).unwrap_or(UNDEFINED),
                    })?;
                    self.room -= 1;
                    if self.room == 0 {
                        return Ok(Break(()));
                    }
                }
                if pause(self.room) {
                    return Ok(Continue(()));
                }
                check_termination(cx)?;
            }
        }
        visit(Match {
            start: self.start,
            end: length,
        })?;
        self.room -= 1;
        Ok(Break(()))
    }
}

#[inline(always)]
fn element(cx: &Cx, subject: &StringView, piece: Match) -> Value {
    match piece {
        UNDEFINED => Value::UNDEFINED,
        _ => subject.substring(cx, piece.range()).into(),
    }
}

impl RegExp {
    pub fn split(&self, cx: &Cx, string: Gc<JsString>, limit: u32) -> JsResult<Gc<JsArray>> {
        let global = cx.global();
        let recurring = string.try_resolved().filter(|it| {
            limit == u32::MAX
                && !global.is_having_a_bad_time()
                && (it.is_atom() || string.is_read_again())
        });
        if let Some(recurring) = &recurring
            && let Some((pieces, last)) = cx.regexps().split_cache.get(cx, recurring, self)
        {
            if let Some(last) = last {
                global.record_match(self, string, last);
            }
            return JsArray::from_immutable(cx, pieces);
        }
        if limit == 0 {
            return Ok(cx.new_array());
        }
        let subject = string.view(cx)?;
        if string.is_empty() {
            let Some(found) = self.find(cx, subject.text(), 0)? else {
                return cx.new_array_from(&[string.into()]);
            };
            global.record_match(self, string, found);
            return Ok(cx.new_array());
        }
        let separator = match self.is_sticky() {
            true => RegExp::create(cx, &self.pattern(), self.flags() - Flags::STICKY)?,
            false => self.into(),
        };
        let mut splitter = Splitter {
            separator: &separator,
            subject: &subject,
            records_match_at_end: !self.is_sticky(),
            start: 0,
            room: limit,
            last: None,
        };
        let mut pieces = Matches::new();
        let flow = splitter.run(
            cx,
            |piece| try_push(cx, &mut pieces, piece),
            |room| (limit - room) as usize >= MAX_UNCOUNTED,
        );
        if let Some(last) = splitter.last {
            global.record_match(&separator, string, last);
        }
        if flow?.is_continue() {
            return split_into_many(cx, string, &subject, &pieces, splitter);
        }
        if let Some(recurring) = recurring.filter(|_| !self.is_sticky()) {
            return self.split_into_cache(cx, &recurring, &subject, &pieces, splitter.last);
        }
        let shape = global.array_shape(ElementKind::Contiguous);
        let array = JsArray::try_from_fn(cx, shape, [], pieces.len(), |index| {
            element(cx, &subject, pieces[index])
        });
        cx.or_out_of_memory(array)
    }

    #[inline(never)]
    fn split_into_cache(
        &self,
        cx: &Cx,
        string: &StringImpl,
        subject: &StringView,
        pieces: &[Match],
        last: Option<Match>,
    ) -> JsResult<Gc<JsArray>> {
        let looks_like_key = |piece: Match| {
            let first = subject.text().get(piece.start as usize);
            !piece.is_empty()
                && first.is_some_and(|it| it.is_ascii_alphabetic() || it.is(b'_') || it.is(b'$'))
        };
        let wants_atoms = string.is_atom() && pieces.len() < MAX_PIECES_AS_ATOMS;
        let shared = ImmutableArray::try_from_fn(cx, pieces.len(), |index| match pieces[index] {
            piece if wants_atoms && looks_like_key(piece) => {
                match Atom::try_new(subject.text().slice(piece.range())) {
                    Ok(atom) => JsString::from_name(cx, atom.name()).into(),
                    Err(_) => element(cx, subject, piece),
                }
            }
            piece => element(cx, subject, piece),
        });
        let shared = cx.or_out_of_memory(shared)?;
        cx.regexps().split_cache.insert(string, self, shared, last);
        JsArray::from_immutable(cx, shared)
    }
}

#[cold]
fn split_into_many(
    cx: &Cx,
    string: Gc<JsString>,
    subject: &StringView,
    first: &[Match],
    mut rest: Splitter<'_>,
) -> JsResult<Gc<JsArray>> {
    let mut counter = rest;
    let count = |room| first.len() + (rest.room - room) as usize;
    let is_too_long = |room| count(room) > Storage::MAX_VECTOR_LENGTH as usize;
    let flow = counter.run(cx, |_| Ok(()), is_too_long);
    if let Some(last) = counter.last {
        cx.global().record_match(counter.separator, string, last);
    }
    let _ = flow?;
    if is_too_long(counter.room) {
        return Err(cx.throw_out_of_memory());
    }
    let array = cx.new_array_with_capacity(ElementKind::Contiguous, count(counter.room))?;
    let append =
        |piece| cx.or_out_of_memory(array.append_values(cx, &[element(cx, subject, piece)]));
    first.iter().copied().try_for_each(append)?;
    rest.run(cx, append, |_| false).map(|_| array)
}
