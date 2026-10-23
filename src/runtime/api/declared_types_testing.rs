//! `DeclaredTypesForTesting` of `bun:internal-for-testing`: see `declared_types_testing.bind.ts`.

use bun_jsc::bindgen::{JsHeap, JsLocal, JsWrapper};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::generated_bindgen::declared_types_testing::js_DeclaredTypesForTesting as js;

pub(crate) struct DeclaredTypesForTesting;

impl DeclaredTypesForTesting {
    pub(crate) fn constructor() -> Self {
        Self
    }

    pub(crate) fn answer_operand<'a>(&self, _heap: &JsHeap<'a>, value: JsLocal<'a>) -> JsLocal<'a> {
        value
    }

    pub(crate) fn static_answer_operand<'a>(_heap: &JsHeap<'a>, value: JsLocal<'a>) -> JsLocal<'a> {
        value
    }

    pub(crate) fn hold<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        value: JsLocal<'a>,
    ) {
        // SAFETY: storing a value runs no JavaScript.
        js::held_set_cached(this_value.to_js(), unsafe { heap.global() }, value.to_js());
    }

    pub(crate) fn get_held<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
    ) -> JsLocal<'a> {
        JsLocal::new(
            heap,
            js::held_get_cached(this_value.to_js()).unwrap_or(JSValue::UNDEFINED),
        )
    }
}

pub(crate) fn get_class(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    Ok(js::get_constructor(global))
}
