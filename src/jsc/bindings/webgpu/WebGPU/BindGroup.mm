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
#import "BindGroup.h"

#import "APIConversions.h"
#import "BindGroupLayout.h"
#import "Buffer.h"
#import "Device.h"
#import "ExternalTexture.h"
#import "MetalSPI.h"
#import "Sampler.h"
#import "TextureView.h"
#import <ranges>
#import <wtf/EnumeratedArray.h>
#import <wtf/TZoneMallocInlines.h>
#import <wtf/spi/cocoa/IOSurfaceSPI.h>

#if USE(APPLE_INTERNAL_SDK)
#include <CoreVideo/CVPixelBufferPrivate.h>
#else

// FIXME: Move to CoreVideoSPI.h.
enum {
    kCVPixelFormatType_420YpCbCr10PackedBiPlanarVideoRange = 'p420',
    kCVPixelFormatType_422YpCbCr10PackedBiPlanarVideoRange = 'p422',
    kCVPixelFormatType_444YpCbCr10PackedBiPlanarVideoRange = 'p444',
#if HAVE(COREVIDEO_COMPRESSED_PIXEL_FORMAT_TYPES)
    kCVPixelFormatType_AGX_420YpCbCr8BiPlanarVideoRange = '&8v0',
    kCVPixelFormatType_AGX_420YpCbCr8BiPlanarFullRange = '&8f0',
#endif
};
#endif

namespace WebGPU {

namespace {
constexpr auto maxResourceUsageValue = MTLResourceUsageRead | MTLResourceUsageWrite;
constexpr ShaderStage stagesPlusUndefined[] = { ShaderStage::Vertex, ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Undefined };
constexpr ShaderStage stages[] = { ShaderStage::Vertex, ShaderStage::Fragment, ShaderStage::Compute };
constexpr size_t stageCount = std::size(stages);
constexpr size_t stagesPlusUndefinedCount = std::size(stagesPlusUndefined);
}

static bool NODELETE bufferIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.buffer;
}

static bool NODELETE samplerIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.sampler;
}

static bool NODELETE textureIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.texture;
}

static bool NODELETE textureViewIsPresent(const WGPUBindGroupEntry& entry)
{
    return entry.textureView;
}

static MTLRenderStages NODELETE metalRenderStage(ShaderStage shaderStage)
{
    switch (shaderStage) {
    case ShaderStage::Vertex:
        return MTLRenderStageVertex;
    case ShaderStage::Fragment:
        return MTLRenderStageFragment;
    case ShaderStage::Compute:
        return BindGroup::MTLRenderStageCompute;
    case ShaderStage::Undefined:
        return BindGroup::MTLRenderStageUndefined;
    }
}

#if HAVE(COREVIDEO_METAL_SUPPORT)

enum class TransferFunctionCV {
    kITU_R_709_2,
    kITU_R_601_4,
    kITU_R_2020,
};

enum class PixelRange {
    Video,
    Full
};

static PixelRange NODELETE pixelRangeFromPixelFormat(OSType pixelFormat)
{
    switch (pixelFormat) {
    case kCVPixelFormatType_4444AYpCbCr8:
    case kCVPixelFormatType_4444AYpCbCr16:
    case kCVPixelFormatType_422YpCbCr_4A_8BiPlanar:
    case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange:
    case kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange:
    case kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange:
    case kCVPixelFormatType_444YpCbCr10BiPlanarVideoRange:
#if HAVE(COREVIDEO_COMPRESSED_PIXEL_FORMAT_TYPES)
    case kCVPixelFormatType_AGX_420YpCbCr8BiPlanarVideoRange:
#endif
        return PixelRange::Video;
    case kCVPixelFormatType_420YpCbCr8PlanarFullRange:
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange:
    case kCVPixelFormatType_422YpCbCr8FullRange:
    case kCVPixelFormatType_ARGB2101010LEPacked:
    case kCVPixelFormatType_420YpCbCr10BiPlanarFullRange:
    case kCVPixelFormatType_422YpCbCr10BiPlanarFullRange:
    case kCVPixelFormatType_444YpCbCr10BiPlanarFullRange:
#if HAVE(COREVIDEO_COMPRESSED_PIXEL_FORMAT_TYPES)
    case kCVPixelFormatType_AGX_420YpCbCr8BiPlanarFullRange:
#endif
        return PixelRange::Full;
    default:
        return PixelRange::Video;
    }
}

static TransferFunctionCV transferFunctionFromString(RetainPtr<CFStringRef> string)
{
    CFStringRef cfString = string.get();
    if (!string || CFEqual(cfString, kCVImageBufferYCbCrMatrix_ITU_R_709_2))
        return TransferFunctionCV::kITU_R_709_2;
    if (CFEqual(cfString, kCVImageBufferYCbCrMatrix_ITU_R_601_4))
        return TransferFunctionCV::kITU_R_601_4;
    if (CFEqual(cfString, kCVImageBufferYCbCrMatrix_ITU_R_2020))
        return TransferFunctionCV::kITU_R_2020;

    ASSERT_NOT_REACHED("Unexpected transfer function format");
    return TransferFunctionCV::kITU_R_709_2;
}

static simd::float4x3 colorSpaceConversionMatrixForPixelBuffer(CVPixelBufferRef pixelBuffer)
{
    auto format = CVPixelBufferGetPixelFormatType(pixelBuffer);
    auto range = pixelRangeFromPixelFormat(format);
    auto transferFunction = transferFunctionFromString(adoptCF((CFStringRef)CVBufferCopyAttachment(pixelBuffer, kCVImageBufferYCbCrMatrixKey, nil)));

    switch (transferFunction) {
    case TransferFunctionCV::kITU_R_709_2: {
        switch (range) {
        case PixelRange::Full:
            return simd::float4x3(simd::make_float3(+1.00000f, +1.00000f, +1.00000f),
                simd::make_float3(-0.00012f, -0.18726f, +1.85559f),
                simd::make_float3(+1.57471f, -0.46814f, +0.00012f),
                simd::make_float3(-0.78729f, +0.32770f, -0.92786f));
        case PixelRange::Video:
            return simd::float4x3(simd::make_float3(+1.16895f, +1.16895f, +1.16895f),
                simd::make_float3(-0.00012f, -0.21399f, +2.12073f),
                simd::make_float3(+1.79968f, -0.53503f, +0.00012f),
                simd::make_float3(-0.97284f, +0.30145f, -1.13348f));
        }
    }

    case TransferFunctionCV::kITU_R_601_4: {
        switch (range) {
        case PixelRange::Full:
            return simd::float4x3(simd::make_float3(+1.00000f, +1.00000f, +1.00000f),
                simd::make_float3(-0.00100f, -0.34375f, +1.77221f),
                simd::make_float3(+1.40173f, -0.71411f, +0.00100f),
                simd::make_float3(-0.70038f, +0.51672f, -0.88660f));

        case PixelRange::Video:
            return simd::float4x3(simd::make_float3(+1.16895f, +1.16895f, +1.16895f),
                simd::make_float3(-0.00110f, -0.39282f, +2.02527f),
                simd::make_float3(+1.60193f, -0.81616f, +0.00110f),
                simd::make_float3(-0.87347f, +0.53143f, -1.08624f));
        }
    }

    case TransferFunctionCV::kITU_R_2020: {
        switch (range) {
        case PixelRange::Full:
            return simd::float4x3(simd::make_float3(+1.00000f, +1.00000f, +1.00000f),
                simd::make_float3(+0.00000f, -0.16455f, +1.88135f),
                simd::make_float3(+1.47461f, -0.57129f, -0.00012f),
                simd::make_float3(-0.73730f, +0.36792f, -0.94061f));
        case PixelRange::Video:
            return simd::float4x3(simd::make_float3(+1.16895f, +1.16895f, +1.16895f),
                simd::make_float3(+0.00000f, -0.18799f, +2.15015f),
                simd::make_float3(+1.68530f, -0.65295f, +0.00012f),
                simd::make_float3(-0.91571f, +0.34741f, -1.14807f));
        }
    } }
}

static MTLPixelFormat metalPixelFormat(CVPixelBufferRef pixelBuffer, size_t plane, std::optional<MTLTextureSwizzleChannels>& swizzle, bool supportsExtendedFormats)
{
    auto pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer);
    auto biplanarFormat = [](int plane) {
        return plane ? MTLPixelFormatRG8Unorm : MTLPixelFormatR8Unorm;
    };

    switch (pixelFormat) {
    case kCVPixelFormatType_1Monochrome: /* 1 bit indexed */
    case kCVPixelFormatType_2Indexed: /* 2 bit indexed */
    case kCVPixelFormatType_4Indexed: /* 4 bit indexed */
    case kCVPixelFormatType_8Indexed: /* 8 bit indexed */
    case kCVPixelFormatType_1IndexedGray_WhiteIsZero: /* 1 bit indexed gray, white is zero */
    case kCVPixelFormatType_2IndexedGray_WhiteIsZero: /* 2 bit indexed gray, white is zero */
    case kCVPixelFormatType_4IndexedGray_WhiteIsZero: /* 4 bit indexed gray, white is zero */
    case kCVPixelFormatType_8IndexedGray_WhiteIsZero: /* 8 bit indexed gray, white is zero */
        return MTLPixelFormatA8Unorm;

    case kCVPixelFormatType_16BE555: /* 16 bit BE RGB 555 */
    case kCVPixelFormatType_16LE555:     /* 16 bit LE RGB 555 */
    case kCVPixelFormatType_16LE5551:     /* 16 bit LE RGB 5551 */
        return MTLPixelFormatBGR5A1Unorm;

    case kCVPixelFormatType_16BE565:     /* 16 bit BE RGB 565 */
    case kCVPixelFormatType_16LE565:     /* 16 bit LE RGB 565 */
        return MTLPixelFormatB5G6R5Unorm;

    case kCVPixelFormatType_24RGB: /* 24 bit RGB */
        return MTLPixelFormatRGBA8Unorm;
    case kCVPixelFormatType_32ABGR:     /* 32 bit ABGR */
        swizzle = MTLTextureSwizzleChannelsMake(MTLTextureSwizzleGreen, MTLTextureSwizzleZero, MTLTextureSwizzleZero, MTLTextureSwizzleZero);
        return MTLPixelFormatBGRA8Unorm;
    case kCVPixelFormatType_32ARGB: /* 32 bit ARGB */
        swizzle = MTLTextureSwizzleChannelsMake(MTLTextureSwizzleGreen, MTLTextureSwizzleZero, MTLTextureSwizzleZero, MTLTextureSwizzleZero);
        return MTLPixelFormatRGBA8Unorm;
    case kCVPixelFormatType_24BGR:     /* 24 bit BGR */
    case kCVPixelFormatType_32BGRA:     /* 32 bit BGRA */
        return MTLPixelFormatBGRA8Unorm;
    case kCVPixelFormatType_32RGBA:     /* 32 bit RGBA */
        return MTLPixelFormatRGBA8Unorm;
    case kCVPixelFormatType_64ARGB:     /* 64 bit ARGB, 16-bit big-endian samples */
        swizzle = MTLTextureSwizzleChannelsMake(MTLTextureSwizzleGreen, MTLTextureSwizzleZero, MTLTextureSwizzleZero, MTLTextureSwizzleZero);
        [[fallthrough]];
    case kCVPixelFormatType_64RGBALE:     /* 64 bit RGBA, 16-bit little-endian full-range (0-65535) samples */
        return MTLPixelFormatRGBA16Unorm;

    case kCVPixelFormatType_48RGB:     /* 48 bit RGB, 16-bit big-endian samples */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatBGRA8Unorm;

    case kCVPixelFormatType_32AlphaGray:     /* 32 bit AlphaGray, 16-bit big-endian samples, black is zero */
        return MTLPixelFormatR32Float;

    case kCVPixelFormatType_16Gray:     /* 16 bit Grayscale, 16-bit big-endian samples, black is zero */
        return MTLPixelFormatR16Float;

    case kCVPixelFormatType_30RGB:     /* 30 bit RGB, 10-bit big-endian samples, 2 unused padding bits (at least significant end). */
        return MTLPixelFormatBGR10A2Unorm;

    case kCVPixelFormatType_422YpCbCr8:     /* Component Y'CbCr 8-bit 4:2:2, ordered Cb Y'0 Cr Y'1 */
        return biplanarFormat(plane);

    case kCVPixelFormatType_4444YpCbCrA8:     /* Component Y'CbCrA 8-bit 4:4:4:4, ordered Cb Y' Cr A */
    case kCVPixelFormatType_4444YpCbCrA8R:     /* Component Y'CbCrA 8-bit 4:4:4:4, rendering format. full range alpha, zero biased YUV, ordered A Y' Cb Cr */
    case kCVPixelFormatType_4444AYpCbCr8:     /* Component Y'CbCrA 8-bit 4:4:4:4, ordered A Y' Cb Cr, full range alpha, video range Y'CbCr. */
    case kCVPixelFormatType_4444AYpCbCr16:     /* Component Y'CbCrA 16-bit 4:4:4:4, ordered A Y' Cb Cr, full range alpha, video range Y'CbCr, 16-bit little-endian samples. */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatBGRA8Unorm;

    case kCVPixelFormatType_444YpCbCr8:     /* Component Y'CbCr 8-bit 4:4:4, ordered Cr Y' Cb, video range Y'CbCr */
        return biplanarFormat(plane);

    case kCVPixelFormatType_422YpCbCr16:     /* Component Y'CbCr 10,12,14,16-bit 4:2:2 */
        ASSERT_NOT_REACHED();
        return biplanarFormat(plane);

    case kCVPixelFormatType_422YpCbCr10:     /* Component Y'CbCr 10-bit 4:2:2 */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR8_422_1P) : biplanarFormat(plane);

    case kCVPixelFormatType_444YpCbCr10:     /* Component Y'CbCr 10-bit 4:4:4 */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_444_1P) : biplanarFormat(plane);

    case kCVPixelFormatType_420YpCbCr8Planar:   /* Planar Component Y'CbCr 8-bit 4:2:0.  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrPlanar struct */
        return biplanarFormat(plane);

    case kCVPixelFormatType_420YpCbCr8PlanarFullRange:   /* Planar Component Y'CbCr 8-bit 4:2:0, full range.  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrPlanar struct */
    case kCVPixelFormatType_422YpCbCr_4A_8BiPlanar: /* First plane: Video-range Component Y'CbCr 8-bit 4:2:2, ordered Cb Y'0 Cr Y'1; second plane: alpha 8-bit 0-255 */
        return biplanarFormat(plane);

    case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange: /* Bi-Planar Component Y'CbCr 8-bit 4:2:0, video-range (luma=[16,235] chroma=[16,240]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange: /* Bi-Planar Component Y'CbCr 8-bit 4:2:0, full-range (luma=[0,255] chroma=[1,255]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
        return biplanarFormat(plane);

    case kCVPixelFormatType_422YpCbCr8BiPlanarVideoRange: /* Bi-Planar Component Y'CbCr 8-bit 4:2:2, video-range (luma=[16,235] chroma=[16,240]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
    case kCVPixelFormatType_422YpCbCr8BiPlanarFullRange: /* Bi-Planar Component Y'CbCr 8-bit 4:2:2, full-range (luma=[0,255] chroma=[1,255]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
        return biplanarFormat(plane);

    case kCVPixelFormatType_444YpCbCr8BiPlanarVideoRange: /* Bi-Planar Component Y'CbCr 8-bit 4:4:4, video-range (luma=[16,235] chroma=[16,240]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
    case kCVPixelFormatType_444YpCbCr8BiPlanarFullRange: /* Bi-Planar Component Y'CbCr 8-bit 4:4:4, full-range (luma=[0,255] chroma=[1,255]).  baseAddr points to a big-endian CVPlanarPixelBufferInfo_YCbCrBiPlanar struct */
        return biplanarFormat(plane);

    case kCVPixelFormatType_422YpCbCr8_yuvs:     /* Component Y'CbCr 8-bit 4:2:2, ordered Y'0 Cb Y'1 Cr */
    case kCVPixelFormatType_422YpCbCr8FullRange: /* Component Y'CbCr 8-bit 4:2:2, full range, ordered Y'0 Cb Y'1 Cr */
        return biplanarFormat(plane);

    case kCVPixelFormatType_OneComponent8:     /* 8 bit one component, black is zero */
        return MTLPixelFormatR8Unorm;

    case kCVPixelFormatType_TwoComponent8:     /* 8 bit two component, black is zero */
        return MTLPixelFormatRG8Unorm;

    case kCVPixelFormatType_30RGBLEPackedWideGamut: /* little-endian RGB101010, 2 MSB are zero, wide-gamut (384-895) */
        return MTLPixelFormatRGB10A2Unorm;
    case kCVPixelFormatType_ARGB2101010LEPacked:     /* little-endian ARGB2101010 full-range ARGB */
        swizzle = MTLTextureSwizzleChannelsMake(MTLTextureSwizzleGreen, MTLTextureSwizzleZero, MTLTextureSwizzleZero, MTLTextureSwizzleZero);
        return MTLPixelFormatRGB10A2Unorm;

    case kCVPixelFormatType_40ARGBLEWideGamut: /* little-endian ARGB10101010, each 10 bits in the MSBs of 16bits, wide-gamut (384-895, including alpha) */
    case kCVPixelFormatType_40ARGBLEWideGamutPremultiplied: /* little-endian ARGB10101010, each 10 bits in the MSBs of 16bits, wide-gamut (384-895, including alpha). Alpha premultiplied */
        return MTLPixelFormatInvalid;

    case kCVPixelFormatType_OneComponent10:     /* 10 bit little-endian one component, stored as 10 MSBs of 16 bits, black is zero */
        return MTLPixelFormatInvalid;

    case kCVPixelFormatType_OneComponent12:     /* 12 bit little-endian one component, stored as 12 MSBs of 16 bits, black is zero */
        return MTLPixelFormatInvalid;

    case kCVPixelFormatType_OneComponent16:     /* 16 bit little-endian one component, black is zero */
        return MTLPixelFormatR16Unorm;

    case kCVPixelFormatType_TwoComponent16:     /* 16 bit little-endian two component, black is zero */
        return MTLPixelFormatRG16Unorm;

    case kCVPixelFormatType_OneComponent16Half:     /* 16 bit one component IEEE half-precision float, 16-bit little-endian samples */
        return MTLPixelFormatR16Float;

    case kCVPixelFormatType_OneComponent32Float:     /* 32 bit one component IEEE float, 32-bit little-endian samples */
        return MTLPixelFormatR32Float;

    case kCVPixelFormatType_TwoComponent16Half:     /* 16 bit two component IEEE half-precision float, 16-bit little-endian samples */
        return MTLPixelFormatRG16Float;

    case kCVPixelFormatType_TwoComponent32Float:     /* 32 bit two component IEEE float, 32-bit little-endian samples */
        return MTLPixelFormatRG32Float;

    case kCVPixelFormatType_64RGBAHalf:     /* 64 bit RGBA IEEE half-precision float, 16-bit little-endian samples */
        return MTLPixelFormatRGBA16Float;

    case kCVPixelFormatType_128RGBAFloat:     /* 128 bit RGBA IEEE float, 32-bit little-endian samples */
        return MTLPixelFormatRGBA32Float;

    case kCVPixelFormatType_14Bayer_GRBG:     /* Bayer 14-bit Little-Endian, packed in 16-bits, ordered G R G R... alternating with B G B G... */
    case kCVPixelFormatType_14Bayer_RGGB:     /* Bayer 14-bit Little-Endian, packed in 16-bits, ordered R G R G... alternating with G B G B... */
    case kCVPixelFormatType_14Bayer_BGGR:     /* Bayer 14-bit Little-Endian, packed in 16-bits, ordered B G B G... alternating with G R G R... */
    case kCVPixelFormatType_14Bayer_GBRG:     /* Bayer 14-bit Little-Endian, packed in 16-bits, ordered G B G B... alternating with R G R G... */
    case kCVPixelFormatType_DisparityFloat16:     /* IEEE754-2008 binary16 (half float), describing the normalized shift when comparing two images. Units are 1/meters: ( pixelShift / (pixelFocalLength * baselineInMeters) ) */
    case kCVPixelFormatType_DisparityFloat32:     /* IEEE754-2008 binary32 float, describing the normalized shift when comparing two images. Units are 1/meters: ( pixelShift / (pixelFocalLength * baselineInMeters) ) */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatBGRA8Unorm;

    case kCVPixelFormatType_DepthFloat16:     /* IEEE754-2008 binary16 (half float), describing the depth (distance to an object) in meters */
        return MTLPixelFormatDepth16Unorm;
    case kCVPixelFormatType_DepthFloat32:     /* IEEE754-2008 binary32 float, describing the depth (distance to an object) in meters */
        return MTLPixelFormatDepth32Float;

    case kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange: /* 2 plane YCbCr10 4:2:0, each 10 bits in the MSBs of 16bits, video-range (luma=[64,940] chroma=[64,960]) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_420_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange: /* 2 plane YCbCr10 4:2:2, each 10 bits in the MSBs of 16bits, video-range (luma=[64,940] chroma=[64,960]) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_444YpCbCr10BiPlanarVideoRange: /* 2 plane YCbCr10 4:4:4, each 10 bits in the MSBs of 16bits, video-range (luma=[64,940] chroma=[64,960]) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_444_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_420YpCbCr10BiPlanarFullRange: /* 2 plane YCbCr10 4:2:0, each 10 bits in the MSBs of 16bits, full-range (Y range 0-1023) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_422YpCbCr10BiPlanarFullRange: /* 2 plane YCbCr10 4:2:2, each 10 bits in the MSBs of 16bits, full-range (Y range 0-1023) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_444YpCbCr10BiPlanarFullRange: /* 2 plane YCbCr10 4:4:4, each 10 bits in the MSBs of 16bits, full-range (Y range 0-1023) */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_444_2P) : biplanarFormat(plane);
    case kCVPixelFormatType_420YpCbCr8VideoRange_8A_TriPlanar: /* first and second planes as per 420YpCbCr8BiPlanarVideoRange (420v), alpha 8 bits in third plane full-range.  No CVPlanarPixelBufferInfo struct. */
        return biplanarFormat(plane);

    case kCVPixelFormatType_16VersatileBayer:   /* Single plane Bayer 16-bit little-endian sensor element ("sensel") samples from full-size decoding of ProRes RAW images; Bayer pattern (sensel ordering) and other raw conversion information is described via buffer attachments */
    case kCVPixelFormatType_64RGBA_DownscaledProResRAW:   /* Single plane 64-bit RGBA (16-bit little-endian samples) from downscaled decoding of ProRes RAW images; components--which may not be co-sited with one another--are sensel values and require raw conversion, information for which is described via buffer attachments */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatBGRA8Unorm;

    case kCVPixelFormatType_422YpCbCr16BiPlanarVideoRange: /* 2 plane YCbCr16 4:2:2, video-range (luma=[4096,60160] chroma=[4096,61440]) */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatInvalid;

    case kCVPixelFormatType_444YpCbCr16BiPlanarVideoRange: /* 2 plane YCbCr16 4:4:4, video-range (luma=[4096,60160] chroma=[4096,61440]) */
    case kCVPixelFormatType_444YpCbCr16VideoRange_16A_TriPlanar: /* 3 plane video-range YCbCr16 4:4:4 with 16-bit full-range alpha (luma=[4096,60160] chroma=[4096,61440] alpha=[0,65535]).  No CVPlanarPixelBufferInfo struct. */
        ASSERT_NOT_REACHED();
        return MTLPixelFormatInvalid;

    case kCVPixelFormatType_Lossless_32BGRA: /* Lossless-compressed form of case kCVPixelFormatType_32BGRA. */
        return MTLPixelFormatBGRA8Unorm;

        // Lossless-compressed Bi-planar YCbCr pixel format types
    case kCVPixelFormatType_Lossless_420YpCbCr8BiPlanarVideoRange: /* Lossless-compressed form of case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. */
    case kCVPixelFormatType_Lossless_420YpCbCr8BiPlanarFullRange: /* Lossless-compressed form of case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange.  No CVPlanarPixelBufferInfo struct. */
        return biplanarFormat(plane);

    case kCVPixelFormatType_Lossless_420YpCbCr10PackedBiPlanarVideoRange: /* Lossless-compressed-packed form of case kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. Format is compressed-packed with no padding bits between pixels. */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_420_2P_PACKED) : biplanarFormat(plane);

    case kCVPixelFormatType_Lossless_422YpCbCr10PackedBiPlanarVideoRange: /* Lossless-compressed form of case kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. Format is compressed-packed with no padding bits between pixels. */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P_PACKED) : biplanarFormat(plane);

    case kCVPixelFormatType_Lossy_32BGRA: /* Lossy-compressed form of case kCVPixelFormatType_32BGRA. No CVPlanarPixelBufferInfo struct.  */
        return MTLPixelFormatBGRA8Unorm;

    case kCVPixelFormatType_Lossy_420YpCbCr8BiPlanarVideoRange: /* Lossy-compressed form of case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. */
    case kCVPixelFormatType_Lossy_420YpCbCr8BiPlanarFullRange: /* Lossy-compressed form of case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange.  No CVPlanarPixelBufferInfo struct. */
        return biplanarFormat(plane);

    case kCVPixelFormatType_Lossy_420YpCbCr10PackedBiPlanarVideoRange: /* Lossy-compressed form of case kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. Format is compressed-packed with no padding bits between pixels. */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_420_2P_PACKED_PQ) : biplanarFormat(plane);

    case kCVPixelFormatType_Lossy_422YpCbCr10PackedBiPlanarVideoRange: /* Lossy-compressed form of kCVPixelFormatType_422YpCbCr10BiPlanarVideoRange.  No CVPlanarPixelBufferInfo struct. Format is compressed-packed with no padding bits between pixels. */
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P_PACKED) : biplanarFormat(plane);

    case kCVPixelFormatType_420YpCbCr10PackedBiPlanarVideoRange:
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_420_2P_PACKED) : biplanarFormat(plane);
    case kCVPixelFormatType_422YpCbCr10PackedBiPlanarVideoRange:
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_422_2P_PACKED) : biplanarFormat(plane);
    case kCVPixelFormatType_444YpCbCr10PackedBiPlanarVideoRange:
        return !plane && supportsExtendedFormats ? static_cast<MTLPixelFormat>(MTLPixelFormatYCBCR10_444_2P_PACKED) : biplanarFormat(plane);
    }

    return MTLPixelFormatInvalid;
}

#endif

Device::ExternalTextureData Device::createExternalTextureFromPixelBuffer(CVPixelBufferRef pixelBuffer, WGPUColorSpace colorSpace) const
{
#if HAVE(COREVIDEO_METAL_SUPPORT)
    UNUSED_PARAM(colorSpace);

    std::optional<MTLTextureSwizzleChannels> firstPlaneSwizzle, secondPlaneSwizzle;
    auto gbTextureFromRGB = ^(id<MTLTexture> texture, bool alphaFirst) {
        return [texture newTextureViewWithPixelFormat:texture.pixelFormat textureType:texture.textureType levels:NSMakeRange(0, texture.mipmapLevelCount) slices:NSMakeRange(0, texture.arrayLength) swizzle:alphaFirst ? MTLTextureSwizzleChannelsMake(MTLTextureSwizzleBlue, MTLTextureSwizzleAlpha, MTLTextureSwizzleZero, MTLTextureSwizzleZero) : MTLTextureSwizzleChannelsMake(MTLTextureSwizzleGreen, MTLTextureSwizzleBlue, MTLTextureSwizzleZero, MTLTextureSwizzleZero)];
    };

    CVMetalTextureCacheFlush(m_coreVideoTextureCache.get(), 0);
    const bool supportsExtendedFormats = [m_device supportsFamily:MTLGPUFamilyApple4];
    IOSurfaceRef ioSurface = CVPixelBufferGetIOSurface(pixelBuffer);
    if (!ioSurface || isIntel()) {
        auto planeCount = std::max<size_t>(CVPixelBufferGetPlaneCount(pixelBuffer), 1);
        if (planeCount > 2) {
            ASSERT_NOT_REACHED("non-IOSurface CVPixelBuffer instances with more than two planes are not supported");
            return { };
        }

        CVReturn status = CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
        if (status != kCVReturnSuccess)
            return { };

        std::array<id<MTLTexture>, 2> mtlTextures { };

        for (size_t plane = 0; plane < planeCount; ++plane) {
            int width = CVPixelBufferGetWidthOfPlane(pixelBuffer, plane);
            int height = CVPixelBufferGetHeightOfPlane(pixelBuffer, plane);

            MTLTextureDescriptor *textureDescriptor = [MTLTextureDescriptor new];
            textureDescriptor.usage = MTLTextureUsageShaderRead;
            textureDescriptor.textureType = MTLTextureType2D;
            textureDescriptor.width = width;
            textureDescriptor.height = height;
            textureDescriptor.pixelFormat = metalPixelFormat(pixelBuffer, plane, firstPlaneSwizzle, supportsExtendedFormats);
            if (firstPlaneSwizzle)
                textureDescriptor.swizzle = *firstPlaneSwizzle;
            textureDescriptor.mipmapLevelCount = 1;
            textureDescriptor.sampleCount = 1;
#if 1 /* PLATFORM(MAC) */ || 0 /* PLATFORM(MACCATALYST) */
            ALLOW_DEPRECATED_DECLARATIONS_BEGIN
            textureDescriptor.storageMode = hasUnifiedMemory() ? MTLStorageModeShared : MTLStorageModeManaged;
            ALLOW_DEPRECATED_DECLARATIONS_END
#else
            textureDescriptor.storageMode = hasUnifiedMemory() ? MTLStorageModeShared : MTLStorageModePrivate;
#endif

            id<MTLTexture> mtlTexture = [m_device newTextureWithDescriptor:textureDescriptor];
            if (!mtlTexture)
                return { };

            uint8_t *imageBytes = static_cast<uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, plane));
            int bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, plane);

            [mtlTexture replaceRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0 withBytes:imageBytes bytesPerRow:bytesPerRow];
            mtlTextures[plane] = mtlTexture;
        }

        CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

        simd::float4x3 colorSpaceConversionMatrix;
        if (planeCount > 1)
            colorSpaceConversionMatrix = colorSpaceConversionMatrixForPixelBuffer(pixelBuffer);
        else {
            colorSpaceConversionMatrix = simd::float4x3(1.f);
            mtlTextures[1] = gbTextureFromRGB(mtlTextures[0], firstPlaneSwizzle.has_value());
        }

        return { mtlTextures[0], mtlTextures[1], simd::float3x2(1.f), colorSpaceConversionMatrix };
    }

    if (auto optionalWebProcessID = webProcessID()) {
        if (auto webProcessID = optionalWebProcessID->sendRight())
            IOSurfaceSetOwnershipIdentity(ioSurface, webProcessID, kIOSurfaceMemoryLedgerTagGraphics, 0);
    }

    id<MTLTexture> baseTexture = nil;
    id<MTLTexture> mtlTexture0 = nil;
    id<MTLTexture> mtlTexture1 = nil;

    CVMetalTextureRef plane0 = nullptr;
    CVMetalTextureRef plane1 = nullptr;
    auto planeCount = CVPixelBufferGetPlaneCount(pixelBuffer);
    CVReturn status1 = kCVReturnInvalidPixelFormat;
    CVReturn status2 = kCVReturnInvalidPixelFormat;
    if (planeCount < 2)
        status1 = CVMetalTextureCacheCreateTextureFromImage(nullptr, m_coreVideoTextureCache.get(), pixelBuffer, nullptr, metalPixelFormat(pixelBuffer, 0, firstPlaneSwizzle, supportsExtendedFormats), CVPixelBufferGetWidthOfPlane(pixelBuffer, 0), CVPixelBufferGetHeightOfPlane(pixelBuffer, 0), 0, &plane0);
    else {
        auto format0 = metalPixelFormat(pixelBuffer, 0, firstPlaneSwizzle, supportsExtendedFormats);
        if (format0 != MTLPixelFormatInvalid)
            status1 = CVMetalTextureCacheCreateTextureFromImage(nullptr, m_coreVideoTextureCache.get(), pixelBuffer, nullptr, format0, CVPixelBufferGetWidthOfPlane(pixelBuffer, 0), CVPixelBufferGetHeightOfPlane(pixelBuffer, 0), 0, &plane0);
        auto format1 = metalPixelFormat(pixelBuffer, 1, secondPlaneSwizzle, supportsExtendedFormats);
        if (format1 != MTLPixelFormatInvalid)
            status2 = CVMetalTextureCacheCreateTextureFromImage(nullptr, m_coreVideoTextureCache.get(), pixelBuffer, nullptr, format1, CVPixelBufferGetWidthOfPlane(pixelBuffer, 1), CVPixelBufferGetHeightOfPlane(pixelBuffer, 1), 1, &plane1);
    }

    std::array<float, 2> lowerLeft;
    std::array<float, 2> lowerRight;
    std::array<float, 2> upperRight;
    std::array<float, 2> upperLeft;

    if (status1 == kCVReturnSuccess) {
        baseTexture = mtlTexture0 = CVMetalTextureGetTexture(plane0);
        setOwnerWithIdentity(mtlTexture0);
        CVMetalTextureGetCleanTexCoords(plane0, lowerLeft.begin(), lowerRight.begin(), upperRight.begin(), upperLeft.begin());
        if (firstPlaneSwizzle)
            mtlTexture0 = [mtlTexture0 newTextureViewWithPixelFormat:mtlTexture0.pixelFormat textureType:mtlTexture0.textureType levels:NSMakeRange(0, mtlTexture0.mipmapLevelCount) slices:NSMakeRange(0, mtlTexture0.arrayLength) swizzle:*firstPlaneSwizzle];
    } else {
        if (plane1)
            CFRelease(plane1);
        return { };
    }

    if (status2 == kCVReturnSuccess) {
        mtlTexture1 = CVMetalTextureGetTexture(plane1);
        setOwnerWithIdentity(mtlTexture1);
        if (secondPlaneSwizzle)
            mtlTexture1 = [mtlTexture1 newTextureViewWithPixelFormat:mtlTexture1.pixelFormat textureType:mtlTexture1.textureType levels:NSMakeRange(0, mtlTexture1.mipmapLevelCount) slices:NSMakeRange(0, mtlTexture1.arrayLength) swizzle:*secondPlaneSwizzle];
    }

    protect(m_defaultQueue)->onSubmittedWorkDone([plane0, plane1](WGPUQueueWorkDoneStatus) {
        if (plane0)
            CFRelease(plane0);

        if (plane1)
            CFRelease(plane1);
    });

    float Ax = 1.f / (upperRight[0] - lowerLeft[0]);
    float Bx = -Ax * lowerLeft[0];
    float Ay = 1.f / (lowerRight[1] - upperLeft[1]);
    float By = -Ay * upperLeft[1];
    simd::float3x2 uvRemappingMatrix = simd::float3x2(simd::make_float2(Ax, 0.f), simd::make_float2(0.f, Ay), simd::make_float2(Bx, By));
    simd::float4x3 colorSpaceConversionMatrix = mtlTexture1 ? colorSpaceConversionMatrixForPixelBuffer(pixelBuffer) : simd::float4x3(1.f);
    if (!mtlTexture1)
        mtlTexture1 = gbTextureFromRGB(baseTexture, firstPlaneSwizzle.has_value());

    return { mtlTexture0, mtlTexture1, uvRemappingMatrix, colorSpaceConversionMatrix };
#else
    UNUSED_PARAM(pixelBuffer);
    UNUSED_PARAM(colorSpace);
    return { };
#endif
}

static bool NODELETE hasProperUsageFlags(WGPUBufferBindingType bufferType, WGPUBufferUsageFlags usage)
{
    switch (bufferType) {
    case WGPUBufferBindingType_Uniform:
        return usage & WGPUBufferUsage_Uniform;
    case WGPUBufferBindingType_Storage:
    case WGPUBufferBindingType_ReadOnlyStorage:
        return usage & WGPUBufferUsage_Storage;
    case WGPUBufferBindingType_Undefined:
    case WGPUBufferBindingType_Force32:
        ASSERT_NOT_REACHED();
        return false;
    }
}

static MTLResourceUsage NODELETE resourceUsageForBindingAcccess(BindGroupLayout::BindingAccess bindingAccess)
{
    switch (bindingAccess) {
    case BindGroupLayout::BindingAccessReadOnly:
        return MTLResourceUsageRead;
    case BindGroupLayout::BindingAccessWriteOnly:
        return MTLResourceUsageWrite;
    case BindGroupLayout::BindingAccessReadWrite:
        return MTLResourceUsageRead | MTLResourceUsageWrite;
    }
}

template <typename ExpectedType>
static const ExpectedType* hasBinding(const BindGroupLayout::EntriesContainer& bindGroupLayoutEntries, auto bindingIndex)
{
    auto it = bindGroupLayoutEntries.find(bindingIndex);
    RELEASE_ASSERT(it != bindGroupLayoutEntries.end());
    return std::get_if<ExpectedType>(&it->value.bindingLayout);
}

static bool is32bppFloatFormat(id<MTLTexture> t)
{
    return t.pixelFormat == MTLPixelFormatR32Float || t.pixelFormat == MTLPixelFormatRG32Float || t.pixelFormat == MTLPixelFormatRGBA32Float;
}

static bool NODELETE valid32bppFloatSampleType(WGPUTextureSampleType sampleType)
{
    return sampleType == WGPUTextureSampleType_Float || sampleType == WGPUTextureSampleType_UnfilterableFloat;
}

enum FormatType {
    FormatType_Undefined = 0,
    FormatType_Float = 1 << 0,
    FormatType_UnfilterableFloat = 1 << 1,
    FormatType_Depth = 1 << 2,
    FormatType_SignedInt = 1 << 3,
    FormatType_UnsignedInt = 1 << 4
};

static std::underlying_type<FormatType>::type formatType(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    switch (format) {
    case WGPUTextureFormat_R8Unorm:
    case WGPUTextureFormat_R8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_R8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R16Unorm:
    case WGPUTextureFormat_R16Snorm:
    case WGPUTextureFormat_RG16Unorm:
    case WGPUTextureFormat_RG16Snorm:
    case WGPUTextureFormat_RGBA16Unorm:
    case WGPUTextureFormat_RGBA16Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_R16Float:
    case WGPUTextureFormat_RG8Unorm:
    case WGPUTextureFormat_RG8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RG8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_R32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_R32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_R32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RG16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RG16Float:
    case WGPUTextureFormat_RGBA8Unorm:
    case WGPUTextureFormat_RGBA8UnormSrgb:
    case WGPUTextureFormat_RGBA8Snorm:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGBA8Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA8Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_BGRA8Unorm:
    case WGPUTextureFormat_BGRA8UnormSrgb:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGB10A2Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGB10A2Unorm:
    case WGPUTextureFormat_RG11B10Ufloat:
    case WGPUTextureFormat_RGB9E5Ufloat:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RG32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_RG32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RG32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RGBA16Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA16Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_RGBA16Float:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_RGBA32Float:
        return FormatType_UnfilterableFloat | (device.hasFeature(WGPUFeatureName_Float32Filterable) ? FormatType_Float : 0);
    case WGPUTextureFormat_RGBA32Uint:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_RGBA32Sint:
        return FormatType_SignedInt;
    case WGPUTextureFormat_Stencil8:
        return FormatType_UnsignedInt;
    case WGPUTextureFormat_Depth16Unorm:
    case WGPUTextureFormat_Depth24Plus:
        return FormatType_Depth | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_Depth24PlusStencil8:
    case WGPUTextureFormat_Depth32FloatStencil8: {
        switch (aspect) {
        case WGPUTextureAspect_All:
            return FormatType_Depth | FormatType_UnfilterableFloat | FormatType_UnsignedInt;
        case WGPUTextureAspect_StencilOnly:
            return FormatType_UnsignedInt;
        case WGPUTextureAspect_DepthOnly:
            return FormatType_Depth | FormatType_UnfilterableFloat;
        case WGPUTextureAspect_Force32:
            RELEASE_ASSERT_NOT_REACHED();
        }
    }
    case WGPUTextureFormat_Depth32Float:
        return FormatType_Depth | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_BC1RGBAUnorm:
    case WGPUTextureFormat_BC1RGBAUnormSrgb:
    case WGPUTextureFormat_BC2RGBAUnorm:
    case WGPUTextureFormat_BC2RGBAUnormSrgb:
    case WGPUTextureFormat_BC3RGBAUnorm:
    case WGPUTextureFormat_BC3RGBAUnormSrgb:
    case WGPUTextureFormat_BC4RUnorm:
    case WGPUTextureFormat_BC4RSnorm:
    case WGPUTextureFormat_BC5RGUnorm:
    case WGPUTextureFormat_BC5RGSnorm:
    case WGPUTextureFormat_BC6HRGBUfloat:
    case WGPUTextureFormat_BC6HRGBFloat:
    case WGPUTextureFormat_BC7RGBAUnorm:
    case WGPUTextureFormat_BC7RGBAUnormSrgb:
    case WGPUTextureFormat_ETC2RGB8Unorm:
    case WGPUTextureFormat_ETC2RGB8UnormSrgb:
    case WGPUTextureFormat_ETC2RGB8A1Unorm:
    case WGPUTextureFormat_ETC2RGB8A1UnormSrgb:
    case WGPUTextureFormat_ETC2RGBA8Unorm:
    case WGPUTextureFormat_ETC2RGBA8UnormSrgb:
    case WGPUTextureFormat_EACR11Unorm:
    case WGPUTextureFormat_EACR11Snorm:
    case WGPUTextureFormat_EACRG11Unorm:
    case WGPUTextureFormat_EACRG11Snorm:
    case WGPUTextureFormat_ASTC4x4Unorm:
    case WGPUTextureFormat_ASTC4x4UnormSrgb:
    case WGPUTextureFormat_ASTC5x4Unorm:
    case WGPUTextureFormat_ASTC5x4UnormSrgb:
    case WGPUTextureFormat_ASTC5x5Unorm:
    case WGPUTextureFormat_ASTC5x5UnormSrgb:
    case WGPUTextureFormat_ASTC6x5Unorm:
    case WGPUTextureFormat_ASTC6x5UnormSrgb:
    case WGPUTextureFormat_ASTC6x6Unorm:
    case WGPUTextureFormat_ASTC6x6UnormSrgb:
    case WGPUTextureFormat_ASTC8x5Unorm:
    case WGPUTextureFormat_ASTC8x5UnormSrgb:
    case WGPUTextureFormat_ASTC8x6Unorm:
    case WGPUTextureFormat_ASTC8x6UnormSrgb:
    case WGPUTextureFormat_ASTC8x8Unorm:
    case WGPUTextureFormat_ASTC8x8UnormSrgb:
    case WGPUTextureFormat_ASTC10x5Unorm:
    case WGPUTextureFormat_ASTC10x5UnormSrgb:
    case WGPUTextureFormat_ASTC10x6Unorm:
    case WGPUTextureFormat_ASTC10x6UnormSrgb:
    case WGPUTextureFormat_ASTC10x8Unorm:
    case WGPUTextureFormat_ASTC10x8UnormSrgb:
    case WGPUTextureFormat_ASTC10x10Unorm:
    case WGPUTextureFormat_ASTC10x10UnormSrgb:
    case WGPUTextureFormat_ASTC12x10Unorm:
    case WGPUTextureFormat_ASTC12x10UnormSrgb:
    case WGPUTextureFormat_ASTC12x12Unorm:
    case WGPUTextureFormat_ASTC12x12UnormSrgb:
        return FormatType_Float | FormatType_UnfilterableFloat;
    case WGPUTextureFormat_Undefined:
    case WGPUTextureFormat_Force32:
        return FormatType_Undefined;
    }
}

static bool formatIsFloat(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_Float;
}
static bool formatIsUnfilterableFloat(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_UnfilterableFloat;
}
static bool formatIsDepth(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_Depth;
}
static bool formatIsSignedInt(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_SignedInt;
}
static bool formatIsUnsignedInt(WGPUTextureFormat format, WGPUTextureAspect aspect, const Device& device)
{
    return formatType(format, aspect, device) & FormatType_UnsignedInt;
}

static bool validateTextureSampleType(const WGPUTextureBindingLayout* textureEntry, const auto& apiTextureView, const Device& device)
{
    if (!textureEntry)
        return true;

    auto format = apiTextureView->format();
    auto aspect = apiTextureView->aspect();
    switch (textureEntry->sampleType) {
    case WGPUTextureSampleType_Float:
        return formatIsFloat(format, aspect, device);
    case WGPUTextureSampleType_UnfilterableFloat:
        return formatIsUnfilterableFloat(format, aspect, device);
    case WGPUTextureSampleType_Depth:
        return formatIsDepth(format, aspect, device);
    case WGPUTextureSampleType_Sint:
        return formatIsSignedInt(format, aspect, device);
    case WGPUTextureSampleType_Uint:
        return formatIsUnsignedInt(format, aspect, device);
    case WGPUTextureSampleType_Force32:
    case WGPUTextureSampleType_Undefined:
        return false;
    }
}

static const NSString* sampleType(const WGPUTextureBindingLayout* textureEntry)
{
    switch (textureEntry->sampleType) {
    case WGPUTextureSampleType_Float:
        return @"float";
    case WGPUTextureSampleType_UnfilterableFloat:
        return @"unfilterable-float";
    case WGPUTextureSampleType_Depth:
        return @"depth";
    case WGPUTextureSampleType_Sint:
        return @"sint";
    case WGPUTextureSampleType_Uint:
        return @"uint";
    case WGPUTextureSampleType_Force32:
    case WGPUTextureSampleType_Undefined:
        return @"unknown";
    }
}

static const NSString* sampleType(const auto& apiTextureView, const Device& device)
{
    auto format = apiTextureView->format();
    auto aspect = apiTextureView->aspect();
    auto type = formatType(format, aspect, device);

    NSString* result = @"";
#define MAKE_STRING(x) result.length ? (@" + " x) : (x)
    if (type & FormatType_Float)
        result = [result stringByAppendingString:MAKE_STRING(@"float")];
    if (type & FormatType_UnfilterableFloat)
        result = [result stringByAppendingString:MAKE_STRING(@"unfilterable-float")];
    if (type & FormatType_Depth)
        result = [result stringByAppendingString:MAKE_STRING(@"depth")];
    if (type & FormatType_SignedInt)
        result = [result stringByAppendingString:MAKE_STRING(@"sint")];
    if (type & FormatType_UnsignedInt)
        result = [result stringByAppendingString:MAKE_STRING(@"uint")];
#undef MAKE_STRING

    return result;
}

static bool validateTextureViewDimension(const auto* textureEntry, const auto& apiTextureView)
{
    if (!textureEntry)
        return true;

    WGPUTextureViewDimension viewDimension = textureEntry->viewDimension;
    auto textureType = apiTextureView->texture().textureType;
    switch (viewDimension) {
    case WGPUTextureViewDimension_1D:
        return textureType == MTLTextureType1D;
    case WGPUTextureViewDimension_2D:
        return textureType == MTLTextureType2D || textureType == MTLTextureType2DMultisample;
    case WGPUTextureViewDimension_2DArray:
        return textureType == MTLTextureType2DArray || textureType == MTLTextureType2DMultisampleArray;
    case WGPUTextureViewDimension_Cube:
        return textureType == MTLTextureTypeCube;
    case WGPUTextureViewDimension_CubeArray:
        return textureType == MTLTextureTypeCubeArray;
    case WGPUTextureViewDimension_3D:
        return textureType == MTLTextureType3D;
    case WGPUTextureViewDimension_Undefined:
    case WGPUTextureViewDimension_Force32:
        return false;
    }
}

static bool NODELETE validateStorageTextureViewFormat(const WGPUStorageTextureBindingLayout* storageTexture, const auto& apiTextureView)
{
    return !storageTexture || storageTexture->format == apiTextureView->format();
}

static bool NODELETE validateSamplerType(WGPUSamplerBindingType type, const Sampler& sampler)
{
    switch (type) {
    case WGPUSamplerBindingType_Filtering:
        return !sampler.isComparison();
    case WGPUSamplerBindingType_NonFiltering:
        return !sampler.isComparison() && !sampler.isFiltering();
    case WGPUSamplerBindingType_Comparison:
        return sampler.isComparison();
    case WGPUSamplerBindingType_Undefined:
    case WGPUSamplerBindingType_Force32:
        ASSERT_NOT_REACHED();
        return false;
    }
}

static BindGroupEntryUsage NODELETE usageForTexture(const WGPUTextureBindingLayout&)
{
    return BindGroupEntryUsage::ConstantTexture;
}

static BindGroupEntryUsage NODELETE usageForStorageTexture(const WGPUStorageTextureBindingLayout& textureLayout)
{
    switch (textureLayout.access) {
    case WGPUStorageTextureAccess_Undefined:
        return BindGroupEntryUsage::Undefined;
    case WGPUStorageTextureAccess_ReadOnly:
        return BindGroupEntryUsage::StorageTextureRead;
    case WGPUStorageTextureAccess_ReadWrite:
        return BindGroupEntryUsage::StorageTextureReadWrite;
    case WGPUStorageTextureAccess_WriteOnly:
        return BindGroupEntryUsage::StorageTextureWriteOnly;
    case WGPUStorageTextureAccess_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }

    RELEASE_ASSERT_NOT_REACHED();
    return BindGroupEntryUsage::Undefined;
}

static BindGroupEntryUsage NODELETE usageForBuffer(WGPUBufferBindingType bufferBindingType)
{
    switch (bufferBindingType) {
    case WGPUBufferBindingType_Undefined:
        return BindGroupEntryUsage::Undefined;
    case WGPUBufferBindingType_Uniform:
        return BindGroupEntryUsage::Constant;
    case WGPUBufferBindingType_Storage:
        return BindGroupEntryUsage::Storage;
    case WGPUBufferBindingType_ReadOnlyStorage:
        return BindGroupEntryUsage::StorageRead;
    case WGPUBufferBindingType_Force32:
        RELEASE_ASSERT_NOT_REACHED();
    }

    return BindGroupEntryUsage::Undefined;
}

template <typename T>
static BindGroupEntryUsageData makeBindGroupEntryUsageData(BindGroupEntryUsage usage, uint32_t bindingIndex, const Ref<T>& resource, uint64_t entryOffset = 0, uint64_t entrySize = 0)
{
    return BindGroupEntryUsageData { .usage = usage, .binding = bindingIndex, .resource = resource.ptr(), .entryOffset = entryOffset, .entrySize = entrySize };
}

static bool NODELETE allowedExternalTextureFormat(WGPUTextureFormat format)
{
    switch (format) {
    case WGPUTextureFormat_RGBA8Unorm:
    case WGPUTextureFormat_BGRA8Unorm:
    case WGPUTextureFormat_RGBA16Float:
        return true;
    default:
        return false;
    }
}

template <typename T>
static std::optional<Ref<BindGroup>> validateTextureOrBindGroup(WebGPU::Device &object, const Ref<T> &apiTextureView, BindGroup::ShaderStageArray<id<MTLBuffer>> &argumentBuffer, BindGroup::ShaderStageArray<id<MTLArgumentEncoder>> &argumentEncoder, BindGroup::ShaderStageArray<BindGroupLayout::ArgumentIndices> &argumentIndices, const Ref<BindGroupLayout> &bindGroupLayout, const WGPUBindGroupEntry &entry, const WGPUExternalTextureBindingLayout *externalTextureEntry, NSUInteger index, MTLResourceUsage resourceUsage, ShaderStage stage, std::array<std::array<Vector<BindGroupEntryUsageData>, maxResourceUsageValue>, stagesPlusUndefinedCount> &stageResourceUsages, std::array<std::array<Vector<id<MTLResource>>, maxResourceUsageValue>, stagesPlusUndefinedCount> &stageResources, const WGPUStorageTextureBindingLayout *storageTextureEntry, const WGPUTextureBindingLayout *textureEntry)
{
#define INTERNAL_ERROR_STRING(x) [NSString stringWithFormat:@"GPUDevice.createBindGroup: %@", x]
#define VALIDATION_ERROR(...) object.generateAValidationError(INTERNAL_ERROR_STRING((__VA_ARGS__)))

    object.getQueue()->clearTextureViewIfNeeded(apiTextureView);

    id<MTLTexture> texture = apiTextureView->texture();
    if (!apiTextureView->isDestroyed()) {
        if (!apiTextureView->isValid()) {
            VALIDATION_ERROR(@"Underlying texture is not valid");
            return BindGroup::createInvalid(object);
        }
        if (&apiTextureView->device() != &object) {
            VALIDATION_ERROR(@"Underlying texture was created from a different device");
            return BindGroup::createInvalid(object);
        }
        auto textureUsage = apiTextureView->usage();
        if ((textureEntry && !(textureUsage & WGPUTextureUsage_TextureBinding)) || (storageTextureEntry && !(textureUsage & WGPUTextureUsage_StorageBinding))) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Storage texture usage(%u) did not have storage usage or storage texture entry did not have storage binding", textureUsage]);
            return BindGroup::createInvalid(object);
        }
        if (textureEntry && (3 * (textureEntry->multisampled ? 1 : 0) + 1 != apiTextureView->sampleCount())) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Bind group entry multisampled(%d) state does not match underlying texture sample count(%d)", textureEntry->multisampled, apiTextureView->sampleCount()]);
            return BindGroup::createInvalid(object);
        }
        if (!bindGroupLayout->isAutoGenerated() && !validateTextureSampleType(textureEntry, apiTextureView, object)) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Bind group entry sampleType(%@) does not match TextureView sampleType(%@) for texture format(%s)", sampleType(textureEntry), sampleType(apiTextureView, object), Texture::formatToString(apiTextureView->format()).characters()]);
            return BindGroup::createInvalid(object);
        }
        if (!validateTextureViewDimension(textureEntry, apiTextureView) || !validateTextureViewDimension(storageTextureEntry, apiTextureView)) {
            VALIDATION_ERROR(@"Bind group entry viewDimension does not match TextureView viewDimension");
            return BindGroup::createInvalid(object);
        }
        if (!validateStorageTextureViewFormat(storageTextureEntry, apiTextureView)) {
            VALIDATION_ERROR(@"Bind group storage texture entry format does not match TextureView format");
            return BindGroup::createInvalid(object);
        }
        if (storageTextureEntry && apiTextureView->texture().mipmapLevelCount != 1) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Storage textures must have a single mip level(%lu)", static_cast<unsigned long>(apiTextureView->texture().mipmapLevelCount)]);
            return BindGroup::createInvalid(object);
        }

        if (textureEntry && is32bppFloatFormat(texture) && (!valid32bppFloatSampleType(textureEntry->sampleType) || (textureEntry->sampleType == WGPUTextureSampleType_Float && !object.hasFeature(WGPUFeatureName_Float32Filterable)))) {
            VALIDATION_ERROR(@"Can not create bind group with filterable 32bpp floating point texture as float32-filterable feature is not enabled");
            return BindGroup::createInvalid(object);
        }
        if (externalTextureEntry) {
            if (!(textureUsage & WGPUTextureUsage_TextureBinding)) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot which does not have usage containing texture binding.");
                return BindGroup::createInvalid(object);
            }
            if (!apiTextureView->is2DTexture()) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot when the texture view is not a 2D texture.");
                return BindGroup::createInvalid(object);
            }
            if (apiTextureView->mipLevelCount() != 1) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture slot when the texture view has more than 1 mip level");
                return BindGroup::createInvalid(object);
            }
            if (!allowedExternalTextureFormat(apiTextureView->format())) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture which is not an allowed external texture format");
                return BindGroup::createInvalid(object);
            }
            if (apiTextureView->sampleCount() != 1) {
                VALIDATION_ERROR(@"Can not create bind group with a texture view set to an external texture which has a sample count greater than 1");
                return BindGroup::createInvalid(object);
            }
        }
    } else if (stage != ShaderStage::Undefined) {
        argumentEncoder[stage] = nil;
        argumentBuffer[stage] = { };
    }

    if (stage != ShaderStage::Undefined) {
        argumentIndices[stage].remove(index);
        [argumentEncoder[stage] setTexture:texture atIndex:index];
    }
    if (texture) {
        stageResources[metalRenderStage(stage)][resourceUsage - 1].append(texture);
        // ASSERT(apiTextureView->isDestroyed() || texture.parentRelativeLevel == apiTextureView->baseMipLevel());
        // ASSERT(apiTextureView->isDestroyed() || texture.parentRelativeSlice == apiTextureView->baseArrayLayer());
        stageResourceUsages[metalRenderStage(stage)][resourceUsage - 1].append(makeBindGroupEntryUsageData(textureEntry ? usageForTexture(*textureEntry) : (storageTextureEntry ? usageForStorageTexture(*storageTextureEntry) : BindGroupEntryUsage::ConstantTexture), entry.binding, apiTextureView));
    }
#undef VALIDATION_ERROR
#undef INTERNAL_ERROR_STRING

    return std::nullopt;
}

Ref<BindGroup> Device::createBindGroup(const WGPUBindGroupDescriptor& descriptor)
{
#define INTERNAL_ERROR_STRING(x) [NSString stringWithFormat:@"GPUDevice.createBindGroup: %@", x]
#define VALIDATION_ERROR(...) generateAValidationError(INTERNAL_ERROR_STRING((__VA_ARGS__)))
    if (!descriptor.layout || !isValid())
        return BindGroup::createInvalid(*this);

    Ref bindGroupLayout = WebGPU::fromAPI(descriptor.layout);
    if (!bindGroupLayout->isValid() || (!bindGroupLayout->isAutoGenerated() && descriptor.entryCount != bindGroupLayout->entries().size()) || &bindGroupLayout->device() != this) {
        VALIDATION_ERROR(@"invalid BindGroupLayout createBindGroup");
        return BindGroup::createInvalid(*this);
    }

    BindGroup::ShaderStageArray<id<MTLArgumentEncoder>> argumentEncoder = std::array<id<MTLArgumentEncoder>, stageCount>({ bindGroupLayout->vertexArgumentEncoder(), bindGroupLayout->fragmentArgumentEncoder(), bindGroupLayout->computeArgumentEncoder() });
    BindGroup::ShaderStageArray<ExternalTextureIndices> externalTextureIndices = std::array<ExternalTextureIndices, stageCount>({ ExternalTextureIndices(), ExternalTextureIndices(), ExternalTextureIndices() });
    BindGroup::ShaderStageArray<id<MTLBuffer>> argumentBuffer;
    BindGroup::ShaderStageArray<BindGroupLayout::ArgumentIndices> argumentIndices;
    for (ShaderStage stage : stages) {
        auto encodedLength = bindGroupLayout->encodedLength(stage);
        if (encodedLength)
            argumentBuffer[stage] = safeCreateBuffer(encodedLength, MTLStorageModeShared);
        [argumentEncoder[stage] setArgumentBuffer:argumentBuffer[stage] offset:0];
        argumentIndices[stage] = bindGroupLayout->argumentIndices(stage);
    }

    static_assert(maxResourceUsageValue == 3, "Code path assumes MTLResourceUsageRead | MTLResourceUsageWrite == 3");
    std::array<std::array<Vector<id<MTLResource>>, maxResourceUsageValue>, stagesPlusUndefinedCount> stageResources { };
    std::array<std::array<Vector<BindGroupEntryUsageData>, maxResourceUsageValue>, stagesPlusUndefinedCount> stageResourceUsages { };
    auto& bindGroupLayoutEntries = bindGroupLayout->entries();
    BindGroup::DynamicBuffersContainer dynamicBuffers;
    BindGroup::SamplersContainer samplersSet;
    HashSet<uint32_t, DefaultHash<uint32_t>, WTF::UnsignedWithZeroKeyHashTraits<uint32_t>> usedBindingSlots;

    for (const WGPUBindGroupEntry& entry : descriptor.entriesSpan()) {
        WGPUExternalTexture wgpuExternalTexture = entry.externalTexture;

        bool bufferIsPresent = WebGPU::bufferIsPresent(entry);
        bool samplerIsPresent = WebGPU::samplerIsPresent(entry);
        bool textureIsPresent = WebGPU::textureIsPresent(entry);
        bool textureViewIsPresent = WebGPU::textureViewIsPresent(entry);
        bool externalTextureIsPresent = static_cast<bool>(wgpuExternalTexture);
        if (bufferIsPresent + samplerIsPresent + textureIsPresent + textureViewIsPresent + externalTextureIsPresent != 1)
            return BindGroup::createInvalid(*this);

        bool bindingContainedInStage = false;
        bool appendedBufferToDynamicBuffers = false;
        auto bindingIndex = entry.binding;
        if (usedBindingSlots.contains(bindingIndex)) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Binding %u is duplicated in the bind group descriptor", bindingIndex]);
            return BindGroup::createInvalid(*this);
        }
        usedBindingSlots.add(bindingIndex);
        for (ShaderStage stage : stagesPlusUndefined) {
            auto index = bindGroupLayout->argumentBufferIndexForEntryIndex(bindingIndex, stage);
            if (index == NSNotFound)
                continue;

            bindingContainedInStage = true;
            auto optionalAccess = bindGroupLayout->bindingAccessForBindingIndex(bindingIndex, stage);
            RELEASE_ASSERT(optionalAccess);
            auto bufferSizeArgumentBufferIndex = bindGroupLayout->bufferSizeIndexForEntryIndex(bindingIndex, stage);
            MTLResourceUsage resourceUsage = resourceUsageForBindingAcccess(*optionalAccess);

            if (bufferIsPresent) {
                auto* layoutBinding = hasBinding<WGPUBufferBindingLayout>(bindGroupLayoutEntries, bindingIndex);
                if (!layoutBinding) {
                    VALIDATION_ERROR(@"Expected buffer but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }
                Ref apiBuffer = WebGPU::fromAPI(entry.buffer);
                id<MTLBuffer> buffer = apiBuffer->buffer();
                bool isDestroyed = apiBuffer->isDestroyed();
                if (isDestroyed && stage != ShaderStage::Undefined) {
                    argumentEncoder[stage] = nil;
                    argumentBuffer[stage] = { };
                }

                auto entryOffset = isDestroyed ? 0 : entry.offset;
                auto bufferLengthMinusOffset = buffer.length > entryOffset ? (buffer.length - entryOffset) : 0;
                auto entrySize = entry.size == WGPU_WHOLE_MAP_SIZE ? bufferLengthMinusOffset : entry.size;
                if (layoutBinding->hasDynamicOffset && !appendedBufferToDynamicBuffers) {
                    dynamicBuffers.append({ .type = layoutBinding->type, .bindingSize = entrySize, .bufferSize = bufferLengthMinusOffset, .bindingIndex = bindingIndex });
                    appendedBufferToDynamicBuffers = true;
                }

                if (!apiBuffer->isValid() || &apiBuffer->device() != this) {
                    if (!isDestroyed)
                        VALIDATION_ERROR(@"Buffer is invalid or created from a different device");
                    return BindGroup::createInvalid(*this);
                }

                auto& deviceLimits = limits();
                const bool isUniformBuffer = layoutBinding->type == WGPUBufferBindingType_Uniform;
                const bool isStorageBuffer = layoutBinding->type == WGPUBufferBindingType_Storage || layoutBinding->type == WGPUBufferBindingType_ReadOnlyStorage;
                if (!apiBuffer->isDestroyed()) {
                    if (entry.offset >= buffer.length) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Unexpected entry.offset(%llu) >= buffer length(%lu)", entry.offset, (unsigned long)buffer.length]);
                        return BindGroup::createInvalid(*this);
                    }

                    if (!hasProperUsageFlags(layoutBinding->type, apiBuffer->usage())) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Unexpected type(%u), buffer.usage(%u)", layoutBinding->type, apiBuffer->usage()]);
                        return BindGroup::createInvalid(*this);
                    }

                    if ((isUniformBuffer && (entry.offset % deviceLimits.minUniformBufferOffsetAlignment))
                        || (isStorageBuffer && (entry.offset % deviceLimits.minStorageBufferOffsetAlignment))) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Buffer offset(%llu) is not a multiple of the device buffer alignment(%u)", entry.offset, deviceLimits.minStorageBufferOffsetAlignment]);
                        return BindGroup::createInvalid(*this);
                    }

                    if ((isUniformBuffer && entrySize > deviceLimits.maxUniformBufferBindingSize)
                        || (isStorageBuffer && entrySize > deviceLimits.maxStorageBufferBindingSize)) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Buffer size(%llu) is larger than the device limits(%llu)", entrySize, isUniformBuffer ? deviceLimits.maxUniformBufferBindingSize : deviceLimits.maxStorageBufferBindingSize]);
                        return BindGroup::createInvalid(*this);
                    }
                    if (isStorageBuffer && entrySize % 4) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"Storage buffer size(%llu) is not multiple of 4", entrySize]);
                        return BindGroup::createInvalid(*this);
                    }
                    if (!entrySize || entrySize + entryOffset > buffer.length || (layoutBinding->minBindingSize && layoutBinding->minBindingSize > entrySize)) {
                        VALIDATION_ERROR([NSString stringWithFormat:@"entrySize == 0 or entrySize(%llu) + entryOffset(%llu) > buffer size(%lu) or layoutBinding->minBindingSize(%llu) > entrySize(%llu)", entrySize, entryOffset, static_cast<unsigned long>(buffer.length), layoutBinding->minBindingSize, entrySize]);
                        return BindGroup::createInvalid(*this);
                    }
                }

                if (stage != ShaderStage::Undefined && buffer.length) {
                    argumentIndices[stage].remove(index);
                    [argumentEncoder[stage] setBuffer:buffer offset:entryOffset atIndex:index];
                    if (bufferSizeArgumentBufferIndex) {
                        argumentIndices[stage].remove(*bufferSizeArgumentBufferIndex);
                        if (auto* lengthAddress = (uint32_t*)[argumentEncoder[stage] constantDataAtIndex:*bufferSizeArgumentBufferIndex])
                            *lengthAddress = std::min<uint32_t>(entrySize, buffer.length);
                    }
                }
                if (buffer) {
                    stageResources[metalRenderStage(stage)][resourceUsage - 1].append(buffer);
                    stageResourceUsages[metalRenderStage(stage)][resourceUsage - 1].append(makeBindGroupEntryUsageData(usageForBuffer(layoutBinding->type), entry.binding, apiBuffer, entryOffset, entrySize));
                }
            } else if (samplerIsPresent) {
                auto* layoutBinding = hasBinding<WGPUSamplerBindingLayout>(bindGroupLayoutEntries, bindingIndex);
                if (!layoutBinding) {
                    VALIDATION_ERROR(@"Expected sampler but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }
                Ref apiSampler = WebGPU::fromAPI(entry.sampler);
                if (!apiSampler->isValid() || &apiSampler->device() != this) {
                    VALIDATION_ERROR(@"Underlying sampler is not valid or created from a different device");
                    return BindGroup::createInvalid(*this);
                }

                if (!validateSamplerType(layoutBinding->type, apiSampler)) {
                    VALIDATION_ERROR([NSString stringWithFormat:@"Expected sampler type(%u) has wrong comparison or filtering modes", layoutBinding->type]);
                    return BindGroup::createInvalid(*this);
                }

                id<MTLSamplerState> sampler = apiSampler->tryCacheSamplerState();
                if (stage != ShaderStage::Undefined) {
                    argumentIndices[stage].remove(index);
                    [argumentEncoder[stage] setSamplerState:sampler atIndex:index];
                    samplersSet.add(WTF::move(apiSampler), BindGroup::ShaderStageArray<std::optional<uint32_t>> { }).iterator->value[stage] = index;
                }
            } else if (textureViewIsPresent || textureIsPresent) {
                auto it = bindGroupLayoutEntries.find(bindingIndex);
                RELEASE_ASSERT(it != bindGroupLayoutEntries.end());
                auto* textureEntry = std::get_if<WGPUTextureBindingLayout>(&it->value.bindingLayout);
                auto* storageTextureEntry = std::get_if<WGPUStorageTextureBindingLayout>(&it->value.bindingLayout);
                auto* externalTextureEntry = std::get_if<WGPUExternalTextureBindingLayout>(&it->value.bindingLayout);
                if (!textureEntry && !storageTextureEntry && !externalTextureEntry) {
                    VALIDATION_ERROR(@"Expected texture or storage texture but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }

                if (textureViewIsPresent) {
                    Ref apiTextureView = WebGPU::fromAPI(entry.textureView);
                    if (auto result = validateTextureOrBindGroup(*this, apiTextureView, argumentBuffer, argumentEncoder, argumentIndices, bindGroupLayout, entry, externalTextureEntry, index, resourceUsage, stage, stageResourceUsages, stageResources, storageTextureEntry, textureEntry))
                        return *result;
                } else {
                    Ref apiTexture = WebGPU::fromAPI(entry.texture);
                    if (auto result = validateTextureOrBindGroup(*this, apiTexture, argumentBuffer, argumentEncoder, argumentIndices, bindGroupLayout, entry, externalTextureEntry, index, resourceUsage, stage, stageResourceUsages, stageResources, storageTextureEntry, textureEntry))
                        return *result;
                }

            } else if (externalTextureIsPresent) {
                if (!hasBinding<WGPUExternalTextureBindingLayout>(bindGroupLayoutEntries, bindingIndex)) {
                    VALIDATION_ERROR(@"Expected external texture but it was not present in the bind group layout");
                    return BindGroup::createInvalid(*this);
                }
                Ref externalTexture = WebGPU::fromAPI(wgpuExternalTexture);
                auto textureData = createExternalTextureFromPixelBuffer(externalTexture->pixelBuffer(), externalTexture->colorSpace());
                id<MTLTexture> texture0 = textureData.texture0 ?: placeholderTexture(WGPUTextureFormat_BGRA8Unorm);
                auto metalStage = metalRenderStage(stage);
                if (stage != ShaderStage::Undefined) {
                    externalTextureIndices[stage].argumentBufferIndex = index;
                    externalTextureIndices[stage].resourceIndex = stageResources[metalStage][resourceUsage - 1].size();
                }
                if (texture0) {
                    stageResources[metalStage][resourceUsage - 1].append(texture0);
                    stageResourceUsages[metalStage][resourceUsage - 1].append(makeBindGroupEntryUsageData(BindGroupEntryUsage::ConstantTexture, entry.binding, externalTexture));
                }
                id<MTLTexture> texture1 = textureData.texture1 ?: placeholderTexture(WGPUTextureFormat_BGRA8Unorm);
                if (texture1) {
                    stageResources[metalStage][resourceUsage - 1].append(texture1);
                    stageResourceUsages[metalStage][resourceUsage - 1].append(makeBindGroupEntryUsageData(BindGroupEntryUsage::ConstantTexture, entry.binding, externalTexture));
                }

                if (stage != ShaderStage::Undefined) {
                    argumentIndices[stage].remove(index);
                    externalTexture->updateExternalTextures(texture0, texture1);
                    [argumentEncoder[stage] setTexture:texture0 atIndex:index++];

                    argumentIndices[stage].remove(index);
                    [argumentEncoder[stage] setTexture:texture1 atIndex:index++];

                    argumentIndices[stage].remove(index);
                    if (auto* uvRemapAddress = static_cast<simd::float3x2*>([argumentEncoder[stage] constantDataAtIndex:index++]))
                        *uvRemapAddress = textureData.uvRemappingMatrix;

                    argumentIndices[stage].remove(index);
                    if (auto* cscMatrixAddress = static_cast<simd::float4x3*>([argumentEncoder[stage] constantDataAtIndex:index++]))
                        *cscMatrixAddress = textureData.colorSpaceConversionMatrix;
                }
            }
        }

        if (!bindingContainedInStage && !bindGroupLayout->isAutoGenerated()) {
            VALIDATION_ERROR([NSString stringWithFormat:@"Binding %d was not contained in the bind group", entry.binding]);
            return BindGroup::createInvalid(*this);
        }
    }

    for (auto& indices : argumentIndices) {
        if (indices.size())
            return BindGroup::createInvalid(*this);
    }

    Vector<BindableResources> resources;
    for (ShaderStage stage : stagesPlusUndefined) {
        for (size_t i = 0; i < maxResourceUsageValue; ++i) {
            auto renderStage = metalRenderStage(stage);
            auto &v = stageResources[renderStage][i];
            auto &u = stageResourceUsages[renderStage][i];
            static_assert(MTLResourceUsageRead == 1 && !BindGroupLayout::BindingAccessReadOnly);
            if (v.size()) {
                if (stage != ShaderStage::Undefined && i == BindGroupLayout::BindingAccessReadOnly)
                    externalTextureIndices[stage].containerIndex = resources.size();
                resources.append(BindableResources {
                    .mtlResources = WTF::move(v),
                    .resourceUsages = WTF::move(u),
                    .usage = static_cast<MTLResourceUsage>(i + 1),
                    .renderStages = renderStage
                });
            }
        }
    }

    argumentBuffer[ShaderStage::Vertex].label = bindGroupLayout->vertexArgumentEncoder().label;
    argumentBuffer[ShaderStage::Fragment].label = bindGroupLayout->fragmentArgumentEncoder().label;
    argumentBuffer[ShaderStage::Compute].label = bindGroupLayout->computeArgumentEncoder().label;

    std::ranges::sort(dynamicBuffers, { }, &BindGroup::BufferAndType::bindingIndex);

    if (m_bindGroupId == std::numeric_limits<decltype(m_bindGroupId)>::max()) {
        loseTheDevice(WGPUDeviceLostReason_Undefined);
        return BindGroup::createInvalid(*this);
    }

    return BindGroup::create(argumentBuffer[ShaderStage::Vertex], argumentBuffer[ShaderStage::Fragment], argumentBuffer[ShaderStage::Compute], WTF::move(resources), bindGroupLayout, WTF::move(dynamicBuffers), WTF::move(samplersSet), WTF::move(externalTextureIndices), ++m_bindGroupId, *this);
#undef VALIDATION_ERROR
#undef INTERNAL_ERROR_STRING
}

bool BindGroup::isValid() const
{
    return !!bindGroupLayout();
}

BindGroup::BindGroup(id<MTLBuffer> vertexArgumentBuffer, id<MTLBuffer> fragmentArgumentBuffer, id<MTLBuffer> computeArgumentBuffer, Vector<BindableResources>&& resources, const BindGroupLayout& bindGroupLayout, DynamicBuffersContainer&& dynamicBuffers, SamplersContainer&& samplers, ShaderStageArray<ExternalTextureIndices>&& externalTextureIndices, uint32_t uniqueIdentifier, Device& device)
    : m_vertexArgumentBuffer(vertexArgumentBuffer)
    , m_fragmentArgumentBuffer(fragmentArgumentBuffer)
    , m_computeArgumentBuffer(computeArgumentBuffer)
    , m_device(device)
    , m_resources(WTF::move(resources))
    , m_bindGroupLayout(&bindGroupLayout)
    , m_dynamicBuffers(WTF::move(dynamicBuffers))
    , m_samplers(WTF::move(samplers))
    , m_externalTextureIndices(WTF::move(externalTextureIndices))
    , m_uniqueIdentifier(uniqueIdentifier)
{
    for (size_t index = 0, maxIndex = m_dynamicBuffers.size(); index < maxIndex; ++index)
        m_dynamicOffsetsIndices.add(m_dynamicBuffers[index].bindingIndex, index);
}

WTF_MAKE_TZONE_ALLOCATED_IMPL(BindGroup);

BindGroup::BindGroup(Device& device)
    : m_device(device)
{
}

BindGroup::~BindGroup() = default;

const BindGroup::BufferAndType* BindGroup::dynamicBuffer(uint32_t i) const
{
    ASSERT(i < m_dynamicBuffers.size());
    return i < m_dynamicBuffers.size() ? &m_dynamicBuffers[i] : nullptr;
}

uint32_t BindGroup::dynamicOffset(uint32_t bindingIndex, const Vector<uint32_t>* dynamicOffsets) const
{
    if (auto it = m_dynamicOffsetsIndices.find(bindingIndex); it != m_dynamicOffsetsIndices.end())
        return dynamicOffsets && it->value < dynamicOffsets->size() ? (*dynamicOffsets)[it->value] : 0u;

    return 0u;
}

void BindGroup::setLabel(String&& label)
{
    RetainPtr labelString = label.createNSString();
    m_vertexArgumentBuffer.label = labelString.get();
    m_fragmentArgumentBuffer.label = labelString.get();
    m_computeArgumentBuffer.label = labelString.get();
}

bool BindGroup::allowedUsage(const OptionSet<BindGroupEntryUsage>& allowedUsage)
{
    if ((allowedUsage & BindGroupEntryUsage::Storage) && (allowedUsage != BindGroupEntryUsage::Storage))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::StorageTextureWriteOnly) && (allowedUsage != BindGroupEntryUsage::StorageTextureWriteOnly))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::StorageTextureReadWrite) && (allowedUsage != BindGroupEntryUsage::StorageTextureReadWrite))
        return false;

    if ((allowedUsage & BindGroupEntryUsage::Attachment) && (allowedUsage != BindGroupEntryUsage::Attachment))
        return false;

    return true;
}

NSString* BindGroup::usageName(const OptionSet<BindGroupEntryUsage>& allowedUsage)
{
    NSString* result = @"";
    if (allowedUsage & BindGroupEntryUsage::Input)
        result = [result stringByAppendingString:@"Input "];
    if (allowedUsage & BindGroupEntryUsage::Constant)
        result = [result stringByAppendingString:@"Constant "];
    if (allowedUsage & BindGroupEntryUsage::Storage)
        result = [result stringByAppendingString:@"Storage "];
    if (allowedUsage & BindGroupEntryUsage::StorageRead)
        result = [result stringByAppendingString:@"StorageRead "];
    if (allowedUsage & BindGroupEntryUsage::Attachment)
        result = [result stringByAppendingString:@"Attachment "];
    if (allowedUsage & BindGroupEntryUsage::AttachmentRead)
        result = [result stringByAppendingString:@"AttachmentRead "];
    if (allowedUsage & BindGroupEntryUsage::ConstantTexture)
        result = [result stringByAppendingString:@"ConstantTexture "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureWriteOnly)
        result = [result stringByAppendingString:@"StorageTextureWriteOnly "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureRead)
        result = [result stringByAppendingString:@"StorageTextureRead "];
    if (allowedUsage & BindGroupEntryUsage::StorageTextureReadWrite)
        result = [result stringByAppendingString:@"StorageTextureReadWrite "];

    return result;
}

uint64_t BindGroup::makeEntryMapKey(uint32_t baseMipLevel, uint32_t baseArrayLayer, WGPUTextureAspect aspect)
{
    RELEASE_ASSERT(aspect);
    return (static_cast<uint64_t>(aspect) - 1) | (static_cast<uint64_t>(baseMipLevel) << 1) | (static_cast<uint64_t>(baseArrayLayer) << 32);
}

[[nodiscard]] static bool setArgumentBuffer(id<MTLArgumentEncoder> encoder, id<MTLBuffer> buffer)
{
    if (!encoder || !buffer)
        return false;

    [encoder setArgumentBuffer:buffer offset:0];
    return true;
}

bool BindGroup::rebindSamplersIfNeeded() const
{
    if (!m_bindGroupLayout)
        return true;

    for (auto& [samplerRef, shaderStageArray] : m_samplers) {
        Ref sampler = samplerRef;
        if (sampler->cachedSamplerState())
            continue;

        WTFLogAlways("Rebinding of samplers required, if this occurs frequently the application is using too many unique samplers");
        id<MTLSamplerState> samplerState = sampler->tryCacheSamplerState();
        if (!samplerState)
            return false;
        if (shaderStageArray[ShaderStage::Vertex].has_value() && setArgumentBuffer(m_bindGroupLayout->vertexArgumentEncoder(), vertexArgumentBuffer()))
            [m_bindGroupLayout->vertexArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Vertex]];

        if (shaderStageArray[ShaderStage::Fragment].has_value() && setArgumentBuffer(m_bindGroupLayout->fragmentArgumentEncoder(), fragmentArgumentBuffer()))
            [m_bindGroupLayout->fragmentArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Fragment]];

        if (shaderStageArray[ShaderStage::Compute].has_value() && setArgumentBuffer(m_bindGroupLayout->computeArgumentEncoder(), computeArgumentBuffer()))
            [m_bindGroupLayout->computeArgumentEncoder() setSamplerState:samplerState atIndex:*shaderStageArray[ShaderStage::Compute]];
    }
    return true;
}

bool BindGroup::updateExternalTextures(ExternalTexture& externalTexture)
{
    if (!m_bindGroupLayout || externalTexture.openCommandEncoderCount())
        return false;

    Ref device = m_device;
    auto textureData = device->createExternalTextureFromPixelBuffer(externalTexture.pixelBuffer(), externalTexture.colorSpace());
    id<MTLTexture> texture0 = textureData.texture0 ?: device->placeholderTexture(WGPUTextureFormat_BGRA8Unorm);
    id<MTLTexture> texture1 = textureData.texture1 ?: device->placeholderTexture(WGPUTextureFormat_BGRA8Unorm);
    externalTexture.updateExternalTextures(texture0, texture1);
    if (!texture0 || !texture1)
        return false;

    BindGroup::ShaderStageArray<id<MTLBuffer>> argumentBuffers = std::array<id<MTLBuffer>, 3>({ vertexArgumentBuffer(), fragmentArgumentBuffer(), computeArgumentBuffer() });
    BindGroup::ShaderStageArray<id<MTLArgumentEncoder>> argumentEncoders = std::array<id<MTLArgumentEncoder>, 3>({ m_bindGroupLayout->vertexArgumentEncoder(), m_bindGroupLayout->fragmentArgumentEncoder(), m_bindGroupLayout->computeArgumentEncoder() });
    for (ShaderStage stage : stages) {
        auto& indices = m_externalTextureIndices[stage];
        auto index = indices.argumentBufferIndex;
        auto resourceIndex = indices.resourceIndex;
        auto containerIndex = indices.containerIndex;
        if (index == NSNotFound || containerIndex >= m_resources.size() || resourceIndex >= m_resources[containerIndex].mtlResources.size() || (resourceIndex + 1) >= m_resources[containerIndex].mtlResources.size())
            continue;

        m_resources[containerIndex].mtlResources[resourceIndex] = texture0;
        m_resources[containerIndex].mtlResources[resourceIndex + 1] = texture1;

        id<MTLArgumentEncoder> argumentEncoder = argumentEncoders[stage];
        if (!setArgumentBuffer(argumentEncoder, argumentBuffers[stage]))
            continue;

        [argumentEncoder setTexture:texture0 atIndex:index++];
        [argumentEncoder setTexture:texture1 atIndex:index++];

        if (auto* uvRemapAddress = static_cast<simd::float3x2*>([argumentEncoder constantDataAtIndex:index++]))
            *uvRemapAddress = textureData.uvRemappingMatrix;

        if (auto* cscMatrixAddress = static_cast<simd::float4x3*>([argumentEncoder constantDataAtIndex:index++]))
            *cscMatrixAddress = textureData.colorSpaceConversionMatrix;
    }

    return true;
}

bool BindGroup::makeSubmitInvalid(ShaderStage stage, const BindGroupLayout* pipelineLayout) const
{
    if (!pipelineLayout || pipelineLayout->entries().isEmpty())
        return false;

    if (!m_bindGroupLayout)
        return true;

    Ref pipelineBindGroupLayout { *pipelineLayout };
    switch (stage) {
    case ShaderStage::Vertex:
        return m_vertexArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Fragment:
        return m_fragmentArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Compute:
        return m_computeArgumentBuffer.length != pipelineBindGroupLayout->encodedLength(stage);
    case ShaderStage::Undefined:
        return true;
    }

    return true;
}

static uint64_t NODELETE makePipelineBindGroupKey(uint32_t groupIndex, uint64_t pipelineIndex)
{
    return static_cast<uint64_t>(groupIndex) | (pipelineIndex << Device::maxBindGroups);
}

void BindGroup::validatedSuccessfully(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const
{
    auto it = m_validatedBindGroup.add(makePipelineBindGroupKey(groupIndex, pipelineIndex), maxOffset).iterator;
    it->value = std::max(it->value, maxOffset);
}

bool BindGroup::previouslyValidatedBindGroup(uint32_t groupIndex, uint64_t pipelineIndex, uint32_t maxOffset) const
{
    auto it = m_validatedBindGroup.find(makePipelineBindGroupKey(groupIndex, pipelineIndex));
    return it != m_validatedBindGroup.end() && it->value >= maxOffset;
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuBindGroupReference(WGPUBindGroup bindGroup)
{
    WebGPU::fromAPI(bindGroup).ref();
}

void wgpuBindGroupRelease(WGPUBindGroup bindGroup)
{
    WebGPU::fromAPI(bindGroup).deref();
}

void wgpuBindGroupSetLabel(WGPUBindGroup bindGroup, const char* label)
{
    protect(WebGPU::fromAPI(bindGroup))->setLabel(WebGPU::fromAPI(label));
}

bool wgpuBindGroupUpdateExternalTextures(WGPUBindGroup bindGroup, WGPUExternalTexture externalTexture)
{
    return protect(WebGPU::fromAPI(bindGroup))->updateExternalTextures(protect(WebGPU::fromAPI(externalTexture)));
}
