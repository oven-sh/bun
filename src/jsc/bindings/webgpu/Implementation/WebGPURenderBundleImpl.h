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

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUPtr.h"
#include "WebGPURenderBundle.h"
#include <WebGPU/WebGPU.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class RenderBundleImpl final : public RenderBundle {
    WTF_MAKE_TZONE_ALLOCATED(RenderBundleImpl);
public:
    static Ref<RenderBundleImpl> create(WebGPUPtr<WGPURenderBundle>&& renderBundle, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new RenderBundleImpl(WTF::move(renderBundle), convertToBackingContext));
    }

    virtual ~RenderBundleImpl();

private:
    friend class DowncastConvertToBackingContext;

    RenderBundleImpl(WebGPUPtr<WGPURenderBundle>&&, ConvertToBackingContext&);

    RenderBundleImpl(const RenderBundleImpl&) = delete;
    RenderBundleImpl(RenderBundleImpl&&) = delete;
    RenderBundleImpl& operator=(const RenderBundleImpl&) = delete;
    RenderBundleImpl& operator=(RenderBundleImpl&&) = delete;

    WGPURenderBundle backing() const { return m_backing.get(); }
    bool isRenderBundleImpl() const final { return true; }

    void setLabelInternal(const String&) final;

    WebGPUPtr<WGPURenderBundle> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::RenderBundleImpl)
    static bool isType(const WebCore::WebGPU::RenderBundle& bundle) { return bundle.isRenderBundleImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
