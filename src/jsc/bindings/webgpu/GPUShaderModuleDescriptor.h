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

#include "GPUObjectDescriptorBase.h"
#include "GPUShaderModuleCompilationHint.h"
#include "WebGPUShaderModuleDescriptor.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

struct GPUShaderModuleDescriptor : public GPUObjectDescriptorBase {
    WebGPU::ShaderModuleDescriptor convertToBacking(const Ref<GPUPipelineLayout>& autoLayout) const
    {
        return {
            { label },
            code,
            // FIXME: Handle the sourceMap.
            hints.map([&autoLayout](auto& hint) {
                return KeyValuePair<String, WebGPU::ShaderModuleCompilationHint>(hint.key, hint.value.convertToBacking(autoLayout));
            }),
        };
    }

    String code;
    JSC::Strong<JSC::JSObject> sourceMap;
    Vector<KeyValuePair<String, GPUShaderModuleCompilationHint>> hints;
};

}
