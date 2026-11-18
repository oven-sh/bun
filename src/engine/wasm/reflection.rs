//! Types as objects (WebAssembly JavaScript Interface, type reflection). `None` is for a type that has no name there.

use bun_engine_asm::Width;
use bun_engine_vm::Attributes;
use bun_engine_wasm_format::{
    AbstractHeapType, CanonicalType, CanonicalValType, Extern, Limits, Module, ValKind, ValType,
};

use crate::descriptor::from_address;
use crate::prelude::*;

fn name_of(ty: ValType) -> Option<PropertyName<'static>> {
    let Some(reference) = ty.as_ref() else {
        return Some(match ty.kind() {
            ValKind::I32 => names::i32,
            ValKind::I64 => names::i64,
            ValKind::F32 => names::f32,
            ValKind::F64 => names::f64,
            ValKind::V128 | ValKind::Ref => names::v128,
        });
    };
    let heap_type = reference.is_nullable().then(|| reference.heap_type())?;
    if heap_type.is(AbstractHeapType::Func) {
        return Some(names::funcref);
    }
    (heap_type.is(AbstractHeapType::Extern)).then_some(names::externref)
}

fn put(cx: &Cx, object: &JsObject, name: PropertyName<'_>, value: Value) {
    object.put_direct(cx, name, value, Attributes::NONE);
}

fn put_name(cx: &Cx, object: &JsObject, name: PropertyName<'_>, value: PropertyName<'_>) {
    put(cx, object, name, JsString::from_name(cx, value).into());
}

/// `put_own` defines what comes between the limits and the type of addresses.
fn with_limits(
    cx: &Cx,
    limits: Limits,
    address: Width,
    put_own: impl FnOnce(&JsObject),
) -> Gc<JsObject> {
    let object = cx.new_object();
    let members = [
        (names::maximum, limits.maximum),
        (names::minimum, Some(limits.initial)),
    ];
    for (name, limit) in members {
        if let Some(limit) = limit {
            put(cx, &object, name, from_address(cx, limit, address));
        }
    }
    put_own(&object);
    let address = name_of(ValType::int(address)).expect("an integer");
    put_name(cx, &object, names::address, address);
    object
}

pub(crate) fn memory_type(cx: &Cx, pages: Limits, address: Width, shared: bool) -> Gc<JsObject> {
    with_limits(cx, pages, address, |object| {
        put(cx, object, names::shared, shared.into());
    })
}

pub(crate) fn table_type(
    cx: &Cx,
    limits: Limits,
    address: Width,
    element: ValType,
) -> Option<Gc<JsObject>> {
    let element = name_of(element)?;
    Some(with_limits(cx, limits, address, |object| {
        put_name(cx, object, names::element, element);
    }))
}

fn name_of_canonical(ty: &CanonicalValType) -> Option<PropertyName<'static>> {
    name_of(ty.erased()).filter(|_| ty.defined().is_none())
}

pub(crate) fn global_type(cx: &Cx, ty: &CanonicalValType, mutable: bool) -> Option<Gc<JsObject>> {
    let name = name_of_canonical(ty)?;
    let object = cx.new_object();
    put(cx, &object, names::mutable, mutable.into());
    put_name(cx, &object, names::value, name);
    Some(object)
}

/// False if one of the types has no name.
fn put_list(
    cx: &mut Cx,
    object: &JsObject,
    member: PropertyName<'_>,
    types: impl Iterator<Item = Option<PropertyName<'static>>>,
) -> JsResult<bool> {
    let list = cx.new_array();
    for name in types {
        let Some(name) = name else { return Ok(false) };
        let name = JsString::from_name(cx, name);
        append(cx, &list, name.into())?;
    }
    put(cx, object, member, list.into());
    Ok(true)
}

pub(crate) fn tag_type(cx: &mut Cx, ty: &CanonicalType) -> JsResult<Option<Gc<JsObject>>> {
    let (object, parameters) = (
        cx.new_object(),
        ty.params().map(|it| name_of_canonical(&it)),
    );
    Ok(put_list(cx, &object, names::parameters, parameters)?.then_some(object))
}

/// Of anything but a tag.
pub(crate) fn extern_type(
    cx: &mut Cx,
    module: &Module,
    item: Extern,
) -> JsResult<Option<Gc<JsObject>>> {
    Ok(match item {
        Extern::Func(func) => {
            let (ty, object) = (module.func_type(func), cx.new_object());
            for (name, types) in [(names::parameters, ty.params), (names::results, ty.results)] {
                if !put_list(cx, &object, name, types.iter().copied().map(name_of))? {
                    return Ok(None);
                }
            }
            Some(object)
        }
        Extern::Memory(memory) => {
            let ty = module.memory(memory);
            Some(memory_type(cx, ty.pages, ty.address, ty.shared))
        }
        Extern::Table(table) => {
            let ty = module.table(table);
            table_type(cx, ty.limits, ty.address, ty.element.into())
        }
        Extern::Global(global) => {
            let ty = module.global(global);
            global_type(cx, &module.types().canonical_value(ty.ty), ty.mutable)
        }
        Extern::Tag(_) => None,
    })
}
