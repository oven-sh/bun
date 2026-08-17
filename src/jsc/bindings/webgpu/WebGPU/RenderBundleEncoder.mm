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
#import "RenderBundleEncoder.h"

#import "APIConversions.h"
#import "BindGroup.h"
#import "BindableResource.h"
#import "Buffer.h"
#import "Device.h"
#import "IsValidToUseWith.h"
#import "RenderBundle.h"
#import "RenderPipeline.h"
#import <wtf/IndexedRange.h>
#import <wtf/TZoneMallocInlines.h>

#define ENABLE_WEBGPU_ALWAYS_USE_ICB_REPLAY 0

@implementation RenderBundleICBWithResources {
    Vector<WebGPU::BindableResources> _resources;
    HashMap<uint64_t, WebGPU::IndexBufferAndIndexData, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> _minVertexCountForDrawCommand;
}

static bool setCommandEncoder(auto& buffer, auto& renderPassEncoder)
{
    buffer.setCommandEncoder(renderPassEncoder->parentEncoder());
    return !!renderPassEncoder->renderCommandEncoder();
}

- (instancetype)initWithICB:(id<MTLIndirectCommandBuffer>)icb containerBuffer:(id<MTLBuffer>)containerBuffer pipelineState:(id<MTLRenderPipelineState>)pipelineState depthStencilState:(id<MTLDepthStencilState>)depthStencilState cullMode:(MTLCullMode)cullMode frontFace:(MTLWinding)frontFace depthClipMode:(MTLDepthClipMode)depthClipMode depthBias:(float)depthBias depthBiasSlopeScale:(float)depthBiasSlopeScale depthBiasClamp:(float)depthBiasClamp fragmentDynamicOffsetsBuffer:(id<MTLBuffer>)fragmentDynamicOffsetsBuffer pipeline:(const WebGPU::RenderPipeline*)pipeline minVertexCounts:(WebGPU::RenderBundle::MinVertexCountsContainer*)minVertexCounts outOfBoundsReadFlag:(id<MTLBuffer>)outOfBoundsReadFlag
{
    if (!(self = [super init]))
        return nil;

    _outOfBoundsReadFlag = outOfBoundsReadFlag;
    _indirectCommandBuffer = icb;
    _indirectCommandBufferContainer = containerBuffer;
    _currentPipelineState = pipelineState;
    _depthStencilState = depthStencilState;
    _cullMode = cullMode;
    _frontFace = frontFace;
    _depthClipMode = depthClipMode;
    _depthBias = depthBias;
    _depthBiasSlopeScale = depthBiasSlopeScale;
    _depthBiasClamp = depthBiasClamp;
    _fragmentDynamicOffsetsBuffer = fragmentDynamicOffsetsBuffer;
    _pipeline = pipeline;
    _minVertexCountForDrawCommand = WTF::move(*minVertexCounts);

    return self;
}

- (Vector<WebGPU::BindableResources>*)resources
{
    return &_resources;
}

- (WebGPU::RenderBundle::MinVertexCountsContainer*)minVertexCountForDrawCommand
{
    return &_minVertexCountForDrawCommand;
}

@end

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RenderBundleEncoder);

static constexpr uint64_t maxCommandCount = 0x4000;

bool RenderBundleEncoder::returnIfEncodingIsFinished(NSString* errorString)
{
    if (!validToEncodeCommand()) {
        protect(m_device)->generateAValidationError(errorString);
        return true;
    }

    return false;
}

#define RETURN_IF_FINISHED() \
if (returnIfEncodingIsFinished([NSString stringWithFormat:@"%s: failed as encoding has finished", __PRETTY_FUNCTION__]) || !m_icbDescriptor) \
    return;

#define RETURN_IF_FINISHED_RENDER_COMMAND() \
if (returnIfEncodingIsFinished([NSString stringWithFormat:@"%s: failed as encoding has finished", __PRETTY_FUNCTION__]) || !m_icbDescriptor) \
    return finalizeRenderCommand();

static RenderBundleICBWithResources* makeRenderBundleICBWithResources(id<MTLIndirectCommandBuffer> icb, id<MTLRenderPipelineState> renderPipelineState, id<MTLDepthStencilState> depthStencilState, MTLCullMode cullMode, MTLWinding frontFace, MTLDepthClipMode depthClipMode, float depthBias, float depthBiasSlopeScale, float depthBiasClamp, id<MTLBuffer> fragmentDynamicOffsetsBuffer, const RenderPipeline* pipeline, Device& device, RenderBundle::MinVertexCountsContainer& vertexCountContainer)
{
    id<MTLArgumentEncoder> argumentEncoder =
        [device.icbCommandClampFunction(MTLIndexTypeUInt32) newArgumentEncoderWithBufferIndex:device.bufferIndexForICBContainer()];
    id<MTLBuffer> container = device.safeCreateBuffer(argumentEncoder.encodedLength);
    id<MTLBuffer> outOfBoundsRead = device.safeCreateBuffer(sizeof(uint32_t));
    outOfBoundsRead.label = @"Out of bounds read flag";
    container.label = @"ICB Argument Buffer";
    [argumentEncoder setArgumentBuffer:container offset:0];
    [argumentEncoder setBuffer:outOfBoundsRead offset:0 atIndex:0];
    [argumentEncoder setIndirectCommandBuffer:icb atIndex:1];

    RenderBundleICBWithResources* renderBundle = [[RenderBundleICBWithResources alloc] initWithICB:icb containerBuffer:container pipelineState:renderPipelineState depthStencilState:depthStencilState cullMode:cullMode frontFace:frontFace depthClipMode:depthClipMode depthBias:depthBias depthBiasSlopeScale:depthBiasSlopeScale depthBiasClamp:depthBiasClamp fragmentDynamicOffsetsBuffer:fragmentDynamicOffsetsBuffer pipeline:pipeline minVertexCounts:&vertexCountContainer outOfBoundsReadFlag:outOfBoundsRead];

    vertexCountContainer.clear();

    return renderBundle;
}

Ref<RenderBundleEncoder> Device::createRenderBundleEncoder(const WGPURenderBundleEncoderDescriptor& descriptor)
{
    if (!isValid())
        return RenderBundleEncoder::createInvalid(*this, @"createRenderBundleEncoder: invalid device");

    MTLIndirectCommandBufferDescriptor *icbDescriptor = [MTLIndirectCommandBufferDescriptor new];
    icbDescriptor.inheritBuffers = NO;
    icbDescriptor.inheritPipelineState = NO;
    icbDescriptor.maxFragmentBufferBindCount = 1;

    uint32_t bytesPerSample = 0;
    const auto maxColorAttachmentBytesPerSample = limits().maxColorAttachmentBytesPerSample;

    if (descriptor.colorFormatCount > limits().maxColorAttachments) {
        NSString* error = [NSString stringWithFormat:@"descriptor.colorFormatCount(%zu) > limits().maxColorAttachments(%u)", descriptor.colorFormatCount, limits().maxColorAttachments];
        generateAValidationError(error);
        return RenderBundleEncoder::createInvalid(*this, error);
    }
    for (auto [ i, textureFormat ] : indexedRange(descriptor.colorFormatsSpan())) {
        if (textureFormat == WGPUTextureFormat_Undefined)
            continue;
        if (!Texture::isColorRenderableFormat(textureFormat, *this)) {
            NSString* error = [NSString stringWithFormat:@"createRenderBundleEncoder - colorAttachment[%zu] with format %d is not renderable", i, textureFormat];
            generateAValidationError(error);
            return RenderBundleEncoder::createInvalid(*this, error);
        }
        bytesPerSample = roundUpToMultipleOfNonPowerOfTwo(Texture::renderTargetPixelByteAlignment(textureFormat), bytesPerSample);
        bytesPerSample += Texture::renderTargetPixelByteCost(textureFormat);
        if (bytesPerSample > maxColorAttachmentBytesPerSample) {
            NSString* error = @"createRenderBundleEncoder - bytesPerSample > maxColorAttachmentBytesPerSample";
            generateAValidationError(error);
            return RenderBundleEncoder::createInvalid(*this, error);
        }
    }

    if (descriptor.depthStencilFormat != WGPUTextureFormat_Undefined) {
        if (!Texture::isDepthOrStencilFormat(descriptor.depthStencilFormat)) {
            NSString* error = [NSString stringWithFormat:@"createRenderBundleEncoder - provided depthStencilFormat %d is not a depth or stencil format", descriptor.depthStencilFormat];
            generateAValidationError(error);
            return RenderBundleEncoder::createInvalid(*this, error);
        }
    } else if (!descriptor.colorFormatCount) {
        NSString* error = @"createRenderBundleEncoder - zero color and depth-stencil formats provided";
        generateAValidationError(error);
        return RenderBundleEncoder::createInvalid(*this, error);
    }

    return RenderBundleEncoder::create(icbDescriptor, descriptor, *this);
}

RenderBundleEncoder::RenderBundleEncoder(MTLIndirectCommandBufferDescriptor *indirectCommandBufferDescriptor, const WGPURenderBundleEncoderDescriptor& descriptor, Device& device)
    : m_device(device)
    , m_icbDescriptor(indirectCommandBufferDescriptor)
    , m_resources([NSMapTable strongToStrongObjectsMapTable])
    , m_vertexBuffers(m_device->maxBuffersPlusVertexBuffersForVertexStage() + 1)
    , m_fragmentBuffers(m_device->maxBuffersForFragmentStage() + 1)
    , m_descriptor(descriptor)
    , m_descriptorColorFormats(descriptor.colorFormats ? Vector<WGPUTextureFormat>(unsafeMakeSpan(descriptor.colorFormats, descriptor.colorFormatCount)) : Vector<WGPUTextureFormat>())
{
    m_descriptor.colorFormats = m_descriptorColorFormats.size() ? &m_descriptorColorFormats[0] : nullptr;
    m_icbArray = [NSMutableArray array];
    m_bindGroupDynamicOffsets = BindGroupDynamicOffsetsContainer();
#if ENABLE(WEBGPU_ALWAYS_USE_ICB_REPLAY)
    m_requiresCommandReplay = true;
#endif
}

RenderBundleEncoder::RenderBundleEncoder(Device& device, NSString* errorString)
    : m_device(device)
    , m_lastErrorString(errorString)
{
}

void RenderBundleEncoder::makeInvalid(NSString* errorString)
{
    m_indirectCommandBuffer = nil;
    m_icbDescriptor = nil;
    m_resources = nil;
    m_lastErrorString = errorString;
    m_icbArray = nil;
    if (RefPtr renderPassEncoder = m_renderPassEncoder.get())
        renderPassEncoder->makeInvalid(errorString);
}

RenderBundleEncoder::~RenderBundleEncoder() = default;

bool RenderBundleEncoder::replayingCommands() const
{
    return m_renderPassEncoder || m_currentCommand || m_indirectCommandBuffer;
}

id<MTLIndirectRenderCommand> RenderBundleEncoder::currentRenderCommand()
{
    if (auto* renderPassEncoder = m_renderPassEncoder.get())
        return (id<MTLIndirectRenderCommand>)renderPassEncoder->renderCommandEncoder();

    if (m_currentCommand)
        return m_currentCommand;

    ASSERT(!m_indirectCommandBuffer || m_currentCommandIndex < m_indirectCommandBuffer.size);
    m_currentCommand = m_currentCommandIndex < m_indirectCommandBuffer.size ? [m_indirectCommandBuffer indirectRenderCommandAtIndex:m_currentCommandIndex] : nil;
    return m_currentCommand;
}

bool RenderBundleEncoder::addResource(RenderBundle::ResourcesContainer* resources, id<MTLResource> mtlResource, ResourceUsageAndRenderStage *resource)
{
    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    if (renderPassEncoder) {
        if (resource.renderStages && mtlResource)
            [renderPassEncoder->renderCommandEncoder() useResource:mtlResource usage:resource.usage stages:resource.renderStages];
        ASSERT(resource.entryUsage.hasExactlyOneBitSet());
        renderPassEncoder->addResourceToActiveResources(resource.resource, resource.entryUsage);
        renderPassEncoder->setCommandEncoder(resource.resource);
        return renderPassEncoder->renderCommandEncoder();
    }

    if (ResourceUsageAndRenderStage *existingResource = [resources objectForKey:mtlResource]) {
        existingResource.usage |= resource.usage;
        existingResource.renderStages |= resource.renderStages;
        existingResource.entryUsage |= resource.entryUsage;
        existingResource.binding = resource.binding;
    } else
        [resources setObject:resource forKey:mtlResource];

    return true;
}

bool RenderBundleEncoder::addResource(RenderBundle::ResourcesContainer* container, id<MTLResource> mtlResource, MTLRenderStages stage)
{
    RefPtr<Buffer> placeholderBuffer;
    return addResource(container, mtlResource, stage, placeholderBuffer);
}

bool RenderBundleEncoder::addResource(RenderBundle::ResourcesContainer* resources, id<MTLResource> mtlResource, MTLRenderStages stage, const BindGroupEntryUsageData::Resource& resource)
{
    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    if (renderPassEncoder && mtlResource) {
        id<MTLRenderCommandEncoder> renderCommandEncoder = renderPassEncoder->renderCommandEncoder();
        [renderCommandEncoder useResource:mtlResource usage:MTLResourceUsageRead stages:stage];
        return !!renderCommandEncoder;
    }

    return addResource(resources, mtlResource, [[ResourceUsageAndRenderStage alloc] initWithUsage:MTLResourceUsageRead renderStages:stage entryUsage:BindGroupEntryUsage::Input binding:BindGroupEntryUsageData::invalidBindingIndex resource:resource]);
}

template<typename T>
static std::span<T> makeSpanFromBuffer(id<MTLBuffer> buffer, size_t byteOffset = 0)
{
    auto bufferLength = buffer.length;
    if (bufferLength < byteOffset || (bufferLength - byteOffset < sizeof(T))) [[unlikely]]
        return { };

    return unsafeMakeSpan(static_cast<T*>(buffer.contents), (bufferLength - byteOffset) / sizeof(T));
}

bool RenderBundleEncoder::executePreDrawCommands(bool needsValidationLayerWorkaround, bool passWasSplit, uint32_t firstInstance, uint32_t instanceCount)
{
    if (!isValid())
        return false;

    if (checkedSum<uint64_t>(instanceCount, firstInstance) > std::numeric_limits<uint32_t>::max())
        return false;

    auto vertexDynamicOffset = m_vertexDynamicOffset;
    auto fragmentDynamicOffset = m_fragmentDynamicOffset;
    RefPtr pipeline = m_pipeline.get();
    if (!pipeline) {
        makeInvalid(@"Pipeline was not set prior to draw command");
        return false;
    }

    if (!pipeline->isValid()) {
        makeInvalid(@"pipeline is not valid prior to draw");
        return false;
    }

    Ref pipelineLayout = pipeline->pipelineLayout();
    auto vertexDynamicOffsetSum = checkedSum<uint64_t>(m_vertexDynamicOffset, sizeof(uint32_t) * pipelineLayout->sizeOfVertexDynamicOffsets());
    if (vertexDynamicOffsetSum.hasOverflowed()) {
        makeInvalid(@"Invalid vertexDynamicOffset");
        return false;
    }
    m_vertexDynamicOffset = vertexDynamicOffsetSum.value();

    auto fragmentDynamicOffsetSum = checkedSum<uint64_t>(m_fragmentDynamicOffset, sizeof(uint32_t) * pipelineLayout->sizeOfFragmentDynamicOffsets());
    if (fragmentDynamicOffsetSum.hasOverflowed()) {
        makeInvalid(@"Invalid fragmentDynamicOffset");
        return false;
    }
    m_fragmentDynamicOffset = fragmentDynamicOffsetSum.value();

    if (needsValidationLayerWorkaround) {
        pipeline = pipeline->recomputeLastStrideAsStride();
        m_currentPipelineState = pipeline->icbRenderPipelineState();
    }

    if (!m_currentPipelineState)
        return false;

    id<MTLIndirectRenderCommand> icbCommand = currentRenderCommand();
    if (!icbCommand)
        return true;

    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    if (renderPassEncoder && passWasSplit) {
        id<MTLRenderCommandEncoder> commandEncoder = renderPassEncoder->renderCommandEncoder();
        if (id<MTLRenderPipelineState> renderPipeline = m_currentPipelineState)
            [commandEncoder setRenderPipelineState:renderPipeline];
        if (id<MTLDepthStencilState> depthStencilState = m_depthStencilState)
            [commandEncoder setDepthStencilState:depthStencilState];

        [commandEncoder setCullMode:m_cullMode];
        [commandEncoder setFrontFacingWinding:m_frontFace];
        [commandEncoder setDepthClipMode:m_depthClipMode];
        [commandEncoder setDepthBias:m_depthBias slopeScale:m_depthBiasSlopeScale clamp:m_depthBiasClamp];

        for (auto& [groupIndex, bindGroup] : m_bindGroups) {
            for (const auto& resource : bindGroup->resources()) {
                ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
                for (size_t i = 0, resourceCount = resource.resourceUsages.size(); i < resourceCount; ++i) {
                    if (resource.renderStages && resource.mtlResources[i])
                        [renderPassEncoder->renderCommandEncoder() useResource:resource.mtlResources[i] usage:resource.usage stages:resource.renderStages];
                }
            }
        }
    }

    for (auto& [groupIndex, bindGroup] : m_bindGroups) {
        Ref group = bindGroup;
        RefPtr pipelineOptionalBindGroupLayout = pipelineLayout->optionalBindGroupLayout(groupIndex);
        const Vector<uint32_t>* dynamicOffsets = nullptr;
        if (m_bindGroupDynamicOffsets) {
            if (auto it = m_bindGroupDynamicOffsets->find(groupIndex); it != m_bindGroupDynamicOffsets->end())
                dynamicOffsets = &it->value;
        }
        if (NSString* error = errorValidatingBindGroup(group, pipeline->minimumBufferSizes(groupIndex), dynamicOffsets)) {
            makeInvalid(error);
            return false;
        }

        if (group->makeSubmitInvalid(ShaderStage::Vertex, pipelineOptionalBindGroupLayout.get()) || group->makeSubmitInvalid(ShaderStage::Fragment, pipelineOptionalBindGroupLayout.get()))
            m_makeSubmitInvalid = true;
    }

    if (NSString* error = pipeline->pipelineLayout().errorValidatingBindGroupCompatibility(m_bindGroups)) {
        makeInvalid(error);
        return false;
    }

    if (NSString* error = errorValidatingDraw()) {
        makeInvalid(error);
        return false;
    }

    if (m_currentPipelineState)
        [icbCommand setRenderPipelineState:m_currentPipelineState];

    for (size_t i = 0, sz = m_vertexBuffers.size(); i < sz; ++i) {
        if (m_vertexBuffers[i].buffer) {
            if (m_vertexBuffers[i].offset < m_vertexBuffers[i].buffer.length)
                [icbCommand setVertexBuffer:m_vertexBuffers[i].buffer offset:m_vertexBuffers[i].offset atIndex:i];
            else if (m_vertexBuffers[i].size) {
                makeInvalid(@"attempting to set non-zero sized buffer");
                return false;
            } else
                [icbCommand setVertexBuffer:m_device->placeholderBuffer() offset:0 atIndex:i];
        }
    }

    for (size_t i = 0, sz = m_fragmentBuffers.size(); i < sz; ++i) {
        if (m_fragmentBuffers[i].buffer)
            [icbCommand setFragmentBuffer:m_fragmentBuffers[i].buffer offset:m_fragmentBuffers[i].offset atIndex:i];
    }

    if (m_bindGroupDynamicOffsets) {
        auto vertexDynamicOffsetInElements = vertexDynamicOffset / sizeof(uint32_t);
        auto fragmentDynamicOffsetInElements = fragmentDynamicOffset / sizeof(uint32_t);
        for (auto& kvp : *m_bindGroupDynamicOffsets) {
            Ref pipelineLayout = pipeline->pipelineLayout();
            auto bindGroupIndex = kvp.key;

            if (m_dynamicOffsetsVertexBuffer) {
                auto dynamicOffsetsVertexBuffer = makeSpanFromBuffer<uint32_t>(m_dynamicOffsetsVertexBuffer);
                auto vertexBufferContentsSpan = dynamicOffsetsVertexBuffer.subspan(vertexDynamicOffsetInElements);
                if (!pipelineLayout->updateVertexOffsets(bindGroupIndex, kvp.value, vertexBufferContentsSpan)) {
                    makeInvalid(@"Incorrect data for vertexBuffer");
                    return false;
                }
            }

            if (m_dynamicOffsetsFragmentBuffer) {
                auto dynamicOffsetsFragmentBuffer = makeSpanFromBuffer<uint32_t>(m_dynamicOffsetsFragmentBuffer);
                auto fragmentBufferContents = dynamicOffsetsFragmentBuffer.subspan(fragmentDynamicOffsetInElements + RenderBundleEncoder::startIndexForFragmentDynamicOffsets);
                if (!pipelineLayout->updateFragmentOffsets(bindGroupIndex, kvp.value, fragmentBufferContents)) {
                    makeInvalid(@"Incorrect data for fragmentBuffer");
                    return false;
                }
            }
        }
    }

    if (m_dynamicOffsetsVertexBuffer && vertexDynamicOffset < m_dynamicOffsetsVertexBuffer.length)
        [icbCommand setVertexBuffer:m_dynamicOffsetsVertexBuffer offset:vertexDynamicOffset atIndex:m_device->maxBuffersPlusVertexBuffersForVertexStage()];

    if (m_dynamicOffsetsFragmentBuffer && fragmentDynamicOffset < m_dynamicOffsetsFragmentBuffer.length) {
        RELEASE_ASSERT(m_fragmentBuffers.size());
        [icbCommand setFragmentBuffer:m_dynamicOffsetsFragmentBuffer offset:fragmentDynamicOffset atIndex:m_fragmentBuffers.size() - 1];
    }

    if (m_bindGroupDynamicOffsets)
        m_bindGroupDynamicOffsets->clear();

    return true;
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::draw(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    RETURN_IF_FINISHED_RENDER_COMMAND();
    if (!executePreDrawCommands(vertexCount == 1, false, firstInstance, instanceCount))
        return finalizeRenderCommand();
    if (id<MTLIndirectRenderCommand> icbCommand = currentRenderCommand()) {
        if (!m_makeSubmitInvalid)
            [icbCommand drawPrimitives:m_primitiveType vertexStart:firstVertex vertexCount:vertexCount instanceCount:instanceCount baseInstance:firstInstance];
    } else {
        if (!runVertexBufferValidation(vertexCount, instanceCount, firstVertex, firstInstance))
            return finalizeRenderCommand();
        if (!vertexCount || !instanceCount)
            return finalizeRenderCommand();

        recordCommand([vertexCount, instanceCount, firstVertex, firstInstance, protectedThis = protect(*this)] {
            protectedThis->draw(vertexCount, instanceCount, firstVertex, firstInstance);
            return true;
        });
    }

    return finalizeRenderCommand(MTLIndirectCommandTypeDraw);
}

uint32_t RenderBundleEncoder::maxVertexBufferIndex() const
{
    return m_maxVertexBufferSlot;
}

uint32_t RenderBundleEncoder::maxBindGroupIndex() const
{
    return m_maxBindGroupSlot;
}

NSString* RenderBundleEncoder::errorValidatingDraw() const
{
    RefPtr pipeline = m_pipeline.get();
    if (!pipeline)
        return @"pipeline is not set";

    auto& requiredBufferIndices = pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, _] : requiredBufferIndices) {
        if (!m_utilizedBufferIndices.contains(bufferIndex))
            return [NSString stringWithFormat:@"Buffer index[%u] is missing", bufferIndex];
    }

    auto bindGroupSpaceUsedPlusVertexBufferSpaceUsed = checkedSum<uint32_t>(maxBindGroupIndex(), 1, maxVertexBufferIndex(), 1);
    if (bindGroupSpaceUsedPlusVertexBufferSpaceUsed.hasOverflowed() || bindGroupSpaceUsedPlusVertexBufferSpaceUsed.value() > m_device->limits().maxBindGroupsPlusVertexBuffers)
        return @"Too many bind groups and vertex buffers used";

    return nil;
}

NSString* RenderBundleEncoder::errorValidatingDrawIndexed() const
{
    RefPtr pipeline = m_pipeline.get();
    RELEASE_ASSERT(pipeline);
    if (!pipeline->requiredBufferIndices().size())
        return nil;

    if (!m_indexBuffer)
        return @"Index buffer is not set";

    auto topology = pipeline->primitiveTopology();
    if (topology == WGPUPrimitiveTopology_LineStrip || topology == WGPUPrimitiveTopology_TriangleStrip) {
        if (m_indexType != pipeline->stripIndexFormat())
            return @"Primitive topology mismiatch with render pipeline";
    }

    return nil;
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::finalizeRenderCommand(MTLIndirectCommandType commandTypes)
{
    m_icbDescriptor.commandTypes |= commandTypes;
    ++m_currentCommandIndex;

    return finalizeRenderCommand();
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::finalizeRenderCommand()
{
    m_currentCommand = nil;

    if (isValid() && m_currentCommandIndex >= maxCommandCount && !m_requiresCommandReplay && m_indirectCommandBuffer)
        splitICB();

    return FinalizeRenderCommand { };
}

bool RenderBundleEncoder::runIndexBufferValidation(uint32_t firstInstance, uint32_t instanceCount)
{
    RefPtr pipeline = m_pipeline.get();
    if (!pipeline || !m_indexBuffer) {
        makeInvalid(@"Missing pipeline before draw command");
        return false;
    }

    auto checkedStrideCount = checkedSum<NSUInteger>(firstInstance, instanceCount);
    if (checkedStrideCount.hasOverflowed())
        return false;

    auto strideCount = checkedStrideCount.value();
    if (!strideCount)
        return true;

    auto& requiredBufferIndices = pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, bufferData] : requiredBufferIndices) {
        RELEASE_ASSERT(bufferIndex < m_vertexBuffers.size());
        auto& vertexBuffer = m_vertexBuffers[bufferIndex];
        auto bufferSize = vertexBuffer.size;
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
                makeInvalid([NSString stringWithFormat:@"(RenderBundle) Buffer[%d] fails: (strideCount(%lu) - 1) * stride(%llu) + lastStride(%llu) > bufferSize(%llu), metalBufferLength(%lu)", bufferIndex, static_cast<unsigned long>(strideCount), stride, lastStride, bufferSize, static_cast<unsigned long>(vertexBuffer.buffer.length)]);
                return false;
            }
        }
    }

    return true;
}

bool RenderBundleEncoder::runVertexBufferValidation(uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    RefPtr pipeline = m_pipeline.get();
    if (!pipeline) {
        makeInvalid(@"Missing pipeline before draw command");
        return false;
    }

    if (checkedSum<uint32_t>(firstVertex, vertexCount).hasOverflowed()) {
        makeInvalid(@"Overflow in vertex count + firstVertex");
        return false;
    }

    auto& requiredBufferIndices = pipeline->requiredBufferIndices();
    for (auto& [bufferIndex, bufferData] : requiredBufferIndices) {
        Checked<uint64_t, WTF::RecordOverflow> strideCount = 0;
        switch (bufferData.stepMode) {
        case WGPUVertexStepMode_Vertex:
            strideCount = checkedSum<uint32_t>(firstVertex, vertexCount);
            if (strideCount.hasOverflowed()) {
                makeInvalid(@"StrideCount invalid");
                return false;
            }
            break;
        case WGPUVertexStepMode_Instance:
            strideCount = checkedSum<uint32_t>(firstInstance, instanceCount);
            if (strideCount.hasOverflowed()) {
                makeInvalid(@"StrideCount invalid");
                return false;
            }
            break;
        default:
            break;
        }
        if (!strideCount.value())
            continue;

        if (bufferIndex >= m_vertexBuffers.size()) {
            makeInvalid([NSString stringWithFormat:@"vertex buffer validation failed as vertex buffer %d was not set", bufferIndex]);
            return false;
        }
        auto& vertexBuffer = m_vertexBuffers[bufferIndex];
        auto bufferSize = vertexBuffer.size;
        auto strideSize = checkedProduct<uint64_t>((strideCount.value() - 1), bufferData.stride);
        auto requiredSize = checkedSum<uint64_t>(strideSize.value(), bufferData.lastStride);
        if (strideSize.hasOverflowed() || requiredSize.hasOverflowed() ||  requiredSize.value() > bufferSize) {
            makeInvalid([NSString stringWithFormat:@"Buffer[%d] fails: (strideCount(%llu) - 1) * bufferData.stride(%llu) + bufferData.lastStride(%llu) > bufferSize(%llu)", bufferIndex, strideCount.value(), bufferData.stride,  bufferData.lastStride, bufferSize]);
            return false;
        }
    }

    return true;
}

std::pair<uint32_t, uint32_t> RenderBundleEncoder::computeMininumVertexInstanceCount(bool& needsValidationLayerWorkaround) const
{
    RefPtr pipeline = m_pipeline.get();
    return RenderPassEncoder::computeMininumVertexInstanceCount(pipeline.get(), needsValidationLayerWorkaround, ^(uint32_t bufferIndex) {
        return bufferIndex < m_vertexBuffers.size() ? m_vertexBuffers[bufferIndex].size : 0;
    });
}

bool RenderBundleEncoder::storeVertexBufferCountsForValidation(uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance, MTLIndexType indexType, NSUInteger indexBufferOffsetInBytes)
{
    if (m_renderPassEncoder.get())
        return true;

    id<MTLBuffer> indexBuffer = m_indexBuffer.get() ? m_indexBuffer->buffer() : nil;
    id<MTLIndirectRenderCommand> icbCommand = currentRenderCommand();
    if (!icbCommand || !indexBuffer || m_indexBuffer->isDestroyed())
        return false;

    bool needsValidationLayerWorkaround;
    auto indexSizeInBytes = (m_indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t));
    auto elementCount = indexBuffer.length / indexSizeInBytes;
    RELEASE_ASSERT(elementCount);

    auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
    m_minVertexCountForDrawCommand.add(m_currentCommandIndex, IndexBufferAndIndexData {
        .indexBuffer = m_indexBuffer,
        .indexType = indexType,
        .indexBufferOffsetInBytes = indexBufferOffsetInBytes,
        .indexData = IndexData {
            .renderCommand = m_currentCommandIndex,
            .minVertexCount = minVertexCount,
            .minInstanceCount = minInstanceCount,
            .bufferGpuAddress = indexBuffer.gpuAddress,
            .indexBufferElementCountMinusOne = static_cast<uint32_t>(elementCount - 1),
            .indexCount = indexCount,
            .instanceCount = instanceCount,
            .firstIndex = firstIndex,
            .baseVertex = baseVertex,
            .firstInstance = firstInstance,
            .primitiveType = static_cast<decltype(IndexData::primitiveType)>(m_primitiveType),
        }
    });
    return true;
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::drawIndexed(uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance)
{
    RETURN_IF_FINISHED_RENDER_COMMAND();

    auto indexSizeInBytes = (m_indexType == MTLIndexTypeUInt16 ? sizeof(uint16_t) : sizeof(uint32_t));
    auto firstIndexOffsetInBytes = checkedProduct<size_t>(firstIndex, indexSizeInBytes);
    auto indexBufferOffsetInBytes = checkedSum<size_t>(m_indexBufferOffset, firstIndexOffsetInBytes);
    if (indexBufferOffsetInBytes.hasOverflowed() || firstIndexOffsetInBytes.hasOverflowed())
        return finalizeRenderCommand();

    id<MTLBuffer> indexBuffer = m_indexBuffer ? m_indexBuffer->buffer() : nil;
    RenderPassEncoder::IndexCall useIndirectCall { RenderPassEncoder::IndexCall::Draw };
    id<MTLBuffer> indirectBuffer = nil;
    uint64_t indirectBufferOffset = 0;
    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    bool needsValidationLayerWorkaround = false;
    bool passWasSplit = false;
    if (renderPassEncoder) {
        auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
        auto result = RenderPassEncoder::clampIndexBufferToValidValues(indexCount, instanceCount, baseVertex, firstInstance, m_indexType, indexBufferOffsetInBytes, m_indexBuffer.get(), minVertexCount, minInstanceCount, *renderPassEncoder, m_device.get(), m_descriptor.sampleCount, m_primitiveType);
        useIndirectCall = result.result;
        indirectBuffer = result.buffer;
        indirectBufferOffset = result.offset;
        if (useIndirectCall == RenderPassEncoder::IndexCall::IndirectDraw || useIndirectCall == RenderPassEncoder::IndexCall::CachedIndirectDraw)
            passWasSplit = renderPassEncoder->splitRenderPass();
    }

    if (!executePreDrawCommands(needsValidationLayerWorkaround, passWasSplit, firstInstance, instanceCount))
        return finalizeRenderCommand();

    auto indexCountTimesSizeInBytes = checkedProduct<size_t>(indexCount, indexSizeInBytes);
    if (id<MTLIndirectRenderCommand> icbCommand = currentRenderCommand()) {
        if (!storeVertexBufferCountsForValidation(indexCount, instanceCount, indexBufferOffsetInBytes / indexSizeInBytes, baseVertex, firstInstance, m_indexType, indexBufferOffsetInBytes))
            return finalizeRenderCommand();

        RefPtr renderPassEncoder = m_renderPassEncoder.get();
        if (renderPassEncoder && (useIndirectCall == RenderPassEncoder::IndexCall::IndirectDraw || useIndirectCall == RenderPassEncoder::IndexCall::CachedIndirectDraw)) {
            if (!m_makeSubmitInvalid)
                [renderPassEncoder->renderCommandEncoder() drawIndexedPrimitives:m_primitiveType indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:0 indirectBuffer:indirectBuffer indirectBufferOffset:indirectBufferOffset];
        } else if (useIndirectCall != RenderPassEncoder::IndexCall::Skip) {
            auto checkedAddition = checkedSum<size_t>(indexBufferOffsetInBytes, indexCountTimesSizeInBytes);
            if (!checkedAddition.hasOverflowed() && checkedAddition.value() <= indexBuffer.length && !m_makeSubmitInvalid)
                [icbCommand drawIndexedPrimitives:m_primitiveType indexCount:indexCount indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:indexBufferOffsetInBytes instanceCount:instanceCount baseVertex:baseVertex baseInstance:firstInstance];
        }
    } else {
        if (NSString* error = errorValidatingDrawIndexed()) {
            makeInvalid(error);
            return finalizeRenderCommand();
        }

        auto lastIndexOffset = checkedSum<size_t>(firstIndexOffsetInBytes, indexCountTimesSizeInBytes);
        if (lastIndexOffset.hasOverflowed() || lastIndexOffset.value() > m_indexBufferSize || m_indexBufferSize < indexSizeInBytes) {
            makeInvalid(@"firstIndexOffsetInBytes + indexCount * indexSizeInBytes > m_indexBufferSize");
            return finalizeRenderCommand();
        }

        if (!runIndexBufferValidation(firstInstance, instanceCount))
            return finalizeRenderCommand();

        if (!indexCount || !instanceCount || !indexBuffer || m_indexBuffer->isDestroyed())
            return finalizeRenderCommand();

        recordCommand([indexCount, instanceCount, firstIndex, baseVertex, firstInstance, protectedThis = protect(*this)] {
            protectedThis->drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
            return true;
        });
    }

    return finalizeRenderCommand(MTLIndirectCommandTypeDrawIndexed);
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::drawIndexedIndirect(Buffer& indirectBuffer, uint64_t indirectOffset)
{
    RETURN_IF_FINISHED_RENDER_COMMAND();

    m_requiresCommandReplay = true;
    id<MTLBuffer> mtlIndirectBuffer = nil;
    uint64_t modifiedIndirectOffset = 0;
    bool splitPass = false;
    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    bool needsValidationLayerWorkaround = false;
    if (renderPassEncoder) {
        auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
        auto result = RenderPassEncoder::clampIndirectIndexBufferToValidValues(m_indexBuffer.get(), indirectBuffer, m_indexType, m_indexBufferOffset, indirectOffset, minVertexCount, minInstanceCount, m_primitiveType, m_device.get(), m_descriptor.sampleCount, *renderPassEncoder.get(), splitPass);
        if (splitPass)
            splitPass = renderPassEncoder->splitRenderPass();
        mtlIndirectBuffer = result.first;
        modifiedIndirectOffset = result.second;
    }

    if (!executePreDrawCommands(needsValidationLayerWorkaround, splitPass))
        return finalizeRenderCommand();
    id<MTLBuffer> indexBuffer = m_indexBuffer ? m_indexBuffer->buffer() : nil;
    if (currentRenderCommand()) {
        if (renderPassEncoder) {
            if (!setCommandEncoder(indirectBuffer, renderPassEncoder))
                return finalizeRenderCommand();
            if (!indirectBuffer.isDestroyed() && indexBuffer.length && mtlIndirectBuffer && !m_makeSubmitInvalid)
                [renderPassEncoder->renderCommandEncoder() drawIndexedPrimitives:m_primitiveType indexType:m_indexType indexBuffer:indexBuffer indexBufferOffset:m_indexBufferOffset indirectBuffer:mtlIndirectBuffer indirectBufferOffset:modifiedIndirectOffset];
        } else {
            // FIXME: https://bugs.webkit.org/show_bug.cgi?id=264219
        }
    } else {
        if (!indexBuffer.length)
            return finalizeRenderCommand();

        if (!isValidToUseWith(indirectBuffer, *this)) {
            makeInvalid(@"drawIndexedIndirect: buffer was invalid");
            return finalizeRenderCommand();
        }

        if (!(indirectBuffer.usage() & WGPUBufferUsage_Indirect) || (indirectOffset % 4)) {
            makeInvalid(@"drawIndexedIndirect: validation failed");
            return finalizeRenderCommand();
        }

        auto indirectOffsetSum = checkedSum<uint64_t>(indirectOffset,  sizeof(MTLDrawIndexedPrimitivesIndirectArguments));
        if (indirectOffsetSum.hasOverflowed() || indirectBuffer.initialSize() < indirectOffsetSum.value()) {
            makeInvalid(@"drawIndexedIndirect: validation failed");
            return finalizeRenderCommand();
        }

        recordCommand([indirectBuffer = protect(indirectBuffer), indirectOffset, protectedThis = protect(*this)] {
            protectedThis->drawIndexedIndirect(indirectBuffer.get(), indirectOffset);
            return true;
        });
    }

    return finalizeRenderCommand(MTLIndirectCommandTypeDrawIndexed);
}

RenderBundleEncoder::FinalizeRenderCommand RenderBundleEncoder::drawIndirect(Buffer& indirectBuffer, uint64_t indirectOffset)
{
    RETURN_IF_FINISHED_RENDER_COMMAND();

    m_requiresCommandReplay = true;
    id<MTLBuffer> clampedIndirectBuffer = nil;
    bool splitPass = false;
    RefPtr renderPassEncoder = m_renderPassEncoder.get();
    bool needsValidationLayerWorkaround = false;
    if (renderPassEncoder) {
        auto [minVertexCount, minInstanceCount] = computeMininumVertexInstanceCount(needsValidationLayerWorkaround);
        auto [adjustedBuffer, adjustedOffset] = RenderPassEncoder::clampIndirectBufferToValidValues(indirectBuffer, indirectOffset, minVertexCount, minInstanceCount, m_device.get(), m_descriptor.sampleCount, *renderPassEncoder.get(), splitPass);
        clampedIndirectBuffer = adjustedBuffer;
        indirectOffset = adjustedOffset;
        if (splitPass)
            splitPass = renderPassEncoder->splitRenderPass();
    }

    if (!executePreDrawCommands(needsValidationLayerWorkaround, splitPass))
        return finalizeRenderCommand();
    if (currentRenderCommand()) {
        if (renderPassEncoder) {
            if (!setCommandEncoder(indirectBuffer, renderPassEncoder))
                return finalizeRenderCommand();
            if (!indirectBuffer.isDestroyed() && clampedIndirectBuffer && !m_makeSubmitInvalid)
                [renderPassEncoder->renderCommandEncoder() drawPrimitives:m_primitiveType indirectBuffer:clampedIndirectBuffer indirectBufferOffset:indirectOffset];
        } else {
            // FIXME: https://bugs.webkit.org/show_bug.cgi?id=264219
        }
    } else {
        if (!isValidToUseWith(indirectBuffer, *this)) {
            makeInvalid(@"drawIndirect: buffer was invalid");
            return finalizeRenderCommand();
        }

        if (!(indirectBuffer.usage() & WGPUBufferUsage_Indirect) || (indirectOffset % 4)) {
            makeInvalid(@"drawIndirect: validation failed");
            return finalizeRenderCommand();
        }

        if (indirectBuffer.initialSize() < indirectOffset + sizeof(MTLDrawPrimitivesIndirectArguments)) {
            makeInvalid(@"drawIndirect: validation failed");
            return finalizeRenderCommand();
        }

        recordCommand([indirectBuffer = protect(indirectBuffer), indirectOffset, protectedThis = protect(*this)] {
            protectedThis->drawIndirect(indirectBuffer.get(), indirectOffset);
            return true;
        });
    }

    return finalizeRenderCommand(MTLIndirectCommandTypeDraw);
}

id<MTLIndirectCommandBuffer> RenderBundleEncoder::makeICB(uint64_t commandCount)
{
    if (!m_icbDescriptor.commandTypes)
        return nil;

    Ref device = m_device;
    commandCount = std::clamp(commandCount, 1ull, maxCommandCount);
    id<MTLIndirectCommandBuffer> icb = [device->device() newIndirectCommandBufferWithDescriptor:m_icbDescriptor maxCommandCount:commandCount options:0];
    if (!icb || icb.size != commandCount) {
        makeInvalid(@"MTLIndirectCommandBuffer allocation failed, likely tried to encode too many commands");
        return nil;
    }

    device->setOwnerWithIdentity(icb);
    return icb;
}

void RenderBundleEncoder::cleanup(bool resetPipeline)
{
    m_currentCommand = nil;
    m_currentPipelineState = nil;
    m_minVertexCountForDrawCommand.clear();
    m_depthStencilState = nil;
    m_cullMode = MTLCullModeNone;
    m_frontFace = static_cast<MTLWinding>(0);
    m_depthClipMode = static_cast<MTLDepthClipMode>(0);
    m_depthBiasSlopeScale = 0.f;
    m_depthBias = 0.f;
    m_depthBiasClamp = 0.f;

    if (RefPtr pipeline = m_pipeline; resetPipeline && m_pipeline && validToEncodeCommand())
        setPipeline(*pipeline);
}

void RenderBundleEncoder::endCurrentICB()
{
    auto commandCount = m_currentCommandIndex;
    m_previousCommandCount = m_currentCommandIndex;
    m_currentCommandIndex = 0;

    RELEASE_ASSERT(!commandCount || !!m_icbDescriptor);
    m_requiresCommandReplay = m_requiresCommandReplay ?: (!commandCount && !m_icbArray.count);
    if (!m_icbDescriptor.commandTypes && !m_requiresCommandReplay) {
        m_recordedCommands.clear();
        cleanup(false);
        return;
    }

    Ref device = m_device;

    m_icbDescriptor.maxVertexBufferBindCount = device->maxBuffersPlusVertexBuffersForVertexStage() + 1;
    m_icbDescriptor.maxFragmentBufferBindCount = device->maxBuffersForFragmentStage() + 1;
    if (m_vertexDynamicOffset && !m_dynamicOffsetsVertexBuffer) {
        m_dynamicOffsetsVertexBuffer = device->safeCreateBuffer(m_vertexDynamicOffset);
        if (!addResource(m_resources, m_dynamicOffsetsVertexBuffer, MTLRenderStageVertex))
            return;
    }
    m_vertexDynamicOffset = 0;

    if (!m_dynamicOffsetsFragmentBuffer) {
        m_dynamicOffsetsFragmentBuffer = device->safeCreateBuffer(m_fragmentDynamicOffset + RenderBundleEncoder::startIndexForFragmentDynamicOffsets * sizeof(float));
        auto fragmentBufferSpan = makeSpanFromBuffer<float>(m_dynamicOffsetsFragmentBuffer);
        auto fragmentBufferIntSpan = makeSpanFromBuffer<uint32_t>(m_dynamicOffsetsFragmentBuffer);
        RELEASE_ASSERT(fragmentBufferSpan.size());
        static_assert(sizeof(float) == sizeof(uint32_t));
        fragmentBufferSpan[0] = 0.f;
        fragmentBufferSpan[1] = 1.f;
        fragmentBufferIntSpan[2] = m_sampleMask;
        if (!addResource(m_resources, m_dynamicOffsetsFragmentBuffer, MTLRenderStageFragment))
            return;
    }
    m_fragmentDynamicOffset = 0;

    if (!m_renderPassEncoder && !m_requiresCommandReplay)
        m_indirectCommandBuffer = makeICB(commandCount);

    for (auto& command : m_recordedCommands)
        command();

    m_pipeline = nullptr;
    splitICB();
    m_currentCommandIndex = 0;

    m_indirectCommandBuffer = nil;
    m_dynamicOffsetsFragmentBuffer = nil;
    m_dynamicOffsetsVertexBuffer = nil;
}

bool RenderBundleEncoder::validToEncodeCommand() const
{
    if (!m_device->isValid())
        return false;

    return !m_finished || (m_renderPassEncoder && m_renderPassEncoder->renderCommandEncoder() && !m_makeSubmitInvalid);
}

void RenderBundleEncoder::resetIndexBuffer()
{
    m_indexBuffer = nullptr;
    m_indexType = MTLIndexTypeUInt16;
    m_indexBufferOffset = 0;
    m_indexBufferSize = 0;
}

static Vector<WebGPU::BindableResources> makeBindableResources(RenderBundle::ResourcesContainer* resources)
{
    Vector<WebGPU::BindableResources> result;
    constexpr auto maxResourceUsageValue = MTLResourceUsageRead | MTLResourceUsageWrite;
    constexpr auto maxStageValue = (MTLRenderStageVertex | MTLRenderStageFragment) + 1;
    static_assert(maxResourceUsageValue == 3 && maxStageValue == 4, "Code path assumes MTLResourceUsageRead | MTLResourceUsageWrite == 3 and MTLRenderStageVertex | MTLRenderStageFragment == 3");
    std::array<std::array<Vector<id<MTLResource>>, maxResourceUsageValue>, maxStageValue> stageResources { };
    std::array<std::array<Vector<BindGroupEntryUsageData>, maxResourceUsageValue>, maxStageValue> stageResourceUsages { };

    for (id<MTLResource> r : resources) {
        if (!r)
            continue;

        ResourceUsageAndRenderStage *usageAndStage = [resources objectForKey:r];
        if (!usageAndStage.renderStages || !usageAndStage.usage)
            continue;
        stageResources[usageAndStage.renderStages - 1][usageAndStage.usage - 1].append(r);
        stageResourceUsages[usageAndStage.renderStages - 1][usageAndStage.usage - 1].append(BindGroupEntryUsageData { .usage = usageAndStage.entryUsage, .binding = usageAndStage.binding, .resource = usageAndStage.resource });
    }

    for (size_t stage = 0; stage < maxStageValue; ++stage) {
        for (size_t i = 0; i < maxResourceUsageValue; ++i) {
            auto &v = stageResources[stage][i];
            auto &u = stageResourceUsages[stage][i];
            if (v.size()) {
                result.append(BindableResources {
                    .mtlResources = WTF::move(v),
                    .resourceUsages = WTF::move(u),
                    .usage = static_cast<MTLResourceUsage>(i + 1),
                    .renderStages = static_cast<MTLRenderStages>(stage + 1)
                });
            }
        }
    }

    return result;
}

Ref<RenderBundle> RenderBundleEncoder::finish(const WGPURenderBundleDescriptor& descriptor)
{
    auto device = m_device;
    if (!m_icbDescriptor || m_debugGroupStackSize || !device->isValid() || m_finished) {
        device->generateAValidationError(m_lastErrorString);
        return RenderBundle::createInvalid(device, m_lastErrorString);
    }

    m_requiresCommandReplay = m_requiresCommandReplay ?: (!m_currentCommandIndex && !m_icbArray.count);
    resetIndexBuffer();

    auto createRenderBundle = ^{
        if (m_requiresCommandReplay)
            return RenderBundle::create(nil, makeBindableResources(m_resources), this, m_descriptor, m_currentCommandIndex, m_makeSubmitInvalid, WTF::move(m_allBindGroups), device);

        auto commandCount = m_currentCommandIndex;
        endCurrentICB();
        if (m_requiresCommandReplay)
            return RenderBundle::create(nil, makeBindableResources(m_resources), this, m_descriptor, m_currentCommandIndex, m_makeSubmitInvalid, WTF::move(m_allBindGroups), device);

        m_vertexBuffers.clear();
        m_fragmentBuffers.clear();
        m_icbDescriptor.maxVertexBufferBindCount = 0;
        m_icbDescriptor.maxFragmentBufferBindCount = 0;
        m_recordedCommands.clear();

        RELEASE_ASSERT(m_icbArray || m_lastErrorString);
        if (m_icbArray)
            return RenderBundle::create(m_icbArray, makeBindableResources(m_resources), nullptr, m_descriptor, commandCount, m_makeSubmitInvalid, WTF::move(m_allBindGroups), device);

        device->generateAValidationError(m_lastErrorString);
        return RenderBundle::createInvalid(device, m_lastErrorString);
    };

    auto renderBundle = createRenderBundle();
    renderBundle->setLabel(String::fromUTF8(descriptor.label));
    m_finished = true;

    return renderBundle;
}

bool RenderBundleEncoder::isValid() const
{
    return !!m_icbDescriptor;
}

void RenderBundleEncoder::replayCommands(RenderPassEncoder& renderPassEncoder)
{
    if (!renderPassEncoder.renderCommandEncoder() || !isValid() || !m_device->isValid())
        return;

    m_renderPassEncoder = renderPassEncoder;
    endCurrentICB();
    m_renderPassEncoder = nullptr;
    m_currentPipelineState = nil;
    m_depthStencilState = nil;
    m_bindGroupDynamicOffsets = std::nullopt;
    resetIndexBuffer();
}

void RenderBundleEncoder::insertDebugMarker(String&&)
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-insertdebugmarker

    if (!prepareTheEncoderState())
        return;

    // MTLIndirectCommandBuffers don't support debug commands.
}

bool RenderBundleEncoder::validatePopDebugGroup() const
{
    if (!m_debugGroupStackSize)
        return false;

    return true;
}

void RenderBundleEncoder::popDebugGroup()
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-popdebuggroup

    if (!prepareTheEncoderState())
        return;

    if (!validatePopDebugGroup()) {
        makeInvalid(@"validatePopDebugGroup failed");
        return;
    }

    --m_debugGroupStackSize;
    // MTLIndirectCommandBuffers don't support debug commands.
}

void RenderBundleEncoder::pushDebugGroup(String&&)
{
    RETURN_IF_FINISHED();
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-pushdebuggroup

    if (!prepareTheEncoderState())
        return;

    ++m_debugGroupStackSize;
    // MTLIndirectCommandBuffers don't support debug commands.
}

void RenderBundleEncoder::setBindGroup(uint32_t groupIndex, const BindGroup* groupPtr, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    RETURN_IF_FINISHED();

    if (groupPtr && !isValidToUseWith(*groupPtr, *this)) {
        makeInvalid(@"setBindGroup: invalid bind group");
        return;
    }

    m_maxBindGroupSlot = std::max(groupIndex, m_maxBindGroupSlot);
    if (!replayingCommands()) {
        if (groupPtr)
            m_allBindGroups.add(protect(groupPtr));

        if (groupIndex >= m_device->limits().maxBindGroups) {
            makeInvalid(@"setBindGroup: groupIndex >= limits.maxBindGroups");
            return;
        }

        if (groupPtr) {
            auto& group = *groupPtr;
            if (dynamicOffsets) {
                RefPtr bindGroupLayout = group.bindGroupLayout();
                if (!bindGroupLayout) {
                    makeInvalid(@"GPURenderBundleEncoder.setBindGroup: bind group is nil");
                    return;
                }
                uint32_t maxDynamicOffset = 0;
                if (NSString* error = bindGroupLayout->errorValidatingDynamicOffsets(dynamicOffsets->span(), group, maxDynamicOffset)) {
                    makeInvalid([NSString stringWithFormat:@"GPURenderBundleEncoder.setBindGroup: %@", error]);
                    return;
                }
            }

            if (group.fragmentArgumentBuffer())
                m_icbDescriptor.maxFragmentBufferBindCount = std::max<NSUInteger>(m_icbDescriptor.maxFragmentBufferBindCount, 2 + groupIndex);
        }

        recordCommand([groupIndex, group = protect(groupPtr), protectedThis = protect(*this), dynamicOffsets = WTF::move(dynamicOffsets)]() mutable {
            protectedThis->setBindGroup(groupIndex, group.get(), WTF::move(dynamicOffsets));
            return false;
        });
        return;
    }

    if (!groupPtr) {
        m_bindGroups.remove(groupIndex);
        return;
    }

    auto& group = *groupPtr;
    uint32_t dynamicOffsetCount = dynamicOffsets ? dynamicOffsets->size() : 0;
    if (dynamicOffsetCount && m_bindGroupDynamicOffsets)
        m_bindGroupDynamicOffsets->set(groupIndex, WTF::move(*dynamicOffsets));

    for (const auto& resource : group.resources()) {
        ASSERT(resource.mtlResources.size() == resource.resourceUsages.size());
        for (size_t i = 0, resourceCount = resource.resourceUsages.size(); i < resourceCount; ++i) {
            auto& resourceUsage = resource.resourceUsages[i];
            ResourceUsageAndRenderStage* usageAndRenderStage = [[ResourceUsageAndRenderStage alloc] initWithUsage:resource.usage renderStages:resource.renderStages entryUsage:resourceUsage.usage binding:resourceUsage.binding resource:resourceUsage.resource];
            if (!addResource(m_resources, resource.mtlResources[i], usageAndRenderStage))
                return;
        }
        if (RefPtr renderPassEncoder = m_renderPassEncoder.get()) {
            for (size_t i = 0, resourceCount = resource.resourceUsages.size(); i < resourceCount; ++i) {
                auto& resourceUsage = resource.resourceUsages[i];
                if (!renderPassEncoder->setCommandEncoder(resourceUsage.resource))
                    return;
            }
        }
    }

    m_bindGroups.set(groupIndex, group);
    if (auto vertexBindGroupBufferIndex = m_device->vertexBufferIndexForBindGroup(groupIndex); group.vertexArgumentBuffer() && m_vertexBuffers.size() > vertexBindGroupBufferIndex) {
        if (!addResource(m_resources, group.vertexArgumentBuffer(), MTLRenderStageVertex))
            return;
        m_vertexBuffers[vertexBindGroupBufferIndex] = { .buffer = group.vertexArgumentBuffer(), .offset = 0, .dynamicOffsetCount = dynamicOffsetCount, .dynamicOffsets = dynamicOffsets->span().data(), .size = group.vertexArgumentBuffer().length };
    }
    if (group.fragmentArgumentBuffer() && m_fragmentBuffers.size() > groupIndex) {
        if (!addResource(m_resources, group.fragmentArgumentBuffer(), MTLRenderStageFragment))
            return;
        m_fragmentBuffers[groupIndex] = { .buffer = group.fragmentArgumentBuffer(), .offset = 0, .dynamicOffsetCount = dynamicOffsetCount, .dynamicOffsets = dynamicOffsets->span().data(), .size = group.fragmentArgumentBuffer().length };
    }
}

void RenderBundleEncoder::setIndexBuffer(Buffer& buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size)
{
    RETURN_IF_FINISHED();
    m_indexBuffer = buffer;
    RELEASE_ASSERT(m_indexBuffer);
    m_indexType = format == WGPUIndexFormat_Uint32 ? MTLIndexTypeUInt32 : MTLIndexTypeUInt16;
    m_indexBufferOffset = offset;
    m_indexBufferSize = size == WGPU_WHOLE_SIZE ? buffer.initialSize() : size;
    if (m_renderPassEncoder && !setCommandEncoder(buffer, m_renderPassEncoder))
        return;

    if (!isValidToUseWith(buffer, *this)) {
        makeInvalid(@"setIndexBuffer: invalid index buffer");
        return;
    }

    id<MTLBuffer> indexBuffer = m_indexBuffer->buffer();

    if (!replayingCommands()) {
        if (computedSizeOverflows(buffer, offset, size))  {
            makeInvalid(@"setIndexBuffer: computed size overflows");
            return;
        }

        auto indexSizeInBytes = (format == WGPUIndexFormat_Uint16 ? sizeof(uint16_t) : sizeof(uint32_t));
        if (!(buffer.usage() & WGPUBufferUsage_Index) || (offset % indexSizeInBytes)) {
            makeInvalid(@"setIndexBuffer: validation failed");
            return;
        }

        if (!isValidToUseWith(buffer, *this)) {
            makeInvalid(@"setIndexBuffer: buffer is not valid");
            return;
        }

        recordCommand([buffer = protect(buffer), format, offset, size, protectedThis = protect(*this)] {
            protectedThis->setIndexBuffer(buffer.get(), format, offset, size);
            return false;
        });
        return;
    }

    addResource(m_resources, indexBuffer, MTLRenderStageVertex, &buffer);
}

bool RenderBundleEncoder::icbNeedsToBeSplit(const RenderPipeline& a, const RenderPipeline& b)
{
    if (m_requiresCommandReplay || m_renderPassEncoder)
        return false;

    if (&a == &b)
        return false;

    if (a.sampleMask() != b.sampleMask())
        return true;

    if (a.cullMode() != b.cullMode())
        return true;

    if (a.frontFace() != b.frontFace())
        return true;

    if (a.depthClipMode() != b.depthClipMode())
        return true;

    MTLDepthStencilDescriptor *aDepthStencil = a.depthStencilDescriptor();
    MTLDepthStencilDescriptor *bDepthStencil = b.depthStencilDescriptor();
    if ((aDepthStencil || bDepthStencil) && ![aDepthStencil isEqual:bDepthStencil])
        return true;

    if (a.depthBias() != b.depthBias())
        return true;

    if (a.depthBiasSlopeScale() != b.depthBiasSlopeScale())
        return true;

    if (a.depthBiasClamp() != b.depthBiasClamp())
        return true;

    return false;
}

void RenderBundleEncoder::recordCommand(WTF::Function<bool(void)>&& function)
{
    if (!isValid())
        return;

    ASSERT(!m_renderPassEncoder || m_renderPassEncoder->renderCommandEncoder());
    RELEASE_ASSERT(!m_dynamicOffsetsFragmentBuffer);
    m_recordedCommands.append(WTF::move(function));
}

void RenderBundleEncoder::splitICB(bool needsPipelineReset)
{
    Ref device = m_device;
    if (m_indirectCommandBuffer.size > m_currentCommandIndex) {
        if (m_currentCommandIndex) {
            id<MTLIndirectCommandBuffer> newICB = makeICB(m_currentCommandIndex);
            m_indirectCommandBuffer = m_device->getQueue()->trimICB(newICB, m_indirectCommandBuffer, m_currentCommandIndex);
        } else
            m_indirectCommandBuffer = nil;
    }
    m_previousCommandCount -= m_currentCommandIndex;
    m_currentCommandIndex = 0;

    if (m_indirectCommandBuffer.size)
        [m_icbArray addObject:makeRenderBundleICBWithResources(m_indirectCommandBuffer, m_currentPipelineState, m_depthStencilState, m_cullMode, m_frontFace, m_depthClipMode, m_depthBias, m_depthBiasSlopeScale, m_depthBiasClamp, m_dynamicOffsetsFragmentBuffer, m_pipeline.get(), device.get(), m_minVertexCountForDrawCommand)];

    if (m_previousCommandCount)
        m_indirectCommandBuffer = makeICB(m_previousCommandCount);
    cleanup(needsPipelineReset);
}

void RenderBundleEncoder::setPipeline(const RenderPipeline& pipeline)
{
    RETURN_IF_FINISHED();

    if (!isValidToUseWith(pipeline, *this)) {
        makeInvalid(@"setPipeline: invalid index buffer");
        return;
    }

    id<MTLRenderPipelineState> previousRenderPipelineState = m_currentPipelineState;
    m_currentPipelineState = pipeline.icbRenderPipelineState();

    if (replayingCommands()) {
        auto currentPipeline = m_pipeline;
        if (m_pipeline && m_currentCommandIndex && icbNeedsToBeSplit(*currentPipeline, pipeline)) {
            m_currentPipelineState = previousRenderPipelineState;
            splitICB(false);
            m_currentPipelineState = pipeline.icbRenderPipelineState();
        }

        id<MTLDepthStencilState> previousDepthStencilState = m_depthStencilState;
        auto previous_cullMode = m_cullMode;
        auto previous_frontFace = m_frontFace;
        auto previous_depthClipmpde = m_depthClipMode;
        auto previous_depthBias = m_depthBias;
        auto previous_depthBiasSlopeScale = m_depthBiasSlopeScale;
        auto previous_depthBiasClamp = m_depthBiasClamp;

        m_depthStencilState = pipeline.depthStencilState();
        m_cullMode = pipeline.cullMode();
        m_frontFace = pipeline.frontFace();
        m_depthClipMode = pipeline.depthClipMode();
        m_primitiveType = pipeline.primitiveType();
        m_depthBias = pipeline.depthBias();
        m_depthBiasSlopeScale = pipeline.depthBiasSlopeScale();
        m_depthBiasClamp = pipeline.depthBiasClamp();
        m_sampleMask = pipeline.sampleMask();
        auto fragmentBufferIntSpan = makeSpanFromBuffer<uint32_t>(m_dynamicOffsetsFragmentBuffer);
        fragmentBufferIntSpan[2] = m_sampleMask;

        RefPtr renderPassEncoder = m_renderPassEncoder.get();
        if (renderPassEncoder) {
            if (NSString* error = renderPassEncoder->errorValidatingPipeline(pipeline)) {
                makeInvalid(error);
                return;
            }

        id<MTLRenderCommandEncoder> commandEncoder = renderPassEncoder->renderCommandEncoder();
        id<MTLRenderPipelineState> renderPipeline = m_currentPipelineState;
        if (renderPipeline && previousRenderPipelineState != m_currentPipelineState)
            [commandEncoder setRenderPipelineState:renderPipeline];
        id<MTLDepthStencilState> depthStencilState = m_depthStencilState;
        if (depthStencilState && previousDepthStencilState != depthStencilState)
            [commandEncoder setDepthStencilState:depthStencilState];

        if (previous_cullMode != m_cullMode)
            [commandEncoder setCullMode:m_cullMode];
        if (previous_frontFace != m_frontFace)
            [commandEncoder setFrontFacingWinding:m_frontFace];
        if (previous_depthClipmpde != m_depthClipMode)
            [commandEncoder setDepthClipMode:m_depthClipMode];
        if (previous_depthBias != m_depthBias || previous_depthBiasSlopeScale != m_depthBiasSlopeScale || previous_depthBiasClamp != m_depthBiasClamp)
            [commandEncoder setDepthBias:m_depthBias slopeScale:m_depthBiasSlopeScale clamp:m_depthBiasClamp];
        }
    } else {
        if (!pipeline.icbRenderPipelineState())
            return;

        if (!pipeline.validateRenderBundle(m_descriptor)) {
            makeInvalid(@"setPipeline: validation failed");
            return;
        }

        // FIXME: Remove after https://bugs.webkit.org/show_bug.cgi?id=26499 is implemented
        if (pipeline.sampleMask() != defaultSampleMask)
            m_requiresCommandReplay = true;

        recordCommand([pipeline = protect(pipeline), protectedThis = protect(*this)] {
            protectedThis->setPipeline(pipeline);
            return false;
        });
    }

    m_pipeline = pipeline;
}

void RenderBundleEncoder::setVertexBuffer(uint32_t slot, Buffer* optionalBuffer, uint64_t offset, uint64_t size)
{
    RETURN_IF_FINISHED();
    m_maxVertexBufferSlot = std::max(m_maxVertexBufferSlot, slot);

    if (optionalBuffer && !isValidToUseWith(*optionalBuffer, *this)) {
        makeInvalid(@"setVertexBuffer: invalid index buffer");
        return;
    }

    if (!replayingCommands()) {
        if (optionalBuffer) {
            auto& buffer = *optionalBuffer;
            if (!isValidToUseWith(buffer, *this)) {
                makeInvalid(@"setVertexBuffer: buffer is not valid");
                return;
            }
            if (computedSizeOverflows(buffer, offset, size)) {
                makeInvalid(@"setVertexBuffer: size overflowed");
                return;
            }
            if (slot >= m_device->limits().maxVertexBuffers || !(buffer.usage() & WGPUBufferUsage_Vertex) || (offset % 4)) {
                makeInvalid(@"setVertexBuffer: validation failed");
                return;
            }
        }

        recordCommand([slot, optionalBuffer = protect(optionalBuffer), offset, size, protectedThis = protect(*this)] {
            protectedThis->setVertexBuffer(slot, optionalBuffer.get(), offset, size);
            return false;
        });
    }

    if (!optionalBuffer) {
        if (slot < m_device->limits().maxVertexBuffers)
            m_utilizedBufferIndices.remove(slot);
        if (slot < m_vertexBuffers.size())
            m_vertexBuffers[slot] = BufferAndOffset();

        return;
    }

    auto& buffer = *optionalBuffer;
    m_utilizedBufferIndices.add(slot, size);
    if (!addResource(m_resources, buffer.buffer(), MTLRenderStageVertex, &buffer))
        return;

    m_vertexBuffers[slot] = { .buffer = buffer.buffer(), .offset = offset, .dynamicOffsetCount = 0, .dynamicOffsets = nullptr, .size = size };
    if (m_renderPassEncoder && !setCommandEncoder(buffer, m_renderPassEncoder))
        return;
}

void RenderBundleEncoder::setLabel(String&& label)
{
    m_indirectCommandBuffer.label = label.createNSString().get();
}

#undef RETURN_IF_FINISHED

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuRenderBundleEncoderReference(WGPURenderBundleEncoder renderBundleEncoder)
{
    WebGPU::fromAPI(renderBundleEncoder).ref();
}

void wgpuRenderBundleEncoderRelease(WGPURenderBundleEncoder renderBundleEncoder)
{
    WebGPU::fromAPI(renderBundleEncoder).deref();
}

void wgpuRenderBundleEncoderDraw(WGPURenderBundleEncoder renderBundleEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->draw(vertexCount, instanceCount, firstVertex, firstInstance);
}

void wgpuRenderBundleEncoderDrawIndexed(WGPURenderBundleEncoder renderBundleEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
}

void wgpuRenderBundleEncoderDrawIndexedIndirect(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset)
{
    RELEASE_ASSERT(indirectBuffer);
    protect(WebGPU::fromAPI(renderBundleEncoder))->drawIndexedIndirect(protect(WebGPU::fromAPI(indirectBuffer)), indirectOffset);
}

void wgpuRenderBundleEncoderDrawIndirect(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset)
{
    RELEASE_ASSERT(indirectBuffer);
    protect(WebGPU::fromAPI(renderBundleEncoder))->drawIndirect(protect(WebGPU::fromAPI(indirectBuffer)), indirectOffset);
}

WGPURenderBundle wgpuRenderBundleEncoderFinish(WGPURenderBundleEncoder renderBundleEncoder, const WGPURenderBundleDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(renderBundleEncoder))->finish(*descriptor));
}

void wgpuRenderBundleEncoderInsertDebugMarker(WGPURenderBundleEncoder renderBundleEncoder, const char* markerLabel)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->insertDebugMarker(WebGPU::fromAPI(markerLabel));
}

void wgpuRenderBundleEncoderPopDebugGroup(WGPURenderBundleEncoder renderBundleEncoder)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->popDebugGroup();
}

void wgpuRenderBundleEncoderPushDebugGroup(WGPURenderBundleEncoder renderBundleEncoder, const char* groupLabel)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->pushDebugGroup(WebGPU::fromAPI(groupLabel));
}

void NODELETE wgpuRenderBundleEncoderSetBindGroup(WGPURenderBundleEncoder, uint32_t, WGPUBindGroup, size_t, const uint32_t*)
{
}

void wgpuRenderBundleEncoderSetBindGroupWithDynamicOffsets(WGPURenderBundleEncoder renderBundleEncoder, uint32_t groupIndex, WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->setBindGroup(groupIndex, group ? protect(WebGPU::fromAPI(group)).ptr() : nullptr, WTF::move(dynamicOffsets));
}

void wgpuRenderBundleEncoderSetIndexBuffer(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->setIndexBuffer(protect(WebGPU::fromAPI(buffer)), format, offset, size);
}

void wgpuRenderBundleEncoderSetPipeline(WGPURenderBundleEncoder renderBundleEncoder, WGPURenderPipeline pipeline)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->setPipeline(protect(WebGPU::fromAPI(pipeline)));
}

void wgpuRenderBundleEncoderSetVertexBuffer(WGPURenderBundleEncoder renderBundleEncoder, uint32_t slot, WGPUBuffer buffer, uint64_t offset, uint64_t size)
{
    RefPtr<WebGPU::Buffer> optionalBuffer;
    if (buffer)
        optionalBuffer = protect(WebGPU::fromAPI(buffer)).ptr();
    protect(WebGPU::fromAPI(renderBundleEncoder))->setVertexBuffer(slot, optionalBuffer.get(), offset, size);
}

void wgpuRenderBundleEncoderSetLabel(WGPURenderBundleEncoder renderBundleEncoder, const char* label)
{
    protect(WebGPU::fromAPI(renderBundleEncoder))->setLabel(WebGPU::fromAPI(label));
}
