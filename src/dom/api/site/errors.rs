//! <https://webidl.spec.whatwg.org/#idl-DOMException-derived-interfaces>

use bun_jsc::bindgen::{DomException, to_js};

use super::*;

#[repr(C)]
pub(crate) struct DerivedException(pub(crate) DomException);

#[repr(C)]
pub(crate) struct QuotaExceededError {
    pub(crate) base: DerivedException,
    message: DomString,
    quota: Option<f64>,
    requested: Option<f64>,
}

impl QuotaExceededError {
    fn new(message: DomString, quota: Option<f64>, requested: Option<f64>) -> QuotaExceededError {
        QuotaExceededError {
            base: DerivedException(DomException::new(message.as_impl(), "QuotaExceededError")),
            message,
            quota,
            requested,
        }
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        message: DomString,
        options: &QuotaExceededErrorOptions,
    ) -> Result<'a, &'a Self> {
        let QuotaExceededErrorOptions { quota, requested } = *options;
        if [quota, requested].into_iter().flatten().any(|it| it < 0.0)
            || quota
                .zip(requested)
                .is_some_and(|(quota, requested)| requested < quota)
        {
            return Err(heap.range_error(format_args!(
                "The quota or the requested amount is invalid."
            )));
        }
        Ok(structure.create(heap, QuotaExceededError::new(message, quota, requested)))
    }

    pub(crate) fn get_quota(&self) -> Option<f64> {
        self.quota
    }

    pub(crate) fn get_requested(&self) -> Option<f64> {
        self.requested
    }

    pub(crate) fn serialize<'a>(&self, cx: Cx<'_, 'a>, _: bool) -> Result<'a, JsLocal<'a>> {
        let [quota, requested] =
            [self.quota, self.requested].map(|it| it.map_or(JSValue::NULL, JSValue::js_number));
        to_js::array(
            &cx.heap,
            [self.message.to_js(&cx.heap).to_js(), quota, requested],
            |heap, it| Ok(JsLocal::new(heap, it)),
        )
    }

    pub(crate) fn deserialize<'a>(cx: Cx<'_, 'a>, clone: JsLocal<'a>) -> Result<'a, &'a Self> {
        let mut at = |index| clone.to_js().get_index(cx.global(), index);
        let (message, quota, requested) = (at(0)?, at(1)?.get_number(), at(2)?.get_number());
        let message = DomString::from_js(cx, JsLocal::new(&cx.heap, message))?;
        Ok(quota_exceeded(&cx.heap, message, quota, requested))
    }
}

pub(crate) fn quota_exceeded<'a>(
    heap: &JsHeap<'a>,
    message: DomString,
    quota: Option<f64>,
    requested: Option<f64>,
) -> &'a QuotaExceededError {
    js_QuotaExceededError::create(heap, QuotaExceededError::new(message, quota, requested))
}
