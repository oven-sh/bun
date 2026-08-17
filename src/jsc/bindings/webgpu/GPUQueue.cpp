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
#include "GPUQueue.h"

#include "GPUBuffer.h"
#include "GPUDevice.h"
#include "GPUTexture.h"
#include "GPUTextureDescriptor.h"
#include "JSDOMConvertNull.h"
#include "JSDOMPromiseDeferred.h"
#include <JavaScriptCore/HeapCellInlines.h>
#include <array>
#include <wtf/CheckedArithmetic.h>

namespace WebCore {

GPUQueue::GPUQueue(Ref<WebGPU::Queue>&& backing, GPUDevice& device)
    : m_backing(WTF::move(backing))
    , m_device(device)
{
}

bool GPUQueue::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPUQueue::device() const
{
    return m_device;
}

String GPUQueue::label() const
{
    return m_backing->label();
}

void GPUQueue::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

void GPUQueue::submit(Vector<Ref<GPUCommandBuffer>>&& commandBuffers)
{
    auto result = WTF::map(commandBuffers, [](auto& commandBuffer) -> Ref<WebGPU::CommandBuffer> {
        return commandBuffer->backing();
    });
    m_backing->submit(WTF::move(result));

    if (RefPtr device = m_device) {
        for (Ref commandBuffer : commandBuffers) {
            commandBuffer->setOverrideLabel(commandBuffer->label());
            commandBuffer->setBacking(device->backing().invalidCommandEncoder(), device->backing().invalidCommandBuffer());
        }
    }
}

void GPUQueue::onSubmittedWorkDone(OnSubmittedWorkDonePromise&& promise)
{
    m_backing->onSubmittedWorkDone([promise = WTF::move(promise)]() mutable {
        promise.resolve(nullptr);
    });
}

static GPUSize64 computeElementSize(const BufferSource& data)
{
    auto* bufferView = std::get_if<RefPtr<JSC::ArrayBufferView>>(&data.variant());
    if (!bufferView || !*bufferView)
        return 1;
    return static_cast<GPUSize64>(JSC::elementSize((*bufferView)->getType()));
}

static std::span<const uint8_t> bytes(const BufferSource& data)
{
    return { data.data(), data.length() };
}

ExceptionOr<void> GPUQueue::writeBuffer(
    const GPUBuffer& buffer,
    GPUSize64 bufferOffset,
    BufferSource&& data,
    GPUSize64 optionalDataOffset,
    std::optional<GPUSize64> optionalSize)
{
    auto elementSize = computeElementSize(data);
    auto dataOffset = elementSize * optionalDataOffset;
    auto dataSize = data.length();
    auto contentSize = optionalSize.has_value() ? (elementSize * optionalSize.value()) : (dataSize - dataOffset);

    if (dataOffset > dataSize || dataOffset + contentSize > dataSize || (contentSize % 4))
        return Exception { ExceptionCode::OperationError };

    m_backing->writeBuffer(buffer.backing(), bufferOffset, bytes(data).subspan(dataOffset, contentSize), 0, contentSize);
    return { };
}

static uint32_t getExtentDimension(const GPUExtent3D& size, size_t dimension)
{
    return WTF::switchOn(size, [&](const Vector<GPUIntegerCoordinate>& v) -> uint32_t {
        return dimension < v.size() ? v[dimension] : 0u;
    }, [&](const GPUExtent3DDict& size) -> uint32_t {
        switch (dimension) {
        default:
        case 0:
            return size.width;
        case 1:
            return size.height;
        case 2:
            return size.depthOrArrayLayers;
        }
    });
}

static uint32_t width(const GPUExtent3D& extent)
{
    return getExtentDimension(extent, 0);
}
static uint32_t height(const GPUExtent3D& extent)
{
    return getExtentDimension(extent, 1);
}
static uint32_t depth(const GPUExtent3D& extent)
{
    return getExtentDimension(extent, 2);
}

static size_t requiredBytesInCopy(const GPUImageCopyTexture& destination, const GPUImageDataLayout& layout, const GPUExtent3D& copyExtent)
{
    using namespace WebGPU;

    Ref texture = destination.texture;

    auto aspectSpecificFormat = GPUTexture::aspectSpecificFormat(texture->format(), destination.aspect);
    uint32_t blockWidth = GPUTexture::texelBlockWidth(aspectSpecificFormat);
    uint32_t blockHeight = GPUTexture::texelBlockHeight(aspectSpecificFormat);
    uint32_t blockSize = GPUTexture::texelBlockSize(aspectSpecificFormat);

    auto copyExtentWidth = width(copyExtent);
    auto widthInBlocks = copyExtentWidth / blockWidth;
    if (copyExtentWidth % blockWidth)
        return 0;

    auto copyExtentHeight = height(copyExtent);
    auto heightInBlocks = copyExtentHeight / blockHeight;
    if (copyExtentHeight % blockHeight)
        return 0;

    auto bytesInLastRow = checkedProduct<uint64_t>(blockSize, widthInBlocks);
    if (bytesInLastRow.hasOverflowed())
        return 0;

    auto requiredBytesInCopy = CheckedUint64(bytesInLastRow);
    auto bytesPerImage = CheckedUint64(0);
    if (heightInBlocks > 1) {
        if (!layout.bytesPerRow.has_value())
            return 0;

        bytesPerImage = layout.bytesPerRow.value() * heightInBlocks;
        requiredBytesInCopy = bytesPerImage;
    }

    auto copyExtentDepthOrArrayLayers = depth(copyExtent);
    if (copyExtentDepthOrArrayLayers > 1) {
        if (!layout.bytesPerRow.has_value() || !layout.rowsPerImage.has_value())
            return 0;
    }

    if (layout.bytesPerRow.has_value()) {
        if (*layout.bytesPerRow < bytesInLastRow.value())
            return 0;
    }

    if (layout.rowsPerImage.has_value()) {
        if (layout.rowsPerImage < heightInBlocks)
            return 0;
    }

    if (copyExtentDepthOrArrayLayers > 0) {
        requiredBytesInCopy = CheckedUint64(0);

        if (heightInBlocks > 1)
            requiredBytesInCopy += checkedProduct<uint64_t>(*layout.bytesPerRow, checkedDifference<uint64_t>(heightInBlocks, 1));

        if (heightInBlocks > 0)
            requiredBytesInCopy += bytesInLastRow;

        if (copyExtentDepthOrArrayLayers > 1) {
            bytesPerImage = checkedProduct<uint64_t>(*layout.bytesPerRow, *layout.rowsPerImage);

            auto bytesBeforeLastImage = checkedProduct<uint64_t>(bytesPerImage, checkedDifference<uint64_t>(copyExtentDepthOrArrayLayers, 1));
            requiredBytesInCopy += bytesBeforeLastImage;
        }
    }

    return requiredBytesInCopy.hasOverflowed() ? 0 : requiredBytesInCopy.value();
}

void GPUQueue::writeTexture(
    const GPUImageCopyTexture& destination,
    BufferSource&& data,
    const GPUImageDataLayout& initialImageDataLayout,
    const GPUExtent3D& size)
{
    auto imageDataLayout = initialImageDataLayout;
    auto initialOffset = imageDataLayout.offset;
    auto span = bytes(data);
    auto spanLength = span.size();
    auto requiredBytes = requiredBytesInCopy(destination, imageDataLayout, size);
    if (initialOffset >= spanLength) {
        initialOffset = 0;
        requiredBytes = spanLength;
    } else {
        imageDataLayout.offset = 0;
        requiredBytes = std::min<size_t>(spanLength - initialOffset, requiredBytes);
    }

    m_backing->writeTexture(destination.convertToBacking(), span.subspan(initialOffset, requiredBytes), imageDataLayout.convertToBacking(), convertToBacking(size));
}

} // namespace WebCore
