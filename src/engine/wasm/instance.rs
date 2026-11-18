//! `WebAssembly.Instance`

mod exports;
mod imports;

use std::sync::Arc;

use bun_engine_vm::ic::KeptResult;
use bun_engine_vm::{Thrown, errors as vm_errors};
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::Extern;
use bun_engine_wasm_runtime::{ConstantError, InitializeError, SegmentError};

pub(crate) use self::imports::{ImportName, link_imports, throw_unknown_builtin};
use crate::errors::{self, Kind};
use crate::function;
use crate::instance_cell::WasmInstance;
use crate::module::{self, WasmModule, optional_object};
use crate::namespace::{Namespace, Slot, shape_for_new_target};
use crate::prelude::*;
use crate::store::store;

static_table!(static PROTOTYPE_PROPERTIES = [
    member(StaticProperty::getter(names::exports, get_exports)),
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmInstance),
]);

define_object!(Prototype, "WebAssembly.Instance", PROTOTYPE_PROPERTIES);

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    let spec = ShapeSpec::of::<WasmInstance>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::InstanceShape, shape);
    let constructor = new_constructor(cx, call, construct, 1, names::Instance, &prototype);
    namespace.put(Slot::InstanceConstructor, constructor);
}

/// `link_imports` and `run` follow.
pub(crate) fn create(
    cx: &Cx,
    shape: Gc<Shape>,
    module: Gc<WasmModule>,
) -> JsResult<Gc<WasmInstance>> {
    module::check_is_enabled(cx)?;
    let store = store(cx).ok_or_else(|| cx.throw_out_of_memory())?;
    WasmInstance::create(cx, shape, module, &store, module.compiled())
}

/// With the imports that the object has. `run` follows.
pub(crate) fn create_and_link(
    cx: &mut Cx,
    shape: Gc<Shape>,
    module: Gc<WasmModule>,
    imports: Option<Gc<JsObject>>,
) -> JsResult<Gc<WasmInstance>> {
    let object = create(cx, shape, module)?;
    match imports {
        Some(imports) => link_imports(cx, object, |cx, name| imports::read(cx, &imports, name))?,
        None if object.instance().module().imports().is_empty() => {}
        None => {
            return Err(cx.throw_type_error(
                "can't make WebAssembly.Instance because there is no imports Object and the WebAssembly.Module requires imports",
            ));
        }
    }
    Ok(object)
}

/// Makes what the module defines and exports, applies the segments and calls the start function.
pub(crate) fn run(cx: &mut Cx, object: Gc<WasmInstance>) -> JsResult<()> {
    run_binding_exports(cx, object, |_, _, _| Ok(()))
}

/// The same. `bind` gets each export as it is made.
pub(crate) fn run_binding_exports(
    cx: &mut Cx,
    object: Gc<WasmInstance>,
    bind: impl FnMut(&Cx, Extern, Value) -> JsResult<()>,
) -> JsResult<()> {
    let instance = object.instance();
    (instance.initialize()).map_err(|error| throw_initialize_error(cx, error))?;
    exports::create(cx, object, bind)?;
    (instance.apply_segments()).map_err(|error| throw_segment_error(cx, error))?;
    if let Some(start) = Arc::clone(instance.module()).start() {
        let start = function::exported(cx, instance, start)?;
        cx.call(start, Value::UNDEFINED, &[])?;
    }
    Ok(())
}

#[cold]
fn throw_initialize_error(cx: &Cx, error: InitializeError) -> Thrown {
    let (what, offset) = match error {
        InitializeError::Table => return errors::throw(cx, Kind::Link, "couldn't create Table"),
        InitializeError::Constant(ConstantError { trap, offset }) => match trap {
            Trap::ArrayNewFailure => ("array", offset),
            Trap::StructNewFailure => ("struct", offset),
            _ => return cx.throw_out_of_memory(),
        },
        InitializeError::OutOfMemory => return cx.throw_out_of_memory(),
    };
    errors::throw(
        cx,
        Kind::Runtime,
        format_args!(
            "couldn't evaluate constant expression: WebAssembly.Module doesn't parse at byte {offset}: Failed to allocate new {what}"
        ),
    )
}

#[cold]
fn throw_segment_error(cx: &Cx, error: SegmentError) -> Thrown {
    match error {
        SegmentError::OutOfMemory => cx.throw_out_of_memory(),
        SegmentError::ElementsOutOfBounds => {
            let message = "Element is trying to set an out of bounds table index";
            errors::throw(cx, Kind::Runtime, message)
        }
        SegmentError::DataOutOfBounds {
            memory_length,
            segment_length,
            offset,
        } => {
            let problem = match memory_length < segment_length.into() {
                true => "is too big",
                false => "writes outside of memory",
            };
            errors::throw(
                cx,
                Kind::Runtime,
                format_args!(
                    "Invalid data segment initialization: segment of {segment_length} bytes memory of {memory_length} bytes, at offset {offset}, segment {problem}"
                ),
            )
        }
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Instance",
    ))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(module) = frame.argument(0).downcast::<WasmModule>() else {
        let message = "first argument to WebAssembly.Instance must be a WebAssembly.Module";
        return Err(vm_errors::throw_type_error_with_source(cx, message));
    };
    let imports = optional_object(cx, frame.argument(1), "second", "Instance")?;
    let shape = shape_for_new_target(cx, frame, Slot::InstanceShape)?;
    let instance = create_and_link(cx, shape, module, imports)?;
    run(cx, instance)?;
    Ok(instance.into())
}

#[native_abi]
fn get_exports(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    exports_of(cx, frame.this_value(), names::exports)
}

#[native_abi]
fn exports_of(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    match this.downcast::<WasmInstance>() {
        Some(instance) => Ok(instance.exports().map_or_default(Into::into)),
        None => Err(
            cx.throw_type_error("expected |this| value to be an instance of WebAssembly.Instance")
        ),
    }
}

pub(crate) fn kept_result(getter: usize, receiver: &JsObject) -> Option<KeptResult> {
    let is_ours = getter == get_exports as *const () as usize && receiver.is::<WasmInstance>();
    is_ours.then_some(KeptResult {
        offset: WasmInstance::OFFSET_OF_EXPORTS as u16,
        getter: exports_of,
    })
}
