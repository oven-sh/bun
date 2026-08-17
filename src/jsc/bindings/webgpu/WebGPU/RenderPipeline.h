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

#pragma once

#import "Pipeline.h"
#import "PipelineLayout.h"

#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/HashTraits.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/WeakPtr.h>

struct WGPURenderPipelineImpl {
};

namespace WebGPU {

class BindGroupLayout;
class Device;
class TextureOrTextureView;
class TextureView;

// https://gpuweb.github.io/gpuweb/#gpurenderpipeline
class RenderPipeline : public RefCountedAndCanMakeWeakPtr<RenderPipeline>, public WGPURenderPipelineImpl {
    WTF_MAKE_TZONE_ALLOCATED(RenderPipeline);
public:
    struct BufferData {
        uint64_t stride { 0 };
        uint64_t lastStride { 0 };
        WGPUVertexStepMode stepMode { WGPUVertexStepMode_Vertex };
    };
    using RequiredBufferIndicesContainer = HashMap<uint32_t, BufferData, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;

    static Ref<RenderPipeline> create(MTLPrimitiveType primitiveType, std::optional<MTLIndexType> indexType, MTLWinding frontFace, MTLCullMode cullMode, MTLDepthClipMode depthClipMode, MTLDepthStencilDescriptor *depthStencilDescriptor, Ref<PipelineLayout>&& pipelineLayout, float depthBias, float depthBiasSlopeScale, float depthBiasClamp, uint32_t sampleMask, MTLRenderPipelineDescriptor* renderPipelineDescriptor, uint32_t colorAttachmentCount, const WGPURenderPipelineDescriptor& descriptor, RequiredBufferIndicesContainer&& requiredBufferIndices, BufferBindingSizesForPipeline&& minimumBufferSizes, uint64_t uniqueId, uint32_t vertexShaderBindingCount, Device& device)
    {
        return adoptRef(*new RenderPipeline(primitiveType, indexType, frontFace, cullMode, depthClipMode, depthStencilDescriptor, WTF::move(pipelineLayout), depthBias, depthBiasSlopeScale, depthBiasClamp, sampleMask, renderPipelineDescriptor, colorAttachmentCount, descriptor, WTF::move(requiredBufferIndices), WTF::move(minimumBufferSizes), uniqueId, vertexShaderBindingCount, device));
    }

    static Ref<RenderPipeline> createInvalid(Device& device)
    {
        return adoptRef(*new RenderPipeline(device));
    }

    ~RenderPipeline();

    Ref<BindGroupLayout> getBindGroupLayout(uint32_t groupIndex);
    void NODELETE setLabel(String&&);

    bool isValid() const { return m_renderPipelineDescriptor && m_pipelineLayout->isValid(); }

    MTLRenderPipelineDescriptor* renderPipelineDescriptor() const { return m_renderPipelineDescriptor; }
    id<MTLRenderPipelineState> renderPipelineState() const;
    id<MTLRenderPipelineState> icbRenderPipelineState() const;

    id<MTLDepthStencilState> NODELETE depthStencilState() const;
    bool validateDepthStencilState(bool depthReadOnly, bool stencilReadOnly) const;
    MTLPrimitiveType primitiveType() const { return m_primitiveType; }
    MTLWinding frontFace() const { return m_frontFace; }
    MTLCullMode cullMode() const { return m_cullMode; }
    MTLDepthClipMode depthClipMode() const { return m_clipMode; }
    MTLDepthStencilDescriptor *depthStencilDescriptor() const { return m_depthStencilDescriptor; }
    float depthBias() const { return m_depthBias; }
    float depthBiasSlopeScale() const { return m_depthBiasSlopeScale; }
    float depthBiasClamp() const { return m_depthBiasClamp; }
    uint32_t sampleMask() const { return m_sampleMask; }

    Device& device() const { return m_device; }
    PipelineLayout& pipelineLayout() const { return m_pipelineLayout; }
    NSString* errorValidatingColorDepthStencilTargets(const WGPURenderPassDescriptor&, const Vector<TextureOrTextureView>&, const std::optional<TextureOrTextureView>&) const;
    bool validateRenderBundle(const WGPURenderBundleEncoderDescriptor&) const;
    bool writesDepth() const;
    bool NODELETE writesStencil() const;

    const RequiredBufferIndicesContainer& requiredBufferIndices() const LIFETIME_BOUND { return m_requiredBufferIndices; }
    WGPUPrimitiveTopology primitiveTopology() const { return m_descriptor.primitive.topology; }

    MTLIndexType stripIndexFormat() const { return m_descriptor.primitive.stripIndexFormat == WGPUIndexFormat_Uint16 ? MTLIndexTypeUInt16 : MTLIndexTypeUInt32; }

    const BufferBindingSizesForBindGroup* NODELETE minimumBufferSizes(uint32_t) const;
    RefPtr<RenderPipeline> recomputeLastStrideAsStride() const;
    uint64_t uniqueId() const { return m_uniqueId; }
    uint32_t vertexShaderBindingCount() const { return m_vertexShaderBindingCount; }

private:
    RenderPipeline(MTLPrimitiveType, std::optional<MTLIndexType>, MTLWinding, MTLCullMode, MTLDepthClipMode, MTLDepthStencilDescriptor *, Ref<PipelineLayout>&&, float depthBias, float depthBiasSlopeScale, float depthBiasClamp, uint32_t sampleMask, MTLRenderPipelineDescriptor*, uint32_t colorAttachmentCount, const WGPURenderPipelineDescriptor&, RequiredBufferIndicesContainer&&, BufferBindingSizesForPipeline&&, uint64_t uniqueId, uint32_t vertexShaderBindingCount, Device&);
    RenderPipeline(Device&);
    bool colorTargetsMatch(MTLRenderPassDescriptor*, uint32_t) const;
    bool depthAttachmentMatches(MTLRenderPassDepthAttachmentDescriptor*) const;
    bool stencilAttachmentMatches(MTLRenderPassStencilAttachmentDescriptor*) const;

    mutable id<MTLRenderPipelineState> m_renderPipelineState { nil };

    const Ref<Device> m_device;
    MTLPrimitiveType m_primitiveType;
    std::optional<MTLIndexType> m_indexType;
    MTLWinding m_frontFace;
    MTLCullMode m_cullMode;
    MTLDepthClipMode m_clipMode;
    float m_depthBias { 0 };
    float m_depthBiasSlopeScale { 0 };
    float m_depthBiasClamp { 0 };
    uint32_t m_sampleMask { UINT32_MAX };
    MTLRenderPipelineDescriptor* m_renderPipelineDescriptor { nil };
    uint32_t m_colorAttachmentCount { 0 };
    MTLDepthStencilDescriptor *m_depthStencilDescriptor { nil };
    id<MTLDepthStencilState> m_depthStencilState;
    RequiredBufferIndicesContainer m_requiredBufferIndices;
    const Ref<PipelineLayout> m_pipelineLayout;
    mutable RefPtr<RenderPipeline> m_lastStrideAsStridePipeline;
    WGPURenderPipelineDescriptor m_descriptor;
    WGPUDepthStencilState m_descriptorDepthStencil;
    WGPUFragmentState m_descriptorFragment;
    Vector<WGPUColorTargetState> m_descriptorTargets;
    const BufferBindingSizesForPipeline m_minimumBufferSizes;
    const uint64_t m_uniqueId { 0 };
    const uint32_t m_vertexShaderBindingCount { 0 };
    bool m_writesStencil { false };
};

} // namespace WebGPU
