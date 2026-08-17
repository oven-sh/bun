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

#import "Instance.h"
#import <Metal/Metal.h>
#import <wtf/CompletionHandler.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashMap.h>
#import <wtf/Ref.h>
#import <wtf/SwiftBridging.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/ThreadSafeRefCounted.h>
#import <wtf/ThreadSafeWeakPtr.h>
#import <wtf/Vector.h>
#import <wtf/WeakPtr.h>

IGNORE_CLANG_WARNINGS_BEGIN("nullability-completeness")

struct WGPUQueueImpl {
};

namespace WebGPU {

class Buffer;
class CommandBuffer;
class CommandEncoder;
class Device;
class Texture;
class TextureView;

// https://gpuweb.github.io/gpuweb/#gpuqueue
// A device owns its default queue, not the other way around.
class Queue : public WGPUQueueImpl, public ThreadSafeRefCounted<Queue> {
    WTF_MAKE_TZONE_ALLOCATED(Queue);
public:
    static Ref<Queue> create(id<MTLCommandQueue> commandQueue, Adapter& adapter, Device& device)
    {
        return adoptRef(*new Queue(commandQueue, adapter, device));
    }
    static Ref<Queue> createInvalid(Adapter& adapter, Device& device)
    {
        return adoptRef(*new Queue(adapter, device));
    }

    ~Queue();

    void onSubmittedWorkDone(CompletionHandler<void(WGPUQueueWorkDoneStatus)>&& callback);
    void submit(Vector<Ref<WebGPU::CommandBuffer>>&& commands);
    void writeBuffer(Buffer&, uint64_t bufferOffset, std::span<uint8_t> data);
    void writeBuffer(id<MTLBuffer>, uint64_t bufferOffset, std::span<uint8_t> data) HAS_SWIFTCXX_THUNK;
    void clearBuffer(id<MTLBuffer>, NSUInteger offset = 0, NSUInteger size = NSUIntegerMax);
    void writeTexture(const WGPUImageCopyTexture& destination, std::span<uint8_t> data, const WGPUTextureDataLayout&, const WGPUExtent3D& writeSize, bool skipValidation = false);
    void setLabel(String&&);

    void onSubmittedWorkScheduled(Function<void()>&&);

    bool isValid() const { return m_commandQueue; }
    void makeInvalid();
    void setCommittedSignalEvent(id<MTLSharedEvent>, size_t frameIndex);

    const Device& device() const SWIFT_RETURNS_INDEPENDENT_VALUE;
    void clearTextureIfNeeded(const WGPUImageCopyTexture&, NSUInteger);
    id<MTLCommandBuffer> _Nullable commandBufferWithDescriptor(MTLCommandBufferDescriptor*);
    void commitMTLCommandBuffer(id<MTLCommandBuffer>);
    void removeMTLCommandBuffer(id<MTLCommandBuffer>);
    void setEncoderForBuffer(id<MTLCommandBuffer>, id<MTLCommandEncoder>);
    id<MTLCommandEncoder> _Nullable encoderForBuffer(id<MTLCommandBuffer>) const;
    void clearTextureViewIfNeeded(TextureView&);
    void clearTextureViewIfNeeded(Texture&);
    static bool NODELETE writeWillCompletelyClear(WGPUTextureDimension, uint32_t widthForMetal, uint32_t logicalSizeWidth, uint32_t heightForMetal, uint32_t logicalSizeHeight, uint32_t depthForMetal, uint32_t logicalSizeDepthOrArrayLayers);
    void endEncoding(id<MTLCommandEncoder>, id<MTLCommandBuffer>) const;

    id<MTLBlitCommandEncoder> ensureBlitCommandEncoder();
    void finalizeBlitCommandEncoder();

    // This can be called on a background thread.
    void scheduleWork(Instance::WorkItem&&);
    [[nodiscard]] uint64_t retainCounterSampleBuffer(CommandEncoder&);
    void releaseCounterSampleBuffer(uint64_t);
    void retainTimestampsForOneUpdate(NSMutableSet<id<MTLCounterSampleBuffer>> *);
    void waitForAllCommitedWorkToComplete();
    void synchronizeResourceAndWait(id<MTLBuffer>);
    id<MTLIndirectCommandBuffer> trimICB(id<MTLIndirectCommandBuffer> dest, id<MTLIndirectCommandBuffer> src, NSUInteger newSize);
    id<MTLDevice> _Nullable metalDevice() const;
    std::pair<id<MTLBuffer>, uint64_t> newTemporaryBufferWithBytes(std::span<uint8_t> data, bool noCopy);

private:
    Queue(id<MTLCommandQueue>, Adapter&, Device&);
    Queue(Adapter&, Device&);

    NSString * _Nullable errorValidatingSubmit(const Vector<Ref<WebGPU::CommandBuffer>>&) const;
    bool validateWriteBuffer(const Buffer&, uint64_t bufferOffset, size_t) const;


    bool NODELETE isIdle() const;
    bool isSchedulingIdle() const { return m_submittedCommandBufferCount == m_scheduledCommandBufferCount; }
    void removeMTLCommandBufferInternal(id<MTLCommandBuffer>);
    void clearTextureIfNeeded(Texture&, uint32_t mipLevelCount, uint32_t arrayLayerCount, uint32_t baseMipLevel, uint32_t baseArrayLayer);

    NSString * _Nullable errorValidatingWriteTexture(const WGPUImageCopyTexture&, const WGPUTextureDataLayout&, const WGPUExtent3D&, size_t, const Texture&) const;

    id<MTLCommandQueue> _Nullable m_commandQueue { nil };
    id<MTLCommandBuffer> _Nullable m_commandBuffer { nil };
    id<MTLBlitCommandEncoder> _Nullable m_blitCommandEncoder { nil };
    ThreadSafeWeakPtr<Device> m_device; // The only kind of queues that exist right now are default queues, which are owned by Devices.
    uint64_t m_submittedCommandBufferCount { 0 };
    uint64_t m_completedCommandBufferCount { 0 };
    uint64_t m_scheduledCommandBufferCount { 0 };
    using OnSubmittedWorkScheduledCallbacks = Vector<WTF::Function<void()>>;
    HashMap<uint64_t, OnSubmittedWorkScheduledCallbacks, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_onSubmittedWorkScheduledCallbacks;
    using OnSubmittedWorkDoneCallbacks = Vector<WTF::Function<void(WGPUQueueWorkDoneStatus)>>;
    HashMap<uint64_t, OnSubmittedWorkDoneCallbacks, DefaultHash<uint64_t>, WTF::UnsignedWithZeroKeyHashTraits<uint64_t>> m_onSubmittedWorkDoneCallbacks;
    NSMutableDictionary<NSNumber*, NSMutableSet<id<MTLCounterSampleBuffer>>*> * _Nullable m_retainedCounterSampleBuffers;
    NSMutableOrderedSet<id<MTLCommandBuffer>> * _Nullable m_createdNotCommittedBuffers { nil };
    NSMutableOrderedSet<id<MTLCommandBuffer>> * _Nullable m_committedNotCompletedBuffers WTF_GUARDED_BY_LOCK(m_committedNotCompletedBuffersLock) { nil };
    Lock m_committedNotCompletedBuffersLock;
    NSMapTable<id<MTLCommandBuffer>, id<MTLCommandEncoder>> * _Nullable m_openCommandEncoders;
    const ThreadSafeWeakPtr<Instance> m_instance;
    id<MTLBuffer> _Nullable m_temporaryBuffer;
    uint64_t m_temporaryBufferOffset;
} SWIFT_SHARED_REFERENCE(refQueue, derefQueue) SWIFT_PRIVATE_FILEID("WebGPU/Queue.swift") SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;

} // namespace WebGPU

inline void refQueue(WebGPU::Queue* obj)
{
    obj->ref();
}

inline void derefQueue(WebGPU::Queue* obj)
{
    obj->deref();
}

IGNORE_CLANG_WARNINGS_END
