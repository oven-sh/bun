//! `Map`, `Set`, their weak kin, `WeakRef` and `FinalizationRegistry`.

mod finalization_registry;
mod map;
mod presize;
mod private;
mod set;
mod set_methods;
mod weak_map;
mod weak_ref;
mod weak_set;

use bun_engine_text::PropertyName;
use bun_engine_vm::{CellKind, NativeFunction, RealmSlot, RealmWatchpoint};

use crate::prelude::*;
use crate::watchpoints::Conditions;

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    use RealmSlot::*;
    match slot {
        map_prototype | map_constructor | map_shape => map::initialize(cx),
        map_prototype_entries => map::initialize_entries(cx),
        map_iterator_prototype | map_iterator_shape => map::initialize_iterator(cx),
        set_prototype | set_constructor | set_shape => set::initialize(cx),
        set_prototype_values => set::initialize_values(cx),
        set_iterator_prototype | set_iterator_shape => set::initialize_iterator(cx),
        weak_map_constructor | weak_map_shape => weak_map::initialize(cx),
        weak_set_constructor | weak_set_shape => weak_set::initialize(cx),
        weak_ref_constructor | weak_ref_shape => weak_ref::initialize(cx),
        finalization_registry_constructor | finalization_registry_shape => {
            finalization_registry::initialize(cx);
        }
        _ => return private::initialize_slot(cx, slot),
    }
    true
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    match which {
        RealmWatchpoint::MapIteratorProtocol => {
            conditions.pristine(&cx.map_prototype(), symbols::iterator);
            conditions.pristine_iterator(&cx.map_iterator_prototype());
        }
        RealmWatchpoint::SetIteratorProtocol => {
            conditions.pristine(&cx.set_prototype(), symbols::iterator);
            conditions.pristine_iterator(&cx.set_iterator_prototype());
        }
        RealmWatchpoint::MapSet => conditions.pristine(&cx.map_prototype(), names::set),
        RealmWatchpoint::SetAdd => conditions.pristine(&cx.set_prototype(), names::add),
        RealmWatchpoint::SetPrimordialProperties => {
            for name in [names::size, names::has, names::keys] {
                conditions.pristine(&cx.set_prototype(), name);
            }
            conditions.pristine_iterator(&cx.set_iterator_prototype());
        }
        _ => return false,
    }
    true
}

fn instance_shape<T: CellKind>(cx: &Cx, prototype: Gc<JsObject>) -> Gc<Shape> {
    Shape::create(
        cx,
        Some(cx.global()),
        prototype.into(),
        ShapeSpec::of::<T>(),
    )
}

/// The method that a constructor adds the elements of an iterable with.
fn get_adder(
    cx: &mut Cx,
    collection: &JsObject,
    name: PropertyName<'_>,
    message: &'static str,
) -> JsResult<Gc<JsObject>> {
    let adder = collection.get(cx, name)?;
    match adder.as_object() {
        Some(adder) if adder.is_callable() => Ok(adder),
        _ => Err(cx.throw_type_error(message)),
    }
}

/// The realm of `function` if it is that native one.
fn realm_if_native(
    function: Gc<JsObject>,
    native: NativeFunction,
) -> Option<Gc<bun_engine_vm::GlobalObject>> {
    let function = function.downcast::<bun_engine_vm::JsFunction>()?;
    let executable = function.native_executable()?;
    core::ptr::fn_addr_eq(executable.function(), native).then(|| function.function_realm())
}

#[inline(always)]
fn key_and_value(cx: &mut Cx, entry: Value, message: &'static str) -> JsResult<(Value, Value)> {
    let Some(entry) = entry.as_object() else {
        return Err(cx.throw_type_error(message));
    };
    Ok((entry.get_index(cx, 0)?, entry.get_index(cx, 1)?))
}

/// For the weak kinds.
#[inline(always)]
fn this_weak<T: CellKind>(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<T>> {
    let this = frame.this_value();
    this.downcast()
        .ok_or_else(|| throw_incompatible(cx, this, T::CLASS.name()))
}

#[cold]
fn throw_incompatible(cx: &Cx, this: Value, class: &str) -> bun_engine_vm::Thrown {
    if this.is_object() {
        cx.throw_type_error(format_args!(
            "Called {class} function on a non-{class} object"
        ))
    } else {
        cx.throw_type_error(format_args!("Called {class} function on non-object"))
    }
}
