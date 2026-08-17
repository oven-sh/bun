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
#include "GPURenderPipeline.h"

#include "GPUBindGroupLayout.h"
#include "GPUDevice.h"
#include "InspectorInstrumentation.h"
#include <wtf/Locker.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

Lock GPURenderPipeline::s_instancesLock;

Ref<GPURenderPipeline> GPURenderPipeline::create(Ref<WebGPU::RenderPipeline>&& backing, uint64_t uniqueId, GPUDevice* device, const String& vertexShaderSource, const String& fragmentShaderSource, bool sharesVertexFragmentShader)
{
    Ref result = adoptRef(*new GPURenderPipeline(WTF::move(backing), uniqueId, device, vertexShaderSource, fragmentShaderSource, sharesVertexFragmentShader));

    if (device)
        InspectorInstrumentation::didCreateWebGPURenderPipeline(*device, result);

    return result;
}

HashMap<GPURenderPipeline*, GPUDevice*>& GPURenderPipeline::instances()
{
    static NeverDestroyed<HashMap<GPURenderPipeline*, GPUDevice*>> instances;
    return instances;
}

Lock& GPURenderPipeline::instancesLock()
{
    return s_instancesLock;
}

void GPURenderPipeline::willDestroyDevice(GPUDevice& device)
{
    Locker locker { instancesLock() };
    for (auto& registeredDevice : instances().values()) {
        if (registeredDevice == &device) {
            // Don't remove any GPURenderPipeline from the instances list, as they may still exist.
            // Only remove the association with a GPUDevice.
            registeredDevice = nullptr;
        }
    }
}

GPURenderPipeline::GPURenderPipeline(Ref<WebGPU::RenderPipeline>&& backing, uint64_t uniqueId, GPUDevice* device, const String& vertexShaderSource, const String& fragmentShaderSource, bool sharesVertexFragmentShader)
    : m_backing(WTF::move(backing))
    , m_uniqueId(uniqueId)
    , m_vertexShaderSource(vertexShaderSource)
    , m_fragmentShaderSource(fragmentShaderSource)
    , m_sharesVertexFragmentShader(sharesVertexFragmentShader)
{
    if (device) {
        m_device = *device;

        Locker locker { instancesLock() };
        instances().add(this, device);
    }
}

GPURenderPipeline::~GPURenderPipeline()
{
    InspectorInstrumentation::willDestroyWebGPURenderPipeline(*this);

    Locker locker { instancesLock() };
    instances().remove(this);
}

bool GPURenderPipeline::hasActiveInspectorCanvasCallTracer() const
{
    RefPtr device = m_device;
    return device && device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPURenderPipeline::device() const
{
    return m_device;
}

String GPURenderPipeline::label() const
{
    return m_backing->label();
}

void GPURenderPipeline::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

Ref<GPUBindGroupLayout> GPURenderPipeline::getBindGroupLayout(uint32_t index)
{
    // "A new GPUBindGroupLayout wrapper is returned each time"
    return GPUBindGroupLayout::create(m_backing->getBindGroupLayout(index), m_uniqueId, protect(m_device));
}

}
