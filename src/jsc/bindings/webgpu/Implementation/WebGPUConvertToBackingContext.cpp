/*
 * Copyright (C) 2021-2023 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WebGPUConvertToBackingContext.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUAddressMode.h"
#include "WebGPUBlendFactor.h"
#include "WebGPUBlendOperation.h"
#include "WebGPUBufferBindingType.h"
#include "WebGPUCompareFunction.h"
#include "WebGPUCompilationMessageType.h"
#include "WebGPUCullMode.h"
#include "WebGPUErrorFilter.h"
#include "WebGPUFeatureName.h"
#include "WebGPUFilterMode.h"
#include "WebGPUFrontFace.h"
#include "WebGPUIndexFormat.h"
#include "WebGPULoadOp.h"
#include "WebGPUPowerPreference.h"
#include "WebGPUPrimitiveTopology.h"
#include "WebGPUQueryType.h"
#include "WebGPUSamplerBindingType.h"
#include "WebGPUStencilOperation.h"
#include "WebGPUStorageTextureAccess.h"
#include "WebGPUStoreOp.h"
#include "WebGPUTextureAspect.h"
#include "WebGPUTextureDimension.h"
#include "WebGPUTextureFormat.h"
#include "WebGPUTextureSampleType.h"
#include "WebGPUTextureViewDimension.h"
#include "WebGPUVertexFormat.h"
#include "WebGPUVertexStepMode.h"
#include "WebGPUXREye.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(ConvertToBackingContext);

WGPUAddressMode ConvertToBackingContext::convertToBacking(AddressMode addressMode)
{
    switch (addressMode) {
    case AddressMode::ClampToEdge:
        return WGPUAddressMode_ClampToEdge;
    case AddressMode::Repeat:
        return WGPUAddressMode_Repeat;
    case AddressMode::MirrorRepeat:
        return WGPUAddressMode_MirrorRepeat;
    }
}

WGPUBlendFactor ConvertToBackingContext::convertToBacking(BlendFactor blendFactor)
{
    switch (blendFactor) {
    case BlendFactor::Zero:
        return WGPUBlendFactor_Zero;
    case BlendFactor::One:
        return WGPUBlendFactor_One;
    case BlendFactor::Src:
        return WGPUBlendFactor_Src;
    case BlendFactor::OneMinusSrc:
        return WGPUBlendFactor_OneMinusSrc;
    case BlendFactor::SrcAlpha:
        return WGPUBlendFactor_SrcAlpha;
    case BlendFactor::OneMinusSrcAlpha:
        return WGPUBlendFactor_OneMinusSrcAlpha;
    case BlendFactor::Dst:
        return WGPUBlendFactor_Dst;
    case BlendFactor::OneMinusDst:
        return WGPUBlendFactor_OneMinusDst;
    case BlendFactor::DstAlpha:
        return WGPUBlendFactor_DstAlpha;
    case BlendFactor::OneMinusDstAlpha:
        return WGPUBlendFactor_OneMinusDstAlpha;
    case BlendFactor::SrcAlphaSaturated:
        return WGPUBlendFactor_SrcAlphaSaturated;
    case BlendFactor::Constant:
        return WGPUBlendFactor_Constant;
    case BlendFactor::OneMinusConstant:
        return WGPUBlendFactor_OneMinusConstant;
    }
}

WGPUBlendOperation ConvertToBackingContext::convertToBacking(BlendOperation blendOperation)
{
    switch (blendOperation) {
    case BlendOperation::Add:
        return WGPUBlendOperation_Add;
    case BlendOperation::Subtract:
        return WGPUBlendOperation_Subtract;
    case BlendOperation::ReverseSubtract:
        return WGPUBlendOperation_ReverseSubtract;
    case BlendOperation::Min:
        return WGPUBlendOperation_Min;
    case BlendOperation::Max:
        return WGPUBlendOperation_Max;
    }
}

WGPUBufferBindingType ConvertToBackingContext::convertToBacking(BufferBindingType bufferBindingType)
{
    switch (bufferBindingType) {
    case BufferBindingType::Uniform:
        return WGPUBufferBindingType_Uniform;
    case BufferBindingType::Storage:
        return WGPUBufferBindingType_Storage;
    case BufferBindingType::ReadOnlyStorage:
        return WGPUBufferBindingType_ReadOnlyStorage;
    }
}

WGPUCompareFunction ConvertToBackingContext::convertToBacking(CompareFunction compareFunction)
{
    switch (compareFunction) {
    case CompareFunction::Never:
        return WGPUCompareFunction_Never;
    case CompareFunction::Less:
        return WGPUCompareFunction_Less;
    case CompareFunction::Equal:
        return WGPUCompareFunction_Equal;
    case CompareFunction::LessEqual:
        return WGPUCompareFunction_LessEqual;
    case CompareFunction::Greater:
        return WGPUCompareFunction_Greater;
    case CompareFunction::NotEqual:
        return WGPUCompareFunction_NotEqual;
    case CompareFunction::GreaterEqual:
        return WGPUCompareFunction_GreaterEqual;
    case CompareFunction::Always:
        return WGPUCompareFunction_Always;
    }
}

WGPUCompilationMessageType ConvertToBackingContext::convertToBacking(CompilationMessageType compilationMessageType)
{
    switch (compilationMessageType) {
    case CompilationMessageType::Error:
        return WGPUCompilationMessageType_Error;
    case CompilationMessageType::Warning:
        return WGPUCompilationMessageType_Warning;
    case CompilationMessageType::Info:
        return WGPUCompilationMessageType_Info;
    }
}

WGPUCullMode ConvertToBackingContext::convertToBacking(CullMode cullMode)
{
    switch (cullMode) {
    case CullMode::None:
        return WGPUCullMode_None;
    case CullMode::Front:
        return WGPUCullMode_Front;
    case CullMode::Back:
        return WGPUCullMode_Back;
    }
}

WGPUErrorFilter ConvertToBackingContext::convertToBacking(ErrorFilter errorFilter)
{
    switch (errorFilter) {
    case ErrorFilter::OutOfMemory:
        return WGPUErrorFilter_OutOfMemory;
    case ErrorFilter::Validation:
        return WGPUErrorFilter_Validation;
    case ErrorFilter::Internal:
        return WGPUErrorFilter_Internal;
    }
}

WGPUFeatureName ConvertToBackingContext::convertToBacking(FeatureName featureName)
{
    switch (featureName) {
    case FeatureName::DepthClipControl:
        return WGPUFeatureName_DepthClipControl;
    case FeatureName::Depth32floatStencil8:
        return WGPUFeatureName_Depth32FloatStencil8;
    case FeatureName::TextureCompressionBc:
        return WGPUFeatureName_TextureCompressionBC;
    case FeatureName::TextureCompressionBcSliced3d:
        return WGPUFeatureName_TextureCompressionBCSliced3D;
    case FeatureName::TextureCompressionEtc2:
        return WGPUFeatureName_TextureCompressionETC2;
    case FeatureName::TextureCompressionAstc:
        return WGPUFeatureName_TextureCompressionASTC;
    case FeatureName::TextureCompressionAstcSliced3d:
        return WGPUFeatureName_TextureCompressionASTCSliced3D;
    case FeatureName::TimestampQuery:
        return WGPUFeatureName_TimestampQuery;
    case FeatureName::IndirectFirstInstance:
        return WGPUFeatureName_IndirectFirstInstance;
    case FeatureName::Bgra8unormStorage:
        return WGPUFeatureName_BGRA8UnormStorage;
    case FeatureName::ShaderF16:
        return WGPUFeatureName_ShaderF16;
    case FeatureName::Rg11b10ufloatRenderable:
        return WGPUFeatureName_RG11B10UfloatRenderable;
    case FeatureName::Float32Filterable:
        return WGPUFeatureName_Float32Filterable;
    case FeatureName::Float16Renderable:
        return WGPUFeatureName_Float16Renderable;
    case FeatureName::Float32Renderable:
        return WGPUFeatureName_Float32Renderable;
    case FeatureName::Float32Blendable:
        return WGPUFeatureName_Float32Blendable;
    case FeatureName::ClipDistances:
        return WGPUFeatureName_ClipDistances;
    case FeatureName::DualSourceBlending:
        return WGPUFeatureName_DualSourceBlending;
    case FeatureName::CoreFeaturesAndLimits:
        return WGPUFeatureName_CoreFeaturesAndLimits;
    case FeatureName::TextureFormatsTier1:
        return WGPUFeatureName_TextureFormatsTier1;
    case FeatureName::TextureFormatsTier2:
        return WGPUFeatureName_TextureFormatsTier2;
    case FeatureName::PrimitiveIndex:
        return WGPUFeatureName_PrimitiveIndex;
    case FeatureName::Subgroups:
        return WGPUFeatureName_Subgroups;
    }
}

WGPUFilterMode ConvertToBackingContext::convertToBacking(FilterMode filterMode)
{
    switch (filterMode) {
    case FilterMode::Nearest:
        return WGPUFilterMode_Nearest;
    case FilterMode::Linear:
        return WGPUFilterMode_Linear;
    }
}

WGPUMipmapFilterMode ConvertToBackingContext::convertToBacking(MipmapFilterMode filterMode)
{
    switch (filterMode) {
    case MipmapFilterMode::Nearest:
        return WGPUMipmapFilterMode_Nearest;
    case MipmapFilterMode::Linear:
        return WGPUMipmapFilterMode_Linear;
    }
}

WGPUFrontFace ConvertToBackingContext::convertToBacking(FrontFace frontFace)
{
    switch (frontFace) {
    case FrontFace::CCW:
        return WGPUFrontFace_CCW;
    case FrontFace::CW:
        return WGPUFrontFace_CW;
    }
}

WGPUIndexFormat ConvertToBackingContext::convertToBacking(IndexFormat indexFormat)
{
    switch (indexFormat) {
    case IndexFormat::Uint16:
        return WGPUIndexFormat_Uint16;
    case IndexFormat::Uint32:
        return WGPUIndexFormat_Uint32;
    }
}

WGPULoadOp ConvertToBackingContext::convertToBacking(LoadOp loadOp)
{
    switch (loadOp) {
    case LoadOp::Load:
        return WGPULoadOp_Load;
    case LoadOp::Clear:
        return WGPULoadOp_Clear;
    }
}

WGPUPowerPreference ConvertToBackingContext::convertToBacking(PowerPreference powerPreference)
{
    switch (powerPreference) {
    case PowerPreference::LowPower:
        return WGPUPowerPreference_LowPower;
    case PowerPreference::HighPerformance:
        return WGPUPowerPreference_HighPerformance;
    }
}

WGPUPrimitiveTopology ConvertToBackingContext::convertToBacking(PrimitiveTopology primitiveTopology)
{
    switch (primitiveTopology) {
    case PrimitiveTopology::PointList:
        return WGPUPrimitiveTopology_PointList;
    case PrimitiveTopology::LineList:
        return WGPUPrimitiveTopology_LineList;
    case PrimitiveTopology::LineStrip:
        return WGPUPrimitiveTopology_LineStrip;
    case PrimitiveTopology::TriangleList:
        return WGPUPrimitiveTopology_TriangleList;
    case PrimitiveTopology::TriangleStrip:
        return WGPUPrimitiveTopology_TriangleStrip;
    }
}

WGPUQueryType ConvertToBackingContext::convertToBacking(QueryType queryType)
{
    switch (queryType) {
    case QueryType::Occlusion:
        return WGPUQueryType_Occlusion;
    case QueryType::Timestamp:
        return WGPUQueryType_Timestamp;
    }
}

WGPUSamplerBindingType ConvertToBackingContext::convertToBacking(SamplerBindingType samplerBindingType)
{
    switch (samplerBindingType) {
    case SamplerBindingType::Filtering:
        return WGPUSamplerBindingType_Filtering;
    case SamplerBindingType::NonFiltering:
        return WGPUSamplerBindingType_NonFiltering;
    case SamplerBindingType::Comparison:
        return WGPUSamplerBindingType_Comparison;
    }
}

WGPUStencilOperation ConvertToBackingContext::convertToBacking(StencilOperation stencilOperation)
{
    switch (stencilOperation) {
    case StencilOperation::Keep:
        return WGPUStencilOperation_Keep;
    case StencilOperation::Zero:
        return WGPUStencilOperation_Zero;
    case StencilOperation::Replace:
        return WGPUStencilOperation_Replace;
    case StencilOperation::Invert:
        return WGPUStencilOperation_Invert;
    case StencilOperation::IncrementClamp:
        return WGPUStencilOperation_IncrementClamp;
    case StencilOperation::DecrementClamp:
        return WGPUStencilOperation_DecrementClamp;
    case StencilOperation::IncrementWrap:
        return WGPUStencilOperation_IncrementWrap;
    case StencilOperation::DecrementWrap:
        return WGPUStencilOperation_DecrementWrap;
    }
}

WGPUStorageTextureAccess ConvertToBackingContext::convertToBacking(StorageTextureAccess storageTextureAccess)
{
    switch (storageTextureAccess) {
    case StorageTextureAccess::WriteOnly:
        return WGPUStorageTextureAccess_WriteOnly;
    case StorageTextureAccess::ReadOnly:
        return WGPUStorageTextureAccess_ReadOnly;
    case StorageTextureAccess::ReadWrite:
        return WGPUStorageTextureAccess_ReadWrite;
    }
}

WGPUStoreOp ConvertToBackingContext::convertToBacking(StoreOp storeOp)
{
    switch (storeOp) {
    case StoreOp::Store:
        return WGPUStoreOp_Store;
    case StoreOp::Discard:
        return WGPUStoreOp_Discard;
    }
}

WGPUTextureAspect ConvertToBackingContext::convertToBacking(TextureAspect textureAspect)
{
    switch (textureAspect) {
    case TextureAspect::All:
        return WGPUTextureAspect_All;
    case TextureAspect::StencilOnly:
        return WGPUTextureAspect_StencilOnly;
    case TextureAspect::DepthOnly:
        return WGPUTextureAspect_DepthOnly;
    }
}

WGPUTextureDimension ConvertToBackingContext::convertToBacking(TextureDimension textureDimension)
{
    switch (textureDimension) {
    case TextureDimension::_1d:
        return WGPUTextureDimension_1D;
    case TextureDimension::_2d:
        return WGPUTextureDimension_2D;
    case TextureDimension::_3d:
        return WGPUTextureDimension_3D;
    }
}

WGPUTextureFormat ConvertToBackingContext::convertToBacking(TextureFormat textureFormat)
{
    switch (textureFormat) {
    case TextureFormat::R8unorm:
        return WGPUTextureFormat_R8Unorm;
    case TextureFormat::R8snorm:
        return WGPUTextureFormat_R8Snorm;
    case TextureFormat::R8uint:
        return WGPUTextureFormat_R8Uint;
    case TextureFormat::R8sint:
        return WGPUTextureFormat_R8Sint;
    case TextureFormat::R16uint:
        return WGPUTextureFormat_R16Uint;
    case TextureFormat::R16unorm:
        return WGPUTextureFormat_R16Unorm;
    case TextureFormat::R16snorm:
        return WGPUTextureFormat_R16Snorm;
    case TextureFormat::Rg16unorm:
        return WGPUTextureFormat_RG16Unorm;
    case TextureFormat::Rg16snorm:
        return WGPUTextureFormat_RG16Snorm;
    case TextureFormat::Rgba16unorm:
        return WGPUTextureFormat_RGBA16Unorm;
    case TextureFormat::Rgba16snorm:
        return WGPUTextureFormat_RGBA16Snorm;
    case TextureFormat::R16sint:
        return WGPUTextureFormat_R16Sint;
    case TextureFormat::R16float:
        return WGPUTextureFormat_R16Float;
    case TextureFormat::Rg8unorm:
        return WGPUTextureFormat_RG8Unorm;
    case TextureFormat::Rg8snorm:
        return WGPUTextureFormat_RG8Snorm;
    case TextureFormat::Rg8uint:
        return WGPUTextureFormat_RG8Uint;
    case TextureFormat::Rg8sint:
        return WGPUTextureFormat_RG8Sint;
    case TextureFormat::R32uint:
        return WGPUTextureFormat_R32Uint;
    case TextureFormat::R32sint:
        return WGPUTextureFormat_R32Sint;
    case TextureFormat::R32float:
        return WGPUTextureFormat_R32Float;
    case TextureFormat::Rg16uint:
        return WGPUTextureFormat_RG16Uint;
    case TextureFormat::Rg16sint:
        return WGPUTextureFormat_RG16Sint;
    case TextureFormat::Rg16float:
        return WGPUTextureFormat_RG16Float;
    case TextureFormat::Rgba8unorm:
        return WGPUTextureFormat_RGBA8Unorm;
    case TextureFormat::Rgba8unormSRGB:
        return WGPUTextureFormat_RGBA8UnormSrgb;
    case TextureFormat::Rgba8snorm:
        return WGPUTextureFormat_RGBA8Snorm;
    case TextureFormat::Rgba8uint:
        return WGPUTextureFormat_RGBA8Uint;
    case TextureFormat::Rgba8sint:
        return WGPUTextureFormat_RGBA8Sint;
    case TextureFormat::Bgra8unorm:
        return WGPUTextureFormat_BGRA8Unorm;
    case TextureFormat::Bgra8unormSRGB:
        return WGPUTextureFormat_BGRA8UnormSrgb;
    case TextureFormat::Rgb9e5ufloat:
        return WGPUTextureFormat_RGB9E5Ufloat;
    case TextureFormat::Rgb10a2uint:
        return WGPUTextureFormat_RGB10A2Uint;
    case TextureFormat::Rgb10a2unorm:
        return WGPUTextureFormat_RGB10A2Unorm;
    case TextureFormat::Rg11b10ufloat:
        return WGPUTextureFormat_RG11B10Ufloat;
    case TextureFormat::Rg32uint:
        return WGPUTextureFormat_RG32Uint;
    case TextureFormat::Rg32sint:
        return WGPUTextureFormat_RG32Sint;
    case TextureFormat::Rg32float:
        return WGPUTextureFormat_RG32Float;
    case TextureFormat::Rgba16uint:
        return WGPUTextureFormat_RGBA16Uint;
    case TextureFormat::Rgba16sint:
        return WGPUTextureFormat_RGBA16Sint;
    case TextureFormat::Rgba16float:
        return WGPUTextureFormat_RGBA16Float;
    case TextureFormat::Rgba32uint:
        return WGPUTextureFormat_RGBA32Uint;
    case TextureFormat::Rgba32sint:
        return WGPUTextureFormat_RGBA32Sint;
    case TextureFormat::Rgba32float:
        return WGPUTextureFormat_RGBA32Float;
    case TextureFormat::Stencil8:
        return WGPUTextureFormat_Stencil8;
    case TextureFormat::Depth16unorm:
        return WGPUTextureFormat_Depth16Unorm;
    case TextureFormat::Depth24plus:
        return WGPUTextureFormat_Depth24Plus;
    case TextureFormat::Depth24plusStencil8:
        return WGPUTextureFormat_Depth24PlusStencil8;
    case TextureFormat::Depth32float:
        return WGPUTextureFormat_Depth32Float;
    case TextureFormat::Bc1RgbaUnorm:
        return WGPUTextureFormat_BC1RGBAUnorm;
    case TextureFormat::Bc1RgbaUnormSRGB:
        return WGPUTextureFormat_BC1RGBAUnormSrgb;
    case TextureFormat::Bc2RgbaUnorm:
        return WGPUTextureFormat_BC2RGBAUnorm;
    case TextureFormat::Bc2RgbaUnormSRGB:
        return WGPUTextureFormat_BC2RGBAUnormSrgb;
    case TextureFormat::Bc3RgbaUnorm:
        return WGPUTextureFormat_BC3RGBAUnorm;
    case TextureFormat::Bc3RgbaUnormSRGB:
        return WGPUTextureFormat_BC3RGBAUnormSrgb;
    case TextureFormat::Bc4RUnorm:
        return WGPUTextureFormat_BC4RUnorm;
    case TextureFormat::Bc4RSnorm:
        return WGPUTextureFormat_BC4RSnorm;
    case TextureFormat::Bc5RgUnorm:
        return WGPUTextureFormat_BC5RGUnorm;
    case TextureFormat::Bc5RgSnorm:
        return WGPUTextureFormat_BC5RGSnorm;
    case TextureFormat::Bc6hRgbUfloat:
        return WGPUTextureFormat_BC6HRGBUfloat;
    case TextureFormat::Bc6hRgbFloat:
        return WGPUTextureFormat_BC6HRGBFloat;
    case TextureFormat::Bc7RgbaUnorm:
        return WGPUTextureFormat_BC7RGBAUnorm;
    case TextureFormat::Bc7RgbaUnormSRGB:
        return WGPUTextureFormat_BC7RGBAUnormSrgb;
    case TextureFormat::Etc2Rgb8unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGB8Unorm);
    case TextureFormat::Etc2Rgb8unormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGB8UnormSrgb);
    case TextureFormat::Etc2Rgb8a1unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGB8A1Unorm);
    case TextureFormat::Etc2Rgb8a1unormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGB8A1UnormSrgb);
    case TextureFormat::Etc2Rgba8unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGBA8Unorm);
    case TextureFormat::Etc2Rgba8unormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ETC2RGBA8UnormSrgb);
    case TextureFormat::EacR11unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_EACR11Unorm);
    case TextureFormat::EacR11snorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_EACR11Snorm);
    case TextureFormat::EacRg11unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_EACRG11Unorm);
    case TextureFormat::EacRg11snorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_EACRG11Snorm);
    case TextureFormat::Astc4x4Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC4x4Unorm);
    case TextureFormat::Astc4x4UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC4x4UnormSrgb);
    case TextureFormat::Astc5x4Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC5x4Unorm);
    case TextureFormat::Astc5x4UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC5x4UnormSrgb);
    case TextureFormat::Astc5x5Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC5x5Unorm);
    case TextureFormat::Astc5x5UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC5x5UnormSrgb);
    case TextureFormat::Astc6x5Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC6x5Unorm);
    case TextureFormat::Astc6x5UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC6x5UnormSrgb);
    case TextureFormat::Astc6x6Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC6x6Unorm);
    case TextureFormat::Astc6x6UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC6x6UnormSrgb);
    case TextureFormat::Astc8x5Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x5Unorm);
    case TextureFormat::Astc8x5UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x5UnormSrgb);
    case TextureFormat::Astc8x6Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x6Unorm);
    case TextureFormat::Astc8x6UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x6UnormSrgb);
    case TextureFormat::Astc8x8Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x8Unorm);
    case TextureFormat::Astc8x8UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC8x8UnormSrgb);
    case TextureFormat::Astc10x5Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x5Unorm);
    case TextureFormat::Astc10x5UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x5UnormSrgb);
    case TextureFormat::Astc10x6Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x6Unorm);
    case TextureFormat::Astc10x6UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x6UnormSrgb);
    case TextureFormat::Astc10x8Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x8Unorm);
    case TextureFormat::Astc10x8UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x8UnormSrgb);
    case TextureFormat::Astc10x10Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x10Unorm);
    case TextureFormat::Astc10x10UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC10x10UnormSrgb);
    case TextureFormat::Astc12x10Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC12x10Unorm);
    case TextureFormat::Astc12x10UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC12x10UnormSrgb);
    case TextureFormat::Astc12x12Unorm:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC12x12Unorm);
    case TextureFormat::Astc12x12UnormSRGB:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_ASTC12x12UnormSrgb);
    case TextureFormat::Depth32floatStencil8:
        return static_cast<WGPUTextureFormat>(WGPUTextureFormat_Depth32FloatStencil8);
    }
}

WGPUTextureSampleType ConvertToBackingContext::convertToBacking(TextureSampleType textureSampleType)
{
    switch (textureSampleType) {
    case TextureSampleType::Float:
        return WGPUTextureSampleType_Float;
    case TextureSampleType::UnfilterableFloat:
        return WGPUTextureSampleType_UnfilterableFloat;
    case TextureSampleType::Depth:
        return WGPUTextureSampleType_Depth;
    case TextureSampleType::Sint:
        return WGPUTextureSampleType_Sint;
    case TextureSampleType::Uint:
        return WGPUTextureSampleType_Uint;
    }
}

WGPUTextureViewDimension ConvertToBackingContext::convertToBacking(TextureViewDimension textureViewDimension)
{
    switch (textureViewDimension) {
    case TextureViewDimension::_1d:
        return WGPUTextureViewDimension_1D;
    case TextureViewDimension::_2d:
        return WGPUTextureViewDimension_2D;
    case TextureViewDimension::_2dArray:
        return WGPUTextureViewDimension_2DArray;
    case TextureViewDimension::Cube:
        return WGPUTextureViewDimension_Cube;
    case TextureViewDimension::CubeArray:
        return WGPUTextureViewDimension_CubeArray;
    case TextureViewDimension::_3d:
        return WGPUTextureViewDimension_3D;
    }
}

WGPUVertexFormat ConvertToBackingContext::convertToBacking(VertexFormat vertexFormat)
{
    switch (vertexFormat) {
    case VertexFormat::Uint8:
        return WGPUVertexFormat_Uint8;
    case VertexFormat::Uint8x2:
        return WGPUVertexFormat_Uint8x2;
    case VertexFormat::Uint8x4:
        return WGPUVertexFormat_Uint8x4;
    case VertexFormat::Sint8:
        return WGPUVertexFormat_Sint8;
    case VertexFormat::Sint8x2:
        return WGPUVertexFormat_Sint8x2;
    case VertexFormat::Sint8x4:
        return WGPUVertexFormat_Sint8x4;
    case VertexFormat::Unorm8:
        return WGPUVertexFormat_Unorm8;
    case VertexFormat::Unorm8x2:
        return WGPUVertexFormat_Unorm8x2;
    case VertexFormat::Unorm8x4:
        return WGPUVertexFormat_Unorm8x4;
    case VertexFormat::Snorm8:
        return WGPUVertexFormat_Snorm8;
    case VertexFormat::Snorm8x2:
        return WGPUVertexFormat_Snorm8x2;
    case VertexFormat::Snorm8x4:
        return WGPUVertexFormat_Snorm8x4;
    case VertexFormat::Uint16:
        return WGPUVertexFormat_Uint16;
    case VertexFormat::Uint16x2:
        return WGPUVertexFormat_Uint16x2;
    case VertexFormat::Uint16x4:
        return WGPUVertexFormat_Uint16x4;
    case VertexFormat::Sint16:
        return WGPUVertexFormat_Sint16;
    case VertexFormat::Sint16x2:
        return WGPUVertexFormat_Sint16x2;
    case VertexFormat::Sint16x4:
        return WGPUVertexFormat_Sint16x4;
    case VertexFormat::Unorm16:
        return WGPUVertexFormat_Unorm16;
    case VertexFormat::Unorm16x2:
        return WGPUVertexFormat_Unorm16x2;
    case VertexFormat::Unorm16x4:
        return WGPUVertexFormat_Unorm16x4;
    case VertexFormat::Snorm16:
        return WGPUVertexFormat_Snorm16;
    case VertexFormat::Snorm16x2:
        return WGPUVertexFormat_Snorm16x2;
    case VertexFormat::Snorm16x4:
        return WGPUVertexFormat_Snorm16x4;
    case VertexFormat::Float16:
        return WGPUVertexFormat_Float16;
    case VertexFormat::Float16x2:
        return WGPUVertexFormat_Float16x2;
    case VertexFormat::Float16x4:
        return WGPUVertexFormat_Float16x4;
    case VertexFormat::Float32:
        return WGPUVertexFormat_Float32;
    case VertexFormat::Float32x2:
        return WGPUVertexFormat_Float32x2;
    case VertexFormat::Float32x3:
        return WGPUVertexFormat_Float32x3;
    case VertexFormat::Float32x4:
        return WGPUVertexFormat_Float32x4;
    case VertexFormat::Uint32:
        return WGPUVertexFormat_Uint32;
    case VertexFormat::Uint32x2:
        return WGPUVertexFormat_Uint32x2;
    case VertexFormat::Uint32x3:
        return WGPUVertexFormat_Uint32x3;
    case VertexFormat::Uint32x4:
        return WGPUVertexFormat_Uint32x4;
    case VertexFormat::Sint32:
        return WGPUVertexFormat_Sint32;
    case VertexFormat::Sint32x2:
        return WGPUVertexFormat_Sint32x2;
    case VertexFormat::Sint32x3:
        return WGPUVertexFormat_Sint32x3;
    case VertexFormat::Sint32x4:
        return WGPUVertexFormat_Sint32x4;
    case VertexFormat::Unorm1010102:
        return WGPUVertexFormat_Unorm1010102;
    case VertexFormat::Unorm8x4Bgra:
        return WGPUVertexFormat_Unorm8x4Bgra;
    }
}

WGPUVertexStepMode ConvertToBackingContext::convertToBacking(VertexStepMode vertexStepMode)
{
    switch (vertexStepMode) {
    case VertexStepMode::Vertex:
        return WGPUVertexStepMode_Vertex;
    case VertexStepMode::Instance:
        return WGPUVertexStepMode_Instance;
    }
}

static constexpr bool NODELETE compare(BufferUsage a, unsigned b)
{
    return static_cast<unsigned>(a) == b;
}

WGPUBufferUsageFlags ConvertToBackingContext::convertBufferUsageFlagsToBacking(BufferUsageFlags bufferUsageFlags)
{
    static_assert(compare(BufferUsage::MapRead, WGPUBufferUsage_MapRead), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::MapWrite, WGPUBufferUsage_MapWrite), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::CopySource, WGPUBufferUsage_CopySrc), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::CopyDestination, WGPUBufferUsage_CopyDst), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::Index, WGPUBufferUsage_Index), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::Vertex, WGPUBufferUsage_Vertex), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::Uniform, WGPUBufferUsage_Uniform), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::Storage, WGPUBufferUsage_Storage), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::Indirect, WGPUBufferUsage_Indirect), "BufferUsageFlags mismatch");
    static_assert(compare(BufferUsage::QueryResolve, WGPUBufferUsage_QueryResolve), "BufferUsageFlags mismatch");

    return static_cast<WGPUBufferUsageFlags>(bufferUsageFlags);
}

static constexpr bool NODELETE compare(auto a, auto b)
{
    return static_cast<unsigned>(a) == static_cast<unsigned>(b);
}
WGPUColorWriteMaskFlags ConvertToBackingContext::convertColorWriteFlagsToBacking(ColorWriteFlags colorWriteFlags)
{
    static_assert(compare(ColorWrite::Red, WGPUColorWriteMask_Red), "color masks have different values");
    static_assert(compare(ColorWrite::Green, WGPUColorWriteMask_Green), "color masks have different values");
    static_assert(compare(ColorWrite::Blue, WGPUColorWriteMask_Blue), "color masks have different values");
    static_assert(compare(ColorWrite::Alpha, WGPUColorWriteMask_Alpha), "color masks have different values");
    return static_cast<WGPUColorWriteMaskFlags>(colorWriteFlags);
}

WGPUMapModeFlags ConvertToBackingContext::convertMapModeFlagsToBacking(MapModeFlags mapModeFlags)
{
    WGPUMapModeFlags result = 0;
    if (mapModeFlags.contains(MapMode::Read))
        result |= WGPUMapMode_Read;
    if (mapModeFlags.contains(MapMode::Write))
        result |= WGPUMapMode_Write;
    return result;
}

WGPUShaderStageFlags ConvertToBackingContext::convertShaderStageFlagsToBacking(ShaderStageFlags shaderStageFlags)
{
    WGPUShaderStageFlags result = 0;
    if (shaderStageFlags.contains(ShaderStage::Vertex))
        result |= WGPUShaderStage_Vertex;
    if (shaderStageFlags.contains(ShaderStage::Fragment))
        result |= WGPUShaderStage_Fragment;
    if (shaderStageFlags.contains(ShaderStage::Compute))
        result |= WGPUShaderStage_Compute;
    return result;
}

WGPUTextureUsageFlags ConvertToBackingContext::convertTextureUsageFlagsToBacking(TextureUsageFlags textureUsageFlags)
{
    WGPUTextureUsageFlags result = 0;
    if (textureUsageFlags.contains(TextureUsage::CopySource))
        result |= WGPUTextureUsage_CopySrc;
    if (textureUsageFlags.contains(TextureUsage::CopyDestination))
        result |= WGPUTextureUsage_CopyDst;
    if (textureUsageFlags.contains(TextureUsage::TextureBinding))
        result |= WGPUTextureUsage_TextureBinding;
    if (textureUsageFlags.contains(TextureUsage::StorageBinding))
        result |= WGPUTextureUsage_StorageBinding;
    if (textureUsageFlags.contains(TextureUsage::RenderAttachment))
        result |= WGPUTextureUsage_RenderAttachment;
    if (textureUsageFlags.contains(TextureUsage::Transient))
        result |= WGPUTextureUsage_Transient;
    return result;
}

WGPUColor ConvertToBackingContext::convertToBacking(const Color& color)
{
    return WTF::switchOn(color, [](const Vector<double>& vector) {
        return WGPUColor {
            vector.size() > 0 ? vector[0] : 0,
            vector.size() > 1 ? vector[1] : 0,
            vector.size() > 2 ? vector[2] : 0,
            vector.size() > 3 ? vector[3] : 0,
        };
    }, [](const ColorDict& color) {
        return WGPUColor {
            color.r,
            color.g,
            color.b,
            color.a,
        };
    });
}

WGPUExtent3D ConvertToBackingContext::convertToBacking(const Extent3D& extent3D)
{
    return WTF::switchOn(extent3D, [](const Vector<IntegerCoordinate>& vector) {
        return WGPUExtent3D {
            vector.size() > 0 ? vector[0] : 1,
            vector.size() > 1 ? vector[1] : 1,
            vector.size() > 2 ? vector[2] : 1,
        };
    }, [](const Extent3DDict& extent) {
        return WGPUExtent3D {
            extent.width,
            extent.height,
            extent.depthOrArrayLayers,
        };
    });
}

WGPUOrigin3D ConvertToBackingContext::convertToBacking(const Origin2D& origin2D)
{
    return WTF::switchOn(origin2D, [](const Vector<IntegerCoordinate>& vector) {
        return WGPUOrigin3D {
            vector.size() > 0 ? vector[0] : 0,
            vector.size() > 1 ? vector[1] : 0,
            0,
        };
    }, [](const Origin2DDict& origin) {
        return WGPUOrigin3D {
            origin.x,
            origin.y,
            0,
        };
    });
}

WGPUOrigin3D ConvertToBackingContext::convertToBacking(const Origin3D& origin3D)
{
    return WTF::switchOn(origin3D, [](const Vector<IntegerCoordinate>& vector) {
        return WGPUOrigin3D {
            vector.size() > 0 ? vector[0] : 0,
            vector.size() > 1 ? vector[1] : 0,
            vector.size() > 2 ? vector[2] : 0,
        };
    }, [](const Origin3DDict& origin) {
        return WGPUOrigin3D {
            origin.x,
            origin.y,
            origin.z,
        };
    });
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
