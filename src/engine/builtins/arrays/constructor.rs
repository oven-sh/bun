use bun_engine_text::private_names;
use bun_engine_vm::{ElementKind, IteratorRecord, JsArray, RealmSlot, errors};

use super::{hidden_function, set_length};
use crate::define::species_getter;
use crate::js::array_constructor as js;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::builtin(names::from, js::from),
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::function(names::of, of, 0).with_intrinsic(Intrinsic::ArrayConstructorOf),
    StaticProperty::function(names::isArray, is_array, 1).with_intrinsic(Intrinsic::ArrayIsArray),
    StaticProperty::builtin(names::fromAsync, js::fromAsync),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(ArrayConstructor, PROPERTIES, call, construct);

pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    let global = cx.global();
    match slot {
        RealmSlot::array_constructor => {
            let (parent, prototype) = (cx.function_prototype(), cx.array_prototype());
            let constructor = ArrayConstructor::create(cx, parent, 1, names::Array, &prototype);
            global.init_array_constructor(constructor);
        }
        RealmSlot::private_is_array => {
            let function =
                hidden_function(cx, names::isArray, is_array, 1, Intrinsic::ArrayIsArray);
            global.init_private_is_array(function);
        }
        RealmSlot::private_array_from_fast => {
            let name = private_names::arrayFromFastWithoutMapFn;
            global.init_private_array_from_fast(hidden_function(
                cx,
                name,
                from_fast,
                2,
                Intrinsic::None,
            ));
        }
        _ => return false,
    }
    true
}

#[inline(always)]
fn create(cx: &mut Cx, frame: &CallFrame, new_target: Value) -> JsResult<Value> {
    let (arguments, callee) = (frame.arguments(), frame.callee());
    let size = match arguments {
        [size] if size.is_number() => Some(size.as_uint32()),
        _ => None,
    };
    let kind = match size {
        Some(_) => ElementKind::Undecided,
        None => ElementKind::Undecided.generalized_for_slice(arguments),
    };
    let mut shape =
        cx.shape_from_new_target(new_target, &callee, |realm, _| realm.array_shape(kind))?;
    // Getting the prototype may have made the realm change its shapes.
    if let Some(realm) = shape
        .global()
        .filter(|it| it.is_original_array_shape(&shape))
    {
        shape = realm.array_shape(kind);
    }
    let array = match size {
        Some(Some(size)) => JsArray::try_create(cx, shape, size, 0),
        Some(None) => return Err(cx.throw_range_error(errors::INVALID_ARRAY_SIZE)),
        None => JsArray::try_from_values_with_shape(cx, shape, arguments),
    };
    cx.or_out_of_memory(array).map(Into::into)
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create(cx, frame, Value::UNDEFINED)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    create(cx, frame, frame.new_target())
}

#[native_abi]
fn is_array(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    bun_engine_vm::is_array(cx, frame.argument(0)).map(Into::into)
}

fn makes_plain_arrays(cx: &Cx, this: Value) -> bool {
    this == cx.array_constructor().into() || !this.is_constructor()
}

#[native_abi]
fn of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, items) = (frame.this_value(), frame.arguments());
    if makes_plain_arrays(cx, this) {
        return cx.new_array_from(items).map(Into::into);
    }
    let result = cx.construct(this, &[items.len().into()], this)?;
    for (index, &item) in (0..).zip(items) {
        result.create_data_index(cx, index, item, true)?;
    }
    set_length(cx, &result, items.len() as u64)?;
    Ok(result.into())
}

/// Undefined if `Array.from` has to go through the motions.
#[native_abi]
fn from_fast(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if makes_plain_arrays(cx, frame.argument(0))
        && let Some(record) = IteratorRecord::for_pristine_iterable(cx, frame.argument(1))
    {
        return record.to_array(cx).map(Into::into);
    }
    Ok(Value::UNDEFINED)
}
