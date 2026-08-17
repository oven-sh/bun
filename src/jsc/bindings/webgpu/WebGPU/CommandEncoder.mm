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
#import "CommandEncoder.h"

#import "APIConversions.h"
#import "Buffer.h"
#import "CommandBuffer.h"
#import "ComputePassEncoder.h"
#import "Device.h"
#import "IsValidToUseWith.h"
#import "QuerySet.h"
#import "RenderPassEncoder.h"
#import "Texture.h"
#import "TextureOrTextureView.h"
#if ENABLE(WEBGPU_SWIFT)
#import "CxxBridging.h"
#import <WebGPU/CxxBridgingPublic.h>
#import <WebGPU/WGPUTextureImpl.h>
#import <WebGPU/WebGPU.h>
#import "WebGPUSwift-Generated.h"
#endif
#import <wtf/CheckedArithmetic.h>
#import <wtf/IndexedRange.h>
#import <wtf/TZoneMallocInlines.h>

@implementation TextureAndClearColor
- (instancetype)initWithTexture:(id<MTLTexture>)texture
{
    if (!(self = [super init]))
        return nil;

    _texture = texture;
    _clearColor = MTLClearColorMake(0, 0, 0, 0);

    return self;
}
@end

namespace WebGPU {

#define GENERATE_INVALID_ENCODER_STATE_ERROR() \
if (m_state == EncoderState::Ended) \
    protect(m_device)->generateAValidationError([NSString stringWithFormat:@"%s: encoder state is %@", __PRETTY_FUNCTION__, encoderStateName()]); \
else \
    makeInvalid(m_lastErrorString ?: @"Encoder state is locked");

void CommandEncoder::generateInvalidEncoderStateError()
{
    GENERATE_INVALID_ENCODER_STATE_ERROR();
}

static MTLLoadAction NODELETE loadAction(WGPULoadOp loadOp, bool readOnly = false)
{
    switch (loadOp) {
    case WGPULoadOp_Load:
        return MTLLoadActionLoad;
    case WGPULoadOp_Clear:
        return MTLLoadActionClear;
    case WGPULoadOp_Undefined:
        return readOnly ? MTLLoadActionLoad : MTLLoadActionDontCare;
    case WGPULoadOp_Force32:
        ASSERT_NOT_REACHED();
        return MTLLoadActionDontCare;
    }
}

static MTLStoreAction NODELETE storeAction(WGPUStoreOp storeOp, bool hasResolveTarget = false)
{
    switch (storeOp) {
    case WGPUStoreOp_Store:
        return hasResolveTarget ? MTLStoreActionStoreAndMultisampleResolve : MTLStoreActionStore;
    case WGPUStoreOp_Discard:
        return hasResolveTarget ? MTLStoreActionMultisampleResolve : MTLStoreActionDontCare;
    case WGPUStoreOp_Undefined:
        return hasResolveTarget ? MTLStoreActionMultisampleResolve : MTLStoreActionDontCare;
    case WGPUStoreOp_Force32:
        ASSERT_NOT_REACHED();
        return MTLStoreActionDontCare;
    }
}

Ref<CommandEncoder> Device::createCommandEncoder(const WGPUCommandEncoderDescriptor& descriptor)
{
    if (!isValid())
        return CommandEncoder::createInvalid(*this);

    captureFrameIfNeeded();
    // https://gpuweb.github.io/gpuweb/#dom-gpudevice-createcommandencoder

    auto *commandBufferDescriptor = [MTLCommandBufferDescriptor new];
    auto commandBuffer = protect(m_defaultQueue)->commandBufferWithDescriptor(commandBufferDescriptor);
    if (!commandBuffer)
        return CommandEncoder::createInvalid(*this);

    commandBuffer.label = createNSString(fromAPI(descriptor.label)).get();

    auto commandEncoder = CommandEncoder::create(commandBuffer, *this, m_commandEncoderId++);
    m_commandEncoderMap.set(commandEncoder->uniqueId(), commandEncoder.ptr());
    return commandEncoder;
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(CommandEncoder);

CommandEncoder::CommandEncoder(id<MTLCommandBuffer> commandBuffer, Device& device, uint64_t uniqueId)
    : m_commandBuffer(commandBuffer)
    , m_device(device)
    , m_uniqueId(uniqueId)
{
#if CPU(X86_64) && (1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */)
    m_managedTextures = [NSMutableSet set];
    m_managedBuffers = [NSMutableSet set];
#endif
    if (device.isShaderValidationEnabled()) {
        m_retainedBuffers = [NSMutableSet set];
        m_retainedTextures = [NSMutableSet set];
        m_retainedICBs = [NSMutableSet set];
    }
    m_retainedTimestampBuffers = [NSMutableSet set];

    addOnCommitHandler([](CommandBuffer& commandBuffer, CommandEncoder& commandEncoder) {
        for (auto& [bufferIdentifier, skippedDrawIndexedValidationKeys] : commandEncoder.m_skippedDrawIndexedValidationKeys) {
            RefPtr apiBuffer = commandBuffer.device().lookupBuffer(bufferIdentifier);
            if (!apiBuffer)
                continue;
            apiBuffer->removeSkippedValidationCommandEncoder(commandEncoder.uniqueId());
            if (apiBuffer->mustTakeSlowIndexValidationPath()) {
                for (auto& keyValuePair : skippedDrawIndexedValidationKeys) {
                    auto& key = keyValuePair.first;
                    auto& value = keyValuePair.second;
                    apiBuffer->takeSlowIndexValidationPath(commandBuffer, key.firstIndex, key.indexCount, key.indexType(), key.primitiveOffset(), value);
                    commandBuffer.addPostCommitHandler([bufferIdentifier, device = protect(commandBuffer.device())](id<MTLCommandBuffer>) {
                        if (RefPtr apiBuffer = device->lookupBuffer(bufferIdentifier))
                            apiBuffer->clearMustTakeSlowIndexValidationPath();
                    });
                }
            }
        }
        for (Ref group : commandEncoder.m_bindGroups)
            group->rebindSamplersIfNeeded();

        return true;
    });
}

CommandEncoder::CommandEncoder(Device& device)
    : m_device(device)
{
}

void CommandEncoder::retainTimestampsForOneUpdateLoop()
{
    // Workaround for rdar://143905417
    m_device->getQueue()->retainTimestampsForOneUpdate(m_retainedTimestampBuffers);
}

CommandEncoder::~CommandEncoder()
{
    finalizeBlitCommandEncoder();
    m_device->getQueue()->removeMTLCommandBuffer(m_commandBuffer);
    retainTimestampsForOneUpdateLoop();
    m_commandBuffer = nil; // Do not remove, this is needed to workaround rdar://143905417
    clearTracking();
    m_device->removeCommandEncoder(m_uniqueId);
}

id<MTLBlitCommandEncoder> CommandEncoder::ensureBlitCommandEncoder()
{
    if (m_commandBuffer.status >= MTLCommandBufferStatusEnqueued) {
        m_blitCommandEncoder = nil;
        return nil;
    }

    if (m_blitCommandEncoder) {
        if (encoderIsCurrent(m_blitCommandEncoder))
            return m_blitCommandEncoder;

        finalizeBlitCommandEncoder();
    }

    if (!m_device->isValid())
        return nil;

    MTLBlitPassDescriptor *descriptor = [MTLBlitPassDescriptor new];
    m_blitCommandEncoder = [m_commandBuffer blitCommandEncoderWithDescriptor:descriptor];
    setExistingEncoder(m_blitCommandEncoder);

    return m_blitCommandEncoder;
}

void CommandEncoder::finalizeBlitCommandEncoder()
{
    if (!encoderIsCurrent(m_blitCommandEncoder))
        return;

    endEncoding(m_blitCommandEncoder);
    m_blitCommandEncoder = nil;
    setExistingEncoder(nil);
}

static auto NODELETE timestampWriteIndex(auto writeIndex)
{
    return writeIndex == WGPU_QUERY_SET_INDEX_UNDEFINED ? 0 : writeIndex;
}

static NSUInteger NODELETE timestampWriteIndex(NSUInteger writeIndex, NSUInteger defaultValue, uint32_t offset)
{
    return writeIndex == WGPU_QUERY_SET_INDEX_UNDEFINED ? defaultValue : (writeIndex + offset);
}

static NSString* errorValidatingTimestampWrites(const auto& timestampWrites, const CommandEncoder& commandEncoder)
{
    if (timestampWrites) {
        if (!protect(commandEncoder.device())->hasFeature(WGPUFeatureName_TimestampQuery))
            return @"device does not have timestamp query feature";

        const auto& timestampWrite = *timestampWrites;
        Ref querySet = fromAPI(timestampWrite.querySet);
        if (querySet->type() != WGPUQueryType_Timestamp)
            return [NSString stringWithFormat:@"query type is not timestamp but %d", querySet->type()];

        if (!isValidToUseWith(querySet, commandEncoder))
            return @"device mismatch";

        auto querySetCount = querySet->count();
        auto beginningOfPassWriteIndex = timestampWriteIndex(timestampWrite.beginningOfPassWriteIndex);
        auto endOfPassWriteIndex = timestampWriteIndex(timestampWrite.endOfPassWriteIndex);
        if (beginningOfPassWriteIndex >= querySetCount || endOfPassWriteIndex >= querySetCount || timestampWrite.beginningOfPassWriteIndex == timestampWrite.endOfPassWriteIndex)
            return [NSString stringWithFormat:@"writeIndices mismatch: beginningOfPassWriteIndex(%u) >= querySetCount(%u) || endOfPassWriteIndex(%u) >= querySetCount(%u) || timestampWrite.beginningOfPassWriteIndex(%u) == timestampWrite.endOfPassWriteIndex(%u)", beginningOfPassWriteIndex, querySetCount, endOfPassWriteIndex, querySetCount, timestampWrite.beginningOfPassWriteIndex, timestampWrite.endOfPassWriteIndex];
    }

    return nil;
}

NSString* CommandEncoder::errorValidatingComputePassDescriptor(const WGPUComputePassDescriptor& descriptor) const
{
    return errorValidatingTimestampWrites(descriptor.timestampWrites, *this);
}

Ref<ComputePassEncoder> CommandEncoder::beginComputePass(const WGPUComputePassDescriptor& descriptor)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled())
        return commandEncoderBeginComputePass(this, descriptor);
#endif

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return ComputePassEncoder::createInvalid(*this, m_device, @"encoder state is invalid");
    }

    if (NSString* error = errorValidatingComputePassDescriptor(descriptor))
        return ComputePassEncoder::createInvalid(*this, m_device, error);

    if (m_commandBuffer.status >= MTLCommandBufferStatusEnqueued)
        return ComputePassEncoder::createInvalid(*this, m_device, @"command buffer has already been committed");

    finalizeBlitCommandEncoder();

    if (!m_device->isValid())
        return ComputePassEncoder::createInvalid(*this, m_device, @"GPUDevice was invalid, this will be an error submitting the command buffer");

    MTLComputePassDescriptor* computePassDescriptor = [MTLComputePassDescriptor new];
    computePassDescriptor.dispatchType = MTLDispatchTypeSerial;
    QuerySet::CounterSampleBuffer counterSampleBuffer;
    if (auto* wgpuTimestampWrites = descriptor.timestampWrites) {
        Ref timestampWrites = fromAPI(wgpuTimestampWrites->querySet);
        counterSampleBuffer = timestampWrites->counterSampleBufferWithOffset();
        timestampWrites->setCommandEncoder(*this);
    }

    if (m_device->enableEncoderTimestamps() || counterSampleBuffer.buffer) {
        auto* timestampWrites = descriptor.timestampWrites;
        computePassDescriptor.sampleBufferAttachments[0].sampleBuffer = counterSampleBuffer.buffer ?: m_device->timestampsBuffer(m_commandBuffer, 2);
        computePassDescriptor.sampleBufferAttachments[0].startOfEncoderSampleIndex = timestampWrites ? timestampWriteIndex(timestampWrites->beginningOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset) : 0;
        computePassDescriptor.sampleBufferAttachments[0].endOfEncoderSampleIndex = timestampWrites ? timestampWriteIndex(timestampWrites->endOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset) : 1;
        m_device->trackTimestampsBuffer(m_commandBuffer, counterSampleBuffer.buffer);
    }

    id<MTLComputeCommandEncoder> computeCommandEncoder = [m_commandBuffer computeCommandEncoderWithDescriptor:computePassDescriptor];
    setExistingEncoder(computeCommandEncoder);
    computeCommandEncoder.label = createNSString(descriptor.label).get();

    return ComputePassEncoder::create(computeCommandEncoder, descriptor, *this, m_device);
}

void CommandEncoder::setExistingEncoder(id<MTLCommandEncoder> encoder)
{
    ASSERT(!m_existingCommandEncoder || !encoder);
    m_existingCommandEncoder = encoder;
    m_device->getQueue()->setEncoderForBuffer(m_commandBuffer, encoder);
}

void CommandEncoder::discardCommandBuffer()
{
    if (!m_commandBuffer || m_commandBuffer.status >= MTLCommandBufferStatusCommitted) {
        retainTimestampsForOneUpdateLoop();
        m_commandBuffer = nil;
        return;
    }

    id<MTLCommandEncoder> existingEncoder = m_device->getQueue()->encoderForBuffer(m_commandBuffer);
    Ref queue = m_device->getQueue();
    queue->endEncoding(existingEncoder, m_commandBuffer);
    queue->removeMTLCommandBuffer(m_commandBuffer);
    retainTimestampsForOneUpdateLoop();
    m_commandBuffer = nil;
}

void CommandEncoder::endEncoding(id<MTLCommandEncoder> encoder)
{
    Ref queue = m_device->getQueue();
    id<MTLCommandEncoder> existingEncoder = queue->encoderForBuffer(m_commandBuffer);
    if (existingEncoder != encoder) {
        queue->endEncoding(existingEncoder, m_commandBuffer);
        setExistingEncoder(nil);
        if (m_lastErrorString)
            discardCommandBuffer();
        return;
    }

    queue->endEncoding(m_existingCommandEncoder, m_commandBuffer);
    setExistingEncoder(nil);
    m_blitCommandEncoder = nil;
    if (m_lastErrorString)
        discardCommandBuffer();
}

NSString* CommandEncoder::errorValidatingRenderPassDescriptor(const WGPURenderPassDescriptor& descriptor) const
{
    if (auto* wgpuOcclusionQuery = descriptor.occlusionQuerySet) {
        Ref occlusionQuery = fromAPI(wgpuOcclusionQuery);
        if (!isValidToUseWith(occlusionQuery, *this))
            return @"occlusion query does not match the device";
        if (occlusionQuery->type() != WGPUQueryType_Occlusion)
            return @"occlusion query type is not occlusion";
    }

    return errorValidatingTimestampWrites(descriptor.timestampWrites, *this);
}

bool Device::isStencilOnlyFormat(MTLPixelFormat format)
{
    switch (format) {
    case MTLPixelFormatStencil8:
    case MTLPixelFormatX32_Stencil8:
        return true;
    default:
        return false;
    }
}

id<MTLFunction> Device::nopVertexFunction(id<MTLDevice> device)
{
    static id<MTLFunction> function = [&] {
        NSError *error = nil;
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        id<MTLLibrary> library = [device newLibraryWithSource:@"[[vertex]] float4 vsNop() { return (float4)0; }" options:options error:&error];
        if (error)
            WTFLogAlways("%@", error); // NOLINT
        return [library newFunctionWithName:@"vsNop"];
    }();

    return function;
}

static std::pair<id<MTLRenderPipelineState>, id<MTLDepthStencilState>> createSimplePso(NSMutableDictionary<NSNumber*, TextureAndClearColor*> *attachmentsToClear, id<MTLTexture> depthStencilAttachmentToClear, bool depthAttachmentToClear, bool stencilAttachmentToClear, id<MTLDevice> device)
{
    MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];

    NSUInteger sampleCount = 0;
    MTLDepthStencilDescriptor *depthStencilDescriptor = nil;
    for (NSNumber *key in attachmentsToClear) {
        int i = key.intValue;
        TextureAndClearColor *textureAndClearColor = [attachmentsToClear objectForKey:key];
        id<MTLTexture> t = textureAndClearColor.texture;
        sampleCount = t.sampleCount;

        const auto& mtlColorAttachment = mtlRenderPipelineDescriptor.colorAttachments[i];
        mtlColorAttachment.pixelFormat = t.pixelFormat;
        mtlColorAttachment.blendingEnabled = NO;
    }

    if (depthStencilAttachmentToClear) {
        depthStencilDescriptor = [MTLDepthStencilDescriptor new];
        id<MTLTexture> t = depthStencilAttachmentToClear;
        sampleCount = t.sampleCount;
        mtlRenderPipelineDescriptor.depthAttachmentPixelFormat = (!depthAttachmentToClear || Device::isStencilOnlyFormat(t.pixelFormat)) ? MTLPixelFormatInvalid : t.pixelFormat;
        depthStencilDescriptor.depthWriteEnabled = NO;

        if (stencilAttachmentToClear && (t.pixelFormat == MTLPixelFormatDepth32Float_Stencil8 || t.pixelFormat == MTLPixelFormatStencil8 || t.pixelFormat == MTLPixelFormatX32_Stencil8))
            mtlRenderPipelineDescriptor.stencilAttachmentPixelFormat = t.pixelFormat;
    }

    id<MTLFunction> function = Device::nopVertexFunction(device);
    RELEASE_ASSERT(function);

    mtlRenderPipelineDescriptor.vertexFunction = function;
    mtlRenderPipelineDescriptor.fragmentFunction = nil;

    RELEASE_ASSERT(sampleCount);
    mtlRenderPipelineDescriptor.rasterSampleCount = sampleCount;
    mtlRenderPipelineDescriptor.inputPrimitiveTopology = MTLPrimitiveTopologyClassPoint;

    NSError* error;
    id<MTLRenderPipelineState> pso = [device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    id<MTLDepthStencilState> depthStencil = depthStencilDescriptor ? [device newDepthStencilStateWithDescriptor:depthStencilDescriptor] : nil;
    RELEASE_ASSERT(!error);
    ASSERT_UNUSED(error, !error);

    return std::make_pair(pso, depthStencil);
}

void CommandEncoder::runClearEncoder(NSMutableDictionary<NSNumber*, TextureAndClearColor*> *attachmentsToClear, id<MTLTexture> depthStencilAttachmentToClear, bool depthAttachmentToClear, bool stencilAttachmentToClear, float depthClearValue, uint32_t stencilClearValue, id<MTLRenderCommandEncoder> existingEncoder)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderRunClearEncoder(this, attachmentsToClear, depthStencilAttachmentToClear, depthAttachmentToClear, stencilAttachmentToClear, depthClearValue, stencilClearValue, existingEncoder);
        return;
    }
#endif

    if (!attachmentsToClear.count && !depthAttachmentToClear && !stencilAttachmentToClear) {
        endEncoding(existingEncoder);
        return;
    }

    if (!stencilAttachmentToClear && !depthAttachmentToClear)
        depthStencilAttachmentToClear = nil;

    id<MTLDevice> device = m_device->device();
    if (!device) {
        endEncoding(existingEncoder);
        return;
    }
    id<MTLRenderCommandEncoder> clearRenderCommandEncoder = existingEncoder;
    if (!clearRenderCommandEncoder) {
        MTLRenderPassDescriptor* clearDescriptor = [MTLRenderPassDescriptor new];
        if (depthAttachmentToClear) {
            clearDescriptor.depthAttachment.loadAction = MTLLoadActionClear;
            clearDescriptor.depthAttachment.storeAction = MTLStoreActionStore;
            clearDescriptor.depthAttachment.clearDepth = depthClearValue;
            clearDescriptor.depthAttachment.texture = depthStencilAttachmentToClear;
        }

        if (stencilAttachmentToClear) {
            clearDescriptor.stencilAttachment.loadAction = MTLLoadActionClear;
            clearDescriptor.stencilAttachment.storeAction = MTLStoreActionStore;
            clearDescriptor.stencilAttachment.clearStencil = stencilClearValue;
            clearDescriptor.stencilAttachment.texture = depthStencilAttachmentToClear;
        } else if (depthAttachmentToClear && depthStencilAttachmentToClear) {
            // Depth is being pre-cleared but stencil has valid data (previously cleared).
            // Load the stencil to preserve it — without this, the pre-clear pass uses
            // MTLLoadActionDontCare for stencil, silently discarding what was written.
            MTLPixelFormat fmt = depthStencilAttachmentToClear.pixelFormat;
            bool hasStencil = (fmt == MTLPixelFormatDepth32Float_Stencil8
                || fmt == MTLPixelFormatX32_Stencil8
                || fmt == MTLPixelFormatStencil8);
            if (hasStencil) {
                clearDescriptor.stencilAttachment.loadAction = MTLLoadActionLoad;
                clearDescriptor.stencilAttachment.storeAction = MTLStoreActionStore;
                clearDescriptor.stencilAttachment.texture = depthStencilAttachmentToClear;
            }
        }

        if (!attachmentsToClear.count) {
            RELEASE_ASSERT(depthStencilAttachmentToClear);
            clearDescriptor.defaultRasterSampleCount = depthStencilAttachmentToClear.sampleCount;
            clearDescriptor.renderTargetWidth = depthStencilAttachmentToClear.width;
            clearDescriptor.renderTargetHeight = depthStencilAttachmentToClear.height;
        }

        for (NSNumber *key in attachmentsToClear) {
            int i = key.intValue;
            TextureAndClearColor *textureAndClearColor = [attachmentsToClear objectForKey:key];
            id<MTLTexture> t = textureAndClearColor.texture;
            const auto& mtlAttachment = clearDescriptor.colorAttachments[i];
            mtlAttachment.loadAction = MTLLoadActionClear;
            mtlAttachment.storeAction = MTLStoreActionStore;
            mtlAttachment.clearColor = textureAndClearColor.clearColor;
            mtlAttachment.texture = t;
            mtlAttachment.level = 0;
            mtlAttachment.slice = 0;
            mtlAttachment.depthPlane = textureAndClearColor.depthPlane;
        }
        clearRenderCommandEncoder = [m_commandBuffer renderCommandEncoderWithDescriptor:clearDescriptor];
        setExistingEncoder(clearRenderCommandEncoder);
    }

    auto [pso, depthStencil] = createSimplePso(attachmentsToClear, depthStencilAttachmentToClear, depthAttachmentToClear, stencilAttachmentToClear, device);
    [clearRenderCommandEncoder setRenderPipelineState:pso];
    if (depthStencil)
        [clearRenderCommandEncoder setDepthStencilState:depthStencil];
    [clearRenderCommandEncoder setCullMode:MTLCullModeNone];
    [clearRenderCommandEncoder drawPrimitives:MTLPrimitiveTypePoint vertexStart:0 vertexCount:1 instanceCount:1 baseInstance:0];
    m_device->getQueue()->endEncoding(clearRenderCommandEncoder, m_commandBuffer);
    setExistingEncoder(nil);
}

static bool isMultisampleTexture(id<MTLTexture> texture)
{
    return texture.textureType == MTLTextureType2DMultisample || texture.textureType == MTLTextureType2DMultisampleArray;
}

Ref<RenderPassEncoder> CommandEncoder::beginRenderPass(const WGPURenderPassDescriptor& descriptor)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled())
        return commandEncoderBeginRenderPass(this, descriptor);
#endif

    auto maxDrawCount = descriptor.maxDrawCount;

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return RenderPassEncoder::createInvalid(*this, m_device, @"encoder state is not valid");
    }

    if (NSString* error = errorValidatingRenderPassDescriptor(descriptor))
        return RenderPassEncoder::createInvalid(*this, m_device, error);

    if (m_commandBuffer.status >= MTLCommandBufferStatusEnqueued)
        return RenderPassEncoder::createInvalid(*this, m_device, @"command buffer has already been committed");

    MTLRenderPassDescriptor* mtlDescriptor = [MTLRenderPassDescriptor new];
    QuerySet::CounterSampleBuffer counterSampleBuffer;
    if (auto* wgpuTimestampWrites = descriptor.timestampWrites) {
        Ref timestampWrites = fromAPI(wgpuTimestampWrites->querySet);
        timestampWrites->setCommandEncoder(*this);
        counterSampleBuffer = timestampWrites->counterSampleBufferWithOffset();
    }

    if (m_device->enableEncoderTimestamps() || counterSampleBuffer.buffer) {
        if (counterSampleBuffer.buffer) {
            mtlDescriptor.sampleBufferAttachments[0].sampleBuffer = counterSampleBuffer.buffer;
            mtlDescriptor.sampleBufferAttachments[0].startOfVertexSampleIndex = timestampWriteIndex(descriptor.timestampWrites->beginningOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset);
            mtlDescriptor.sampleBufferAttachments[0].endOfVertexSampleIndex = timestampWriteIndex(descriptor.timestampWrites->endOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset);
            mtlDescriptor.sampleBufferAttachments[0].startOfFragmentSampleIndex = timestampWriteIndex(descriptor.timestampWrites->endOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset);
            mtlDescriptor.sampleBufferAttachments[0].endOfFragmentSampleIndex = timestampWriteIndex(descriptor.timestampWrites->endOfPassWriteIndex, MTLCounterDontSample, counterSampleBuffer.offset);
            m_device->trackTimestampsBuffer(m_commandBuffer, counterSampleBuffer.buffer);
        } else {
            mtlDescriptor.sampleBufferAttachments[0].sampleBuffer = m_device->timestampsBuffer(m_commandBuffer, 4);
            mtlDescriptor.sampleBufferAttachments[0].startOfVertexSampleIndex = 0;
            mtlDescriptor.sampleBufferAttachments[0].endOfVertexSampleIndex = 1;
            mtlDescriptor.sampleBufferAttachments[0].startOfFragmentSampleIndex = 2;
            mtlDescriptor.sampleBufferAttachments[0].endOfFragmentSampleIndex = 3;
        }
    }

    if (descriptor.colorAttachmentCount > 8)
        return RenderPassEncoder::createInvalid(*this, m_device, @"color attachment count is > 8");

    finalizeBlitCommandEncoder();
    NSMutableDictionary<NSNumber*, TextureAndClearColor*> *attachmentsToClear = [NSMutableDictionary dictionary];
    bool zeroColorTargets = true;
    uint32_t bytesPerSample = 0;
    const auto maxColorAttachmentBytesPerSample = m_device->limits().maxColorAttachmentBytesPerSample;
    uint32_t textureWidth = 0, textureHeight = 0, sampleCount = 0;
    using SliceSet = HashSet<uint64_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>;
    HashMap<void*, SliceSet> depthSlices;
    for (auto [ i, attachment ] : indexedRange(descriptor.colorAttachmentsSpan())) {
        if (!attachment.view && !attachment.texture)
            continue;

        // MTLRenderPassColorAttachmentDescriptorArray is bounds-checked internally.
        const auto& mtlAttachment = mtlDescriptor.colorAttachments[i];

        mtlAttachment.clearColor = MTLClearColorMake(attachment.clearValue.r,
            attachment.clearValue.g,
            attachment.clearValue.b,
            attachment.clearValue.a);

        auto texture = attachment.view ? TextureOrTextureView(fromAPI(attachment.view)) : TextureOrTextureView(fromAPI(attachment.texture));

        if (!isValidToUseWith(texture, *this))
            return RenderPassEncoder::createInvalid(*this, m_device, @"device mismatch");
        if (textureWidth && (texture.width() != textureWidth || texture.height() != textureHeight || sampleCount != texture.sampleCount()))
            return RenderPassEncoder::createInvalid(*this, m_device, @"texture size does not match");
        textureWidth = texture.width();
        textureHeight = texture.height();
        sampleCount = texture.sampleCount();
        auto textureFormat = texture.format();
        bytesPerSample = roundUpToMultipleOfNonPowerOfTwo(Texture::renderTargetPixelByteAlignment(textureFormat), bytesPerSample);
        bytesPerSample += Texture::renderTargetPixelByteCost(textureFormat);
        if (bytesPerSample > maxColorAttachmentBytesPerSample)
            return RenderPassEncoder::createInvalid(*this, m_device, @"total bytes per sample exceeds limit");

        bool textureIsDestroyed = texture.isDestroyed();
        if (!textureIsDestroyed) {
            if (!(texture.usage() & WGPUTextureUsage_RenderAttachment) || !Texture::isColorRenderableFormat(textureFormat, m_device))
                return RenderPassEncoder::createInvalid(*this, m_device, @"color attachment is not renderable");

            if (!isRenderableTextureView(texture, attachment.loadOp, attachment.storeOp))
                return RenderPassEncoder::createInvalid(*this, m_device, @"texture view is not renderable");
        }
        if (!isAllowableTextureView(texture, attachment.loadOp, attachment.storeOp))
            return RenderPassEncoder::createInvalid(*this, m_device, @"texture view is not renderable");

        texture.setCommandEncoder(*this);

        id<MTLTexture> mtlTexture = texture.texture();
        mtlAttachment.texture = mtlTexture;
        if (!mtlAttachment.texture) {
            if (!textureIsDestroyed)
                return RenderPassEncoder::createInvalid(*this, m_device, @"color attachment's texture is nil");
            continue;
        }
        mtlAttachment.level = 0;
        mtlAttachment.slice = 0;
        uint64_t depthSliceOrArrayLayer = 0;
        if (attachment.depthSlice) {
            if (!texture.is3DTexture())
                return RenderPassEncoder::createInvalid(*this, m_device, @"depthSlice specified on 2D texture");
            depthSliceOrArrayLayer = textureIsDestroyed ? 0 : *attachment.depthSlice;
            if (depthSliceOrArrayLayer >= texture.depthOrArrayLayers())
                return RenderPassEncoder::createInvalid(*this, m_device, @"depthSlice is greater than texture's depth or array layers");

        } else {
            if (texture.is3DTexture())
                return RenderPassEncoder::createInvalid(*this, m_device, @"textureDimension is 3D and no depth slice is specified");
            depthSliceOrArrayLayer = textureIsDestroyed ? 0 : texture.baseArrayLayer();
        }

        auto* bridgedTexture = (__bridge void*)texture.parentTexture();
        auto baseMipLevel = textureIsDestroyed ? 0 : texture.baseMipLevel();
        uint64_t depthAndMipLevel = depthSliceOrArrayLayer | (static_cast<uint64_t>(baseMipLevel) << 32);
        if (auto it = depthSlices.find(bridgedTexture); it != depthSlices.end()) {
            auto addResult = it->value.add(depthAndMipLevel);
            if (!addResult.isNewEntry)
                return RenderPassEncoder::createInvalid(*this, m_device, @"attempting to render to overlapping color attachment");
        } else
            depthSlices.set(bridgedTexture, SliceSet { depthAndMipLevel });

        mtlAttachment.depthPlane = texture.is3DTexture() ? depthSliceOrArrayLayer : 0;
        mtlAttachment.slice = 0;
        mtlAttachment.loadAction = loadAction(attachment.loadOp);
        mtlAttachment.storeAction = storeAction(attachment.storeOp, !!attachment.resolveTarget || !!attachment.resolveTexture);

        zeroColorTargets = false;
        id<MTLTexture> textureToClear = nil;
        if (mtlAttachment.loadAction == MTLLoadActionLoad && !texture.previouslyCleared())
            textureToClear = mtlAttachment.texture;

        auto compositorTexture = texture;
        if (attachment.resolveTarget || attachment.resolveTexture) {
            auto resolveTarget = attachment.resolveTarget ? TextureOrTextureView(fromAPI(attachment.resolveTarget)) : TextureOrTextureView(fromAPI(attachment.resolveTexture));
            compositorTexture = resolveTarget;

            if (!isValidToUseWith(resolveTarget, *this))
                return RenderPassEncoder::createInvalid(*this, m_device, @"resolve target created from different device");
            resolveTarget.setCommandEncoder(*this);
            id<MTLTexture> resolveTexture = resolveTarget.texture();
            if (mtlTexture.sampleCount == 1 || resolveTexture.sampleCount != 1 || isMultisampleTexture(resolveTexture) || !isMultisampleTexture(mtlTexture) || !isRenderableTextureView(resolveTarget, attachment.loadOp, attachment.storeOp) || mtlTexture.pixelFormat != resolveTexture.pixelFormat || !Texture::supportsResolve(resolveTarget.format(), m_device))
                return RenderPassEncoder::createInvalid(*this, m_device, @"resolve target is invalid");

            mtlAttachment.resolveTexture = resolveTexture;
            mtlAttachment.resolveLevel = 0;
            mtlAttachment.resolveSlice = 0;
            mtlAttachment.resolveDepthPlane = 0;
            if (resolveTarget.width() != texture.width() || resolveTarget.height() != texture.height())
                return RenderPassEncoder::createInvalid(*this, m_device, [NSString stringWithFormat:@"resolve target dimensions (%u x %u) don't match expected dimensions (%u x %u)", resolveTarget.width(), resolveTarget.height(), texture.width(), texture.height()]);
        }

        if (id<MTLRasterizationRateMap> rateMap = compositorTexture.apiParentTexture().rasterizationMapForSlice(compositorTexture.parentRelativeSlice()))
            mtlDescriptor.rasterizationRateMap = rateMap;

        if (textureToClear) {
            TextureAndClearColor *textureWithResolve = [[TextureAndClearColor alloc] initWithTexture:textureToClear];
            [attachmentsToClear setObject:textureWithResolve forKey:@(i)];
            texture.setPreviouslyCleared();
            if (attachment.resolveTarget)
                protect(fromAPI(attachment.resolveTarget))->setPreviouslyCleared();
            if (attachment.resolveTexture)
                protect(fromAPI(attachment.resolveTexture))->setPreviouslyCleared();
        }
    }

    bool depthReadOnly = false, stencilReadOnly = false;
    bool hasStencilComponent = false;
    id<MTLTexture> depthStencilAttachmentToClear = nil;
    bool depthAttachmentToClear = false;
    bool hasDepthComponent = false;
    if (const auto* attachment = descriptor.depthStencilAttachment) {
        auto textureView = attachment->view ? TextureOrTextureView(fromAPI(attachment->view)) : TextureOrTextureView(fromAPI(attachment->texture));
        if (!isValidToUseWith(textureView, *this))
            return RenderPassEncoder::createInvalid(*this, m_device, @"depth stencil texture device mismatch");
        id<MTLTexture> metalDepthStencilTexture = textureView.texture();
        auto textureFormat = textureView.format();
        hasStencilComponent = Texture::containsStencilAspect(textureFormat);
        hasDepthComponent = Texture::containsDepthAspect(textureFormat);
        bool isDestroyed = textureView.isDestroyed();
        if (!isDestroyed) {
            if (textureWidth && (textureView.width() != textureWidth || textureView.height() != textureHeight || sampleCount != textureView.sampleCount()))
                return RenderPassEncoder::createInvalid(*this, m_device, @"depth stencil texture dimensions mismatch");
            if (textureView.arrayLayerCount() > 1 || textureView.mipLevelCount() > 1)
                return RenderPassEncoder::createInvalid(*this, m_device, @"depth stencil texture has more than one array layer or mip level");

            if (!Texture::isDepthStencilRenderableFormat(textureView.format(), m_device) || !isRenderableTextureView(textureView, attachment->depthLoadOp, attachment->depthStoreOp))
                return RenderPassEncoder::createInvalid(*this, m_device, @"depth stencil texture is not renderable");
        }

        if (!isAllowableTextureView(textureView, attachment->depthLoadOp, attachment->depthStoreOp))
            return RenderPassEncoder::createInvalid(*this, m_device, @"depth stencil texture is not renderable");

        depthReadOnly = attachment->depthReadOnly;
        if (hasDepthComponent) {
            const auto& mtlAttachment = mtlDescriptor.depthAttachment;
            auto clearDepth = std::clamp(RenderPassEncoder::quantizedDepthValue(attachment->depthClearValue, textureView.format()), 0., 1.);
            mtlAttachment.clearDepth = attachment->depthLoadOp == WGPULoadOp_Clear ? clearDepth : 1.0;
            mtlAttachment.texture = metalDepthStencilTexture;
            mtlAttachment.level = 0;
            mtlAttachment.loadAction = loadAction(attachment->depthLoadOp, attachment->depthReadOnly);
            mtlAttachment.storeAction = storeAction(attachment->depthStoreOp);

            if (mtlAttachment.loadAction == MTLLoadActionLoad && mtlAttachment.storeAction == MTLStoreActionDontCare && !textureView.previouslyCleared()) {
                depthStencilAttachmentToClear = mtlAttachment.texture;
                depthAttachmentToClear = !!mtlAttachment.texture;
            }
        }

        if (!isDestroyed) {
            if (hasDepthComponent && !depthReadOnly) {
                if (attachment->depthLoadOp == WGPULoadOp_Undefined || attachment->depthStoreOp == WGPUStoreOp_Undefined)
                    return RenderPassEncoder::createInvalid(*this, m_device, @"depth load and store op were not specified");
            } else if (attachment->depthLoadOp != WGPULoadOp_Undefined || attachment->depthStoreOp != WGPUStoreOp_Undefined)
                return RenderPassEncoder::createInvalid(*this, m_device, @"depth load and store op were specified");
        }

        if (attachment->depthLoadOp == WGPULoadOp_Clear && (attachment->depthClearValue < 0 || attachment->depthClearValue > 1))
            return RenderPassEncoder::createInvalid(*this, m_device, @"depth clear value is invalid");

        if (zeroColorTargets) {
            mtlDescriptor.defaultRasterSampleCount = metalDepthStencilTexture.sampleCount;
            if (!mtlDescriptor.defaultRasterSampleCount)
                return RenderPassEncoder::createInvalid(*this, m_device, @"no color targets and depth-stencil texture is nil");
            mtlDescriptor.renderTargetWidth = metalDepthStencilTexture.width;
            mtlDescriptor.renderTargetHeight = metalDepthStencilTexture.height;
        }
    }

    bool stencilAttachmentToClear = false;
    if (const auto* attachment = descriptor.depthStencilAttachment) {
        const auto& mtlAttachment = mtlDescriptor.stencilAttachment;
        stencilReadOnly = attachment->stencilReadOnly;
        auto textureView = attachment->view ? TextureOrTextureView(fromAPI(attachment->view)) : TextureOrTextureView(fromAPI(attachment->texture));
        if (hasStencilComponent)
            mtlAttachment.texture = textureView.texture();
        mtlAttachment.clearStencil = attachment->stencilClearValue;
        mtlAttachment.loadAction = loadAction(attachment->stencilLoadOp, attachment->stencilReadOnly);
        mtlAttachment.storeAction = storeAction(attachment->stencilStoreOp);

        bool isDestroyed = textureView.isDestroyed();
        if (!isDestroyed) {
            if (hasStencilComponent && !stencilReadOnly) {
                if (attachment->stencilLoadOp == WGPULoadOp_Undefined || attachment->stencilStoreOp == WGPUStoreOp_Undefined)
                    return RenderPassEncoder::createInvalid(*this, m_device, @"stencil load and store op were not specified");
            } else if (attachment->stencilLoadOp != WGPULoadOp_Undefined || attachment->stencilStoreOp != WGPUStoreOp_Undefined)
                return RenderPassEncoder::createInvalid(*this, m_device, @"stencil load and store op were specified");
        }

        textureView.setCommandEncoder(*this);

        if (hasStencilComponent && mtlAttachment.loadAction == MTLLoadActionLoad && mtlAttachment.storeAction == MTLStoreActionDontCare && !textureView.previouslyCleared()) {
            depthStencilAttachmentToClear = mtlAttachment.texture;
            stencilAttachmentToClear = !!mtlAttachment.texture;
        }
    }

    if (zeroColorTargets && !mtlDescriptor.renderTargetWidth)
        return RenderPassEncoder::createInvalid(*this, m_device, @"zero color and depth targets");

    size_t visibilityResultBufferSize = 0;
    id<MTLBuffer> visibilityResultBuffer = nil;
    if (auto* wgpuOcclusionQuery = descriptor.occlusionQuerySet) {
        Ref occlusionQuery = fromAPI(wgpuOcclusionQuery);
        occlusionQuery->setCommandEncoder(*this);
        if (occlusionQuery->type() != WGPUQueryType_Occlusion)
            return RenderPassEncoder::createInvalid(*this, m_device, @"querySet for occlusion query was not of type occlusion");
        mtlDescriptor.visibilityResultBuffer = occlusionQuery->visibilityBuffer();
        visibilityResultBuffer = mtlDescriptor.visibilityResultBuffer;
        visibilityResultBufferSize = occlusionQuery->isDestroyed() ? NSUIntegerMax : occlusionQuery->visibilityBuffer().length;
    }

    if (attachmentsToClear.count || depthStencilAttachmentToClear) {
        if (const auto* attachment = descriptor.depthStencilAttachment; depthStencilAttachmentToClear) {
            auto textureView = attachment->view ? TextureOrTextureView(fromAPI(attachment->view)) : TextureOrTextureView(fromAPI(attachment->texture));
            textureView.setPreviouslyCleared();
        }

        runClearEncoder(attachmentsToClear, depthStencilAttachmentToClear, depthAttachmentToClear, stencilAttachmentToClear);
    }

    if (!m_device->isValid())
        return RenderPassEncoder::createInvalid(*this, m_device, @"GPUDevice was invalid, this will be an error submitting the command buffer");

    auto mtlRenderCommandEncoder = [m_commandBuffer renderCommandEncoderWithDescriptor:mtlDescriptor];
    ASSERT(!m_existingCommandEncoder);
    setExistingEncoder(mtlRenderCommandEncoder);
    return RenderPassEncoder::create(mtlRenderCommandEncoder, descriptor, visibilityResultBufferSize, depthReadOnly, stencilReadOnly, *this, visibilityResultBuffer, maxDrawCount, m_device, mtlDescriptor);
}

id<MTLCommandBuffer> CommandEncoder::commandBuffer() const
{
    return m_commandBuffer;
}

NSString* CommandEncoder::errorValidatingCopyBufferToBuffer(const Buffer& source, uint64_t sourceOffset, const Buffer& destination, uint64_t destinationOffset, uint64_t size)
{
#define ERROR_STRING(x) (@"GPUCommandEncoder.copyBufferToBuffer: " x)
    if (!source.isDestroyed() && !isValidToUseWith(source, *this))
        return ERROR_STRING(@"source buffer is not valid");

    if (!destination.isDestroyed() && !isValidToUseWith(destination, *this))
        return ERROR_STRING(@"destination buffer is not valid");

    if (!(source.usage() & WGPUBufferUsage_CopySrc))
        return ERROR_STRING(@"source usage does not have COPY_SRC");

    if (!(destination.usage() & WGPUBufferUsage_CopyDst))
        return ERROR_STRING(@"destination usage does not have COPY_DST");

    if (destination.state() == Buffer::State::MappingPending || source.state() == Buffer::State::MappingPending)
        return ERROR_STRING(@"destination state is not unmapped or source state is not unmapped");

    if (size % 4)
        return ERROR_STRING(@"size is not a multiple of 4");

    if (sourceOffset % 4)
        return ERROR_STRING(@"source offset is not a multiple of 4");

    if (destinationOffset % 4)
        return ERROR_STRING(@"destination offset is not a multiple of 4");

    auto sourceEnd = checkedSum<uint64_t>(sourceOffset, size);
    if (sourceEnd.hasOverflowed())
        return ERROR_STRING(@"source size + offset overflows");

    auto destinationEnd = checkedSum<uint64_t>(destinationOffset, size);
    if (destinationEnd.hasOverflowed())
        return ERROR_STRING(@"destination size + offset overflows");

    if (source.initialSize() < sourceEnd.value())
        return ERROR_STRING(@"source size + offset overflows");

    if (destination.initialSize() < destinationEnd.value())
        return ERROR_STRING(@"destination size + offset overflows");

    if (&source == &destination)
        return ERROR_STRING(@"source equals destination not valid");

#undef ERROR_STRING
    return nil;
}

void CommandEncoder::incrementBufferMapCount()
{
    ++m_bufferMapCount;
    if (RefPtr commandBuffer = m_cachedCommandBuffer.get())
        commandBuffer->setBufferMapCount(m_bufferMapCount);
}

void CommandEncoder::decrementBufferMapCount()
{
    if (m_bufferMapCount <= 0)
        return;
    --m_bufferMapCount;
    if (RefPtr commandBuffer = m_cachedCommandBuffer.get())
        commandBuffer->setBufferMapCount(m_bufferMapCount);
}

void CommandEncoder::copyBufferToBuffer(const Buffer& source, uint64_t sourceOffset, Buffer& destination, uint64_t destinationOffset, uint64_t size)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        // FIXME: rdar://138047285
        commandEncoderCopyBufferToBuffer(this, &const_cast<Buffer&>(source), sourceOffset, &destination, destinationOffset, size);
        return;
    }
#endif

    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-copybuffertobuffer
    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (NSString* error = errorValidatingCopyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size)) {
        makeInvalid(error);
        return;
    }

    source.setCommandEncoder(*this);
    destination.setCommandEncoder(*this);
    destination.indirectBufferInvalidated(*this);
    if (!size || source.isDestroyed() || destination.isDestroyed())
        return;

    ensureBlitCommandEncoder();

    [m_blitCommandEncoder copyFromBuffer:source.buffer() sourceOffset:static_cast<NSUInteger>(sourceOffset) toBuffer:destination.buffer() destinationOffset:static_cast<NSUInteger>(destinationOffset) size:static_cast<NSUInteger>(size)];
}

NSString* CommandEncoder::errorValidatingImageCopyBuffer(const WGPUImageCopyBuffer& imageCopyBuffer) const
{
    // https://gpuweb.github.io/gpuweb/#abstract-opdef-validating-gpuimagecopybuffer
    Ref buffer = fromAPI(imageCopyBuffer.buffer);
    if (!isValidToUseWith(buffer, *this))
        return @"buffer is not valid";

    if (imageCopyBuffer.layout.bytesPerRow != WGPU_COPY_STRIDE_UNDEFINED && (imageCopyBuffer.layout.bytesPerRow % 256))
        return @"imageCopyBuffer.layout.bytesPerRow is not a multiple of 256";

    return nil;
}

static bool NODELETE refersToAllAspects(WGPUTextureFormat format, WGPUTextureAspect aspect)
{
    switch (aspect) {
    case WGPUTextureAspect_All:
        return true;
    case WGPUTextureAspect_StencilOnly:
        return Texture::containsStencilAspect(format) && !Texture::containsDepthAspect(format);
    case WGPUTextureAspect_DepthOnly:
        return Texture::containsDepthAspect(format) && !Texture::containsStencilAspect(format);
    case WGPUTextureAspect_Force32:
        ASSERT_NOT_REACHED();
        return false;
    }
}

NSString* CommandEncoder::errorValidatingCopyBufferToTexture(const WGPUImageCopyBuffer& source, const WGPUImageCopyTexture& destination, const WGPUExtent3D& copySize) const
{
#define ERROR_STRING(x) [NSString stringWithFormat:@"GPUCommandEncoder.copyBufferToTexture: %@", x]
    Ref destinationTexture = fromAPI(destination.texture);
    Ref sourceBuffer = fromAPI(source.buffer);

    if (NSString* error = errorValidatingImageCopyBuffer(source))
        return ERROR_STRING(error);

    if (!(sourceBuffer->usage() & WGPUBufferUsage_CopySrc))
        return ERROR_STRING(@"source usage does not contain CopySrc");

    if (!isValidToUseWith(destinationTexture, *this))
        return ERROR_STRING(@"destination texture is not valid to use with this GPUCommandEncoder");

    if (NSString* error = Texture::errorValidatingImageCopyTexture(destination, copySize))
        return ERROR_STRING(error);

    if (!(destinationTexture->usage() & WGPUTextureUsage_CopyDst))
        return ERROR_STRING(@"destination usage does not contain CopyDst");

    if (destinationTexture->sampleCount() != 1)
        return ERROR_STRING(@"destination sample count is not one");

    WGPUTextureFormat aspectSpecificFormat = destinationTexture->format();

    if (Texture::isDepthOrStencilFormat(destinationTexture->format())) {
        if (!Texture::refersToSingleAspect(destinationTexture->format(), destination.aspect))
            return ERROR_STRING(@"destination aspect refers to more than one asepct");

        if (!Texture::isValidDepthStencilCopyDestination(destinationTexture->format(), destination.aspect))
            return ERROR_STRING(@"destination is not valid depthStencilCopyDestination");

        aspectSpecificFormat = Texture::aspectSpecificFormat(destinationTexture->format(), destination.aspect);
    }

    if (NSString* error = Texture::errorValidatingTextureCopyRange(destination, copySize))
        return ERROR_STRING(error);

    if (!Texture::isDepthOrStencilFormat(destinationTexture->format())) {
        auto texelBlockSize = Texture::texelBlockSize(destinationTexture->format());
        if (source.layout.offset % texelBlockSize.value())
            return ERROR_STRING(@"source.layout.offset is not a multiple of texelBlockSize");
    }

    if (Texture::isDepthOrStencilFormat(destinationTexture->format())) {
        if (source.layout.offset % 4)
            return ERROR_STRING(@"source.layout.offset is not a multiple of four for depth stencil format");
    }

    if (NSString* errorString = Texture::errorValidatingLinearTextureData(source.layout, fromAPI(source.buffer).initialSize(), aspectSpecificFormat, copySize))
        return ERROR_STRING(errorString);
#undef ERROR_STRING
    return nil;
}

void CommandEncoder::copyBufferToTexture(const WGPUImageCopyBuffer& source, const WGPUImageCopyTexture& destination, const WGPUExtent3D& copySize)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderCopyBufferToTexture(this, source, destination, copySize);
        return;
    }
#endif

    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-copybuffertotexture

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    Ref destinationTexture = fromAPI(destination.texture);
    if (NSString* error = errorValidatingCopyBufferToTexture(source, destination, copySize)) {
        makeInvalid(error);
        return;
    }

    Ref apiBuffer = fromAPI(source.buffer);
    apiBuffer->setCommandEncoder(*this);
    destinationTexture->setCommandEncoder(*this);

    if (!copySize.width && !copySize.height && !copySize.depthOrArrayLayers)
        return;

    if (apiBuffer->isDestroyed() || destinationTexture->isDestroyed())
        return;

    ensureBlitCommandEncoder();

    NSUInteger sourceBytesPerRow = source.layout.bytesPerRow;
    id<MTLBuffer> sourceBuffer = apiBuffer->buffer();
    RELEASE_ASSERT(sourceBuffer);
    if (sourceBytesPerRow == WGPU_COPY_STRIDE_UNDEFINED)
        sourceBytesPerRow = sourceBuffer.length;

    auto aspectSpecificFormat = Texture::aspectSpecificFormat(destinationTexture->format(), destination.aspect);
    auto blockSize = Texture::texelBlockSize(aspectSpecificFormat);
    switch (destinationTexture->dimension()) {
    case WGPUTextureDimension_1D: {
        auto checkedBlockSizeTimesTextureDimension = checkedProduct<uint32_t>(blockSize, m_device->limits().maxTextureDimension1D);
        sourceBytesPerRow = checkedBlockSizeTimesTextureDimension.hasOverflowed() ? sourceBytesPerRow : std::min<uint32_t>(sourceBytesPerRow, checkedBlockSizeTimesTextureDimension.value());
    } break;
    case WGPUTextureDimension_2D:
    case WGPUTextureDimension_3D: {
        auto checkedBlockSizeTimesTextureDimension = checkedProduct<uint32_t>(blockSize, m_device->limits().maxTextureDimension2D);
        sourceBytesPerRow = checkedBlockSizeTimesTextureDimension.hasOverflowed() ? sourceBytesPerRow : std::min<uint32_t>(sourceBytesPerRow, checkedBlockSizeTimesTextureDimension.value());
    } break;
    case WGPUTextureDimension_Force32:
        break;
    }


    MTLBlitOption options = MTLBlitOptionNone;
    switch (destination.aspect) {
    case WGPUTextureAspect_All:
        options = MTLBlitOptionNone;
        break;
    case WGPUTextureAspect_StencilOnly:
        options = MTLBlitOptionStencilFromDepthStencil;
        break;
    case WGPUTextureAspect_DepthOnly:
        options = MTLBlitOptionDepthFromDepthStencil;
        break;
    case WGPUTextureAspect_Force32:
        ASSERT_NOT_REACHED();
        return;
    }

    auto logicalSize = protect(fromAPI(destination.texture))->logicalMiplevelSpecificTextureExtent(destination.mipLevel);
    auto widthForMetal = logicalSize.width < destination.origin.x ? 0 : std::min(copySize.width, logicalSize.width - destination.origin.x);
    auto heightForMetal = logicalSize.height < destination.origin.y ? 0 : std::min(copySize.height, logicalSize.height - destination.origin.y);
    auto depthForMetal = logicalSize.depthOrArrayLayers < destination.origin.z ? 0 : std::min(copySize.depthOrArrayLayers, logicalSize.depthOrArrayLayers - destination.origin.z);

    auto rowsPerImage = source.layout.rowsPerImage;
    if (rowsPerImage == WGPU_COPY_STRIDE_UNDEFINED)
        rowsPerImage = heightForMetal ?: 1;

    auto checkedSourceBytesPerImage = checkedProduct<NSUInteger>(rowsPerImage, sourceBytesPerRow);
    if (checkedSourceBytesPerImage.hasOverflowed())
        return;
    NSUInteger sourceBytesPerImage = checkedSourceBytesPerImage.value();

    id<MTLTexture> mtlDestinationTexture = destinationTexture->texture();

    auto textureDimension = destinationTexture->dimension();
    uint32_t sliceCount = textureDimension == WGPUTextureDimension_3D ? 1 : copySize.depthOrArrayLayers;
    for (uint32_t layer = 0; layer < sliceCount; ++layer) {
        auto originPlusLayer = checkedSum<NSUInteger>(destination.origin.z, layer);
        if (originPlusLayer.hasOverflowed())
            return;
        NSUInteger destinationSlice = destinationTexture->dimension() == WGPUTextureDimension_3D ? 0 : originPlusLayer.value();
        RELEASE_ASSERT(mtlDestinationTexture.parentTexture == nil);
        if (Queue::writeWillCompletelyClear(textureDimension, widthForMetal, logicalSize.width, heightForMetal, logicalSize.height, depthForMetal, logicalSize.depthOrArrayLayers))
            destinationTexture->setPreviouslyCleared(destination.mipLevel, destinationSlice);
        else
            clearTextureIfNeeded(destination, destinationSlice);
    }

    NSUInteger maxSourceBytesPerRow = textureDimension == WGPUTextureDimension_3D ? (2048 * blockSize.value()) : sourceBytesPerRow;

    if (textureDimension == WGPUTextureDimension_3D && copySize.depthOrArrayLayers <= 1 && copySize.height <= 1)
        sourceBytesPerRow = 0;

    if (sourceBytesPerRow > maxSourceBytesPerRow) {
        for (uint32_t z = 0; z < copySize.depthOrArrayLayers; ++z) {
            auto destinationOriginPlusZ = checkedSum<uint32_t>(destination.origin.z, z);
            auto zTimesSourceBytesPerImage = checkedProduct<uint32_t>(z, sourceBytesPerImage);
            if (zTimesSourceBytesPerImage.hasOverflowed())
                return;
            for (uint32_t y = 0; y < copySize.height; ++y) {
                auto yTimesSourceBytesPerImage = checkedProduct<uint32_t>(y, sourceBytesPerRow);
                if (yTimesSourceBytesPerImage.hasOverflowed())
                    return;
                auto tripleSum = checkedSum<uint64_t>(zTimesSourceBytesPerImage.value(), yTimesSourceBytesPerImage.value(), source.layout.offset);
                if (tripleSum.hasOverflowed())
                    return;
                WGPUImageCopyBuffer newSource {
                    .layout = WGPUTextureDataLayout {
                        .offset = tripleSum.value(),
                        .bytesPerRow = WGPU_COPY_STRIDE_UNDEFINED,
                        .rowsPerImage = WGPU_COPY_STRIDE_UNDEFINED,
                    },
                    .buffer = source.buffer
                };
                auto destinationOriginPlusY = checkedSum<uint32_t>(destination.origin.y, y);
                if (destinationOriginPlusY.hasOverflowed())
                    return;
                WGPUImageCopyTexture newDestination {
                    .texture = destination.texture,
                    .mipLevel = destination.mipLevel,
                    .origin = { .x = destination.origin.x, .y = destinationOriginPlusY.value(), .z = destinationOriginPlusZ.value() },
                    .aspect = destination.aspect
                };

                copyBufferToTexture(newSource, newDestination, {
                    .width = copySize.width,
                    .height = 1,
                    .depthOrArrayLayers = 1
                });
            }
        }
        return;
    }

    if (sourceBuffer.length < Texture::bytesPerRow(aspectSpecificFormat, widthForMetal, destinationTexture->sampleCount()))
        return;

    switch (destinationTexture->dimension()) {
    case WGPUTextureDimension_1D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400771-copyfrombuffer?language=objc
        // "When you copy to a 1D texture, height and depth must be 1."
        auto sourceSize = MTLSizeMake(widthForMetal, 1, 1);
        if (!widthForMetal)
            return;

        auto destinationOrigin = MTLOriginMake(destination.origin.x, 0, 0);
        auto widthTimesBlockSize = checkedProduct<uint32_t>(widthForMetal, blockSize);
        if (widthTimesBlockSize.hasOverflowed())
            return;
        sourceBytesPerRow = std::min<NSUInteger>(sourceBytesPerRow, widthTimesBlockSize.value());
        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto layerTimesSourceBytesPerImage = checkedProduct<NSUInteger>(layer, sourceBytesPerImage);
            if (layerTimesSourceBytesPerImage.hasOverflowed())
                return;

            auto checkedSourceOffset = checkedSum<NSUInteger>(source.layout.offset, layerTimesSourceBytesPerImage.value());
            auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (checkedSourceOffset.hasOverflowed() || checkedDestinationSlice.hasOverflowed())
                return;
            auto sourceOffset = checkedSourceOffset.value();
            NSUInteger destinationSlice = checkedDestinationSlice.value();
            auto sourceOffsetPlusSourceBytesPerRow = checkedSum<NSUInteger>(sourceOffset, sourceBytesPerRow);
            if (sourceOffsetPlusSourceBytesPerRow.hasOverflowed())
                return;
            if (sourceOffsetPlusSourceBytesPerRow.value() > sourceBuffer.length)
                continue;
            [m_blitCommandEncoder
                copyFromBuffer:sourceBuffer
                sourceOffset:sourceOffset
                sourceBytesPerRow:sourceBytesPerRow
                sourceBytesPerImage:sourceBytesPerImage
                sourceSize:sourceSize
                toTexture:mtlDestinationTexture
                destinationSlice:destinationSlice
                destinationLevel:destination.mipLevel
                destinationOrigin:destinationOrigin
                options:options];
        }
        break;
    }
    case WGPUTextureDimension_2D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400771-copyfrombuffer?language=objc
        // "When you copy to a 2D texture, depth must be 1."
        auto sourceSize = MTLSizeMake(widthForMetal, heightForMetal, 1);
        if (!widthForMetal || !heightForMetal)
            return;

        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, 0);
        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto layerTimesSourceBytesPerImage = checkedProduct<NSUInteger>(layer, sourceBytesPerImage);
            if (layerTimesSourceBytesPerImage.hasOverflowed())
                return;
            auto checkedSourceOffset = checkedSum<NSUInteger>(source.layout.offset, layerTimesSourceBytesPerImage.value());
            if (checkedSourceOffset.hasOverflowed())
                return;
            auto sourceOffset = checkedSourceOffset;

            auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (checkedDestinationSlice.hasOverflowed())
                return;
            NSUInteger destinationSlice = checkedDestinationSlice.value();
            [m_blitCommandEncoder
                copyFromBuffer:sourceBuffer
                sourceOffset:sourceOffset
                sourceBytesPerRow:sourceBytesPerRow
                sourceBytesPerImage:sourceBytesPerImage
                sourceSize:sourceSize
                toTexture:mtlDestinationTexture
                destinationSlice:destinationSlice
                destinationLevel:destination.mipLevel
                destinationOrigin:destinationOrigin
                options:options];
        }
        break;
    }
    case WGPUTextureDimension_3D: {
        auto sourceSize = MTLSizeMake(widthForMetal, heightForMetal, depthForMetal);
        if (!widthForMetal || !heightForMetal || !depthForMetal)
            return;

        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, destination.origin.z);
        auto sourceOffset = static_cast<NSUInteger>(source.layout.offset);
        [m_blitCommandEncoder
            copyFromBuffer:sourceBuffer
            sourceOffset:sourceOffset
            sourceBytesPerRow:sourceBytesPerRow
            sourceBytesPerImage:sourceBytesPerImage
            sourceSize:sourceSize
            toTexture:mtlDestinationTexture
            destinationSlice:0
            destinationLevel:destination.mipLevel
            destinationOrigin:destinationOrigin
            options:options];
        break;
    }
    case WGPUTextureDimension_Force32:
        ASSERT_NOT_REACHED();
        return;
    }
}

NSString* CommandEncoder::errorValidatingCopyTextureToBuffer(const WGPUImageCopyTexture& source, const WGPUImageCopyBuffer& destination, const WGPUExtent3D& copySize) const
{
#define ERROR_STRING(x) [NSString stringWithFormat:@"GPUCommandEncoder.copyTextureToBuffer: %@", x]
    Ref sourceTexture = fromAPI(source.texture);

    if (!isValidToUseWith(sourceTexture, *this))
        return ERROR_STRING(@"source texture is not valid to use with this GPUCommandEncoder");

    if (NSString* error = Texture::errorValidatingImageCopyTexture(source, copySize))
        return ERROR_STRING(error);

    if (!(sourceTexture->usage() & WGPUTextureUsage_CopySrc))
        return ERROR_STRING(@"sourceTexture usage does not contain CopySrc");

    if (sourceTexture->sampleCount() != 1)
        return ERROR_STRING(@"sourceTexture sample count != 1");

    WGPUTextureFormat aspectSpecificFormat = sourceTexture->format();

    if (Texture::isDepthOrStencilFormat(sourceTexture->format())) {
        if (!Texture::refersToSingleAspect(sourceTexture->format(), source.aspect))
            return ERROR_STRING(@"copying to depth stencil texture with more than one aspect");

        if (!Texture::isValidDepthStencilCopySource(sourceTexture->format(), source.aspect))
            return ERROR_STRING(@"copying to depth stencil texture, validDepthStencilCopySource fails");

        aspectSpecificFormat = Texture::aspectSpecificFormat(sourceTexture->format(), source.aspect);
    }

    if (NSString* error = errorValidatingImageCopyBuffer(destination))
        return ERROR_STRING(error);

    if (!(fromAPI(destination.buffer).usage() & WGPUBufferUsage_CopyDst))
        return ERROR_STRING(@"destination buffer usage does not contain CopyDst");

    if (NSString* error = Texture::errorValidatingTextureCopyRange(source, copySize))
        return ERROR_STRING(error);

    if (!Texture::isDepthOrStencilFormat(sourceTexture->format())) {
        auto texelBlockSize = Texture::texelBlockSize(sourceTexture->format());
        if (destination.layout.offset % texelBlockSize.value())
            return ERROR_STRING(@"destination.layout.offset is not a multiple of texelBlockSize");
    }

    if (Texture::isDepthOrStencilFormat(sourceTexture->format())) {
        if (destination.layout.offset % 4)
            return ERROR_STRING(@"destination.layout.offset is not a multiple of 4");
    }

    if (NSString* errorString = Texture::errorValidatingLinearTextureData(destination.layout, fromAPI(destination.buffer).initialSize(), aspectSpecificFormat, copySize))
        return ERROR_STRING(errorString);
#undef ERROR_STRING
    return nil;
}

void CommandEncoder::clearTextureIfNeeded(const WGPUImageCopyTexture& destination, NSUInteger slice)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderClearTextureIfNeeded(this, destination, slice);
        return;
    }
#endif

    clearTextureIfNeeded(destination, slice, m_device, m_blitCommandEncoder);
}


void CommandEncoder::clearTextureIfNeeded(const WGPUImageCopyTexture& destination, NSUInteger slice, const Device& device, id<MTLBlitCommandEncoder> blitCommandEncoder)
{
    Ref texture = fromAPI(destination.texture);
    NSUInteger mipLevel = destination.mipLevel;
    CommandEncoder::clearTextureIfNeeded(texture, mipLevel, slice, device, blitCommandEncoder);
}


void CommandEncoder::clearTextureIfNeeded(Texture& texture, NSUInteger mipLevel, NSUInteger slice, const Device& device, id<MTLBlitCommandEncoder> blitCommandEncoder)
{
    if (!blitCommandEncoder || texture.previouslyCleared(mipLevel, slice))
        return;

    texture.setPreviouslyCleared(mipLevel, slice);
    auto logicalExtent = texture.logicalMiplevelSpecificTextureExtent(mipLevel);
    if (!logicalExtent.width)
        return;
    if (texture.dimension() != WGPUTextureDimension_1D && !logicalExtent.height)
        return;
    if (texture.dimension() == WGPUTextureDimension_3D && !logicalExtent.depthOrArrayLayers)
        return;

    id<MTLTexture> mtlTexture = texture.texture();
    if (!mtlTexture)
        return;
    auto textureFormat = texture.format();
    if (mtlTexture.pixelFormat == MTLPixelFormatDepth32Float_Stencil8 || mtlTexture.pixelFormat == MTLPixelFormatX32_Stencil8)
        textureFormat = WGPUTextureFormat_Depth32Float;
    auto physicalExtent = Texture::physicalTextureExtent(texture.dimension(), textureFormat, logicalExtent);
    NSUInteger sourceBytesPerRow = Texture::bytesPerRow(textureFormat, physicalExtent.width, texture.sampleCount());
    NSUInteger depth = texture.dimension() == WGPUTextureDimension_3D ? physicalExtent.depthOrArrayLayers : 1;
    auto checkedBytesPerImage = checkedProduct<NSUInteger>(sourceBytesPerRow, physicalExtent.height);
    if (checkedBytesPerImage.hasOverflowed())
        return;
    NSUInteger bytesPerImage = checkedBytesPerImage.value();
    auto checkedBufferLength = checkedProduct<NSUInteger>(bytesPerImage, depth);
    if (checkedBufferLength.hasOverflowed())
        return;
    NSUInteger bufferLength = checkedBufferLength.value();
    if (!bufferLength)
        return;
    id<MTLBuffer> temporaryBuffer = device.safeCreateBuffer(bufferLength);

    if (!temporaryBuffer)
        return;

    MTLSize sourceSize;
    NSUInteger sourceBytesPerImage = 0;
    switch (texture.dimension()) {
    case WGPUTextureDimension_1D:
        sourceSize = MTLSizeMake(logicalExtent.width, 1, 1);
        break;
    case WGPUTextureDimension_2D:
        sourceSize = MTLSizeMake(logicalExtent.width, logicalExtent.height, 1);
        break;
    case WGPUTextureDimension_3D:
        sourceSize = MTLSizeMake(logicalExtent.width, logicalExtent.height, logicalExtent.depthOrArrayLayers);
        sourceBytesPerImage = bytesPerImage;
        slice = 0;
        break;
    case WGPUTextureDimension_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }

    MTLBlitOption options = MTLBlitOptionNone;
    if (mtlTexture.pixelFormat == MTLPixelFormatDepth32Float_Stencil8)
        options = MTLBlitOptionDepthFromDepthStencil;

    if (slice >= mtlTexture.arrayLength)
        return;

    [blitCommandEncoder
        copyFromBuffer:temporaryBuffer
        sourceOffset:0
        sourceBytesPerRow:sourceBytesPerRow
        sourceBytesPerImage:sourceBytesPerImage
        sourceSize:sourceSize
        toTexture:mtlTexture
        destinationSlice:slice
        destinationLevel:mipLevel
        destinationOrigin:MTLOriginMake(0, 0, 0)
        options:options];

    if (options != MTLBlitOptionNone) {
        sourceBytesPerRow /= sizeof(float);
        sourceBytesPerImage /= sizeof(float);
        [blitCommandEncoder
            copyFromBuffer:temporaryBuffer
            sourceOffset:0
            sourceBytesPerRow:sourceBytesPerRow
            sourceBytesPerImage:sourceBytesPerImage
            sourceSize:sourceSize
            toTexture:mtlTexture
            destinationSlice:slice
            destinationLevel:mipLevel
            destinationOrigin:MTLOriginMake(0, 0, 0)
            options:MTLBlitOptionStencilFromDepthStencil];
    }
}

bool CommandEncoder::waitForCommandBufferCompletion()
{
    if (RefPtr cachedCommandBuffer = m_cachedCommandBuffer.get())
        return cachedCommandBuffer->waitForCompletion();

    return true;
}

bool CommandEncoder::encoderIsCurrent(id<MTLCommandEncoder> commandEncoder) const
{
    return m_device->isValid() && m_existingCommandEncoder == commandEncoder;
}

void CommandEncoder::makeInvalid(NSString* errorString)
{
    if (!m_commandBuffer || m_commandBuffer.status >= MTLCommandBufferStatusCommitted)
        return;

    endEncoding(m_existingCommandEncoder);
    m_blitCommandEncoder = nil;
    m_existingCommandEncoder = nil;
    m_device->getQueue()->removeMTLCommandBuffer(m_commandBuffer);

    m_commandBuffer = nil;
    m_lastErrorString = errorString;
    if (RefPtr commandBuffer = m_cachedCommandBuffer.get())
        commandBuffer->makeInvalid(errorString);
}

void CommandEncoder::addICB(id<MTLIndirectCommandBuffer> icb)
{
    if (!icb)
        return;
    [m_retainedICBs addObject:icb];
}
void CommandEncoder::addBuffer(id<MTLCounterSampleBuffer> buffer)
{
    if (!buffer)
        return;
    [m_retainedTimestampBuffers addObject:buffer];
}
void CommandEncoder::addBuffer(id<MTLBuffer> buffer)
{
    if (!buffer)
        return;

#if CPU(X86_64) && (1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */)
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if (buffer.storageMode == MTLStorageModeManaged)
        [m_managedBuffers addObject:buffer];
    else
    ALLOW_DEPRECATED_DECLARATIONS_END
#endif
        [m_retainedBuffers addObject:buffer];
}
void CommandEncoder::addTexture(id<MTLTexture> texture)
{
    if (!texture)
        return;

#if CPU(X86_64) && (1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */)
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if (texture.storageMode == MTLStorageModeManaged)
        [m_managedTextures addObject:texture];
    else
    ALLOW_DEPRECATED_DECLARATIONS_END
#endif
        [m_retainedTextures addObject:texture];
}

void CommandEncoder::addTexture(const Texture& baseTexture)
{
    addTexture(baseTexture.texture());

    if (id<MTLSharedEvent> event = baseTexture.sharedEvent()) {
        m_sharedEvent = event;
        m_sharedEventSignalValue = baseTexture.sharedEventSignalValue();
    }
}

void CommandEncoder::addSampler(const Sampler& sampler)
{
    m_retainedSamplers.add(protect(sampler));
}

void CommandEncoder::makeSubmitInvalid(NSString* errorString)
{
    m_makeSubmitInvalid = true;
    if (RefPtr commandBuffer = m_cachedCommandBuffer.get())
        commandBuffer->makeInvalid(errorString ?: m_lastErrorString);
}

static bool NODELETE hasValidDimensions(WGPUTextureDimension dimension, NSUInteger width, NSUInteger height, NSUInteger depth)
{
    switch (dimension) {
    case WGPUTextureDimension_1D:
        return !!width;
    case WGPUTextureDimension_2D:
        return width && height;
    case WGPUTextureDimension_3D:
        return width && height && depth;
    default:
        return true;
    }
}

void CommandEncoder::copyTextureToBuffer(const WGPUImageCopyTexture& source, const WGPUImageCopyBuffer& destination, const WGPUExtent3D& copySize)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderCopyTextureToBuffer(this, source, destination, copySize);
        return;
    }
#endif

    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-copytexturetobuffer

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    Ref sourceTexture = fromAPI(source.texture);
    if (NSString* error = errorValidatingCopyTextureToBuffer(source, destination, copySize)) {
        makeInvalid(error);
        return;
    }

    Ref apiDestinationBuffer = fromAPI(destination.buffer);
    sourceTexture->setCommandEncoder(*this);
    apiDestinationBuffer->setCommandEncoder(*this);
    apiDestinationBuffer->indirectBufferInvalidated(*this);
    if (sourceTexture->isDestroyed() || apiDestinationBuffer->isDestroyed())
        return;

    MTLBlitOption options = MTLBlitOptionNone;
    switch (source.aspect) {
    case WGPUTextureAspect_All:
        options = MTLBlitOptionNone;
        break;
    case WGPUTextureAspect_StencilOnly:
        options = MTLBlitOptionStencilFromDepthStencil;
        break;
    case WGPUTextureAspect_DepthOnly:
        options = MTLBlitOptionDepthFromDepthStencil;
        break;
    case WGPUTextureAspect_Force32:
        ASSERT_NOT_REACHED();
        return;
    }

    auto logicalSize = sourceTexture->logicalMiplevelSpecificTextureExtent(source.mipLevel);
    auto widthForMetal = logicalSize.width < source.origin.x ? 0 : std::min(copySize.width, logicalSize.width - source.origin.x);
    auto heightForMetal = logicalSize.height < source.origin.y ? 0 : std::min(copySize.height, logicalSize.height - source.origin.y);
    auto depthForMetal = logicalSize.depthOrArrayLayers < source.origin.z ? 0 : std::min(copySize.depthOrArrayLayers, logicalSize.depthOrArrayLayers - source.origin.z);

    auto destinationBuffer = apiDestinationBuffer->buffer();
    NSUInteger destinationBytesPerRow = destination.layout.bytesPerRow;
    if (destinationBytesPerRow == WGPU_COPY_STRIDE_UNDEFINED)
        destinationBytesPerRow = destinationBuffer.length;

    auto sourceTextureFormat = sourceTexture->format();
    auto aspectSpecificFormat = Texture::aspectSpecificFormat(sourceTextureFormat, source.aspect);
    auto blockSize = Texture::texelBlockSize(aspectSpecificFormat);
    auto textureDimension = sourceTexture->dimension();
    switch (textureDimension) {
    case WGPUTextureDimension_1D: {
        auto product = checkedProduct<uint32_t>(blockSize, m_device->limits().maxTextureDimension1D);
        destinationBytesPerRow = product.hasOverflowed() ? destinationBytesPerRow : std::min<uint32_t>(destinationBytesPerRow, product.value());
    } break;
    case WGPUTextureDimension_2D:
    case WGPUTextureDimension_3D: {
        auto product = checkedProduct<uint32_t>(blockSize, m_device->limits().maxTextureDimension2D);
        destinationBytesPerRow = product.hasOverflowed() ? destinationBytesPerRow : std::min<uint32_t>(destinationBytesPerRow, product.value());
    } break;
    case WGPUTextureDimension_Force32:
        break;
    }

    destinationBytesPerRow = roundUpToMultipleOfNonPowerOfTwo(blockSize, destinationBytesPerRow);
    if (textureDimension == WGPUTextureDimension_3D && copySize.depthOrArrayLayers <= 1 && copySize.height <= 1)
        destinationBytesPerRow = 0;

    auto rowsPerImage = destination.layout.rowsPerImage;
    if (rowsPerImage == WGPU_COPY_STRIDE_UNDEFINED)
        rowsPerImage = heightForMetal ?: 1;
    auto checkedDestinationBytesPerImage = checkedProduct<NSUInteger>(rowsPerImage, destinationBytesPerRow);
    if (checkedDestinationBytesPerImage.hasOverflowed())
        return;
    NSUInteger destinationBytesPerImage = checkedDestinationBytesPerImage.value();

    NSUInteger maxDestinationBytesPerRow = textureDimension == WGPUTextureDimension_3D ? (2048 * blockSize.value()) : destinationBytesPerRow;
    if (destinationBytesPerRow > maxDestinationBytesPerRow) {
        for (uint32_t z = 0; z < copySize.depthOrArrayLayers; ++z) {
            auto zPlusOriginZ = checkedSum<uint32_t>(source.origin.z, z);
            auto zTimesDestinationBytesPerImage = checkedProduct<uint32_t>(z, destinationBytesPerImage);
            if (zPlusOriginZ.hasOverflowed() || zTimesDestinationBytesPerImage.hasOverflowed())
                return;
            for (uint32_t y = 0; y < copySize.height; ++y) {
                auto yPlusOriginY = checkedSum<uint32_t>(source.origin.y, y);
                auto yTimesDestinationBytesPerImage = checkedProduct<uint32_t>(y, destinationBytesPerRow);
                if (yPlusOriginY.hasOverflowed() || yTimesDestinationBytesPerImage.hasOverflowed())
                    return;
                WGPUImageCopyTexture newSource {
                    .texture = source.texture,
                    .mipLevel = source.mipLevel,
                    .origin = { .x = source.origin.x, .y = yPlusOriginY, .z = zPlusOriginZ },
                    .aspect = source.aspect
                };
                auto tripleSum = checkedSum<uint64_t>(zTimesDestinationBytesPerImage.value(), yTimesDestinationBytesPerImage.value(), destination.layout.offset);
                if (tripleSum.hasOverflowed())
                    return;
                WGPUImageCopyBuffer newDestination {
                    .layout = WGPUTextureDataLayout {
                        .offset = tripleSum.value(),
                        .bytesPerRow = WGPU_COPY_STRIDE_UNDEFINED,
                        .rowsPerImage = WGPU_COPY_STRIDE_UNDEFINED,
                    },
                    .buffer = destination.buffer
                };
                copyTextureToBuffer(newSource, newDestination, {
                    .width = copySize.width,
                    .height = 1,
                    .depthOrArrayLayers = 1
                });
            }
        }
        return;
    }

    ensureBlitCommandEncoder();

    for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
        auto originZPlusLayer = checkedSum<NSUInteger>(source.origin.z, layer);
        if (originZPlusLayer.hasOverflowed())
            return;
        NSUInteger sourceSlice = sourceTexture->dimension() == WGPUTextureDimension_3D ? 0 : originZPlusLayer.value();
        if (!sourceTexture->previouslyCleared(source.mipLevel, sourceSlice))
            clearTextureIfNeeded(source, sourceSlice);
    }

    if (!hasValidDimensions(sourceTexture->dimension(), widthForMetal, heightForMetal, depthForMetal))
        return;

    if (destinationBuffer.length < Texture::bytesPerRow(aspectSpecificFormat, widthForMetal, sourceTexture->sampleCount()))
        return;

    switch (sourceTexture->dimension()) {
    case WGPUTextureDimension_1D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400756-copyfromtexture?language=objc
        // "When you copy to a 1D texture, height and depth must be 1."
        auto sourceSize = MTLSizeMake(widthForMetal, 1, 1);
        auto sourceOrigin = MTLOriginMake(source.origin.x, 0, 0);
        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto layerTimesDestinatinBytesPerImage = checkedProduct<NSUInteger>(layer, destinationBytesPerImage);
            if (layerTimesDestinatinBytesPerImage.hasOverflowed())
                return;
            auto checkedDestinationOffset = checkedSum<NSUInteger>(destination.layout.offset, layerTimesDestinatinBytesPerImage.value());
            if (checkedDestinationOffset.hasOverflowed())
                return;
            auto destinationOffset = checkedDestinationOffset.value();
            auto checkedSourceSlice = checkedSum<NSUInteger>(source.origin.z, layer);
            if (checkedSourceSlice.hasOverflowed())
                return;
            NSUInteger sourceSlice = checkedSourceSlice.value();
            auto widthTimesBlockSize = checkedProduct<NSUInteger>(widthForMetal, blockSize);
            if (widthTimesBlockSize.hasOverflowed())
                return;

            auto sum = checkedSum<NSUInteger>(destinationOffset, widthTimesBlockSize);
            if (sum.value() > destinationBuffer.length)
                continue;
            [m_blitCommandEncoder
                copyFromTexture:sourceTexture->texture()
                sourceSlice:sourceSlice
                sourceLevel:source.mipLevel
                sourceOrigin:sourceOrigin
                sourceSize:sourceSize
                toBuffer:destinationBuffer
                destinationOffset:destinationOffset
                destinationBytesPerRow:destinationBytesPerRow
                destinationBytesPerImage:destinationBytesPerImage
                options:options];
        }
        break;
    }
    case WGPUTextureDimension_2D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400756-copyfromtexture?language=objc
        // "When you copy to a 2D texture, depth must be 1."
        auto sourceSize = MTLSizeMake(widthForMetal, heightForMetal, 1);
        auto sourceOrigin = MTLOriginMake(source.origin.x, source.origin.y, 0);
        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto layerTimesBytesPerImage = checkedProduct<NSUInteger>(layer, destinationBytesPerImage);
            if (layerTimesBytesPerImage.hasOverflowed())
                return;

            auto checkedDestinationOffset = checkedSum<NSUInteger>(destination.layout.offset, layerTimesBytesPerImage.value());
            if (checkedDestinationOffset.hasOverflowed())
                return;
            auto destinationOffset = checkedDestinationOffset.value();
            auto checkedSourceSlice = checkedSum<NSUInteger>(source.origin.z, layer);
            if (checkedSourceSlice.hasOverflowed())
                return;
            NSUInteger sourceSlice = checkedSourceSlice.value();
            [m_blitCommandEncoder
                copyFromTexture:sourceTexture->texture()
                sourceSlice:sourceSlice
                sourceLevel:source.mipLevel
                sourceOrigin:sourceOrigin
                sourceSize:sourceSize
                toBuffer:destinationBuffer
                destinationOffset:destinationOffset
                destinationBytesPerRow:destinationBytesPerRow
                destinationBytesPerImage:destinationBytesPerImage
                options:options];
        }
        break;
    }
    case WGPUTextureDimension_3D: {
        auto sourceSize = MTLSizeMake(widthForMetal, heightForMetal, depthForMetal);
        auto sourceOrigin = MTLOriginMake(source.origin.x, source.origin.y, source.origin.z);
        auto destinationOffset = static_cast<NSUInteger>(destination.layout.offset);
            [m_blitCommandEncoder
                copyFromTexture:sourceTexture->texture()
                sourceSlice:0
                sourceLevel:source.mipLevel
                sourceOrigin:sourceOrigin
                sourceSize:sourceSize
                toBuffer:destinationBuffer
                destinationOffset:destinationOffset
                destinationBytesPerRow:destinationBytesPerRow
                destinationBytesPerImage:destinationBytesPerImage
                options:options];
        break;
    }
    case WGPUTextureDimension_Force32:
        ASSERT_NOT_REACHED();
        return;
    }
}

static bool NODELETE areCopyCompatible(WGPUTextureFormat format1, WGPUTextureFormat format2)
{
    // https://gpuweb.github.io/gpuweb/#copy-compatible

    if (format1 == format2)
        return true;

    return Texture::removeSRGBSuffix(format1) == Texture::removeSRGBSuffix(format2);
}

NSString* CommandEncoder::errorValidatingCopyTextureToTexture(const WGPUImageCopyTexture& source, const WGPUImageCopyTexture& destination, const WGPUExtent3D& copySize) const
{
#define ERROR_STRING(x) [NSString stringWithFormat:@"GPUCommandEncoder.copyTextureToTexture: %@", x]
    Ref sourceTexture = fromAPI(source.texture);
    if (!isValidToUseWith(sourceTexture, *this))
        return ERROR_STRING(@"source texture is not valid to use with this GPUCommandEncoder");

    Ref destinationTexture = fromAPI(destination.texture);
    if (!isValidToUseWith(destinationTexture, *this))
        return ERROR_STRING(@"desintation texture is not valid to use with this GPUCommandEncoder");

    if (NSString* error = Texture::errorValidatingImageCopyTexture(source, copySize))
        return ERROR_STRING(error);

    if (!(sourceTexture->usage() & WGPUTextureUsage_CopySrc))
        return ERROR_STRING(@"source texture usage does not contain CopySrc");

    if (NSString* error = Texture::errorValidatingImageCopyTexture(destination, copySize))
        return ERROR_STRING(error);

    if (!(destinationTexture->usage() & WGPUTextureUsage_CopyDst))
        return ERROR_STRING(@"destination texture usage does not contain CopyDst");

    if (sourceTexture->sampleCount() != destinationTexture->sampleCount())
        return ERROR_STRING(@"destination texture sample count does not equal source texture sample count");

    if (!areCopyCompatible(sourceTexture->format(), destinationTexture->format()))
        return ERROR_STRING(@"destination texture and source texture are not copy compatible");

    bool srcIsDepthOrStencil = Texture::isDepthOrStencilFormat(sourceTexture->format());
    bool dstIsDepthOrStencil = Texture::isDepthOrStencilFormat(destinationTexture->format());

    if (srcIsDepthOrStencil) {
        if (!refersToAllAspects(sourceTexture->format(), source.aspect)
            || !refersToAllAspects(destinationTexture->format(), destination.aspect))
            return ERROR_STRING(@"source or destination do not refer to a single copy aspect");
    } else {
        if (source.aspect != WGPUTextureAspect_All)
            return ERROR_STRING(@"source aspect is not All");
        if (!dstIsDepthOrStencil) {
            if (destination.aspect != WGPUTextureAspect_All)
                return ERROR_STRING(@"destination aspect is not All");
        }
    }

    if (NSString* error = Texture::errorValidatingTextureCopyRange(source, copySize))
        return ERROR_STRING(error);

    if (NSString* error = Texture::errorValidatingTextureCopyRange(destination, copySize))
        return ERROR_STRING(error);

    // https://gpuweb.github.io/gpuweb/#abstract-opdef-set-of-subresources-for-texture-copy
    if (source.texture == destination.texture) {
        // Mip levels are never ranges.
        if (source.mipLevel == destination.mipLevel) {
            switch (fromAPI(source.texture).dimension()) {
            case WGPUTextureDimension_1D:
                return ERROR_STRING(@"can't copy 1D texture to itself");
            case WGPUTextureDimension_2D: {
                Range<uint32_t> sourceRange(source.origin.z, source.origin.z + copySize.depthOrArrayLayers);
                Range<uint32_t> destinationRange(destination.origin.z, destination.origin.z + copySize.depthOrArrayLayers);
                if (sourceRange.overlaps(destinationRange))
                    return ERROR_STRING(@"can't copy 2D texture to itself with overlapping array range");
                break;
            }
            case WGPUTextureDimension_3D:
                return ERROR_STRING(@"can't copy 3D texture to itself");
            case WGPUTextureDimension_Force32:
                ASSERT_NOT_REACHED();
                return ERROR_STRING(@"unknown texture format");
            }
        }
    }

#undef ERROR_STRING
    return nil;
}

void CommandEncoder::copyTextureToTexture(const WGPUImageCopyTexture& source, const WGPUImageCopyTexture& destination, const WGPUExtent3D& copySize)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderCopyTextureToTexture(this, source, destination, copySize);
        return;
    }
#endif

    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-copytexturetotexture

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (NSString* error = errorValidatingCopyTextureToTexture(source, destination, copySize)) {
        makeInvalid(error);
        return;
    }

    Ref sourceTexture = fromAPI(source.texture);
    Ref destinationTexture = fromAPI(destination.texture);
    sourceTexture->setCommandEncoder(*this);
    destinationTexture->setCommandEncoder(*this);

    if (sourceTexture->isDestroyed() || destinationTexture->isDestroyed())
        return;

    ensureBlitCommandEncoder();

    auto destinationTextureDimension = destinationTexture->dimension();
    uint32_t sliceCount = destinationTextureDimension == WGPUTextureDimension_3D ? 1 : copySize.depthOrArrayLayers;
    auto destinationLogicalSize = destinationTexture->logicalMiplevelSpecificTextureExtent(destination.mipLevel);
    for (uint32_t layer = 0; layer < sliceCount; ++layer) {
        auto sourceOriginPlusLayer = checkedSum<NSUInteger>(source.origin.z, layer);
        if (sourceOriginPlusLayer.hasOverflowed())
            return;
        NSUInteger sourceSlice = sourceTexture->dimension() == WGPUTextureDimension_3D ? 0 : sourceOriginPlusLayer.value();
        clearTextureIfNeeded(source, sourceSlice);

        auto destinationOriginPlusLayer = checkedSum<NSUInteger>(destination.origin.z, layer);
        if (destinationOriginPlusLayer.hasOverflowed())
            return;
        NSUInteger destinationSlice = destinationTexture->dimension() == WGPUTextureDimension_3D ? 0 : destinationOriginPlusLayer.value();
        if (Queue::writeWillCompletelyClear(destinationTextureDimension, copySize.width, destinationLogicalSize.width, copySize.height, destinationLogicalSize.height, copySize.depthOrArrayLayers, destinationLogicalSize.depthOrArrayLayers))
            destinationTexture->setPreviouslyCleared(destination.mipLevel, destinationSlice);
        else
            clearTextureIfNeeded(destination, destinationSlice);
    }

    id<MTLTexture> mtlDestinationTexture = destinationTexture->texture();
    id<MTLTexture> mtlSourceTexture = fromAPI(source.texture).texture();

    // FIXME(PERFORMANCE): Is it actually faster to use the -[MTLBlitCommandEncoder copyFromTexture:...toTexture:...levelCount:]
    // variant, where possible, rather than calling the other variant in a loop?
    switch (sourceTexture->dimension()) {
    case WGPUTextureDimension_1D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400756-copyfromtexture?language=objc
        // "When you copy to a 1D texture, height and depth must be 1."
        auto sourceSize = MTLSizeMake(copySize.width, 1, 1);
        if (!sourceSize.width)
            return;

        auto sourceOrigin = MTLOriginMake(source.origin.x, 0, 0);
        auto destinationOrigin = MTLOriginMake(destination.origin.x, 0, 0);

        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto sourceOriginPlusLayer = checkedSum<NSUInteger>(source.origin.z, layer);
            if (sourceOriginPlusLayer.hasOverflowed())
                return;
            NSUInteger sourceSlice = sourceOriginPlusLayer.value();
            auto destinationOriginPlusLayer = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (destinationOriginPlusLayer.hasOverflowed())
                return;
            NSUInteger destinationSlice = destinationOriginPlusLayer.value();
            if (destinationSlice >= mtlDestinationTexture.arrayLength || sourceSlice >= mtlSourceTexture.arrayLength)
                continue;
            [m_blitCommandEncoder
                copyFromTexture:mtlSourceTexture
                sourceSlice:sourceSlice
                sourceLevel:source.mipLevel
                sourceOrigin:sourceOrigin
                sourceSize:sourceSize
                toTexture:mtlDestinationTexture
                destinationSlice:destinationSlice
                destinationLevel:destination.mipLevel
                destinationOrigin:destinationOrigin];
        }
        break;
    }
    case WGPUTextureDimension_2D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400756-copyfromtexture?language=objc
        // "When you copy to a 2D texture, depth must be 1."
        auto sourceSize = MTLSizeMake(copySize.width, copySize.height, 1);
        if (!sourceSize.width || !sourceSize.height)
            return;

        auto sourceOrigin = MTLOriginMake(source.origin.x, source.origin.y, 0);
        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, 0);

        for (uint32_t layer = 0; layer < copySize.depthOrArrayLayers; ++layer) {
            auto sourceOriginPlusLayer = checkedSum<NSUInteger>(source.origin.z, layer);
            if (sourceOriginPlusLayer.hasOverflowed())
                return;
            NSUInteger sourceSlice = sourceOriginPlusLayer.value();
            auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (checkedDestinationSlice.hasOverflowed())
                return;
            NSUInteger destinationSlice = checkedDestinationSlice.value();
            if (destinationSlice >= mtlDestinationTexture.arrayLength || sourceSlice >= mtlSourceTexture.arrayLength)
                continue;
            [m_blitCommandEncoder
                copyFromTexture:mtlSourceTexture
                sourceSlice:sourceSlice
                sourceLevel:source.mipLevel
                sourceOrigin:sourceOrigin
                sourceSize:sourceSize
                toTexture:mtlDestinationTexture
                destinationSlice:destinationSlice
                destinationLevel:destination.mipLevel
                destinationOrigin:destinationOrigin];
        }
        break;
    }
    case WGPUTextureDimension_3D: {
        auto sourceSize = MTLSizeMake(copySize.width, copySize.height, copySize.depthOrArrayLayers);
        if (!sourceSize.width || !sourceSize.height || !sourceSize.depth)
            return;

        auto originPlusSourceSize = checkedSum<uint32_t>(destination.origin.z, sourceSize.depth);
        if (originPlusSourceSize.hasOverflowed())
            return;
        if (originPlusSourceSize.value() > std::min<uint32_t>(destinationLogicalSize.depthOrArrayLayers, mtlDestinationTexture.depth)) {
            makeInvalid(@"GPUCommandEncoder.copyTextureToTexture: destination.origin.z + sourceSize.depth > destinationLogicalSize.depthOrArrayLayers");
            return;
        }

        auto sourceOrigin = MTLOriginMake(source.origin.x, source.origin.y, source.origin.z);
        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, destination.origin.z);

        [m_blitCommandEncoder
            copyFromTexture:mtlSourceTexture
            sourceSlice:0
            sourceLevel:source.mipLevel
            sourceOrigin:sourceOrigin
            sourceSize:sourceSize
            toTexture:mtlDestinationTexture
            destinationSlice:0
            destinationLevel:destination.mipLevel
            destinationOrigin:destinationOrigin];
        break;
    }
    case WGPUTextureDimension_Force32:
        ASSERT_NOT_REACHED();
        return;
    }
}

bool CommandEncoder::validateClearBuffer(const Buffer& buffer, uint64_t offset, uint64_t size)
{
    if (!isValidToUseWith(buffer, *this))
        return false;

    if (!(buffer.usage() & WGPUBufferUsage_CopyDst))
        return false;

    if (size % 4)
        return false;

    if (offset % 4)
        return false;

    auto end = checkedSum<uint64_t>(offset, size);
    if (end.hasOverflowed() || buffer.initialSize() < end.value())
        return false;

    return true;
}

void CommandEncoder::clearBuffer(Buffer& buffer, uint64_t offset, uint64_t size)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-clearbuffer
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        commandEncoderClearBuffer(this, &buffer, offset, size);
        return;
    }
#endif

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (size == WGPU_WHOLE_SIZE) {
        auto localSize = checkedDifference<uint64_t>(buffer.initialSize(), offset);
        if (localSize.hasOverflowed()) {
            protect(m_device)->generateAValidationError("CommandEncoder::clearBuffer(): offset > buffer.size"_s);
            return;
        }
        size = localSize.value();
    }

    if (!validateClearBuffer(buffer, offset, size)) {
        makeInvalid(@"GPUCommandEncoder.clearBuffer validation failed");
        return;
    }

    buffer.setCommandEncoder(*this);
    buffer.indirectBufferInvalidated(*this);
    auto range = NSMakeRange(static_cast<NSUInteger>(offset), static_cast<NSUInteger>(size));
    if (buffer.isDestroyed() || !size || NSMaxRange(range) > buffer.buffer().length)
        return;

    ensureBlitCommandEncoder();

    [m_blitCommandEncoder fillBuffer:buffer.buffer() range:range value:0];
}

void CommandEncoder::setLastError(NSString* errorString)
{
    m_lastErrorString = errorString;
}

NSString* CommandEncoder::validateFinishError() const
{
    if (!isValid())
        return @"GPUCommandEncoder.finish: encoder is not valid";

    if (m_state != EncoderState::Open)
        return [NSString stringWithFormat:@"GPUCommandEncoder.finish: encoder state is '%@', expected 'Open'", encoderStateName()];

    if (m_debugGroupStackSize)
        return [NSString stringWithFormat:@"GPUCommandEncoder.finish: encoder stack size '%llu'", m_debugGroupStackSize];

    // FIXME: "Every usage scope contained in this must satisfy the usage scope validation."

    return nil;
}

Ref<CommandBuffer> CommandEncoder::finish(const WGPUCommandBufferDescriptor& descriptor)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled())
        return commandEncoderFinish(this, descriptor);
#endif

    if (!isValid() || (m_existingCommandEncoder && m_existingCommandEncoder != m_blitCommandEncoder)) {
        m_state = EncoderState::Ended;
        discardCommandBuffer();
        protect(m_device)->generateAValidationError(m_lastErrorString ?: @"Invalid CommandEncoder.");
        return CommandBuffer::createInvalid(m_device);
    }

    // https://gpuweb.github.io/gpuweb/#dom-gpucommandencoder-finish

    auto validationFailedError = validateFinishError();

    auto priorState = m_state;
    m_state = EncoderState::Ended;
    UNUSED_PARAM(priorState);
    if (validationFailedError) {
        discardCommandBuffer();
        protect(m_device)->generateAValidationError(m_lastErrorString ?: validationFailedError);
        return CommandBuffer::createInvalid(m_device);
    }

    finalizeBlitCommandEncoder();

    auto *commandBuffer = m_commandBuffer;
    m_commandBuffer = nil;
    m_existingCommandEncoder = nil;

    commandBuffer.label = createNSString(descriptor.label).get();

#if CPU(X86_64) && (1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */)
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if (m_managedBuffers.count || m_managedTextures.count) {
        id<MTLBlitCommandEncoder> blitCommandEncoder = [commandBuffer blitCommandEncoder];
        for (id<MTLBuffer> buffer in m_managedBuffers)
            [blitCommandEncoder synchronizeResource:buffer];
        for (id<MTLTexture> texture in m_managedTextures)
            [blitCommandEncoder synchronizeResource:texture];
        [blitCommandEncoder endEncoding];
    }
    ALLOW_DEPRECATED_DECLARATIONS_END
#endif

    auto result = CommandBuffer::create(commandBuffer, m_device, m_sharedEvent, m_sharedEventSignalValue, WTF::move(m_onCommitHandlers), *this);
    m_sharedEvent = nil;
    m_cachedCommandBuffer = result.ptr();
    result->setBufferMapCount(m_bufferMapCount);
    if (m_makeSubmitInvalid)
        result->makeInvalid(m_lastErrorString);

    return result;
}

void CommandEncoder::insertDebugMarker(String&& markerLabel)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-insertdebugmarker

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    finalizeBlitCommandEncoder();

    // There's no direct way of doing this, so we just push/pop an empty debug group.
    [m_commandBuffer pushDebugGroup:createNSString(markerLabel).get()];
    [m_commandBuffer popDebugGroup];
}

bool CommandEncoder::validatePopDebugGroup() const
{
    if (!m_debugGroupStackSize)
        return false;

    return true;
}

void CommandEncoder::popDebugGroup()
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-popdebuggroup

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (!validatePopDebugGroup()) {
        makeInvalid(@"validatePopDebugGroup failed");
        return;
    }

    finalizeBlitCommandEncoder();

    --m_debugGroupStackSize;
    [m_commandBuffer popDebugGroup];
}

void CommandEncoder::pushDebugGroup(String&& groupLabel)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudebugcommandsmixin-pushdebuggroup

    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }
    
    finalizeBlitCommandEncoder();

    ++m_debugGroupStackSize;
    [m_commandBuffer pushDebugGroup:createNSString(groupLabel).get()];
}

static bool NODELETE validateResolveQuerySet(const QuerySet& querySet, uint32_t firstQuery, uint32_t queryCount, const Buffer& destination, uint64_t destinationOffset)
{
    if (!querySet.isDestroyed() && !querySet.isValid())
        return false;
    if (!destination.isDestroyed() && !destination.isValid())
        return false;
    if (!(destination.usage() & WGPUBufferUsage_QueryResolve))
        return false;

    if (firstQuery >= querySet.count())
        return false;

    auto countEnd = checkedSum<uint32_t>(firstQuery, queryCount);
    if (countEnd.hasOverflowed() || countEnd.value() > querySet.count())
        return false;

    if (destinationOffset % 256)
        return false;

    auto queryCountTimes8 = checkedProduct<uint64_t>(8, static_cast<uint64_t>(queryCount));
    if (queryCountTimes8.hasOverflowed())
        return false;
    auto countTimes8PlusOffset = checkedSum<uint64_t>(destinationOffset, queryCountTimes8);
    if (countTimes8PlusOffset.hasOverflowed() || countTimes8PlusOffset.value() > destination.initialSize())
        return false;

    return true;
}

void CommandEncoder::resolveQuerySet(const QuerySet& querySet, uint32_t firstQuery, uint32_t queryCount, Buffer& destination, uint64_t destinationOffset)
{
#if ENABLE(WEBGPU_SWIFT)
    // FIXME: rdar://138047285 const_cast is needed as a workaround.
    if (isWebGPUSwiftEnabled()) {
        commandEncoderResolveQuerySet(this, const_cast<QuerySet*>(&querySet), firstQuery, queryCount, &destination, destinationOffset);
        return;
    }
#endif
    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (!validateResolveQuerySet(querySet, firstQuery, queryCount, destination, destinationOffset) || !isValidToUseWith(querySet, *this) || !isValidToUseWith(destination, *this)) {
        makeInvalid(@"GPUCommandEncoder.resolveQuerySet validation failed");
        return;
    }

    querySet.setCommandEncoder(*this);
    destination.setCommandEncoder(*this);
    destination.indirectBufferInvalidated(*this);
    if (querySet.isDestroyed() || destination.isDestroyed() || !queryCount)
        return;

    switch (querySet.type()) {
    case WGPUQueryType_Occlusion: {
        ensureBlitCommandEncoder();
        [m_blitCommandEncoder copyFromBuffer:querySet.visibilityBuffer() sourceOffset:sizeof(uint64_t) * firstQuery toBuffer:destination.buffer() destinationOffset:destinationOffset size:sizeof(uint64_t) * queryCount];
        break;
    }
    case WGPUQueryType_Timestamp: {
        // FIXME: https://bugs.webkit.org/show_bug.cgi?id=283385 - https://bugs.webkit.org/show_bug.cgi?id=283088 should be reverted when the blocking issue is resolved
        finalizeBlitCommandEncoder();
        id<MTLSharedEvent> workaround = m_device->resolveTimestampsSharedEvent();
        // The signal value does not matter, the event alone prevents reordering
        [m_commandBuffer encodeSignalEvent:workaround value:1];
        [m_commandBuffer encodeWaitForEvent:workaround value:1];
        ensureBlitCommandEncoder();
        auto counterSampleBuffer = querySet.counterSampleBufferWithOffset();
        [m_blitCommandEncoder resolveCounters:counterSampleBuffer.buffer inRange:NSMakeRange(firstQuery + counterSampleBuffer.offset, queryCount) destinationBuffer:destination.buffer() destinationOffset:destinationOffset];
        break;
    }
    default:
        ASSERT_NOT_REACHED();
        break;
    }
}

void CommandEncoder::writeTimestamp(QuerySet& querySet, uint32_t queryIndex)
{
    if (!prepareTheEncoderState()) {
        GENERATE_INVALID_ENCODER_STATE_ERROR();
        return;
    }

    if (!protect(m_device)->hasFeature(WGPUFeatureName_TimestampQuery))
        return;

    if (querySet.type() != WGPUQueryType_Timestamp || queryIndex >= querySet.count() || !isValidToUseWith(querySet, *this)) {
        makeInvalid(@"GPUCommandEncoder.writeTimestamp validation failed");
        return;
    }

    querySet.setCommandEncoder(*this);
}

void CommandEncoder::setLabel(String&& label)
{
    m_commandBuffer.label = createNSString(label).get();
}

void CommandEncoder::lock(bool shouldLock)
{
    if (m_state == EncoderState::Ended)
        return;

    m_state = shouldLock ? EncoderState::Locked : EncoderState::Open;
    if (!shouldLock)
        setExistingEncoder(nil);
}

size_t CommandEncoder::computeSize(TrackedResourceContainer& container, const Device& device)
{
    container.removeIf([&](auto commandEncoder) {
        return !device.commandEncoderFromIdentifier(commandEncoder);
    });
    return container.size();
}

void CommandEncoder::clearTracking()
{
    auto identifier = uniqueId();
    for (auto& resource : m_trackedBuffers)
        resource->removeEncoder(identifier);
    for (auto& resource : m_trackedTextures)
        resource->removeEncoder(identifier);
    for (auto& resource : m_trackedTextureViews)
        resource->removeEncoder(identifier);
    for (auto& resource : m_trackedQuerySets)
        resource->removeEncoder(identifier);

    m_trackedBuffers.clear();
    m_trackedTextures.clear();
    m_trackedTextureViews.clear();
    m_trackedQuerySets.clear();
}

bool CommandEncoder::trackEncoderForBuffer(const Buffer& buffer, TrackedResourceContainer& encoderContainer)
{
    auto addResult = encoderContainer.add(uniqueId());
    if (addResult.isNewEntry)
        m_trackedBuffers.append(buffer);
    return addResult.isNewEntry;
}
void CommandEncoder::trackEncoderForTexture(const Texture& texture, TrackedResourceContainer& encoderContainer)
{
    if (encoderContainer.add(uniqueId()).isNewEntry)
        m_trackedTextures.append(texture);
}
void CommandEncoder::trackEncoderForTextureView(const TextureView& textureView, TrackedResourceContainer& encoderContainer)
{
    if (encoderContainer.add(uniqueId()).isNewEntry)
        m_trackedTextureViews.append(textureView);
}
void CommandEncoder::trackEncoderForQuerySet(const QuerySet& querySet, TrackedResourceContainer& encoderContainer)
{
    if (encoderContainer.add(uniqueId()).isNewEntry)
        m_trackedQuerySets.append(querySet);
}

void CommandEncoder::trackEncoder(CommandEncoder& commandEncoder, HashSet<uint64_t, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>>& encoderContainer)
{
    encoderContainer.add(commandEncoder.uniqueId());
}

void CommandEncoder::addOnCommitHandler(Function<bool(CommandBuffer&, CommandEncoder&)>&& onCommitHandler)
{
    ASSERT(m_commandBuffer);
    m_onCommitHandlers.append(WTF::move(onCommitHandler));
}

#if ENABLE(WEBGPU_BY_DEFAULT)
bool CommandEncoder::useResidencySet(id<MTLResidencySet> residencySet)
{
    if (residencySet && m_currentResidencySetCount < 32) {
        [m_commandBuffer useResidencySet:residencySet];
        [residencySet requestResidency];
        ++m_currentResidencySetCount;
        return true;
    }

    return false;
}
#endif

#undef GENERATE_INVALID_ENCODER_STATE_ERROR

void CommandEncoder::skippedDrawIndexedValidation(uint64_t bufferIdentifier, DrawIndexCacheContainerIterator it)
{
    m_skippedDrawIndexedValidationKeys.add(bufferIdentifier, Vector<std::pair<DrawIndexCacheContainerValue, uint32_t>> { }).iterator->value.append(std::make_pair(DrawIndexCacheContainerValue(it->key.key()), it->value));
}

void CommandEncoder::rebindSamplersPreCommit(const BindGroup& group)
{
    m_bindGroups.append(group);
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuCommandEncoderReference(WGPUCommandEncoder commandEncoder)
{
    WebGPU::fromAPI(commandEncoder).ref();
}

void wgpuCommandEncoderRelease(WGPUCommandEncoder commandEncoder)
{
    WebGPU::fromAPI(commandEncoder).deref();
}

WGPUComputePassEncoder wgpuCommandEncoderBeginComputePass(WGPUCommandEncoder commandEncoder, const WGPUComputePassDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(commandEncoder))->beginComputePass(*descriptor));
}

WGPURenderPassEncoder wgpuCommandEncoderBeginRenderPass(WGPUCommandEncoder commandEncoder, const WGPURenderPassDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(commandEncoder))->beginRenderPass(*descriptor));
}

void wgpuCommandEncoderCopyBufferToBuffer(WGPUCommandEncoder commandEncoder, WGPUBuffer source, uint64_t sourceOffset, WGPUBuffer destination, uint64_t destinationOffset, uint64_t size)
{
    protect(WebGPU::fromAPI(commandEncoder))->copyBufferToBuffer(protect(WebGPU::fromAPI(source)), sourceOffset, protect(WebGPU::fromAPI(destination)), destinationOffset, size);
}

void wgpuCommandEncoderCopyBufferToTexture(WGPUCommandEncoder commandEncoder, const WGPUImageCopyBuffer* source, const WGPUImageCopyTexture* destination, const WGPUExtent3D* copySize)
{
    protect(WebGPU::fromAPI(commandEncoder))->copyBufferToTexture(*source, *destination, *copySize);
}

void wgpuCommandEncoderCopyTextureToBuffer(WGPUCommandEncoder commandEncoder, const WGPUImageCopyTexture* source, const WGPUImageCopyBuffer* destination, const WGPUExtent3D* copySize)
{
    protect(WebGPU::fromAPI(commandEncoder))->copyTextureToBuffer(*source, *destination, *copySize);
}

void wgpuCommandEncoderCopyTextureToTexture(WGPUCommandEncoder commandEncoder, const WGPUImageCopyTexture* source, const WGPUImageCopyTexture* destination, const WGPUExtent3D* copySize)
{
    protect(WebGPU::fromAPI(commandEncoder))->copyTextureToTexture(*source, *destination, *copySize);
}

void wgpuCommandEncoderClearBuffer(WGPUCommandEncoder commandEncoder, WGPUBuffer buffer, uint64_t offset, uint64_t size)
{
    protect(WebGPU::fromAPI(commandEncoder))->clearBuffer(protect(WebGPU::fromAPI(buffer)), offset, size);
}

WGPUCommandBuffer wgpuCommandEncoderFinish(WGPUCommandEncoder commandEncoder, const WGPUCommandBufferDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(commandEncoder))->finish(*descriptor));
}

void wgpuCommandEncoderInsertDebugMarker(WGPUCommandEncoder commandEncoder, const char* markerLabel)
{
    protect(WebGPU::fromAPI(commandEncoder))->insertDebugMarker(WebGPU::fromAPI(markerLabel));
}

void wgpuCommandEncoderPopDebugGroup(WGPUCommandEncoder commandEncoder)
{
    protect(WebGPU::fromAPI(commandEncoder))->popDebugGroup();
}

void wgpuCommandEncoderPushDebugGroup(WGPUCommandEncoder commandEncoder, const char* groupLabel)
{
    protect(WebGPU::fromAPI(commandEncoder))->pushDebugGroup(WebGPU::fromAPI(groupLabel));
}

void wgpuCommandEncoderResolveQuerySet(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t firstQuery, uint32_t queryCount, WGPUBuffer destination, uint64_t destinationOffset)
{
    protect(WebGPU::fromAPI(commandEncoder))->resolveQuerySet(protect(WebGPU::fromAPI(querySet)), firstQuery, queryCount, protect(WebGPU::fromAPI(destination)), destinationOffset);
}

void wgpuCommandEncoderWriteTimestamp(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t queryIndex)
{
    protect(WebGPU::fromAPI(commandEncoder))->writeTimestamp(protect(WebGPU::fromAPI(querySet)), queryIndex);
}

void wgpuCommandEncoderSetLabel(WGPUCommandEncoder commandEncoder, const char* label)
{
    protect(WebGPU::fromAPI(commandEncoder))->setLabel(WebGPU::fromAPI(label));
}
