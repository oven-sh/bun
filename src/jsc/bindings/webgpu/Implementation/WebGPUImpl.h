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

#include "WebGPU.h"
#include "WebGPUConvertToBackingContext.h"
#include "WebGPUPtr.h"
#include <WebGPU/WebGPU.h>
#include <WebGPU/WebGPUExt.h>
#include <wtf/CompletionHandler.h>
#include <wtf/Deque.h>
#include <wtf/Function.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore {
class GraphicsContext;
class IntSize;
class NativeImage;
}

namespace WebCore::WebGPU {

class Adapter;
class Buffer;
class BindGroup;
class BindGroupLayout;
class CompositorIntegration;
class CommandBuffer;
class CommandEncoder;
class ComputePassEncoder;
class ComputePipeline;
class ConvertToBackingContext;
class Device;
class ExternalTexture;
class PipelineLayout;
class PresentationContext;
class QuerySet;
class Queue;
class RenderBundleEncoder;
class RenderBundle;
class RenderPassEncoder;
class RenderPipeline;
class Sampler;
class ShaderModule;
class Texture;
class TextureView;
class XRBinding;
class XRProjectionLayer;
class XRSubImage;

class GPUImpl final : public GPU, public RefCounted<GPUImpl> {
    WTF_MAKE_TZONE_ALLOCATED(GPUImpl);
public:
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    static Ref<GPUImpl> create(WebGPUPtr<WGPUInstance>&& instance, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new GPUImpl(WTF::move(instance), convertToBackingContext));
    }

    virtual ~GPUImpl();

    void paintToCanvas(WebCore::NativeImage&, const WebCore::IntSize&, WebCore::GraphicsContext&) final;

private:
    friend class DowncastConvertToBackingContext;

    GPUImpl(WebGPUPtr<WGPUInstance>&&, ConvertToBackingContext&);

    GPUImpl(const GPUImpl&) = delete;
    GPUImpl(GPUImpl&&) = delete;
    GPUImpl& operator=(const GPUImpl&) = delete;
    GPUImpl& operator=(GPUImpl&&) = delete;

    WGPUInstance backing() const { return m_backing.get(); }
    bool isGPUImpl() const final { return true; }

    void requestAdapter(const RequestAdapterOptions&, CompletionHandler<void(RefPtr<Adapter>&&)>&&) final;

    RefPtr<PresentationContext> createPresentationContext(const PresentationContextDescriptor&) final;

    RefPtr<CompositorIntegration> createCompositorIntegration() final;
    bool NODELETE isValid(const CompositorIntegration&) const final;
    bool isValid(const Buffer&) const final;
    bool isValid(const Adapter&) const final;
    bool isValid(const BindGroup&) const final;
    bool isValid(const BindGroupLayout&) const final;
    bool isValid(const CommandBuffer&) const final;
    bool isValid(const CommandEncoder&) const final;
    bool isValid(const ComputePassEncoder&) const final;
    bool isValid(const ComputePipeline&) const final;
    bool isValid(const Device&) const final;
    bool isValid(const ExternalTexture&) const final;
    bool isValid(const PipelineLayout&) const final;
    bool isValid(const PresentationContext&) const final;
    bool isValid(const QuerySet&) const final;
    bool isValid(const Queue&) const final;
    bool isValid(const RenderBundleEncoder&) const final;
    bool isValid(const RenderBundle&) const final;
    bool isValid(const RenderPassEncoder&) const final;
    bool isValid(const RenderPipeline&) const final;
    bool isValid(const Sampler&) const final;
    bool isValid(const ShaderModule&) const final;
    bool isValid(const Texture&) const final;
    bool isValid(const TextureView&) const final;
    bool isValid(const XRBinding&) const final;
    bool isValid(const XRSubImage&) const final;
    bool isValid(const XRProjectionLayer&) const final;
    bool isValid(const XRView&) const final;

    WebGPUPtr<WGPUInstance> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::GPUImpl)
    static bool isType(const WebCore::WebGPU::GPU& gpu) { return gpu.isGPUImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
