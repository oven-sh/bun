use bun_collections::smallvec::SmallVec;
use bun_dawn_sys::{self as dawn, Chain};
use bun_jsc::bindgen::{BufferSource, JsHeap, JsLocal, JsPayload as _, JsWrapper, Result};

use super::convert::{self, optional_u32, size_or_whole};
use super::device::check_stack;
use super::{
    Child as _, GPUBindGroup, GPUBuffer, GPUCommandBuffer, GPUComputePipeline, GPUQuerySet,
    GPURenderBundle, GPURenderPipeline, Object, idl,
};

pub(crate) type GPUCommandEncoder = Object<dawn::CommandEncoder>;
pub(crate) type GPUComputePassEncoder = Object<dawn::ComputePassEncoder>;
pub(crate) type GPURenderPassEncoder = Object<dawn::RenderPassEncoder>;
pub(crate) type GPURenderBundleEncoder = Object<dawn::RenderBundleEncoder>;

macro_rules! impl_debug_commands_mixin {
    ($($Encoder:ident),*) => {$(
        impl $Encoder {
            pub(crate) fn push_debug_group(&self, group_label: &[u8]) {
                self.handle.push_debug_group(group_label.into());
            }

            pub(crate) fn pop_debug_group(&self) {
                self.handle.pop_debug_group();
            }

            pub(crate) fn insert_debug_marker(&self, marker_label: &[u8]) {
                self.handle.insert_debug_marker(marker_label.into());
            }
        }
    )*};
}

impl_debug_commands_mixin!(
    GPUCommandEncoder,
    GPUComputePassEncoder,
    GPURenderPassEncoder,
    GPURenderBundleEncoder
);

macro_rules! impl_binding_commands_mixin {
    ($($Encoder:ident),*) => {$(
        impl $Encoder {
            pub(crate) fn set_bind_group(
                &self,
                index: u32,
                bind_group: Option<&GPUBindGroup>,
                dynamic_offsets: &[u32],
            ) {
                let bind_group = bind_group.map(|bind_group| &*bind_group.handle);
                self.handle.set_bind_group(index, bind_group, dynamic_offsets);
            }

            pub(crate) fn set_bind_group_with_data<'a>(
                &self,
                heap: &JsHeap<'a>,
                index: u32,
                bind_group: Option<&GPUBindGroup>,
                data: JsLocal<'a, BufferSource>,
                start: u64,
                length: u32,
            ) -> Result<'a, ()> {
                let dynamic_offsets = convert::dynamic_offsets(heap, data, start, length)?;
                self.set_bind_group(index, bind_group, &dynamic_offsets);
                Ok(())
            }

            pub(crate) fn set_immediates<'a>(
                &self,
                heap: &JsHeap<'a>,
                range_offset: u32,
                data: JsLocal<'a, BufferSource>,
                data_offset: u64,
                data_size: Option<u64>,
            ) -> Result<'a, ()> {
                convert::with_elements(heap, data, data_offset, data_size, |bytes| {
                    self.handle.set_immediates(range_offset, bytes);
                })
            }
        }
    )*};
}

impl_binding_commands_mixin!(
    GPUComputePassEncoder,
    GPURenderPassEncoder,
    GPURenderBundleEncoder
);

macro_rules! impl_render_commands_mixin {
    ($($Encoder:ident),*) => {$(
        impl $Encoder {
            pub(crate) fn set_pipeline(&self, pipeline: &GPURenderPipeline) {
                self.handle.set_pipeline(&pipeline.handle);
            }

            pub(crate) fn set_index_buffer(
                &self,
                buffer: &GPUBuffer,
                index_format: idl::GPUIndexFormat,
                offset: u64,
                size: Option<u64>,
            ) {
                let size = size_or_whole(size);
                self.handle.set_index_buffer(&buffer.handle, index_format.into(), offset, size);
            }

            pub(crate) fn set_vertex_buffer(
                &self,
                slot: u32,
                buffer: Option<&GPUBuffer>,
                offset: u64,
                size: Option<u64>,
            ) {
                let buffer = buffer.map(|buffer| &*buffer.handle);
                self.handle.set_vertex_buffer(slot, buffer, offset, size_or_whole(size));
            }

            pub(crate) fn draw(
                &self,
                vertex_count: u32,
                instance_count: u32,
                first_vertex: u32,
                first_instance: u32,
            ) {
                self.handle.draw(vertex_count, instance_count, first_vertex, first_instance);
            }

            pub(crate) fn draw_indexed(
                &self,
                index_count: u32,
                instance_count: u32,
                first_index: u32,
                base_vertex: i32,
                first_instance: u32,
            ) {
                self.handle.draw_indexed(
                    index_count,
                    instance_count,
                    first_index,
                    base_vertex,
                    first_instance,
                );
            }

            pub(crate) fn draw_indirect(&self, indirect_buffer: &GPUBuffer, indirect_offset: u64) {
                self.handle.draw_indirect(&indirect_buffer.handle, indirect_offset);
            }

            pub(crate) fn draw_indexed_indirect(
                &self,
                indirect_buffer: &GPUBuffer,
                indirect_offset: u64,
            ) {
                self.handle.draw_indexed_indirect(&indirect_buffer.handle, indirect_offset);
            }
        }
    )*};
}

impl_render_commands_mixin!(GPURenderPassEncoder, GPURenderBundleEncoder);

fn color_attachment<'a>(
    heap: &JsHeap<'a>,
    attachment: Option<&idl::GPURenderPassColorAttachment<'a>>,
) -> Result<'a, dawn::RenderPassColorAttachment<'a>> {
    let Some(attachment) = attachment else {
        return Ok(Default::default());
    };
    Ok(dawn::RenderPassColorAttachment {
        next_in_chain: Chain::END,
        clear_value: match &attachment.clear_value {
            Some(clear_value) => convert::color(heap, clear_value)?,
            None => Default::default(),
        },
        view: Some(attachment.view.view()),
        depth_slice: optional_u32(attachment.depth_slice),
        resolve_target: attachment.resolve_target.as_ref().map(|it| it.view()),
        load_op: attachment.load_op.into(),
        store_op: attachment.store_op.into(),
    })
}

fn depth_stencil_attachment<'a>(
    attachment: &idl::GPURenderPassDepthStencilAttachment<'a>,
) -> dawn::RenderPassDepthStencilAttachment<'a> {
    let load_op = |op: Option<idl::GPULoadOp>| op.map_or(dawn::LoadOp::Undefined, Into::into);
    let store_op = |op: Option<idl::GPUStoreOp>| op.map_or(dawn::StoreOp::Undefined, Into::into);
    dawn::RenderPassDepthStencilAttachment {
        next_in_chain: Chain::END,
        view: attachment.view.view(),
        depth_load_op: load_op(attachment.depth_load_op),
        depth_store_op: store_op(attachment.depth_store_op),
        depth_clear_value: (attachment.depth_clear_value)
            .unwrap_or(dawn::DEPTH_CLEAR_VALUE_UNDEFINED),
        depth_read_only: attachment.depth_read_only.into(),
        stencil_load_op: load_op(attachment.stencil_load_op),
        stencil_store_op: store_op(attachment.stencil_store_op),
        stencil_clear_value: attachment.stencil_clear_value,
        stencil_read_only: attachment.stencil_read_only.into(),
    }
}

impl GPUCommandEncoder {
    pub(crate) fn begin_render_pass<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPURenderPassDescriptor<'a>,
    ) -> Result<'a, JsWrapper<'a, GPURenderPassEncoder>> {
        check_stack(heap)?;
        let color_attachments = (descriptor.color_attachments.iter())
            .map(|attachment| color_attachment(heap, attachment.as_ref()))
            .collect::<Result<'a, SmallVec<[_; 8]>>>()?;
        let depth_stencil_attachment =
            (descriptor.depth_stencil_attachment.as_ref()).map(depth_stencil_attachment);
        let timestamp_writes = descriptor.timestamp_writes.as_ref().map(|writes| {
            convert::timestamp_writes(
                writes.query_set,
                writes.beginning_of_pass_write_index,
                writes.end_of_pass_write_index,
            )
        });
        let max_draw_count = dawn::RenderPassMaxDrawCount {
            chain: Default::default(),
            max_draw_count: descriptor.max_draw_count,
        };
        let handle = self.handle.begin_render_pass(&dawn::RenderPassDescriptor {
            next_in_chain: Chain::from(&max_draw_count),
            label: convert::label(&descriptor.label.to_utf8()),
            color_attachments: (*color_attachments).into(),
            depth_stencil_attachment: depth_stencil_attachment.as_ref(),
            occlusion_query_set: descriptor.occlusion_query_set.map(|set| &*set.handle),
            timestamp_writes: timestamp_writes.as_ref(),
        });
        Ok(
            Object::with_state(handle, &descriptor.label, self.state.clone())
                .into_child_of(heap, this_value.to_js()),
        )
    }

    pub(crate) fn begin_compute_pass<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUComputePassDescriptor<'a>,
    ) -> JsWrapper<'a, GPUComputePassEncoder> {
        let timestamp_writes = descriptor.timestamp_writes.as_ref().map(|writes| {
            convert::timestamp_writes(
                writes.query_set,
                writes.beginning_of_pass_write_index,
                writes.end_of_pass_write_index,
            )
        });
        let handle = self
            .handle
            .begin_compute_pass(Some(&dawn::ComputePassDescriptor {
                next_in_chain: Chain::END,
                label: convert::label(&descriptor.label.to_utf8()),
                timestamp_writes: timestamp_writes.as_ref(),
            }));
        Object::with_state(handle, &descriptor.label, self.state.clone())
            .into_child_of(heap, this_value.to_js())
    }

    pub(crate) fn copy_buffer_to_buffer_from_start(
        &self,
        source: &GPUBuffer,
        destination: &GPUBuffer,
        size: Option<u64>,
    ) {
        self.copy_buffer_to_buffer(source, 0, destination, 0, size);
    }

    pub(crate) fn copy_buffer_to_buffer(
        &self,
        source: &GPUBuffer,
        source_offset: u64,
        destination: &GPUBuffer,
        destination_offset: u64,
        size: Option<u64>,
    ) {
        self.handle.copy_buffer_to_buffer(
            &source.handle,
            source_offset,
            &destination.handle,
            destination_offset,
            size.unwrap_or_else(|| source.get_size().saturating_sub(source_offset)),
        );
    }

    pub(crate) fn copy_buffer_to_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &idl::GPUTexelCopyBufferInfo<'a>,
        destination: &idl::GPUTexelCopyTextureInfo<'a>,
        copy_size: &idl::GPUExtent3D,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle.copy_buffer_to_texture(
            &convert::buffer_info(source),
            &convert::texture_info(heap, destination)?,
            &convert::extent(heap, copy_size)?,
        );
        Ok(())
    }

    pub(crate) fn copy_texture_to_buffer<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &idl::GPUTexelCopyTextureInfo<'a>,
        destination: &idl::GPUTexelCopyBufferInfo<'a>,
        copy_size: &idl::GPUExtent3D,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle.copy_texture_to_buffer(
            &convert::texture_info(heap, source)?,
            &convert::buffer_info(destination),
            &convert::extent(heap, copy_size)?,
        );
        Ok(())
    }

    pub(crate) fn copy_texture_to_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        source: &idl::GPUTexelCopyTextureInfo<'a>,
        destination: &idl::GPUTexelCopyTextureInfo<'a>,
        copy_size: &idl::GPUExtent3D,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle.copy_texture_to_texture(
            &convert::texture_info(heap, source)?,
            &convert::texture_info(heap, destination)?,
            &convert::extent(heap, copy_size)?,
        );
        Ok(())
    }

    pub(crate) fn clear_buffer(&self, buffer: &GPUBuffer, offset: u64, size: Option<u64>) {
        self.handle
            .clear_buffer(&buffer.handle, offset, size_or_whole(size));
    }

    pub(crate) fn resolve_query_set<'a>(
        &self,
        heap: &JsHeap<'a>,
        query_set: &GPUQuerySet,
        first_query: u32,
        query_count: u32,
        destination: &GPUBuffer,
        destination_offset: u64,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle.resolve_query_set(
            &query_set.handle,
            first_query,
            query_count,
            &destination.handle,
            destination_offset,
        );
        Ok(())
    }

    pub(crate) fn finish<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPUCommandBufferDescriptor,
    ) -> JsWrapper<'a, GPUCommandBuffer> {
        let handle = self.handle.finish(Some(&dawn::CommandBufferDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
        }));
        Object::with_state(handle, &descriptor.label, self.state.clone()).into_js(heap)
    }
}

impl GPUComputePassEncoder {
    pub(crate) fn set_pipeline(&self, pipeline: &GPUComputePipeline) {
        self.handle.set_pipeline(&pipeline.handle);
    }

    pub(crate) fn dispatch_workgroups(&self, x: u32, y: u32, z: u32) {
        self.handle.dispatch_workgroups(x, y, z);
    }

    pub(crate) fn dispatch_workgroups_indirect<'a>(
        &self,
        heap: &JsHeap<'a>,
        indirect_buffer: &GPUBuffer,
        indirect_offset: u64,
    ) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle
            .dispatch_workgroups_indirect(&indirect_buffer.handle, indirect_offset);
        Ok(())
    }

    pub(crate) fn end(&self) {
        self.handle.end();
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
        self.handle
            .set_viewport(x, y, width, height, min_depth, max_depth);
    }

    pub(crate) fn set_scissor_rect(&self, x: u32, y: u32, width: u32, height: u32) {
        self.handle.set_scissor_rect(x, y, width, height);
    }

    pub(crate) fn set_blend_constant<'a>(
        &self,
        heap: &JsHeap<'a>,
        color: &idl::GPUColor,
    ) -> Result<'a, ()> {
        self.handle
            .set_blend_constant(&convert::color(heap, color)?);
        Ok(())
    }

    pub(crate) fn set_stencil_reference(&self, reference: u32) {
        self.handle.set_stencil_reference(reference);
    }

    pub(crate) fn begin_occlusion_query(&self, query_index: u32) {
        self.handle.begin_occlusion_query(query_index);
    }

    pub(crate) fn end_occlusion_query(&self) {
        self.handle.end_occlusion_query();
    }

    pub(crate) fn execute_bundles(&self, bundles: &[&GPURenderBundle]) {
        let handles = bundles.iter().map(|bundle| &*bundle.handle);
        self.handle
            .execute_bundles(&handles.collect::<SmallVec<[_; 8]>>());
    }

    pub(crate) fn end<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, ()> {
        check_stack(heap)?;
        self.handle.end();
        Ok(())
    }
}

impl GPURenderBundleEncoder {
    pub(crate) fn finish<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &idl::GPURenderBundleDescriptor,
    ) -> JsWrapper<'a, GPURenderBundle> {
        let handle = self.handle.finish(Some(&dawn::RenderBundleDescriptor {
            next_in_chain: Chain::END,
            label: convert::label(&descriptor.label.to_utf8()),
        }));
        Object::with_state(handle, &descriptor.label, self.state.clone()).into_js(heap)
    }
}
