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

#include "EventTarget.h"
#include "GPUCommandBufferDescriptor.h"
#include "GPUComputePassDescriptor.h"
#include "GPUComputePassEncoder.h"
#include "GPUExtent3DDict.h"
#include "GPUImageCopyBuffer.h"
#include "GPUImageCopyTexture.h"
#include "GPUIntegralTypes.h"
#include "GPURenderPassDescriptor.h"
#include "GPURenderPassEncoder.h"
#include "WebGPUCommandEncoder.h"
#include <optional>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUBuffer;
class GPUCommandBuffer;
class GPUDevice;
class GPUQuerySet;

class GPUCommandEncoder : public RefCountedAndCanMakeWeakPtr<GPUCommandEncoder> {
public:
    static Ref<GPUCommandEncoder> create(Ref<WebGPU::CommandEncoder>&& backing, GPUDevice& device)
    {
        return adoptRef(*new GPUCommandEncoder(WTF::move(backing), device));
    }

    String NODELETE label() const;
    void setLabel(String&&);

    ExceptionOr<Ref<GPURenderPassEncoder>> beginRenderPass(const GPURenderPassDescriptor&);
    ExceptionOr<Ref<GPUComputePassEncoder>> beginComputePass(const std::optional<GPUComputePassDescriptor>&);

    void copyBufferToBuffer(
        const GPUBuffer& source,
        const GPUBuffer& destination,
        std::optional<GPUSize64>);

    void copyBufferToBuffer(
        const GPUBuffer& source,
        GPUSize64 sourceOffset,
        const GPUBuffer& destination,
        GPUSize64 destinationOffset,
        std::optional<GPUSize64>);

    void copyBufferToTexture(
        const GPUImageCopyBuffer& source,
        const GPUImageCopyTexture& destination,
        const GPUExtent3D& copySize);

    void copyTextureToBuffer(
        const GPUImageCopyTexture& source,
        const GPUImageCopyBuffer& destination,
        const GPUExtent3D& copySize);

    void copyTextureToTexture(
        const GPUImageCopyTexture& source,
        const GPUImageCopyTexture& destination,
        const GPUExtent3D& copySize);

    void clearBuffer(
        const GPUBuffer&,
        GPUSize64 offset,
        std::optional<GPUSize64>);

    void pushDebugGroup(String&& groupLabel);
    void popDebugGroup();
    void insertDebugMarker(String&& markerLabel);

    void writeTimestamp(const GPUQuerySet&, GPUSize32 queryIndex);

    void resolveQuerySet(
        const GPUQuerySet&,
        GPUSize32 firstQuery,
        GPUSize32 queryCount,
        const GPUBuffer& destination,
        GPUSize64 destinationOffset);

    ExceptionOr<Ref<GPUCommandBuffer>> finish(const std::optional<GPUCommandBufferDescriptor>&);

    WebGPU::CommandEncoder& backing() { return m_backing; }
    const WebGPU::CommandEncoder& backing() const { return m_backing; }
    void setBacking(WebGPU::CommandEncoder&);

    GPUDevice* device() const;

    bool hasActiveInspectorCanvasCallTracer() const;

private:
    GPUCommandEncoder(Ref<WebGPU::CommandEncoder>&&, GPUDevice&);

    Ref<WebGPU::CommandEncoder> m_backing;
    WeakPtr<GPUDevice, WeakPtrImplWithEventTargetData> m_device;
    std::optional<String> m_overrideLabel;
};

}
