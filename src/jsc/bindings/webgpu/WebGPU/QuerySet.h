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

#import "BindableResource.h"
#import <WebGPU/WGPUQuerySetImpl.h>
#import <WebGPU/WebGPU.h>
#import <WebGPU/WebGPUExt.h>
#import <optional>
#import <wtf/FastMalloc.h>
#import <wtf/Range.h>
#import <wtf/RangeSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCountedAndCanMakeWeakPtr.h>
#import <wtf/SwiftBridging.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/Vector.h>
#import <wtf/WeakHashSet.h>
#import <wtf/WeakPtr.h>

namespace WebGPU {

class Buffer;
class CommandEncoder;
class Device;

// https://gpuweb.github.io/gpuweb/#gpuqueryset
class QuerySet : public WGPUQuerySetImpl, public RefCountedAndCanMakeWeakPtr<QuerySet>, public TrackedResource {
    WTF_MAKE_TZONE_ALLOCATED(QuerySet);
public:
    struct CounterSampleBuffer {
        id<MTLCounterSampleBuffer> buffer { nil }; // Safety: ARC retains this pointer
        uint32_t offset { 0 };
    } SWIFT_ESCAPABLE;

    static Ref<QuerySet> create(id<MTLBuffer> visibilityBuffer, uint32_t count, WGPUQueryType type, Device& device)
    {
        return adoptRef(*new QuerySet(visibilityBuffer, count, type, device));
    }
    static Ref<QuerySet> create(CounterSampleBuffer&& counterSampleBuffer, uint32_t count, WGPUQueryType type, Device& device)
    {
        return adoptRef(*new QuerySet(WTF::move(counterSampleBuffer), count, type, device));
    }
    static Ref<QuerySet> createInvalid(Device& device)
    {
        return adoptRef(*new QuerySet(device));
    }

    ~QuerySet();

    void destroy();
    void setLabel(String&&);

    bool NODELETE isValid() const;

    void NODELETE setOverrideLocation(QuerySet& otherQuerySet, uint32_t beginningOfPassIndex, uint32_t endOfPassIndex);

    Device& device() const { return m_device; }
    uint32_t count() const { return m_count; }
    WGPUQueryType type() const { return m_type; }
    id<MTLBuffer> visibilityBuffer() const { return m_visibilityBuffer; }
    CounterSampleBuffer NODELETE counterSampleBufferWithOffset() const;

    void setCommandEncoder(CommandEncoder&) const;
    bool NODELETE isDestroyed() const;
    static void destroyQuerySet(const QuerySet&);
    static CounterSampleBuffer counterSampleBufferWithOffsetForDevice(size_t, const Device&);
    static void createContainersIfNeeded();

private:
    QuerySet(id<MTLBuffer>, uint32_t, WGPUQueryType, Device&);
    QuerySet(CounterSampleBuffer&&, uint32_t, WGPUQueryType, Device&);
    QuerySet(Device&);

    const Ref<Device> m_device;
    id<MTLBuffer> m_visibilityBuffer { nil };
    CounterSampleBuffer m_timestampBufferWithOffset;
    uint32_t m_count { 0 };
    const WGPUQueryType m_type { WGPUQueryType_Force32 };

    // rdar://91371495 is about how we can't just naively transform PassDescriptor.timestampWrites into MTLComputePassDescriptor.sampleBufferAttachments.
    // Instead, we can resolve all the information to a dummy counter sample buffer, and then internally remember that the data
    // is in a different place than where it's supposed to be. That's what this "overrides" vector is: A way to remember, when we resolve the data, that we
    // should resolve it from our dummy buffer instead of from where it's supposed to be.
    //
    // When rdar://91371495 is fixed, we can delete this indirection, and put the data directly where it's supposed to go.
    struct OverrideLocation {
        Ref<QuerySet> other;
        uint32_t otherIndex;
    };
    bool m_destroyed { false };

    // static is intentional here as the limit is per process
    static constexpr uint32_t maxCounterSampleBuffers = 32;
    static Lock querySetLock;
    static std::unique_ptr<Vector<id<MTLCounterSampleBuffer>>> m_counterSampleBuffers WTF_GUARDED_BY_LOCK(querySetLock);
    static std::unique_ptr<Vector<RangeSet<Range<uint32_t>>>> m_counterSampleBufferFreeRanges WTF_GUARDED_BY_LOCK(querySetLock);
} SWIFT_SHARED_REFERENCE(refQuerySet, derefQuerySet) SWIFT_RETURNED_AS_UNRETAINED_BY_DEFAULT;

} // namespace WebGPU

inline void refQuerySet(WebGPU::QuerySet* obj)
{
    obj->ref();
}

inline void derefQuerySet(WebGPU::QuerySet* obj)
{
    obj->deref();
}
