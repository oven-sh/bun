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
#include "GPULoadOp.h"
#include "GPUStoreOp.h"
#include "GPUTexture.h"
#include "GPUTextureView.h"
#include "WebGPURenderPassDepthStencilAttachment.h"
#include <wtf/RefPtr.h>

namespace WebCore {

using GPURenderPassDepthAttachmentView = Variant<Ref<GPUTexture>, Ref<GPUTextureView>>;

struct GPURenderPassDepthStencilAttachment {
    WebGPU::RenderPassDepthStencilAttachment convertToBacking() const
    {
        return {
            WTF::switchOn(view,
                [](const Ref<GPUTexture>& texture) -> WebGPU::RenderPassDepthAttachmentView {
                    return texture->backing();
                },
                [](const Ref<GPUTextureView>& view) -> WebGPU::RenderPassDepthAttachmentView {
                    return view->backing();
                }
            ),
            depthClearValue.value_or(-1.f),
            depthLoadOp ? std::optional { WebCore::convertToBacking(*depthLoadOp) } : std::nullopt,
            depthStoreOp ? std::optional { WebCore::convertToBacking(*depthStoreOp) } : std::nullopt,
            depthReadOnly,
            stencilClearValue,
            stencilLoadOp ? std::optional { WebCore::convertToBacking(*stencilLoadOp) } : std::nullopt,
            stencilStoreOp ? std::optional { WebCore::convertToBacking(*stencilStoreOp) } : std::nullopt,
            stencilReadOnly,
        };
    }

    GPURenderPassDepthAttachmentView view;

    std::optional<float> depthClearValue;
    std::optional<GPULoadOp> depthLoadOp;
    std::optional<GPUStoreOp> depthStoreOp;
    bool depthReadOnly { false };

    GPUStencilValue stencilClearValue { 0 };
    std::optional<GPULoadOp> stencilLoadOp;
    std::optional<GPUStoreOp> stencilStoreOp;
    bool stencilReadOnly { false };
};

}
