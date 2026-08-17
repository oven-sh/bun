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
#include "WebGPURenderPipeline.h"
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

class GPURenderPipeline : public RefCountedAndCanMakeWeakPtr<GPURenderPipeline> {
public:
    static Ref<GPURenderPipeline> create(Ref<WebGPU::RenderPipeline>&&, uint64_t uniqueId, GPUDevice*, const String& vertexShaderSource, const String& fragmentShaderSource, bool sharesVertexFragmentShader);

    ~GPURenderPipeline();

    static HashMap<GPURenderPipeline*, GPUDevice*>& NODELETE instances() WTF_REQUIRES_LOCK(instancesLock());
    static Lock& NODELETE instancesLock() WTF_RETURNS_LOCK(s_instancesLock);
    static void willDestroyDevice(GPUDevice&);

    String NODELETE label() const;
    void setLabel(String&&);

    Ref<GPUBindGroupLayout> getBindGroupLayout(uint32_t index);

    WebGPU::RenderPipeline& backing() { return m_backing; }
    const WebGPU::RenderPipeline& backing() const { return m_backing; }

    GPUDevice* device() const;
    const String& vertexShaderSource() const { return m_vertexShaderSource; }
    const String& fragmentShaderSource() const { return m_fragmentShaderSource; }
    bool sharesVertexFragmentShader() const { return m_sharesVertexFragmentShader; }

    bool hasActiveInspectorCanvasCallTracer() const;

private:
    GPURenderPipeline(Ref<WebGPU::RenderPipeline>&&, uint64_t uniqueId, GPUDevice*, const String& vertexShaderSource, const String& fragmentShaderSource, bool sharesVertexFragmentShader);

    static Lock s_instancesLock;

    const Ref<WebGPU::RenderPipeline> m_backing;
    const uint64_t m_uniqueId;
    WeakPtr<GPUDevice, WeakPtrImplWithEventTargetData> m_device;
    String m_vertexShaderSource;
    String m_fragmentShaderSource;
    const bool m_sharesVertexFragmentShader;
};

}
