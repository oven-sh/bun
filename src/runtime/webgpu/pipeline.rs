use core::ffi::c_void;

use bun_core::Utf8Bytes;
use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_jsc::{JSValue, JsClass as _, JsResult};

use super::device::DeviceRef;
use super::instance::Instance;
use super::{
    GPUBindGroupLayout, GPUDevice, GPUPipelineError, WebEnum as _, gpu_object, new_object,
    optional_string_view, optional_to_sys, string_view, sys, to_sys_bool,
};
use crate::generated_bindgen::webgpu::{
    GPUBlendComponent, GPUComputePipelineDescriptor, GPUPipelineLayoutOrAuto,
    GPURenderPipelineDescriptor, GPUStencilFaceState,
};

gpu_object! {
    GPUComputePipeline {
        handle: WGPUComputePipeline,
        release: wgpuComputePipelineRelease,
        set_label: wgpuComputePipelineSetLabel,
        device: DeviceRef,
    }
}

gpu_object! {
    GPURenderPipeline {
        handle: WGPURenderPipeline,
        release: wgpuRenderPipelineRelease,
        set_label: wgpuRenderPipelineSetLabel,
        device: DeviceRef,
    }
}

impl GPUComputePipeline {
    pub(crate) fn get_bind_group_layout(&self, heap: &JsHeap<'_>, index: u32) -> JSValue {
        // SAFETY: a live pipeline.
        let layout = unsafe { sys::wgpuComputePipelineGetBindGroupLayout(self.handle, index) };
        new_object(
            heap,
            GPUBindGroupLayout::new(layout, &bun_core::String::EMPTY, self.device.clone()),
        )
    }
}

impl GPURenderPipeline {
    pub(crate) fn get_bind_group_layout(&self, heap: &JsHeap<'_>, index: u32) -> JSValue {
        // SAFETY: a live pipeline.
        let layout = unsafe { sys::wgpuRenderPipelineGetBindGroupLayout(self.handle, index) };
        new_object(
            heap,
            GPUBindGroupLayout::new(layout, &bun_core::String::EMPTY, self.device.clone()),
        )
    }
}

// ───────────────────────────── descriptors ─────────────────────────────

/// Null asks Dawn to work the layout out.
fn layout_to_sys(layout: &GPUPipelineLayoutOrAuto) -> sys::WGPUPipelineLayout {
    match layout {
        GPUPipelineLayoutOrAuto::Layout(layout) => layout.handle,
        GPUPipelineLayoutOrAuto::Automatic(_) => core::ptr::null_mut(),
    }
}

/// The `constants` of a stage. `entries` points into `_keys`.
struct Constants<'a> {
    _keys: Vec<Utf8Bytes<'a>>,
    entries: Vec<sys::WGPUConstantEntry>,
}

impl<'a> Constants<'a> {
    fn new(constants: &'a [(bun_core::String, f64)]) -> Self {
        let keys: Vec<Utf8Bytes<'a>> = constants.iter().map(|(key, _)| key.to_utf8()).collect();
        let entries = keys
            .iter()
            .zip(constants)
            .map(|(key, &(_, value))| sys::WGPUConstantEntry {
                key: string_view(key),
                value,
                ..sys::WGPUConstantEntry::INIT
            })
            .collect();
        Self {
            _keys: keys,
            entries,
        }
    }
}

fn with_compute_pipeline_descriptor<R>(
    descriptor: &GPUComputePipelineDescriptor<'_>,
    f: impl FnOnce(&sys::WGPUComputePipelineDescriptor) -> R,
) -> R {
    let label = descriptor.label.to_utf8();
    let constants = Constants::new(&descriptor.compute.constants);
    f(&sys::WGPUComputePipelineDescriptor {
        label: string_view(&label),
        layout: layout_to_sys(&descriptor.layout),
        compute: sys::WGPUComputeState {
            module: descriptor.compute.module.handle,
            entryPoint: optional_string_view(descriptor.compute.entry_point),
            constantCount: constants.entries.len(),
            constants: constants.entries.as_ptr(),
            ..sys::WGPUComputeState::INIT
        },
        ..sys::WGPUComputePipelineDescriptor::INIT
    })
}

fn stencil_face_to_sys(face: &GPUStencilFaceState) -> sys::WGPUStencilFaceState {
    sys::WGPUStencilFaceState {
        compare: face.compare.to_sys(),
        failOp: face.fail_op.to_sys(),
        depthFailOp: face.depth_fail_op.to_sys(),
        passOp: face.pass_op.to_sys(),
    }
}

fn blend_component_to_sys(component: &GPUBlendComponent) -> sys::WGPUBlendComponent {
    sys::WGPUBlendComponent {
        operation: component.operation.to_sys(),
        srcFactor: component.src_factor.to_sys(),
        dstFactor: component.dst_factor.to_sys(),
    }
}

fn with_render_pipeline_descriptor<R>(
    descriptor: &GPURenderPipelineDescriptor<'_>,
    f: impl FnOnce(&sys::WGPURenderPipelineDescriptor) -> R,
) -> R {
    let label = descriptor.label.to_utf8();

    let vertex_constants = Constants::new(&descriptor.vertex.constants);
    let attributes: Vec<Vec<sys::WGPUVertexAttribute>> = descriptor
        .vertex
        .buffers
        .iter()
        .map(|buffer| {
            let attributes = buffer.as_ref().map_or(&[][..], |buffer| &buffer.attributes);
            attributes
                .iter()
                .map(|attribute| sys::WGPUVertexAttribute {
                    format: attribute.format.to_sys(),
                    offset: attribute.offset,
                    shaderLocation: attribute.shader_location,
                    ..sys::WGPUVertexAttribute::INIT
                })
                .collect()
        })
        .collect();
    let buffers: Vec<sys::WGPUVertexBufferLayout> = descriptor
        .vertex
        .buffers
        .iter()
        .zip(&attributes)
        .map(|(buffer, attributes)| match buffer {
            Some(buffer) => sys::WGPUVertexBufferLayout {
                stepMode: buffer.step_mode.to_sys(),
                arrayStride: buffer.array_stride,
                attributeCount: attributes.len(),
                attributes: attributes.as_ptr(),
                ..sys::WGPUVertexBufferLayout::INIT
            },
            // No step mode and no attributes: the slot is not used.
            None => sys::WGPUVertexBufferLayout {
                stepMode: sys::WGPUVertexStepMode::Undefined,
                ..sys::WGPUVertexBufferLayout::INIT
            },
        })
        .collect();

    let depth_stencil = descriptor
        .depth_stencil
        .as_ref()
        .map(|state| sys::WGPUDepthStencilState {
            format: state.format.to_sys(),
            depthWriteEnabled: match state.depth_write_enabled {
                Some(true) => sys::WGPUOptionalBool::True,
                Some(false) => sys::WGPUOptionalBool::False,
                None => sys::WGPUOptionalBool::Undefined,
            },
            depthCompare: optional_to_sys!(state.depth_compare, WGPUCompareFunction),
            stencilFront: stencil_face_to_sys(&state.stencil_front),
            stencilBack: stencil_face_to_sys(&state.stencil_back),
            stencilReadMask: state.stencil_read_mask,
            stencilWriteMask: state.stencil_write_mask,
            depthBias: state.depth_bias,
            depthBiasSlopeScale: state.depth_bias_slope_scale,
            depthBiasClamp: state.depth_bias_clamp,
            ..sys::WGPUDepthStencilState::INIT
        });

    let targets = descriptor
        .fragment
        .as_ref()
        .map_or(&[][..], |fragment| &fragment.targets);
    let blends: Vec<Option<sys::WGPUBlendState>> = targets
        .iter()
        .map(|target| {
            let blend = target.as_ref()?.blend.as_ref()?;
            Some(sys::WGPUBlendState {
                color: blend_component_to_sys(&blend.color),
                alpha: blend_component_to_sys(&blend.alpha),
            })
        })
        .collect();
    let sys_targets: Vec<sys::WGPUColorTargetState> = targets
        .iter()
        .zip(&blends)
        .map(|(target, blend)| match target {
            Some(target) => sys::WGPUColorTargetState {
                format: target.format.to_sys(),
                blend: blend
                    .as_ref()
                    .map_or(core::ptr::null(), core::ptr::from_ref),
                writeMask: target.write_mask.into(),
                ..sys::WGPUColorTargetState::INIT
            },
            // No format: nothing is drawn to this one.
            None => sys::WGPUColorTargetState {
                format: sys::WGPUTextureFormat::Undefined,
                ..sys::WGPUColorTargetState::INIT
            },
        })
        .collect();
    let fragment_constants = descriptor
        .fragment
        .as_ref()
        .map(|fragment| Constants::new(&fragment.constants));
    let fragment = descriptor
        .fragment
        .as_ref()
        .zip(fragment_constants.as_ref())
        .map(|(fragment, constants)| sys::WGPUFragmentState {
            module: fragment.module.handle,
            entryPoint: optional_string_view(fragment.entry_point),
            constantCount: constants.entries.len(),
            constants: constants.entries.as_ptr(),
            targetCount: sys_targets.len(),
            targets: sys_targets.as_ptr(),
            ..sys::WGPUFragmentState::INIT
        });

    f(&sys::WGPURenderPipelineDescriptor {
        label: string_view(&label),
        layout: layout_to_sys(&descriptor.layout),
        vertex: sys::WGPUVertexState {
            module: descriptor.vertex.module.handle,
            entryPoint: optional_string_view(descriptor.vertex.entry_point),
            constantCount: vertex_constants.entries.len(),
            constants: vertex_constants.entries.as_ptr(),
            bufferCount: buffers.len(),
            buffers: buffers.as_ptr(),
            ..sys::WGPUVertexState::INIT
        },
        primitive: sys::WGPUPrimitiveState {
            topology: descriptor.primitive.topology.to_sys(),
            stripIndexFormat: optional_to_sys!(
                descriptor.primitive.strip_index_format,
                WGPUIndexFormat
            ),
            frontFace: descriptor.primitive.front_face.to_sys(),
            cullMode: descriptor.primitive.cull_mode.to_sys(),
            unclippedDepth: to_sys_bool(descriptor.primitive.unclipped_depth),
            ..sys::WGPUPrimitiveState::INIT
        },
        depthStencil: depth_stencil
            .as_ref()
            .map_or(core::ptr::null(), core::ptr::from_ref),
        multisample: sys::WGPUMultisampleState {
            count: descriptor.multisample.count,
            mask: descriptor.multisample.mask,
            alphaToCoverageEnabled: to_sys_bool(descriptor.multisample.alpha_to_coverage_enabled),
            ..sys::WGPUMultisampleState::INIT
        },
        fragment: fragment
            .as_ref()
            .map_or(core::ptr::null(), core::ptr::from_ref),
        ..sys::WGPURenderPipelineDescriptor::INIT
    })
}

// ───────────────────────────── creation ─────────────────────────────

impl GPUDevice {
    fn validate_render_pipeline_formats<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPURenderPipelineDescriptor<'a>,
    ) -> bindgen::Result<'a, ()> {
        let targets = descriptor
            .fragment
            .as_ref()
            .map_or(&[][..], |fragment| &fragment.targets);
        for target in targets.iter().flatten() {
            self.state.validate_format(heap, target.format)?;
        }
        if let Some(depth_stencil) = &descriptor.depth_stencil {
            self.state.validate_format(heap, depth_stencil.format)?;
        }
        Ok(())
    }

    pub(crate) fn create_compute_pipeline<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUComputePipelineDescriptor<'a>,
    ) -> JSValue {
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle = with_compute_pipeline_descriptor(descriptor, |descriptor| unsafe {
            sys::wgpuDeviceCreateComputePipeline(self.handle, descriptor)
        });
        new_object(
            heap,
            GPUComputePipeline::new(handle, &descriptor.label, self.device_ref()),
        )
    }

    pub(crate) fn create_render_pipeline<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPURenderPipelineDescriptor<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        self.validate_render_pipeline_formats(heap, descriptor)?;
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle = with_render_pipeline_descriptor(descriptor, |descriptor| unsafe {
            sys::wgpuDeviceCreateRenderPipeline(self.handle, descriptor)
        });
        Ok(new_object(
            heap,
            GPURenderPipeline::new(handle, &descriptor.label, self.device_ref()),
        ))
    }

    pub(crate) fn create_compute_pipeline_async<'a>(
        &self,
        cx: &mut JsScope<'a>,
        descriptor: &GPUComputePipelineDescriptor<'a>,
    ) -> JsResult<JSValue> {
        let (promise, userdata) = self
            .state
            .instance
            .new_promise(cx.global(), (descriptor.label.clone(), self.device_ref()));
        let callback = sys::WGPUCreateComputePipelineAsyncCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_compute_pipeline),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live device, and a descriptor that Dawn is done with when the call returns.
        with_compute_pipeline_descriptor(descriptor, |descriptor| unsafe {
            sys::wgpuDeviceCreateComputePipelineAsync(self.handle, descriptor, callback)
        });
        Ok(promise)
    }

    pub(crate) fn create_render_pipeline_async<'a>(
        &self,
        cx: &mut JsScope<'a>,
        descriptor: &GPURenderPipelineDescriptor<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        self.validate_render_pipeline_formats(&cx.heap, descriptor)?;
        let (promise, userdata) = self
            .state
            .instance
            .new_promise(cx.global(), (descriptor.label.clone(), self.device_ref()));
        let callback = sys::WGPUCreateRenderPipelineAsyncCallbackInfo {
            nextInChain: core::ptr::null_mut(),
            mode: sys::WGPUCallbackMode::AllowProcessEvents,
            callback: Some(on_render_pipeline),
            userdata1: userdata,
            userdata2: core::ptr::null_mut(),
        };
        // SAFETY: a live device, and a descriptor that Dawn is done with when the call returns.
        with_render_pipeline_descriptor(descriptor, |descriptor| unsafe {
            sys::wgpuDeviceCreateRenderPipelineAsync(self.handle, descriptor, callback)
        });
        Ok(promise)
    }
}

macro_rules! on_pipeline {
    ($name:ident, $Handle:ident, $Pipeline:ident) => {
        unsafe extern "C" fn $name(
            status: sys::WGPUCreatePipelineAsyncStatus,
            pipeline: sys::$Handle,
            message: sys::WGPUStringView,
            userdata1: *mut c_void,
            _userdata2: *mut c_void,
        ) {
            type Data = (bun_core::String, DeviceRef);
            // SAFETY: what `new_promise` gave the function that passed this callback.
            let (settle, (label, device)) = unsafe { Instance::finish::<Data>(userdata1) };
            let pipeline = (!pipeline.is_null()).then(|| $Pipeline::new(pipeline, &label, device));
            settle.with(|global| match pipeline {
                Some(pipeline) if status == sys::WGPUCreatePipelineAsyncStatus::Success => {
                    Ok(pipeline.to_js(global))
                }
                // SAFETY: Dawn's, until this returns.
                _ => Err(unsafe { GPUPipelineError::of(status, message) }.to_js(global)),
            });
        }
    };
}
on_pipeline!(on_compute_pipeline, WGPUComputePipeline, GPUComputePipeline);
on_pipeline!(on_render_pipeline, WGPURenderPipeline, GPURenderPipeline);
