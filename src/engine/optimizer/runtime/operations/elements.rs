//! For what is indexed.

use core::num::NonZeroUsize;

use bun_engine_macros::native_abi;
use bun_engine_text::PropertyName;
use bun_engine_vm::caches::try_has_own_property;
use bun_engine_vm::heap::Space;
use bun_engine_vm::{
    self as vm, BufferSlice, CellType, Cx, Gc, ImmutableArray, JsArray, JsArrayBufferView,
    JsObject, JsResult, JsString, JsTypedArray, Shape, Value, Vm,
};

use super::{Address, Operation, Returned};

fn allocate_words(cx: &Cx, space: &Space, words: u32) -> JsResult<NonZeroUsize> {
    // SAFETY: the code goes on to do that.
    let address = unsafe { space.try_allocate_uninitialized(&cx.heap, words as usize * 8) };
    NonZeroUsize::new(address).ok_or_else(|| cx.throw_out_of_memory())
}

operations! {
    ALLOCATE_LARGE_CELL: fn allocate_large_cell(cx: &Cx, words: u32) -> JsResult<NonZeroUsize> {
        allocate_words(cx, &cx.heap.cells, words)
    }
    ALLOCATE_LARGE_STORAGE: fn allocate_large_storage(cx: &Cx, words: u32) -> JsResult<NonZeroUsize> {
        allocate_words(cx, &cx.heap.auxiliary, words)
    }
    NEW_TYPED_ARRAY: fn new_typed_array(cx: &Cx, shape: Gc<Shape>, length: u32) -> JsResult<Gc<JsTypedArray>> {
        JsTypedArray::create(cx, shape, length as usize)
    }
    // One more than the answer.
    HAS_OWN: fn has_own(cx: &mut Cx, object: Gc<JsObject>, key: Value) -> u32 {
        try_has_own_property(cx, &object, key).map_or(0, |answer| 1 + u32::from(answer))
    }
    NEW_LONG_ARRAY: fn new_long_array(cx: &Cx, shape: Gc<Shape>, length: u32) -> JsResult<Gc<JsArray>> {
        cx.or_out_of_memory(JsArray::try_create(cx, shape, length, 0))
    }
    NEW_ARRAY_WITH_SPREAD: fn new_array_with_spread(
        cx: &Cx, parts: *const Option<Value>, count: usize
    ) -> JsResult<Gc<JsArray>> {
        // SAFETY: the code has put that many there.
        vm::new_array_with_spread(cx, unsafe { core::slice::from_raw_parts(parts, count) })
    }
    SPREAD: fn spread(cx: &mut Cx, iterable: Value) -> JsResult<Gc<ImmutableArray>> {
        vm::spread(cx, iterable)
    }
    SPREAD_ELEMENTS: fn spread_elements(cx: &mut Cx, object: Value) -> usize {
        let list = vm::try_spread_directly(cx, object);
        let list = list.map_err(|thrown| cx.discard_unless_termination(thrown));
        list.ok().flatten().map_or(0, |it| it.address())
    }
    MAKE_NAME: fn make_name(cx: &Cx, key: Gc<JsString>) -> u32 {
        let key = key.to_property_key(cx).map_err(|it| cx.discard_unless_termination(it));
        key.is_ok_and(|it| it.name().as_index().is_none()).into()
    }
    HAS_TEXT: fn has_text(cx: &Cx, string: Gc<JsString>, name: PropertyName<'_>) -> usize {
        let has_length = string.len() as usize == name.text().len();
        (has_length && string.try_resolve(cx).is_ok_and(|it| it.text() == name.text())).into()
    }
    STORE_PLAIN_ELEMENT: fn store_plain_element(cx: &Cx, object: Gc<JsObject>, key: i32, value: Value) -> usize {
        u32::try_from(key).is_ok_and(|index| object.try_store_plain_element(cx, index, value)).into()
    }
}

leaves! {
    COPY_WORDS: fn copy_words(target: *mut u64, source: *const u64, count: u32) -> () {
        // SAFETY: the code has just made the target, with room for that many.
        unsafe { target.copy_from_nonoverlapping(source, count as usize) }
    }
    SPECIES_IS_ARRAY: fn species_is_array(cx: &Cx, original: &JsObject) -> u32 {
        match original.as_exact_array() {
            Some(array) => array.realm() == Some(cx.global()) && array.has_default_species(cx),
            None => !matches!(original.cell_type(), CellType::DerivedArray | CellType::Proxy),
        }
        .into()
    }
    LOOK_UP_ELEMENT: fn look_up_element(vm: &Vm, object: &JsObject, key: i32) -> Option<Value> {
        object.look_up_int32(vm, key).map(Option::unwrap_or_default)
    }
    LOOK_UP_NAME: fn look_up_name(object: &JsObject, name: PropertyName<'_>) -> Option<Value> {
        object.look_up_name(name).map(Option::unwrap_or_default)
    }
    HAS_ELEMENT: fn has_element(vm: &Vm, object: &JsObject, key: i32) -> Option<Value> {
        object.look_up_int32(vm, key).map(|found| found.is_some().into())
    }
    HALF_TO_DOUBLE: fn half_to_double(bits: u32) -> f64 {
        bun_engine_number::float16_to_f64(bits as u16)
    }
    DOUBLE_TO_HALF: fn double_to_half(number: f64) -> u32 {
        bun_engine_number::float16_from_f64(number).into()
    }
    CLEAR_WORDS: fn clear_words(first: *mut u64, count: u32) -> () {
        // SAFETY: the code has just allocated that many.
        unsafe { first.write_bytes(0, count as usize) }
    }
    MOVE_BYTES: fn move_bytes(target: *mut u8, source: *mut u8, count: usize) -> () {
        // SAFETY: both views have that many, and nothing borrows them while code runs.
        unsafe { BufferSlice::<u8>::new(target, count).copy_from(BufferSlice::new(source, count)) }
    }
    OFFSET_OF_VIEW: fn offset_of_view(view: &JsArrayBufferView) -> usize {
        view.byte_offset()
    }
    LENGTH_OF_VIEW: fn length_of_view(view: &JsArrayBufferView) -> usize {
        view.length()
    }
}
