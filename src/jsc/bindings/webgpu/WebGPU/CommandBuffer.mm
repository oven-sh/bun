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
#import "CommandBuffer.h"

#import "APIConversions.h"
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CommandBuffer);

CommandBuffer::CommandBuffer(id<MTLCommandBuffer> commandBuffer, Device& device, id<MTLSharedEvent> sharedEvent, uint64_t sharedEventSignalValue, Vector<Function<bool(CommandBuffer&, CommandEncoder&)>>&& onCommitHandlers, CommandEncoder& commandEncoder)
    : m_commandBuffer(commandBuffer)
    , m_device(device)
    , m_sharedEvent(sharedEvent)
    , m_preCommitHandlers(WTF::move(onCommitHandlers))
    , m_sharedEventSignalValue(sharedEventSignalValue)
    , m_commandEncoder(&commandEncoder)
{
}

CommandBuffer::CommandBuffer(Device& device)
    : m_device(device)
{
}

void CommandBuffer::retainTimestampsForOneUpdateLoop()
{
    // Workaround for rdar://143905417
    if (RefPtr commandEncoder = m_commandEncoder)
        m_device->getQueue()->retainTimestampsForOneUpdate(commandEncoder->timestampBuffers());
}

CommandBuffer::~CommandBuffer()
{
    retainTimestampsForOneUpdateLoop();
    m_device->getQueue()->removeMTLCommandBuffer(m_commandBuffer);
    m_commandBuffer = nil;
    m_cachedCommandBuffer = nil;
}

void CommandBuffer::setLabel(String&& label)
{
    m_commandBuffer.label = label.createNSString().get();
}

void CommandBuffer::makeInvalid(NSString* lastError)
{
    if (!m_commandBuffer || m_commandBuffer.status >= MTLCommandBufferStatusCommitted)
        return;

    m_lastErrorString = lastError;
    m_device->getQueue()->removeMTLCommandBuffer(m_commandBuffer);
    retainTimestampsForOneUpdateLoop();
    m_commandBuffer = nil;
    m_cachedCommandBuffer = nil;
    if (RefPtr commandEncoder = m_commandEncoder)
        commandEncoder->clearTracking();
    m_commandEncoder = nullptr;
    m_preCommitHandlers.clear();
    m_postCommitHandlers.clear();
}

bool CommandBuffer::preCommitHandler()
{
    bool result = true;
    if (RefPtr commandEncoder = m_commandEncoder) {
        auto& commandEncoderRef = *commandEncoder;
        for (auto& function : m_preCommitHandlers)
            result = function(*this, commandEncoderRef) && result;
    }

    m_preCommitHandlers.clear();
    return result;
}

void CommandBuffer::postCommitHandler()
{
    for (auto& function : m_postCommitHandlers)
        function(m_cachedCommandBuffer);

    m_postCommitHandlers.clear();
}

void CommandBuffer::addPostCommitHandler(Function<void(id<MTLCommandBuffer>)>&& function)
{
    m_postCommitHandlers.append(WTF::move(function));
}

void CommandBuffer::makeInvalidDueToCommit(NSString* lastError)
{
    if (m_sharedEvent)
        [m_commandBuffer encodeSignalEvent:m_sharedEvent value:m_sharedEventSignalValue];

    m_cachedCommandBuffer = m_commandBuffer;
    [m_commandBuffer addCompletedHandler:[protectedThis = protect(*this)](id<MTLCommandBuffer>) {
        protectedThis->m_commandBufferComplete.signal();
        protectedThis->m_device->getQueue()->scheduleWork([protectedThis]() mutable {
            protectedThis->m_cachedCommandBuffer = nil;
            if (RefPtr commandEncoder = protectedThis->m_commandEncoder)
                commandEncoder->clearTracking();

            protectedThis->m_commandEncoder = nullptr;
        });
    }];
    m_lastErrorString = lastError;
    m_commandBuffer = nil;
}

NSString* CommandBuffer::lastError() const
{
    return m_lastErrorString;
}

bool CommandBuffer::waitForCompletion()
{
    auto status = [m_cachedCommandBuffer status];
    constexpr auto commandBufferSubmissionTimeout = 500_ms;
    if (status == MTLCommandBufferStatusCommitted || status == MTLCommandBufferStatusScheduled)
        return m_commandBufferComplete.waitFor(commandBufferSubmissionTimeout);

    return true;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuCommandBufferReference(WGPUCommandBuffer commandBuffer)
{
    WebGPU::fromAPI(commandBuffer).ref();
}

void wgpuCommandBufferRelease(WGPUCommandBuffer commandBuffer)
{
    WebGPU::fromAPI(commandBuffer).deref();
}

void wgpuCommandBufferSetLabel(WGPUCommandBuffer commandBuffer, const char* label)
{
    protect(WebGPU::fromAPI(commandBuffer))->setLabel(WebGPU::fromAPI(label));
}
