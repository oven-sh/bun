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

#import "CommandsMixin.h"
#import "RenderBundle.h"
#import <wtf/FastMalloc.h>
#import <wtf/Function.h>
#import <wtf/HashMap.h>
#import <wtf/HashSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCounted.h>
#import <wtf/TZoneMallocInlines.h>
#import <wtf/Vector.h>
#import <wtf/WeakPtr.h>

namespace WebGPU {
class RenderPipeline;
}

struct WGPURenderBundleEncoderImpl {
};

@interface RenderBundleICBWithResources : NSObject

- (instancetype)initWithICB:(id<MTLIndirectCommandBuffer>)icb containerBuffer:(id<MTLBuffer>)containerBuffer pipelineState:(id<MTLRenderPipelineState>)pipelineState depthStencilState:(id<MTLDepthStencilState>)depthStencilState cullMode:(MTLCullMode)cullMode frontFace:(MTLWinding)frontFace depthClipMode:(MTLDepthClipMode)depthClipMode depthBias:(float)depthBias depthBiasSlopeScale:(float)depthBiasSlopeScale depthBiasClamp:(float)depthBiasClamp fragmentDynamicOffsetsBuffer:(id<MTLBuffer>)fragmentDynamicOffsetsBuffer pipeline:(const WebGPU::RenderPipeline*)pipeline minVertexCounts:(WebGPU::RenderBundle::MinVertexCountsContainer*)minVertexCounts outOfBoundsReadFlag:(id<MTLBuffer>)outOfBoundsReadFlag NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property (readonly, nonatomic) id<MTLBuffer> outOfBoundsReadFlag;
@property (readonly, nonatomic) id<MTLIndirectCommandBuffer> indirectCommandBuffer;
@property (readonly, nonatomic) id<MTLBuffer> indirectCommandBufferContainer;
@property (readonly, nonatomic) id<MTLRenderPipelineState> currentPipelineState;
@property (readonly, nonatomic) id<MTLDepthStencilState> depthStencilState;
@property (readonly, nonatomic) MTLCullMode cullMode;
@property (readonly, nonatomic) MTLWinding frontFace;
@property (readonly, nonatomic) MTLDepthClipMode depthClipMode;
@property (readonly, nonatomic) float depthBias;
@property (readonly, nonatomic) float depthBiasSlopeScale;
@property (readonly, nonatomic) float depthBiasClamp;
@property (readonly, nonatomic) id<MTLBuffer> fragmentDynamicOffsetsBuffer;
@property (readonly, nonatomic) WeakPtr<WebGPU::RenderPipeline> pipeline;

- (WebGPU::RenderBundle::MinVertexCountsContainer*)minVertexCountForDrawCommand;
@end

namespace WebGPU {

class BindGroup;
class Buffer;
class Device;
class RenderBundle;
class RenderPipeline;
class TextureView;

// https://gpuweb.github.io/gpuweb/#gpurenderbundleencoder
class RenderBundleEncoder : public WGPURenderBundleEncoderImpl, public RefCounted<RenderBundleEncoder>, public CommandsMixin {
    WTF_MAKE_TZONE_ALLOCATED(RenderBundleEncoder);
public:
    static Ref<RenderBundleEncoder> create(MTLIndirectCommandBufferDescriptor *indirectCommandBufferDescriptor, const WGPURenderBundleEncoderDescriptor& descriptor, Device& device)
    {
        return adoptRef(*new RenderBundleEncoder(indirectCommandBufferDescriptor, descriptor, device));
    }
    static Ref<RenderBundleEncoder> createInvalid(Device& device, NSString* errorString)
    {
        return adoptRef(*new RenderBundleEncoder(device, errorString));
    }

    ~RenderBundleEncoder();

    enum FinalizeRenderCommand { };
    FinalizeRenderCommand draw(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance);
    FinalizeRenderCommand drawIndexed(uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance);
    FinalizeRenderCommand drawIndexedIndirect(Buffer& indirectBuffer, uint64_t indirectOffset);
    FinalizeRenderCommand drawIndirect(Buffer& indirectBuffer, uint64_t indirectOffset);
    Ref<RenderBundle> finish(const WGPURenderBundleDescriptor&);
    void insertDebugMarker(String&& markerLabel);
    void popDebugGroup();
    void pushDebugGroup(String&& groupLabel);
    void setBindGroup(uint32_t groupIndex, const BindGroup*, std::optional<Vector<uint32_t>>&& dynamicOffsets);
    void setIndexBuffer(Buffer&, WGPUIndexFormat, uint64_t offset, uint64_t size);
    void setPipeline(const RenderPipeline&);
    void setVertexBuffer(uint32_t slot, Buffer*, uint64_t offset, uint64_t size);
    void setLabel(String&&);

    bool NODELETE isValid() const;
    void replayCommands(RenderPassEncoder&);

    static constexpr auto startIndexForFragmentDynamicOffsets = 3;
    static constexpr uint32_t defaultSampleMask = UINT32_MAX;
    static constexpr uint32_t invalidVertexInstanceCount = UINT32_MAX;

    bool validateDepthStencilState(bool depthReadOnly, bool stencilReadOnly) const;
    Device& device() const { return m_device; }

private:
    RenderBundleEncoder(MTLIndirectCommandBufferDescriptor*, const WGPURenderBundleEncoderDescriptor&, Device&);
    RenderBundleEncoder(Device&, NSString*);

    bool NODELETE validatePopDebugGroup() const;
    id<MTLIndirectRenderCommand> currentRenderCommand();
    bool NODELETE replayingCommands() const;

    void makeInvalid(NSString* = nil);
    bool executePreDrawCommands(bool needsValidationLayerWorkaround, bool passWasSplit, uint32_t firstInstance = 0, uint32_t instanceCount = 0);
    void endCurrentICB();
    bool addResource(RenderBundle::ResourcesContainer*, id<MTLResource>, ResourceUsageAndRenderStage*);
    bool addResource(RenderBundle::ResourcesContainer*, id<MTLResource>, MTLRenderStages, const BindGroupEntryUsageData::Resource&);
    bool addResource(RenderBundle::ResourcesContainer*, id<MTLResource>, MTLRenderStages);
    bool icbNeedsToBeSplit(const RenderPipeline& a, const RenderPipeline& b);
    FinalizeRenderCommand finalizeRenderCommand(MTLIndirectCommandType);
    FinalizeRenderCommand finalizeRenderCommand();
    bool validToEncodeCommand() const;
    bool returnIfEncodingIsFinished(NSString* errorString);
    bool runIndexBufferValidation(uint32_t firstInstance, uint32_t instanceCount);
    bool runVertexBufferValidation(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance);
    NSString* errorValidatingDraw() const;
    NSString* errorValidatingDrawIndexed() const;
    uint32_t NODELETE maxVertexBufferIndex() const;
    uint32_t NODELETE maxBindGroupIndex() const;
    void recordCommand(WTF::Function<bool(void)>&&);
    bool storeVertexBufferCountsForValidation(uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance, MTLIndexType, NSUInteger indexBufferOffsetInBytes);
    std::pair<uint32_t, uint32_t> computeMininumVertexInstanceCount(bool& needsValidationLayerWorkaround) const;
    void resetIndexBuffer();
    void splitICB(bool needsPipelineReset = true);
    id<MTLIndirectCommandBuffer> makeICB(uint64_t);
    void cleanup(bool resetPipeline);

    const Ref<Device> m_device;
    RefPtr<Buffer> m_indexBuffer;
    MTLIndexType m_indexType { MTLIndexTypeUInt16 };
    NSUInteger m_indexBufferOffset { 0 };
    NSUInteger m_indexBufferSize { 0 };
    RefPtr<const RenderPipeline> m_pipeline;
    uint32_t m_maxVertexBufferSlot { 0 };
    uint32_t m_maxBindGroupSlot { 0 };
    using UtilizedBufferIndicesContainer = HashMap<uint32_t, uint64_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;
    UtilizedBufferIndicesContainer m_utilizedBufferIndices;

    id<MTLIndirectCommandBuffer> m_indirectCommandBuffer { nil };
    MTLIndirectCommandBufferDescriptor *m_icbDescriptor { nil };

    uint64_t m_debugGroupStackSize { 0 };
    uint64_t m_currentCommandIndex { 0 };
    uint64_t m_previousCommandCount { 0 };
    id<MTLRenderPipelineState> m_currentPipelineState { nil };
    id<MTLDepthStencilState> m_depthStencilState { nil };
    MTLCullMode m_cullMode { MTLCullModeNone };
    MTLWinding m_frontFace { MTLWindingClockwise };
    MTLDepthClipMode m_depthClipMode { MTLDepthClipModeClip };
    float m_depthBias { 0 };
    float m_depthBiasSlopeScale { 0 };
    float m_depthBiasClamp { 0 };

    MTLPrimitiveType m_primitiveType { MTLPrimitiveTypeTriangle };
    Vector<WTF::Function<bool(void)>> m_recordedCommands;
    NSMapTable<id<MTLResource>, ResourceUsageAndRenderStage*>* m_resources;
    struct BufferAndOffset {
        id<MTLBuffer> buffer { nil };
        uint64_t offset { 0 };
        uint32_t dynamicOffsetCount { 0 };
        const uint32_t* dynamicOffsets { nullptr };
        uint64_t size { 0 };
    };
    Vector<BufferAndOffset> m_vertexBuffers;
    Vector<BufferAndOffset> m_fragmentBuffers;
    using BindGroupDynamicOffsetsContainer = HashMap<uint32_t, Vector<uint32_t>, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>>;
    std::optional<BindGroupDynamicOffsetsContainer> m_bindGroupDynamicOffsets;
    HashMap<uint32_t, Ref<const BindGroup>, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> m_bindGroups;
    HashSet<RefPtr<const BindGroup>> m_allBindGroups;
    RenderBundle::MinVertexCountsContainer m_minVertexCountForDrawCommand;
    NSMutableArray<RenderBundleICBWithResources*> *m_icbArray;
    id<MTLBuffer> m_dynamicOffsetsVertexBuffer { nil };
    id<MTLBuffer> m_dynamicOffsetsFragmentBuffer { nil };
    uint64_t m_vertexDynamicOffset { 0 };
    uint64_t m_fragmentDynamicOffset { 0 };

    WeakPtr<RenderPassEncoder> m_renderPassEncoder;
    id<MTLIndirectRenderCommand> m_currentCommand { nil };
    WGPURenderBundleEncoderDescriptor m_descriptor;
    const Vector<WGPUTextureFormat> m_descriptorColorFormats;
    NSString* m_lastErrorString { nil };
    bool m_requiresCommandReplay { false };
    bool m_finished { false };
    uint32_t m_sampleMask { defaultSampleMask };
    bool m_makeSubmitInvalid { false };
};

} // namespace WebGPU
