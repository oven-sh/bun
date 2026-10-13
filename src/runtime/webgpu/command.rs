//! `GPUCommandEncoder` and `GPUCommandBuffer`.

use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::{GpuError, instance, wgt};

use super::args::{self, Dict, Held};
use super::device::DeviceRef;
use super::texture::{parse_texel_copy_buffer_info, parse_texel_copy_texture_info};
use super::{GPUBuffer, GPUComputePassEncoder, GPUQuerySet, GPURenderPassEncoder};

#[bun_jsc::JsClass]
pub(crate) struct GPUCommandEncoder {
    device: DeviceRef,
    raw: bun_webgpu::CommandEncoder,
    label: JsCell<bun_core::String>,
    /// A pass descriptor error found here and not by wgpu-core. `finish()` reports it in place of wgpu-core's.
    invalid: JsCell<Option<String>>,
}

super::gpu_object!(GPUCommandEncoder, label);

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
        let encoder = GPUCommandEncoder {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
            invalid: JsCell::new(None),
        }
        .to_js(global);
        Ok(device.adopt(
            global,
            encoder,
            crate::generated_classes::js_GPUCommandEncoder::device_set_cached,
        ))
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
        let (pass, invalid) = GPURenderPassEncoder::begin(
            global,
            &self.device,
            self.raw.id(),
            callframe.argument(0),
        )?;
        if let Some(message) = invalid {
            self.invalid
                .with_mut(|first| first.get_or_insert(message).len());
        }
        Ok(pass)
    }

    /// `copyBufferToBuffer(src, dst, size?)` or `(src, srcOffset, dst, dstOffset, size?)`.
    pub(crate) fn copy_buffer_to_buffer(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const WHAT: &str = "copyBufferToBuffer";
        let mut held = Held::default();
        let source = held.id::<GPUBuffer>(global, callframe.argument(0), WHAT, "GPUBuffer")?;
        // WebIDL picks the overload by argument count, so a call that mixes the two forms is a TypeError.
        let (source_offset, destination, destination_offset, size) =
            if callframe.arguments_count() <= 3 {
                (
                    0,
                    held.id::<GPUBuffer>(global, callframe.argument(1), WHAT, "GPUBuffer")?,
                    0,
                    args::optional_u64(global, callframe.argument(2), "copyBufferToBuffer: size")?,
                )
            } else {
                (
                    args::to_u64(
                        global,
                        callframe.argument(1),
                        "copyBufferToBuffer: sourceOffset",
                    )?,
                    held.id::<GPUBuffer>(global, callframe.argument(2), WHAT, "GPUBuffer")?,
                    args::to_u64(
                        global,
                        callframe.argument(3),
                        "copyBufferToBuffer: destinationOffset",
                    )?,
                    args::optional_u64(global, callframe.argument(4), "copyBufferToBuffer: size")?,
                )
            };
        let result = instance().command_encoder_copy_buffer_to_buffer(
            self.raw.id(),
            source,
            source_offset,
            destination,
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
        let mut held = Held::default();
        let source = parse_texel_copy_buffer_info(global, callframe.argument(0), &mut held)?;
        let destination = parse_texel_copy_texture_info(
            global,
            callframe.argument(1),
            "copyBufferToTexture: destination",
            &mut held,
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
        let mut held = Held::default();
        let source = parse_texel_copy_texture_info(
            global,
            callframe.argument(0),
            "copyTextureToBuffer: source",
            &mut held,
        )?;
        let destination = parse_texel_copy_buffer_info(global, callframe.argument(1), &mut held)?;
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
        let mut held = Held::default();
        let source = parse_texel_copy_texture_info(
            global,
            callframe.argument(0),
            "copyTextureToTexture: source",
            &mut held,
        )?;
        let destination = parse_texel_copy_texture_info(
            global,
            callframe.argument(1),
            "copyTextureToTexture: destination",
            &mut held,
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
        let mut held = Held::default();
        let buffer =
            held.id::<GPUBuffer>(global, callframe.argument(0), "clearBuffer", "GPUBuffer")?;
        let offset =
            args::optional_u64(global, callframe.argument(1), "clearBuffer: offset")?.unwrap_or(0);
        let size = args::optional_u64(global, callframe.argument(2), "clearBuffer: size")?;
        let result = instance().command_encoder_clear_buffer(self.raw.id(), buffer, offset, size);
        self.device.check_result(global, result)?;
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn resolve_query_set(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        const WHAT: &str = "resolveQuerySet";
        let mut held = Held::default();
        let query_set =
            held.id::<GPUQuerySet>(global, callframe.argument(0), WHAT, "GPUQuerySet")?;
        let first_query =
            args::to_u32(global, callframe.argument(1), "resolveQuerySet: firstQuery")?;
        let query_count =
            args::to_u32(global, callframe.argument(2), "resolveQuerySet: queryCount")?;
        let destination = held.id::<GPUBuffer>(global, callframe.argument(3), WHAT, "GPUBuffer")?;
        let destination_offset = args::to_u64(
            global,
            callframe.argument(4),
            "resolveQuerySet: destinationOffset",
        )?;
        let result = instance().command_encoder_resolve_query_set(
            self.raw.id(),
            query_set,
            first_query,
            query_count,
            destination,
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
        let raw = Rc::new(bun_webgpu::CommandBuffer::new(id));
        if let Some(message) = self.invalid.take() {
            self.device.report(global, GpuError::validation(message))?;
        } else if let Some((_, err)) = err {
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
pub(crate) struct GPUCommandBuffer {
    raw: Rc<bun_webgpu::CommandBuffer>,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUCommandBuffer, label);
super::resource!(GPUCommandBuffer, bun_webgpu::CommandBuffer);
