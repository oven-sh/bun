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
#import "RenderPassEncoder.h"

#import "APIConversions.h"
#import "BindGroup.h"
#import "BindableResource.h"
#import "Buffer.h"
#import "CommandEncoder.h"
#import "ExternalTexture.h"
#import "IsValidToUseWith.h"
#import "Pipeline.h"
#import "QuerySet.h"
#import "RenderBundle.h"
#import "RenderPipeline.h"
#import "TextureOrTextureView.h"
#import "TextureView.h"
#import <wtf/IndexedRange.h>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

#define RETURN_IF_FINISHED() \
if (!m_parentEncoder->isLocked() || m_parentEncoder->isFinished()) { \
    protect(m_device)->generateAValidationError([NSString stringWithFormat:@"%s: failed as encoding has finished", __PRETTY_FUNCTION__]); \
    m_renderCommandEncoder = nil; \
    return; \
} \
if (!m_renderCommandEncoder || !m_parentEncoder->isValid() || !protect(m_parentEncoder)->encoderIsCurrent(m_renderCommandEncoder)) { \
    m_renderCommandEncoder = nil; \
    return; \
}

#define CHECKED_SET_PSO(commandEncoder, makePso, ...) \
if (id<MTLRenderPipelineState> pso = makePso) \
    [commandEncoder setRenderPipelineState:pso]; \
else \
    return __VA_ARGS__;

WTF_MAKE_TZONE_ALLOCATED_IMPL(RenderPassEncoder);

static std::pair<uint64_t, uint32_t> NODELETE makeKey(uint64_t bufferIdentifier, uint32_t offset)
{
    return std::make_pair(bufferIdentifier, offset);
}

void RenderPassEncoder::setVertexBuffer(id<MTLRenderCommandEncoder> commandEncoder, id<MTLBuffer> buffer, uint32_t offset, uint32_t bufferIndex)
{
    if (m_ignoreBufferCache) [[unlikely]] {
        [commandEncoder setVertexBuffer:buffer offset:offset atIndex:bufferIndex];
        return;
    }

    uint64_t bufferIdentifier = buffer.gpuAddress;
    if (auto key = makeKey(bufferIdentifier, offset); m_existingVertexBuffers[bufferIndex] != key || !bufferIdentifier) {
        [commandEncoder setVertexBuffer:buffer offset:offset atIndex:bufferIndex];
        m_existingVertexBuffers[bufferIndex] = key;
    }
}

void RenderPassEncoder::setFragmentBuffer(id<MTLRenderCommandEncoder> commandEncoder, id<MTLBuffer> buffer, uint32_t offset, uint32_t bufferIndex)
{
    if (m_ignoreBufferCache) [[unlikely]] {
        [commandEncoder setFragmentBuffer:buffer offset:offset atIndex:bufferIndex];
        return;
    }

    uint64_t bufferIdentifier = buffer.gpuAddress;
    if (auto key = makeKey(bufferIdentifier, offset); m_existingFragmentBuffers[bufferIndex] != key || !bufferIdentifier) {
        [commandEncoder setFragmentBuffer:buffer offset:offset atIndex:bufferIndex];
        m_existingFragmentBuffers[bufferIndex] = key;
    }
}

void RenderPassEncoder::setVertexBytes(id<MTLRenderCommandEncoder> commandEncoder, std::span<const uint8_t> span, uint32_t bufferIndex)
{
    [commandEncoder setVertexBytes:span.data() length:span.size() atIndex:bufferIndex];
    m_existingVertexBuffers[bufferIndex] = { };
}
void RenderPassEncoder::setFragmentBytes(id<MTLRenderCommandEncoder> commandEncoder, std::span<const uint8_t> span, uint32_t bufferIndex)
{
    [commandEncoder setFragmentBytes:span.data() length:span.size() atIndex:bufferIndex];
    m_existingFragmentBuffers[bufferIndex] = { };
}

RenderPassEncoder::RenderPassEncoder(id<MTLRenderCommandEncoder> renderCommandEncoder, const WGPURenderPassDescriptor& descriptor, NSUInteger visibilityResultBufferSize, bool depthReadOnly, bool stencilReadOnly, CommandEncoder& rawParentEncoder, id<MTLBuffer> visibilityResultBuffer, uint64_t maxDrawCount, Device& device, MTLRenderPassDescriptor* metalDescriptor)
    : m_renderCommandEncoder(renderCommandEncoder)
    , m_device(device)
    , m_visibilityResultBufferSize(visibilityResultBufferSize)
    , m_depthReadOnly(depthReadOnly)
    , m_stencilReadOnly(stencilReadOnly)
    , m_parentEncoder(rawParentEncoder)
    , m_visibilityResultBuffer(visibilityResultBuffer)
    , m_descriptor(descriptor)
    , m_descriptorColorAttachments(descriptor.colorAttachmentCount ? Vector<WGPURenderPassColorAttachment>(unsafeMakeSpan(descriptor.colorAttachments, descriptor.colorAttachmentCount)) : Vector<WGPURenderPassColorAttachment>())
    , m_descriptorDepthStencilAttachment(descriptor.depthStencilAttachment ? *descriptor.depthStencilAttachment : WGPURenderPassDepthStencilAttachment())
    , m_metalDescriptor(metalDescriptor)
    , m_maxDrawCount(maxDrawCount)
    , m_rasterizationRateMap(metalDescriptor.rasterizationRateMap)
{
    if (m_device->baseCapabilities().memoryBarrierLimit > maxDrawCount)
        m_metalDescriptor = nil;

    if (m_descriptorColorAttachments.size())
        m_descriptor.colorAttachments = &m_descriptorColorAttachments[0];
    if (descriptor.depthStencilAttachment)
        m_descriptor.depthStencilAttachment = &m_descriptorDepthStencilAttachment;
    auto colorAttachments = descriptor.colorAttachmentsSpan();
    for (auto& attachment : colorAttachments) {
        auto texture = attachment.view ? TextureOrTextureView(static_cast<TextureView*>(attachment.view)) : TextureOrTextureView(static_cast<Texture*>(attachment.texture));
        m_colorAttachmentViews.append(texture);
    }
    if (const auto* attachment = descriptor.depthStencilAttachment)
        m_depthStencilView = attachment->view ? TextureOrTextureView(fromAPI(attachment->view)) : TextureOrTextureView(fromAPI(attachment->texture));

    m_parentEncoder->lock(true);

    m_attachmentsToClear = [NSMutableDictionary dictionary];
    for (auto [ i, attachment ] : indexedRange(colorAttachments)) {
        if (!attachment.view && !attachment.texture)
            continue;

        auto texture = attachment.view ? TextureOrTextureView(fromAPI(attachment.view)) : TextureOrTextureView(fromAPI(attachment.texture));
        if (texture.isDestroyed())
            m_parentEncoder->makeSubmitInvalid();

        texture.setPreviouslyCleared();
        addResourceToActiveResources(texture, BindGroupEntryUsage::Attachment);
        m_rasterSampleCount = texture.sampleCount();
        if (attachment.resolveTarget || attachment.resolveTexture) {
            auto texture = attachment.resolveTarget ? TextureOrTextureView(fromAPI(attachment.resolveTarget)) : TextureOrTextureView(fromAPI(attachment.resolveTexture));
            texture.setCommandEncoder(m_parentEncoder);
            texture.setPreviouslyCleared();
            addResourceToActiveResources(texture, BindGroupEntryUsage::Attachment);
        }

        texture.setCommandEncoder(m_parentEncoder);
        id<MTLTexture> textureToClear = texture.texture();
        m_renderTargetWidth = textureToClear.width;
        m_renderTargetHeight = textureToClear.height;
        if (!textureToClear)
            continue;
        TextureAndClearColor *textureWithClearColor = [[TextureAndClearColor alloc] initWithTexture:textureToClear];
        if (attachment.storeOp != WGPUStoreOp_Discard) {
            auto& c = attachment.clearValue;
            textureWithClearColor.clearColor = MTLClearColorMake(c.r, c.g, c.b, c.a);
        } else if (attachment.loadOp == WGPULoadOp_Load) {
            textureWithClearColor.clearColor = MTLClearColorMake(0, 0, 0, 0);
            [m_attachmentsToClear setObject:textureWithClearColor forKey:@(i)];
        }

        textureWithClearColor.depthPlane = texture.isDestroyed() ? 0 : attachment.depthSlice.value_or(0);
    }

    if (const auto* attachment = descriptor.depthStencilAttachment) {
        auto textureView = attachment->view ? TextureOrTextureView(fromAPI(attachment->view)) : TextureOrTextureView(fromAPI(attachment->texture));
        textureView.setPreviouslyCleared();
        textureView.setCommandEncoder(m_parentEncoder);
        id<MTLTexture> depthTexture = textureView.isDestroyed() ? nil : textureView.texture();
        if (textureView.width() && !m_renderTargetWidth) {
            m_renderTargetWidth = depthTexture.width;
            m_renderTargetHeight = depthTexture.height;
            m_rasterSampleCount = textureView.sampleCount();
        }

        m_depthClearValue = attachment->depthStoreOp == WGPUStoreOp_Discard ? 0 : quantizedDepthValue(attachment->depthClearValue, textureView.format());
        if (!Device::isStencilOnlyFormat(depthTexture.pixelFormat)) {
            m_clearDepthAttachment = depthTexture && attachment->depthStoreOp == WGPUStoreOp_Discard && attachment->depthLoadOp == WGPULoadOp_Load;
            m_depthStencilAttachmentToClear = depthTexture;
            addResourceToActiveResources(textureView, attachment->depthReadOnly ? BindGroupEntryUsage::AttachmentRead : BindGroupEntryUsage::Attachment, WGPUTextureAspect_DepthOnly);
        }

        m_stencilClearValue = attachment->stencilStoreOp == WGPUStoreOp_Discard ? 0 : attachment->stencilClearValue;
        if (Texture::stencilOnlyAspectMetalFormat(textureView.format())) {
            m_clearStencilAttachment = depthTexture && attachment->stencilStoreOp == WGPUStoreOp_Discard && attachment->stencilLoadOp == WGPULoadOp_Load;
            m_depthStencilAttachmentToClear = depthTexture;
            addResourceToActiveResources(textureView, attachment->stencilReadOnly ? BindGroupEntryUsage::AttachmentRead : BindGroupEntryUsage::Attachment, WGPUTextureAspect_StencilOnly);
        }
    }

    m_bindGroupDynamicOffsetsChanged.resize(m_device->limits().maxBindGroups);
    RELEASE_ASSERT(m_maxDynamicOffsetAtIndex.size() >= m_device->limits().maxBindGroups);
}

double RenderPassEncoder::quantizedDepthValue(double depthClearValue, WGPUTextureFormat pixelFormat)
{
    if (depthClearValue < 0 || depthClearValue > 1)
        return depthClearValue;
    switch (pixelFormat) {
    case WGPUTextureFormat_Depth16Unorm:
        return std::nextafterf(depthClearValue + 0.5 / USHRT_MAX, 1.f);
    default:
        return depthClearValue;
    }
}

RenderPassEncoder::RenderPassEncoder(CommandEncoder& parentEncoder, Device& device, NSString* errorString)
    : m_device(device)
    , m_parentEncoder(parentEncoder)
    , m_lastErrorString(errorString)
{
    m_parentEncoder->lock(true);
    m_parentEncoder->setLastError(errorString);
    RELEASE_ASSERT(m_maxDynamicOffsetAtIndex.size() >= m_device->limits().maxBindGroups);
}

RenderPassEncoder::~RenderPassEncoder()
{
    if (m_renderCommandEncoder)
        m_parentEncoder->makeInvalid(@"GPURenderPassEncoder.finish was never called");

    m_renderCommandEncoder = nil;
}

bool RenderPassEncoder::occlusionQueryIsDestroyed() const
{
    return m_visibilityResultBufferSize == NSUIntegerMax;
}

void RenderPassEncoder::beginOcclusionQuery(uint32_t queryIndex)
{
    RETURN_IF_FINISHED();

    auto initialQueryIndex = queryIndex;
    queryIndex *= sizeof(uint64_t);
    if (m_occlusionQueryActive || m_queryBufferIndicesToClear.contains(queryIndex)) {
        makeInvalid(@"beginOcclusionQuery validation failure");
        return;
    }
    if (initialQueryIndex >= m_visibilityResultBufferSize / sizeof(uint64_t)) {
        makeInvalid(@"beginOcclusionQuery validation failure");
        return;
    }

    m_occlusionQueryActive = true;
    m_visibilityResultBufferOffset = queryIndex;
    m_queryBufferIndicesToClear.add(m_visibilityResultBufferOffset);

    if (occlusionQueryIsDestroyed())
        return;

    if (m_queryBufferUtilizedIndices.contains(queryIndex))
        return;
    [renderCommandEncoder() setVisibilityResultMode:MTLVisibilityResultModeCounting offset:queryIndex];
    m_queryBufferUtilizedIndices.add(queryIndex);
}

void RenderPassEncoder::endOcclusionQuery()
{
    RETURN_IF_FINISHED();
    if (!m_occlusionQueryActive) {
        makeInvalid(@"endOcclusionQuery - occlusion query was not active");
        return;
    }
    m_occlusionQueryActive = false;

    if (occlusionQueryIsDestroyed())
        return;
    [renderCommandEncoder() setVisibilityResultMode:MTLVisibilityResultModeDisabled offset:m_visibilityResultBufferOffset];
}

static void setViewportMinMaxDepthIntoBuffer(auto& fragmentDynamicOffsets, float minDepth, float maxDepth)
{
    static_assert(sizeof(fragmentDynamicOffsets[0]) == sizeof(minDepth), "expect dynamic offsets container to have matching size to depth values");
    static_assert(RenderBundleEncoder::startIndexForFragmentDynamicOffsets > 1, "code path assumes value is 2 or more");
    if (fragmentDynamicOffsets.size() < RenderBundleEncoder::startIndexForFragmentDynamicOffsets)
        fragmentDynamicOffsets.grow(RenderBundleEncoder::startIndexForFragmentDynamicOffsets);

    using destType = typename std::remove_reference<decltype(fragmentDynamicOffsets[0])>::type;
    fragmentDynamicOffsets[0] = std::bit_cast<destType>(minDepth);
    fragmentDynamicOffsets[1] = std::bit_cast<destType>(maxDepth);
}

void RenderPassEncoder::addTextureToActiveResources(const void* resourceAddress, id<MTLResource> mtlResource, OptionSet<BindGroupEntryUsage> initialUsage, uint32_t baseMipLevel, uint32_t baseArrayLayer, WGPUTextureAspect aspect)
{
    if (!mtlResource)
        return;

    auto mapKey = BindGroup::makeEntryMapKey(baseMipLevel, baseArrayLayer, aspect);
    EntryUsage resourceUsage = initialUsage;
    EntryMap* entryMap = nullptr;
    if (auto it = m_usagesForTexture.find(resourceAddress); it != m_usagesForTexture.end()) {
        entryMap = &it->value;
        if (auto innerIt = it->value.find(mapKey); innerIt != it->value.end())
            resourceUsage.add(innerIt->value);
    }

    if (!BindGroup::allowedUsage(resourceUsage)) {
        makeInvalid([NSString stringWithFormat:@"Bind group has incompatible usage list: %@", BindGroup::usageName(resourceUsage)]);
        return;
    }
    if (!entryMap) {
        EntryMap entryMap;
        entryMap.set(mapKey, resourceUsage);
        m_usagesForTexture.set(resourceAddress, entryMap);
    } else
        entryMap->set(mapKey, resourceUsage);
}

void RenderPassEncoder::addResourceToActiveResources(const void* resourceAddress, OptionSet<BindGroupEntryUsage> initialUsage)
{
    if (!resourceAddress)
        return;

    EntryUsage resourceUsage = initialUsage;
    if (auto it = m_usagesForBuffer.find(resourceAddress); it != m_usagesForBuffer.end())
        resourceUsage.add(it->value);

    if (!BindGroup::allowedUsage(resourceUsage)) {
        makeInvalid([NSString stringWithFormat:@"Bind group has incompatible usage list: %@", BindGroup::usageName(resourceUsage)]);
        return;
    }
    m_usagesForBuffer.set(resourceAddress, resourceUsage);
}

void RenderPassEncoder::addResourceToActiveResources(const TextureView& texture, OptionSet<BindGroupEntryUsage> resourceUsage, WGPUTextureAspect textureAspect)
{
    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), textureAspect);
}

void RenderPassEncoder::addResourceToActiveResources(const TextureOrTextureView& texture, OptionSet<BindGroupEntryUsage> resourceUsage, WGPUTextureAspect textureAspect)
{
    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), textureAspect);
}

void RenderPassEncoder::addResourceToActiveResources(const TextureView& texture, OptionSet<BindGroupEntryUsage> resourceUsage)
{
    WGPUTextureAspect textureAspect = texture.aspect();
    if (textureAspect != WGPUTextureAspect_All) {
        addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), textureAspect);
        return;
    }

    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_DepthOnly);
    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_StencilOnly);
}

void RenderPassEncoder::addResourceToActiveResources(const TextureOrTextureView& texture, OptionSet<BindGroupEntryUsage> resourceUsage)
{
    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_DepthOnly);
    addTextureToActiveResources(&texture.apiParentTexture(), texture.parentTexture(), resourceUsage, texture.baseMipLevel(), texture.baseArrayLayer(), WGPUTextureAspect_StencilOnly);
}

void RenderPassEncoder::addResourceToActiveResources(const Texture& texture, OptionSet<BindGroupEntryUsage> resourceUsage)
{
    constexpr uint32_t baseMipLevel = 0;
    constexpr uint32_t baseArrayLayer = 0;
    addTextureToActiveResources(&texture, texture.texture(), resourceUsage, baseMipLevel, baseArrayLayer, WGPUTextureAspect_DepthOnly);
    addTextureToActiveResources(&texture, texture.texture(), resourceUsage, baseMipLevel, baseArrayLayer, WGPUTextureAspect_StencilOnly);
}

void RenderPassEncoder::addResourceToActiveResources(const BindGroupEntryUsageData::Resource& resource, OptionSet<BindGroupEntryUsage> resourceUsage)
{
    WTF::switchOn(resource, [&](const RefPtr<Buffer>& buffer) {
        if (buffer.get()) {
            if (resourceUsage.contains(BindGroupEntryUsage::Storage))
                buffer->indirectBufferInvalidated(m_parentEncoder);
            addResourceToActiveResources(buffer.get(), resourceUsage);
        }
        }, [&](const RefPtr<const Texture>& texture) {
            if (texture.get())
                addResourceToActiveResources(*texture.get(), resourceUsage);
        }, [&](const RefPtr<const TextureView>& textureView) {
            if (textureView.get())
                addResourceToActiveResources(*textureView.get(), resourceUsage);
        }, [&](const RefPtr<const ExternalTexture>& externalTexture) {
            addResourceToActiveResources(externalTexture.get(), resourceUsage);
    });
}

bool RenderPassEncoder::runIndexBufferValidation(uint32_t firstInstance, uint32_t instanceCount)
{
    if (!m_pipeline || !m_indexBuffer) {
        makeInvalid(@"Missing pipeline before draw command");
        return false;
    }

    auto checkedStrideCount = checkedSum<NSUInteger>(firstInstance, instanceCount);
    if (checkedStrideCount.hasOverflowed())
        return false;

    auto strideCount = checkedStrideCount.value();
    if (!strideCount)
        return true;

    auto& requiredBufferIndices = m_pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, bufferData] : requiredBufferIndices) {
        auto& bufferAndOffset = m_vertexBuffers[bufferIndex];
        if (!bufferAndOffset.buffer)
            continue;
        auto bufferSize = bufferAndOffset.size;
        auto stride = bufferData.stride;
        auto lastStride = bufferData.lastStride;
        if (bufferData.stepMode == WGPUVertexStepMode_Instance) {
            auto product = checkedProduct<NSUInteger>(strideCount - 1, stride);
            if (product.hasOverflowed())
                return false;
            auto sum = checkedSum<NSUInteger>(product.value(), lastStride);
            if (sum.hasOverflowed())
                return false;

            if (sum.value() > bufferSize) {
                makeInvalid([NSString stringWithFormat:@"Buffer[%d] fails: (strideCount(%lu) - 1) * stride(%llu) + lastStride(%llu) > bufferSize(%llu) / mtlBufferSize(%lu)", bufferIndex, static_cast<unsigned long>(strideCount), stride, lastStride, bufferSize, (unsigned long)bufferAndOffset.buffer.length]);
                return false;
            }
        }
    }

    return true;
}

void RenderPassEncoder::runVertexBufferValidation(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    if (!m_pipeline) {
        makeInvalid(@"Missing pipeline before draw command");
        return;
    }

    if (checkedSum<uint32_t>(firstVertex, vertexCount).hasOverflowed()) {
        makeInvalid(@"Overflow in vertex count + firstVertex");
        return;
    }

    auto& requiredBufferIndices = m_pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, bufferData] : requiredBufferIndices) {
        Checked<uint64_t, WTF::RecordOverflow> strideCount = 0;
        switch (bufferData.stepMode) {
        case WGPUVertexStepMode_Vertex:
            strideCount = checkedSum<uint32_t>(firstVertex, vertexCount);
            if (strideCount.hasOverflowed()) {
                makeInvalid(@"StrideCount invalid");
                return;
            }
            break;
        case WGPUVertexStepMode_Instance:
            strideCount = checkedSum<uint32_t>(firstInstance, instanceCount);
            if (strideCount.hasOverflowed()) {
                makeInvalid(@"StrideCount invalid");
                return;
            }
            break;
        default:
            break;
        }

        if (!strideCount.value())
            continue;

        auto& bufferAndOffset = m_vertexBuffers[bufferIndex];
        auto bufferSize = bufferAndOffset.size;
        auto strideSize = checkedProduct<uint64_t>((strideCount.value() - 1), bufferData.stride);
        auto requiredSize = checkedSum<uint64_t>(strideSize.value(), bufferData.lastStride);
        if (strideSize.hasOverflowed() || requiredSize.hasOverflowed() || requiredSize.value() > bufferSize) {
            makeInvalid([NSString stringWithFormat:@"Buffer[%d] fails: (strideCount(%llu) - 1) * bufferData.stride(%llu) + bufferData.lastStride(%llu) > bufferSize(%llu)", bufferIndex, strideCount.value(), bufferData.stride,  bufferData.lastStride, bufferSize]);
            return;
        }
    }
}

uint32_t RenderPassEncoder::maxVertexBufferIndex() const
{
    return m_maxVertexBufferSlot;
}

uint32_t RenderPassEncoder::maxBindGroupIndex() const
{
    return m_maxBindGroupSlot;
}

NSString* RenderPassEncoder::errorValidatingAndBindingBuffers()
{
    if (!m_pipeline)
        return @"pipeline is not set";

    auto& requiredBufferIndices = m_pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, _] : requiredBufferIndices) {
        auto& bufferAndOffset = m_vertexBuffers[bufferIndex];
        if (!bufferAndOffset.buffer)
            return [NSString stringWithFormat:@"Buffer1 index[%u] is missing", bufferIndex];

        if (bufferAndOffset.offset < bufferAndOffset.buffer.length)
            setVertexBuffer(renderCommandEncoder(), bufferAndOffset.buffer, bufferAndOffset.offset, bufferIndex);
        else if (bufferAndOffset.size) {
            makeInvalid(@"offset >= buffer.length && buffer.size");
            return @"offset >= buffer.length && buffer.size";
        } else
            setVertexBuffer(renderCommandEncoder(), m_device->placeholderBuffer(), 0, bufferIndex);
    }

    auto bindGroupSpaceUsedPlusVertexBufferSpaceUsed = checkedSum<uint32_t>(maxBindGroupIndex(), 1, maxVertexBufferIndex(), 1);
    if (bindGroupSpaceUsedPlusVertexBufferSpaceUsed.hasOverflowed() || bindGroupSpaceUsedPlusVertexBufferSpaceUsed.value() > m_device->limits().maxBindGroupsPlusVertexBuffers)
        return @"Too many bind groups and vertex buffers used";

    return nil;
}

NSString* RenderPassEncoder::errorValidatingDrawIndexed() const
{
    if (!m_indexBuffer)
        return @"Index buffer is not set";

    if (!m_pipeline)
        return @"Pipeline is not set";

    auto topology = m_pipeline->primitiveTopology();
    if (topology == WGPUPrimitiveTopology_LineStrip || topology == WGPUPrimitiveTopology_TriangleStrip) {
        if (m_indexType != m_pipeline->stripIndexFormat())
            return @"Primitive topology mismiatch with render pipeline";
    }

    return nil;
}

void RenderPassEncoder::incrementDrawCount(uint32_t drawCalls)
{
    auto checkedDrawCount = checkedSum<uint64_t>(m_drawCount, drawCalls);
    if (checkedDrawCount.hasOverflowed() || checkedDrawCount > m_maxDrawCount) {
        makeInvalid(@"m_drawCount > m_maxDrawCount");
        return;
    }

    m_drawCount = checkedDrawCount;
}

bool RenderPassEncoder::issuedDrawCall() const
{
    return m_drawCount;
}

void RenderPassEncoder::setCachedRenderPassState(id<MTLRenderCommandEncoder> commandEncoder)
{
    if (m_viewport) {
        [commandEncoder setViewport:*m_viewport];
#if !CPU(X86_64)
        m_viewport = std::nullopt;
#endif
    }
    if (m_blendColor)
        [commandEncoder setBlendColorRed:m_blendColor->r green:m_blendColor->g blue:m_blendColor->b alpha:m_blendColor->a];
    if (m_stencilReferenceValue) {
        [commandEncoder setStencilReferenceValue:*m_stencilReferenceValue];
        m_stencilReferenceValue = std::nullopt;
    }
    if (m_scissorRect) {
        [commandEncoder setScissorRect:*m_scissorRect];
        m_scissorRect = std::nullopt;
    }
}

bool RenderPassEncoder::executePreDrawCommands(uint32_t vertexCount)
{
    return executePreDrawCommands(0, 0, false, nullptr, vertexCount == 1);
}

bool RenderPassEncoder::executePreDrawCommands(uint32_t firstInstance, uint32_t instanceCount, bool passWasSplit, const Buffer* indirectBuffer, bool needsValidationLayerWorkaround)
{
    auto pipeline = m_pipeline;
    if (pipeline && needsValidationLayerWorkaround)
        pipeline = pipeline->recomputeLastStrideAsStride();

    if (!pipeline) {
        makeInvalid(@"Missing pipeline before draw command");
        return false;
    }

    if (!pipeline->isValid()) {
        makeInvalid(@"pipeline is not valid prior to draw");
        return false;
    }

    if (checkedSum<uint64_t>(instanceCount, firstInstance) > std::numeric_limits<uint32_t>::max())
        return false;

    Ref pipelineLayout = pipeline->pipelineLayout();
    if (NSString* error = pipelineLayout->errorValidatingBindGroupCompatibility(m_bindGroups)) {
        makeInvalid(error);
        return false;
    }

    if (indirectBuffer)
        addResourceToActiveResources(indirectBuffer, BindGroupEntryUsage::Input);
    if (NSString* error = errorValidatingAndBindingBuffers()) {
        makeInvalid(error);
        return false;
    }

    id<MTLRenderCommandEncoder> commandEncoder = renderCommandEncoder();
    auto pipelineIdentifier = pipeline->uniqueId();
    for (auto& [groupIndex, bindGroup] : m_bindGroups) {
        Ref group = bindGroup;
        if (passWasSplit) {
            for (const auto& resource : group->resources()) {
                if ((resource.renderStages & (MTLRenderStageVertex | MTLRenderStageFragment)) && resource.mtlResources.size())
                    [renderCommandEncoder() useResources:&resource.mtlResources[0] count:resource.mtlResources.size() usage:resource.usage stages:resource.renderStages];

                ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
                for (size_t i = 0, sz = resource.mtlResources.size(); i < sz; ++i) {
                    auto& resourceUsage = resource.resourceUsages[i];
                    addResourceToActiveResources(resourceUsage.resource, resourceUsage.usage);
                    setCommandEncoder(resourceUsage.resource);
                }
            }
        }

        if (group->hasSamplers())
            m_parentEncoder->rebindSamplersPreCommit(group);

        if (!group->previouslyValidatedBindGroup(groupIndex, pipelineIdentifier, m_maxDynamicOffsetAtIndex[groupIndex])) {
            const Vector<uint32_t>* dynamicOffsets = nullptr;
            if (auto it = m_bindGroupDynamicOffsets.find(groupIndex); it != m_bindGroupDynamicOffsets.end())
                dynamicOffsets = &it->value;
            if (NSString* error = errorValidatingBindGroup(group, pipeline->minimumBufferSizes(groupIndex), dynamicOffsets)) {
                makeInvalid(error);
                return false;
            }
            if (group->makeSubmitInvalid(ShaderStage::Vertex, protect(pipelineLayout->optionalBindGroupLayout(groupIndex)).get()) || group->makeSubmitInvalid(ShaderStage::Fragment, protect(pipelineLayout->optionalBindGroupLayout(groupIndex)).get())) {
                m_parentEncoder->makeSubmitInvalid();
                return false;
            }
            group->validatedSuccessfully(groupIndex, pipelineIdentifier, m_maxDynamicOffsetAtIndex[groupIndex]);
        }
        setVertexBuffer(commandEncoder, group->vertexArgumentBuffer(), 0, m_device->vertexBufferIndexForBindGroup(groupIndex));
        setFragmentBuffer(commandEncoder, group->fragmentArgumentBuffer(), 0, groupIndex);
    }

    if (pipeline->renderPipelineState())
        [commandEncoder setRenderPipelineState:pipeline->renderPipelineState()];
    if (pipeline->depthStencilState())
        [commandEncoder setDepthStencilState:pipeline->depthStencilState()];
    [commandEncoder setCullMode:pipeline->cullMode()];
    [commandEncoder setFrontFacingWinding:pipeline->frontFace()];
    if (m_overrideDepthClipMode != MTLDepthClipModeClip)
        [commandEncoder setDepthClipMode:m_overrideDepthClipMode];
    else
        [commandEncoder setDepthClipMode:pipeline->depthClipMode()];
    [commandEncoder setDepthBias:pipeline->depthBias() slopeScale:pipeline->depthBiasSlopeScale() clamp:pipeline->depthBiasClamp()];
    setCachedRenderPassState(commandEncoder);

    m_queryBufferIndicesToClear.remove(m_visibilityResultBufferOffset);

    for (auto& kvp : m_bindGroupDynamicOffsets) {
        auto bindGroupIndex = kvp.key;
        if (m_bindGroupDynamicOffsetsChanged[bindGroupIndex]) {
            if (!pipelineLayout->updateVertexOffsets(bindGroupIndex, kvp.value, m_vertexDynamicOffsets) || !pipelineLayout->updateFragmentOffsets(bindGroupIndex, kvp.value, m_fragmentDynamicOffsets.mutableSpan().subspan(RenderBundleEncoder::startIndexForFragmentDynamicOffsets))) {
                makeInvalid(@"Invalid offset calculation");
                return false;
            }
            m_bindGroupDynamicOffsetsChanged[bindGroupIndex] = false;
        }
    }

    if (m_vertexDynamicOffsets.size() && m_priorVertexDynamicOffsets != m_vertexDynamicOffsets) {
        setVertexBytes(commandEncoder, asByteSpan(m_vertexDynamicOffsets.span()), m_device->maxBuffersPlusVertexBuffersForVertexStage());
        m_priorVertexDynamicOffsets = m_vertexDynamicOffsets;
    }

    float minDepth = m_viewport ? m_viewport->znear : 0.f;
    float maxDepth = m_viewport ? m_viewport->zfar : 1.f;
    setViewportMinMaxDepthIntoBuffer(m_fragmentDynamicOffsets, minDepth, maxDepth);
    ASSERT(m_fragmentDynamicOffsets.size());
    if (m_priorFragmentDynamicOffsets != m_fragmentDynamicOffsets) {
        setFragmentBytes(commandEncoder, asByteSpan(m_fragmentDynamicOffsets.span()), m_device->maxBuffersForFragmentStage());
        m_priorFragmentDynamicOffsets = m_fragmentDynamicOffsets;
    }

    incrementDrawCount();

    return true;
}

void RenderPassEncoder::draw(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    RETURN_IF_FINISHED();

    auto checkedVertexCount = checkedProduct<uint32_t>(vertexCount, instanceCount);
    if (checkedVertexCount.hasOverflowed() || checkedVertexCount.value() > m_device->maxVerticesPerDrawCall()) {
        protect(m_device)->loseTheDevice(WGPUDeviceLostReason_Undefined);
        return;
    }

    if (!executePreDrawCommands(vertexCount))
        return;
    runVertexBufferValidation(vertexCount, instanceCount, firstVertex, firstInstance);
    if (!instanceCount || !vertexCount || instanceCount + firstInstance < firstInstance || vertexCount + firstVertex < firstVertex)
        return;

    [renderCommandEncoder()
        drawPrimitives:m_primitiveType
        vertexStart:firstVertex
        vertexCount:vertexCount
        instanceCount:instanceCount
        baseInstance:firstInstance];
}

std::pair<uint32_t, uint32_t> RenderPassEncoder::computeMininumVertexInstanceCount(const RenderPipeline* pipeline, bool& needsValidationLayerWorkaround, uint64_t (^computeBufferSize)(uint32_t))
{
    needsValidationLayerWorkaround = false;
    if (!pipeline)
        return std::make_pair(0, 0);

    uint32_t minVertexCount = RenderBundleEncoder::invalidVertexInstanceCount;
    uint32_t minInstanceCount = RenderBundleEncoder::invalidVertexInstanceCount;
    auto& requiredBufferIndices = pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, bufferData] : requiredBufferIndices) {
        auto bufferSize = computeBufferSize(bufferIndex);
        auto stride = bufferData.stride;
        auto lastStride = bufferData.lastStride;
        if (!stride && bufferSize >= lastStride)
            continue;

        auto elementCount = bufferSize < lastStride ? 0 : ((bufferSize - lastStride) / stride + 1);
        if (bufferSize < stride && bufferSize >= lastStride && elementCount == 1)
            needsValidationLayerWorkaround = true;

        if (bufferData.stepMode == WGPUVertexStepMode_Vertex)
            minVertexCount = std::min<uint32_t>(minVertexCount, elementCount);
        else
            minInstanceCount = std::min<uint32_t>(minInstanceCount, elementCount);
    }
    return std::make_pair(minVertexCount, minInstanceCount);
}

std::pair<uint32_t, uint32_t> RenderPassEncoder::computeMininumVertexInstanceCount(bool& needsValidationLayerWorkaround) const
{
    return computeMininumVertexInstanceCount(m_pipeline.get(), needsValidationLayerWorkaround, ^(uint32_t bufferIndex) {
        auto& bufferAndOffset = m_vertexBuffers[bufferIndex];
        return !bufferAndOffset.buffer || (bufferAndOffset.buffer.length < bufferAndOffset.offset) ? 0 : (bufferAndOffset.buffer.length - bufferAndOffset.offset);
    });
}

void RenderPassEncoder::emitMemoryBarrier(id<MTLRenderCommandEncoder> renderCommandEncoder)
{
    if (++m_memoryBarrierCount < m_device->baseCapabilities().memoryBarrierLimit)
        [renderCommandEncoder memoryBarrierWithScope:MTLBarrierScopeBuffers afterStages:MTLRenderStageVertex beforeStages:MTLRenderStageVertex];
}

template <typename T>
static T* NODELETE typedCast(auto& s)
{
    return static_cast<T*>(static_cast<void*>(&s));
}

RenderPassEncoder::DrawIndexResult RenderPassEncoder::clampIndexBufferToValidValues(uint32_t indexCount, uint32_t instanceCount, int32_t baseVertex, uint32_t firstInstance, MTLIndexType indexType, NSUInteger indexBufferOffsetInBytes, Buffer* apiIndexBuffer, uint32_t minVertexCount, uint32_t minInstanceCount, RenderPassEncoder& encoder, Device& device, uint32_t rasterSampleCount, MTLPrimitiveType primitiveType)
{
    id<MTLBuffer> indexBuffer = apiIndexBuffer ? apiIndexBuffer->buffer() : nil;
    if (!indexCount || !indexBuffer || apiIndexBuffer->isDestroyed())
        return DrawIndexResult { IndexCall::Skip, nil, 0 };

    if (minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount && minInstanceCount == RenderBundleEncoder::invalidVertexInstanceCount)
        return DrawIndexResult { IndexCall::Draw, nil, 0 };

    uint32_t indexSizeInBytes = indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t);
    uint32_t firstIndex = indexBufferOffsetInBytes / indexSizeInBytes;
    int64_t baseVertex64 = baseVertex;
    if (!minVertexCount || !minInstanceCount || indexBufferOffsetInBytes >= indexBuffer.length || -baseVertex64 > static_cast<int64_t>(minVertexCount) || baseVertex64 > static_cast<int64_t>(minVertexCount))
        return DrawIndexResult { IndexCall::Skip, nil, 0 };

    auto primitiveOffset = primitiveType == MTLPrimitiveTypeLineStrip || primitiveType == MTLPrimitiveTypeTriangleStrip ? 1u : 0u;
    auto effectiveMinVertexCount = minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount ? minVertexCount : (minVertexCount - baseVertex);
    if (auto it = apiIndexBuffer->canSkipDrawIndexedValidation(firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset)) {
        if (apiIndexBuffer->didReadOOB())
            return DrawIndexResult { IndexCall::Skip, nil, 0 };

        apiIndexBuffer->skippedDrawIndexedValidation(encoder.parentEncoder(), *it);
        return DrawIndexResult { IndexCall::Draw, nil, 0 };
    }

    auto indexCountInBytes = checkedProduct<size_t>(indexSizeInBytes, indexCount);
    auto indexCountPlusOffsetInBytes = checkedSum<size_t>(indexCountInBytes, indexBufferOffsetInBytes);
    if (indexCountInBytes.hasOverflowed() || indexCountPlusOffsetInBytes.hasOverflowed() || indexCountPlusOffsetInBytes > indexBuffer.length)
        return DrawIndexResult { IndexCall::Skip, nil, 0 };

    auto baseInstancePlusInstanceCount = checkedSum<NSUInteger>(firstInstance, instanceCount);
    bool failedCondition = baseInstancePlusInstanceCount.hasOverflowed() || baseInstancePlusInstanceCount.value() > minInstanceCount || firstInstance >= minInstanceCount;
    WebKitMTLDrawIndexedPrimitivesIndirectArguments indirectArguments {
        .args = MTLDrawIndexedPrimitivesIndirectArguments {
            .indexCount = failedCondition ? 0u : indexCount,
            .instanceCount = failedCondition ? 0u : instanceCount,
            .indexStart = firstIndex,
            .baseVertex = baseVertex,
            .baseInstance = firstInstance
        },
        .lostOrOOBRead = 0u
    };

    id<MTLRenderCommandEncoder> renderCommandEncoder = encoder.renderCommandEncoder();
    auto [indexedIndirectBuffer, indexedIndirectBufferOffset] = device.getQueue()->newTemporaryBufferWithBytes(unsafeMakeSpan(typedCast<uint8_t>(indirectArguments), sizeof(indirectArguments)), false);
    CHECKED_SET_PSO(renderCommandEncoder, device.indexBufferClampPipeline(indexType, rasterSampleCount), DrawIndexResult { IndexCall::Skip, nil, 0 });
    encoder.setVertexBuffer(renderCommandEncoder, indexBuffer, indexBufferOffsetInBytes, 0);
    encoder.setVertexBuffer(renderCommandEncoder, indexedIndirectBuffer, indexedIndirectBufferOffset, 1);
    uint32_t data[] = {
        minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount ? minVertexCount - primitiveOffset : minVertexCount,
        primitiveOffset,
        indexCount - 1
    };
    encoder.setVertexBytes(renderCommandEncoder, asByteSpan(data), 2);
    [renderCommandEncoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:indexCount];

    encoder.emitMemoryBarrier(renderCommandEncoder);

    auto encoderHandle = device.getQueue()->retainCounterSampleBuffer(encoder.parentEncoder());
    [encoder.parentEncoder().commandBuffer() addCompletedHandler:[encoderHandle, protectedDevice = protect(device), firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, refIndexBuffer = protect(*apiIndexBuffer), indexedIndirectBuffer, indexedIndirectBufferOffset](id<MTLCommandBuffer> completedCommandBuffer) mutable {
        if (completedCommandBuffer.status != MTLCommandBufferStatusCompleted) {
            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
            return;
        }
        protectedDevice->getQueue()->scheduleWork([encoderHandle, protectedDevice, firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, refIndexBuffer = WTF::move(refIndexBuffer), indexedIndirectBuffer, indexedIndirectBufferOffset]() mutable {
            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
            if (!indexedIndirectBuffer.contents || indexedIndirectBuffer.length < sizeof(WebKitMTLDrawIndexedPrimitivesIndirectArguments) + indexedIndirectBufferOffset)
                return;

            auto* offsetContents = static_cast<uint8_t*>(indexedIndirectBuffer.contents) + indexedIndirectBufferOffset;
            auto& args = *static_cast<WebKitMTLDrawIndexedPrimitivesIndirectArguments*>(static_cast<void*>(offsetContents));
            refIndexBuffer->didReadOOB(args.lostOrOOBRead);
            refIndexBuffer->drawIndexedValidated(firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset);
        });
    }];

    return DrawIndexResult { IndexCall::IndirectDraw, indexedIndirectBuffer, indexedIndirectBufferOffset };
}

RenderPassEncoder::DrawIndexResult RenderPassEncoder::clampIndexBufferToValidValues(uint32_t indexCount, uint32_t instanceCount, int32_t baseVertex, uint32_t firstInstance, MTLIndexType indexType, NSUInteger indexBufferOffsetInBytes, bool& needsValidationLayerWorkaround)
{
    auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
    return clampIndexBufferToValidValues(indexCount, instanceCount, baseVertex, firstInstance, indexType, indexBufferOffsetInBytes, m_indexBuffer.get(), minVertexCount, minInstanceCount, *this, m_device.get(), m_rasterSampleCount, m_primitiveType);
}

static void checkForIndirectDrawDeviceLost(Device &device, RenderPassEncoder &encoder, id<MTLBuffer> indirectBuffer)
{
    auto encoderHandle = device.getQueue()->retainCounterSampleBuffer(encoder.parentEncoder());
    [encoder.parentEncoder().commandBuffer() addCompletedHandler:[encoderHandle, protectedDevice = protect(device), indirectBuffer](id<MTLCommandBuffer> completedCommandBuffer) {
        if (completedCommandBuffer.status != MTLCommandBufferStatusCompleted) {
            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
            return;
        }
        protectedDevice->getQueue()->scheduleWork([encoderHandle, indirectBuffer, protectedDevice]() mutable {
            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
            if (!indirectBuffer.contents || indirectBuffer.length != sizeof(WebKitMTLDrawPrimitivesIndirectArguments))
                return;

            auto& args = *static_cast<WebKitMTLDrawPrimitivesIndirectArguments*>(indirectBuffer.contents);
            if (args.lostOrOOBRead)
                protectedDevice->loseTheDevice(WGPUDeviceLostReason_Undefined);
        });
    }];
}

std::pair<id<MTLBuffer>, uint64_t> RenderPassEncoder::clampIndirectIndexBufferToValidValues(Buffer* apiIndexBuffer, Buffer& indexedIndirectBuffer, MTLIndexType indexType, NSUInteger indexBufferOffsetInBytes, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount, MTLPrimitiveType primitiveType, Device& device, uint32_t rasterSampleCount, RenderPassEncoder& encoder, bool& splitEncoder)
{
    if (minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount && minInstanceCount == RenderBundleEncoder::invalidVertexInstanceCount)
        return std::make_pair(indexedIndirectBuffer.buffer(), indirectOffset);

    id<MTLBuffer> indexBuffer = apiIndexBuffer ? apiIndexBuffer->buffer() : nil;
    if (!indexBuffer || apiIndexBuffer->isDestroyed() || indexedIndirectBuffer.isDestroyed())
        return std::make_pair(nil, 0ull);

    id<MTLBuffer> indirectBuffer = indexedIndirectBuffer.indirectBuffer();
    auto indexSize = indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t);
    auto checkedOffsetPlusSize = checkedSum<uint32_t>(indexBufferOffsetInBytes, indexSize);
    if (!indirectBuffer || !minVertexCount || !minInstanceCount || checkedOffsetPlusSize.hasOverflowed() || checkedOffsetPlusSize.value() >= indexBuffer.length)
        return std::make_pair(nil, 0ull);

    if (!indexedIndirectBuffer.indirectIndexedBufferRequiresRecomputation(indexType, indexBufferOffsetInBytes, indirectOffset, minVertexCount, minInstanceCount)) {
        indexedIndirectBuffer.skippedDrawIndirectIndexedValidation(encoder.parentEncoder(), apiIndexBuffer, indexType, indexBufferOffsetInBytes, indirectOffset, minVertexCount, minInstanceCount, primitiveType);
        return std::make_pair(indexedIndirectBuffer.indirectIndexedBuffer(), 0ull);
    }

    id<MTLRenderCommandEncoder> renderCommandEncoder = encoder.renderCommandEncoder();
    CHECKED_SET_PSO(renderCommandEncoder, device.indexedIndirectBufferClampPipeline(rasterSampleCount), std::make_pair(nil, 0ull));
    uint32_t indexBufferCount = static_cast<uint32_t>((indexBuffer.length - indexBufferOffsetInBytes) / indexSize);
    encoder.setVertexBuffer(renderCommandEncoder, indexedIndirectBuffer.buffer(), indirectOffset, 0);
    encoder.setVertexBuffer(renderCommandEncoder, indexedIndirectBuffer.indirectIndexedBuffer(), 0, 1);
    encoder.setVertexBuffer(renderCommandEncoder, indirectBuffer, 0, 2);
    uint32_t indirectData[] = { indexBufferCount, minInstanceCount };
    encoder.setVertexBytes(renderCommandEncoder, asByteSpan(indirectData), 3);
    [renderCommandEncoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:1];
    encoder.emitMemoryBarrier(renderCommandEncoder);

    if (encoder.splitRenderPass())
        renderCommandEncoder = encoder.renderCommandEncoder();
    CHECKED_SET_PSO(renderCommandEncoder, device.indexBufferClampPipeline(indexType, rasterSampleCount), std::make_pair(nil, 0ull));
    encoder.setVertexBuffer(renderCommandEncoder, indexBuffer, indexBufferOffsetInBytes, 0);
    encoder.setVertexBuffer(renderCommandEncoder, indexedIndirectBuffer.indirectIndexedBuffer(), 0, 1);
    auto primitiveOffset = primitiveType == MTLPrimitiveTypeLineStrip || primitiveType == MTLPrimitiveTypeTriangleStrip ? 1u : 0u;
    uint32_t data[] = { minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount ? minVertexCount - primitiveOffset : minVertexCount, primitiveOffset, indexBufferCount - 1 };
    encoder.setVertexBytes(renderCommandEncoder, asByteSpan(data), 2);
    [renderCommandEncoder drawPrimitives:MTLPrimitiveTypePoint indirectBuffer:indirectBuffer indirectBufferOffset:0];
    encoder.emitMemoryBarrier(renderCommandEncoder);

    splitEncoder = true;
    indexedIndirectBuffer.indirectIndexedBufferRecomputed(indexType, indexBufferOffsetInBytes, indirectOffset, minVertexCount, minInstanceCount);
    checkForIndirectDrawDeviceLost(device, encoder, indirectBuffer);

    return std::make_pair(indexedIndirectBuffer.indirectIndexedBuffer(), 0ull);
}

std::pair<id<MTLBuffer>, uint64_t> RenderPassEncoder::clampIndirectIndexBufferToValidValues(Buffer& indexedIndirectBuffer, MTLIndexType indexType, NSUInteger indexBufferOffsetInBytes, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount, bool& splitEncoder)
{
    return clampIndirectIndexBufferToValidValues(m_indexBuffer.get(), indexedIndirectBuffer, indexType, indexBufferOffsetInBytes, indirectOffset, minVertexCount, minInstanceCount, m_primitiveType, m_device.get(), m_rasterSampleCount, *this, splitEncoder);
}

std::pair<id<MTLBuffer>, uint64_t> RenderPassEncoder::clampIndirectBufferToValidValues(Buffer& indirectBuffer, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount, Device& device, uint32_t rasterSampleCount, RenderPassEncoder& encoder, bool& splitEncoder)
{
    if (!minVertexCount || !minInstanceCount || indirectBuffer.isDestroyed())
        return std::make_pair(nil, 0ull);

    if (minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount && minInstanceCount == RenderBundleEncoder::invalidVertexInstanceCount)
        return std::make_pair(indirectBuffer.buffer(), indirectOffset);

    if (!indirectBuffer.indirectBufferRequiresRecomputation(indirectOffset, minVertexCount, minInstanceCount)) {
        indirectBuffer.skippedDrawIndirectValidation(encoder.parentEncoder(), indirectOffset, minVertexCount, minInstanceCount);
        return std::make_pair(indirectBuffer.indirectBuffer(), 0ull);
    }

    id<MTLRenderCommandEncoder> renderCommandEncoder = encoder.renderCommandEncoder();
    id<MTLRenderPipelineState> renderPipelineState = device.indirectBufferClampPipeline(rasterSampleCount);
    CHECKED_SET_PSO(renderCommandEncoder, renderPipelineState, std::make_pair(nil, 0ull));
    encoder.setVertexBuffer(renderCommandEncoder, indirectBuffer.buffer(), indirectOffset, 0);
    encoder.setVertexBuffer(renderCommandEncoder, indirectBuffer.indirectBuffer(), 0, 1);
    uint32_t data[] = { minVertexCount, minInstanceCount };
    encoder.setVertexBytes(renderCommandEncoder, asByteSpan(data), 2);
    [renderCommandEncoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:1];
    encoder.emitMemoryBarrier(renderCommandEncoder);

    splitEncoder = true;
    indirectBuffer.indirectBufferRecomputed(indirectOffset, minVertexCount, minInstanceCount);
    checkForIndirectDrawDeviceLost(device, encoder, indirectBuffer.indirectBuffer());

    return std::make_pair(indirectBuffer.indirectBuffer(), 0ull);
}

std::pair<id<MTLBuffer>, uint64_t> RenderPassEncoder::clampIndirectBufferToValidValues(Buffer& indirectBuffer, uint64_t indirectOffset, uint32_t minVertexCount, uint32_t minInstanceCount, bool& splitEncoder)
{
    return clampIndirectBufferToValidValues(indirectBuffer, indirectOffset, minVertexCount, minInstanceCount, m_device.get(), m_rasterSampleCount, *this, splitEncoder);
}

static NSUInteger NODELETE verticesPerPrimitive(MTLPrimitiveType primitiveType)
{
    switch (primitiveType) {
    case MTLPrimitiveTypePoint:
        return 1;
    case MTLPrimitiveTypeLine:
    case MTLPrimitiveTypeLineStrip:
        return 2;
    case MTLPrimitiveTypeTriangle:
    case MTLPrimitiveTypeTriangleStrip:
        return 3;
    }
    RELEASE_ASSERT_NOT_REACHED("Unexpected primitive type value");
}

void RenderPassEncoder::drawIndexed(uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance)
{
    RETURN_IF_FINISHED();

    auto checkedVertexCount = checkedProduct<uint32_t>(indexCount, instanceCount);
    if (checkedVertexCount.hasOverflowed() || checkedVertexCount.value() > m_device->maxVerticesPerDrawCall()) {
        protect(m_device)->loseTheDevice(WGPUDeviceLostReason_Undefined);
        return;
    }

    auto indexSizeInBytes = (m_indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t));
    auto firstIndexOffsetInBytes = checkedProduct<size_t>(firstIndex, indexSizeInBytes);
    auto indexBufferOffsetInBytes = checkedSum<size_t>(m_indexBufferOffset, firstIndexOffsetInBytes);
    if (firstIndexOffsetInBytes.hasOverflowed() || indexBufferOffsetInBytes.hasOverflowed()) {
        makeInvalid(@"Invalid offset to drawIndexed");
        return;
    }

    if (NSString* error = errorValidatingDrawIndexed()) {
        makeInvalid(error);
        return;
    }

    auto indexCountInBytes = checkedProduct<size_t>(indexSizeInBytes, indexCount);
    auto lastIndexOffset = checkedSum<size_t>(firstIndexOffsetInBytes, indexCountInBytes);
    if (indexCountInBytes.hasOverflowed() || lastIndexOffset.hasOverflowed() ||  lastIndexOffset.value() > m_indexBufferSize) {
        makeInvalid(@"Values to drawIndexed are invalid");
        return;
    }

    if (!runIndexBufferValidation(firstInstance, instanceCount))
        return;

    bool needsValidationLayerWorkaround;
    auto result = clampIndexBufferToValidValues(indexCount, instanceCount, baseVertex, firstInstance, m_indexType, indexBufferOffsetInBytes, needsValidationLayerWorkaround);
    auto useIndirectCall = result.result;
    auto indirectBuffer = result.buffer;
    auto indirectBufferOffset = result.offset;
    bool passWasSplit = useIndirectCall == IndexCall::IndirectDraw;
    if (passWasSplit)
        passWasSplit = splitRenderPass();

    if (!executePreDrawCommands(0, 0, passWasSplit, nullptr, needsValidationLayerWorkaround))
        return;

    if (!instanceCount || !indexCount || m_indexBuffer->isDestroyed())
        return;

    id<MTLBuffer> indexBuffer = m_indexBuffer.get() ? m_indexBuffer->buffer() : nil;
    if (useIndirectCall == IndexCall::IndirectDraw || useIndirectCall == IndexCall::CachedIndirectDraw) {
        if (indexBuffer.length / indexSizeInBytes < verticesPerPrimitive(m_primitiveType))
            return;
        [renderCommandEncoder() drawIndexedPrimitives:m_primitiveType indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:0 indirectBuffer:indirectBuffer indirectBufferOffset:indirectBufferOffset];
    } else if (useIndirectCall == IndexCall::Draw)
        [renderCommandEncoder() drawIndexedPrimitives:m_primitiveType indexCount:indexCount indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:indexBufferOffsetInBytes instanceCount:instanceCount baseVertex:baseVertex baseInstance:firstInstance];
}

void RenderPassEncoder::drawIndexedIndirect(Buffer& indirectBuffer, uint64_t indirectOffset)
{
    RETURN_IF_FINISHED();
    if (!isValidToUseWith(indirectBuffer, *this)) {
        makeInvalid(@"drawIndexedIndirect: buffer was invalid");
        return;
    }
    indirectBuffer.setCommandEncoder(m_parentEncoder);
    if (indirectBuffer.isDestroyed())
        return;

    if (!m_indexBuffer) {
        makeInvalid(@"drawIndexedIndirect: index buffer is nil");
        return;
    }

    id<MTLBuffer> indexBuffer = m_indexBuffer->buffer();
    if (!indexBuffer.length)
        return;

    if (!(indirectBuffer.usage() & WGPUBufferUsage_Indirect) || (indirectOffset % 4)) {
        makeInvalid(@"drawIndexedIndirect: validation failed");
        return;
    }

    auto checkedIndirectOffset = checkedSum<uint64_t>(indirectOffset, sizeof(MTLDrawIndexedPrimitivesIndirectArguments));
    if (checkedIndirectOffset.hasOverflowed() || indirectBuffer.initialSize() < checkedIndirectOffset) {
        makeInvalid(@"drawIndexedIndirect: validation failed");
        return;
    }

    bool needsValidationLayerWorkaround;
    auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
    bool splitEncoder = false;
    auto result = clampIndirectIndexBufferToValidValues(indirectBuffer, m_indexType, m_indexBufferOffset, indirectOffset, minVertexCount, minInstanceCount, splitEncoder);
    id<MTLBuffer> mtlIndirectBuffer = result.first;
    uint64_t modifiedIndirectOffset = result.second;
    if (splitEncoder)
        splitEncoder = splitRenderPass();

    if (!executePreDrawCommands(0, 0, splitEncoder, &indirectBuffer, needsValidationLayerWorkaround) || m_indexBuffer->isDestroyed() || mtlIndirectBuffer.length < sizeof(MTLDrawIndexedPrimitivesIndirectArguments))
        return;

    uint32_t indexSizeInBytes = m_indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t);
    if (m_indexBufferOffset > indexBuffer.length || (indexBuffer.length - m_indexBufferOffset) / indexSizeInBytes < verticesPerPrimitive(m_primitiveType))
        return;
    [renderCommandEncoder() drawIndexedPrimitives:m_primitiveType indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:m_indexBufferOffset indirectBuffer:mtlIndirectBuffer indirectBufferOffset:modifiedIndirectOffset];
}

bool RenderPassEncoder::splitRenderPass()
{
    if (m_memoryBarrierCount < m_device->baseCapabilities().memoryBarrierLimit || !m_renderCommandEncoder)
        return false;

    m_memoryBarrierCount = 0;
#ifndef NDEBUG
#if CPU(ARM64)
    WTFLogAlways("WebGPU: Splitting render pass on ARM64 - severe performance penalty"); // NOLINT
#endif
#endif
    m_parentEncoder->endEncoding(m_renderCommandEncoder);
    if (issuedDrawCall()) {
        for (size_t i = 0; i < m_descriptorColorAttachments.size(); ++i)
            m_metalDescriptor.colorAttachments[i].loadAction = MTLLoadActionLoad;

        m_metalDescriptor.depthAttachment.loadAction = MTLLoadActionLoad;
        m_metalDescriptor.stencilAttachment.loadAction = MTLLoadActionLoad;
    }
    m_priorVertexDynamicOffsets.clear();
    m_priorFragmentDynamicOffsets.clear();

    m_renderCommandEncoder = [m_parentEncoder->commandBuffer() renderCommandEncoderWithDescriptor:m_metalDescriptor];
    m_parentEncoder->setExistingEncoder(m_renderCommandEncoder);
    if (m_viewport)
        [m_renderCommandEncoder setViewport:*m_viewport];
    if (m_blendColor)
        [m_renderCommandEncoder setBlendColorRed:m_blendColor->r green:m_blendColor->g blue:m_blendColor->b alpha:m_blendColor->a];
    if (m_stencilReferenceValue)
        [m_renderCommandEncoder setStencilReferenceValue:*m_stencilReferenceValue];
    if (m_scissorRect)
        [m_renderCommandEncoder setScissorRect:*m_scissorRect];
    if (RefPtr pipeline = m_pipeline) {
        m_pipeline = nullptr;
        setPipeline(*pipeline);
    }
    m_existingVertexBuffers.fill(ExistingBufferKey { });
    m_existingFragmentBuffers.fill(ExistingBufferKey { });
    m_bindGroupDynamicOffsetsChanged.fill(true);
    m_maxDynamicOffsetAtIndex.fill(0);

    return true;
}

void RenderPassEncoder::drawIndirect(Buffer& indirectBuffer, uint64_t indirectOffset)
{
    RETURN_IF_FINISHED();
    if (!isValidToUseWith(indirectBuffer, *this)) {
        makeInvalid(@"drawIndirect: buffer was invalid");
        return;
    }
    indirectBuffer.setCommandEncoder(m_parentEncoder);
    if (indirectBuffer.isDestroyed())
        return;
    if (!(indirectBuffer.usage() & WGPUBufferUsage_Indirect) || (indirectOffset % 4)) {
        makeInvalid(@"drawIndirect: validation failed");
        return;
    }

    auto checkedIndirectOffset = checkedSum<uint64_t>(indirectOffset, sizeof(MTLDrawPrimitivesIndirectArguments));
    if (checkedIndirectOffset.hasOverflowed() || indirectBuffer.initialSize() < checkedIndirectOffset) {
        makeInvalid(@"drawIndirect: validation failed");
        return;
    }

    bool needsValidationLayerWorkaround;
    auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
    bool splitEncoder = false;
    auto [mtlIndirectBuffer, adjustedIndirectBufferOffset] = clampIndirectBufferToValidValues(indirectBuffer, indirectOffset, minVertexCount, minInstanceCount, splitEncoder);
    if (splitEncoder)
        splitEncoder = splitRenderPass();

    if (!executePreDrawCommands(0, 0, splitEncoder, &indirectBuffer, needsValidationLayerWorkaround) || mtlIndirectBuffer.length < sizeof(MTLDrawPrimitivesIndirectArguments) || indirectBuffer.isDestroyed())
        return;

    [renderCommandEncoder() drawPrimitives:m_primitiveType indirectBuffer:mtlIndirectBuffer indirectBufferOffset:adjustedIndirectBufferOffset];
}

void RenderPassEncoder::endPass()
{
    if (m_passEnded) {
        protect(m_device)->generateAValidationError([NSString stringWithFormat:@"%s: failed as pass is already ended", __PRETTY_FUNCTION__]);
        return;
    }
    m_passEnded = true;

    RETURN_IF_FINISHED();

    auto passIsValid = isValid();
    if (m_debugGroupStackSize || m_occlusionQueryActive || !passIsValid) {
        m_parentEncoder->endEncoding(m_renderCommandEncoder);
        m_renderCommandEncoder = nil;
        m_parentEncoder->makeInvalid([NSString stringWithFormat:@"RenderPassEncoder.endPass failure, m_debugGroupStackSize = %llu, m_occlusionQueryActive = %d, isValid = %d, error = %@", m_debugGroupStackSize, m_occlusionQueryActive, passIsValid, m_lastErrorString]);
        return;
    }

    auto endEncoder = ^{
        m_parentEncoder->endEncoding(m_renderCommandEncoder);
    };
    bool hasTexturesToClear = m_attachmentsToClear.count || (m_depthStencilAttachmentToClear && (m_clearDepthAttachment || m_clearStencilAttachment));

    if (hasTexturesToClear) {
        endEncoder();
        m_parentEncoder->runClearEncoder(m_attachmentsToClear, m_depthStencilAttachmentToClear, m_clearDepthAttachment, m_clearStencilAttachment, m_depthClearValue, m_stencilClearValue, nil);
    } else
        endEncoder();

    m_renderCommandEncoder = nil;
    m_parentEncoder->lock(false);

    if (m_queryBufferIndicesToClear.size() && !occlusionQueryIsDestroyed()) {
        id<MTLBlitCommandEncoder> blitCommandEncoder = m_parentEncoder->ensureBlitCommandEncoder();
        for (auto& offset : m_queryBufferIndicesToClear)
            [blitCommandEncoder fillBuffer:m_visibilityResultBuffer range:NSMakeRange(static_cast<NSUInteger>(offset), sizeof(uint64_t)) value:0];

        m_queryBufferIndicesToClear.clear();
        m_parentEncoder->finalizeBlitCommandEncoder();
    }
}

bool RenderPassEncoder::setCommandEncoder(const BindGroupEntryUsageData::Resource& resource)
{
    WTF::switchOn(resource, [&](const RefPtr<Buffer>& buffer) {
        if (buffer)
            buffer->setCommandEncoder(m_parentEncoder);
        }, [&](const RefPtr<const Texture>& texture) {
            if (texture)
                texture->setCommandEncoder(m_parentEncoder);
        }, [&](const RefPtr<const TextureView>& textureView) {
            if (textureView)
                textureView->setCommandEncoder(m_parentEncoder);
        }, [&](const RefPtr<const ExternalTexture>& externalTexture) {
            if (externalTexture)
                externalTexture->setCommandEncoder(m_parentEncoder);
    });
    return !!renderCommandEncoder();
}

void RenderPassEncoder::executeBundles(Vector<Ref<RenderBundle>>&& bundles)
{
    RETURN_IF_FINISHED();
    m_queryBufferIndicesToClear.remove(m_visibilityResultBufferOffset);
    id<MTLRenderCommandEncoder> commandEncoder = renderCommandEncoder();
    setCachedRenderPassState(commandEncoder);
    float minDepth = m_viewport ? m_viewport->znear : 0.f;
    float maxDepth = m_viewport ? m_viewport->zfar : 1.f;

    for (auto bundle : bundles) {
        if (!isValidToUseWith(bundle, *this)) {
            makeInvalid([NSString stringWithFormat:@"executeBundles: render bundle is not valid, reason = %@", bundle->lastError()]);
            return;
        }

        if (bundle->makeSubmitInvalid()) {
            m_parentEncoder->makeSubmitInvalid();
            return;
        }

        bundle->updateMinMaxDepths(minDepth, maxDepth);

        if (!bundle->validateRenderPass(m_depthReadOnly, m_stencilReadOnly, m_descriptor, m_colorAttachmentViews, m_depthStencilView) || !bundle->validatePipeline(m_pipeline.get())) {
            makeInvalid(@"executeBundles: validation failed");
            return;
        }

        commandEncoder = renderCommandEncoder();
        m_parentEncoder->addOnCommitHandler([bundle](CommandBuffer&, CommandEncoder&) {
            return bundle->rebindSamplersIfNeeded();
        });
        if (!bundle->requiresCommandReplay()) {
            bool splitPass = false;
            for (RenderBundleICBWithResources* icb in bundle->renderBundlesResources()) {
                auto& hashMap = *icb.minVertexCountForDrawCommand;
                for (auto& [commandIndex, data] : hashMap) {
                    RefPtr indexBuffer = data.indexBuffer.get();
                    auto firstIndex = data.indexData.firstIndex;
                    auto indexCount = data.indexData.indexCount;
                    auto minVertexCount = data.indexData.minVertexCount;
                    auto indexType = data.indexType;
                    auto baseVertex = data.indexData.baseVertex;
                    auto primitiveOffset = data.indexData.primitiveType == MTLPrimitiveTypeLineStrip || data.indexData.primitiveType == MTLPrimitiveTypeTriangleStrip ? 1u : 0u;
                    if (!indexBuffer)
                        continue;
                    auto effectiveMinVertexCount = minVertexCount == RenderBundleEncoder::invalidVertexInstanceCount ? minVertexCount : (minVertexCount - baseVertex);
                    if (auto it = indexBuffer->canSkipDrawIndexedValidation(firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, icb.indirectCommandBuffer); it && !indexBuffer->didReadOOB(icb.indirectCommandBuffer)) {
                        indexBuffer->skippedDrawIndexedValidation(m_parentEncoder, *it);
                        continue;
                    }

                    id<MTLRenderPipelineState> renderPipelineState = protect(m_device)->icbCommandClampPipeline(data.indexType, m_rasterSampleCount);
                    id<MTLBuffer> indirectCommandBufferContainer = icb.indirectCommandBufferContainer;
                    CHECKED_SET_PSO(commandEncoder, renderPipelineState);
                    setVertexBytes(commandEncoder, asByteSpan(data.indexData), 0);
                    m_parentEncoder->addBuffer(indirectCommandBufferContainer);
                    setVertexBuffer(commandEncoder, indirectCommandBufferContainer, 0, 1);
                    m_parentEncoder->addBuffer(indexBuffer->buffer());
                    [commandEncoder useResource:indexBuffer->buffer() usage:MTLResourceUsageRead stages:MTLRenderStageVertex];
                    m_parentEncoder->addICB(icb.indirectCommandBuffer);
                    [commandEncoder useResource:icb.indirectCommandBuffer usage:MTLResourceUsageRead | MTLResourceUsageWrite stages:MTLRenderStageVertex];
                    m_parentEncoder->addBuffer(icb.outOfBoundsReadFlag);
                    [commandEncoder useResource:icb.outOfBoundsReadFlag usage:MTLResourceUsageWrite stages:MTLRenderStageVertex];
                    [commandEncoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:data.indexData.indexCount];

                    auto encoderHandle = m_device->getQueue()->retainCounterSampleBuffer(m_parentEncoder);
                    [m_parentEncoder->commandBuffer() addCompletedHandler:[encoderHandle, protectedDevice = protect(m_device), firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, refIndexBuffer = protect(*indexBuffer), icb](id<MTLCommandBuffer> completedCommandBuffer) mutable {
                        if (completedCommandBuffer.status != MTLCommandBufferStatusCompleted) {
                            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
                            return;
                        }

                        protectedDevice->getQueue()->scheduleWork([encoderHandle, protectedDevice, icb, firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, refIndexBuffer = WTF::move(refIndexBuffer)]() mutable {
                            protectedDevice->getQueue()->releaseCounterSampleBuffer(encoderHandle);
                            id<MTLBuffer> outOfBoundsReadFlag = icb.outOfBoundsReadFlag;
                            refIndexBuffer->didReadOOB(*static_cast<uint32_t*>(outOfBoundsReadFlag.contents), icb.indirectCommandBuffer);
                            refIndexBuffer->drawIndexedValidated(firstIndex, indexCount, effectiveMinVertexCount, indexType, primitiveOffset, icb.indirectCommandBuffer);
                        });
                    }];
                    splitPass = true;
                }
            }
            if (splitPass) {
                emitMemoryBarrier(commandEncoder);
                splitPass = splitRenderPass();
                commandEncoder = renderCommandEncoder();
            }
        }

        incrementDrawCount(bundle->drawCount());

        for (const auto& resource : bundle->resources()) {
            if ((resource.renderStages & (MTLRenderStageVertex | MTLRenderStageFragment)) && resource.mtlResources.size())
                [renderCommandEncoder() useResources:&resource.mtlResources[0] count:resource.mtlResources.size() usage:resource.usage stages:resource.renderStages];

            ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
            for (size_t i = 0, resourceCount = resource.mtlResources.size(); i < resourceCount; ++i) {
                auto& resourceUsage = resource.resourceUsages[i];
                addResourceToActiveResources(resourceUsage.resource, resourceUsage.usage);
                setCommandEncoder(resourceUsage.resource);
            }
        }

        for (RenderBundleICBWithResources* icb in bundle->renderBundlesResources()) {
            commandEncoder = renderCommandEncoder();

            if (id<MTLDepthStencilState> depthStencilState = icb.depthStencilState)
                [commandEncoder setDepthStencilState:depthStencilState];
            [commandEncoder setCullMode:icb.cullMode];
            [commandEncoder setFrontFacingWinding:icb.frontFace];
            if (m_overrideDepthClipMode != MTLDepthClipModeClip)
                [commandEncoder setDepthClipMode:m_overrideDepthClipMode];
            else
                [commandEncoder setDepthClipMode:icb.depthClipMode];
            [commandEncoder setDepthBias:icb.depthBias slopeScale:icb.depthBiasSlopeScale clamp:icb.depthBiasClamp];

            id<MTLIndirectCommandBuffer> indirectCommandBuffer = icb.indirectCommandBuffer;
            [renderCommandEncoder() executeCommandsInBuffer:indirectCommandBuffer withRange:NSMakeRange(0, indirectCommandBuffer.size)];
        }

        m_ignoreBufferCache = true;
        bundle->replayCommands(*this);
        m_ignoreBufferCache = false;
    }

    m_vertexBuffers.fill(BufferAndOffset { });
    m_bindGroups.clear();
    m_bindGroupDynamicOffsets.clear();
    m_bindGroupDynamicOffsetsChanged.fill(true);
    m_pipeline = nullptr;
    m_vertexDynamicOffsets.clear();
    m_priorVertexDynamicOffsets.clear();
    m_fragmentDynamicOffsets.clear();
    m_priorFragmentDynamicOffsets.clear();
    m_indexBuffer = nullptr;
    m_maxVertexBufferSlot = 0;
    m_maxBindGroupSlot = 0;
    m_existingVertexBuffers.fill(ExistingBufferKey { });
    m_existingFragmentBuffers.fill(ExistingBufferKey { });
    m_maxDynamicOffsetAtIndex.fill(0);
}

NSString* RenderPassEncoder::errorValidatingColorDepthStencilTargets(const RenderPipeline& pipeline) const
{
    return pipeline.errorValidatingColorDepthStencilTargets(m_descriptor, m_colorAttachmentViews, m_depthStencilView);
}

id<MTLRenderCommandEncoder> RenderPassEncoder::renderCommandEncoder() const
{
    return m_parentEncoder->submitWillBeInvalid() ? nil : m_renderCommandEncoder;
}

void RenderPassEncoder::insertDebugMarker(String&& markerLabel)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-insertdebugmarker
    if (!prepareTheEncoderState())
        return;

    [m_renderCommandEncoder insertDebugSignpost:markerLabel.createNSString().get()];
}

bool RenderPassEncoder::validatePopDebugGroup() const
{
    if (!m_parentEncoder->isLocked())
        return false;

    if (!m_debugGroupStackSize)
        return false;

    return true;
}

void RenderPassEncoder::makeInvalid(NSString* errorString)
{
    m_lastErrorString = errorString;

    Ref parentEncoder = m_parentEncoder;

    if (!m_renderCommandEncoder) {
        parentEncoder->makeInvalid([NSString stringWithFormat:@"RenderPassEncoder.makeInvalid, rason = %@", errorString]);
        return;
    }

    parentEncoder->setLastError(errorString);
    parentEncoder->endEncoding(m_renderCommandEncoder);
    m_renderCommandEncoder = nil;
}

void RenderPassEncoder::popDebugGroup()
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-popdebuggroup

    if (!prepareTheEncoderState())
        return;

    if (!validatePopDebugGroup()) {
        makeInvalid(@"popDebugGroup: validation failed");
        return;
    }

    --m_debugGroupStackSize;
    [m_renderCommandEncoder popDebugGroup];
}

void RenderPassEncoder::pushDebugGroup(String&& groupLabel)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-pushdebuggroup

    if (!prepareTheEncoderState())
        return;

    ++m_debugGroupStackSize;
    [m_renderCommandEncoder pushDebugGroup:groupLabel.createNSString().get()];
}

void RenderPassEncoder::setBindGroup(uint32_t groupIndex, const BindGroup* groupPtr, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    RETURN_IF_FINISHED();

    auto dynamicOffsetCount = (groupPtr && groupPtr->bindGroupLayout()) ? groupPtr->bindGroupLayout()->dynamicBufferCount() : 0;
    if (groupIndex >= m_device->limits().maxBindGroups || (dynamicOffsets && dynamicOffsetCount != dynamicOffsets->size())) {
        makeInvalid(@"setBindGroup: groupIndex >= limits.maxBindGroups");
        return;
    }

    if (!groupPtr) {
        m_bindGroups.remove(groupIndex);
        m_bindGroupDynamicOffsets.remove(groupIndex);
        m_bindGroupDynamicOffsetsChanged[groupIndex] = true;
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;
        return;
    }

    auto& group = *groupPtr;
    if (!isValidToUseWith(group, *this)) {
        makeInvalid(@"setBindGroup: invalid bind group");
        return;
    }

    RefPtr bindGroupLayout = group.bindGroupLayout();
    if (!bindGroupLayout) {
        makeInvalid(@"GPURenderPassEncoder.setBindGroup: bind group is nil");
        return;
    }
    if (NSString* error = bindGroupLayout->errorValidatingDynamicOffsets(dynamicOffsets ? dynamicOffsets->span() : std::span<const uint32_t> { }, group, m_maxDynamicOffsetAtIndex[groupIndex])) {
        makeInvalid([NSString stringWithFormat:@"GPURenderPassEncoder.setBindGroup: %@", error]);
        return;
    }

    m_maxBindGroupSlot = std::max(groupIndex, m_maxBindGroupSlot);
    if (dynamicOffsets && dynamicOffsets->size()) {
        m_bindGroupDynamicOffsets.set(groupIndex, WTF::move(*dynamicOffsets));
        m_bindGroupDynamicOffsetsChanged[groupIndex] = true;
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;
    } else if (m_bindGroupDynamicOffsets.remove(groupIndex)) {
        m_bindGroupDynamicOffsetsChanged[groupIndex] = true;
        m_maxDynamicOffsetAtIndex[groupIndex] = 0;
    }

    auto parentEncoder = m_parentEncoder;
    for (const auto& resource : group.resources()) {
        if ((resource.renderStages & (MTLRenderStageVertex | MTLRenderStageFragment)) && resource.mtlResources.size())
            [renderCommandEncoder() useResources:&resource.mtlResources[0] count:resource.mtlResources.size() usage:resource.usage stages:resource.renderStages];

        ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
        for (size_t i = 0, sz = resource.mtlResources.size(); i < sz; ++i) {
            auto& resourceUsage = resource.resourceUsages[i];
            addResourceToActiveResources(resourceUsage.resource, resourceUsage.usage);
            setCommandEncoder(resourceUsage.resource);
        }

        for (auto& [samplerPtr, _] : group.samplers()) {
            if (RefPtr sampler = samplerPtr.get())
                parentEncoder->addSampler(*sampler);
        }
    }

    m_bindGroups.set(groupIndex, group);
}

void RenderPassEncoder::setBlendConstant(const WGPUColor& color)
{
    RETURN_IF_FINISHED();

    m_blendColor = color;
}

void RenderPassEncoder::setIndexBuffer(Buffer& buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size)
{
    RETURN_IF_FINISHED();
    if (!isValidToUseWith(buffer, *this)) {
        makeInvalid(@"setIndexBuffer: invalid buffer");
        return;
    }

    buffer.setCommandEncoder(m_parentEncoder);
    if (buffer.isDestroyed())
        return;

    auto indexSizeInBytes = (format == WGPUIndexFormat_Uint16 ? sizeof(uint16_t) : sizeof(uint32_t));
    if (!(buffer.usage() & WGPUBufferUsage_Index) || (offset % indexSizeInBytes)) {
        makeInvalid(@"setIndexBuffer: validation failed");
        return;
    }

    if (computedSizeOverflows(buffer, offset, size)) {
        makeInvalid(@"setIndexBuffer: computed size overflows");
        return;
    }

    m_indexBuffer = buffer;
    m_indexBufferSize = size == WGPU_WHOLE_SIZE ? buffer.initialSize() : size;
    m_indexType = format == WGPUIndexFormat_Uint32 ? MTLIndexTypeUInt32 : MTLIndexTypeUInt16;
    m_indexBufferOffset = offset;
    addResourceToActiveResources(&buffer, BindGroupEntryUsage::Input);
}

NSString* RenderPassEncoder::errorValidatingPipeline(const RenderPipeline& pipeline) const
{
    if (!isValidToUseWith(pipeline, *this))
        return @"setPipeline: invalid RenderPipeline";

    if (!pipeline.validateDepthStencilState(m_depthReadOnly, m_stencilReadOnly))
        return @"setPipeline: invalid depth stencil state";

    if (NSString* error = errorValidatingColorDepthStencilTargets(pipeline))
        return [NSString stringWithFormat:@"setPipeline: color and depth targets from pass do not match pipeline - %@", error];

    if (sumOverflows<uint64_t>(pipeline.pipelineLayout().sizeOfFragmentDynamicOffsets(), RenderBundleEncoder::startIndexForFragmentDynamicOffsets))
        return @"setPipeline: invalid size of fragmentDynamicOffsets";

    return nil;
}

void RenderPassEncoder::setPipeline(const RenderPipeline& pipeline)
{
    RETURN_IF_FINISHED();

    if (NSString *error = errorValidatingPipeline(pipeline)) {
        makeInvalid(error);
        return;
    }

    if (m_pipeline.get() == &pipeline)
        return;

    m_primitiveType = pipeline.primitiveType();
    m_pipeline = pipeline;
    m_bindGroupDynamicOffsetsChanged.fill(true);
    m_maxDynamicOffsetAtIndex.fill(0);

    m_vertexDynamicOffsets.fill(0, pipeline.pipelineLayout().sizeOfVertexDynamicOffsets());
    m_fragmentDynamicOffsets.fill(0, pipeline.pipelineLayout().sizeOfFragmentDynamicOffsets() + RenderBundleEncoder::startIndexForFragmentDynamicOffsets);

    if (m_fragmentDynamicOffsets.size() < RenderBundleEncoder::startIndexForFragmentDynamicOffsets)
        m_fragmentDynamicOffsets.grow(RenderBundleEncoder::startIndexForFragmentDynamicOffsets);
    static_assert(RenderBundleEncoder::startIndexForFragmentDynamicOffsets > 2, "code path assumes value is greater than 2");
    m_fragmentDynamicOffsets[2] = pipeline.sampleMask();
}

void RenderPassEncoder::setScissorRect(uint32_t x, uint32_t y, uint32_t width, uint32_t height)
{
    RETURN_IF_FINISHED();

    if (sumOverflows<uint32_t>(x, width) || x + width > m_renderTargetWidth || sumOverflows<uint32_t>(y, height) || y + height > m_renderTargetHeight) {
        makeInvalid();
        return;
    }

    if (id<MTLRasterizationRateMap> map = m_rasterizationRateMap) {
        MTLSize physSize = [map physicalSizeForLayer:0];
        MTLCoordinate2D scissorStart = [map mapPhysicalToScreenCoordinates:MTLCoordinate2DMake(x, y) forLayer:0];
        MTLCoordinate2D scissorEnd = [map mapPhysicalToScreenCoordinates:MTLCoordinate2DMake(std::min<float>(physSize.width, x + width), std::min<float>(physSize.height, y + height)) forLayer:0];
        MTLSize screenSize = [map screenSize];
        m_scissorRect = MTLScissorRect {
            static_cast<NSUInteger>(roundf(scissorStart.x)),
            static_cast<NSUInteger>(roundf(scissorStart.y)),
            std::min(screenSize.width, static_cast<NSUInteger>(roundf(scissorEnd.x - scissorStart.x))),
            std::min(screenSize.height, static_cast<NSUInteger>(roundf(scissorEnd.y - scissorStart.y))),
        };

        return;
    }

    m_scissorRect = MTLScissorRect { x, y, width, height };
}

void RenderPassEncoder::setStencilReference(uint32_t reference)
{
    RETURN_IF_FINISHED();
    m_stencilReferenceValue = reference & 0xFF;
}

void RenderPassEncoder::setVertexBuffer(uint32_t slot, const Buffer* optionalBuffer, uint64_t offset, uint64_t size)
{
    RETURN_IF_FINISHED()
    if (!optionalBuffer) {
        if (slot <= m_device->limits().maxBindGroupsPlusVertexBuffers)
            m_vertexBuffers[slot] = { };

        return;
    }

    auto& buffer = *optionalBuffer;
    buffer.setCommandEncoder(m_parentEncoder);
    if (!isValidToUseWith(buffer, *this)) {
        makeInvalid(@"setVertexBuffer: invalid buffer");
        return;
    }

    if (buffer.isDestroyed())
        return;

    if (computedSizeOverflows(buffer, offset, size)) {
        makeInvalid(@"setVertexBuffer: size overflowed");
        return;
    }

    if (slot >= m_device->limits().maxVertexBuffers || !(buffer.usage() & WGPUBufferUsage_Vertex) || (offset % 4)) {
        makeInvalid(@"setVertexBuffer: validation failed");
        return;
    }

    m_maxVertexBufferSlot = std::max(slot, m_maxVertexBufferSlot);
    id<MTLBuffer> mtlBuffer = buffer.buffer();
    auto bufferLength = mtlBuffer.length;
    if (size == WGPU_WHOLE_SIZE)
        size = buffer.initialSize();
    m_vertexBuffers[slot] = BufferAndOffset { .buffer = mtlBuffer, .offset = offset, .size = size };
    if (offset == bufferLength && !size)
        return;
    if (offset >= bufferLength) {
        makeInvalid(@"setVertexBuffer: buffer length is invalid");
        return;
    }
    addResourceToActiveResources(&buffer, BindGroupEntryUsage::Input);
}

void RenderPassEncoder::setViewport(float x, float y, float width, float height, float minDepth, float maxDepth)
{
    RETURN_IF_FINISHED();
    MTLCoordinate2D renderTargetSize = MTLCoordinate2DMake(m_renderTargetWidth, m_renderTargetHeight);
    if (m_rasterizationRateMap)
        renderTargetSize = [m_rasterizationRateMap mapPhysicalToScreenCoordinates:renderTargetSize forLayer:0];

    if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > ceilf(renderTargetSize.x) || y + height > ceilf(renderTargetSize.y) || minDepth < 0 || maxDepth > 1 || minDepth > maxDepth) {
        makeInvalid();
        return;
    }
    m_viewport = MTLViewport {
        .originX = x,
        .originY = y,
        .width = width,
        .height = height,
        .znear = minDepth,
        .zfar = maxDepth
    };
}

void RenderPassEncoder::setLabel(String&& label)
{
    m_renderCommandEncoder.label = label.createNSString().get();
}

#undef CHECKED_SET_PSO
#undef RETURN_IF_FINISHED

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuRenderPassEncoderReference(WGPURenderPassEncoder renderPassEncoder)
{
    WebGPU::fromAPI(renderPassEncoder).ref();
}

void wgpuRenderPassEncoderRelease(WGPURenderPassEncoder renderPassEncoder)
{
    WebGPU::fromAPI(renderPassEncoder).deref();
}

void wgpuRenderPassEncoderBeginOcclusionQuery(WGPURenderPassEncoder renderPassEncoder, uint32_t queryIndex)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->beginOcclusionQuery(queryIndex);
}

void wgpuRenderPassEncoderDraw(WGPURenderPassEncoder renderPassEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->draw(vertexCount, instanceCount, firstVertex, firstInstance);
}

void wgpuRenderPassEncoderDrawIndexed(WGPURenderPassEncoder renderPassEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
}

void wgpuRenderPassEncoderDrawIndexedIndirect(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->drawIndexedIndirect(protect(WebGPU::fromAPI(indirectBuffer)), indirectOffset);
}

void wgpuRenderPassEncoderDrawIndirect(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->drawIndirect(protect(WebGPU::fromAPI(indirectBuffer)), indirectOffset);
}

void wgpuRenderPassEncoderEndOcclusionQuery(WGPURenderPassEncoder renderPassEncoder)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->endOcclusionQuery();
}

void wgpuRenderPassEncoderEnd(WGPURenderPassEncoder renderPassEncoder)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->endPass();
}

void wgpuRenderPassEncoderExecuteBundles(WGPURenderPassEncoder renderPassEncoder, size_t bundlesCount, const WGPURenderBundle* bundles)
{
    Vector<Ref<WebGPU::RenderBundle>> bundlesToForward;
    for (auto& bundle : unsafeMakeSpan(bundles, bundlesCount))
        bundlesToForward.append(protect(WebGPU::fromAPI(bundle)));
    protect(WebGPU::fromAPI(renderPassEncoder))->executeBundles(WTF::move(bundlesToForward));
}

void wgpuRenderPassEncoderInsertDebugMarker(WGPURenderPassEncoder renderPassEncoder, const char* markerLabel)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->insertDebugMarker(WebGPU::fromAPI(markerLabel));
}

void wgpuRenderPassEncoderPopDebugGroup(WGPURenderPassEncoder renderPassEncoder)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->popDebugGroup();
}

void wgpuRenderPassEncoderPushDebugGroup(WGPURenderPassEncoder renderPassEncoder, const char* groupLabel)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->pushDebugGroup(WebGPU::fromAPI(groupLabel));
}

void wgpuRenderPassEncoderSetBindGroup(WGPURenderPassEncoder renderPassEncoder, uint32_t groupIndex, WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setBindGroup(groupIndex, group ? protect(WebGPU::fromAPI(group)).ptr() : nullptr, WTF::move(dynamicOffsets));
}

void wgpuRenderPassEncoderSetBlendConstant(WGPURenderPassEncoder renderPassEncoder, const WGPUColor* color)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setBlendConstant(*color);
}

void wgpuRenderPassEncoderSetIndexBuffer(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setIndexBuffer(protect(WebGPU::fromAPI(buffer)), format, offset, size);
}

void wgpuRenderPassEncoderSetPipeline(WGPURenderPassEncoder renderPassEncoder, WGPURenderPipeline pipeline)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setPipeline(protect(WebGPU::fromAPI(pipeline)));
}

void wgpuRenderPassEncoderSetScissorRect(WGPURenderPassEncoder renderPassEncoder, uint32_t x, uint32_t y, uint32_t width, uint32_t height)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setScissorRect(x, y, width, height);
}

void wgpuRenderPassEncoderSetStencilReference(WGPURenderPassEncoder renderPassEncoder, uint32_t reference)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setStencilReference(reference);
}

void wgpuRenderPassEncoderSetVertexBuffer(WGPURenderPassEncoder renderPassEncoder, uint32_t slot, WGPUBuffer buffer, uint64_t offset, uint64_t size)
{
    RefPtr<WebGPU::Buffer> optionalBuffer;
    if (buffer)
        optionalBuffer = protect(WebGPU::fromAPI(buffer)).ptr();
    protect(WebGPU::fromAPI(renderPassEncoder))->setVertexBuffer(slot, optionalBuffer.get(), offset, size);
}

void wgpuRenderPassEncoderSetViewport(WGPURenderPassEncoder renderPassEncoder, float x, float y, float width, float height, float minDepth, float maxDepth)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setViewport(x, y, width, height, minDepth, maxDepth);
}

void wgpuRenderPassEncoderSetLabel(WGPURenderPassEncoder renderPassEncoder, const char* label)
{
    protect(WebGPU::fromAPI(renderPassEncoder))->setLabel(WebGPU::fromAPI(label));
}
