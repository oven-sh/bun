/*
 * Copyright (c) 2025 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#import "Texture.h"
#import "TextureView.h"

#import <WebGPU/WebGPU.h>
#import <wtf/Ref.h>

namespace WebGPU {

class TextureOrTextureView {
public:
    TextureOrTextureView(Texture& texture)
        : m_texture(&texture)
    {
    }
    TextureOrTextureView(TextureView& view)
        : m_view(&view)
    {
    }
    TextureOrTextureView(Texture* texture)
        : m_texture(texture)
    {
    }
    TextureOrTextureView(TextureView* view)
        : m_view(view)
    {
    }

#define TEXTURE_OR_VIEW_INVOKE(x) return m_view ? protect(m_view)->x() : protect(m_texture)->x()
#define TEXTURE_OR_VIEW_HELPER(x) auto x() const { TEXTURE_OR_VIEW_INVOKE(x); }
#define TEXTURE_OR_VIEW_HELPER_NONCONST(x) auto x() { TEXTURE_OR_VIEW_INVOKE(x); }
#define TEXTURE_OR_VIEW_HELPER_REF(x) const auto& x() const { TEXTURE_OR_VIEW_INVOKE(x); }

    TEXTURE_OR_VIEW_HELPER(width)
    TEXTURE_OR_VIEW_HELPER(height)
    TEXTURE_OR_VIEW_HELPER(is2DTexture)
    TEXTURE_OR_VIEW_HELPER(is2DArrayTexture)
    TEXTURE_OR_VIEW_HELPER(is3DTexture)
    TEXTURE_OR_VIEW_HELPER(sampleCount)
    TEXTURE_OR_VIEW_HELPER(format)
    TEXTURE_OR_VIEW_HELPER(isDestroyed)
    TEXTURE_OR_VIEW_HELPER(depthOrArrayLayers)
    TEXTURE_OR_VIEW_HELPER(baseArrayLayer)
    TEXTURE_OR_VIEW_HELPER(baseMipLevel)
    TEXTURE_OR_VIEW_HELPER(parentTexture)
    TEXTURE_OR_VIEW_HELPER(parentRelativeSlice)
    TEXTURE_OR_VIEW_HELPER(previouslyCleared)
    TEXTURE_OR_VIEW_HELPER_NONCONST(setPreviouslyCleared)
    TEXTURE_OR_VIEW_HELPER(texture)
    TEXTURE_OR_VIEW_HELPER(isValid)
    TEXTURE_OR_VIEW_HELPER(usage)
    TEXTURE_OR_VIEW_HELPER(mipLevelCount)
    TEXTURE_OR_VIEW_HELPER(arrayLayerCount)

    TEXTURE_OR_VIEW_HELPER_REF(apiParentTexture)
    TEXTURE_OR_VIEW_HELPER_REF(device)

    void setCommandEncoder(CommandEncoder& encoder)
    {
        m_view ? protect(m_view)->setCommandEncoder(encoder) : protect(m_texture)->setCommandEncoder(encoder);
    }

    id<MTLRasterizationRateMap> rasterizationMapForSlice(uint32_t slice)
    {
        return m_view ? protect(m_view)->rasterizationMapForSlice(slice) : protect(m_texture)->rasterizationMapForSlice(slice);
    }

#undef TEXTURE_OR_VIEW_INVOKE
#undef TEXTURE_OR_VIEW_HELPER
#undef TEXTURE_OR_VIEW_HELPER_REF
#undef TEXTURE_OR_VIEW_HELPER_NONCONST

    operator bool() const { return m_texture || m_view; }

private:
    RefPtr<Texture> m_texture;
    RefPtr<TextureView> m_view;
};

static bool isRenderableTextureView(const auto& texture, WGPULoadOp loadOp, WGPUStoreOp storeOp)
{
    if (texture.usage() & WGPUTextureUsage_Transient) {
        if (loadOp != WGPULoadOp_Clear || storeOp != WGPUStoreOp_Discard)
            return false;
    }

    return (texture.usage() & WGPUTextureUsage_RenderAttachment) && (texture.is2DTexture() || texture.is2DArrayTexture() || texture.is3DTexture()) && texture.mipLevelCount() == 1 && texture.arrayLayerCount() <= 1;
}

static bool isAllowableTextureView(const auto& texture, WGPULoadOp loadOp, WGPUStoreOp storeOp)
{
    if (texture.usage() & WGPUTextureUsage_Transient) {
        if (loadOp != WGPULoadOp_Clear || storeOp != WGPUStoreOp_Discard)
            return false;
    }

    return true;
}

}
