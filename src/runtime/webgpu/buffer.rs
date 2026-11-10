use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_jsc::{DOMExceptionCode, JSGlobalObject, JSValue, JsResult};
use bun_ptr::{AsCtxPtr as _, JsCell, RefPtr};

use super::device::DeviceRef;
use super::instance::Instance;
use super::{
    Bun__WebGPU__createMappedRange, Bun__WebGPU__detachMappedRange,
    Bun__WebGPU__isMappedRangeInUse, GPUDevice, dom_error, dom_exception, gpu_object, new_object,
    operation_error, string_view, sys, to_sys_bool,
};
use crate::generated_bindgen::webgpu::{GPUBufferDescriptor, GPUBufferMapState};

gpu_object! {
    GPUBuffer {
        handle: WGPUBuffer,
        release: wgpuBufferRelease,
        set_label: wgpuBufferSetLabel,
        /// Dawn frees what is mapped when the last reference to the device goes.
        device: DeviceRef,
        size: u64,
        usage: u32,
        /// What `getMappedRange()` has returned since the buffer was mapped, as `start..end`.
        ranges: JsCell<Vec<(u64, u64)>>,
        /// Those of them that are neither detached nor collected: an id, and the `JSC::ArrayBuffer`, which holds a
        /// reference to `self` and gives it back through `Bun__WebGPU__mappedRangeReleased`.
        array_buffers: JsCell<Vec<(u64, *mut c_void)>>,
        next_range_id: Cell<u64>,
        /// `[[pending_map]]`: the promise of the `mapAsync()` that has neither been answered nor given up.
        pending_map: Cell<Option<usize>>,
    }
}

impl GPUDevice {
    pub(crate) fn create_buffer<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUBufferDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        if descriptor.mapped_at_creation && !descriptor.size.is_multiple_of(4) {
            return Err(heap.range_error(format_args!(
                "size is {}, and that of a buffer that is mapped at creation is a multiple of 4",
                descriptor.size
            )));
        }
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPUBufferDescriptor {
            label: string_view(&label),
            usage: descriptor.usage.into(),
            size: descriptor.size,
            mappedAtCreation: to_sys_bool(descriptor.mapped_at_creation),
            ..sys::WGPUBufferDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call.
        let handle = unsafe { sys::wgpuDeviceCreateBuffer(self.handle, &raw const sys_descriptor) };
        if handle.is_null() {
            return Err(heap.range_error(format_args!(
                "There is not enough memory to map a buffer of {} bytes at creation",
                descriptor.size
            )));
        }
        let buffer = GPUBuffer::new(
            handle,
            &descriptor.label,
            self.device_ref(),
            descriptor.size,
            descriptor.usage,
            JsCell::new(Vec::new()),
            JsCell::new(Vec::new()),
            Cell::new(0),
            Cell::new(None),
        );
        Ok(new_object(heap, buffer))
    }
}

impl GPUBuffer {
    /// Read by the GC's threads.
    pub(crate) fn estimated_size(&self) -> usize {
        usize::try_from(self.size).unwrap_or(usize::MAX)
    }

    pub(crate) fn get_size(&self) -> u64 {
        self.size
    }

    pub(crate) fn get_usage(&self) -> u32 {
        self.usage
    }

    pub(crate) fn get_map_state(&self) -> GPUBufferMapState {
        // Dawn has already refused what it is going to refuse, and JavaScript has not heard yet.
        if self.pending_map.get().is_some() {
            return GPUBufferMapState::Pending;
        }
        // SAFETY: a live buffer.
        match unsafe { sys::wgpuBufferGetMapState(self.handle) } {
            sys::WGPUBufferMapState::Mapped => GPUBufferMapState::Mapped,
            _ => GPUBufferMapState::Unmapped,
        }
    }

    /// `unmap()` and `destroy()` give up on a `mapAsync()` that has not been answered.
    fn abort_pending_map(&self, global: &JSGlobalObject, what: &str) {
        if let Some(slot) = self.pending_map.take() {
            let message = format!("{what} was called before the buffer was mapped");
            let reason = dom_exception(global, DOMExceptionCode::AbortError, message.as_bytes());
            self.device.state.instance.reject_early(slot, reason);
        }
    }

    pub(crate) fn map_async(
        &self,
        cx: &mut JsScope<'_>,
        mode: u32,
        offset: u64,
        size: Option<u64>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (Ok(offset), Ok(size)) = (
            usize::try_from(offset),
            size.map_or(Ok(sys::WGPU_WHOLE_MAP_SIZE), usize::try_from),
        ) else {
            return Err(global.throw_dom_exception(
                DOMExceptionCode::OperationError,
                format_args!("The range to map is past the end of the buffer"),
            ));
        };
        let is_unmapped = self.get_map_state() == GPUBufferMapState::Unmapped;
        let instance = &self.device.state.instance;
        // SAFETY: `self` is live.
        let this = unsafe { RefPtr::init_ref(self.as_ctx_ptr()) };
        let (promise, userdata) = instance.new_promise(global, this);
        // SAFETY: what `new_promise` has just returned.
        let slot = unsafe { Instance::slot_of::<RefPtr<GPUBuffer>>(userdata) };
        let callback = sys::WGPUBufferMapCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_mapped),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live buffer.
        unsafe { sys::wgpuBufferMapAsync(self.handle, mode.into(), offset, size, callback) };
        if is_unmapped {
            self.pending_map.set(Some(slot));
        } else {
            // It takes no asking the GPU. The call above made the validation error.
            let message = b"The buffer is mapped already, or is being mapped";
            let reason = dom_exception(global, DOMExceptionCode::OperationError, message);
            instance.reject_early(slot, reason);
        }
        Ok(promise)
    }

    pub(crate) fn get_mapped_range<'a>(
        &self,
        heap: &JsHeap<'a>,
        offset: u64,
        size: Option<u64>,
    ) -> bindgen::Result<'a, JSValue> {
        let size = size.unwrap_or_else(|| self.size.saturating_sub(offset));
        if !offset.is_multiple_of(8) {
            let message = format!("offset is {offset}, which is not a multiple of 8");
            return Err(operation_error(heap, &message));
        }
        if !size.is_multiple_of(4) {
            let message = format!("size is {size}, which is not a multiple of 4");
            return Err(operation_error(heap, &message));
        }
        let (Some(end), Ok(start), Ok(length)) = (
            offset.checked_add(size),
            usize::try_from(offset),
            usize::try_from(size),
        ) else {
            return Err(operation_error(
                heap,
                "The range is past the end of the buffer",
            ));
        };
        let overlaps =
            |&(other_start, other_end): &(u64, u64)| end > other_start && offset < other_end;
        if self.ranges.get().iter().any(overlaps) {
            return Err(operation_error(
                heap,
                "The range overlaps one that getMappedRange() has returned since the buffer was mapped",
            ));
        }
        // The one that is not const refuses a buffer that is mapped to be read.
        // SAFETY: a live buffer.
        let data = unsafe { sys::wgpuBufferGetConstMappedRange(self.handle, start, length) };
        if data.is_null() {
            if self.get_map_state() != GPUBufferMapState::Mapped {
                return Err(operation_error(heap, "The buffer is not mapped"));
            }
            let message = format!("Bytes {offset} to {end} are not all in what is mapped");
            return Err(operation_error(heap, &message));
        }

        let id = self.next_range_id.get();
        self.next_range_id.set(id + 1);
        // SAFETY: `self` is live.
        let this = unsafe { RefPtr::init_ref(self.as_ctx_ptr()) };
        let mut array_buffer = core::ptr::null_mut();
        // SAFETY: Dawn keeps `length` bytes at `data` until the buffer is unmapped or destroyed, or its device is
        // destroyed. `detach_ranges` comes before each. Making an `ArrayBuffer` runs no JavaScript.
        let value = unsafe {
            Bun__WebGPU__createMappedRange(
                heap.global().as_mut_ptr(),
                data.cast_mut(),
                length,
                this.into_raw().cast(),
                id,
                &raw mut array_buffer,
            )
        };
        self.ranges.with_mut(|ranges| ranges.push((offset, end)));
        if self.array_buffers.get().is_empty() {
            self.device.state.add_buffer_with_ranges(self.as_non_null());
        }
        self.array_buffers
            .with_mut(|list| list.push((id, array_buffer)));
        Ok(value)
    }

    fn as_non_null(&self) -> NonNull<Self> {
        // SAFETY: a reference is not null.
        unsafe { NonNull::new_unchecked(self.as_ctx_ptr()) }
    }

    /// `what` frees the memory that is mapped, which an operation that has not finished may still read or write: one
    /// that was given what `getMappedRange()` returned, and pinned it.
    pub(super) fn check_ranges_are_free<'a>(
        &self,
        heap: &JsHeap<'a>,
        what: &str,
    ) -> bindgen::Result<'a, ()> {
        // SAFETY: none of them has called `Bun__WebGPU__mappedRangeReleased`, so they are live.
        let is_in_use = |&(_, array_buffer): &(u64, *mut c_void)| unsafe {
            Bun__WebGPU__isMappedRangeInUse(array_buffer)
        };
        if !self.array_buffers.get().iter().any(is_in_use) {
            return Ok(());
        }
        let message = format!(
            "{what} frees the memory that getMappedRange() returned, which an operation that has not finished is using. Await that operation first."
        );
        Err(dom_error(
            heap,
            DOMExceptionCode::InvalidStateError,
            &message,
        ))
    }

    /// No `ArrayBuffer` reads the memory of the buffer from here on. The caller holds a reference to `self`, and has
    /// asked `check_ranges_are_free`.
    pub(super) fn detach_ranges(&self, global: &JSGlobalObject) {
        self.ranges.take();
        let array_buffers = self.array_buffers.take();
        if array_buffers.is_empty() {
            return;
        }
        self.device
            .state
            .remove_buffer_with_ranges(self.as_non_null());
        for (_, array_buffer) in array_buffers {
            // SAFETY: it has not called `Bun__WebGPU__mappedRangeReleased`, so it is live.
            unsafe { Bun__WebGPU__detachMappedRange(global.as_mut_ptr(), array_buffer) };
        }
    }

    pub(crate) fn unmap<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, ()> {
        self.check_ranges_are_free(&cx.heap, "unmap()")?;
        self.abort_pending_map(cx.global(), "unmap()");
        self.detach_ranges(cx.global());
        // SAFETY: a live buffer.
        unsafe { sys::wgpuBufferUnmap(self.handle) };
        Ok(())
    }

    pub(crate) fn destroy<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, ()> {
        self.check_ranges_are_free(&cx.heap, "destroy()")?;
        self.abort_pending_map(cx.global(), "destroy()");
        self.detach_ranges(cx.global());
        // SAFETY: a live buffer.
        unsafe { sys::wgpuBufferDestroy(self.handle) };
        Ok(())
    }
}

/// An `ArrayBuffer` that `get_mapped_range` made was detached or collected.
///
/// # Safety
/// `buffer` and `id` are what `Bun__WebGPU__createMappedRange` was given, and this is the one call for them.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__WebGPU__mappedRangeReleased(buffer: *mut GPUBuffer, id: u64) {
    // SAFETY: the reference that `get_mapped_range` gave up.
    let buffer = unsafe { RefPtr::from_raw(buffer) };
    let had_some = !buffer.array_buffers.get().is_empty();
    buffer
        .array_buffers
        .with_mut(|list| list.retain(|(other, _)| *other != id));
    if had_some && buffer.array_buffers.get().is_empty() {
        buffer
            .device
            .state
            .remove_buffer_with_ranges(buffer.as_non_null());
    }
}

unsafe extern "C" fn on_mapped(
    status: sys::WGPUMapAsyncStatus,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `map_async` passed what `new_promise` gave it.
    let (settle, buffer) = unsafe { Instance::finish::<RefPtr<GPUBuffer>>(userdata1) };
    if buffer.pending_map.get() == Some(settle.slot()) {
        buffer.pending_map.set(None);
    }
    settle.with(|global| {
        let code = match status {
            sys::WGPUMapAsyncStatus::Success => return Ok(JSValue::UNDEFINED),
            sys::WGPUMapAsyncStatus::Error => DOMExceptionCode::OperationError,
            _ => DOMExceptionCode::AbortError,
        };
        // SAFETY: Dawn's, until this returns.
        Err(dom_exception(global, code, unsafe {
            super::bytes_of_view(message)
        }))
    });
}
