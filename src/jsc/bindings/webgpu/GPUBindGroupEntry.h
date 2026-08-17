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

#include "GPUBufferBinding.h"
#include "GPUExternalTexture.h"
#include "GPUIntegralTypes.h"
#include "GPUSampler.h"
#include "GPUTexture.h"
#include "GPUTextureView.h"
#include "WebGPUBindGroupEntry.h"
#include <utility>

namespace WebCore {

using GPUBindingResource = Variant<
    Ref<GPUSampler>,
    Ref<GPUTexture>,
    Ref<GPUTextureView>,
    Ref<GPUBuffer>,
    GPUBufferBinding,
    Ref<GPUExternalTexture>
>;

inline WebGPU::BindingResource convertToBacking(const GPUBindingResource& bindingResource)
{
    return WTF::switchOn(bindingResource,
        [](const Ref<GPUSampler>& sampler) -> WebGPU::BindingResource {
            return sampler->backing();
        },
        [](const Ref<GPUTexture>& texture) -> WebGPU::BindingResource {
            return texture->backing();
        },
        [](const Ref<GPUTextureView>& textureView) -> WebGPU::BindingResource {
            return textureView->backing();
        },
        [](const Ref<GPUBuffer>& buffer) -> WebGPU::BindingResource {
            GPUBufferBinding bufferBinding {
                .buffer = buffer,
                .offset = 0,
                .size = std::nullopt
            };
            return bufferBinding.convertToBacking();
        },
        [](const GPUBufferBinding& bufferBinding) -> WebGPU::BindingResource {
            return bufferBinding.convertToBacking();
        },
        [](const Ref<GPUExternalTexture>& externalTexture) -> WebGPU::BindingResource {
            return externalTexture->backing();
        }
    );
}

struct GPUBindGroupEntry {
    WebGPU::BindGroupEntry convertToBacking() const
    {
        return {
            binding,
            WebCore::convertToBacking(resource),
        };
    }

    static bool equal(const GPUSampler& entry, const GPUBindingResource& otherEntry)
    {
        return WTF::switchOn(otherEntry,
            [&](const Ref<GPUSampler>& sampler) {
                return sampler.ptr() == &entry;
            },
            [](const Ref<GPUTexture>&) {
                return false;
            },
            [](const Ref<GPUTextureView>&) {
                return false;
            },
            [](const Ref<GPUBuffer>&) {
                return false;
            },
            [](const GPUBufferBinding&) {
                return false;
            },
            [](const Ref<GPUExternalTexture>&) {
                return false;
            }
        );
    }
    static bool equal(const GPUTexture& entry, const GPUBindingResource& otherEntry)
    {
        return WTF::switchOn(otherEntry,
            [](const Ref<GPUSampler>&) {
                return false;
            },
            [&](const Ref<GPUTexture>& texture) {
                return texture.ptr() == &entry;
            },
            [](const Ref<GPUTextureView>&) {
                return false;
            },
            [](const Ref<GPUBuffer>&) {
                return false;
            },
            [](const GPUBufferBinding&) {
                return false;
            },
            [](const Ref<GPUExternalTexture>&) {
                return false;
            }
        );
    }
    static bool equal(const GPUTextureView& entry, const GPUBindingResource& otherEntry)
    {
        return WTF::switchOn(otherEntry,
            [](const Ref<GPUSampler>&) {
                return false;
            },
            [](const Ref<GPUTexture>&) {
                return false;
            },
            [&](const Ref<GPUTextureView>& textureView) {
                return textureView.ptr() == &entry;
            },
            [](const Ref<GPUBuffer>&) {
                return false;
            },
            [](const GPUBufferBinding&) {
                return false;
            },
            [](const Ref<GPUExternalTexture>&) {
                return false;
            }
        );
    }
    static bool equalSizes(const std::optional<GPUSize64>& a, const std::optional<GPUSize64>& b)
    {
        return (!a && !b) || (a && b && *a == *b);
    }
    static bool equalSizes(const GPUSize64& a, const std::optional<GPUSize64>& b)
    {
        return (!a && !b) || (b && a == *b);
    }
    static bool equal(const GPUBufferBinding& entry, const GPUBindingResource& otherEntry)
    {
        return WTF::switchOn(otherEntry,
            [](const Ref<GPUSampler>&) {
                return false;
            },
            [](const Ref<GPUTexture>&) {
                return false;
            },
            [](const Ref<GPUTextureView>&) {
                return false;
            },
            [&](const Ref<GPUBuffer>& bufferBinding) {
                return bufferBinding.ptr() == entry.buffer.ptr() && !entry.offset && equalSizes(bufferBinding->size(), entry.size);
            },
            [&](const GPUBufferBinding& bufferBinding) {
                return bufferBinding.buffer.ptr() == entry.buffer.ptr() && bufferBinding.offset == entry.offset && equalSizes(bufferBinding.size, entry.size);
            },
            [](const Ref<GPUExternalTexture>&) {
                return false;
            }
        );
    }
    static bool equal(const GPUExternalTexture& entry, const GPUBindingResource& otherEntry)
    {
        return WTF::switchOn(otherEntry,
            [](const Ref<GPUSampler>&) {
                return false;
            },
            [](const Ref<GPUTexture>&) {
                return false;
            },
            [](const Ref<GPUTextureView>&) {
                return false;
            },
            [](const Ref<GPUBuffer>&) {
                return false;
            },
            [](const GPUBufferBinding&) {
                return false;
            },
            [&](const Ref<GPUExternalTexture>& externalTexture) {
                return externalTexture.ptr() == &entry;
            }
        );
    }
    static bool equal(const GPUBindGroupEntry& entry, const GPUBindGroupEntry& otherEntry)
    {
        if (entry.binding != otherEntry.binding)
            return false;

        return WTF::switchOn(entry.resource,
            [&](const Ref<GPUSampler>& sampler) {
                return equal(sampler, otherEntry.resource);
            },
            [&](const Ref<GPUTexture>& texture) {
                return equal(texture, otherEntry.resource);
            },
            [&](const Ref<GPUTextureView>& textureView) {
                return equal(textureView, otherEntry.resource);
            },
            [](const Ref<GPUBuffer>&) {
                return false;
            },
            [&](const GPUBufferBinding& bufferBinding) {
                return equal(bufferBinding, otherEntry.resource);
            },
            [&](const Ref<GPUExternalTexture>& externalTexture) {
                return equal(externalTexture, otherEntry.resource);
            }
        );
    }

    const Ref<GPUExternalTexture>* externalTexture() const
    {
        return std::get_if<Ref<GPUExternalTexture>>(&resource);
    }

    GPUIndex32 binding { 0 };
    GPUBindingResource resource;
};

}
