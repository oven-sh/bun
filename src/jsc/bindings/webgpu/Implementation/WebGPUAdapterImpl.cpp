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
#include "WebGPUAdapterImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUConvertToBackingContext.h"
#include "WebGPUDeviceImpl.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/BlockPtr.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

static String adapterName(WGPUAdapter adapter)
{
    WGPUAdapterProperties properties;
    wgpuAdapterGetProperties(adapter, &properties);
    return String::fromLatin1(properties.name);
}

static Ref<SupportedFeatures> supportedFeatures(const Vector<WGPUFeatureName>& features)
{
    Vector<String> result;
    for (auto feature : features)
        result.append(wgpuAdapterFeatureName(feature));

    return SupportedFeatures::create(WTF::move(result));
}

static Ref<SupportedFeatures> supportedFeatures(WGPUAdapter adapter)
{
    auto featureCount = wgpuAdapterEnumerateFeatures(adapter, nullptr);
    Vector<WGPUFeatureName> features(featureCount);
    wgpuAdapterEnumerateFeatures(adapter, features.mutableSpan().data());

    return supportedFeatures(features);
}

static Ref<SupportedLimits> supportedLimits(WGPUAdapter adapter)
{
    WGPUSupportedLimits limits;
    auto result = wgpuAdapterGetLimits(adapter, &limits);
    ASSERT_UNUSED(result, result);

    // https://www.w3.org/TR/webgpu/#devices
    // maxStorageBuffersPerShaderStage = max(perStage, inVertex, inFragment)
    // Then set inVertex and inFragment equal to the per-stage value.
    auto& lm = limits.limits;
    lm.maxStorageBuffersPerShaderStage = std::max({ lm.maxStorageBuffersPerShaderStage, lm.maxStorageBuffersInVertexStage, lm.maxStorageBuffersInFragmentStage });
    lm.maxStorageBuffersInVertexStage = lm.maxStorageBuffersPerShaderStage;
    lm.maxStorageBuffersInFragmentStage = lm.maxStorageBuffersPerShaderStage;

    lm.maxStorageTexturesPerShaderStage = std::max({ lm.maxStorageTexturesPerShaderStage, lm.maxStorageTexturesInVertexStage, lm.maxStorageTexturesInFragmentStage });
    lm.maxStorageTexturesInVertexStage = lm.maxStorageTexturesPerShaderStage;
    lm.maxStorageTexturesInFragmentStage = lm.maxStorageTexturesPerShaderStage;

    return SupportedLimits::create(
        limits.limits.maxTextureDimension1D,
        limits.limits.maxTextureDimension2D,
        limits.limits.maxTextureDimension3D,
        limits.limits.maxTextureArrayLayers,
        limits.limits.maxBindGroups,
        limits.limits.maxBindGroupsPlusVertexBuffers,
        limits.limits.maxBindingsPerBindGroup,
        limits.limits.maxDynamicUniformBuffersPerPipelineLayout,
        limits.limits.maxDynamicStorageBuffersPerPipelineLayout,
        limits.limits.maxSampledTexturesPerShaderStage,
        limits.limits.maxSamplersPerShaderStage,
        limits.limits.maxStorageBuffersPerShaderStage,
        limits.limits.maxStorageTexturesPerShaderStage,
        limits.limits.maxUniformBuffersPerShaderStage,
        limits.limits.maxUniformBufferBindingSize,
        limits.limits.maxStorageBufferBindingSize,
        limits.limits.minUniformBufferOffsetAlignment,
        limits.limits.minStorageBufferOffsetAlignment,
        limits.limits.maxVertexBuffers,
        limits.limits.maxBufferSize,
        limits.limits.maxVertexAttributes,
        limits.limits.maxVertexBufferArrayStride,
        limits.limits.maxInterStageShaderVariables,
        limits.limits.maxColorAttachments,
        limits.limits.maxColorAttachmentBytesPerSample,
        limits.limits.maxComputeWorkgroupStorageSize,
        limits.limits.maxComputeInvocationsPerWorkgroup,
        limits.limits.maxComputeWorkgroupSizeX,
        limits.limits.maxComputeWorkgroupSizeY,
        limits.limits.maxComputeWorkgroupSizeZ,
        limits.limits.maxComputeWorkgroupsPerDimension,
        limits.limits.maxStorageBuffersInFragmentStage,
        limits.limits.maxStorageTexturesInFragmentStage,
        limits.limits.maxStorageBuffersInVertexStage,
        limits.limits.maxStorageTexturesInVertexStage);
}

static bool isFallbackAdapter(WGPUAdapter adapter)
{
    WGPUAdapterProperties properties;
    wgpuAdapterGetProperties(adapter, &properties);
    return properties.adapterType == WGPUAdapterType_CPU;
}

static uint32_t subgroupMinSize(WGPUAdapter adapter)
{
    WGPUAdapterProperties properties;
    wgpuAdapterGetProperties(adapter, &properties);
    return properties.subgroupMinSize;
}

static uint32_t subgroupMaxSize(WGPUAdapter adapter)
{
    WGPUAdapterProperties properties;
    wgpuAdapterGetProperties(adapter, &properties);
    return properties.subgroupMaxSize;
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(AdapterImpl);

AdapterImpl::AdapterImpl(WebGPUPtr<WGPUAdapter>&& adapter, ConvertToBackingContext& convertToBackingContext)
    : Adapter(adapterName(adapter.get()), supportedFeatures(adapter.get()), supportedLimits(adapter.get()), WebGPU::isFallbackAdapter(adapter.get()), WebGPU::subgroupMinSize(adapter.get()), WebGPU::subgroupMaxSize(adapter.get()))
    , m_backing(WTF::move(adapter))
    , m_convertToBackingContext(convertToBackingContext)
{
}

AdapterImpl::~AdapterImpl() = default;

static bool NODELETE setMaxIntegerValue(uint32_t& limitValue, uint64_t i)
{
    CheckedUint32 narrowed = i;
    if (narrowed.hasOverflowed())
        return false;

    if (uint32_t narrowedValue = narrowed.value(); narrowedValue > limitValue)
        limitValue = narrowedValue;

    return true;
}

static bool NODELETE setMaxIntegerValue(uint64_t& limitValue, uint64_t i)
{
    if (i > limitValue)
        limitValue = i;

    return true;
}

static bool NODELETE setAlignmentIntegerValue(uint32_t& limitValue, uint64_t i, uint32_t supportedAlignment)
{
    CheckedUint32 narrowed = i;
    if (narrowed.hasOverflowed())
        return false;

    uint32_t narrowedValue = narrowed.value();
    if (narrowedValue < supportedAlignment || (narrowedValue % supportedAlignment))
        return false;

    if (narrowedValue < limitValue)
        limitValue = narrowedValue;

    return true;
}

static void requestDeviceCallback(WGPURequestDeviceStatus status, WGPUDevice device, const char* message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPURequestDeviceStatus, WGPUDevice, const char*)>(userdata);
    block(status, device, message);
    Block_release(block); // Block_release is matched with Block_copy below in AdapterImpl::requestDevice().
}

void AdapterImpl::requestDevice(const DeviceDescriptor& descriptor, CompletionHandler<void(RefPtr<Device>&&)>&& callback)
{
    auto label = descriptor.label.utf8();

    auto features = descriptor.requiredFeatures.map([&convertToBackingContext = m_convertToBackingContext.get()](auto featureName) {
        return convertToBackingContext.convertToBacking(featureName);
    });

    if (features.contains(WGPUFeatureName_TextureFormatsTier2) && !features.contains(WGPUFeatureName_TextureFormatsTier1))
        features.append(WGPUFeatureName_TextureFormatsTier1);

    if (features.contains(WGPUFeatureName_TextureFormatsTier1) && !features.contains(WGPUFeatureName_RG11B10UfloatRenderable))
        features.append(WGPUFeatureName_RG11B10UfloatRenderable);

    if (!features.contains(WGPUFeatureName_CoreFeaturesAndLimits))
        features.append(WGPUFeatureName_CoreFeaturesAndLimits);

    auto limits = wgpuDefaultLimits();

    auto& supportedLimits = this->limits();

    for (const auto& pair : descriptor.requiredLimits) {
#define SET_MAX_VALUE(LIMIT) \
        else if (pair.key == #LIMIT ""_s) { \
            if (pair.value > supportedLimits.LIMIT() || !setMaxIntegerValue(limits.LIMIT, pair.value)) { \
                callback(nullptr); \
                return; \
            } \
        }

#define SET_ALIGNMENT_VALUE(LIMIT) \
        else if (pair.key == #LIMIT ""_s) { \
            if (!setAlignmentIntegerValue(limits.LIMIT, pair.value, supportedLimits.LIMIT())) { \
                callback(nullptr); \
                return; \
            } \
        }

        if (false) { }
        SET_MAX_VALUE(maxTextureDimension1D)
        SET_MAX_VALUE(maxTextureDimension2D)
        SET_MAX_VALUE(maxTextureDimension3D)
        SET_MAX_VALUE(maxTextureArrayLayers)
        SET_MAX_VALUE(maxBindGroups)
        SET_MAX_VALUE(maxBindGroupsPlusVertexBuffers)
        SET_MAX_VALUE(maxBindingsPerBindGroup)
        SET_MAX_VALUE(maxDynamicUniformBuffersPerPipelineLayout)
        SET_MAX_VALUE(maxDynamicStorageBuffersPerPipelineLayout)
        SET_MAX_VALUE(maxSampledTexturesPerShaderStage)
        SET_MAX_VALUE(maxSamplersPerShaderStage)
        SET_MAX_VALUE(maxStorageBuffersPerShaderStage)
        SET_MAX_VALUE(maxStorageTexturesPerShaderStage)
        SET_MAX_VALUE(maxUniformBuffersPerShaderStage)
        SET_MAX_VALUE(maxUniformBufferBindingSize)
        SET_MAX_VALUE(maxStorageBufferBindingSize)
        SET_ALIGNMENT_VALUE(minUniformBufferOffsetAlignment)
        SET_ALIGNMENT_VALUE(minStorageBufferOffsetAlignment)
        SET_MAX_VALUE(maxVertexBuffers)
        SET_MAX_VALUE(maxBufferSize)
        SET_MAX_VALUE(maxVertexAttributes)
        SET_MAX_VALUE(maxVertexBufferArrayStride)
        SET_MAX_VALUE(maxInterStageShaderVariables)
        SET_MAX_VALUE(maxColorAttachments)
        SET_MAX_VALUE(maxColorAttachmentBytesPerSample)
        SET_MAX_VALUE(maxComputeWorkgroupStorageSize)
        SET_MAX_VALUE(maxComputeInvocationsPerWorkgroup)
        SET_MAX_VALUE(maxComputeWorkgroupSizeX)
        SET_MAX_VALUE(maxComputeWorkgroupSizeY)
        SET_MAX_VALUE(maxComputeWorkgroupSizeZ)
        SET_MAX_VALUE(maxComputeWorkgroupsPerDimension)
        SET_MAX_VALUE(maxStorageBuffersInFragmentStage)
        SET_MAX_VALUE(maxStorageTexturesInFragmentStage)
        SET_MAX_VALUE(maxStorageBuffersInVertexStage)
        SET_MAX_VALUE(maxStorageTexturesInVertexStage)
        else {
            callback(nullptr);
            return;
        }

#undef SET_ALIGNMENT_VALUE
#undef SET_MAX_VALUE
    }

    WGPURequiredLimits requiredLimits { .limits = WTF::move(limits) };

    WGPUDeviceDescriptor backingDescriptor {
        .label = label.data(),
        .requiredFeatureCount = features.size(),
        .requiredFeatures = features.size() ? features.span().data() : nullptr,
        .requiredLimits = &requiredLimits,
        .defaultQueue = {
            .label = "queue"
        },
        .deviceLostCallback = nullptr,
        .deviceLostUserdata = nullptr,
    };

    auto requestedLimits = SupportedLimits::create(limits.maxTextureDimension1D,
        limits.maxTextureDimension2D,
        limits.maxTextureDimension3D,
        limits.maxTextureArrayLayers,
        limits.maxBindGroups,
        limits.maxBindGroupsPlusVertexBuffers,
        limits.maxBindingsPerBindGroup,
        limits.maxDynamicUniformBuffersPerPipelineLayout,
        limits.maxDynamicStorageBuffersPerPipelineLayout,
        limits.maxSampledTexturesPerShaderStage,
        limits.maxSamplersPerShaderStage,
        limits.maxStorageBuffersPerShaderStage,
        limits.maxStorageTexturesPerShaderStage,
        limits.maxUniformBuffersPerShaderStage,
        limits.maxUniformBufferBindingSize,
        limits.maxStorageBufferBindingSize,
        limits.minUniformBufferOffsetAlignment,
        limits.minStorageBufferOffsetAlignment,
        limits.maxVertexBuffers,
        limits.maxBufferSize,
        limits.maxVertexAttributes,
        limits.maxVertexBufferArrayStride,
        limits.maxInterStageShaderVariables,
        limits.maxColorAttachments,
        limits.maxColorAttachmentBytesPerSample,
        limits.maxComputeWorkgroupStorageSize,
        limits.maxComputeInvocationsPerWorkgroup,
        limits.maxComputeWorkgroupSizeX,
        limits.maxComputeWorkgroupSizeY,
        limits.maxComputeWorkgroupSizeZ,
        limits.maxComputeWorkgroupsPerDimension,
        limits.maxStorageBuffersInFragmentStage,
        limits.maxStorageTexturesInFragmentStage,
        limits.maxStorageBuffersInVertexStage,
        limits.maxStorageTexturesInVertexStage);

    auto requestedFeatures = supportedFeatures(features);
    auto blockPtr = makeBlockPtr([protectedThis = protect(*this), convertToBackingContext = m_convertToBackingContext.copyRef(), callback = WTF::move(callback), requestedLimits, requestedFeatures](WGPURequestDeviceStatus status, WGPUDevice device, const char*) mutable {
        callback(DeviceImpl::create(adoptWebGPU(device), status == WGPURequestDeviceStatus_Success ? WTF::move(requestedFeatures) : SupportedFeatures::create({ }), WTF::move(requestedLimits), convertToBackingContext));
    });
    wgpuAdapterRequestDevice(m_backing.get(), &backingDescriptor, &requestDeviceCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in requestDeviceCallback().
}

bool AdapterImpl::xrCompatible()
{
    return wgpuAdapterXRCompatible(m_backing.get());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
