use core::cell::Cell;
use core::mem::offset_of;
use core::ptr::{NonNull, null_mut, with_exposed_provenance_mut};

use bun_alloc::AllocError;
use bun_engine_macros::cell;

use super::array_buffer::{ArrayBuffer, ArrayBufferRef, HeldBuffer};
use super::borrow::Borrowed;
use super::contents::{ArrayBufferContents, MAX_ARRAY_BUFFER_SIZE};
use super::element::ElementType;
use super::slice::BufferSlice;
use crate::heap::{barrier, delay};
use crate::{
    CellKind, CellType, Class, Cx, Gc, GlobalObject, JsArrayBuffer, JsObject, JsObjectInit,
    JsResult, JsTypedArray, NoGc, RealmSlot, Shape, Thrown, Value, Visitor, Vm, errors,
};

bitflags::bitflags! {
    /// Without any: a small typed array whose vector is in the heap.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct ViewMode: u8 {
        /// Reaches to the end of the buffer.
        const AUTO_LENGTH = 1 << 0;
        const GROWABLE_SHARED = 1 << 1;
        /// And not shared.
        const RESIZABLE = 1 << 2;
        const HAS_BUFFER = 1 << 3;
        const SHARED = 1 << 4;
        /// The view owns an allocation of the default allocator.
        const OVERSIZE = 1 << 5;

        const RESIZABLE_OR_GROWABLE = Self::GROWABLE_SHARED.bits() | Self::RESIZABLE.bits();
    }
}

/// A typed array or a `DataView`.
#[cell(name = "ArrayBufferView", cell_type = Int8Array..=DataView, export = "engine_class_ArrayBufferView",
    visit_children, estimated_size)]
pub struct JsArrayBufferView {
    base: JsObject,
    /// Null if the buffer is detached.
    vector: Cell<*mut u8>,
    /// So many elements are accessible in any mode. With `RESIZABLE_OR_GROWABLE` there can be more.
    length: Cell<usize>,
    byte_offset_and_mode: Cell<u64>,
    /// With `HAS_BUFFER` its address. With `OVERSIZE` the number of pins.
    buffer: Cell<usize>,
}

/// An instance of a class for views on buffers whose length can change.
#[repr(C)]
pub(super) struct ResizableView {
    view: JsArrayBufferView,
    /// `[[ArrayLength]]` or `[[ByteLength]]`, zero for auto.
    declared_length: usize,
}

/// The vector of a view that is small and has no elements.
static NO_ELEMENTS: u64 = 0;

#[inline(always)]
const fn size_shift_of(cell_type: CellType) -> u32 {
    let index = cell_type.0.wrapping_sub(CellType::Int8Array.0);
    ElementType::PACKED_SIZE_SHIFTS >> (index as u32 * 2 % u32::BITS) & 3
}

/// Whether the shape is for views on buffers whose length can change.
#[inline(always)]
pub fn is_shape_of_resizable_view(shape: &Shape) -> bool {
    shape.class().size() == size_of::<ResizableView>()
}

impl GlobalObject {
    /// `cell_type` is one of `BUFFER_VIEWS`.
    #[inline(always)]
    pub fn view_shape(&self, vm: &Vm, cell_type: CellType, is_resizable: bool) -> Gc<Shape> {
        let first = if is_resizable {
            RealmSlot::resizable_int8_array_shape
        } else {
            RealmSlot::int8_array_shape
        };
        assert!(CellType::BUFFER_VIEWS.contains(cell_type));
        let slot = first.offset_by(usize::from(cell_type.0 - CellType::Int8Array.0));
        // SAFETY: a run of shapes, one for each type.
        unsafe { self.slot(vm, slot).cast_unchecked() }
    }
}

impl JsArrayBufferView {
    pub const OFFSET_OF_VECTOR: usize = offset_of!(JsArrayBufferView, vector);
    pub const OFFSET_OF_LENGTH: usize = offset_of!(JsArrayBufferView, length);
    /// Under `BYTE_OFFSET_MASK`.
    pub const OFFSET_OF_BYTE_OFFSET: usize = offset_of!(JsArrayBufferView, byte_offset_and_mode);
    pub const OFFSET_OF_MODE: usize = Self::OFFSET_OF_BYTE_OFFSET + size_of::<u64>() - 1;
    pub const OFFSET_OF_BUFFER: usize = offset_of!(JsArrayBufferView, buffer);
    /// With `RESIZABLE_OR_GROWABLE`.
    pub const OFFSET_OF_DECLARED_LENGTH: usize = offset_of!(ResizableView, declared_length);
    pub const BYTE_OFFSET_MASK: u64 = u64::MAX >> u8::BITS;
    const MODE_SHIFT: u32 = u64::BITS - u8::BITS;
    /// Up to so many elements are put in the heap.
    pub const MAX_SMALL_LENGTH: usize = 1000;

    /// # Safety
    /// The shape is of one of the classes of views that this module declares, and what follows describes an instance.
    #[inline(always)]
    pub(super) unsafe fn allocate(
        vm: &Vm,
        shape: Gc<Shape>,
        vector: *mut u8,
        length: usize,
        byte_offset: usize,
        mode: ViewMode,
        buffer: usize,
    ) -> Gc<JsArrayBufferView> {
        let init = JsArrayBufferViewInit {
            base: JsObjectInit::new(vm, shape),
            vector: Cell::new(vector),
            length: Cell::new(length),
            byte_offset_and_mode: Cell::new(
                byte_offset as u64 | u64::from(mode.bits()) << Self::MODE_SHIFT,
            ),
            buffer: Cell::new(buffer),
        };
        let address = if mode.intersects(ViewMode::RESIZABLE_OR_GROWABLE) {
            let address = vm.allocate_cell_memory(size_of::<ResizableView>());
            let view = with_exposed_provenance_mut::<ResizableView>(address);
            // SAFETY: a new cell of that size.
            unsafe { (&raw mut (*view).declared_length).write(length) };
            address
        } else {
            vm.allocate_cell_memory(size_of::<JsArrayBufferView>())
        };
        // SAFETY: a new cell that is large enough. The classes add nothing else.
        unsafe {
            JsArrayBufferView::initialize(with_exposed_provenance_mut(address), init);
            Gc::from_address(address)
        }
    }

    /// Memory for the vector of a small view. May collect.
    #[inline(always)]
    pub(super) fn allocate_small_vector(vm: &Vm, size: usize) -> Result<*mut u8, AllocError> {
        if size == 0 {
            return Ok((&raw const NO_ELEMENTS).cast_mut().cast());
        }
        match vm.heap.auxiliary.try_allocate(&vm.heap, size) {
            0 => Err(AllocError),
            address => Ok(with_exposed_provenance_mut(address)),
        }
    }

    #[inline(always)]
    pub(super) fn assert_shape(shape: &Shape, class: &Class) {
        assert!(shape.class().is(class));
    }

    /// The view of the type that the shape says. `length` is in elements, and without one it reaches to the end of the
    /// buffer. Panics unless the shape is for views and is for resizable ones if and only if the buffer is.
    #[inline]
    pub fn create_on_buffer(
        cx: &Cx,
        shape: Gc<Shape>,
        buffer: &ArrayBuffer,
        byte_offset: usize,
        length: Option<usize>,
    ) -> JsResult<Gc<JsArrayBufferView>> {
        if buffer.is_detached() {
            return Err(Self::throw_out_of_bounds(cx));
        }
        Self::check_range(cx, &shape, buffer.byte_length(), byte_offset, length)?;
        Ok(Self::create_checked(cx, shape, buffer, byte_offset, length))
    }

    /// The same for the copy of a view, which may be out of the bounds of a buffer whose length can change.
    pub fn recreate_on_buffer(
        cx: &Cx,
        shape: Gc<Shape>,
        buffer: &ArrayBuffer,
        byte_offset: usize,
        length: Option<usize>,
    ) -> JsResult<Gc<JsArrayBufferView>> {
        if buffer.is_detached() {
            return Err(Self::throw_out_of_bounds(cx));
        }
        let limit = (buffer.max_byte_length()).unwrap_or_else(|| buffer.byte_length());
        Self::check_range(cx, &shape, limit, byte_offset, length)?;
        Ok(Self::create_checked(cx, shape, buffer, byte_offset, length))
    }

    #[inline(always)]
    fn check_range(
        cx: &Cx,
        shape: &Shape,
        byte_length: usize,
        byte_offset: usize,
        length: Option<usize>,
    ) -> JsResult<()> {
        let shift = size_shift_of(shape.instance_type());
        if byte_offset > byte_length || length.unwrap_or(0) > (byte_length - byte_offset) >> shift {
            return Err(cx.throw_range_error(errors::LENGTH_OUT_OF_RANGE_OF_BUFFER));
        }
        if byte_offset & ((1 << shift) - 1) != 0 {
            return Err(cx.throw_range_error("Byte offset is not aligned"));
        }
        Ok(())
    }

    /// The range is inside what the buffer has or can come to have.
    #[inline(always)]
    fn create_checked(
        vm: &Vm,
        shape: Gc<Shape>,
        buffer: &ArrayBuffer,
        byte_offset: usize,
        length: Option<usize>,
    ) -> Gc<JsArrayBufferView> {
        let (cell_type, is_resizable) = (shape.instance_type(), buffer.is_resizable_or_growable());
        Self::assert_shape(&shape, super::class_of_view(cell_type, is_resizable));
        let mut mode = ViewMode::HAS_BUFFER;
        mode.set(ViewMode::SHARED, buffer.is_shared());
        let length = if is_resizable {
            mode |= if buffer.is_shared() {
                ViewMode::GROWABLE_SHARED
            } else {
                ViewMode::RESIZABLE
            };
            mode.set(ViewMode::AUTO_LENGTH, length.is_none());
            length.unwrap_or(0)
        } else {
            length
                .unwrap_or_else(|| (buffer.byte_length() - byte_offset) >> size_shift_of(cell_type))
        };
        let vector = buffer.data().wrapping_add(byte_offset);
        let address = core::ptr::from_ref(buffer).expose_provenance();
        // SAFETY: the class is checked, and the length is put right before anything sees it.
        let view = unsafe { Self::allocate(vm, shape, vector, length, byte_offset, mode, address) };
        if is_resizable {
            view.forget_length();
            view.update_length(buffer);
        }
        buffer.add_view(vm, &view, 0);
        vm.heap.collect_if_extra_memory_adds_up();
        view
    }

    #[cold]
    pub fn throw_out_of_bounds(cx: &Cx) -> Thrown {
        cx.throw_type_error(errors::BUFFER_DETACHED_OR_OUT_OF_BOUNDS)
    }

    #[inline(always)]
    pub fn mode(&self) -> ViewMode {
        ViewMode::from_bits_retain((self.byte_offset_and_mode.get() >> Self::MODE_SHIFT) as u8)
    }

    #[inline(always)]
    fn set_byte_offset_and_mode(&self, byte_offset: usize, mode: ViewMode) {
        self.byte_offset_and_mode
            .set(byte_offset as u64 | u64::from(mode.bits()) << Self::MODE_SHIFT);
    }

    #[inline(always)]
    pub fn has_buffer(&self) -> bool {
        self.mode().contains(ViewMode::HAS_BUFFER)
    }

    #[inline(always)]
    pub fn is_shared(&self) -> bool {
        self.mode().contains(ViewMode::SHARED)
    }

    #[inline(always)]
    pub fn is_resizable_or_growable(&self) -> bool {
        self.mode().intersects(ViewMode::RESIZABLE_OR_GROWABLE)
    }

    #[inline(always)]
    pub fn is_auto_length(&self) -> bool {
        self.mode().contains(ViewMode::AUTO_LENGTH)
    }

    #[inline(always)]
    pub fn is_detached(&self) -> bool {
        self.vector.get().is_null()
    }

    /// The logarithm of the size of an element.
    #[inline(always)]
    pub fn size_shift(&self) -> u32 {
        size_shift_of(self.cell_type())
    }

    /// Null if the buffer is detached. It changes when a small view gets a buffer.
    #[inline(always)]
    pub fn vector(&self) -> *mut u8 {
        self.vector.get()
    }

    /// At most the length.
    #[inline(always)]
    pub fn known_length(&self) -> usize {
        self.length.get()
    }

    /// In elements. `None` if it is out of bounds or the buffer is detached.
    #[inline(always)]
    pub fn checked_length(&self) -> Option<usize> {
        if self.is_resizable_or_growable() {
            return self.current_length();
        }
        (!self.is_detached()).then(|| self.known_length())
    }

    /// In elements. Zero if it is out of bounds or the buffer is detached.
    #[inline(always)]
    pub fn length(&self) -> usize {
        if self.is_resizable_or_growable() {
            return self.current_length().unwrap_or(0);
        }
        self.known_length()
    }

    #[inline(always)]
    pub fn byte_length(&self) -> usize {
        self.length() << self.size_shift()
    }

    /// Also if the buffer is detached.
    #[inline(always)]
    pub fn is_out_of_bounds(&self) -> bool {
        self.checked_length().is_none()
    }

    /// Zero if it is out of bounds.
    #[inline(always)]
    pub fn byte_offset(&self) -> usize {
        if self.is_resizable_or_growable() && self.is_out_of_bounds() {
            return 0;
        }
        self.declared_byte_offset()
    }

    /// `[[ByteOffset]]`, or zero if the buffer is detached.
    #[inline(always)]
    pub fn declared_byte_offset(&self) -> usize {
        (self.byte_offset_and_mode.get() & Self::BYTE_OFFSET_MASK) as usize
    }

    /// `[[ArrayLength]]` or `[[ByteLength]]`. `None` for auto.
    #[inline]
    pub fn declared_length(&self) -> Option<usize> {
        if !self.is_resizable_or_growable() {
            return Some(self.known_length());
        }
        // SAFETY: allocated as one for that mode.
        let view = unsafe { Gc::from(self).cast_unchecked::<ResizableView>() };
        (!self.is_auto_length()).then_some(view.declared_length)
    }

    /// What the length will never exceed.
    pub fn max_length(&self) -> usize {
        self.declared_length().unwrap_or_else(|| {
            let max = self.existing_buffer().and_then(|it| it.max_byte_length());
            max.unwrap_or(0) >> self.size_shift()
        })
    }

    /// IsValidIntegerIndex
    #[inline(always)]
    pub fn is_valid_index(&self, index: usize) -> bool {
        index < self.known_length() || (self.is_resizable_or_growable() && index < self.length())
    }

    #[inline(never)]
    fn current_length(&self) -> Option<usize> {
        self.update_length(&*self.existing_buffer()?)
    }

    /// As `checked_length`, but leaves the known length as it is, so that a marker or a destructor can call it.
    pub fn compute_length(&self) -> Option<usize> {
        match self.existing_buffer() {
            Some(buffer) => self.length_in(&buffer),
            None => Some(self.known_length()),
        }
    }

    #[inline(always)]
    fn length_in(&self, buffer: &ArrayBuffer) -> Option<usize> {
        let rest = (buffer.byte_length()).checked_sub(self.declared_byte_offset())?;
        let available = rest >> self.size_shift();
        let length = self.declared_length().unwrap_or(available);
        (length <= available && !self.is_detached()).then_some(length)
    }

    fn update_length(&self, buffer: &ArrayBuffer) -> Option<usize> {
        let length = self.length_in(buffer);
        let known = length.unwrap_or(0);
        if self.length.replace(known) == 0
            && known != 0
            && self.mode().contains(ViewMode::RESIZABLE)
        {
            buffer.add_view_with_known_elements(self);
        }
        length
    }

    pub(super) fn forget_length(&self) {
        self.length.set(0);
    }

    pub(super) fn did_move_buffer(&self, data: *mut u8) {
        self.vector
            .set(data.wrapping_add(self.declared_byte_offset()));
    }

    pub(super) fn did_detach_buffer(&self) {
        let _lock = barrier::is_fenced().then(|| self.lock());
        self.vector.set(null_mut());
        self.length.set(0);
        self.set_byte_offset_and_mode(0, self.mode());
    }

    #[inline(always)]
    pub fn existing_buffer(&self) -> Option<HeldBuffer> {
        // SAFETY: what the field has in that mode. The view was added to the buffer then.
        self.has_buffer().then(|| unsafe {
            let buffer = with_exposed_provenance_mut(self.buffer.get());
            HeldBuffer::new(self, NonNull::new_unchecked(buffer))
        })
    }

    /// Makes one if there is none, which may move the elements.
    #[inline]
    pub fn buffer(&self, cx: &mut Cx) -> JsResult<HeldBuffer> {
        // SAFETY: a borrow would need the `Cx`.
        cx.or_out_of_memory(unsafe { self.buffer_unchecked(cx) })
    }

    /// Does not collect.
    ///
    /// # Safety
    /// Nothing borrows the elements.
    #[inline]
    pub unsafe fn buffer_unchecked(&self, vm: &Vm) -> Result<HeldBuffer, AllocError> {
        if !self.has_buffer() {
            self.create_buffer(vm)?;
        }
        self.existing_buffer().ok_or(AllocError)
    }

    #[inline(never)]
    fn create_buffer(&self, vm: &Vm) -> Result<(), AllocError> {
        let byte_length = self.byte_length();
        let (buffer, already_reported) = if self.mode().contains(ViewMode::OVERSIZE) {
            // SAFETY: the view gives it up with its mode.
            let contents = unsafe { ArrayBufferContents::adopt(self.vector(), byte_length) };
            let buffer = ArrayBufferRef::new(contents);
            buffer.set_hold_count(self.buffer.get() as u32);
            (buffer, byte_length)
        } else {
            // SAFETY: only read, at once.
            let bytes = unsafe { self.bytes_unchecked() };
            let contents = ArrayBufferContents::try_copy_of(bytes, byte_length)?;
            (ArrayBufferRef::try_new(contents)?, 0)
        };
        let lock = barrier::is_fenced().then(|| self.lock());
        self.vector.set(buffer.data());
        delay::of_mutator();
        self.buffer
            .set(core::ptr::from_ref(&*buffer).expose_provenance());
        self.set_byte_offset_and_mode(0, ViewMode::HAS_BUFFER);
        drop(lock);
        buffer.add_view(vm, self, already_reported);
        Ok(())
    }

    /// `[[ViewedArrayBuffer]]`
    #[inline]
    pub fn js_buffer(&self, cx: &mut Cx) -> JsResult<Gc<JsArrayBuffer>> {
        let buffer = self.buffer(cx)?;
        let global = self.realm().unwrap_or_else(|| cx.global());
        Ok(JsArrayBuffer::wrap(cx, &global, &buffer))
    }

    /// As `ArrayBuffer::pin`, without making a buffer for memory that does not move anyway. One that is made later can
    /// be detached, which leaves the bytes where they are.
    ///
    /// # Safety
    /// Nothing borrows the elements.
    pub unsafe fn pin(&self, vm: &Vm) -> Result<(), AllocError> {
        if self.mode().contains(ViewMode::OVERSIZE) {
            assert!(self.buffer.get() < u32::MAX as usize);
            self.buffer.update(|count| count + 1);
        } else {
            // SAFETY: the caller's.
            unsafe { self.buffer_unchecked(vm) }?.pin();
        }
        Ok(())
    }

    /// Looks at nothing but the fields, so that a destructor can call it. Panics if it is not pinned.
    pub fn unpin(&self) {
        match self.existing_buffer() {
            Some(buffer) => buffer.release_hold_or_unpin(),
            None => self
                .buffer
                .update(|count| count.checked_sub(1).expect("pinned")),
        }
    }

    /// Empty if it is out of bounds.
    #[inline(always)]
    pub fn bytes<'a>(&'a self, _: &'a NoGc<'_>) -> BufferSlice<'a, u8> {
        // SAFETY: what could take them away needs the `Cx` that the token borrows.
        unsafe { self.bytes_unchecked() }
    }

    /// # Safety
    /// While the slice is in use the view is alive, its buffer is neither made, detached nor resized, and nothing else
    /// borrows the bytes.
    #[inline(always)]
    pub unsafe fn bytes_unchecked(&self) -> BufferSlice<'_, u8> {
        if self.is_detached() {
            return BufferSlice::empty();
        }
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.vector(), self.byte_length()) }
    }

    /// What is pinned may have been lent to one.
    #[inline]
    pub(super) fn may_be_used_by_other_threads(&self) -> bool {
        match self.existing_buffer() {
            Some(buffer) => self.is_shared() || buffer.is_pinned(),
            None => self.buffer.get() != 0,
        }
    }

    /// `None` if they are shared or pinned.
    #[inline]
    pub fn borrow_bytes<'a>(&'a self, _: &'a Vm) -> Option<Borrowed<'a, u8>> {
        // SAFETY: what could change them or take them away needs the `Cx` that the `Vm` is borrowed from.
        (!self.may_be_used_by_other_threads())
            .then(|| unsafe { Borrowed::new(self, self.bytes_unchecked()) })
    }

    /// `None` if the index is out of bounds, the element is a BigInt or this is a `DataView`.
    #[inline(never)]
    pub fn try_get_number(&self, index: usize) -> Option<Value> {
        self.downcast::<JsTypedArray>()?.try_get_number(index)
    }

    /// The vector, if the view owns it. It is empty afterwards.
    pub(super) fn take_oversize_vector(&self) -> Option<*mut u8> {
        self.mode().contains(ViewMode::OVERSIZE).then(|| {
            self.length.set(0);
            self.set_byte_offset_and_mode(0, ViewMode::empty());
            self.vector
                .replace((&raw const NO_ELEMENTS).cast_mut().cast())
        })
    }

    fn visit_children(&self, visitor: &mut Visitor) {
        visitor.with_current_cell_locked(|visitor| {
            let mode = self.mode();
            delay::of_helper(3);
            // SAFETY: what the fields have in each mode. Neither is freed before marking ends.
            unsafe {
                if mode.contains(ViewMode::HAS_BUFFER) {
                    let buffer =
                        core::ptr::with_exposed_provenance::<ArrayBuffer>(self.buffer.get());
                    visitor.append_word((*buffer).wrapper_address() as u64);
                } else if mode.contains(ViewMode::OVERSIZE) {
                    visitor.report_extra_memory(self.byte_length());
                } else if self.known_length() != 0 {
                    visitor.mark_auxiliary(self.vector().addr());
                }
            }
        });
    }

    fn estimated_size(&self, vm: &Vm) -> usize {
        // SAFETY: the method of the base.
        let own = unsafe { (JsObject::OPS.estimated_size)(self, vm) };
        own + if self.has_buffer() {
            0
        } else {
            self.byte_length()
        }
    }
}

const _: () = assert!(MAX_ARRAY_BUFFER_SIZE as u64 <= JsArrayBufferView::BYTE_OFFSET_MASK);
const _: () = assert!(size_shift_of(CellType::DataView) == 0);
