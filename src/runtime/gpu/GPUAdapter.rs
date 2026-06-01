use std::sync::Arc;

use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsCell,
    JsClass as _, JsResult,
};

use super::GPUDevice::GPUDevice;
use super::inner::GpuDeviceInner;

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPUAdapter {
    pub adapter: Arc<wgpu::Adapter>,
    pub adapter_info: wgpu::AdapterInfo,
    pub label: JsCell<String>,
}

impl GPUAdapter {
    #[bun_jsc::host_fn(method)]
    pub fn request_device(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let descriptor = callframe.argument(0);
        let label = if descriptor.is_object() {
            match descriptor.get(global, b"label")? {
                Some(v) if v.is_string() => {
                    let s = v.to_bun_string(global)?;
                    String::from_utf8_lossy(s.to_utf8().slice()).into_owned()
                }
                _ => String::new(),
            }
        } else {
            String::new()
        };

        let promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();

        AnyTaskJob::create_and_schedule(
            global,
            RequestDeviceTask {
                adapter: Arc::clone(&this.adapter),
                adapter_info: this.adapter_info.clone(),
                label,
                promise,
                result: None,
                error: None,
            },
        )?;

        Ok(promise_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn request_adapter_info(
        this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let info = build_adapter_info_object(global, &this.adapter_info)?;
        let mut promise = JSPromiseStrong::init(global);
        let value = promise.value();
        let mut p = promise.swap();
        p.resolve(global, info)?;
        Ok(value)
    }

    pub fn get_info(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        build_adapter_info_object(global, &this.adapter_info)
    }

    pub fn get_features(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(global, 0))
    }

    pub fn get_limits(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(global, 0))
    }

    pub fn get_is_fallback_adapter(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(
            this.adapter_info.device_type == wgpu::DeviceType::Cpu,
        ))
    }
}

fn build_adapter_info_object(
    global: &JSGlobalObject,
    info: &wgpu::AdapterInfo,
) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 4);
    obj.put(
        global,
        b"vendor",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.vendor.to_string().as_bytes())?,
    );
    obj.put(
        global,
        b"architecture",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.name.as_bytes())?,
    );
    obj.put(
        global,
        b"device",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.device.to_string().as_bytes())?,
    );
    obj.put(
        global,
        b"description",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, info.driver.as_bytes())?,
    );
    Ok(obj)
}

// ── Async task: request_device ───────────────────────────────────────────────

struct RequestDeviceTask {
    adapter: Arc<wgpu::Adapter>,
    adapter_info: wgpu::AdapterInfo,
    label: String,
    promise: JSPromiseStrong,
    result: Option<(wgpu::Device, wgpu::Queue)>,
    error: Option<String>,
}

// SAFETY: Arc<wgpu::Adapter>, wgpu::Device, wgpu::Queue are Send
unsafe impl Send for RequestDeviceTask {}

impl AnyTaskJobCtx for RequestDeviceTask {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let desc = wgpu::DeviceDescriptor {
            label: if self.label.is_empty() {
                None
            } else {
                Some(self.label.as_str())
            },
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: Default::default(),
            experimental_features: Default::default(),
            trace: Default::default(),
        };
        match futures::executor::block_on(self.adapter.request_device(&desc)) {
            Ok((device, queue)) => self.result = Some((device, queue)),
            Err(e) => self.error = Some(e.to_string()),
        }
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        let mut promise = self.promise.swap();
        if let Some(err) = self.error.take() {
            let err_msg = format!("requestDevice failed: {}", err);
            let js_err = global.throw(format_args!("{}", err_msg));
            promise.reject_with_async_stack(global, Err(js_err))?;
            return Ok(());
        }
        let (device, queue) = self.result.take().unwrap();
        let inner = GpuDeviceInner::new(device, queue, self.adapter_info.clone());
        let label = core::mem::take(&mut self.label);
        let js_device = GPUDevice {
            inner,
            label: JsCell::new(label),
        }
        .to_js(global);
        promise.resolve(global, js_device)?;
        Ok(())
    }
}
