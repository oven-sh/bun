//! Where the time goes.

use bun_engine_inspector::profiling::SamplingProfiler;
use bun_engine_vm::json;

use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("platformSupportsSamplingProfiler", is_supported, 0),
    ("startSamplingProfiler", start, 0),
    ("samplingProfilerStackTraces", take_traces, 0),
];

#[native_abi]
fn is_supported(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::TRUE)
}

#[native_abi]
fn start(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    SamplingProfiler::start(cx);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn take_traces(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    if !SamplingProfiler::exists(cx) {
        return Err(cx.throw_error(ErrorType::Error, "Sampling profiler was never started"));
    }
    let text = cx.or_out_of_memory(SamplingProfiler::take_traces_as_json(cx))?;
    json::parse(cx, text.text().into())
}
