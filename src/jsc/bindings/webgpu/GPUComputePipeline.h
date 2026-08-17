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

#pragma once

#include "GPUBindGroupLayout.h"
#include "WebGPUComputePipeline.h"
#include <cstdint>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUDevice;
class WeakPtrImplWithEventTargetData;

class GPUComputePipeline : public RefCountedAndCanMakeWeakPtr<GPUComputePipeline> {
public:
    static Ref<GPUComputePipeline> create(Ref<WebGPU::ComputePipeline>&&, uint64_t uniqueId, GPUDevice*, const String& shaderSource);

    ~GPUComputePipeline();

    static HashMap<GPUComputePipeline*, GPUDevice*>& NODELETE instances() WTF_REQUIRES_LOCK(instancesLock());
    static Lock& NODELETE instancesLock() WTF_RETURNS_LOCK(s_instancesLock);
    static void willDestroyDevice(GPUDevice&);

    String NODELETE label() const;
    void setLabel(String&&);

    Ref<GPUBindGroupLayout> getBindGroupLayout(uint32_t index);

    WebGPU::ComputePipeline& backing() { return m_backing; }
    const WebGPU::ComputePipeline& backing() const { return m_backing; }

    GPUDevice* device() const;
    const String& shaderSource() const { return m_shaderSource; }

    bool hasActiveInspectorCanvasCallTracer() const;

private:
    GPUComputePipeline(Ref<WebGPU::ComputePipeline>&&, uint64_t uniqueId, GPUDevice*, const String& shaderSource);

    static Lock s_instancesLock;

    const Ref<WebGPU::ComputePipeline> m_backing;
    const uint64_t m_uniqueId;
    WeakPtr<GPUDevice, WeakPtrImplWithEventTargetData> m_device;
    String m_shaderSource;
};

}
