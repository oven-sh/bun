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
#include "WebGPUDeviceImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUBindGroupDescriptor.h"
#include "WebGPUBindGroupImpl.h"
#include "WebGPUBindGroupLayoutDescriptor.h"
#include "WebGPUBindGroupLayoutImpl.h"
#include "WebGPUBufferDescriptor.h"
#include "WebGPUBufferImpl.h"
#include "WebGPUCommandEncoderDescriptor.h"
#include "WebGPUCommandEncoderImpl.h"
#include "WebGPUComputePipelineDescriptor.h"
#include "WebGPUComputePipelineImpl.h"
#include "WebGPUConvertToBackingContext.h"
#include "WebGPUExtent3D.h"
#include "WebGPUExternalTextureDescriptor.h"
#include "WebGPUExternalTextureImpl.h"
#include "WebGPUInternalError.h"
#include "WebGPUOutOfMemoryError.h"
#include "WebGPUPipelineLayoutDescriptor.h"
#include "WebGPUPipelineLayoutImpl.h"
#include "WebGPUPresentationContextImpl.h"
#include "WebGPUQuerySetDescriptor.h"
#include "WebGPUQuerySetImpl.h"
#include "WebGPURenderBundleEncoderDescriptor.h"
#include "WebGPURenderBundleEncoderImpl.h"
#include "WebGPURenderPipelineDescriptor.h"
#include "WebGPURenderPipelineImpl.h"
#include "WebGPUSamplerDescriptor.h"
#include "WebGPUSamplerImpl.h"
#include "WebGPUShaderModuleDescriptor.h"
#include "WebGPUShaderModuleImpl.h"
#include "WebGPUTextureDescriptor.h"
#include "WebGPUTextureImpl.h"
#include "WebGPUTextureViewImpl.h"
#include "WebGPUValidationError.h"
#include "WebGPUXRBindingImpl.h"
#include <CoreGraphics/CGColorSpace.h>
#include <WebGPU/WebGPUExt.h>
#include <wtf/BlockPtr.h>
#include <wtf/SegmentedVector.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

static auto invalidEntryPointName()
{
    return CString(""_s);
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(DeviceImpl);

DeviceImpl::DeviceImpl(WebGPUPtr<WGPUDevice>&& device, Ref<SupportedFeatures>&& features, Ref<SupportedLimits>&& limits, ConvertToBackingContext& convertToBackingContext)
    : Device(WTF::move(features), WTF::move(limits))
    , m_backing(device.copyRef())
    , m_convertToBackingContext(convertToBackingContext)
    , m_queue(QueueImpl::create(WebGPUPtr<WGPUQueue> { wgpuDeviceGetQueue(device.get()) }, convertToBackingContext))
{
}

DeviceImpl::~DeviceImpl()
{
    wgpuDeviceClearDeviceLostCallback(m_backing.get());
    wgpuDeviceClearUncapturedErrorCallback(m_backing.get());
}

Ref<Queue> DeviceImpl::queue()
{
    return m_queue;
}

void DeviceImpl::destroy()
{
    wgpuDeviceDestroy(m_backing.get());
}

RefPtr<XRBinding> DeviceImpl::createXRBinding()
{
    return XRBindingImpl::create(adoptWebGPU(wgpuDeviceCreateXRBinding(m_backing.get())), m_convertToBackingContext);
}

RefPtr<Buffer> DeviceImpl::createBuffer(const BufferDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUBufferDescriptor backingDescriptor {
        .label = label.data(),
        .usage = convertToBackingContext->convertBufferUsageFlagsToBacking(descriptor.usage),
        .size = descriptor.size,
        .mappedAtCreation = descriptor.mappedAtCreation,
    };

    return BufferImpl::create(adoptWebGPU(wgpuDeviceCreateBuffer(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

RefPtr<Texture> DeviceImpl::createTexture(const TextureDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    Ref convertToBackingContext = m_convertToBackingContext;

    auto backingTextureFormats = descriptor.viewFormats.map([&](TextureFormat textureFormat) {
        return convertToBackingContext->convertToBacking(textureFormat);
    });

    WGPUTextureDescriptor backingDescriptor {
        .label = label.data(),
        .usage = convertToBackingContext->convertTextureUsageFlagsToBacking(descriptor.usage),
        .dimension = convertToBackingContext->convertToBacking(descriptor.dimension),
        .size = convertToBackingContext->convertToBacking(descriptor.size),
        .format = convertToBackingContext->convertToBacking(descriptor.format),
        .mipLevelCount = descriptor.mipLevelCount,
        .sampleCount = descriptor.sampleCount,
        .viewFormatCount = backingTextureFormats.size(),
        .viewFormats = backingTextureFormats.size() ? backingTextureFormats.span().data() : nullptr,
    };

    return TextureImpl::create(adoptWebGPU(wgpuDeviceCreateTexture(m_backing.get(), &backingDescriptor)), descriptor.format, descriptor.dimension, convertToBackingContext);
}

RefPtr<Sampler> DeviceImpl::createSampler(const SamplerDescriptor& descriptor)
{
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUSamplerDescriptor backingDescriptor {
        .label = descriptor.label,
        .addressModeU = convertToBackingContext->convertToBacking(descriptor.addressModeU),
        .addressModeV = convertToBackingContext->convertToBacking(descriptor.addressModeV),
        .addressModeW = convertToBackingContext->convertToBacking(descriptor.addressModeW),
        .magFilter = convertToBackingContext->convertToBacking(descriptor.magFilter),
        .minFilter = convertToBackingContext->convertToBacking(descriptor.minFilter),
        .mipmapFilter = convertToBackingContext->convertToBacking(descriptor.mipmapFilter),
        .lodMinClamp = descriptor.lodMinClamp,
        .lodMaxClamp = descriptor.lodMaxClamp,
        .compare = descriptor.compare ? convertToBackingContext->convertToBacking(*descriptor.compare) : WGPUCompareFunction_Undefined,
        .maxAnisotropy = descriptor.maxAnisotropy,
    };

    return SamplerImpl::create(adoptWebGPU(wgpuDeviceCreateSampler(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

static WGPUColorSpace NODELETE convertToWGPUColorSpace(const PredefinedColorSpace& colorSpace)
{
    switch (colorSpace) {
    case PredefinedColorSpace::SRGB:
        return WGPUColorSpace::SRGB;
    case PredefinedColorSpace::SRGBLinear:
        return WGPUColorSpace::SRGBLinear;
#if ENABLE(PREDEFINED_COLOR_SPACE_DISPLAY_P3)
    case PredefinedColorSpace::DisplayP3:
        return WGPUColorSpace::DisplayP3;
    case PredefinedColorSpace::DisplayP3Linear:
        return WGPUColorSpace::DisplayP3Linear;
#endif
    }

    ASSERT_NOT_REACHED();
    return WGPUColorSpace::SRGB;
}

void DeviceImpl::updateExternalTexture(const WebCore::WebGPU::ExternalTexture&, const WebCore::MediaPlayerIdentifier&)
{
    RELEASE_ASSERT_NOT_REACHED();
}

RefPtr<ExternalTexture> DeviceImpl::importExternalTexture(const ExternalTextureDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    auto pixelBuffer = std::get_if<RetainPtr<CVPixelBufferRef>>(&descriptor.videoBacking);
    WGPUExternalTextureDescriptor backingDescriptor {
        .label = label.data(),
        .pixelBuffer = pixelBuffer ? pixelBuffer->get() : nullptr,
        .colorSpace = convertToWGPUColorSpace(descriptor.colorSpace),
    };
    return ExternalTextureImpl::create(adoptWebGPU(wgpuDeviceImportExternalTexture(m_backing.get(), &backingDescriptor)), descriptor, m_convertToBackingContext);
}

RefPtr<BindGroupLayout> DeviceImpl::createBindGroupLayout(const BindGroupLayoutDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    auto backingEntries = WTF::map(descriptor.entries, [&](auto& entry) {
        return WGPUBindGroupLayoutEntry {
            .binding = entry.binding,
            .metalBinding = { entry.binding, entry.binding, entry.binding },
            .visibility = m_convertToBackingContext->convertShaderStageFlagsToBacking(entry.visibility),
            .buffer = {
                .type = entry.buffer ? m_convertToBackingContext->convertToBacking(entry.buffer->type) : WGPUBufferBindingType_Undefined,
                .hasDynamicOffset = entry.buffer ? entry.buffer->hasDynamicOffset : false,
                .minBindingSize = entry.buffer ? entry.buffer->minBindingSize : 0,
                .bufferSizeForBinding = 0,
            },
            .sampler = {
                .type = entry.sampler ? m_convertToBackingContext->convertToBacking(entry.sampler->type) : WGPUSamplerBindingType_Undefined,
            },
            .texture = {
                .sampleType = entry.externalTexture ? static_cast<WGPUTextureSampleType>(WGPUTextureSampleType_ExternalTexture) : (entry.texture ? m_convertToBackingContext->convertToBacking(entry.texture->sampleType) : WGPUTextureSampleType_Undefined),
                .viewDimension = (!entry.externalTexture && entry.texture) ? m_convertToBackingContext->convertToBacking(entry.texture->viewDimension) : WGPUTextureViewDimension_Undefined,
                .multisampled = (!entry.externalTexture && entry.texture) ? entry.texture->multisampled : false,
            },
            .storageTexture = {
                .access = entry.storageTexture ? m_convertToBackingContext->convertToBacking(entry.storageTexture->access) : WGPUStorageTextureAccess_Undefined,
                .format = entry.storageTexture ? m_convertToBackingContext->convertToBacking(entry.storageTexture->format) : WGPUTextureFormat_Undefined,
                .viewDimension = entry.storageTexture ? m_convertToBackingContext->convertToBacking(entry.storageTexture->viewDimension) : WGPUTextureViewDimension_Undefined,
            },
        };
    });

    WGPUBindGroupLayoutDescriptor backingDescriptor {
        .label = label.data(),
        .entryCount = backingEntries.size(),
        .entries = backingEntries.size() ? backingEntries.span().data() : nullptr,
    };

    return BindGroupLayoutImpl::create(adoptWebGPU(wgpuDeviceCreateBindGroupLayout(m_backing.get(), &backingDescriptor)), m_convertToBackingContext);
}

RefPtr<PipelineLayout> DeviceImpl::createPipelineLayout(const PipelineLayoutDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    Vector<WGPUBindGroupLayout> backingBindGroupLayouts;
    if (descriptor.bindGroupLayouts) {
        backingBindGroupLayouts = descriptor.bindGroupLayouts->map([&convertToBackingContext = m_convertToBackingContext.get()](auto bindGroupLayout) {
            return convertToBackingContext.convertToBacking(bindGroupLayout.get());
        });
    }

    WGPUPipelineLayoutDescriptor backingDescriptor {
        .label = label.data(),
        .bindGroupLayoutCount = descriptor.bindGroupLayouts ? backingBindGroupLayouts.size() : 0,
        .bindGroupLayouts = descriptor.bindGroupLayouts ? backingBindGroupLayouts.span().data() : nullptr,
    };

    return PipelineLayoutImpl::create(adoptWebGPU(wgpuDeviceCreatePipelineLayout(m_backing.get(), &backingDescriptor)), m_convertToBackingContext);
}

RefPtr<BindGroup> DeviceImpl::createBindGroup(const BindGroupDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    Ref convertToBackingContext = m_convertToBackingContext;
    SegmentedVector<WGPUExternalTexture, 1> chainedEntries;
    auto backingEntries = descriptor.entries.map([&](const auto& bindGroupEntry) {
        return WGPUBindGroupEntry {
            .binding = bindGroupEntry.binding,
            .buffer = std::holds_alternative<BufferBinding>(bindGroupEntry.resource) ? convertToBackingContext->convertToBacking(std::get<BufferBinding>(bindGroupEntry.resource).buffer) : nullptr,
            .offset = std::holds_alternative<BufferBinding>(bindGroupEntry.resource) ? std::get<BufferBinding>(bindGroupEntry.resource).offset : 0,
            .size = std::holds_alternative<BufferBinding>(bindGroupEntry.resource) ? std::get<BufferBinding>(bindGroupEntry.resource).size.value_or(WGPU_WHOLE_SIZE) : 0,
            .sampler = std::holds_alternative<std::reference_wrapper<Sampler>>(bindGroupEntry.resource) ? convertToBackingContext->convertToBacking(std::get<std::reference_wrapper<Sampler>>(bindGroupEntry.resource).get()) : nullptr,
            .texture = std::holds_alternative<std::reference_wrapper<Texture>>(bindGroupEntry.resource) ? convertToBackingContext->convertToBacking(std::get<std::reference_wrapper<Texture>>(bindGroupEntry.resource).get()) : nullptr,
            .textureView = std::holds_alternative<std::reference_wrapper<TextureView>>(bindGroupEntry.resource) ? convertToBackingContext->convertToBacking(std::get<std::reference_wrapper<TextureView>>(bindGroupEntry.resource).get()) : nullptr,
            .externalTexture = std::holds_alternative<std::reference_wrapper<ExternalTexture>>(bindGroupEntry.resource) ? convertToBackingContext->convertToBacking(std::get<std::reference_wrapper<ExternalTexture>>(bindGroupEntry.resource).get()) : nullptr,
        };
    });

    WGPUBindGroupDescriptor backingDescriptor {
        .label = label.data(),
        .layout = convertToBackingContext->convertToBacking(protect(descriptor.layout)),
        .entryCount = backingEntries.size(),
        .entries = backingEntries.size() ? backingEntries.span().data() : nullptr,
    };

    return BindGroupImpl::create(adoptWebGPU(wgpuDeviceCreateBindGroup(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

RefPtr<ShaderModule> DeviceImpl::createShaderModule(const ShaderModuleDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();

    auto entryPoints = descriptor.hints.map([](const auto& hint) {
        return hint.key.utf8();
    });

    Ref convertToBackingContext = m_convertToBackingContext;

    Vector<WGPUShaderModuleCompilationHint> hintsEntries;
    hintsEntries.reserveInitialCapacity(descriptor.hints.size());
    for (size_t i = 0; i < descriptor.hints.size(); ++i) {
        const auto& hint = descriptor.hints[i].value;
        hintsEntries.append(WGPUShaderModuleCompilationHint {
            .entryPoint = entryPoints[i].data(),
            .layout = convertToBackingContext->convertToBacking(protect(hint.pipelineLayout))
        });
    }

    WGPUShaderModuleDescriptor backingDescriptor {
        .wgslDescriptor = descriptor.code,
        .label = label.data(),
        .hintCount = hintsEntries.size(),
        .hints = hintsEntries.size() ? &hintsEntries[0] : nullptr,
    };

    return ShaderModuleImpl::create(adoptWebGPU(wgpuDeviceCreateShaderModule(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

template <typename T>
static auto convertToBacking(const ComputePipelineDescriptor& descriptor, ConvertToBackingContext& convertToBackingContext, T&& callback)
{
    auto label = descriptor.label.utf8();

    std::optional<CString> entryPoint;
    if (!descriptor.compute.entryPoint.isNull()) {
        entryPoint = descriptor.compute.entryPoint.utf8();
        if (descriptor.compute.entryPoint.length() != String::fromUTF8(entryPoint->data()).length())
            entryPoint = invalidEntryPointName();
    }

    auto constantNames = descriptor.compute.constants.map([](const auto& constant) {
        bool lengthsMatch = constant.key.length() == String::fromUTF8(constant.key.utf8().data()).length();
        return lengthsMatch ? constant.key.utf8() : "";
    });

    Vector<WGPUConstantEntry> backingConstantEntries(descriptor.compute.constants.size(), [&](size_t i) {
        const auto& constant = descriptor.compute.constants[i];
        return WGPUConstantEntry {
            .key = constantNames[i].data(),
            .value = constant.value
        };
    });

    WGPUComputePipelineDescriptor backingDescriptor {
        .label = label.data(),
        .layout = descriptor.layout ? convertToBackingContext.convertToBacking(*protect(descriptor.layout)) : nullptr,
        .compute = WGPUProgrammableStageDescriptor {
            .module = convertToBackingContext.convertToBacking(protect(descriptor.compute.module)),
            .entryPoint = entryPoint ? entryPoint->data() : nullptr,
            .constantCount = backingConstantEntries.size(),
            .constants = backingConstantEntries.size() ? backingConstantEntries.span().data() : nullptr,
        }
    };

    return callback(backingDescriptor);
}

RefPtr<ComputePipeline> DeviceImpl::createComputePipeline(const ComputePipelineDescriptor& descriptor)
{
    return convertToBacking(descriptor, m_convertToBackingContext, [backing = m_backing, &convertToBackingContext = m_convertToBackingContext.get()](const WGPUComputePipelineDescriptor& backingDescriptor) {
        return ComputePipelineImpl::create(adoptWebGPU(wgpuDeviceCreateComputePipeline(backing.get(), &backingDescriptor)), convertToBackingContext);
    });
}

template <typename T>
static auto convertToBacking(const RenderPipelineDescriptor& descriptor, ConvertToBackingContext& convertToBackingContext, T&& callback)
{
    auto label = descriptor.label.utf8();

    std::optional<CString> vertexEntryPoint;
    if (!descriptor.vertex.entryPoint.isNull()) {
        vertexEntryPoint = descriptor.vertex.entryPoint.utf8();
        if (descriptor.vertex.entryPoint.length() != String::fromUTF8(vertexEntryPoint->data()).length())
            vertexEntryPoint = invalidEntryPointName();
    }

    auto vertexConstantNames = descriptor.vertex.constants.map([](const auto& constant) {
        bool lengthsMatch = constant.key.length() == String::fromUTF8(constant.key.utf8().data()).length();
        return lengthsMatch ? constant.key.utf8() : "";
    });

    Vector<WGPUConstantEntry> vertexConstantEntries(descriptor.vertex.constants.size(), [&](size_t i) {
        const auto& constant = descriptor.vertex.constants[i];
        return WGPUConstantEntry {
            .key = vertexConstantNames[i].data(),
            .value = constant.value
        };
    });

    auto backingAttributes = descriptor.vertex.buffers.map([&convertToBackingContext](const auto& buffer) -> Vector<WGPUVertexAttribute> {
        if (buffer) {
            return buffer->attributes.map([&convertToBackingContext](const auto& attribute) {
                return WGPUVertexAttribute {
                    convertToBackingContext.convertToBacking(attribute.format),
                    attribute.offset,
                    attribute.shaderLocation,
                };
            });
        } else
            return { };
    });

    Vector<WGPUVertexBufferLayout> backingBuffers(descriptor.vertex.buffers.size(), [&](size_t i) {
        const auto& buffer = descriptor.vertex.buffers[i];
        return WGPUVertexBufferLayout {
            buffer ? buffer->arrayStride : WGPU_COPY_STRIDE_UNDEFINED,
            buffer ? convertToBackingContext.convertToBacking(buffer->stepMode) : WGPUVertexStepMode_Vertex,
            backingAttributes[i].size(),
            backingAttributes[i].size() ? backingAttributes[i].span().data() : nullptr,
        };
    });

    WGPUDepthStencilState depthStencilState {
        .format = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->format) : WGPUTextureFormat_Undefined,
        .depthWriteEnabled = descriptor.depthStencil ? descriptor.depthStencil->depthWriteEnabled : false,
        .depthCompare = (descriptor.depthStencil && descriptor.depthStencil->depthCompare) ? convertToBackingContext.convertToBacking(*descriptor.depthStencil->depthCompare) : WGPUCompareFunction_Undefined,
        .stencilFront = {
            .compare = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilFront.compare) : WGPUCompareFunction_Undefined,
            .failOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilFront.failOp) : WGPUStencilOperation_Keep,
            .depthFailOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilFront.depthFailOp) : WGPUStencilOperation_Keep,
            .passOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilFront.passOp) : WGPUStencilOperation_Keep,
        },
        .stencilBack = {
            .compare = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilBack.compare) : WGPUCompareFunction_Undefined,
            .failOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilBack.failOp) : WGPUStencilOperation_Keep,
            .depthFailOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilBack.depthFailOp) : WGPUStencilOperation_Keep,
            .passOp = descriptor.depthStencil ? convertToBackingContext.convertToBacking(descriptor.depthStencil->stencilBack.passOp) : WGPUStencilOperation_Keep,
        },
        .stencilReadMask = descriptor.depthStencil && descriptor.depthStencil->stencilReadMask ? *descriptor.depthStencil->stencilReadMask : 0,
        .stencilWriteMask = descriptor.depthStencil && descriptor.depthStencil->stencilWriteMask ? *descriptor.depthStencil->stencilWriteMask : 0,
        .depthBias = descriptor.depthStencil ? descriptor.depthStencil->depthBias : 0,
        .depthBiasSlopeScale = descriptor.depthStencil ? descriptor.depthStencil->depthBiasSlopeScale : 0,
        .depthBiasClamp = descriptor.depthStencil ? descriptor.depthStencil->depthBiasClamp : 0,
    };

    std::optional<CString> fragmentEntryPoint;
    Vector<CString> fragmentConstantNames;
    if (descriptor.fragment) {
        if (!descriptor.fragment->entryPoint.isNull()) {
            fragmentEntryPoint = descriptor.fragment->entryPoint.utf8();
            if (descriptor.fragment->entryPoint.length() != String::fromUTF8(fragmentEntryPoint->data()).length())
                fragmentEntryPoint = invalidEntryPointName();
        }

        fragmentConstantNames = descriptor.fragment->constants.map([](const auto& constant) {
            bool lengthsMatch = constant.key.length() == String::fromUTF8(constant.key.utf8().data()).length();
            return lengthsMatch ? constant.key.utf8() : "";
        });
    }

    Vector<WGPUConstantEntry> fragmentConstantEntries;
    if (descriptor.fragment) {
        fragmentConstantEntries = Vector<WGPUConstantEntry>(descriptor.fragment->constants.size(), [&](size_t i) {
            const auto& constant = descriptor.fragment->constants[i];
            return WGPUConstantEntry {
                .key = fragmentConstantNames[i].data(),
                .value = constant.value,
            };
        });
    }

    Vector<std::optional<WGPUBlendState>> blendStates;
    if (descriptor.fragment) {
        blendStates = descriptor.fragment->targets.map([&convertToBackingContext](const auto& target) -> std::optional<WGPUBlendState> {
            if (target && target->blend) {
                return WGPUBlendState {
                    {
                        convertToBackingContext.convertToBacking(target->blend->color.operation),
                        convertToBackingContext.convertToBacking(target->blend->color.srcFactor),
                        convertToBackingContext.convertToBacking(target->blend->color.dstFactor),
                    }, {
                        convertToBackingContext.convertToBacking(target->blend->alpha.operation),
                        convertToBackingContext.convertToBacking(target->blend->alpha.srcFactor),
                        convertToBackingContext.convertToBacking(target->blend->alpha.dstFactor),
                    }
                };
            } else
                return std::nullopt;
        });
    }

    Vector<WGPUColorTargetState> colorTargets;
    if (descriptor.fragment) {
        colorTargets = Vector<WGPUColorTargetState>(descriptor.fragment->targets.size(), [&](size_t i) {
            if (auto& target = descriptor.fragment->targets[i]) {
                return WGPUColorTargetState {
                    .format = convertToBackingContext.convertToBacking(target->format),
                    .blend = blendStates[i] ? &*blendStates[i] : nullptr,
                    .writeMask = convertToBackingContext.convertColorWriteFlagsToBacking(target->writeMask),
                };
            }
            return WGPUColorTargetState {
                .format = WGPUTextureFormat_Undefined,
                .blend = nullptr,
                .writeMask = WGPUMapMode_None,
            };
        });
    }

    WGPUFragmentState fragmentState {
        .module = descriptor.fragment ? convertToBackingContext.convertToBacking(protect(descriptor.fragment->module)) : nullptr,
        .entryPoint = fragmentEntryPoint ? fragmentEntryPoint->data() : nullptr,
        .constantCount = fragmentConstantEntries.size(),
        .constants = fragmentConstantEntries.size() ? fragmentConstantEntries.span().data() : nullptr,
        .targetCount = colorTargets.size(),
        .targets = colorTargets.size() ? colorTargets.span().data() : nullptr,
    };

    WGPURenderPipelineDescriptor backingDescriptor {
        .label = label.data(),
        .layout = descriptor.layout ? convertToBackingContext.convertToBacking(*protect(descriptor.layout)) : nullptr,
        .vertex = {
            .module = convertToBackingContext.convertToBacking(protect(descriptor.vertex.module)),
            .entryPoint = vertexEntryPoint ? vertexEntryPoint->data() : nullptr,
            .constantCount = vertexConstantEntries.size(),
            .constants = vertexConstantEntries.size() ? vertexConstantEntries.span().data() : nullptr,
            .bufferCount = backingBuffers.size(),
            .buffers = backingBuffers.size() ? backingBuffers.span().data() : nullptr,
        },
        .primitive = {
            .topology = descriptor.primitive ? convertToBackingContext.convertToBacking(descriptor.primitive->topology) : WGPUPrimitiveTopology_TriangleList,
            .stripIndexFormat = descriptor.primitive && descriptor.primitive->stripIndexFormat ? convertToBackingContext.convertToBacking(*descriptor.primitive->stripIndexFormat) : WGPUIndexFormat_Undefined,
            .frontFace = descriptor.primitive ? convertToBackingContext.convertToBacking(descriptor.primitive->frontFace) : WGPUFrontFace_CCW,
            .cullMode = descriptor.primitive ? convertToBackingContext.convertToBacking(descriptor.primitive->cullMode) : WGPUCullMode_None,
            .unclippedDepth = descriptor.primitive && descriptor.primitive->unclippedDepth,
        },
        .depthStencil = descriptor.depthStencil ? &depthStencilState : nullptr,
        .multisample = {
            .count = descriptor.multisample ? descriptor.multisample->count : 1,
            .mask = descriptor.multisample ? descriptor.multisample->mask : 0xFFFFFFFFU,
            .alphaToCoverageEnabled = descriptor.multisample ? descriptor.multisample->alphaToCoverageEnabled : false,
        },
        .fragment = descriptor.fragment ? &fragmentState : nullptr,
    };

    return callback(backingDescriptor);
}

RefPtr<RenderPipeline> DeviceImpl::createRenderPipeline(const RenderPipelineDescriptor& descriptor)
{
    return convertToBacking(descriptor, m_convertToBackingContext, [backing = m_backing.copyRef(), &convertToBackingContext = m_convertToBackingContext.get()](const WGPURenderPipelineDescriptor& backingDescriptor) {
        return RenderPipelineImpl::create(adoptWebGPU(wgpuDeviceCreateRenderPipeline(backing.get(), &backingDescriptor)), convertToBackingContext);
    });
}

static void createComputePipelineAsyncCallback(WGPUCreatePipelineAsyncStatus status, WGPUComputePipeline pipeline, String&& message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUCreatePipelineAsyncStatus, WGPUComputePipeline, String&&)>(userdata);
    block(status, pipeline, WTF::move(message));
    Block_release(block); // Block_release is matched with Block_copy below in DeviceImpl::createComputePipelineAsync().
}

void DeviceImpl::createComputePipelineAsync(const ComputePipelineDescriptor& descriptor, CompletionHandler<void(RefPtr<ComputePipeline>&&, String&&)>&& callback)
{
    convertToBacking(descriptor, m_convertToBackingContext, [backing = m_backing.copyRef(), &convertToBackingContext = m_convertToBackingContext.get(), callback = WTF::move(callback)](const WGPUComputePipelineDescriptor& backingDescriptor) mutable {
        auto blockPtr = makeBlockPtr([convertToBackingContext = protect(convertToBackingContext), callback = WTF::move(callback)](WGPUCreatePipelineAsyncStatus status, WGPUComputePipeline pipeline, String&& message) mutable {
            if (status == WGPUCreatePipelineAsyncStatus_Success)
                callback(ComputePipelineImpl::create(adoptWebGPU(pipeline), convertToBackingContext), ""_s);
            else
                callback(nullptr, WTF::move(message));
        });
        wgpuDeviceCreateComputePipelineAsync(backing.get(), &backingDescriptor, &createComputePipelineAsyncCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in createComputePipelineAsyncCallback().
    });
}

static void createRenderPipelineAsyncCallback(WGPUCreatePipelineAsyncStatus status, WGPURenderPipeline pipeline, String&& message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUCreatePipelineAsyncStatus, WGPURenderPipeline, String&&)>(userdata);
    block(status, pipeline, WTF::move(message));
    Block_release(block); // Block_release is matched with Block_copy below in DeviceImpl::createRenderPipelineAsync().
}

void DeviceImpl::createRenderPipelineAsync(const RenderPipelineDescriptor& descriptor, CompletionHandler<void(RefPtr<RenderPipeline>&&, String&&)>&& callback)
{
    convertToBacking(descriptor, m_convertToBackingContext, [backing = m_backing.copyRef(), convertToBackingContext = m_convertToBackingContext.copyRef(), callback = WTF::move(callback)](const WGPURenderPipelineDescriptor& backingDescriptor) mutable {
        auto blockPtr = makeBlockPtr([convertToBackingContext = convertToBackingContext.copyRef(), callback = WTF::move(callback)](WGPUCreatePipelineAsyncStatus status, WGPURenderPipeline pipeline, String&& message) mutable {
            if (status == WGPUCreatePipelineAsyncStatus_Success)
                callback(RenderPipelineImpl::create(adoptWebGPU(pipeline), convertToBackingContext), ""_s);
            else
                callback(nullptr, WTF::move(message));
        });
        wgpuDeviceCreateRenderPipelineAsync(backing.get(), &backingDescriptor, &createRenderPipelineAsyncCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in createRenderPipelineAsyncCallback().
    });
}

RefPtr<CommandEncoder> DeviceImpl::createCommandEncoder(const std::optional<CommandEncoderDescriptor>& descriptor)
{
    CString label = descriptor ? descriptor->label.utf8() : CString(""_s);

    WGPUCommandEncoderDescriptor backingDescriptor {
        .label = label.data(),
    };

    return CommandEncoderImpl::create(adoptWebGPU(wgpuDeviceCreateCommandEncoder(m_backing.get(), &backingDescriptor)), m_convertToBackingContext);
}

RefPtr<RenderBundleEncoder> DeviceImpl::createRenderBundleEncoder(const RenderBundleEncoderDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();
    Ref convertToBackingContext = m_convertToBackingContext;

    auto backingColorFormats = descriptor.colorFormats.map([&](auto colorFormat) {
        return colorFormat ? convertToBackingContext->convertToBacking(*colorFormat) : WGPUTextureFormat_Undefined;
    });

    WGPURenderBundleEncoderDescriptor backingDescriptor {
        .label = label.data(),
        .colorFormatCount = backingColorFormats.size(),
        .colorFormats = backingColorFormats.size() ? backingColorFormats.span().data() : nullptr,
        .depthStencilFormat = descriptor.depthStencilFormat ? convertToBackingContext->convertToBacking(*descriptor.depthStencilFormat) : WGPUTextureFormat_Undefined,
        .sampleCount = descriptor.sampleCount,
        .depthReadOnly = descriptor.depthReadOnly,
        .stencilReadOnly = descriptor.stencilReadOnly,
    };

    return RenderBundleEncoderImpl::create(adoptWebGPU(wgpuDeviceCreateRenderBundleEncoder(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

RefPtr<QuerySet> DeviceImpl::createQuerySet(const QuerySetDescriptor& descriptor)
{
    auto label = descriptor.label.utf8();
    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUQuerySetDescriptor backingDescriptor {
        .label = label.data(),
        .type = convertToBackingContext->convertToBacking(descriptor.type),
        .count = descriptor.count,
    };

    return QuerySetImpl::create(adoptWebGPU(wgpuDeviceCreateQuerySet(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

void DeviceImpl::pushErrorScope(ErrorFilter errorFilter)
{
    wgpuDevicePushErrorScope(m_backing.get(), protect(m_convertToBackingContext)->convertToBacking(errorFilter));
}

static void popErrorScopeCallback(WGPUErrorType type, const char* message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUErrorType, const char*)>(userdata);
    block(type, message);
    Block_release(block); // Block_release is matched with Block_copy below in DeviceImpl::popErrorScope().
}

static void setUncapturedScopeCallback(WGPUErrorType type, const char* message, void* userdata)
{
    auto block = reinterpret_cast<void(^)(WGPUErrorType, const char*)>(userdata);
    block(type, message);
    Block_release(block);
}

void DeviceImpl::popErrorScope(CompletionHandler<void(bool, std::optional<Error>&&)>&& callback)
{
    auto blockPtr = makeBlockPtr([callback = WTF::move(callback)](WGPUErrorType errorType, const char* message) mutable {
        std::optional<Error> error;
        bool succeeded = false;
        switch (errorType) {
        case WGPUErrorType_NoError:
            succeeded = true;
            break;
        case WGPUErrorType_Force32:
            break;
        case WGPUErrorType_Internal:
            error = { { InternalError::create(String::fromLatin1(message)) } };
            break;
        case WGPUErrorType_Validation:
            error = { { ValidationError::create(String::fromLatin1(message)) } };
            break;
        case WGPUErrorType_OutOfMemory:
            error = { { OutOfMemoryError::create() } };
            break;
        case WGPUErrorType_Unknown:
            break;
        case WGPUErrorType_DeviceLost:
            break;
        }

        callback(succeeded, WTF::move(error));
    });
    wgpuDevicePopErrorScope(m_backing.get(), &popErrorScopeCallback, Block_copy(blockPtr.get())); // Block_copy is matched with Block_release above in popErrorScopeCallback().
}

void DeviceImpl::resolveUncapturedErrorEvent(CompletionHandler<void(bool, std::optional<Error>&&)>&& callback)
{
    auto blockPtr = makeBlockPtr([callback = WTF::move(callback)](WGPUErrorType errorType, const char* message) mutable {
        std::optional<Error> error;
        bool hasUncapturedError = true;
        switch (errorType) {
        case WGPUErrorType_NoError:
            hasUncapturedError = false;
            break;
        case WGPUErrorType_Force32:
            break;
        case WGPUErrorType_Internal:
            error = { { InternalError::create(String::fromLatin1(message)) } };
            break;
        case WGPUErrorType_Validation:
            error = { { ValidationError::create(String::fromLatin1(message)) } };
            break;
        case WGPUErrorType_OutOfMemory:
            error = { { OutOfMemoryError::create() } };
            break;
        case WGPUErrorType_Unknown:
            break;
        case WGPUErrorType_DeviceLost:
            break;
        }

        callback(hasUncapturedError, WTF::move(error));
    });
    wgpuDeviceSetUncapturedErrorCallback(m_backing.get(), &setUncapturedScopeCallback, Block_copy(blockPtr.get()));
}

void DeviceImpl::resolveDeviceLostPromise(CompletionHandler<void(WebCore::WebGPU::DeviceLostReason)>&& callback)
{
    wgpuDeviceSetDeviceLostCallbackWithBlock(m_backing.get(), makeBlockPtr([callback = WTF::move(callback)](WGPUDeviceLostReason reason, const char*) mutable {
        switch (reason) {
        case WGPUDeviceLostReason_Undefined:
        case WGPUDeviceLostReason_Force32:
            callback(WebCore::WebGPU::DeviceLostReason::Unknown);
            return;
        case WGPUDeviceLostReason_Destroyed:
            callback(WebCore::WebGPU::DeviceLostReason::Destroyed);
            return;
        }
    }).get());
}

void DeviceImpl::pauseAllErrorReporting(bool pause)
{
    wgpuDevicePauseErrorReporting(m_backing.get(), pause);
}

void DeviceImpl::setLabelInternal(const String& label)
{
    wgpuDeviceSetLabel(m_backing.get(), label.utf8().data());
}

Ref<CommandEncoder> DeviceImpl::invalidCommandEncoder()
{
    RELEASE_ASSERT_NOT_REACHED();
}

Ref<CommandBuffer> DeviceImpl::invalidCommandBuffer()
{
    RELEASE_ASSERT_NOT_REACHED();
}

Ref<RenderPassEncoder> DeviceImpl::invalidRenderPassEncoder()
{
    RELEASE_ASSERT_NOT_REACHED();
}
Ref<ComputePassEncoder> DeviceImpl::invalidComputePassEncoder()
{
    RELEASE_ASSERT_NOT_REACHED();
}

Ref<BindGroupLayout> DeviceImpl::emptyBindGroupLayout() const
{
    RELEASE_ASSERT_NOT_REACHED();
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
