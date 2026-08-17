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

#include "GPUAddressMode.h"
#include "GPUCompareFunction.h"
#include "GPUFilterMode.h"
#include "GPUMipmapFilterMode.h"
#include "GPUObjectDescriptorBase.h"
#include "WebGPUSamplerDescriptor.h"
#include <cstdint>
#include <optional>

namespace WebCore {

struct GPUSamplerDescriptor : public GPUObjectDescriptorBase {
    WebGPU::SamplerDescriptor convertToBacking() const
    {
        return {
            { label },
            WebCore::convertToBacking(addressModeU),
            WebCore::convertToBacking(addressModeV),
            WebCore::convertToBacking(addressModeW),
            WebCore::convertToBacking(magFilter),
            WebCore::convertToBacking(minFilter),
            WebCore::convertToBacking(mipmapFilter),
            lodMinClamp,
            lodMaxClamp,
            compare ? std::optional { WebCore::convertToBacking(*compare) } : std::nullopt,
            maxAnisotropy,
        };
    }

    GPUAddressMode addressModeU { GPUAddressMode::ClampToEdge };
    GPUAddressMode addressModeV { GPUAddressMode::ClampToEdge };
    GPUAddressMode addressModeW { GPUAddressMode::ClampToEdge };
    GPUFilterMode magFilter { GPUFilterMode::Nearest };
    GPUFilterMode minFilter { GPUFilterMode::Nearest };
    GPUMipmapFilterMode mipmapFilter { GPUMipmapFilterMode::Nearest };
    float lodMinClamp { 0 };
    float lodMaxClamp { 32 };
    std::optional<GPUCompareFunction> compare;
    uint16_t maxAnisotropy { 1 };
};

}
