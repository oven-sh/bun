//! `WebAssembly.Memory`

mod contents;
mod object;

use bun_engine_vm::errors as vm_errors;
use bun_engine_vm::ic::KeptResult;
use bun_engine_wasm_compiler::abi::MemoryMode;
use bun_engine_wasm_format::limits::max_pages;
use bun_engine_wasm_format::{Limits, Memory as MemoryType};
use bun_engine_wasm_runtime::{GrowError, Memory};

pub(crate) use self::object::{WasmMemory, create, create_for_shared};
use crate::descriptor::{Descriptor, from_address, to_address};
use crate::namespace::{Namespace, Slot, define_type_method, shape_for_new_target};
use crate::prelude::*;
use crate::reflection;
use crate::store::store;

static_table!(static PROTOTYPE_PROPERTIES = [
    member(StaticProperty::function(names::grow, grow, 1)),
    read_only_attribute(names::buffer, buffer),
    StaticProperty::position_of(names::r#type),
    member(StaticProperty::function(names::toFixedLengthBuffer, to_fixed_length_buffer, 0)),
    member(StaticProperty::function(names::toResizableBuffer, to_resizable_buffer, 0)),
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmMemory),
]);

define_object!(Prototype, "WebAssembly.Memory", PROTOTYPE_PROPERTIES);

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    define_type_method(cx, &prototype, reflect);
    let spec = ShapeSpec::of::<WasmMemory>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::MemoryShape, shape);
    let constructor = new_constructor(cx, call, construct, 1, names::Memory, &prototype);
    namespace.put(Slot::MemoryConstructor, constructor);
}

fn read_type(cx: &mut Cx, descriptor: &Descriptor) -> JsResult<MemoryType> {
    let address = descriptor.address_type(cx)?;
    let initial = descriptor.initial(cx, address)?;
    if initial > max_pages(address) {
        return Err(cx.throw_range_error("WebAssembly.Memory 'initial' page count is too large"));
    }
    let maximum = descriptor.maximum(cx, address)?;
    if maximum.is_some_and(|it| it > max_pages(address)) {
        return Err(cx.throw_range_error("WebAssembly.Memory 'maximum' page count is too large"));
    }
    if maximum.is_some_and(|it| it < initial) {
        return Err(cx.throw_range_error(
            "'maximum' page count must be than greater than or equal to the 'initial' page count",
        ));
    }
    let shared = descriptor.get(cx, names::shared)?.to_boolean(cx);
    if shared && maximum.is_none() {
        let message = "'maximum' page count must be defined if 'shared' is true";
        return Err(cx.throw_type_error(message));
    }
    Ok(MemoryType {
        address,
        pages: Limits { initial, maximum },
        shared,
    })
}

/// `wanted` is a wish.
pub(crate) fn from_descriptor(
    cx: &mut Cx,
    shape: Gc<Shape>,
    descriptor: Value,
    wanted: MemoryMode,
) -> JsResult<Gc<WasmMemory>> {
    let descriptor = Descriptor::new(cx, "WebAssembly.Memory", descriptor)?;
    let ty = read_type(cx, &descriptor)?;
    match store(cx).and_then(|store| Memory::new(&store, ty, wanted).ok()) {
        Some(memory) => Ok(create(cx, shape, &memory)),
        None => Err(cx.throw_out_of_memory()),
    }
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Memory",
    ))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = shape_for_new_target(cx, frame, Slot::MemoryShape)?;
    from_descriptor(cx, shape, frame.argument(0), MemoryMode::Guarded).map(Into::into)
}

fn this_memory(cx: &Cx, this: Value) -> JsResult<Gc<WasmMemory>> {
    this.downcast().ok_or_else(|| {
        cx.throw_type_error(
            "WebAssembly.Memory.prototype.buffer getter called with non WebAssembly.Memory |this| value",
        )
    })
}

#[native_abi]
fn buffer(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    this_memory(cx, this)?.buffer(cx).map(Into::into)
}

#[native_abi]
fn to_fixed_length_buffer(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let memory = this_memory(cx, frame.this_value())?;
    memory.buffer_of_kind(cx, false).map(Into::into)
}

#[native_abi]
fn to_resizable_buffer(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let memory = this_memory(cx, frame.this_value())?;
    memory.buffer_of_kind(cx, true).map(Into::into)
}

#[native_abi]
fn grow(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = this_memory(cx, frame.this_value())?;
    let address = object.memory().ty().address;
    let delta = to_address(cx, frame.argument(0), address)?;
    let message = match object.grow(cx, delta) {
        Ok(pages) => return Ok(from_address(cx, pages, address)),
        Err(GrowError::OutOfMemory) => return Err(cx.throw_out_of_memory()),
        Err(GrowError::InvalidSize) if delta > max_pages(bun_engine_asm::Width::W64) => {
            "WebAssembly.Memory.grow expects the delta to be a valid page count"
        }
        Err(GrowError::InvalidSize) => {
            "WebAssembly.Memory.grow expects the grown size to be a valid page count"
        }
        Err(GrowError::ExceedsMaximum) => {
            "WebAssembly.Memory.grow would exceed the memory's declared maximum size"
        }
    };
    Err(cx.throw_range_error(message))
}

#[native_abi]
fn reflect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_memory(cx, frame.this_value())?;
    let memory = this.anchor().memory();
    let ty = memory.ty();
    let pages = Limits {
        initial: memory.page_count(),
        ..ty.pages
    };
    Ok(reflection::memory_type(cx, pages, ty.address, ty.shared).into())
}

pub(crate) fn kept_result(getter: usize, receiver: &JsObject) -> Option<KeptResult> {
    let is_ours = getter == buffer as *const () as usize && receiver.is::<WasmMemory>();
    is_ours.then_some(KeptResult {
        offset: WasmMemory::OFFSET_OF_FRESH_BUFFER as u16,
        getter: buffer,
    })
}

/// `Hooks::grow_wasm_memory`
pub fn grow_memory(cx: &mut Cx, memory: Gc<JsObject>, pages: usize) -> bool {
    memory.cast::<WasmMemory>().grow(cx, pages as u64).is_ok()
}
