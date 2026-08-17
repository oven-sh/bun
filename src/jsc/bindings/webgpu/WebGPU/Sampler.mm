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
#import "Sampler.h"

#import "APIConversions.h"
#import "Device.h"
#import <cmath>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>
#import <wtf/text/Base64.h>

namespace WebGPU {

static bool NODELETE validateCreateSampler(Device& device, const WGPUSamplerDescriptor& descriptor)
{
    // https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpusamplerdescriptor

    if (!device.isValid())
        return false;

    if (std::isnan(descriptor.lodMinClamp) || descriptor.lodMinClamp < 0)
        return false;

    if (std::isnan(descriptor.lodMaxClamp) || descriptor.lodMaxClamp < descriptor.lodMinClamp)
        return false;

    if (descriptor.maxAnisotropy < 1)
        return false;

    if (descriptor.maxAnisotropy > 1) {
        if (descriptor.magFilter != WGPUFilterMode_Linear
            || descriptor.minFilter != WGPUFilterMode_Linear
            || descriptor.mipmapFilter != WGPUMipmapFilterMode_Linear)
            return false;
    }

    return true;
}

static MTLSamplerAddressMode NODELETE addressMode(WGPUAddressMode addressMode)
{
    switch (addressMode) {
    case WGPUAddressMode_Repeat:
        return MTLSamplerAddressModeRepeat;
    case WGPUAddressMode_MirrorRepeat:
        return MTLSamplerAddressModeMirrorRepeat;
    case WGPUAddressMode_ClampToEdge:
        return MTLSamplerAddressModeClampToEdge;
    case WGPUAddressMode_Force32:
        ASSERT_NOT_REACHED();
        return MTLSamplerAddressModeClampToEdge;
    }
}

static MTLSamplerMinMagFilter NODELETE minMagFilter(WGPUFilterMode filterMode)
{
    switch (filterMode) {
    case WGPUFilterMode_Nearest:
        return MTLSamplerMinMagFilterNearest;
    case WGPUFilterMode_Linear:
        return MTLSamplerMinMagFilterLinear;
    case WGPUFilterMode_Force32:
        ASSERT_NOT_REACHED();
        return MTLSamplerMinMagFilterNearest;
    }
}

static MTLSamplerMipFilter NODELETE mipFilter(WGPUMipmapFilterMode filterMode)
{
    switch (filterMode) {
    case WGPUMipmapFilterMode_Nearest:
        return MTLSamplerMipFilterNearest;
    case WGPUMipmapFilterMode_Linear:
        return MTLSamplerMipFilterLinear;
    case WGPUMipmapFilterMode_Force32:
        ASSERT_NOT_REACHED();
        return MTLSamplerMipFilterNearest;
    }
}

static MTLCompareFunction NODELETE compareFunction(WGPUCompareFunction compareFunction)
{
    switch (compareFunction) {
    case WGPUCompareFunction_Never:
        return MTLCompareFunctionNever;
    case WGPUCompareFunction_Less:
        return MTLCompareFunctionLess;
    case WGPUCompareFunction_LessEqual:
        return MTLCompareFunctionLessEqual;
    case WGPUCompareFunction_Greater:
        return MTLCompareFunctionGreater;
    case WGPUCompareFunction_GreaterEqual:
        return MTLCompareFunctionGreaterEqual;
    case WGPUCompareFunction_Equal:
        return MTLCompareFunctionEqual;
    case WGPUCompareFunction_NotEqual:
        return MTLCompareFunctionNotEqual;
    case WGPUCompareFunction_Undefined:
    case WGPUCompareFunction_Always:
        return MTLCompareFunctionAlways;
    case WGPUCompareFunction_Force32:
        ASSERT_NOT_REACHED();
        return MTLCompareFunctionAlways;
    }
}

static uint32_t miscHash(MTLSamplerDescriptor* descriptor)
{
    struct MTLSamplerDescriptorHash {
        union {
            struct {
                // Pack this all down for faster equality/hashing.
                uint32_t minFilter:2;
                uint32_t magFilter:2;
                uint32_t mipFilter:2;
                uint32_t sAddressMode:3;
                uint32_t tAddressMode:3;
                uint32_t rAddressMode:3;
                uint32_t normalizedCoords:1;
                uint32_t borderColor:2;
                uint32_t lodAverage:1;
                uint32_t compareFunction:3;
                uint32_t supportArgumentBuffers:1;

            };
            uint32_t miscHash;
        };
    };
    MTLSamplerDescriptorHash h {
        .minFilter = static_cast<uint32_t>(descriptor.minFilter),
        .magFilter = static_cast<uint32_t>(descriptor.magFilter),
        .mipFilter = static_cast<uint32_t>(descriptor.mipFilter),
        .sAddressMode = static_cast<uint32_t>(descriptor.sAddressMode),
        .tAddressMode = static_cast<uint32_t>(descriptor.tAddressMode),
        .rAddressMode = static_cast<uint32_t>(descriptor.rAddressMode),
        .normalizedCoords = static_cast<uint32_t>(descriptor.normalizedCoordinates),
        .borderColor = static_cast<uint32_t>(descriptor.borderColor),
        .lodAverage = static_cast<uint32_t>(descriptor.lodAverage),
        .compareFunction = static_cast<uint32_t>(descriptor.compareFunction),
        .supportArgumentBuffers = static_cast<uint32_t>(descriptor.supportArgumentBuffers),
    };
    return h.miscHash;
}

static Sampler::UniqueSamplerIdentifier computeDescriptorHash(MTLSamplerDescriptor* descriptor)
{
    auto floatToUint32 = ^(float f) {
        return *reinterpret_cast<uint32_t*>(&f);
    };
    return std::array<uint32_t, 4> { miscHash(descriptor), floatToUint32(descriptor.lodMinClamp), floatToUint32(descriptor.lodMaxClamp), floatToUint32(descriptor.maxAnisotropy) };
}

static MTLSamplerDescriptor *createMetalDescriptorFromDescriptor(const WGPUSamplerDescriptor &descriptor)
{
    MTLSamplerDescriptor *samplerDescriptor = [MTLSamplerDescriptor new];

    samplerDescriptor.sAddressMode = addressMode(descriptor.addressModeU);
    samplerDescriptor.tAddressMode = addressMode(descriptor.addressModeV);
    samplerDescriptor.rAddressMode = addressMode(descriptor.addressModeW);
    samplerDescriptor.magFilter = minMagFilter(descriptor.magFilter);
    samplerDescriptor.minFilter = minMagFilter(descriptor.minFilter);
    samplerDescriptor.mipFilter = mipFilter(descriptor.mipmapFilter);
    samplerDescriptor.lodMinClamp = descriptor.lodMinClamp;
    samplerDescriptor.lodMaxClamp = descriptor.lodMaxClamp;
    samplerDescriptor.compareFunction = compareFunction(descriptor.compare);
    samplerDescriptor.supportArgumentBuffers = YES;

    // https://developer.apple.com/documentation/metal/mtlsamplerdescriptor/1516164-maxanisotropy?language=objc
    // "Values must be between 1 and 16, inclusive."
    samplerDescriptor.maxAnisotropy = std::min<uint16_t>(descriptor.maxAnisotropy, 16);
    samplerDescriptor.label = descriptor.label.createNSString().get();

    return samplerDescriptor;
}

static Lock samplerStatesLock;

struct SamplerState {
    RetainPtr<id<MTLSamplerState>> strong;
    WeakObjCPtr<id<MTLSamplerState>> weak;
    size_t useCount { 0 };
};

static HashMap<GenericHashKey<Sampler::UniqueSamplerIdentifier>, SamplerState>& NODELETE samplerStates() WTF_REQUIRES_LOCK(samplerStatesLock)
{
    static NeverDestroyed<HashMap<GenericHashKey<Sampler::UniqueSamplerIdentifier>, SamplerState>> samplerStates WTF_GUARDED_BY_LOCK(samplerStatesLock);
    return samplerStates.get();
}

static NSUInteger samplerStateHardLimit(id<MTLDevice> device)
{
    static constexpr NSUInteger samplerStateHardLimit = 2048;

    return std::min(samplerStateHardLimit, device.maxArgumentBufferSamplerCount) / 2; // Reserve space for other frameworks using Metal
}

// Most programs allocate one or two Samplers and that's it. But extreme test cases, at least,
// can churn through more. We want to be robust in the face of the hard limit Metal puts on the
// number of MTLSamplerStates that can be live at the same time.
static id<MTLSamplerState> tryCacheSamplerState(const Sampler::UniqueSamplerIdentifier& samplerIdentifier, id<MTLDevice> device, const WGPUSamplerDescriptor& descriptor)
{
    Locker locker { samplerStatesLock };
    auto& samplerStates = WebGPU::samplerStates();

    if (auto it = samplerStates.find(samplerIdentifier); it != samplerStates.end()) {
        if (auto mtlSamplerState = it->value.weak.get()) {
            ++it->value.useCount;
            return mtlSamplerState.get();
        }
    }

    auto hardLimit = samplerStateHardLimit(device);
    if (samplerStates.size() > hardLimit) {
        samplerStates.removeIf([&] (auto& bucket) {
            bucket.value.strong = nil;
            // Eviction can fail because of live references from running shaders, or other
            // refcounting shenanigans. When eviction fails, we keep the live weak reference
            // in our map to continue to track our footprint relative to our hard limit.
            return !bucket.value.weak;
        });
    }

    // Exceeding Metal's hard limit crashes when Metal validation is enabled, so fail the shader instead.
    if (samplerStates.size() > hardLimit)
        return nil;

    auto samplerState = [device newSamplerStateWithDescriptor:createMetalDescriptorFromDescriptor(descriptor)];
    if (!samplerState)
        return nil;

    samplerStates.set(samplerIdentifier, SamplerState {
        .strong = samplerState,
        .weak = samplerState,
        .useCount = 1,
    });

    return samplerState;
}

static void uncacheSamplerState(const Sampler::UniqueSamplerIdentifier& samplerIdentifier, id<MTLSamplerState> samplerState)
{
    Locker locker { samplerStatesLock };
    auto& samplerStates = WebGPU::samplerStates();

    auto it = samplerStates.find(samplerIdentifier);
    RELEASE_ASSERT(it != samplerStates.end());
    RELEASE_ASSERT(it->value.weak.get().get() == samplerState);

    --it->value.useCount;
    if (!it->value.useCount)
        samplerStates.remove(it);
}

Ref<Sampler> Device::createSampler(const WGPUSamplerDescriptor& descriptor)
{
    if (!isValid())
        return Sampler::createInvalid(*this);

    // https://gpuweb.github.io/gpuweb/#dom-gpudevice-createsampler

    if (!validateCreateSampler(*this, descriptor)) {
        generateAValidationError("Validation failure."_s);
        return Sampler::createInvalid(*this);
    }

    MTLSamplerDescriptor* samplerDescriptor = createMetalDescriptorFromDescriptor(descriptor);
    return Sampler::create(computeDescriptorHash(samplerDescriptor), descriptor, *this);
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(Sampler);

Sampler::Sampler(UniqueSamplerIdentifier&& samplerIdentifier, const WGPUSamplerDescriptor& descriptor, Device& device)
    : m_samplerIdentifier(samplerIdentifier)
    , m_descriptor(descriptor)
    , m_device(device)
{
    tryCacheSamplerState();
}

Sampler::Sampler(Device& device)
    : m_device(device)
{
}

Sampler::~Sampler()
{
    if (id<MTLSamplerState> samplerState = m_cachedSamplerState)
        uncacheSamplerState(*m_samplerIdentifier, samplerState);
}

void Sampler::setLabel(String&& label)
{
    m_descriptor.label = label;
}

bool Sampler::isValid() const
{
    return !!m_samplerIdentifier;
}

id<MTLSamplerState> Sampler::tryCacheSamplerState() const
{
    if (auto cachedSamplerState = m_cachedSamplerState)
        return cachedSamplerState;

    if (!m_samplerIdentifier)
        return nil;

    id<MTLDevice> device = m_device->device();
    if (!device)
        return nil;

    auto cachedSamplerState = WebGPU::tryCacheSamplerState(*m_samplerIdentifier, device, m_descriptor);
    m_cachedSamplerState = cachedSamplerState;
    return m_cachedSamplerState;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuSamplerReference(WGPUSampler sampler)
{
    WebGPU::fromAPI(sampler).ref();
}

void wgpuSamplerRelease(WGPUSampler sampler)
{
    WebGPU::fromAPI(sampler).deref();
}

void wgpuSamplerSetLabel(WGPUSampler sampler, const char* label)
{
    protect(WebGPU::fromAPI(sampler))->setLabel(WebGPU::fromAPI(label));
}
