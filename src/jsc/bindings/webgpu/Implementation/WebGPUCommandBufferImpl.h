/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

#include "WebGPUCommandBuffer.h"
#include "WebGPUPtr.h"
#include <WebGPU/WebGPU.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class CommandBufferImpl final : public CommandBuffer {
    WTF_MAKE_TZONE_ALLOCATED(CommandBufferImpl);
public:
    static Ref<CommandBufferImpl> create(WebGPUPtr<WGPUCommandBuffer>&& commandBuffer, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new CommandBufferImpl(WTF::move(commandBuffer), convertToBackingContext));
    }

    virtual ~CommandBufferImpl();

private:
    friend class DowncastConvertToBackingContext;

    CommandBufferImpl(WebGPUPtr<WGPUCommandBuffer>&&, ConvertToBackingContext&);

    CommandBufferImpl(const CommandBufferImpl&) = delete;
    CommandBufferImpl(CommandBufferImpl&&) = delete;
    CommandBufferImpl& operator=(const CommandBufferImpl&) = delete;
    CommandBufferImpl& operator=(CommandBufferImpl&&) = delete;

    WGPUCommandBuffer backing() const { return m_backing.get(); }
    bool isCommandBufferImpl() const final { return true; }

    void setLabelInternal(const String&) final;

    WebGPUPtr<WGPUCommandBuffer> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::CommandBufferImpl)
    static bool isType(const WebCore::WebGPU::CommandBuffer& commandBuffer) { return commandBuffer.isCommandBufferImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
