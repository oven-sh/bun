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

#include "WebGPUTextureFormat.h"
#include <cstdint>
#include <wtf/text/WTFString.h>

namespace WebCore {

enum class GPUTextureFormat : uint8_t {
    // 8-bit formats
    R8unorm,
    R8snorm,
    R8uint,
    R8sint,

    // 16-bit formats
    R16unorm,
    R16snorm,
    R16uint,
    R16sint,
    R16float,
    Rg8unorm,
    Rg8snorm,
    Rg8uint,
    Rg8sint,

    // 32-bit formats
    R32uint,
    R32sint,
    R32float,
    Rg16unorm,
    Rg16snorm,
    Rg16uint,
    Rg16sint,
    Rg16float,
    Rgba8unorm,
    Rgba8unormSRGB,
    Rgba8snorm,
    Rgba8uint,
    Rgba8sint,
    Bgra8unorm,
    Bgra8unormSRGB,
    // Packed 32-bit formats
    Rgb9e5ufloat,
    Rgb10a2uint,
    Rgb10a2unorm,
    Rg11b10ufloat,

    // 64-bit formats
    Rg32uint,
    Rg32sint,
    Rg32float,
    Rgba16unorm,
    Rgba16snorm,
    Rgba16uint,
    Rgba16sint,
    Rgba16float,

    // 128-bit formats
    Rgba32uint,
    Rgba32sint,
    Rgba32float,

    // Depth/stencil formats
    Stencil8,
    Depth16unorm,
    Depth24plus,
    Depth24plusStencil8,
    Depth32float,

    // depth32float-stencil8 feature
    Depth32floatStencil8,

    // BC compressed formats usable if texture-compression-bc is both
    // supported by the device/user agent and enabled in requestDevice.
    Bc1RgbaUnorm,
    Bc1RgbaUnormSRGB,
    Bc2RgbaUnorm,
    Bc2RgbaUnormSRGB,
    Bc3RgbaUnorm,
    Bc3RgbaUnormSRGB,
    Bc4RUnorm,
    Bc4RSnorm,
    Bc5RgUnorm,
    Bc5RgSnorm,
    Bc6hRgbUfloat,
    Bc6hRgbFloat,
    Bc7RgbaUnorm,
    Bc7RgbaUnormSRGB,

    // ETC2 compressed formats usable if texture-compression-etc2 is both
    // supported by the device/user agent and enabled in requestDevice.
    Etc2Rgb8unorm,
    Etc2Rgb8unormSRGB,
    Etc2Rgb8a1unorm,
    Etc2Rgb8a1unormSRGB,
    Etc2Rgba8unorm,
    Etc2Rgba8unormSRGB,
    EacR11unorm,
    EacR11snorm,
    EacRg11unorm,
    EacRg11snorm,

    // ASTC compressed formats usable if texture-compression-astc is both
    // supported by the device/user agent and enabled in requestDevice.
    Astc4x4Unorm,
    Astc4x4UnormSRGB,
    Astc5x4Unorm,
    Astc5x4UnormSRGB,
    Astc5x5Unorm,
    Astc5x5UnormSRGB,
    Astc6x5Unorm,
    Astc6x5UnormSRGB,
    Astc6x6Unorm,
    Astc6x6UnormSRGB,
    Astc8x5Unorm,
    Astc8x5UnormSRGB,
    Astc8x6Unorm,
    Astc8x6UnormSRGB,
    Astc8x8Unorm,
    Astc8x8UnormSRGB,
    Astc10x5Unorm,
    Astc10x5UnormSRGB,
    Astc10x6Unorm,
    Astc10x6UnormSRGB,
    Astc10x8Unorm,
    Astc10x8UnormSRGB,
    Astc10x10Unorm,
    Astc10x10UnormSRGB,
    Astc12x10Unorm,
    Astc12x10UnormSRGB,
    Astc12x12Unorm,
    Astc12x12UnormSRGB,
};

inline WebGPU::TextureFormat convertToBacking(GPUTextureFormat textureFormat)
{
    switch (textureFormat) {
    case GPUTextureFormat::R8unorm:
        return WebGPU::TextureFormat::R8unorm;
    case GPUTextureFormat::R8snorm:
        return WebGPU::TextureFormat::R8snorm;
    case GPUTextureFormat::R8uint:
        return WebGPU::TextureFormat::R8uint;
    case GPUTextureFormat::R8sint:
        return WebGPU::TextureFormat::R8sint;
    case GPUTextureFormat::R16unorm:
        return WebGPU::TextureFormat::R16unorm;
    case GPUTextureFormat::R16snorm:
        return WebGPU::TextureFormat::R16snorm;
    case GPUTextureFormat::R16uint:
        return WebGPU::TextureFormat::R16uint;
    case GPUTextureFormat::R16sint:
        return WebGPU::TextureFormat::R16sint;
    case GPUTextureFormat::R16float:
        return WebGPU::TextureFormat::R16float;
    case GPUTextureFormat::Rg8unorm:
        return WebGPU::TextureFormat::Rg8unorm;
    case GPUTextureFormat::Rg8snorm:
        return WebGPU::TextureFormat::Rg8snorm;
    case GPUTextureFormat::Rg8uint:
        return WebGPU::TextureFormat::Rg8uint;
    case GPUTextureFormat::Rg8sint:
        return WebGPU::TextureFormat::Rg8sint;
    case GPUTextureFormat::R32uint:
        return WebGPU::TextureFormat::R32uint;
    case GPUTextureFormat::R32sint:
        return WebGPU::TextureFormat::R32sint;
    case GPUTextureFormat::R32float:
        return WebGPU::TextureFormat::R32float;
    case GPUTextureFormat::Rg16unorm:
        return WebGPU::TextureFormat::Rg16unorm;
    case GPUTextureFormat::Rg16snorm:
        return WebGPU::TextureFormat::Rg16snorm;
    case GPUTextureFormat::Rg16uint:
        return WebGPU::TextureFormat::Rg16uint;
    case GPUTextureFormat::Rg16sint:
        return WebGPU::TextureFormat::Rg16sint;
    case GPUTextureFormat::Rg16float:
        return WebGPU::TextureFormat::Rg16float;
    case GPUTextureFormat::Rgba8unorm:
        return WebGPU::TextureFormat::Rgba8unorm;
    case GPUTextureFormat::Rgba8unormSRGB:
        return WebGPU::TextureFormat::Rgba8unormSRGB;
    case GPUTextureFormat::Rgba8snorm:
        return WebGPU::TextureFormat::Rgba8snorm;
    case GPUTextureFormat::Rgba8uint:
        return WebGPU::TextureFormat::Rgba8uint;
    case GPUTextureFormat::Rgba8sint:
        return WebGPU::TextureFormat::Rgba8sint;
    case GPUTextureFormat::Bgra8unorm:
        return WebGPU::TextureFormat::Bgra8unorm;
    case GPUTextureFormat::Bgra8unormSRGB:
        return WebGPU::TextureFormat::Bgra8unormSRGB;
    case GPUTextureFormat::Rgb9e5ufloat:
        return WebGPU::TextureFormat::Rgb9e5ufloat;
    case GPUTextureFormat::Rgb10a2uint:
        return WebGPU::TextureFormat::Rgb10a2uint;
    case GPUTextureFormat::Rgb10a2unorm:
        return WebGPU::TextureFormat::Rgb10a2unorm;
    case GPUTextureFormat::Rg11b10ufloat:
        return WebGPU::TextureFormat::Rg11b10ufloat;
    case GPUTextureFormat::Rg32uint:
        return WebGPU::TextureFormat::Rg32uint;
    case GPUTextureFormat::Rg32sint:
        return WebGPU::TextureFormat::Rg32sint;
    case GPUTextureFormat::Rg32float:
        return WebGPU::TextureFormat::Rg32float;
    case GPUTextureFormat::Rgba16unorm:
        return WebGPU::TextureFormat::Rgba16unorm;
    case GPUTextureFormat::Rgba16snorm:
        return WebGPU::TextureFormat::Rgba16snorm;
    case GPUTextureFormat::Rgba16uint:
        return WebGPU::TextureFormat::Rgba16uint;
    case GPUTextureFormat::Rgba16sint:
        return WebGPU::TextureFormat::Rgba16sint;
    case GPUTextureFormat::Rgba16float:
        return WebGPU::TextureFormat::Rgba16float;
    case GPUTextureFormat::Rgba32uint:
        return WebGPU::TextureFormat::Rgba32uint;
    case GPUTextureFormat::Rgba32sint:
        return WebGPU::TextureFormat::Rgba32sint;
    case GPUTextureFormat::Rgba32float:
        return WebGPU::TextureFormat::Rgba32float;
    case GPUTextureFormat::Stencil8:
        return WebGPU::TextureFormat::Stencil8;
    case GPUTextureFormat::Depth16unorm:
        return WebGPU::TextureFormat::Depth16unorm;
    case GPUTextureFormat::Depth24plus:
        return WebGPU::TextureFormat::Depth24plus;
    case GPUTextureFormat::Depth24plusStencil8:
        return WebGPU::TextureFormat::Depth24plusStencil8;
    case GPUTextureFormat::Depth32float:
        return WebGPU::TextureFormat::Depth32float;
    case GPUTextureFormat::Depth32floatStencil8:
        return WebGPU::TextureFormat::Depth32floatStencil8;
    case GPUTextureFormat::Bc1RgbaUnorm:
        return WebGPU::TextureFormat::Bc1RgbaUnorm;
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
        return WebGPU::TextureFormat::Bc1RgbaUnormSRGB;
    case GPUTextureFormat::Bc2RgbaUnorm:
        return WebGPU::TextureFormat::Bc2RgbaUnorm;
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
        return WebGPU::TextureFormat::Bc2RgbaUnormSRGB;
    case GPUTextureFormat::Bc3RgbaUnorm:
        return WebGPU::TextureFormat::Bc3RgbaUnorm;
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
        return WebGPU::TextureFormat::Bc3RgbaUnormSRGB;
    case GPUTextureFormat::Bc4RUnorm:
        return WebGPU::TextureFormat::Bc4RUnorm;
    case GPUTextureFormat::Bc4RSnorm:
        return WebGPU::TextureFormat::Bc4RSnorm;
    case GPUTextureFormat::Bc5RgUnorm:
        return WebGPU::TextureFormat::Bc5RgUnorm;
    case GPUTextureFormat::Bc5RgSnorm:
        return WebGPU::TextureFormat::Bc5RgSnorm;
    case GPUTextureFormat::Bc6hRgbUfloat:
        return WebGPU::TextureFormat::Bc6hRgbUfloat;
    case GPUTextureFormat::Bc6hRgbFloat:
        return WebGPU::TextureFormat::Bc6hRgbFloat;
    case GPUTextureFormat::Bc7RgbaUnorm:
        return WebGPU::TextureFormat::Bc7RgbaUnorm;
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return WebGPU::TextureFormat::Bc7RgbaUnormSRGB;
    case GPUTextureFormat::Etc2Rgb8unorm:
        return WebGPU::TextureFormat::Etc2Rgb8unorm;
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
        return WebGPU::TextureFormat::Etc2Rgb8unormSRGB;
    case GPUTextureFormat::Etc2Rgb8a1unorm:
        return WebGPU::TextureFormat::Etc2Rgb8a1unorm;
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
        return WebGPU::TextureFormat::Etc2Rgb8a1unormSRGB;
    case GPUTextureFormat::Etc2Rgba8unorm:
        return WebGPU::TextureFormat::Etc2Rgba8unorm;
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
        return WebGPU::TextureFormat::Etc2Rgba8unormSRGB;
    case GPUTextureFormat::EacR11unorm:
        return WebGPU::TextureFormat::EacR11unorm;
    case GPUTextureFormat::EacR11snorm:
        return WebGPU::TextureFormat::EacR11snorm;
    case GPUTextureFormat::EacRg11unorm:
        return WebGPU::TextureFormat::EacRg11unorm;
    case GPUTextureFormat::EacRg11snorm:
        return WebGPU::TextureFormat::EacRg11snorm;
    case GPUTextureFormat::Astc4x4Unorm:
        return WebGPU::TextureFormat::Astc4x4Unorm;
    case GPUTextureFormat::Astc4x4UnormSRGB:
        return WebGPU::TextureFormat::Astc4x4UnormSRGB;
    case GPUTextureFormat::Astc5x4Unorm:
        return WebGPU::TextureFormat::Astc5x4Unorm;
    case GPUTextureFormat::Astc5x4UnormSRGB:
        return WebGPU::TextureFormat::Astc5x4UnormSRGB;
    case GPUTextureFormat::Astc5x5Unorm:
        return WebGPU::TextureFormat::Astc5x5Unorm;
    case GPUTextureFormat::Astc5x5UnormSRGB:
        return WebGPU::TextureFormat::Astc5x5UnormSRGB;
    case GPUTextureFormat::Astc6x5Unorm:
        return WebGPU::TextureFormat::Astc6x5Unorm;
    case GPUTextureFormat::Astc6x5UnormSRGB:
        return WebGPU::TextureFormat::Astc6x5UnormSRGB;
    case GPUTextureFormat::Astc6x6Unorm:
        return WebGPU::TextureFormat::Astc6x6Unorm;
    case GPUTextureFormat::Astc6x6UnormSRGB:
        return WebGPU::TextureFormat::Astc6x6UnormSRGB;
    case GPUTextureFormat::Astc8x5Unorm:
        return WebGPU::TextureFormat::Astc8x5Unorm;
    case GPUTextureFormat::Astc8x5UnormSRGB:
        return WebGPU::TextureFormat::Astc8x5UnormSRGB;
    case GPUTextureFormat::Astc8x6Unorm:
        return WebGPU::TextureFormat::Astc8x6Unorm;
    case GPUTextureFormat::Astc8x6UnormSRGB:
        return WebGPU::TextureFormat::Astc8x6UnormSRGB;
    case GPUTextureFormat::Astc8x8Unorm:
        return WebGPU::TextureFormat::Astc8x8Unorm;
    case GPUTextureFormat::Astc8x8UnormSRGB:
        return WebGPU::TextureFormat::Astc8x8UnormSRGB;
    case GPUTextureFormat::Astc10x5Unorm:
        return WebGPU::TextureFormat::Astc10x5Unorm;
    case GPUTextureFormat::Astc10x5UnormSRGB:
        return WebGPU::TextureFormat::Astc10x5UnormSRGB;
    case GPUTextureFormat::Astc10x6Unorm:
        return WebGPU::TextureFormat::Astc10x6Unorm;
    case GPUTextureFormat::Astc10x6UnormSRGB:
        return WebGPU::TextureFormat::Astc10x6UnormSRGB;
    case GPUTextureFormat::Astc10x8Unorm:
        return WebGPU::TextureFormat::Astc10x8Unorm;
    case GPUTextureFormat::Astc10x8UnormSRGB:
        return WebGPU::TextureFormat::Astc10x8UnormSRGB;
    case GPUTextureFormat::Astc10x10Unorm:
        return WebGPU::TextureFormat::Astc10x10Unorm;
    case GPUTextureFormat::Astc10x10UnormSRGB:
        return WebGPU::TextureFormat::Astc10x10UnormSRGB;
    case GPUTextureFormat::Astc12x10Unorm:
        return WebGPU::TextureFormat::Astc12x10Unorm;
    case GPUTextureFormat::Astc12x10UnormSRGB:
        return WebGPU::TextureFormat::Astc12x10UnormSRGB;
    case GPUTextureFormat::Astc12x12Unorm:
        return WebGPU::TextureFormat::Astc12x12Unorm;
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return WebGPU::TextureFormat::Astc12x12UnormSRGB;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

inline String convertToString(GPUTextureFormat textureFormat)
{
    switch (textureFormat) {
    case GPUTextureFormat::R8unorm:
        return "r8unorm"_s;
    case GPUTextureFormat::R8snorm:
        return "r8snorm"_s;
    case GPUTextureFormat::R8uint:
        return "r8uint"_s;
    case GPUTextureFormat::R8sint:
        return "r8sint"_s;
    case GPUTextureFormat::R16unorm:
        return "r16unorm"_s;
    case GPUTextureFormat::R16snorm:
        return "r16snorm"_s;
    case GPUTextureFormat::R16uint:
        return "r16uint"_s;
    case GPUTextureFormat::R16sint:
        return "r16sint"_s;
    case GPUTextureFormat::R16float:
        return "r16float"_s;
    case GPUTextureFormat::Rg8unorm:
        return "rg8unorm"_s;
    case GPUTextureFormat::Rg8snorm:
        return "rg8snorm"_s;
    case GPUTextureFormat::Rg8uint:
        return "rg8uint"_s;
    case GPUTextureFormat::Rg8sint:
        return "rg8sint"_s;
    case GPUTextureFormat::R32uint:
        return "r32uint"_s;
    case GPUTextureFormat::R32sint:
        return "r32sint"_s;
    case GPUTextureFormat::R32float:
        return "r32float"_s;
    case GPUTextureFormat::Rg16unorm:
        return "rg16unorm"_s;
    case GPUTextureFormat::Rg16snorm:
        return "rg16snorm"_s;
    case GPUTextureFormat::Rg16uint:
        return "rg16uint"_s;
    case GPUTextureFormat::Rg16sint:
        return "rg16sint"_s;
    case GPUTextureFormat::Rg16float:
        return "rg16float"_s;
    case GPUTextureFormat::Rgba8unorm:
        return "rgba8unorm"_s;
    case GPUTextureFormat::Rgba8unormSRGB:
        return "rgba8unorm-srgb"_s;
    case GPUTextureFormat::Rgba8snorm:
        return "rgba8snorm"_s;
    case GPUTextureFormat::Rgba8uint:
        return "Rgba8uint"_s;
    case GPUTextureFormat::Rgba8sint:
        return "rgba8sint"_s;
    case GPUTextureFormat::Bgra8unorm:
        return "bgra8unorm"_s;
    case GPUTextureFormat::Bgra8unormSRGB:
        return "bgra8unorm-srgb"_s;
    case GPUTextureFormat::Rgb9e5ufloat:
        return "rgb9e5ufloat"_s;
    case GPUTextureFormat::Rgb10a2uint:
        return "rgb10a2uint"_s;
    case GPUTextureFormat::Rgb10a2unorm:
        return "rgb10a2unorm"_s;
    case GPUTextureFormat::Rg11b10ufloat:
        return "rg11b10ufloat"_s;
    case GPUTextureFormat::Rg32uint:
        return "rg32uint"_s;
    case GPUTextureFormat::Rg32sint:
        return "rg32sint"_s;
    case GPUTextureFormat::Rg32float:
        return "rg32float"_s;
    case GPUTextureFormat::Rgba16unorm:
        return "rgba16unorm"_s;
    case GPUTextureFormat::Rgba16snorm:
        return "rgba16snorm"_s;
    case GPUTextureFormat::Rgba16uint:
        return "rgba16uint"_s;
    case GPUTextureFormat::Rgba16sint:
        return "rgba16sint"_s;
    case GPUTextureFormat::Rgba16float:
        return "rgba16float"_s;
    case GPUTextureFormat::Rgba32uint:
        return "rgba32uint"_s;
    case GPUTextureFormat::Rgba32sint:
        return "rgba32sint"_s;
    case GPUTextureFormat::Rgba32float:
        return "rgba32float"_s;
    case GPUTextureFormat::Stencil8:
        return "stencil8"_s;
    case GPUTextureFormat::Depth16unorm:
        return "depth16unorm"_s;
    case GPUTextureFormat::Depth24plus:
        return "depth24plus"_s;
    case GPUTextureFormat::Depth24plusStencil8:
        return "depth24plus-stencil8"_s;
    case GPUTextureFormat::Depth32float:
        return "dpth32float"_s;
    case GPUTextureFormat::Depth32floatStencil8:
        return "depth32float-stencil8"_s;
    case GPUTextureFormat::Bc1RgbaUnorm:
        return "bc1-rgba-unorm"_s;
    case GPUTextureFormat::Bc1RgbaUnormSRGB:
        return "bc1-rgba-unorm-srgb"_s;
    case GPUTextureFormat::Bc2RgbaUnorm:
        return "bc2-rgba-unorm"_s;
    case GPUTextureFormat::Bc2RgbaUnormSRGB:
        return "bc2-rgba-unorm-srgb"_s;
    case GPUTextureFormat::Bc3RgbaUnorm:
        return "bc3-rgba-unorm"_s;
    case GPUTextureFormat::Bc3RgbaUnormSRGB:
        return "bc3-rgba-unorm-srgb"_s;
    case GPUTextureFormat::Bc4RUnorm:
        return "bc4-r-unorm"_s;
    case GPUTextureFormat::Bc4RSnorm:
        return "bc4-r-snorm"_s;
    case GPUTextureFormat::Bc5RgUnorm:
        return "bc5-rg-unorm"_s;
    case GPUTextureFormat::Bc5RgSnorm:
        return "bc5-rg-snorm"_s;
    case GPUTextureFormat::Bc6hRgbUfloat:
        return "bc6h-rgb-ufloat"_s;
    case GPUTextureFormat::Bc6hRgbFloat:
        return "bc6h-rgb-float"_s;
    case GPUTextureFormat::Bc7RgbaUnorm:
        return "bc7-rgba-unorm"_s;
    case GPUTextureFormat::Bc7RgbaUnormSRGB:
        return "bc7-rgba-unorm-srgb"_s;
    case GPUTextureFormat::Etc2Rgb8unorm:
        return "etc2-rgb8unorm"_s;
    case GPUTextureFormat::Etc2Rgb8unormSRGB:
        return "etc2-rgb8unorm-srgb"_s;
    case GPUTextureFormat::Etc2Rgb8a1unorm:
        return "etc2-rgb8a1unorm"_s;
    case GPUTextureFormat::Etc2Rgb8a1unormSRGB:
        return "etc2-rgb8a1unorm-srgb"_s;
    case GPUTextureFormat::Etc2Rgba8unorm:
        return "etc2-rgba8unorm"_s;
    case GPUTextureFormat::Etc2Rgba8unormSRGB:
        return "etc2-rgba8unorm-srgb"_s;
    case GPUTextureFormat::EacR11unorm:
        return "eac-r11unorm"_s;
    case GPUTextureFormat::EacR11snorm:
        return "eac-r11snorm"_s;
    case GPUTextureFormat::EacRg11unorm:
        return "eac-rg11unorm"_s;
    case GPUTextureFormat::EacRg11snorm:
        return "eac-rg11snorm"_s;
    case GPUTextureFormat::Astc4x4Unorm:
        return "astc-4x4-unorm"_s;
    case GPUTextureFormat::Astc4x4UnormSRGB:
        return "astc-4x4-unorm-srgb"_s;
    case GPUTextureFormat::Astc5x4Unorm:
        return "astc-5x4-unorm"_s;
    case GPUTextureFormat::Astc5x4UnormSRGB:
        return "astc-5x4-unorm-srgb"_s;
    case GPUTextureFormat::Astc5x5Unorm:
        return "astc-5x5-unorm"_s;
    case GPUTextureFormat::Astc5x5UnormSRGB:
        return "astc-5x5-unorm-srgb"_s;
    case GPUTextureFormat::Astc6x5Unorm:
        return "astc-6x5-unorm"_s;
    case GPUTextureFormat::Astc6x5UnormSRGB:
        return "astc-6x5-unorm-srgb"_s;
    case GPUTextureFormat::Astc6x6Unorm:
        return "astc-6x6-unorm"_s;
    case GPUTextureFormat::Astc6x6UnormSRGB:
        return "astc-6x6-unorm-srgb"_s;
    case GPUTextureFormat::Astc8x5Unorm:
        return "astc-8x5-unorm"_s;
    case GPUTextureFormat::Astc8x5UnormSRGB:
        return "astc-8x5-unorm-srgb"_s;
    case GPUTextureFormat::Astc8x6Unorm:
        return "astc-8x6-unorm"_s;
    case GPUTextureFormat::Astc8x6UnormSRGB:
        return "astc-8x6-unorm-srgb"_s;
    case GPUTextureFormat::Astc8x8Unorm:
        return "astc-8x8-unorm"_s;
    case GPUTextureFormat::Astc8x8UnormSRGB:
        return "astc-8x8-unorm-srgb"_s;
    case GPUTextureFormat::Astc10x5Unorm:
        return "astc-10x5-unorm"_s;
    case GPUTextureFormat::Astc10x5UnormSRGB:
        return "astc-10x5-unorm-srgb"_s;
    case GPUTextureFormat::Astc10x6Unorm:
        return "astc-10x6-unorm"_s;
    case GPUTextureFormat::Astc10x6UnormSRGB:
        return "astc-10x6-unorm-srgb"_s;
    case GPUTextureFormat::Astc10x8Unorm:
        return "astc-10x8-unorm"_s;
    case GPUTextureFormat::Astc10x8UnormSRGB:
        return "astc-10x8-unorm-srgb"_s;
    case GPUTextureFormat::Astc10x10Unorm:
        return "astc-10x10-unorm"_s;
    case GPUTextureFormat::Astc10x10UnormSRGB:
        return "astc-10x10-unorm-srgb"_s;
    case GPUTextureFormat::Astc12x10Unorm:
        return "astc-12x10-unorm"_s;
    case GPUTextureFormat::Astc12x10UnormSRGB:
        return "astc-12x10-unorm-srgb"_s;
    case GPUTextureFormat::Astc12x12Unorm:
        return "astc-12x12-unorm"_s;
    case GPUTextureFormat::Astc12x12UnormSRGB:
        return "astc-12x12-unorm-srgb"_s;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

}
