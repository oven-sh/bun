//! `WebAssembly.Tag` and `WebAssembly.JSTag` (js-api "Tags").

use std::sync::{Arc, LazyLock};

use bun_engine_vm::{GcFree, JsDestructibleObject, errors as vm_errors, for_each_in_iterable};
use bun_engine_wasm_format::{CanonicalType, TagIndex, ValType};
use bun_engine_wasm_runtime::{Instance, LinkError, Tag};

use crate::descriptor::choose;
use crate::namespace::{Namespace, Slot, define_type_method, shape_for_new_target};
use crate::owned::host_cell;
use crate::prelude::*;
use crate::reflection;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::position_of(names::r#type),
    StaticProperty::position_of(names::constructor),
    StaticProperty::string(symbols::toStringTag, names::wasmTag),
]);

define_object!(Prototype, "WebAssembly.Tag", PROTOTYPE_PROPERTIES);

struct SharedTag(Arc<Tag>);

// SAFETY: a tag refers to no cell.
unsafe impl GcFree for SharedTag {}

#[cell(name = "WebAssembly.Tag")]
pub(crate) struct WasmTag {
    base: JsDestructibleObject,
    tag: SharedTag,
}

/// That of what scripts throw. The payload is the value.
pub(crate) fn script_tag() -> &'static Arc<Tag> {
    static TAG: LazyLock<Arc<Tag>> = LazyLock::new(|| {
        let ty = CanonicalType::function(&[ValType::EXTERNREF], &[]);
        Tag::new(ty.unwrap_or_else(|_| bun_alloc::out_of_memory()))
    });
    &TAG
}

impl WasmTag {
    pub(crate) fn create(cx: &Cx, shape: Gc<Shape>, tag: Arc<Tag>) -> Gc<WasmTag> {
        cx.allocate::<WasmTag>(WasmTagInit {
            base: JsObjectInit::new(cx, shape),
            tag: SharedTag(tag),
        })
    }

    /// The object that the instance has imported, or the one for a tag that it defines.
    pub(crate) fn of_instance(instance: &Instance, index: TagIndex) -> Gc<WasmTag> {
        // SAFETY: only these own tags, and the instance keeps the owner alive.
        unsafe { Gc::from_address(instance.tag_owner(index).address()) }
    }

    pub(crate) fn link_to(&self, instance: &Instance, index: TagIndex) -> Result<(), LinkError> {
        let (tag, owner) = (Arc::clone(&self.tag.0), host_cell(self.as_cell().into()));
        // SAFETY: it has a clone.
        unsafe { instance.link_tag(index, tag, owner) }
    }

    pub(crate) fn tag(&self) -> &Tag {
        &self.tag.0
    }
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    define_type_method(cx, &prototype, reflect);
    let spec = ShapeSpec::of::<WasmTag>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::TagShape, shape);
    let constructor = new_constructor(cx, call, construct, 1, names::Tag, &prototype);
    namespace.put(Slot::TagConstructor, constructor);
}

pub(crate) fn initialize_script_tag(cx: &Cx, namespace: &Namespace) {
    let shape = namespace.shape(cx, Slot::TagShape);
    let object = WasmTag::create(cx, shape, Arc::clone(script_tag()));
    namespace.put(Slot::ScriptTag, object);
}

#[native_abi]
pub(crate) fn get_script_tag(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Namespace::of(cx).get(cx, Slot::ScriptTag).as_value())
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(cx, "WebAssembly.Tag"))
}

fn parameter_type(cx: &mut Cx, name: Value) -> JsResult<ValType> {
    let known = [
        (names::i32, ValType::I32),
        (names::i64, ValType::I64),
        (names::f32, ValType::F32),
        (names::f64, ValType::F64),
        (names::v128, ValType::V128),
        (names::funcref, ValType::FUNCREF),
        (names::anyfunc, ValType::FUNCREF),
        (names::externref, ValType::EXTERNREF),
    ];
    choose(cx, name, &known)?.ok_or_else(|| {
        cx.throw_type_error(
            "WebAssembly.Tag constructor expects the 'parameters' field of the first argument to be a sequence of \
             WebAssembly value types.",
        )
    })
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() < 1 {
        let message = "WebAssembly.Tag constructor expects the tag type as the first argument.";
        return Err(cx.throw_type_error(message));
    }
    let list = frame.argument(0).get(cx, names::parameters)?;
    if !list.is_object() {
        let message =
            "WebAssembly.Tag constructor expects a tag type with the 'parameters' property.";
        return Err(cx.throw_type_error(message));
    }
    let mut parameters = Vec::new();
    for_each_in_iterable(cx, list, |cx, name| {
        let ty = parameter_type(cx, name)?;
        if parameters.try_reserve(1).is_err() {
            return Err(cx.throw_out_of_memory());
        }
        parameters.push(ty);
        Ok(())
    })?;
    let Ok(ty) = CanonicalType::function(&parameters, &[]) else {
        return Err(cx.throw_out_of_memory());
    };
    let shape = shape_for_new_target(cx, frame, Slot::TagShape)?;
    Ok(WasmTag::create(cx, shape, Tag::new(ty)).into())
}

#[native_abi]
fn reflect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    let Some(object) = this.downcast::<WasmTag>() else {
        return Err(match this.is_cell() {
            true => cx.throw_type_error("WebAssembly.Tag operation called on non-Tag object"),
            false => vm_errors::throw_not_an_object(cx, this),
        });
    };
    match reflection::tag_type(cx, object.anchor().tag().ty())? {
        Some(ty) => Ok(ty.into()),
        None => Err(cx.throw_type_error(
            "WebAssembly.Tag.prototype.type unable to produce type descriptor for the given tag",
        )),
    }
}
