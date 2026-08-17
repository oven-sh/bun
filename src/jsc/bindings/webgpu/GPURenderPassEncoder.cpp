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
#include "GPURenderPassEncoder.h"

#include "ExceptionOr.h"
#include "GPUBindGroup.h"
#include "GPUBuffer.h"
#include "GPUCommandEncoder.h"
#include "GPUDevice.h"
#include "GPUQuerySet.h"
#include "GPURenderBundle.h"
#include "GPURenderPipeline.h"
#include "InspectorInstrumentation.h"

namespace WebCore {

GPURenderPassEncoder::GPURenderPassEncoder(Ref<WebGPU::RenderPassEncoder>&& backing, GPUCommandEncoder& commandEncoder)
    : m_backing(WTF::move(backing))
    , m_device(commandEncoder.device())
{
}

bool GPURenderPassEncoder::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPURenderPassEncoder::device() const
{
    return m_device;
}

String GPURenderPassEncoder::label() const
{
    return m_overrideLabel ? *m_overrideLabel : m_backing->label();
}

void GPURenderPassEncoder::setLabel(String&& label)
{
    protect(backing())->setLabel(WTF::move(label));
}

void GPURenderPassEncoder::setPipeline(const GPURenderPipeline& renderPipeline)
{
    m_currentPipeline = renderPipeline;
    protect(backing())->setPipeline(renderPipeline.backing());
}

void GPURenderPassEncoder::setIndexBuffer(const GPUBuffer& buffer, GPUIndexFormat indexFormat, GPUSize64 offset, std::optional<GPUSize64> size)
{
    protect(backing())->setIndexBuffer(buffer.backing(), convertToBacking(indexFormat), offset, size);
}

void GPURenderPassEncoder::setVertexBuffer(GPUIndex32 slot, const GPUBuffer* buffer, GPUSize64 offset, std::optional<GPUSize64> size)
{
    protect(backing())->setVertexBuffer(slot, buffer ? &buffer->backing() : nullptr, offset, size);
}

void GPURenderPassEncoder::draw(GPUSize32 vertexCount, GPUSize32 instanceCount,
    GPUSize32 firstVertex, GPUSize32 firstInstance)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    protect(backing())->draw(vertexCount, instanceCount, firstVertex, firstInstance);
}

void GPURenderPassEncoder::drawIndexed(GPUSize32 indexCount, GPUSize32 instanceCount,
    GPUSize32 firstIndex,
    GPUSignedOffset32 baseVertex,
    GPUSize32 firstInstance)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    protect(backing())->drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
}

void GPURenderPassEncoder::drawIndirect(const GPUBuffer& indirectBuffer, GPUSize64 indirectOffset)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    protect(backing())->drawIndirect(indirectBuffer.backing(), indirectOffset);
}

void GPURenderPassEncoder::drawIndexedIndirect(const GPUBuffer& indirectBuffer, GPUSize64 indirectOffset)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    protect(backing())->drawIndexedIndirect(indirectBuffer.backing(), indirectOffset);
}

void GPURenderPassEncoder::setBindGroup(GPUIndex32 index, const GPUBindGroup* bindGroup,
    std::optional<Vector<GPUBufferDynamicOffset>>&& dynamicOffsets)
{
    protect(backing())->setBindGroup(index, bindGroup ? &bindGroup->backing() : nullptr, WTF::move(dynamicOffsets));
}

ExceptionOr<void> GPURenderPassEncoder::setBindGroup(GPUIndex32 index, const GPUBindGroup* bindGroup,
    const Uint32Array& dynamicOffsetsData,
    GPUSize64 dynamicOffsetsDataStart,
    GPUSize32 dynamicOffsetsDataLength)
{
    auto offset = checkedSum<uint64_t>(dynamicOffsetsDataStart, dynamicOffsetsDataLength);
    if (offset.hasOverflowed() || offset > dynamicOffsetsData.length())
        return Exception { ExceptionCode::RangeError, "dynamic offsets overflowed"_s };

    protect(backing())->setBindGroup(index, bindGroup ? &bindGroup->backing() : nullptr, dynamicOffsetsData.typedSpan(), dynamicOffsetsDataStart, dynamicOffsetsDataLength);
    return { };
}

void GPURenderPassEncoder::pushDebugGroup(String&& groupLabel)
{
    protect(backing())->pushDebugGroup(WTF::move(groupLabel));
}

void GPURenderPassEncoder::popDebugGroup()
{
    protect(backing())->popDebugGroup();
}

void GPURenderPassEncoder::insertDebugMarker(String&& markerLabel)
{
    protect(backing())->insertDebugMarker(WTF::move(markerLabel));
}

void GPURenderPassEncoder::setViewport(float x, float y,
    float width, float height,
    float minDepth, float maxDepth)
{
    protect(backing())->setViewport(x, y, width, height, minDepth, maxDepth);
}

void GPURenderPassEncoder::setScissorRect(GPUIntegerCoordinate x, GPUIntegerCoordinate y,
    GPUIntegerCoordinate width, GPUIntegerCoordinate height)
{
    protect(backing())->setScissorRect(x, y, width, height);
}

void GPURenderPassEncoder::setBlendConstant(GPUColor color)
{
    protect(backing())->setBlendConstant(convertToBacking(color));
}

void GPURenderPassEncoder::setStencilReference(GPUStencilValue stencilValue)
{
    protect(backing())->setStencilReference(stencilValue);
}

void GPURenderPassEncoder::beginOcclusionQuery(GPUSize32 queryIndex)
{
    protect(backing())->beginOcclusionQuery(queryIndex);
}

void GPURenderPassEncoder::endOcclusionQuery()
{
    protect(backing())->endOcclusionQuery();
}

void GPURenderPassEncoder::executeBundles(Vector<Ref<GPURenderBundle>>&& bundles)
{
    auto result = WTF::map(bundles, [](auto& bundle) -> Ref<WebGPU::RenderBundle> {
        return bundle->backing();
    });
    protect(backing())->executeBundles(WTF::move(result));
    m_currentPipeline = nullptr;
}

void GPURenderPassEncoder::end()
{
    protect(backing())->end();
    m_currentPipeline = nullptr;
    if (RefPtr device = m_device) {
        m_overrideLabel = label();
        m_backing = device->backing().invalidRenderPassEncoder();
    }
}

}
