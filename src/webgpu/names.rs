//! WebGPU IDL enum strings ⇄ `wgpu_types` enums, spelled as in <https://www.w3.org/TR/webgpu/>.

use crate::wgt;

/// Declares `$parse(&[u8]) -> Option<$ty>` and `$name($ty) -> &'static str` from one table.
macro_rules! string_enum {
    ($parse:ident, $name:ident, $ty:ty, { $($s:literal => $v:expr,)+ }) => {
        pub fn $parse(s: &[u8]) -> Option<$ty> {
            $(if s == $s.as_bytes() { return Some($v); })+
            None
        }
        pub fn $name(v: $ty) -> &'static str {
            $(if v == $v { return $s; })+
            ""
        }
    };
}

/// Parse-only variant for enums that never travel back to JS.
macro_rules! string_enum_in {
    ($parse:ident, $ty:ty, { $($s:literal => $v:expr,)+ }) => {
        pub fn $parse(s: &[u8]) -> Option<$ty> {
            $(if s == $s.as_bytes() { return Some($v); })+
            None
        }
    };
}

string_enum_in!(parse_power_preference, wgt::PowerPreference, {
    "low-power" => wgt::PowerPreference::LowPower,
    "high-performance" => wgt::PowerPreference::HighPerformance,
});

string_enum_in!(parse_address_mode, wgt::AddressMode, {
    "clamp-to-edge" => wgt::AddressMode::ClampToEdge,
    "repeat" => wgt::AddressMode::Repeat,
    "mirror-repeat" => wgt::AddressMode::MirrorRepeat,
});

string_enum_in!(parse_filter_mode, wgt::FilterMode, {
    "nearest" => wgt::FilterMode::Nearest,
    "linear" => wgt::FilterMode::Linear,
});

string_enum_in!(parse_mipmap_filter_mode, wgt::MipmapFilterMode, {
    "nearest" => wgt::MipmapFilterMode::Nearest,
    "linear" => wgt::MipmapFilterMode::Linear,
});

string_enum_in!(parse_compare_function, wgt::CompareFunction, {
    "never" => wgt::CompareFunction::Never,
    "less" => wgt::CompareFunction::Less,
    "equal" => wgt::CompareFunction::Equal,
    "less-equal" => wgt::CompareFunction::LessEqual,
    "greater" => wgt::CompareFunction::Greater,
    "not-equal" => wgt::CompareFunction::NotEqual,
    "greater-equal" => wgt::CompareFunction::GreaterEqual,
    "always" => wgt::CompareFunction::Always,
});

string_enum!(parse_texture_dimension, texture_dimension_name, wgt::TextureDimension, {
    "1d" => wgt::TextureDimension::D1,
    "2d" => wgt::TextureDimension::D2,
    "3d" => wgt::TextureDimension::D3,
});

string_enum_in!(parse_texture_view_dimension, wgt::TextureViewDimension, {
    "1d" => wgt::TextureViewDimension::D1,
    "2d" => wgt::TextureViewDimension::D2,
    "2d-array" => wgt::TextureViewDimension::D2Array,
    "cube" => wgt::TextureViewDimension::Cube,
    "cube-array" => wgt::TextureViewDimension::CubeArray,
    "3d" => wgt::TextureViewDimension::D3,
});

string_enum_in!(parse_texture_aspect, wgt::TextureAspect, {
    "all" => wgt::TextureAspect::All,
    "stencil-only" => wgt::TextureAspect::StencilOnly,
    "depth-only" => wgt::TextureAspect::DepthOnly,
});

string_enum_in!(parse_storage_texture_access, wgt::StorageTextureAccess, {
    "write-only" => wgt::StorageTextureAccess::WriteOnly,
    "read-only" => wgt::StorageTextureAccess::ReadOnly,
    "read-write" => wgt::StorageTextureAccess::ReadWrite,
});

string_enum_in!(parse_primitive_topology, wgt::PrimitiveTopology, {
    "point-list" => wgt::PrimitiveTopology::PointList,
    "line-list" => wgt::PrimitiveTopology::LineList,
    "line-strip" => wgt::PrimitiveTopology::LineStrip,
    "triangle-list" => wgt::PrimitiveTopology::TriangleList,
    "triangle-strip" => wgt::PrimitiveTopology::TriangleStrip,
});

string_enum_in!(parse_front_face, wgt::FrontFace, {
    "ccw" => wgt::FrontFace::Ccw,
    "cw" => wgt::FrontFace::Cw,
});

/// `GPUCullMode`. `"none"` is `Some(None)`.
pub fn parse_cull_mode(s: &[u8]) -> Option<Option<wgt::Face>> {
    match s {
        b"none" => Some(None),
        b"front" => Some(Some(wgt::Face::Front)),
        b"back" => Some(Some(wgt::Face::Back)),
        _ => None,
    }
}

string_enum_in!(parse_index_format, wgt::IndexFormat, {
    "uint16" => wgt::IndexFormat::Uint16,
    "uint32" => wgt::IndexFormat::Uint32,
});

string_enum_in!(parse_vertex_step_mode, wgt::VertexStepMode, {
    "vertex" => wgt::VertexStepMode::Vertex,
    "instance" => wgt::VertexStepMode::Instance,
});

string_enum_in!(parse_blend_factor, wgt::BlendFactor, {
    "zero" => wgt::BlendFactor::Zero,
    "one" => wgt::BlendFactor::One,
    "src" => wgt::BlendFactor::Src,
    "one-minus-src" => wgt::BlendFactor::OneMinusSrc,
    "src-alpha" => wgt::BlendFactor::SrcAlpha,
    "one-minus-src-alpha" => wgt::BlendFactor::OneMinusSrcAlpha,
    "dst" => wgt::BlendFactor::Dst,
    "one-minus-dst" => wgt::BlendFactor::OneMinusDst,
    "dst-alpha" => wgt::BlendFactor::DstAlpha,
    "one-minus-dst-alpha" => wgt::BlendFactor::OneMinusDstAlpha,
    "src-alpha-saturated" => wgt::BlendFactor::SrcAlphaSaturated,
    "constant" => wgt::BlendFactor::Constant,
    "one-minus-constant" => wgt::BlendFactor::OneMinusConstant,
    "src1" => wgt::BlendFactor::Src1,
    "one-minus-src1" => wgt::BlendFactor::OneMinusSrc1,
    "src1-alpha" => wgt::BlendFactor::Src1Alpha,
    "one-minus-src1-alpha" => wgt::BlendFactor::OneMinusSrc1Alpha,
});

string_enum_in!(parse_blend_operation, wgt::BlendOperation, {
    "add" => wgt::BlendOperation::Add,
    "subtract" => wgt::BlendOperation::Subtract,
    "reverse-subtract" => wgt::BlendOperation::ReverseSubtract,
    "min" => wgt::BlendOperation::Min,
    "max" => wgt::BlendOperation::Max,
});

string_enum_in!(parse_stencil_operation, wgt::StencilOperation, {
    "keep" => wgt::StencilOperation::Keep,
    "zero" => wgt::StencilOperation::Zero,
    "replace" => wgt::StencilOperation::Replace,
    "invert" => wgt::StencilOperation::Invert,
    "increment-clamp" => wgt::StencilOperation::IncrementClamp,
    "decrement-clamp" => wgt::StencilOperation::DecrementClamp,
    "increment-wrap" => wgt::StencilOperation::IncrementWrap,
    "decrement-wrap" => wgt::StencilOperation::DecrementWrap,
});

string_enum_in!(parse_vertex_format, wgt::VertexFormat, {
    "uint8" => wgt::VertexFormat::Uint8,
    "uint8x2" => wgt::VertexFormat::Uint8x2,
    "uint8x4" => wgt::VertexFormat::Uint8x4,
    "sint8" => wgt::VertexFormat::Sint8,
    "sint8x2" => wgt::VertexFormat::Sint8x2,
    "sint8x4" => wgt::VertexFormat::Sint8x4,
    "unorm8" => wgt::VertexFormat::Unorm8,
    "unorm8x2" => wgt::VertexFormat::Unorm8x2,
    "unorm8x4" => wgt::VertexFormat::Unorm8x4,
    "snorm8" => wgt::VertexFormat::Snorm8,
    "snorm8x2" => wgt::VertexFormat::Snorm8x2,
    "snorm8x4" => wgt::VertexFormat::Snorm8x4,
    "uint16" => wgt::VertexFormat::Uint16,
    "uint16x2" => wgt::VertexFormat::Uint16x2,
    "uint16x4" => wgt::VertexFormat::Uint16x4,
    "sint16" => wgt::VertexFormat::Sint16,
    "sint16x2" => wgt::VertexFormat::Sint16x2,
    "sint16x4" => wgt::VertexFormat::Sint16x4,
    "unorm16" => wgt::VertexFormat::Unorm16,
    "unorm16x2" => wgt::VertexFormat::Unorm16x2,
    "unorm16x4" => wgt::VertexFormat::Unorm16x4,
    "snorm16" => wgt::VertexFormat::Snorm16,
    "snorm16x2" => wgt::VertexFormat::Snorm16x2,
    "snorm16x4" => wgt::VertexFormat::Snorm16x4,
    "float16" => wgt::VertexFormat::Float16,
    "float16x2" => wgt::VertexFormat::Float16x2,
    "float16x4" => wgt::VertexFormat::Float16x4,
    "float32" => wgt::VertexFormat::Float32,
    "float32x2" => wgt::VertexFormat::Float32x2,
    "float32x3" => wgt::VertexFormat::Float32x3,
    "float32x4" => wgt::VertexFormat::Float32x4,
    "uint32" => wgt::VertexFormat::Uint32,
    "uint32x2" => wgt::VertexFormat::Uint32x2,
    "uint32x3" => wgt::VertexFormat::Uint32x3,
    "uint32x4" => wgt::VertexFormat::Uint32x4,
    "sint32" => wgt::VertexFormat::Sint32,
    "sint32x2" => wgt::VertexFormat::Sint32x2,
    "sint32x3" => wgt::VertexFormat::Sint32x3,
    "sint32x4" => wgt::VertexFormat::Sint32x4,
    "unorm10-10-10-2" => wgt::VertexFormat::Unorm10_10_10_2,
    "unorm8x4-bgra" => wgt::VertexFormat::Unorm8x4Bgra,
});

string_enum!(parse_query_type_name, query_type_name, QueryKind, {
    "occlusion" => QueryKind::Occlusion,
    "timestamp" => QueryKind::Timestamp,
});

/// `GPUQueryType`: `wgt::QueryType` without the native-only pipeline-statistics payload.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum QueryKind {
    Occlusion,
    Timestamp,
}

impl QueryKind {
    pub fn to_wgt(self) -> wgt::QueryType {
        match self {
            QueryKind::Occlusion => wgt::QueryType::Occlusion,
            QueryKind::Timestamp => wgt::QueryType::Timestamp,
        }
    }
}

string_enum!(parse_texture_format, texture_format_name, wgt::TextureFormat, {
    "r8unorm" => wgt::TextureFormat::R8Unorm,
    "r8snorm" => wgt::TextureFormat::R8Snorm,
    "r8uint" => wgt::TextureFormat::R8Uint,
    "r8sint" => wgt::TextureFormat::R8Sint,
    "r16unorm" => wgt::TextureFormat::R16Unorm,
    "r16snorm" => wgt::TextureFormat::R16Snorm,
    "r16uint" => wgt::TextureFormat::R16Uint,
    "r16sint" => wgt::TextureFormat::R16Sint,
    "r16float" => wgt::TextureFormat::R16Float,
    "rg8unorm" => wgt::TextureFormat::Rg8Unorm,
    "rg8snorm" => wgt::TextureFormat::Rg8Snorm,
    "rg8uint" => wgt::TextureFormat::Rg8Uint,
    "rg8sint" => wgt::TextureFormat::Rg8Sint,
    "r32uint" => wgt::TextureFormat::R32Uint,
    "r32sint" => wgt::TextureFormat::R32Sint,
    "r32float" => wgt::TextureFormat::R32Float,
    "rg16unorm" => wgt::TextureFormat::Rg16Unorm,
    "rg16snorm" => wgt::TextureFormat::Rg16Snorm,
    "rg16uint" => wgt::TextureFormat::Rg16Uint,
    "rg16sint" => wgt::TextureFormat::Rg16Sint,
    "rg16float" => wgt::TextureFormat::Rg16Float,
    "rgba8unorm" => wgt::TextureFormat::Rgba8Unorm,
    "rgba8unorm-srgb" => wgt::TextureFormat::Rgba8UnormSrgb,
    "rgba8snorm" => wgt::TextureFormat::Rgba8Snorm,
    "rgba8uint" => wgt::TextureFormat::Rgba8Uint,
    "rgba8sint" => wgt::TextureFormat::Rgba8Sint,
    "bgra8unorm" => wgt::TextureFormat::Bgra8Unorm,
    "bgra8unorm-srgb" => wgt::TextureFormat::Bgra8UnormSrgb,
    "rgb9e5ufloat" => wgt::TextureFormat::Rgb9e5Ufloat,
    "rgb10a2uint" => wgt::TextureFormat::Rgb10a2Uint,
    "rgb10a2unorm" => wgt::TextureFormat::Rgb10a2Unorm,
    "rg11b10ufloat" => wgt::TextureFormat::Rg11b10Ufloat,
    "rg32uint" => wgt::TextureFormat::Rg32Uint,
    "rg32sint" => wgt::TextureFormat::Rg32Sint,
    "rg32float" => wgt::TextureFormat::Rg32Float,
    "rgba16unorm" => wgt::TextureFormat::Rgba16Unorm,
    "rgba16snorm" => wgt::TextureFormat::Rgba16Snorm,
    "rgba16uint" => wgt::TextureFormat::Rgba16Uint,
    "rgba16sint" => wgt::TextureFormat::Rgba16Sint,
    "rgba16float" => wgt::TextureFormat::Rgba16Float,
    "rgba32uint" => wgt::TextureFormat::Rgba32Uint,
    "rgba32sint" => wgt::TextureFormat::Rgba32Sint,
    "rgba32float" => wgt::TextureFormat::Rgba32Float,
    "stencil8" => wgt::TextureFormat::Stencil8,
    "depth16unorm" => wgt::TextureFormat::Depth16Unorm,
    "depth24plus" => wgt::TextureFormat::Depth24Plus,
    "depth24plus-stencil8" => wgt::TextureFormat::Depth24PlusStencil8,
    "depth32float" => wgt::TextureFormat::Depth32Float,
    "depth32float-stencil8" => wgt::TextureFormat::Depth32FloatStencil8,
    "bc1-rgba-unorm" => wgt::TextureFormat::Bc1RgbaUnorm,
    "bc1-rgba-unorm-srgb" => wgt::TextureFormat::Bc1RgbaUnormSrgb,
    "bc2-rgba-unorm" => wgt::TextureFormat::Bc2RgbaUnorm,
    "bc2-rgba-unorm-srgb" => wgt::TextureFormat::Bc2RgbaUnormSrgb,
    "bc3-rgba-unorm" => wgt::TextureFormat::Bc3RgbaUnorm,
    "bc3-rgba-unorm-srgb" => wgt::TextureFormat::Bc3RgbaUnormSrgb,
    "bc4-r-unorm" => wgt::TextureFormat::Bc4RUnorm,
    "bc4-r-snorm" => wgt::TextureFormat::Bc4RSnorm,
    "bc5-rg-unorm" => wgt::TextureFormat::Bc5RgUnorm,
    "bc5-rg-snorm" => wgt::TextureFormat::Bc5RgSnorm,
    "bc6h-rgb-ufloat" => wgt::TextureFormat::Bc6hRgbUfloat,
    "bc6h-rgb-float" => wgt::TextureFormat::Bc6hRgbFloat,
    "bc7-rgba-unorm" => wgt::TextureFormat::Bc7RgbaUnorm,
    "bc7-rgba-unorm-srgb" => wgt::TextureFormat::Bc7RgbaUnormSrgb,
    "etc2-rgb8unorm" => wgt::TextureFormat::Etc2Rgb8Unorm,
    "etc2-rgb8unorm-srgb" => wgt::TextureFormat::Etc2Rgb8UnormSrgb,
    "etc2-rgb8a1unorm" => wgt::TextureFormat::Etc2Rgb8A1Unorm,
    "etc2-rgb8a1unorm-srgb" => wgt::TextureFormat::Etc2Rgb8A1UnormSrgb,
    "etc2-rgba8unorm" => wgt::TextureFormat::Etc2Rgba8Unorm,
    "etc2-rgba8unorm-srgb" => wgt::TextureFormat::Etc2Rgba8UnormSrgb,
    "eac-r11unorm" => wgt::TextureFormat::EacR11Unorm,
    "eac-r11snorm" => wgt::TextureFormat::EacR11Snorm,
    "eac-rg11unorm" => wgt::TextureFormat::EacRg11Unorm,
    "eac-rg11snorm" => wgt::TextureFormat::EacRg11Snorm,
    "astc-4x4-unorm" => astc(wgt::AstcBlock::B4x4, wgt::AstcChannel::Unorm),
    "astc-4x4-unorm-srgb" => astc(wgt::AstcBlock::B4x4, wgt::AstcChannel::UnormSrgb),
    "astc-5x4-unorm" => astc(wgt::AstcBlock::B5x4, wgt::AstcChannel::Unorm),
    "astc-5x4-unorm-srgb" => astc(wgt::AstcBlock::B5x4, wgt::AstcChannel::UnormSrgb),
    "astc-5x5-unorm" => astc(wgt::AstcBlock::B5x5, wgt::AstcChannel::Unorm),
    "astc-5x5-unorm-srgb" => astc(wgt::AstcBlock::B5x5, wgt::AstcChannel::UnormSrgb),
    "astc-6x5-unorm" => astc(wgt::AstcBlock::B6x5, wgt::AstcChannel::Unorm),
    "astc-6x5-unorm-srgb" => astc(wgt::AstcBlock::B6x5, wgt::AstcChannel::UnormSrgb),
    "astc-6x6-unorm" => astc(wgt::AstcBlock::B6x6, wgt::AstcChannel::Unorm),
    "astc-6x6-unorm-srgb" => astc(wgt::AstcBlock::B6x6, wgt::AstcChannel::UnormSrgb),
    "astc-8x5-unorm" => astc(wgt::AstcBlock::B8x5, wgt::AstcChannel::Unorm),
    "astc-8x5-unorm-srgb" => astc(wgt::AstcBlock::B8x5, wgt::AstcChannel::UnormSrgb),
    "astc-8x6-unorm" => astc(wgt::AstcBlock::B8x6, wgt::AstcChannel::Unorm),
    "astc-8x6-unorm-srgb" => astc(wgt::AstcBlock::B8x6, wgt::AstcChannel::UnormSrgb),
    "astc-8x8-unorm" => astc(wgt::AstcBlock::B8x8, wgt::AstcChannel::Unorm),
    "astc-8x8-unorm-srgb" => astc(wgt::AstcBlock::B8x8, wgt::AstcChannel::UnormSrgb),
    "astc-10x5-unorm" => astc(wgt::AstcBlock::B10x5, wgt::AstcChannel::Unorm),
    "astc-10x5-unorm-srgb" => astc(wgt::AstcBlock::B10x5, wgt::AstcChannel::UnormSrgb),
    "astc-10x6-unorm" => astc(wgt::AstcBlock::B10x6, wgt::AstcChannel::Unorm),
    "astc-10x6-unorm-srgb" => astc(wgt::AstcBlock::B10x6, wgt::AstcChannel::UnormSrgb),
    "astc-10x8-unorm" => astc(wgt::AstcBlock::B10x8, wgt::AstcChannel::Unorm),
    "astc-10x8-unorm-srgb" => astc(wgt::AstcBlock::B10x8, wgt::AstcChannel::UnormSrgb),
    "astc-10x10-unorm" => astc(wgt::AstcBlock::B10x10, wgt::AstcChannel::Unorm),
    "astc-10x10-unorm-srgb" => astc(wgt::AstcBlock::B10x10, wgt::AstcChannel::UnormSrgb),
    "astc-12x10-unorm" => astc(wgt::AstcBlock::B12x10, wgt::AstcChannel::Unorm),
    "astc-12x10-unorm-srgb" => astc(wgt::AstcBlock::B12x10, wgt::AstcChannel::UnormSrgb),
    "astc-12x12-unorm" => astc(wgt::AstcBlock::B12x12, wgt::AstcChannel::Unorm),
    "astc-12x12-unorm-srgb" => astc(wgt::AstcBlock::B12x12, wgt::AstcChannel::UnormSrgb),
});

const fn astc(block: wgt::AstcBlock, channel: wgt::AstcChannel) -> wgt::TextureFormat {
    wgt::TextureFormat::Astc { block, channel }
}

/// The `GPUFeatureName`s this build reports and accepts; wgpu's native extensions stay hidden.
pub const FEATURES: &[(&str, wgt::Features)] = &[
    ("depth-clip-control", wgt::Features::DEPTH_CLIP_CONTROL),
    (
        "depth32float-stencil8",
        wgt::Features::DEPTH32FLOAT_STENCIL8,
    ),
    (
        "texture-compression-bc",
        wgt::Features::TEXTURE_COMPRESSION_BC,
    ),
    (
        "texture-compression-bc-sliced-3d",
        wgt::Features::TEXTURE_COMPRESSION_BC_SLICED_3D,
    ),
    (
        "texture-compression-etc2",
        wgt::Features::TEXTURE_COMPRESSION_ETC2,
    ),
    (
        "texture-compression-astc",
        wgt::Features::TEXTURE_COMPRESSION_ASTC,
    ),
    (
        "texture-compression-astc-sliced-3d",
        wgt::Features::TEXTURE_COMPRESSION_ASTC_SLICED_3D,
    ),
    ("timestamp-query", wgt::Features::TIMESTAMP_QUERY),
    (
        "indirect-first-instance",
        wgt::Features::INDIRECT_FIRST_INSTANCE,
    ),
    ("shader-f16", wgt::Features::SHADER_F16),
    (
        "rg11b10ufloat-renderable",
        wgt::Features::RG11B10UFLOAT_RENDERABLE,
    ),
    ("bgra8unorm-storage", wgt::Features::BGRA8UNORM_STORAGE),
    ("float32-filterable", wgt::Features::FLOAT32_FILTERABLE),
    ("float32-blendable", wgt::Features::FLOAT32_BLENDABLE),
    ("clip-distances", wgt::Features::CLIP_DISTANCES),
    ("dual-source-blending", wgt::Features::DUAL_SOURCE_BLENDING),
    ("primitive-index", wgt::Features::PRIMITIVE_INDEX),
];

pub fn parse_feature(s: &[u8]) -> Option<wgt::Features> {
    FEATURES
        .iter()
        .find(|(name, _)| name.as_bytes() == s)
        .map(|(_, f)| *f)
}

/// One `GPUSupportedLimits` attribute and the `wgt::Limits` field behind it.
pub struct Limit {
    pub name: &'static str,
    pub get: fn(&wgt::Limits) -> u64,
    /// Returns `false` when `value` does not fit the field.
    pub set: fn(&mut wgt::Limits, u64) -> bool,
}

macro_rules! limits {
    ($($name:literal => $field:ident: $ty:ty,)+) => {
        /// Every limit the WebGPU spec defines, in spec order.
        pub const LIMITS: &[Limit] = &[$(
            Limit {
                name: $name,
                get: |l| u64::from(l.$field),
                set: |l, v| match <$ty>::try_from(v) {
                    Ok(v) => {
                        l.$field = v;
                        true
                    }
                    Err(_) => false,
                },
            },
        )+];
    };
}

limits! {
    "maxTextureDimension1D" => max_texture_dimension_1d: u32,
    "maxTextureDimension2D" => max_texture_dimension_2d: u32,
    "maxTextureDimension3D" => max_texture_dimension_3d: u32,
    "maxTextureArrayLayers" => max_texture_array_layers: u32,
    "maxBindGroups" => max_bind_groups: u32,
    "maxBindGroupsPlusVertexBuffers" => max_bind_groups_plus_vertex_buffers: u32,
    "maxBindingsPerBindGroup" => max_bindings_per_bind_group: u32,
    "maxDynamicUniformBuffersPerPipelineLayout" => max_dynamic_uniform_buffers_per_pipeline_layout: u32,
    "maxDynamicStorageBuffersPerPipelineLayout" => max_dynamic_storage_buffers_per_pipeline_layout: u32,
    "maxSampledTexturesPerShaderStage" => max_sampled_textures_per_shader_stage: u32,
    "maxSamplersPerShaderStage" => max_samplers_per_shader_stage: u32,
    "maxStorageBuffersPerShaderStage" => max_storage_buffers_per_shader_stage: u32,
    "maxStorageTexturesPerShaderStage" => max_storage_textures_per_shader_stage: u32,
    "maxUniformBuffersPerShaderStage" => max_uniform_buffers_per_shader_stage: u32,
    "maxUniformBufferBindingSize" => max_uniform_buffer_binding_size: u64,
    "maxStorageBufferBindingSize" => max_storage_buffer_binding_size: u64,
    "minUniformBufferOffsetAlignment" => min_uniform_buffer_offset_alignment: u32,
    "minStorageBufferOffsetAlignment" => min_storage_buffer_offset_alignment: u32,
    "maxVertexBuffers" => max_vertex_buffers: u32,
    "maxBufferSize" => max_buffer_size: u64,
    "maxVertexAttributes" => max_vertex_attributes: u32,
    "maxVertexBufferArrayStride" => max_vertex_buffer_array_stride: u32,
    "maxInterStageShaderVariables" => max_inter_stage_shader_variables: u32,
    "maxColorAttachments" => max_color_attachments: u32,
    "maxColorAttachmentBytesPerSample" => max_color_attachment_bytes_per_sample: u32,
    "maxComputeWorkgroupStorageSize" => max_compute_workgroup_storage_size: u32,
    "maxComputeInvocationsPerWorkgroup" => max_compute_invocations_per_workgroup: u32,
    "maxComputeWorkgroupSizeX" => max_compute_workgroup_size_x: u32,
    "maxComputeWorkgroupSizeY" => max_compute_workgroup_size_y: u32,
    "maxComputeWorkgroupSizeZ" => max_compute_workgroup_size_z: u32,
    "maxComputeWorkgroupsPerDimension" => max_compute_workgroups_per_dimension: u32,
}

pub fn find_limit(name: &[u8]) -> Option<&'static Limit> {
    LIMITS.iter().find(|l| l.name.as_bytes() == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_format_round_trips() {
        for name in [
            "rgba8unorm",
            "depth24plus-stencil8",
            "astc-12x12-unorm-srgb",
            "bc7-rgba-unorm",
        ] {
            let f = parse_texture_format(name.as_bytes()).unwrap();
            assert_eq!(texture_format_name(f), name);
        }
        assert!(parse_texture_format(b"rgba8").is_none());
    }

    #[test]
    fn feature_names_match_wgpu() {
        for (name, flag) in FEATURES {
            assert_eq!(flag.as_str(), Some(*name));
        }
    }
}
