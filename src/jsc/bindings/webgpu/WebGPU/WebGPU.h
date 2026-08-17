// BSD 3-Clause License
//
// Copyright (c) 2019, "WebGPU native" developers
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
#ifndef WEBGPU_H_
#define WEBGPU_H_

#include <wtf/Compiler.h>
#include <wtf/SwiftBridging.h>

#if __has_include(<swift/bridging>)
#include <swift/bridging>
#endif

#include <CoreFoundation/CoreFoundation.h>

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnullability-completeness"

#ifdef __cplusplus

#include <array>
#include <optional>
#include <wtf/Forward.h>
#include <wtf/StdLibExtras.h>

#if defined(WGPU_SHARED_LIBRARY)
#    if defined(_WIN32)
#        if defined(WGPU_IMPLEMENTATION)
#            define WGPU_EXPORT __declspec(dllexport)
#        else
#            define WGPU_EXPORT __declspec(dllimport)
#        endif
#    else  // defined(_WIN32)
#        if defined(WGPU_IMPLEMENTATION)
#            define WGPU_EXPORT __attribute__((visibility("default")))
#        else
#            define WGPU_EXPORT
#        endif
#    endif  // defined(_WIN32)
#else       // defined(WGPU_SHARED_LIBRARY)
#    define WGPU_EXPORT
#endif  // defined(WGPU_SHARED_LIBRARY)

#if !defined(WGPU_OBJECT_ATTRIBUTE)
#define WGPU_OBJECT_ATTRIBUTE
#endif
#if !defined(WGPU_ENUM_ATTRIBUTE)
#define WGPU_ENUM_ATTRIBUTE
#endif
#if !defined(WGPU_STRUCTURE_ATTRIBUTE)
#define WGPU_STRUCTURE_ATTRIBUTE
#endif
#if !defined(WGPU_FUNCTION_ATTRIBUTE)
#define WGPU_FUNCTION_ATTRIBUTE
#endif
#if !defined(WGPU_NULLABLE)
#define WGPU_NULLABLE
#endif

#include <stdint.h>
#include <stddef.h>

#include <span>
#include <wtf/text/WTFString.h>
#include <wtf/Platform.h>
#include <wtf/Vector.h>

#define WGPU_ARRAY_LAYER_COUNT_UNDEFINED (0xffffffffUL)
#define WGPU_COPY_STRIDE_UNDEFINED (0xffffffffUL)
#define WGPU_LIMIT_U32_UNDEFINED (0xffffffffUL)
#define WGPU_LIMIT_U64_UNDEFINED (0xffffffffffffffffULL)
#define WGPU_MIP_LEVEL_COUNT_UNDEFINED (0xffffffffUL)
#define WGPU_QUERY_SET_INDEX_UNDEFINED (0xffffffffUL)
#define WGPU_WHOLE_MAP_SIZE SIZE_MAX
#define WGPU_WHOLE_SIZE (0xffffffffffffffffULL)

typedef uint32_t WGPUFlags;
typedef uint32_t WGPUBool;

typedef struct WGPUAdapterImpl* WGPUAdapter WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUBindGroupImpl* WGPUBindGroup WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUBindGroupLayoutImpl* WGPUBindGroupLayout WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUBufferImpl* WGPUBuffer WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUCommandBufferImpl* WGPUCommandBuffer WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUCommandEncoderImpl* WGPUCommandEncoder WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUComputePassEncoderImpl* WGPUComputePassEncoder WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUComputePipelineImpl* WGPUComputePipeline WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUDeviceImpl* WGPUDevice WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUExternalTextureImpl* WGPUExternalTexture;
typedef struct WGPUInstanceImpl* WGPUInstance WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUPipelineLayoutImpl* WGPUPipelineLayout WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUQuerySetImpl* WGPUQuerySet WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUQueueImpl* WGPUQueue WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPURenderBundleImpl* WGPURenderBundle WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPURenderBundleEncoderImpl* WGPURenderBundleEncoder WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPURenderPassEncoderImpl* WGPURenderPassEncoder WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPURenderPipelineImpl* WGPURenderPipeline WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUSamplerImpl* WGPUSampler WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUShaderModuleImpl* WGPUShaderModule WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUSurfaceImpl* WGPUSurface WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUSwapChainImpl* WGPUSwapChain WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUTextureImpl* WGPUTexture WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUTextureViewImpl* WGPUTextureView WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUXRBindingImpl* WGPUXRBinding WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUXRSubImageImpl* WGPUXRSubImage WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUXRProjectionLayerImpl* WGPUXRProjectionLayer WGPU_OBJECT_ATTRIBUTE;
typedef struct WGPUXRViewImpl* WGPUXRView WGPU_OBJECT_ATTRIBUTE;

// Structure forward declarations
struct WGPUAdapterProperties;
struct WGPUBindGroupEntry;
struct WGPUBlendComponent;
struct WGPUBufferBindingLayout;
struct WGPUBufferDescriptor;
struct WGPUColor;
struct WGPUCommandBufferDescriptor;
struct WGPUCommandEncoderDescriptor;
struct WGPUCompilationMessage;
struct WGPUComputePassTimestampWrites;
struct WGPUConstantEntry;
struct WGPUExtent3D;
struct WGPUInstanceDescriptor;
struct WGPULimits;
struct WGPUMultisampleState;
struct WGPUOrigin3D;
struct WGPUPipelineLayoutDescriptor;
struct WGPUPrimitiveState;
struct WGPUQuerySetDescriptor;
struct WGPUQueueDescriptor;
struct WGPURenderBundleDescriptor;
struct WGPURenderBundleEncoderDescriptor;
struct WGPURenderPassDepthStencilAttachment;
struct WGPURenderPassTimestampWrites;
struct WGPURequestAdapterOptions;
struct WGPUSamplerBindingLayout;
struct WGPUSamplerDescriptor;
struct WGPUShaderModuleCompilationHint;
struct WGPUShaderModuleSPIRVDescriptor;
struct WGPUStencilFaceState;
struct WGPUStorageTextureBindingLayout;
struct WGPUSurfaceDescriptor;
struct WGPUSurfaceDescriptorFromAndroidNativeWindow;
struct WGPUSurfaceDescriptorFromCanvasHTMLSelector;
struct WGPUSurfaceDescriptorFromMetalLayer;
struct WGPUSurfaceDescriptorFromWaylandSurface;
struct WGPUSurfaceDescriptorFromWindowsHWND;
struct WGPUSurfaceDescriptorFromXcbWindow;
struct WGPUSurfaceDescriptorFromXlibWindow;
struct WGPUSwapChainDescriptor;
struct WGPUTextureBindingLayout;
struct WGPUTextureDataLayout;
struct WGPUTextureViewDescriptor;
struct WGPUVertexAttribute;
struct WGPUBindGroupDescriptor;
struct WGPUBindGroupLayoutEntry;
struct WGPUBlendState;
struct WGPUCompilationInfo;
struct WGPUComputePassDescriptor;
struct WGPUDepthStencilState;
struct WGPUImageCopyBuffer;
struct WGPUImageCopyTexture;
struct WGPUProgrammableStageDescriptor;
struct WGPURenderPassColorAttachment;
struct WGPURequiredLimits;
struct WGPUShaderModuleDescriptor;
struct WGPUSupportedLimits;
struct WGPUTextureDescriptor;
struct WGPUVertexBufferLayout;
struct WGPUBindGroupLayoutDescriptor;
struct WGPUColorTargetState;
struct WGPUComputePipelineDescriptor;
struct WGPUDeviceDescriptor;
struct WGPURenderPassDescriptor;
struct WGPUVertexState;
struct WGPUFragmentState;
struct WGPURenderPipelineDescriptor;

typedef enum WGPUColorSpace {
    SRGB,
    SRGBLinear,
    DisplayP3,
    DisplayP3Linear,
} WGPUColorSpace;

typedef enum WGPUAdapterType {
    WGPUAdapterType_DiscreteGPU = 0x00000000,
    WGPUAdapterType_IntegratedGPU = 0x00000001,
    WGPUAdapterType_CPU = 0x00000002,
    WGPUAdapterType_Unknown = 0x00000003,
    WGPUAdapterType_Force32 = 0x7FFFFFFF
} WGPUAdapterType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUAddressMode {
    WGPUAddressMode_Repeat = 0x00000000,
    WGPUAddressMode_MirrorRepeat = 0x00000001,
    WGPUAddressMode_ClampToEdge = 0x00000002,
    WGPUAddressMode_Force32 = 0x7FFFFFFF
} WGPUAddressMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBackendType {
    WGPUBackendType_Undefined = 0x00000000,
    WGPUBackendType_Null = 0x00000001,
    WGPUBackendType_WebGPU = 0x00000002,
    WGPUBackendType_D3D11 = 0x00000003,
    WGPUBackendType_D3D12 = 0x00000004,
    WGPUBackendType_Metal = 0x00000005,
    WGPUBackendType_Vulkan = 0x00000006,
    WGPUBackendType_OpenGL = 0x00000007,
    WGPUBackendType_OpenGLES = 0x00000008,
    WGPUBackendType_Force32 = 0x7FFFFFFF
} WGPUBackendType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBlendFactor {
    WGPUBlendFactor_Zero = 0x00000000,
    WGPUBlendFactor_One = 0x00000001,
    WGPUBlendFactor_Src = 0x00000002,
    WGPUBlendFactor_OneMinusSrc = 0x00000003,
    WGPUBlendFactor_SrcAlpha = 0x00000004,
    WGPUBlendFactor_OneMinusSrcAlpha = 0x00000005,
    WGPUBlendFactor_Dst = 0x00000006,
    WGPUBlendFactor_OneMinusDst = 0x00000007,
    WGPUBlendFactor_DstAlpha = 0x00000008,
    WGPUBlendFactor_OneMinusDstAlpha = 0x00000009,
    WGPUBlendFactor_SrcAlphaSaturated = 0x0000000A,
    WGPUBlendFactor_Constant = 0x0000000B,
    WGPUBlendFactor_OneMinusConstant = 0x0000000C,
    WGPUBlendFactor_Force32 = 0x7FFFFFFF
} WGPUBlendFactor WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBlendOperation {
    WGPUBlendOperation_Add = 0x00000000,
    WGPUBlendOperation_Subtract = 0x00000001,
    WGPUBlendOperation_ReverseSubtract = 0x00000002,
    WGPUBlendOperation_Min = 0x00000003,
    WGPUBlendOperation_Max = 0x00000004,
    WGPUBlendOperation_Force32 = 0x7FFFFFFF
} WGPUBlendOperation WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBufferBindingType {
    WGPUBufferBindingType_Undefined = 0x00000000,
    WGPUBufferBindingType_Uniform = 0x00000001,
    WGPUBufferBindingType_Storage = 0x00000002,
    WGPUBufferBindingType_ReadOnlyStorage = 0x00000003,
    WGPUBufferBindingType_Force32 = 0x7FFFFFFF
} WGPUBufferBindingType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBufferMapAsyncStatus {
    WGPUBufferMapAsyncStatus_Success = 0x00000000,
    WGPUBufferMapAsyncStatus_ValidationError = 0x00000001,
    WGPUBufferMapAsyncStatus_Unknown = 0x00000002,
    WGPUBufferMapAsyncStatus_DeviceLost = 0x00000003,
    WGPUBufferMapAsyncStatus_DestroyedBeforeCallback = 0x00000004,
    WGPUBufferMapAsyncStatus_UnmappedBeforeCallback = 0x00000005,
    WGPUBufferMapAsyncStatus_MappingAlreadyPending = 0x00000006,
    WGPUBufferMapAsyncStatus_OffsetOutOfRange = 0x00000007,
    WGPUBufferMapAsyncStatus_SizeOutOfRange = 0x00000008,
    WGPUBufferMapAsyncStatus_Force32 = 0x7FFFFFFF
} WGPUBufferMapAsyncStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBufferMapState {
    WGPUBufferMapState_Unmapped = 0x00000000,
    WGPUBufferMapState_Pending = 0x00000001,
    WGPUBufferMapState_Mapped = 0x00000002,
    WGPUBufferMapState_Force32 = 0x7FFFFFFF
} WGPUBufferMapState WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCompareFunction {
    WGPUCompareFunction_Undefined = 0x00000000,
    WGPUCompareFunction_Never = 0x00000001,
    WGPUCompareFunction_Less = 0x00000002,
    WGPUCompareFunction_LessEqual = 0x00000003,
    WGPUCompareFunction_Greater = 0x00000004,
    WGPUCompareFunction_GreaterEqual = 0x00000005,
    WGPUCompareFunction_Equal = 0x00000006,
    WGPUCompareFunction_NotEqual = 0x00000007,
    WGPUCompareFunction_Always = 0x00000008,
    WGPUCompareFunction_Force32 = 0x7FFFFFFF
} WGPUCompareFunction WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCompilationInfoRequestStatus {
    WGPUCompilationInfoRequestStatus_Success = 0x00000000,
    WGPUCompilationInfoRequestStatus_Error = 0x00000001,
    WGPUCompilationInfoRequestStatus_DeviceLost = 0x00000002,
    WGPUCompilationInfoRequestStatus_Unknown = 0x00000003,
    WGPUCompilationInfoRequestStatus_Force32 = 0x7FFFFFFF
} WGPUCompilationInfoRequestStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCompilationMessageType {
    WGPUCompilationMessageType_Error = 0x00000000,
    WGPUCompilationMessageType_Warning = 0x00000001,
    WGPUCompilationMessageType_Info = 0x00000002,
    WGPUCompilationMessageType_Force32 = 0x7FFFFFFF
} WGPUCompilationMessageType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUToneMappingMode {
    WGPUToneMappingMode_Standard = 0x00000000,
    WGPUToneMappingMode_Extended = 0x00000001,
} WGPUToneMappingMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCompositeAlphaMode {
    WGPUCompositeAlphaMode_Auto = 0x00000000,
    WGPUCompositeAlphaMode_Opaque = 0x00000001,
    WGPUCompositeAlphaMode_Premultiplied = 0x00000002,
    WGPUCompositeAlphaMode_Unpremultiplied = 0x00000003,
    WGPUCompositeAlphaMode_Inherit = 0x00000004,
    WGPUCompositeAlphaMode_Force32 = 0x7FFFFFFF
} WGPUCompositeAlphaMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCreatePipelineAsyncStatus {
    WGPUCreatePipelineAsyncStatus_Success = 0x00000000,
    WGPUCreatePipelineAsyncStatus_ValidationError = 0x00000001,
    WGPUCreatePipelineAsyncStatus_InternalError = 0x00000002,
    WGPUCreatePipelineAsyncStatus_DeviceLost = 0x00000003,
    WGPUCreatePipelineAsyncStatus_DeviceDestroyed = 0x00000004,
    WGPUCreatePipelineAsyncStatus_Unknown = 0x00000005,
    WGPUCreatePipelineAsyncStatus_Force32 = 0x7FFFFFFF
} WGPUCreatePipelineAsyncStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUCullMode {
    WGPUCullMode_None = 0x00000000,
    WGPUCullMode_Front = 0x00000001,
    WGPUCullMode_Back = 0x00000002,
    WGPUCullMode_Force32 = 0x7FFFFFFF
} WGPUCullMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUDeviceLostReason {
    WGPUDeviceLostReason_Undefined = 0x00000000,
    WGPUDeviceLostReason_Destroyed = 0x00000001,
    WGPUDeviceLostReason_Force32 = 0x7FFFFFFF
} WGPUDeviceLostReason WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUErrorFilter {
    WGPUErrorFilter_Validation = 0x00000000,
    WGPUErrorFilter_OutOfMemory = 0x00000001,
    WGPUErrorFilter_Internal = 0x00000002,
    WGPUErrorFilter_Force32 = 0x7FFFFFFF
} WGPUErrorFilter WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUErrorType {
    WGPUErrorType_NoError = 0x00000000,
    WGPUErrorType_Validation = 0x00000001,
    WGPUErrorType_OutOfMemory = 0x00000002,
    WGPUErrorType_Internal = 0x00000003,
    WGPUErrorType_Unknown = 0x00000004,
    WGPUErrorType_DeviceLost = 0x00000005,
    WGPUErrorType_Force32 = 0x7FFFFFFF
} WGPUErrorType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUFeatureName {
    WGPUFeatureName_Undefined = 0x00000000,
    WGPUFeatureName_DepthClipControl = 0x00000001,
    WGPUFeatureName_Depth32FloatStencil8 = 0x00000002,
    WGPUFeatureName_TimestampQuery = 0x00000003,
    WGPUFeatureName_TextureCompressionBC = 0x00000004,
    WGPUFeatureName_TextureCompressionBCSliced3D = 0x00000005,
    WGPUFeatureName_TextureCompressionETC2 = 0x00000006,
    WGPUFeatureName_TextureCompressionASTC = 0x00000007,
    WGPUFeatureName_TextureCompressionASTCSliced3D = 0x00000008,
    WGPUFeatureName_IndirectFirstInstance = 0x00000009,
    WGPUFeatureName_ShaderF16 = 0x0000000A,
    WGPUFeatureName_RG11B10UfloatRenderable = 0x0000000B,
    WGPUFeatureName_BGRA8UnormStorage = 0x0000000C,
    WGPUFeatureName_Float32Filterable = 0x0000000D,
    WGPUFeatureName_Float32Blendable = 0x0000000E,
    WGPUFeatureName_ClipDistances = 0x0000000F,
    WGPUFeatureName_DualSourceBlending = 0x00000010,
    WGPUFeatureName_PrimitiveIndex = 0x00000011,
    WGPUFeatureName_Float16Renderable = 0x00000012,
    WGPUFeatureName_Float32Renderable = 0x00000013,
    WGPUFeatureName_CoreFeaturesAndLimits = 0x00000014,
    WGPUFeatureName_TextureFormatsTier1 = 0x00000015,
    WGPUFeatureName_TextureFormatsTier2 = 0x00000016,
    WGPUFeatureName_Subgroups = 0x00000017,
    WGPUFeatureName_Force32 = 0x7FFFFFFF
} WGPUFeatureName WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUFilterMode {
    WGPUFilterMode_Nearest = 0x00000000,
    WGPUFilterMode_Linear = 0x00000001,
    WGPUFilterMode_Force32 = 0x7FFFFFFF
} WGPUFilterMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUFrontFace {
    WGPUFrontFace_CCW = 0x00000000,
    WGPUFrontFace_CW = 0x00000001,
    WGPUFrontFace_Force32 = 0x7FFFFFFF
} WGPUFrontFace WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUIndexFormat {
    WGPUIndexFormat_Undefined = 0x00000000,
    WGPUIndexFormat_Uint16 = 0x00000001,
    WGPUIndexFormat_Uint32 = 0x00000002,
    WGPUIndexFormat_Force32 = 0x7FFFFFFF
} WGPUIndexFormat WGPU_ENUM_ATTRIBUTE;

typedef enum WGPULoadOp {
    WGPULoadOp_Undefined = 0x00000000,
    WGPULoadOp_Clear = 0x00000001,
    WGPULoadOp_Load = 0x00000002,
    WGPULoadOp_Force32 = 0x7FFFFFFF
} WGPULoadOp WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUMipmapFilterMode {
    WGPUMipmapFilterMode_Nearest = 0x00000000,
    WGPUMipmapFilterMode_Linear = 0x00000001,
    WGPUMipmapFilterMode_Force32 = 0x7FFFFFFF
} WGPUMipmapFilterMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUPowerPreference {
    WGPUPowerPreference_Undefined = 0x00000000,
    WGPUPowerPreference_LowPower = 0x00000001,
    WGPUPowerPreference_HighPerformance = 0x00000002,
    WGPUPowerPreference_Force32 = 0x7FFFFFFF
} WGPUPowerPreference WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUPresentMode {
    WGPUPresentMode_Fifo = 0x00000000,
    WGPUPresentMode_FifoRelaxed = 0x00000001,
    WGPUPresentMode_Immediate = 0x00000002,
    WGPUPresentMode_Mailbox = 0x00000003,
    WGPUPresentMode_Force32 = 0x7FFFFFFF
} WGPUPresentMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUPrimitiveTopology {
    WGPUPrimitiveTopology_PointList = 0x00000000,
    WGPUPrimitiveTopology_LineList = 0x00000001,
    WGPUPrimitiveTopology_LineStrip = 0x00000002,
    WGPUPrimitiveTopology_TriangleList = 0x00000003,
    WGPUPrimitiveTopology_TriangleStrip = 0x00000004,
    WGPUPrimitiveTopology_Force32 = 0x7FFFFFFF
} WGPUPrimitiveTopology WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUQueryType {
    WGPUQueryType_Occlusion = 0x00000000,
    WGPUQueryType_Timestamp = 0x00000001,
    WGPUQueryType_Force32 = 0x7FFFFFFF
} WGPUQueryType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUQueueWorkDoneStatus {
    WGPUQueueWorkDoneStatus_Success = 0x00000000,
    WGPUQueueWorkDoneStatus_Error = 0x00000001,
    WGPUQueueWorkDoneStatus_Unknown = 0x00000002,
    WGPUQueueWorkDoneStatus_DeviceLost = 0x00000003,
    WGPUQueueWorkDoneStatus_Force32 = 0x7FFFFFFF
} WGPUQueueWorkDoneStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPURequestAdapterStatus {
    WGPURequestAdapterStatus_Success = 0x00000000,
    WGPURequestAdapterStatus_Unavailable = 0x00000001,
    WGPURequestAdapterStatus_Error = 0x00000002,
    WGPURequestAdapterStatus_Unknown = 0x00000003,
    WGPURequestAdapterStatus_Force32 = 0x7FFFFFFF
} WGPURequestAdapterStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPURequestDeviceStatus {
    WGPURequestDeviceStatus_Success = 0x00000000,
    WGPURequestDeviceStatus_Error = 0x00000001,
    WGPURequestDeviceStatus_Unknown = 0x00000002,
    WGPURequestDeviceStatus_Force32 = 0x7FFFFFFF
} WGPURequestDeviceStatus WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUSType {
    WGPUSType_Invalid = 0x00000000,
    WGPUSType_SurfaceDescriptorFromMetalLayer = 0x00000001,
    WGPUSType_SurfaceDescriptorFromWindowsHWND = 0x00000002,
    WGPUSType_SurfaceDescriptorFromXlibWindow = 0x00000003,
    WGPUSType_SurfaceDescriptorFromCanvasHTMLSelector = 0x00000004,
    WGPUSType_ShaderModuleSPIRVDescriptor = 0x00000005,
    WGPUSType_ShaderModuleWGSLDescriptor = 0x00000006,
    WGPUSType_PrimitiveDepthClipControl = 0x00000007,
    WGPUSType_SurfaceDescriptorFromWaylandSurface = 0x00000008,
    WGPUSType_SurfaceDescriptorFromAndroidNativeWindow = 0x00000009,
    WGPUSType_SurfaceDescriptorFromXcbWindow = 0x0000000A,
    WGPUSType_Force32 = 0x7FFFFFFF
} WGPUSType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUSamplerBindingType {
    WGPUSamplerBindingType_Undefined = 0x00000000,
    WGPUSamplerBindingType_Filtering = 0x00000001,
    WGPUSamplerBindingType_NonFiltering = 0x00000002,
    WGPUSamplerBindingType_Comparison = 0x00000003,
    WGPUSamplerBindingType_Force32 = 0x7FFFFFFF
} WGPUSamplerBindingType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUStencilOperation {
    WGPUStencilOperation_Keep = 0x00000000,
    WGPUStencilOperation_Zero = 0x00000001,
    WGPUStencilOperation_Replace = 0x00000002,
    WGPUStencilOperation_Invert = 0x00000003,
    WGPUStencilOperation_IncrementClamp = 0x00000004,
    WGPUStencilOperation_DecrementClamp = 0x00000005,
    WGPUStencilOperation_IncrementWrap = 0x00000006,
    WGPUStencilOperation_DecrementWrap = 0x00000007,
    WGPUStencilOperation_Force32 = 0x7FFFFFFF
} WGPUStencilOperation WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUStorageTextureAccess {
    WGPUStorageTextureAccess_Undefined = 0x00000000,
    WGPUStorageTextureAccess_WriteOnly = 0x00000001,
    WGPUStorageTextureAccess_ReadOnly = 0x00000002,
    WGPUStorageTextureAccess_ReadWrite = 0x00000003,
    WGPUStorageTextureAccess_Force32 = 0x7FFFFFFF
} WGPUStorageTextureAccess WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUStoreOp {
    WGPUStoreOp_Undefined = 0x00000000,
    WGPUStoreOp_Store = 0x00000001,
    WGPUStoreOp_Discard = 0x00000002,
    WGPUStoreOp_Force32 = 0x7FFFFFFF
} WGPUStoreOp WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureAspect {
    WGPUTextureAspect_All = 0x00000000,
    WGPUTextureAspect_StencilOnly = 0x00000001,
    WGPUTextureAspect_DepthOnly = 0x00000002,
    WGPUTextureAspect_Force32 = 0x7FFFFFFF
} WGPUTextureAspect WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureDimension {
    WGPUTextureDimension_1D = 0x00000000,
    WGPUTextureDimension_2D = 0x00000001,
    WGPUTextureDimension_3D = 0x00000002,
    WGPUTextureDimension_Force32 = 0x7FFFFFFF
} WGPUTextureDimension WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureFormat {
    WGPUTextureFormat_Undefined = 0x00000000,
    WGPUTextureFormat_R8Unorm = 0x00000001,
    WGPUTextureFormat_R8Snorm = 0x00000002,
    WGPUTextureFormat_R8Uint = 0x00000003,
    WGPUTextureFormat_R8Sint = 0x00000004,
    WGPUTextureFormat_R16Uint = 0x00000005,
    WGPUTextureFormat_R16Sint = 0x00000006,
    WGPUTextureFormat_R16Float = 0x00000007,
    WGPUTextureFormat_RG8Unorm = 0x00000008,
    WGPUTextureFormat_RG8Snorm = 0x00000009,
    WGPUTextureFormat_RG8Uint = 0x0000000A,
    WGPUTextureFormat_RG8Sint = 0x0000000B,
    WGPUTextureFormat_R32Float = 0x0000000C,
    WGPUTextureFormat_R32Uint = 0x0000000D,
    WGPUTextureFormat_R32Sint = 0x0000000E,
    WGPUTextureFormat_RG16Uint = 0x0000000F,
    WGPUTextureFormat_RG16Sint = 0x00000010,
    WGPUTextureFormat_RG16Float = 0x00000011,
    WGPUTextureFormat_RGBA8Unorm = 0x00000012,
    WGPUTextureFormat_RGBA8UnormSrgb = 0x00000013,
    WGPUTextureFormat_RGBA8Snorm = 0x00000014,
    WGPUTextureFormat_RGBA8Uint = 0x00000015,
    WGPUTextureFormat_RGBA8Sint = 0x00000016,
    WGPUTextureFormat_BGRA8Unorm = 0x00000017,
    WGPUTextureFormat_BGRA8UnormSrgb = 0x00000018,
    WGPUTextureFormat_RGB10A2Uint = 0x00000019,
    WGPUTextureFormat_RGB10A2Unorm = 0x0000001A,
    WGPUTextureFormat_RG11B10Ufloat = 0x0000001B,
    WGPUTextureFormat_RGB9E5Ufloat = 0x0000001C,
    WGPUTextureFormat_RG32Float = 0x0000001D,
    WGPUTextureFormat_RG32Uint = 0x0000001E,
    WGPUTextureFormat_RG32Sint = 0x0000001F,
    WGPUTextureFormat_RGBA16Uint = 0x00000020,
    WGPUTextureFormat_RGBA16Sint = 0x00000021,
    WGPUTextureFormat_RGBA16Float = 0x00000022,
    WGPUTextureFormat_RGBA32Float = 0x00000023,
    WGPUTextureFormat_RGBA32Uint = 0x00000024,
    WGPUTextureFormat_RGBA32Sint = 0x00000025,
    WGPUTextureFormat_Stencil8 = 0x00000026,
    WGPUTextureFormat_Depth16Unorm = 0x00000027,
    WGPUTextureFormat_Depth24Plus = 0x00000028,
    WGPUTextureFormat_Depth24PlusStencil8 = 0x00000029,
    WGPUTextureFormat_Depth32Float = 0x0000002A,
    WGPUTextureFormat_Depth32FloatStencil8 = 0x0000002B,
    WGPUTextureFormat_BC1RGBAUnorm = 0x0000002C,
    WGPUTextureFormat_BC1RGBAUnormSrgb = 0x0000002D,
    WGPUTextureFormat_BC2RGBAUnorm = 0x0000002E,
    WGPUTextureFormat_BC2RGBAUnormSrgb = 0x0000002F,
    WGPUTextureFormat_BC3RGBAUnorm = 0x00000030,
    WGPUTextureFormat_BC3RGBAUnormSrgb = 0x00000031,
    WGPUTextureFormat_BC4RUnorm = 0x00000032,
    WGPUTextureFormat_BC4RSnorm = 0x00000033,
    WGPUTextureFormat_BC5RGUnorm = 0x00000034,
    WGPUTextureFormat_BC5RGSnorm = 0x00000035,
    WGPUTextureFormat_BC6HRGBUfloat = 0x00000036,
    WGPUTextureFormat_BC6HRGBFloat = 0x00000037,
    WGPUTextureFormat_BC7RGBAUnorm = 0x00000038,
    WGPUTextureFormat_BC7RGBAUnormSrgb = 0x00000039,
    WGPUTextureFormat_ETC2RGB8Unorm = 0x0000003A,
    WGPUTextureFormat_ETC2RGB8UnormSrgb = 0x0000003B,
    WGPUTextureFormat_ETC2RGB8A1Unorm = 0x0000003C,
    WGPUTextureFormat_ETC2RGB8A1UnormSrgb = 0x0000003D,
    WGPUTextureFormat_ETC2RGBA8Unorm = 0x0000003E,
    WGPUTextureFormat_ETC2RGBA8UnormSrgb = 0x0000003F,
    WGPUTextureFormat_EACR11Unorm = 0x00000040,
    WGPUTextureFormat_EACR11Snorm = 0x00000041,
    WGPUTextureFormat_EACRG11Unorm = 0x00000042,
    WGPUTextureFormat_EACRG11Snorm = 0x00000043,
    WGPUTextureFormat_ASTC4x4Unorm = 0x00000044,
    WGPUTextureFormat_ASTC4x4UnormSrgb = 0x00000045,
    WGPUTextureFormat_ASTC5x4Unorm = 0x00000046,
    WGPUTextureFormat_ASTC5x4UnormSrgb = 0x00000047,
    WGPUTextureFormat_ASTC5x5Unorm = 0x00000048,
    WGPUTextureFormat_ASTC5x5UnormSrgb = 0x00000049,
    WGPUTextureFormat_ASTC6x5Unorm = 0x0000004A,
    WGPUTextureFormat_ASTC6x5UnormSrgb = 0x0000004B,
    WGPUTextureFormat_ASTC6x6Unorm = 0x0000004C,
    WGPUTextureFormat_ASTC6x6UnormSrgb = 0x0000004D,
    WGPUTextureFormat_ASTC8x5Unorm = 0x0000004E,
    WGPUTextureFormat_ASTC8x5UnormSrgb = 0x0000004F,
    WGPUTextureFormat_ASTC8x6Unorm = 0x00000050,
    WGPUTextureFormat_ASTC8x6UnormSrgb = 0x00000051,
    WGPUTextureFormat_ASTC8x8Unorm = 0x00000052,
    WGPUTextureFormat_ASTC8x8UnormSrgb = 0x00000053,
    WGPUTextureFormat_ASTC10x5Unorm = 0x00000054,
    WGPUTextureFormat_ASTC10x5UnormSrgb = 0x00000055,
    WGPUTextureFormat_ASTC10x6Unorm = 0x00000056,
    WGPUTextureFormat_ASTC10x6UnormSrgb = 0x00000057,
    WGPUTextureFormat_ASTC10x8Unorm = 0x00000058,
    WGPUTextureFormat_ASTC10x8UnormSrgb = 0x00000059,
    WGPUTextureFormat_ASTC10x10Unorm = 0x0000005A,
    WGPUTextureFormat_ASTC10x10UnormSrgb = 0x0000005B,
    WGPUTextureFormat_ASTC12x10Unorm = 0x0000005C,
    WGPUTextureFormat_ASTC12x10UnormSrgb = 0x0000005D,
    WGPUTextureFormat_ASTC12x12Unorm = 0x0000005E,
    WGPUTextureFormat_ASTC12x12UnormSrgb = 0x0000005F,
    WGPUTextureFormat_R16Unorm = 0x00000060,
    WGPUTextureFormat_R16Snorm = 0x00000061,
    WGPUTextureFormat_RG16Unorm = 0x00000062,
    WGPUTextureFormat_RG16Snorm = 0x00000063,
    WGPUTextureFormat_RGBA16Unorm = 0x00000064,
    WGPUTextureFormat_RGBA16Snorm = 0x00000065,
    WGPUTextureFormat_Force32 = 0x7FFFFFFF
} WGPUTextureFormat WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureSampleType {
    WGPUTextureSampleType_Undefined = 0x00000000,
    WGPUTextureSampleType_Float = 0x00000001,
    WGPUTextureSampleType_UnfilterableFloat = 0x00000002,
    WGPUTextureSampleType_Depth = 0x00000003,
    WGPUTextureSampleType_Sint = 0x00000004,
    WGPUTextureSampleType_Uint = 0x00000005,
    WGPUTextureSampleType_Force32 = 0x7FFFFFFF
} WGPUTextureSampleType WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureViewDimension {
    WGPUTextureViewDimension_Undefined = 0x00000000,
    WGPUTextureViewDimension_1D = 0x00000001,
    WGPUTextureViewDimension_2D = 0x00000002,
    WGPUTextureViewDimension_2DArray = 0x00000003,
    WGPUTextureViewDimension_Cube = 0x00000004,
    WGPUTextureViewDimension_CubeArray = 0x00000005,
    WGPUTextureViewDimension_3D = 0x00000006,
    WGPUTextureViewDimension_Force32 = 0x7FFFFFFF
} WGPUTextureViewDimension WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUVertexFormat {
    WGPUVertexFormat_Undefined = 0x00000000,
    WGPUVertexFormat_Uint8,
    WGPUVertexFormat_Uint8x2,
    WGPUVertexFormat_Uint8x4,
    WGPUVertexFormat_Sint8,
    WGPUVertexFormat_Sint8x2,
    WGPUVertexFormat_Sint8x4,
    WGPUVertexFormat_Unorm8,
    WGPUVertexFormat_Unorm8x2,
    WGPUVertexFormat_Unorm8x4,
    WGPUVertexFormat_Snorm8,
    WGPUVertexFormat_Snorm8x2,
    WGPUVertexFormat_Snorm8x4,
    WGPUVertexFormat_Uint16,
    WGPUVertexFormat_Uint16x2,
    WGPUVertexFormat_Uint16x4,
    WGPUVertexFormat_Sint16,
    WGPUVertexFormat_Sint16x2,
    WGPUVertexFormat_Sint16x4,
    WGPUVertexFormat_Unorm16,
    WGPUVertexFormat_Unorm16x2,
    WGPUVertexFormat_Unorm16x4,
    WGPUVertexFormat_Snorm16,
    WGPUVertexFormat_Snorm16x2,
    WGPUVertexFormat_Snorm16x4,
    WGPUVertexFormat_Float16,
    WGPUVertexFormat_Float16x2,
    WGPUVertexFormat_Float16x4,
    WGPUVertexFormat_Float32,
    WGPUVertexFormat_Float32x2,
    WGPUVertexFormat_Float32x3,
    WGPUVertexFormat_Float32x4,
    WGPUVertexFormat_Uint32,
    WGPUVertexFormat_Uint32x2,
    WGPUVertexFormat_Uint32x3,
    WGPUVertexFormat_Uint32x4,
    WGPUVertexFormat_Sint32,
    WGPUVertexFormat_Sint32x2,
    WGPUVertexFormat_Sint32x3,
    WGPUVertexFormat_Sint32x4,
    WGPUVertexFormat_Unorm1010102,
    WGPUVertexFormat_Unorm8x4Bgra,
    WGPUVertexFormat_Force32 = 0x7FFFFFFF
} WGPUVertexFormat WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUVertexStepMode {
    WGPUVertexStepMode_Vertex = 0x00000000,
    WGPUVertexStepMode_Instance = 0x00000001,
    WGPUVertexStepMode_VertexBufferNotUsed = 0x00000002,
    WGPUVertexStepMode_Force32 = 0x7FFFFFFF
} WGPUVertexStepMode WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUBufferUsage {
    WGPUBufferUsage_None = 0x00000000,
    WGPUBufferUsage_MapRead = 0x00000001,
    WGPUBufferUsage_MapWrite = 0x00000002,
    WGPUBufferUsage_CopySrc = 0x00000004,
    WGPUBufferUsage_CopyDst = 0x00000008,
    WGPUBufferUsage_Index = 0x00000010,
    WGPUBufferUsage_Vertex = 0x00000020,
    WGPUBufferUsage_Uniform = 0x00000040,
    WGPUBufferUsage_Storage = 0x00000080,
    WGPUBufferUsage_Indirect = 0x00000100,
    WGPUBufferUsage_QueryResolve = 0x00000200,
    WGPUBufferUsage_Force32 = 0x7FFFFFFF
} WGPUBufferUsage WGPU_ENUM_ATTRIBUTE;
typedef WGPUFlags WGPUBufferUsageFlags WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUColorWriteMask {
    WGPUColorWriteMask_None = 0x00000000,
    WGPUColorWriteMask_Red = 0x00000001,
    WGPUColorWriteMask_Green = 0x00000002,
    WGPUColorWriteMask_Blue = 0x00000004,
    WGPUColorWriteMask_Alpha = 0x00000008,
    WGPUColorWriteMask_All = 0x0000000F,
    WGPUColorWriteMask_Force32 = 0x7FFFFFFF
} WGPUColorWriteMask WGPU_ENUM_ATTRIBUTE;
typedef WGPUFlags WGPUColorWriteMaskFlags WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUMapMode {
    WGPUMapMode_None = 0x00000000,
    WGPUMapMode_Read = 0x00000001,
    WGPUMapMode_Write = 0x00000002,
    WGPUMapMode_Force32 = 0x7FFFFFFF
} WGPUMapMode WGPU_ENUM_ATTRIBUTE;
typedef WGPUFlags WGPUMapModeFlags WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUShaderStage {
    WGPUShaderStage_None = 0x00000000,
    WGPUShaderStage_Vertex = 0x00000001,
    WGPUShaderStage_Fragment = 0x00000002,
    WGPUShaderStage_Compute = 0x00000004,
    WGPUShaderStage_Force32 = 0x7FFFFFFF
} WGPUShaderStage WGPU_ENUM_ATTRIBUTE;
typedef WGPUFlags WGPUShaderStageFlags WGPU_ENUM_ATTRIBUTE;

typedef enum WGPUTextureUsage {
    WGPUTextureUsage_None = 0x00000000,
    WGPUTextureUsage_CopySrc = 0x00000001,
    WGPUTextureUsage_CopyDst = 0x00000002,
    WGPUTextureUsage_TextureBinding = 0x00000004,
    WGPUTextureUsage_StorageBinding = 0x00000008,
    WGPUTextureUsage_RenderAttachment = 0x00000010,
    WGPUTextureUsage_Transient = 0x00000020,
    WGPUTextureUsage_Force32 = 0x7FFFFFFF
} WGPUTextureUsage WGPU_ENUM_ATTRIBUTE;
typedef WGPUFlags WGPUTextureUsageFlags WGPU_ENUM_ATTRIBUTE;

typedef void (*WGPUBufferMapCallback)(WGPUBufferMapAsyncStatus status, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUCompilationInfoCallback)(WGPUCompilationInfoRequestStatus status, struct WGPUCompilationInfo const * compilationInfo, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUCreateComputePipelineAsyncCallback)(WGPUCreatePipelineAsyncStatus status, WGPUComputePipeline pipeline, WTF::String&& message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUCreateRenderPipelineAsyncCallback)(WGPUCreatePipelineAsyncStatus status, WGPURenderPipeline pipeline, WTF::String&& message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUDeviceLostCallback)(WGPUDeviceLostReason reason, char const * message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUErrorCallback)(WGPUErrorType type, char const * message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProc)(void) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUQueueWorkDoneCallback)(WGPUQueueWorkDoneStatus status, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPURequestAdapterCallback)(WGPURequestAdapterStatus status, WGPUAdapter adapter, char const * message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPURequestDeviceCallback)(WGPURequestDeviceStatus status, WGPUDevice device, char const * message, void * userdata) WGPU_FUNCTION_ATTRIBUTE;

typedef struct WGPUChainedStruct {
    struct WGPUChainedStruct const * next;
    WGPUSType sType;
} WGPUChainedStruct WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUChainedStructOut {
    struct WGPUChainedStructOut * next;
    WGPUSType sType;
} WGPUChainedStructOut WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUAdapterProperties {
    uint32_t vendorID;
    char const * vendorName;
    char const * architecture;
    uint32_t deviceID;
    char const * name;
    char const * driverDescription;
    WGPUAdapterType adapterType;
    WGPUBackendType backendType;
    uint32_t subgroupMinSize;
    uint32_t subgroupMaxSize;
} WGPUAdapterProperties WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBindGroupEntry {
    uint32_t binding;
    WGPU_NULLABLE WGPUBuffer buffer;
    uint64_t offset;
    uint64_t size;
    WGPU_NULLABLE WGPUSampler sampler;
    WGPU_NULLABLE WGPUTexture texture;
    WGPU_NULLABLE WGPUTextureView textureView;
    WGPU_NULLABLE WGPUExternalTexture externalTexture;
} WGPUBindGroupEntry WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBlendComponent {
    WGPUBlendOperation operation;
    WGPUBlendFactor srcFactor;
    WGPUBlendFactor dstFactor;
} WGPUBlendComponent WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBufferBindingLayout {
    WGPUBufferBindingType type;
    WGPUBool hasDynamicOffset;
    uint64_t minBindingSize;
    uint64_t bufferSizeForBinding;
} WGPUBufferBindingLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBufferDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUBufferUsageFlags usage;
    uint64_t size;
    WGPUBool mappedAtCreation;
} WGPUBufferDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUColor {
    double r;
    double g;
    double b;
    double a;
} WGPUColor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUCommandBufferDescriptor {
    WGPU_NULLABLE WTF::String label;
} WGPUCommandBufferDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUCommandEncoderDescriptor {
    WGPU_NULLABLE char const * label;
} WGPUCommandEncoderDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUCompilationMessage {
    WTF::String message;
    WGPUCompilationMessageType type;
    uint64_t lineNum;
    uint64_t linePos;
    uint64_t offset;
    uint64_t length;
    uint64_t utf16LinePos;
    uint64_t utf16Offset;
    uint64_t utf16Length;
} WGPUCompilationMessage WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUComputePassTimestampWrites {
    WGPUQuerySet querySet;
    uint32_t beginningOfPassWriteIndex;
    uint32_t endOfPassWriteIndex;
} WGPUComputePassTimestampWrites WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUConstantEntry {
    char const * key;
    double value;
} WGPUConstantEntry WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUExtent3D {
    uint32_t width;
    uint32_t height;
    uint32_t depthOrArrayLayers;
} WGPUExtent3D WGPU_STRUCTURE_ATTRIBUTE;

typedef void (^WGPUWorkItem)(void);
typedef void (^WGPUScheduleWorkBlock)(WGPUWorkItem workItem);
typedef void (^WGPUDeviceLostBlockCallback)(WGPUDeviceLostReason reason, char const * message);

typedef void (^WGPURenderBuffersWereRecreatedBlockCallback)(CFArrayRef ioSurfaces);
typedef void (^WGPUOnSubmittedWorkScheduledCallback)(WGPUWorkItem);
typedef void (^WGPUCompositorIntegrationRegisterBlockCallback)(WGPURenderBuffersWereRecreatedBlockCallback renderBuffersWereRecreated, WGPUOnSubmittedWorkScheduledCallback onSubmittedWorkScheduledCallback);

typedef struct WGPUInstanceCocoaDescriptor {
    // The API contract is: callers must call WebGPU's functions in a non-racey way with respect
    // to each other. This scheduleWorkBlock will execute on a background thread, and it must
    // schedule the block it's passed to be run in a non-racey way with regards to all the other
    // WebGPU calls. If calls to scheduleWorkBlock are ordered (e.g. multiple calls on the same
    // thread), then the work that is scheduled must also be ordered in the same order.
    // It's fine to pass NULL here, but if you do, you must periodically call
    // wgpuInstanceProcessEvents() to synchronously run the queued callbacks.
    __unsafe_unretained WGPUScheduleWorkBlock scheduleWorkBlock;
    const void* webProcessResourceOwner;
} WGPUInstanceCocoaDescriptor;

typedef struct WGPUInstanceDescriptor {
    WGPUInstanceCocoaDescriptor cocoaDescriptor;
} WGPUInstanceDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPULimits {
    uint32_t maxTextureDimension1D;
    uint32_t maxTextureDimension2D;
    uint32_t maxTextureDimension3D;
    uint32_t maxTextureArrayLayers;
    uint32_t maxBindGroups;
    uint32_t maxBindGroupsPlusVertexBuffers;
    uint32_t maxBindingsPerBindGroup;
    uint32_t maxDynamicUniformBuffersPerPipelineLayout;
    uint32_t maxDynamicStorageBuffersPerPipelineLayout;
    uint32_t maxSampledTexturesPerShaderStage;
    uint32_t maxSamplersPerShaderStage;
    uint32_t maxStorageBuffersPerShaderStage;
    uint32_t maxStorageTexturesPerShaderStage;
    uint32_t maxUniformBuffersPerShaderStage;
    uint64_t maxUniformBufferBindingSize;
    uint64_t maxStorageBufferBindingSize;
    uint32_t minUniformBufferOffsetAlignment;
    uint32_t minStorageBufferOffsetAlignment;
    uint32_t maxVertexBuffers;
    uint64_t maxBufferSize;
    uint32_t maxVertexAttributes;
    uint32_t maxVertexBufferArrayStride;
    uint32_t maxInterStageShaderVariables;
    uint32_t maxColorAttachments;
    uint32_t maxColorAttachmentBytesPerSample;
    uint32_t maxComputeWorkgroupStorageSize;
    uint32_t maxComputeInvocationsPerWorkgroup;
    uint32_t maxComputeWorkgroupSizeX;
    uint32_t maxComputeWorkgroupSizeY;
    uint32_t maxComputeWorkgroupSizeZ;
    uint32_t maxComputeWorkgroupsPerDimension;
    uint32_t maxStorageBuffersInFragmentStage;
    uint32_t maxStorageTexturesInFragmentStage;
    uint32_t maxStorageBuffersInVertexStage;
    uint32_t maxStorageTexturesInVertexStage;
} WGPULimits WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUMultisampleState {
    uint32_t count;
    uint32_t mask;
    WGPUBool alphaToCoverageEnabled;
} WGPUMultisampleState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUOrigin3D {
    uint32_t x;
    uint32_t y;
    uint32_t z;
} WGPUOrigin3D WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUPipelineLayoutDescriptor {
    WGPU_NULLABLE char const * label;
    size_t bindGroupLayoutCount;
    WGPUBindGroupLayout const * bindGroupLayouts;

    auto bindGroupLayoutsSpan() const { return unsafeMakeSpan(bindGroupLayouts, bindGroupLayoutCount); }
} WGPUPipelineLayoutDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUPrimitiveState {
    WGPUPrimitiveTopology topology;
    WGPUIndexFormat stripIndexFormat;
    WGPUFrontFace frontFace;
    WGPUCullMode cullMode;
    WGPUBool unclippedDepth;
} WGPUPrimitiveState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUQuerySetDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUQueryType type;
    uint32_t count;
} WGPUQuerySetDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUQueueDescriptor {
    WGPU_NULLABLE char const * label;
} WGPUQueueDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderBundleDescriptor {
    WGPU_NULLABLE char const * label;
} WGPURenderBundleDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderBundleEncoderDescriptor {
    WGPU_NULLABLE char const * label;
    size_t colorFormatCount;
    WGPUTextureFormat const * colorFormats;
    WGPUTextureFormat depthStencilFormat;
    uint32_t sampleCount;
    WGPUBool depthReadOnly;
    WGPUBool stencilReadOnly;

    auto colorFormatsSpan() const { return unsafeMakeSpan(colorFormats, colorFormatCount); }
} WGPURenderBundleEncoderDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderPassDepthStencilAttachment {
    WGPUTexture texture;
    WGPUTextureView view;
    WGPULoadOp depthLoadOp;
    WGPUStoreOp depthStoreOp;
    float depthClearValue;
    WGPUBool depthReadOnly;
    WGPULoadOp stencilLoadOp;
    WGPUStoreOp stencilStoreOp;
    uint32_t stencilClearValue;
    WGPUBool stencilReadOnly;
} WGPURenderPassDepthStencilAttachment WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderPassTimestampWrites {
    WGPUQuerySet querySet;
    uint32_t beginningOfPassWriteIndex;
    uint32_t endOfPassWriteIndex;
} WGPURenderPassTimestampWrites WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURequestAdapterOptions {
    WGPU_NULLABLE WGPUSurface compatibleSurface;
    WGPUPowerPreference powerPreference;
    WGPUBackendType backendType;
    WGPUBool forceFallbackAdapter;
    WGPUBool xrCompatible;
} WGPURequestAdapterOptions WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUSamplerBindingLayout {
    WGPUSamplerBindingType type;
} WGPUSamplerBindingLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUSamplerDescriptor {
    WTF::String label;
    WGPUAddressMode addressModeU;
    WGPUAddressMode addressModeV;
    WGPUAddressMode addressModeW;
    WGPUFilterMode magFilter;
    WGPUFilterMode minFilter;
    WGPUMipmapFilterMode mipmapFilter;
    float lodMinClamp;
    float lodMaxClamp;
    WGPUCompareFunction compare;
    uint16_t maxAnisotropy;
} WGPUSamplerDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUShaderModuleCompilationHint {
    char const * entryPoint;
    WGPUPipelineLayout layout;
} WGPUShaderModuleCompilationHint WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUStencilFaceState {
    WGPUCompareFunction compare;
    WGPUStencilOperation failOp;
    WGPUStencilOperation depthFailOp;
    WGPUStencilOperation passOp;
} WGPUStencilFaceState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUStorageTextureBindingLayout {
    WGPUStorageTextureAccess access;
    WGPUTextureFormat format;
    WGPUTextureViewDimension viewDimension;
} WGPUStorageTextureBindingLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUSurfaceDescriptorCocoaCustomSurface {
    WGPUCompositorIntegrationRegisterBlockCallback compositorIntegrationRegister;
} WGPUSurfaceDescriptorCocoaCustomSurface;

typedef struct WGPUSurfaceDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUSurfaceDescriptorCocoaCustomSurface cocoaDescriptor;
} WGPUSurfaceDescriptor WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromAndroidNativeWindow {
    WGPUChainedStruct chain;
    void * window;
} WGPUSurfaceDescriptorFromAndroidNativeWindow WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromCanvasHTMLSelector {
    WGPUChainedStruct chain;
    char const * selector;
} WGPUSurfaceDescriptorFromCanvasHTMLSelector WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromMetalLayer {
    WGPUChainedStruct chain;
    void * layer;
} WGPUSurfaceDescriptorFromMetalLayer WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromWaylandSurface {
    WGPUChainedStruct chain;
    void * display;
    void * surface;
} WGPUSurfaceDescriptorFromWaylandSurface WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromWindowsHWND {
    WGPUChainedStruct chain;
    void * hinstance;
    void * hwnd;
} WGPUSurfaceDescriptorFromWindowsHWND WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromXcbWindow {
    WGPUChainedStruct chain;
    void * connection;
    uint32_t window;
} WGPUSurfaceDescriptorFromXcbWindow WGPU_STRUCTURE_ATTRIBUTE;

// Can be chained in WGPUSurfaceDescriptor
typedef struct WGPUSurfaceDescriptorFromXlibWindow {
    WGPUChainedStruct chain;
    void * display;
    uint64_t window;
} WGPUSurfaceDescriptorFromXlibWindow WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUSwapChainDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUTextureUsageFlags usage;
    WGPUTextureFormat format;
    uint32_t width;
    uint32_t height;
    WGPUPresentMode presentMode;
    Vector<WGPUTextureFormat> viewFormats;
    WGPUColorSpace colorSpace;
    WGPUToneMappingMode toneMappingMode;
    WGPUCompositeAlphaMode compositeAlphaMode;
    WGPUBool reportValidationErrors;
} WGPUSwapChainDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUTextureBindingLayout {
    WGPUTextureSampleType sampleType;
    WGPUTextureViewDimension viewDimension;
    WGPUBool multisampled;
} WGPUTextureBindingLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUTextureDataLayout {
    uint64_t offset;
    uint32_t bytesPerRow;
    uint32_t rowsPerImage;
} WGPUTextureDataLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUTextureViewDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUTextureFormat format;
    WGPUTextureViewDimension dimension;
    uint32_t baseMipLevel;
    uint32_t mipLevelCount;
    uint32_t baseArrayLayer;
    uint32_t arrayLayerCount;
    WGPUTextureAspect aspect;
    WGPUTextureUsageFlags usage;
} WGPUTextureViewDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUVertexAttribute {
    WGPUVertexFormat format;
    uint64_t offset;
    uint32_t shaderLocation;
} WGPUVertexAttribute WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBindGroupDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUBindGroupLayout layout;
    size_t entryCount;
    WGPUBindGroupEntry const * entries;

    auto entriesSpan() const { return unsafeMakeSpan(entries, entryCount); }
} WGPUBindGroupDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBindGroupLayoutEntry {
    uint32_t binding;
    std::array<uint32_t, WGPUShaderStage_Compute / 2 + 1> metalBinding;
    WGPUShaderStageFlags visibility;
    WGPUBufferBindingLayout buffer;
    WGPUSamplerBindingLayout sampler;
    WGPUTextureBindingLayout texture;
    WGPUStorageTextureBindingLayout storageTexture;
} WGPUBindGroupLayoutEntry WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBlendState {
    WGPUBlendComponent color;
    WGPUBlendComponent alpha;
} WGPUBlendState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUCompilationInfo {
    size_t messageCount;
    WGPUCompilationMessage const * messages;
} WGPUCompilationInfo WGPU_STRUCTURE_ATTRIBUTE;

inline std::span<const WGPUCompilationMessage> messagesSpan(const WGPUCompilationInfo& compilationInfo)
{
    return unsafeMakeSpan(compilationInfo.messages, compilationInfo.messageCount);
}

typedef struct WGPUComputePassDescriptor {
    WGPU_NULLABLE WTF::String label;
    WGPU_NULLABLE WGPUComputePassTimestampWrites const * timestampWrites;
} SWIFT_ESCAPABLE WGPUComputePassDescriptor WGPU_STRUCTURE_ATTRIBUTE; // FIXME: This is unsafe!

static inline WGPU_NULLABLE WGPUComputePassTimestampWrites const * _Nullable __counted_by(1) wgpuGetComputePassDescriptorTimestampWrites(const WGPUComputePassDescriptor * __counted_by(1) descriptor LIFETIME_BOUND) {
    return descriptor->timestampWrites;
}

typedef struct WGPUDepthStencilState {
    WGPUTextureFormat format;
    std::optional<WGPUBool> depthWriteEnabled;
    WGPUCompareFunction depthCompare;
    WGPUStencilFaceState stencilFront;
    WGPUStencilFaceState stencilBack;
    uint32_t stencilReadMask;
    uint32_t stencilWriteMask;
    int32_t depthBias;
    float depthBiasSlopeScale;
    float depthBiasClamp;
} WGPUDepthStencilState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUImageCopyBuffer {
    WGPUTextureDataLayout layout;
    WGPUBuffer buffer;
} WGPUImageCopyBuffer WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUImageCopyTexture {
    WGPUTexture texture;
    uint32_t mipLevel;
    WGPUOrigin3D origin;
    WGPUTextureAspect aspect;
} WGPUImageCopyTexture WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUProgrammableStageDescriptor {
    WGPUShaderModule module;
    char const * entryPoint;
    size_t constantCount;
    WGPUConstantEntry const * constants;

    auto constantsSpan() const { return unsafeMakeSpan(constants, constantCount); }
} WGPUProgrammableStageDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderPassColorAttachment {
    WGPU_NULLABLE WGPUTexture texture;
    WGPU_NULLABLE WGPUTextureView view;
    std::optional<uint32_t> depthSlice;
    WGPU_NULLABLE WGPUTexture resolveTexture;
    WGPU_NULLABLE WGPUTextureView resolveTarget;
    WGPULoadOp loadOp;
    WGPUStoreOp storeOp;
    WGPUColor clearValue;
} WGPURenderPassColorAttachment WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURequiredLimits {
    WGPULimits limits;
} WGPURequiredLimits WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUShaderModuleDescriptor {
    WTF::String wgslDescriptor;
    WGPU_NULLABLE char const * label;
    size_t hintCount;
    WGPUShaderModuleCompilationHint const * hints;

    auto hintsSpan() const { return unsafeMakeSpan(hints, hintCount); }
} WGPUShaderModuleDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUSupportedLimits {
    WGPULimits limits;
} WGPUSupportedLimits WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUTextureDescriptor {
    WGPU_NULLABLE char const * label;
    WGPUTextureUsageFlags usage;
    WGPUTextureDimension dimension;
    WGPUExtent3D size;
    WGPUTextureFormat format;
    uint32_t mipLevelCount;
    uint32_t sampleCount;
    size_t viewFormatCount;
    WGPUTextureFormat const * viewFormats;

    auto viewFormatsSpan() const { return unsafeMakeSpan(viewFormats, viewFormatCount); }
} WGPUTextureDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUVertexBufferLayout {
    uint64_t arrayStride;
    WGPUVertexStepMode stepMode;
    size_t attributeCount;
    WGPUVertexAttribute const * attributes;

    auto attributesSpan() const { return unsafeMakeSpan(attributes, attributeCount); }
} WGPUVertexBufferLayout WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUBindGroupLayoutDescriptor {
    WGPU_NULLABLE char const * label;
    size_t entryCount;
    WGPUBindGroupLayoutEntry const * entries;

    auto entriesSpan() const { return unsafeMakeSpan(entries, entryCount); }
} WGPUBindGroupLayoutDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUColorTargetState {
    WGPUTextureFormat format;
    WGPU_NULLABLE WGPUBlendState const * blend;
    WGPUColorWriteMaskFlags writeMask;
} WGPUColorTargetState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUComputePipelineDescriptor {
    WGPU_NULLABLE char const * label;
    WGPU_NULLABLE WGPUPipelineLayout layout;
    WGPUProgrammableStageDescriptor compute;
} WGPUComputePipelineDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUDeviceDescriptor {
    WGPU_NULLABLE char const * label;
    size_t requiredFeatureCount;
    WGPUFeatureName const * requiredFeatures;
    WGPU_NULLABLE WGPURequiredLimits const * requiredLimits;
    WGPUQueueDescriptor defaultQueue;
    WGPUDeviceLostCallback deviceLostCallback;
    void * deviceLostUserdata;

    auto requiredFeaturesSpan() const { return unsafeMakeSpan(requiredFeatures, requiredFeatureCount); }
} WGPUDeviceDescriptor WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderPassDescriptor {
    uint64_t maxDrawCount;
    WGPU_NULLABLE char const * label;
    size_t colorAttachmentCount;
    WGPURenderPassColorAttachment const * colorAttachments;
    WGPU_NULLABLE WGPURenderPassDepthStencilAttachment const * depthStencilAttachment;
    WGPU_NULLABLE WGPUQuerySet occlusionQuerySet;
    WGPU_NULLABLE WGPURenderPassTimestampWrites const * timestampWrites;

    auto colorAttachmentsSpan() const { return unsafeMakeSpan(colorAttachments, colorAttachmentCount); }
} SWIFT_ESCAPABLE WGPURenderPassDescriptor WGPU_STRUCTURE_ATTRIBUTE; // FIXME: This is unsafe!

inline WGPURenderPassTimestampWrites const * _Nullable __counted_by(1) wgpuGetRenderPassDescriptorTimestampWrites(const WGPURenderPassDescriptor * __counted_by(1) descriptor LIFETIME_BOUND) {
    return descriptor->timestampWrites;
}

inline WGPURenderPassColorAttachment const * __counted_by(count) wgpuGetRenderPassDescriptorColorAttachments(const WGPURenderPassDescriptor * __counted_by(1) descriptor LIFETIME_BOUND, size_t count) {
    ((void)count);
    return descriptor->colorAttachments;
}

inline WGPURenderPassDepthStencilAttachment const * _Nullable __counted_by(1) wgpuGetRenderPassDescriptorDepthStencilAttachment(const WGPURenderPassDescriptor * __counted_by(1) descriptor LIFETIME_BOUND) {
    return descriptor->depthStencilAttachment;
}

typedef struct WGPUVertexState {
    WGPUShaderModule module;
    char const * entryPoint;
    size_t constantCount;
    WGPUConstantEntry const * constants;
    size_t bufferCount;
    WGPUVertexBufferLayout const * buffers;

    auto buffersSpan() const { return unsafeMakeSpan(buffers, bufferCount); }
    auto constantsSpan() const { return unsafeMakeSpan(constants, constantCount); }
} WGPUVertexState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPUFragmentState {
    WGPUShaderModule module;
    char const * entryPoint;
    size_t constantCount;
    WGPUConstantEntry const * constants;
    size_t targetCount;
    WGPUColorTargetState const * targets;

    auto targetsSpan() const { return unsafeMakeSpan(targets, targetCount); }
    auto constantsSpan() const { return unsafeMakeSpan(constants, constantCount); }
} WGPUFragmentState WGPU_STRUCTURE_ATTRIBUTE;

typedef struct WGPURenderPipelineDescriptor {
    WGPU_NULLABLE char const * label;
    WGPU_NULLABLE WGPUPipelineLayout layout;
    WGPUVertexState vertex;
    WGPUPrimitiveState primitive;
    WGPU_NULLABLE WGPUDepthStencilState const * depthStencil;
    WGPUMultisampleState multisample;
    WGPU_NULLABLE WGPUFragmentState const * fragment;
} WGPURenderPipelineDescriptor WGPU_STRUCTURE_ATTRIBUTE;

#if !defined(WGPU_SKIP_PROCS)

typedef WGPUInstance (*WGPUProcCreateInstance)(WGPU_NULLABLE WGPUInstanceDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUProc (*WGPUProcGetProcAddress)(WGPUDevice device, char const * procName) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Adapter
typedef size_t (*WGPUProcAdapterEnumerateFeatures)(WGPUAdapter adapter, WGPUFeatureName * features) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBool (*WGPUProcAdapterGetLimits)(WGPUAdapter adapter, WGPUSupportedLimits * limits) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcAdapterGetProperties)(WGPUAdapter adapter, WGPUAdapterProperties * properties) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBool (*WGPUProcAdapterHasFeature)(WGPUAdapter adapter, WGPUFeatureName feature) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcAdapterRequestDevice)(WGPUAdapter adapter, WGPU_NULLABLE WGPUDeviceDescriptor const * descriptor, WGPURequestDeviceCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcAdapterReference)(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcAdapterRelease)(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;

// Procs of BindGroup
typedef void (*WGPUProcBindGroupSetLabel)(WGPUBindGroup bindGroup, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBindGroupReference)(WGPUBindGroup bindGroup) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBindGroupRelease)(WGPUBindGroup bindGroup) WGPU_FUNCTION_ATTRIBUTE;

// Procs of BindGroupLayout
typedef void (*WGPUProcBindGroupLayoutSetLabel)(WGPUBindGroupLayout bindGroupLayout, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBindGroupLayoutReference)(WGPUBindGroupLayout bindGroupLayout) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBindGroupLayoutRelease)(WGPUBindGroupLayout bindGroupLayout) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Buffer
typedef void (*WGPUProcBufferDestroy)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef void const * (*WGPUProcBufferGetConstMappedRange)(WGPUBuffer buffer, size_t offset, size_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBufferMapState (*WGPUProcBufferGetMapState)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef uint64_t (*WGPUProcBufferGetSize)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBufferUsageFlags (*WGPUProcBufferGetUsage)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBufferMapAsync)(WGPUBuffer buffer, WGPUMapModeFlags mode, size_t offset, size_t size, WGPUBufferMapCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBufferSetLabel)(WGPUBuffer buffer, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBufferUnmap)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBufferReference)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcBufferRelease)(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;

// Procs of CommandBuffer
typedef void (*WGPUProcCommandBufferSetLabel)(WGPUCommandBuffer commandBuffer, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandBufferReference)(WGPUCommandBuffer commandBuffer) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandBufferRelease)(WGPUCommandBuffer commandBuffer) WGPU_FUNCTION_ATTRIBUTE;

// Procs of CommandEncoder
typedef WGPUComputePassEncoder (*WGPUProcCommandEncoderBeginComputePass)(WGPUCommandEncoder commandEncoder, WGPU_NULLABLE WGPUComputePassDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPURenderPassEncoder (*WGPUProcCommandEncoderBeginRenderPass)(WGPUCommandEncoder commandEncoder, WGPURenderPassDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderClearBuffer)(WGPUCommandEncoder commandEncoder, WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderCopyBufferToBuffer)(WGPUCommandEncoder commandEncoder, WGPUBuffer source, uint64_t sourceOffset, WGPUBuffer destination, uint64_t destinationOffset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderCopyBufferToTexture)(WGPUCommandEncoder commandEncoder, WGPUImageCopyBuffer const * source, WGPUImageCopyTexture const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderCopyTextureToBuffer)(WGPUCommandEncoder commandEncoder, WGPUImageCopyTexture const * source, WGPUImageCopyBuffer const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderCopyTextureToTexture)(WGPUCommandEncoder commandEncoder, WGPUImageCopyTexture const * source, WGPUImageCopyTexture const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUCommandBuffer (*WGPUProcCommandEncoderFinish)(WGPUCommandEncoder commandEncoder, WGPU_NULLABLE WGPUCommandBufferDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderInsertDebugMarker)(WGPUCommandEncoder commandEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderPopDebugGroup)(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderPushDebugGroup)(WGPUCommandEncoder commandEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderResolveQuerySet)(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t firstQuery, uint32_t queryCount, WGPUBuffer destination, uint64_t destinationOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderSetLabel)(WGPUCommandEncoder commandEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderWriteTimestamp)(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t queryIndex) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderReference)(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcCommandEncoderRelease)(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Procs of ComputePassEncoder
typedef void (*WGPUProcComputePassEncoderDispatchWorkgroups)(WGPUComputePassEncoder computePassEncoder, uint32_t workgroupCountX, uint32_t workgroupCountY, uint32_t workgroupCountZ) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderDispatchWorkgroupsIndirect)(WGPUComputePassEncoder computePassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderEnd)(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderInsertDebugMarker)(WGPUComputePassEncoder computePassEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderPopDebugGroup)(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderPushDebugGroup)(WGPUComputePassEncoder computePassEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderSetBindGroup)(WGPUComputePassEncoder computePassEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, size_t dynamicOffsetCount, uint32_t const * dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderSetLabel)(WGPUComputePassEncoder computePassEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderSetPipeline)(WGPUComputePassEncoder computePassEncoder, WGPUComputePipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderReference)(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePassEncoderRelease)(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Procs of ComputePipeline
typedef WGPUBindGroupLayout (*WGPUProcComputePipelineGetBindGroupLayout)(WGPUComputePipeline computePipeline, uint32_t groupIndex) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePipelineSetLabel)(WGPUComputePipeline computePipeline, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePipelineReference)(WGPUComputePipeline computePipeline) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcComputePipelineRelease)(WGPUComputePipeline computePipeline) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Device
typedef WGPUBindGroup (*WGPUProcDeviceCreateBindGroup)(WGPUDevice device, WGPUBindGroupDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBindGroupLayout (*WGPUProcDeviceCreateBindGroupLayout)(WGPUDevice device, WGPUBindGroupLayoutDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBuffer (*WGPUProcDeviceCreateBuffer)(WGPUDevice device, WGPUBufferDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUCommandEncoder (*WGPUProcDeviceCreateCommandEncoder)(WGPUDevice device, WGPU_NULLABLE WGPUCommandEncoderDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUComputePipeline (*WGPUProcDeviceCreateComputePipeline)(WGPUDevice device, WGPUComputePipelineDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceCreateComputePipelineAsync)(WGPUDevice device, WGPUComputePipelineDescriptor const * descriptor, WGPUCreateComputePipelineAsyncCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUPipelineLayout (*WGPUProcDeviceCreatePipelineLayout)(WGPUDevice device, WGPUPipelineLayoutDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUQuerySet (*WGPUProcDeviceCreateQuerySet)(WGPUDevice device, WGPUQuerySetDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPURenderBundleEncoder (*WGPUProcDeviceCreateRenderBundleEncoder)(WGPUDevice device, WGPURenderBundleEncoderDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPURenderPipeline (*WGPUProcDeviceCreateRenderPipeline)(WGPUDevice device, WGPURenderPipelineDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceCreateRenderPipelineAsync)(WGPUDevice device, WGPURenderPipelineDescriptor const * descriptor, WGPUCreateRenderPipelineAsyncCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUSampler (*WGPUProcDeviceCreateSampler)(WGPUDevice device, WGPU_NULLABLE WGPUSamplerDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUShaderModule (*WGPUProcDeviceCreateShaderModule)(WGPUDevice device, WGPUShaderModuleDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUTexture (*WGPUProcDeviceCreateTexture)(WGPUDevice device, WGPUTextureDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceDestroy)(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
typedef size_t (*WGPUProcDeviceEnumerateFeatures)(WGPUDevice device, WGPUFeatureName * features) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBool (*WGPUProcDeviceGetLimits)(WGPUDevice device, WGPUSupportedLimits * limits) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUQueue (*WGPUProcDeviceGetQueue)(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUBool (*WGPUProcDeviceHasFeature)(WGPUDevice device, WGPUFeatureName feature) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDevicePopErrorScope)(WGPUDevice device, WGPUErrorCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDevicePushErrorScope)(WGPUDevice device, WGPUErrorFilter filter) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceSetLabel)(WGPUDevice device, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceSetUncapturedErrorCallback)(WGPUDevice device, WGPUErrorCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceReference)(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcDeviceRelease)(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Instance
typedef WGPUSurface (*WGPUProcInstanceCreateSurface)(WGPUInstance instance, WGPUSurfaceDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcInstanceProcessEvents)(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcInstanceRequestAdapter)(WGPUInstance instance, WGPU_NULLABLE WGPURequestAdapterOptions const * options, WGPURequestAdapterCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcInstanceReference)(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcInstanceRelease)(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;

// Procs of PipelineLayout
typedef void (*WGPUProcPipelineLayoutSetLabel)(WGPUPipelineLayout pipelineLayout, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcPipelineLayoutReference)(WGPUPipelineLayout pipelineLayout) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcPipelineLayoutRelease)(WGPUPipelineLayout pipelineLayout) WGPU_FUNCTION_ATTRIBUTE;

// Procs of QuerySet
typedef void (*WGPUProcQuerySetDestroy)(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcQuerySetGetCount)(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUQueryType (*WGPUProcQuerySetGetType)(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQuerySetSetLabel)(WGPUQuerySet querySet, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQuerySetReference)(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQuerySetRelease)(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Queue
typedef void (*WGPUProcQueueOnSubmittedWorkDone)(WGPUQueue queue, WGPUQueueWorkDoneCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueSetLabel)(WGPUQueue queue, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueSubmit)(WGPUQueue queue, size_t commandCount, WGPUCommandBuffer const * commands) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueWriteBuffer)(WGPUQueue queue, WGPUBuffer buffer, uint64_t bufferOffset, void * data, size_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueWriteTexture)(WGPUQueue queue, WGPUImageCopyTexture const * destination, void * data, size_t dataSize, WGPUTextureDataLayout const * dataLayout, WGPUExtent3D const * writeSize) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueReference)(WGPUQueue queue) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcQueueRelease)(WGPUQueue queue) WGPU_FUNCTION_ATTRIBUTE;

// Procs of RenderBundle
typedef void (*WGPUProcRenderBundleSetLabel)(WGPURenderBundle renderBundle, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleReference)(WGPURenderBundle renderBundle) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleRelease)(WGPURenderBundle renderBundle) WGPU_FUNCTION_ATTRIBUTE;

// Procs of RenderBundleEncoder
typedef void (*WGPUProcRenderBundleEncoderDraw)(WGPURenderBundleEncoder renderBundleEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderDrawIndexed)(WGPURenderBundleEncoder renderBundleEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderDrawIndexedIndirect)(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderDrawIndirect)(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPURenderBundle (*WGPUProcRenderBundleEncoderFinish)(WGPURenderBundleEncoder renderBundleEncoder, WGPU_NULLABLE WGPURenderBundleDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderInsertDebugMarker)(WGPURenderBundleEncoder renderBundleEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderPopDebugGroup)(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderPushDebugGroup)(WGPURenderBundleEncoder renderBundleEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderSetBindGroup)(WGPURenderBundleEncoder renderBundleEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, size_t dynamicOffsetCount, uint32_t const * dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderSetIndexBuffer)(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderSetLabel)(WGPURenderBundleEncoder renderBundleEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderSetPipeline)(WGPURenderBundleEncoder renderBundleEncoder, WGPURenderPipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderSetVertexBuffer)(WGPURenderBundleEncoder renderBundleEncoder, uint32_t slot, WGPU_NULLABLE WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderReference)(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderBundleEncoderRelease)(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Procs of RenderPassEncoder
typedef void (*WGPUProcRenderPassEncoderBeginOcclusionQuery)(WGPURenderPassEncoder renderPassEncoder, uint32_t queryIndex) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderDraw)(WGPURenderPassEncoder renderPassEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderDrawIndexed)(WGPURenderPassEncoder renderPassEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderDrawIndexedIndirect)(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderDrawIndirect)(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderEnd)(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderEndOcclusionQuery)(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderExecuteBundles)(WGPURenderPassEncoder renderPassEncoder, size_t bundleCount, WGPURenderBundle const * bundles) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderInsertDebugMarker)(WGPURenderPassEncoder renderPassEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderPopDebugGroup)(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderPushDebugGroup)(WGPURenderPassEncoder renderPassEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetBindGroup)(WGPURenderPassEncoder renderPassEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, size_t dynamicOffsetCount, uint32_t const * dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetBlendConstant)(WGPURenderPassEncoder renderPassEncoder, WGPUColor const * color) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetIndexBuffer)(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetLabel)(WGPURenderPassEncoder renderPassEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetPipeline)(WGPURenderPassEncoder renderPassEncoder, WGPURenderPipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetScissorRect)(WGPURenderPassEncoder renderPassEncoder, uint32_t x, uint32_t y, uint32_t width, uint32_t height) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetStencilReference)(WGPURenderPassEncoder renderPassEncoder, uint32_t reference) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetVertexBuffer)(WGPURenderPassEncoder renderPassEncoder, uint32_t slot, WGPU_NULLABLE WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderSetViewport)(WGPURenderPassEncoder renderPassEncoder, float x, float y, float width, float height, float minDepth, float maxDepth) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderReference)(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPassEncoderRelease)(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Procs of RenderPipeline
typedef WGPUBindGroupLayout (*WGPUProcRenderPipelineGetBindGroupLayout)(WGPURenderPipeline renderPipeline, uint32_t groupIndex) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPipelineSetLabel)(WGPURenderPipeline renderPipeline, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPipelineReference)(WGPURenderPipeline renderPipeline) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcRenderPipelineRelease)(WGPURenderPipeline renderPipeline) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Sampler
typedef void (*WGPUProcSamplerSetLabel)(WGPUSampler sampler, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSamplerReference)(WGPUSampler sampler) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSamplerRelease)(WGPUSampler sampler) WGPU_FUNCTION_ATTRIBUTE;

// Procs of ShaderModule
typedef void (*WGPUProcShaderModuleGetCompilationInfo)(WGPUShaderModule shaderModule, WGPUCompilationInfoCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcShaderModuleSetLabel)(WGPUShaderModule shaderModule, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcShaderModuleReference)(WGPUShaderModule shaderModule) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcShaderModuleRelease)(WGPUShaderModule shaderModule) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Surface
typedef WGPUTextureFormat (*WGPUProcSurfaceGetPreferredFormat)(WGPUSurface surface, WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSurfaceReference)(WGPUSurface surface) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSurfaceRelease)(WGPUSurface surface) WGPU_FUNCTION_ATTRIBUTE;

// Procs of SwapChain
typedef WGPUTextureView (*WGPUProcSwapChainGetCurrentTextureView)(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSwapChainPresent)(WGPUSwapChain swapChain, uint32_t frameIndex) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSwapChainReference)(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcSwapChainRelease)(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;

// Procs of Texture
typedef WGPUTextureView (*WGPUProcTextureCreateView)(WGPUTexture texture, WGPU_NULLABLE WGPUTextureViewDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureDestroy)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcTextureGetDepthOrArrayLayers)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUTextureDimension (*WGPUProcTextureGetDimension)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUTextureFormat (*WGPUProcTextureGetFormat)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcTextureGetHeight)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcTextureGetMipLevelCount)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcTextureGetSampleCount)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef WGPUTextureUsageFlags (*WGPUProcTextureGetUsage)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef uint32_t (*WGPUProcTextureGetWidth)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureSetLabel)(WGPUTexture texture, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureReference)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureRelease)(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;

// Procs of TextureView
typedef void (*WGPUProcTextureViewSetLabel)(WGPUTextureView textureView, char const * label) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureViewReference)(WGPUTextureView textureView) WGPU_FUNCTION_ATTRIBUTE;
typedef void (*WGPUProcTextureViewRelease)(WGPUTextureView textureView) WGPU_FUNCTION_ATTRIBUTE;

#endif  // !defined(WGPU_SKIP_PROCS)

#if !defined(WGPU_SKIP_DECLARATIONS)

WGPU_EXPORT WGPUInstance wgpuCreateInstance(WGPU_NULLABLE WGPUInstanceDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUProc wgpuGetProcAddress(WGPUDevice device, char const * procName) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Adapter
WGPU_EXPORT size_t wgpuAdapterEnumerateFeatures(WGPUAdapter adapter, WGPUFeatureName * features) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuAdapterGetLimits(WGPUAdapter adapter, WGPUSupportedLimits * limits) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuAdapterGetProperties(WGPUAdapter adapter, WGPUAdapterProperties * properties) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuAdapterHasFeature(WGPUAdapter adapter, WGPUFeatureName feature) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuAdapterRequestDevice(WGPUAdapter adapter, WGPU_NULLABLE WGPUDeviceDescriptor const * descriptor, WGPURequestDeviceCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuAdapterReference(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuAdapterRelease(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;

// Methods of BindGroup
WGPU_EXPORT void wgpuBindGroupSetLabel(WGPUBindGroup bindGroup, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBindGroupReference(WGPUBindGroup bindGroup) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBindGroupRelease(WGPUBindGroup bindGroup) WGPU_FUNCTION_ATTRIBUTE;

// Methods of BindGroupLayout
WGPU_EXPORT void wgpuBindGroupLayoutSetLabel(WGPUBindGroupLayout bindGroupLayout, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBindGroupLayoutReference(WGPUBindGroupLayout bindGroupLayout) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBindGroupLayoutRelease(WGPUBindGroupLayout bindGroupLayout) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Buffer
WGPU_EXPORT void wgpuBufferDestroy(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBufferMapState wgpuBufferGetMapState(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint64_t wgpuBufferGetInitialSize(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint64_t wgpuBufferGetCurrentSize(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBufferUsageFlags wgpuBufferGetUsage(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferMapAsync(WGPUBuffer buffer, WGPUMapModeFlags mode, size_t offset, size_t size, WGPUBufferMapCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferSetLabel(WGPUBuffer buffer, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferUnmap(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferGenerateAValidationError(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferReference(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferRelease(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuBufferCopy(WGPUBuffer buffer, std::span<const uint8_t> data, size_t offset) WGPU_FUNCTION_ATTRIBUTE;

// Methods of CommandBuffer
WGPU_EXPORT void wgpuCommandBufferSetLabel(WGPUCommandBuffer commandBuffer, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandBufferReference(WGPUCommandBuffer commandBuffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandBufferRelease(WGPUCommandBuffer commandBuffer) WGPU_FUNCTION_ATTRIBUTE;

// Methods of CommandEncoder
WGPU_EXPORT WGPUComputePassEncoder wgpuCommandEncoderBeginComputePass(WGPUCommandEncoder commandEncoder, WGPU_NULLABLE WGPUComputePassDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPURenderPassEncoder wgpuCommandEncoderBeginRenderPass(WGPUCommandEncoder commandEncoder, WGPURenderPassDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderClearBuffer(WGPUCommandEncoder commandEncoder, WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderCopyBufferToBuffer(WGPUCommandEncoder commandEncoder, WGPUBuffer source, uint64_t sourceOffset, WGPUBuffer destination, uint64_t destinationOffset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderCopyBufferToTexture(WGPUCommandEncoder commandEncoder, WGPUImageCopyBuffer const * source, WGPUImageCopyTexture const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderCopyTextureToBuffer(WGPUCommandEncoder commandEncoder, WGPUImageCopyTexture const * source, WGPUImageCopyBuffer const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderCopyTextureToTexture(WGPUCommandEncoder commandEncoder, WGPUImageCopyTexture const * source, WGPUImageCopyTexture const * destination, WGPUExtent3D const * copySize) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUCommandBuffer wgpuCommandEncoderFinish(WGPUCommandEncoder commandEncoder, WGPU_NULLABLE WGPUCommandBufferDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderInsertDebugMarker(WGPUCommandEncoder commandEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderPopDebugGroup(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderPushDebugGroup(WGPUCommandEncoder commandEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderResolveQuerySet(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t firstQuery, uint32_t queryCount, WGPUBuffer destination, uint64_t destinationOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderSetLabel(WGPUCommandEncoder commandEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderWriteTimestamp(WGPUCommandEncoder commandEncoder, WGPUQuerySet querySet, uint32_t queryIndex) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderReference(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuCommandEncoderRelease(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Methods of ComputePassEncoder
WGPU_EXPORT void wgpuComputePassEncoderDispatchWorkgroups(WGPUComputePassEncoder computePassEncoder, uint32_t workgroupCountX, uint32_t workgroupCountY, uint32_t workgroupCountZ) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderDispatchWorkgroupsIndirect(WGPUComputePassEncoder computePassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderEnd(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderInsertDebugMarker(WGPUComputePassEncoder computePassEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderPopDebugGroup(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderPushDebugGroup(WGPUComputePassEncoder computePassEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderSetBindGroup(WGPUComputePassEncoder computePassEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderSetLabel(WGPUComputePassEncoder computePassEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderSetPipeline(WGPUComputePassEncoder computePassEncoder, WGPUComputePipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderReference(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePassEncoderRelease(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Methods of ComputePipeline
WGPU_EXPORT WGPUBindGroupLayout wgpuComputePipelineGetBindGroupLayout(WGPUComputePipeline computePipeline, uint32_t groupIndex) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePipelineSetLabel(WGPUComputePipeline computePipeline, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePipelineReference(WGPUComputePipeline computePipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuComputePipelineRelease(WGPUComputePipeline computePipeline) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Device
WGPU_EXPORT WGPUBindGroup wgpuDeviceCreateBindGroup(WGPUDevice device, WGPUBindGroupDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBindGroupLayout wgpuDeviceCreateBindGroupLayout(WGPUDevice device, WGPUBindGroupLayoutDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBuffer wgpuDeviceCreateBuffer(WGPUDevice device, WGPUBufferDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUCommandEncoder wgpuDeviceCreateCommandEncoder(WGPUDevice device, WGPU_NULLABLE WGPUCommandEncoderDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUComputePipeline wgpuDeviceCreateComputePipeline(WGPUDevice device, WGPUComputePipelineDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceCreateComputePipelineAsync(WGPUDevice device, WGPUComputePipelineDescriptor const * descriptor, WGPUCreateComputePipelineAsyncCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUPipelineLayout wgpuDeviceCreatePipelineLayout(WGPUDevice device, WGPUPipelineLayoutDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUQuerySet wgpuDeviceCreateQuerySet(WGPUDevice device, WGPUQuerySetDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPURenderBundleEncoder wgpuDeviceCreateRenderBundleEncoder(WGPUDevice device, WGPURenderBundleEncoderDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPURenderPipeline wgpuDeviceCreateRenderPipeline(WGPUDevice device, WGPURenderPipelineDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceCreateRenderPipelineAsync(WGPUDevice device, WGPURenderPipelineDescriptor const * descriptor, WGPUCreateRenderPipelineAsyncCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUSampler wgpuDeviceCreateSampler(WGPUDevice device, WGPU_NULLABLE WGPUSamplerDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUShaderModule wgpuDeviceCreateShaderModule(WGPUDevice device, WGPUShaderModuleDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUSwapChain wgpuDeviceCreateSwapChain(WGPUDevice device, WGPUSurface surface, WGPUSwapChainDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUTexture wgpuDeviceCreateTexture(WGPUDevice device, WGPUTextureDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceDestroy(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT size_t wgpuDeviceEnumerateFeatures(WGPUDevice device, WGPUFeatureName * features) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuDeviceGetLimits(WGPUDevice device, WGPUSupportedLimits * limits) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUQueue wgpuDeviceGetQueue(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuDeviceHasFeature(WGPUDevice device, WGPUFeatureName feature) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDevicePopErrorScope(WGPUDevice device, WGPUErrorCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDevicePushErrorScope(WGPUDevice device, WGPUErrorFilter filter) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceSetLabel(WGPUDevice device, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceSetUncapturedErrorCallback(WGPUDevice device, WGPUErrorCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceReference(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuDeviceRelease(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Instance
WGPU_EXPORT WGPUSurface wgpuInstanceCreateSurface(WGPUInstance instance, WGPUSurfaceDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuInstanceProcessEvents(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuInstanceRequestAdapter(WGPUInstance instance, WGPU_NULLABLE WGPURequestAdapterOptions const * options, WGPURequestAdapterCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuInstanceReference(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuInstanceRelease(WGPUInstance instance) WGPU_FUNCTION_ATTRIBUTE;

// Methods of PipelineLayout
WGPU_EXPORT void wgpuPipelineLayoutSetLabel(WGPUPipelineLayout pipelineLayout, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuPipelineLayoutReference(WGPUPipelineLayout pipelineLayout) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuPipelineLayoutRelease(WGPUPipelineLayout pipelineLayout) WGPU_FUNCTION_ATTRIBUTE;

// Methods of QuerySet
WGPU_EXPORT void wgpuQuerySetDestroy(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuQuerySetGetCount(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUQueryType wgpuQuerySetGetType(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQuerySetSetLabel(WGPUQuerySet querySet, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQuerySetReference(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQuerySetRelease(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Queue
WGPU_EXPORT void wgpuQueueOnSubmittedWorkDone(WGPUQueue queue, WGPUQueueWorkDoneCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueSetLabel(WGPUQueue queue, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueSubmit(WGPUQueue queue, size_t commandCount, WGPUCommandBuffer const * commands) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueWriteBuffer(WGPUQueue queue, WGPUBuffer buffer, uint64_t bufferOffset, std::span<uint8_t> data) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueWriteTexture(WGPUQueue queue, WGPUImageCopyTexture const * destination, std::span<uint8_t> data, WGPUTextureDataLayout const * dataLayout, WGPUExtent3D const * writeSize) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueReference(WGPUQueue queue) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuQueueRelease(WGPUQueue queue) WGPU_FUNCTION_ATTRIBUTE;

// Methods of RenderBundle
WGPU_EXPORT void wgpuRenderBundleSetLabel(WGPURenderBundle renderBundle, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleReference(WGPURenderBundle renderBundle) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleRelease(WGPURenderBundle renderBundle) WGPU_FUNCTION_ATTRIBUTE;

// Methods of RenderBundleEncoder
WGPU_EXPORT void wgpuRenderBundleEncoderDraw(WGPURenderBundleEncoder renderBundleEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderDrawIndexed(WGPURenderBundleEncoder renderBundleEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderDrawIndexedIndirect(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderDrawIndirect(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPURenderBundle wgpuRenderBundleEncoderFinish(WGPURenderBundleEncoder renderBundleEncoder, WGPU_NULLABLE WGPURenderBundleDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderInsertDebugMarker(WGPURenderBundleEncoder renderBundleEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderPopDebugGroup(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderPushDebugGroup(WGPURenderBundleEncoder renderBundleEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderSetBindGroup(WGPURenderBundleEncoder renderBundleEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, size_t dynamicOffsetCount, uint32_t const * dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderSetIndexBuffer(WGPURenderBundleEncoder renderBundleEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderSetLabel(WGPURenderBundleEncoder renderBundleEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderSetPipeline(WGPURenderBundleEncoder renderBundleEncoder, WGPURenderPipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderSetVertexBuffer(WGPURenderBundleEncoder renderBundleEncoder, uint32_t slot, WGPU_NULLABLE WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderReference(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderBundleEncoderRelease(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Methods of RenderPassEncoder
WGPU_EXPORT void wgpuRenderPassEncoderBeginOcclusionQuery(WGPURenderPassEncoder renderPassEncoder, uint32_t queryIndex) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderDraw(WGPURenderPassEncoder renderPassEncoder, uint32_t vertexCount, uint32_t instanceCount, uint32_t firstVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderDrawIndexed(WGPURenderPassEncoder renderPassEncoder, uint32_t indexCount, uint32_t instanceCount, uint32_t firstIndex, int32_t baseVertex, uint32_t firstInstance) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderDrawIndexedIndirect(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderDrawIndirect(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer indirectBuffer, uint64_t indirectOffset) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderEnd(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderEndOcclusionQuery(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderExecuteBundles(WGPURenderPassEncoder renderPassEncoder, size_t bundleCount, WGPURenderBundle const * bundles) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderInsertDebugMarker(WGPURenderPassEncoder renderPassEncoder, char const * markerLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderPopDebugGroup(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderPushDebugGroup(WGPURenderPassEncoder renderPassEncoder, char const * groupLabel) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetBindGroup(WGPURenderPassEncoder renderPassEncoder, uint32_t groupIndex, WGPU_NULLABLE WGPUBindGroup group, std::optional<Vector<uint32_t>>&& dynamicOffsets) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetBlendConstant(WGPURenderPassEncoder renderPassEncoder, WGPUColor const * color) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetIndexBuffer(WGPURenderPassEncoder renderPassEncoder, WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetLabel(WGPURenderPassEncoder renderPassEncoder, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetPipeline(WGPURenderPassEncoder renderPassEncoder, WGPURenderPipeline pipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetScissorRect(WGPURenderPassEncoder renderPassEncoder, uint32_t x, uint32_t y, uint32_t width, uint32_t height) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetStencilReference(WGPURenderPassEncoder renderPassEncoder, uint32_t reference) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetVertexBuffer(WGPURenderPassEncoder renderPassEncoder, uint32_t slot, WGPU_NULLABLE WGPUBuffer buffer, uint64_t offset, uint64_t size) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderSetViewport(WGPURenderPassEncoder renderPassEncoder, float x, float y, float width, float height, float minDepth, float maxDepth) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderReference(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPassEncoderRelease(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;

// Methods of RenderPipeline
WGPU_EXPORT WGPUBindGroupLayout wgpuRenderPipelineGetBindGroupLayout(WGPURenderPipeline renderPipeline, uint32_t groupIndex) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPipelineSetLabel(WGPURenderPipeline renderPipeline, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPipelineReference(WGPURenderPipeline renderPipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuRenderPipelineRelease(WGPURenderPipeline renderPipeline) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Sampler
WGPU_EXPORT void wgpuSamplerSetLabel(WGPUSampler sampler, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSamplerReference(WGPUSampler sampler) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSamplerRelease(WGPUSampler sampler) WGPU_FUNCTION_ATTRIBUTE;

// Methods of ShaderModule
WGPU_EXPORT void wgpuShaderModuleGetCompilationInfo(WGPUShaderModule shaderModule, WGPUCompilationInfoCallback callback, void * userdata) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuShaderModuleSetLabel(WGPUShaderModule shaderModule, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuShaderModuleReference(WGPUShaderModule shaderModule) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuShaderModuleRelease(WGPUShaderModule shaderModule) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Surface
WGPU_EXPORT WGPUTextureFormat wgpuSurfaceGetPreferredFormat(WGPUSurface surface, WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSurfaceReference(WGPUSurface surface) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSurfaceRelease(WGPUSurface surface) WGPU_FUNCTION_ATTRIBUTE;

// Methods of SwapChain
WGPU_EXPORT WGPUTextureView wgpuSwapChainGetCurrentTextureView(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSwapChainPresent(WGPUSwapChain swapChain, uint32_t frameIndex) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSwapChainReference(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuSwapChainRelease(WGPUSwapChain swapChain) WGPU_FUNCTION_ATTRIBUTE;

// Methods of Texture
WGPU_EXPORT WGPUTextureView wgpuTextureCreateView(WGPUTexture texture, WGPU_NULLABLE WGPUTextureViewDescriptor const * descriptor) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureDestroy(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureUndestroy(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuTextureGetDepthOrArrayLayers(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUTextureDimension wgpuTextureGetDimension(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUTextureFormat wgpuTextureGetFormat(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuTextureGetHeight(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuTextureGetMipLevelCount(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuTextureGetSampleCount(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUTextureUsageFlags wgpuTextureGetUsage(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT uint32_t wgpuTextureGetWidth(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureSetLabel(WGPUTexture texture, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureReference(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureRelease(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;

// Methods of TextureView
WGPU_EXPORT void wgpuTextureViewSetLabel(WGPUTextureView textureView, char const * label) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureViewReference(WGPUTextureView textureView) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuTextureViewRelease(WGPUTextureView textureView) WGPU_FUNCTION_ATTRIBUTE;

// isValid checks
WGPU_EXPORT WGPUBool wgpuBufferIsValid(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuAdapterIsValid(WGPUAdapter adapter) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuBindGroupIsValid(WGPUBindGroup bindGroup) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuBindGroupLayoutIsValid(WGPUBindGroupLayout bindGroupLayout) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuCommandBufferIsValid(WGPUCommandBuffer commandBuffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuCommandEncoderIsValid(WGPUCommandEncoder commandEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuComputePassEncoderIsValid(WGPUComputePassEncoder computePassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuComputePipelineIsValid(WGPUComputePipeline computePipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuDeviceIsValid(WGPUDevice device) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuPipelineLayoutIsValid(WGPUPipelineLayout pipelineLayout) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuPresentationContextIsValid(WGPUSurface presentationContext) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuQuerySetIsValid(WGPUQuerySet querySet) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuQueueIsValid(WGPUQueue queue) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuRenderBundleEncoderIsValid(WGPURenderBundleEncoder renderBundleEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuRenderBundleIsValid(WGPURenderBundle renderBundle) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuRenderPassEncoderIsValid(WGPURenderPassEncoder renderPassEncoder) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuRenderPipelineIsValid(WGPURenderPipeline renderPipeline) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuSamplerIsValid(WGPUSampler sampler) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuShaderModuleIsValid(WGPUShaderModule shaderModule) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuTextureIsValid(WGPUTexture texture) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuTextureViewIsValid(WGPUTextureView textureView) WGPU_FUNCTION_ATTRIBUTE;

// XRBinding functions
WGPU_EXPORT void wgpuXRBindingReference(WGPUXRBinding binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuXRBindingRelease(WGPUXRBinding binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuXRBindingIsValid(WGPUXRBinding binding) WGPU_FUNCTION_ATTRIBUTE;

// XRSubImage functions
WGPU_EXPORT void wgpuXRSubImageReference(WGPUXRSubImage binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuXRSubImageRelease(WGPUXRSubImage binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuXRSubImageIsValid(WGPUXRSubImage binding) WGPU_FUNCTION_ATTRIBUTE;

// XRProjectionLayer functions
WGPU_EXPORT void wgpuXRProjectionLayerReference(WGPUXRProjectionLayer binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuXRProjectionLayerRelease(WGPUXRProjectionLayer binding) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuXRProjectionLayerIsValid(WGPUXRProjectionLayer binding) WGPU_FUNCTION_ATTRIBUTE;

// XRView functions
WGPU_EXPORT void wgpuXRViewReference(WGPUXRView view) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT void wgpuXRViewRelease(WGPUXRView view) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT WGPUBool wgpuXRViewIsValid(WGPUXRView view) WGPU_FUNCTION_ATTRIBUTE;

#endif  // !defined(WGPU_SKIP_DECLARATIONS)

WGPU_EXPORT std::span<uint8_t> wgpuBufferGetBufferContents(WGPUBuffer buffer) WGPU_FUNCTION_ATTRIBUTE;
WGPU_EXPORT std::span<uint8_t> wgpuBufferGetMappedRange(WGPUBuffer buffer, size_t offset, size_t size) WGPU_FUNCTION_ATTRIBUTE;

#endif

#pragma clang diagnostic pop

#endif // WEBGPU_H_
