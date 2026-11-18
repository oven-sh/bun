use core::cell::{Cell, UnsafeCell};
use core::mem::offset_of;
use core::ops::Deref;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering, fence};
use std::sync::Arc;

use bun_alloc::AllocError;
use bun_engine_macros::FieldOffsets;

use super::cell_list::CellList;
use super::contents::{ArrayBufferContents, ResizeError, SharedArrayBufferContents};
use super::slice::BufferSlice;
use crate::heap::{Scope, Survivors, keep_alive};
use crate::{
    Cx, Gc, GcFree, InlineWatchpointSet, JsArrayBuffer, JsArrayBufferView, JsCell, NoGc, Vm,
    WatchpointState,
};

/// What an `ArrayBuffer` object and the views on it share. It is counted, and the `Vm` holds a reference for as long
/// as such a cell is alive. From the first of them on it belongs to the thread of that `Vm`.
#[derive(FieldOffsets)]
#[repr(C)]
pub struct ArrayBuffer {
    ref_count: AtomicU32,
    pin_count: Cell<u32>,
    contents: UnsafeCell<ArrayBufferContents>,
    /// The address of the object that stands for the buffer, or zero. The views keep it alive.
    wrapper: AtomicUsize,
    /// All other cells that refer to the buffer.
    referrers: CellList,
    /// Of a buffer that can shrink, the views whose known length is not zero.
    views_with_known_elements: CellList,
    detach_watchpoints: InlineWatchpointSet,
    /// What the heap counts for the buffer. Zero while the `Vm` holds no reference.
    reported_size: Cell<usize>,
    /// The pins that a view had when the buffer was made for it. They keep the bytes where they are, but not attached.
    hold_count: Cell<u32>,
    is_wasm_memory: Cell<bool>,
    has_new_referrers: Cell<bool>,
    left_behind: Cell<Option<Box<LeftBehind>>>,
}

/// What a memory of WebAssembly has given up while its buffer was pinned.
struct LeftBehind {
    _contents: ArrayBufferContents,
    _earlier: Option<Box<LeftBehind>>,
}

// SAFETY: forgets the cells that die.
unsafe impl GcFree for ArrayBuffer {}

/// A counted reference.
#[repr(transparent)]
pub struct ArrayBufferRef(NonNull<ArrayBuffer>);

impl ArrayBufferRef {
    #[inline]
    pub fn try_new(contents: ArrayBufferContents) -> Result<ArrayBufferRef, AllocError> {
        let buffer = Box::try_new(ArrayBuffer {
            ref_count: AtomicU32::new(1),
            pin_count: Cell::new(0),
            contents: UnsafeCell::new(contents),
            wrapper: AtomicUsize::new(0),
            referrers: CellList::default(),
            views_with_known_elements: CellList::default(),
            detach_watchpoints: InlineWatchpointSet::new(WatchpointState::Watched),
            reported_size: Cell::new(0),
            hold_count: Cell::new(0),
            is_wasm_memory: Cell::new(false),
            has_new_referrers: Cell::new(false),
            left_behind: Cell::new(None),
        });
        Ok(ArrayBufferRef(Box::into_non_null(
            buffer.map_err(|_| AllocError)?,
        )))
    }

    #[inline]
    pub fn new(contents: ArrayBufferContents) -> ArrayBufferRef {
        Self::try_new(contents).unwrap_or_else(|_| bun_alloc::out_of_memory())
    }

    #[inline]
    pub fn retain(buffer: &ArrayBuffer) -> ArrayBufferRef {
        let old = buffer.ref_count.fetch_add(1, Ordering::Relaxed);
        assert!(old < u32::MAX / 2);
        ArrayBufferRef(NonNull::from(buffer))
    }

    pub fn into_raw(self) -> NonNull<ArrayBuffer> {
        core::mem::ManuallyDrop::new(self).0
    }

    /// # Safety
    /// The caller hands over a reference that it holds.
    pub unsafe fn from_raw(buffer: NonNull<ArrayBuffer>) -> ArrayBufferRef {
        ArrayBufferRef(buffer)
    }

    /// For a holder whose count has just reached zero.
    ///
    /// # Safety
    /// Nothing refers to the buffer.
    #[inline(never)]
    pub unsafe fn destroy(buffer: NonNull<ArrayBuffer>) {
        // SAFETY: boxed by `try_new`, and the caller's.
        drop(unsafe { Box::from_non_null(buffer) });
    }
}

impl Deref for ArrayBufferRef {
    type Target = ArrayBuffer;

    #[inline(always)]
    fn deref(&self) -> &ArrayBuffer {
        // SAFETY: counted.
        unsafe { self.0.as_ref() }
    }
}

impl Clone for ArrayBufferRef {
    fn clone(&self) -> ArrayBufferRef {
        ArrayBufferRef::retain(self)
    }
}

impl Drop for ArrayBufferRef {
    #[inline]
    fn drop(&mut self) {
        if self.ref_count.fetch_sub(1, Ordering::Release) == 1 {
            fence(Ordering::Acquire);
            // SAFETY: that was the last reference.
            unsafe { Self::destroy(self.0) }
        }
    }
}

/// The buffer of a cell, which stays alive while this is.
pub struct HeldBuffer {
    owner: Gc<JsCell>,
    buffer: NonNull<ArrayBuffer>,
}

impl HeldBuffer {
    /// # Safety
    /// `owner` is among the cells that refer to the buffer.
    #[inline(always)]
    pub(super) unsafe fn new(owner: &JsCell, buffer: NonNull<ArrayBuffer>) -> HeldBuffer {
        HeldBuffer {
            owner: owner.into(),
            buffer,
        }
    }
}

impl Deref for HeldBuffer {
    type Target = ArrayBuffer;

    #[inline(always)]
    fn deref(&self) -> &ArrayBuffer {
        // SAFETY: the `Vm` holds a reference for the owner.
        unsafe { self.buffer.as_ref() }
    }
}

impl Drop for HeldBuffer {
    #[inline(always)]
    fn drop(&mut self) {
        keep_alive(self.owner.address());
    }
}

/// Runs `allocate` a second time if it takes a collection to make room.
pub(super) fn retry_after_collection<T, E>(
    vm: &Vm,
    is_out_of_memory: impl Fn(&E) -> bool,
    mut allocate: impl FnMut() -> Result<T, E>,
) -> Result<T, E> {
    match allocate() {
        Err(error) if is_out_of_memory(&error) => {
            vm.heap.collect(Some(Scope::Full));
            allocate()
        }
        result => result,
    }
}

impl ArrayBuffer {
    const OFFSET_OF_CONTENTS: usize = offset_of!(ArrayBuffer, contents);
    pub const OFFSET_OF_DATA: usize =
        Self::OFFSET_OF_CONTENTS + ArrayBufferContents::OFFSET_OF_DATA;
    /// Of a buffer that is not both shared and growable.
    pub const OFFSET_OF_BYTE_LENGTH: usize =
        Self::OFFSET_OF_CONTENTS + ArrayBufferContents::OFFSET_OF_BYTE_LENGTH;
    /// Of one that is: a pointer to the length, which other threads change.
    pub const OFFSET_OF_SHARED_BYTE_LENGTH: usize =
        Self::OFFSET_OF_CONTENTS + ArrayBufferContents::OFFSET_OF_SHARED_BYTE_LENGTH;
    pub const OFFSET_OF_WRAPPER: usize = offset_of!(ArrayBuffer, wrapper);

    const IS_LOCKED: u32 = 1 << 31;

    #[inline(always)]
    fn read<R>(&self, read: impl FnOnce(&ArrayBufferContents) -> R) -> R {
        // SAFETY: the callers in this file run no other code while they have the reference.
        read(unsafe { &*self.contents.get() })
    }

    #[inline(always)]
    fn change<R>(&self, change: impl FnOnce(&mut ArrayBufferContents) -> R) -> R {
        // SAFETY: as above.
        change(unsafe { &mut *self.contents.get() })
    }

    /// Null if it is detached.
    #[inline(always)]
    pub fn data(&self) -> *mut u8 {
        self.read(ArrayBufferContents::data)
    }

    #[inline(always)]
    pub fn byte_length(&self) -> usize {
        self.read(ArrayBufferContents::byte_length)
    }

    #[inline(always)]
    pub fn max_byte_length(&self) -> Option<usize> {
        self.read(ArrayBufferContents::max_byte_length)
    }

    #[inline(always)]
    pub fn is_detached(&self) -> bool {
        self.read(ArrayBufferContents::is_detached)
    }

    #[inline(always)]
    pub fn is_shared(&self) -> bool {
        self.read(ArrayBufferContents::is_shared)
    }

    #[inline(always)]
    pub fn is_resizable_or_growable(&self) -> bool {
        self.read(ArrayBufferContents::is_resizable_or_growable)
    }

    #[inline(always)]
    pub fn bytes<'a>(&'a self, _: &'a NoGc<'_>) -> BufferSlice<'a, u8> {
        // SAFETY: what could take them away needs the `Cx` that the token borrows.
        unsafe { self.bytes_unchecked() }
    }

    /// # Safety
    /// The buffer is neither detached nor resized while the slice is in use, and nothing else borrows the bytes.
    #[inline(always)]
    pub unsafe fn bytes_unchecked(&self) -> BufferSlice<'_, u8> {
        if self.is_detached() {
            return BufferSlice::empty();
        }
        // SAFETY: the caller's.
        unsafe { BufferSlice::new(self.data(), self.byte_length()) }
    }

    /// Whether the two have their memory from the same Shared Data Block.
    pub fn shares_memory_with(&self, other: &ArrayBuffer) -> bool {
        let block = |buffer: &ArrayBuffer| buffer.read(|it| it.shared_contents().map(Arc::as_ptr));
        block(self).is_some_and(|this| block(other) == Some(this))
    }

    pub fn shared_contents(&self) -> Option<Arc<SharedArrayBufferContents>> {
        self.read(|contents| contents.shared_contents().cloned())
    }

    /// `None` unless it is shared.
    pub fn share(&self) -> Option<ArrayBufferContents> {
        self.read(ArrayBufferContents::share)
    }

    /// Panics if it is detached or a cell refers to it.
    pub fn make_shared(&self) {
        assert!(!self.has_referrers());
        self.change(|contents| *contents = core::mem::take(contents).into_shared());
    }

    /// While it is pinned, the bytes that it has stay accessible where they are. A memory of WebAssembly may go on
    /// elsewhere.
    #[inline]
    pub fn pin(&self) {
        let old = self.pin_count.get();
        assert!(old | Self::IS_LOCKED != u32::MAX);
        self.pin_count.set(old + 1);
    }

    #[inline]
    pub fn unpin(&self) {
        let old = self.pin_count.get();
        assert!(old & !Self::IS_LOCKED != 0);
        self.pin_count.set(old - 1);
        if old - 1 == Self::IS_LOCKED {
            self.left_behind.set(None);
        }
    }

    fn leave_behind(&self, contents: ArrayBufferContents) {
        if self.is_pinned() {
            self.left_behind.set(Some(Box::new(LeftBehind {
                _contents: contents,
                _earlier: self.left_behind.take(),
            })));
        }
    }

    pub(super) fn set_hold_count(&self, count: u32) {
        self.hold_count.set(count);
    }

    /// For a view, which does not know what it has. What promises less goes first: a hold, or a pin on nothing.
    #[inline]
    pub(super) fn release_hold_or_unpin(&self) {
        let pins_nothing = self.is_detached() && self.pin_count.get() & !Self::IS_LOCKED != 0;
        let Some(holds) = (self.hold_count.get().checked_sub(1)).filter(|_| !pins_nothing) else {
            return self.unpin();
        };
        self.hold_count.set(holds);
        if holds == 0 && self.is_detached() {
            drop(self.change(ArrayBufferContents::take));
        }
    }

    /// Whether something counts on the bytes staying where they are. A memory of WebAssembly is not meant.
    #[inline]
    pub(super) fn is_pinned(&self) -> bool {
        self.pin_count.get() & !Self::IS_LOCKED != 0 || self.hold_count.get() != 0
    }

    #[inline]
    pub fn is_detachable(&self) -> bool {
        self.pin_count.get() == 0 && !self.is_shared()
    }

    pub fn make_wasm_memory(&self) {
        self.is_wasm_memory.set(true);
        self.pin_count.update(|count| count | Self::IS_LOCKED);
    }

    #[inline]
    pub fn is_wasm_memory(&self) -> bool {
        self.is_wasm_memory.get()
    }

    /// Fires when the memory is taken away or moves.
    pub fn detach_watchpoints(&self) -> &InlineWatchpointSet {
        &self.detach_watchpoints
    }

    #[inline]
    pub fn wrapper(&self, _: &Vm) -> Option<Gc<JsArrayBuffer>> {
        let address = self.wrapper_address();
        // SAFETY: cleared before the cell is freed.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    #[inline(always)]
    pub(super) fn wrapper_address(&self) -> usize {
        self.wrapper.load(Ordering::Relaxed)
    }

    #[inline(always)]
    fn has_referrers(&self) -> bool {
        self.wrapper_address() != 0 || !self.referrers.is_empty()
    }

    /// Returns how many cells it has looked at.
    fn for_each_view(&self, mut visit: impl FnMut(Gc<JsArrayBufferView>)) -> usize {
        self.referrers.for_each(|cell| {
            // SAFETY: pruned before it is freed.
            let cell = unsafe { Gc::<JsCell>::from_address(cell) };
            cell.downcast().into_iter().for_each(&mut visit);
        })
    }

    /// `already_reported`: so many of the bytes have been counted as allocated. Does not collect.
    #[inline]
    pub(super) fn add_view(&self, vm: &Vm, view: &JsArrayBufferView, already_reported: usize) {
        self.referrers.push(view.address());
        self.did_add_referrer(vm, already_reported);
    }

    pub(super) fn add_view_with_known_elements(&self, view: &JsArrayBufferView) {
        self.views_with_known_elements.push(view.address());
    }

    /// As `add_view`.
    #[inline]
    pub(super) fn set_wrapper(&self, vm: &Vm, wrapper: &JsArrayBuffer, already_reported: usize) {
        let old = self.wrapper_address();
        self.wrapper.store(wrapper.address(), Ordering::Relaxed);
        self.for_each_view(|view| view.write_barrier_for_cell());
        if old != 0 {
            self.referrers.push(old);
        }
        self.did_add_referrer(vm, already_reported);
    }

    #[inline(always)]
    fn did_add_referrer(&self, vm: &Vm, already_reported: usize) {
        if self.has_new_referrers.replace(true) {
            return;
        }
        if self.reported_size.get() != 0 {
            return vm.services.buffers.did_add_referrer_to_old(self);
        }
        let size = self.estimated_size();
        self.reported_size.set(size);
        vm.heap.did_add_array_buffer(size, already_reported);
        vm.services.buffers.add(ArrayBufferRef::retain(self));
    }

    pub fn estimated_size(&self) -> usize {
        size_of::<ArrayBuffer>() + self.read(ArrayBufferContents::footprint)
    }

    fn report_size(&self, vm: &Vm) {
        let (old, new) = (self.reported_size.get(), self.estimated_size());
        if old == 0 {
            return;
        }
        self.reported_size.set(new);
        match new.checked_sub(old) {
            Some(more) => vm.heap.did_add_array_buffer(more, 0),
            None => vm.heap.did_remove_array_buffer(old - new),
        }
    }

    /// False if no cell refers to it any more.
    pub(super) fn prune_referrers(&self, survivors: &Survivors) -> bool {
        // SAFETY: only the address is looked at.
        let survives = |cell| survivors.contains(unsafe { Gc::<JsCell>::from_address(cell) });
        self.has_new_referrers.set(false);
        for cells in [&self.referrers, &self.views_with_known_elements] {
            cells.prune(survivors.scope() == Scope::Eden, survives);
        }
        let wrapper = self.wrapper_address();
        if wrapper != 0 && !survives(wrapper) {
            self.wrapper.store(0, Ordering::Relaxed);
        }
        if !self.has_referrers() {
            let size = self.reported_size.take();
            survivors.vm().heap.did_remove_array_buffer(size);
            return false;
        }
        // Another thread may have grown it.
        self.report_size(survivors.vm());
        true
    }

    /// The `Vm` goes away. Returns the contents if nothing else can get at them.
    pub(super) fn forget_referrers(&self) -> Option<ArrayBufferContents> {
        self.for_each_view(|view| view.did_detach_buffer());
        self.referrers.clear();
        self.views_with_known_elements.clear();
        self.wrapper.store(0, Ordering::Relaxed);
        self.reported_size.set(0);
        self.has_new_referrers.set(false);
        (self.ref_count.load(Ordering::Acquire) == 1)
            .then(|| self.change(ArrayBufferContents::take))
    }

    /// DetachArrayBuffer, whatever pins it. Panics if it is shared.
    pub fn detach(&self, cx: &mut Cx) -> ArrayBufferContents {
        // SAFETY: a borrow would need the `Cx`.
        unsafe { self.detach_unchecked(cx) }
    }

    /// # Safety
    /// Nothing borrows the bytes, and `vm` is the one that the buffer belongs to. So for all that follow.
    pub unsafe fn detach_unchecked(&self, vm: &Vm) -> ArrayBufferContents {
        assert!(!self.is_shared());
        if self.is_detached() {
            return ArrayBufferContents::default();
        }
        let contents = self.change(match self.hold_count.get() {
            0 => ArrayBufferContents::take,
            _ => ArrayBufferContents::take_and_keep,
        });
        self.did_detach(vm);
        if self.is_wasm_memory() {
            self.leave_behind(contents);
            return ArrayBufferContents::default();
        }
        contents
    }

    fn did_detach(&self, vm: &Vm) {
        self.views_with_known_elements.clear();
        if self.for_each_view(|view| view.did_detach_buffer()) != 0 {
            vm.array_buffer_detach_watchpoints().fire(vm);
        }
        self.report_size(vm);
        self.detach_watchpoints.fire(vm);
    }

    /// Detaches the buffer. One that cannot be detached stays as it is and gives a share or a copy of its memory.
    /// `None` if it is detached or there is no memory for the copy.
    ///
    /// # Safety
    /// See `detach_unchecked`.
    pub unsafe fn transfer_unchecked(&self, vm: &Vm) -> Option<ArrayBufferContents> {
        if self.is_detached() {
            return None;
        }
        if self.is_shared() {
            return self.share();
        }
        // SAFETY: the caller's.
        unsafe {
            if self.is_detachable() {
                return Some(self.detach_unchecked(vm));
            }
            ArrayBufferContents::try_copy_of(self.bytes_unchecked(), self.byte_length()).ok()
        }
    }

    pub fn transfer(&self, cx: &mut Cx) -> Option<ArrayBufferContents> {
        // SAFETY: a borrow would need the `Cx`.
        unsafe { self.transfer_unchecked(cx) }
    }

    /// The same for a buffer that is neither shared nor detached, into contents of that fixed length.
    pub fn transfer_to_fixed_length(
        &self,
        cx: &mut Cx,
        byte_length: usize,
    ) -> Result<ArrayBufferContents, AllocError> {
        let is_detachable = self.is_detachable();
        if is_detachable
            && !self.is_resizable_or_growable()
            && (byte_length == self.byte_length()
                || self.hold_count.get() == 0
                    // SAFETY: the views are told next.
                    && self.change(|contents| unsafe { contents.try_truncate(byte_length) }))
        {
            return Ok(self.detach(cx));
        }
        let copy = ArrayBufferContents::try_copy_of(self.bytes(&cx.no_gc()), byte_length)?;
        if is_detachable {
            drop(self.detach(cx));
        }
        Ok(copy)
    }

    /// The same for one that is resizable, into contents that are too and have that length.
    pub fn transfer_resized(
        &self,
        cx: &mut Cx,
        byte_length: usize,
    ) -> Result<ArrayBufferContents, AllocError> {
        if self.is_detachable() {
            self.resize(cx, byte_length).map_err(|_| AllocError)?;
            return Ok(self.detach(cx));
        }
        let max = self.max_byte_length().ok_or(AllocError)?;
        let mut copy = ArrayBufferContents::try_resizable(byte_length, max)?;
        let no_gc = cx.no_gc();
        let source = self.bytes(&no_gc).clamped(0..byte_length);
        source.copy_to_slice(&mut copy.as_mut_slice().ok_or(AllocError)?[..source.len()]);
        Ok(copy)
    }

    /// Of a buffer that is resizable, not shared and no memory of WebAssembly. May collect.
    pub fn resize(&self, cx: &mut Cx, byte_length: usize) -> Result<(), ResizeError> {
        if self.is_shared() || self.is_wasm_memory() || !self.is_resizable_or_growable() {
            return Err(ResizeError::InvalidLength);
        }
        if byte_length >= self.byte_length() {
            let is_out_of_memory = |error: &ResizeError| *error == ResizeError::OutOfMemory;
            retry_after_collection(cx, is_out_of_memory, || {
                self.change(|contents| contents.grow(byte_length))
            })?;
        } else {
            let keeps_pages = self.pin_count.get() != 0;
            // SAFETY: a borrow would need the `Cx`, and the views are told next.
            self.change(|contents| unsafe { contents.shrink(byte_length, keeps_pages) });
            // Those that are still in use come back, and the others are not looked at again.
            self.views_with_known_elements.for_each(|view| {
                // SAFETY: pruned before it is freed.
                unsafe { Gc::<JsArrayBufferView>::from_address(view) }.forget_length();
            });
            self.views_with_known_elements.clear();
        }
        self.report_size(cx);
        cx.heap.collect_if_necessary();
        Ok(())
    }

    /// Of a growable shared buffer. May collect.
    pub fn grow(&self, vm: &Vm, byte_length: usize) -> Result<(), ResizeError> {
        let shared = self
            .shared_contents()
            .filter(|_| self.is_resizable_or_growable())
            .ok_or(ResizeError::InvalidLength)?;
        let is_out_of_memory = |error: &ResizeError| *error == ResizeError::OutOfMemory;
        retry_after_collection(vm, is_out_of_memory, || shared.grow(byte_length))?;
        self.report_size(vm);
        vm.heap.collect_if_necessary();
        Ok(())
    }

    /// Of the resizable buffer of a memory that is not shared, whose owner reports the new bytes as allocated.
    ///
    /// # Safety
    /// See `detach_unchecked`.
    pub unsafe fn did_grow_wasm_memory(&self, vm: &Vm, grown: ArrayBufferContents) {
        assert!(grown.byte_length() >= self.byte_length());
        assert!(grown.max_byte_length() == self.max_byte_length() && !grown.is_shared());
        let data = grown.data();
        let old = self.change(|contents| core::mem::replace(contents, grown));
        if data != old.data() {
            self.for_each_view(|view| view.did_move_buffer(data));
            self.detach_watchpoints.fire(vm);
            self.leave_behind(old);
        }
        let (old_size, size) = (self.reported_size.get(), self.estimated_size());
        if old_size != 0 {
            self.reported_size.set(size);
            (vm.heap).did_add_array_buffer(size - old_size, size - old_size);
        }
    }
}
