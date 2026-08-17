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
#include "GPUQuerySet.h"
#include "GPURenderPassColorAttachment.h"
#include "GPURenderPassDepthStencilAttachment.h"
#include "GPURenderPassTimestampWrites.h"
#include "WebGPURenderPassDescriptor.h"
#include <optional>
#include <wtf/RefPtr.h>
#include <wtf/Vector.h>

namespace WebCore {

struct GPURenderPassDescriptor : public GPUObjectDescriptorBase {
    WebGPU::RenderPassDescriptor convertToBacking() const
    {
        return {
            { label },
            colorAttachments.map([](auto& colorAttachment) -> std::optional<WebGPU::RenderPassColorAttachment> {
                return colorAttachment ? std::optional { colorAttachment->convertToBacking() } : std::nullopt;
            }),
            depthStencilAttachment ? std::optional { depthStencilAttachment->convertToBacking() } : std::nullopt,
            occlusionQuerySet ? &occlusionQuerySet->backing() : nullptr,
            timestampWrites ? std::optional { timestampWrites->convertToBacking() } : std::nullopt,
            maxDrawCount,
        };
    }

    Vector<std::optional<GPURenderPassColorAttachment>> colorAttachments;
    std::optional<GPURenderPassDepthStencilAttachment> depthStencilAttachment;
    RefPtr<GPUQuerySet> occlusionQuerySet;
    std::optional<GPURenderPassTimestampWrites> timestampWrites;
    GPUSize64 maxDrawCount { 50000000 };
};

}
