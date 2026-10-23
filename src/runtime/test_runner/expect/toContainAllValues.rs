use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::{Expect, ExpectedArray, ContainMsgs, ContainOutcome};

impl Expect {
    pub(crate) fn to_contain_all_values(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.contain_matcher(cx.global(), this_value.to_js(), expected.to_js(), "toContainAllValues", ExpectedArray::BeforeValue,
            ContainMsgs { verb: "contain all values", not_verb: "contain all values" },
            |g, value, expected| {
                if value.is_undefined_or_null() { return Ok(ContainOutcome::pass(false)); }
                let values = value.values(g)?;
                if values.get_length(g)? != expected.get_length(g)? { return Ok(ContainOutcome::pass(false)); }
                // jest-extended only walks values -> expected; the reverse walk keeps { a: 1, b: 1 } from matching [1, 2].
                let pass = each_has_match(g, values, expected, |object_value, item| object_value.jest_deep_equals(item, g))?
                    && each_has_match(g, expected, values, |item, object_value| object_value.jest_deep_equals(item, g))?;
                Ok(ContainOutcome::pass(pass))
            })
    }
}

/// Whether `matches(item, candidate)` holds for each element of the array `items` with some element of the array `candidates`.
fn each_has_match(
    g: &JSGlobalObject,
    items: JSValue,
    candidates: JSValue,
    matches: impl Fn(JSValue, JSValue) -> JsResult<bool>,
) -> JsResult<bool> {
    let mut items = items.array_iterator(g)?;
    'items: while let Some(item) = items.next()? {
        let mut candidates = candidates.array_iterator(g)?;
        while let Some(candidate) = candidates.next()? {
            if matches(item, candidate)? { continue 'items; }
        }
        return Ok(false);
    }
    Ok(true)
}
