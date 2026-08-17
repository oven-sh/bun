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
#include "WebGPUImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUAdapterImpl.h"
#include "WebGPUCompositorIntegrationImpl.h"
#include "WebGPUDowncastConvertToBackingContext.h"
#include "WebGPUPresentationContextDescriptor.h"
#include "WebGPUPresentationContextImpl.h"
#include "GraphicsContext.h"
#include "IntSize.h"
#include "NativeImage.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/BlockPtr.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GPUImpl);

GPUImpl::GPUImpl(WebGPUPtr<WGPUInstance>&& instance, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(instance))
    , m_convertToBackingContext(convertToBackingContext)
{
}

GPUImpl::~GPUImpl() = default;

static void requestAdapterCallback(WGPURequestAdapterStatus status, WGPUAdapter adapter, const char* message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPURequestAdapterStatus, WGPUAdapter, const char*)>(userdata);
    block(status, adapter, message);
    Block_release(block); // Block_release is matched with Block_copy below in GPUImpl::requestAdapter().
}

void GPUImpl::requestAdapter(const RequestAdapterOptions& options, CompletionHandler<void(RefPtr<Adapter>&&)>&& callback)
{
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPURequestAdapterOptions backingOptions {
        .compatibleSurface = nullptr,
#if CPU(X86_64)
        .powerPreference = WGPUPowerPreference_HighPerformance,
#else
        .powerPreference = options.powerPreference ? convertToBackingContext->convertToBacking(*options.powerPreference) : static_cast<WGPUPowerPreference>(WGPUPowerPreference_Undefined),
#endif
        .backendType = WGPUBackendType_Metal,
        .forceFallbackAdapter = options.forceFallbackAdapter,
        .xrCompatible = options.xrCompatible,
    };

    auto blockPtr = makeBlockPtr([convertToBackingContext = convertToBackingContext.copyRef(), callback = WTF::move(callback)](WGPURequestAdapterStatus status, WGPUAdapter adapter, const char*) mutable {
        if (status == WGPURequestAdapterStatus_Success)
            callback(AdapterImpl::create(adoptWebGPU(adapter), convertToBackingContext));
        else
            callback(nullptr);
    });
    wgpuInstanceRequestAdapter(m_backing.get(), &backingOptions, &requestAdapterCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in requestAdapterCallback().
}

static WTF::Function<void(CompletionHandler<void()>&&)> convert(WGPUOnSubmittedWorkScheduledCallback&& onSubmittedWorkScheduledCallback)
{
    return [onSubmittedWorkScheduledCallback = makeBlockPtr(WTF::move(onSubmittedWorkScheduledCallback))](CompletionHandler<void()>&& completionHandler) {
        onSubmittedWorkScheduledCallback(makeBlockPtr(WTF::move(completionHandler)).get());
    };
}

RefPtr<PresentationContext> GPUImpl::createPresentationContext(const PresentationContextDescriptor& presentationContextDescriptor)
{
    Ref compositorIntegration { m_convertToBackingContext->convertToBacking(protect(presentationContextDescriptor.compositorIntegration)) };

    auto registerCallbacksBlock = makeBlockPtr([&](WGPURenderBuffersWereRecreatedBlockCallback renderBuffersWereRecreatedCallback, WGPUOnSubmittedWorkScheduledCallback onSubmittedWorkScheduledCallback) {
        compositorIntegration->registerCallbacks(makeBlockPtr(WTF::move(renderBuffersWereRecreatedCallback)), convert(WTF::move(onSubmittedWorkScheduledCallback)));
    });

    WGPUSurfaceDescriptor surfaceDescriptor {
        .label = nullptr,
        .cocoaDescriptor = WGPUSurfaceDescriptorCocoaCustomSurface {
            .compositorIntegrationRegister = registerCallbacksBlock.get(),
        }
    };

    auto result = PresentationContextImpl::create(adoptWebGPU(wgpuInstanceCreateSurface(m_backing.get(), &surfaceDescriptor)), m_convertToBackingContext);
    compositorIntegration->setPresentationContext(result);
    return result;
}

RefPtr<CompositorIntegration> GPUImpl::createCompositorIntegration()
{
    return CompositorIntegrationImpl::create(m_convertToBackingContext);
}

void GPUImpl::paintToCanvas(WebCore::NativeImage& image, const WebCore::IntSize& canvasSize, WebCore::GraphicsContext& context)
{
    auto imageSize = image.size();
    FloatRect canvasRect(FloatPoint(), canvasSize);
    GraphicsContextStateSaver stateSaver(context);
    context.setImageInterpolationQuality(InterpolationQuality::DoNotInterpolate);
    context.drawNativeImage(image, canvasRect, FloatRect(FloatPoint(), imageSize), { CompositeOperator::Copy });
}

bool GPUImpl::isValid(const CompositorIntegration&) const
{
    return true;
}

bool GPUImpl::isValid(const Buffer& buffer) const
{
    WGPUBuffer wgpuBuffer = m_convertToBackingContext.get().convertToBacking(buffer);
    return wgpuBufferIsValid(wgpuBuffer);
}

bool GPUImpl::isValid(const Adapter& adapter) const
{
    WGPUAdapter wgpuAdapter = m_convertToBackingContext.get().convertToBacking(adapter);
    return wgpuAdapterIsValid(wgpuAdapter);
}

bool GPUImpl::isValid(const BindGroup& bindGroup) const
{
    WGPUBindGroup wgpuBindGroup = m_convertToBackingContext.get().convertToBacking(bindGroup);
    return wgpuBindGroupIsValid(wgpuBindGroup);
}

bool GPUImpl::isValid(const BindGroupLayout& bindGroupLayout) const
{
    WGPUBindGroupLayout wgpuBindGroupLayout = m_convertToBackingContext.get().convertToBacking(bindGroupLayout);
    return wgpuBindGroupLayoutIsValid(wgpuBindGroupLayout);
}

bool GPUImpl::isValid(const CommandBuffer& commandBuffer) const
{
    WGPUCommandBuffer wgpuCommandBuffer = m_convertToBackingContext.get().convertToBacking(commandBuffer);
    return wgpuCommandBufferIsValid(wgpuCommandBuffer);
}

bool GPUImpl::isValid(const CommandEncoder& commandEncoder) const
{
    WGPUCommandEncoder wgpuCommandEncoder = m_convertToBackingContext.get().convertToBacking(commandEncoder);
    return wgpuCommandEncoderIsValid(wgpuCommandEncoder);
}

bool GPUImpl::isValid(const ComputePassEncoder& computePassEncoder) const
{
    WGPUComputePassEncoder wgpuComputePassEncoder = m_convertToBackingContext.get().convertToBacking(computePassEncoder);
    return wgpuComputePassEncoderIsValid(wgpuComputePassEncoder);
}

bool GPUImpl::isValid(const ComputePipeline& computePipeline) const
{
    WGPUComputePipeline wgpuComputePipeline = m_convertToBackingContext.get().convertToBacking(computePipeline);
    return wgpuComputePipelineIsValid(wgpuComputePipeline);
}

bool GPUImpl::isValid(const Device& device) const
{
    WGPUDevice wgpuDevice = m_convertToBackingContext.get().convertToBacking(device);
    return wgpuDeviceIsValid(wgpuDevice);
}

bool GPUImpl::isValid(const ExternalTexture& externalTexture) const
{
    WGPUExternalTexture wgpuExternalTexture = m_convertToBackingContext.get().convertToBacking(externalTexture);
    return wgpuExternalTextureIsValid(wgpuExternalTexture);
}

bool GPUImpl::isValid(const PipelineLayout& pipelineLayout) const
{
    WGPUPipelineLayout wgpuPipelineLayout = m_convertToBackingContext.get().convertToBacking(pipelineLayout);
    return wgpuPipelineLayoutIsValid(wgpuPipelineLayout);
}

bool GPUImpl::isValid(const PresentationContext& presentationContext) const
{
    WGPUSurface wgpuPresentationContext = m_convertToBackingContext.get().convertToBacking(presentationContext);
    return wgpuPresentationContextIsValid(wgpuPresentationContext);
}

bool GPUImpl::isValid(const QuerySet& querySet) const
{
    WGPUQuerySet wgpuQuerySet = m_convertToBackingContext.get().convertToBacking(querySet);
    return wgpuQuerySetIsValid(wgpuQuerySet);
}

bool GPUImpl::isValid(const Queue& queue) const
{
    WGPUQueue wgpuQueue = m_convertToBackingContext.get().convertToBacking(queue);
    return wgpuQueueIsValid(wgpuQueue);
}

bool GPUImpl::isValid(const RenderBundleEncoder& renderBundleEncoder) const
{
    WGPURenderBundleEncoder wgpuRenderBundleEncoder = m_convertToBackingContext.get().convertToBacking(renderBundleEncoder);
    return wgpuRenderBundleEncoderIsValid(wgpuRenderBundleEncoder);
}

bool GPUImpl::isValid(const RenderBundle& renderBundle) const
{
    WGPURenderBundle wgpuRenderBundle = m_convertToBackingContext.get().convertToBacking(renderBundle);
    return wgpuRenderBundleIsValid(wgpuRenderBundle);
}

bool GPUImpl::isValid(const RenderPassEncoder& renderPassEncoder) const
{
    WGPURenderPassEncoder wgpuRenderPassEncoder = m_convertToBackingContext.get().convertToBacking(renderPassEncoder);
    return wgpuRenderPassEncoderIsValid(wgpuRenderPassEncoder);
}

bool GPUImpl::isValid(const RenderPipeline& renderPipeline) const
{
    WGPURenderPipeline wgpuRenderPipeline = m_convertToBackingContext.get().convertToBacking(renderPipeline);
    return wgpuRenderPipelineIsValid(wgpuRenderPipeline);
}

bool GPUImpl::isValid(const Sampler& sampler) const
{
    WGPUSampler wgpuSampler = m_convertToBackingContext.get().convertToBacking(sampler);
    return wgpuSamplerIsValid(wgpuSampler);
}

bool GPUImpl::isValid(const ShaderModule& shaderModule) const
{
    WGPUShaderModule wgpuShaderModule = m_convertToBackingContext.get().convertToBacking(shaderModule);
    return wgpuShaderModuleIsValid(wgpuShaderModule);
}

bool GPUImpl::isValid(const Texture& texture) const
{
    WGPUTexture wgpuTexture = m_convertToBackingContext.get().convertToBacking(texture);
    return wgpuTextureIsValid(wgpuTexture);
}

bool GPUImpl::isValid(const TextureView& textureView) const
{
    WGPUTextureView wgpuTextureView = m_convertToBackingContext.get().convertToBacking(textureView);
    return wgpuTextureViewIsValid(wgpuTextureView);
}

bool GPUImpl::isValid(const XRBinding& binding) const
{
    WGPUXRBinding wgpuBinding = m_convertToBackingContext.get().convertToBacking(binding);
    return wgpuXRBindingIsValid(wgpuBinding);
}

bool GPUImpl::isValid(const XRSubImage& subImage) const
{
    WGPUXRSubImage wgpuSubImage = m_convertToBackingContext.get().convertToBacking(subImage);
    return wgpuXRSubImageIsValid(wgpuSubImage);
}

bool GPUImpl::isValid(const XRProjectionLayer& layer) const
{
    WGPUXRProjectionLayer wgpuLayer = m_convertToBackingContext.get().convertToBacking(layer);
    return wgpuXRProjectionLayerIsValid(wgpuLayer);
}

bool GPUImpl::isValid(const XRView& view) const
{
    WGPUXRView wgpuView = m_convertToBackingContext.get().convertToBacking(view);
    return wgpuXRViewIsValid(wgpuView);
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
