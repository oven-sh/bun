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
#import "Instance.h"

#import "APIConversions.h"
#import "Adapter.h"
#import "HardwareCapabilities.h"
#import <cstring>
#import <dlfcn.h>
#import <wtf/BlockPtr.h>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Instance);

static NSArray<id<MTLDevice>>* getDevices()
{
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
    NSArray<id<MTLDevice>> *devices = MTLCopyAllDevices();
#else
    NSMutableArray<id<MTLDevice>> *devices = [NSMutableArray array];
    if (id<MTLDevice> device = MTLCreateSystemDefaultDevice())
        [devices addObject:device];
#endif
    return devices;
}

Ref<Instance> Instance::create(const WGPUInstanceDescriptor& descriptor)
{
    const WGPUInstanceCocoaDescriptor& cocoaDescriptor = descriptor.cocoaDescriptor;

    return adoptRef(*new Instance(cocoaDescriptor.scheduleWorkBlock));
}

Instance::Instance(WGPUScheduleWorkBlock scheduleWorkBlock)
    : m_scheduleWorkBlock(scheduleWorkBlock ? WTF::move(scheduleWorkBlock) : ^(WGPUWorkItem workItem) { defaultScheduleWork(WTF::move(workItem)); })
{
}

Instance::Instance()
    : m_scheduleWorkBlock(^(WGPUWorkItem workItem) { defaultScheduleWork(WTF::move(workItem)); })
    , m_isValid(false)
{
}

Instance::~Instance() = default;

void Instance::scheduleWork(WorkItem&& workItem)
{
    m_scheduleWorkBlock(makeBlockPtr(WTF::move(workItem)).get());
}

void Instance::defaultScheduleWork(WGPUWorkItem&& workItem)
{
    Locker locker(m_lock);
    m_pendingWork.append(WTF::move(workItem));
}

void Instance::processEvents()
{
    while (true) {
        Deque<WGPUWorkItem> localWork;
        {
            Locker locker(m_lock);
            std::swap(m_pendingWork, localWork);
        }
        if (localWork.isEmpty())
            return;
        for (auto& workItem : localWork)
            workItem();
    }
}

static NSArray<id<MTLDevice>> *sortedDevices(NSArray<id<MTLDevice>> *devices, WGPUPowerPreference powerPreference)
{
    switch (powerPreference) {
    case WGPUPowerPreference_Undefined:
        return devices;
    case WGPUPowerPreference_LowPower:
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
        return [devices sortedArrayWithOptions:NSSortStable usingComparator:^NSComparisonResult (id<MTLDevice> obj1, id<MTLDevice> obj2)
        {
            ALLOW_DEPRECATED_DECLARATIONS_BEGIN
            if (obj1.lowPower == obj2.lowPower)
                return NSOrderedSame;
            if (obj1.lowPower)
                return NSOrderedAscending;
            ALLOW_DEPRECATED_DECLARATIONS_END
            return NSOrderedDescending;
        }];
#else
        return devices;
#endif
    case WGPUPowerPreference_HighPerformance:
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
        return [devices sortedArrayWithOptions:NSSortStable usingComparator:^NSComparisonResult (id<MTLDevice> obj1, id<MTLDevice> obj2)
        {
            ALLOW_DEPRECATED_DECLARATIONS_BEGIN
            if (obj1.lowPower == obj2.lowPower)
                return NSOrderedSame;
            if (obj1.lowPower)
                return NSOrderedDescending;
            ALLOW_DEPRECATED_DECLARATIONS_END
            return NSOrderedAscending;
        }];
#else
        return devices;
#endif
    case WGPUPowerPreference_Force32:
        ASSERT_NOT_REACHED();
        return nil;
    }
}

void Instance::requestAdapter(const WGPURequestAdapterOptions& options, CompletionHandler<void(WGPURequestAdapterStatus, Ref<Adapter>&&, String&&)>&& callback)
{
    auto devices = getDevices();

    auto sortedDevices = WebGPU::sortedDevices(devices, options.powerPreference);

    if (options.forceFallbackAdapter) {
        callback(WGPURequestAdapterStatus_Unavailable, Adapter::createInvalid(*this), "No adapters present"_s);
        return;
    }

    if (!sortedDevices) {
        callback(WGPURequestAdapterStatus_Error, Adapter::createInvalid(*this), "Unknown power preference"_s);
        return;
    }

    if (!sortedDevices.count) {
        callback(WGPURequestAdapterStatus_Unavailable, Adapter::createInvalid(*this), "No adapters present"_s);
        return;
    }

    if (!sortedDevices[0]) {
        callback(WGPURequestAdapterStatus_Error, Adapter::createInvalid(*this), "Adapter is internally null"_s);
        return;
    }

    auto device = sortedDevices[0];

    auto deviceCapabilities = hardwareCapabilities(device);

    if (!deviceCapabilities) {
        callback(WGPURequestAdapterStatus_Error, Adapter::createInvalid(*this), "Device does not support WebGPU"_s);
        return;
    }

    // FIXME: this should be asynchronous
    callback(WGPURequestAdapterStatus_Success, Adapter::create(sortedDevices[0], *this, options.xrCompatible, WTF::move(*deviceCapabilities)), { });
}

void Instance::retainDevice(Device& device, id<MTLCommandBuffer> commandBuffer)
{
    Locker locker(m_lock);
    auto& container = retainedDeviceInstances.ensure(device, [] {
        return CommandBufferContainer { };
    }).iterator->value;

    container.append(commandBuffer);

    for (auto& container : retainedDeviceInstances.values()) {
        container.removeAllMatching([&](auto& pair) {
            return !pair;
        });
    }
    retainedDeviceInstances.removeIf([&](auto& pair) {
        return !pair.value.size();
    });
}

id<MTLDevice> Instance::device() const
{
    return getDevices().firstObject;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuInstanceReference(WGPUInstance instance)
{
    WebGPU::fromAPI(instance).ref();
}

void wgpuInstanceRelease(WGPUInstance instance)
{
    WebGPU::fromAPI(instance).deref();
}

WGPUInstance wgpuCreateInstance(const WGPUInstanceDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(WebGPU::Instance::create(*descriptor));
}

WGPUProc NODELETE wgpuGetProcAddress(WGPUDevice, const char*)
{
    return nullptr;
}

void wgpuInstanceProcessEvents(WGPUInstance instance)
{
    protect(WebGPU::fromAPI(instance))->processEvents();
}

void wgpuInstanceRequestAdapter(WGPUInstance instance, const WGPURequestAdapterOptions* options, WGPURequestAdapterCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(instance))->requestAdapter(*options, [callback, userdata](WGPURequestAdapterStatus status, Ref<WebGPU::Adapter>&& adapter, String&& message) {
        if (status != WGPURequestAdapterStatus_Success) {
            callback(status, nullptr, message.utf8().data(), userdata);
            return;
        }

        callback(status, WebGPU::releaseToAPI(WTF::move(adapter)), message.utf8().data(), userdata);
    });
}

void wgpuInstanceRequestAdapterWithBlock(WGPUInstance instance, WGPURequestAdapterOptions const * options, WGPURequestAdapterBlockCallback callback)
{
    protect(WebGPU::fromAPI(instance))->requestAdapter(*options, [callback = WebGPU::fromAPI(WTF::move(callback))](WGPURequestAdapterStatus status, Ref<WebGPU::Adapter>&& adapter, String&& message) {
        if (status != WGPURequestAdapterStatus_Success) {
            callback(status, nullptr, message.utf8().data());
            return;
        }

        callback(status, WebGPU::releaseToAPI(WTF::move(adapter)), message.utf8().data());
    });
}

// Fuzzer things
WGPUBool wgpuBufferIsValid(WGPUBuffer buffer)
{
    return protect(WebGPU::fromAPI(buffer))->isValid();
}

WGPUBool wgpuAdapterIsValid(WGPUAdapter adapter)
{
    return protect(WebGPU::fromAPI(adapter))->isValid();
}

WGPUBool wgpuBindGroupIsValid(WGPUBindGroup bindGroup)
{
    return protect(WebGPU::fromAPI(bindGroup))->isValid();
}

WGPUBool wgpuBindGroupLayoutIsValid(WGPUBindGroupLayout bindGroupLayout)
{
    return protect(WebGPU::fromAPI(bindGroupLayout))->isValid();
}

WGPUBool wgpuCommandBufferIsValid(WGPUCommandBuffer commandBuffer)
{
    return protect(WebGPU::fromAPI(commandBuffer))->isValid();
}

WGPUBool wgpuCommandEncoderIsValid(WGPUCommandEncoder commandEncoder)
{
    return protect(WebGPU::fromAPI(commandEncoder))->isValid();
}

WGPUBool wgpuComputePassEncoderIsValid(WGPUComputePassEncoder computePassEncoder)
{
    return protect(WebGPU::fromAPI(computePassEncoder))->isValid();
}

WGPUBool wgpuComputePipelineIsValid(WGPUComputePipeline computePipeline)
{
    return protect(WebGPU::fromAPI(computePipeline))->isValid();
}

WGPUBool wgpuDeviceIsValid(WGPUDevice device)
{
    return protect(WebGPU::fromAPI(device))->isValid();
}

WGPUBool wgpuPipelineLayoutIsValid(WGPUPipelineLayout pipelineLayout)
{
    return protect(WebGPU::fromAPI(pipelineLayout))->isValid();
}

WGPUBool wgpuQuerySetIsValid(WGPUQuerySet querySet)
{
    return protect(WebGPU::fromAPI(querySet))->isValid();
}

WGPUBool wgpuQueueIsValid(WGPUQueue queue)
{
    return protect(WebGPU::fromAPI(queue))->isValid();
}

WGPUBool wgpuRenderBundleEncoderIsValid(WGPURenderBundleEncoder renderBundleEncoder)
{
    return protect(WebGPU::fromAPI(renderBundleEncoder))->isValid();
}

WGPUBool wgpuRenderBundleIsValid(WGPURenderBundle renderBundle)
{
    return protect(WebGPU::fromAPI(renderBundle))->isValid();
}

WGPUBool wgpuRenderPassEncoderIsValid(WGPURenderPassEncoder renderPassEncoder)
{
    return protect(WebGPU::fromAPI(renderPassEncoder))->isValid();
}

WGPUBool wgpuRenderPipelineIsValid(WGPURenderPipeline renderPipeline)
{
    return protect(WebGPU::fromAPI(renderPipeline))->isValid();
}

WGPUBool wgpuSamplerIsValid(WGPUSampler sampler)
{
    return protect(WebGPU::fromAPI(sampler))->isValid();
}

WGPUBool wgpuShaderModuleIsValid(WGPUShaderModule shaderModule)
{
    return protect(WebGPU::fromAPI(shaderModule))->isValid();
}

WGPUBool wgpuTextureIsValid(WGPUTexture texture)
{
    return protect(WebGPU::fromAPI(texture))->isValid();
}

WGPUBool wgpuTextureViewIsValid(WGPUTextureView textureView)
{
    return protect(WebGPU::fromAPI(textureView))->isValid();
}
