/*
 * Copyright (c) 2021-2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#import "config.h"
#import "BindGroup.h"

#import "APIConversions.h"
#import "BindGroupLayout.h"
#import "Buffer.h"
#import "Device.h"
#import "Sampler.h"
#import "TextureView.h"
#import <ranges>
#import <wtf/EnumeratedArray.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

namespace {
constexpr auto maxResourceUsageValue = MTLResourceUsageRead | MTLResourceUsageWrite;
constexpr ShaderStage stagesPlusUndefined[] = { ShaderStage::Vertex, ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Undefined };
constexpr ShaderStage stages[] = { ShaderStage::Vertex, ShaderStage::Fragment, ShaderStage::Compute };
constexpr size_t stageCount = std::size(stages);
constexpr size_t stagesPlusUndefinedCount = std::size(stagesPlusUndefined);
}

static bool NODELETE bufferIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.buffer;
}

static bool NODELETE samplerIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.sampler;
}

static bool NODELETE textureIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.texture;
}

static bool NODELETE textureViewIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.textureView;
}

static MTLRenderStages NODELETE metalRenderStage(ShaderStage shaderStage)
{
    switch (shaderStage) {
    case ShaderStage::Vertex:
        return MTLRenderStageVertex;
    case ShaderStage::Fragment:
        return MTLRenderStageFragment;
    case ShaderStage::Compute:
        return BindGroup::MTLRenderStageCompute;
    case ShaderStage::Undefined:
        return BindGroup::MTLRenderStageUndefined;
    }
}

static bool NODELETE hasProperUsageFlags(WGPUBufferBindingType bufferType, WGPUBufferUsageFlags usage)
{
    switch (bufferType) {
    case WGPUBufferBindingType_Uniform:
        return usage & WGPUBufferUsage_Uniform;
    case WGPUBufferBindingType_Storage:
    case WGPUBufferBindingType_ReadOnlyStorage:
        return usage & WGPUBufferUsage_Storage;
    case WGPUBufferBindingType_Undefined:
    case WGPUBufferBindingType_Force32:
        ASSERT_NOT_REACHED();
        return false;
    }
}

static MTLResourceUsage NODELETE resourceUsageForBindingAcccess(BindGroupLayout::BindingAccess bindingAccess)
{
    switch (bindingAccess) {
    case BindGroupLayout::BindingAccessReadOnly:
        return MTLResourceUsageRead;
    case BindGroupLayout::BindingAccessWriteOnly:
        return MTLResourceUsageWrite;
    case BindGroupLayout::BindingAccessReadWrite:
        return MTLResourceUsageRead | MTLResourceUsageWrite;
    }
}

template <typename ExpectedType>
static const ExpectedType* hasBinding(const BindGroupLayout::EntriesContainer& bindGroupLayoutEntries, auto bindingIndex)
{
    auto it = bindGroupLayoutEntries.find(bindingIndex);
    RELEASE_ASSERT(it != bindGroupLayoutEntries.end());
    return std::get_if<ExpectedType>(&it->value.bindingLayout);
}

static bool is32bppFloatFormat(id<MTLTexture> t)
{
    return t.pixelFormat == MTLPixelFormatR32Float || t.pixelFormat == MTLPixelFormatRG32Float || t.pixelFormat == MTLPixelFormatRGBA32Float;
}

static bool NODELETE valid32bppFloatSampleType(WGPUTextureSampleType sampleType)
{
    return sampleType == WGPUTextureSampleType_Float || sampleType == WGPUTextureSampleType_UnfilterableFloat;
}

enum FormatType {
    FormatType_Undefined = 0,
    FormatType_Float = 1 << 0,
    FormatType_UnfilterableFloat = 1 << 1,
    FormatType_Depth = 1 << 2,
    FormatType_SignedInt = 1 << 3,
    FormatType_UnsignedInt = 1 << 4
};

static std::underlying_type<FormatType>::type formatType(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    switch (format) {
    case WGPUTextureFormat_R8Unorm:
    case WGPUTextureFormat_R8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_R8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R16Unorm:
    case WGPUTextureFormat_R16Snorm:
    case WGPUTextureFormat_RG16Unorm:
    case WGPUTextureFormat_RG16Snorm:
    case WGPUTextureFormat_RGBA16Unorm:
    case WGPUTextureFormat_RGBA16Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_R16Float:
    case WGPUTextureFormat_RG8Unorm:
    case WGPUTextureFormat_RG8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RG8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_R32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RG16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RG16Float:
    case WGPUTextureFormat_RGBA8Unorm:
    case WGPUTextureFormat_RGBA8UnormSrgb:
    case WGPUTextureFormat_RGBA8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGBA8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_BGRA8Unorm:
    case WGPUTextureFormat_BGRA8UnormSrgb:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGB10A2Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGB10A2Unorm:
    case WGPUTextureFormat_RG11B10Ufloat:
    case WGPUTextureFormat_RGB9E5Ufloat:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RG32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_RG32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RGBA16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RGBA16Float:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGBA32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_RGBA32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_Stencil8:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_Depth16Unorm:
    case WGPUTextureFormat_Depth24Plus:
        return FormatType_Depth | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_Depth24PlusStencil8:
    case WGPUTextureFormat_Depth32FloatStencil8: {
        switch (aspect) {
        case WGPUTextureAspect_All:
            return FormatType_Depth | FormatType_UnfilterableFloat | FormatType_UnsignedInt;
        case WGPUTextureAspect_StencilOnly:
            return FormatType_UnsignedInt;
        case WGPUTextureAspect_DepthOnly:
            return FormatType_Depth | FormatType_UnfilterableFloat;
        case WGPUTextureAspect_Force32:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }
    case WGPUTextureFormat_Depth32Float:
        return FormatType_Depth | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_BC1RGBAUnorm:
    case WGPUTextureFormat_BC1RGBAUnormSrgb:
    case WGPUTextureFormat_BC2RGBAUnorm:
    case WGPUTextureFormat_BC2RGBAUnormSrgb:
    case WGPUTextureFormat_BC3RGBAUnorm:
    case WGPUTextureFormat_BC3RGBAUnormSrgb:
    case WGPUTextureFormat_BC4RUnorm:
    case WGPUTextureFormat_BC4RSnorm:
    case WGPUTextureFormat_BC5RGUnorm:
    case WGPUTextureFormat_BC5RGSnorm:
    case WGPUTextureFormat_BC6HRGBUfloat:
    case WGPUTextureFormat_BC6HRGBFloat:
    case WGPUTextureFormat_BC7RGBAUnorm:
    case WGPUTextureFormat_BC7RGBAUnormSrgb:
    case WGPUTextureFormat_ETC2RGB8Unorm:
    case WGPUTextureFormat_ETC2RGB8UnormSrgb:
    case WGPUTextureFormat_ETC2RGB8A1Unorm:
    case WGPUTextureFormat_ETC2RGB8A1UnormSrgb:
    case WGPUTextureFormat_ETC2RGBA8Unorm:
    case WGPUTextureFormat_ETC2RGBA8UnormSrgb:
    case WGPUTextureFormat_EACR11Unorm:
    case WGPUTextureFormat_EACR11Snorm:
    case WGPUTextureFormat_EACRG11Unorm:
    case WGPUTextureFormat_EACRG11Snorm:
    case WGPUTextureFormat_ASTC4x4Unorm:
    case WGPUTextureFormat_ASTC4x4UnormSrgb:
    case WGPUTextureFormat_ASTC5x4Unorm:
    case WGPUTextureFormat_ASTC5x4UnormSrgb:
    case WGPUTextureFormat_ASTC5x5Unorm:
    case WGPUTextureFormat_ASTC5x5UnormSrgb:
    case WGPUTextureFormat_ASTC6x5Unorm:
    case WGPUTextureFormat_ASTC6x5UnormSrgb:
    case WGPUTextureFormat_ASTC6x6Unorm:
    case WGPUTextureFormat_ASTC6x6UnormSrgb:
    case WGPUTextureFormat_ASTC8x5Unorm:
    case WGPUTextureFormat_ASTC8x5UnormSrgb:
    case WGPUTextureFormat_ASTC8x6Unorm:
    case WGPUTextureFormat_ASTC8x6UnormSrgb:
    case WGPUTextureFormat_ASTC8x8Unorm:
    case WGPUTextureFormat_ASTC8x8UnormSrgb:
    case WGPUTextureFormat_ASTC10x5Unorm:
    case WGPUTextureFormat_ASTC10x5UnormSrgb:
    case WGPUTextureFormat_ASTC10x6Unorm:
    case WGPUTextureFormat_ASTC10x6UnormSrgb:
    case WGPUTextureFormat_ASTC10x8Unorm:
    case WGPUTextureFormat_ASTC10x8UnormSrgb:
    case WGPUTextureFormat_ASTC10x10Unorm:
    case WGPUTextureFormat_ASTC10x10UnormSrgb:
    case WGPUTextureFormat_ASTC12x10Unorm:
    case WGPUTextureFormat_ASTC12x10UnormSrgb:
    case WGPUTextureFormat_ASTC12x12Unorm:
    case WGPUTextureFormat_ASTC12x12UnormSrgb:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_Undefined:
    case WGPUTextureFormat_Force32:
        return FormatType_Undefined;
    }
}

static bool formatIsFloat(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_Float;
}
static bool formatIsUnfilterableFloat(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_UnfilterableFloat;
}
static bool formatIsDepth(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_Depth;
}
static bool formatIsSignedInt(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_SignedInt;
}
static bool formatIsUnsignedInt(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_UnsignedInt;
}

static bool validateTextureSampleType(const WGPUTextureBindingLayout* textureEntry, const auto& apiTextureView, const Device& device)
{
    if (!textureEntry)
        return true;

    auto format = apiTextureView->format();
    auto aspect = apiTextureView->aspect();
    switch (textureEntry->sampleType) {
    case WGPUTextureSampleType_Float:
        return formatIsFloat(format, aspect, device);
    case WGPUTextureSampleType_UnfilterableFloat:
        return formatIsUnfilterableFloat(format, aspect, device);
    case WGPUTextureSampleType_Depth:
        return formatIsDepth(format, aspect, device);
    case WGPUTextureSampleType_Sint:
        return formatIsSignedInt(format, aspect, device);
    case WGPUTextureSampleType_Uint:
        return formatIsUnsignedInt(format, aspect, device);
    case WGPUTextureSampleType_Force32:
    case WGPUTextureSampleType_Undefined:
        return false;
    }
}

static const NSString* sampleType(const WGPUTextureBindingLayout* textureEntry)
{
    switch (textureEntry->sampleType) {
    case WGPUTextureSampleType_Float:
        return @"float";
    case WGPUTextureSampleType_UnfilterableFloat:
        return @"unfilterable-float";
    case WGPUTextureSampleType_Depth:
        return @"depth";
    case WGPUTextureSampleType_Sint:
        return @"sint";
    case WGPUTextureSampleType_Uint:
        return @"uint";
    case WGPUTextureSampleType_Force32:
    case WGPUTextureSampleType_Undefined:
        return @"unknown";
    }
}

static const NSString* sampleType(const auto& apiTextureView, const Device& device)
{
    auto format = apiTextureView->format();
    auto aspect = apiTextureView->aspect();
    auto type = formatType(format, aspect, device);

    NSString* result = @"";
#define MAKE_STRING(x) result.length ? (@" + " x) : (x)
    if (type & FormatType_Float)
        result = [result stringByAppendingString:MAKE_STRING(@"float")];
    if (type & FormatType_UnfilterableFloat)
        result = [result stringByAppendingString:MAKE_STRING(@"unfilterable-float")];
    if (type & FormatType_Depth)
        result = [result stringByAppendingString:MAKE_STRING(@"depth")];
    if (type & FormatType_SignedInt)
        result = [result stringByAppendingString:MAKE_STRING(@"sint")];
    if (type & FormatType_UnsignedInt)
        result = [result stringByAppendingString:MAKE_STRING(@"uint")];
#undef MAKE_STRING

    return result;
}

static bool validateTextureViewDimension(const auto* textureEntry, const auto& apiTextureView)
{
    if (!textureEntry)
        return true;

    WGPUTextureViewDimension viewDimension = textureEntry->viewDimension;
    auto textureType = apiTextureView->texture().textureType;
    switch (viewDimension) {
    case WGPUTextureViewDimension_1D:
        return textureType == MTLTextureType1D;
    case WGPUTextureViewDimension_2D:
        return textureType == MTLTextureType2D || textureType == MTLTextureType2DMultisample;
    case WGPUTextureViewDimension_2DArray:
        return textureType == MTLTextureType2DArray || textureType == MTLTextureType2DMultisampleArray;
    case WGPUTextureViewDimension_Cube:
        return textureType == MTLTextureTypeCube;
    case WGPUTextureViewDimension_CubeArray:
        return textureType == MTLTextureTypeCubeArray;
    case WGPUTextureViewDimension_3D:
        return textureType == MTLTextureType3D;
    case WGPUTextureViewDimension_Undefined:
    case WGPUTextureViewDimension_Force32:
        return false;
    }
}

static bool NODELETE validateStorageTextureViewFormat(const WGPUStorageTextureBindingLayout* storageTexture, const auto& apiTextureView)
{
    return !storageTexture || storageTexture->format == apiTextureView->format();
}

static bool NODELETE validateSamplerType(WGPUSamplerBindingType type, const Sampler& sampler)
{
    switch (type) {
    case WGPUSamplerBindingType_Filtering:
        return !sampler.isComparison();
    case WGPUSamplerBindingType_NonFiltering:
        return !sampler.isComparison() && !sampler.isFiltering();
    case WGPUSamplerBindingType_Comparison:
        return sampler.isComparison();
    case WGPUSamplerBindingType_Undefined:
    case WGPUSamplerBindingType_Force32:
        ASSERT_NOT_REACHED();
        return false;
    }
}

static BindGroupEntryUsage NODELETE usageForTexture(const WGPUTextureBindingLayout&)
{
    return BindGroupEntryUsage::ConstantTexture;
}

static BindGroupEntryUsage NODELETE usageForStorageTexture(const WGPUStorageTextureBindingLayout& textureLayout)
{
    switch (textureLayout.access) {
    case WGPUStorageTextureAccess_Undefined:
        return BindGroupEntryUsage::Undefined;
    case WGPUStorageTextureAccess_ReadOnly:
        return BindGroupEntryUsage::StorageTextureRead;
    case WGPUStorageTextureAccess_ReadWrite:
        return BindGroupEntryUsage::StorageTextureReadWrite;
    case WGPUStorageTextureAccess_WriteOnly:
        return BindGroupEntryUsage::StorageTextureWriteOnly;
    case WGPUStorageTextureAccess_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }

    RELEASE_ASSERT_NOT_REACHED();
    return BindGroupEntryUsage::Undefined;
}

static BindGroupEntryUsage NODELETE usageForBuffer(WGPUBufferBindingType bufferBindingType)
{
    switch (bufferBindingType) {
    case WGPUBufferBindingType_Undefined:
        return BindGroupEntryUsage::Undefined;
    case WGPUBufferBindingType_Uniform:
        return BindGroupEntryUsage::Constant;
    case WGPUBufferBindingType_Storage:
        return BindGroupEntryUsage::Storage;
    case WGPUBufferBindingType_ReadOnlyStorage:
        return BindGroupEntryUsage::StorageRead;
    case WGPUBufferBindingType_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }

    return BindGroupEntryUsage::Undefined;
}

template <typename T>
static BindGroupEntryUsageData makeBindGroupEntryUsageData(BindGroupEntryUsage usage, uint32_t bindingIndex, const Ref<T>& resource, uint64_t entryOffset = 0, uint64_t entrySize = 0)
{
    return BindGroupEntryUsageData { .usage = usage, .binding = bindingIndex, .resource = resource.ptr(), .entryOffset = entryOffset, .entrySize = entrySize };
}

static bool NODELETE allowedExternalTextureFormat(WGPUTextureFormat format)
{
    switch (format) {
    case WGPUTextureFormat_RGBA8Unorm:
    case WGPUTextureFormat_BGRA8Unorm:
    case WGPUTextureFormat_RGBA16Float:
        return true;
    default:
        return false;
    }
}

template <typename T>
static std::optional<Ref<BindGroup>> validateTextureOrBindGroup(WebGPU::Device &object, const Ref<T> &apiTextureView, BindGroup::ShaderStageArray<id<MTLBuffer>> &argumentBuffer, BindGroup::ShaderStageArray<id<MTLArgumentEncoder>> &argumentEncoder, BindGroup::ShaderStageArray<BindGroupLayout::ArgumentIndices> &argumentIndices, const Ref<BindGroupLayout> &bindGroupLayout, const WGPUBindGroupEntry &entry, const WGPUExternalTextureBindingLayout *externalTextureEntry, NSUInteger index, MTLResourceUsage resourceUsage, ShaderStage stage, std::array<std::array<Vector<BindGroupEntryUsageData>, maxResourceUsageValue>, stagesPlusUndefinedCount> &stageResourceUsages, std::array<std::array<Vector<id<MTLResource>>, maxResourceUsageValue>, stagesPlusUndefinedCount> &stageResources, const WGPUStorageTextureBindingLayout *storageTextureEntry, const WGPUTextureBindingLayout *textureEntry)
{
#define INTERNAL_ERROR_STRING(x) [NSString stringWithFormat:@"GPUDevice.createBindGroup: %@", x]
#define VALIDATION_ERROR(...) object.generateAValidationError(INTERNAL_ERROR_STRING((__VA_ARGS__)))

    object.getQueue()->clearTextureViewIfNeeded(apiTextureView);

    id<MTLTexture> texture = apiTextureView->texture();
    if (!apiTextureView->isDestroyed()) {
        if (!apiTextureView->isValid()) {
            VALIDATION_ERROR(@"Underlying texture is not valid");
            return BindGroup::createInvalid(object);
        }
        if (&apiTextureView->device() != &object) {
            VALIDATION_ERROR(@"Underlying texture was created from a different device");
            return BindGroup::createInvalid(object);
        }
        auto textureUsage = apiTextureView->usage();
        if ((textureEntry && !(textureUsage & WGPUTextureUsage_TextureBinding)) || (storageTextureEntry && !(textureUsage & WGPUTextureUsage_StorageBinding))) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Storage texture usage(%u) did not have storage usage or storage texture entry did not have storage binding", textureUsage]);
            return BindGroup::createInvalid(object);
        }
        if (textureEntry && (3 * (textureEntry->multisampled ? 1 : 0) + 1 != apiTextureView->sampleCount())) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Bind group entry multisampled(%d) state does not match underlying texture sample count(%d)", textureEntry->multisampled, apiTextureView->sampleCount()]);
            return BindGroup::createInvalid(object);
        }
        if (!bindGroupLayout->isAutoGenerated() && !validateTextureSampleType(textureEntry, apiTextureView, object)) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Bind group entry sampleType(%@) does not match TextureView sampleType(%@) for texture format(%s)", sampleType(textureEntry), sampleType(apiTextureView, object), Texture::formatToString(apiTextureView->format()).characters()]);
            return BindGroup::createInvalid(object);
        }
        if (!validateTextureViewDimension(textureEntry, apiTextureView) || !validateTextureViewDimension(storageTextureEntry, apiTextureView)) {
            VALIDATION_ERROR(@"Bind group entry viewDimension does not match TextureView viewDimension");
            return BindGroup::createInvalid(object);
        }
        if (!validateStorageTextureViewFormat(storageTextureEntry, apiTextureView)) {
            VALIDATION_ERROR(@"Bind group storage texture entry format does not match TextureView format");
            return BindGroup::createInvalid(object);
        }
        if (storageTextureEntry && apiTextureView->texture().mipmapLevelCount != 1) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Storage textures must have a single mip level(%lu)", static_cast<unsigned long>(apiTextureView->texture().mipmapLevelCount)]);
            return BindGroup::createInvalid(object);
        }

        if (textureEntry && is32bppFloatFormat(texture) && (!valid32bppFloatSampleType(textureEntry->sampleType) || (textureEntry->sampleType == WGPUTextureSampleType_Float && !object.hasFeature(WGPUFeatureName_Float32Filterable)))) {
            VALIDATION_ERROR(@"Can not create bind group with filterable 32bpp floating point texture as float32-filterable feature is not enabled");
            return BindGroup::createInvalid(object);
        }
        if (externalTextureEntry) {
            if (!(textureUsage & WGPUTextureUsage_TextureBinding)) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot which does not have usage containing texture binding.");
                return BindGroup::createInvalid(object);
            }
            if (!apiTextureView->is2DTexture()) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot when the texture view is not a 2D texture.");
                return BindGroup::createInvalid(object);
            }
            if (apiTextureView->mipLevelCount() != 1) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot when the texture view has more than 1 mip level");
                return BindGroup::createInvalid(object);
            }
            if (!allowedExternalTextureFormat(apiTextureView->format())) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture which is not an allowed external texture format");
                return BindGroup::createInvalid(object);
            }
            if (apiTextureView->sampleCount() != 1) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture which has a sample count greater than 1");
                return BindGroup::createInvalid(object);
            }
        }
    } else if (stage != ShaderStage::Undefined) {
        argumentEncoder[stage] = nil;
        argumentBuffer[stage] = { };
    }

    if (stage != ShaderStage::Undefined) {
        argumentIndices[stage].remove(index);
        [argumentEncoder[stage] setTexture:texture atIndex:index];
    }
    if (texture) {
        stageResources[metalRenderStage(stage)][resourceUsage - 1].append(texture);
        // ASSERT(apiTextureView->isDestroyed() || texture.parentRelativeLevel == apiTextureView->baseMipLevel());
        // ASSERT(apiTextureView->isDestroyed() || texture.parentRelativeSlice == apiTextureView->baseArrayLayer());
        stageResourceUsages[metalRenderStage(stage)][resourceUsage - 1].append(makeBindGroupEntryUsageData(textureEntry ? usageForTexture(*textureEntry) : (storageTextureEntry ? usageForStorageTexture(*storageTextureEntry) : BindGroupEntryUsage::ConstantTexture), entry.binding, apiTextureView));
    }
#undef VALIDATION_ERROR
#undef INTERNAL_ERROR_STRING

    return std::nullopt;
}

Ref<BindGroup> Device::createBindGroup(const WGPUBindGroupDescriptor& descriptor)
{
#define INTERNAL_ERROR_STRING(x) [NSString stringWithFormat:@"GPUDevice.createBindGroup: %@", x]
#define VALIDATION_ERROR(...) generateAValidationError(INTERNAL_ERROR_STRING((__VA_ARGS__)))
    if (!descriptor.layout || !isValid())
        return BindGroup::createInvalid(*this);

    Ref bindGroupLayout = WebGPU::fromAPI(descriptor.layout);
    if (!bindGroupLayout->isValid() || (!bindGroupLayout->isAutoGenerated() && descriptor.entryCount != bindGroupLayout->entries().size()) || &bindGroupLayout->device() != this) {
        VALIDATION_ERROR(@"invalid BindGroupLayout createBindGroup");
        return BindGroup::createInvalid(*this);
    }

    BindGroup::ShaderStageArray<id<MTLArgumentEncoder>> argumentEncoder = std::array<id<MTLArgumentEncoder>, stageCount>({ bindGroupLayout->vertexArgumentEncoder(), bindGroupLayout->fragmentArgumentEncoder(), bindGroupLayout->computeArgumentEncoder() });
    BindGroup::ShaderStageArray<id<MTLBuffer>> argumentBuffer;
    BindGroup::ShaderStageArray<BindGroupLayout::ArgumentIndices> argumentIndices;
    for (ShaderStage stage : stages) {
        auto encodedLength = bindGroupLayout->encodedLength(stage);
        if (encodedLength)
            argumentBuffer[stage] = safeCreateBuffer(encodedLength, MTLStorageModeShared);
        [argumentEncoder[stage] setArgumentBuffer:argumentBuffer[stage] offset:0];
        argumentIndices[stage] = bindGroupLayout->argumentIndices(stage);
    }

    static_assert(maxResourceUsageValue == 3, "Code path assumes MTLResourceUsageRead | MTLResourceUsageWrite == 3");
    std::array<std::array<Vector<id<MTLResource>>, maxResourceUsageValue>, stagesPlusUndefinedCount> stageResources { };
    std::array<std::array<Vector<BindGroupEntryUsageData>, maxResourceUsageValue>, stagesPlusUndefinedCount> stageResourceUsages { };
    auto& bindGroupLayoutEntries = bindGroupLayout->entries();
    BindGroup::DynamicBuffersContainer dynamicBuffers;
    BindGroup::SamplersContainer samplersSet;
    HashSet<uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> usedBindingSlots;

    for (const WGPUBindGroupEntry& entry : descriptor.entriesSpan()) {
        bool bufferIsPresent = WebGPU::bufferIsPresent(entry);
        bool samplerIsPresent = WebGPU::samplerIsPresent(entry);
        bool textureIsPresent = WebGPU::textureIsPresent(entry);
        bool textureViewIsPresent = WebGPU::textureViewIsPresent(entry);
        if (bufferIsPresent + samplerIsPresent + textureIsPresent + textureViewIsPresent != 1)
            return BindGroup::createInvalid(*this);

        bool bindingContainedInStage = false;
        bool appendedBufferToDynamicBuffers = false;
        auto bindingIndex = entry.binding;
        if (usedBindingSlots.contains(bindingIndex)) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Binding %u is duplicated in the bind group descriptor", bindingIndex]);
            return BindGroup::createInvalid(*this);
        }
        usedBindingSlots.add(bindingIndex);
        for (ShaderStage stage : stagesPlusUndefined) {
            auto index = bindGroupLayout->argumentBufferIndexForEntryIndex(bindingIndex, stage);
            if (index == NSNotFound)
                continue;

            bindingContainedInStage = true;
            auto optionalAccess = bindGroupLayout->bindingAccessForBindingIndex(bindingIndex, stage);
            RELEASE_ASSERT(optionalAccess);
            auto bufferSizeArgumentBufferIndex = bindGroupLayout->bufferSizeIndexForEntryIndex(bindingIndex, stage);
            MTLResourceUsage resourceUsage = resourceUsageForBindingAcccess(*optionalAccess);

            if (bufferIsPresent) {
                auto* layoutBinding = hasBinding<WGPUBufferBindingLayout>(bindGroupLayoutEntries, bindingIndex);
                if (!layoutBinding) {
                    VALIDATION_ERROR(@"Expected buffer but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }
                Ref apiBuffer = WebGPU::fromAPI(entry.buffer);
                id<MTLBuffer> buffer = apiBuffer->buffer();
                bool isDestroyed = apiBuffer->isDestroyed();
                if (isDestroyed && stage != ShaderStage::Undefined) {
                    argumentEncoder[stage] = nil;
                    argumentBuffer[stage] = { };
                }

                auto entryOffset = isDestroyed ? 0 : entry.offset;
                auto bufferLengthMinusOffset = buffer.length > entryOffset ? (buffer.length - entryOffset) : 0;
                auto entrySize = entry.size == WGPU_WHOLE_MAP_SIZE ? bufferLengthMinusOffset : entry.size;
                if (layoutBinding->hasDynamicOffset && !appendedBufferToDynamicBuffers) {
                    dynamicBuffers.append({ .type = layoutBinding->type, .bindingSize = entrySize, .bufferSize = bufferLengthMinusOffset, .bindingIndex = bindingIndex });
                    appendedBufferToDynamicBuffers = true;
                }

                if (!apiBuffer->isValid() || &apiBuffer->device() != this) {
                    if (!isDestroyed)
                        VALIDATION_ERROR(@"Buffer is invalid or created from a different device");
                    return BindGroup::createInvalid(*this);
                }

                auto& deviceLimits = limits();
                const bool isUniformBuffer = layoutBinding->type == WGPUBufferBindingType_Uniform;
                const bool isStorageBuffer = layoutBinding->type == WGPUBufferBindingType_Storage || layoutBinding->type == WGPUBufferBindingType_ReadOnlyStorage;
                if (!apiBuffer->isDestroyed()) {
                    if (entry.offset >= buffer.length) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Unexpected entry.offset(%llu) >= buffer length(%lu)", entry.offset, (unsigned long)buffer.length]);
                        return BindGroup::createInvalid(*this);
                    }

                    if (!hasProperUsageFlags(layoutBinding->type, apiBuffer->usage())) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Unexpected type(%u), buffer.usage(%u)", layoutBinding->type, apiBuffer->usage()]);
                        return BindGroup::createInvalid(*this);
                    }

                    if ((isUniformBuffer && (entry.offset % deviceLimits.minUniformBufferOffsetAlignment))
                        || (isStorageBuffer && (entry.offset % deviceLimits.minStorageBufferOffsetAlignment))) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Buffer offset(%llu) is not a multiple of the device buffer alignment(%u)", entry.offset, deviceLimits.minStorageBufferOffsetAlignment]);
                        return BindGroup::createInvalid(*this);
                    }

                    if ((isUniformBuffer && entrySize > deviceLimits.maxUniformBufferBindingSize)
                        || (isStorageBuffer && entrySize > deviceLimits.maxStorageBufferBindingSize)) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Buffer size(%llu) is larger than the device limits(%llu)", entrySize, isUniformBuffer ? deviceLimits.maxUniformBufferBindingSize : deviceLimits.maxStorageBufferBindingSize]);
                        return BindGroup::createInvalid(*this);
                    }
                    if (isStorageBuffer && entrySize % 4) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Storage buffer size(%llu) is not multiple of 4", entrySize]);
                        return BindGroup::createInvalid(*this);
                    }
                    if (!entrySize || entrySize + entryOffset > buffer.length || (layoutBinding->minBindingSize && layoutBinding->minBindingSize > entrySize)) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"entrySize == 0 or entrySize(%llu) + entryOffset(%llu) > buffer size(%lu) or layoutBinding->minBindingSize(%llu) > entrySize(%llu)", entrySize, entryOffset, static_cast<unsigned long>(buffer.length), layoutBinding->minBindingSize, entrySize]);
                        return BindGroup::createInvalid(*this);
                    }
                }

                if (stage != ShaderStage::Undefined && buffer.length) {
                    argumentIndices[stage].remove(index);
                    [argumentEncoder[stage] setBuffer:buffer offset:entryOffset atIndex:index];
                    if (bufferSizeArgumentBufferIndex) {
                        argumentIndices[stage].remove(*bufferSizeArgumentBufferIndex);
                        if (auto* lengthAddress = (uint32_t*)[argumentEncoder[stage] constantDataAtIndex:*bufferSizeArgumentBufferIndex])
                            *lengthAddress = std::min<uint32_t>(entrySize, buffer.length);
                    }
                }
                if (buffer) {
                    stageResources[metalRenderStage(stage)][resourceUsage - 1].append(buffer);
                    stageResourceUsages[metalRenderStage(stage)][resourceUsage - 1].append(makeBindGroupEntryUsageData(usageForBuffer(layoutBinding->type), entry.binding, apiBuffer, entryOffset, entrySize));
                }
            } else if (samplerIsPresent) {
                auto* layoutBinding = hasBinding<WGPUSamplerBindingLayout>(bindGroupLayoutEntries, bindingIndex);
                if (!layoutBinding) {
                    VALIDATION_ERROR(@"Expected sampler but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }
                Ref apiSampler = WebGPU::fromAPI(entry.sampler);
                if (!apiSampler->isValid() || &apiSampler->device() != this) {
                    VALIDATION_ERROR(@"Underlying sampler is not valid or created from a different device");
                    return BindGroup::createInvalid(*this);
                }

                if (!validateSamplerType(layoutBinding->type, apiSampler)) {
                    VALIDATION_ERROR([NSString stringWithFormat:@"Expected sampler type(%u) has wrong comparison or filtering modes", layoutBinding->type]);
                    return BindGroup::createInvalid(*this);
                }

                id<MTLSamplerState> sampler = apiSampler->tryCacheSamplerState();
                if (stage != ShaderStage::Undefined) {
                    argumentIndices[stage].remove(index);
                    [argumentEncoder[stage] setSamplerState:sampler atIndex:index];
                    samplersSet.add(WTF::move(apiSampler), BindGroup::ShaderStageArray<std::optional<uint32_t>> { }).iterator->value[stage] = index;
                }
            } else if (textureViewIsPresent || textureIsPresent) {
                auto it = bindGroupLayoutEntries.find(bindingIndex);
                RELEASE_ASSERT(it != bindGroupLayoutEntries.end());
                auto* textureEntry = std::get_if<WGPUTextureBindingLayout>(&it->value.bindingLayout);
                auto* storageTextureEntry = std::get_if<WGPUStorageTextureBindingLayout>(&it->value.bindingLayout);
                auto* externalTextureEntry = std::get_if<WGPUExternalTextureBindingLayout>(&it->value.bindingLayout);
                if (!textureEntry && !storageTextureEntry && !externalTextureEntry) {
                    VALIDATION_ERROR(@"Expected texture or storage texture but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }

                if (textureViewIsPresent) {
                    Ref apiTextureView = WebGPU::fromAPI(entry.textureView);
                    if (auto result = validateTextureOrBindGroup(*this, apiTextureView, argumentBuffer, argumentEncoder, argumentIndices, bindGroupLayout, entry, externalTextureEntry, index, resourceUsage, stage, stageResourceUsages, stageResources, storageTextureEntry, textureEntry))
                        return *result;
                } else {
                    Ref apiTexture = WebGPU::fromAPI(entry.texture);
                    if (auto result = validateTextureOrBindGroup(*this, apiTexture, argumentBuffer, argumentEncoder, argumentIndices, bindGroupLayout, entry, externalTextureEntry, index, resourceUsage, stage, stageResourceUsages, stageResources, storageTextureEntry, textureEntry))
                        return *result;
                }

            }
        }

        if (!bindingContainedInStage && !bindGroupLayout->isAutoGenerated()) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Binding %d was not contained in the bind group", entry.binding]);
            return BindGroup::createInvalid(*this);
        }
    }

    for (auto& indices : argumentIndices) {
        if (indices.size())
            return BindGroup::createInvalid(*this);
    }

    Vector<BindableResources> resources;
    for (ShaderStage stage : stagesPlusUndefined) {
        for (size_t i = 0; i < maxResourceUsageValue; ++i) {
            auto renderStage = metalRenderStage(stage);
            auto &v = stageResources[renderStage][i];
            auto &u = stageResourceUsages[renderStage][i];
            static_assert(MTLResourceUsageRead == 1 && !BindGroupLayout::BindingAccessReadOnly);
            if (v.size()) {
                resources.append(BindableResources {
                    .mtlResources = WTF::move(v),
                    .resourceUsages = WTF::move(u),
                    .usage = static_cast<MTLResourceUsage>(i + 1),
                    .renderStages = renderStage
                });
            }
        }
    }

    argumentBuffer[ShaderStage::Vertex].label = bindGroupLayout->vertexArgumentEncoder().label;
    argumentBuffer[ShaderStage::Fragment].label = bindGroupLayout->fragmentArgumentEncoder().label;
    argumentBuffer[ShaderStage::Compute].label = bindGroupLayout->computeArgumentEncoder().label;

    std::ranges::sort(dynamicBuffers, { }, &BindGroup::BufferAndType::bindingIndex);

    if (m_bindGroupId == std::numeric_limits<decltype(m_bindGroupId)>::max()) {
        loseTheDevice(WGPUDeviceLostReason_Undefined);
        return BindGroup::createInvalid(*this);
    }

    return BindGroup::create(argumentBuffer[ShaderStage::Vertex], argumentBuffer[ShaderStage::Fragment], argumentBuffer[ShaderStage::Compute], WTF::move(resources), bindGroupLayout, WTF::move(dynamicBuffers), WTF::move(samplersSet), ++m_bindGroupId, *this);
#undef VALIDATION_ERROR
#undef INTERNAL_ERROR_STRING
}

bool BindGroup::isValid() const
{
    return !!bindGroupLayout();
}

BindGroup::BindGroup(id<MTLBuffer> vertexArgumentBuffer, id<MTLBuffer> fragmentArgumentBuffer, id<MTLBuffer> computeArgumentBuffer, Vector<BindableResources>&& resources, const BindGroupLayout& bindGroupLayout, DynamicBuffersContainer&& dynamicBuffers, SamplersContainer&& samplers, uint32_t uniqueIdentifier, Device& device)
    : m_vertexArgumentBuffer(vertexArgumentBuffer)
    , m_fragmentArgumentBuffer(fragmentArgumentBuffer)
    , m_computeArgumentBuffer(computeArgumentBuffer)
    , m_device(device)
    , m_resources(WTF::move(resources))
    , m_bindGroupLayout(&bindGroupLayout)
    , m_dynamicBuffers(WTF::move(dynamicBuffers))
    , m_samplers(WTF::move(samplers))
    , m_uniqueIdentifier(uniqueIdentifier)
{
    for (size_t index = 0, maxIndex = m_dynamicBuffers.size(); index < maxIndex; ++index)
        m_dynamicOffsetsIndices.add(m_dynamicBuffers[index].bindingIndex, index);
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(BindGroup);

BindGroup::BindGroup(Device& device)
    : m_device(device)
{
}

BindGroup::~BindGroup() = default;

const BindGroup::BufferAndType* BindGroup::dynamicBuffer(uint32_t i) const
{
    ASSERT(i < m_dynamicBuffers.size());
    return i < m_dynamicBuffers.size() ? &m_dynamicBuffers[i] : nullptr;
}

uint32_t BindGroup::dynamicOffset(uint32_t bindingIndex, const Vector<uint32_t>* dynamicOffsets) const
{
    if (auto it = m_dynamicOffsetsIndices.find(bindingIndex); it != m_dynamicOffsetsIndices.end())
        return dynamicOffsets && it->value < dynamicOffsets->size() ? (*dynamicOffsets)[it->value] : 0u;

    return 0u;
}

void BindGroup::setLabel(String&& label)
{
    RetainPtr labelString = createNSString(label);
    m_vertexArgumentBuffer.label = labelString.get();
    m_fragmentArgumentBuffer.label = labelString.get();
    m_computeArgumentBuffer.label = labelString.get();
}

bool BindGroup::allowedUsage(const OptionSet<BindGroupEntryUsage>& allowedUsage)
{
    if ((allowedUsage & BindGroupEntryUsage::Storage) && (allowedUsage != BindGroupEntryUsage::Storage))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::StorageTextureWriteOnly) && (allowedUsage != BindGroupEntryUsage::StorageTextureWriteOnly))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::StorageTextureReadWrite) && (allowedUsage != BindGroupEntryUsage::StorageTextureReadWrite))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::Attachment) && (allowedUsage != BindGroupEntryUsage::Attachment))
        return false;

    return true;
}

NSString* BindGroup::usageName(const OptionSet<BindGroupEntryUsage>& allowedUsage)
{
    NSString* result = @"";
    if (allowedUsage & BindGroupEntryUsage::Input)
        result = [result stringByAppendingString:@"Input "];
    if (allowedUsage & BindGroupEntryUsage::Constant)
        result = [result stringByAppendingString:@"Constant "];
    if (allowedUsage & BindGroupEntryUsage::Storage)
        result = [result stringByAppendingString:@"Storage "];
    if (allowedUsage & BindGroupEntryUsage::StorageRead)
        result = [result stringByAppendingString:@"StorageRead "];
    if (allowedUsage & BindGroupEntryUsage::Attachment)
        result = [result stringByAppendingString:@"Attachment "];
    if (allowedUsage & BindGroupEntryUsage::AttachmentRead)
        result = [result stringByAppendingString:@"AttachmentRead "];
    if (allowedUsage & BindGroupEntryUsage::ConstantTexture)
        result = [result stringByAppendingString:@"ConstantTexture "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureWriteOnly)
        result = [result stringByAppendingString:@"StorageTextureWriteOnly "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureRead)
        result = [result stringByAppendingString:@"StorageTextureRead "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureReadWrite)
        result = [result stringByAppendingString:@"StorageTextureReadWrite "];

    return result;
}

uint64_t BindGroup::makeEntryMapKey(uint32_t baseMipLevel, uint32_t baseArrayLayer, WGPUTextureAspect aspect)
{
    RELEASE_ASSERT(aspect);
    return (static_cast<uint64_t>(aspect) - 1) | (static_cast<uint64_t>(baseMipLevel) << 1) | (static_cast<uint64_t>(baseArrayLayer) << 32);
}

[[nodiscard]] static bool setArgumentBuffer(id<MTLArgumentEncoder> encoder, id<MTLBuffer> buffer)
{
    if (!encoder || !buffer)
        return false;

    [encoder setArgumentBuffer:buffer offset:0];
    return true;
}

bool BindGroup::rebindSamplersIfNeeded() const
{
    if (!m_bindGroupLayout)
        return true;

    for (auto& [samplerRef, shaderStageArray] : m_samplers) {
        Ref sampler = samplerRef;
        if (sampler->cachedSamplerState())
            continue;

        WTFLogAlways("Rebinding of samplers required, if this occurs frequently the application is using too many unique samplers");
        id<MTLSamplerState> samplerState = sampler->tryCacheSamplerState();
        if (!samplerState)
            return false;
        if (shaderStageArray[ShaderStage::Vertex].has_value() && setArgumentBuffer(m_bindGroupLayout->vertexArgumentEncoder(), vertexArgumentBuffer()))
            [m_bindGroupLayout->vertexArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Vertex]];

        if (shaderStageArray[ShaderStage::Fragment].has_value() && setArgumentBuffer(m_bindGroupLayout->fragmentArgumentEncoder(), fragmentArgumentBuffer()))
            [m_bindGroupLayout->fragmentArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Fragment]];

        if (shaderStageArray[ShaderStage::Compute].has_value() && setArgumentBuffer(m_bindGroupLayout->computeArgumentEncoder(), computeArgumentBuffer()))
            [m_bindGroupLayout->computeArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Compute]];
    }
    return true;
}

bool BindGroup::makeSubmitInvalid(ShaderStage stage, const BindGroupLayout* pipelineLayout) const
{
    if (!pipelineLayout || pipelineLayout->entries().isEmpty())
        return false;

    if (!m_bindGroupLayout)
        return true;

    Ref pipelineBindGroupLayout { *pipelineLayout };
    switch (stage) {
    case ShaderStage::Vertex:
        return m_vertexArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Fragment:
        return m_fragmentArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Compute:
        return m_computeArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Undefined:
        return true;
    }

    return true;
}

static uint64_t NODELETE makePipelineBindGroupKey(uint32_t groupIndex, uint64_t pipelineIndex)
{
    return static_cast<uint64_t>(groupIndex) | (pipelineIndex << Device::maxBindGroups);
}

void BindGroup::validatedSuccessfully(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const
{
    auto it = m_validatedBindGroup.add(makePipelineBindGroupKey(groupIndex, pipelineIndex), maxOffset).iterator;
    it->value = std::max(it->value, maxOffset);
}

bool BindGroup::previouslyValidatedBindGroup(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const
{
    auto it = m_validatedBindGroup.find(makePipelineBindGroupKey(groupIndex, pipelineIndex));
    return it != m_validatedBindGroup.end() && it->value >= maxOffset;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuBindGroupReference(WGPUBindGroup bindGroup)
{
    WebGPU::fromAPI(bindGroup).ref();
}

void wgpuBindGroupRelease(WGPUBindGroup bindGroup)
{
    WebGPU::fromAPI(bindGroup).deref();
}

void wgpuBindGroupSetLabel(WGPUBindGroup bindGroup, const char* label)
{
    protect(WebGPU::fromAPI(bindGroup))->setLabel(WebGPU::fromAPI(label));
}
