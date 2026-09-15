//! `GPUComputePipeline` and `GPURenderPipeline`.

use std::borrow::Cow;
use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::names;
use bun_webgpu::wgc::pipeline as pl;
use bun_webgpu::{GpuError, instance, wgc, wgt};

use super::args::{self, Dict};
use super::device::DeviceRef;
use super::{GPUBindGroupLayout, GPUPipelineLayout, GPUShaderModule};

/// `layout: GPUPipelineLayout | "auto"`.
fn parse_layout(d: &Dict<'_>) -> JsResult<Option<wgc::id::PipelineLayoutId>> {
    let value = d.require("layout")?;
    if let Some(layout) = value.as_class_ref::<GPUPipelineLayout>() {
        return Ok(Some(layout.id()));
    }
    if value.is_string() && args::to_utf8(d.global, value)?.as_ref() == b"auto" {
        return Ok(None);
    }
    Err(d.global.throw_type_error(format_args!(
        "{}.layout: expected a GPUPipelineLayout or \"auto\"",
        d.name
    )))
}

/// `GPUProgrammableStage`.
fn parse_stage(d: &Dict<'_>) -> JsResult<pl::ProgrammableStageDescriptor<'static>> {
    let module = d
        .require_class::<GPUShaderModule>("module", "GPUShaderModule")?
        .id();
    let entry_point = d.string("entryPoint")?.map(Cow::Owned);
    let mut constants = wgc::naga::back::PipelineConstants::default();
    if let Some(record) = d.get("constants")? {
        if !record.is_object() {
            return Err(d
                .global
                .throw_type_error(format_args!("{}.constants: expected an object", d.name)));
        }
        let keys = record.keys(d.global)?;
        let mut iter = keys.array_iterator(d.global)?;
        while let Some(key) = iter.next()? {
            let name = args::to_string(d.global, key)?;
            let Some(value) = record.get(d.global, name.as_bytes())? else {
                continue;
            };
            // `double`, unrestricted: NaN and the infinities get to naga, which rejects them.
            constants.insert(name, value.to_number(d.global)?);
        }
    }
    Ok(pl::ProgrammableStageDescriptor {
        module,
        entry_point,
        constants,
        zero_initialize_workgroup_memory: true,
    })
}

#[bun_jsc::JsClass]
pub struct GPUComputePipeline {
    device: DeviceRef,
    raw: bun_webgpu::ComputePipeline,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUComputePipeline, label);

impl GPUComputePipeline {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::ComputePipelineId {
        self.raw.id()
    }

    /// Returns the pipeline and the creation error, if any: the sync entry
    /// point reports it to the device, the async one rejects with it.
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<(JSValue, Option<GpuError>)> {
        let d = Dict::new(global, descriptor, "GPUComputePipelineDescriptor")?;
        let label = d.label()?;
        let desc = pl::ComputePipelineDescriptor {
            label: super::wgpu_label(&label),
            layout: parse_layout(&d)?,
            stage: parse_stage(&d.require_dict("compute", "GPUProgrammableStage")?)?,
            cache: None,
        };
        let (id, err) = instance().device_create_compute_pipeline(device.id(), &desc, None);
        let value = GPUComputePipeline {
            device: Rc::clone(device),
            raw: bun_webgpu::ComputePipeline::new(id),
            label: JsCell::new(label),
        }
        .to_js(global);
        Ok((value, err.map(|e| GpuError::from_wgpu(&e))))
    }

    pub(crate) fn get_bind_group_layout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let index = args::to_u32(global, callframe.argument(0), "getBindGroupLayout: index")?;
        let (id, err) =
            instance().compute_pipeline_get_bind_group_layout(self.raw.id(), index, None);
        let layout = bun_webgpu::BindGroupLayout::new(id);
        self.device.check(global, err)?;
        Ok(GPUBindGroupLayout::wrap(global, layout))
    }
}

#[bun_jsc::JsClass]
pub struct GPURenderPipeline {
    device: DeviceRef,
    raw: bun_webgpu::RenderPipeline,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPURenderPipeline, label);

fn parse_stencil_face(d: Option<Dict<'_>>) -> JsResult<wgt::StencilFaceState> {
    let Some(d) = d else {
        return Ok(wgt::StencilFaceState::IGNORE);
    };
    let op = |key: &'static str| {
        d.enum_or(
            key,
            "GPUStencilOperation",
            names::parse_stencil_operation,
            wgt::StencilOperation::Keep,
        )
    };
    Ok(wgt::StencilFaceState {
        compare: d.enum_or(
            "compare",
            "GPUCompareFunction",
            names::parse_compare_function,
            wgt::CompareFunction::Always,
        )?,
        fail_op: op("failOp")?,
        depth_fail_op: op("depthFailOp")?,
        pass_op: op("passOp")?,
    })
}

fn parse_blend_component(d: &Dict<'_>) -> JsResult<wgt::BlendComponent> {
    Ok(wgt::BlendComponent {
        operation: d.enum_or(
            "operation",
            "GPUBlendOperation",
            names::parse_blend_operation,
            wgt::BlendOperation::Add,
        )?,
        src_factor: d.enum_or(
            "srcFactor",
            "GPUBlendFactor",
            names::parse_blend_factor,
            wgt::BlendFactor::One,
        )?,
        dst_factor: d.enum_or(
            "dstFactor",
            "GPUBlendFactor",
            names::parse_blend_factor,
            wgt::BlendFactor::Zero,
        )?,
    })
}

/// `GPUDepthStencilState`.
pub(crate) fn parse_depth_stencil(d: &Dict<'_>) -> JsResult<wgt::DepthStencilState> {
    Ok(wgt::DepthStencilState {
        format: d.require_enum("format", "GPUTextureFormat", names::parse_texture_format)?,
        depth_write_enabled: d.get("depthWriteEnabled")?.map(JSValue::to_boolean),
        depth_compare: d.enum_(
            "depthCompare",
            "GPUCompareFunction",
            names::parse_compare_function,
        )?,
        stencil: wgt::StencilState {
            front: parse_stencil_face(d.dict("stencilFront", "GPUStencilFaceState")?)?,
            back: parse_stencil_face(d.dict("stencilBack", "GPUStencilFaceState")?)?,
            read_mask: d.u32_or("stencilReadMask", u32::MAX)?,
            write_mask: d.u32_or("stencilWriteMask", u32::MAX)?,
        },
        bias: wgt::DepthBiasState {
            constant: d.i32_or("depthBias", 0)?,
            slope_scale: d.f32_or("depthBiasSlopeScale", 0.0)?,
            clamp: d.f32_or("depthBiasClamp", 0.0)?,
        },
    })
}

impl GPURenderPipeline {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::RenderPipelineId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<(JSValue, Option<GpuError>)> {
        let d = Dict::new(global, descriptor, "GPURenderPipelineDescriptor")?;
        let label = d.label()?;
        let layout = parse_layout(&d)?;

        let vertex = d.require_dict("vertex", "GPUVertexState")?;
        let mut buffers = Vec::new();
        vertex.each("buffers", |item| {
            if item.is_undefined_or_null() {
                buffers.push(None);
                return Ok(());
            }
            let b = Dict::new(global, item, "GPUVertexBufferLayout")?;
            let mut attributes = Vec::new();
            b.require_each("attributes", |item| {
                let a = Dict::new(global, item, "GPUVertexAttribute")?;
                attributes.push(wgt::VertexAttribute {
                    format: a.require_enum(
                        "format",
                        "GPUVertexFormat",
                        names::parse_vertex_format,
                    )?,
                    offset: a.require_u64("offset")?,
                    shader_location: a.require_u32("shaderLocation")?,
                });
                Ok(())
            })?;
            buffers.push(Some(pl::VertexBufferLayout {
                array_stride: b.require_u64("arrayStride")?,
                step_mode: b.enum_or(
                    "stepMode",
                    "GPUVertexStepMode",
                    names::parse_vertex_step_mode,
                    wgt::VertexStepMode::Vertex,
                )?,
                attributes: Cow::Owned(attributes),
            }));
            Ok(())
        })?;
        let vertex = pl::VertexState {
            stage: parse_stage(&vertex)?,
            buffers: Cow::Owned(buffers),
        };

        let primitive = match d.dict("primitive", "GPUPrimitiveState")? {
            None => wgt::PrimitiveState::default(),
            Some(p) => wgt::PrimitiveState {
                topology: p.enum_or(
                    "topology",
                    "GPUPrimitiveTopology",
                    names::parse_primitive_topology,
                    wgt::PrimitiveTopology::TriangleList,
                )?,
                strip_index_format: p.enum_(
                    "stripIndexFormat",
                    "GPUIndexFormat",
                    names::parse_index_format,
                )?,
                front_face: p.enum_or(
                    "frontFace",
                    "GPUFrontFace",
                    names::parse_front_face,
                    wgt::FrontFace::Ccw,
                )?,
                cull_mode: p.enum_or("cullMode", "GPUCullMode", names::parse_cull_mode, None)?,
                unclipped_depth: p.bool_or("unclippedDepth", false)?,
                polygon_mode: wgt::PolygonMode::Fill,
                conservative: false,
            },
        };

        let depth_stencil = match d.dict("depthStencil", "GPUDepthStencilState")? {
            None => None,
            Some(ds) => {
                let state = parse_depth_stencil(&ds)?;
                device.check_format(global, state.format, "createRenderPipeline: depthStencil")?;
                Some(state)
            }
        };

        let multisample = match d.dict("multisample", "GPUMultisampleState")? {
            None => wgt::MultisampleState::default(),
            Some(m) => wgt::MultisampleState {
                count: m.u32_or("count", 1)?,
                mask: u64::from(m.u32_or("mask", u32::MAX)?),
                alpha_to_coverage_enabled: m.bool_or("alphaToCoverageEnabled", false)?,
            },
        };

        let fragment = match d.dict("fragment", "GPUFragmentState")? {
            None => None,
            Some(f) => {
                let mut targets = Vec::new();
                f.require_each("targets", |item| {
                    if item.is_undefined_or_null() {
                        targets.push(None);
                        return Ok(());
                    }
                    let t = Dict::new(global, item, "GPUColorTargetState")?;
                    let blend = match t.dict("blend", "GPUBlendState")? {
                        None => None,
                        Some(b) => Some(wgt::BlendState {
                            color: parse_blend_component(
                                &b.require_dict("color", "GPUBlendComponent")?,
                            )?,
                            alpha: parse_blend_component(
                                &b.require_dict("alpha", "GPUBlendComponent")?,
                            )?,
                        }),
                    };
                    let format =
                        t.require_enum("format", "GPUTextureFormat", names::parse_texture_format)?;
                    device.check_format(global, format, "createRenderPipeline: targets")?;
                    targets.push(Some(wgt::ColorTargetState {
                        format,
                        blend,
                        write_mask: wgt::ColorWrites::from_bits_truncate(
                            t.u32_or("writeMask", 0xF)?,
                        ),
                    }));
                    Ok(())
                })?;
                Some(pl::FragmentState {
                    stage: parse_stage(&f)?,
                    targets: Cow::Owned(targets),
                })
            }
        };

        let desc = pl::RenderPipelineDescriptor {
            label: super::wgpu_label(&label),
            layout,
            vertex,
            primitive,
            depth_stencil,
            multisample,
            fragment,
            multiview_mask: None,
            cache: None,
        };
        let (id, err) = instance().device_create_render_pipeline(device.id(), &desc, None);
        let value = GPURenderPipeline {
            device: Rc::clone(device),
            raw: bun_webgpu::RenderPipeline::new(id),
            label: JsCell::new(label),
        }
        .to_js(global);
        Ok((value, err.map(|e| GpuError::from_wgpu(&e))))
    }

    pub(crate) fn get_bind_group_layout(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let index = args::to_u32(global, callframe.argument(0), "getBindGroupLayout: index")?;
        let (id, err) =
            instance().render_pipeline_get_bind_group_layout(self.raw.id(), index, None);
        let layout = bun_webgpu::BindGroupLayout::new(id);
        self.device.check(global, err)?;
        Ok(GPUBindGroupLayout::wrap(global, layout))
    }
}
