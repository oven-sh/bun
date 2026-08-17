#pragma once

// How the WebGPU objects reach JavaScript: `navigator.gpu` plus the GPU*
// constructors and constant namespaces that the spec puts on the global
// object (ZigGlobalObject.lut.txt lists them under ENABLE(WEBGPU) and points
// at the callbacks declared here). Bun's counterpart to WebKit's
// NavigatorGPU.idl mixin and its generated global-object attributes.

#include "root.h"

#include <JavaScriptCore/JSCJSValue.h>

namespace JSC {
class JSObject;
class VM;
}

namespace Bun {

// Every interface and namespace the WebGPU IDL exposes on the global object.
#define FOR_EACH_WEBGPU_GLOBAL_CONSTRUCTOR(macro) \
    macro(GPU)                                    \
    macro(GPUAdapter)                             \
    macro(GPUAdapterInfo)                         \
    macro(GPUBindGroup)                           \
    macro(GPUBindGroupLayout)                     \
    macro(GPUBuffer)                              \
    macro(GPUBufferUsage)                         \
    macro(GPUColorWrite)                          \
    macro(GPUCommandBuffer)                       \
    macro(GPUCommandEncoder)                      \
    macro(GPUCompilationInfo)                     \
    macro(GPUCompilationMessage)                  \
    macro(GPUComputePassEncoder)                  \
    macro(GPUComputePipeline)                     \
    macro(GPUDevice)                              \
    macro(GPUDeviceLostInfo)                      \
    macro(GPUInternalError)                       \
    macro(GPUMapMode)                             \
    macro(GPUOutOfMemoryError)                    \
    macro(GPUPipelineError)                       \
    macro(GPUPipelineLayout)                      \
    macro(GPUQuerySet)                            \
    macro(GPUQueue)                               \
    macro(GPURenderBundle)                        \
    macro(GPURenderBundleEncoder)                 \
    macro(GPURenderPassEncoder)                   \
    macro(GPURenderPipeline)                      \
    macro(GPUSampler)                             \
    macro(GPUShaderModule)                        \
    macro(GPUShaderStage)                         \
    macro(GPUSupportedFeatures)                   \
    macro(GPUSupportedLimits)                     \
    macro(GPUTexture)                             \
    macro(GPUTextureUsage)                        \
    macro(GPUTextureView)                         \
    macro(GPUUncapturedErrorEvent)                \
    macro(GPUValidationError)                     \
    macro(WGSLLanguageFeatures)

// The PropertyCallback behind each global-object table entry: builds the
// constructor (or namespace object) the first time the global is touched.
#define DECLARE_WEBGPU_CONSTRUCTOR_CALLBACK(name) JSC::JSValue name##ConstructorCallback(JSC::VM&, JSC::JSObject* globalObject);
FOR_EACH_WEBGPU_GLOBAL_CONSTRUCTOR(DECLARE_WEBGPU_CONSTRUCTOR_CALLBACK)
#undef DECLARE_WEBGPU_CONSTRUCTOR_CALLBACK

// Getter for `navigator.gpu`. Creates the GPU object for the navigator's
// global on first use and keeps it on the navigator object, so the same
// object comes back every time ([SameObject]) and the underlying instance
// lives as long as the global does.
JSC_DECLARE_HOST_FUNCTION(jsNavigatorGetGPU);

} // namespace Bun
