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

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUDevice.h"
#include "WebGPUPtr.h"
#include "WebGPUQueueImpl.h"
#include <WebGPU/WebGPU.h>
#include <wtf/Deque.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;
enum class DeviceLostReason : uint8_t;

class DeviceImpl final : public Device {
    WTF_MAKE_TZONE_ALLOCATED(DeviceImpl);
public:
    static Ref<DeviceImpl> create(WebGPUPtr<WGPUDevice>&& device, Ref<SupportedFeatures>&& features, Ref<SupportedLimits>&& limits, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new DeviceImpl(WTF::move(device), WTF::move(features), WTF::move(limits), convertToBackingContext));
    }

    virtual ~DeviceImpl();
    void setLastUncapturedError(WGPUErrorType, char const*);

private:
    friend class DowncastConvertToBackingContext;

    DeviceImpl(WebGPUPtr<WGPUDevice>&&, Ref<SupportedFeatures>&&, Ref<SupportedLimits>&&, ConvertToBackingContext&);

    DeviceImpl(const DeviceImpl&) = delete;
    DeviceImpl(DeviceImpl&&) = delete;
    DeviceImpl& operator=(const DeviceImpl&) = delete;
    DeviceImpl& operator=(DeviceImpl&&) = delete;

    WGPUDevice backing() const { return m_backing.get(); }
    bool isDeviceImpl() const final { return true; }

    Ref<Queue> NODELETE queue() final;

    void destroy() final;

    RefPtr<Buffer> createBuffer(const BufferDescriptor&) final;
    RefPtr<Texture> createTexture(const TextureDescriptor&) final;
    RefPtr<Sampler> createSampler(const SamplerDescriptor&) final;

    RefPtr<BindGroupLayout> createBindGroupLayout(const BindGroupLayoutDescriptor&) final;
    RefPtr<PipelineLayout> createPipelineLayout(const PipelineLayoutDescriptor&) final;
    RefPtr<BindGroup> createBindGroup(const BindGroupDescriptor&) final;

    RefPtr<ShaderModule> createShaderModule(const ShaderModuleDescriptor&) final;
    RefPtr<ComputePipeline> createComputePipeline(const ComputePipelineDescriptor&) final;
    RefPtr<RenderPipeline> createRenderPipeline(const RenderPipelineDescriptor&) final;
    void createComputePipelineAsync(const ComputePipelineDescriptor&, CompletionHandler<void(RefPtr<ComputePipeline>&&, String&&)>&&) final;
    void createRenderPipelineAsync(const RenderPipelineDescriptor&, CompletionHandler<void(RefPtr<RenderPipeline>&&, String&&)>&&) final;

    RefPtr<CommandEncoder> createCommandEncoder(const std::optional<CommandEncoderDescriptor>&) final;
    RefPtr<RenderBundleEncoder> createRenderBundleEncoder(const RenderBundleEncoderDescriptor&) final;

    RefPtr<QuerySet> createQuerySet(const QuerySetDescriptor&) final;

    void pushErrorScope(ErrorFilter) final;
    void popErrorScope(CompletionHandler<void(bool, std::optional<Error>&&)>&&) final;
    void resolveUncapturedErrorEvent(CompletionHandler<void(bool, std::optional<WebCore::WebGPU::Error>&&)>&&) final;
    void resolveDeviceLostPromise(CompletionHandler<void(WebCore::WebGPU::DeviceLostReason)>&&) final;

    void setLabelInternal(const String&) final;
    void pauseAllErrorReporting(bool pause) final;

    [[noreturn]] Ref<CommandEncoder> NODELETE invalidCommandEncoder() final;
    [[noreturn]] Ref<CommandBuffer> NODELETE invalidCommandBuffer() final;
    [[noreturn]] Ref<RenderPassEncoder> NODELETE invalidRenderPassEncoder() final;
    [[noreturn]] Ref<ComputePassEncoder> NODELETE invalidComputePassEncoder() final;
    [[noreturn]] Ref<BindGroupLayout> NODELETE emptyBindGroupLayout() const final;

    WebGPUPtr<WGPUDevice> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
    const Ref<QueueImpl> m_queue;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::DeviceImpl)
    static bool isType(const WebCore::WebGPU::Device& device) { return device.isDeviceImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
