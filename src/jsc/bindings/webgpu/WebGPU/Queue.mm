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
#import "Queue.h"

#import "APIConversions.h"
#import "Buffer.h"
#import "CommandBuffer.h"
#import "CommandEncoder.h"
#import "Device.h"
#import "IsValidToUseWith.h"
#import "MetalSPI.h"
#import "Texture.h"
#import "TextureView.h"
#import <simd/simd.h>
#import <wtf/Borrow.h>
#import <wtf/CheckedArithmetic.h>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>

#if ENABLE(WEBGPU_SWIFT)
#import "CxxBridging.h"
#import <WebGPU/CxxBridgingPublic.h>
#import <WebGPU/WGPUTextureImpl.h>
#import "WebGPUSwift-Generated.h"
#endif

namespace WebGPU {

constexpr bool skipMemoryAttribution = true;

WTF_MAKE_TZONE_ALLOCATED_IMPL(Queue);

Queue::Queue(id<MTLCommandQueue> commandQueue, Adapter& adapter, Device& device)
    : m_commandQueue(commandQueue)
    , m_device(device)
    , m_instance(adapter.weakInstance())
{
    m_createdNotCommittedBuffers = [NSMutableOrderedSet orderedSet];
    m_openCommandEncoders = [NSMapTable strongToStrongObjectsMapTable];
    m_retainedCounterSampleBuffers = [NSMutableDictionary dictionary];
}

Queue::Queue(Adapter& adapter, Device& device)
    : m_device(device)
    , m_instance(adapter.weakInstance())
{
}

Queue::~Queue()
{
    // We can't actually call finalizeBlitCommandEncoder() here because, if there are pending copies,
    // that would cause them to be committed, which ends up retaining this in the completed handler.
    // It's actually fine, though, because we can just drop any pending copies on the floor.
    // If the queue is being destroyed, this is unobservable.
    if (m_blitCommandEncoder)
        endEncoding(m_blitCommandEncoder, m_commandBuffer);
}

id<MTLBlitCommandEncoder> Queue::ensureBlitCommandEncoder()
{
    if (m_blitCommandEncoder && m_blitCommandEncoder == encoderForBuffer(m_commandBuffer))
        return m_blitCommandEncoder;

    auto *commandBufferDescriptor = [MTLCommandBufferDescriptor new];
    auto blitCommandBuffer = commandBufferWithDescriptor(commandBufferDescriptor);
    m_commandBuffer = blitCommandBuffer;
    m_blitCommandEncoder = [m_commandBuffer blitCommandEncoder];
    setEncoderForBuffer(m_commandBuffer, m_blitCommandEncoder);
    return m_blitCommandEncoder;
}

void Queue::finalizeBlitCommandEncoder()
{
    if (m_blitCommandEncoder) {
        endEncoding(m_blitCommandEncoder, m_commandBuffer);
        commitMTLCommandBuffer(m_commandBuffer);
        m_blitCommandEncoder = nil;
        m_commandBuffer = nil;
    }
}

void Queue::endEncoding(id<MTLCommandEncoder> commandEncoder, id<MTLCommandBuffer> commandBuffer) const
{
    id<MTLCommandEncoder> currentEncoder = encoderForBuffer(commandBuffer);
    if (!currentEncoder || currentEncoder != commandEncoder)
        return;

    [currentEncoder endEncoding];
    if (RefPtr device = m_device.get())
        device->resolveTimestampsForBuffer(commandBuffer);
    [m_openCommandEncoders removeObjectForKey:commandBuffer];
}

id<MTLCommandEncoder> Queue::encoderForBuffer(id<MTLCommandBuffer> commandBuffer) const
{
    if (!commandBuffer)
        return nil;

    return [m_openCommandEncoders objectForKey:commandBuffer];
}

void Queue::setEncoderForBuffer(id<MTLCommandBuffer> commandBuffer, id<MTLCommandEncoder> commandEncoder)
{
    if (!commandBuffer)
        return;

    endEncoding(encoderForBuffer(commandBuffer), commandBuffer);
    if (!commandEncoder)
        [m_openCommandEncoders removeObjectForKey:commandBuffer];
    else
        [m_openCommandEncoders setObject:commandEncoder forKey:commandBuffer];
}

id<MTLCommandBuffer> Queue::commandBufferWithDescriptor(MTLCommandBufferDescriptor* descriptor)
{
    if (!isValid())
        return nil;

    constexpr auto maxCommandBufferCount = 1000;
    auto devicePtr = m_device.get();
    if (m_createdNotCommittedBuffers.count >= maxCommandBufferCount) {
        if (devicePtr)
            devicePtr->loseTheDevice(WGPUDeviceLostReason_Destroyed);
        return nil;
    }

    id<MTLCommandBuffer> buffer = [m_commandQueue commandBufferWithDescriptor:descriptor];
    if (buffer)
        [m_createdNotCommittedBuffers addObject:buffer];

    if (auto instance = m_instance.get()) {
        if (auto device = m_device.get())
            instance->retainDevice(*device, buffer);
    }
    return buffer;
}

void Queue::makeInvalid()
{
    m_commandQueue = nil;
    for (auto& [_, callbackVector] : m_onSubmittedWorkScheduledCallbacks) {
        for (auto& callback : callbackVector)
            callback();
    }
    for (auto& [_, callbackVector] : m_onSubmittedWorkDoneCallbacks) {
        for (auto& callback : callbackVector)
            callback(WGPUQueueWorkDoneStatus_DeviceLost);
    }

    m_onSubmittedWorkScheduledCallbacks.clear();
    m_onSubmittedWorkDoneCallbacks.clear();

    while (m_createdNotCommittedBuffers.count)
        removeMTLCommandBuffer(m_createdNotCommittedBuffers.firstObject);

    m_createdNotCommittedBuffers = nil;
    m_openCommandEncoders = nil;
}

void Queue::onSubmittedWorkDone(CompletionHandler<void(WGPUQueueWorkDoneStatus)>&& callback)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpuqueue-onsubmittedworkdone
    auto devicePtr = m_device.get();
    if (!devicePtr || !devicePtr->isValid() || devicePtr->isLost()) {
        callback(WGPUQueueWorkDoneStatus_DeviceLost);
        return;
    }

    ASSERT(m_submittedCommandBufferCount >= m_completedCommandBufferCount);

    finalizeBlitCommandEncoder();

    if (isIdle()) {
        scheduleWork([callback = WTF::move(callback)]() mutable {
            callback(WGPUQueueWorkDoneStatus_Success);
        });
        return;
    }

    auto& callbacks = m_onSubmittedWorkDoneCallbacks.add(m_submittedCommandBufferCount, OnSubmittedWorkDoneCallbacks()).iterator->value;
    callbacks.append(WTF::move(callback));
}

void Queue::onSubmittedWorkScheduled(Function<void()>&& completionHandler)
{
    ASSERT(m_submittedCommandBufferCount >= m_scheduledCommandBufferCount);
    auto devicePtr = m_device.get();
    if (!devicePtr || !devicePtr->isValid() || devicePtr->isLost()) {
        completionHandler();
        return;
    }

    finalizeBlitCommandEncoder();

    if (isSchedulingIdle()) {
        scheduleWork([completionHandler = WTF::move(completionHandler)]() mutable {
            completionHandler();
        });
        return;
    }

    auto& callbacks = m_onSubmittedWorkScheduledCallbacks.add(m_submittedCommandBufferCount, OnSubmittedWorkScheduledCallbacks()).iterator->value;
    callbacks.append(WTF::move(completionHandler));
}

NSString* Queue::errorValidatingSubmit(const Vector<Ref<WebGPU::CommandBuffer>>& commands) const
{
    for (Ref command : commands) {
        if (!isValidToUseWith(command.get(), *this) || command->bufferMapCount() || command->commandBuffer().status >= MTLCommandBufferStatusCommitted)
            return command->lastError() ?: @"Validation failure.";
    }

    // FIXME: "Every GPUQuerySet referenced in a command in any element of commandBuffers is in the available state."
    // FIXME: "For occlusion queries, occlusionQuerySet in beginRenderPass() does not constitute a reference, while beginOcclusionQuery() does."

    // There's only one queue right now, so there is no need to make sure that the command buffers are being submitted to the correct queue.

    return nil;
}

void Queue::removeMTLCommandBuffer(id<MTLCommandBuffer> commandBuffer)
{
    if (!commandBuffer)
        return;

    id<MTLCommandEncoder> existingEncoder = encoderForBuffer(commandBuffer);
    endEncoding(existingEncoder, commandBuffer);
    removeMTLCommandBufferInternal(commandBuffer);
}

void Queue::removeMTLCommandBufferInternal(id<MTLCommandBuffer> commandBuffer)
{
    [m_openCommandEncoders removeObjectForKey:commandBuffer];
    [m_createdNotCommittedBuffers removeObject:commandBuffer];
}

void Queue::waitForAllCommitedWorkToComplete()
{
    id<MTLCommandBuffer> commandBuffer = nil;
    do {
        {
            Locker locker { m_committedNotCompletedBuffersLock };
            commandBuffer = m_committedNotCompletedBuffers.firstObject;
        }
        [commandBuffer waitUntilCompleted];
    } while (commandBuffer);
}

template<unsigned errorCode>
[[noreturn]] void crashGPUProcess(NSError* error, NSError* underlyingError)
{
    WTFLogAlways("Encountered fatal command buffer error %@, underlying error %@", error, underlyingError); // NOLINT
    RELEASE_ASSERT_NOT_REACHED();
}

void Queue::commitMTLCommandBuffer(id<MTLCommandBuffer> commandBuffer)
{
    if (!commandBuffer || commandBuffer.status >= MTLCommandBufferStatusCommitted || !isValid()) {
        removeMTLCommandBuffer(commandBuffer);
        return;
    }

    ASSERT(commandBuffer.commandQueue == m_commandQueue);
    [commandBuffer addScheduledHandler:[protectedThis = protect(*this)](id<MTLCommandBuffer>) {
        protectedThis->scheduleWork([protectedThis = protectedThis.copyRef()]() {
            ++(protectedThis->m_scheduledCommandBufferCount);
            for (auto& callback : protectedThis->m_onSubmittedWorkScheduledCallbacks.take(protectedThis->m_scheduledCommandBufferCount))
                callback();
        });
    }];
    [commandBuffer addCompletedHandler:[protectedThis = protect(*this)](id<MTLCommandBuffer> mtlCommandBuffer) {
        MTLCommandBufferStatus status = mtlCommandBuffer.status;
        bool loseTheDevice = false;
        if (NSError *error = mtlCommandBuffer.error; status != MTLCommandBufferStatusCompleted) {
            loseTheDevice = !error || error.code != MTLCommandBufferErrorNotPermitted;
            if (loseTheDevice) {
                NSError* underlyingError = error.userInfo[NSUnderlyingErrorKey];
                if (underlyingError.code == 0x10a || underlyingError.code == 0x5)
                    loseTheDevice = false;
                else {
#define makeCase(N) case N: crashGPUProcess<N>(error, underlyingError);
                    switch (underlyingError.code) {
                        makeCase(8); // kIOGPUCommandBufferCallbackErrorOutOfMemory = 8,
                        makeCase(9); // kIOGPUCommandBufferCallbackErrorInvalidResource = 9,
                        makeCase(10); // kIOGPUCommandBufferCallbackErrorInvalidInput = 10,
                        makeCase(11); // kIOGPUCommandBufferCallbackErrorPageFault = 11,
                        makeCase(16); // kIOGPUCommandBufferCallbackErrorProtectionViolation = 16,
                        makeCase(17); // kIOGPUCommandBufferCallbackErrorStackOverflow = 17,
                        break;
                    default:
                        break;
                    }
#undef makeCase
                    WTFLogAlways("Encountered non-fatal command buffer error %@, underlying error %@", error, underlyingError); // NOLINT
                }
            }
        }

        {
            Locker locker { protectedThis->m_committedNotCompletedBuffersLock };
            [protectedThis->m_committedNotCompletedBuffers removeObject:mtlCommandBuffer];
        }

        protectedThis->scheduleWork([loseTheDevice, protectedThis = protectedThis.copyRef()]() {
            ++(protectedThis->m_completedCommandBufferCount);
            for (auto& callback : protectedThis->m_onSubmittedWorkDoneCallbacks.take(protectedThis->m_completedCommandBufferCount))
                callback(WGPUQueueWorkDoneStatus_Success);
            if (loseTheDevice) {
                auto device = protectedThis->m_device.get();
                if (device)
                    device->loseTheDevice(WGPUDeviceLostReason_Undefined);
            }
        });
    }];

    [commandBuffer commit];
    {
        Locker locker { m_committedNotCompletedBuffersLock };
        [m_committedNotCompletedBuffers addObject:commandBuffer];
    }
    removeMTLCommandBufferInternal(commandBuffer);
    ++m_submittedCommandBufferCount;
}

static void invalidateCommandBuffers(Vector<Ref<WebGPU::CommandBuffer>>&& commands, auto&& makeInvalidFunc)
{
    for (auto commandBuffer : commands)
        makeInvalidFunc(commandBuffer.get());
}

void Queue::submit(Vector<Ref<WebGPU::CommandBuffer>>&& commands)
{
    auto device = m_device.get();
    if (!device)
        return;

    // https://gpuweb.github.io/gpuweb/#dom-gpuqueue-submit
    if (NSString* error = errorValidatingSubmit(commands)) {
        device->generateAValidationError(error ?: @"Validation failure.");
        return invalidateCommandBuffers(WTF::move(commands), ^(CommandBuffer& command) {
            command.makeInvalid(command.lastError() ?: error);
        });
    }

    finalizeBlitCommandEncoder();

    NSMutableOrderedSet<id<MTLCommandBuffer>> *commandBuffersToSubmit = [NSMutableOrderedSet orderedSetWithCapacity:commands.size()];
    HashMap<void*, Ref<CommandBuffer>> metalCommandBuffersReverseMap;
    NSString* validationError = nil;
    for (Ref command : commands) {
        if (id<MTLCommandBuffer> mtlBuffer = command->commandBuffer(); mtlBuffer && ![commandBuffersToSubmit containsObject:mtlBuffer]) {
            [commandBuffersToSubmit addObject:mtlBuffer];
            metalCommandBuffersReverseMap.set((__bridge void*)mtlBuffer, WTF::move(command));
        } else {
            validationError = command->lastError() ?: @"Command buffer appears twice.";
            break;
        }
    }

    invalidateCommandBuffers(WTF::move(commands), ^(CommandBuffer& command) {
        validationError ? command.makeInvalid(command.lastError() ?: validationError) : command.makeInvalidDueToCommit(@"command buffer was submitted");
    });
    if (validationError) {
        device->generateAValidationError(@"Command buffer appears twice.");
        return;
    }

    for (id<MTLCommandBuffer> commandBuffer in commandBuffersToSubmit) {
        RefPtr apiCommandBuffer = metalCommandBuffersReverseMap.get((__bridge void*)commandBuffer);
#if ASSERT_ENABLED
        if (!apiCommandBuffer)
            ASSERT_NOT_REACHED("Always expect command buffer in the container");
#endif
        apiCommandBuffer->preCommitHandler();
        commitMTLCommandBuffer(commandBuffer);
        apiCommandBuffer->postCommitHandler();
    }

    if ([MTLCaptureManager sharedCaptureManager].isCapturing && device->shouldStopCaptureAfterSubmit())
        [[MTLCaptureManager sharedCaptureManager] stopCapture];
}

uint64_t Queue::retainCounterSampleBuffer(CommandEncoder& encoder)
{
    auto encoderHandle = encoder.uniqueId();
    [m_retainedCounterSampleBuffers setObject:encoder.timestampBuffers() forKey:[NSNumber numberWithUnsignedLongLong:encoderHandle]];
    return encoderHandle;
}

void Queue::releaseCounterSampleBuffer(uint64_t encoderHandle)
{
    scheduleWork([protectedThis = protect(*this), encoderHandle]() {
        [protectedThis->m_retainedCounterSampleBuffers removeObjectForKey:[NSNumber numberWithUnsignedLongLong:encoderHandle]];
    });
}

void Queue::retainTimestampsForOneUpdate(NSMutableSet<id<MTLCounterSampleBuffer>> *timestamps)
{
    // Workaround for rdar://143905417
    if (!timestamps)
        return;

    scheduleWork([protectedThis = protect(*this), timestamps]() {
        UNUSED_PARAM(timestamps);
    });
}

bool Queue::validateWriteBuffer(const Buffer& buffer, uint64_t bufferOffset, size_t size) const
{
    if (!isValidToUseWith(buffer, *this))
        return false;

    auto bufferState = buffer.state();
    if (bufferState != Buffer::State::Unmapped)
        return false;

    if (!(buffer.usage() & WGPUBufferUsage_CopyDst))
        return false;

    if (size % 4)
        return false;

    if (bufferOffset % 4)
        return false;

    auto end = checkedSum<uint64_t>(bufferOffset, size);
    if (end.hasOverflowed() || end.value() > buffer.currentSize())
        return false;

    return true;
}

void Queue::synchronizeResourceAndWait(id<MTLBuffer> buffer)
{
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if (buffer.storageMode != MTLStorageModeManaged)
        return;

    ensureBlitCommandEncoder();
    [m_blitCommandEncoder synchronizeResource:buffer];
    ALLOW_DEPRECATED_DECLARATIONS_END
    id<MTLCommandBuffer> commandBuffer = m_commandBuffer;
    finalizeBlitCommandEncoder();
    [commandBuffer waitUntilCompleted];
#else
    UNUSED_PARAM(buffer);
#endif
}

id<MTLIndirectCommandBuffer> Queue::trimICB(id<MTLIndirectCommandBuffer> dest, id<MTLIndirectCommandBuffer> src, NSUInteger newSize)
{
    ensureBlitCommandEncoder();
    [m_blitCommandEncoder copyIndirectCommandBuffer:src sourceRange:NSMakeRange(0, newSize) destination:dest destinationIndex:0];

    return dest;
}

static std::pair<uint32_t, uint16_t> NODELETE maxIndexValueSlow(std::span<uint8_t> data)
{
    auto lengthUint32 = data.size() / 4;
    std::span<uint32_t> dataUint = unsafeMakeSpan(static_cast<uint32_t*>(static_cast<void*>(data.data())), lengthUint32);
    std::span<uint16_t> dataUshort = unsafeMakeSpan(static_cast<uint16_t*>(static_cast<void*>(data.data())), lengthUint32 * 2);
    uint32_t maxValue = 0;
    for (uint32_t dataUintV : dataUint) {
        if (maxValue < dataUintV)
            maxValue = dataUintV;
    }
    uint16_t maxUshort = 0;
    for (uint16_t dataUshortV : dataUshort) {
        if (maxUshort < dataUshortV)
            maxUshort = dataUshortV;
    }
    return std::make_pair(maxValue, maxUshort);
}

static std::pair<uint32_t, uint16_t> maxIndexValue(std::span<uint8_t> data)
{
    constexpr auto blockSize = 64;
    auto divResult = std::div(data.size(), blockSize);
    auto lengthUint32 = divResult.quot;
    if (!lengthUint32 || reinterpret_cast<uint64_t>(data.data()) % 64)
        return maxIndexValueSlow(data);

    std::span<simd::uint16> dataUint = unsafeMakeSpan(static_cast<simd::uint16*>(static_cast<void*>(data.data())), lengthUint32);
    std::span<simd::ushort32> dataUshort = unsafeMakeSpan(static_cast<simd::ushort32*>(static_cast<void*>(data.data())), lengthUint32);
    simd::uint16 maxValue = dataUint.front();
    simd::ushort32 maxUshort = dataUshort.front();

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wpsabi"
    for (auto dataUintV : dataUint)
        maxValue = simd_max(maxValue, dataUintV);
    for (auto dataUshortV : dataUshort)
        maxUshort = simd_max(maxUshort, dataUshortV);

    auto result = std::make_pair(simd_reduce_max(maxValue), simd_reduce_max(maxUshort));
#pragma clang diagnostic pop

    if (divResult.rem) {
        auto slowResult = maxIndexValueSlow(data.subspan(blockSize * divResult.quot));
        result.first = std::max(result.first, slowResult.first);
        result.second = std::max(result.second, slowResult.second);
    }
    return result;
}

void Queue::writeBuffer(Buffer& buffer, uint64_t bufferOffset, std::span<uint8_t> data)
{
    auto device = m_device.get();
    if (!device)
        return;

    // https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writebuffer

    auto dataSize = data.size();
    if (!validateWriteBuffer(buffer, bufferOffset, dataSize) || !isValidToUseWith(buffer, *this)) {
        device->generateAValidationError("Validation failure."_s);
        return;
    }

    if (data.empty())
        return;

    if (buffer.isDestroyed()) {
        device->generateAValidationError("GPUQueue.writeBuffer: destination buffer is destroyed"_s);
        return;
    }

    // FIXME(PERFORMANCE): Instead of checking whether or not the whole queue is idle,
    // we could detect whether this specific resource is idle, if we tracked every resource.
    bool needsInvalidation = true;

    if (dataSize < 16*KB && (buffer.usage() & WGPUBufferUsage_Index) && !(buffer.usage() & WGPUBufferUsage_Indirect)) {
        auto maxUnsignedUshortValue = maxIndexValue(data);
        if (!buffer.needsIndexValidation(maxUnsignedUshortValue.first, maxUnsignedUshortValue.second))
            needsInvalidation = false;
    }
    if (needsInvalidation)
        buffer.indirectBufferInvalidated();
    if (isIdle()) {
        switch (buffer.buffer().storageMode) {
        case MTLStorageModeShared:
            SUPPRESS_UNCOUNTED_ARG memcpySpan(borrow(buffer)->getBufferContents().subspan(bufferOffset, data.size()), data);
            return;
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        case MTLStorageModeManaged:
            SUPPRESS_UNCOUNTED_ARG memcpySpan(borrow(buffer)->getBufferContents().subspan(bufferOffset, data.size()), data);
            [buffer.buffer() didModifyRange:NSMakeRange(bufferOffset, data.size())];
            return;
        ALLOW_DEPRECATED_DECLARATIONS_END
#endif
        case MTLStorageModePrivate:
            // The only way to get data into a private resource is to tell the GPU to copy it in.
            break;
        default:
            ASSERT_NOT_REACHED();
            return;
        }
    }
    writeBuffer(buffer.buffer(), bufferOffset, data);
}

static std::span<uint8_t> span(id<MTLBuffer> buffer)
{
    return unsafeMakeSpan(static_cast<uint8_t*>(buffer.contents), buffer.length);
}

std::pair<id<MTLBuffer>, uint64_t> Queue::newTemporaryBufferWithBytes(std::span<uint8_t> dataSpan)
{
    auto device = m_device.get();
    if (!device)
        return std::make_pair(nil, 0ull);

    // The data is always copied: the callers of wgpuQueueWriteBuffer/WriteTexture in this binary
    // pass the JS-owned bytes straight through and are free to release them once the call returns.
    auto dataSize = dataSpan.size();
    if (!m_temporaryBuffer || m_temporaryBufferOffset + dataSize > m_temporaryBuffer.length) {
        m_temporaryBuffer = device->safeCreateBuffer(std::max(dataSize, 64 * KB), skipMemoryAttribution);
        m_temporaryBufferOffset = 0;
    }

    auto priorOffset = m_temporaryBufferOffset;
    m_temporaryBufferOffset += WTF::roundUpToMultipleOf(64, dataSize);
    memcpySpan(span(m_temporaryBuffer).subspan(priorOffset), dataSpan);
    return std::make_pair(m_temporaryBuffer, priorOffset);
}

void Queue::writeBuffer(id<MTLBuffer> buffer, uint64_t bufferOffset, std::span<uint8_t> data)
{
#if ENABLE(WEBGPU_SWIFT)
    if (isWebGPUSwiftEnabled()) {
        queueWriteBuffer(this, buffer, bufferOffset, data);
        return;
    }
#endif

    auto device = m_device.get();
    if (!device)
        return;

    ensureBlitCommandEncoder();
    auto bufferWithOffset = newTemporaryBufferWithBytes(data);
    id<MTLBuffer> temporaryBuffer = bufferWithOffset.first;
    uint64_t temporaryBufferOffset = bufferWithOffset.second;
    if (!temporaryBuffer) {
        ASSERT_NOT_REACHED();
        return;
    }

    [m_blitCommandEncoder
        copyFromBuffer:temporaryBuffer
        sourceOffset:temporaryBufferOffset
        toBuffer:buffer
        destinationOffset:bufferOffset
        size:data.size()];
}

void Queue::clearBuffer(id<MTLBuffer> buffer, NSUInteger offset, NSUInteger size)
{
    if (offset > buffer.length)
        return;

    ensureBlitCommandEncoder();
    auto lengthMinusOffset = buffer.length - offset;
    [m_blitCommandEncoder fillBuffer:buffer range:NSMakeRange(offset, std::min<NSUInteger>(lengthMinusOffset, size)) value:0];
}

bool Queue::isIdle() const
{
    return m_submittedCommandBufferCount == m_completedCommandBufferCount && !m_blitCommandEncoder;
}

NSString* Queue::errorValidatingWriteTexture(const WGPUImageCopyTexture& destination, const WGPUTextureDataLayout& dataLayout, const WGPUExtent3D& size, size_t dataByteSize, const Texture& texture) const
{
#define ERROR_STRING(x) [NSString stringWithFormat:@"GPUQueue.writeTexture: %@", x]
    if (!isValidToUseWith(texture, *this))
        return ERROR_STRING(@"destination texture is not valid");

    if (NSString* error = Texture::errorValidatingImageCopyTexture(destination, size))
        return ERROR_STRING(error);

    if (!(texture.usage() & WGPUTextureUsage_CopyDst))
        return ERROR_STRING(@"texture usage does not contain CopyDst");

    if (texture.sampleCount() != 1)
        return ERROR_STRING(@"destinationTexture sampleCount is not 1");

    if (NSString* error = Texture::errorValidatingTextureCopyRange(destination, size))
        return ERROR_STRING(error);

    if (!Texture::refersToSingleAspect(texture.format(), destination.aspect))
        return ERROR_STRING(@"refersToSingleAspect failed");

    auto aspectSpecificFormat = texture.format();

    if (Texture::isDepthOrStencilFormat(texture.format())) {
        if (!Texture::isValidDepthStencilCopyDestination(texture.format(), destination.aspect))
            return ERROR_STRING(@"isValidDepthStencilCopyDestination failed");

        aspectSpecificFormat = Texture::aspectSpecificFormat(texture.format(), destination.aspect);
    }

    if (NSString* errorString = Texture::errorValidatingLinearTextureData(dataLayout, dataByteSize, aspectSpecificFormat, size))
        return ERROR_STRING(errorString);

#undef ERROR_STRING
    return nil;
}

const Device& Queue::device() const
{
    auto device = m_device.get();
    RELEASE_ASSERT(device);
    return *device.unsafeGet();
}

void Queue::clearTextureIfNeeded(const WGPUImageCopyTexture& destination, NSUInteger slice)
{
    auto device = m_device.get();
    if (!device)
        return;

    Ref texture = fromAPI(destination.texture);
    if (texture->isDestroyed()) {
        device->generateAValidationError("GPUQueue.clearTexture: destination texture is destroyed"_s);
        return;
    }

    ensureBlitCommandEncoder();
    CommandEncoder::clearTextureIfNeeded(destination, slice, *device, m_blitCommandEncoder);
}

bool Queue::writeWillCompletelyClear(WGPUTextureDimension textureDimension, uint32_t widthForMetal, uint32_t logicalSizeWidth, uint32_t heightForMetal, uint32_t logicalSizeHeight, uint32_t depthForMetal, uint32_t logicalSizeDepthOrArrayLayers)
{
    switch (textureDimension) {
    case WGPUTextureDimension_1D:
        return widthForMetal == logicalSizeWidth;
    case WGPUTextureDimension_2D:
        return widthForMetal == logicalSizeWidth && heightForMetal == logicalSizeHeight;
    case WGPUTextureDimension_3D:
        return widthForMetal == logicalSizeWidth && heightForMetal == logicalSizeHeight && depthForMetal == logicalSizeDepthOrArrayLayers;
    case WGPUTextureDimension_Force32:
        return false;
    }

    ASSERT_NOT_REACHED();
    return false;
}

void Queue::writeTexture(const WGPUImageCopyTexture& destination, std::span<uint8_t> data, const WGPUTextureDataLayout& dataLayout, const WGPUExtent3D& size, bool skipValidation)
{
    auto device = m_device.get();
    if (!device)
        return;

    // https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writetexture

    auto dataByteSize = data.size();
    Ref texture = fromAPI(destination.texture);
    if (texture->isDestroyed()) {
        device->generateAValidationError("GPUQueue.writeTexture: destination texture is destroyed"_s);
        return;
    }

    auto textureFormat = texture->format();
    if (Texture::isDepthOrStencilFormat(textureFormat)) {
        textureFormat = Texture::aspectSpecificFormat(textureFormat, destination.aspect);
        if (textureFormat == WGPUTextureFormat_Undefined) {
            device->generateAValidationError("Invalid depth-stencil format"_s);
            return;
        }
    }

    if (!skipValidation) {
        if (NSString* error = errorValidatingWriteTexture(destination, dataLayout, size, dataByteSize, texture)) {
            device->generateAValidationError(error);
            return;
        }
    }

    if (data.empty() || !dataByteSize || dataByteSize <= dataLayout.offset)
        return;

    uint32_t blockSize = Texture::texelBlockSize(textureFormat);
    auto logicalSize = texture->logicalMiplevelSpecificTextureExtent(destination.mipLevel);
    auto widthForMetal = logicalSize.width < destination.origin.x ? 0 : std::min(size.width, logicalSize.width - destination.origin.x);
    if (!widthForMetal)
        return;

    auto heightForMetal = logicalSize.height < destination.origin.y ? 0 : std::min(size.height, logicalSize.height - destination.origin.y);
    auto depthForMetal = logicalSize.depthOrArrayLayers < destination.origin.z ? 0 : std::min(size.depthOrArrayLayers, logicalSize.depthOrArrayLayers - destination.origin.z);

    NSUInteger bytesPerRow = dataLayout.bytesPerRow;
    if (bytesPerRow == WGPU_COPY_STRIDE_UNDEFINED)
        bytesPerRow = std::max<uint32_t>(size.height ? (data.size() / size.height) : data.size(), Texture::bytesPerRow(textureFormat, widthForMetal, texture->sampleCount()));

    switch (texture->dimension()) {
    case WGPUTextureDimension_1D: {
        auto blockSizeTimes1DTextureLimit = checkedProduct<uint32_t>(blockSize, device->limits().maxTextureDimension1D);
        bytesPerRow = blockSizeTimes1DTextureLimit.hasOverflowed() ? bytesPerRow : std::min<uint32_t>(bytesPerRow, blockSizeTimes1DTextureLimit.value());
    }break;
    case WGPUTextureDimension_2D:
    case WGPUTextureDimension_3D: {
        auto blockSizeTimes2DTextureLimit = checkedProduct<uint32_t>(blockSize, device->limits().maxTextureDimension2D);
        bytesPerRow = blockSizeTimes2DTextureLimit.hasOverflowed() ? bytesPerRow : std::min<uint32_t>(bytesPerRow, blockSizeTimes2DTextureLimit.value());
    } break;
    case WGPUTextureDimension_Force32:
        break;
    }

    NSUInteger rowsPerImage = (dataLayout.rowsPerImage == WGPU_COPY_STRIDE_UNDEFINED) ? size.height : dataLayout.rowsPerImage;
    auto checkedBytesPerImage = checkedProduct<uint32_t>(bytesPerRow, rowsPerImage);
    if (checkedBytesPerImage.hasOverflowed())
        return;
    NSUInteger bytesPerImage = checkedBytesPerImage.value();

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

    id<MTLTexture> mtlTexture = texture->texture();
    auto textureDimension = texture->dimension();
    uint32_t sliceCount = textureDimension == WGPUTextureDimension_3D ? 1 : size.depthOrArrayLayers;
    bool clearWasNeeded = false;
    for (uint32_t layer = 0; layer < sliceCount; ++layer) {
        auto checkedDestinationSlice = checkedSum<uint32_t>(destination.origin.z, layer);
        if (checkedDestinationSlice.hasOverflowed())
            return;
        NSUInteger destinationSlice = textureDimension == WGPUTextureDimension_3D ? 0 : checkedDestinationSlice.value();
        if (!texture->previouslyCleared(destination.mipLevel, destinationSlice)) {
            if (writeWillCompletelyClear(textureDimension, widthForMetal, logicalSize.width, heightForMetal, logicalSize.height, depthForMetal, logicalSize.depthOrArrayLayers))
                texture->setPreviouslyCleared(destination.mipLevel, destinationSlice);
            else {
                clearWasNeeded = true;
                clearTextureIfNeeded(destination, destinationSlice);
            }
        }
    }

    auto checkedBlockSizeTimes2048 = checkedProduct<uint32_t>(2048, blockSize);
    if (checkedBlockSizeTimes2048.hasOverflowed())
        return;
    NSUInteger maxRowBytes = textureDimension == WGPUTextureDimension_3D ? checkedBlockSizeTimes2048.value() : bytesPerRow;
    bool isCompressed = Texture::isCompressedFormat(textureFormat);
    auto blockHeight = Texture::texelBlockHeight(textureFormat);
    auto blockWidth = Texture::texelBlockWidth(textureFormat);
    if (!isCompressed && (bytesPerRow % blockSize || (bytesPerRow > maxRowBytes))) {
        WGPUExtent3D newSize {
            .width = size.width,
            .height = isCompressed ? blockSize : blockHeight,
            .depthOrArrayLayers = 1
        };

        if (textureDimension != WGPUTextureDimension_1D && (heightForMetal > newSize.height || depthForMetal > newSize.depthOrArrayLayers)) {
            WGPUTextureDataLayout newDataLayout {
                .offset = 0,
                .bytesPerRow = std::min<uint32_t>(maxRowBytes, dataLayout.bytesPerRow),
                .rowsPerImage = newSize.height
            };

            uint32_t blockWidth = Texture::texelBlockWidth(textureFormat);
            auto widthInBlocks = blockWidth ? (widthForMetal / blockWidth) : 0;
            auto bytesInLastRow = checkedProduct<uint64_t>(blockSize, widthInBlocks);
            if (bytesInLastRow.hasOverflowed())
                return;

            for (uint32_t z = 0, endZ = std::max<uint32_t>(1, depthForMetal); z < endZ; ++z) {
                WGPUImageCopyTexture newDestination = destination;
                auto checkedNewDestinationOriginZ = checkedSum<uint32_t>(destination.origin.z, z);
                if (checkedNewDestinationOriginZ.hasOverflowed())
                    return;
                newDestination.origin.z = checkedNewDestinationOriginZ.value();
                for (uint32_t y = 0, endY = textureDimension == WGPUTextureDimension_1D ? std::max<uint32_t>(1, heightForMetal) : heightForMetal; y < endY; ) {
                    auto checkedDestinationOriginYPlusY = checkedSum<uint32_t>(destination.origin.y, y);
                    if (checkedDestinationOriginYPlusY.hasOverflowed())
                        return;
                    newDestination.origin.y = checkedDestinationOriginYPlusY.value();
                    auto checkedNewDestinationOriginYPlusHeight = checkedSum<uint32_t>(newDestination.origin.y, newSize.height);
                    if (checkedNewDestinationOriginYPlusHeight.value() > logicalSize.height)
                        newSize.height = static_cast<uint32_t>(checkedNewDestinationOriginYPlusHeight.value() - logicalSize.height);

                    auto checkedBytesPerRowTimesHeight = checkedProduct<uint32_t>(bytesPerRow, newSize.height);
                    if (checkedBytesPerRowTimesHeight.hasOverflowed())
                        return;
                    auto size = (y + 1 == endY) ? bytesInLastRow.value() : checkedBytesPerRowTimesHeight.value();
                    for (uint32_t x = 0; x < widthForMetal; ) {
                        auto checkedDestinationOriginXPlusX = checkedSum<uint32_t>(destination.origin.x, x);
                        if (checkedDestinationOriginXPlusX.hasOverflowed())
                            return;
                        newDestination.origin.x = checkedDestinationOriginXPlusX.value();
                        auto checkedYTimesBytesPerRow = checkedProduct<uint32_t>(y, bytesPerRow);
                        auto checkedZTimesBytesPerImage = checkedProduct<uint32_t>(z, bytesPerImage);
                        if (checkedYTimesBytesPerRow.hasOverflowed() || checkedZTimesBytesPerImage.hasOverflowed())
                            return;
                        auto checkedXPlusYPlusZ = checkedSum<uint32_t>(x, checkedYTimesBytesPerRow.value(), checkedZTimesBytesPerImage.value());
                        if (checkedXPlusYPlusZ.hasOverflowed())
                            return;
                        auto offset = checkedXPlusYPlusZ.value();
                        auto checkedOffsetPlusSize = checkedSum<uint32_t>(offset, size);
                        if (checkedOffsetPlusSize.hasOverflowed() || checkedOffsetPlusSize.value() > data.size())
                            return;

                        writeTexture(newDestination, data.subspan(offset, size), newDataLayout, newSize);
                        auto checkedXPlusMaxRowBytes = checkedSum<uint32_t>(x, maxRowBytes);
                        if (checkedXPlusMaxRowBytes.hasOverflowed())
                            return;
                        x = checkedXPlusMaxRowBytes.value();
                    }
                    auto checkedYPlusHeight = checkedSum<uint32_t>(y, newSize.height);
                    if (checkedYPlusHeight.hasOverflowed())
                        return;
                    y = checkedYPlusHeight.value();
                }
            }
            return;
        }

        bytesPerRow = 0;
        bytesPerImage = 0;
    }

    switch (textureDimension) {
    case WGPUTextureDimension_1D:
        if (!widthForMetal || !heightForMetal)
            return;
        break;
    case WGPUTextureDimension_2D:
        if (!widthForMetal || !heightForMetal)
            return;
        break;
    case WGPUTextureDimension_3D:
        if (!widthForMetal || !heightForMetal || !depthForMetal)
            return;
        break;
    case WGPUTextureDimension_Force32:
        return;
    }

    Vector<uint8_t> newData;
    auto checkedNewBytesPerRow = checkedProduct<uint32_t>(blockSize, ((widthForMetal / blockWidth) + ((widthForMetal % blockWidth) ? 1 : 0)));
    if (checkedNewBytesPerRow.hasOverflowed())
        return;
    const auto newBytesPerRow = checkedNewBytesPerRow.value();
    auto dataLayoutOffset = dataLayout.offset;
    const bool widthMismatch = newBytesPerRow != bytesPerRow && widthForMetal == logicalSize.width && heightForMetal == logicalSize.height;
    const bool multipleOfBlockSize = bytesPerRow % blockSize;
    if (isCompressed && (widthMismatch || multipleOfBlockSize)) {

        const auto maxY = std::max<size_t>(blockHeight, heightForMetal) / blockHeight;
        auto checkedNewBytesPerImage = checkedProduct<uint32_t>(newBytesPerRow, std::max<size_t>(blockHeight, logicalSize.height / blockHeight + (logicalSize.height % blockHeight ? 1 : 0)));
        if (checkedNewBytesPerImage.hasOverflowed())
            return;
        auto newBytesPerImage = checkedNewBytesPerImage.value();
        const auto maxZ = std::max<size_t>(1, size.depthOrArrayLayers);
        auto checkedNewBytesPerImageTimesMaxZ = checkedProduct<uint32_t>(newBytesPerImage, maxZ);
        if (checkedNewBytesPerImageTimesMaxZ.hasOverflowed())
            return;
        newData = Vector<uint8_t>(FillWith { }, checkedNewBytesPerImageTimesMaxZ.value(), 0);
        dataLayoutOffset = 0;

        auto verticalOffset = checkedProduct<uint64_t>(maxY ? (maxY - 1) : 0, bytesPerRow);
        ASSERT(maxZ);
        auto depthOffset = checkedProduct<uint64_t>(maxZ - 1, bytesPerImage);
        auto maxResult = checkedSum<uint64_t>(verticalOffset.value(), depthOffset.value(), newBytesPerRow);
        if (verticalOffset.hasOverflowed() || depthOffset.hasOverflowed() || maxResult.hasOverflowed()) {
            device->generateAValidationError("Result overflows uin64_t"_s);
            return;
        }

        if (maxY) {
            auto maxYMinus1TimesNewBytesPerRow = checkedProduct<uint32_t>((maxY - 1), newBytesPerRow);
            auto maxZMinus1TimesNewBytesPerImage = checkedProduct<uint32_t>((maxZ - 1), newBytesPerImage);
            auto maxYMinus1TimesBytesPerRow = checkedProduct<uint32_t>((maxY - 1), bytesPerRow);
            auto maxZMinus1TimesBytesPerImage = checkedProduct<uint32_t>((maxZ - 1), bytesPerImage);
            if (maxYMinus1TimesNewBytesPerRow.hasOverflowed() || maxZMinus1TimesNewBytesPerImage.hasOverflowed() || maxYMinus1TimesBytesPerRow.hasOverflowed() || maxZMinus1TimesBytesPerImage.hasOverflowed())
                return;
            auto checkedNewBytesSum = checkedSum<uint32_t>(maxYMinus1TimesNewBytesPerRow.value(), maxZMinus1TimesNewBytesPerImage.value(), newBytesPerRow);
            auto checkedBytesSum = checkedSum<uint32_t>(maxYMinus1TimesBytesPerRow.value(), maxZMinus1TimesBytesPerImage.value(), dataLayout.offset, newBytesPerRow);
            if (checkedNewBytesSum.hasOverflowed() || checkedBytesSum.hasOverflowed())
                return;
            if (checkedNewBytesSum.value() > newData.size() || checkedBytesSum.value() > data.size()) {
                auto y = (maxY - 1);
                auto z = (maxZ - 1);
                device->generateAValidationError([NSString stringWithFormat:@"y(%zu) * newBytesPerRow(%u) + z(%zu) * newBytesPerImage(%u) + newBytesPerRow(%u) > newData.size()(%zu) || y(%zu) * bytesPerRow(%lu) + z(%zu) * bytesPerImage(%lu) + newBytesPerRow(%u) > dataSize(%zu), copySize %u, %u, %u, textureSize %u, %u, %u, offset %llu", y, newBytesPerRow, z, newBytesPerImage, newBytesPerRow, newData.size(), y, static_cast<unsigned long>(bytesPerRow), z, static_cast<unsigned long>(bytesPerImage), newBytesPerRow, data.size(), widthForMetal, heightForMetal, depthForMetal, logicalSize.width, logicalSize.height, logicalSize.depthOrArrayLayers, dataLayout.offset]);
                return;
            }
        }

        auto newDataSpan = newData.mutableSpan();
        for (size_t z = 0; z < maxZ; ++z) {
            for (size_t y = 0; y < maxY; ++y) {
                auto yTimesBytesPerRow = checkedProduct<uint32_t>(y, bytesPerRow);
                auto yTimesNewBytesPerRow = checkedProduct<uint32_t>(y, newBytesPerRow);
                auto zTimesBytesPerImage = checkedProduct<uint32_t>(z, bytesPerImage);
                auto zTimesNewBytesPerImage = checkedProduct<uint32_t>(z, newBytesPerImage);
                if (yTimesBytesPerRow.hasOverflowed() || yTimesNewBytesPerRow.hasOverflowed() || zTimesBytesPerImage.hasOverflowed() || zTimesNewBytesPerImage.hasOverflowed())
                    return;
                auto checkedYPlusZPlusOffset = checkedSum<uint32_t>(yTimesBytesPerRow.value(), zTimesBytesPerImage.value(), dataLayout.offset);
                auto checkedNewYPlusNewZ = checkedSum<uint32_t>(yTimesNewBytesPerRow.value(), zTimesNewBytesPerImage.value());
                if (checkedYPlusZPlusOffset.hasOverflowed() || checkedNewYPlusNewZ.hasOverflowed())
                    return;
                auto sourceBytesSpan = data.subspan(checkedYPlusZPlusOffset.value(), newBytesPerRow);
                auto destBytesSpan = newDataSpan.subspan(checkedNewYPlusNewZ.value(), newBytesPerRow);
                memcpySpan(destBytesSpan, sourceBytesSpan);
            }
        }

        bytesPerRow = newBytesPerRow;
        dataByteSize = newData.size();
        bytesPerImage = newBytesPerImage;
        data = newData.mutableSpan();
    }

    // FIXME(PERFORMANCE): Instead of checking whether or not the whole queue is idle,
    // we could detect whether this specific resource is idle, if we tracked every resource.
    if (isIdle() && options == MTLBlitOptionNone && !clearWasNeeded) {
        switch (mtlTexture.storageMode) {
        case MTLStorageModeShared:
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        case MTLStorageModeManaged:
        ALLOW_DEPRECATED_DECLARATIONS_END
#endif
            {
                switch (textureDimension) {
                case WGPUTextureDimension_1D: {
                    if (!widthForMetal || !heightForMetal)
                        return;

                    auto region = MTLRegionMake1D(destination.origin.x, widthForMetal);
                    for (uint32_t layer = 0; layer < size.depthOrArrayLayers; ++layer) {
                        auto checkedLayerTimesBytesPerImage = checkedProduct<uint32_t>(layer, bytesPerImage);
                        if (checkedLayerTimesBytesPerImage.hasOverflowed())
                            return;
                        auto checkedDataLayoutOffsetPlusSum = checkedSum<uint32_t>(dataLayoutOffset, checkedLayerTimesBytesPerImage.value());
                        if (checkedDataLayoutOffsetPlusSum.hasOverflowed())
                            return;
                        auto sourceOffset = static_cast<NSUInteger>(checkedDataLayoutOffsetPlusSum.value());
                        if (sourceOffset % blockSize)
                            continue;
                        auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
                        if (checkedDestinationSlice.hasOverflowed())
                            return;
                        NSUInteger destinationSlice = checkedDestinationSlice.value();
                        [mtlTexture
                            replaceRegion:region
                            mipmapLevel:destination.mipLevel
                            slice:destinationSlice
                            withBytes:byteCast<char>(data.subspan(sourceOffset).data())
                            bytesPerRow:0
                            bytesPerImage:0];
                    }
                    break;
                }
                case WGPUTextureDimension_2D: {
                    if (!widthForMetal || !heightForMetal)
                        return;

                    auto region = MTLRegionMake2D(destination.origin.x, destination.origin.y, widthForMetal, heightForMetal);
                    for (uint32_t layer = 0; layer < size.depthOrArrayLayers; ++layer) {
                        auto layerTimesBytesPerImage = checkedProduct<uint32_t>(layer, bytesPerImage);
                        if (layerTimesBytesPerImage.hasOverflowed())
                            return;

                        auto checkedSourceOffset = checkedSum<NSUInteger>(dataLayoutOffset, layerTimesBytesPerImage.value());
                        if (checkedSourceOffset.hasOverflowed())
                            return;
                        auto sourceOffset = checkedSourceOffset.value();
                        if (sourceOffset % blockSize)
                            continue;
                        auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
                        if (checkedDestinationSlice.hasOverflowed())
                            return;
                        NSUInteger destinationSlice = checkedDestinationSlice.value();
                        [mtlTexture
                            replaceRegion:region
                            mipmapLevel:destination.mipLevel
                            slice:destinationSlice
                            withBytes:byteCast<char>(data.subspan(sourceOffset).data())
                            bytesPerRow:bytesPerRow
                            bytesPerImage:0];
                    }
                    break;
                }
                case WGPUTextureDimension_3D: {
                    if (!widthForMetal || !heightForMetal || !depthForMetal)
                        return;

                    auto region = MTLRegionMake3D(destination.origin.x, destination.origin.y, destination.origin.z, widthForMetal, heightForMetal, depthForMetal);
                    auto sourceOffset = static_cast<NSUInteger>(dataLayoutOffset);
                    if (sourceOffset % blockSize)
                        break;
                    [mtlTexture
                        replaceRegion:region
                        mipmapLevel:destination.mipLevel
                        slice:0
                        withBytes:byteCast<char>(data.subspan(sourceOffset).data())
                        bytesPerRow:bytesPerRow
                        bytesPerImage:bytesPerImage];
                    break;
                }
                case WGPUTextureDimension_Force32:
                    ASSERT_NOT_REACHED();
                    return;
                }
                return;
            }
        case MTLStorageModePrivate:
            // The only way to get data into a private resource is to tell the GPU to copy it in.
            break;
        default:
            ASSERT_NOT_REACHED();
            return;
        }
    }

    ensureBlitCommandEncoder();
    // FIXME(PERFORMANCE): Suballocate, so the common case doesn't need to hit the kernel.
    // FIXME(PERFORMANCE): Should this temporary buffer really be shared?
    NSUInteger newBufferSize = dataByteSize - dataLayoutOffset;
    auto temporaryBufferWithOffset = newTemporaryBufferWithBytes(data.subspan(dataLayoutOffset));
    id<MTLBuffer> temporaryBuffer = temporaryBufferWithOffset.first;
    auto temporaryBufferOffset = temporaryBufferWithOffset.second;
    if (!temporaryBuffer)
        return;
    ASSERT(temporaryBuffer.length >= newBufferSize);

    switch (texture->dimension()) {
    case WGPUTextureDimension_1D: {
        // https://developer.apple.com/documentation/metal/mtlblitcommandencoder/1400771-copyfrombuffer?language=objc
        // "When you copy to a 1D texture, height and depth must be 1."
        auto sourceSize = MTLSizeMake(widthForMetal, 1, 1);
        if (!widthForMetal || !heightForMetal)
            return;

        auto destinationOrigin = MTLOriginMake(destination.origin.x, 0, 0);

        for (uint32_t layer = 0; layer < size.depthOrArrayLayers; ++layer) {
            auto checkedSourceOffset = checkedProduct<NSUInteger>(layer, bytesPerImage);
            if (checkedSourceOffset.hasOverflowed())
                return;
            NSUInteger sourceOffset = checkedSourceOffset.value();
            auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (checkedDestinationSlice.hasOverflowed())
                return;
            NSUInteger destinationSlice = checkedDestinationSlice.value();
            auto widthTimesBlockSize = checkedProduct<NSUInteger>(widthForMetal, blockSize);
            if (widthTimesBlockSize.hasOverflowed())
                return;
            auto sourceOffsetSum = checkedSum<NSUInteger>(sourceOffset, widthTimesBlockSize.value());
            if (sourceOffsetSum.hasOverflowed())
                return;
            if (sourceOffsetSum.value() > newBufferSize)
                continue;
            if (sourceOffset % blockSize)
                continue;

            [m_blitCommandEncoder
                copyFromBuffer:temporaryBuffer
                sourceOffset:sourceOffset + temporaryBufferOffset
                sourceBytesPerRow:bytesPerRow
                sourceBytesPerImage:0
                sourceSize:sourceSize
                toTexture:mtlTexture
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
        if (!widthForMetal || !heightForMetal || (bytesPerRow && bytesPerRow < Texture::bytesPerRow(textureFormat, widthForMetal, texture->sampleCount())))
            return;

        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, 0);
        for (uint32_t layer = 0; layer < size.depthOrArrayLayers; ++layer) {
            auto layerTimesBytesPerImage = checkedProduct<NSUInteger>(layer, bytesPerImage);
            if (layerTimesBytesPerImage.hasOverflowed())
                return;
            NSUInteger sourceOffset = layerTimesBytesPerImage.value();
            auto checkedDestinationSlice = checkedSum<NSUInteger>(destination.origin.z, layer);
            if (checkedDestinationSlice.hasOverflowed())
                return;
            NSUInteger destinationSlice = checkedDestinationSlice.value();
            if (sourceOffset % blockSize)
                continue;
            [m_blitCommandEncoder
                copyFromBuffer:temporaryBuffer
                sourceOffset:sourceOffset + temporaryBufferOffset
                sourceBytesPerRow:bytesPerRow
                sourceBytesPerImage:0
                sourceSize:sourceSize
                toTexture:mtlTexture
                destinationSlice:destinationSlice
                destinationLevel:destination.mipLevel
                destinationOrigin:destinationOrigin
                options:options];
        }
        break;
    }
    case WGPUTextureDimension_3D: {
        auto sourceSize = MTLSizeMake(widthForMetal, heightForMetal, depthForMetal);
        auto destinationOrigin = MTLOriginMake(destination.origin.x, destination.origin.y, destination.origin.z);
        if (!widthForMetal || !heightForMetal || !depthForMetal || (bytesPerRow && bytesPerRow < Texture::bytesPerRow(textureFormat, widthForMetal, texture->sampleCount())))
            return;

        [m_blitCommandEncoder
            copyFromBuffer:temporaryBuffer
            sourceOffset:temporaryBufferOffset
            sourceBytesPerRow:bytesPerRow
            sourceBytesPerImage:bytesPerImage
            sourceSize:sourceSize
            toTexture:mtlTexture
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

void Queue::setLabel(String&& label)
{
    m_commandQueue.label = createNSString(label).get();
}

void Queue::scheduleWork(Instance::WorkItem&& workItem)
{
    if (auto instance = m_instance.get())
        instance->scheduleWork(WTF::move(workItem));
}

void Queue::clearTextureViewIfNeeded(TextureView& textureView)
{
    Ref parentTexture = textureView.apiParentTexture();
    return clearTextureIfNeeded(parentTexture.get(), textureView.mipLevelCount(), textureView.arrayLayerCount(), textureView.baseMipLevel(), textureView.baseArrayLayer());
}

void Queue::clearTextureViewIfNeeded(Texture& texture)
{
    return clearTextureIfNeeded(texture, texture.mipLevelCount(), texture.arrayLayerCount(), 0, 0);
}

void Queue::clearTextureIfNeeded(Texture& parentTexture, uint32_t mipLevelCount, uint32_t arrayLayerCount, uint32_t baseMipLevel, uint32_t baseArrayLayer)
{
    auto devicePtr = m_device.get();
    if (!devicePtr)
        return;

    for (uint32_t slice = 0; slice < arrayLayerCount; ++slice) {
        for (uint32_t mipLevel = 0; mipLevel < mipLevelCount; ++mipLevel) {
            auto checkedParentMipLevel = checkedSum<uint32_t>(baseMipLevel, mipLevel);
            auto checkedParentSlice = checkedSum<uint32_t>(baseArrayLayer, slice);
            if (checkedParentMipLevel.hasOverflowed() || checkedParentSlice.hasOverflowed())
                return;
            auto parentMipLevel = checkedParentMipLevel.value();
            auto parentSlice = checkedParentSlice.value();
            if (parentTexture.previouslyCleared(parentMipLevel, parentSlice))
                continue;

            CommandEncoder::clearTextureIfNeeded(parentTexture, parentMipLevel, parentSlice, *devicePtr, ensureBlitCommandEncoder());
        }
    }
    finalizeBlitCommandEncoder();
}

id<MTLDevice> Queue::metalDevice() const
{
    return device().device();
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuQueueReference(WGPUQueue queue)
{
    WebGPU::fromAPI(queue).ref();
}

void wgpuQueueRelease(WGPUQueue queue)
{
    WebGPU::fromAPI(queue).deref();
}

void wgpuQueueOnSubmittedWorkDone(WGPUQueue queue, WGPUQueueWorkDoneCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(queue))->onSubmittedWorkDone([callback, userdata](WGPUQueueWorkDoneStatus status) {
        callback(status, userdata);
    });
}

void wgpuQueueOnSubmittedWorkDoneWithBlock(WGPUQueue queue, WGPUQueueWorkDoneBlockCallback callback)
{
    protect(WebGPU::fromAPI(queue))->onSubmittedWorkDone([callback = WebGPU::fromAPI(WTF::move(callback))](WGPUQueueWorkDoneStatus status) {
        callback(status);
    });
}

void wgpuQueueSubmit(WGPUQueue queue, size_t commandCount, const WGPUCommandBuffer* commands)
{
    Vector<Ref<WebGPU::CommandBuffer>> commandsToForward;
    for (auto& command : unsafeMakeSpan(commands, commandCount))
        commandsToForward.append(protect(WebGPU::fromAPI(command)));
    protect(WebGPU::fromAPI(queue))->submit(WTF::move(commandsToForward));
}

void wgpuQueueWriteBuffer(WGPUQueue queue, WGPUBuffer buffer, uint64_t bufferOffset, std::span<uint8_t> data)
{
    protect(WebGPU::fromAPI(queue))->writeBuffer(protect(WebGPU::fromAPI(buffer)), bufferOffset, data);
}

void wgpuQueueWriteTexture(WGPUQueue queue, const WGPUImageCopyTexture* destination, std::span<uint8_t> data, const WGPUTextureDataLayout* dataLayout, const WGPUExtent3D* writeSize)
{
    protect(WebGPU::fromAPI(queue))->writeTexture(*destination, data, *dataLayout, *writeSize);
}

void wgpuQueueSetLabel(WGPUQueue queue, const char* label)
{
    protect(WebGPU::fromAPI(queue))->setLabel(WebGPU::fromAPI(label));
}
