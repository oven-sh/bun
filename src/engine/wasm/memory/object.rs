//! The object for a memory, and the buffer that it has at a time.

use core::cell::Cell;
use core::mem::offset_of;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_vm::{
    ArrayBufferContents, ArrayBufferRef, Field, GcFree, JsArrayBuffer, JsDestructibleObject,
    SharedArrayBufferContents, Visitor, Vm,
};
use bun_engine_wasm_runtime::{GrowError, Memory, Store};

use super::contents;
use crate::owned::host_cell;
use crate::prelude::*;

struct LinearMemory(Rc<Memory>);

// SAFETY: the only cell that it knows of is the one that has this.
unsafe impl GcFree for LinearMemory {}

struct DataBlock(Option<Arc<SharedArrayBufferContents>>);

// SAFETY: threads share it, and it knows of no heap.
unsafe impl GcFree for DataBlock {}

#[cell(
    name = "WebAssembly.Memory",
    export = "engine_class_WasmMemory",
    visit_children
)]
pub(crate) struct WasmMemory {
    base: JsDestructibleObject,
    memory: LinearMemory,
    /// If it is shared.
    block: DataBlock,
    /// The buffer, unless it is the following.
    fresh_buffer: Field<Option<Gc<JsArrayBuffer>>>,
    /// One that is shared and has the fixed length `known_length`. Another thread may have grown the memory since.
    aging_buffer: Field<Option<Gc<JsArrayBuffer>>>,
    /// The length when this thread last heard of it.
    known_length: AtomicUsize,
    /// How many of the bytes the heap has counted as allocated.
    reported_bytes: Cell<usize>,
}

fn allocate(
    cx: &Cx,
    shape: Gc<Shape>,
    memory: &Rc<Memory>,
    block: Option<Arc<SharedArrayBufferContents>>,
) -> Gc<WasmMemory> {
    let length = memory.len() as usize;
    let object = cx.allocate::<WasmMemory>(WasmMemoryInit {
        base: JsObjectInit::new(cx, shape),
        memory: LinearMemory(Rc::clone(memory)),
        block: DataBlock(block),
        fresh_buffer: None,
        aging_buffer: None,
        known_length: AtomicUsize::new(length),
        reported_bytes: Cell::new(length),
    });
    // SAFETY: the object keeps the memory.
    unsafe { memory.set_owner(host_cell(object.cell())) };
    cx.heap.report_extra_memory_allocated(&object, length);
    object
}

/// For a new memory.
pub(crate) fn create(cx: &Cx, shape: Gc<Shape>, memory: &Rc<Memory>) -> Gc<WasmMemory> {
    allocate(cx, shape, memory, contents::new_data_block(memory))
}

/// `block` is from `WasmMemory::data_block`.
pub(crate) fn create_for_shared(
    cx: &Cx,
    shape: Gc<Shape>,
    store: &Rc<Store>,
    block: Arc<SharedArrayBufferContents>,
) -> Gc<WasmMemory> {
    let memory = Memory::from_shared(store, contents::memory_of(&block));
    allocate(cx, shape, &memory, Some(block))
}

impl WasmMemory {
    pub(super) const OFFSET_OF_FRESH_BUFFER: usize = offset_of!(WasmMemory, fresh_buffer);

    pub(crate) fn of(memory: &Memory) -> Gc<WasmMemory> {
        let owner = memory.owner().expect("an owner");
        // SAFETY: `allocate` makes every owner, and instances keep those of their memories.
        unsafe { Gc::from_address(owner.address()) }
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.report_extra_memory(self.known_length.load(Ordering::Relaxed));
    }

    pub(crate) fn memory(&self) -> &Rc<Memory> {
        &self.memory.0
    }

    /// `None` unless it is shared.
    pub(crate) fn data_block(&self) -> Option<Arc<SharedArrayBufferContents>> {
        self.block.0.clone()
    }

    /// Gives the number of pages before.
    pub(super) fn grow(&self, _: &mut Cx, pages: u64) -> Result<u64, GrowError> {
        anchor!(self).memory.0.grow(pages)
    }

    #[inline]
    pub(super) fn buffer(&self, cx: &mut Cx) -> JsResult<Gc<JsArrayBuffer>> {
        let known_length = self.known_length.load(Ordering::Relaxed);
        let is_whole = |_: &_| {
            self.block
                .0
                .iter()
                .all(|it| it.byte_length() == known_length)
        };
        let current = (self.fresh_buffer()).or_else(|| self.aging_buffer().filter(is_whole));
        current.map_or_else(|| self.make_buffer(cx, false), Ok)
    }

    pub(super) fn buffer_of_kind(
        &self,
        cx: &mut Cx,
        is_resizable: bool,
    ) -> JsResult<Gc<JsArrayBuffer>> {
        match self.fresh_buffer() {
            Some(buffer) if buffer.is_resizable_or_growable() == is_resizable => return Ok(buffer),
            // SAFETY: a borrow would need the `Cx`.
            Some(buffer) => unsafe { self.give_up(cx, buffer) },
            None if !is_resizable => return self.buffer(cx),
            None => {}
        }
        self.make_buffer(cx, is_resizable)
    }

    #[inline(never)]
    fn make_buffer(&self, cx: &mut Cx, is_resizable: bool) -> JsResult<Gc<JsArrayBuffer>> {
        let contents = match self.data_block() {
            Some(block) => ArrayBufferContents::shared(block, !is_resizable),
            None => contents::unshared(&self.memory.0, is_resizable),
        };
        let bytes = cx.or_out_of_memory(ArrayBufferRef::try_new(contents))?;
        bytes.make_wasm_memory();
        let length = bytes.byte_length();
        let reported = self.reported_bytes.replace(length).min(length);
        self.known_length.store(length, Ordering::Relaxed);
        let shape = cx.global().array_buffer_shape_for(cx, bytes.is_shared());
        let buffer = JsArrayBuffer::create_with_reported_bytes(cx, shape, &bytes, reported);
        if bytes.is_shared() {
            buffer.freeze_or_throw(cx)?;
        } else {
            buffer.set_wasm_memory(Some(Gc::from(self).upcast()));
        }
        let ages = bytes.is_shared() && !is_resizable;
        self.set_fresh_buffer((!ages).then_some(buffer));
        self.set_aging_buffer(ages.then_some(buffer));
        Ok(buffer)
    }

    /// # Safety
    /// Nothing borrows the bytes.
    unsafe fn give_up(&self, vm: &Vm, buffer: Gc<JsArrayBuffer>) {
        self.set_fresh_buffer(None);
        if !buffer.is_shared() {
            buffer.set_wasm_memory(None);
            // SAFETY: the caller's.
            drop(unsafe { buffer.buffer().detach_unchecked(vm) });
        }
    }

    /// Refreshes the buffer. May collect.
    ///
    /// # Safety
    /// Nothing borrows the bytes of a buffer, as when a script runs.
    pub(crate) unsafe fn did_grow(&self, vm: &Vm, old_length: u64) {
        match self.fresh_buffer() {
            // SAFETY: the caller's.
            Some(buffer) if !buffer.is_resizable_or_growable() => unsafe {
                self.give_up(vm, buffer);
            },
            // SAFETY: the caller's.
            Some(buffer) if !buffer.is_shared() => unsafe {
                let grown = contents::unshared(&self.memory.0, true);
                buffer.buffer().did_grow_wasm_memory(vm, grown);
            },
            _ => {}
        }
        self.set_aging_buffer(None);
        let length = self.memory.0.len() as usize;
        let added = length - old_length as usize;
        self.known_length.store(length, Ordering::Relaxed);
        self.reported_bytes.update(|it| it.saturating_add(added));
        vm.heap.report_extra_memory_allocated(self, added);
    }
}
