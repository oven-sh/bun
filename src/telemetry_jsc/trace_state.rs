use bun_jsc::bindgen::{JsHeap, JsPayload, JsWrapper};
use bun_telemetry::propagation::{tracestate_members, tracestate_with};

/// `@opentelemetry/api`'s `TraceState`, kept as its header.
pub(crate) struct TraceState(Box<[u8]>);

impl TraceState {
    pub(crate) fn new(header: &[u8]) -> TraceState {
        TraceState(header.into())
    }

    pub(crate) fn get(&self, key: &[u8]) -> Option<&[u8]> {
        tracestate_members(&self.0).find_map(|(k, value)| (k == key).then_some(value))
    }

    pub(crate) fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        key: &[u8],
        value: &[u8],
    ) -> JsWrapper<'a, Self> {
        TraceState(tracestate_with(&self.0, key, Some(value)).into()).into_js(heap)
    }

    pub(crate) fn unset<'a>(&self, heap: &JsHeap<'a>, key: &[u8]) -> JsWrapper<'a, Self> {
        TraceState(tracestate_with(&self.0, key, None).into()).into_js(heap)
    }

    pub(crate) fn serialize(&self) -> &[u8] {
        &self.0
    }
}
