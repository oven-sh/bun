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

#include "GPUIntegralTypes.h"
#include "WebGPUShaderStage.h"
#include <cstdint>
#include <wtf/RefCounted.h>

namespace WebCore {

using GPUShaderStageFlags = uint32_t;
class GPUShaderStage : public RefCounted<GPUShaderStage> {
public:
    static constexpr GPUFlagsConstant VERTEX   = 0x1;
    static constexpr GPUFlagsConstant FRAGMENT = 0x2;
    static constexpr GPUFlagsConstant COMPUTE  = 0x4;
};

inline WebGPU::ShaderStageFlags convertShaderStageFlagsToBacking(GPUShaderStageFlags shaderStageFlags)
{
    WebGPU::ShaderStageFlags result;
    if (shaderStageFlags & GPUShaderStage::VERTEX)
        result.add(WebGPU::ShaderStage::Vertex);
    if (shaderStageFlags & GPUShaderStage::FRAGMENT)
        result.add(WebGPU::ShaderStage::Fragment);
    if (shaderStageFlags & GPUShaderStage::COMPUTE)
        result.add(WebGPU::ShaderStage::Compute);
    return result;
}

}
