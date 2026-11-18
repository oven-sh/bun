//! `Array`, `Iterator` and their kin.

pub(crate) mod array;
mod constructor;
mod copy;
pub(crate) mod iterator;
mod iterator_prototype;
mod join;
mod merge_sort;
mod mutate;
mod radix_sort;
mod search;
pub(crate) mod sort;
mod string_sort;

use bun_engine_bytecode::Visibility;
use bun_engine_text::{PropertyName, StringRef};
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{JsFunction, NativeFunction, RealmSlot, RealmWatchpoint, errors};

use crate::prelude::*;
use crate::watchpoints::Conditions;

/// Of an array-like object.
const MAX_LENGTH: u64 = (1 << 53) - 1;

/// ToObject(this value)
#[inline(always)]
fn receiver(cx: &Cx, this: Value) -> JsResult<Gc<JsObject>> {
    let object = this.to_object(cx)?;
    object.prefer_dense_elements(cx);
    Ok(object)
}

/// The same, for a method of `Array.prototype` whose error has its name.
macro_rules! this_object {
    ($cx:ident, $frame:ident, $method:literal) => {
        $frame
            .this_value()
            .require_object_coercible(
                $cx,
                concat!(
                    "Array.prototype.",
                    $method,
                    " requires that |this| not be null or undefined"
                ),
            )
            .and_then(|this| super::receiver($cx, this))
    };
}

use this_object;

/// Set(object, "length", length, true)
#[inline]
fn set_length(cx: &mut Cx, object: &JsObject, length: u64) -> JsResult<()> {
    match (object.as_exact_array(), u32::try_from(length)) {
        (Some(array), Ok(length)) => array.set_length(cx, length, true),
        (Some(_), Err(_)) => Err(cx.throw_range_error(errors::INVALID_ARRAY_LENGTH)),
        (None, _) => object.set(cx, names::length, length.into(), true),
    }
    .map(|_| ())
}

/// One that stack traces do not show.
fn hidden_function(
    cx: &Cx,
    name: PropertyName<'_>,
    function: NativeFunction,
    length: u32,
    intrinsic: Intrinsic,
) -> Gc<JsFunction> {
    let (name, constructor) = (StringRef::from_text(name.text()), native_not_a_constructor);
    let visibility = Visibility::Private;
    JsFunction::native_with(
        cx,
        length,
        &name,
        function,
        constructor,
        intrinsic,
        visibility,
    )
}

pub(crate) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
    if slot == RealmSlot::array_prototype_to_string {
        array::initialize_to_string(cx);
        return true;
    }
    constructor::initialize_slot(cx, slot) || iterator::initialize_slot(cx, slot)
}

pub(crate) fn add_conditions(
    cx: &Cx,
    which: RealmWatchpoint,
    conditions: &mut Conditions<'_>,
) -> bool {
    let (array, object) = (cx.array_prototype(), cx.object_prototype());
    match which {
        RealmWatchpoint::ArrayPrototypeChainIsSane => {
            conditions.no_elements(&array, object.into());
            conditions.no_elements(&object, Value::NULL);
            conditions.absent(&array, names::minusOne, object.into());
            conditions.absent(&object, names::minusOne, Value::NULL);
        }
        RealmWatchpoint::ArrayIteratorProtocol => {
            conditions.pristine(&array, symbols::iterator);
            conditions.pristine_iterator(&cx.array_iterator_prototype());
        }
        RealmWatchpoint::StringIteratorProtocol => {
            conditions.pristine(&cx.string_prototype(), symbols::iterator);
            conditions.pristine_iterator(&cx.string_iterator_prototype());
        }
        RealmWatchpoint::ArraySpecies => {
            conditions.pristine(&array, names::constructor);
            conditions.pristine(&cx.array_constructor(), symbols::species);
        }
        RealmWatchpoint::ArrayJoin => conditions.pristine(&array, names::join),
        RealmWatchpoint::ArrayToString => conditions.pristine(&array, names::toString),
        RealmWatchpoint::ArrayIsConcatSpreadable => {
            conditions.absent(&array, symbols::isConcatSpreadable, object.into());
            conditions.absent(&object, symbols::isConcatSpreadable, Value::NULL);
        }
        _ => return false,
    }
    true
}
