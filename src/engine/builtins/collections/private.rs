//! What the built-ins that are written in JavaScript step through maps and sets with.

use bun_engine_bytecode::Visibility;
use bun_engine_text::StringRef;
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{
    JsArray, JsFunction, JsMap, JsSet, MapKind, MapTable, NativeFunction, OrderedCollection,
    OrderedCursor, OrderedTable, RealmSlot, SetKind, SetTable, TableKind,
};

use crate::prelude::*;

macro_rules! private_functions {
    ($($slot:ident, $init:ident: $function:expr, $intrinsic:ident;)*) => {
        pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
            match slot {
                $(RealmSlot::$slot => cx.global().$init(create(cx, $function, Intrinsic::$intrinsic)),)*
                _ => return false,
            }
            true
        }
    };
}

private_functions! {
    private_is_iteration_pristine, init_private_is_iteration_pristine: is_iteration_pristine, None;
    private_map_storage, init_private_map_storage: start::<MapKind>, MapStorage;
    private_map_iteration_next, init_private_map_iteration_next: advance::<MapKind>, MapIterationNext;
    private_map_iteration_entry, init_private_map_iteration_entry: position::<MapKind>, MapIterationEntry;
    private_map_iteration_entry_key, init_private_map_iteration_entry_key: map_key, MapIterationEntryKey;
    private_map_iteration_entry_value, init_private_map_iteration_entry_value: map_value, MapIterationEntryValue;
    private_set_storage, init_private_set_storage: start::<SetKind>, SetStorage;
    private_set_iteration_next, init_private_set_iteration_next: advance::<SetKind>, SetIterationNext;
    private_set_iteration_entry, init_private_set_iteration_entry: position::<SetKind>, SetIterationEntry;
    private_set_iteration_entry_key, init_private_set_iteration_entry_key: set_key, SetIterationEntryKey;
}

fn create(cx: &Cx, function: NativeFunction, intrinsic: Intrinsic) -> Gc<JsFunction> {
    let (name, constructor) = (StringRef::empty(), native_not_a_constructor);
    let visibility = Visibility::Private;
    JsFunction::native_with(cx, 0, &name, function, constructor, intrinsic, visibility)
}

/// Whether no script can tell how often its `Symbol.iterator` is read.
#[native_abi]
fn is_iteration_pristine(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let value = frame.argument(0);
    let is_pristine = (value.downcast::<JsArray>()).is_some_and(|it| it.is_iteration_pristine())
        || (value.downcast::<JsSet>()).is_some_and(|it| it.is_iteration_pristine(cx))
        || (value.downcast::<JsMap>()).is_some_and(|it| it.is_iteration_pristine(cx));
    Ok(is_pristine.into())
}

#[native_abi]
fn start<K: TableKind>(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let collection = frame.argument(0).cast::<OrderedCollection<K>>();
    Ok(collection.cursor().parts().0.into())
}

#[native_abi]
fn advance<K: TableKind>(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let number = frame.argument(1).as_uint32().expect("a position");
    let cursor = OrderedCursor::<K>::from_parts(frame.argument(0).cast(), number);
    Ok(cursor.advance_for_builtin().map_or_default(Into::into))
}

#[native_abi]
fn position<K: TableKind>(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let table = frame.argument(0).cast::<OrderedTable<K>>();
    Ok(table.builtin_position().into())
}

#[native_abi]
fn map_key(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let entry = frame.argument(0).cast::<MapTable>();
    Ok(entry.item_at_builtin_position().map_or_default(|it| it.0))
}

#[native_abi]
fn map_value(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let table = frame.argument(0).cast::<MapTable>();
    Ok(table.item_at_builtin_position().map_or_default(|it| it.1))
}

#[native_abi]
fn set_key(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let table = frame.argument(0).cast::<SetTable>();
    Ok(table.item_at_builtin_position().unwrap_or_default())
}
