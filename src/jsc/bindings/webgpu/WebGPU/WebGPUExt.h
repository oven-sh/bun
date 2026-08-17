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

#ifndef WEBGPUEXT_H_
#define WEBGPUEXT_H_

#ifdef __cplusplus

#include <WebGPU/WebGPU.h>
#include <CoreGraphics/CGImage.h>
#ifndef __swift__
// Swift C++ Interop does not support extern C. This header has that.
#include <CoreVideo/CoreVideo.h>
#endif
#include <IOSurface/IOSurfaceRef.h>

#ifdef NDEBUG
#define WGPU_FUZZER_ASSERT_NOT_REACHED(...) (WTFLogAlways(__VA_ARGS__), ASSERT_WITH_SECURITY_IMPLICATION(0))
#else
#define WGPU_FUZZER_ASSERT_NOT_REACHED(...) WTFLogAlways(__VA_ARGS__)
#endif

#include <optional>
#include <simd/simd.h>
#include <wtf/MachSendRight.h>
#include <wtf/RetainPtr.h>
#include <wtf/Vector.h>

#ifdef __swift__
typedef struct CF_BRIDGED_TYPE(id) __CVBuffer* CVPixelBufferRef;
#endif

typedef struct WebMeshImpl* WebMesh;
typedef struct WGPUExternalTextureImpl* WGPUExternalTexture;

typedef enum WGPUBufferBindingTypeExtended {
    WGPUBufferBindingType_Float3x2 = WGPUBufferBindingType_Force32 - 1,
    WGPUBufferBindingType_Float4x3 = WGPUBufferBindingType_Force32 - 2,
    WGPUBufferBindingType_ArrayLength = WGPUBufferBindingType_Force32 - 3,
} WGPUBufferBindingTypeExtended;

typedef enum WGPUSTypeExtended {
    WGPUSTypeExtended_InstanceCocoaDescriptor = 0x151BBC00, // Random
    WGPUSTypeExtended_SurfaceDescriptorCocoaSurfaceBacking = 0x017E9710, // Random
    WGPUSTypeExtended_BindGroupEntryExternalTexture = 0xF7A6EBF9, // Random
    WGPUSTypeExtended_BindGroupLayoutEntryExternalTexture = 0x645C3DAA, // Random
    WGPUSTypeExtended_Force32 = 0x7FFFFFFF
} WGPUSTypeExtended;

const int WGPUTextureSampleType_ExternalTexture = WGPUTextureSampleType_Force32 - 1;

typedef struct WGPUExternalTextureBindingLayout {
} WGPUExternalTextureBindingLayout;

typedef struct WGPUExternalTextureDescriptor {
    char const * label; // nullable
    CVPixelBufferRef pixelBuffer;
    WGPUColorSpace colorSpace;
} WGPUExternalTextureDescriptor;

#if !defined(WGPU_SKIP_PROCS)

typedef void (*WGPUProcRenderBundleSetLabel)(WGPURenderBundle renderBundle, char const * label);

typedef WGPUExternalTexture (*WGPUProcDeviceImportExternalTexture)(WGPUSwapChain swapChain);

// FIXME: https://github.com/webgpu-native/webgpu-headers/issues/89 is about moving this from WebGPUExt.h to WebGPU.h
typedef WGPUTexture (*WGPUProcSwapChainGetCurrentTexture)(WGPUSwapChain swapChain);

#endif  // !defined(WGPU_SKIP_PROCS)

#if !defined(WGPU_SKIP_DECLARATIONS)

WGPU_EXPORT void wgpuRenderBundleSetLabel(WGPURenderBundle renderBundle, char const * label);

// FIXME: https://github.com/webgpu-native/webgpu-headers/issues/89 is about moving this from WebGPUExt.h to WebGPU.h
WGPU_EXPORT WGPUTexture wgpuSwapChainGetCurrentTexture(WGPUSwapChain swapChain, uint32_t frameIndex);

WGPU_EXPORT WGPUExternalTexture wgpuDeviceImportExternalTexture(WGPUDevice device, const WGPUExternalTextureDescriptor* descriptor);

WGPU_EXPORT void wgpuDeviceSetDeviceLostCallback(WGPUDevice device, WGPUDeviceLostCallback callback, void* userdata);
WGPU_EXPORT void wgpuDeviceSetDeviceLostCallbackWithBlock(WGPUDevice device, WGPUDeviceLostBlockCallback callback);
WGPU_EXPORT void wgpuExternalTextureReference(WGPUExternalTexture externalTexture);
WGPU_EXPORT void wgpuExternalTextureRelease(WGPUExternalTexture externalTexture);
WGPU_EXPORT void wgpuRenderBundleEncoderSetBindGroupWithDynamicOffsets(WGPURenderBundleEncoder renderBundleEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuExternalTextureDestroy(WGPUExternalTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuExternalTextureUndestroy(WGPUExternalTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuExternalTextureUpdate(WGPUExternalTexture texture, CVPixelBufferRef) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPULimits wgpuDefaultLimits() WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT bool wgpuBindGroupUpdateExternalTextures(WGPUBindGroup bindGroup, WGPUExternalTexture externalTexture) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT WGPUXRBinding wgpuDeviceCreateXRBinding(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDevicePauseErrorReporting(WGPUDevice device, WGPUBool pauseErrors) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT WGPUXRProjectionLayer wgpuBindingCreateXRProjectionLayer(WGPUXRBinding binding, WGPUTextureFormat colorFormat, WGPUTextureFormat* optionalDepthStencilFormat, WGPUTextureUsageFlags flags, double scale) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUXRSubImage wgpuBindingGetViewSubImage(WGPUXRBinding binding, WGPUXRProjectionLayer layer) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT WGPUTexture wgpuXRSubImageGetColorTexture(WGPUXRSubImage subImage) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUTexture wgpuXRSubImageGetDepthStencilTexture(WGPUXRSubImage subImage) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT WGPUBool wgpuAdapterXRCompatible(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT void wgpuXRProjectionLayerStartFrame(WGPUXRProjectionLayer layer, size_t frameIndex, WTF::MachSendRight&& colorBuffer, WTF::MachSendRight&& depthBuffer, WTF::MachSendRight&& completionSyncEvent, size_t reusableTextureIndex, unsigned screenWidth, unsigned screenHeight, Vector<float>&& horizontalSamplesLeft, Vector<float>&& horizontalSamplesRight, Vector<float>&& verticalSamples) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT RetainPtr<CGImageRef> wgpuSwapChainGetTextureAsNativeImage(WGPUSwapChain swapChain, uint32_t bufferIndex, bool& isIOSurfaceSupportedFormat);
WGPU_EXPORT WGPUBool wgpuExternalTextureIsValid(WGPUExternalTexture externalTexture) WGPU_FUNCTION_ATTRIBUTE;

WGPU_EXPORT void wgpuDeviceClearDeviceLostCallback(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceClearUncapturedErrorCallback(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;

#endif  // !defined(WGPU_SKIP_DECLARATIONS)

WGPU_EXPORT String wgpuAdapterFeatureName(WGPUFeatureName feature) WGPU_FUNCTION_ATTRIBUTE;

#endif

#endif // WEBGPUEXT_H_
