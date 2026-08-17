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
#include "GPUComputePipeline.h"

#include "GPUBindGroupLayout.h"
#include "GPUDevice.h"
#include "InspectorInstrumentation.h"
#include <wtf/Locker.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

Lock GPUComputePipeline::s_instancesLock;

Ref<GPUComputePipeline> GPUComputePipeline::create(Ref<WebGPU::ComputePipeline>&& backing, uint64_t uniqueId, GPUDevice* device, const String& shaderSource)
{
    Ref result = adoptRef(*new GPUComputePipeline(WTF::move(backing), uniqueId, device, shaderSource));

    if (device)
        InspectorInstrumentation::didCreateWebGPUComputePipeline(*device, result);

    return result;
}

HashMap<GPUComputePipeline*, GPUDevice*>& GPUComputePipeline::instances()
{
    static NeverDestroyed<HashMap<GPUComputePipeline*, GPUDevice*>> instances;
    return instances;
}

Lock& GPUComputePipeline::instancesLock()
{
    return s_instancesLock;
}

void GPUComputePipeline::willDestroyDevice(GPUDevice& device)
{
    Locker locker { instancesLock() };
    for (auto& registeredDevice : instances().values()) {
        if (registeredDevice == &device) {
            // Don't remove any GPUComputePipeline from the instances list, as they may still exist.
            // Only remove the association with a GPUDevice.
            registeredDevice = nullptr;
        }
    }
}

GPUComputePipeline::GPUComputePipeline(Ref<WebGPU::ComputePipeline>&& backing, uint64_t uniqueId, GPUDevice* device, const String& shaderSource)
    : m_backing(WTF::move(backing))
    , m_uniqueId(uniqueId)
    , m_shaderSource(shaderSource)
{
    if (device) {
        m_device = *device;

        Locker locker { instancesLock() };
        instances().add(this, device);
    }
}

GPUComputePipeline::~GPUComputePipeline()
{
    InspectorInstrumentation::willDestroyWebGPUComputePipeline(*this);

    Locker locker { instancesLock() };
    instances().remove(this);
}

bool GPUComputePipeline::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPUComputePipeline::device() const
{
    return m_device;
}

String GPUComputePipeline::label() const
{
    return m_backing->label();
}

void GPUComputePipeline::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

Ref<GPUBindGroupLayout> GPUComputePipeline::getBindGroupLayout(uint32_t index)
{
    // "A new GPUBindGroupLayout wrapper is returned each time"
    return GPUBindGroupLayout::create(m_backing->getBindGroupLayout(index), m_uniqueId, protect(m_device));
}

} // namespace WebCore
