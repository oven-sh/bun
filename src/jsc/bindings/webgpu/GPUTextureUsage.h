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
#include "WebGPUTextureUsage.h"
#include <cstdint>
#include <wtf/RefCounted.h>

namespace WebCore {

using GPUTextureUsageFlags = uint32_t;
class GPUTextureUsage : public RefCounted<GPUTextureUsage> {
public:
    static constexpr GPUFlagsConstant COPY_SRC             = 0x01;
    static constexpr GPUFlagsConstant COPY_DST             = 0x02;
    static constexpr GPUFlagsConstant TEXTURE_BINDING      = 0x04;
    static constexpr GPUFlagsConstant STORAGE_BINDING      = 0x08;
    static constexpr GPUFlagsConstant RENDER_ATTACHMENT    = 0x10;
    static constexpr GPUFlagsConstant TRANSIENT_ATTACHMENT = 0x20;
};

inline WebGPU::TextureUsageFlags convertTextureUsageFlagsToBacking(GPUTextureUsageFlags textureUsageFlags)
{
    WebGPU::TextureUsageFlags result;
    if (textureUsageFlags & GPUTextureUsage::COPY_SRC)
        result.add(WebGPU::TextureUsage::CopySource);
    if (textureUsageFlags & GPUTextureUsage::COPY_DST)
        result.add(WebGPU::TextureUsage::CopyDestination);
    if (textureUsageFlags & GPUTextureUsage::TEXTURE_BINDING)
        result.add(WebGPU::TextureUsage::TextureBinding);
    if (textureUsageFlags & GPUTextureUsage::STORAGE_BINDING)
        result.add(WebGPU::TextureUsage::StorageBinding);
    if (textureUsageFlags & GPUTextureUsage::RENDER_ATTACHMENT)
        result.add(WebGPU::TextureUsage::RenderAttachment);
    if (textureUsageFlags & GPUTextureUsage::TRANSIENT_ATTACHMENT)
        result.add(WebGPU::TextureUsage::Transient);
    return result;
}

}
