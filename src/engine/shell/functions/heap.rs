//! The collector.

use bun_engine_vm::JsFinalizationRegistry;
use bun_engine_vm::heap::{Request, Scope};

use super::{put, return_undefined};
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("gc", gc, 0),
    ("fullGC", full_gc, 0),
    ("idleFullGC", idle_full_gc, 0),
    ("edenGC", eden_gc, 0),
    ("gcHeapSize", heap_size, 0),
    ("heapCapacity", heap_capacity, 0),
    ("memoryUsageStatistics", memory_usage_statistics, 0),
    ("MemoryFootprint", memory_footprint, 0),
    ("resetMemoryPeak", return_undefined, 0),
    ("mallocInALoop", return_undefined, 0),
    ("releaseWeakRefs", clear_kept_objects, 0),
    (
        "finalizationRegistryLiveCount",
        count_registrations::<true>,
        0,
    ),
    (
        "finalizationRegistryDeadCount",
        count_registrations::<false>,
        0,
    ),
];

#[native_abi]
pub(super) fn gc(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.heap.collect_and_sweep(Some(Scope::Full));
    Ok(cx.heap.sizes().after_last_full.into())
}

#[native_abi]
fn full_gc(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.heap.collect(Some(Scope::Full));
    Ok(cx.heap.sizes().after_last_full.into())
}

#[native_abi]
fn idle_full_gc(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.heap.request_collection(Request {
        scope: Some(Scope::Full),
        is_idle: true,
        did_finish: None,
    });
    cx.heap.collect_if_necessary();
    Ok(cx.heap.sizes().after_last_full.into())
}

#[native_abi]
pub(super) fn eden_gc(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.heap.collect(Some(Scope::Eden));
    Ok(cx.heap.sizes().after_last_eden.into())
}

/// So many allocations, or never, and counts on from the second argument. Returns how far it had counted.
#[native_abi]
pub(super) fn collect_every(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let period = frame.argument(0).to_uint32(cx)?;
    let count = frame.argument(1).to_uint32(cx)?;
    Ok(cx.heap.set_stress_period(period, count).into())
}

#[native_abi]
pub(super) fn clear_kept_objects(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.clear_kept_objects();
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn count_registrations<const LIVE: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(registry) = frame.argument(0).downcast::<JsFinalizationRegistry>() else {
        return Err(cx.throw_type_error("first argument is not a finalizationRegistry"));
    };
    let registrations = registry.snapshot(cx);
    let matching = registrations
        .iter()
        .filter(|it| it.target.is_some() == LIVE);
    Ok(matching.count().into())
}

#[native_abi]
fn heap_size(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(cx.heap.size().into())
}

#[native_abi]
fn heap_capacity(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(cx.heap.capacity().into())
}

#[native_abi]
fn memory_usage_statistics(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let object = cx.new_object();
    for (name, number) in [
        ("heapSize", cx.heap.size()),
        ("heapCapacity", cx.heap.capacity()),
        ("extraMemorySize", cx.heap.extra_memory_size()),
        ("objectCount", cx.heap.object_count()),
    ] {
        put(cx, &object, name, number.into());
    }
    Ok(object.into())
}

/// The current and the highest number of resident bytes. Zero where the system has no such file.
pub(crate) fn footprint() -> (u64, u64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let bytes = |key: &str| {
        let value = status.lines().find_map(|line| line.strip_prefix(key));
        let kilobytes = value.and_then(|it| it.split_whitespace().next()?.parse::<u64>().ok());
        kilobytes.unwrap_or(0) * 1024
    };
    (bytes("VmRSS:"), bytes("VmHWM:"))
}

#[native_abi]
fn memory_footprint(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let (object, (current, peak)) = (cx.new_object_with_null_prototype(), footprint());
    put(cx, &object, "current", current.into());
    put(cx, &object, "peak", peak.into());
    Ok(object.into())
}
