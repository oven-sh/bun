use std::sync::Arc;

use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, ArrayBuffer, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue,
    JsCell, JsClass as _, JsResult,
};

use super::GPUCommandBuffer::GPUCommandBuffer;
use super::inner::GpuDeviceInner;

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUQueue {
    pub inner: Arc<GpuDeviceInner>,
    pub label: JsCell<String>,
}

impl GPUQueue {
    pub fn get_label(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, this.label.get().as_bytes())
    }

    pub fn set_label(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if value.is_string() {
            if let Ok(s) = value.to_bun_string(global) {
                let owned = String::from_utf8_lossy(s.to_utf8().slice()).into_owned();
                this.label.set(owned);
            }
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn submit(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let array_val = callframe.argument(0);
        if !array_val.is_object() {
            return Err(global.throw(format_args!(
                "GPUQueue.submit: argument must be an array of GPUCommandBuffer"
            )));
        }

        let length = array_val.get_length(global)? as u32;
        let mut command_buffers = Vec::with_capacity(length as usize);

        for i in 0..length {
            let elem = JSValue::get_index(array_val, global, i)?;
            let ptr = GPUCommandBuffer::from_js(elem).ok_or_else(|| {
                global.throw(format_args!(
                    "GPUQueue.submit: array element {} is not a GPUCommandBuffer",
                    i
                ))
            })?;
            let cb_ref = unsafe { &*ptr };
            let cb = cb_ref.take_command_buffer().ok_or_else(|| {
                global.throw(format_args!(
                    "GPUQueue.submit: GPUCommandBuffer has already been submitted"
                ))
            })?;
            command_buffers.push(cb);
        }

        this.inner.queue.submit(command_buffers);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_buffer(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let buffer_val = callframe.argument(0);
        let buffer_offset = callframe.argument(1).as_number() as u64;
        let data_val = callframe.argument(2);
        let data_offset = if callframe.arguments_count() > 3 {
            callframe.argument(3).as_number() as usize
        } else {
            0
        };
        let data_size_opt = if callframe.arguments_count() > 4 {
            let v = callframe.argument(4);
            if v.is_number() {
                Some(v.as_number() as usize)
            } else {
                None
            }
        } else {
            None
        };

        let buf_ptr = super::GPUBuffer::GPUBuffer::from_js(buffer_val).ok_or_else(|| {
            global.throw(format_args!(
                "GPUQueue.writeBuffer: first argument must be a GPUBuffer"
            ))
        })?;
        let buf_ref = unsafe { &*buf_ptr };
        let state = buf_ref.buffer_state.lock().unwrap();
        let wgpu_buffer = state.buffer.as_ref().ok_or_else(|| {
            global.throw(format_args!(
                "GPUQueue.writeBuffer: buffer has been destroyed"
            ))
        })?;

        // Extract bytes from data_val (TypedArray, ArrayBuffer, or DataView)
        let ab = data_val.as_array_buffer(global).ok_or_else(|| {
            global.throw(format_args!(
                "GPUQueue.writeBuffer: data must be a TypedArray or ArrayBuffer"
            ))
        })?;
        let bytes = ab.byte_slice();
        let end = data_size_opt
            .map(|s| (data_offset + s).min(bytes.len()))
            .unwrap_or(bytes.len());
        let slice = &bytes[data_offset..end];

        this.inner
            .queue
            .write_buffer(wgpu_buffer, buffer_offset, slice);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_texture(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!("GPUQueue.writeTexture: not yet implemented")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn copy_external_image_to_texture(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Err(global.throw(format_args!(
            "GPUQueue.copyExternalImageToTexture: not yet implemented"
        )))
    }

    #[bun_jsc::host_fn(method)]
    pub fn on_submitted_work_done(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut promise = JSPromiseStrong::init(global);
        let value = promise.value();
        let mut p = promise.swap();
        p.resolve(global, JSValue::UNDEFINED)?;
        Ok(value)
    }
}
