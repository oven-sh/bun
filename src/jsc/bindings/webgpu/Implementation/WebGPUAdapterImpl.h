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

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUAdapter.h"
#include "WebGPUPtr.h"
#include <WebGPU/WebGPU.h>
#include <wtf/Deque.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class AdapterImpl final : public Adapter {
    WTF_MAKE_TZONE_ALLOCATED(AdapterImpl);
public:
    static Ref<AdapterImpl> create(WebGPUPtr<WGPUAdapter>&& adapter, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new AdapterImpl(WTF::move(adapter), convertToBackingContext));
    }

    virtual ~AdapterImpl();

private:
    friend class DowncastConvertToBackingContext;

    AdapterImpl(WebGPUPtr<WGPUAdapter>&&, ConvertToBackingContext&);

    AdapterImpl(const AdapterImpl&) = delete;
    AdapterImpl(AdapterImpl&&) = delete;
    AdapterImpl& operator=(const AdapterImpl&) = delete;
    AdapterImpl& operator=(AdapterImpl&&) = delete;

    WGPUAdapter backing() const { return m_backing.get(); }
    bool isAdapterImpl() const final { return true; }
    bool xrCompatible() final;

    void requestDevice(const DeviceDescriptor&, CompletionHandler<void(RefPtr<Device>&&)>&&) final;

    WebGPUPtr<WGPUAdapter> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::AdapterImpl)
    static bool isType(const WebCore::WebGPU::Adapter& adapter) { return adapter.isAdapterImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
