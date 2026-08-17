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

#include "config.h"
#include "WebGPUCommandEncoderImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUBufferImpl.h"
#include "WebGPUCommandBufferImpl.h"
#include "WebGPUComputePassEncoderImpl.h"
#include "WebGPUConvertToBackingContext.h"
#include "WebGPUQuerySetImpl.h"
#include "WebGPURenderPassEncoderImpl.h"
#include "WebGPUTextureImpl.h"
#include "WebGPUTextureViewImpl.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CommandEncoderImpl);

CommandEncoderImpl::CommandEncoderImpl(WebGPUPtr<WGPUCommandEncoder>&& commandEncoder, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(commandEncoder))
    , m_convertToBackingContext(convertToBackingContext)
{
}

CommandEncoderImpl::~CommandEncoderImpl() = default;

RefPtr<RenderPassEncoder> CommandEncoderImpl::beginRenderPass(const RenderPassDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    Vector<WGPURenderPassColorAttachment> colorAttachments;
    Ref convertToBackingContext = m_convertToBackingContext;
    for (const auto& colorAttachment : descriptor.colorAttachments) {
        if (colorAttachment) {
            RefPtr texture = colorAttachment->texture();
            RefPtr textureView = colorAttachment->textureView();
            RefPtr resolveTexture = colorAttachment->resolveTexture();
            RefPtr resolveTarget = colorAttachment->resolveTextureView();
            colorAttachments.append(WGPURenderPassColorAttachment {
                .texture = texture ? convertToBackingContext->convertToBacking(*texture) : nullptr,
                .view = textureView ? convertToBackingContext->convertToBacking(*textureView) : nullptr,
                .depthSlice = colorAttachment->depthSlice,
                .resolveTexture = resolveTexture ? convertToBackingContext->convertToBacking(*resolveTexture) : nullptr,
                .resolveTarget = resolveTarget ? convertToBackingContext->convertToBacking(*resolveTarget) : nullptr,
                .loadOp = convertToBackingContext->convertToBacking(colorAttachment->loadOp),
                .storeOp = convertToBackingContext->convertToBacking(colorAttachment->storeOp),
                .clearValue = colorAttachment->clearValue ? convertToBackingContext->convertToBacking(*colorAttachment->clearValue) : WGPUColor { 0, 0, 0, 0 },
            });
        } else
            colorAttachments.append(WGPURenderPassColorAttachment {
                .texture = nullptr,
                .view = nullptr,
                .depthSlice = std::nullopt,
                .resolveTexture = nullptr,
                .resolveTarget = nullptr,
                .loadOp = WGPULoadOp_Clear,
                .storeOp = WGPUStoreOp_Discard,
                .clearValue = { 0, 0, 0, 0 },
            });
    }

    std::optional<WGPURenderPassDepthStencilAttachment> depthStencilAttachment;
    if (descriptor.depthStencilAttachment) {
        RefPtr texture = descriptor.depthStencilAttachment->texture();
        RefPtr textureView = descriptor.depthStencilAttachment->textureView();

        depthStencilAttachment = WGPURenderPassDepthStencilAttachment {
            .texture = texture ? convertToBackingContext->convertToBacking(*texture) : nullptr,
            .view = textureView ? convertToBackingContext->convertToBacking(*textureView) : nullptr,
            .depthLoadOp = descriptor.depthStencilAttachment->depthLoadOp ? convertToBackingContext->convertToBacking(*descriptor.depthStencilAttachment->depthLoadOp) : WGPULoadOp_Undefined,
            .depthStoreOp = descriptor.depthStencilAttachment->depthStoreOp ? convertToBackingContext->convertToBacking(*descriptor.depthStencilAttachment->depthStoreOp) : WGPUStoreOp_Undefined,
            .depthClearValue = descriptor.depthStencilAttachment->depthClearValue,
            .depthReadOnly = descriptor.depthStencilAttachment->depthReadOnly,
            .stencilLoadOp = descriptor.depthStencilAttachment->stencilLoadOp ? convertToBackingContext->convertToBacking(*descriptor.depthStencilAttachment->stencilLoadOp) : WGPULoadOp_Undefined,
            .stencilStoreOp = descriptor.depthStencilAttachment->stencilStoreOp ? convertToBackingContext->convertToBacking(*descriptor.depthStencilAttachment->stencilStoreOp) : WGPUStoreOp_Undefined,
            .stencilClearValue = descriptor.depthStencilAttachment->stencilClearValue,
            .stencilReadOnly = descriptor.depthStencilAttachment->stencilReadOnly,
        };
    }

    WGPURenderPassTimestampWrites timestampWrites {
        .querySet = descriptor.timestampWrites ? convertToBackingContext->convertToBacking(*protect(descriptor.timestampWrites->querySet)) : nullptr,
        .beginningOfPassWriteIndex = descriptor.timestampWrites ? descriptor.timestampWrites->beginningOfPassWriteIndex : 0,
        .endOfPassWriteIndex = descriptor.timestampWrites ? descriptor.timestampWrites->endOfPassWriteIndex : 0
    };

    WGPURenderPassDescriptor backingDescriptor {
        .maxDrawCount = descriptor.maxDrawCount.value_or(UINT64_MAX),
        .label = label.data(),
        .colorAttachmentCount = colorAttachments.size(),
        .colorAttachments = colorAttachments.size() ? colorAttachments.span().data() : nullptr,
        .depthStencilAttachment = depthStencilAttachment ? &depthStencilAttachment.value() : nullptr,
        .occlusionQuerySet = descriptor.occlusionQuerySet ? convertToBackingContext->convertToBacking(*protect(descriptor.occlusionQuerySet)) : nullptr,
        .timestampWrites = timestampWrites.querySet ? &timestampWrites : nullptr
    };

    return RenderPassEncoderImpl::create(adoptWebGPU(wgpuCommandEncoderBeginRenderPass(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

RefPtr<ComputePassEncoder> CommandEncoderImpl::beginComputePass(const std::optional<ComputePassDescriptor>& descriptor)
{
    String label = descriptor ? descriptor->label : emptyString();

    WGPUComputePassTimestampWrites timestampWrites {
        .querySet = (descriptor && descriptor->timestampWrites && descriptor->timestampWrites->querySet) ? m_convertToBackingContext->convertToBacking(*protect(descriptor->timestampWrites->querySet)) : nullptr,
        .beginningOfPassWriteIndex = (descriptor && descriptor->timestampWrites) ? descriptor->timestampWrites->beginningOfPassWriteIndex : 0,
        .endOfPassWriteIndex = (descriptor && descriptor->timestampWrites) ? descriptor->timestampWrites->endOfPassWriteIndex : 0
    };

    WGPUComputePassDescriptor backingDescriptor {
        .label = label,
        .timestampWrites = timestampWrites.querySet ? &timestampWrites : nullptr
    };

    return ComputePassEncoderImpl::create(adoptWebGPU(wgpuCommandEncoderBeginComputePass(m_backing.get(), &backingDescriptor)), m_convertToBackingContext);
}

void CommandEncoderImpl::copyBufferToBuffer(
    const Buffer& source,
    Size64 sourceOffset,
    const Buffer& destination,
    Size64 destinationOffset,
    Size64 size)
{
    Ref convertToBackingContext = m_convertToBackingContext;
    wgpuCommandEncoderCopyBufferToBuffer(m_backing.get(), convertToBackingContext->convertToBacking(source), sourceOffset, convertToBackingContext->convertToBacking(destination), destinationOffset, size);
}

void CommandEncoderImpl::copyBufferToTexture(
    const ImageCopyBuffer& source,
    const ImageCopyTexture& destination,
    const Extent3D& copySize)
{
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUImageCopyBuffer backingSource {
        .layout = {
            .offset = source.offset,
            .bytesPerRow = source.bytesPerRow.value_or(WGPU_COPY_STRIDE_UNDEFINED),
            .rowsPerImage = source.rowsPerImage.value_or(WGPU_COPY_STRIDE_UNDEFINED),
        },
        .buffer = convertToBackingContext->convertToBacking(protect(source.buffer)),
    };

    WGPUImageCopyTexture backingDestination {
        .texture = convertToBackingContext->convertToBacking(protect(destination.texture)),
        .mipLevel = destination.mipLevel,
        .origin = destination.origin ? convertToBackingContext->convertToBacking(*destination.origin) : WGPUOrigin3D { 0, 0, 0 },
        .aspect = convertToBackingContext->convertToBacking(destination.aspect),
    };

    WGPUExtent3D backingCopySize = convertToBackingContext->convertToBacking(copySize);

    wgpuCommandEncoderCopyBufferToTexture(m_backing.get(), &backingSource, &backingDestination, &backingCopySize);
}

void CommandEncoderImpl::copyTextureToBuffer(
    const ImageCopyTexture& source,
    const ImageCopyBuffer& destination,
    const Extent3D& copySize)
{
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUImageCopyTexture backingSource {
        .texture = convertToBackingContext->convertToBacking(protect(source.texture)),
        .mipLevel = source.mipLevel,
        .origin = source.origin ? convertToBackingContext->convertToBacking(*source.origin) : WGPUOrigin3D { 0, 0, 0 },
        .aspect = convertToBackingContext->convertToBacking(source.aspect),
    };

    WGPUImageCopyBuffer backingDestination {
        .layout = {
            .offset = destination.offset,
            .bytesPerRow = destination.bytesPerRow.value_or(WGPU_COPY_STRIDE_UNDEFINED),
            .rowsPerImage = destination.rowsPerImage.value_or(WGPU_COPY_STRIDE_UNDEFINED),
        },
        .buffer = convertToBackingContext->convertToBacking(protect(destination.buffer)),
    };

    WGPUExtent3D backingCopySize = convertToBackingContext->convertToBacking(copySize);

    wgpuCommandEncoderCopyTextureToBuffer(m_backing.get(), &backingSource, &backingDestination, &backingCopySize);
}

void CommandEncoderImpl::copyTextureToTexture(
    const ImageCopyTexture& source,
    const ImageCopyTexture& destination,
    const Extent3D& copySize)
{
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUImageCopyTexture backingSource {
        .texture = convertToBackingContext->convertToBacking(protect(source.texture)),
        .mipLevel = source.mipLevel,
        .origin = source.origin ? convertToBackingContext->convertToBacking(*source.origin) : WGPUOrigin3D { 0, 0, 0 },
        .aspect = convertToBackingContext->convertToBacking(source.aspect),
    };

    WGPUImageCopyTexture backingDestination {
        .texture = convertToBackingContext->convertToBacking(protect(destination.texture)),
        .mipLevel = destination.mipLevel,
        .origin = destination.origin ? convertToBackingContext->convertToBacking(*destination.origin) : WGPUOrigin3D { 0, 0, 0 },
        .aspect = convertToBackingContext->convertToBacking(destination.aspect),
    };

    WGPUExtent3D backingCopySize = convertToBackingContext->convertToBacking(copySize);

    wgpuCommandEncoderCopyTextureToTexture(m_backing.get(), &backingSource, &backingDestination, &backingCopySize);
}

void CommandEncoderImpl::clearBuffer(
    const Buffer& buffer,
    Size64 offset,
    std::optional<Size64> size)
{
    wgpuCommandEncoderClearBuffer(m_backing.get(), m_convertToBackingContext->convertToBacking(buffer), offset, size.value_or(WGPU_WHOLE_SIZE));
}

void CommandEncoderImpl::pushDebugGroup(String&& groupLabel)
{
    wgpuCommandEncoderPushDebugGroup(m_backing.get(), groupLabel.utf8().data());
}

void CommandEncoderImpl::popDebugGroup()
{
    wgpuCommandEncoderPopDebugGroup(m_backing.get());
}

void CommandEncoderImpl::insertDebugMarker(String&& markerLabel)
{
    wgpuCommandEncoderInsertDebugMarker(m_backing.get(), markerLabel.utf8().data());
}

void CommandEncoderImpl::writeTimestamp(const QuerySet& querySet, Size32 queryIndex)
{
    wgpuCommandEncoderWriteTimestamp(m_backing.get(), m_convertToBackingContext->convertToBacking(querySet), queryIndex);
}

void CommandEncoderImpl::resolveQuerySet(
    const QuerySet& querySet,
    Size32 firstQuery,
    Size32 queryCount,
    const Buffer& destination,
    Size64 destinationOffset)
{
    Ref convertToBackingContext = m_convertToBackingContext;
    wgpuCommandEncoderResolveQuerySet(m_backing.get(), convertToBackingContext->convertToBacking(querySet), firstQuery, queryCount, convertToBackingContext->convertToBacking(destination), destinationOffset);
}

RefPtr<CommandBuffer> CommandEncoderImpl::finish(const CommandBufferDescriptor& descriptor)
{
    WGPUCommandBufferDescriptor backingDescriptor {
        .label = descriptor.label,
    };

    return CommandBufferImpl::create(adoptWebGPU(wgpuCommandEncoderFinish(m_backing.get(), &backingDescriptor)), m_convertToBackingContext);
}

void CommandEncoderImpl::setLabelInternal(const String& label)
{
    wgpuCommandEncoderSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
