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

#include "GPUBufferBindingLayout.h"
#include "GPUExternalTextureBindingLayout.h"
#include "GPUIntegralTypes.h"
#include "GPUSamplerBindingLayout.h"
#include "GPUShaderStage.h"
#include "GPUStorageTextureBindingLayout.h"
#include "GPUTextureBindingLayout.h"
#include "WebGPUBindGroupLayoutEntry.h"
#include <optional>

namespace WebCore {

struct GPUBindGroupLayoutEntry {
    WebGPU::BindGroupLayoutEntry convertToBacking() const
    {
        return {
            binding,
            convertShaderStageFlagsToBacking(visibility),
            buffer ? std::optional { buffer->convertToBacking() } : std::nullopt,
            sampler ? std::optional { sampler->convertToBacking() } : std::nullopt,
            texture ? std::optional { texture->convertToBacking() } : std::nullopt,
            storageTexture ? std::optional { storageTexture->convertToBacking() } : std::nullopt,
            externalTexture ? std::optional { externalTexture->convertToBacking() } : std::nullopt,
        };
    }

    GPUIndex32 binding { 0 };
    GPUShaderStageFlags visibility { 0 };

    std::optional<GPUBufferBindingLayout> buffer;
    std::optional<GPUSamplerBindingLayout> sampler;
    std::optional<GPUTextureBindingLayout> texture;
    std::optional<GPUStorageTextureBindingLayout> storageTexture;
    std::optional<GPUExternalTextureBindingLayout> externalTexture;
};

}
