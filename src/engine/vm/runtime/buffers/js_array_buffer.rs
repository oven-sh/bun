use core::mem::offset_of;
use core::ptr::NonNull;

use bun_engine_macros::cell;

use super::array_buffer::{ArrayBuffer, ArrayBufferRef, HeldBuffer, retry_after_collection};
use super::contents::ArrayBufferContents;
use super::slice::BufferSlice;
use crate::{
    CellKind, Cx, Field, Gc, GlobalObject, JsObject, JsObjectInit, JsResult, NoGc, Shape, Vm,
};

/// An `ArrayBuffer` or a `SharedArrayBuffer`.
#[cell(name = "ArrayBuffer", cell_type = ArrayBuffer, export = "engine_class_ArrayBuffer", estimated_size)]
pub struct JsArrayBuffer {
    base: JsObject,
    buffer: NonNull<ArrayBuffer>,
    /// The `WebAssembly.Memory`, not shared, whose bytes the buffer has.
    pub wasm_memory: Field<Option<Gc<JsObject>>>,
}

impl GlobalObject {
    #[inline]
    pub fn array_buffer_shape_for(&self, vm: &Vm, is_shared: bool) -> Gc<Shape> {
        if is_shared {
            self.shared_array_buffer_shape(vm)
        } else {
            self.array_buffer_shape(vm)
        }
    }
}

impl JsArrayBuffer {
    pub const OFFSET_OF_BUFFER: usize = offset_of!(JsArrayBuffer, buffer);

    /// Becomes the object that stands for the buffer.
    #[inline]
    pub fn create(vm: &Vm, shape: Gc<Shape>, buffer: &ArrayBuffer) -> Gc<JsArrayBuffer> {
        Self::create_with_reported_bytes(vm, shape, buffer, 0)
    }

    /// The heap has been told of the allocation of so many of the bytes.
    #[inline]
    pub fn create_with_reported_bytes(
        vm: &Vm,
        shape: Gc<Shape>,
        buffer: &ArrayBuffer,
        already_reported: usize,
    ) -> Gc<JsArrayBuffer> {
        let wrapper = vm.allocate::<JsArrayBuffer>(JsArrayBufferInit {
            base: JsObjectInit::new(vm, shape),
            buffer: NonNull::from(buffer),
            wasm_memory: None,
        });
        buffer.set_wrapper(vm, &wrapper, already_reported);
        vm.heap.collect_if_extra_memory_adds_up();
        wrapper
    }

    /// The object that stands for the buffer. It is made in that realm if there is none.
    #[inline]
    pub fn wrap(vm: &Vm, global: &GlobalObject, buffer: &ArrayBuffer) -> Gc<JsArrayBuffer> {
        buffer.wrapper(vm).unwrap_or_else(|| {
            let shape = global.array_buffer_shape_for(vm, buffer.is_shared());
            Self::create(vm, shape, buffer)
        })
    }

    pub fn from_contents(
        cx: &Cx,
        shape: Gc<Shape>,
        contents: ArrayBufferContents,
    ) -> JsResult<Gc<JsArrayBuffer>> {
        let buffer = cx.or_out_of_memory(ArrayBufferRef::try_new(contents))?;
        Ok(Self::create(cx, shape, &buffer))
    }

    /// AllocateArrayBuffer and AllocateSharedArrayBuffer, once the prototype is known.
    pub fn allocate(
        cx: &Cx,
        shape: Gc<Shape>,
        byte_length: u64,
        max_byte_length: Option<u64>,
        is_shared: bool,
    ) -> JsResult<Gc<JsArrayBuffer>> {
        let byte_length = byte_length as usize;
        cx.heap.will_allocate_extra_memory(byte_length);
        let mut contents = cx.or_out_of_memory(match max_byte_length {
            None => ArrayBufferContents::try_zeroed(byte_length),
            Some(max) => retry_after_collection(
                cx,
                |_| byte_length.max(max as usize) <= super::MAX_ARRAY_BUFFER_SIZE,
                || ArrayBufferContents::try_resizable(byte_length, max as usize),
            ),
        })?;
        if is_shared {
            contents = contents.into_shared();
        }
        Self::from_contents(cx, shape, contents)
    }

    #[inline(always)]
    pub fn buffer(&self) -> HeldBuffer {
        // SAFETY: added when it was made.
        unsafe { HeldBuffer::new(self, self.buffer) }
    }

    #[inline(always)]
    pub fn is_shared(&self) -> bool {
        self.buffer().is_shared()
    }

    #[inline(always)]
    pub fn is_detached(&self) -> bool {
        self.buffer().is_detached()
    }

    #[inline(always)]
    pub fn is_resizable_or_growable(&self) -> bool {
        self.buffer().is_resizable_or_growable()
    }

    #[inline(always)]
    pub fn byte_length(&self) -> usize {
        self.buffer().byte_length()
    }

    #[inline(always)]
    pub fn bytes<'a>(&'a self, no_gc: &'a NoGc<'_>) -> BufferSlice<'a, u8> {
        // SAFETY: nothing dies while the token is alive.
        unsafe { self.buffer.as_ref() }.bytes(no_gc)
    }

    fn estimated_size(&self, vm: &Vm) -> usize {
        // SAFETY: the method of the base.
        let own = unsafe { (JsObject::OPS.estimated_size)(self, vm) };
        own + self.buffer().estimated_size()
    }
}
