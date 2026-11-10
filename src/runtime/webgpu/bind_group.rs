use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap};

use super::device::DeviceRef;
use super::texture::DefaultViews;
use super::{GPUDevice, WebEnum as _, gpu_object, new_object, string_view, sys, to_sys_bool};
use crate::generated_bindgen::webgpu::{
    GPUBindGroupDescriptor, GPUBindGroupLayoutDescriptor, GPUBindingResource,
    GPUPipelineLayoutDescriptor,
};

gpu_object! {
    GPUBindGroupLayout {
        handle: WGPUBindGroupLayout,
        release: wgpuBindGroupLayoutRelease,
        set_label: wgpuBindGroupLayoutSetLabel,
        _device: DeviceRef,
    }
}

gpu_object! {
    GPUBindGroup {
        handle: WGPUBindGroup,
        release: wgpuBindGroupRelease,
        set_label: wgpuBindGroupSetLabel,
        _device: DeviceRef,
    }
}

gpu_object! {
    GPUPipelineLayout {
        handle: WGPUPipelineLayout,
        release: wgpuPipelineLayoutRelease,
        set_label: wgpuPipelineLayoutSetLabel,
        _device: DeviceRef,
    }
}

pub(crate) enum GPUExternalTexture {}

impl GPUExternalTexture {
    pub(crate) fn get_label(&self) -> bun_core::String {
        match *self {}
    }

    pub(crate) fn set_label(&self, _label: bun_core::String) {
        match *self {}
    }
}

impl GPUDevice {
    pub(crate) fn create_bind_group_layout<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUBindGroupLayoutDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        for entry in &descriptor.entries {
            if let Some(storage_texture) = &entry.storage_texture {
                self.state.validate_format(heap, storage_texture.format)?;
            }
        }
        let label = descriptor.label.to_utf8();
        let mut external_texture = sys::WGPUExternalTextureBindingLayout::INIT;
        let entries: Vec<sys::WGPUBindGroupLayoutEntry> = descriptor
            .entries
            .iter()
            .map(|entry| {
                // In `INIT` none of the five is used.
                let mut sys_entry = sys::WGPUBindGroupLayoutEntry {
                    binding: entry.binding,
                    visibility: entry.visibility.into(),
                    ..sys::WGPUBindGroupLayoutEntry::INIT
                };
                if let Some(buffer) = &entry.buffer {
                    sys_entry.buffer = sys::WGPUBufferBindingLayout {
                        r#type: buffer.r#type.to_sys(),
                        hasDynamicOffset: to_sys_bool(buffer.has_dynamic_offset),
                        minBindingSize: buffer.min_binding_size,
                        ..sys::WGPUBufferBindingLayout::INIT
                    };
                }
                if let Some(sampler) = &entry.sampler {
                    sys_entry.sampler = sys::WGPUSamplerBindingLayout {
                        r#type: sampler.r#type.to_sys(),
                        ..sys::WGPUSamplerBindingLayout::INIT
                    };
                }
                if let Some(texture) = &entry.texture {
                    sys_entry.texture = sys::WGPUTextureBindingLayout {
                        sampleType: texture.sample_type.to_sys(),
                        viewDimension: texture.view_dimension.to_sys(),
                        multisampled: to_sys_bool(texture.multisampled),
                        ..sys::WGPUTextureBindingLayout::INIT
                    };
                }
                if let Some(storage_texture) = &entry.storage_texture {
                    sys_entry.storageTexture = sys::WGPUStorageTextureBindingLayout {
                        access: storage_texture.access.to_sys(),
                        format: storage_texture.format.to_sys(),
                        viewDimension: storage_texture.view_dimension.to_sys(),
                        ..sys::WGPUStorageTextureBindingLayout::INIT
                    };
                }
                if entry.external_texture.is_some() {
                    sys_entry.nextInChain = (&raw mut external_texture).cast();
                }
                sys_entry
            })
            .collect();
        let sys_descriptor = sys::WGPUBindGroupLayoutDescriptor {
            label: string_view(&label),
            entryCount: entries.len(),
            entries: entries.as_ptr(),
            ..sys::WGPUBindGroupLayoutDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle =
            unsafe { sys::wgpuDeviceCreateBindGroupLayout(self.handle, &raw const sys_descriptor) };
        Ok(new_object(
            heap,
            GPUBindGroupLayout::new(handle, &descriptor.label, self.device_ref()),
        ))
    }

    pub(crate) fn create_pipeline_layout(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUPipelineLayoutDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let layouts: Vec<sys::WGPUBindGroupLayout> = descriptor
            .bind_group_layouts
            .iter()
            .map(|layout| {
                layout
                    .as_ref()
                    .map_or(core::ptr::null_mut(), |layout| layout.handle)
            })
            .collect();
        let sys_descriptor = sys::WGPUPipelineLayoutDescriptor {
            label: string_view(&label),
            bindGroupLayoutCount: layouts.len(),
            bindGroupLayouts: layouts.as_ptr(),
            immediateSize: descriptor.immediate_size,
            ..sys::WGPUPipelineLayoutDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle =
            unsafe { sys::wgpuDeviceCreatePipelineLayout(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUPipelineLayout::new(handle, &descriptor.label, self.device_ref()),
        )
    }

    pub(crate) fn create_bind_group(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUBindGroupDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let mut views = DefaultViews::default();
        let entries: Vec<sys::WGPUBindGroupEntry> = descriptor
            .entries
            .iter()
            .map(|entry| {
                let mut sys_entry = sys::WGPUBindGroupEntry {
                    binding: entry.binding,
                    ..sys::WGPUBindGroupEntry::INIT
                };
                match &entry.resource {
                    GPUBindingResource::Sampler(sampler) => sys_entry.sampler = sampler.handle,
                    GPUBindingResource::Texture(texture) => {
                        sys_entry.textureView = views.of(texture);
                    }
                    GPUBindingResource::TextureView(view) => sys_entry.textureView = view.handle,
                    GPUBindingResource::Buffer(buffer) => sys_entry.buffer = buffer.handle,
                    GPUBindingResource::BufferBinding(binding) => {
                        sys_entry.buffer = binding.buffer.handle;
                        sys_entry.offset = binding.offset;
                        sys_entry.size = binding.size.unwrap_or(sys::WGPU_WHOLE_SIZE);
                    }
                }
                sys_entry
            })
            .collect();
        let sys_descriptor = sys::WGPUBindGroupDescriptor {
            label: string_view(&label),
            layout: descriptor.layout.handle,
            entryCount: entries.len(),
            entries: entries.as_ptr(),
            ..sys::WGPUBindGroupDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle =
            unsafe { sys::wgpuDeviceCreateBindGroup(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUBindGroup::new(handle, &descriptor.label, self.device_ref()),
        )
    }
}
