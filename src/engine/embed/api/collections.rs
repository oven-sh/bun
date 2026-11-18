use core::ffi::c_void;

use bun_engine_macros::export;
use bun_engine_vm::{
    Cx, Gc, IterationKind, JsCell, JsFinalizationRegistry, JsMap, JsMapIterator, JsObject,
    JsResult, JsSet, JsSetIterator, JsWeakMap, JsWeakSet, Shape, Value, Vm,
};

#[export]
fn map_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsMap> {
    JsMap::create_with_shape(vm, shape)
}

#[export]
fn map_get(map: &JsMap, cx: &Cx, key: Value) -> JsResult<Value> {
    map.get(cx, key)
}

#[export]
fn map_has(map: &JsMap, cx: &Cx, key: Value) -> JsResult<bool> {
    map.has(cx, key)
}

#[export]
fn map_set(map: &JsMap, cx: &Cx, key: Value, value: Value) -> JsResult<()> {
    map.set(cx, key, value)
}

#[export]
fn map_remove(map: &JsMap, cx: &Cx, key: Value) -> JsResult<bool> {
    map.remove(cx, key)
}

#[export]
fn map_clear(map: &JsMap, vm: &Vm) {
    map.clear(vm);
}

#[export]
fn set_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsSet> {
    JsSet::create_with_shape(vm, shape)
}

#[export]
fn set_has(set: &JsSet, cx: &Cx, key: Value) -> JsResult<bool> {
    set.has(cx, key)
}

#[export]
fn set_add(set: &JsSet, cx: &Cx, key: Value) -> JsResult<()> {
    set.add(cx, key)
}

#[export]
fn set_remove(set: &JsSet, cx: &Cx, key: Value) -> JsResult<bool> {
    set.remove(cx, key)
}

#[export]
fn map_iterator_create(
    vm: &Vm,
    shape: Gc<Shape>,
    map: Gc<JsMap>,
    kind: IterationKind,
) -> Gc<JsMapIterator> {
    JsMapIterator::create_with_shape(vm, shape, map, kind)
}

/// The key.
#[export]
fn map_iterator_next(
    iterator: &JsMapIterator,
    vm: &Vm,
    value: &mut Option<Value>,
) -> Option<Value> {
    let (key, found) = iterator.next_item(vm).unzip();
    *value = found;
    key
}

#[export]
fn set_iterator_create(
    vm: &Vm,
    shape: Gc<Shape>,
    set: Gc<JsSet>,
    kind: IterationKind,
) -> Gc<JsSetIterator> {
    JsSetIterator::create_with_shape(vm, shape, set, kind)
}

#[export]
fn set_iterator_next(iterator: &JsSetIterator, vm: &Vm) -> Option<Value> {
    iterator.next_item(vm)
}

#[export]
fn weak_map_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsWeakMap> {
    JsWeakMap::create_with_shape(vm, shape)
}

#[export]
fn weak_map_size(map: &JsWeakMap) -> u32 {
    map.size()
}

#[export]
fn weak_map_get(map: &JsWeakMap, key: Gc<JsCell>) -> Value {
    map.get(key)
}

#[export]
fn weak_map_has(map: &JsWeakMap, key: Gc<JsCell>) -> bool {
    map.has(key)
}

#[export]
fn weak_map_set(map: &JsWeakMap, key: Gc<JsCell>, value: Value) {
    (map.set(key, value)).unwrap_or_else(|_| bun_alloc::out_of_memory());
}

#[export]
fn weak_set_create(vm: &Vm, shape: Gc<Shape>) -> Gc<JsWeakSet> {
    JsWeakSet::create_with_shape(vm, shape)
}

#[export]
fn weak_set_has(set: &JsWeakSet, key: Gc<JsCell>) -> bool {
    set.has(key)
}

#[export]
fn weak_set_add(set: &JsWeakSet, key: Gc<JsCell>) {
    set.add(key).unwrap_or_else(|_| bun_alloc::out_of_memory());
}

#[export]
unsafe fn weak_set_for_each(
    set: &JsWeakSet,
    cx: &mut Cx,
    visit: unsafe extern "C" fn(*mut c_void, Value),
    context: *mut c_void,
) {
    for key in set.items(&cx.no_gc()) {
        // SAFETY: the two go together, and it allocates nothing in the heap.
        unsafe { visit(context, key) };
    }
}

#[export]
fn finalization_registry_callback(registry: &JsFinalizationRegistry) -> Gc<JsObject> {
    registry.callback()
}
