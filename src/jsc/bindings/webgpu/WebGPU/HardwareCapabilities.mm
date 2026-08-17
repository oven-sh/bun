/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
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
#import "HardwareCapabilities.h"

#import <algorithm>
#import <limits>
#import <ranges>
#import <sys/sysctl.h>
#import <wtf/MathExtras.h>
#import <wtf/PageBlock.h>
#import <wtf/StdLibExtras.h>

namespace WebGPU {

// FIXME: these two limits should be 30 and 30, but they fail the tests
// due to https://github.com/gpuweb/cts/issues/3376
static constexpr auto maxVertexBuffers = 12;
static constexpr uint32_t maxBindGroups = 11;

static constexpr auto tier2LimitForBuffersAndTextures = 4;
static constexpr auto tier2LimitForSamplers = 2;
static constexpr uint64_t defaultMaxBufferSize = 268435456;

static constexpr auto NODELETE multipleOf4(auto input)
{
    return input & (~3);
}
static uint64_t maxBufferSize(id<MTLDevice> device)
{
    constexpr auto maxBuffersToAllow = 3;
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
    auto result = std::max<uint64_t>(std::min<uint64_t>(device.maxBufferLength, GB), std::min<uint64_t>(INT_MAX, device.maxBufferLength / maxBuffersToAllow));
#else
    auto result = std::max<uint64_t>(defaultMaxBufferSize, std::min<uint64_t>(GB, device.maxBufferLength / maxBuffersToAllow));
#endif
    return multipleOf4(result);
}

static constexpr uint32_t NODELETE largeReasonableLimit()
{
    return USHRT_MAX;
}

static constexpr auto NODELETE workaroundCTSBindGroupLimit(auto valueToClamp)
{
    return valueToClamp > 1000 ? 1000 : valueToClamp;
}

#if CPU(X86_64)
static bool isIntel(id<MTLDevice> device)
{
    return [device.name localizedCaseInsensitiveContainsString:@"intel"];
}
#endif

// https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf

static HardwareCapabilities::BaseCapabilities baseCapabilities(id<MTLDevice> device)
{
    id<MTLCounterSet> timestampCounterSet = nil;
    id<MTLCounterSet> statisticCounterSet = nil;

#if CPU(X86_64)
    if (!isIntel(device)) {
#endif
        if ([device supportsCounterSampling:MTLCounterSamplingPointAtStageBoundary]) {
            for (id<MTLCounterSet> counterSet in device.counterSets) {
                if ([counterSet.name isEqualToString:MTLCommonCounterSetTimestamp])
                    timestampCounterSet = counterSet;
                else if ([counterSet.name isEqualToString:MTLCommonCounterSetStatistic])
                    statisticCounterSet = counterSet;
            }
        }
#if CPU(X86_64)
    }
#endif

    return HardwareCapabilities::BaseCapabilities {
        .argumentBuffersTier = [device argumentBuffersSupport],
        .timestampCounterSet = timestampCounterSet,
        .statisticCounterSet = statisticCounterSet,
        .memoryBarrierLimit = std::numeric_limits<decltype(HardwareCapabilities::BaseCapabilities::memoryBarrierLimit)>::max(),
        .supportsNonPrivateDepthStencilTextures = false, // To be filled in by the caller.
        .canPresentRGB10A2PixelFormats = false, // To be filled in by the caller.
        .supportsResidencySets = false,
    };
}

static Vector<WGPUFeatureName> baseFeatures(id<MTLDevice> device, const HardwareCapabilities::BaseCapabilities& baseCapabilities)
{
    Vector<WGPUFeatureName> features;

    features.append(WGPUFeatureName_CoreFeaturesAndLimits);
    features.append(WGPUFeatureName_Float16Renderable);
    features.append(WGPUFeatureName_Float32Renderable);
    features.append(WGPUFeatureName_Float32Blendable);

    features.append(WGPUFeatureName_ClipDistances);
    features.append(WGPUFeatureName_PrimitiveIndex);
    features.append(WGPUFeatureName_DepthClipControl);
    features.append(WGPUFeatureName_Depth32FloatStencil8);

    UNUSED_PARAM(baseCapabilities);

#if !0 /* PLATFORM(WATCHOS) */
    if (device.supportsBCTextureCompression) {
        features.append(WGPUFeatureName_TextureCompressionBC);
        features.append(WGPUFeatureName_TextureCompressionBCSliced3D);
    }
#else
    UNUSED_PARAM(device);
#endif

    // WGPUFeatureName_TextureCompressionETC2 and WGPUFeatureName_TextureCompressionASTC are to be filled in by the caller.

    features.append(WGPUFeatureName_IndirectFirstInstance);
    features.append(WGPUFeatureName_RG11B10UfloatRenderable);
    features.append(WGPUFeatureName_ShaderF16);
    features.append(WGPUFeatureName_BGRA8UnormStorage);
#if CPU(ARM64)
    features.append(WGPUFeatureName_TextureFormatsTier1);
    features.append(WGPUFeatureName_TextureFormatsTier2);
#endif

    // Subgroup (SIMD-group) built-in functions are guaranteed across GPU vendors by the
    // Metal 3 feature set, which provides the full reduction, prefix-scan, shuffle, ballot,
    // and quad operation set that the WGSL 'subgroups' extension requires.
    if ([device supportsFamily:MTLGPUFamilyMetal3])
        features.append(WGPUFeatureName_Subgroups);

#if !0 /* PLATFORM(WATCHOS) */
    if (device.supports32BitFloatFiltering)
        features.append(WGPUFeatureName_Float32Filterable);
#endif

    if (baseCapabilities.timestampCounterSet)
        features.append(WGPUFeatureName_TimestampQuery);

    return features;
}

bool isShaderValidationEnabled(id<MTLDevice> device)
{
    static bool result = [&] {
        // Workaround for rdar://141660277
        NSString* deviceName = NSStringFromClass([device class]);
        bool result = [deviceName containsString:@"Debug"] || [deviceName containsString:@"LegacySV"] || [deviceName containsString:@"CaptureMTLDevice"];
        if (result)
            WTFLogAlways("WebGPU: Using DEBUG Metal device: retaining references"); // NOLINT
        return result;
    }();
    return result;
}

#if ENABLE(WEBGPU_SWIFT)
static std::optional<std::array<int, 4>> extractClangVersion()
{
    NSString* input = @(__clang_version__);
    NSError *error = nil;
    NSRegularExpression *regex = [NSRegularExpression
        regularExpressionWithPattern:@"clang-([0-9]+)\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)"
        options:0
        error:&error];

    if (error)
        return std::nullopt;

    NSTextCheckingResult *match = [regex firstMatchInString:input options:0 range:NSMakeRange(0, input.length)];

    if (match && match.numberOfRanges > 1) {
        std::array<int, 4> result;
        for (int i = 0; i < 4; ++i) {
            NSRange clangRange = [match rangeAtIndex:i + 1];
            NSString* substring = [input substringWithRange:clangRange];
            result[i] = substring.intValue;
        }
        return result;
    }

    return std::nullopt;
}

static bool swiftCompilerSupportsWebGPU()
{
    auto maybeClangVersion = extractClangVersion();
    if (!maybeClangVersion)
        return false;

    auto clangVersion = *maybeClangVersion;
    if (clangVersion[0] == 1700
        && clangVersion[1] >= 6
        && (clangVersion[1] > 6 || clangVersion[2] >= 1)
        && (clangVersion[1] > 6 || clangVersion[2] > 1 || clangVersion[3] >= 1))
        return true;

    if (clangVersion[0] == 2100
        && clangVersion[1] >= 0
        && (clangVersion[1] > 0 || clangVersion[2] >= 101)
        && (clangVersion[1] > 0 || clangVersion[2] > 101 || clangVersion[3] >= 15))
        return true;

    if (clangVersion[0] > 2100)
        return true;

    return false;
}
#endif

bool isWebGPUSwiftEnabled()
{
#if defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED
    return true;
#elif !ENABLE(WEBGPU_SWIFT)
    return false;
#else
    static bool isWebGPUSwiftEnabled = [&] {
        NSNumber* object = [[NSUserDefaults standardUserDefaults] objectForKey:@"WebKitWebGPUSwiftEnabled"];
        bool isWebGPUSwiftEnabled;
        if (object)
            isWebGPUSwiftEnabled = object.boolValue;
        else
            isWebGPUSwiftEnabled = swiftCompilerSupportsWebGPU();

        if (isWebGPUSwiftEnabled)
            WTFLogAlways("WebGPU: using SWIFT backend"); // NOLINT
        else
            WTFLogAlways("WebGPU: using C++ backend"); // NOLINT
        return isWebGPUSwiftEnabled;
    }();
    return isWebGPUSwiftEnabled;
#endif
}

static HardwareCapabilities apple4(id<MTLDevice> device)
{
    auto baseCapabilities = WebGPU::baseCapabilities(device);

    baseCapabilities.supportsNonPrivateDepthStencilTextures = true;
    baseCapabilities.canPresentRGB10A2PixelFormats = false;
    baseCapabilities.memoryBarrierLimit = isShaderValidationEnabled(device) ? 0u : std::numeric_limits<decltype(baseCapabilities.memoryBarrierLimit)>::max();

    auto features = WebGPU::baseFeatures(device, baseCapabilities);

    features.append(WGPUFeatureName_TextureCompressionETC2);
    features.append(WGPUFeatureName_TextureCompressionASTC);
    features.append(WGPUFeatureName_TextureCompressionASTCSliced3D);

    std::ranges::sort(features);

    return {
        defaultLimits(),
        WTF::move(features),
        baseCapabilities,
    };
}

static HardwareCapabilities apple5(id<MTLDevice> device)
{
    auto baseCapabilities = WebGPU::baseCapabilities(device);

    baseCapabilities.supportsNonPrivateDepthStencilTextures = true;
    baseCapabilities.canPresentRGB10A2PixelFormats = false;

    auto features = WebGPU::baseFeatures(device, baseCapabilities);

    features.append(WGPUFeatureName_TextureCompressionETC2);
    features.append(WGPUFeatureName_TextureCompressionASTC);
    features.append(WGPUFeatureName_TextureCompressionASTCSliced3D);

    std::ranges::sort(features);

    return {
        defaultLimits(),
        WTF::move(features),
        baseCapabilities,
    };
}

#if !0 /* PLATFORM(WATCHOS) */ && !0 /* PLATFORM(APPLETV) */
static HardwareCapabilities apple6(id<MTLDevice> device)
{
    auto baseCapabilities = WebGPU::baseCapabilities(device);

    baseCapabilities.supportsNonPrivateDepthStencilTextures = true;
    baseCapabilities.canPresentRGB10A2PixelFormats = false;
    baseCapabilities.supportsResidencySets = false;

    auto features = WebGPU::baseFeatures(device, baseCapabilities);

    features.append(WGPUFeatureName_TextureCompressionETC2);
    features.append(WGPUFeatureName_TextureCompressionASTC);
    features.append(WGPUFeatureName_TextureCompressionASTCSliced3D);

    std::ranges::sort(features);

    return {
        {
            .maxTextureDimension1D =    16384,
            .maxTextureDimension2D =    16384,
            .maxTextureDimension3D =    2048,
            .maxTextureArrayLayers =    2048,
            .maxBindGroups =    maxBindGroups,
            .maxBindGroupsPlusVertexBuffers = 30,
            .maxBindingsPerBindGroup =    largeReasonableLimit(),
            .maxDynamicUniformBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxDynamicStorageBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxSampledTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxSamplersPerShaderStage =    maxBindGroups * tier2LimitForSamplers,
            .maxStorageBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBufferBindingSize =    0, // To be filled in by the caller.
            .maxStorageBufferBindingSize =    0, // To be filled in by the caller.
            .minUniformBufferOffsetAlignment =    32,
            .minStorageBufferOffsetAlignment =    32,
            .maxVertexBuffers =    maxVertexBuffers,
            .maxBufferSize = maxBufferSize(device),
            .maxVertexAttributes =    30,
            .maxVertexBufferArrayStride =    multipleOf4(largeReasonableLimit()),
            .maxInterStageShaderVariables = 31,
            .maxColorAttachments = 8,
            .maxColorAttachmentBytesPerSample = 64,
            .maxComputeWorkgroupStorageSize =    32 * KB,
            .maxComputeInvocationsPerWorkgroup =    1024,
            .maxComputeWorkgroupSizeX =    1024,
            .maxComputeWorkgroupSizeY =    1024,
            .maxComputeWorkgroupSizeZ =    1024,
            .maxComputeWorkgroupsPerDimension =    largeReasonableLimit(),
            .maxStorageBuffersInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageBuffersInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
        },
        WTF::move(features),
        baseCapabilities,
    };
}

static HardwareCapabilities apple7(id<MTLDevice> device)
{
    auto baseCapabilities = WebGPU::baseCapabilities(device);

    baseCapabilities.supportsNonPrivateDepthStencilTextures = true;
    baseCapabilities.canPresentRGB10A2PixelFormats = false;
    baseCapabilities.supportsResidencySets = false;

    auto features = WebGPU::baseFeatures(device, baseCapabilities);

    features.append(WGPUFeatureName_TextureCompressionETC2);
    features.append(WGPUFeatureName_TextureCompressionASTC);
    features.append(WGPUFeatureName_TextureCompressionASTCSliced3D);

    std::ranges::sort(features);

    return {
        {
            .maxTextureDimension1D =    16384,
            .maxTextureDimension2D =    16384,
            .maxTextureDimension3D =    2048,
            .maxTextureArrayLayers =    2048,
            .maxBindGroups =    maxBindGroups,
            .maxBindGroupsPlusVertexBuffers = 30,
            .maxBindingsPerBindGroup =    largeReasonableLimit(),
            .maxDynamicUniformBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxDynamicStorageBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxSampledTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxSamplersPerShaderStage =    maxBindGroups * tier2LimitForSamplers,
            .maxStorageBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBufferBindingSize =    0, // To be filled in by the caller.
            .maxStorageBufferBindingSize =    0, // To be filled in by the caller.
            .minUniformBufferOffsetAlignment =    32,
            .minStorageBufferOffsetAlignment =    32,
            .maxVertexBuffers =    maxVertexBuffers,
            .maxBufferSize = maxBufferSize(device),
            .maxVertexAttributes =    30,
            .maxVertexBufferArrayStride =    multipleOf4(largeReasonableLimit()),
            .maxInterStageShaderVariables =    31,
            .maxColorAttachments = 8,
            .maxColorAttachmentBytesPerSample = 64,
            .maxComputeWorkgroupStorageSize =    32 * KB,
            .maxComputeInvocationsPerWorkgroup =    1024,
            .maxComputeWorkgroupSizeX =    1024,
            .maxComputeWorkgroupSizeY =    1024,
            .maxComputeWorkgroupSizeZ =    1024,
            .maxComputeWorkgroupsPerDimension =    largeReasonableLimit(),
            .maxStorageBuffersInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageBuffersInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
        },
        WTF::move(features),
        baseCapabilities,
    };
}
#endif

static HardwareCapabilities mac2(id<MTLDevice> device)
{
    auto baseCapabilities = WebGPU::baseCapabilities(device);

    baseCapabilities.supportsNonPrivateDepthStencilTextures = false;
    baseCapabilities.canPresentRGB10A2PixelFormats = true;
    if (![device supportsFamily:MTLGPUFamilyApple4])
        baseCapabilities.memoryBarrierLimit = 0;
    else if (![device supportsFamily:MTLGPUFamilyApple8])
        baseCapabilities.memoryBarrierLimit = 512;

    auto features = WebGPU::baseFeatures(device, baseCapabilities);

    std::ranges::sort(features);

    return {
        {
            .maxTextureDimension1D =    16384,
            .maxTextureDimension2D =    16384,
            .maxTextureDimension3D =    2048,
            .maxTextureArrayLayers =    2048,
            .maxBindGroups =    maxBindGroups,
            .maxBindGroupsPlusVertexBuffers = 30,
            .maxBindingsPerBindGroup =  1000,
            .maxDynamicUniformBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxDynamicStorageBuffersPerPipelineLayout =    largeReasonableLimit(),
            .maxSampledTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxSamplersPerShaderStage =    maxBindGroups * tier2LimitForSamplers,
            .maxStorageBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBuffersPerShaderStage =    maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxUniformBufferBindingSize =    0, // To be filled in by the caller.
            .maxStorageBufferBindingSize =    0, // To be filled in by the caller.
            .minUniformBufferOffsetAlignment =    256,
            .minStorageBufferOffsetAlignment =    256,
            .maxVertexBuffers =    maxVertexBuffers,
            .maxBufferSize =    maxBufferSize(device),
            .maxVertexAttributes =    30,
            .maxVertexBufferArrayStride =    multipleOf4(largeReasonableLimit()),
            .maxInterStageShaderVariables =    31,
            .maxColorAttachments =    8,
            .maxColorAttachmentBytesPerSample = 64,
            .maxComputeWorkgroupStorageSize =    32 * KB,
            .maxComputeInvocationsPerWorkgroup =    1024,
            .maxComputeWorkgroupSizeX =    1024,
            .maxComputeWorkgroupSizeY =    1024,
            .maxComputeWorkgroupSizeZ =    1024,
            .maxComputeWorkgroupsPerDimension =    largeReasonableLimit(),
            .maxStorageBuffersInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInFragmentStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageBuffersInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
            .maxStorageTexturesInVertexStage = maxBindGroups * tier2LimitForBuffersAndTextures,
        },
        WTF::move(features),
        baseCapabilities,
    };
}

template <typename T>
static T mergeMaximum(T previous, T next)
{
    // https://gpuweb.github.io/gpuweb/#limit-class-maximum
    return std::max(previous, next);
};

template <typename T>
static T mergeAlignment(T previous, T next)
{
    // https://gpuweb.github.io/gpuweb/#limit-class-alignment
    return std::min(roundUpToPowerOfTwo(previous), roundUpToPowerOfTwo(next));
};

static WGPULimits mergeLimits(const WGPULimits& previous, const WGPULimits& next)
{
    return {
        .maxTextureDimension1D = mergeMaximum(previous.maxTextureDimension1D, next.maxTextureDimension1D),
        .maxTextureDimension2D = mergeMaximum(previous.maxTextureDimension2D, next.maxTextureDimension2D),
        .maxTextureDimension3D = mergeMaximum(previous.maxTextureDimension3D, next.maxTextureDimension3D),
        .maxTextureArrayLayers = mergeMaximum(previous.maxTextureArrayLayers, next.maxTextureArrayLayers),
        .maxBindGroups = mergeMaximum(previous.maxBindGroups, next.maxBindGroups),
        .maxBindGroupsPlusVertexBuffers = mergeMaximum(previous.maxBindGroupsPlusVertexBuffers, next.maxBindGroupsPlusVertexBuffers),
        .maxBindingsPerBindGroup = mergeMaximum(previous.maxBindingsPerBindGroup, next.maxBindingsPerBindGroup),
        .maxDynamicUniformBuffersPerPipelineLayout = mergeMaximum(previous.maxDynamicUniformBuffersPerPipelineLayout, next.maxDynamicUniformBuffersPerPipelineLayout),
        .maxDynamicStorageBuffersPerPipelineLayout = mergeMaximum(previous.maxDynamicStorageBuffersPerPipelineLayout, next.maxDynamicStorageBuffersPerPipelineLayout),
        .maxSampledTexturesPerShaderStage = workaroundCTSBindGroupLimit(mergeMaximum(previous.maxSampledTexturesPerShaderStage, next.maxSampledTexturesPerShaderStage)),
        .maxSamplersPerShaderStage = workaroundCTSBindGroupLimit(mergeMaximum(previous.maxSamplersPerShaderStage, next.maxSamplersPerShaderStage)),
        .maxStorageBuffersPerShaderStage = workaroundCTSBindGroupLimit(mergeMaximum(previous.maxStorageBuffersPerShaderStage, next.maxStorageBuffersPerShaderStage)),
        .maxStorageTexturesPerShaderStage = workaroundCTSBindGroupLimit(mergeMaximum(previous.maxStorageTexturesPerShaderStage, next.maxStorageTexturesPerShaderStage)),
        .maxUniformBuffersPerShaderStage = workaroundCTSBindGroupLimit(mergeMaximum(previous.maxUniformBuffersPerShaderStage, next.maxUniformBuffersPerShaderStage)),
        .maxUniformBufferBindingSize = mergeMaximum(previous.maxUniformBufferBindingSize, next.maxUniformBufferBindingSize),
        .maxStorageBufferBindingSize = mergeMaximum(previous.maxStorageBufferBindingSize, next.maxStorageBufferBindingSize),
        .minUniformBufferOffsetAlignment = mergeAlignment(previous.minUniformBufferOffsetAlignment, next.minUniformBufferOffsetAlignment),
        .minStorageBufferOffsetAlignment = mergeAlignment(previous.minStorageBufferOffsetAlignment, next.minStorageBufferOffsetAlignment),
        .maxVertexBuffers = mergeMaximum(previous.maxVertexBuffers, next.maxVertexBuffers),
        .maxBufferSize = mergeMaximum(previous.maxBufferSize, next.maxBufferSize),
        .maxVertexAttributes = mergeMaximum(previous.maxVertexAttributes, next.maxVertexAttributes),
        .maxVertexBufferArrayStride = mergeMaximum(previous.maxVertexBufferArrayStride, next.maxVertexBufferArrayStride),
        .maxInterStageShaderVariables = mergeMaximum(previous.maxInterStageShaderVariables, next.maxInterStageShaderVariables),
        .maxColorAttachments = mergeMaximum(previous.maxColorAttachments, next.maxColorAttachments),
        .maxColorAttachmentBytesPerSample = mergeMaximum(previous.maxColorAttachmentBytesPerSample, next.maxColorAttachmentBytesPerSample),
        .maxComputeWorkgroupStorageSize = mergeMaximum(previous.maxComputeWorkgroupStorageSize, next.maxComputeWorkgroupStorageSize),
        .maxComputeInvocationsPerWorkgroup = mergeMaximum(previous.maxComputeInvocationsPerWorkgroup, next.maxComputeInvocationsPerWorkgroup),
        .maxComputeWorkgroupSizeX = mergeMaximum(previous.maxComputeWorkgroupSizeX, next.maxComputeWorkgroupSizeX),
        .maxComputeWorkgroupSizeY = mergeMaximum(previous.maxComputeWorkgroupSizeY, next.maxComputeWorkgroupSizeY),
        .maxComputeWorkgroupSizeZ = mergeMaximum(previous.maxComputeWorkgroupSizeZ, next.maxComputeWorkgroupSizeZ),
        .maxComputeWorkgroupsPerDimension = mergeMaximum(previous.maxComputeWorkgroupsPerDimension, next.maxComputeWorkgroupsPerDimension),
        .maxStorageBuffersInFragmentStage = mergeMaximum(previous.maxStorageBuffersInFragmentStage, next.maxStorageBuffersInFragmentStage),
        .maxStorageTexturesInFragmentStage = mergeMaximum(previous.maxStorageTexturesInFragmentStage, next.maxStorageTexturesInFragmentStage),
        .maxStorageBuffersInVertexStage = mergeMaximum(previous.maxStorageBuffersInVertexStage, next.maxStorageBuffersInVertexStage),
        .maxStorageTexturesInVertexStage = mergeMaximum(previous.maxStorageTexturesInVertexStage, next.maxStorageTexturesInVertexStage),
    };
};

static Vector<WGPUFeatureName> mergeFeatures(const Vector<WGPUFeatureName>& previous, const Vector<WGPUFeatureName>& next)
{
    ASSERT(std::ranges::is_sorted(previous));
    ASSERT(std::ranges::is_sorted(next));

    Vector<WGPUFeatureName> result(previous.size() + next.size());
    auto end = mergeDeduplicatedSorted(previous.begin(), previous.end(), next.begin(), next.end(), result.begin());
    result.shrink(end - result.begin());
    return result;
}

static HardwareCapabilities::BaseCapabilities mergeBaseCapabilities(const HardwareCapabilities::BaseCapabilities& previous, const HardwareCapabilities::BaseCapabilities& next)
{
    ASSERT(previous.argumentBuffersTier == next.argumentBuffersTier);
    ASSERT((!previous.timestampCounterSet && !next.timestampCounterSet) || [previous.timestampCounterSet isEqual:next.timestampCounterSet]);
    ASSERT(!previous.statisticCounterSet || [previous.statisticCounterSet isEqual:next.statisticCounterSet]);
    return HardwareCapabilities::BaseCapabilities {
        .argumentBuffersTier = previous.argumentBuffersTier,
        .timestampCounterSet = previous.timestampCounterSet,
        .statisticCounterSet = previous.statisticCounterSet,
        .memoryBarrierLimit = std::min(previous.memoryBarrierLimit, next.memoryBarrierLimit),
        .supportsNonPrivateDepthStencilTextures = previous.supportsNonPrivateDepthStencilTextures || next.supportsNonPrivateDepthStencilTextures,
        .canPresentRGB10A2PixelFormats = previous.canPresentRGB10A2PixelFormats || next.canPresentRGB10A2PixelFormats,
        .supportsResidencySets = previous.supportsResidencySets || next.supportsResidencySets,
    };
}

static bool isPhysicalHardware()
{
#if 0 /* PLATFORM(IOS_FAMILY_SIMULATOR) */
    return false;
#else
    static bool result = [] {
        uint32_t isVM = 0;
        size_t size = sizeof(isVM);
        if (!sysctlbyname("kern.hv_vmm_present", &isVM, &size, NULL, 0)) {
            if (isVM) {
                id value = [[NSUserDefaults standardUserDefaults] objectForKey:@"WebKitAllowWebGPUOnVMs"];
                return value ? static_cast<bool>([value boolValue]) : true;
            }
            return true;
        }
        return true;
    }();
    return result;
#endif
}

static std::optional<HardwareCapabilities> rawHardwareCapabilities(id<MTLDevice> device)
{
    if (!isPhysicalHardware())
        return std::nullopt;

    std::optional<HardwareCapabilities> result;

    auto merge = [&](const HardwareCapabilities& capabilities) {
        if (!result) {
            result = capabilities;
            return;
        }

        result->limits = mergeLimits(result->limits, capabilities.limits);
        result->features = mergeFeatures(result->features, capabilities.features);
        result->baseCapabilities = mergeBaseCapabilities(result->baseCapabilities, capabilities.baseCapabilities);
    };

    if ([device supportsFamily:MTLGPUFamilyApple4])
        merge(apple4(device));
    if ([device supportsFamily:MTLGPUFamilyApple5])
        merge(apple5(device));
#if !0 /* PLATFORM(WATCHOS) */ && !0 /* PLATFORM(APPLETV) */
    if ([device supportsFamily:MTLGPUFamilyApple6])
        merge(apple6(device));
    if ([device supportsFamily:MTLGPUFamilyApple7])
        merge(apple7(device));
#endif
    // MTLGPUFamilyMac1 is not supported (yet?).
ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if ([device supportsFamily:MTLGPUFamilyMac2])
        merge(mac2(device));
ALLOW_DEPRECATED_DECLARATIONS_END
    if (result) {
        auto maxBufferLength = maxBufferSize(device);
        result->limits.maxUniformBufferBindingSize = maxBufferLength;
        result->limits.maxStorageBufferBindingSize = maxBufferLength;
    }

    return result;
}

bool anyLimitIsBetterThan(const WGPULimits& target, const WGPULimits& reference)
{
    if (target.maxTextureDimension1D > reference.maxTextureDimension1D)
        return true;
    if (target.maxTextureDimension2D > reference.maxTextureDimension2D)
        return true;
    if (target.maxTextureDimension3D > reference.maxTextureDimension3D)
        return true;
    if (target.maxTextureArrayLayers > reference.maxTextureArrayLayers)
        return true;
    if (target.maxBindGroups > reference.maxBindGroups)
        return true;
    if (target.maxBindingsPerBindGroup > reference.maxBindingsPerBindGroup)
        return true;
    if (target.maxDynamicUniformBuffersPerPipelineLayout > reference.maxDynamicUniformBuffersPerPipelineLayout)
        return true;
    if (target.maxDynamicStorageBuffersPerPipelineLayout > reference.maxDynamicStorageBuffersPerPipelineLayout)
        return true;
    if (target.maxSampledTexturesPerShaderStage > reference.maxSampledTexturesPerShaderStage)
        return true;
    if (target.maxSamplersPerShaderStage > reference.maxSamplersPerShaderStage)
        return true;
    if (target.maxStorageBuffersPerShaderStage > reference.maxStorageBuffersPerShaderStage)
        return true;
    if (target.maxStorageTexturesPerShaderStage > reference.maxStorageTexturesPerShaderStage)
        return true;
    if (target.maxUniformBuffersPerShaderStage > reference.maxUniformBuffersPerShaderStage)
        return true;
    if (target.maxUniformBufferBindingSize > reference.maxUniformBufferBindingSize)
        return true;
    if (target.maxStorageBufferBindingSize > reference.maxStorageBufferBindingSize)
        return true;
    if (target.minUniformBufferOffsetAlignment < reference.minUniformBufferOffsetAlignment)
        return true;
    if (target.minStorageBufferOffsetAlignment < reference.minStorageBufferOffsetAlignment)
        return true;
    if (target.maxVertexBuffers > reference.maxVertexBuffers)
        return true;
    if (target.maxBufferSize > reference.maxBufferSize)
        return true;
    if (target.maxVertexAttributes > reference.maxVertexAttributes)
        return true;
    if (target.maxVertexBufferArrayStride > reference.maxVertexBufferArrayStride)
        return true;
    if (target.maxInterStageShaderVariables > reference.maxInterStageShaderVariables)
        return true;
    if (target.maxColorAttachments > reference.maxColorAttachments)
        return true;
    if (target.maxColorAttachmentBytesPerSample > reference.maxColorAttachmentBytesPerSample)
        return true;
    if (target.maxComputeWorkgroupStorageSize > reference.maxComputeWorkgroupStorageSize)
        return true;
    if (target.maxComputeInvocationsPerWorkgroup > reference.maxComputeInvocationsPerWorkgroup)
        return true;
    if (target.maxComputeWorkgroupSizeX > reference.maxComputeWorkgroupSizeX)
        return true;
    if (target.maxComputeWorkgroupSizeY > reference.maxComputeWorkgroupSizeY)
        return true;
    if (target.maxComputeWorkgroupSizeZ > reference.maxComputeWorkgroupSizeZ)
        return true;
    if (target.maxComputeWorkgroupsPerDimension > reference.maxComputeWorkgroupsPerDimension)
        return true;
    if (target.maxStorageBuffersInFragmentStage > reference.maxStorageBuffersInFragmentStage)
        return true;
    if (target.maxStorageTexturesInFragmentStage > reference.maxStorageTexturesInFragmentStage)
        return true;
    if (target.maxStorageBuffersInVertexStage > reference.maxStorageBuffersInVertexStage)
        return true;
    if (target.maxStorageTexturesInVertexStage > reference.maxStorageTexturesInVertexStage)
        return true;

    return false;
}

bool includesUnsupportedFeatures(const Vector<WGPUFeatureName>& target, const Vector<WGPUFeatureName>& reference)
{
    ASSERT(std::ranges::is_sorted(reference));
    for (auto feature : target) {
        if (!std::ranges::binary_search(reference, feature))
            return true;
    }
    return false;
}

WGPULimits defaultLimits()
{
    // https://gpuweb.github.io/gpuweb/#limit-default

    return {
        .maxTextureDimension1D =    8192,
        .maxTextureDimension2D =    8192,
        .maxTextureDimension3D =    2048,
        .maxTextureArrayLayers =    256,
        .maxBindGroups =    4,
        .maxBindGroupsPlusVertexBuffers = 24,
        .maxBindingsPerBindGroup = 1000,
        .maxDynamicUniformBuffersPerPipelineLayout =    8,
        .maxDynamicStorageBuffersPerPipelineLayout =    4,
        .maxSampledTexturesPerShaderStage =    16,
        .maxSamplersPerShaderStage =    16,
        .maxStorageBuffersPerShaderStage =    8,
        .maxStorageTexturesPerShaderStage =    4,
        .maxUniformBuffersPerShaderStage =    12,
        .maxUniformBufferBindingSize =    65536,
        .maxStorageBufferBindingSize =    134217728,
        .minUniformBufferOffsetAlignment =    256,
        .minStorageBufferOffsetAlignment =    256,
        .maxVertexBuffers =    8,
        .maxBufferSize = defaultMaxBufferSize,
        .maxVertexAttributes =    16,
        .maxVertexBufferArrayStride =    2048,
        .maxInterStageShaderVariables = 16,
        .maxColorAttachments = 8,
        .maxColorAttachmentBytesPerSample = 32,
        .maxComputeWorkgroupStorageSize =    16384,
        .maxComputeInvocationsPerWorkgroup =    256,
        .maxComputeWorkgroupSizeX =    256,
        .maxComputeWorkgroupSizeY =    256,
        .maxComputeWorkgroupSizeZ =    64,
        .maxComputeWorkgroupsPerDimension =    65535,
        .maxStorageBuffersInFragmentStage = 8,
        .maxStorageTexturesInFragmentStage = 4,
        .maxStorageBuffersInVertexStage = 8,
        .maxStorageTexturesInVertexStage = 4,
    };
}

std::optional<HardwareCapabilities> hardwareCapabilities(id<MTLDevice> device)
{
    auto result = rawHardwareCapabilities(device);

    if (!result)
        return std::nullopt;

    if (anyLimitIsBetterThan(defaultLimits(), result->limits))
        return std::nullopt;

    return result;
}

bool isValid(const WGPULimits& limits)
{
    return isPowerOfTwo(limits.minUniformBufferOffsetAlignment) && isPowerOfTwo(limits.minStorageBufferOffsetAlignment);
}

} // namespace WebGPU

WGPULimits NODELETE wgpuDefaultLimits()
{
    return WebGPU::defaultLimits();
}
