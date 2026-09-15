//! `navigator.gpu` and the `GPU*` classes (<https://www.w3.org/TR/webgpu/>) on wgpu-core.

mod adapter;
mod args;
mod bind;
mod buffer;
mod command;
mod compute_pass;
mod device;
mod gpu;
mod pipeline;
mod query;
mod queue;
mod render_pass;
mod shader;
mod texture;
mod wait;

pub use adapter::GPUAdapter;
pub use bind::{GPUBindGroup, GPUBindGroupLayout, GPUPipelineLayout};
pub use buffer::GPUBuffer;
pub use command::{GPUCommandBuffer, GPUCommandEncoder};
pub use compute_pass::GPUComputePassEncoder;
pub use device::GPUDeviceHandle;
pub use gpu::GPU;
pub use pipeline::{GPUComputePipeline, GPURenderPipeline};
pub use query::GPUQuerySet;
pub use queue::GPUQueue;
pub use render_pass::{GPURenderBundle, GPURenderBundleEncoder, GPURenderPassEncoder};
pub use shader::GPUShaderModule;
pub use texture::{GPUSampler, GPUTexture, GPUTextureView};

use bun_jsc::{JSGlobalObject, JSValue, JsResult};

/// The throwing constructor every `GPU*` global has, plus `label` for the types that carry one.
macro_rules! gpu_object {
    ($ty:ident) => {
        impl $ty {
            pub(crate) fn constructor(
                global: &bun_jsc::JSGlobalObject,
                _callframe: &bun_jsc::CallFrame,
            ) -> bun_jsc::JsResult<*mut $ty> {
                Err(global.throw_illegal_constructor())
            }
        }
    };
    ($ty:ident, label) => {
        $crate::webgpu::gpu_object!($ty);
        impl $ty {
            pub(crate) fn get_label(
                &self,
                global: &bun_jsc::JSGlobalObject,
            ) -> bun_jsc::JsResult<bun_jsc::JSValue> {
                use bun_jsc::StringJsc as _;
                self.label.get().to_js(global)
            }
            pub(crate) fn set_label(
                &self,
                global: &bun_jsc::JSGlobalObject,
                value: bun_jsc::JSValue,
            ) -> bun_jsc::JsResult<bool> {
                self.label.set(value.to_bun_string(global)?);
                Ok(true)
            }
        }
    };
}
pub(crate) use gpu_object;

/// `label` as wgpu wants it.
pub(crate) fn wgpu_label(label: &bun_core::String) -> Option<std::borrow::Cow<'static, str>> {
    if label.is_empty() {
        return None;
    }
    Some(std::borrow::Cow::Owned(args::usv_string(&label.to_utf8())))
}

unsafe extern "C" {
    safe fn Bun__WebGPU__internalModule(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__WebGPU__pinArrayBuffer(value: JSValue);
    safe fn Bun__WebGPU__detachArrayBuffer(global: &JSGlobalObject, value: JSValue);
}

/// Calls the export `name` of `internal/webgpu` with `args`.
pub(crate) fn js_module(
    global: &JSGlobalObject,
    name: &'static str,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let module =
        bun_jsc::host_fn::from_js_host_call(global, || Bun__WebGPU__internalModule(global))?;
    let Some(function) = module.get(global, name)? else {
        return Err(
            global.throw_type_error(format_args!("internal/webgpu has no export named {name}"))
        );
    };
    function.call(global, JSValue::UNDEFINED, args)
}

/// Makes the ArrayBuffer `value` non-transferable until [`detach_array_buffer`].
pub(crate) fn pin_array_buffer(value: JSValue) {
    Bun__WebGPU__pinArrayBuffer(value)
}

/// Unpins and detaches an ArrayBuffer that [`pin_array_buffer`] pinned.
pub(crate) fn detach_array_buffer(global: &JSGlobalObject, value: JSValue) {
    Bun__WebGPU__detachArrayBuffer(global, value)
}
