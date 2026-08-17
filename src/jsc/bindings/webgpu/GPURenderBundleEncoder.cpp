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
#include "GPURenderBundleEncoder.h"

#include "ExceptionOr.h"
#include "GPUBindGroup.h"
#include "GPUBuffer.h"
#include "GPUDevice.h"
#include "GPURenderBundle.h"
#include "GPURenderPipeline.h"
#include "InspectorInstrumentation.h"

namespace WebCore {

GPURenderBundleEncoder::GPURenderBundleEncoder(Ref<WebGPU::RenderBundleEncoder>&& backing, GPUDevice& device)
    : m_backing(WTF::move(backing))
    , m_device(device)
{
}

bool GPURenderBundleEncoder::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPURenderBundleEncoder::device() const
{
    return m_device;
}

String GPURenderBundleEncoder::label() const
{
    return m_backing->label();
}

void GPURenderBundleEncoder::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

void GPURenderBundleEncoder::setPipeline(const GPURenderPipeline& renderPipeline)
{
    m_currentPipeline = renderPipeline;
    m_backing->setPipeline(renderPipeline.backing());
}

void GPURenderBundleEncoder::setIndexBuffer(const GPUBuffer& buffer, GPUIndexFormat indexFormat, GPUSize64 offset, std::optional<GPUSize64> size)
{
    m_backing->setIndexBuffer(buffer.backing(), convertToBacking(indexFormat), offset, size);
}

void GPURenderBundleEncoder::setVertexBuffer(GPUIndex32 slot, const GPUBuffer* buffer, GPUSize64 offset, std::optional<GPUSize64> size)
{
    m_backing->setVertexBuffer(slot, buffer ? &buffer->backing() : nullptr, offset, size);
}

void GPURenderBundleEncoder::draw(GPUSize32 vertexCount,
    GPUSize32 instanceCount,
    GPUSize32 firstVertex, GPUSize32 firstInstance)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    m_backing->draw(vertexCount, instanceCount, firstVertex, firstInstance);
}

void GPURenderBundleEncoder::drawIndexed(GPUSize32 indexCount,
    GPUSize32 instanceCount,
    GPUSize32 firstIndex,
    GPUSignedOffset32 baseVertex,
    GPUSize32 firstInstance)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    m_backing->drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
}

void GPURenderBundleEncoder::drawIndirect(const GPUBuffer& indirectBuffer, GPUSize64 indirectOffset)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    m_backing->drawIndirect(indirectBuffer.backing(), indirectOffset);
}

void GPURenderBundleEncoder::drawIndexedIndirect(const GPUBuffer& indirectBuffer, GPUSize64 indirectOffset)
{
    if (RefPtr pipeline = m_currentPipeline; pipeline && InspectorInstrumentation::isWebGPURenderPipelineDisabled(*pipeline)) [[unlikely]]
        return;
    m_backing->drawIndexedIndirect(indirectBuffer.backing(), indirectOffset);
}

void GPURenderBundleEncoder::setBindGroup(GPUIndex32 index, const GPUBindGroup* bindGroup,
    std::optional<Vector<GPUBufferDynamicOffset>>&& dynamicOffsets)
{
    m_backing->setBindGroup(index, bindGroup ? &bindGroup->backing() : nullptr, WTF::move(dynamicOffsets));
}

ExceptionOr<void> GPURenderBundleEncoder::setBindGroup(GPUIndex32 index, const GPUBindGroup* bindGroup,
    const Uint32Array& dynamicOffsetsData,
    GPUSize64 dynamicOffsetsDataStart,
    GPUSize32 dynamicOffsetsDataLength)
{
    auto offset = checkedSum<uint64_t>(dynamicOffsetsDataStart, dynamicOffsetsDataLength);
    if (offset.hasOverflowed() || offset > dynamicOffsetsData.length())
        return Exception { ExceptionCode::RangeError, "dynamic offsets overflowed"_s };

    m_backing->setBindGroup(index, bindGroup ? &bindGroup->backing() : nullptr, dynamicOffsetsData.typedSpan(), dynamicOffsetsDataStart, dynamicOffsetsDataLength);
    return { };
}

void GPURenderBundleEncoder::pushDebugGroup(String&& groupLabel)
{
    m_backing->pushDebugGroup(WTF::move(groupLabel));
}

void GPURenderBundleEncoder::popDebugGroup()
{
    m_backing->popDebugGroup();
}

void GPURenderBundleEncoder::insertDebugMarker(String&& markerLabel)
{
    m_backing->insertDebugMarker(WTF::move(markerLabel));
}

static WebGPU::RenderBundleDescriptor NODELETE convertToBacking(const std::optional<GPURenderBundleDescriptor>& renderBundleDescriptor)
{
    if (!renderBundleDescriptor)
        return { };
    return renderBundleDescriptor->convertToBacking();
}

ExceptionOr<Ref<GPURenderBundle>> GPURenderBundleEncoder::finish(const std::optional<GPURenderBundleDescriptor>& renderBundleDescriptor)
{
    RefPtr bundle = m_backing->finish(convertToBacking(renderBundleDescriptor));
    m_currentPipeline = nullptr;
    if (!bundle)
        return Exception { ExceptionCode::InvalidStateError, "GPURenderBundleEncoder.finish: Unable to finish."_s };
    return GPURenderBundle::create(bundle.releaseNonNull(), *this);
}

}
