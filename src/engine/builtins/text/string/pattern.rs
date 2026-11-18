//! The methods that leave it to their argument what to do, if it is an object with a method for that.

use bun_engine_vm::ReplaceMode;

use crate::prelude::*;
use crate::text::regexp::string_methods::{delegate_replace, delegate_replace_all, delegate_split};

#[inline(always)]
fn replace_in(cx: &mut Cx, frame: &CallFrame, mode: ReplaceMode) -> JsResult<Value> {
    let (this, search, replacement) = (frame.this_value(), frame.argument(0), frame.argument(1));
    if let Some(pattern) = search.as_object()
        && let Some(result) = match mode {
            ReplaceMode::First => delegate_replace(cx, this, pattern, replacement)?,
            ReplaceMode::All => delegate_replace_all(cx, this, pattern, replacement)?,
        }
    {
        return Ok(result);
    }
    let string = this.to_string(cx)?;
    let search = search.to_string(cx)?;
    string
        .replace(cx, mode, search, replacement)
        .map(Into::into)
}

#[native_abi]
pub(super) fn replace(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.replace requires that |this| not be null or undefined";
    frame.this_value().require_object_coercible(cx, message)?;
    replace_in(cx, frame, ReplaceMode::First)
}

#[native_abi]
pub(super) fn replace_all(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.replaceAll requires |this| not to be null nor undefined";
    frame.this_value().require_object_coercible(cx, message)?;
    replace_in(cx, frame, ReplaceMode::All)
}

#[native_abi]
pub(super) fn split(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.split requires that |this| not be null or undefined";
    let this = frame.this_value().require_object_coercible(cx, message)?;
    let (separator, limit) = (frame.argument(0), frame.argument(1));
    if let Some(pattern) = separator.as_object()
        && let Some(result) = delegate_split(cx, this, pattern, limit)?
    {
        return Ok(result);
    }
    let string = this.to_string(cx)?;
    let limit = if limit.is_undefined() {
        u32::MAX
    } else {
        limit.to_uint32(cx)?
    };
    if separator.is_undefined() {
        let whole = [string.into()];
        return (cx.new_array_from(&whole[..limit.min(1) as usize])).map(Into::into);
    }
    let separator = separator.to_string(cx)?;
    string.split(cx, &separator, limit).map(Into::into)
}
