/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
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

DECLARE_SYSTEM_HEADER

#import <Metal/Metal.h>

#if USE(APPLE_INTERNAL_SDK)
#import <Metal/MTLCommandBuffer_Private.h>
#import <Metal/MTLDevice_Private.h>
#import <Metal/MTLResource_Private.h>
#import <Metal/MTLTexture_Private.h>
#else
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_420_2P = static_cast<MTLPixelFormat>(500);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_422_1P = static_cast<MTLPixelFormat>(501);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_422_2P = static_cast<MTLPixelFormat>(502);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_444_2P = static_cast<MTLPixelFormat>(503);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_1P = static_cast<MTLPixelFormat>(504);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P = static_cast<MTLPixelFormat>(505);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P = static_cast<MTLPixelFormat>(506);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P = static_cast<MTLPixelFormat>(507);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P_PACKED = static_cast<MTLPixelFormat>(508);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P_PACKED = static_cast<MTLPixelFormat>(509);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P_PACKED = static_cast<MTLPixelFormat>(510);

constexpr MTLPixelFormat MTLPixelFormatYCBCR8_420_2P_sRGB = static_cast<MTLPixelFormat>(520);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_422_1P_sRGB = static_cast<MTLPixelFormat>(521);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_422_2P_sRGB = static_cast<MTLPixelFormat>(522);
constexpr MTLPixelFormat MTLPixelFormatYCBCR8_444_2P_sRGB = static_cast<MTLPixelFormat>(523);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_1P_sRGB = static_cast<MTLPixelFormat>(524);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P_sRGB = static_cast<MTLPixelFormat>(525);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P_sRGB = static_cast<MTLPixelFormat>(526);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P_sRGB = static_cast<MTLPixelFormat>(527);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P_PACKED_sRGB = static_cast<MTLPixelFormat>(528);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P_PACKED_sRGB = static_cast<MTLPixelFormat>(529);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P_PACKED_sRGB = static_cast<MTLPixelFormat>(530);

constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_1P_PQ = static_cast<MTLPixelFormat>(563);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P_PQ = static_cast<MTLPixelFormat>(564);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P_PQ = static_cast<MTLPixelFormat>(565);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P_PQ = static_cast<MTLPixelFormat>(566);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_420_2P_PACKED_PQ = static_cast<MTLPixelFormat>(567);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_422_2P_PACKED_PQ = static_cast<MTLPixelFormat>(568);
constexpr MTLPixelFormat MTLPixelFormatYCBCR10_444_2P_PACKED_PQ = static_cast<MTLPixelFormat>(569);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_420_2P = static_cast<MTLPixelFormat>(570);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_422_2P = static_cast<MTLPixelFormat>(571);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_444_2P = static_cast<MTLPixelFormat>(572);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_420_2P_PQ = static_cast<MTLPixelFormat>(573);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_422_2P_PQ = static_cast<MTLPixelFormat>(574);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_444_2P_PQ = static_cast<MTLPixelFormat>(575);

constexpr MTLPixelFormat MTLPixelFormatYCBCR12_420_2P_PACKED = static_cast<MTLPixelFormat>(580);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_422_2P_PACKED = static_cast<MTLPixelFormat>(581);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_444_2P_PACKED = static_cast<MTLPixelFormat>(582);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_420_2P_PACKED_PQ = static_cast<MTLPixelFormat>(583);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_422_2P_PACKED_PQ = static_cast<MTLPixelFormat>(584);
constexpr MTLPixelFormat MTLPixelFormatYCBCR12_444_2P_PACKED_PQ = static_cast<MTLPixelFormat>(585);

@protocol MTLResourceSPI <MTLResource>
@optional
- (kern_return_t)setOwnerWithIdentity:(mach_port_t)task_id_token;
@end

#if !0 /* PLATFORM(WATCHOS) */
@interface MTLSharedTextureHandle(Private)
- (instancetype)initWithMachPort:(mach_port_t)machPort;
@end
#endif

@protocol MTLDeviceSPI <MTLDevice>
- (id <MTLSharedEvent>)newSharedEventWithMachPort:(mach_port_t)machPort;
@end

@protocol MTLRasterizationRateMapDescriptorSPI
@property (nonatomic) float minFactor;
@property (nonatomic) MTLMutability mutability;
@property (nonatomic) BOOL skipSampleValidationAndApplySampleAtTileGranularity;
@end

#endif
