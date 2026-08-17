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

#include "config.h"
#include "WebGPUTextureImpl.h"

#if HAVE(WEBGPU_IMPLEMENTATION)

#include "WebGPUConvertToBackingContext.h"
#include "WebGPUTextureView.h"
#include "WebGPUTextureViewDescriptor.h"
#include "WebGPUTextureViewImpl.h"
#include <WebGPU/WebGPUExt.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore::WebGPU {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextureImpl);

TextureImpl::TextureImpl(WebGPUPtr<WGPUTexture>&& texture, TextureFormat, TextureDimension, ConvertToBackingContext& convertToBackingContext)
    : m_backing(WTF::move(texture))
    , m_convertToBackingContext(convertToBackingContext)
{
}

TextureImpl::~TextureImpl() = default;

RefPtr<TextureView> TextureImpl::createView(const std::optional<TextureViewDescriptor>& descriptor)
{
    CString label = descriptor ? descriptor->label.utf8() : CString(""_s);

    Ref convertToBackingContext = m_convertToBackingContext;

    WGPUTextureViewDescriptor backingDescriptor {
        .label = label.data(),
        .format = descriptor && descriptor->format ? convertToBackingContext->convertToBacking(*descriptor->format) : WGPUTextureFormat_Undefined,
        .dimension = descriptor && descriptor->dimension ? convertToBackingContext->convertToBacking(*descriptor->dimension) : WGPUTextureViewDimension_Undefined,
        .baseMipLevel = descriptor ? descriptor->baseMipLevel : 0,
        .mipLevelCount = descriptor && descriptor->mipLevelCount ? *descriptor->mipLevelCount : static_cast<uint32_t>(WGPU_MIP_LEVEL_COUNT_UNDEFINED),
        .baseArrayLayer = descriptor ? descriptor->baseArrayLayer : 0,
        .arrayLayerCount = descriptor && descriptor->arrayLayerCount ? *descriptor->arrayLayerCount : static_cast<uint32_t>(WGPU_ARRAY_LAYER_COUNT_UNDEFINED),
        .aspect = descriptor ? convertToBackingContext->convertToBacking(descriptor->aspect) : WGPUTextureAspect_All,
        .usage = descriptor ? convertToBackingContext->convertTextureUsageFlagsToBacking(descriptor->usage) : 0,
    };

    return TextureViewImpl::create(adoptWebGPU(wgpuTextureCreateView(m_backing.get(), &backingDescriptor)), convertToBackingContext);
}

void TextureImpl::destroy()
{
    wgpuTextureDestroy(m_backing.get());
}

void TextureImpl::undestroy()
{
    wgpuTextureUndestroy(m_backing.get());
}

void TextureImpl::setLabelInternal(const String& label)
{
    wgpuTextureSetLabel(m_backing.get(), label.utf8().data());
}

} // namespace WebCore::WebGPU

#endif // HAVE(WEBGPU_IMPLEMENTATION)
