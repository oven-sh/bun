//! `GPUBindGroupLayout`, `GPUPipelineLayout`, `GPUBindGroup`.

use std::borrow::Cow;
use std::num::NonZeroU64;

use bun_jsc::{JSGlobalObject, JSValue, JsCell, JsClass, JsResult};
use bun_webgpu::names;
use bun_webgpu::wgc::binding_model as bm;
use bun_webgpu::{GpuError, instance, wgc, wgt};

use super::args::{self, Dict};
use super::device::DeviceRef;
use super::{GPUBuffer, GPUSampler, GPUTexture, GPUTextureView};

#[bun_jsc::JsClass]
pub struct GPUBindGroupLayout {
    raw: bun_webgpu::BindGroupLayout,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUBindGroupLayout, label);

fn parse_buffer_binding_type(s: &[u8]) -> Option<wgt::BufferBindingType> {
    match s {
        b"uniform" => Some(wgt::BufferBindingType::Uniform),
        b"storage" => Some(wgt::BufferBindingType::Storage { read_only: false }),
        b"read-only-storage" => Some(wgt::BufferBindingType::Storage { read_only: true }),
        _ => None,
    }
}

fn parse_sampler_binding_type(s: &[u8]) -> Option<wgt::SamplerBindingType> {
    match s {
        b"filtering" => Some(wgt::SamplerBindingType::Filtering),
        b"non-filtering" => Some(wgt::SamplerBindingType::NonFiltering),
        b"comparison" => Some(wgt::SamplerBindingType::Comparison),
        _ => None,
    }
}

fn parse_texture_sample_type(s: &[u8]) -> Option<wgt::TextureSampleType> {
    match s {
        b"float" => Some(wgt::TextureSampleType::Float { filterable: true }),
        b"unfilterable-float" => Some(wgt::TextureSampleType::Float { filterable: false }),
        b"depth" => Some(wgt::TextureSampleType::Depth),
        b"sint" => Some(wgt::TextureSampleType::Sint),
        b"uint" => Some(wgt::TextureSampleType::Uint),
        _ => None,
    }
}

impl GPUBindGroupLayout {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::BindGroupLayoutId {
        self.raw.id()
    }

    pub(crate) fn wrap(global: &JSGlobalObject, raw: bun_webgpu::BindGroupLayout) -> JSValue {
        GPUBindGroupLayout {
            raw,
            label: JsCell::new(bun_core::String::EMPTY),
        }
        .to_js(global)
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUBindGroupLayoutDescriptor")?;
        let label = d.label()?;
        let mut entries = Vec::new();
        // An entry with no binding type, or several, has no wgpu spelling: validation error, invalid layout.
        let mut malformed: Option<u32> = None;
        d.require_each("entries", |item| {
            let e = Dict::new(global, item, "GPUBindGroupLayoutEntry")?;
            let binding = e.require_u32("binding")?;
            let visibility = e.require_u32("visibility")?;
            let unknown_stage = visibility & !0x7 != 0;
            let visibility = wgt::ShaderStages::from_bits_truncate(visibility & 0x7);
            let mut ty = None;
            let mut members = 0u32;
            if let Some(b) = e.dict("buffer", "GPUBufferBindingLayout")? {
                members += 1;
                ty = Some(wgt::BindingType::Buffer {
                    ty: b.enum_or(
                        "type",
                        "GPUBufferBindingType",
                        parse_buffer_binding_type,
                        wgt::BufferBindingType::Uniform,
                    )?,
                    has_dynamic_offset: b.bool_or("hasDynamicOffset", false)?,
                    min_binding_size: NonZeroU64::new(b.u64_or("minBindingSize", 0)?),
                });
            }
            if let Some(s) = e.dict("sampler", "GPUSamplerBindingLayout")? {
                members += 1;
                ty = Some(wgt::BindingType::Sampler(s.enum_or(
                    "type",
                    "GPUSamplerBindingType",
                    parse_sampler_binding_type,
                    wgt::SamplerBindingType::Filtering,
                )?));
            }
            if let Some(t) = e.dict("texture", "GPUTextureBindingLayout")? {
                members += 1;
                ty = Some(wgt::BindingType::Texture {
                    sample_type: t.enum_or(
                        "sampleType",
                        "GPUTextureSampleType",
                        parse_texture_sample_type,
                        wgt::TextureSampleType::Float { filterable: true },
                    )?,
                    view_dimension: t.enum_or(
                        "viewDimension",
                        "GPUTextureViewDimension",
                        names::parse_texture_view_dimension,
                        wgt::TextureViewDimension::D2,
                    )?,
                    multisampled: t.bool_or("multisampled", false)?,
                });
            }
            if let Some(t) = e.dict("storageTexture", "GPUStorageTextureBindingLayout")? {
                members += 1;
                ty = Some(wgt::BindingType::StorageTexture {
                    access: t.enum_or(
                        "access",
                        "GPUStorageTextureAccess",
                        names::parse_storage_texture_access,
                        wgt::StorageTextureAccess::WriteOnly,
                    )?,
                    format: {
                        let format = t.require_enum(
                            "format",
                            "GPUTextureFormat",
                            names::parse_texture_format,
                        )?;
                        device.check_format(global, format, "createBindGroupLayout")?;
                        format
                    },
                    view_dimension: t.enum_or(
                        "viewDimension",
                        "GPUTextureViewDimension",
                        names::parse_texture_view_dimension,
                        wgt::TextureViewDimension::D2,
                    )?,
                });
            }
            if e.get("externalTexture")?.is_some() {
                members += 1;
                ty = None;
            }
            match (members, ty) {
                (1, Some(ty)) if !unknown_stage => entries.push(wgt::BindGroupLayoutEntry {
                    binding,
                    visibility,
                    ty,
                    count: None,
                }),
                _ => malformed = malformed.or(Some(binding)),
            }
            Ok(())
        })?;

        if let Some(binding) = malformed {
            device.report(
                global,
                GpuError::validation(format!(
                    "createBindGroupLayout: entry {binding} has to set exactly one of buffer, sampler, texture, storageTexture (externalTexture is not supported), and only GPUShaderStage bits in visibility"
                )),
            )?;
            // wgpu-core hands out an invalid layout only from a failed creation: two entries on one binding.
            let conflict = wgt::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgt::ShaderStages::NONE,
                ty: wgt::BindingType::Sampler(wgt::SamplerBindingType::Filtering),
                count: None,
            };
            entries = vec![conflict, conflict];
        }
        let desc = bm::BindGroupLayoutDescriptor {
            label: super::wgpu_label(&label),
            entries: Cow::Owned(entries),
        };
        let (id, err) = instance().device_create_bind_group_layout(device.id(), &desc, None);
        let raw = bun_webgpu::BindGroupLayout::new(id);
        if malformed.is_none() {
            device.check(global, err)?;
        }
        Ok(GPUBindGroupLayout {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

#[bun_jsc::JsClass]
pub struct GPUPipelineLayout {
    raw: bun_webgpu::PipelineLayout,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUPipelineLayout, label);

impl GPUPipelineLayout {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::PipelineLayoutId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUPipelineLayoutDescriptor")?;
        let label = d.label()?;
        let mut layouts = Vec::new();
        d.require_each("bindGroupLayouts", |item| {
            if item.is_undefined_or_null() {
                layouts.push(None);
            } else {
                let layout = args::to_class::<GPUBindGroupLayout>(
                    global,
                    item,
                    "GPUPipelineLayoutDescriptor.bindGroupLayouts",
                    "GPUBindGroupLayout",
                )?;
                layouts.push(Some(layout.id()));
            }
            Ok(())
        })?;
        let desc = bm::PipelineLayoutDescriptor {
            label: super::wgpu_label(&label),
            bind_group_layouts: Cow::Owned(layouts),
            immediate_size: 0,
        };
        let (id, err) = instance().device_create_pipeline_layout(device.id(), &desc, None);
        let raw = bun_webgpu::PipelineLayout::new(id);
        device.check(global, err)?;
        Ok(GPUPipelineLayout {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

#[bun_jsc::JsClass]
pub struct GPUBindGroup {
    raw: bun_webgpu::BindGroup,
    label: JsCell<bun_core::String>,
}

super::gpu_object!(GPUBindGroup, label);

impl GPUBindGroup {
    #[inline]
    pub(crate) fn id(&self) -> wgc::id::BindGroupId {
        self.raw.id()
    }

    pub(crate) fn create(
        global: &JSGlobalObject,
        device: &DeviceRef,
        descriptor: JSValue,
    ) -> JsResult<JSValue> {
        let d = Dict::new(global, descriptor, "GPUBindGroupDescriptor")?;
        let label = d.label()?;
        let layout = d
            .require_class::<GPUBindGroupLayout>("layout", "GPUBindGroupLayout")?
            .id();
        let mut entries: Vec<bm::BindGroupEntry<'static>> = Vec::new();
        // Views made here for `resource: GPUTexture`; the bind group keeps what it needs once it exists.
        let mut implicit_views = Vec::new();
        d.require_each("entries", |item| {
            let e = Dict::new(global, item, "GPUBindGroupEntry")?;
            let binding = e.require_u32("binding")?;
            let resource = e.require("resource")?;
            let resource = if let Some(sampler) = resource.as_class_ref::<GPUSampler>() {
                bm::BindingResource::Sampler(sampler.id())
            } else if let Some(view) = resource.as_class_ref::<GPUTextureView>() {
                bm::BindingResource::TextureView(view.id())
            } else if let Some(texture) = resource.as_class_ref::<GPUTexture>() {
                let desc = wgc::resource::TextureViewDescriptor::default();
                let (id, err) = instance().texture_create_view(texture.id(), &desc, None);
                implicit_views.push(bun_webgpu::TextureView::new(id));
                device.check(global, err)?;
                bm::BindingResource::TextureView(id)
            } else if let Some(buffer) = resource.as_class_ref::<GPUBuffer>() {
                bm::BindingResource::Buffer(bm::BufferBinding {
                    buffer: buffer.id(),
                    offset: 0,
                    size: None,
                })
            } else {
                let b = Dict::new(global, resource, "GPUBufferBinding")?;
                let buffer = b.require_class::<GPUBuffer>("buffer", "GPUBuffer")?;
                bm::BindingResource::Buffer(bm::BufferBinding {
                    buffer: buffer.id(),
                    offset: b.u64_or("offset", 0)?,
                    size: b.u64("size")?,
                })
            };
            entries.push(bm::BindGroupEntry { binding, resource });
            Ok(())
        })?;
        let desc = bm::BindGroupDescriptor {
            label: super::wgpu_label(&label),
            layout,
            entries: Cow::Owned(entries),
        };
        let (id, err) = instance().device_create_bind_group(device.id(), &desc, None);
        let raw = bun_webgpu::BindGroup::new(id);
        drop(implicit_views);
        device.check(global, err)?;
        Ok(GPUBindGroup {
            raw,
            label: JsCell::new(label),
        }
        .to_js(global))
    }
}

/// `setBindGroup(index, bindGroup, offsets?)` or `(index, bindGroup, Uint32Array, start, length)`.
pub(crate) fn parse_set_bind_group(
    global: &JSGlobalObject,
    callframe: &bun_jsc::CallFrame,
) -> JsResult<(u32, Option<wgc::id::BindGroupId>, Vec<u32>)> {
    let index = args::to_u32(global, callframe.argument(0), "setBindGroup: index")?;
    let bind_group = match callframe.argument(1) {
        v if v.is_undefined_or_null() => None,
        v => Some(args::to_class::<GPUBindGroup>(global, v, "setBindGroup", "GPUBindGroup")?.id()),
    };
    let offsets_arg = callframe.argument(2);
    let mut offsets = Vec::new();
    if offsets_arg.is_undefined() {
        return Ok((index, bind_group, offsets));
    }
    // WebIDL picks the overload by argument count: a three-argument Uint32Array is a plain sequence.
    let is_uint32_array = offsets_arg.js_type() == bun_jsc::JSType::Uint32Array;
    let windowed = callframe.arguments_count() > 3;
    if windowed && !is_uint32_array {
        return Err(global.throw_type_error(format_args!(
            "setBindGroup: dynamicOffsetsData has to be a Uint32Array"
        )));
    }
    if is_uint32_array {
        let (start, length) = if windowed {
            (
                args::to_u64(
                    global,
                    callframe.argument(3),
                    "setBindGroup: dynamicOffsetsDataStart",
                )?,
                Some(args::to_u32(
                    global,
                    callframe.argument(4),
                    "setBindGroup: dynamicOffsetsDataLength",
                )?),
            )
        } else {
            (0, None)
        };
        // Read the view last: the conversions above can run script that detaches it.
        let Some(view) = offsets_arg.as_array_buffer(global) else {
            return Ok((index, bind_group, offsets));
        };
        let bytes = view.byte_slice();
        let count = (bytes.len() / 4) as u64;
        let length = length.map_or_else(|| count.saturating_sub(start), u64::from);
        if start > count || length > count - start {
            return Err(global.throw_value(global.create_range_error_instance(format_args!(
                "setBindGroup: dynamicOffsetsDataStart + dynamicOffsetsDataLength is past the end of dynamicOffsetsData"
            ))));
        }
        let start = start as usize * 4;
        let (words, _) = bytes[start..start + length as usize * 4].as_chunks::<4>();
        offsets.extend(words.iter().map(|word| u32::from_ne_bytes(*word)));
        return Ok((index, bind_group, offsets));
    }
    args::for_each(
        global,
        offsets_arg,
        "setBindGroup: dynamicOffsets",
        |item| {
            offsets.push(args::to_u32(global, item, "setBindGroup: dynamicOffsets")?);
            Ok(())
        },
    )?;
    Ok((index, bind_group, offsets))
}
