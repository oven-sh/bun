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

#include "WebGPUVertexFormat.h"
#include <cstdint>

namespace WebCore {

enum class GPUVertexFormat : uint8_t {
    Uint8,
    Uint8x2,
    Uint8x4,
    Sint8,
    Sint8x2,
    Sint8x4,
    Unorm8,
    Unorm8x2,
    Unorm8x4,
    Snorm8,
    Snorm8x2,
    Snorm8x4,
    Uint16,
    Uint16x2,
    Uint16x4,
    Sint16,
    Sint16x2,
    Sint16x4,
    Unorm16,
    Unorm16x2,
    Unorm16x4,
    Snorm16,
    Snorm16x2,
    Snorm16x4,
    Float16,
    Float16x2,
    Float16x4,
    Float32,
    Float32x2,
    Float32x3,
    Float32x4,
    Uint32,
    Uint32x2,
    Uint32x3,
    Uint32x4,
    Sint32,
    Sint32x2,
    Sint32x3,
    Sint32x4,
    Unorm1010102,
    Unorm8x4Bgra,
};

inline WebGPU::VertexFormat convertToBacking(GPUVertexFormat vertexFormat)
{
    switch (vertexFormat) {
    case GPUVertexFormat::Uint8:
        return WebGPU::VertexFormat::Uint8;
    case GPUVertexFormat::Uint8x2:
        return WebGPU::VertexFormat::Uint8x2;
    case GPUVertexFormat::Uint8x4:
        return WebGPU::VertexFormat::Uint8x4;
    case GPUVertexFormat::Sint8:
        return WebGPU::VertexFormat::Sint8;
    case GPUVertexFormat::Sint8x2:
        return WebGPU::VertexFormat::Sint8x2;
    case GPUVertexFormat::Sint8x4:
        return WebGPU::VertexFormat::Sint8x4;
    case GPUVertexFormat::Unorm8:
        return WebGPU::VertexFormat::Unorm8;
    case GPUVertexFormat::Unorm8x2:
        return WebGPU::VertexFormat::Unorm8x2;
    case GPUVertexFormat::Unorm8x4:
        return WebGPU::VertexFormat::Unorm8x4;
    case GPUVertexFormat::Snorm8:
        return WebGPU::VertexFormat::Snorm8;
    case GPUVertexFormat::Snorm8x2:
        return WebGPU::VertexFormat::Snorm8x2;
    case GPUVertexFormat::Snorm8x4:
        return WebGPU::VertexFormat::Snorm8x4;
    case GPUVertexFormat::Uint16:
        return WebGPU::VertexFormat::Uint16;
    case GPUVertexFormat::Uint16x2:
        return WebGPU::VertexFormat::Uint16x2;
    case GPUVertexFormat::Uint16x4:
        return WebGPU::VertexFormat::Uint16x4;
    case GPUVertexFormat::Sint16:
        return WebGPU::VertexFormat::Sint16;
    case GPUVertexFormat::Sint16x2:
        return WebGPU::VertexFormat::Sint16x2;
    case GPUVertexFormat::Sint16x4:
        return WebGPU::VertexFormat::Sint16x4;
    case GPUVertexFormat::Unorm16:
        return WebGPU::VertexFormat::Unorm16;
    case GPUVertexFormat::Unorm16x2:
        return WebGPU::VertexFormat::Unorm16x2;
    case GPUVertexFormat::Unorm16x4:
        return WebGPU::VertexFormat::Unorm16x4;
    case GPUVertexFormat::Snorm16:
        return WebGPU::VertexFormat::Snorm16;
    case GPUVertexFormat::Snorm16x2:
        return WebGPU::VertexFormat::Snorm16x2;
    case GPUVertexFormat::Snorm16x4:
        return WebGPU::VertexFormat::Snorm16x4;
    case GPUVertexFormat::Float16:
        return WebGPU::VertexFormat::Float16;
    case GPUVertexFormat::Float16x2:
        return WebGPU::VertexFormat::Float16x2;
    case GPUVertexFormat::Float16x4:
        return WebGPU::VertexFormat::Float16x4;
    case GPUVertexFormat::Float32:
        return WebGPU::VertexFormat::Float32;
    case GPUVertexFormat::Float32x2:
        return WebGPU::VertexFormat::Float32x2;
    case GPUVertexFormat::Float32x3:
        return WebGPU::VertexFormat::Float32x3;
    case GPUVertexFormat::Float32x4:
        return WebGPU::VertexFormat::Float32x4;
    case GPUVertexFormat::Uint32:
        return WebGPU::VertexFormat::Uint32;
    case GPUVertexFormat::Uint32x2:
        return WebGPU::VertexFormat::Uint32x2;
    case GPUVertexFormat::Uint32x3:
        return WebGPU::VertexFormat::Uint32x3;
    case GPUVertexFormat::Uint32x4:
        return WebGPU::VertexFormat::Uint32x4;
    case GPUVertexFormat::Sint32:
        return WebGPU::VertexFormat::Sint32;
    case GPUVertexFormat::Sint32x2:
        return WebGPU::VertexFormat::Sint32x2;
    case GPUVertexFormat::Sint32x3:
        return WebGPU::VertexFormat::Sint32x3;
    case GPUVertexFormat::Sint32x4:
        return WebGPU::VertexFormat::Sint32x4;
    case GPUVertexFormat::Unorm1010102:
        return WebGPU::VertexFormat::Unorm1010102;
    case GPUVertexFormat::Unorm8x4Bgra:
        return WebGPU::VertexFormat::Unorm8x4Bgra;
    }

    RELEASE_ASSERT_NOT_REACHED();
}

}
