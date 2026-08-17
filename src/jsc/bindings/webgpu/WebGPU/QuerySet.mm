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
#import "QuerySet.h"

#import "APIConversions.h"
#import "Buffer.h"
#import "CommandEncoder.h"
#import "Device.h"
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

Lock QuerySet::querySetLock;
__attribute__((no_destroy)) std::unique_ptr<Vector<id<MTLCounterSampleBuffer>>> QuerySet::m_counterSampleBuffers;
__attribute__((no_destroy)) std::unique_ptr<Vector<RangeSet<Range<uint32_t>>>> QuerySet::m_counterSampleBufferFreeRanges;

Ref<QuerySet> Device::createQuerySet(const WGPUQuerySetDescriptor& descriptor)
{
    QuerySet::createContainersIfNeeded();

    auto count = descriptor.count;
    constexpr auto maxCountAllowed = 4096;
    if (count > maxCountAllowed || !isValid()) {
        generateAValidationError("GPUQuerySetDescriptor.count must be <= 4096"_s);
        return QuerySet::createInvalid(*this);
    }

    const char* label = descriptor.label;
    auto type = descriptor.type;

    switch (type) {
    case WGPUQueryType_Timestamp: {
#if !0 /* PLATFORM(WATCHOS) */
        auto querySetWithOffset = QuerySet::counterSampleBufferWithOffsetForDevice(count, *this);
        if (!querySetWithOffset.buffer)
            return QuerySet::createInvalid(*this);

        return QuerySet::create(WTF::move(querySetWithOffset), count, type, *this);
#else
        return QuerySet::createInvalid(*this);
#endif
    } case WGPUQueryType_Occlusion: {
        auto buffer = safeCreateBuffer(sizeof(uint64_t) * count, MTLStorageModePrivate);
        buffer.label = fromAPI(label).createNSString().get();
        return QuerySet::create(buffer, count, type, *this);
    }
    case WGPUQueryType_Force32:
        return QuerySet::createInvalid(*this);
    }
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(QuerySet);

QuerySet::QuerySet(id<MTLBuffer> buffer, uint32_t count, WGPUQueryType type, Device& device)
    : m_device(device)
    , m_visibilityBuffer(buffer)
    , m_count(count)
    , m_type(type)
{
    RELEASE_ASSERT(m_type != WGPUQueryType_Force32);
}

QuerySet::QuerySet(CounterSampleBuffer&& buffer, uint32_t count, WGPUQueryType type, Device& device)
    : m_device(device)
    , m_timestampBufferWithOffset(WTF::move(buffer))
    , m_count(count)
    , m_type(type)
{
    RELEASE_ASSERT(m_type != WGPUQueryType_Force32);
}

QuerySet::QuerySet(Device& device)
    : m_device(device)
    , m_type(WGPUQueryType_Force32)
{
}

QuerySet::~QuerySet()
{
    QuerySet::destroyQuerySet(*this);
}

bool QuerySet::isValid() const
{
    return isDestroyed() || m_visibilityBuffer || m_timestampBufferWithOffset.buffer;
}

bool QuerySet::isDestroyed() const
{
    return m_destroyed;
}

void QuerySet::destroy()
{
    m_destroyed = true;
    QuerySet::destroyQuerySet(*this);
    // https://gpuweb.github.io/gpuweb/#dom-gpuqueryset-destroy
    m_visibilityBuffer = nil;
    m_timestampBufferWithOffset.buffer = nil;
    m_device->makeSubmitInvalidClearingEncoders(m_commandEncoders);
}

void QuerySet::setLabel(String&& label)
{
    m_visibilityBuffer.label = label.createNSString().get();
    // MTLCounterSampleBuffer's label property is read-only.
}

void QuerySet::setOverrideLocation(QuerySet&, uint32_t, uint32_t)
{
}

void QuerySet::setCommandEncoder(CommandEncoder& commandEncoder) const
{
    CommandEncoder::trackEncoder(commandEncoder, m_commandEncoders);
    commandEncoder.addBuffer(m_visibilityBuffer);
    commandEncoder.addBuffer(m_timestampBufferWithOffset.buffer);
    if (isDestroyed())
        commandEncoder.makeSubmitInvalid();
}

QuerySet::CounterSampleBuffer QuerySet::counterSampleBufferWithOffset() const
{
    return m_timestampBufferWithOffset;
}

void QuerySet::destroyQuerySet(const QuerySet& querySet)
{
    auto querySetWithOffset = querySet.counterSampleBufferWithOffset();
    if (!querySetWithOffset.buffer)
        return;

    auto sampleCountInBytes = querySet.count() * sizeof(uint64_t);
    Locker locker { querySetLock };
    for (uint32_t i = 0; i < maxCounterSampleBuffers; ++i) {
        if (querySetWithOffset.buffer != (*m_counterSampleBuffers)[i])
            continue;

        uint32_t offsetInBytes = static_cast<uint32_t>(querySetWithOffset.offset * sizeof(uint64_t));
        auto endOffset = static_cast<uint32_t>(offsetInBytes + sampleCountInBytes);
        RELEASE_ASSERT(offsetInBytes < 32 * KB);
        (*m_counterSampleBufferFreeRanges)[i].add({ offsetInBytes, endOffset });
        (*m_counterSampleBufferFreeRanges)[i].compact();
    }
}

QuerySet::CounterSampleBuffer QuerySet::counterSampleBufferWithOffsetForDevice(size_t sampleCount, const Device& device)
{
    Locker locker { querySetLock };
    uint32_t sampleCountInBytes = static_cast<uint32_t>(sampleCount * sizeof(uint64_t));
    constexpr uint32_t maxSampleBufferSize = 32 * KB;

    for (uint32_t i = 0; i < maxCounterSampleBuffers; ++i) {
        if ((*m_counterSampleBuffers)[i]) {
            RangeSet<Range<uint32_t>> newRangeSet;
            std::optional<uint32_t> result { std::nullopt };

            for (auto& r : (*m_counterSampleBufferFreeRanges)[i]) {
                if (!result && r.end() - r.begin() >= sampleCountInBytes) {
                    newRangeSet.add({ static_cast<uint32_t>(r.begin() + sampleCountInBytes), r.end() });
                    result = r.begin();
                } else
                    newRangeSet.add(r);
            }

            if (result) {
                (*m_counterSampleBufferFreeRanges)[i] = newRangeSet;
                RELEASE_ASSERT(*result / sizeof(uint64_t) < 4096);
                return CounterSampleBuffer { (*m_counterSampleBuffers)[i], static_cast<uint32_t>(*result / sizeof(uint64_t)) };
            }

            continue;
        }

        MTLCounterSampleBufferDescriptor* sampleBufferDesc = [MTLCounterSampleBufferDescriptor new];
        sampleBufferDesc.sampleCount = maxSampleBufferSize / sizeof(uint64_t);
        sampleBufferDesc.storageMode = MTLStorageModeShared;
        sampleBufferDesc.counterSet = device.baseCapabilities().timestampCounterSet;

        NSError* error;
        id<MTLCounterSampleBuffer> result = [device.device() newCounterSampleBufferWithDescriptor:sampleBufferDesc error:&error];
        if (error)
            return CounterSampleBuffer { nil, 0 };

        (*m_counterSampleBuffers)[i] = result;
        (*m_counterSampleBufferFreeRanges)[i].add({ sampleCountInBytes, maxSampleBufferSize });
        return CounterSampleBuffer { result, 0 };
    }

    return CounterSampleBuffer { nil, 0 };
}

void QuerySet::createContainersIfNeeded()
{
    {
        Locker locker { querySetLock };
        if (!QuerySet::m_counterSampleBuffers)
            QuerySet::m_counterSampleBuffers = makeUnique<Vector<id<MTLCounterSampleBuffer>>>(QuerySet::maxCounterSampleBuffers);

        if (!QuerySet::m_counterSampleBufferFreeRanges)
            QuerySet::m_counterSampleBufferFreeRanges = makeUnique<Vector<RangeSet<Range<uint32_t>>>>(QuerySet::maxCounterSampleBuffers);
    }
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuQuerySetReference(WGPUQuerySet querySet)
{
    WebGPU::fromAPI(querySet).ref();
}

void wgpuQuerySetRelease(WGPUQuerySet querySet)
{
    WebGPU::fromAPI(querySet).deref();
}

void wgpuQuerySetDestroy(WGPUQuerySet querySet)
{
    protect(WebGPU::fromAPI(querySet))->destroy();
}

void wgpuQuerySetSetLabel(WGPUQuerySet querySet, const char* label)
{
    protect(WebGPU::fromAPI(querySet))->setLabel(WebGPU::fromAPI(label));
}

uint32_t wgpuQuerySetGetCount(WGPUQuerySet querySet)
{
    return WebGPU::fromAPI(querySet).count();
}

WGPUQueryType wgpuQuerySetGetType(WGPUQuerySet querySet)
{
    return WebGPU::fromAPI(querySet).type();
}
