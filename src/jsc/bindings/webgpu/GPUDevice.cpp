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
#include "GPUDevice.h"

#include "GPUEventLoopKeepAlive.h"
#include "ContextDestructionObserverInlines.h"
#include "DOMPromiseProxy.h"
#include "EventNames.h"
#include "GPUAdapterInfo.h"
#include "GPUBindGroup.h"
#include "GPUBindGroupDescriptor.h"
#include "GPUBindGroupLayout.h"
#include "GPUBindGroupLayoutDescriptor.h"
#include "GPUBuffer.h"
#include "GPUBufferDescriptor.h"
#include "GPUCommandEncoder.h"
#include "GPUCommandEncoderDescriptor.h"
#include "GPUComputePipeline.h"
#include "GPUComputePipelineDescriptor.h"
#include "GPUPipelineError.h"
#include "GPUPipelineLayout.h"
#include "GPUPipelineLayoutDescriptor.h"
#include "GPUQuerySet.h"
#include "GPUQuerySetDescriptor.h"
#include "GPURenderBundleEncoder.h"
#include "GPURenderBundleEncoderDescriptor.h"
#include "GPURenderPipeline.h"
#include "GPURenderPipelineDescriptor.h"
#include "GPUSampler.h"
#include "GPUSamplerDescriptor.h"
#include "GPUShaderModule.h"
#include "GPUShaderModuleDescriptor.h"
#include "GPUSupportedFeatures.h"
#include "GPUSupportedLimits.h"
#include "GPUTexture.h"
#include "GPUTextureDescriptor.h"
#include "GPUTextureFormat.h"
#include "GPUUncapturedErrorEvent.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMPromiseDeferred.h"
#include "JSGPUComputePipeline.h"
#include "JSGPUDeviceLostInfo.h"
#include "JSGPUInternalError.h"
#include "JSGPUOutOfMemoryError.h"
#include "JSGPUPipelineError.h"
#include "JSGPURenderPipeline.h"
#include "JSGPUUncapturedErrorEvent.h"
#include "JSGPUValidationError.h"
#include <wtf/NeverDestroyed.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GPUDevice);

Lock GPUDevice::s_instancesLock;

HashSet<GPUDevice*>& GPUDevice::instances()
{
    static NeverDestroyed<HashSet<GPUDevice*>> instances;
    return instances;
}

Lock& GPUDevice::instancesLock()
{
    return s_instancesLock;
}

Ref<GPUDevice> GPUDevice::create(ScriptExecutionContext* scriptExecutionContext, Ref<WebGPU::Device>&& backing, String&& queueLabel, GPUAdapterInfo& adapterInfo)
{
    Ref device = adoptRef(*new GPUDevice(scriptExecutionContext, WTF::move(backing), WTF::move(queueLabel), adapterInfo));

    return device;
}

GPUDevice::GPUDevice(ScriptExecutionContext* scriptExecutionContext, Ref<WebGPU::Device>&& backing, String&& queueLabel, GPUAdapterInfo& adapterInfo)
    : ActiveDOMObject { scriptExecutionContext }
    , m_lostPromise(makeUniqueRef<LostPromise>())
    , m_backing(WTF::move(backing))
    , m_queue(GPUQueue::create(m_backing->queue(), *this))
    , m_autoPipelineLayout(createAutoPipelineLayout())
    , m_features(GPUSupportedFeatures::create(m_backing->features()))
    , m_limits(GPUSupportedLimits::create(m_backing->limits()))
    , m_adapterInfo(adapterInfo)
    , m_owningThreadUID(currentThreadID())
{
    m_queue->setLabel(WTF::move(queueLabel));

    Locker locker { instancesLock() };
    instances().add(this);
}

GPUDevice::~GPUDevice()
{
    GPUComputePipeline::willDestroyDevice(*this);
    GPURenderPipeline::willDestroyDevice(*this);

    {
        Locker locker { instancesLock() };
        instances().remove(this);
    }
}

void GPUDevice::contextDestroyed()
{
    ActiveDOMObject::contextDestroyed();
}

String GPUDevice::label() const
{
    return m_backing->label();
}

void GPUDevice::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

Ref<GPUSupportedFeatures> GPUDevice::features() const
{
    return m_features;
}

Ref<GPUSupportedLimits> GPUDevice::limits() const
{
    return m_limits;
}

Ref<GPUQueue> GPUDevice::queue() const
{
    return m_queue;
}

void GPUDevice::addBufferToUnmap(GPUBuffer& buffer)
{
    m_buffersToUnmap.add(buffer);
}

void GPUDevice::removeBufferToUnmap(GPUBuffer& buffer)
{
    m_buffersToUnmap.remove(buffer);
}

void GPUDevice::destroy(ScriptExecutionContext& scriptExecutionContext)
{
    for (Ref buffer : m_buffersToUnmap)
        buffer->destroy(scriptExecutionContext);

    m_buffersToUnmap.clear();

    m_backing->destroy();
}

GPUDevice::LostPromise& GPUDevice::lost()
{
    if (m_waitingForDeviceLostPromise)
        return m_lostPromise;

    m_waitingForDeviceLostPromise = true;
    m_backing->resolveDeviceLostPromise([weakThis = WeakPtr { *this }](WebCore::WebGPU::DeviceLostReason reason) {
        if (!weakThis)
            return;

        auto ref = GPUDeviceLostInfo::create(WebCore::WebGPU::DeviceLostInfo::create(reason, ""_s));
        weakThis->m_lostPromise->resolve(WTF::move(ref));
    });

    return m_lostPromise;
}

ExceptionOr<Ref<GPUBuffer>> GPUDevice::createBuffer(GPUBufferDescriptor&& bufferDescriptor)
{
    auto bufferSize = bufferDescriptor.size;
    if (bufferDescriptor.mappedAtCreation) {
        if (bufferSize > limits()->maxBufferSize())
            return Exception { ExceptionCode::RangeError, makeString("GPUDevice.createBuffer: mappedAtCreation = true and bufferSize("_s, bufferSize, ") exceeds max buffer size"_s) };
        if (bufferSize % 4)
            return Exception { ExceptionCode::RangeError, makeString("GPUDevice.createBuffer: mappedAtCreation = true and bufferSize("_s, bufferSize, ") is not a multiple of 4"_s) };
    }

    auto usage = bufferDescriptor.usage;
    auto mappedAtCreation = bufferDescriptor.mappedAtCreation;
    RefPtr buffer = m_backing->createBuffer(bufferDescriptor.convertToBacking());
    if (!buffer)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createBuffer: Unable to create buffer."_s };

    return GPUBuffer::create(buffer.releaseNonNull(), bufferSize, usage, mappedAtCreation, *this);
}

static std::optional<String> validateFeature(const auto& featureContainer, const String& featureName, String&& error)
{
    if (!featureContainer.contains(featureName))
        return error;

    return std::nullopt;
}

std::optional<String> GPUDevice::errorValidatingSupportedFormat(GPUTextureFormat format) const
{
    const auto& featureContainer = m_backing->features().features();
    switch (format) {
    case GPUTextureFormat::Depth32floatStencil8:
        return validateFeature(featureContainer, "depth32float-stencil8"_s, convertToString(format));

    // BC compressed formats usable if texture-compression-bc is both
    // supported by the device/user agent and enabled in requestDevice.
    case GPUTextureFormat::Bc1RgbaUnorm:
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
    case GPUTextureFormat::Bc2RgbaUnorm:
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
    case GPUTextureFormat::Bc3RgbaUnorm:
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
    case GPUTextureFormat::Bc4RUnorm:
    case GPUTextureFormat::Bc4RSnorm:
    case GPUTextureFormat::Bc5RgUnorm:
    case GPUTextureFormat::Bc5RgSnorm:
    case GPUTextureFormat::Bc6hRgbUfloat:
    case GPUTextureFormat::Bc6hRgbFloat:
    case GPUTextureFormat::Bc7RgbaUnorm:
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return validateFeature(featureContainer, "texture-compression-bc"_s, convertToString(format));

    // ETC2 compressed formats usable if texture-compression-etc2 is both
    // supported by the device/user agent and enabled in requestDevice.
    case GPUTextureFormat::Etc2Rgb8unorm:
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
    case GPUTextureFormat::Etc2Rgb8a1unorm:
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
    case GPUTextureFormat::Etc2Rgba8unorm:
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
    case GPUTextureFormat::EacR11unorm:
    case GPUTextureFormat::EacR11snorm:
    case GPUTextureFormat::EacRg11unorm:
    case GPUTextureFormat::EacRg11snorm:
        return validateFeature(featureContainer, "texture-compression-etc2"_s, convertToString(format));

    // ASTC compressed formats usable if texture-compression-astc is both
    // supported by the device/user agent and enabled in requestDevice.
    case GPUTextureFormat::Astc4x4Unorm:
    case GPUTextureFormat::Astc4x4UnormSRGB:
    case GPUTextureFormat::Astc5x4Unorm:
    case GPUTextureFormat::Astc5x4UnormSRGB:
    case GPUTextureFormat::Astc5x5Unorm:
    case GPUTextureFormat::Astc5x5UnormSRGB:
    case GPUTextureFormat::Astc6x5Unorm:
    case GPUTextureFormat::Astc6x5UnormSRGB:
    case GPUTextureFormat::Astc6x6Unorm:
    case GPUTextureFormat::Astc6x6UnormSRGB:
    case GPUTextureFormat::Astc8x5Unorm:
    case GPUTextureFormat::Astc8x5UnormSRGB:
    case GPUTextureFormat::Astc8x6Unorm:
    case GPUTextureFormat::Astc8x6UnormSRGB:
    case GPUTextureFormat::Astc8x8Unorm:
    case GPUTextureFormat::Astc8x8UnormSRGB:
    case GPUTextureFormat::Astc10x5Unorm:
    case GPUTextureFormat::Astc10x5UnormSRGB:
    case GPUTextureFormat::Astc10x6Unorm:
    case GPUTextureFormat::Astc10x6UnormSRGB:
    case GPUTextureFormat::Astc10x8Unorm:
    case GPUTextureFormat::Astc10x8UnormSRGB:
    case GPUTextureFormat::Astc10x10Unorm:
    case GPUTextureFormat::Astc10x10UnormSRGB:
    case GPUTextureFormat::Astc12x10Unorm:
    case GPUTextureFormat::Astc12x10UnormSRGB:
    case GPUTextureFormat::Astc12x12Unorm:
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return validateFeature(featureContainer, "texture-compression-astc"_s, convertToString(format));

    case GPUTextureFormat::R16unorm:
    case GPUTextureFormat::R16snorm:
    case GPUTextureFormat::Rg16unorm:
    case GPUTextureFormat::Rg16snorm:
    case GPUTextureFormat::Rgba16unorm:
    case GPUTextureFormat::Rgba16snorm:
        return validateFeature(featureContainer, "texture-formats-tier1"_s, convertToString(format));

    default:
        return std::nullopt;
    }
}

ExceptionOr<Ref<GPUTexture>> GPUDevice::createTexture(GPUTextureDescriptor&& textureDescriptor)
{
    if (auto error = errorValidatingSupportedFormat(textureDescriptor.format))
        return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createTexture: Unsupported texture format: "_s, *error) };

    RefPtr texture = m_backing->createTexture(textureDescriptor.convertToBacking());
    if (!texture)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createTexture: Unable to create texture."_s };

    return GPUTexture::create(texture.releaseNonNull(), textureDescriptor, *this);
}

static WebGPU::SamplerDescriptor NODELETE convertToBacking(const std::optional<GPUSamplerDescriptor>& samplerDescriptor)
{
    if (!samplerDescriptor) {
        return {
            { },
            WebGPU::AddressMode::ClampToEdge,
            WebGPU::AddressMode::ClampToEdge,
            WebGPU::AddressMode::ClampToEdge,
            WebGPU::FilterMode::Nearest,
            WebGPU::FilterMode::Nearest,
            WebGPU::MipmapFilterMode::Nearest,
            0,
            32,
            std::nullopt,
            1
        };
    }

    return samplerDescriptor->convertToBacking();
}

ExceptionOr<Ref<GPUSampler>> GPUDevice::createSampler(std::optional<GPUSamplerDescriptor>&& samplerDescriptor)
{
    RefPtr sampler = m_backing->createSampler(convertToBacking(samplerDescriptor));
    if (!sampler)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createSampler: Unable to create sampler."_s };
    return GPUSampler::create(sampler.releaseNonNull(), *this);
}

ScriptExecutionContext* GPUDevice::scriptExecutionContext() const
{
    return ActiveDOMObject::scriptExecutionContext();
}

ExceptionOr<Ref<GPUBindGroupLayout>> GPUDevice::createBindGroupLayout(GPUBindGroupLayoutDescriptor&& bindGroupLayoutDescriptor)
{
    for (auto& entry : bindGroupLayoutDescriptor.entries) {
        if (entry.storageTexture) {
            if (auto error = errorValidatingSupportedFormat(entry.storageTexture->format))
                return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createBindGroupLayout: Unsupported texture format: "_s, *error) };
        }
    }

    RefPtr layout = m_backing->createBindGroupLayout(bindGroupLayoutDescriptor.convertToBacking());
    if (!layout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createBindGroupLayout: Unable to create bind group layout."_s };
    return GPUBindGroupLayout::create(layout.releaseNonNull(), 0, this);
}

RefPtr<GPUPipelineLayout> GPUDevice::createAutoPipelineLayout()
{
    RefPtr layout = m_backing->createPipelineLayout(WebGPU::PipelineLayoutDescriptor {
        { "autoLayout"_s, },
        std::nullopt
    });
    if (!layout)
        return nullptr;
    return GPUPipelineLayout::create(layout.releaseNonNull(), *this);
}

ExceptionOr<Ref<GPUPipelineLayout>> GPUDevice::createPipelineLayout(GPUPipelineLayoutDescriptor&& pipelineLayoutDescriptor)
{
    RefPtr pipelineLayout = m_backing->createPipelineLayout(pipelineLayoutDescriptor.convertToBacking(m_backing));
    if (!pipelineLayout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createPipelineLayout: Unable to make pipeline layout."_s };
    return GPUPipelineLayout::create(pipelineLayout.releaseNonNull(), *this);
}

ExceptionOr<Ref<GPUBindGroup>> GPUDevice::createBindGroup(GPUBindGroupDescriptor&& bindGroupDescriptor)
{
    Ref currentLayout = bindGroupDescriptor.layout;

    RefPtr group = m_backing->createBindGroup(bindGroupDescriptor.convertToBacking());
    if (!group)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createBindGroup: Unable to make bind group."_s };
    auto result = GPUBindGroup::create(group.releaseNonNull(), WTF::move(currentLayout), *this);

    return result;
}

ExceptionOr<Ref<GPUShaderModule>> GPUDevice::createShaderModule(GPUShaderModuleDescriptor&& shaderModuleDescriptor)
{
    if (!m_autoPipelineLayout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createShaderModule: Unable to make shader module."_s };
    String source = shaderModuleDescriptor.code;
    RefPtr<WebCore::WebGPU::ShaderModule> shaderModule;

#if 0 /* PLATFORM(VISION) */
    // FIXME: Remove once https://bugs.webkit.org/show_bug.cgi?id=297538 is addressed
    if (auto context = scriptExecutionContext(); context && context->url().string().contains("toji.github.io/webgpu-metaballs"_s)) {
        GPUShaderModuleDescriptor clonedShaderModuleDescriptor = shaderModuleDescriptor;
        clonedShaderModuleDescriptor.code = makeStringByReplacingAll(shaderModuleDescriptor.code, "fma(depthSample"_s, "fma(min(depthSample, 0.95)"_s);
        shaderModule = m_backing->createShaderModule(clonedShaderModuleDescriptor.convertToBacking(*m_autoPipelineLayout));
    } else
#endif
    shaderModule = m_backing->createShaderModule(shaderModuleDescriptor.convertToBacking(*m_autoPipelineLayout));
    if (!shaderModule)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createShaderModule: Unable to make shader module."_s };
    return GPUShaderModule::create(shaderModule.releaseNonNull(), WTF::move(source), *this);
}

ExceptionOr<Ref<GPUComputePipeline>> GPUDevice::createComputePipeline(UniquelyAnnotatedDescriptor<GPUComputePipelineDescriptor>&& computePipelineDescriptor)
{
    if (!m_autoPipelineLayout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createComputePipeline: Unable to make pipeline."_s };
    RefPtr pipeline = m_backing->createComputePipeline(computePipelineDescriptor->convertToBacking(*m_autoPipelineLayout));
    if (!pipeline)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createComputePipeline: Unable to make pipeline."_s };

    return GPUComputePipeline::create(pipeline.releaseNonNull(), computePipelineDescriptor.uniqueAutogeneratedId(), this, computePipelineDescriptor->compute.module->source());
}

ExceptionOr<Ref<GPURenderPipeline>> GPUDevice::createRenderPipeline(UniquelyAnnotatedDescriptor<GPURenderPipelineDescriptor>&& renderPipelineDescriptor)
{
    if (renderPipelineDescriptor->fragment) {
        for (auto& colorState : renderPipelineDescriptor->fragment->targets) {
            if (colorState) {
                if (auto error = errorValidatingSupportedFormat(colorState->format))
                    return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderPipeline: Unsupported texture format for color target: "_s, *error) };
            }
        }
    }
    if (renderPipelineDescriptor->depthStencil) {
        if (auto error = errorValidatingSupportedFormat(renderPipelineDescriptor->depthStencil->format))
            return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderPipeline: Unsupported texture format for depth target: "_s, *error) };
    }

    if (!m_autoPipelineLayout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createRenderPipeline: Unable to make pipeline."_s };
    RefPtr renderPipeline = m_backing->createRenderPipeline(renderPipelineDescriptor->convertToBacking(*m_autoPipelineLayout));
    if (!renderPipeline)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createRenderPipeline: Unable to make pipeline."_s };

    String fragmentShaderSource;
    bool sharesVertexFragmentShader = false;
    if (auto& fragment = renderPipelineDescriptor->fragment) {
        fragmentShaderSource = fragment->module->source();
        sharesVertexFragmentShader = renderPipelineDescriptor->vertex.module.ptr() == fragment->module.ptr();
    }

    return GPURenderPipeline::create(renderPipeline.releaseNonNull(), renderPipelineDescriptor.uniqueAutogeneratedId(), this, renderPipelineDescriptor->vertex.module->source(), fragmentShaderSource, sharesVertexFragmentShader);
}

void GPUDevice::createComputePipelineAsync(UniquelyAnnotatedDescriptor<GPUComputePipelineDescriptor>&& computePipelineDescriptor, CreateComputePipelineAsyncPromise&& promise)
{
    if (!m_autoPipelineLayout) {
        promise.rejectType<IDLInterface<GPUPipelineError>>(GPUPipelineError::create(""_s, { GPUPipelineErrorReason::Internal }));
        return;
    }
    String shaderSource = computePipelineDescriptor->compute.module->source();
    m_backing->createComputePipelineAsync(computePipelineDescriptor->convertToBacking(*m_autoPipelineLayout), [eventLoop = GPUEventLoopKeepAlive(promise), promise = WTF::move(promise), weakThis = WeakPtr { *this }, shaderSource = WTF::move(shaderSource), autogeneratedId = computePipelineDescriptor.uniqueAutogeneratedId()](RefPtr<WebGPU::ComputePipeline>&& computePipeline, String&& error) mutable {
        if (computePipeline) {
            RefPtr device { weakThis };
            Ref result = GPUComputePipeline::create(computePipeline.releaseNonNull(), autogeneratedId, device.get(), shaderSource);
            promise.resolve(WTF::move(result));
        } else
            promise.rejectType<IDLInterface<GPUPipelineError>>(GPUPipelineError::create(WTF::move(error), { GPUPipelineErrorReason::Validation }));
    });
}

ExceptionOr<void> GPUDevice::createRenderPipelineAsync(UniquelyAnnotatedDescriptor<GPURenderPipelineDescriptor>&& renderPipelineDescriptor, CreateRenderPipelineAsyncPromise&& promise)
{
    if (renderPipelineDescriptor->fragment) {
        for (auto& colorState : renderPipelineDescriptor->fragment->targets) {
            if (colorState) {
                if (auto error = errorValidatingSupportedFormat(colorState->format))
                    return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderBundleEncoder: Unsupported texture format for color format: "_s, *error) };
            }
        }
    }
    if (renderPipelineDescriptor->depthStencil) {
        if (auto error = errorValidatingSupportedFormat(renderPipelineDescriptor->depthStencil->format))
            return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderBundleEncoder: Unsupported texture format for color format: "_s, *error) };
    }

    if (!m_autoPipelineLayout)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createRenderBundleEncoder: Unable to make encoder."_s };

    String vertexShaderSource = renderPipelineDescriptor->vertex.module->source();
    String fragmentShaderSource;
    bool sharesVertexFragmentShader = false;
    if (auto& fragment = renderPipelineDescriptor->fragment) {
        fragmentShaderSource = fragment->module->source();
        sharesVertexFragmentShader = renderPipelineDescriptor->vertex.module.ptr() == fragment->module.ptr();
    }

    m_backing->createRenderPipelineAsync(renderPipelineDescriptor->convertToBacking(*m_autoPipelineLayout), [eventLoop = GPUEventLoopKeepAlive(promise), promise = WTF::move(promise), weakThis = WeakPtr { *this }, vertexShaderSource = WTF::move(vertexShaderSource), fragmentShaderSource = WTF::move(fragmentShaderSource), sharesVertexFragmentShader, autogeneratedId = renderPipelineDescriptor.uniqueAutogeneratedId()](RefPtr<WebGPU::RenderPipeline>&& renderPipeline, String&& error) mutable {
        if (renderPipeline) {
            RefPtr device { weakThis };
            Ref result = GPURenderPipeline::create(renderPipeline.releaseNonNull(), autogeneratedId, device.get(), vertexShaderSource, fragmentShaderSource, sharesVertexFragmentShader);
            promise.resolve(WTF::move(result));
        } else
            promise.rejectType<IDLInterface<GPUPipelineError>>(GPUPipelineError::create(WTF::move(error), { GPUPipelineErrorReason::Validation }));
    });
    return { };
}

static WebGPU::CommandEncoderDescriptor NODELETE convertToBacking(const std::optional<GPUCommandEncoderDescriptor>& commandEncoderDescriptor)
{
    if (!commandEncoderDescriptor)
        return { };

    return commandEncoderDescriptor->convertToBacking();
}

ExceptionOr<Ref<GPUCommandEncoder>> GPUDevice::createCommandEncoder(std::optional<GPUCommandEncoderDescriptor>&& commandEncoderDescriptor)
{
    RefPtr encoder = m_backing->createCommandEncoder(convertToBacking(commandEncoderDescriptor));
    if (!encoder)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createCommandEncoder: Unable to make command encoder."_s };
    return GPUCommandEncoder::create(encoder.releaseNonNull(), *this);
}

ExceptionOr<Ref<GPURenderBundleEncoder>> GPUDevice::createRenderBundleEncoder(GPURenderBundleEncoderDescriptor&& renderBundleEncoderDescriptor)
{
    for (auto& colorFormat : renderBundleEncoderDescriptor.colorFormats) {
        if (colorFormat) {
            if (auto error = errorValidatingSupportedFormat(*colorFormat))
                return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderBundleEncoder: Unsupported texture format for color format."_s, *error) };
        }
    }
    if (renderBundleEncoderDescriptor.depthStencilFormat) {
        if (auto error = errorValidatingSupportedFormat(*renderBundleEncoderDescriptor.depthStencilFormat))
            return Exception { ExceptionCode::TypeError, makeString("GPUDevice.createRenderBundleEncoder: Unsupported texture format for depth format."_s, *error) };
    }

    RefPtr encoder = m_backing->createRenderBundleEncoder(renderBundleEncoderDescriptor.convertToBacking());
    if (!encoder)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createRenderBundleEncoder: Unable to make encoder."_s };
    return GPURenderBundleEncoder::create(encoder.releaseNonNull(), *this);
}

ExceptionOr<Ref<GPUQuerySet>> GPUDevice::createQuerySet(GPUQuerySetDescriptor&& querySetDescriptor)
{
    if (querySetDescriptor.type == GPUQueryType::Timestamp) {
        if (!m_backing->features().features().contains("timestamp-query"_s))
            return Exception { ExceptionCode::TypeError, "Timestamp queries are not supported."_s };
    }

    RefPtr querySet = m_backing->createQuerySet(querySetDescriptor.convertToBacking());
    if (!querySet)
        return Exception { ExceptionCode::InvalidStateError, "GPUDevice.createQuerySet: Unable to make query set."_s };

    return GPUQuerySet::create(querySet.releaseNonNull(), querySetDescriptor, *this);
}

void GPUDevice::pushErrorScope(GPUErrorFilter errorFilter)
{
    m_backing->pushErrorScope(convertToBacking(errorFilter));
}

static GPUError createGPUErrorFromWebGPUError(auto& webGPUError)
{
    return WTF::switchOn(WTF::move(*webGPUError),
        [](Ref<WebGPU::OutOfMemoryError>&& outOfMemoryError) -> GPUError {
            return GPUOutOfMemoryError::create(WTF::move(outOfMemoryError));
        },
        [](Ref<WebGPU::ValidationError>&& validationError) -> GPUError {
            return GPUValidationError::create(WTF::move(validationError));
        },
        [](Ref<WebGPU::InternalError>&& internalError) -> GPUError {
            return GPUInternalError::create(WTF::move(internalError));
        }
    );
}

void GPUDevice::popErrorScope(ErrorScopePromise&& errorScopePromise)
{
    m_backing->popErrorScope([eventLoop = GPUEventLoopKeepAlive(errorScopePromise), promise = WTF::move(errorScopePromise)](bool success, std::optional<WebGPU::Error>&& error) mutable {
        if (!error) {
            if (success)
                promise.resolve(std::nullopt);
            else
                promise.reject(Exception { ExceptionCode::OperationError, "popErrorScope failed"_s });
            return;
        }
        promise.resolve(createGPUErrorFromWebGPUError(error));
    });
}

bool GPUDevice::addEventListener(const AtomString& eventType, Ref<EventListener>&& eventListener, const AddEventListenerOptions& options)
{
    auto result = EventTarget::addEventListener(eventType, WTF::move(eventListener), options);
#if 1 /* PLATFORM(COCOA) */
    if (eventType == WebCore::eventNames().uncapturederrorEvent)
        listenForUncapturedErrors();
#endif
    return result;
}

void GPUDevice::listenForUncapturedErrors()
{
    if (m_listeningForUncapturedErrors)
        return;
#if 1 /* PLATFORM(COCOA) */
    m_listeningForUncapturedErrors = true;
    m_backing->resolveUncapturedErrorEvent([pendingActivity = makePendingActivity(*this), weakThis = WeakPtr { *this }](bool hasUncapturedError, std::optional<WebGPU::Error>&& error) {
        RefPtr protectedThis { weakThis };
        if (!protectedThis || !hasUncapturedError)
            return;

        protectedThis->m_listeningForUncapturedErrors = false;

        RefPtr context = protectedThis->scriptExecutionContext();
        if (!context)
            return;

        queueTaskKeepingObjectAlive(*protectedThis, TaskSource::WebGPU, [event = GPUUncapturedErrorEvent::create(WebCore::eventNames().uncapturederrorEvent, GPUUncapturedErrorEventInit { .error = createGPUErrorFromWebGPUError(error) })](GPUDevice& device) {
            device.dispatchEvent(event);
        });
        protectedThis->listenForUncapturedErrors();
    });
#endif
}

Ref<GPUAdapterInfo> GPUDevice::adapterInfo() const
{
    return m_adapterInfo;
}

}
