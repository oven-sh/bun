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
#include "WebGPUBufferImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUConvertToBackingContext.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/BlockPtr.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BufferImpl);

BufferImpl::BufferImpl(WebGPUPtr<WGPUBuffer>&& buffer, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(buffer))
    , m_convertToBackingContext(convertToBackingContext)
{
}

BufferImpl::~BufferImpl() = default;

static Size64 getMappedSize(WGPUBuffer buffer, std::optional<Size64> size, Size64 offset)
{
    if (size.has_value())
        return size.value();

    auto bufferSize = wgpuBufferGetInitialSize(buffer);
    return bufferSize > offset ? (bufferSize - offset) : 0;
}

static void mapAsyncCallback(WGPUBufferMapAsyncStatus status, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUBufferMapAsyncStatus)>(userdata);
    block(status);
    Block_release(block); // Block_release is matched with Block_copy below in BufferImpl::mapAsync().
}

void BufferImpl::mapAsync(MapModeFlags mapModeFlags, Size64 offset, std::optional<Size64> size, CompletionHandler<void(bool)>&& callback)
{
    auto backingMapModeFlags = m_convertToBackingContext->convertMapModeFlagsToBacking(mapModeFlags);
    auto usedSize = getMappedSize(m_backing.get(), size, offset);

    // FIXME: Check the casts.
    auto blockPtr = makeBlockPtr([callback = WTF::move(callback)](WGPUBufferMapAsyncStatus status) mutable {
        callback(status == WGPUBufferMapAsyncStatus_Success);
    });
    wgpuBufferMapAsync(m_backing.get(), backingMapModeFlags, static_cast<size_t>(offset), static_cast<size_t>(usedSize), &mapAsyncCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in mapAsyncCallback().
}

void BufferImpl::getMappedRange(Size64 offset, std::optional<Size64> size, NOESCAPE const Function<void(std::span<uint8_t>)>& callback)
{
    auto usedSize = getMappedSize(m_backing.get(), size, offset);

    callback(wgpuBufferGetMappedRange(m_backing.get(), static_cast<size_t>(offset), static_cast<size_t>(usedSize)));
}

std::span<uint8_t> BufferImpl::getBufferContents()
{
    if (!m_backing)
        return { };

    return wgpuBufferGetBufferContents(m_backing.get());
}

#if ENABLE(WEBGPU_SWIFT)
void BufferImpl::copyFrom(std::span<const uint8_t> data, size_t offset)
{
    RELEASE_ASSERT(backing());
    return wgpuBufferCopy(backing(), data, offset);
}
#else
void BufferImpl::copyFrom(std::span<const uint8_t>, size_t)
{
    RELEASE_ASSERT_NOT_REACHED();
}
#endif

void BufferImpl::unmap()
{
    wgpuBufferUnmap(m_backing.get());
}

void BufferImpl::destroy()
{
    wgpuBufferDestroy(m_backing.get());
}

void BufferImpl::generateAValidationError()
{
    wgpuBufferGenerateAValidationError(m_backing.get());
}

void BufferImpl::setLabelInternal(const String& label)
{
    wgpuBufferSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
