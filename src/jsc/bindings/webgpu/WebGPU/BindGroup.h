/*
 * Copyright (c) 2021-2022 Apple Inc. All rights reserved.
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

#pragma once

#import "BindableResource.h"
#import "ShaderStage.h"
#import <wtf/EnumeratedArray.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashTraits.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/Vector.h>
#import <wtf/WeakPtr.h>

struct WGPUBindGroupImpl {
};

namespace WebGPU {

class BindGroupLayout;
class Device;
class ExternalTexture;
class Sampler;

struct ExternalTextureIndices {
    NSUInteger containerIndex { NSNotFound };
    NSUInteger resourceIndex { NSNotFound };
    NSUInteger argumentBufferIndex { NSNotFound };
};

// https://gpuweb.github.io/gpuweb/#gpubindgroup
class BindGroup : public RefCountedAndCanMakeWeakPtr<BindGroup>, public WGPUBindGroupImpl {
    WTF_MAKE_TZONE_ALLOCATED(BindGroup);
public:
    template <typename T>
    using ShaderStageArray = EnumeratedArray<ShaderStage, T, ShaderStage::Compute>;
    using SamplersContainer = HashMap<Ref<Sampler>, ShaderStageArray<std::optional<uint32_t>>>;
    struct BufferAndType {
        WGPUBufferBindingType type;
        uint64_t bindingSize;
        uint64_t bufferSize;
        uint32_t bindingIndex;
    };
    using DynamicBuffersContainer = Vector<BufferAndType>;

    static constexpr MTLRenderStages MTLRenderStageCompute = static_cast<MTLRenderStages>(0);
    static constexpr MTLRenderStages MTLRenderStageUndefined = static_cast<MTLRenderStages>(MTLRenderStageFragment + 1);
    static Ref<BindGroup> create(id<MTLBuffer> vertexArgumentBuffer, id<MTLBuffer> fragmentArgumentBuffer, id<MTLBuffer> computeArgumentBuffer, Vector<BindableResources>&& resources, const BindGroupLayout& bindGroupLayout, DynamicBuffersContainer&& dynamicBuffers, SamplersContainer&& samplers, ShaderStageArray<ExternalTextureIndices>&& externalTextureIndices, uint32_t uniqueIdentifier, Device& device)
    {
        return adoptRef(*new BindGroup(vertexArgumentBuffer, fragmentArgumentBuffer, computeArgumentBuffer, WTF::move(resources), bindGroupLayout, WTF::move(dynamicBuffers), WTF::move(samplers), WTF::move(externalTextureIndices), uniqueIdentifier, device));
    }
    static Ref<BindGroup> createInvalid(Device& device)
    {
        return adoptRef(*new BindGroup(device));
    }

    ~BindGroup();

    void setLabel(String&&);

    bool NODELETE isValid() const;

    id<MTLBuffer> vertexArgumentBuffer() const { return m_vertexArgumentBuffer; }
    id<MTLBuffer> fragmentArgumentBuffer() const { return m_fragmentArgumentBuffer; }
    id<MTLBuffer> computeArgumentBuffer() const { return m_computeArgumentBuffer; }

    const Vector<BindableResources>& resources() const LIFETIME_BOUND { return m_resources; }

    Device& device() const { return m_device; }
    static bool NODELETE allowedUsage(const OptionSet<BindGroupEntryUsage>&);
    static NSString* usageName(const OptionSet<BindGroupEntryUsage>&);
    static uint64_t NODELETE makeEntryMapKey(uint32_t baseMipLevel, uint32_t baseArrayLayer, WGPUTextureAspect);

    const BindGroupLayout* bindGroupLayout() const { return m_bindGroupLayout.get(); }

    const BufferAndType* NODELETE dynamicBuffer(uint32_t) const;
    uint32_t NODELETE dynamicOffset(uint32_t bindingIndex, const Vector<uint32_t>*) const;
    bool rebindSamplersIfNeeded() const;
    bool updateExternalTextures(ExternalTexture&);
    bool makeSubmitInvalid(ShaderStage, const BindGroupLayout*) const;
    const SamplersContainer& samplers() const LIFETIME_BOUND { return m_samplers; }
    uint32_t uniqueId() const { return m_uniqueIdentifier; }
    void validatedSuccessfully(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const;
    bool NODELETE previouslyValidatedBindGroup(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const;
    bool hasSamplers() const { return m_samplers.size(); }

private:
    BindGroup(id<MTLBuffer> vertexArgumentBuffer, id<MTLBuffer> fragmentArgumentBuffer, id<MTLBuffer> computeArgumentBuffer, Vector<BindableResources>&&, const BindGroupLayout&, DynamicBuffersContainer&&, SamplersContainer&&, ShaderStageArray<ExternalTextureIndices>&&, uint32_t uniqueIdentifier, Device&);
    BindGroup(Device&);

    const id<MTLBuffer> m_vertexArgumentBuffer { nil };
    const id<MTLBuffer> m_fragmentArgumentBuffer { nil };
    const id<MTLBuffer> m_computeArgumentBuffer { nil };

    const Ref<Device> m_device;
    Vector<BindableResources> m_resources;
    RefPtr<const BindGroupLayout> m_bindGroupLayout;
    DynamicBuffersContainer m_dynamicBuffers;
    HashMap<uint32_t, uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_dynamicOffsetsIndices;
    mutable HashMap<uint64_t, uint32_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_validatedBindGroup;
    SamplersContainer m_samplers;
    ShaderStageArray<ExternalTextureIndices> m_externalTextureIndices;
    uint32_t m_uniqueIdentifier { 0 };
};

} // namespace WebGPU
