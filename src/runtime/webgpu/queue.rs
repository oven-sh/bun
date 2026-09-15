//! `GPUQueue`.

use std::rc::Rc;
use std::sync::Arc;

use bun_jsc::{
    CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsCell, JsClass, JsResult, JsThread,
    Strong,
};
use bun_webgpu::{GpuError, instance};

use super::args::{self, BufferSource};
use super::device::DeviceRef;
use super::texture::{parse_texel_copy_buffer_layout, parse_texel_copy_texture_info};
use super::wait::{Slot, Wait, Waiter};
use super::{GPUBuffer, GPUCommandBuffer};

#[bun_jsc::JsClass]
pub struct GPUQueue {
    device: DeviceRef,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUQueue, label);

struct WorkDone;

impl Waiter for WorkDone {
    type Result = ();
    /// The promise, and the `GPUQueue` it came from.
    type Js = (JSPromiseStrong, Strong);

    fn settle(
        _result: Option<()>,
        (mut promise, queue): Self::Js,
        cx: &JsThread<'_>,
    ) -> JsResult<()> {
        if let Some(queue) = queue.get().as_class_ref::<GPUQueue>() {
            queue.device.deliver_loss(cx.global())?;
        }
        promise.resolve(cx.global(), JSValue::UNDEFINED)
    }
}

impl GPUQueue {
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        label: bun_core::String,
    ) -> JSValue {
        GPUQueue {
            device: Rc::clone(device),
            label: JsCell::new(label),
        }
        .to_js(global)
    }

    pub(crate) fn submit(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut ids = Vec::new();
        args::for_each(global, callframe.argument(0), "submit", |item| {
            let cb =
                args::to_class::<GPUCommandBuffer>(global, item, "submit", "GPUCommandBuffer")?;
            ids.push(cb.id());
            Ok(())
        })?;
        if let Err((_, err)) = instance().queue_submit(self.device.raw.queue_id(), &ids) {
            self.device.report(global, GpuError::from_wgpu(&err))?;
        }
        self.device.deliver_loss(global)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn on_submitted_work_done(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let promise = JSPromiseStrong::init(global);
        let value = promise.value();
        let slot = Slot::<()>::new();
        let submission = {
            let slot = Arc::clone(&slot);
            instance().queue_on_submitted_work_done(
                self.device.raw.queue_id(),
                Box::new(move || slot.fill(())),
            )
        };
        Wait::<WorkDone>::schedule(
            &global.js_thread(),
            Arc::clone(&self.device.raw),
            submission,
            slot,
            (promise, Strong::create(this_value, global)),
        );
        Ok(value)
    }

    pub(crate) fn write_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let buffer =
            args::to_class::<GPUBuffer>(global, callframe.argument(0), "writeBuffer", "GPUBuffer")?;
        let buffer_offset =
            args::to_u64(global, callframe.argument(1), "writeBuffer: bufferOffset")?;
        let data_offset = match callframe.argument(3) {
            v if v.is_undefined() => 0,
            v => args::to_u64(global, v, "writeBuffer: dataOffset")?,
        };
        let size = match callframe.argument(4) {
            v if v.is_undefined() => None,
            v => Some(args::to_u64(global, v, "writeBuffer: size")?),
        };
        // Read the bytes last: the conversions above can run script that detaches `data`.
        let source = BufferSource::from_js(global, callframe.argument(2), "writeBuffer: data")?;

        let element = source.element_size as u64;
        let data_len = source.len as u64;
        let operation_error = |message: &str| {
            global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::OperationError,
                format_args!("writeBuffer: {message}"),
            )
        };
        let Some(start) = data_offset.checked_mul(element).filter(|s| *s <= data_len) else {
            return Err(operation_error("dataOffset is past the end of data"));
        };
        let byte_len = match size {
            None => data_len - start,
            Some(size) => match size.checked_mul(element).filter(|n| *n <= data_len - start) {
                Some(n) => n,
                None => return Err(operation_error("dataOffset + size is past the end of data")),
            },
        };
        if byte_len % 4 != 0 {
            return Err(operation_error(
                "the number of bytes to write is not a multiple of 4",
            ));
        }

        // SAFETY: nothing between `from_js` above and this read runs JS.
        let bytes = unsafe { source.bytes() };
        let bytes = &bytes[start as usize..(start + byte_len) as usize];
        let result = instance().queue_write_buffer(
            self.device.raw.queue_id(),
            buffer.id(),
            buffer_offset,
            bytes,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn write_texture(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let destination = parse_texel_copy_texture_info(
            global,
            callframe.argument(0),
            "writeTexture: destination",
        )?;
        let layout = parse_texel_copy_buffer_layout(
            global,
            callframe.argument(2),
            "GPUTexelCopyBufferLayout",
        )?;
        let size = args::to_extent3d(global, callframe.argument(3), "writeTexture: size")?;
        let source = BufferSource::from_js(global, callframe.argument(1), "writeTexture: data")?;
        // SAFETY: nothing between `from_js` above and this read runs JS.
        let bytes = unsafe { source.bytes() };
        let result = instance().queue_write_texture(
            self.device.raw.queue_id(),
            &destination,
            bytes,
            &layout,
            &size,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }
}
