/*
 * Copyright (C) 2021-2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "GPUBuffer.h"

#include "GPUDevice.h"
#include "JSDOMConvertNull.h"
#include "JSDOMPromiseDeferred.h"
#include "JSGPUBufferMapState.h"

namespace WebCore {

GPUBuffer::~GPUBuffer() = default;

GPUBuffer::GPUBuffer(Ref<WebGPU::Buffer>&& backing, size_t bufferSize, GPUBufferUsageFlags usage, bool mappedAtCreation, GPUDevice& device)
    : m_backing(WTF::move(backing))
    , m_bufferSize(bufferSize)
    , m_usage(usage)
    , m_mapState(mappedAtCreation ? GPUBufferMapState::Mapped : GPUBufferMapState::Unmapped)
    , m_device(device)
    , m_mappedAtCreation(mappedAtCreation)
{
    if (mappedAtCreation)
        m_mappedRangeSize = m_bufferSize;
}

bool GPUBuffer::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPUBuffer::device() const
{
    return m_device;
}

String GPUBuffer::label() const
{
    return m_backing->label();
}

void GPUBuffer::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

void GPUBuffer::mapAsync(GPUMapModeFlags mode, GPUSize64 offset, std::optional<GPUSize64> size, MapAsyncPromise&& promise)
{
    if (m_mapState != GPUBufferMapState::Unmapped) {
        m_backing->generateAValidationError();
        promise.reject(Exception { ExceptionCode::OperationError, "pendingMapPromise"_s });
        return;
    }

    if (m_mapState == GPUBufferMapState::Unmapped)
        m_mapState = GPUBufferMapState::Pending;

    m_pendingMapPromise = makeUnique<MapAsyncPromise>(promise);
    // FIXME: Should this capture a weak pointer to |this| instead?
    m_backing->mapAsync(convertMapModeFlagsToBacking(mode), offset, size, [promise = WTF::move(promise), protectedThis = protect(*this), offset, size](bool success) mutable {
        if (!protectedThis->m_pendingMapPromise) {
            if (protectedThis->m_destroyed)
                promise.reject(Exception { ExceptionCode::OperationError, "buffer destroyed during mapAsync"_s });
            else
                promise.resolve(nullptr);
            return;
        }

        protectedThis->m_pendingMapPromise = nullptr;
        if (success) {
            protectedThis->m_mapState = GPUBufferMapState::Mapped;
            protectedThis->m_mappedRangeOffset = offset;
            protectedThis->m_mappedRangeSize = size.value_or(protectedThis->m_bufferSize - protectedThis->m_mappedRangeOffset);
            promise.resolve(nullptr);
        } else {
            if (protectedThis->m_mapState == GPUBufferMapState::Pending)
                protectedThis->m_mapState = GPUBufferMapState::Unmapped;

            promise.reject(Exception { ExceptionCode::OperationError, "map async was not successful"_s });
        }
    });
}

static auto makeArrayBuffer(Variant<std::span<const uint8_t>, size_t> source, size_t offset, auto& cachedArrayBuffers, auto& device, auto& buffer)
{
    RefPtr<ArrayBuffer> arrayBuffer;
    WTF::visit(WTF::makeVisitor([&](std::span<const uint8_t> source) {
        arrayBuffer = ArrayBuffer::create(source);
    }, [&](size_t numberOfElements) {
        arrayBuffer = ArrayBuffer::create(numberOfElements, 1);
    }), source);

    cachedArrayBuffers.append({ arrayBuffer.get(), offset });
    arrayBuffer->pin();
    if (device)
        device->addBufferToUnmap(buffer);
    return arrayBuffer;
}

static bool containsRange(size_t offset, size_t endOffset, const auto& mappedRanges, const auto& mappedPoints)
{
    if (offset == endOffset) {
        if (mappedPoints.contains(offset))
            return true;

        for (auto& range : mappedRanges) {
            if (range.begin() < offset && offset < range.end())
                return true;
        }
        return false;
    }

    if (mappedRanges.overlaps({ offset, endOffset }))
        return true;

    for (auto& i : mappedPoints) {
        if (offset < i && i < endOffset)
            return true;
    }

    return false;
}

ExceptionOr<Ref<JSC::ArrayBuffer>> GPUBuffer::getMappedRange(GPUSize64 offset, std::optional<GPUSize64> optionalSize)
{
    if (m_mapState != GPUBufferMapState::Mapped || m_destroyed)
        return Exception { ExceptionCode::OperationError, "not mapped or destroyed"_s };

    if (offset > m_bufferSize)
        return Exception { ExceptionCode::OperationError, "offset > bufferSize"_s };

    auto size = optionalSize.value_or(m_bufferSize - offset);
    auto checkedEndOffset = checkedSum<uint64_t>(offset, size);
    if (checkedEndOffset.hasOverflowed())
        return Exception { ExceptionCode::OperationError, "has overflowed"_s };

    auto endOffset = checkedEndOffset.value();
    if (offset % 8)
        return Exception { ExceptionCode::OperationError, "validation failed offset % 8"_s };

    if (size % 4)
        return Exception { ExceptionCode::OperationError, "validation failed size % 4"_s };

    if (offset < m_mappedRangeOffset)
        return Exception { ExceptionCode::OperationError, "validation failed offset < m_mappedRangeOffset"_s };

    if (endOffset > m_mappedRangeSize + m_mappedRangeOffset)
        return Exception { ExceptionCode::OperationError, "getMappedRangeFailed because offset + size > mappedRangeSize + mappedRangeOffset"_s };

    if (endOffset > m_bufferSize)
        return Exception { ExceptionCode::OperationError, "validation failed endOffset > bufferSize"_s };

    if (containsRange(offset, endOffset, m_mappedRanges, m_mappedPoints))
        return Exception { ExceptionCode::OperationError, "validation failed - containsRange"_s };

    if (offset == endOffset)
        m_mappedPoints.add(offset);
    else {
        m_mappedRanges.add({ static_cast<size_t>(offset), static_cast<size_t>(endOffset) });
        m_mappedRanges.compact();
    }

    RefPtr<JSC::ArrayBuffer> result;
    m_backing->getMappedRange(offset, size, [&] (auto mappedRange) {
        if (!mappedRange.data()) {
            m_arrayBuffers.clear();
            if (m_mappedAtCreation || !size)
                result = makeArrayBuffer(0U /* numberOfElements */, 0 /* offset */, m_arrayBuffers, m_device, *this);

            return;
        }

        result = makeArrayBuffer(mappedRange.first(size), offset, m_arrayBuffers, m_device, *this);
    });

    if (!result)
        return Exception { ExceptionCode::OperationError, "getMappedRange failed"_s };

    return result.releaseNonNull();
}

void GPUBuffer::unmap(ScriptExecutionContext& scriptExecutionContext)
{
    internalUnmap(scriptExecutionContext);
    if (RefPtr device = m_device)
        device->removeBufferToUnmap(*this);
}

void GPUBuffer::internalUnmap(ScriptExecutionContext& scriptExecutionContext)
{
    m_mappedAtCreation = false;
    m_mappedRangeOffset = 0;
    m_mappedRangeSize = 0;
    m_mappedRanges.clear();
    m_mappedPoints.clear();
    if (m_pendingMapPromise) {
        m_pendingMapPromise->reject(Exception { ExceptionCode::AbortError });
        m_pendingMapPromise = nullptr;
    }

    m_mapState = GPUBufferMapState::Unmapped;

    for (auto& arrayBufferAndOffset : m_arrayBuffers) {
        auto& arrayBuffer = arrayBufferAndOffset.buffer;
        if (arrayBuffer && arrayBuffer->data() && arrayBuffer->byteLength()) {
            m_backing->copyFrom(arrayBuffer->span(), arrayBufferAndOffset.offset);
            JSC::ArrayBufferContents emptyBuffer;
            arrayBuffer->unpin();
            arrayBuffer->transferTo(scriptExecutionContext.vm(), emptyBuffer);
        }
    }

    m_backing->unmap();
    m_arrayBuffers.clear();
}

void GPUBuffer::destroy(ScriptExecutionContext& scriptExecutionContext)
{
    m_destroyed = true;
    internalUnmap(scriptExecutionContext);
    m_bufferSize = 0;
    m_backing->destroy();
}

}
