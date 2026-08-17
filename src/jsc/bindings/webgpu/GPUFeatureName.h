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

#include "WebGPUFeatureName.h"
#include <cstdint>

namespace WebCore {

enum class GPUFeatureName : uint8_t {
    DepthClipControl,
    Depth32floatStencil8,
    TextureCompressionBc,
    TextureCompressionBcSliced3d,
    TextureCompressionEtc2,
    TextureCompressionAstc,
    TextureCompressionAstcSliced3d,
    TimestampQuery,
    IndirectFirstInstance,
    ShaderF16,
    Rg11b10ufloatRenderable,
    Bgra8unormStorage,
    Float32Filterable,
    Float32Blendable,
    ClipDistances,
    DualSourceBlending,
    Float16Renderable,
    Float32Renderable,
    CoreFeaturesAndLimits,
    TextureFormatsTier1,
    TextureFormatsTier2,
    PrimitiveIndex,
    Subgroups,
};

inline WebGPU::FeatureName convertToBacking(GPUFeatureName featureName)
{
    switch (featureName) {
    case GPUFeatureName::DepthClipControl:
        return WebGPU::FeatureName::DepthClipControl;
    case GPUFeatureName::Depth32floatStencil8:
        return WebGPU::FeatureName::Depth32floatStencil8;
    case GPUFeatureName::TextureCompressionBc:
        return WebGPU::FeatureName::TextureCompressionBc;
    case GPUFeatureName::TextureCompressionBcSliced3d:
        return WebGPU::FeatureName::TextureCompressionBcSliced3d;
    case GPUFeatureName::TextureCompressionEtc2:
        return WebGPU::FeatureName::TextureCompressionEtc2;
    case GPUFeatureName::TextureCompressionAstc:
        return WebGPU::FeatureName::TextureCompressionAstc;
    case GPUFeatureName::TextureCompressionAstcSliced3d:
        return WebGPU::FeatureName::TextureCompressionAstcSliced3d;
    case GPUFeatureName::TimestampQuery:
        return WebGPU::FeatureName::TimestampQuery;
    case GPUFeatureName::IndirectFirstInstance:
        return WebGPU::FeatureName::IndirectFirstInstance;
    case GPUFeatureName::Bgra8unormStorage:
        return WebGPU::FeatureName::Bgra8unormStorage;
    case GPUFeatureName::ShaderF16:
        return WebGPU::FeatureName::ShaderF16;
    case GPUFeatureName::Rg11b10ufloatRenderable:
        return WebGPU::FeatureName::Rg11b10ufloatRenderable;
    case GPUFeatureName::Float32Filterable:
        return WebGPU::FeatureName::Float32Filterable;
    case GPUFeatureName::Float32Blendable:
        return WebGPU::FeatureName::Float32Blendable;
    case GPUFeatureName::Float16Renderable:
        return WebGPU::FeatureName::Float16Renderable;
    case GPUFeatureName::Float32Renderable:
        return WebGPU::FeatureName::Float32Renderable;
    case GPUFeatureName::DualSourceBlending:
        return WebGPU::FeatureName::DualSourceBlending;
    case GPUFeatureName::ClipDistances:
        return WebGPU::FeatureName::ClipDistances;
    case GPUFeatureName::CoreFeaturesAndLimits:
        return WebGPU::FeatureName::CoreFeaturesAndLimits;
    case GPUFeatureName::TextureFormatsTier1:
        return WebGPU::FeatureName::TextureFormatsTier1;
    case GPUFeatureName::TextureFormatsTier2:
        return WebGPU::FeatureName::TextureFormatsTier2;
    case GPUFeatureName::PrimitiveIndex:
        return WebGPU::FeatureName::PrimitiveIndex;
    case GPUFeatureName::Subgroups:
        return WebGPU::FeatureName::Subgroups;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

}
