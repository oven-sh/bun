use std::rc::Rc;

use bun_collections::smallvec::SmallVec;
use bun_core::String;
use bun_dawn_sys::{self as dawn, Chain, CreatePipelineAsyncStatus, FeatureName, StringView};
use bun_jsc::bindgen::{
    DOMExceptionBase, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper, Result, to_js,
};
use bun_jsc::{JSArray, JSGlobalObject, JSValue, JsClass as _};

use super::device::Device;
use super::instance::Deferred;
use super::{GPUBindGroupLayout, GPUPipelineError, Object, convert, idl};

pub(crate) type GPUShaderModule = Object<dawn::ShaderModule, Rc<Device>>;
pub(crate) type GPUComputePipeline = Object<dawn::ComputePipeline>;
pub(crate) type GPURenderPipeline = Object<dawn::RenderPipeline>;

impl GPUShaderModule {
    pub(crate) fn get_compilation_info<'a>(&self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let (deferred, promise) = Deferred::new(&self.state.instance, cx);
        let callback = dawn::CompilationInfoCallbackInfo::new(move |_, info| {
            let messages = info.map_or(&[][..], |info| info.messages.as_slice());
            let messages = messages.iter().map(GPUCompilationMessage::new).collect();
            deferred.complete(move |global, promise| {
                promise.resolve(global, GPUCompilationInfo { messages }.to_js(global))
            });
        });
        self.handle.get_compilation_info(callback);
        Ok(promise)
    }
}

pub(crate) struct GPUCompilationInfo {
    messages: Vec<GPUCompilationMessage>,
}

impl GPUCompilationInfo {
    pub(crate) fn get_messages<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JsLocal<'a, JSArray>> {
        heap.create_frozen_array(&self.messages, |heap, message| {
            to_js::any(heap, message.clone().into_js(heap))
        })
    }
}

#[derive(Clone)]
pub(crate) struct GPUCompilationMessage {
    message: String,
    r#type: idl::GPUCompilationMessageType,
    line_num: u64,
    line_pos: u64,
    offset: u64,
    length: u64,
}

impl GPUCompilationMessage {
    fn new(message: &dawn::CompilationMessage<'_>) -> Self {
        let utf16 = (message.next_in_chain).find::<dawn::DawnCompilationMessageUtf16<'_>>();
        let (line_pos, offset, length) = match utf16 {
            Some(utf16) => (utf16.line_pos, utf16.offset, utf16.length),
            None => (message.line_pos, message.offset, message.length),
        };
        Self {
            message: String::clone_utf8(message.message.as_bytes()),
            r#type: match message.r#type {
                dawn::CompilationMessageType::Error => idl::GPUCompilationMessageType::Error,
                dawn::CompilationMessageType::Warning => idl::GPUCompilationMessageType::Warning,
                _ => idl::GPUCompilationMessageType::Info,
            },
            line_num: message.line_num,
            line_pos,
            offset,
            length,
        }
    }

    pub(crate) fn get_message(&self) -> String {
        self.message.clone()
    }

    pub(crate) fn get_type(&self) -> idl::GPUCompilationMessageType {
        self.r#type
    }

    pub(crate) fn get_line_num(&self) -> u64 {
        self.line_num
    }

    pub(crate) fn get_line_pos(&self) -> u64 {
        self.line_pos
    }

    pub(crate) fn get_offset(&self) -> u64 {
        self.offset
    }

    pub(crate) fn get_length(&self) -> u64 {
        self.length
    }
}

macro_rules! impl_pipeline_base {
    ($($Pipeline:ident),*) => {$(
        impl $Pipeline {
            pub(crate) fn get_bind_group_layout<'a>(
                &self,
                heap: &JsHeap<'a>,
                index: u32,
            ) -> JsWrapper<'a, GPUBindGroupLayout> {
                let handle = self.handle.get_bind_group_layout(index);
                Object::with_state(handle, &String::EMPTY, self.state.clone()).into_js(heap)
            }
        }
    )*};
}

impl_pipeline_base!(GPUComputePipeline, GPURenderPipeline);

pub(super) fn create_pipeline_error(
    global: &JSGlobalObject,
    status: CreatePipelineAsyncStatus,
    message: String,
) -> JSValue {
    let reason = match status {
        CreatePipelineAsyncStatus::ValidationError => idl::GPUPipelineErrorReason::Validation,
        _ => idl::GPUPipelineErrorReason::Internal,
    };
    GPUPipelineError { reason }
        .into_js_with_base(JsHeap::from_global(global), &DOMExceptionBase { message })
        .to_js()
}

fn layout<'a>(descriptor: &idl::GPUPipelineDescriptorBase<'a>) -> Option<&'a dawn::PipelineLayout> {
    match descriptor.layout {
        idl::GPUPipelineLayoutOrAuto::Layout(layout) => Some(&layout.handle),
        idl::GPUPipelineLayoutOrAuto::Mode(idl::GPUAutoLayoutMode::Auto) => None,
    }
}

fn entry_point<'a>(stage: &idl::GPUProgrammableStage<'a>) -> StringView<'a> {
    stage.entry_point.map_or(StringView::NULL, Into::into)
}

fn constants<'a>(stage: &'a idl::GPUProgrammableStage<'_>) -> Vec<dawn::ConstantEntry<'a>> {
    (stage.constants.iter())
        .map(|(key, value)| dawn::ConstantEntry {
            next_in_chain: Chain::END,
            key: (**key).into(),
            value: *value,
        })
        .collect()
}

pub(super) fn with_compute_pipeline_descriptor<R>(
    descriptor: &idl::GPUComputePipelineDescriptor<'_>,
    f: impl FnOnce(&dawn::ComputePipelineDescriptor<'_>) -> R,
) -> R {
    f(&dawn::ComputePipelineDescriptor {
        next_in_chain: Chain::END,
        label: convert::label(&descriptor.label.to_utf8()),
        layout: layout(descriptor),
        compute: dawn::ComputeState {
            next_in_chain: Chain::END,
            module: &descriptor.compute.module.handle,
            entry_point: entry_point(&descriptor.compute),
            constants: (*constants(&descriptor.compute)).into(),
        },
    })
}

fn stencil_face(face: &idl::GPUStencilFaceState) -> dawn::StencilFaceState {
    dawn::StencilFaceState {
        compare: face.compare.into(),
        fail_op: face.fail_op.into(),
        depth_fail_op: face.depth_fail_op.into(),
        pass_op: face.pass_op.into(),
    }
}

impl Device {
    fn depth_stencil_state<'a>(
        &self,
        heap: &JsHeap<'a>,
        state: &idl::GPUDepthStencilState,
    ) -> Result<'a, dawn::DepthStencilState<'static>> {
        Ok(dawn::DepthStencilState {
            next_in_chain: Chain::END,
            format: self.texture_format(heap, state.format)?,
            depth_write_enabled: state.depth_write_enabled.into(),
            depth_compare: (state.depth_compare)
                .map_or(dawn::CompareFunction::Undefined, Into::into),
            stencil_front: stencil_face(&state.stencil_front),
            stencil_back: stencil_face(&state.stencil_back),
            stencil_read_mask: state.stencil_read_mask,
            stencil_write_mask: state.stencil_write_mask,
            depth_bias: state.depth_bias,
            depth_bias_slope_scale: state.depth_bias_slope_scale,
            depth_bias_clamp: state.depth_bias_clamp,
        })
    }

    fn blend_factor<'a>(
        &self,
        heap: &JsHeap<'a>,
        factor: idl::GPUBlendFactor,
    ) -> Result<'a, dawn::BlendFactor> {
        use idl::GPUBlendFactor::{OneMinusSrc1, OneMinusSrc1Alpha, Src1, Src1Alpha};
        let feature = FeatureName::DualSourceBlending;
        if matches!(factor, Src1 | OneMinusSrc1 | Src1Alpha | OneMinusSrc1Alpha)
            && !self.has_feature(feature)
        {
            let user = format_args!("A blend factor of \"src1\"");
            return Err(Self::missing_feature(heap, feature, user));
        }
        Ok(factor.into())
    }

    fn blend_component<'a>(
        &self,
        heap: &JsHeap<'a>,
        component: &idl::GPUBlendComponent,
    ) -> Result<'a, dawn::BlendComponent> {
        Ok(dawn::BlendComponent {
            operation: component.operation.into(),
            src_factor: self.blend_factor(heap, component.src_factor)?,
            dst_factor: self.blend_factor(heap, component.dst_factor)?,
        })
    }

    fn blend_state<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: Option<&idl::GPUColorTargetState>,
    ) -> Result<'a, Option<dawn::BlendState>> {
        let Some(blend) = target.and_then(|target| target.blend.as_ref()) else {
            return Ok(None);
        };
        Ok(Some(dawn::BlendState {
            color: self.blend_component(heap, &blend.color)?,
            alpha: self.blend_component(heap, &blend.alpha)?,
        }))
    }

    pub(super) fn with_render_pipeline_descriptor<'a, R>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPURenderPipelineDescriptor<'a>,
        f: impl FnOnce(&dawn::RenderPipelineDescriptor<'_>) -> R,
    ) -> Result<'a, R> {
        let vertex = &descriptor.vertex;
        let attributes = (vertex.buffers.iter().flatten())
            .flat_map(|buffer| &buffer.attributes)
            .map(|attribute| dawn::VertexAttribute {
                next_in_chain: Chain::END,
                format: attribute.format.into(),
                offset: attribute.offset,
                shader_location: attribute.shader_location,
            })
            .collect::<SmallVec<[_; 16]>>();
        let mut attributes = &*attributes;
        let buffers = (vertex.buffers.iter())
            .map(|buffer| {
                let Some(buffer) = buffer else {
                    return Default::default();
                };
                let own;
                (own, attributes) = attributes.split_at(buffer.attributes.len());
                dawn::VertexBufferLayout {
                    next_in_chain: Chain::END,
                    step_mode: buffer.step_mode.into(),
                    array_stride: buffer.array_stride,
                    attributes: own.into(),
                }
            })
            .collect::<SmallVec<[_; 8]>>();

        let targets = (descriptor.fragment.as_ref()).map_or(&[][..], |fragment| &fragment.targets);
        let blend_states = (targets.iter())
            .map(|target| self.blend_state(heap, target.as_ref()))
            .collect::<Result<'a, SmallVec<[_; 8]>>>()?;
        let targets = (targets.iter().zip(&blend_states))
            .map(|(target, blend)| {
                let Some(target) = target else {
                    return Ok(Default::default());
                };
                Ok(dawn::ColorTargetState {
                    next_in_chain: Chain::END,
                    format: self.texture_format(heap, target.format)?,
                    blend: blend.as_ref(),
                    write_mask: dawn::ColorWriteMask::from_bits(target.write_mask),
                })
            })
            .collect::<Result<'a, SmallVec<[_; 8]>>>()?;
        let fragment_constants =
            (descriptor.fragment.as_ref()).map_or_else(Vec::new, |fragment| constants(fragment));
        let fragment = (descriptor.fragment.as_ref()).map(|fragment| dawn::FragmentState {
            next_in_chain: Chain::END,
            module: &fragment.module.handle,
            entry_point: entry_point(fragment),
            constants: (*fragment_constants).into(),
            targets: (*targets).into(),
        });

        let depth_stencil = (descriptor.depth_stencil.as_ref())
            .map(|state| self.depth_stencil_state(heap, state))
            .transpose()?;

        let (primitive, multisample) = (&descriptor.primitive, &descriptor.multisample);
        Ok(f(&dawn::RenderPipelineDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
            layout: layout(descriptor),
            vertex: dawn::VertexState {
                next_in_chain: Chain::END,
                module: &vertex.module.handle,
                entry_point: entry_point(vertex),
                constants: (*constants(vertex)).into(),
                buffers: (*buffers).into(),
            },
            primitive: dawn::PrimitiveState {
                next_in_chain: Chain::END,
                topology: primitive.topology.into(),
                strip_index_format: (primitive.strip_index_format)
                    .map_or(dawn::IndexFormat::Undefined, Into::into),
                front_face: primitive.front_face.into(),
                cull_mode: primitive.cull_mode.into(),
                unclipped_depth: primitive.unclipped_depth.into(),
            },
            depth_stencil: depth_stencil.as_ref(),
            multisample: dawn::MultisampleState {
                next_in_chain: Chain::END,
                count: multisample.count,
                mask: multisample.mask,
                alpha_to_coverage_enabled: multisample.alpha_to_coverage_enabled.into(),
            },
            fragment: fragment.as_ref(),
        }))
    }
}
