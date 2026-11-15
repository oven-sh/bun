//! One-line `expect()` matchers whose body is just a predicate or a delegate
//! to a shared helper. Grouped here so each matcher doesn't occupy its own
//! file.

use super::{Expect, OrderingRelation};
use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

// ── unary predicates: expect(x).toBe<Kind>() ───────────────────────────────
crate::unary_predicate_matcher!(to_be_array, "toBeArray", |v| v.js_type().is_array());
crate::unary_predicate_matcher!(to_be_boolean, "toBeBoolean", |v| v.is_boolean());
crate::unary_predicate_matcher!(to_be_date, "toBeDate", |v| v.is_date());
crate::unary_predicate_matcher!(to_be_defined, "toBeDefined", |v| !v.is_undefined());
crate::unary_predicate_matcher!(to_be_false, "toBeFalse", |v| v.is_boolean()
    && !v.to_boolean());
crate::unary_predicate_matcher!(to_be_falsy, "toBeFalsy", |v| !v.to_boolean());
crate::unary_predicate_matcher!(to_be_function, "toBeFunction", |v| v.is_callable());
crate::unary_predicate_matcher!(to_be_integer, "toBeInteger", |v| v.is_any_int());
crate::unary_predicate_matcher!(to_be_nan, "toBeNaN", |v| v.is_number()
    && v.as_number().is_nan());
crate::unary_predicate_matcher!(to_be_nil, "toBeNil", |v| v.is_undefined_or_null());
crate::unary_predicate_matcher!(to_be_null, "toBeNull", |v| v.is_null());
crate::unary_predicate_matcher!(to_be_number, "toBeNumber", |v| v.is_number());
crate::unary_predicate_matcher!(to_be_string, "toBeString", |v| v.is_string());
crate::unary_predicate_matcher!(to_be_symbol, "toBeSymbol", |v| v.is_symbol());
crate::unary_predicate_matcher!(to_be_true, "toBeTrue", |v| v.is_boolean() && v.to_boolean());
crate::unary_predicate_matcher!(to_be_truthy, "toBeTruthy", |v| v.to_boolean());
crate::unary_predicate_matcher!(to_be_undefined, "toBeUndefined", |v| v.is_undefined());

crate::unary_predicate_matcher!(to_be_finite, "toBeFinite", |v| v.is_number() && {
    let n = v.as_number();
    n.is_finite() && !n.is_nan()
});
crate::unary_predicate_matcher!(to_be_negative, "toBeNegative", |v| v.is_number() && {
    let n = v.as_number();
    n.round() < 0.0 && !n.is_infinite() && !n.is_nan()
});
crate::unary_predicate_matcher!(to_be_positive, "toBePositive", |v| v.is_number() && {
    let n = v.as_number();
    n.round() > 0.0 && !n.is_infinite() && !n.is_nan()
});

// ── numeric ordering: toBe{Greater,Less}Than[OrEqual] ──────────────────────
impl Expect {
    pub(crate) fn to_be_greater_than(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.numeric_ordering_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toBeGreaterThan", OrderingRelation::Gt)
    }
    pub(crate) fn to_be_greater_than_or_equal(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.numeric_ordering_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toBeGreaterThanOrEqual", OrderingRelation::Ge)
    }
    pub(crate) fn to_be_less_than(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.numeric_ordering_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toBeLessThan", OrderingRelation::Lt)
    }
    pub(crate) fn to_be_less_than_or_equal(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.numeric_ordering_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toBeLessThanOrEqual", OrderingRelation::Le)
    }
}

// ── string affix: toStartWith / toEndWith / toInclude ──────────────────────
impl Expect {
    pub(crate) fn to_start_with(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.run_string_affix_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toStartWith", "start with", strings::starts_with)
    }
    pub(crate) fn to_end_with(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.run_string_affix_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toEndWith", "end with", strings::ends_with)
    }
    pub(crate) fn to_include(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.run_string_affix_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toInclude", "include", strings::contains)
    }
}
