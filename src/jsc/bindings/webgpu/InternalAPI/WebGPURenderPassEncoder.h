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

#include "WebGPUColor.h"
#include "WebGPUIndexFormat.h"
#include "WebGPUIntegralTypes.h"
#include <cstdint>
#include <functional>
#include <optional>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/Vector.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore::WebGPU {

class BindGroup;
class Buffer;
class QuerySet;
class RenderBundle;
class RenderPipeline;

class RenderPassEncoder : public RefCountedAndCanMakeWeakPtr<RenderPassEncoder> {
public:
    virtual ~RenderPassEncoder() = default;

    String label() const { return m_label; }

    void setLabel(String&& label)
    {
        m_label = WTF::move(label);
        setLabelInternal(m_label);
    }

    virtual void setPipeline(const RenderPipeline&) = 0;

    virtual void setIndexBuffer(const Buffer&, IndexFormat, Size64 offset, std::optional<Size64>) = 0;
    virtual void setVertexBuffer(Index32 slot, const Buffer*, Size64 offset, std::optional<Size64>) = 0;

    virtual void draw(Size32 vertexCount, Size32 instanceCount,
        Size32 firstVertex, Size32 firstInstance) = 0;
    virtual void drawIndexed(Size32 indexCount, Size32 instanceCount,
        Size32 firstIndex,
        SignedOffset32 baseVertex,
        Size32 firstInstance) = 0;

    virtual void drawIndirect(const Buffer& indirectBuffer, Size64 indirectOffset) = 0;
    virtual void drawIndexedIndirect(const Buffer& indirectBuffer, Size64 indirectOffset) = 0;

    virtual void setBindGroup(Index32, const BindGroup*,
        std::optional<Vector<BufferDynamicOffset>>&& dynamicOffsets) = 0;

    virtual void setBindGroup(Index32, const BindGroup*,
        std::span<const uint32_t> dynamicOffsetsArrayBuffer,
        Size64 dynamicOffsetsDataStart,
        Size32 dynamicOffsetsDataLength) = 0;

    virtual void pushDebugGroup(String&& groupLabel) = 0;
    virtual void popDebugGroup() = 0;
    virtual void insertDebugMarker(String&& markerLabel) = 0;

    virtual void setViewport(float x, float y,
        float width, float height,
        float minDepth, float maxDepth) = 0;

    virtual void setScissorRect(IntegerCoordinate x, IntegerCoordinate y,
        IntegerCoordinate width, IntegerCoordinate height) = 0;

    virtual void setBlendConstant(Color) = 0;
    virtual void setStencilReference(StencilValue) = 0;

    virtual void beginOcclusionQuery(Size32 queryIndex) = 0;
    virtual void endOcclusionQuery() = 0;

    virtual void executeBundles(Vector<Ref<RenderBundle>>&&) = 0;
    virtual void end() = 0;

    virtual bool isRemoteRenderPassEncoderProxy() const { return false; }
    virtual bool isRenderPassEncoderImpl() const { return false; }

protected:
    RenderPassEncoder() = default;

private:
    RenderPassEncoder(const RenderPassEncoder&) = delete;
    RenderPassEncoder(RenderPassEncoder&&) = delete;
    RenderPassEncoder& operator=(const RenderPassEncoder&) = delete;
    RenderPassEncoder& operator=(RenderPassEncoder&&) = delete;

    virtual void setLabelInternal(const String&) = 0;

    String m_label;
};

} // namespace WebCore::WebGPU
