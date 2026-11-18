//! The operations on iterator objects of ECMA-262, to the letter.

use bun_engine_text::{names, symbols};

use crate::caches::get_megamorphic;
use crate::{Cx, Gc, JsObject, JsResult, PropertyOffset, RepeatedCall, Thrown, Value, errors};

pub const ITERATOR_RESULT_VALUE_OFFSET: PropertyOffset = PropertyOffset::new(0);
pub const ITERATOR_RESULT_DONE_OFFSET: PropertyOffset = PropertyOffset::new(1);

/// Decides what errors say.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Caller {
    Library,
    Syntax,
}

impl Caller {
    #[inline(always)]
    pub(super) fn call<const COUNT: usize>(
        self,
        cx: &mut Cx,
        method: Value,
        this: Value,
        arguments: [Value; COUNT],
    ) -> JsResult<Value> {
        if self == Caller::Library && !method.is_callable() {
            return Err(cx.throw_type_error(errors::TYPE_ERROR));
        }
        RepeatedCall::new(cx, method).call(cx, this, arguments)
    }

    #[inline(always)]
    pub(super) fn next<const COUNT: usize>(
        self,
        cx: &mut Cx,
        iterator: Value,
        next: Value,
        arguments: [Value; COUNT],
    ) -> JsResult<Gc<JsObject>> {
        let result = self.call(cx, next, iterator, arguments)?;
        result
            .as_object()
            .ok_or_else(|| cx.throw_type_error(errors::ITERATOR_RESULT_NOT_OBJECT))
    }

    pub(super) fn close(self, cx: &mut Cx, iterator: Value) -> JsResult<()> {
        let method = get_megamorphic(cx, iterator, names::r#return)?;
        if !method.is_undefined_or_null() {
            self.next(cx, iterator, method, [])?;
        }
        Ok(())
    }
}

#[cold]
pub fn throw_not_iterable(cx: &Cx, value: Value) -> Thrown {
    cx.throw_type_error(match value {
        Value::NULL => "null is not an object",
        Value::UNDEFINED => "undefined is not an object",
        Value::TRUE => "true is not iterable",
        Value::FALSE => "false is not iterable",
        _ if value.is_number() => "number is not iterable",
        _ if value.is_object() => "{} is not iterable",
        _ => "value is not iterable",
    })
}

/// GetMethod(value, %Symbol.iterator%)
pub fn iterator_method(cx: &mut Cx, value: Value) -> JsResult<Option<Value>> {
    let message = "Symbol.iterator property should be callable";
    value.get_method(cx, symbols::iterator, message)
}

/// IteratorNext
pub fn iterator_next(
    cx: &mut Cx,
    iterator: Value,
    next: Value,
    argument: Option<Value>,
) -> JsResult<Gc<JsObject>> {
    match argument {
        Some(argument) => Caller::Library.next(cx, iterator, next, [argument]),
        None => Caller::Library.next(cx, iterator, next, []),
    }
}

/// IteratorComplete
#[inline(always)]
pub fn iterator_complete(cx: &mut Cx, result: &JsObject) -> JsResult<bool> {
    let done = if result.shape() == cx.iterator_result_shape() {
        // SAFETY: a slot of that shape.
        unsafe { result.get_direct_unchecked(ITERATOR_RESULT_DONE_OFFSET) }
    } else {
        get_megamorphic(cx, result.as_value(), names::done)?
    };
    Ok(done.to_boolean(cx))
}

/// IteratorValue
#[inline(always)]
pub fn iterator_value(cx: &mut Cx, result: &JsObject) -> JsResult<Value> {
    if result.shape() == cx.iterator_result_shape() {
        // SAFETY: as above.
        return Ok(unsafe { result.get_direct_unchecked(ITERATOR_RESULT_VALUE_OFFSET) });
    }
    get_megamorphic(cx, result.as_value(), names::value)
}

/// IteratorClose with a normal completion.
pub fn iterator_close(cx: &mut Cx, iterator: Value) -> JsResult<()> {
    Caller::Library.close(cx, iterator)
}

/// What `return` does or throws is dropped, unless execution ends.
pub fn iterator_close_quietly(cx: &mut Cx, iterator: Value) -> JsResult<()> {
    if let Err(thrown) = iterator_close(cx, iterator) {
        cx.catch(thrown)?;
    }
    Ok(())
}

/// IteratorClose with a throw completion.
#[cold]
pub fn iterator_close_on_throw(cx: &mut Cx, iterator: Value, thrown: Thrown) -> Thrown {
    let closed = cx.catch(thrown).and_then(|exception| {
        iterator_close_quietly(cx, iterator)?;
        Ok(exception)
    });
    match closed {
        Ok(exception) => cx.throw_exception(exception),
        Err(termination) => termination,
    }
}
