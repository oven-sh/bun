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

#include "WebGPUComputePipeline.h"
#include "WebGPUDeviceLostInfo.h"
#include "WebGPUError.h"
#include "WebGPUErrorFilter.h"
#include "WebGPURenderPipeline.h"
#include "WebGPUSupportedFeatures.h"
#include "WebGPUSupportedLimits.h"
#include <optional>
#include <wtf/CompletionHandler.h>
#include <wtf/HashSet.h>
#include <wtf/Platform.h>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

#if HAVE(IOSURFACE)
#include <IOSurface/IOSurfaceRef.h>
#endif

namespace WebCore::WebGPU {

class BindGroup;
struct BindGroupDescriptor;
class BindGroupLayout;
struct BindGroupLayoutDescriptor;
class Buffer;
struct BufferDescriptor;
class CommandBuffer;
class CommandEncoder;
struct CommandEncoderDescriptor;
class ComputePassEncoder;
class ComputePipeline;
struct ComputePipelineDescriptor;
class RenderPipeline;
struct RenderPipelineDescriptor;
class PipelineLayout;
struct PipelineLayoutDescriptor;
class QuerySet;
struct QuerySetDescriptor;
class Queue;
class RenderBundleEncoder;
struct RenderBundleEncoderDescriptor;
class RenderPassEncoder;
class RenderPipeline;
struct RenderPipelineDescriptor;
class Sampler;
struct SamplerDescriptor;
class ShaderModule;
struct ShaderModuleDescriptor;
class Texture;
struct TextureDescriptor;

class Device : public RefCountedAndCanMakeWeakPtr<Device> {
public:
    virtual ~Device() = default;

    String label() const { return m_label; }

    void setLabel(String&& label)
    {
        m_label = WTF::move(label);
        setLabelInternal(m_label);
    }

    SupportedFeatures& features() { return m_features; }
    const SupportedFeatures& features() const { return m_features; }
    SupportedLimits& limits() { return m_limits; }
    const SupportedLimits& limits() const { return m_limits; }

    virtual Ref<Queue> queue() = 0;

    virtual void destroy() = 0;

    virtual RefPtr<Buffer> createBuffer(const BufferDescriptor&) = 0;
    virtual RefPtr<Texture> createTexture(const TextureDescriptor&) = 0;
    virtual RefPtr<Sampler> createSampler(const SamplerDescriptor&) = 0;

    virtual RefPtr<BindGroupLayout> createBindGroupLayout(const BindGroupLayoutDescriptor&) = 0;
    virtual RefPtr<PipelineLayout> createPipelineLayout(const PipelineLayoutDescriptor&) = 0;
    virtual RefPtr<BindGroup> createBindGroup(const BindGroupDescriptor&) = 0;

    virtual RefPtr<ShaderModule> createShaderModule(const ShaderModuleDescriptor&) = 0;
    virtual RefPtr<ComputePipeline> createComputePipeline(const ComputePipelineDescriptor&) = 0;
    virtual RefPtr<RenderPipeline> createRenderPipeline(const RenderPipelineDescriptor&) = 0;
    virtual void createComputePipelineAsync(const ComputePipelineDescriptor&, CompletionHandler<void(RefPtr<ComputePipeline>&&, String&&)>&&) = 0;
    virtual void createRenderPipelineAsync(const RenderPipelineDescriptor&, CompletionHandler<void(RefPtr<RenderPipeline>&&, String&&)>&&) = 0;

    virtual RefPtr<CommandEncoder> createCommandEncoder(const std::optional<CommandEncoderDescriptor>&) = 0;
    virtual RefPtr<RenderBundleEncoder> createRenderBundleEncoder(const RenderBundleEncoderDescriptor&) = 0;

    virtual RefPtr<QuerySet> createQuerySet(const QuerySetDescriptor&) = 0;

    virtual void pushErrorScope(ErrorFilter) = 0;
    virtual void popErrorScope(CompletionHandler<void(bool, std::optional<Error>&&)>&&) = 0;
    virtual void resolveUncapturedErrorEvent(CompletionHandler<void(bool, std::optional<Error>&&)>&&) = 0;
    virtual void resolveDeviceLostPromise(CompletionHandler<void(WebCore::WebGPU::DeviceLostReason)>&&) = 0;
    virtual Ref<CommandEncoder> invalidCommandEncoder() = 0;
    virtual Ref<CommandBuffer> invalidCommandBuffer() = 0;
    virtual Ref<RenderPassEncoder> invalidRenderPassEncoder() = 0;
    virtual Ref<ComputePassEncoder> invalidComputePassEncoder() = 0;
    virtual void pauseAllErrorReporting(bool pause) = 0;

    virtual bool isRemoteDeviceProxy() const { return false; }
    virtual bool isDeviceImpl() const { return false; }
    virtual Ref<BindGroupLayout> emptyBindGroupLayout() const = 0;

protected:
    Device(Ref<SupportedFeatures>&& features, Ref<SupportedLimits>&& limits)
        : m_features(WTF::move(features))
        , m_limits(WTF::move(limits))
    {
    }

private:
    Device(const Device&) = delete;
    Device(Device&&) = delete;
    Device& operator=(const Device&) = delete;
    Device& operator=(Device&&) = delete;

    virtual void setLabelInternal(const String&) = 0;

    String m_label;
    const Ref<SupportedFeatures> m_features;
    const Ref<SupportedLimits> m_limits;
};

} // namespace WebCore::WebGPU
