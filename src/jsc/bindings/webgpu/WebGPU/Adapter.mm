/*
 * Copyright (c) 2021-2023 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#import "config.h"
#import "Adapter.h"

#import "APIConversions.h"
#import "Device.h"
#import "Instance.h"
#import <algorithm>
#import <ranges>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Adapter);

Adapter::Adapter(id<MTLDevice> device, Instance& instance, bool xrCompatible, HardwareCapabilities&& capabilities)
    : m_device(device)
    , m_instance(&instance)
    , m_capabilities(WTF::move(capabilities))
    , m_xrCompatible(xrCompatible)
{
}

Adapter::Adapter(Instance& instance)
    : m_instance(&instance)
{
}

Adapter::~Adapter() = default;

size_t Adapter::enumerateFeatures(WGPUFeatureName* features)
{
    // The API contract for this requires that sufficient space has already been allocated for the output.
    // This requires the caller calling us twice: once to get the amount of space to allocate, and once to fill the space.
    if (features)
        std::ranges::copy(m_capabilities.features, features);
    return m_capabilities.features.size();
}

bool Adapter::getLimits(WGPUSupportedLimits& limits)
{
    limits.limits = m_capabilities.limits;
    return true;
}

static uint32_t subgroupSize(id<MTLDevice> device)
{
    // Apple Silicon GPUs have a fixed SIMD-group width of 32,
    // so there's no need to compile a pipeline just to discover it.
    if ([device supportsFamily:MTLGPUFamilyApple4])
        return 32;

    // On non-Apple (Intel/AMD) GPUs the SIMD-group width isn't a fixed device
    // constant, so query it from a compute pipeline state's threadExecutionWidth.
    // Fall back to 32 if the probe pipeline can't be built for any reason.
    NSError *error = nil;
    id<MTLLibrary> library = [device newLibraryWithSource:@"#include <metal_stdlib>\nusing namespace metal;\nkernel void _webgpu_subgroup_size_probe() { }" options:nil error:&error];
    if (!library)
        return 32;
    id<MTLFunction> function = [library newFunctionWithName:@"_webgpu_subgroup_size_probe"];
    if (!function)
        return 32;
    id<MTLComputePipelineState> pipelineState = [device newComputePipelineStateWithFunction:function error:&error];
    if (!pipelineState)
        return 32;
    return static_cast<uint32_t>(pipelineState.threadExecutionWidth);
}

void Adapter::getProperties(WGPUAdapterProperties& properties)
{
    // FIXME: What should the vendorID and deviceID be?
    properties.vendorID = 0;
    properties.deviceID = 0;
    properties.name = m_device.name.UTF8String;
    properties.driverDescription = "";
    properties.adapterType = m_device.hasUnifiedMemory ? WGPUAdapterType_IntegratedGPU : WGPUAdapterType_DiscreteGPU;
    properties.backendType = WGPUBackendType_Metal;
    if (hasFeature(WGPUFeatureName_Subgroups)) {
        // Metal exposes a single SIMD-group (subgroup) width per device, so
        // min and max are equal. It's a fixed 32 on Apple Silicon; on other
        // GPUs it's derived from a compute pipeline's threadExecutionWidth.
        uint32_t size = subgroupSize(m_device);
        properties.subgroupMinSize = size;
        properties.subgroupMaxSize = size;
    } else {
        // Spec defaults when the feature is unsupported: https://github.com/gpuweb/gpuweb/pull/4963
        properties.subgroupMinSize = 4;
        properties.subgroupMaxSize = 128;
    }
}

bool Adapter::hasFeature(WGPUFeatureName feature)
{
    return m_capabilities.features.contains(feature);
}

void Adapter::requestDevice(const WGPUDeviceDescriptor& descriptor, CompletionHandler<void(WGPURequestDeviceStatus, Ref<Device>&&, String&&)>&& callback)
{
    if (m_deviceRequested) {
        callback(WGPURequestDeviceStatus_Error, Device::createInvalid(*this), "Adapter can only request one device"_s);
        makeInvalid();
        return;
    }

    WGPULimits limits { };

    if (descriptor.requiredLimits) {

        if (!WebGPU::isValid(descriptor.requiredLimits->limits)) {
            callback(WGPURequestDeviceStatus_Error, Device::createInvalid(*this), "Device does not support requested limits"_s);
            return;
        }

        if (anyLimitIsBetterThan(descriptor.requiredLimits->limits, m_capabilities.limits)) {
            callback(WGPURequestDeviceStatus_Error, Device::createInvalid(*this), "Device does not support requested limits"_s);
            return;
        }

        limits = descriptor.requiredLimits->limits;
    } else
        limits = defaultLimits();

    Vector<WGPUFeatureName> features(descriptor.requiredFeaturesSpan());
    if (includesUnsupportedFeatures(features, m_capabilities.features)) {
        callback(WGPURequestDeviceStatus_Error, Device::createInvalid(*this), "Device does not support requested features"_s);
        return;
    }

    HardwareCapabilities capabilities {
        limits,
        WTF::move(features),
        m_capabilities.baseCapabilities,
    };

    auto label = fromAPI(descriptor.label);
    m_deviceRequested = true;
    // FIXME: this should be asynchronous - https://bugs.webkit.org/show_bug.cgi?id=233621
    callback(WGPURequestDeviceStatus_Success, Device::create(this->m_device, WTF::move(label), WTF::move(capabilities), *this), { });
}

bool Adapter::isXRCompatible() const
{
    return m_xrCompatible;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuAdapterReference(WGPUAdapter adapter)
{
    WebGPU::fromAPI(adapter).ref();
}

void wgpuAdapterRelease(WGPUAdapter adapter)
{
    WebGPU::fromAPI(adapter).deref();
}

size_t wgpuAdapterEnumerateFeatures(WGPUAdapter adapter, WGPUFeatureName* features)
{
    return protect(WebGPU::fromAPI(adapter))->enumerateFeatures(features);
}

WGPUBool wgpuAdapterGetLimits(WGPUAdapter adapter, WGPUSupportedLimits* limits)
{
    return WebGPU::fromAPI(adapter).getLimits(*limits);
}

void wgpuAdapterGetProperties(WGPUAdapter adapter, WGPUAdapterProperties* properties)
{
    protect(WebGPU::fromAPI(adapter))->getProperties(*properties);
}

WGPUBool wgpuAdapterHasFeature(WGPUAdapter adapter, WGPUFeatureName feature)
{
    return protect(WebGPU::fromAPI(adapter))->hasFeature(feature);
}

void wgpuAdapterRequestDevice(WGPUAdapter adapter, const WGPUDeviceDescriptor* descriptor, WGPURequestDeviceCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(adapter))->requestDevice(*descriptor, [callback, userdata](WGPURequestDeviceStatus status, Ref<WebGPU::Device>&& device, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(device)), message.utf8().data(), userdata);
    });
}

void wgpuAdapterRequestDeviceWithBlock(WGPUAdapter adapter, WGPUDeviceDescriptor const * descriptor, WGPURequestDeviceBlockCallback callback)
{
    protect(WebGPU::fromAPI(adapter))->requestDevice(*descriptor, [callback = WebGPU::fromAPI(WTF::move(callback))](WGPURequestDeviceStatus status, Ref<WebGPU::Device>&& device, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(device)), message.utf8().data());
    });
}

WGPUBool wgpuAdapterXRCompatible(WGPUAdapter adapter)
{
    return WebGPU::fromAPI(adapter).isXRCompatible();
}
