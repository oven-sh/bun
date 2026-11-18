use bun_engine_text::{Text, names};

use super::receiver::Receiver;
use crate::{
    CaptureBuffer, Captures, Cx, Gc, JsArray, JsObject, JsResult, JsString, Match, PlainRegExp,
    RegExp, RegExpObject, Value,
};

/// AdvanceStringIndex
#[inline]
pub fn advance_string_index(text: Text<'_>, index: u64, is_unicode_aware: bool) -> u64 {
    let is_pair = is_unicode_aware
        && index < text.len() as u64
        && text.code_point_at(index as usize) > 0xffff;
    index + 1 + u64::from(is_pair)
}

impl RegExp {
    #[inline(always)]
    fn exec_to_array(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        start: u32,
    ) -> JsResult<Option<(Gc<JsArray>, Match)>> {
        let subject = string.view(cx)?;
        if self.is_known_to_have_no_groups() {
            let Some(found) = self.find(cx, &subject, start)? else {
                return Ok(None);
            };
            let offsets = [found.start, found.end];
            let array = self.match_array(cx, string, &subject, Captures::new(&offsets))?;
            return Ok(Some((array, found)));
        }
        let mut buffer = CaptureBuffer::default();
        let Some(captures) = self.exec(cx, &subject, start, &mut buffer)? else {
            return Ok(None);
        };
        let array = self.match_array(cx, string, &subject, captures)?;
        Ok(Some((array, captures.whole())))
    }

    /// What RegExpBuiltinExec comes to if it is neither global nor sticky.
    #[inline]
    pub(crate) fn exec_once(&self, cx: &Cx, string: Gc<JsString>) -> JsResult<Option<Gc<JsArray>>> {
        Ok(exec_with_range((cx, self), string)?.map(|(array, _)| array))
    }

    #[inline(always)]
    pub(crate) fn find_and_record(
        &self,
        cx: &Cx,
        string: Gc<JsString>,
        start: u32,
    ) -> JsResult<Option<Match>> {
        let found = self.find(cx, &string.view(cx)?, start)?;
        if let Some(found) = found {
            cx.global().record_match(self, string, found);
        }
        Ok(found)
    }

    /// What `Symbol.search` returns.
    #[inline]
    pub fn search(&self, cx: &Cx, string: Gc<JsString>) -> JsResult<i32> {
        let found = self.find_and_record(cx, string, 0)?;
        Ok(found.map_or(-1, |found| found.start as i32))
    }
}

#[inline(always)]
pub(super) fn exec_with_range(
    mut receiver: impl Receiver,
    string: Gc<JsString>,
) -> JsResult<Option<(Gc<JsArray>, Match)>> {
    let result = receiver.with_last_index_updated(
        string,
        #[inline(always)]
        |cx, regexp, start| {
            let result = regexp.exec_to_array(cx, string, start)?;
            Ok(result.map(|result| (result, Gc::from(regexp))))
        },
        |((_, found), _)| found.end,
    )?;
    Ok(result.map(|(result, regexp)| {
        (receiver.cx().global()).record_match(&regexp, string, result.1);
        result
    }))
}

#[inline(always)]
fn test(mut receiver: impl Receiver, string: Gc<JsString>) -> JsResult<bool> {
    let found = receiver.with_last_index_updated(
        string,
        #[inline(always)]
        |cx, regexp, start| regexp.find_and_record(cx, string, start),
        |found| found.end,
    )?;
    Ok(found.is_some())
}

impl RegExpObject {
    /// RegExpBuiltinExec
    #[inline]
    pub fn exec(&self, cx: &mut Cx, string: Gc<JsString>) -> JsResult<Value> {
        let result = exec_with_range((cx, self), string)?;
        Ok(result.map_or(Value::NULL, |(array, _)| array.into()))
    }

    /// The same, without the array.
    #[inline]
    pub fn test(&self, cx: &mut Cx, string: Gc<JsString>) -> JsResult<bool> {
        test((cx, self), string)
    }
}

impl PlainRegExp<'_> {
    #[inline]
    pub fn exec(self, cx: &Cx, string: Gc<JsString>) -> JsResult<Option<Gc<JsArray>>> {
        Ok(exec_with_range((cx, self), string)?.map(|(array, _)| array))
    }

    #[inline]
    pub fn test(self, cx: &Cx, string: Gc<JsString>) -> JsResult<bool> {
        test((cx, self), string)
    }

    /// What `Symbol.match` does with a pristine object.
    #[inline]
    pub fn matches(self, cx: &Cx, string: Gc<JsString>) -> JsResult<Option<Gc<JsArray>>> {
        let regexp = self.regexp();
        if !regexp.is_global() {
            return self.exec(cx, string);
        }
        self.store_last_index(0);
        regexp.match_all(cx, string)
    }
}

/// RegExpExec. `None` is null.
pub fn regexp_exec(
    cx: &mut Cx,
    regexp: Gc<JsObject>,
    string: Gc<JsString>,
) -> JsResult<Option<Gc<JsObject>>> {
    let (exec, builtin) = (regexp.get(cx, names::exec)?, cx.regexp_prototype_exec());
    let result = if exec != builtin.into() && exec.is_callable() {
        cx.call(exec, regexp.into(), &[string.into()])?
    } else if let Some(regexp) = regexp.downcast::<RegExpObject>() {
        regexp.exec(cx, string)?
    } else {
        cx.call(builtin.into(), regexp.into(), &[string.into()])?
    };
    if !result.is_null() && !result.is_object() {
        return Err(cx.throw_type_error("The result of RegExp exec must be null or an object"));
    }
    Ok(result.as_object())
}
