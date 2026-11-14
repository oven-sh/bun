use std::rc::Rc;

use bun_collections::smallvec::SmallVec;
use bun_dawn_sys as dawn;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{BufferSource, JsHeap, JsLocal, JsScope, Result};

use super::device::{Device, check_stack};
use super::instance::Deferred;
use super::{GPUBuffer, GPUCommandBuffer, Object, convert, idl};

pub(crate) type GPUQueue = Object<dawn::Queue, Rc<Device>>;

impl GPUQueue {
    pub(crate) fn submit<'a>(
        &self,
        heap: &JsHeap<'a>,
        command_buffers: &[&GPUCommandBuffer],
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        let handles = command_buffers.iter().map(|buffer| &*buffer.handle);
        self.handle.submit(&handles.collect::<SmallVec<[_; 8]>>());
        self.state.instance.schedule();
        Ok(())
    }

    pub(crate) fn on_submitted_work_done<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let (deferred, promise) = Deferred::new(&self.state.instance, cx);
        self.state.wait_for_queue(|wait| {
            let callback = dawn::QueueWorkDoneCallbackInfo::new(move |_, _| {
                let device = wait.finish();
                deferred.complete(move |global, promise| {
                    drop(device);
                    promise.resolve(global, JSValue::UNDEFINED)
                });
            });
            self.handle.on_submitted_work_done(callback);
            self.handle.serial_of_scheduled_work()
        });
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
    ) -> Result<'a, ()> {
        convert::with_elements(heap, data, data_offset, size, |bytes| {
            self.handle
                .write_buffer(&buffer.handle, buffer_offset, bytes);
        })?;
        self.state.instance.schedule();
        Ok(())
    }

    pub(crate) fn write_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        destination: &idl::GPUTexelCopyTextureInfo<'a>,
        data: JsLocal<'a, BufferSource>,
        data_layout: &idl::GPUTexelCopyBufferLayout,
        size: &idl::GPUExtent3D,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        let destination = convert::texture_info(heap, destination)?;
        let size = convert::extent(heap, size)?;
        let data_layout = convert::buffer_layout(data_layout);
        data.with_bytes(heap, |bytes| {
            self.handle
                .write_texture(&destination, bytes, &data_layout, &size);
        });
        self.state.instance.schedule();
        Ok(())
    }
}
