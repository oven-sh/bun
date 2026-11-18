//! A look into WebAssembly.

use core::cell::RefCell;

use bun_engine_macros::cell;
use bun_engine_vm::{
    CellKind, JsDestructibleObject, JsObjectInit, JsPromise, Shape, ShapeSpec, StackVisitor,
    ValueVec, WasmTier, errors, options,
};
use bun_engine_wasm::{WasmStreamingCompiler, testing};

use super::{define_functions, string};
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("WebAssemblyMemoryMode", memory_mode, 1),
    ("createWebAssemblyMemoryWithMode", create_memory, 2),
    ("callerIsBBQOrOMGCompiled", caller_has_left_first_tier, 0),
];

pub(super) const VM_FUNCTIONS: Functions = &[
    ("omgTrue", caller_is_optimized, 0),
    ("createWasmStreamingParser", create_parser, 0),
    ("createWasmStreamingCompilerForCompile", stream::<false>, 0),
    (
        "createWasmStreamingCompilerForInstantiate",
        stream::<true>,
        0,
    ),
    ("wasmCanonicalTypeCount", canonical_type_count, 0),
    ("wasmStructFieldOffsets", struct_field_offsets, 1),
    ("wasmStructPayloadSize", struct_payload_size, 1),
];

const GUARDED: &str = "Signaling";
const CHECKED: &str = "BoundsChecking";

#[native_abi]
fn memory_mode(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match testing::is_guarded(frame.argument(0)) {
        Some(is_guarded) => Ok(string(cx, if is_guarded { GUARDED } else { CHECKED })),
        None => Err(cx.throw_type_error(
            "WebAssemblyMemoryMode expects either a WebAssembly.Memory or WebAssembly.Instance",
        )),
    }
}

#[native_abi]
fn create_memory(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let is_guarded = !(frame.argument(1).to_string_view(cx)?.text()).eq_ascii(CHECKED);
    testing::new_memory(cx, frame.argument(0), is_guarded)
}

/// Of the function that has called the running one as an import.
fn tier_of_caller(cx: &Cx) -> Option<WasmTier> {
    let callers = StackVisitor::frames(cx).skip(1).map_while(|it| it.wasm);
    callers.take(2).find_map(|it| it.tier)
}

/// Or has no other to go to.
#[native_abi]
fn caller_has_left_first_tier(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let is_last = !options().use_wasm_baseline_jit || !options().use_wasm_optimizer;
    match tier_of_caller(cx) {
        Some(tier) => Ok((tier != WasmTier::Baseline || is_last).into()),
        None => Err(cx.throw_error(ErrorType::Error, "caller isn't a wasm function")),
    }
}

#[native_abi]
fn caller_is_optimized(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let answer = tier_of_caller(cx).map_or(2, |tier| i32::from(tier != WasmTier::Baseline));
    Ok(answer.into())
}

#[native_abi]
fn canonical_type_count(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(testing::canonical_group_count().into())
}

fn layout_of_struct(cx: &Cx, frame: &CallFrame) -> JsResult<(Vec<u32>, u32)> {
    testing::layout_of_struct(frame.argument(0))
        .ok_or_else(|| cx.throw_type_error("argument is not a WebAssembly GC struct"))
}

#[native_abi]
fn struct_field_offsets(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let mut offsets = ValueVec::new();
    for offset in layout_of_struct(cx, frame)?.0 {
        offsets.push(offset.into());
    }
    Ok(cx.new_array_from(&offsets)?.into())
}

#[native_abi]
fn struct_payload_size(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(layout_of_struct(cx, frame)?.1.into())
}

fn base_for<T: CellKind>(cx: &Cx) -> JsObjectInit {
    let shape = Shape::create(cx, Some(cx.global()), Value::NULL, ShapeSpec::of::<T>());
    JsObjectInit::new(cx, shape)
}

#[cell(name = "WasmStreamingParser")]
struct Parser {
    base: JsDestructibleObject,
    pieces: RefCell<Vec<Vec<u8>>>,
}

#[native_abi]
fn create_parser(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let parser = cx.allocate::<Parser>(ParserInit {
        base: base_for::<Parser>(cx),
        pieces: RefCell::default(),
    });
    let methods: Functions = &[("addBytes", add_bytes, 0), ("finalize", finalize, 0)];
    define_functions(cx, &parser, methods, Attributes::DONT_ENUM);
    Ok(parser.into())
}

#[native_abi]
fn finalize(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const FINISHED: i32 = 7;
    const FAILED: i32 = 8;
    let parser = frame.this_value().downcast::<Parser>();
    let parses = parser.is_some_and(|it| testing::parses(&it.pieces.take()));
    Ok(Value::int32(if parses { FINISHED } else { FAILED }))
}

#[cell(name = "WasmStreamingCompiler")]
struct Compiler {
    base: JsDestructibleObject,
    compiler: WasmStreamingCompiler,
}

#[native_abi]
fn add_bytes(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let bytes = testing::copy_bytes(cx, frame.argument(0))?;
    if let Some(parser) = frame.this_value().downcast::<Parser>() {
        parser.pieces.borrow_mut().push(bytes);
    } else if let Some(this) = frame.this_value().downcast::<Compiler>() {
        this.anchor().compiler.add_bytes(&bytes);
    }
    Ok(Value::UNDEFINED)
}

/// The callback adds the bytes.
#[native_abi]
fn stream<const INSTANTIATES: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (callback, imports) = (frame.argument(0), frame.argument(1));
    if !callback.is_callable() {
        return Err(cx.throw_type_error("First argument is not a JS function"));
    }
    if INSTANTIATES && !imports.is_undefined() && !imports.is_object() {
        return Err(cx.throw_type_error(errors::TYPE_ERROR));
    }
    let (promise, imports) = (JsPromise::new(cx), imports.as_object());
    let object = cx.allocate::<Compiler>(CompilerInit {
        base: base_for::<Compiler>(cx),
        compiler: WasmStreamingCompiler::new(cx, promise, INSTANTIATES, imports, Value::UNDEFINED),
    });
    let methods: Functions = &[("addBytes", add_bytes, 0)];
    define_functions(cx, &object, methods, Attributes::DONT_ENUM);
    if let Err(thrown) = cx.call(callback, Value::UNDEFINED, &[object.into()]) {
        cx.catch(thrown)?;
    }
    object.anchor().compiler.finish(cx);
    Ok(promise.into())
}
