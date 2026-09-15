//! `GPUCommandEncoder` and `GPUCommandBuffer`.

use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::{GpuError, instance, wgc, wgt};

use super::args::{self, Dict};
use super::device::DeviceRef;
use super::texture::{parse_texel_copy_buffer_info, parse_texel_copy_texture_info};
use super::{GPUBuffer, GPUComputePassEncoder, GPUQuerySet, GPURenderPassEncoder};

#[bun_jsc::JsClass]
pub struct GPUCommandEncoder {
    device: DeviceRef,
    raw: bun_webgpu::CommandEncoder,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUCommandEncoder, label);

fn optional_u64(global: &JSGlobalObject, v: JSValue, what: &str) -> JsResult<Option<u64>> {
    if v.is_undefined() {
        return Ok(None);
    }
    Ok(Some(args::to_u64(global, v, what)?))
}

impl GPUCommandEncoder {
    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUCommandEncoderDescriptor")?;
        let label = d.label()?;
        let desc = wgt::CommandEncoderDescriptor {
            label: super::wgpu_label(&label),
        };
        let (id, err) = instance().device_create_command_encoder(device.id(), &desc, None);
        let raw = bun_webgpu::CommandEncoder::new(id);
        device.check(global, err)?;
        Ok(GPUCommandEncoder {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }

    pub(crate) fn begin_compute_pass(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPUComputePassEncoder::begin(global, &self.device, self.raw.id(), callframe.argument(0))
    }

    pub(crate) fn begin_render_pass(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        GPURenderPassEncoder::begin(global, &self.device, self.raw.id(), callframe.argument(0))
    }

    /// `copyBufferToBuffer(src, dst, size?)` or `(src, srcOffset, dst, dstOffset, size?)`.
    pub(crate) fn copy_buffer_to_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const WHAT: &str = "copyBufferToBuffer";
        let source = args::to_class::<GPUBuffer>(global, callframe.argument(0), WHAT, "GPUBuffer")?;
        let (source_offset, destination, destination_offset, size) =
            if let Some(destination) = callframe.argument(1).as_class_ref::<GPUBuffer>() {
                (
                    0,
                    destination,
                    0,
                    optional_u64(global, callframe.argument(2), "copyBufferToBuffer: size")?,
                )
            } else {
                (
                    args::to_u64(
                        global,
                        callframe.argument(1),
                        "copyBufferToBuffer: sourceOffset",
                    )?,
                    args::to_class::<GPUBuffer>(global, callframe.argument(2), WHAT, "GPUBuffer")?,
                    args::to_u64(
                        global,
                        callframe.argument(3),
                        "copyBufferToBuffer: destinationOffset",
                    )?,
                    optional_u64(global, callframe.argument(4), "copyBufferToBuffer: size")?,
                )
            };
        let result = instance().command_encoder_copy_buffer_to_buffer(
            self.raw.id(),
            source.id(),
            source_offset,
            destination.id(),
            destination_offset,
            size,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn copy_buffer_to_texture(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let source = parse_texel_copy_buffer_info(global, callframe.argument(0))?;
        let destination = parse_texel_copy_texture_info(
            global,
            callframe.argument(1),
            "copyBufferToTexture: destination",
        )?;
        let size = args::to_extent3d(
            global,
            callframe.argument(2),
            "copyBufferToTexture: copySize",
        )?;
        let result = instance().command_encoder_copy_buffer_to_texture(
            self.raw.id(),
            &source,
            &destination,
            &size,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn copy_texture_to_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let source = parse_texel_copy_texture_info(
            global,
            callframe.argument(0),
            "copyTextureToBuffer: source",
        )?;
        let destination = parse_texel_copy_buffer_info(global, callframe.argument(1))?;
        let size = args::to_extent3d(
            global,
            callframe.argument(2),
            "copyTextureToBuffer: copySize",
        )?;
        let result = instance().command_encoder_copy_texture_to_buffer(
            self.raw.id(),
            &source,
            &destination,
            &size,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn copy_texture_to_texture(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let source = parse_texel_copy_texture_info(
            global,
            callframe.argument(0),
            "copyTextureToTexture: source",
        )?;
        let destination = parse_texel_copy_texture_info(
            global,
            callframe.argument(1),
            "copyTextureToTexture: destination",
        )?;
        let size = args::to_extent3d(
            global,
            callframe.argument(2),
            "copyTextureToTexture: copySize",
        )?;
        let result = instance().command_encoder_copy_texture_to_texture(
            self.raw.id(),
            &source,
            &destination,
            &size,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn clear_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let buffer =
            args::to_class::<GPUBuffer>(global, callframe.argument(0), "clearBuffer", "GPUBuffer")?;
        let offset =
            optional_u64(global, callframe.argument(1), "clearBuffer: offset")?.unwrap_or(0);
        let size = optional_u64(global, callframe.argument(2), "clearBuffer: size")?;
        let result =
            instance().command_encoder_clear_buffer(self.raw.id(), buffer.id(), offset, size);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn resolve_query_set(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const WHAT: &str = "resolveQuerySet";
        let query_set =
            args::to_class::<GPUQuerySet>(global, callframe.argument(0), WHAT, "GPUQuerySet")?;
        let first_query =
            args::to_u32(global, callframe.argument(1), "resolveQuerySet: firstQuery")?;
        let query_count =
            args::to_u32(global, callframe.argument(2), "resolveQuerySet: queryCount")?;
        let destination =
            args::to_class::<GPUBuffer>(global, callframe.argument(3), WHAT, "GPUBuffer")?;
        let destination_offset = args::to_u64(
            global,
            callframe.argument(4),
            "resolveQuerySet: destinationOffset",
        )?;
        let result = instance().command_encoder_resolve_query_set(
            self.raw.id(),
            query_set.id(),
            first_query,
            query_count,
            destination.id(),
            destination_offset,
        );
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn push_debug_group(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().command_encoder_push_debug_group(self.raw.id(), &label);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn pop_debug_group(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = instance().command_encoder_pop_debug_group(self.raw.id());
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn insert_debug_marker(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let label = args::to_string(global, callframe.argument(0))?;
        let result = instance().command_encoder_insert_debug_marker(self.raw.id(), &label);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn finish(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, callframe.argument(0), "GPUCommandBufferDescriptor")?;
        let label = d.label()?;
        let desc = wgt::CommandBufferDescriptor {
            label: super::wgpu_label(&label),
        };
        let (id, err) = instance().command_encoder_finish(self.raw.id(), &desc, None);
        let raw = bun_webgpu::CommandBuffer::new(id);
        if let Some((_, err)) = err {
            self.device.report(global, GpuError::from_wgpu(&err))?;
        }
        Ok(GPUCommandBuffer {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

#[bun_jsc::JsClass]
pub struct GPUCommandBuffer {
    raw: bun_webgpu::CommandBuffer,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUCommandBuffer, label);

impl GPUCommandBuffer {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::CommandBufferId {
        self.raw.id()
    }
}
