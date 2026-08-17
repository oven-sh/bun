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
#include "WebGPUShaderModule.h"
#include <WebGPU/WebGPU.h>
#include <wtf/TZoneMalloc.h>

namespace WebCore::WebGPU {

class ConvertToBackingContext;

class ShaderModuleImpl final : public ShaderModule {
    WTF_MAKE_TZONE_ALLOCATED(ShaderModuleImpl);
public:
    static Ref<ShaderModuleImpl> create(WebGPUPtr<WGPUShaderModule>&& shaderModule, ConvertToBackingContext& convertToBackingContext)
    {
        return adoptRef(*new ShaderModuleImpl(WTF::move(shaderModule), convertToBackingContext));
    }

    virtual ~ShaderModuleImpl();

private:
    friend class DowncastConvertToBackingContext;

    ShaderModuleImpl(WebGPUPtr<WGPUShaderModule>&&, ConvertToBackingContext&);

    ShaderModuleImpl(const ShaderModuleImpl&) = delete;
    ShaderModuleImpl(ShaderModuleImpl&&) = delete;
    ShaderModuleImpl& operator=(const ShaderModuleImpl&) = delete;
    ShaderModuleImpl& operator=(ShaderModuleImpl&&) = delete;

    WGPUShaderModule backing() const { return m_backing.get(); }
    bool isShaderModuleImpl() const final { return true; }

    void compilationInfo(CompletionHandler<void(Ref<CompilationInfo>&&)>&&) final;

    void setLabelInternal(const String&) final;

    WebGPUPtr<WGPUShaderModule> m_backing;
    const Ref<ConvertToBackingContext> m_convertToBackingContext;
};

} // namespace WebCore::WebGPU

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::WebGPU::ShaderModuleImpl)
    static bool isType(const WebCore::WebGPU::ShaderModule& module) { return module.isShaderModuleImpl(); }
SPECIALIZE_TYPE_TRAITS_END()

#endif // HAVE(WEBGPU_IMPLEMENTATION)
