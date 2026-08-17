/*
 * Copyright (C) 2021-2025 Apple Inc. All rights reserved.
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

#include "WebGPUCommandEncoder.h"
#include "WebGPUPtr.h"
#include <WebGPU/WebGPU.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class CommandEncoderImpl final : public CommandEncoder {
    WTF_MAKE_TZONE_ALLOCATED(CommandEncoderImpl);
public:
    static Ref<CommandEncoderImpl> create(WebGPUPtr<WGPUCommandEncoder>&& commandEncoder, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new CommandEncoderImpl(WTF::move(commandEncoder), convertToBackingContext));
    }

    virtual ~CommandEncoderImpl();

private:
    friend class DowncastConvertToBackingContext;

    CommandEncoderImpl(WebGPUPtr<WGPUCommandEncoder>&&, ConvertToBackingContext&);

    CommandEncoderImpl(const CommandEncoderImpl&) = delete;
    CommandEncoderImpl(CommandEncoderImpl&&) = delete;
    CommandEncoderImpl& operator=(const CommandEncoderImpl&) = delete;
    CommandEncoderImpl& operator=(CommandEncoderImpl&&) = delete;

    WGPUCommandEncoder backing() const { return m_backing.get(); }
    bool isCommandEncoderImpl() const final { return true; }

    RefPtr<RenderPassEncoder> beginRenderPass(const RenderPassDescriptor&) final;
    RefPtr<ComputePassEncoder> beginComputePass(const std::optional<ComputePassDescriptor>&) final;

    void copyBufferToBuffer(
        const Buffer& source,
        Size64 sourceOffset,
        const Buffer& destination,
        Size64 destinationOffset,
        Size64) final;

    void copyBufferToTexture(
        const ImageCopyBuffer& source,
        const ImageCopyTexture& destination,
        const Extent3D& copySize) final;

    void copyTextureToBuffer(
        const ImageCopyTexture& source,
        const ImageCopyBuffer& destination,
        const Extent3D& copySize) final;

    void copyTextureToTexture(
        const ImageCopyTexture& source,
        const ImageCopyTexture& destination,
        const Extent3D& copySize) final;

    void clearBuffer(
        const Buffer&,
        Size64 offset,
        std::optional<Size64>) final;

    void pushDebugGroup(String&& groupLabel) final;
    void popDebugGroup() final;
    void insertDebugMarker(String&& markerLabel) final;

    void writeTimestamp(const QuerySet&, Size32 queryIndex) final;

    void resolveQuerySet(
        const QuerySet&,
        Size32 firstQuery,
        Size32 queryCount,
        const Buffer& destination,
        Size64 destinationOffset) final;

    RefPtr<CommandBuffer> finish(const CommandBufferDescriptor&) final;

    void setLabelInternal(const String&) final;

    WebGPUPtr<WGPUCommandEncoder> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::CommandEncoderImpl)
    static bool isType(const WebCore::WebGPU::CommandEncoder& commandEncoder) { return commandEncoder.isCommandEncoderImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
