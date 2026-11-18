//! What `Symbol.replace` does with a pristine object and a function.

use core::cell::Cell;
use core::ops::ControlFlow::Continue;

use bun_engine_regexp::Mode;
use bun_engine_text::StringImpl;
use smallvec::SmallVec;

use super::global_search::{check_termination, try_push};
use super::replace::exec_into;
use super::splice::Splicer;
use crate::{
    CallData, CaptureBuffer, Captures, Cx, Gc, ImmutableArray, JsResult, JsString, Match, RegExp,
    RegExpObject, RepeatedCall, StringView, Value, ValueVec, options,
};

/// What `RegExp.lastMatch` and its kin tell the function.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MatchOnRecord {
    Last,
    /// The one that it is called for, unless the string is long.
    Current,
}

/// The addresses of long strings that have been searched since the last collection, each with that of the pattern.
#[derive(Default)]
pub(super) struct RecentReplacements([Cell<(usize, usize)>; 16]);

impl RecentReplacements {
    /// False the first time, and if the cache would hold on to too much.
    fn is_repeated(&self, subject: &StringImpl, regexp: &RegExp) -> bool {
        const MAX_LENGTH: usize = 1 << 18;
        let key = (subject.address(), regexp.address());
        subject.len() <= MAX_LENGTH
            && self.0[((key.0 ^ key.1) >> 4) % self.0.len()].replace(key) == key
    }

    pub(super) fn clear(&self) {
        self.0.iter().for_each(|entry| entry.set((0, 0)));
    }
}

struct Replacer<'a, 'b> {
    function: RepeatedCall,
    string: Gc<JsString>,
    subject: &'a StringView,
    splicer: &'a mut Splicer<'b>,
}

impl Replacer<'_, '_> {
    #[inline(always)]
    fn replace(&mut self, cx: &mut Cx, regexp: &RegExp, captures: Captures<'_>) -> JsResult<()> {
        let (found, this) = (captures.whole(), Value::UNDEFINED);
        let (start, string) = (Value::int32(found.start as i32), self.string.into());
        let result = match captures.count() {
            1 => {
                let matched = self.subject.substring(cx, found.range()).into();
                self.function.call(cx, this, [matched, start, string])
            }
            2 if !regexp.has_named_groups() => {
                let matched = self.subject.substring(cx, found.range()).into();
                let group = captures.value(cx, self.subject, 1);
                self.function
                    .call(cx, this, [matched, group, start, string])
            }
            _ => self.call_with_groups(cx, regexp, captures),
        };
        self.insert(cx, found, result?)
    }

    #[inline(never)]
    fn call_with_groups(
        &self,
        cx: &mut Cx,
        regexp: &RegExp,
        captures: Captures<'_>,
    ) -> JsResult<Value> {
        let mut arguments = ValueVec::new();
        cx.or_out_of_memory(arguments.try_reserve(captures.count() + 3))?;
        for index in 0..captures.count() {
            arguments.push(captures.value(cx, self.subject, index));
        }
        arguments.push(captures.whole().start.into());
        arguments.push(self.string.into());
        if regexp.has_named_groups() {
            let groups = regexp.groups(cx, &arguments);
            arguments.push(groups);
        }
        cx.call(self.function.callee(), Value::UNDEFINED, &arguments)
    }

    #[inline(always)]
    fn insert(&mut self, cx: &mut Cx, found: Match, result: Value) -> JsResult<()> {
        let replacement = result.to_string(cx)?;
        self.splicer.replace(cx, found, replacement)
    }

    fn replace_while_searching(&mut self, cx: &mut Cx, regexp: &RegExp) -> JsResult<()> {
        let (subject, mut buffer) = (self.subject, CaptureBuffer::default());
        let mut start = 0;
        while let Some(captures) = regexp.exec(cx, subject, start, &mut buffer)? {
            (cx.global()).record_match(regexp, self.string, captures.whole());
            self.replace(cx, regexp, captures)?;
            start = regexp.start_after(subject.text(), captures.whole());
            check_termination(cx)?;
        }
        Ok(())
    }

    fn replace_after_searching(&mut self, cx: &mut Cx, regexp: &RegExp) -> JsResult<()> {
        let (mut pairs, mut last) = (SmallVec::<[[u32; 2]; 32]>::new(), None);
        let result = regexp.for_each_exec(cx, self.subject, 0, |captures| {
            last = Some(captures.whole());
            for &pair in captures.pairs() {
                try_push(cx, &mut pairs, pair)?;
            }
            Ok(Continue(()))
        });
        if let Some(last) = last {
            cx.global().record_match(regexp, self.string, last);
        }
        let _ = result?;
        for pairs in pairs.chunks_exact(regexp.group_count() + 1) {
            self.replace(cx, regexp, Captures::from_pairs(pairs))?;
        }
        Ok(())
    }

    /// For each match the arguments that come before the string.
    fn leading_arguments(
        &self,
        cx: &Cx,
        regexp: &RegExp,
        recurring: &StringImpl,
    ) -> JsResult<Option<Gc<ImmutableArray>>> {
        let cache = &cx.regexps().replace_cache;
        if let Some((all, Some(last))) = cache.get(cx, recurring, regexp) {
            cx.global().record_match(regexp, self.string, last);
            return Ok(Some(all));
        }
        let (mut values, mut last) = (ValueVec::new(), None);
        let result = regexp.for_each_exec(cx, self.subject, 0, |captures| {
            last = Some(captures.whole());
            cx.or_out_of_memory(values.try_reserve(captures.count() + 1))?;
            for index in 0..captures.count() {
                values.push(captures.value(cx, self.subject, index));
            }
            values.push(captures.whole().start.into());
            Ok(Continue(()))
        });
        let Some(found) = last else {
            return result.map(|_| None);
        };
        cx.global().record_match(regexp, self.string, found);
        let _ = result?;
        let all = cx.or_out_of_memory(ImmutableArray::try_from_values(cx, &values))?;
        cache.insert(recurring, regexp, all, last);
        Ok(Some(all))
    }

    fn replace_from_cache(
        &mut self,
        cx: &mut Cx,
        regexp: &RegExp,
        recurring: &StringImpl,
    ) -> JsResult<()> {
        let Some(all) = self.leading_arguments(cx, regexp, recurring)? else {
            return Ok(());
        };
        let (this, string) = (Value::UNDEFINED, self.string.into());
        let mut arguments = ValueVec::new();
        let values = all.values().unwrap_or_default();
        for leading in values.chunks_exact(regexp.group_count() + 2) {
            let start = leading[leading.len() - 1].to_bits() as u32;
            let end = start + leading[0].cast::<JsString>().len();
            let result = match *leading {
                [a, b] => self.function.call(cx, this, [a, b, string]),
                [a, b, c] => self.function.call(cx, this, [a, b, c, string]),
                _ => {
                    arguments.clear();
                    cx.or_out_of_memory(arguments.try_extend_from_slice(leading))?;
                    cx.or_out_of_memory(arguments.try_push(string))?;
                    cx.call(self.function.callee(), this, &arguments)
                }
            };
            self.insert(cx, Match { start, end }, result?)?;
        }
        all.keep_alive();
        Ok(())
    }

    #[inline(always)]
    fn replace_all(&mut self, cx: &mut Cx, regexp: &RegExp, record: MatchOnRecord) -> JsResult<()> {
        regexp.analyze(cx, self.subject.text(), Mode::Captures)?;
        let is_long = self.subject.text().len() >= options().threshold_for_replace_cache
            && !regexp.has_named_groups()
            && !CallData::for_call(self.function.callee()).is_native();
        let recurring = self.string.try_resolved().filter(|it| {
            is_long && (it.is_atom() || cx.regexps().recent_replacements.is_repeated(it, regexp))
        });
        if let Some(recurring) = recurring {
            self.replace_from_cache(cx, regexp, &recurring)
        } else if is_long || record == MatchOnRecord::Last {
            self.replace_after_searching(cx, regexp)
        } else {
            self.replace_while_searching(cx, regexp)
        }
    }
}

impl RegExpObject {
    pub fn replace_with_function(
        &self,
        cx: &mut Cx,
        string: Gc<JsString>,
        function: Value,
        on_record: MatchOnRecord,
    ) -> JsResult<Gc<JsString>> {
        let (regexp, subject) = (self.regexp(), &string.view(cx)?);
        let function = RepeatedCall::new(cx, function);
        Splicer::lend(subject, |splicer| {
            let mut replacer = Replacer {
                function,
                string,
                subject,
                splicer,
            };
            if regexp.is_global() {
                self.set_last_index(cx, 0)?;
                replacer.replace_all(cx, &regexp, on_record)?;
            } else if let Some(captures) = exec_into(
                (&mut *cx, self),
                string,
                subject,
                &mut CaptureBuffer::default(),
            )? {
                replacer.replace(cx, &regexp, captures)?;
            }
            Ok(splicer.finish(cx)?.unwrap_or(string))
        })
    }
}
