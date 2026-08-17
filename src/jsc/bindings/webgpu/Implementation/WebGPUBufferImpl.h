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

#pragma once

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUBuffer.h"
#include "WebGPUPtr.h"
#include <WebGPU/WebGPU.h>
#include <wtf/Deque.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class BufferImpl final : public Buffer {
    WTF_MAKE_TZONE_ALLOCATED(BufferImpl);
public:
    static Ref<BufferImpl> create(WebGPUPtr<WGPUBuffer>&& buffer, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new BufferImpl(WTF::move(buffer), convertToBackingContext));
    }

    virtual ~BufferImpl();

private:
    friend class DowncastConvertToBackingContext;

    BufferImpl(WebGPUPtr<WGPUBuffer>&&, ConvertToBackingContext&);

    BufferImpl(const BufferImpl&) = delete;
    BufferImpl(BufferImpl&&) = delete;
    BufferImpl& operator=(const BufferImpl&) = delete;
    BufferImpl& operator=(BufferImpl&&) = delete;

    WGPUBuffer backing() const { return m_backing.get(); }
    bool isBufferImpl() const final { return true; }

    void mapAsync(MapModeFlags, Size64 offset, std::optional<Size64> sizeForMap, CompletionHandler<void(bool)>&&) final;
    void getMappedRange(Size64 offset, std::optional<Size64>, NOESCAPE const Function<void(std::span<uint8_t>)>&) final;
    std::span<uint8_t> getBufferContents() final;
    void unmap() final;
    void NODELETE copyFrom(std::span<const uint8_t>, size_t offset) final;

    void destroy() final;
    void generateAValidationError() final;

    void setLabelInternal(const String&) final;

    const WebGPUPtr<WGPUBuffer> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::BufferImpl)
    static bool isType(const WebCore::WebGPU::Buffer& buffer) { return buffer.isBufferImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
