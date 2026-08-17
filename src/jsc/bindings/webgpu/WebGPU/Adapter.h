/*
 * Copyright (c) 2021-2022 Apple Inc. All rights reserved.
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

#pragma once

#import "HardwareCapabilities.h"
#import <Metal/Metal.h>
#import <bmalloc/CompactAllocationMode.h>
#import <wtf/Assertions.h>
#import <wtf/CompletionHandler.h>
#import <wtf/FastMalloc.h>
#import <wtf/HashSet.h>
#import <wtf/Ref.h>
#import <wtf/RefCounted.h>
#import <wtf/RefPtr.h>
#import <wtf/TZoneMalloc.h>
#import <wtf/ThreadSafeWeakPtr.h>
#import <wtf/WeakPtr.h>

struct WGPUAdapterImpl {
};

namespace WebGPU {

class Device;
class Instance;

// https://gpuweb.github.io/gpuweb/#gpuadapter
class Adapter : public WGPUAdapterImpl, public RefCounted<Adapter> {
    WTF_MAKE_TZONE_ALLOCATED(Adapter);
public:
    static Ref<Adapter> create(id<MTLDevice> device, Instance& instance, bool xrCompatible, HardwareCapabilities&& capabilities)
    {
        return adoptRef(*new Adapter(device, instance, xrCompatible, WTF::move(capabilities)));
    }
    static Ref<Adapter> createInvalid(Instance& instance)
    {
        return adoptRef(*new Adapter(instance));
    }

    ~Adapter();

    size_t enumerateFeatures(WGPUFeatureName* features);
    bool NODELETE getLimits(WGPUSupportedLimits&);
    void getProperties(WGPUAdapterProperties&);
    bool hasFeature(WGPUFeatureName);
    void requestDevice(const WGPUDeviceDescriptor&, CompletionHandler<void(WGPURequestDeviceStatus, Ref<Device>&&, String&&)>&& callback);

    bool isValid() const { return m_device; }
    void makeInvalid() { m_device = nil; }
    bool NODELETE isXRCompatible() const;

    RefPtr<Instance> instance() const { return m_instance.get(); }
    ThreadSafeWeakPtr<Instance> weakInstance() const { return m_instance; }

private:
    Adapter(id<MTLDevice>, Instance&, bool xrCompatible, HardwareCapabilities&&);
    Adapter(Instance&);

    id<MTLDevice> m_device { nil };
    const ThreadSafeWeakPtr<Instance> m_instance;

    const HardwareCapabilities m_capabilities { };
    bool m_deviceRequested { false };
    bool m_xrCompatible { false };
};

} // namespace WebGPU
