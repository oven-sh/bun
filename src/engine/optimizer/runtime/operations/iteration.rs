//! For iteration.

use bun_engine_macros::native_abi;
use bun_engine_vm::{
    Cx, ForIn, Gc, GlobalObject, JsArray, JsArrayBufferView, JsCell, JsResult, JsString, MapKind,
    OrderedCursor, PropertyNameEnumerator, SetKind, TableKind, Value,
};

use super::{Address, Answer, Operation, Returned};
use crate::lower::Threw;

operations! {
    GET_INDEX: fn get_index(cx: &mut Cx, array: Gc<JsArray>, index: u32) -> JsResult<Value> {
        array.get_index(cx, index.into())
    }
    CODE_POINT_STRING: fn code_point_string(cx: &Cx, string: Gc<JsString>, index: u32) -> Gc<JsString> {
        let view = string.try_view().expect("no rope");
        JsString::from_code_point(cx, view.text().code_point_at(index as usize))
    }
    GET_ENUMERATOR: fn get_enumerator(cx: &mut Cx, base: Value) -> JsResult<Gc<PropertyNameEnumerator>> {
        let object = base.to_object(cx)?;
        PropertyNameEnumerator::for_object(cx, &object)
    }
    NEXT_NAME: fn next_name(cx: &mut Cx, base: Value, enumerator: Value, place: u64) -> Next {
        let mut for_in = for_in_at(enumerator, place);
        Next {
            name: for_in.next(cx, base).map(|name| name.map_or_default(Value::from)),
            place: (for_in.mode as u64) << 32 | u64::from(for_in.index),
        }
    }
    HAS_OWN_NAME: fn has_own_name(
        cx: &mut Cx, base: Value, enumerator: Value, place: u64, name: Gc<JsString>
    ) -> Answer {
        for_in_at(enumerator, place).has_own(cx, base, name).into()
    }
}

fn for_in_at(enumerator: Value, place: u64) -> ForIn {
    let [mode, index] = [place >> 32, place].map(|it| Value::int32(it as i32));
    // SAFETY: from the registers of a loop.
    unsafe { ForIn::from_registers([enumerator, mode, index]) }
}

#[repr(C)]
pub(super) struct Next {
    name: JsResult<Value>,
    place: u64,
}

impl Returned for Next {
    const THREW: Threw = Threw::IfZero;
}

#[repr(C)]
pub(super) struct Found {
    table: Option<Gc<JsCell>>,
    number: usize,
}

fn next_entry<K: TableKind>(place: Gc<JsCell>, number: u32) -> Found {
    let mut cursor = OrderedCursor::<K>::from_parts(place, number);
    let is_there = cursor.next().is_some();
    let (table, after) = cursor.parts();
    Found {
        table: is_there.then_some(table),
        number: after.wrapping_sub(1) as usize,
    }
}

leaves! {
    NEXT_ENTRY_OF_MAP: fn next_entry_of_map(place: Gc<JsCell>, number: u32) -> Found {
        next_entry::<MapKind>(place, number)
    }
    NEXT_ENTRY_OF_SET: fn next_entry_of_set(place: Gc<JsCell>, number: u32) -> Found {
        next_entry::<SetKind>(place, number)
    }
    CAN_ITERATE_BY_INDEX: fn can_iterate_by_index(view: &JsArrayBufferView) -> u32 {
        (!view.is_out_of_bounds() && view.max_length() < u32::MAX as usize).into()
    }
    VIEW_ENDS_AT: fn view_ends_at(view: &JsArrayBufferView, index: u32) -> u32 {
        view.checked_length().is_some_and(|length| index as usize >= length).into()
    }
    INHERITS_ARRAY_ITERATION: fn inherits_array_iteration(array: &JsArray, global: Gc<GlobalObject>) -> u32 {
        (array.shape().global() == Some(global) && array.is_iteration_pristine()).into()
    }
}
