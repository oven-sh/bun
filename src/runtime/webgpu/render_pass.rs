//! `GPURenderPassEncoder`, `GPURenderBundleEncoder`, `GPURenderBundle`.

use std::borrow::Cow;
use std::num::NonZeroU64;
use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::names;
use bun_webgpu::wgc::command as cmd;
use bun_webgpu::{instance, wgc, wgt};

use super::args::{self, Dict};
use super::bind::parse_set_bind_group;
use super::compute_pass::parse_timestamp_writes;
use super::device::DeviceRef;
use super::{GPUBuffer, GPUQuerySet, GPURenderPipeline, GPUTexture, GPUTextureView};

fn parse_load_op(s: &[u8]) -> Option<bool> {
    match s {
        b"load" => Some(false),
        b"clear" => Some(true),
        _ => None,
    }
}

fn parse_store_op(s: &[u8]) -> Option<wgt::StoreOp> {
    match s {
        b"store" => Some(wgt::StoreOp::Store),
        b"discard" => Some(wgt::StoreOp::Discard),
        _ => None,
    }
}

fn optional_u64(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<Option<u64>> {
    if v.is_undefined() {
        return Ok(None);
    }
    Ok(Some(args::to_u64(global, v, what)?))
}

fn u32_or(global: &JSGlobalObject, v: JSValue, what: &str, default: u32) -> JsResult<u32> {
    if v.is_undefined() {
        return Ok(default);
    }
    args::to_u32(global, v, what)
}

/// The render commands `GPURenderPassEncoder` and `GPURenderBundleEncoder`
/// share (`GPURenderCommandsMixin`, `GPUBindingCommandsMixin` and the label-only
/// half of `GPUDebugCommandsMixin`), over the wgpu-core functions named by the
/// `$set_pipeline`, ... arguments.
macro_rules! render_commands {
    ($ty:ident {
        set_pipeline: $set_pipeline:ident,
        set_bind_group: $set_bind_group:ident,
        set_index_buffer: $set_index_buffer:ident,
        set_vertex_buffer: $set_vertex_buffer:ident,
        draw: $draw:ident,
        draw_indexed: $draw_indexed:ident,
        draw_indirect: $draw_indirect:ident,
        draw_indexed_indirect: $draw_indexed_indirect:ident,
    }) => {
        impl $ty {
            pub(crate) fn set_pipeline(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let pipeline = args::to_class::<GPURenderPipeline>(
                    global,
                    callframe.argument(0),
                    "setPipeline",
                    "GPURenderPipeline",
                )?;
                let result = instance().$set_pipeline(self.raw.id(), pipeline.id());
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn set_bind_group(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let (index, bind_group, offsets) = parse_set_bind_group(global, callframe)?;
                let result = instance().$set_bind_group(self.raw.id(), index, bind_group, &offsets);
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn set_index_buffer(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let buffer = args::to_class::<GPUBuffer>(
                    global,
                    callframe.argument(0),
                    "setIndexBuffer",
                    "GPUBuffer",
                )?;
                let format = args::to_enum(
                    global,
                    callframe.argument(1),
                    "setIndexBuffer",
                    "GPUIndexFormat",
                    names::parse_index_format,
                )?;
                let offset = optional_u64(global, callframe.argument(2), "setIndexBuffer: offset")?
                    .unwrap_or(0);
                let size = optional_u64(global, callframe.argument(3), "setIndexBuffer: size")?;
                let result = instance().$set_index_buffer(
                    self.raw.id(),
                    buffer.id(),
                    format,
                    offset,
                    size.and_then(NonZeroU64::new),
                );
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn set_vertex_buffer(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let slot = args::to_u32(global, callframe.argument(0), "setVertexBuffer: slot")?;
                let buffer = match callframe.argument(1) {
                    v if v.is_undefined_or_null() => None,
                    v => Some(
                        args::to_class::<GPUBuffer>(global, v, "setVertexBuffer", "GPUBuffer")?
                            .id(),
                    ),
                };
                let offset =
                    optional_u64(global, callframe.argument(2), "setVertexBuffer: offset")?
                        .unwrap_or(0);
                let size = optional_u64(global, callframe.argument(3), "setVertexBuffer: size")?;
                let result = instance().$set_vertex_buffer(
                    self.raw.id(),
                    slot,
                    buffer,
                    offset,
                    size.and_then(NonZeroU64::new),
                );
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn draw(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let vertex_count =
                    args::to_u32(global, callframe.argument(0), "draw: vertexCount")?;
                let instance_count =
                    u32_or(global, callframe.argument(1), "draw: instanceCount", 1)?;
                let first_vertex = u32_or(global, callframe.argument(2), "draw: firstVertex", 0)?;
                let first_instance =
                    u32_or(global, callframe.argument(3), "draw: firstInstance", 0)?;
                let result = instance().$draw(
                    self.raw.id(),
                    vertex_count,
                    instance_count,
                    first_vertex,
                    first_instance,
                );
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn draw_indexed(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let index_count =
                    args::to_u32(global, callframe.argument(0), "drawIndexed: indexCount")?;
                let instance_count = u32_or(
                    global,
                    callframe.argument(1),
                    "drawIndexed: instanceCount",
                    1,
                )?;
                let first_index =
                    u32_or(global, callframe.argument(2), "drawIndexed: firstIndex", 0)?;
                let base_vertex = match callframe.argument(3) {
                    v if v.is_undefined() => 0,
                    v => args::to_i32(global, v, "drawIndexed: baseVertex")?,
                };
                let first_instance = u32_or(
                    global,
                    callframe.argument(4),
                    "drawIndexed: firstInstance",
                    0,
                )?;
                let result = instance().$draw_indexed(
                    self.raw.id(),
                    index_count,
                    instance_count,
                    first_index,
                    base_vertex,
                    first_instance,
                );
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn draw_indirect(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let buffer = args::to_class::<GPUBuffer>(
                    global,
                    callframe.argument(0),
                    "drawIndirect",
                    "GPUBuffer",
                )?;
                let offset = args::to_u64(
                    global,
                    callframe.argument(1),
                    "drawIndirect: indirectOffset",
                )?;
                let result = instance().$draw_indirect(self.raw.id(), buffer.id(), offset);
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }

            pub(crate) fn draw_indexed_indirect(
                &self,
                global: &JSGlobalObject,
                callframe: &CallFrame,
            ) -> JsResult<JSValue> {
                let buffer = args::to_class::<GPUBuffer>(
                    global,
                    callframe.argument(0),
                    "drawIndexedIndirect",
                    "GPUBuffer",
                )?;
                let offset = args::to_u64(
                    global,
                    callframe.argument(1),
                    "drawIndexedIndirect: indirectOffset",
                )?;
                let result = instance().$draw_indexed_indirect(self.raw.id(), buffer.id(), offset);
                self.device.check_result(global, result)?;
                Ok(JSValue::UNDEFINED)
            }
        }
    };
}

#[bun_jsc::JsClass]
pub struct GPURenderPassEncoder {
    device: DeviceRef,
    raw: bun_webgpu::RenderPassEncoder,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPURenderPassEncoder, label);

render_commands!(GPURenderPassEncoder {
    set_pipeline: render_pass_set_pipeline_with_id,
    set_bind_group: render_pass_set_bind_group_with_id,
    set_index_buffer: render_pass_set_index_buffer_with_id,
    set_vertex_buffer: render_pass_set_vertex_buffer_with_id,
    draw: render_pass_draw_with_id,
    draw_indexed: render_pass_draw_indexed_with_id,
    draw_indirect: render_pass_draw_indirect_with_id,
    draw_indexed_indirect: render_pass_draw_indexed_indirect_with_id,
});

/// `view: GPUTextureView | GPUTexture`. A texture stands for its default view,
/// which is created here and parked in `implicit` until the pass has begun.
fn attachment_view(
    global: &JSGlobalObject,
    device: &DeviceRef,
    value: JSValue,
    what: &str,
    implicit: &mut Vec<bun_webgpu::TextureView>,
) -> JsResult<wgc::id::TextureViewId> {
    if let Some(view) = value.as_class_ref::<GPUTextureView>() {
        return Ok(view.id());
    }
    if let Some(texture) = value.as_class_ref::<GPUTexture>() {
        let desc = wgc::resource::TextureViewDescriptor::default();
        let (id, err) = instance().texture_create_view(texture.id(), &desc, None);
        implicit.push(bun_webgpu::TextureView::new(id));
        device.check(global, err)?;
        return Ok(id);
    }
    Err(global.throw_type_error(format_args!(
        "{what}: expected a GPUTextureView or a GPUTexture"
    )))
}

impl GPURenderPassEncoder {
    pub(crate) fn begin(
        global: &JSGlobalObject,
        device: &DeviceRef,
        encoder: wgc::id::CommandEncoderId,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::required(global, descriptor, "GPURenderPassDescriptor")?;
        let label = d.label()?;
        let mut implicit_views = Vec::new();

        let mut color_attachments = Vec::new();
        d.require_each("colorAttachments", |item| {
            if item.is_undefined_or_null() {
                color_attachments.push(None);
                return Ok(());
            }
            let a = Dict::required(global, item, "GPURenderPassColorAttachment")?;
            let view = attachment_view(
                global,
                device,
                a.require("view")?,
                "GPURenderPassColorAttachment.view",
                &mut implicit_views,
            )?;
            let resolve_target = match a.get("resolveTarget")? {
                Some(v) => Some(attachment_view(
                    global,
                    device,
                    v,
                    "GPURenderPassColorAttachment.resolveTarget",
                    &mut implicit_views,
                )?),
                None => None,
            };
            let clear_value = match a.get("clearValue")? {
                Some(v) => args::to_color(global, v, "GPURenderPassColorAttachment.clearValue")?,
                None => wgt::Color::TRANSPARENT,
            };
            let clear = a.require_enum("loadOp", "GPULoadOp", parse_load_op)?;
            color_attachments.push(Some(cmd::RenderPassColorAttachment {
                view,
                depth_slice: a.u32("depthSlice")?,
                resolve_target,
                load_op: if clear {
                    wgt::LoadOp::Clear(clear_value)
                } else {
                    wgt::LoadOp::Load
                },
                store_op: a.require_enum("storeOp", "GPUStoreOp", parse_store_op)?,
            }));
            Ok(())
        })?;

        let depth_stencil_attachment = match d.dict(
            "depthStencilAttachment",
            "GPURenderPassDepthStencilAttachment",
        )? {
            None => None,
            Some(a) => {
                let view = attachment_view(
                    global,
                    device,
                    a.require("view")?,
                    "GPURenderPassDepthStencilAttachment.view",
                    &mut implicit_views,
                )?;
                let depth_clear = match a.get("depthClearValue")? {
                    Some(v) => Some(args::to_f32(
                        global,
                        v,
                        "GPURenderPassDepthStencilAttachment.depthClearValue",
                    )?),
                    None => None,
                };
                let stencil_clear = a.u32_or("stencilClearValue", 0)?;
                let depth_load = a.enum_("depthLoadOp", "GPULoadOp", parse_load_op)?;
                let stencil_load = a.enum_("stencilLoadOp", "GPULoadOp", parse_load_op)?;
                Some(cmd::RenderPassDepthStencilAttachment {
                    view,
                    depth: cmd::PassChannel {
                        load_op: depth_load.map(|clear| {
                            if clear {
                                wgt::LoadOp::Clear(depth_clear)
                            } else {
                                wgt::LoadOp::Load
                            }
                        }),
                        store_op: a.enum_("depthStoreOp", "GPUStoreOp", parse_store_op)?,
                        read_only: a.bool_or("depthReadOnly", false)?,
                    },
                    stencil: cmd::PassChannel {
                        load_op: stencil_load.map(|clear| {
                            if clear {
                                wgt::LoadOp::Clear(Some(stencil_clear))
                            } else {
                                wgt::LoadOp::Load
                            }
                        }),
                        store_op: a.enum_("stencilStoreOp", "GPUStoreOp", parse_store_op)?,
                        read_only: a.bool_or("stencilReadOnly", false)?,
                    },
                })
            }
        };

        let occlusion_query_set = match d.get("occlusionQuerySet")? {
            Some(v) => Some(
                args::to_class::<GPUQuerySet>(
                    global,
                    v,
                    "GPURenderPassDescriptor.occlusionQuerySet",
                    "GPUQuerySet",
                )?
                .id(),
            ),
            None => None,
        };

        let desc = cmd::RenderPassDescriptor {
            label: super::wgpu_label(&label),
            color_attachments: Cow::Owned(color_attachments),
            depth_stencil_attachment,
            timestamp_writes: parse_timestamp_writes(&d, "GPURenderPassTimestampWrites")?,
            occlusion_query_set,
            multiview_mask: None,
        };
        let (id, err) = instance().command_encoder_begin_render_pass_with_id(encoder, &desc, None);
        let raw = bun_webgpu::RenderPassEncoder::new(id);
        drop(implicit_views);
        device.check(global, err)?;
        Ok(GPURenderPassEncoder {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }

    pub(crate) fn set_viewport(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const NAMES: [&str; 6] = [
            "setViewport: x",
            "setViewport: y",
            "setViewport: width",
            "setViewport: height",
            "setViewport: minDepth",
            "setViewport: maxDepth",
        ];
        let mut v = [0f32; 6];
        for (i, slot) in v.iter_mut().enumerate() {
            *slot = args::to_f32(global, callframe.argument(i), NAMES[i])?;
        }
        let result = instance().render_pass_set_viewport_with_id(
            self.raw.id(),
            v[0],
            v[1],
            v[2],
            v[3],
            v[4],
            v[5],
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn set_scissor_rect(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const NAMES: [&str; 4] = [
            "setScissorRect: x",
            "setScissorRect: y",
            "setScissorRect: width",
            "setScissorRect: height",
        ];
        let mut v = [0u32; 4];
        for (i, slot) in v.iter_mut().enumerate() {
            *slot = args::to_u32(global, callframe.argument(i), NAMES[i])?;
        }
        let result =
            instance().render_pass_set_scissor_rect_with_id(self.raw.id(), v[0], v[1], v[2], v[3]);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn set_blend_constant(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let color = args::to_color(global, callframe.argument(0), "setBlendConstant: color")?;
        let result = instance().render_pass_set_blend_constant_with_id(self.raw.id(), color);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn set_stencil_reference(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let reference = args::to_u32(
            global,
            callframe.argument(0),
            "setStencilReference: reference",
        )?;
        let result = instance().render_pass_set_stencil_reference_with_id(self.raw.id(), reference);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn begin_occlusion_query(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let index = args::to_u32(
            global,
            callframe.argument(0),
            "beginOcclusionQuery: queryIndex",
        )?;
        let result = instance().render_pass_begin_occlusion_query_with_id(self.raw.id(), index);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn end_occlusion_query(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = instance().render_pass_end_occlusion_query_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn execute_bundles(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut bundles = Vec::new();
        args::for_each(global, callframe.argument(0), "executeBundles", |item| {
            bundles.push(
                args::to_class::<GPURenderBundle>(
                    global,
                    item,
                    "executeBundles",
                    "GPURenderBundle",
                )?
                .raw
                .id(),
            );
            Ok(())
        })?;
        let result = instance().render_pass_execute_bundles_with_id(self.raw.id(), &bundles);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn push_debug_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().render_pass_push_debug_group_with_id(self.raw.id(), &label, 0);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn pop_debug_group(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = instance().render_pass_pop_debug_group_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn insert_debug_marker(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().render_pass_insert_debug_marker_with_id(self.raw.id(), &label, 0);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn end(&self, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        let result = instance().render_pass_end_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }
}

#[bun_jsc::JsClass]
pub struct GPURenderBundleEncoder {
    device: DeviceRef,
    raw: bun_webgpu::RenderBundleEncoder,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPURenderBundleEncoder, label);

render_commands!(GPURenderBundleEncoder {
    set_pipeline: render_bundle_encoder_set_pipeline_with_id,
    set_bind_group: render_bundle_encoder_set_bind_group_with_id,
    set_index_buffer: render_bundle_encoder_set_index_buffer_with_id,
    set_vertex_buffer: render_bundle_encoder_set_vertex_buffer_with_id,
    draw: render_bundle_encoder_draw_with_id,
    draw_indexed: render_bundle_encoder_draw_indexed_with_id,
    draw_indirect: render_bundle_encoder_draw_indirect_with_id,
    draw_indexed_indirect: render_bundle_encoder_draw_indexed_indirect_with_id,
});

impl GPURenderBundleEncoder {
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::required(global, descriptor, "GPURenderBundleEncoderDescriptor")?;
        let label = d.label()?;
        let mut color_formats = Vec::new();
        d.require_each("colorFormats", |item| {
            if item.is_undefined_or_null() {
                color_formats.push(None);
            } else {
                color_formats.push(Some(args::to_enum(
                    global,
                    item,
                    "GPURenderBundleEncoderDescriptor.colorFormats",
                    "GPUTextureFormat",
                    names::parse_texture_format,
                )?));
            }
            Ok(())
        })?;
        let depth_stencil = match d.enum_(
            "depthStencilFormat",
            "GPUTextureFormat",
            names::parse_texture_format,
        )? {
            Some(format) => Some(wgt::RenderBundleDepthStencil {
                format,
                depth_read_only: d.bool_or("depthReadOnly", false)?,
                stencil_read_only: d.bool_or("stencilReadOnly", false)?,
            }),
            None => None,
        };
        let desc = cmd::RenderBundleEncoderDescriptor {
            label: super::wgpu_label(&label),
            color_formats: Cow::Owned(color_formats),
            depth_stencil,
            sample_count: d.u32_or("sampleCount", 1)?,
            multiview: None,
        };
        let (id, err) =
            instance().device_create_render_bundle_encoder_with_id(device.id(), &desc, None);
        let raw = bun_webgpu::RenderBundleEncoder::new(id);
        device.check(global, err)?;
        Ok(GPURenderBundleEncoder {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }

    pub(crate) fn push_debug_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result =
            instance().render_bundle_encoder_push_debug_group_with_id(self.raw.id(), &label);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn pop_debug_group(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = instance().render_bundle_encoder_pop_debug_group_with_id(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn insert_debug_marker(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result =
            instance().render_bundle_encoder_insert_debug_marker_with_id(self.raw.id(), &label);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn finish(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, callframe.argument(0), "GPURenderBundleDescriptor")?;
        let label = d.label()?;
        let desc = wgt::RenderBundleDescriptor {
            label: super::wgpu_label(&label),
        };
        let (id, err) = instance().render_bundle_encoder_finish_with_id(self.raw.id(), &desc, None);
        let raw = bun_webgpu::RenderBundle::new(id);
        self.device.check(global, err)?;
        Ok(GPURenderBundle {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

#[bun_jsc::JsClass]
pub struct GPURenderBundle {
    raw: bun_webgpu::RenderBundle,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPURenderBundle, label);
