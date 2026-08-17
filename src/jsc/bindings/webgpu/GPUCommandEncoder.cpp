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
#include "GPUCommandEncoder.h"

#include "ExceptionOr.h"
#include "GPUBuffer.h"
#include "GPUCommandBuffer.h"
#include "GPUDevice.h"
#include "GPUQuerySet.h"

namespace WebCore {

GPUCommandEncoder::GPUCommandEncoder(Ref<WebGPU::CommandEncoder>&& backing, GPUDevice& device)
    : m_backing(WTF::move(backing))
    , m_device(device)
{
}

bool GPUCommandEncoder::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPUCommandEncoder::device() const
{
    return m_device;
}

String GPUCommandEncoder::label() const
{
    return m_overrideLabel ? *m_overrideLabel : m_backing->label();
}

void GPUCommandEncoder::setLabel(String&& label)
{
    protect(backing())->setLabel(WTF::move(label));
}

ExceptionOr<Ref<GPURenderPassEncoder>> GPUCommandEncoder::beginRenderPass(const GPURenderPassDescriptor& renderPassDescriptor)
{
    RefPtr encoder = protect(backing())->beginRenderPass(renderPassDescriptor.convertToBacking());
    if (!encoder)
        return Exception { ExceptionCode::InvalidStateError, "GPUCommandEncoder.beginRenderPass: Unable to begin render pass."_s };
    return GPURenderPassEncoder::create(encoder.releaseNonNull(), *this);
}

ExceptionOr<Ref<GPUComputePassEncoder>> GPUCommandEncoder::beginComputePass(const std::optional<GPUComputePassDescriptor>& computePassDescriptor)
{
    RefPtr computePass = protect(backing())->beginComputePass(computePassDescriptor ? std::optional { computePassDescriptor->convertToBacking() } : std::nullopt);
    if (!computePass)
        return Exception { ExceptionCode::InvalidStateError, "GPUCommandEncoder.beginComputePass: Unable to begin compute pass."_s };
    return GPUComputePassEncoder::create(computePass.releaseNonNull(), *this);
}

void GPUCommandEncoder::copyBufferToBuffer(
    const GPUBuffer& source,
    const GPUBuffer& destination,
    std::optional<GPUSize64> size)
{
    return copyBufferToBuffer(source, 0u, destination, 0u, size);
}

void GPUCommandEncoder::copyBufferToBuffer(
    const GPUBuffer& source,
    GPUSize64 sourceOffset,
    const GPUBuffer& destination,
    GPUSize64 destinationOffset,
    std::optional<GPUSize64> size)
{
    protect(backing())->copyBufferToBuffer(source.backing(), sourceOffset, destination.backing(), destinationOffset, size.value_or(sourceOffset < source.size() ? source.size() - sourceOffset : 0u));
}

void GPUCommandEncoder::copyBufferToTexture(
    const GPUImageCopyBuffer& source,
    const GPUImageCopyTexture& destination,
    const GPUExtent3D& copySize)
{
    protect(backing())->copyBufferToTexture(source.convertToBacking(), destination.convertToBacking(), convertToBacking(copySize));
}

void GPUCommandEncoder::copyTextureToBuffer(
    const GPUImageCopyTexture& source,
    const GPUImageCopyBuffer& destination,
    const GPUExtent3D& copySize)
{
    protect(backing())->copyTextureToBuffer(source.convertToBacking(), destination.convertToBacking(), convertToBacking(copySize));
}

void GPUCommandEncoder::copyTextureToTexture(
    const GPUImageCopyTexture& source,
    const GPUImageCopyTexture& destination,
    const GPUExtent3D& copySize)
{
    protect(backing())->copyTextureToTexture(source.convertToBacking(), destination.convertToBacking(), convertToBacking(copySize));
}


void GPUCommandEncoder::clearBuffer(
    const GPUBuffer& buffer,
    GPUSize64 offset,
    std::optional<GPUSize64> size)
{
    protect(backing())->clearBuffer(buffer.backing(), offset, size);
}

void GPUCommandEncoder::pushDebugGroup(String&& groupLabel)
{
    protect(backing())->pushDebugGroup(WTF::move(groupLabel));
}

void GPUCommandEncoder::popDebugGroup()
{
    protect(backing())->popDebugGroup();
}

void GPUCommandEncoder::insertDebugMarker(String&& markerLabel)
{
    protect(backing())->insertDebugMarker(WTF::move(markerLabel));
}

void GPUCommandEncoder::writeTimestamp(const GPUQuerySet& querySet, GPUSize32 queryIndex)
{
    protect(backing())->writeTimestamp(querySet.backing(), queryIndex);
}

void GPUCommandEncoder::resolveQuerySet(
    const GPUQuerySet& querySet,
    GPUSize32 firstQuery,
    GPUSize32 queryCount,
    const GPUBuffer& destination,
    GPUSize64 destinationOffset)
{
    protect(backing())->resolveQuerySet(querySet.backing(), firstQuery, queryCount, destination.backing(), destinationOffset);
}

static WebGPU::CommandBufferDescriptor NODELETE convertToBacking(const std::optional<GPUCommandBufferDescriptor>& commandBufferDescriptor)
{
    if (!commandBufferDescriptor)
        return { };

    return commandBufferDescriptor->convertToBacking();
}

ExceptionOr<Ref<GPUCommandBuffer>> GPUCommandEncoder::finish(const std::optional<GPUCommandBufferDescriptor>& commandBufferDescriptor)
{
    RefPtr buffer = protect(backing())->finish(convertToBacking(commandBufferDescriptor));
    if (!buffer)
        return Exception { ExceptionCode::InvalidStateError, "GPUCommandEncoder.finish: Unable to finish."_s };
    auto result = GPUCommandBuffer::create(buffer.releaseNonNull(), *this);
    if (RefPtr device = m_device) {
        m_overrideLabel = label();
        m_backing = device->backing().invalidCommandEncoder();
    }
    return result;
}

void GPUCommandEncoder::setBacking(WebGPU::CommandEncoder& newBacking)
{
    m_backing = newBacking;
}

}
