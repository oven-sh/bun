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

#include "WebGPUPtr.h"
#include "WebGPUQueue.h"
#include <WebGPU/WebGPU.h>
#include <wtf/Deque.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class QueueImpl final : public Queue {
    WTF_MAKE_TZONE_ALLOCATED(QueueImpl);
public:
    static Ref<QueueImpl> create(WebGPUPtr<WGPUQueue>&& queue, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new QueueImpl(WTF::move(queue), convertToBackingContext));
    }

    virtual ~QueueImpl();

private:
    friend class DowncastConvertToBackingContext;

    QueueImpl(WebGPUPtr<WGPUQueue>&&, ConvertToBackingContext&);

    QueueImpl(const QueueImpl&) = delete;
    QueueImpl(QueueImpl&&) = delete;
    QueueImpl& operator=(const QueueImpl&) = delete;
    QueueImpl& operator=(QueueImpl&&) = delete;

    WGPUQueue backing() const { return m_backing.get(); }
    bool isQueueImpl() const final { return true; }

    void submit(Vector<Ref<WebGPU::CommandBuffer>>&&) final;

    void onSubmittedWorkDone(CompletionHandler<void()>&&) final;

    void NODELETE writeBuffer(
        const Buffer&,
        Size64 bufferOffset,
        std::span<const uint8_t> source,
        Size64 dataOffset,
        std::optional<Size64>) final;

    void NODELETE writeTexture(
        const ImageCopyTexture& destination,
        std::span<const uint8_t> source,
        const ImageDataLayout&,
        const Extent3D& size) final;

    void writeBufferNoCopy(
        const Buffer&,
        Size64 bufferOffset,
        std::span<uint8_t> source,
        Size64 dataOffset,
        std::optional<Size64>) final;

    void writeTexture(
        const ImageCopyTexture& destination,
        std::span<uint8_t> source,
        const ImageDataLayout&,
        const Extent3D& size) final;

    void NODELETE copyExternalImageToTexture(
        const ImageCopyExternalImage& source,
        const ImageCopyTextureTagged& destination,
        const Extent3D& copySize) final;

    void setLabelInternal(const String&) final;
    RefPtr<WebCore::NativeImage> NODELETE getNativeImage(WebCore::VideoFrame&) final;

    WebGPUPtr<WGPUQueue> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::QueueImpl)
    static bool isType(const WebCore::WebGPU::Queue& queue) { return queue.isQueueImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
