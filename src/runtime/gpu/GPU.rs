use std::sync::Arc;

use bun_jsc::{
    AnyTaskJob, AnyTaskJobCtx, CallFrame, JSGlobalObject, JSPromiseStrong, JSValue, JsClass as _,
    JsResult,
};

use super::GPUAdapter::GPUAdapter;

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct GPU {
    _priv: (),
}

impl GPU {
    pub fn new() -> Self {
        Self { _priv: () }
    }

    #[bun_jsc::host_fn(method)]
    pub fn request_adapter(
        _this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let options = callframe.argument(0);
        let power_preference = if options.is_object() {
            match options.get(global, b"powerPreference")? {
                Some(v) if v.is_string() => {
                    let s = v.to_bun_string(global)?;
                    let utf8 = s.to_utf8();
                    match utf8.slice() {
                        b"high-performance" => wgpu::PowerPreference::HighPerformance,
                        b"low-power" => wgpu::PowerPreference::LowPower,
                        _ => wgpu::PowerPreference::None,
                    }
                }
                _ => wgpu::PowerPreference::None,
            }
        } else {
            wgpu::PowerPreference::None
        };

        let promise = JSPromiseStrong::init(global);
        let promise_value = promise.value();

        AnyTaskJob::create_and_schedule(
            global,
            RequestAdapterTask {
                power_preference,
                promise,
                result: None,
            },
        )?;

        Ok(promise_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_preferred_canvas_format(
        _this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, b"bgra8unorm")
    }

    pub fn get_wgsl_language_features(_this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(global, 0))
    }
}

// ── Async task: request_adapter ──────────────────────────────────────────────

struct RequestAdapterTask {
    power_preference: wgpu::PowerPreference,
    promise: JSPromiseStrong,
    result: Option<wgpu::Adapter>,
}

// SAFETY: wgpu::Adapter is Send + Sync
unsafe impl Send for RequestAdapterTask {}

impl AnyTaskJobCtx for RequestAdapterTask {
    fn run(&mut self, _global: *mut JSGlobalObject) {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        self.result =
            futures::executor::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: self.power_preference,
                compatible_surface: None,
                force_fallback_adapter: false,
            }))
            .ok();
    }

    fn then(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        let mut promise = self.promise.swap();
        match self.result.take() {
            Some(adapter) => {
                let adapter_info = adapter.get_info();
                let js_adapter = GPUAdapter {
                    adapter: Arc::new(adapter),
                    adapter_info,
                    label: bun_jsc::JsCell::new(String::new()),
                }
                .to_js(global);
                promise.resolve(global, js_adapter)?;
            }
            None => {
                promise.resolve(global, JSValue::NULL)?;
            }
        }
        Ok(())
    }
}

// ── C export for ZigGlobalObject ─────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn GPUSingleton__create(global: &JSGlobalObject) -> JSValue {
    GPU::new().to_js(global)
}
