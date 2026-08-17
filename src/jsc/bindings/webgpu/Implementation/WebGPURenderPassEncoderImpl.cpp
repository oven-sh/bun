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
#include "WebGPURenderPassEncoderImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUBindGroupImpl.h"
#include "WebGPUBufferImpl.h"
#include "WebGPUConvertToBackingContext.h"
#include "WebGPUQuerySetImpl.h"
#include "WebGPURenderBundleImpl.h"
#include "WebGPURenderPipelineImpl.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(RenderPassEncoderImpl);

RenderPassEncoderImpl::RenderPassEncoderImpl(WebGPUPtr<WGPURenderPassEncoder>&& renderPassEncoder, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(renderPassEncoder))
    , m_convertToBackingContext(convertToBackingContext)
{
}

RenderPassEncoderImpl::~RenderPassEncoderImpl() = default;

void RenderPassEncoderImpl::setPipeline(const RenderPipeline& renderPipeline)
{
    wgpuRenderPassEncoderSetPipeline(m_backing.get(), m_convertToBackingContext->convertToBacking(renderPipeline));
}

void RenderPassEncoderImpl::setIndexBuffer(const Buffer& buffer, IndexFormat indexFormat, Size64 offset, std::optional<Size64> size)
{
    wgpuRenderPassEncoderSetIndexBuffer(m_backing.get(), m_convertToBackingContext->convertToBacking(buffer), m_convertToBackingContext->convertToBacking(indexFormat), offset, size.value_or(WGPU_WHOLE_SIZE));
}

void RenderPassEncoderImpl::setVertexBuffer(Index32 slot, const Buffer* buffer, Size64 offset, std::optional<Size64> size)
{
    wgpuRenderPassEncoderSetVertexBuffer(m_backing.get(), slot, buffer ? m_convertToBackingContext->convertToBacking(*buffer) : nullptr, offset, size.value_or(WGPU_WHOLE_SIZE));
}

void RenderPassEncoderImpl::draw(Size32 vertexCount, Size32 instanceCount,
    Size32 firstVertex, Size32 firstInstance)
{
    wgpuRenderPassEncoderDraw(m_backing.get(), vertexCount, instanceCount, firstVertex, firstInstance);
}

void RenderPassEncoderImpl::drawIndexed(Size32 indexCount, Size32 instanceCount,
    Size32 firstIndex,
    SignedOffset32 baseVertex,
    Size32 firstInstance)
{
    wgpuRenderPassEncoderDrawIndexed(m_backing.get(), indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
}

void RenderPassEncoderImpl::drawIndirect(const Buffer& indirectBuffer, Size64 indirectOffset)
{
    wgpuRenderPassEncoderDrawIndirect(m_backing.get(), m_convertToBackingContext->convertToBacking(indirectBuffer), indirectOffset);
}

void RenderPassEncoderImpl::drawIndexedIndirect(const Buffer& indirectBuffer, Size64 indirectOffset)
{
    wgpuRenderPassEncoderDrawIndexedIndirect(m_backing.get(), m_convertToBackingContext->convertToBacking(indirectBuffer), indirectOffset);
}

void RenderPassEncoderImpl::setBindGroup(Index32 index, const BindGroup* bindGroup,
    std::optional<Vector<BufferDynamicOffset>>&& dynamicOffsets)
{
    wgpuRenderPassEncoderSetBindGroup(m_backing.get(), index, bindGroup ? m_convertToBackingContext->convertToBacking(*bindGroup) : nullptr, WTF::move(dynamicOffsets));
}

void RenderPassEncoderImpl::setBindGroup(Index32, const BindGroup*, std::span<const uint32_t>, Size64, Size32)
{
    RELEASE_ASSERT_NOT_REACHED();
}

void RenderPassEncoderImpl::pushDebugGroup(String&& groupLabel)
{
    wgpuRenderPassEncoderPushDebugGroup(m_backing.get(), groupLabel.utf8().data());
}

void RenderPassEncoderImpl::popDebugGroup()
{
    wgpuRenderPassEncoderPopDebugGroup(m_backing.get());
}

void RenderPassEncoderImpl::insertDebugMarker(String&& markerLabel)
{
    wgpuRenderPassEncoderInsertDebugMarker(m_backing.get(), markerLabel.utf8().data());
}

void RenderPassEncoderImpl::setViewport(float x, float y,
    float width, float height,
    float minDepth, float maxDepth)
{
    wgpuRenderPassEncoderSetViewport(m_backing.get(), x, y, width, height, minDepth, maxDepth);
}

void RenderPassEncoderImpl::setScissorRect(IntegerCoordinate x, IntegerCoordinate y,
    IntegerCoordinate width, IntegerCoordinate height)
{
    wgpuRenderPassEncoderSetScissorRect(m_backing.get(), x, y, width, height);
}

void RenderPassEncoderImpl::setBlendConstant(Color color)
{
    auto backingColor = m_convertToBackingContext->convertToBacking(color);

    wgpuRenderPassEncoderSetBlendConstant(m_backing.get(), &backingColor);
}

void RenderPassEncoderImpl::setStencilReference(StencilValue stencilValue)
{
    wgpuRenderPassEncoderSetStencilReference(m_backing.get(), stencilValue);
}

void RenderPassEncoderImpl::beginOcclusionQuery(Size32 queryIndex)
{
    wgpuRenderPassEncoderBeginOcclusionQuery(m_backing.get(), queryIndex);
}

void RenderPassEncoderImpl::endOcclusionQuery()
{
    wgpuRenderPassEncoderEndOcclusionQuery(m_backing.get());
}

void RenderPassEncoderImpl::executeBundles(Vector<Ref<RenderBundle>>&& renderBundles)
{
    auto backingBundles = renderBundles.map([&](auto renderBundle) {
        return m_convertToBackingContext->convertToBacking(renderBundle.get());
    });

    wgpuRenderPassEncoderExecuteBundles(m_backing.get(), backingBundles.size(), backingBundles.span().data());
}

void RenderPassEncoderImpl::end()
{
    wgpuRenderPassEncoderEnd(m_backing.get());
}

void RenderPassEncoderImpl::setLabelInternal(const String& label)
{
    wgpuRenderPassEncoderSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
