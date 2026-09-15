//! `GPUTexture`, `GPUTextureView`, `GPUSampler`, and the texel-copy
//! dictionaries the queue and the command encoder share.

use std::cell::Cell;
use std::rc::Rc;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsCell, JsClass, JsResult, StringJsc as _};
use bun_webgpu::names;
use bun_webgpu::{GpuError, instance, wgc, wgt};

use super::args::{self, Dict};
use super::device::DeviceRef;

/// Every `GPUTextureUsage` bit the spec defines.
const ALL_USAGES: u32 = 0x1F;

#[bun_jsc::JsClass]
pub struct GPUTexture {
    device: DeviceRef,
    raw: bun_webgpu::Texture,
    label: JsCell<bun_core::String>,
    size: wgt::Extent3d,
    mip_level_count: u32,
    sample_count: u32,
    dimension: wgt::TextureDimension,
    format: wgt::TextureFormat,
    usage: u32,
    destroyed: Cell<bool>,
}

super::gpu_object!(GPUTexture, label);

impl GPUTexture {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::TextureId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::required(global, descriptor, "GPUTextureDescriptor")?;
        let label = d.label()?;
        let size = args::to_extent3d(global, d.require("size")?, "GPUTextureDescriptor.size")?;
        let mip_level_count = d.u32_or("mipLevelCount", 1)?;
        let sample_count = d.u32_or("sampleCount", 1)?;
        let dimension = d.enum_or(
            "dimension",
            "GPUTextureDimension",
            names::parse_texture_dimension,
            wgt::TextureDimension::D2,
        )?;
        let format = d.require_enum("format", "GPUTextureFormat", names::parse_texture_format)?;
        let usage = d.require_u32("usage")?;
        let mut view_formats = Vec::new();
        d.each("viewFormats", |item| {
            view_formats.push(args::to_enum(
                global,
                item,
                "GPUTextureDescriptor.viewFormats",
                "GPUTextureFormat",
                names::parse_texture_format,
            )?);
            Ok(())
        })?;

        let desc = wgc::resource::TextureDescriptor {
            label: super::wgpu_label(&label),
            size,
            mip_level_count,
            sample_count,
            dimension,
            format,
            usage: wgt::TextureUsages::from_bits_truncate(usage & ALL_USAGES),
            view_formats,
        };
        let raw = if usage & !ALL_USAGES != 0 {
            device.report(
                global,
                GpuError::validation(format!(
                    "createTexture: usage 0x{usage:x} has bits that are not a GPUTextureUsage"
                )),
            )?;
            bun_webgpu::Texture::new(instance().create_texture_error(device.id(), None, &desc))
        } else {
            let (id, err) = instance().device_create_texture(device.id(), &desc, None);
            let raw = bun_webgpu::Texture::new(id);
            device.check(global, err)?;
            raw
        };
        Ok(GPUTexture {
            device: Rc::clone(device),
            raw,
            label: JsCell::new(label),
            size,
            mip_level_count,
            sample_count,
            dimension,
            format,
            usage,
            destroyed: Cell::new(false),
        }
        .to_js(global))
    }

    pub(crate) fn create_view(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, callframe.argument(0), "GPUTextureViewDescriptor")?;
        let label = d.label()?;
        let usage = d.u32_or("usage", 0)?;
        let desc = wgc::resource::TextureViewDescriptor {
            label: super::wgpu_label(&label),
            format: d.enum_("format", "GPUTextureFormat", names::parse_texture_format)?,
            dimension: d.enum_(
                "dimension",
                "GPUTextureViewDimension",
                names::parse_texture_view_dimension,
            )?,
            usage: if usage == 0 {
                None
            } else {
                Some(wgt::TextureUsages::from_bits_truncate(usage & ALL_USAGES))
            },
            range: wgt::ImageSubresourceRange {
                aspect: d.enum_or(
                    "aspect",
                    "GPUTextureAspect",
                    names::parse_texture_aspect,
                    wgt::TextureAspect::All,
                )?,
                base_mip_level: d.u32_or("baseMipLevel", 0)?,
                mip_level_count: d.u32("mipLevelCount")?,
                base_array_layer: d.u32_or("baseArrayLayer", 0)?,
                array_layer_count: d.u32("arrayLayerCount")?,
            },
        };
        let (id, err) = instance().texture_create_view(self.raw.id(), &desc, None);
        let raw = bun_webgpu::TextureView::new(id);
        self.device.check(global, err)?;
        Ok(GPUTextureView {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }

    pub(crate) fn destroy(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if !self.destroyed.replace(true) {
            instance().texture_destroy(self.raw.id());
        }
        Ok(JSValue::UNDEFINED)
    }

    /// A rough figure for the collector: four bytes per texel of the base level and a third
    /// more for the mip chain.
    pub(crate) fn estimated_size(&self) -> usize {
        let texels = u64::from(self.size.width)
            .saturating_mul(u64::from(self.size.height))
            .saturating_mul(u64::from(self.size.depth_or_array_layers))
            .saturating_mul(u64::from(self.sample_count.max(1)));
        let bytes = texels.saturating_mul(4);
        let bytes = if self.mip_level_count > 1 {
            bytes.saturating_add(bytes / 3)
        } else {
            bytes
        };
        core::mem::size_of::<Self>().saturating_add(usize::try_from(bytes).unwrap_or(usize::MAX))
    }

    pub(crate) fn get_width(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.size.width))
    }

    pub(crate) fn get_height(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.size.height))
    }

    pub(crate) fn get_depth_or_array_layers(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.size.depth_or_array_layers))
    }

    pub(crate) fn get_mip_level_count(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.mip_level_count))
    }

    pub(crate) fn get_sample_count(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.sample_count))
    }

    pub(crate) fn get_dimension(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_core::String::static_(names::texture_dimension_name(self.dimension)).to_js(global)
    }

    pub(crate) fn get_format(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_core::String::static_(names::texture_format_name(self.format)).to_js(global)
    }

    pub(crate) fn get_usage(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(u64::from(self.usage))
    }
}

#[bun_jsc::JsClass]
pub struct GPUTextureView {
    raw: bun_webgpu::TextureView,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUTextureView, label);

impl GPUTextureView {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::TextureViewId {
        self.raw.id()
    }
}

#[bun_jsc::JsClass]
pub struct GPUSampler {
    raw: bun_webgpu::Sampler,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUSampler, label);

impl GPUSampler {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::SamplerId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUSamplerDescriptor")?;
        let label = d.label()?;
        let address_mode = |key: &'static str| {
            d.enum_or(
                key,
                "GPUAddressMode",
                names::parse_address_mode,
                wgt::AddressMode::ClampToEdge,
            )
        };
        let filter = |key: &'static str| {
            d.enum_or(
                key,
                "GPUFilterMode",
                names::parse_filter_mode,
                wgt::FilterMode::Nearest,
            )
        };
        let desc = wgc::resource::SamplerDescriptor {
            label: super::wgpu_label(&label),
            address_modes: [
                address_mode("addressModeU")?,
                address_mode("addressModeV")?,
                address_mode("addressModeW")?,
            ],
            mag_filter: filter("magFilter")?,
            min_filter: filter("minFilter")?,
            mipmap_filter: d.enum_or(
                "mipmapFilter",
                "GPUMipmapFilterMode",
                names::parse_mipmap_filter_mode,
                wgt::MipmapFilterMode::Nearest,
            )?,
            lod_min_clamp: d.f32_or("lodMinClamp", 0.0)?,
            lod_max_clamp: d.f32_or("lodMaxClamp", 32.0)?,
            compare: d.enum_(
                "compare",
                "GPUCompareFunction",
                names::parse_compare_function,
            )?,
            anisotropy_clamp: match d.get("maxAnisotropy")? {
                Some(v) => args::to_u16(global, v, "GPUSamplerDescriptor.maxAnisotropy")?,
                None => 1,
            },
            border_color: None,
        };
        let (id, err) = instance().device_create_sampler(device.id(), &desc, None);
        let raw = bun_webgpu::Sampler::new(id);
        device.check(global, err)?;
        Ok(GPUSampler {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

/// `GPUTexelCopyTextureInfo`.
pub(crate) fn parse_texel_copy_texture_info(
    global: &JSGlobalObject,
    value: JSValue,
    what: &'static str,
) -> JsResult<wgt::TexelCopyTextureInfo<wgc::id::TextureId>> {
    let d = Dict::required(global, value, "GPUTexelCopyTextureInfo")?;
    let texture = d.require_class::<GPUTexture>("texture", "GPUTexture")?;
    Ok(wgt::TexelCopyTextureInfo {
        texture: texture.id(),
        mip_level: d.u32_or("mipLevel", 0)?,
        origin: match d.get("origin")? {
            Some(v) => args::to_origin3d(global, v, what)?,
            None => wgt::Origin3d::ZERO,
        },
        aspect: d.enum_or(
            "aspect",
            "GPUTextureAspect",
            names::parse_texture_aspect,
            wgt::TextureAspect::All,
        )?,
    })
}

/// `GPUTexelCopyBufferLayout`.
pub(crate) fn parse_texel_copy_buffer_layout(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
) -> JsResult<wgt::TexelCopyBufferLayout> {
    let d = Dict::required(global, value, name)?;
    Ok(wgt::TexelCopyBufferLayout {
        offset: d.u64_or("offset", 0)?,
        bytes_per_row: d.u32("bytesPerRow")?,
        rows_per_image: d.u32("rowsPerImage")?,
    })
}

/// `GPUTexelCopyBufferInfo`: the layout members plus the buffer.
pub(crate) fn parse_texel_copy_buffer_info(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<wgt::TexelCopyBufferInfo<wgc::id::BufferId>> {
    let layout = parse_texel_copy_buffer_layout(global, value, "GPUTexelCopyBufferInfo")?;
    let d = Dict::required(global, value, "GPUTexelCopyBufferInfo")?;
    let buffer = d.require_class::<super::GPUBuffer>("buffer", "GPUBuffer")?;
    Ok(wgt::TexelCopyBufferInfo {
        buffer: buffer.id(),
        layout,
    })
}
