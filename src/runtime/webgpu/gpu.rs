//! `navigator.gpu`.

use bun_jsc::{CallFrame, JSGlobalObject, JSPromise, JSValue, JsClass, JsResult};
use bun_webgpu::{instance, wgc, wgt};

use super::args::Dict;
use super::{GPUAdapter, js_module};

#[bun_jsc::JsClass]
#[derive(Default)]
pub struct GPU {}

super::gpu_object!(GPU);

impl GPU {
    pub(crate) fn request_adapter(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // A promise-returning operation reports a bad argument by rejecting, not by throwing.
        JSPromise::wrap(global, |global| {
            Self::request_adapter_impl(global, callframe)
        })
    }

    fn request_adapter_impl(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let options = Dict::new(global, callframe.argument(0), "GPURequestAdapterOptions")?;
        // featureLevel and xrCompatible are accepted and have no effect here.
        let power_preference = options.enum_or(
            "powerPreference",
            "GPUPowerPreference",
            bun_webgpu::names::parse_power_preference,
            wgt::PowerPreference::None,
        )?;
        let force_fallback_adapter = options.bool_or("forceFallbackAdapter", false)?;

        let desc = wgc::instance::RequestAdapterOptions {
            power_preference,
            force_fallback_adapter,
            compatible_surface: None,
            apply_limit_buckets: false,
        };
        let adapter = match instance().request_adapter(&desc, wgt::Backends::PRIMARY, None) {
            Ok(id) => GPUAdapter::create(global, bun_webgpu::Adapter::new(id)),
            // No GPU API on this machine, or no adapter that fits: WebGPU's answer is `null`.
            Err(_) => JSValue::NULL,
        };
        Ok(JSPromise::resolved_promise_value(global, adapter))
    }

    /// No canvas exists. This is the format browsers report everywhere but Android.
    pub(crate) fn get_preferred_canvas_format(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        use bun_jsc::StringJsc as _;
        bun_core::String::static_("bgra8unorm").to_js(global)
    }

    pub(crate) fn get_wgsl_language_features(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let names = JSValue::create_empty_array(global, 0)?;
        js_module(global, "createWGSLLanguageFeatures", &[names])
    }
}

/// `navigator.gpu`, created the first time it is read.
#[unsafe(no_mangle)]
extern "C" fn Bun__WebGPU__createGPU(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();
    GPU::default().to_js(global)
}
