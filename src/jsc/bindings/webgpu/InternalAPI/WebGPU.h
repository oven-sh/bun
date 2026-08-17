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

#include "WebGPURequestAdapterOptions.h"
#include <optional>
#include <wtf/AbstractRefCounted.h>
#include <wtf/CompletionHandler.h>
#include <wtf/RefCounted.h>
#include <wtf/RefPtr.h>

namespace WebCore {
class NativeImage;
class IntSize;
class GraphicsContext;
}

namespace WebCore::WebGPU {

class Adapter;
class BindGroup;
class BindGroupLayout;
class Buffer;
class CommandBuffer;
class CommandEncoder;
class CompositorIntegration;
class ComputePassEncoder;
class ComputePipeline;
class Device;
class ExternalTexture;
class GPU;
class GPUImpl;
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
class XRView;

struct PresentationContextDescriptor;

class GPU : public AbstractRefCounted {
public:
    WEBCORE_EXPORT virtual ~GPU() = default;

    virtual void requestAdapter(const RequestAdapterOptions&, CompletionHandler<void(RefPtr<Adapter>&&)>&&) = 0;

    virtual RefPtr<PresentationContext> createPresentationContext(const PresentationContextDescriptor&) = 0;

    virtual RefPtr<CompositorIntegration> createCompositorIntegration() = 0;
    virtual void paintToCanvas(WebCore::NativeImage&, const WebCore::IntSize&, WebCore::GraphicsContext&) = 0;
    virtual bool isValid(const CompositorIntegration&) const = 0;
    virtual bool isValid(const Buffer&) const = 0;
    virtual bool isValid(const Adapter&) const = 0;
    virtual bool isValid(const BindGroup&) const = 0;
    virtual bool isValid(const BindGroupLayout&) const = 0;
    virtual bool isValid(const CommandBuffer&) const = 0;
    virtual bool isValid(const CommandEncoder&) const = 0;
    virtual bool isValid(const ComputePassEncoder&) const = 0;
    virtual bool isValid(const ComputePipeline&) const = 0;
    virtual bool isValid(const Device&) const = 0;
    virtual bool isValid(const ExternalTexture&) const = 0;
    virtual bool isValid(const PipelineLayout&) const = 0;
    virtual bool isValid(const PresentationContext&) const = 0;
    virtual bool isValid(const QuerySet&) const = 0;
    virtual bool isValid(const Queue&) const = 0;
    virtual bool isValid(const RenderBundleEncoder&) const = 0;
    virtual bool isValid(const RenderBundle&) const = 0;
    virtual bool isValid(const RenderPassEncoder&) const = 0;
    virtual bool isValid(const RenderPipeline&) const = 0;
    virtual bool isValid(const Sampler&) const = 0;
    virtual bool isValid(const ShaderModule&) const = 0;
    virtual bool isValid(const Texture&) const = 0;
    virtual bool isValid(const TextureView&) const = 0;
    virtual bool isValid(const XRBinding&) const = 0;
    virtual bool isValid(const XRSubImage&) const = 0;
    virtual bool isValid(const XRProjectionLayer&) const = 0;
    virtual bool isValid(const XRView&) const = 0;

    virtual bool isRemoteGPUProxy() const { return false; }
    virtual bool isGPUImpl() const { return false; }

protected:
    GPU() = default;

private:
    GPU(const GPU&) = delete;
    GPU(GPU&&) = delete;
    GPU& operator=(const GPU&) = delete;
    GPU& operator=(GPU&&) = delete;
};

} // namespace WebCore::WebGPU
