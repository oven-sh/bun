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

#import <Metal/Metal.h>
#import <wtf/FastMalloc.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/SwiftBridging.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/ThreadSafeWeakPtr.h>
#import <wtf/WeakPtr.h>
#import <wtf/threads/BinarySemaphore.h>

struct WGPUCommandBufferImpl {
};

namespace WebGPU {

class CommandEncoder;
class Device;

// https://gpuweb.github.io/gpuweb/#gpucommandbuffer
class CommandBuffer : public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<CommandBuffer>, public WGPUCommandBufferImpl {
    WTF_MAKE_TZONE_ALLOCATED(CommandBuffer);
public:
    static Ref<CommandBuffer> create(id<MTLCommandBuffer> commandBuffer, Device& device, id<MTLSharedEvent> sharedEvent, uint64_t sharedEventSignalValue, Vector<Function<bool(CommandBuffer&, CommandEncoder&)>>&& onCommitHandlers, CommandEncoder& commandEncoder)
    {
        return adoptRef(*new CommandBuffer(commandBuffer, device, sharedEvent, sharedEventSignalValue, WTF::move(onCommitHandlers), commandEncoder));
    }
    static Ref<CommandBuffer> createInvalid(Device& device)
    {
        return adoptRef(*new CommandBuffer(device));
    }

    ~CommandBuffer();

    void setLabel(String&&);

    bool isValid() const { return m_commandBuffer; }

    id<MTLCommandBuffer> commandBuffer() const { return m_commandBuffer; }

    Device& device() const { return m_device; }
    void makeInvalid(NSString*);
    void makeInvalidDueToCommit(NSString*);
    void setBufferMapCount(int bufferMapCount) { m_bufferMapCount = bufferMapCount; }
    int bufferMapCount() const { return m_bufferMapCount; }

    NSString* NODELETE lastError() const;
    bool waitForCompletion();
    bool preCommitHandler();
    void postCommitHandler();
    void addPostCommitHandler(Function<void(id<MTLCommandBuffer>)>&&);

private:
    CommandBuffer(id<MTLCommandBuffer>, Device&, id<MTLSharedEvent>, uint64_t sharedEventSignalValue, Vector<Function<bool(CommandBuffer&, CommandEncoder&)>>&&, CommandEncoder&);
    CommandBuffer(Device&);
    void retainTimestampsForOneUpdateLoop();

    id<MTLCommandBuffer> m_commandBuffer { nil };
    id<MTLCommandBuffer> m_cachedCommandBuffer { nil };
    int m_bufferMapCount { 0 };

    const Ref<Device> m_device;
    NSString* m_lastErrorString { nil };
    id<MTLSharedEvent> m_sharedEvent { nil };
    Vector<Function<bool(CommandBuffer&, CommandEncoder&)>> m_preCommitHandlers;
    Vector<Function<void(id<MTLCommandBuffer>)>> m_postCommitHandlers;
    const uint64_t m_sharedEventSignalValue { 0 };
    // FIXME: we should not need this semaphore - https://bugs.webkit.org/show_bug.cgi?id=272353
    BinarySemaphore m_commandBufferComplete;
    RefPtr<CommandEncoder> m_commandEncoder;
} SWIFT_SHARED_REFERENCE(refCommandBuffer, derefCommandBuffer) SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;

} // namespace WebGPU

inline void refCommandBuffer(WebGPU::CommandBuffer* obj)
{
    obj->ref();
}

inline void derefCommandBuffer(WebGPU::CommandBuffer* obj)
{
    obj->deref();
}
