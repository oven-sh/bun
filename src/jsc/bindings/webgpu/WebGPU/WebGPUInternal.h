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

#pragma once

#ifdef __cplusplus
#include <wtf/text/WTFString.h>

extern "C" {

typedef void (^WGPUBufferMapBlockCallback)(WGPUBufferMapAsyncStatus);
typedef void (^WGPUCompilationInfoBlockCallback)(WGPUCompilationInfoRequestStatus, const WGPUCompilationInfo* compilationInfo);
typedef void (^WGPUCreateComputePipelineAsyncBlockCallback)(WGPUCreatePipelineAsyncStatus, WGPUComputePipeline pipeline, WTF::String&& message);
typedef void (^WGPUCreateRenderPipelineAsyncBlockCallback)(WGPUCreatePipelineAsyncStatus, WGPURenderPipeline pipeline, WTF::String&& message);
typedef void (^WGPUErrorBlockCallback)(WGPUErrorType, const char* message);
typedef void (^WGPUQueueWorkDoneBlockCallback)(WGPUQueueWorkDoneStatus);
typedef void (^WGPURequestAdapterBlockCallback)(WGPURequestAdapterStatus, WGPUAdapter adapter, const char* message);
typedef void (^WGPURequestDeviceBlockCallback)(WGPURequestDeviceStatus, WGPUDevice device, const char* message);
typedef void (^WGPURequestInvalidDeviceBlockCallback)(WGPUDevice);

#if !defined(WGPU_SKIP_PROCS)

typedef void (*WGPUProcAdapterRequestDeviceWithBlock)(WGPUAdapter, const WGPUDeviceDescriptor*, WGPURequestDeviceBlockCallback);
typedef void (*WGPUProcBufferMapAsyncWithBlock)(WGPUBuffer, WGPUMapModeFlags mode, size_t offset, size_t size, WGPUBufferMapBlockCallback);
typedef void (*WGPUProcDeviceCreateComputePipelineAsyncWithBlock)(WGPUDevice, const WGPUComputePipelineDescriptor* descriptor, WGPUCreateComputePipelineAsyncBlockCallback);
typedef void (*WGPUProcDeviceCreateRenderPipelineAsyncWithBlock)(WGPUDevice, const WGPURenderPipelineDescriptor* descriptor, WGPUCreateRenderPipelineAsyncBlockCallback);
typedef bool (*WGPUProcDevicePopErrorScopeWithBlock)(WGPUDevice, WGPUErrorBlockCallback);
typedef void (*WGPUProcDeviceSetUncapturedErrorCallbackWithBlock)(WGPUDevice, WGPUErrorBlockCallback);
typedef void (*WGPUProcInstanceRequestAdapterWithBlock)(WGPUInstance, const WGPURequestAdapterOptions*, WGPURequestAdapterBlockCallback);
typedef void (*WGPUProcQueueOnSubmittedWorkDoneWithBlock)(WGPUQueue, WGPUQueueWorkDoneBlockCallback);
typedef void (*WGPUProcShaderModuleGetCompilationInfoWithBlock)(WGPUShaderModule, WGPUCompilationInfoBlockCallback);

#endif // !defined(WGPU_SKIP_PROCS)

#if !defined(WGPU_SKIP_DECLARATIONS)

void wgpuAdapterRequestDeviceWithBlock(WGPUAdapter, const WGPUDeviceDescriptor*, WGPURequestDeviceBlockCallback);
void wgpuBufferMapAsyncWithBlock(WGPUBuffer, WGPUMapModeFlags, size_t offset, size_t, WGPUBufferMapBlockCallback);
void wgpuDeviceCreateComputePipelineAsyncWithBlock(WGPUDevice, const WGPUComputePipelineDescriptor*, WGPUCreateComputePipelineAsyncBlockCallback);
void wgpuDeviceCreateRenderPipelineAsyncWithBlock(WGPUDevice, const WGPURenderPipelineDescriptor*, WGPUCreateRenderPipelineAsyncBlockCallback);
void wgpuDevicePopErrorScopeWithBlock(WGPUDevice, WGPUErrorBlockCallback);
void wgpuDeviceSetUncapturedErrorCallbackWithBlock(WGPUDevice, WGPUErrorBlockCallback);
void wgpuInstanceRequestAdapterWithBlock(WGPUInstance, const WGPURequestAdapterOptions*, WGPURequestAdapterBlockCallback);
void wgpuQueueOnSubmittedWorkDoneWithBlock(WGPUQueue, WGPUQueueWorkDoneBlockCallback);
void wgpuShaderModuleGetCompilationInfoWithBlock(WGPUShaderModule, WGPUCompilationInfoBlockCallback);

#endif // !defined(WGPU_SKIP_DECLARATIONS)

} // extern "C"
#endif
