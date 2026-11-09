use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap};

use super::device::DeviceRef;
use super::pass_encoder::debug_commands;
use super::texture::DefaultViews;
use super::{
    GPUBuffer, GPUComputePassEncoder, GPUDevice, GPUQuerySet, GPURenderPassEncoder, WebEnum as _,
    color_to_sys, extent_to_sys, gpu_object, new_object, optional_to_sys, origin_to_sys,
    string_view, sys, to_sys_bool,
};
use crate::generated_bindgen::webgpu::{
    GPUCommandBufferDescriptor, GPUCommandEncoderDescriptor, GPUComputePassDescriptor, GPUExtent3D,
    GPURenderPassDescriptor, GPUTexelCopyBufferInfo, GPUTexelCopyBufferLayout,
    GPUTexelCopyTextureInfo, GPUTextureOrView,
};

gpu_object! {
    GPUCommandEncoder {
        handle: WGPUCommandEncoder,
        release: wgpuCommandEncoderRelease,
        set_label: wgpuCommandEncoderSetLabel,
        device: DeviceRef,
    }
}

gpu_object! {
    GPUCommandBuffer {
        handle: WGPUCommandBuffer,
        release: wgpuCommandBufferRelease,
        set_label: wgpuCommandBufferSetLabel,
        _device: DeviceRef,
    }
}

debug_commands!(
    GPUCommandEncoder,
    wgpuCommandEncoderPushDebugGroup,
    wgpuCommandEncoderPopDebugGroup,
    wgpuCommandEncoderInsertDebugMarker
);

impl GPUDevice {
    pub(crate) fn create_command_encoder(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUCommandEncoderDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPUCommandEncoderDescriptor {
            label: string_view(&label),
            ..sys::WGPUCommandEncoderDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call.
        let handle =
            unsafe { sys::wgpuDeviceCreateCommandEncoder(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUCommandEncoder::new(handle, &descriptor.label, self.device_ref()),
        )
    }
}

pub(super) fn buffer_layout_to_sys(
    offset: u64,
    bytes_per_row: Option<u32>,
    rows_per_image: Option<u32>,
) -> sys::WGPUTexelCopyBufferLayout {
    sys::WGPUTexelCopyBufferLayout {
        offset,
        bytesPerRow: bytes_per_row.unwrap_or(sys::WGPU_COPY_STRIDE_UNDEFINED),
        rowsPerImage: rows_per_image.unwrap_or(sys::WGPU_COPY_STRIDE_UNDEFINED),
    }
}

impl GPUTexelCopyBufferLayout {
    pub(super) fn to_sys(&self) -> sys::WGPUTexelCopyBufferLayout {
        buffer_layout_to_sys(self.offset, self.bytes_per_row, self.rows_per_image)
    }
}

impl GPUTexelCopyBufferInfo {
    fn to_sys(&self) -> sys::WGPUTexelCopyBufferInfo {
        sys::WGPUTexelCopyBufferInfo {
            layout: buffer_layout_to_sys(self.offset, self.bytes_per_row, self.rows_per_image),
            buffer: self.buffer.handle,
        }
    }
}

impl GPUTexelCopyTextureInfo {
    pub(super) fn to_sys<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, sys::WGPUTexelCopyTextureInfo> {
        Ok(sys::WGPUTexelCopyTextureInfo {
            texture: self.texture.handle,
            mipLevel: self.mip_level,
            origin: origin_to_sys(heap, self.origin.as_ref())?,
            aspect: self.aspect.to_sys(),
        })
    }
}

fn view_of(attachment: &GPUTextureOrView, views: &mut DefaultViews) -> sys::WGPUTextureView {
    match attachment {
        GPUTextureOrView::View(view) => view.handle,
        GPUTextureOrView::Texture(texture) => views.of(texture),
    }
}

fn timestamp_writes_to_sys(
    query_set: &GPUQuerySet,
    beginning: Option<u32>,
    end: Option<u32>,
) -> sys::WGPUPassTimestampWrites {
    sys::WGPUPassTimestampWrites {
        querySet: query_set.handle,
        beginningOfPassWriteIndex: beginning.unwrap_or(sys::WGPU_QUERY_SET_INDEX_UNDEFINED),
        endOfPassWriteIndex: end.unwrap_or(sys::WGPU_QUERY_SET_INDEX_UNDEFINED),
        ..sys::WGPUPassTimestampWrites::INIT
    }
}

impl GPUCommandEncoder {
    pub(crate) fn begin_render_pass<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPURenderPassDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        let label = descriptor.label.to_utf8();
        let mut views = DefaultViews::default();
        let mut color_attachments = Vec::with_capacity(descriptor.color_attachments.len());
        for attachment in &descriptor.color_attachments {
            // Without a view, nothing is attached at this index.
            let Some(attachment) = attachment else {
                color_attachments.push(sys::WGPURenderPassColorAttachment::INIT);
                continue;
            };
            color_attachments.push(sys::WGPURenderPassColorAttachment {
                view: view_of(&attachment.view, &mut views),
                depthSlice: attachment
                    .depth_slice
                    .unwrap_or(sys::WGPU_DEPTH_SLICE_UNDEFINED),
                resolveTarget: match &attachment.resolve_target {
                    Some(target) => view_of(target, &mut views),
                    None => core::ptr::null_mut(),
                },
                loadOp: attachment.load_op.to_sys(),
                storeOp: attachment.store_op.to_sys(),
                clearValue: match &attachment.clear_value {
                    Some(color) => color_to_sys(heap, color)?,
                    None => sys::WGPUColor {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.0,
                    },
                },
                ..sys::WGPURenderPassColorAttachment::INIT
            });
        }
        let depth_stencil_attachment =
            descriptor
                .depth_stencil_attachment
                .as_ref()
                .map(|attachment| sys::WGPURenderPassDepthStencilAttachment {
                    view: view_of(&attachment.view, &mut views),
                    depthLoadOp: optional_to_sys!(attachment.depth_load_op, WGPULoadOp),
                    depthStoreOp: optional_to_sys!(attachment.depth_store_op, WGPUStoreOp),
                    depthClearValue: attachment
                        .depth_clear_value
                        .unwrap_or(sys::WGPU_DEPTH_CLEAR_VALUE_UNDEFINED),
                    depthReadOnly: to_sys_bool(attachment.depth_read_only),
                    stencilLoadOp: optional_to_sys!(attachment.stencil_load_op, WGPULoadOp),
                    stencilStoreOp: optional_to_sys!(attachment.stencil_store_op, WGPUStoreOp),
                    stencilClearValue: attachment.stencil_clear_value,
                    stencilReadOnly: to_sys_bool(attachment.stencil_read_only),
                    ..sys::WGPURenderPassDepthStencilAttachment::INIT
                });
        let timestamp_writes = descriptor.timestamp_writes.as_ref().map(|writes| {
            timestamp_writes_to_sys(
                &writes.query_set,
                writes.beginning_of_pass_write_index,
                writes.end_of_pass_write_index,
            )
        });
        let mut max_draw_count = sys::WGPURenderPassMaxDrawCount {
            maxDrawCount: descriptor.max_draw_count,
            ..sys::WGPURenderPassMaxDrawCount::INIT
        };
        let sys_descriptor = sys::WGPURenderPassDescriptor {
            nextInChain: (&raw mut max_draw_count).cast(),
            label: string_view(&label),
            colorAttachmentCount: color_attachments.len(),
            colorAttachments: color_attachments.as_ptr(),
            depthStencilAttachment: depth_stencil_attachment
                .as_ref()
                .map_or(core::ptr::null(), core::ptr::from_ref),
            occlusionQuerySet: descriptor
                .occlusion_query_set
                .as_ref()
                .map_or(core::ptr::null_mut(), |query_set| query_set.handle),
            timestampWrites: timestamp_writes
                .as_ref()
                .map_or(core::ptr::null(), core::ptr::from_ref),
        };
        // SAFETY: a live encoder, and a descriptor that outlives the call with all it points at.
        let handle = unsafe {
            sys::wgpuCommandEncoderBeginRenderPass(self.handle, &raw const sys_descriptor)
        };
        Ok(new_object(
            heap,
            GPURenderPassEncoder::new(handle, &descriptor.label, self.device.clone()),
        ))
    }

    pub(crate) fn begin_compute_pass(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUComputePassDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let timestamp_writes = descriptor.timestamp_writes.as_ref().map(|writes| {
            timestamp_writes_to_sys(
                &writes.query_set,
                writes.beginning_of_pass_write_index,
                writes.end_of_pass_write_index,
            )
        });
        let sys_descriptor = sys::WGPUComputePassDescriptor {
            label: string_view(&label),
            timestampWrites: timestamp_writes
                .as_ref()
                .map_or(core::ptr::null(), core::ptr::from_ref),
            ..sys::WGPUComputePassDescriptor::INIT
        };
        // SAFETY: a live encoder, and a descriptor that outlives the call with all it points at.
        let handle = unsafe {
            sys::wgpuCommandEncoderBeginComputePass(self.handle, &raw const sys_descriptor)
        };
        new_object(
            heap,
            GPUComputePassEncoder::new(handle, &descriptor.label, self.device.clone()),
        )
    }

    pub(crate) fn copy_buffer_to_buffer(
        &self,
        source: &GPUBuffer,
        destination: &GPUBuffer,
        size: Option<u64>,
    ) {
        self.copy_buffer_to_buffer_at(source, 0, destination, 0, size);
    }

    pub(crate) fn copy_buffer_to_buffer_at(
        &self,
        source: &GPUBuffer,
        source_offset: u64,
        destination: &GPUBuffer,
        destination_offset: u64,
        size: Option<u64>,
    ) {
        // SAFETY: live objects.
        unsafe {
            sys::wgpuCommandEncoderCopyBufferToBuffer(
                self.handle,
                source.handle,
                source_offset,
                destination.handle,
                destination_offset,
                size.unwrap_or_else(|| source.size.saturating_sub(source_offset)),
            )
        };
    }

    pub(crate) fn copy_buffer_to_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &GPUTexelCopyBufferInfo,
        destination: &GPUTexelCopyTextureInfo,
        copy_size: GPUExtent3D,
    ) -> bindgen::Result<'a, ()> {
        let (source, destination) = (source.to_sys(), destination.to_sys(heap)?);
        let copy_size = extent_to_sys(heap, copy_size)?;
        // SAFETY: live objects, and arguments that outlive the call.
        unsafe {
            sys::wgpuCommandEncoderCopyBufferToTexture(
                self.handle,
                &raw const source,
                &raw const destination,
                &raw const copy_size,
            )
        };
        Ok(())
    }

    pub(crate) fn copy_texture_to_buffer<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &GPUTexelCopyTextureInfo,
        destination: &GPUTexelCopyBufferInfo,
        copy_size: GPUExtent3D,
    ) -> bindgen::Result<'a, ()> {
        let (source, destination) = (source.to_sys(heap)?, destination.to_sys());
        let copy_size = extent_to_sys(heap, copy_size)?;
        // SAFETY: live objects, and arguments that outlive the call.
        unsafe {
            sys::wgpuCommandEncoderCopyTextureToBuffer(
                self.handle,
                &raw const source,
                &raw const destination,
                &raw const copy_size,
            )
        };
        Ok(())
    }

    pub(crate) fn copy_texture_to_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &GPUTexelCopyTextureInfo,
        destination: &GPUTexelCopyTextureInfo,
        copy_size: GPUExtent3D,
    ) -> bindgen::Result<'a, ()> {
        let (source, destination) = (source.to_sys(heap)?, destination.to_sys(heap)?);
        let copy_size = extent_to_sys(heap, copy_size)?;
        // SAFETY: live objects, and arguments that outlive the call.
        unsafe {
            sys::wgpuCommandEncoderCopyTextureToTexture(
                self.handle,
                &raw const source,
                &raw const destination,
                &raw const copy_size,
            )
        };
        Ok(())
    }

    pub(crate) fn clear_buffer(&self, buffer: &GPUBuffer, offset: u64, size: Option<u64>) {
        let size = size.unwrap_or(sys::WGPU_WHOLE_SIZE);
        // SAFETY: live objects.
        unsafe { sys::wgpuCommandEncoderClearBuffer(self.handle, buffer.handle, offset, size) };
    }

    pub(crate) fn resolve_query_set(
        &self,
        query_set: &GPUQuerySet,
        first_query: u32,
        query_count: u32,
        destination: &GPUBuffer,
        destination_offset: u64,
    ) {
        // SAFETY: live objects.
        unsafe {
            sys::wgpuCommandEncoderResolveQuerySet(
                self.handle,
                query_set.handle,
                first_query,
                query_count,
                destination.handle,
                destination_offset,
            )
        };
    }

    pub(crate) fn finish(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUCommandBufferDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPUCommandBufferDescriptor {
            label: string_view(&label),
            ..sys::WGPUCommandBufferDescriptor::INIT
        };
        // SAFETY: a live encoder, and a descriptor that outlives the call.
        let handle =
            unsafe { sys::wgpuCommandEncoderFinish(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUCommandBuffer::new(handle, &descriptor.label, self.device.clone()),
        )
    }
}
