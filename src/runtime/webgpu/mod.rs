//! <https://gpuweb.github.io/gpuweb/>. Dawn is the device and queue timelines. What is here is the content timeline.

use bun_core::{ExternalSharedDescriptor, String};
use bun_dawn_sys::{self as dawn, Ref, StringView};
use bun_jsc::bindgen::{JsHeap, JsPayload, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsClass as _};

use crate::generated_bindgen::webgpu as idl;

mod adapter;
mod buffer;
mod convert;
mod device;
mod encoder;
mod error;
mod instance;
mod pipeline;
mod queue;
mod texture;

pub(crate) use adapter::{
    GPU, GPUAdapter, GPUAdapterInfo, GPUSupportedFeatures, GPUSupportedLimits, WGSLLanguageFeatures,
};
pub(crate) use buffer::GPUBuffer;
pub(crate) use device::{GPUDevice, GPUQuerySet};
pub(crate) use encoder::{
    GPUCommandEncoder, GPUComputePassEncoder, GPURenderBundleEncoder, GPURenderPassEncoder,
};
pub(crate) use error::{GPUDeviceLostInfo, GPUError, GPUPipelineError, GPUUncapturedErrorEvent};
pub(crate) use instance::Instance;
pub(crate) use pipeline::{
    GPUCompilationInfo, GPUCompilationMessage, GPUComputePipeline, GPURenderPipeline,
    GPUShaderModule,
};
pub(crate) use queue::GPUQueue;
pub(crate) use texture::{GPUExternalTexture, GPUTexture};

pub(crate) type GPUBindGroup = Object<dawn::BindGroup>;
pub(crate) type GPUBindGroupLayout = Object<dawn::BindGroupLayout>;
pub(crate) type GPUCommandBuffer = Object<dawn::CommandBuffer>;
pub(crate) type GPUPipelineLayout = Object<dawn::PipelineLayout>;
pub(crate) type GPURenderBundle = Object<dawn::RenderBundle>;
pub(crate) type GPUSampler = Object<dawn::Sampler>;
pub(crate) type GPUTextureView = Object<dawn::TextureView>;

// HOST_EXPORT(Bun__createNavigatorGPU)
pub(crate) fn create_navigator_gpu(global: &JSGlobalObject) -> JSValue {
    #[inline(never)]
    fn create(global: &JSGlobalObject) -> JSValue {
        GPU::default().to_js(global)
    }
    bun_removable_features::call_removable_or!(
        WebGpu,
        ReturnDefault,
        {
            let constructor = idl::js_GPU::get_constructor(global);
            crate::removed_feature::stand_in_for_removed_instance(global, constructor)
        },
        create,
        global
    )
}

/// `GPUObjectBase`
pub(crate) struct Object<T: ExternalSharedDescriptor, State = device::HoldsMemory> {
    handle: Ref<T>,
    label: JsCell<String>,
    state: State,
}

impl<T: ExternalSharedDescriptor, State> Object<T, State> {
    fn with_state(handle: Ref<T>, label: &String, state: State) -> Self {
        Self {
            handle,
            label: JsCell::new(label.clone()),
            state,
        }
    }

    pub(crate) fn get_label(&self) -> String {
        self.label.get().clone()
    }
}

macro_rules! impl_set_label {
    ($($Object:ident),*) => {$(
        impl $Object {
            pub(crate) fn set_label(&self, label: String) {
                self.handle.set_label(StringView::from(&*label.to_utf8()));
                self.label.set(label);
            }
        }
    )*};
}

impl_set_label!(
    GPUBindGroup,
    GPUBindGroupLayout,
    GPUBuffer,
    GPUCommandBuffer,
    GPUCommandEncoder,
    GPUComputePassEncoder,
    GPUComputePipeline,
    GPUDevice,
    GPUPipelineLayout,
    GPUQuerySet,
    GPUQueue,
    GPURenderBundle,
    GPURenderBundleEncoder,
    GPURenderPassEncoder,
    GPURenderPipeline,
    GPUSampler,
    GPUShaderModule,
    GPUTexture,
    GPUTextureView
);

macro_rules! impl_estimated_size {
    ($($Object:ident: $kilobytes:literal),*) => {$(
        impl $Object {
            pub(crate) fn estimated_size(&self) -> usize {
                $kilobytes * 1024
            }
        }
    )*};
}

// What a small one adds to the RSS with a driver that runs on the CPU.
impl_estimated_size!(
    GPUBindGroup: 1,
    GPUBindGroupLayout: 3,
    GPUCommandBuffer: 4,
    GPUCommandEncoder: 4,
    GPUComputePipeline: 64,
    GPUPipelineLayout: 1,
    GPUQuerySet: 8,
    GPURenderBundle: 1,
    GPURenderBundleEncoder: 1,
    GPURenderPipeline: 128,
    GPUSampler: 2,
    GPUShaderModule: 96,
    GPUTextureView: 1
);

/// A class with the internal field `parent`.
trait Child: JsPayload<Base = ()> {
    fn set_parent(this_value: JSValue, global: &JSGlobalObject, parent: JSValue);

    fn into_child_of<'a>(self, heap: &JsHeap<'a>, parent: JSValue) -> JsWrapper<'a, Self> {
        let this_value = self.into_js(heap);
        // SAFETY: storing a value runs no JavaScript.
        Self::set_parent(this_value.to_js(), unsafe { heap.global() }, parent);
        this_value
    }
}

macro_rules! impl_child {
    ($($Object:ident: $js:ident),*) => {$(
        impl Child for $Object {
            fn set_parent(this_value: JSValue, global: &JSGlobalObject, parent: JSValue) {
                idl::$js::parent_set_cached(this_value, global, parent);
            }
        }
    )*};
}

impl_child!(
    GPUBuffer: js_GPUBuffer,
    GPUCommandEncoder: js_GPUCommandEncoder,
    GPUComputePassEncoder: js_GPUComputePassEncoder,
    GPUComputePipeline: js_GPUComputePipeline,
    GPUQueue: js_GPUQueue,
    GPURenderBundleEncoder: js_GPURenderBundleEncoder,
    GPURenderPassEncoder: js_GPURenderPassEncoder,
    GPURenderPipeline: js_GPURenderPipeline,
    GPUShaderModule: js_GPUShaderModule,
    GPUTexture: js_GPUTexture
);
