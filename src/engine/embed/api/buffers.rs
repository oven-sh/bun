use core::ffi::c_void;
use core::ptr::NonNull;

use bun_alloc::AllocError;
use bun_engine_macros::export;
use bun_engine_vm::{
    ArrayBuffer, ArrayBufferContents, ArrayBufferRef, BufferAccessor, CopyOrder, Cx, FreeBytes, Gc,
    JsArrayBuffer, JsArrayBufferView, JsObject, JsResult, JsTypedArray, JsUint8Array,
    NativeFunction, Shape, Vm, is_shape_of_resizable_view,
};

use crate::abi::returned_as_pointer;

returned_as_pointer! {
    ArrayBufferRef,
}

#[export]
unsafe fn array_buffer_contents_destroy(contents: *mut ArrayBufferContents) {
    // SAFETY: C++ does not use them again.
    unsafe { contents.drop_in_place() }
}

#[export]
fn array_buffer_contents_share(
    contents: &ArrayBufferContents,
    result: &mut ArrayBufferContents,
) -> bool {
    contents.share().map(|share| *result = share).is_some()
}

fn try_new(contents: Result<ArrayBufferContents, AllocError>) -> Option<ArrayBufferRef> {
    contents.and_then(ArrayBufferRef::try_new).ok()
}

#[export]
fn array_buffer_try_zeroed(byte_length: usize) -> Option<ArrayBufferRef> {
    try_new(ArrayBufferContents::try_zeroed(byte_length))
}

#[export]
unsafe fn array_buffer_try_uninitialized(byte_length: usize) -> Option<ArrayBufferRef> {
    // SAFETY: C++ writes them.
    try_new(unsafe { ArrayBufferContents::try_uninitialized(byte_length) })
}

#[export]
fn array_buffer_try_resizable(
    byte_length: usize,
    max_byte_length: usize,
) -> Option<ArrayBufferRef> {
    try_new(ArrayBufferContents::try_resizable(
        byte_length,
        max_byte_length,
    ))
}

#[export]
fn array_buffer_from_contents(contents: &mut ArrayBufferContents) -> ArrayBufferRef {
    ArrayBufferRef::new(core::mem::take(contents))
}

#[export]
unsafe fn array_buffer_adopt(data: *const u8, byte_length: usize) -> ArrayBufferRef {
    // SAFETY: C++ gives the allocation up.
    ArrayBufferRef::new(unsafe { ArrayBufferContents::adopt(data.cast_mut(), byte_length) })
}

#[export]
unsafe fn array_buffer_external(
    data: *const u8,
    byte_length: usize,
    free: Option<FreeBytes>,
    context: *mut c_void,
) -> ArrayBufferRef {
    let byte_length = if data.is_null() { 0 } else { byte_length };
    // SAFETY: C++ vouches for them.
    ArrayBufferRef::new(unsafe {
        ArrayBufferContents::external(data.cast_mut(), byte_length, free, context)
    })
}

#[export]
unsafe fn array_buffer_destroy(buffer: *const ArrayBuffer) {
    // SAFETY: C++ has released the last reference.
    unsafe { ArrayBufferRef::destroy(NonNull::new_unchecked(buffer.cast_mut())) }
}

#[export]
fn array_buffer_is_wasm_memory(buffer: &ArrayBuffer) -> bool {
    buffer.is_wasm_memory()
}

#[export]
fn array_buffer_make_shared(buffer: &ArrayBuffer) {
    buffer.make_shared();
}

#[export]
fn array_buffer_pin(buffer: &ArrayBuffer) {
    buffer.pin();
}

#[export]
fn array_buffer_unpin(buffer: &ArrayBuffer) {
    buffer.unpin();
}

#[export]
fn array_buffer_is_detachable(buffer: &ArrayBuffer) -> bool {
    buffer.is_detachable()
}

#[export]
unsafe fn array_buffer_detach(buffer: &ArrayBuffer, vm: &Vm) {
    // SAFETY: Rust does not call out while it borrows the bytes.
    drop(unsafe { buffer.detach_unchecked(vm) });
}

#[export]
unsafe fn array_buffer_transfer(
    buffer: &ArrayBuffer,
    vm: &Vm,
    result: &mut ArrayBufferContents,
) -> bool {
    // SAFETY: as above.
    let contents = unsafe { buffer.transfer_unchecked(vm) };
    contents.map(|contents| *result = contents).is_some()
}

#[export]
fn js_array_buffer_create(vm: &Vm, shape: Gc<Shape>, buffer: &ArrayBuffer) -> Gc<JsArrayBuffer> {
    JsArrayBuffer::create(vm, shape, buffer)
}

/// The shape, or its counterpart if it is for the other kind of buffer.
#[inline(always)]
fn shape_for_buffer(cx: &Cx, shape: Gc<Shape>, buffer: &ArrayBuffer) -> Gc<Shape> {
    #[cold]
    fn counterpart(cx: &Cx, shape: &Shape, is_resizable: bool) -> Gc<Shape> {
        let global = shape.global().unwrap_or_else(|| cx.global());
        let base = global.view_shape(cx, shape.instance_type(), is_resizable);
        if shape.prototype() == base.prototype() {
            return base;
        }
        base.with_prototype(cx, global, shape.prototype().cast())
    }
    let is_resizable = buffer.is_resizable_or_growable();
    if is_shape_of_resizable_view(&shape) == is_resizable {
        return shape;
    }
    counterpart(cx, &shape, is_resizable)
}

#[export]
fn view_create_on_buffer(
    cx: &Cx,
    shape: Gc<Shape>,
    buffer: &ArrayBuffer,
    byte_offset: usize,
    length: usize,
    has_length: bool,
) -> JsResult<Gc<JsArrayBufferView>> {
    let (shape, length) = (
        shape_for_buffer(cx, shape, buffer),
        has_length.then_some(length),
    );
    JsArrayBufferView::create_on_buffer(cx, shape, buffer, byte_offset, length)
}

#[export]
fn view_recreate_on_buffer(
    cx: &Cx,
    shape: Gc<Shape>,
    buffer: &ArrayBuffer,
    byte_offset: usize,
    length: usize,
    has_length: bool,
) -> JsResult<Gc<JsArrayBufferView>> {
    let length = has_length.then_some(length);
    JsArrayBufferView::recreate_on_buffer(cx, shape, buffer, byte_offset, length)
}

#[export]
fn view_length(view: &JsArrayBufferView) -> usize {
    view.compute_length().unwrap_or(0)
}

#[export]
fn view_is_out_of_bounds(view: &JsArrayBufferView) -> bool {
    view.compute_length().is_none()
}

#[export]
unsafe fn view_create_buffer(view: &JsArrayBufferView) -> *mut ArrayBuffer {
    // SAFETY: Rust does not call out while it borrows the elements.
    let buffer = unsafe { view.buffer_unchecked(view.heap_unchecked().vm()) };
    buffer.map_or(core::ptr::null_mut(), |it| (&raw const *it).cast_mut())
}

#[export]
fn view_js_buffer(view: &JsArrayBufferView, cx: &mut Cx) -> JsResult<Gc<JsArrayBuffer>> {
    view.js_buffer(cx)
}

#[export]
unsafe fn view_try_pin(view: &JsArrayBufferView) -> bool {
    // SAFETY: as above.
    unsafe { view.pin(view.heap_unchecked().vm()) }.is_ok()
}

#[export]
fn view_unpin(view: &JsArrayBufferView) {
    view.unpin();
}

#[export]
fn typed_array_create(cx: &Cx, shape: Gc<Shape>, length: usize) -> JsResult<Gc<JsTypedArray>> {
    JsTypedArray::create(cx, shape, length)
}

#[export]
unsafe fn typed_array_create_uninitialized(
    cx: &Cx,
    shape: Gc<Shape>,
    length: usize,
) -> JsResult<Gc<JsTypedArray>> {
    // SAFETY: C++ writes them.
    unsafe { JsTypedArray::create_uninitialized(cx, shape, length) }
}

#[export]
unsafe fn uint8_array_adopt(
    vm: &Vm,
    shape: Gc<Shape>,
    data: *const u8,
    length: usize,
) -> Gc<JsTypedArray> {
    // SAFETY: C++ gives the allocation up.
    unsafe { JsTypedArray::adopt(vm, shape, data.cast_mut(), length) }
        .cast::<JsUint8Array>()
        .upcast()
}

#[export]
fn typed_array_set_from_typed_array(
    array: &JsTypedArray,
    cx: &mut Cx,
    offset: usize,
    source: &JsArrayBufferView,
    source_offset: usize,
    length: usize,
    order: CopyOrder,
) -> JsResult<bool> {
    let Some(source) = source.downcast::<JsTypedArray>() else {
        return Err(cx.throw_type_error("Argument needs to be a typed array."));
    };
    let range = source_offset..source_offset.saturating_add(length);
    (array.set_from_typed_array(cx, offset, &source, range, order)).map(|()| true)
}

#[export]
fn typed_array_set_from_object(
    array: &JsTypedArray,
    cx: &mut Cx,
    offset: usize,
    source: &JsObject,
    source_offset: usize,
    length: usize,
) -> JsResult<bool> {
    let range = source_offset..source_offset.saturating_add(length);
    (array.set_from_object(cx, offset, source, range)).map(|()| true)
}

#[export]
fn buffer_accessor_register(accessor: &BufferAccessor, function: NativeFunction) {
    accessor.register(function);
}
