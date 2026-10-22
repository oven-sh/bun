//! `DeclaredTypesForTesting` of `bun:internal-for-testing`: see `DeclaredTypesForTesting.classes.ts`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::generated_classes::js_DeclaredTypesForTesting as js;

#[bun_jsc::JsClass]
pub(crate) struct DeclaredTypesForTesting;

impl DeclaredTypesForTesting {
    pub(crate) fn constructor(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<Self>> {
        Ok(Box::new(Self))
    }

    pub(crate) fn answer_operand(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        frame.argument(0)
    }

    pub(crate) fn static_answer_operand(_global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        frame.argument(0)
    }

    pub(crate) fn hold(&self, global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        js::held_set_cached(frame.this(), global, frame.argument(0));
        JSValue::UNDEFINED
    }

    pub(crate) fn get_held(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::held_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }
}

pub(crate) fn get_class(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(js::get_constructor(global))
}
