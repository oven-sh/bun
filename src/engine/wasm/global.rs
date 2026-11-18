//! `WebAssembly.Global`

use std::rc::Rc;

use bun_engine_vm::{GcFree, JsDestructibleObject, Visitor, errors as vm_errors};
use bun_engine_wasm_format::{AbstractHeapType, CanonicalValType, ValType};
use bun_engine_wasm_runtime::{Global, Reference};

use crate::descriptor::Descriptor;
use crate::errors::{self, Kind};
use crate::namespace::{Namespace, Slot, define_type_method, shape_for_new_target};
use crate::owned::{host_cell, visit_with};
use crate::prelude::*;
use crate::store::store;
use crate::{reflection, values};

static_table!(static PROTOTYPE_PROPERTIES = [
    member(StaticProperty::function(names::valueOf, get_value, 0)),
    member(StaticProperty::accessor(names::value, get_value, set_value)),
    StaticProperty::position_of(names::r#type),
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmGlobal),
]);

define_object!(Prototype, "WebAssembly.Global", PROTOTYPE_PROPERTIES);

struct Storage(Rc<Global>);

// SAFETY: the cell that has this visits the value.
unsafe impl GcFree for Storage {}

#[cell(name = "WebAssembly.Global", visit_children)]
pub(crate) struct WasmGlobal {
    base: JsDestructibleObject,
    global: Storage,
}

/// The name of the type if scripts cannot have values of it.
pub(crate) fn opaque_type(ty: ValType) -> Option<&'static str> {
    match ty.as_ref() {
        Some(reference) => (reference.heap_type().is(AbstractHeapType::Exn)).then_some("exnref"),
        None => (ty == ValType::V128).then_some("v128"),
    }
}

impl WasmGlobal {
    pub(crate) fn of(global: &Global) -> Gc<WasmGlobal> {
        let owner = global.owner().expect("an owner");
        // SAFETY: `create` makes every owner, and instances keep those of their globals.
        unsafe { Gc::from_address(owner.address()) }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        if visitor.puts_off_current_cell() {
            return;
        }
        self.global.0.trace(visit_with(visitor));
    }

    pub(crate) fn global(&self) -> &Rc<Global> {
        &self.global.0
    }

    /// GetGlobalValue
    pub(crate) fn value(&self, cx: &Cx) -> JsResult<Value> {
        let (ty, bits) = (self.global.0.ty().erased(), self.global.0.get());
        match opaque_type(ty) {
            None if ty.is_ref() => Ok(values::from_reference(Reference(bits as u64))),
            None => values::from_bits(cx, bits, ty),
            Some(name) => Err(errors::throw(
                cx,
                Kind::Runtime,
                format_args!("Cannot get value of {name} global"),
            )),
        }
    }
}

/// For a new global.
pub(crate) fn create(cx: &Cx, shape: Gc<Shape>, global: &Rc<Global>) -> Gc<WasmGlobal> {
    let object = cx.allocate::<WasmGlobal>(WasmGlobalInit {
        base: JsObjectInit::new(cx, shape),
        global: Storage(Rc::clone(global)),
    });
    // SAFETY: the object keeps and traces the global. Whoever made the global sets it.
    unsafe { global.set_owner(host_cell(object.cell())) };
    object
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    define_type_method(cx, &prototype, reflect);
    let spec = ShapeSpec::of::<WasmGlobal>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::GlobalShape, shape);
    let constructor = new_constructor(cx, call, construct, 1, names::Global, &prototype);
    namespace.put(Slot::GlobalConstructor, constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Global",
    ))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let shape = shape_for_new_target(cx, frame, Slot::GlobalShape)?;
    let descriptor = Descriptor::new(cx, "WebAssembly.Global", frame.argument(0))?;
    let is_mutable = descriptor.get(cx, names::mutable)?.to_boolean(cx);
    let types = [
        (names::i32, ValType::I32),
        (names::i64, ValType::I64),
        (names::f32, ValType::F32),
        (names::f64, ValType::F64),
        (names::anyfunc, ValType::FUNCREF),
        (names::funcref, ValType::FUNCREF),
        (names::externref, ValType::EXTERNREF),
    ];
    let Some(ty) = descriptor.choice(cx, names::value, &types)? else {
        return Err(cx.throw_type_error(
            "WebAssembly.Global expects its 'value' field to be the string 'i32', 'i64', 'f32', 'f64', 'anyfunc', 'funcref', or 'externref'",
        ));
    };
    let (value, ty) = (frame.argument(1), CanonicalValType::plain(ty));
    let bits = match value.is_undefined() && ty.erased() != ValType::EXTERNREF {
        true => None,
        false => Some(values::to_bits(cx, value, (&ty).into())?),
    };
    let store = store(cx).ok_or_else(|| cx.throw_out_of_memory())?;
    let global = Global::new(&store, ty, is_mutable);
    let object = create(cx, shape, &global);
    if let Some(bits) = bits {
        // SAFETY: converted to that type. The frame has kept a reference alive.
        unsafe { global.set(bits) };
    }
    Ok(object.into())
}

fn this_global(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<WasmGlobal>> {
    frame.this_value().downcast().ok_or_else(|| {
        cx.throw_type_error("expected |this| value to be an instance of WebAssembly.Global")
    })
}

#[native_abi]
fn get_value(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_global(cx, frame)?.value(cx)
}

#[native_abi]
fn set_value(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_global(cx, frame)?;
    let global = this.anchor().global();
    if !global.is_mutable() {
        return Err(cx.throw_type_error(
            "WebAssembly.Global.prototype.value attempts to modify immutable global value",
        ));
    }
    if let Some(name) = opaque_type(global.ty().erased()) {
        return Err(cx.throw_type_error(format_args!("Cannot set value of {name} global")));
    }
    let bits = values::to_bits(cx, frame.argument(0), global.ty().into())?;
    // SAFETY: converted to that type.
    unsafe { global.set(bits) };
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn reflect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_global(cx, frame)?;
    let global = this.anchor().global();
    match reflection::global_type(cx, global.ty(), global.is_mutable()) {
        Some(object) => Ok(object.into()),
        None => Err(cx.throw_type_error(
            "WebAssembly.Global.prototype.type unable to produce type descriptor for the given global",
        )),
    }
}
