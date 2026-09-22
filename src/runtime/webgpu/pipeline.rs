//! `GPUComputePipeline` and `GPURenderPipeline`.

use std::borrow::Cow;
use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::names;
use bun_webgpu::wgc::pipeline as pl;
use bun_webgpu::{GpuError, instance, wgc, wgt};

use super::args::{self, Dict, Held};
use super::device::DeviceRef;
use super::{GPUBindGroupLayout, GPUPipelineLayout, GPUShaderModule};

/// A pipeline that got no compile thread. The thread's stack is sized for how deep the shader source can nest, and a source that asks for too much gets no thread.
fn no_compile_thread() -> GpuError {
    GpuError::validation(String::from(
        "no thread could be created to compile the pipeline. Its stack is sized for how deep the shader source can nest, so the source may nest too deep",
    ))
}

/// A module wgpu-core rejects as invalid: a pipeline that names it fails before anything is compiled.
fn invalid_module(device: wgc::id::DeviceId) -> bun_webgpu::ShaderModule {
    let desc = pl::ShaderModuleDescriptor {
        label: None,
        runtime_checks: wgt::ShaderRuntimeChecks::checked(),
    };
    let source = pl::ShaderModuleSource::Wgsl(Cow::Borrowed("not compiled"));
    let (id, _) = instance().device_create_shader_module(device, &desc, source, None);
    bun_webgpu::ShaderModule::new(id)
}

/// `layout: GPUPipelineLayout | "auto"`.
fn parse_layout(d: &Dict<'_>, held: &mut Held) -> JsResult<Option<wgc::id::PipelineLayoutId>> {
    let value = d.require("layout")?;
    if let Some(layout) = held.try_id::<GPUPipelineLayout>(value) {
        return Ok(Some(layout));
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
fn parse_stage(
    d: &Dict<'_>,
    held: &mut Held,
    compile_stack: &mut usize,
) -> JsResult<pl::ProgrammableStageDescriptor<'static>> {
    let (module, stack) = held
        .try_read::<GPUShaderModule, _>(d.require("module")?, GPUShaderModule::compile_stack)
        .ok_or_else(|| {
            d.global.throw_type_error(format_args!(
                "{}.module: expected a GPUShaderModule",
                d.name
            ))
        })?;
    *compile_stack = (*compile_stack).max(stack);
    let entry_point = d.string("entryPoint")?.map(Cow::Owned);
    let mut constants = wgc::naga::back::PipelineConstants::default();
    if let Some(record) = d.get("constants")? {
        const WHAT: &str = "GPUProgrammableStage.constants";
        args::for_each_entry(d.global, record, WHAT, |name, value| {
            constants.insert(args::usv_string(name), args::to_f64(d.global, value, WHAT)?);
            Ok(true)
        })?;
    }
    Ok(pl::ProgrammableStageDescriptor {
        module,
        entry_point,
        constants,
        zero_initialize_workgroup_memory: true,
    })
}

#[bun_jsc::JsClass]
pub(crate) struct GPUComputePipeline {
    device: DeviceRef,
    raw: Rc<bun_webgpu::ComputePipeline>,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUComputePipeline, label);
super::resource!(GPUComputePipeline, bun_webgpu::ComputePipeline);

impl GPUComputePipeline {
    /// Returns the pipeline and its creation error: sync callers report it, async callers reject.
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<(JSValue, Option<GpuError>)> {
        let d = Dict::new(global, descriptor, "GPUComputePipelineDescriptor")?;
        let label = d.label()?;
        let mut held = Held::default();
        let mut compile_stack = 0;
        let mut desc = pl::ComputePipelineDescriptor {
            label: super::wgpu_label(&label),
            layout: parse_layout(&d, &mut held)?,
            stage: parse_stage(
                &d.require_dict("compute", "GPUProgrammableStage")?,
                &mut held,
                &mut compile_stack,
            )?,
            cache: None,
        };
        let device_id = device.id();
        let compiled = bun_webgpu::compile(compile_stack, || {
            instance().device_create_compute_pipeline(device_id, &desc, None)
        });
        let (id, err) = match compiled {
            Some((id, err)) => (id, err.map(|e| GpuError::from_wgpu(&e))),
            None => {
                let module = invalid_module(device_id);
                desc.stage.module = module.id();
                let (id, _) = instance().device_create_compute_pipeline(device_id, &desc, None);
                (id, Some(no_compile_thread()))
            }
        };
        // After the last call that names an id in `desc`.
        drop(held);
        let value = GPUComputePipeline {
            device: Rc::clone(device),
            raw: Rc::new(bun_webgpu::ComputePipeline::new(id)),
            label: JsCell::new(label),
        }
        .to_js(global);
        let set_device = crate::generated_classes::js_GPUComputePipeline::device_set_cached;
        Ok((device.adopt(global, value, set_device), err))
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
pub(crate) struct GPURenderPipeline {
    device: DeviceRef,
    raw: Rc<bun_webgpu::RenderPipeline>,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPURenderPipeline, label);
super::resource!(GPURenderPipeline, bun_webgpu::RenderPipeline);

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
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<(JSValue, Option<GpuError>)> {
        let d = Dict::new(global, descriptor, "GPURenderPipelineDescriptor")?;
        let label = d.label()?;
        let mut held = Held::default();
        let mut compile_stack = 0;
        let layout = parse_layout(&d, &mut held)?;

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
            stage: parse_stage(&vertex, &mut held, &mut compile_stack)?,
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

        let mut bad_write_mask: Option<u32> = None;
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
                    let write_mask = t.u32_or("writeMask", 0xF)?;
                    if write_mask > 0xF {
                        bad_write_mask = bad_write_mask.or(Some(write_mask));
                    }
                    targets.push(Some(wgt::ColorTargetState {
                        format,
                        blend,
                        write_mask: wgt::ColorWrites::from_bits_truncate(write_mask),
                    }));
                    Ok(())
                })?;
                Some(pl::FragmentState {
                    stage: parse_stage(&f, &mut held, &mut compile_stack)?,
                    targets: Cow::Owned(targets),
                })
            }
        };

        let mut desc = pl::RenderPipelineDescriptor {
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
        if bad_write_mask.is_some() {
            // wgpu-core hands out an invalid pipeline only from a failed creation: ask for no samples at all.
            desc.multisample.count = 0;
        }
        let device_id = device.id();
        let compiled = bun_webgpu::compile(compile_stack, || {
            instance().device_create_render_pipeline(device_id, &desc, None)
        });
        let (id, err) = match compiled {
            Some((id, err)) => (id, err.map(|e| GpuError::from_wgpu(&e))),
            None => {
                let module = invalid_module(device_id);
                desc.vertex.stage.module = module.id();
                desc.fragment = None;
                let (id, _) = instance().device_create_render_pipeline(device_id, &desc, None);
                (id, Some(no_compile_thread()))
            }
        };
        // After the last call that names an id in `desc`.
        drop(held);
        let value = GPURenderPipeline {
            device: Rc::clone(device),
            raw: Rc::new(bun_webgpu::RenderPipeline::new(id)),
            label: JsCell::new(label),
        }
        .to_js(global);
        let set_device = crate::generated_classes::js_GPURenderPipeline::device_set_cached;
        let value = device.adopt(global, value, set_device);
        let err = match bad_write_mask {
            Some(mask) => Some(GpuError::validation(format!(
                "createRenderPipeline: writeMask 0x{mask:x} has bits that are not a GPUColorWrite"
            ))),
            None => err,
        };
        Ok((value, err))
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
