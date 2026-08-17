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
#include "GPUTexture.h"

#include "ExceptionOr.h"
#include "GPUDevice.h"
#include "GPUTextureDescriptor.h"
#include "GPUTextureView.h"
#include "GPUTextureViewDescriptor.h"
#include "WebGPUTextureViewDescriptor.h"

namespace WebCore {

template<int dimension>
static uint32_t getDimension(auto& extent3D)
{
    static_assert(dimension >= 0 && dimension <= 2, "dimension must be 0, 1, or 2");
    return WTF::switchOn(extent3D, [&](const Vector<GPUIntegerCoordinate>& vector) {
        return dimension <vector.size() ? vector[dimension] : 1;
    }, [&](const GPUExtent3DDict& extent3DDict) {
        switch (dimension) {
        case 0:
            return extent3DDict.width;
        case 1:
            return extent3DDict.height;
        case 2:
            return extent3DDict.depthOrArrayLayers;
        default:
            ASSERT_NOT_REACHED();
            return 0u;
        }
    });
}

GPUTexture::GPUTexture(Ref<WebGPU::Texture>&& backing, const GPUTextureDescriptor& descriptor, GPUDevice& device)
    : m_backing(WTF::move(backing))
    , m_format(descriptor.format)
    , m_width(getDimension<0>(descriptor.size))
    , m_height(getDimension<1>(descriptor.size))
    , m_depthOrArrayLayers(getDimension<2>(descriptor.size))
    , m_mipLevelCount(descriptor.mipLevelCount)
    , m_sampleCount(descriptor.sampleCount)
    , m_dimension(descriptor.dimension)
    , m_usage(descriptor.usage)
    , m_device(device)
{
}

GPUTexture::~GPUTexture() = default;

bool GPUTexture::hasActiveInspectorCanvasCallTracer() const
{
    return m_device->hasActiveInspectorCanvasCallTracer();
}

GPUDevice* GPUTexture::device() const
{
    return m_device.ptr();
}

String GPUTexture::label() const
{
    return m_backing->label();
}

void GPUTexture::setLabel(String&& label)
{
    m_backing->setLabel(WTF::move(label));
}

static WebGPU::TextureViewDescriptor NODELETE convertToBacking(const std::optional<GPUTextureViewDescriptor>& textureViewDescriptor)
{
    if (!textureViewDescriptor)
        return WebGPU::TextureViewDescriptor { };

    return textureViewDescriptor->convertToBacking();
}

ExceptionOr<Ref<GPUTextureView>> GPUTexture::createView(const std::optional<GPUTextureViewDescriptor>& textureViewDescriptor) const
{
    if (textureViewDescriptor.has_value() && textureViewDescriptor->format.has_value()) {
        if (auto error = m_device->errorValidatingSupportedFormat(*textureViewDescriptor->format))
            return Exception { ExceptionCode::TypeError, makeString("GPUTexture.createView: Unsupported texture format: "_s, *error) };
    }
    RefPtr view = m_backing->createView(convertToBacking(textureViewDescriptor));
    if (!view)
        return Exception { ExceptionCode::InvalidStateError, "GPUTexture.createView: Unable to create view."_s };
    return GPUTextureView::create(view.releaseNonNull(), *this);
}

void GPUTexture::destroy()
{
    m_isDestroyed = true;
    m_backing->destroy();
}

GPUIntegerCoordinateOut GPUTexture::width() const
{
    return m_width;
}

GPUIntegerCoordinateOut GPUTexture::height() const
{
    return m_height;
}

GPUIntegerCoordinateOut GPUTexture::depthOrArrayLayers() const
{
    return m_depthOrArrayLayers;
}

GPUIntegerCoordinateOut GPUTexture::mipLevelCount() const
{
    return m_mipLevelCount;
}

GPUSize32Out GPUTexture::sampleCount() const
{
    return m_sampleCount;
}

GPUTextureDimension GPUTexture::dimension() const
{
    return m_dimension;
}

GPUFlagsConstant GPUTexture::usage() const
{
    return m_usage;
}

static GPUTextureFormat NODELETE depthSpecificFormat(GPUTextureFormat textureFormat)
{
    // https://gpuweb.github.io/gpuweb/#aspect-specific-format

    switch (textureFormat) {
    case GPUTextureFormat::Depth24plusStencil8:
        return GPUTextureFormat::Depth24plus;
    case GPUTextureFormat::Depth32floatStencil8:
        return GPUTextureFormat::Depth32float;
    default:
        return textureFormat;
    }
}

static GPUTextureFormat NODELETE stencilSpecificFormat(GPUTextureFormat textureFormat)
{
    // https://gpuweb.github.io/gpuweb/#aspect-specific-format

    switch (textureFormat) {
    case GPUTextureFormat::Depth24plusStencil8:
        return GPUTextureFormat::Stencil8;
    case GPUTextureFormat::Depth32floatStencil8:
        return GPUTextureFormat::Stencil8;
    default:
        return textureFormat;
    }
}

GPUTextureFormat GPUTexture::aspectSpecificFormat(GPUTextureFormat format, GPUTextureAspect aspect)
{
    switch (aspect) {
    case GPUTextureAspect::All:
        return format;
    case GPUTextureAspect::StencilOnly:
        return stencilSpecificFormat(format);
    case GPUTextureAspect::DepthOnly:
        return depthSpecificFormat(format);
    }
    return format;
}
uint32_t GPUTexture::texelBlockSize(GPUTextureFormat format)
{
    switch (format) {
    case GPUTextureFormat::R8unorm:
    case GPUTextureFormat::R8snorm:
    case GPUTextureFormat::R8uint:
    case GPUTextureFormat::R8sint:
        return 1;
    case GPUTextureFormat::R16unorm:
    case GPUTextureFormat::R16snorm:
    case GPUTextureFormat::R16uint:
    case GPUTextureFormat::R16sint:
    case GPUTextureFormat::R16float:
    case GPUTextureFormat::Rg8unorm:
    case GPUTextureFormat::Rg8snorm:
    case GPUTextureFormat::Rg8uint:
    case GPUTextureFormat::Rg8sint:
        return 2;
    case GPUTextureFormat::R32float:
    case GPUTextureFormat::R32uint:
    case GPUTextureFormat::R32sint:
    case GPUTextureFormat::Rg16unorm:
    case GPUTextureFormat::Rg16snorm:
    case GPUTextureFormat::Rg16uint:
    case GPUTextureFormat::Rg16sint:
    case GPUTextureFormat::Rg16float:
    case GPUTextureFormat::Rgba8unorm:
    case GPUTextureFormat::Rgba8unormSRGB:
    case GPUTextureFormat::Rgba8snorm:
    case GPUTextureFormat::Rgba8uint:
    case GPUTextureFormat::Rgba8sint:
    case GPUTextureFormat::Bgra8unorm:
    case GPUTextureFormat::Bgra8unormSRGB:
    case GPUTextureFormat::Rgb10a2unorm:
    case GPUTextureFormat::Rg11b10ufloat:
    case GPUTextureFormat::Rgb9e5ufloat:
    case GPUTextureFormat::Rgb10a2uint:
        return 4;
    case GPUTextureFormat::Rg32float:
    case GPUTextureFormat::Rg32uint:
    case GPUTextureFormat::Rg32sint:
    case GPUTextureFormat::Rgba16unorm:
    case GPUTextureFormat::Rgba16snorm:
    case GPUTextureFormat::Rgba16uint:
    case GPUTextureFormat::Rgba16sint:
    case GPUTextureFormat::Rgba16float:
        return 8;
    case GPUTextureFormat::Rgba32float:
    case GPUTextureFormat::Rgba32uint:
    case GPUTextureFormat::Rgba32sint:
        return 16;
    case GPUTextureFormat::Stencil8:
        return 1;
    case GPUTextureFormat::Depth16unorm:
        return 2;
    case GPUTextureFormat::Depth24plus:
        return 4;
    case GPUTextureFormat::Depth24plusStencil8:
        return 0;
    case GPUTextureFormat::Depth32float:
        return 4;
    case GPUTextureFormat::Depth32floatStencil8:
        return 0;
    case GPUTextureFormat::Bc1RgbaUnorm:
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
        return 8;
    case GPUTextureFormat::Bc2RgbaUnorm:
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
        return 16;
    case GPUTextureFormat::Bc3RgbaUnorm:
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
        return 16;
    case GPUTextureFormat::Bc4RUnorm:
    case GPUTextureFormat::Bc4RSnorm:
        return 8;
    case GPUTextureFormat::Bc5RgUnorm:
    case GPUTextureFormat::Bc5RgSnorm:
        return 16;
    case GPUTextureFormat::Bc6hRgbUfloat:
    case GPUTextureFormat::Bc6hRgbFloat:
        return 16;
    case GPUTextureFormat::Bc7RgbaUnorm:
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return 16;
    case GPUTextureFormat::Etc2Rgb8unorm:
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
    case GPUTextureFormat::Etc2Rgb8a1unorm:
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
        return 8;
    case GPUTextureFormat::EacR11unorm:
    case GPUTextureFormat::EacR11snorm:
        return 8;
    case GPUTextureFormat::Etc2Rgba8unorm:
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
    case GPUTextureFormat::EacRg11unorm:
    case GPUTextureFormat::EacRg11snorm:
        return 16;
    case GPUTextureFormat::Astc4x4Unorm:
    case GPUTextureFormat::Astc4x4UnormSRGB:
    case GPUTextureFormat::Astc5x4Unorm:
    case GPUTextureFormat::Astc5x4UnormSRGB:
    case GPUTextureFormat::Astc5x5Unorm:
    case GPUTextureFormat::Astc5x5UnormSRGB:
    case GPUTextureFormat::Astc6x5Unorm:
    case GPUTextureFormat::Astc6x5UnormSRGB:
    case GPUTextureFormat::Astc6x6Unorm:
    case GPUTextureFormat::Astc6x6UnormSRGB:
    case GPUTextureFormat::Astc8x5Unorm:
    case GPUTextureFormat::Astc8x5UnormSRGB:
    case GPUTextureFormat::Astc8x6Unorm:
    case GPUTextureFormat::Astc8x6UnormSRGB:
    case GPUTextureFormat::Astc8x8Unorm:
    case GPUTextureFormat::Astc8x8UnormSRGB:
    case GPUTextureFormat::Astc10x5Unorm:
    case GPUTextureFormat::Astc10x5UnormSRGB:
    case GPUTextureFormat::Astc10x6Unorm:
    case GPUTextureFormat::Astc10x6UnormSRGB:
    case GPUTextureFormat::Astc10x8Unorm:
    case GPUTextureFormat::Astc10x8UnormSRGB:
    case GPUTextureFormat::Astc10x10Unorm:
    case GPUTextureFormat::Astc10x10UnormSRGB:
    case GPUTextureFormat::Astc12x10Unorm:
    case GPUTextureFormat::Astc12x10UnormSRGB:
    case GPUTextureFormat::Astc12x12Unorm:
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return 16;
    }
    return 0;
}
uint32_t GPUTexture::texelBlockWidth(GPUTextureFormat format)
{
    switch (format) {
    case GPUTextureFormat::Bc1RgbaUnorm:
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
    case GPUTextureFormat::Bc2RgbaUnorm:
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
    case GPUTextureFormat::Bc3RgbaUnorm:
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
    case GPUTextureFormat::Bc4RUnorm:
    case GPUTextureFormat::Bc4RSnorm:
    case GPUTextureFormat::Bc5RgUnorm:
    case GPUTextureFormat::Bc5RgSnorm:
    case GPUTextureFormat::Bc6hRgbUfloat:
    case GPUTextureFormat::Bc6hRgbFloat:
    case GPUTextureFormat::Bc7RgbaUnorm:
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return 4;
    case GPUTextureFormat::Etc2Rgb8unorm:
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
    case GPUTextureFormat::Etc2Rgb8a1unorm:
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
    case GPUTextureFormat::Etc2Rgba8unorm:
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
    case GPUTextureFormat::EacR11unorm:
    case GPUTextureFormat::EacR11snorm:
    case GPUTextureFormat::EacRg11unorm:
    case GPUTextureFormat::EacRg11snorm:
        return 4;
    case GPUTextureFormat::Astc4x4Unorm:
    case GPUTextureFormat::Astc4x4UnormSRGB:
        return 4;
    case GPUTextureFormat::Astc5x4Unorm:
    case GPUTextureFormat::Astc5x4UnormSRGB:
    case GPUTextureFormat::Astc5x5Unorm:
    case GPUTextureFormat::Astc5x5UnormSRGB:
        return 5;
    case GPUTextureFormat::Astc6x5Unorm:
    case GPUTextureFormat::Astc6x5UnormSRGB:
    case GPUTextureFormat::Astc6x6Unorm:
    case GPUTextureFormat::Astc6x6UnormSRGB:
        return 6;
    case GPUTextureFormat::Astc8x5Unorm:
    case GPUTextureFormat::Astc8x5UnormSRGB:
    case GPUTextureFormat::Astc8x6Unorm:
    case GPUTextureFormat::Astc8x6UnormSRGB:
    case GPUTextureFormat::Astc8x8Unorm:
    case GPUTextureFormat::Astc8x8UnormSRGB:
        return 8;
    case GPUTextureFormat::Astc10x5Unorm:
    case GPUTextureFormat::Astc10x5UnormSRGB:
    case GPUTextureFormat::Astc10x6Unorm:
    case GPUTextureFormat::Astc10x6UnormSRGB:
    case GPUTextureFormat::Astc10x8Unorm:
    case GPUTextureFormat::Astc10x8UnormSRGB:
    case GPUTextureFormat::Astc10x10Unorm:
    case GPUTextureFormat::Astc10x10UnormSRGB:
        return 10;
    case GPUTextureFormat::Astc12x10Unorm:
    case GPUTextureFormat::Astc12x10UnormSRGB:
    case GPUTextureFormat::Astc12x12Unorm:
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return 12;
    case GPUTextureFormat::R8unorm:
    case GPUTextureFormat::R8snorm:
    case GPUTextureFormat::R8uint:
    case GPUTextureFormat::R8sint:
    case GPUTextureFormat::R16unorm:
    case GPUTextureFormat::R16snorm:
    case GPUTextureFormat::R16uint:
    case GPUTextureFormat::R16sint:
    case GPUTextureFormat::R16float:
    case GPUTextureFormat::Rg8unorm:
    case GPUTextureFormat::Rg8snorm:
    case GPUTextureFormat::Rg8uint:
    case GPUTextureFormat::Rg8sint:
    case GPUTextureFormat::R32float:
    case GPUTextureFormat::R32uint:
    case GPUTextureFormat::R32sint:
    case GPUTextureFormat::Rg16unorm:
    case GPUTextureFormat::Rg16snorm:
    case GPUTextureFormat::Rg16uint:
    case GPUTextureFormat::Rg16sint:
    case GPUTextureFormat::Rg16float:
    case GPUTextureFormat::Rgba8unorm:
    case GPUTextureFormat::Rgba8unormSRGB:
    case GPUTextureFormat::Rgba8snorm:
    case GPUTextureFormat::Rgba8uint:
    case GPUTextureFormat::Rgba8sint:
    case GPUTextureFormat::Bgra8unorm:
    case GPUTextureFormat::Bgra8unormSRGB:
    case GPUTextureFormat::Rgb10a2unorm:
    case GPUTextureFormat::Rg11b10ufloat:
    case GPUTextureFormat::Rgb9e5ufloat:
    case GPUTextureFormat::Rgb10a2uint:
    case GPUTextureFormat::Rg32float:
    case GPUTextureFormat::Rg32uint:
    case GPUTextureFormat::Rg32sint:
    case GPUTextureFormat::Rgba16unorm:
    case GPUTextureFormat::Rgba16snorm:
    case GPUTextureFormat::Rgba16uint:
    case GPUTextureFormat::Rgba16sint:
    case GPUTextureFormat::Rgba16float:
    case GPUTextureFormat::Rgba32float:
    case GPUTextureFormat::Rgba32uint:
    case GPUTextureFormat::Rgba32sint:
    case GPUTextureFormat::Stencil8:
    case GPUTextureFormat::Depth16unorm:
    case GPUTextureFormat::Depth24plus:
    case GPUTextureFormat::Depth24plusStencil8:
    case GPUTextureFormat::Depth32float:
    case GPUTextureFormat::Depth32floatStencil8:
        return 1;
    }
    return 0;
}
uint32_t GPUTexture::texelBlockHeight(GPUTextureFormat format)
{
    switch (format) {
    case GPUTextureFormat::Bc1RgbaUnorm:
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
    case GPUTextureFormat::Bc2RgbaUnorm:
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
    case GPUTextureFormat::Bc3RgbaUnorm:
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
    case GPUTextureFormat::Bc4RUnorm:
    case GPUTextureFormat::Bc4RSnorm:
    case GPUTextureFormat::Bc5RgUnorm:
    case GPUTextureFormat::Bc5RgSnorm:
    case GPUTextureFormat::Bc6hRgbUfloat:
    case GPUTextureFormat::Bc6hRgbFloat:
    case GPUTextureFormat::Bc7RgbaUnorm:
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return 4;
    case GPUTextureFormat::Etc2Rgb8unorm:
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
    case GPUTextureFormat::Etc2Rgb8a1unorm:
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
    case GPUTextureFormat::Etc2Rgba8unorm:
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
    case GPUTextureFormat::EacR11unorm:
    case GPUTextureFormat::EacR11snorm:
    case GPUTextureFormat::EacRg11unorm:
    case GPUTextureFormat::EacRg11snorm:
        return 4;
    case GPUTextureFormat::Astc4x4Unorm:
    case GPUTextureFormat::Astc4x4UnormSRGB:
    case GPUTextureFormat::Astc5x4Unorm:
    case GPUTextureFormat::Astc5x4UnormSRGB:
        return 4;
    case GPUTextureFormat::Astc5x5Unorm:
    case GPUTextureFormat::Astc5x5UnormSRGB:
    case GPUTextureFormat::Astc6x5Unorm:
    case GPUTextureFormat::Astc6x5UnormSRGB:
        return 5;
    case GPUTextureFormat::Astc6x6Unorm:
    case GPUTextureFormat::Astc6x6UnormSRGB:
        return 6;
    case GPUTextureFormat::Astc8x5Unorm:
    case GPUTextureFormat::Astc8x5UnormSRGB:
        return 5;
    case GPUTextureFormat::Astc8x6Unorm:
    case GPUTextureFormat::Astc8x6UnormSRGB:
        return 6;
    case GPUTextureFormat::Astc8x8Unorm:
    case GPUTextureFormat::Astc8x8UnormSRGB:
        return 8;
    case GPUTextureFormat::Astc10x5Unorm:
    case GPUTextureFormat::Astc10x5UnormSRGB:
        return 5;
    case GPUTextureFormat::Astc10x6Unorm:
    case GPUTextureFormat::Astc10x6UnormSRGB:
        return 6;
    case GPUTextureFormat::Astc10x8Unorm:
    case GPUTextureFormat::Astc10x8UnormSRGB:
        return 8;
    case GPUTextureFormat::Astc10x10Unorm:
    case GPUTextureFormat::Astc10x10UnormSRGB:
    case GPUTextureFormat::Astc12x10Unorm:
    case GPUTextureFormat::Astc12x10UnormSRGB:
        return 10;
    case GPUTextureFormat::Astc12x12Unorm:
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return 12;
    case GPUTextureFormat::R8unorm:
    case GPUTextureFormat::R8snorm:
    case GPUTextureFormat::R8uint:
    case GPUTextureFormat::R8sint:
    case GPUTextureFormat::R16unorm:
    case GPUTextureFormat::R16snorm:
    case GPUTextureFormat::R16uint:
    case GPUTextureFormat::R16sint:
    case GPUTextureFormat::R16float:
    case GPUTextureFormat::Rg8unorm:
    case GPUTextureFormat::Rg8snorm:
    case GPUTextureFormat::Rg8uint:
    case GPUTextureFormat::Rg8sint:
    case GPUTextureFormat::R32float:
    case GPUTextureFormat::R32uint:
    case GPUTextureFormat::R32sint:
    case GPUTextureFormat::Rg16unorm:
    case GPUTextureFormat::Rg16snorm:
    case GPUTextureFormat::Rg16uint:
    case GPUTextureFormat::Rg16sint:
    case GPUTextureFormat::Rg16float:
    case GPUTextureFormat::Rgba8unorm:
    case GPUTextureFormat::Rgba8unormSRGB:
    case GPUTextureFormat::Rgba8snorm:
    case GPUTextureFormat::Rgba8uint:
    case GPUTextureFormat::Rgba8sint:
    case GPUTextureFormat::Bgra8unorm:
    case GPUTextureFormat::Bgra8unormSRGB:
    case GPUTextureFormat::Rgb10a2unorm:
    case GPUTextureFormat::Rg11b10ufloat:
    case GPUTextureFormat::Rgb9e5ufloat:
    case GPUTextureFormat::Rgb10a2uint:
    case GPUTextureFormat::Rg32float:
    case GPUTextureFormat::Rg32uint:
    case GPUTextureFormat::Rg32sint:
    case GPUTextureFormat::Rgba16unorm:
    case GPUTextureFormat::Rgba16snorm:
    case GPUTextureFormat::Rgba16uint:
    case GPUTextureFormat::Rgba16sint:
    case GPUTextureFormat::Rgba16float:
    case GPUTextureFormat::Rgba32float:
    case GPUTextureFormat::Rgba32uint:
    case GPUTextureFormat::Rgba32sint:
    case GPUTextureFormat::Stencil8:
    case GPUTextureFormat::Depth16unorm:
    case GPUTextureFormat::Depth24plus:
    case GPUTextureFormat::Depth24plusStencil8:
    case GPUTextureFormat::Depth32float:
    case GPUTextureFormat::Depth32floatStencil8:
        return 1;
    }
    return 0;
}

}
