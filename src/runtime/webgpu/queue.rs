use core::ffi::c_void;

use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsScope};
use bun_jsc::{DOMExceptionCode, JSValue, JsResult};
use bun_ptr::RefPtr;

use super::device::DeviceRef;
use super::instance::Instance;
use super::{
    GPUBuffer, GPUCommandBuffer, bytes_per_element, dom_exception, extent_to_sys, gpu_object,
    slice_of_data, sys,
};
use crate::generated_bindgen::webgpu::{
    GPUExtent3D, GPUTexelCopyBufferLayout, GPUTexelCopyTextureInfo,
};

gpu_object! {
    GPUQueue {
        handle: WGPUQueue,
        release: wgpuQueueRelease,
        set_label: wgpuQueueSetLabel,
        device: DeviceRef,
    }
}

pub(crate) fn is_device_lost_for_testing(queue: &GPUQueue) -> bool {
    queue.device.state.is_lost()
}

impl GPUQueue {
    pub(crate) fn submit(&self, command_buffers: Vec<RefPtr<GPUCommandBuffer>>) {
        let handles: Vec<sys::WGPUCommandBuffer> = command_buffers
            .iter()
            .map(|command_buffer| command_buffer.handle)
            .collect();
        // SAFETY: live objects, and a list that outlives the call.
        unsafe { sys::wgpuQueueSubmit(self.handle, handles.len(), handles.as_ptr()) };
        drop(command_buffers);
    }

    pub(crate) fn on_submitted_work_done(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let (promise, userdata) = self
            .device
            .state
            .instance
            .new_promise(cx.global(), self.device.clone());
        let callback = sys::WGPUQueueWorkDoneCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_work_done),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live queue.
        unsafe { sys::wgpuQueueOnSubmittedWorkDone(self.handle, callback) };
        Ok(promise)
    }

    pub(crate) fn write_buffer<'a>(
        &self,
        heap: &JsHeap<'a>,
        buffer: &GPUBuffer,
        buffer_offset: u64,
        data: JsLocal<'a, BufferSource>,
        data_offset: u64,
        size: Option<u64>,
    ) -> bindgen::Result<'a, ()> {
        let bytes_per_element = bytes_per_element(data.to_js());
        data.with_bytes(heap, |bytes| {
            let bytes = slice_of_data(heap, bytes, bytes_per_element, data_offset, size)?;
            if bytes.len() % 4 != 0 {
                return Err(super::operation_error(
                    heap,
                    "The number of bytes to write is not a multiple of 4",
                ));
            }
            // SAFETY: live objects, and bytes that outlive the call.
            unsafe {
                sys::wgpuQueueWriteBuffer(
                    self.handle,
                    buffer.handle,
                    buffer_offset,
                    bytes.as_ptr().cast(),
                    bytes.len(),
                )
            };
            Ok(())
        })
    }

    pub(crate) fn write_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        destination: &GPUTexelCopyTextureInfo,
        data: JsLocal<'a, BufferSource>,
        data_layout: &GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
    ) -> bindgen::Result<'a, ()> {
        let destination = destination.to_sys(heap)?;
        let data_layout = data_layout.to_sys();
        let size = extent_to_sys(heap, size)?;
        data.with_bytes(heap, |bytes| {
            // SAFETY: live objects, and arguments that outlive the call.
            unsafe {
                sys::wgpuQueueWriteTexture(
                    self.handle,
                    &raw const destination,
                    bytes.as_ptr().cast(),
                    bytes.len(),
                    &raw const data_layout,
                    &raw const size,
                )
            };
        });
        Ok(())
    }
}

unsafe extern "C" fn on_work_done(
    status: sys::WGPUQueueWorkDoneStatus,
    message: sys::WGPUStringView,
    userdata1: *mut c_void,
    _userdata2: *mut c_void,
) {
    // SAFETY: `on_submitted_work_done` passed what `new_promise` gave it.
    let (settle, _device) = unsafe { Instance::finish::<DeviceRef>(userdata1) };
    settle.with(|global| match status {
        sys::WGPUQueueWorkDoneStatus::Success => Ok(JSValue::UNDEFINED),
        // SAFETY: Dawn's, until this returns.
        _ => Err(dom_exception(
            global,
            DOMExceptionCode::OperationError,
            unsafe { super::bytes_of_view(message) },
        )),
    });
}
