//! Snapshots of the heap.

use bun_engine_bytecode::Visibility;
use bun_engine_inspector::profiling::{HeapProfiler, SnapshotKind, count_cells};
use bun_engine_macros::cell;
use bun_engine_vm::{Field, Intrinsic, JsFunction, JsObjectInit, Shape, ShapeSpec, json};

use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("generateHeapSnapshot", snapshot, 0),
    ("generateHeapSnapshotForGCDebugging", debugging_snapshot, 0),
];

pub(super) const VM_FUNCTIONS: Functions = &[
    ("v8HeapSnapshot", v8_snapshot, 1),
    ("objectTypeCounts", object_type_counts, 0),
    ("getHiddenValue", hidden_value, 1),
    ("setHiddenValue", set_hidden_value, 2),
];

fn snapshot_text(cx: &mut Cx, kind: SnapshotKind) -> JsResult<StringRef> {
    let json = HeapProfiler::of(cx).snapshot(&mut cx.into(), kind, &|_| true);
    cx.or_out_of_memory(json)
}

#[native_abi]
fn snapshot(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let text = snapshot_text(cx, SnapshotKind::Inspector)?;
    json::parse(cx, text.text().into())
}

#[native_abi]
fn debugging_snapshot(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let json = snapshot_text(cx, SnapshotKind::GcDebugging)?;
    Ok(JsString::new(cx, json).into())
}

/// By way of UTF-8 if the argument is true.
#[native_abi]
fn v8_snapshot(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let profiler = HeapProfiler::of(cx);
    let json = if frame.argument(0).is_true() {
        (profiler.v8_snapshot_bytes(&mut cx.into()))
            .and_then(|bytes| StringRef::try_from_utf8(&bytes))
            .map(Option::unwrap_or_default)
    } else {
        profiler.v8_snapshot(&mut cx.into())
    };
    Ok(JsString::new(cx, cx.or_out_of_memory(json)?).into())
}

#[native_abi]
fn object_type_counts(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let counts = cx.new_object_with_null_prototype();
    for (name, count) in count_cells(cx) {
        super::put(cx, &counts, name.as_str(), count.into());
    }
    Ok(counts.into())
}

/// Refers to a value that is no property. It is a constructor that cannot be called.
#[cell(ops)]
struct SimpleObject {
    base: JsObject,
    pub(self) hidden_value: Field<Value>,
}

#[bun_engine_macros::object_ops]
impl SimpleObject {
    fn construct_data(&self) -> bun_engine_vm::CallData {
        bun_engine_vm::CallData::native(create_simple_object)
    }
}

#[native_abi]
fn create_simple_object(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let spec = ShapeSpec::of::<SimpleObject>();
    let shape = Shape::create(cx, Some(cx.global()), Value::NULL, spec);
    let object = cx.allocate::<SimpleObject>(SimpleObjectInit {
        base: JsObjectInit::new(cx, shape),
        hidden_value: Value::UNDEFINED,
    });
    Ok(object.into())
}

pub(super) fn simple_object_constructor(cx: &Cx) -> Value {
    let (name, create) = (
        StringRef::from_literal("SimpleObject"),
        create_simple_object,
    );
    let (intrinsic, visibility) = (Intrinsic::None, Visibility::Public);
    JsFunction::native_with(cx, 0, &name, create, create, intrinsic, visibility).into()
}

fn simple_object(cx: &Cx, frame: &CallFrame, caller: &str) -> JsResult<Gc<SimpleObject>> {
    (frame.argument(0).downcast())
        .ok_or_else(|| cx.throw_type_error(format_args!("Invalid use of {caller} test function")))
}

#[native_abi]
fn hidden_value(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(simple_object(cx, frame, "getHiddenValue")?.hidden_value())
}

#[native_abi]
fn set_hidden_value(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    simple_object(cx, frame, "setHiddenValue")?.set_hidden_value(frame.argument(1));
    Ok(Value::UNDEFINED)
}
