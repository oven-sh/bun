//! The methods that ECMA-402 and UAX #15 define.

use bun_engine_intl::{Case, normalize_string, to_locale_case};
use bun_engine_vm::errors::TYPE_ERROR;

use super::this_string;
use crate::prelude::*;

#[native_abi]
pub(super) fn locale_compare(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "String.prototype.localeCompare requires that |this| not be null or undefined";
    let string = this_string(cx, frame, message)?;
    let that = frame.argument(0).to_string(cx)?;
    bun_engine_intl::locale_compare(cx, string, that, frame.argument(1), frame.argument(2))
}

#[native_abi]
pub(super) fn to_locale_lower_case(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    to_locale_case(cx, string, frame.argument(0), Case::Lower).map(Into::into)
}

#[native_abi]
pub(super) fn to_locale_upper_case(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    to_locale_case(cx, string, frame.argument(0), Case::Upper).map(Into::into)
}

#[native_abi]
pub(super) fn normalize(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let string = this_string(cx, frame, TYPE_ERROR)?;
    normalize_string(cx, string, frame.argument(0)).map(Into::into)
}
