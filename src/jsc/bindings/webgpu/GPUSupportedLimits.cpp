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
#include "GPUSupportedLimits.h"

namespace WebCore {

uint32_t GPUSupportedLimits::maxTextureDimension1D() const
{
    return m_backing->maxTextureDimension1D();
}

uint32_t GPUSupportedLimits::maxTextureDimension2D() const
{
    return m_backing->maxTextureDimension2D();
}

uint32_t GPUSupportedLimits::maxTextureDimension3D() const
{
    return m_backing->maxTextureDimension3D();
}

uint32_t GPUSupportedLimits::maxTextureArrayLayers() const
{
    return m_backing->maxTextureArrayLayers();
}

uint32_t GPUSupportedLimits::maxBindGroups() const
{
    return m_backing->maxBindGroups();
}

uint32_t GPUSupportedLimits::maxBindGroupsPlusVertexBuffers() const
{
    return m_backing->maxBindGroupsPlusVertexBuffers();
}

uint32_t GPUSupportedLimits::maxBindingsPerBindGroup() const
{
    return m_backing->maxBindingsPerBindGroup();
}

uint32_t GPUSupportedLimits::maxDynamicUniformBuffersPerPipelineLayout() const
{
    return m_backing->maxDynamicUniformBuffersPerPipelineLayout();
}

uint32_t GPUSupportedLimits::maxDynamicStorageBuffersPerPipelineLayout() const
{
    return m_backing->maxDynamicStorageBuffersPerPipelineLayout();
}

uint32_t GPUSupportedLimits::maxSampledTexturesPerShaderStage() const
{
    return m_backing->maxSampledTexturesPerShaderStage();
}

uint32_t GPUSupportedLimits::maxSamplersPerShaderStage() const
{
    return m_backing->maxSamplersPerShaderStage();
}

uint32_t GPUSupportedLimits::maxStorageBuffersPerShaderStage() const
{
    return m_backing->maxStorageBuffersPerShaderStage();
}

uint32_t GPUSupportedLimits::maxStorageTexturesPerShaderStage() const
{
    return m_backing->maxStorageTexturesPerShaderStage();
}

uint32_t GPUSupportedLimits::maxUniformBuffersPerShaderStage() const
{
    return m_backing->maxUniformBuffersPerShaderStage();
}

uint64_t GPUSupportedLimits::maxUniformBufferBindingSize() const
{
    return m_backing->maxUniformBufferBindingSize();
}

uint64_t GPUSupportedLimits::maxStorageBufferBindingSize() const
{
    return m_backing->maxStorageBufferBindingSize();
}

uint32_t GPUSupportedLimits::minUniformBufferOffsetAlignment() const
{
    return m_backing->minUniformBufferOffsetAlignment();
}

uint32_t GPUSupportedLimits::minStorageBufferOffsetAlignment() const
{
    return m_backing->minStorageBufferOffsetAlignment();
}

uint32_t GPUSupportedLimits::maxVertexBuffers() const
{
    return m_backing->maxVertexBuffers();
}

uint64_t GPUSupportedLimits::maxBufferSize() const
{
    return m_backing->maxBufferSize();
}

uint32_t GPUSupportedLimits::maxVertexAttributes() const
{
    return m_backing->maxVertexAttributes();
}

uint32_t GPUSupportedLimits::maxVertexBufferArrayStride() const
{
    return m_backing->maxVertexBufferArrayStride();
}

uint32_t GPUSupportedLimits::maxInterStageShaderVariables() const
{
    return m_backing->maxInterStageShaderVariables();
}

uint32_t GPUSupportedLimits::maxColorAttachments() const
{
    return m_backing->maxColorAttachments();
}

uint32_t GPUSupportedLimits::maxColorAttachmentBytesPerSample() const
{
    return m_backing->maxColorAttachmentBytesPerSample();
}

uint32_t GPUSupportedLimits::maxComputeWorkgroupStorageSize() const
{
    return m_backing->maxComputeWorkgroupStorageSize();
}

uint32_t GPUSupportedLimits::maxComputeInvocationsPerWorkgroup() const
{
    return m_backing->maxComputeInvocationsPerWorkgroup();
}

uint32_t GPUSupportedLimits::maxComputeWorkgroupSizeX() const
{
    return m_backing->maxComputeWorkgroupSizeX();
}

uint32_t GPUSupportedLimits::maxComputeWorkgroupSizeY() const
{
    return m_backing->maxComputeWorkgroupSizeY();
}

uint32_t GPUSupportedLimits::maxComputeWorkgroupSizeZ() const
{
    return m_backing->maxComputeWorkgroupSizeZ();
}

uint32_t GPUSupportedLimits::maxComputeWorkgroupsPerDimension() const
{
    return m_backing->maxComputeWorkgroupsPerDimension();
}

uint32_t GPUSupportedLimits::maxStorageBuffersInFragmentStage() const
{
    return m_backing->maxStorageBuffersInFragmentStage();
}

uint32_t GPUSupportedLimits::maxStorageTexturesInFragmentStage() const
{
    return m_backing->maxStorageTexturesInFragmentStage();
}

uint32_t GPUSupportedLimits::maxStorageBuffersInVertexStage() const
{
    return m_backing->maxStorageBuffersInVertexStage();
}

uint32_t GPUSupportedLimits::maxStorageTexturesInVertexStage() const
{
    return m_backing->maxStorageTexturesInVertexStage();
}

}
