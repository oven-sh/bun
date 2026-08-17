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

#include "WebGPUSupportedLimits.h"

namespace WebCore {

class GPUSupportedLimits : public RefCounted<GPUSupportedLimits> {
public:
    static Ref<GPUSupportedLimits> create(Ref<WebGPU::SupportedLimits>&& backing)
    {
        return adoptRef(*new GPUSupportedLimits(WTF::move(backing)));
    }

    uint32_t NODELETE maxTextureDimension1D() const;
    uint32_t NODELETE maxTextureDimension2D() const;
    uint32_t NODELETE maxTextureDimension3D() const;
    uint32_t NODELETE maxTextureArrayLayers() const;
    uint32_t NODELETE maxBindGroups() const;
    uint32_t NODELETE maxBindGroupsPlusVertexBuffers() const;
    uint32_t NODELETE maxBindingsPerBindGroup() const;
    uint32_t NODELETE maxDynamicUniformBuffersPerPipelineLayout() const;
    uint32_t NODELETE maxDynamicStorageBuffersPerPipelineLayout() const;
    uint32_t NODELETE maxSampledTexturesPerShaderStage() const;
    uint32_t NODELETE maxSamplersPerShaderStage() const;
    uint32_t NODELETE maxStorageBuffersPerShaderStage() const;
    uint32_t NODELETE maxStorageTexturesPerShaderStage() const;
    uint32_t NODELETE maxUniformBuffersPerShaderStage() const;
    uint64_t NODELETE maxUniformBufferBindingSize() const;
    uint64_t NODELETE maxStorageBufferBindingSize() const;
    uint32_t NODELETE minUniformBufferOffsetAlignment() const;
    uint32_t NODELETE minStorageBufferOffsetAlignment() const;
    uint32_t NODELETE maxVertexBuffers() const;
    uint64_t NODELETE maxBufferSize() const;
    uint32_t NODELETE maxVertexAttributes() const;
    uint32_t NODELETE maxVertexBufferArrayStride() const;
    uint32_t NODELETE maxInterStageShaderVariables() const;
    uint32_t NODELETE maxColorAttachments() const;
    uint32_t NODELETE maxColorAttachmentBytesPerSample() const;
    uint32_t NODELETE maxComputeWorkgroupStorageSize() const;
    uint32_t NODELETE maxComputeInvocationsPerWorkgroup() const;
    uint32_t NODELETE maxComputeWorkgroupSizeX() const;
    uint32_t NODELETE maxComputeWorkgroupSizeY() const;
    uint32_t NODELETE maxComputeWorkgroupSizeZ() const;
    uint32_t NODELETE maxComputeWorkgroupsPerDimension() const;
    uint32_t NODELETE maxStorageBuffersInFragmentStage() const;
    uint32_t NODELETE maxStorageTexturesInFragmentStage() const;
    uint32_t NODELETE maxStorageBuffersInVertexStage() const;
    uint32_t NODELETE maxStorageTexturesInVertexStage() const;

    WebGPU::SupportedLimits& backing() { return m_backing; }
    const WebGPU::SupportedLimits& backing() const { return m_backing; }

private:
    GPUSupportedLimits(Ref<WebGPU::SupportedLimits>&& backing)
        : m_backing(WTF::move(backing))
    {
    }

    const Ref<WebGPU::SupportedLimits> m_backing;
};

}
