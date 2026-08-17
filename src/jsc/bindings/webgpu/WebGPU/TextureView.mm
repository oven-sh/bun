/*
 * Copyright (c) 2021-2023 Apple Inc. All rights reserved.
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

#import "config.h"
#import "TextureView.h"

#import "APIConversions.h"
#import "CommandEncoder.h"
#import <wtf/TZoneMallocInlines.h>

namespace WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextureView);

TextureView::TextureView(id<MTLTexture> texture, const WGPUTextureViewDescriptor& descriptor, const std::optional<WGPUExtent3D>& renderExtent, Texture& parentTexture, Device& device)
    : m_texture(texture)
    , m_descriptor(descriptor)
    , m_renderExtent(renderExtent)
    , m_device(device)
    , m_parentTexture(parentTexture)
{
}

TextureView::TextureView(Texture& texture, Device& device)
    : m_descriptor { }
    , m_device(device)
    , m_parentTexture(texture)
{
}

TextureView::~TextureView() = default;

void TextureView::setLabel(String&& label)
{
    m_texture.label = label.createNSString().get();
}

id<MTLTexture> TextureView::parentTexture() const
{
    return m_parentTexture->texture();
}

bool TextureView::previouslyCleared() const
{
    return m_parentTexture->previouslyCleared(m_texture.parentRelativeLevel, m_texture.parentRelativeSlice);
}

void TextureView::setPreviouslyCleared(uint32_t mipLevel, uint32_t slice)
{
    m_parentTexture->setPreviouslyCleared(m_texture.parentRelativeLevel + mipLevel, m_texture.parentRelativeSlice + slice);
}

uint32_t TextureView::parentRelativeMipLevel() const
{
    RELEASE_ASSERT(baseMipLevel() == m_texture.parentRelativeLevel);
    return m_texture.parentRelativeLevel;
}

uint32_t TextureView::parentRelativeSlice() const
{
    return m_texture.parentRelativeSlice;
}

uint32_t TextureView::width() const
{
    return m_parentTexture->physicalMiplevelSpecificTextureExtent(baseMipLevel()).width;
}

uint32_t TextureView::height() const
{
    return m_parentTexture->physicalMiplevelSpecificTextureExtent(baseMipLevel()).height;
}

uint32_t TextureView::depthOrArrayLayers() const
{
    return m_parentTexture->physicalMiplevelSpecificTextureExtent(baseMipLevel()).depthOrArrayLayers;
}

WGPUTextureUsageFlags TextureView::usage() const
{
    return m_parentTexture->usage();
}

id<MTLTexture> TextureView::texture() const
{
    return isDestroyed() ? parentTexture() : m_texture;
}

uint32_t TextureView::sampleCount() const
{
    return m_parentTexture->sampleCount();
}

WGPUTextureFormat TextureView::parentFormat() const
{
    return m_parentTexture->format();
}

WGPUTextureFormat TextureView::format() const
{
    return m_descriptor.format;
}

uint32_t TextureView::parentMipLevelCount() const
{
    return m_parentTexture->mipLevelCount();
}

uint32_t TextureView::mipLevelCount() const
{
    return m_descriptor.mipLevelCount;
}

uint32_t TextureView::baseMipLevel() const
{
    return m_descriptor.baseMipLevel;
}

WGPUTextureAspect TextureView::aspect() const
{
    return m_descriptor.aspect;
}

uint32_t TextureView::arrayLayerCount() const
{
    return m_descriptor.arrayLayerCount;
}

uint32_t TextureView::baseArrayLayer() const
{
    return m_descriptor.baseArrayLayer;
}

WGPUTextureViewDimension TextureView::dimension() const
{
    return m_descriptor.dimension;
}

bool TextureView::isDestroyed() const
{
    return m_parentTexture->isDestroyed();
}

bool TextureView::isValid() const
{
    return m_texture || isDestroyed();
}

void TextureView::destroy()
{
    m_texture = protect(m_device)->placeholderTexture(format());
    if (!m_parentTexture->isCanvasBacking())
        m_device->makeSubmitInvalidClearingEncoders(m_commandEncoders);

    m_commandEncoders.clear();
}

void TextureView::setCommandEncoder(CommandEncoder& commandEncoder) const
{
    CommandEncoder::trackEncoder(commandEncoder, m_commandEncoders);
    commandEncoder.addTexture(m_parentTexture);
    if (isDestroyed() && !m_parentTexture->isCanvasBacking())
        commandEncoder.makeSubmitInvalid();
}

id<MTLRasterizationRateMap> TextureView::rasterizationMapForSlice(uint32_t slice) const
{
    return apiParentTexture().rasterizationMapForSlice(slice);
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuTextureViewReference(WGPUTextureView textureView)
{
    WebGPU::fromAPI(textureView).ref();
}

void wgpuTextureViewRelease(WGPUTextureView textureView)
{
    WebGPU::fromAPI(textureView).deref();
}

void wgpuTextureViewSetLabel(WGPUTextureView textureView, const char* label)
{
    protect(WebGPU::fromAPI(textureView))->setLabel(WebGPU::fromAPI(label));
}
