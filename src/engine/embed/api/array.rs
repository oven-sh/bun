use bun_engine_macros::export;
use bun_engine_vm::{
    Cx, ElementKind, Gc, ImmutableArray, JsArray, JsResult, Shape, Value, Vm, is_array,
};

#[export]
fn array_try_create(vm: &Vm, shape: Gc<Shape>, length: u32) -> Option<Gc<JsArray>> {
    JsArray::try_create(vm, shape, length, 0).ok()
}

#[export]
fn array_try_create_dense(vm: &Vm, shape: Gc<Shape>, length: u32) -> Option<Gc<JsArray>> {
    JsArray::try_create_dense(vm, shape, length).ok()
}

#[export]
fn array_with_length(cx: &Cx, length: u32) -> JsResult<Gc<JsArray>> {
    cx.new_array_with_length(ElementKind::Undecided, length)
}

#[export]
fn array_from_values(cx: &Cx, values: &[Value]) -> JsResult<Gc<JsArray>> {
    cx.new_array_from(values)
}

#[export]
fn array_from_values_with_shape(vm: &Vm, shape: Gc<Shape>, values: &[Value]) -> Gc<JsArray> {
    JsArray::try_from_values_with_shape(vm, shape, values)
        .unwrap_or_else(|_| bun_alloc::out_of_memory())
}

#[export]
fn array_set_length(
    array: &JsArray,
    cx: &mut Cx,
    length: u32,
    should_throw: bool,
) -> JsResult<bool> {
    array.set_length(cx, length, should_throw)
}

#[export]
fn array_push(array: &JsArray, cx: &mut Cx, value: Value) -> JsResult<()> {
    array.push(cx, value)
}

#[export]
fn array_next_present_index(array: &JsArray, start: u32) -> u64 {
    array.next_element_index(start).map_or(u64::MAX, u64::from)
}

#[export]
fn array_skip_holes(array: &JsArray, start: u32, end: u32) -> u32 {
    array.skip_holes(start.into()..end.into()) as u32
}

#[export]
fn array_is_iteration_pristine(array: &JsArray) -> bool {
    array.is_iteration_pristine()
}

#[export]
fn proxy_is_array(cx: &Cx, value: Value) -> JsResult<bool> {
    is_array(cx, value)
}

#[export]
fn immutable_array_try_from_values(vm: &Vm, values: &[Value]) -> Option<Gc<ImmutableArray>> {
    ImmutableArray::try_from_values(vm, values).ok()
}
