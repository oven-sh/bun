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

#include "WebGPUConvertToBackingContext.h"
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class DowncastConvertToBackingContext final : public ConvertToBackingContext {
    WTF_MAKE_TZONE_ALLOCATED(DowncastConvertToBackingContext);
public:
    static Ref<DowncastConvertToBackingContext> create()
    {
        return adoptRef(*new DowncastConvertToBackingContext());
    }

    virtual ~DowncastConvertToBackingContext() = default;

    WGPUAdapter NODELETE convertToBacking(const Adapter&) final;
    WGPUBindGroup convertToBacking(const BindGroup&) final;
    WGPUBindGroupLayout convertToBacking(const BindGroupLayout&) final;
    WGPUBuffer convertToBacking(const Buffer&) final;
    WGPUCommandBuffer convertToBacking(const CommandBuffer&) final;
    WGPUCommandEncoder convertToBacking(const CommandEncoder&) final;
    WGPUComputePassEncoder convertToBacking(const ComputePassEncoder&) final;
    WGPUComputePipeline convertToBacking(const ComputePipeline&) final;
    WGPUDevice convertToBacking(const Device&) final;
    WGPUExternalTexture convertToBacking(const ExternalTexture&) final;
    WGPUInstance convertToBacking(const GPU&) final;
    WGPUPipelineLayout convertToBacking(const PipelineLayout&) final;
    WGPUSurface convertToBacking(const PresentationContext&) final;
    WGPUQuerySet convertToBacking(const QuerySet&) final;
    WGPUQueue convertToBacking(const Queue&) final;
    WGPURenderBundleEncoder convertToBacking(const RenderBundleEncoder&) final;
    WGPURenderBundle convertToBacking(const RenderBundle&) final;
    WGPURenderPassEncoder convertToBacking(const RenderPassEncoder&) final;
    WGPURenderPipeline convertToBacking(const RenderPipeline&) final;
    WGPUSampler convertToBacking(const Sampler&) final;
    WGPUShaderModule convertToBacking(const ShaderModule&) final;
    WGPUTexture convertToBacking(const Texture&) final;
    WGPUTextureView convertToBacking(const TextureView&) final;
    CompositorIntegrationImpl& convertToBacking(CompositorIntegration&) final;
    WGPUXRBinding convertToBacking(const XRBinding&) final;
    WGPUXRProjectionLayer convertToBacking(const XRProjectionLayer&) final;
    WGPUXRSubImage convertToBacking(const XRSubImage&) final;
    WGPUXRView convertToBacking(const XRView&) final;

private:
    DowncastConvertToBackingContext() = default;
};

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
