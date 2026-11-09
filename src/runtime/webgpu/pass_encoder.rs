use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal};
use bun_jsc::{JSType, JSValue};

use super::device::DeviceRef;
use super::{
    GPUBindGroup, GPUBuffer, GPUComputePipeline, GPUDevice, GPURenderPipeline, WebEnum as _,
    bytes_per_element, color_to_sys, gpu_object, new_object, optional_to_sys, slice_of_data,
    string_view, sys, to_sys_bool,
};
use crate::generated_bindgen::webgpu::{
    GPUColor, GPUIndexFormat, GPURenderBundleDescriptor, GPURenderBundleEncoderDescriptor,
};

gpu_object! {
    GPUComputePassEncoder {
        handle: WGPUComputePassEncoder,
        release: wgpuComputePassEncoderRelease,
        set_label: wgpuComputePassEncoderSetLabel,
        _device: DeviceRef,
    }
}

gpu_object! {
    GPURenderPassEncoder {
        handle: WGPURenderPassEncoder,
        release: wgpuRenderPassEncoderRelease,
        set_label: wgpuRenderPassEncoderSetLabel,
        _device: DeviceRef,
    }
}

gpu_object! {
    GPURenderBundleEncoder {
        handle: WGPURenderBundleEncoder,
        release: wgpuRenderBundleEncoderRelease,
        set_label: wgpuRenderBundleEncoderSetLabel,
        device: DeviceRef,
    }
}

gpu_object! {
    GPURenderBundle {
        handle: WGPURenderBundle,
        release: wgpuRenderBundleRelease,
        set_label: wgpuRenderBundleSetLabel,
        _device: DeviceRef,
    }
}

fn optional_handle<T, H>(object: Option<&T>, handle: impl FnOnce(&T) -> *mut H) -> *mut H {
    object.map_or(core::ptr::null_mut(), handle)
}

/// `GPUDebugCommandsMixin`.
macro_rules! debug_commands {
    ($Encoder:ident, $push:ident, $pop:ident, $insert:ident) => {
        impl $Encoder {
            pub(crate) fn push_debug_group(&self, group_label: &[u8]) {
                // SAFETY: a live encoder, and a view that outlives the call.
                unsafe { sys::$push(self.handle, crate::webgpu::string_view(group_label)) };
            }
            pub(crate) fn pop_debug_group(&self) {
                // SAFETY: a live encoder.
                unsafe { sys::$pop(self.handle) };
            }
            pub(crate) fn insert_debug_marker(&self, marker_label: &[u8]) {
                // SAFETY: a live encoder, and a view that outlives the call.
                unsafe { sys::$insert(self.handle, crate::webgpu::string_view(marker_label)) };
            }
        }
    };
}
pub(super) use debug_commands;

debug_commands!(
    GPUComputePassEncoder,
    wgpuComputePassEncoderPushDebugGroup,
    wgpuComputePassEncoderPopDebugGroup,
    wgpuComputePassEncoderInsertDebugMarker
);
debug_commands!(
    GPURenderPassEncoder,
    wgpuRenderPassEncoderPushDebugGroup,
    wgpuRenderPassEncoderPopDebugGroup,
    wgpuRenderPassEncoderInsertDebugMarker
);
debug_commands!(
    GPURenderBundleEncoder,
    wgpuRenderBundleEncoderPushDebugGroup,
    wgpuRenderBundleEncoderPopDebugGroup,
    wgpuRenderBundleEncoderInsertDebugMarker
);

/// The `length` elements from `start` of `data`, which has to be a `Uint32Array`.
fn dynamic_offsets<'a>(
    heap: &JsHeap<'a>,
    data: JsLocal<'a, BufferSource>,
    start: u64,
    length: u32,
) -> bindgen::Result<'a, Vec<u32>> {
    if data.to_js().js_type() != JSType::Uint32Array {
        return Err(heap.type_error(format_args!("dynamicOffsetsData must be a Uint32Array")));
    }
    data.with_bytes(heap, |bytes| {
        let count = (bytes.len() / 4) as u64;
        if start > count || u64::from(length) > count - start {
            return Err(heap.range_error(format_args!(
                "dynamicOffsetsDataStart + dynamicOffsetsDataLength is past the end of dynamicOffsetsData"
            )));
        }
        let start = start as usize * 4;
        let bytes = &bytes[start..start + length as usize * 4];
        // An `ArrayBuffer` can be at any address.
        Ok(bun_core::vec_from_bytes::<u32>(bytes).unwrap_or_default())
    })
}

/// `GPUBindingCommandsMixin`.
macro_rules! binding_commands {
    ($Encoder:ident, $set_bind_group:ident, $set_immediates:ident) => {
        impl $Encoder {
            pub(crate) fn set_bind_group(
                &self,
                index: u32,
                bind_group: Option<&GPUBindGroup>,
                dynamic_offsets: Vec<u32>,
            ) {
                let bind_group = optional_handle(bind_group, |bind_group| bind_group.handle);
                // SAFETY: live objects, and offsets that outlive the call.
                unsafe {
                    sys::$set_bind_group(
                        self.handle,
                        index,
                        bind_group,
                        dynamic_offsets.len(),
                        dynamic_offsets.as_ptr(),
                    )
                };
            }

            pub(crate) fn set_bind_group_with_data<'a>(
                &self,
                heap: &JsHeap<'a>,
                index: u32,
                bind_group: Option<&GPUBindGroup>,
                dynamic_offsets_data: JsLocal<'a, BufferSource>,
                dynamic_offsets_data_start: u64,
                dynamic_offsets_data_length: u32,
            ) -> bindgen::Result<'a, ()> {
                let offsets = dynamic_offsets(
                    heap,
                    dynamic_offsets_data,
                    dynamic_offsets_data_start,
                    dynamic_offsets_data_length,
                )?;
                self.set_bind_group(index, bind_group, offsets);
                Ok(())
            }

            pub(crate) fn set_immediates<'a>(
                &self,
                heap: &JsHeap<'a>,
                range_offset: u32,
                data: JsLocal<'a, BufferSource>,
                data_offset: u64,
                data_size: Option<u64>,
            ) -> bindgen::Result<'a, ()> {
                let bytes_per_element = bytes_per_element(data.to_js());
                data.with_bytes(heap, |bytes| {
                    let bytes =
                        slice_of_data(heap, bytes, bytes_per_element, data_offset, data_size)?;
                    // SAFETY: a live encoder, and bytes that outlive the call.
                    unsafe {
                        sys::$set_immediates(
                            self.handle,
                            range_offset,
                            bytes.as_ptr().cast(),
                            bytes.len(),
                        )
                    };
                    Ok(())
                })
            }
        }
    };
}

binding_commands!(
    GPUComputePassEncoder,
    wgpuComputePassEncoderSetBindGroup,
    wgpuComputePassEncoderSetImmediates
);
binding_commands!(
    GPURenderPassEncoder,
    wgpuRenderPassEncoderSetBindGroup,
    wgpuRenderPassEncoderSetImmediates
);
binding_commands!(
    GPURenderBundleEncoder,
    wgpuRenderBundleEncoderSetBindGroup,
    wgpuRenderBundleEncoderSetImmediates
);

/// `GPURenderCommandsMixin`.
macro_rules! render_commands {
    (
        $Encoder:ident,
        $set_pipeline:ident,
        $set_index_buffer:ident,
        $set_vertex_buffer:ident,
        $draw:ident,
        $draw_indexed:ident,
        $draw_indirect:ident,
        $draw_indexed_indirect:ident
    ) => {
        impl $Encoder {
            pub(crate) fn set_pipeline(&self, pipeline: &GPURenderPipeline) {
                // SAFETY: live objects.
                unsafe { sys::$set_pipeline(self.handle, pipeline.handle) };
            }

            pub(crate) fn set_index_buffer(
                &self,
                buffer: &GPUBuffer,
                index_format: GPUIndexFormat,
                offset: u64,
                size: Option<u64>,
            ) {
                let size = size.unwrap_or(sys::WGPU_WHOLE_SIZE);
                // SAFETY: live objects.
                unsafe {
                    sys::$set_index_buffer(
                        self.handle,
                        buffer.handle,
                        index_format.to_sys(),
                        offset,
                        size,
                    )
                };
            }

            pub(crate) fn set_vertex_buffer(
                &self,
                slot: u32,
                buffer: Option<&GPUBuffer>,
                offset: u64,
                size: Option<u64>,
            ) {
                let buffer = optional_handle(buffer, |buffer| buffer.handle);
                let size = size.unwrap_or(sys::WGPU_WHOLE_SIZE);
                // SAFETY: live objects.
                unsafe { sys::$set_vertex_buffer(self.handle, slot, buffer, offset, size) };
            }

            pub(crate) fn draw(
                &self,
                vertex_count: u32,
                instance_count: u32,
                first_vertex: u32,
                first_instance: u32,
            ) {
                // SAFETY: a live encoder.
                unsafe {
                    sys::$draw(
                        self.handle,
                        vertex_count,
                        instance_count,
                        first_vertex,
                        first_instance,
                    )
                };
            }

            pub(crate) fn draw_indexed(
                &self,
                index_count: u32,
                instance_count: u32,
                first_index: u32,
                base_vertex: i32,
                first_instance: u32,
            ) {
                // SAFETY: a live encoder.
                unsafe {
                    sys::$draw_indexed(
                        self.handle,
                        index_count,
                        instance_count,
                        first_index,
                        base_vertex,
                        first_instance,
                    )
                };
            }

            pub(crate) fn draw_indirect(&self, indirect_buffer: &GPUBuffer, indirect_offset: u64) {
                // SAFETY: live objects.
                unsafe {
                    sys::$draw_indirect(self.handle, indirect_buffer.handle, indirect_offset)
                };
            }

            pub(crate) fn draw_indexed_indirect(
                &self,
                indirect_buffer: &GPUBuffer,
                indirect_offset: u64,
            ) {
                // SAFETY: live objects.
                unsafe {
                    sys::$draw_indexed_indirect(
                        self.handle,
                        indirect_buffer.handle,
                        indirect_offset,
                    )
                };
            }
        }
    };
}

render_commands!(
    GPURenderPassEncoder,
    wgpuRenderPassEncoderSetPipeline,
    wgpuRenderPassEncoderSetIndexBuffer,
    wgpuRenderPassEncoderSetVertexBuffer,
    wgpuRenderPassEncoderDraw,
    wgpuRenderPassEncoderDrawIndexed,
    wgpuRenderPassEncoderDrawIndirect,
    wgpuRenderPassEncoderDrawIndexedIndirect
);
render_commands!(
    GPURenderBundleEncoder,
    wgpuRenderBundleEncoderSetPipeline,
    wgpuRenderBundleEncoderSetIndexBuffer,
    wgpuRenderBundleEncoderSetVertexBuffer,
    wgpuRenderBundleEncoderDraw,
    wgpuRenderBundleEncoderDrawIndexed,
    wgpuRenderBundleEncoderDrawIndirect,
    wgpuRenderBundleEncoderDrawIndexedIndirect
);

impl GPUComputePassEncoder {
    pub(crate) fn set_pipeline(&self, pipeline: &GPUComputePipeline) {
        // SAFETY: live objects.
        unsafe { sys::wgpuComputePassEncoderSetPipeline(self.handle, pipeline.handle) };
    }

    pub(crate) fn dispatch_workgroups(&self, x: u32, y: u32, z: u32) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuComputePassEncoderDispatchWorkgroups(self.handle, x, y, z) };
    }

    pub(crate) fn dispatch_workgroups_indirect(
        &self,
        indirect_buffer: &GPUBuffer,
        indirect_offset: u64,
    ) {
        // SAFETY: live objects.
        unsafe {
            sys::wgpuComputePassEncoderDispatchWorkgroupsIndirect(
                self.handle,
                indirect_buffer.handle,
                indirect_offset,
            )
        };
    }

    pub(crate) fn end(&self) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuComputePassEncoderEnd(self.handle) };
    }
}

impl GPURenderPassEncoder {
    pub(crate) fn set_viewport(
        &self,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        min_depth: f32,
        max_depth: f32,
    ) {
        // SAFETY: a live encoder.
        unsafe {
            sys::wgpuRenderPassEncoderSetViewport(
                self.handle,
                x,
                y,
                width,
                height,
                min_depth,
                max_depth,
            )
        };
    }

    pub(crate) fn set_scissor_rect(&self, x: u32, y: u32, width: u32, height: u32) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuRenderPassEncoderSetScissorRect(self.handle, x, y, width, height) };
    }

    pub(crate) fn set_blend_constant<'a>(
        &self,
        heap: &JsHeap<'a>,
        color: GPUColor,
    ) -> bindgen::Result<'a, ()> {
        let color = color_to_sys(heap, color)?;
        // SAFETY: a live encoder, and a color that outlives the call.
        unsafe { sys::wgpuRenderPassEncoderSetBlendConstant(self.handle, &raw const color) };
        Ok(())
    }

    pub(crate) fn set_stencil_reference(&self, reference: u32) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuRenderPassEncoderSetStencilReference(self.handle, reference) };
    }

    pub(crate) fn begin_occlusion_query(&self, query_index: u32) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuRenderPassEncoderBeginOcclusionQuery(self.handle, query_index) };
    }

    pub(crate) fn end_occlusion_query(&self) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuRenderPassEncoderEndOcclusionQuery(self.handle) };
    }

    pub(crate) fn execute_bundles(&self, bundles: Vec<bun_ptr::RefPtr<GPURenderBundle>>) {
        let handles: Vec<sys::WGPURenderBundle> =
            bundles.iter().map(|bundle| bundle.handle).collect();
        // SAFETY: live objects, and a list that outlives the call.
        unsafe {
            sys::wgpuRenderPassEncoderExecuteBundles(self.handle, handles.len(), handles.as_ptr())
        };
        drop(bundles);
    }

    pub(crate) fn end(&self) {
        // SAFETY: a live encoder.
        unsafe { sys::wgpuRenderPassEncoderEnd(self.handle) };
    }
}

impl GPUDevice {
    pub(crate) fn create_render_bundle_encoder<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPURenderBundleEncoderDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        let formats = descriptor.color_formats.iter().flatten();
        for format in formats.chain(&descriptor.depth_stencil_format) {
            self.state.validate_format(heap, *format)?;
        }
        let label = descriptor.label.to_utf8();
        let color_formats: Vec<sys::WGPUTextureFormat> = descriptor
            .color_formats
            .iter()
            .map(|format| optional_to_sys!(*format, WGPUTextureFormat))
            .collect();
        let sys_descriptor = sys::WGPURenderBundleEncoderDescriptor {
            label: string_view(&label),
            colorFormatCount: color_formats.len(),
            colorFormats: color_formats.as_ptr(),
            depthStencilFormat: optional_to_sys!(
                descriptor.depth_stencil_format,
                WGPUTextureFormat
            ),
            sampleCount: descriptor.sample_count,
            depthReadOnly: to_sys_bool(descriptor.depth_read_only),
            stencilReadOnly: to_sys_bool(descriptor.stencil_read_only),
            ..sys::WGPURenderBundleEncoderDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle = unsafe {
            sys::wgpuDeviceCreateRenderBundleEncoder(self.handle, &raw const sys_descriptor)
        };
        Ok(new_object(
            heap,
            GPURenderBundleEncoder::new(handle, &descriptor.label, self.device_ref()),
        ))
    }
}

impl GPURenderBundleEncoder {
    pub(crate) fn finish(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPURenderBundleDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPURenderBundleDescriptor {
            label: string_view(&label),
            ..sys::WGPURenderBundleDescriptor::INIT
        };
        // SAFETY: a live encoder, and a descriptor that outlives the call.
        let handle =
            unsafe { sys::wgpuRenderBundleEncoderFinish(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPURenderBundle::new(handle, &descriptor.label, self.device.clone()),
        )
    }
}
