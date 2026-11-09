use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap};

use super::device::DeviceRef;
use super::{
    GPUDevice, WebEnum as _, extent_to_sys, gpu_object, new_object, optional_to_sys, string_view,
    sys,
};
use crate::generated_bindgen::webgpu::{
    GPUQuerySetDescriptor, GPUQueryType, GPUSamplerDescriptor, GPUTextureDescriptor,
    GPUTextureDimension, GPUTextureFormat, GPUTextureViewDescriptor, GPUTextureViewDimension,
};

// ───────────────────────────── GPUTexture ─────────────────────────────

gpu_object! {
    GPUTexture {
        handle: WGPUTexture,
        release: wgpuTextureRelease,
        set_label: wgpuTextureSetLabel,
        device: DeviceRef,
        dimension: GPUTextureDimension,
        format: GPUTextureFormat,
        estimated_size: usize,
    }
}

gpu_object! {
    GPUTextureView {
        handle: WGPUTextureView,
        release: wgpuTextureViewRelease,
        set_label: wgpuTextureViewSetLabel,
        _device: DeviceRef,
    }
}

impl GPUDevice {
    pub(crate) fn create_texture<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUTextureDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        self.state.validate_format(heap, descriptor.format)?;
        for format in &descriptor.view_formats {
            self.state.validate_format(heap, *format)?;
        }
        let label = descriptor.label.to_utf8();
        let view_formats: Vec<sys::WGPUTextureFormat> = descriptor
            .view_formats
            .iter()
            .map(|format| format.to_sys())
            .collect();
        let mut binding_view_dimension = sys::WGPUTextureBindingViewDimension::INIT;
        let mut sys_descriptor = sys::WGPUTextureDescriptor {
            label: string_view(&label),
            usage: descriptor.usage.into(),
            dimension: descriptor.dimension.to_sys(),
            size: extent_to_sys(heap, &descriptor.size)?,
            format: descriptor.format.to_sys(),
            mipLevelCount: descriptor.mip_level_count,
            sampleCount: descriptor.sample_count,
            viewFormatCount: view_formats.len(),
            viewFormats: view_formats.as_ptr(),
            ..sys::WGPUTextureDescriptor::INIT
        };
        if let Some(dimension) = descriptor.texture_binding_view_dimension {
            binding_view_dimension.textureBindingViewDimension = dimension.to_sys();
            sys_descriptor.nextInChain = (&raw mut binding_view_dimension).cast();
        }
        // SAFETY: a live device, and a descriptor that outlives the call with all it points at.
        let handle =
            unsafe { sys::wgpuDeviceCreateTexture(self.handle, &raw const sys_descriptor) };
        // Most formats have 4 bytes for a texel, and none has more than 16.
        let size = sys_descriptor.size;
        let estimated_size = [
            size.height,
            size.depthOrArrayLayers,
            descriptor.sample_count,
            4,
        ]
        .into_iter()
        .fold(size.width as usize, |bytes, factor| {
            bytes.saturating_mul(factor as usize)
        });
        let texture = GPUTexture::new(
            handle,
            &descriptor.label,
            self.device_ref(),
            descriptor.dimension,
            descriptor.format,
            estimated_size,
        );
        Ok(new_object(heap, texture))
    }
}

/// Where a view is asked for, a texture stands for the view of all of it. These are made for one call.
#[derive(Default)]
pub(super) struct DefaultViews(Vec<sys::WGPUTextureView>);

impl DefaultViews {
    pub(super) fn of(&mut self, texture: &GPUTexture) -> sys::WGPUTextureView {
        // SAFETY: a live texture.
        let view = unsafe { sys::wgpuTextureCreateView(texture.handle, core::ptr::null()) };
        self.0.push(view);
        view
    }
}

impl Drop for DefaultViews {
    fn drop(&mut self) {
        for &view in &self.0 {
            // SAFETY: the reference that `of` was given.
            unsafe { sys::wgpuTextureViewRelease(view) };
        }
    }
}

fn swizzle_to_sys(swizzle: &[u8]) -> Option<sys::WGPUTextureComponentSwizzle> {
    let component = |character: u8| {
        Some(match character {
            b'r' => sys::WGPUComponentSwizzle::R,
            b'g' => sys::WGPUComponentSwizzle::G,
            b'b' => sys::WGPUComponentSwizzle::B,
            b'a' => sys::WGPUComponentSwizzle::A,
            b'0' => sys::WGPUComponentSwizzle::Zero,
            b'1' => sys::WGPUComponentSwizzle::One,
            _ => return None,
        })
    };
    let &[r, g, b, a] = swizzle else { return None };
    Some(sys::WGPUTextureComponentSwizzle {
        r: component(r)?,
        g: component(g)?,
        b: component(b)?,
        a: component(a)?,
    })
}

impl GPUTexture {
    /// Read by the GC's threads.
    pub(crate) fn estimated_size(&self) -> usize {
        self.estimated_size
    }

    pub(crate) fn create_view<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUTextureViewDescriptor<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        if let Some(format) = descriptor.format {
            self.device.state.validate_format(heap, format)?;
        }
        let label = descriptor.label.to_utf8();
        let mut swizzle = sys::WGPUTextureComponentSwizzleDescriptor::INIT;
        let mut sys_descriptor = sys::WGPUTextureViewDescriptor {
            label: string_view(&label),
            format: optional_to_sys!(descriptor.format, WGPUTextureFormat),
            dimension: optional_to_sys!(descriptor.dimension, WGPUTextureViewDimension),
            baseMipLevel: descriptor.base_mip_level,
            mipLevelCount: descriptor
                .mip_level_count
                .unwrap_or(sys::WGPU_MIP_LEVEL_COUNT_UNDEFINED),
            baseArrayLayer: descriptor.base_array_layer,
            arrayLayerCount: descriptor
                .array_layer_count
                .unwrap_or(sys::WGPU_ARRAY_LAYER_COUNT_UNDEFINED),
            aspect: descriptor.aspect.to_sys(),
            usage: descriptor.usage.into(),
            ..sys::WGPUTextureViewDescriptor::INIT
        };
        // Dawn takes one only with the feature, and this one says nothing.
        if descriptor.swizzle != b"rgba" {
            swizzle.swizzle = swizzle_to_sys(descriptor.swizzle).ok_or_else(|| {
                heap.type_error(format_args!(
                    "swizzle is 4 characters, each one of \"r\", \"g\", \"b\", \"a\", \"0\" and \"1\""
                ))
            })?;
            sys_descriptor.nextInChain = (&raw mut swizzle).cast();
        }
        // SAFETY: a live texture, and a descriptor that outlives the call with all it points at.
        let handle = unsafe { sys::wgpuTextureCreateView(self.handle, &raw const sys_descriptor) };
        Ok(new_object(
            heap,
            GPUTextureView::new(handle, &descriptor.label, self.device.clone()),
        ))
    }

    pub(crate) fn destroy(&self) {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureDestroy(self.handle) };
    }

    pub(crate) fn get_width(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetWidth(self.handle) }
    }
    pub(crate) fn get_height(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetHeight(self.handle) }
    }
    pub(crate) fn get_depth_or_array_layers(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetDepthOrArrayLayers(self.handle) }
    }
    pub(crate) fn get_mip_level_count(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetMipLevelCount(self.handle) }
    }
    pub(crate) fn get_sample_count(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetSampleCount(self.handle) }
    }
    pub(crate) fn get_dimension(&self) -> GPUTextureDimension {
        self.dimension
    }
    pub(crate) fn get_format(&self) -> GPUTextureFormat {
        self.format
    }
    pub(crate) fn get_usage(&self) -> u32 {
        // SAFETY: a live texture.
        unsafe { sys::wgpuTextureGetUsage(self.handle) as u32 }
    }
    pub(crate) fn get_texture_binding_view_dimension(&self) -> Option<GPUTextureViewDimension> {
        // SAFETY: a live texture.
        GPUTextureViewDimension::from_sys(unsafe {
            sys::wgpuTextureGetTextureBindingViewDimension(self.handle)
        })
    }
}

// ───────────────────────────── GPUSampler ─────────────────────────────

gpu_object! {
    GPUSampler {
        handle: WGPUSampler,
        release: wgpuSamplerRelease,
        set_label: wgpuSamplerSetLabel,
        _device: DeviceRef,
    }
}

impl GPUDevice {
    pub(crate) fn create_sampler(
        &self,
        heap: &JsHeap<'_>,
        descriptor: &GPUSamplerDescriptor,
    ) -> JSValue {
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPUSamplerDescriptor {
            label: string_view(&label),
            addressModeU: descriptor.address_mode_u.to_sys(),
            addressModeV: descriptor.address_mode_v.to_sys(),
            addressModeW: descriptor.address_mode_w.to_sys(),
            magFilter: descriptor.mag_filter.to_sys(),
            minFilter: descriptor.min_filter.to_sys(),
            mipmapFilter: descriptor.mipmap_filter.to_sys(),
            lodMinClamp: descriptor.lod_min_clamp,
            lodMaxClamp: descriptor.lod_max_clamp,
            compare: optional_to_sys!(descriptor.compare, WGPUCompareFunction),
            maxAnisotropy: descriptor.max_anisotropy,
            ..sys::WGPUSamplerDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call.
        let handle =
            unsafe { sys::wgpuDeviceCreateSampler(self.handle, &raw const sys_descriptor) };
        new_object(
            heap,
            GPUSampler::new(handle, &descriptor.label, self.device_ref()),
        )
    }
}

// ───────────────────────────── GPUQuerySet ─────────────────────────────

gpu_object! {
    GPUQuerySet {
        handle: WGPUQuerySet,
        release: wgpuQuerySetRelease,
        set_label: wgpuQuerySetSetLabel,
        _device: DeviceRef,
        kind: GPUQueryType,
        count: u32,
    }
}

impl GPUDevice {
    pub(crate) fn create_query_set<'a>(
        &self,
        heap: &JsHeap<'a>,
        descriptor: &GPUQuerySetDescriptor,
    ) -> bindgen::Result<'a, JSValue> {
        self.state.validate_query_type(heap, descriptor.r#type)?;
        let label = descriptor.label.to_utf8();
        let sys_descriptor = sys::WGPUQuerySetDescriptor {
            label: string_view(&label),
            r#type: descriptor.r#type.to_sys(),
            count: descriptor.count,
            ..sys::WGPUQuerySetDescriptor::INIT
        };
        // SAFETY: a live device, and a descriptor that outlives the call.
        let handle =
            unsafe { sys::wgpuDeviceCreateQuerySet(self.handle, &raw const sys_descriptor) };
        let query_set = GPUQuerySet::new(
            handle,
            &descriptor.label,
            self.device_ref(),
            descriptor.r#type,
            descriptor.count,
        );
        Ok(new_object(heap, query_set))
    }
}

impl GPUQuerySet {
    pub(crate) fn destroy(&self) {
        // SAFETY: a live query set.
        unsafe { sys::wgpuQuerySetDestroy(self.handle) };
    }
    pub(crate) fn get_type(&self) -> GPUQueryType {
        self.kind
    }
    pub(crate) fn get_count(&self) -> u32 {
        self.count
    }
}
