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

#pragma once

#include "EventTarget.h"
#include "GPUQuerySetDescriptor.h"
#include "GPUQueryType.h"
#include "WebGPUQuerySet.h"
#include <wtf/Ref.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUDevice;

class GPUQuerySet : public RefCountedAndCanMakeWeakPtr<GPUQuerySet> {
public:
    static Ref<GPUQuerySet> create(Ref<WebGPU::QuerySet>&& backing, const GPUQuerySetDescriptor& descriptor, GPUDevice& device)
    {
        return adoptRef(*new GPUQuerySet(WTF::move(backing), descriptor, device));
    }

    String NODELETE label() const;
    void setLabel(String&&);

    void destroy();

    WebGPU::QuerySet& backing() { return m_backing; }
    const WebGPU::QuerySet& backing() const { return m_backing; }

    GPUQueryType NODELETE type() const;
    GPUSize32Out NODELETE count() const;

    GPUDevice* device() const;

    bool hasActiveInspectorCanvasCallTracer() const;

private:
    GPUQuerySet(Ref<WebGPU::QuerySet>&&, const GPUQuerySetDescriptor&, GPUDevice&);

    const Ref<WebGPU::QuerySet> m_backing;
    const GPUQuerySetDescriptor m_descriptor;
    WeakPtr<GPUDevice, WeakPtrImplWithEventTargetData> m_device;
};

}
