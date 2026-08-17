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
#import "Device.h"

#import "API.h"
#import "APIConversions.h"
#import "BindGroup.h"
#import "BindGroupLayout.h"
#import "Buffer.h"
#import "CommandEncoder.h"
#import "ComputePipeline.h"
#import "PipelineLayout.h"
#import "QuerySet.h"
#import "Queue.h"
#import "RenderBundleEncoder.h"
#import "RenderPipeline.h"
#import "Sampler.h"
#import "ShaderModule.h"
#import "Texture.h"
#import <algorithm>
#import <notify.h>
#import <ranges>
#import <wtf/StdLibExtras.h>
#import <wtf/TZoneMallocInlines.h>
#import <wtf/WeakPtr.h>
#import <wtf/darwin/DispatchExtras.h>

#define OBJC_STRINGIFYHELPER(x) @#x
#define OBJC_STRINGIFY(x) OBJC_STRINGIFYHELPER(x)

namespace WebGPU {

struct GPUFrameCapture {
    static void captureSingleFrameIfNeeded(id<MTLDevice> captureObject)
    {
        if (enabled) {
            captureFrame(captureObject);
            enabled = false;
        }
    }

    static void registerForFrameCapture(id<MTLDevice> captureObject)
    {
        // Allow GPU frame capture "notifyutil -p com.apple.WebKit.WebGPU.CaptureFrame" when process is
        // run with __XPC_METAL_CAPTURE_ENABLED=1
        // notifyutil -s com.apple.WebKit.WebGPU.CaptureFrame 10 --> captures 10 GPUQueue.submit calls
        static std::once_flag onceFlag;
        std::call_once(onceFlag, [] {
            int captureFrameToken;
            notify_register_dispatch("com.apple.WebKit.WebGPU.CaptureFrame", &captureFrameToken, mainDispatchQueueSingleton(), ^(int token) {
                uint64_t state;
                notify_get_state(token, &state);
                maxSubmitCallsToCapture = std::max<int>(1, state);
                enabled = true;
            });

            int captureFirstFrameToken;
            notify_register_dispatch("com.apple.WebKit.WebGPU.ToggleCaptureFirstFrame", &captureFirstFrameToken, mainDispatchQueueSingleton(), ^(int) {
                captureFirstFrame = !captureFirstFrame;
            });
        });

        if (captureFirstFrame)
            captureFrame(captureObject);
    }

    static bool NODELETE shouldStopCaptureAfterSubmit()
    {
        ++submitCallsCaptured;
        auto result = submitCallsCaptured >= maxSubmitCallsToCapture;
        if (result)
            submitCallsCaptured = 0;

        return result;
    }

private:
    static void captureFrame(id<MTLDevice> captureObject)
    {
        MTLCaptureManager* captureManager = [MTLCaptureManager sharedCaptureManager];
        if ([captureManager isCapturing])
            return;

        MTLCaptureDescriptor* captureDescriptor = [[MTLCaptureDescriptor alloc] init];
        captureDescriptor.captureObject = captureObject;
        captureDescriptor.destination = MTLCaptureDestinationGPUTraceDocument;
        captureDescriptor.outputURL = [[NSFileManager.defaultManager temporaryDirectory] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.gputrace", NSUUID.UUID.UUIDString]];

        NSError *error;
        if (![captureManager startCaptureWithDescriptor:captureDescriptor error:&error])
            WTFLogAlways("Failed to start GPU frame capture at path %@, error %@", captureDescriptor.outputURL.absoluteString, error);
        else
            WTFLogAlways("Success starting GPU frame capture at path %@ - frame count = %d", captureDescriptor.outputURL.absoluteString, maxSubmitCallsToCapture);
    }

    static bool captureFirstFrame;
    static bool enabled;
    static int submitCallsCaptured;
    static int maxSubmitCallsToCapture;
};

bool GPUFrameCapture::captureFirstFrame = false;
bool GPUFrameCapture::enabled = false;
int GPUFrameCapture::submitCallsCaptured = 0;
int GPUFrameCapture::maxSubmitCallsToCapture = 1;

WTF_MAKE_TZONE_ALLOCATED_IMPL(Device);

GPUShaderValidation Device::shaderValidationState() const
{
#if ENABLE(WEBGPU_BY_DEFAULT)
    static MTLShaderValidation shaderValidationState = MTLShaderValidationDefault;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        int captureFirstFrameToken;
        notify_register_dispatch("com.apple.WebKit.WebGPU.ToggleShaderValidationState", &captureFirstFrameToken, mainDispatchQueueSingleton(), ^(int) {
            shaderValidationState = (shaderValidationState == MTLShaderValidationEnabled ? MTLShaderValidationDefault : MTLShaderValidationEnabled);
        });
    });

    return shaderValidationState;
#else
    return 0;
#endif
}

bool Device::enableEncoderTimestamps() const
{
    static bool enable = false;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [] {
        int token;
        notify_register_dispatch("com.apple.WebKit.WebGPU.EnableEncoderTimestamps", &token, mainDispatchQueueSingleton(), ^(int) {
            enable = !enable;
            WTFLogAlways("Encoder timestamps are %s", enable ? "ENABLED" : "DISABLED");
        });
    });

    return enable;
}

id<MTLCounterSampleBuffer> Device::timestampsBuffer(id<MTLCommandBuffer> commandBuffer, size_t timestampCount)
{
#if !0 /* PLATFORM(WATCHOS) */
    MTLCounterSampleBufferDescriptor* sampleBufferDesc = [MTLCounterSampleBufferDescriptor new];
    sampleBufferDesc.sampleCount = timestampCount;
    sampleBufferDesc.storageMode = MTLStorageModeShared;
    sampleBufferDesc.counterSet = m_capabilities.baseCapabilities.timestampCounterSet;

    NSError* error = nil;
    id<MTLCounterSampleBuffer> buffer = [m_device newCounterSampleBufferWithDescriptor:sampleBufferDesc error:&error];
    if (error) {
        WTFLogAlways("newCounterSamplerBufferWithDescriptor failed %@", error.localizedDescription);
        return nil;
    }

    trackTimestampsBuffer(commandBuffer, buffer);

    return buffer;
#else
    UNUSED_PARAM(commandBuffer);
    UNUSED_PARAM(timestampCount);
    return nil;
#endif
}

void Device::resolveTimestampsForBuffer(id<MTLCommandBuffer> commandBuffer)
{
    if (!enableEncoderTimestamps())
        return;

    NSMutableArray<id<MTLCounterSampleBuffer>>* sampleBufferArray = [m_sampleCounterBuffers objectForKey:commandBuffer];
    if (!sampleBufferArray)
        return;

    [m_sampleCounterBuffers removeObjectForKey:commandBuffer];
    for (id<MTLCounterSampleBuffer> sampleBuffer in sampleBufferArray) {
        id<MTLBlitCommandEncoder> blitCommandEncoder = [commandBuffer blitCommandEncoder];
        auto timestampCount = sampleBuffer.sampleCount;
        id<MTLBuffer> counterDataBuffer = safeCreateBuffer(sizeof(MTLCounterResultTimestamp) * timestampCount);
        [blitCommandEncoder resolveCounters:sampleBuffer inRange:NSMakeRange(0, timestampCount) destinationBuffer:counterDataBuffer destinationOffset:0];
        [blitCommandEncoder endEncoding];
        NSMutableArray<id<MTLBuffer>>* resolvedBuffers = [m_resolvedSampleCounterBuffers objectForKey:commandBuffer];
        if (!resolvedBuffers) {
            resolvedBuffers = [NSMutableArray arrayWithObject:counterDataBuffer];
            [m_resolvedSampleCounterBuffers setObject:resolvedBuffers forKey:commandBuffer];
        } else
            [resolvedBuffers addObject:counterDataBuffer];

        [commandBuffer addCompletedHandler:^(id<MTLCommandBuffer> completedCommandBuffer) {
            for (id<MTLBuffer> buffer in resolvedBuffers) {
                auto timestamps = unsafeMakeSpan(static_cast<MTLCounterResultTimestamp*>(buffer.contents), buffer.length);
                WTFLogAlways("Timestamps for buffer %@", buffer.label); // NOLINT
                for (size_t i = 0, timestampCount = buffer.length / sizeof(MTLCounterResultTimestamp); (i + 1) < timestampCount; i += 2) {
                    auto timeDifference = timestamps[i + 1].timestamp - timestamps[i].timestamp;
                    WTFLogAlways("\tencoder time %f", timeDifference / 100000.0f); // NOLINT
                }
            }
            [m_resolvedSampleCounterBuffers removeObjectForKey:completedCommandBuffer];
        }];
    }
}

bool Device::shouldStopCaptureAfterSubmit()
{
    return GPUFrameCapture::shouldStopCaptureAfterSubmit();
}

bool Device::isDestroyed() const
{
    return m_destroyed;
}

Ref<Device> Device::create(id<MTLDevice> device, String&& deviceLabel, HardwareCapabilities&& capabilities, Adapter& adapter)
{
    id<MTLCommandQueue> commandQueue = [device newCommandQueueWithMaxCommandBufferCount:4096];
    if (!commandQueue)
        return Device::createInvalid(adapter);

    // See the comment in Device::setLabel() about why we're not setting the label on the MTLDevice here.

    commandQueue.label = @"Default queue";
    if (!deviceLabel.isEmpty())
        commandQueue.label = [NSString stringWithFormat:@"Default queue for device %s", deviceLabel.utf8().data()];

    return adoptRef(*new Device(device, commandQueue, WTF::move(capabilities), adapter));
}

static uint32_t computeMaxCountForDevice(id<MTLDevice> device)
{
#if HAVE(METAL_FAMILY_9)
    if ([device supportsFamily:MTLGPUFamilyApple9])
        return 3 * GB;
#endif
ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    if ([device supportsFamily:MTLGPUFamilyMac2])
        return 3 * GB;
ALLOW_DEPRECATED_DECLARATIONS_END
    return 2 * GB;
}

static uint32_t computeAppleGPUFamily(id<MTLDevice> device)
{
#if HAVE(METAL_FAMILY_9)
    if ([device supportsFamily:MTLGPUFamilyApple9])
        return 9;
#endif
#if HAVE(METAL_FAMILY_8)
    if ([device supportsFamily:MTLGPUFamilyApple8])
        return 8;
#endif
    if ([device supportsFamily:MTLGPUFamilyApple7])
        return 7;
    if ([device supportsFamily:MTLGPUFamilyApple6])
        return 6;
    if ([device supportsFamily:MTLGPUFamilyApple5])
        return 5;
    if ([device supportsFamily:MTLGPUFamilyApple4])
        return 4;
    return 0xFF;
}

Device::Device(id<MTLDevice> device, id<MTLCommandQueue> defaultQueue, HardwareCapabilities&& capabilities, Adapter& adapter)
    : m_device(device)
    , m_defaultQueue(Queue::create(defaultQueue, adapter, *this))
    , m_capabilities(WTF::move(capabilities))
    , m_adapter(adapter)
    , m_instance(adapter.weakInstance())
    , m_appleGPUFamily(computeAppleGPUFamily(device))
    , m_maxVerticesPerDrawCall(computeMaxCountForDevice(device))
{
#if 1 /* PLATFORM(MAC) */
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    auto devices = MTLCopyAllDevicesWithObserver(&m_deviceObserver, [weakThis = ThreadSafeWeakPtr { *this }](id<MTLDevice> device, MTLDeviceNotificationName) {
        RefPtr<Device> protectedThis = weakThis.get();
        if (!protectedThis)
            return;
        if (auto instance = protectedThis->instance(); instance.get()) {
            instance->scheduleWork([protectedThis = WTF::move(protectedThis), device = device]() {
                if (![protectedThis->m_device isEqual:device])
                    return;
                protectedThis->loseTheDevice(WGPUDeviceLostReason_Undefined);
            });
        }
    });
    ALLOW_DEPRECATED_DECLARATIONS_END

#if ASSERT_ENABLED
    bool found = false;
    for (id<MTLDevice> observedDevice in devices) {
        if ([observedDevice isEqual:device]) {
            found = true;
            break;
        }
    }
    ASSERT(found);
#else
    UNUSED_VARIABLE(devices);
#endif
#endif

    GPUFrameCapture::registerForFrameCapture(m_device);

    m_placeholderBuffer = safeCreateBuffer(1, MTLStorageModeShared);
    auto desc = [MTLTextureDescriptor new];
    desc.width = 1;
    desc.height = 1;
    desc.mipmapLevelCount = 1;
    desc.pixelFormat = MTLPixelFormatBGRA8Unorm;
    desc.textureType = MTLTextureType2D;
#if 1 /* PLATFORM(MAC) */
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    desc.storageMode = hasUnifiedMemory() ? MTLStorageModeShared : MTLStorageModeManaged;
    ALLOW_DEPRECATED_DECLARATIONS_END
#else
    desc.storageMode = MTLStorageModeShared;
#endif
    desc.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
    m_placeholderTexture = [m_device newTextureWithDescriptor:desc];
    desc.pixelFormat = MTLPixelFormatDepth32Float_Stencil8;
    desc.storageMode = MTLStorageModePrivate;
    m_placeholderDepthStencilTexture = [m_device newTextureWithDescriptor:desc];
    m_sampleCounterBuffers = [NSMapTable weakToStrongObjectsMapTable];
    m_resolvedSampleCounterBuffers = [NSMapTable weakToStrongObjectsMapTable];

    m_shaderValidationEnabled = WebGPU::isShaderValidationEnabled(m_device);
}

Device::Device(Adapter& adapter)
    : m_defaultQueue(Queue::createInvalid(adapter, *this))
    , m_adapter(adapter)
    , m_instance(adapter.weakInstance())
{
    if (!m_adapter->isValid())
        makeInvalid();
}

Device::~Device()
{
#if 1 /* PLATFORM(MAC) */
    ALLOW_DEPRECATED_DECLARATIONS_BEGIN
    MTLRemoveDeviceObserver(m_deviceObserver);
    ALLOW_DEPRECATED_DECLARATIONS_END
#endif
    if (m_deviceLostCallback) {
        m_deviceLostCallback(WGPUDeviceLostReason_Destroyed, ""_s);
        m_deviceLostCallback = nullptr;
    }

    if (m_uncapturedErrorCallback) {
        m_uncapturedErrorCallback(WGPUErrorType_NoError, ""_s);
        m_uncapturedErrorCallback = nullptr;
    }
}

void Device::makeInvalid()
{
    m_device = nil;
    protect(m_defaultQueue)->makeInvalid();
}

void Device::loseTheDevice(WGPUDeviceLostReason reason)
{
    m_device = nil;

    m_adapter->makeInvalid();

    if (m_deviceLostCallback) {
        m_deviceLostCallback(reason, "Device lost."_s);
        m_deviceLostCallback = nullptr;
    }

    protect(m_defaultQueue)->makeInvalid();
    m_isLost = true;
}

void Device::setOwnerWithIdentity(id<MTLResource>) const
{
    // Attributes Metal allocations to another process; WebKit needs this in its GPU process, bun is a single process.
}

void Device::destroy()
{
    m_destroyed = true;

    loseTheDevice(WGPUDeviceLostReason_Destroyed);
}

size_t Device::enumerateFeatures(WGPUFeatureName* features)
{
    // The API contract for this requires that sufficient space has already been allocated for the output.
    // This requires the caller calling us twice: once to get the amount of space to allocate, and once to fill the space.
    if (features)
        std::ranges::copy(m_capabilities.features, features);
    return m_capabilities.features.size();
}

bool Device::getLimits(WGPUSupportedLimits& limits)
{
    limits.limits = m_capabilities.limits;
    return true;
}

id<MTLTexture> Device::placeholderTexture(WGPUTextureFormat format) const
{
    return Texture::isDepthOrStencilFormat(format) ? m_placeholderDepthStencilTexture : m_placeholderTexture;
}

bool Device::hasFeature(WGPUFeatureName feature) const
{
    return m_capabilities.features.contains(feature);
}

auto Device::currentErrorScope(WGPUErrorFilter type) -> ErrorScope*
{
    // https://gpuweb.github.io/gpuweb/#abstract-opdef-current-error-scope

    for (auto iterator = m_errorScopeStack.rbegin(); iterator != m_errorScopeStack.rend(); ++iterator) {
        if (iterator->filter == type)
            return &*iterator;
    }
    return nullptr;
}

void Device::generateAValidationError(NSString * message)
{
    generateAValidationError(createString(message));
}

void Device::generateAValidationError(String&& message)
{
    if (m_supressAllErrors)
        return;

    // https://gpuweb.github.io/gpuweb/#abstract-opdef-generate-a-validation-error
    auto* scope = currentErrorScope(WGPUErrorFilter_Validation);
    if (scope) {
        if (!scope->error)
            scope->error = Error { WGPUErrorType_Validation, WTF::move(message) };
        return;
    }

    if (m_uncapturedErrorCallback) {
        m_uncapturedErrorCallback(WGPUErrorType_Validation, WTF::move(message));
        m_uncapturedErrorCallback = nullptr;
    }
}

void Device::generateAnOutOfMemoryError(String&& message)
{
    if (m_supressAllErrors)
        return;

    // https://gpuweb.github.io/gpuweb/#abstract-opdef-generate-an-out-of-memory-error

    auto* scope = currentErrorScope(WGPUErrorFilter_OutOfMemory);

    if (scope) {
        if (!scope->error)
            scope->error = Error { WGPUErrorType_OutOfMemory, WTF::move(message) };
        return;
    }

    if (m_uncapturedErrorCallback) {
        m_uncapturedErrorCallback(WGPUErrorType_OutOfMemory, WTF::move(message));
        m_uncapturedErrorCallback = nullptr;
    }
}

void Device::generateAnInternalError(String&& message)
{
    if (m_supressAllErrors)
        return;

    // https://gpuweb.github.io/gpuweb/#abstract-opdef-generate-an-internal-error

    auto* scope = currentErrorScope(WGPUErrorFilter_Internal);

    if (scope) {
        if (!scope->error)
            scope->error = Error { WGPUErrorType_Internal, WTF::move(message) };
        return;
    }

    if (m_uncapturedErrorCallback) {
        m_uncapturedErrorCallback(WGPUErrorType_Internal, WTF::move(message));
        m_uncapturedErrorCallback = nullptr;
    }
}

id<MTLBuffer> Device::newBufferWithBytes(const void* pointer, size_t length, MTLResourceOptions options, bool skipAttribution) const
{
    id<MTLBuffer> buffer = [m_device newBufferWithBytes:pointer length:length options:options];
    if (!skipAttribution)
        setOwnerWithIdentity(buffer);
    return buffer;
}

id<MTLBuffer> Device::newBufferWithBytesNoCopy(void* pointer, size_t length, MTLResourceOptions options, bool skipAttribution) const
{
    id<MTLBuffer> buffer = [m_device newBufferWithBytesNoCopy:pointer length:length options:options deallocator:nil];
    if (!skipAttribution)
        setOwnerWithIdentity(buffer);
    return buffer;
}

void Device::captureFrameIfNeeded() const
{
    GPUFrameCapture::captureSingleFrameIfNeeded(m_device);
}

std::optional<WGPUErrorType> Device::validatePopErrorScope() const
{
    if (m_isLost)
        return WGPUErrorType_NoError;

    if (m_errorScopeStack.isEmpty())
        return WGPUErrorType_Unknown;

    return std::nullopt;
}

bool Device::popErrorScope(CompletionHandler<void(WGPUErrorType, String&&)>&& callback)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudevice-poperrorscope

    if (auto errorType = validatePopErrorScope()) {
        callback(*errorType, "popErrorScope() failed validation."_s);
        return false;
    }

    auto scope = m_errorScopeStack.takeLast();

    if (auto inst = instance(); inst.get()) {
        inst->scheduleWork([scope = WTF::move(scope), callback = WTF::move(callback)]() mutable {
            if (scope.error)
                callback(scope.error->type, WTF::move(scope.error->message));
            else
                callback(WGPUErrorType_NoError, { });
        });
    } else
        callback(WGPUErrorType_NoError, { });

    // FIXME: Make sure this is the right thing to return.
    return true;
}

void Device::pushErrorScope(WGPUErrorFilter filter)
{
    // https://gpuweb.github.io/gpuweb/#dom-gpudevice-pusherrorscope

    ErrorScope scope { std::nullopt, filter };

    m_errorScopeStack.append(WTF::move(scope));
}

void Device::setDeviceLostCallback(Function<void(WGPUDeviceLostReason, String&&)>&& callback)
{
    if (m_deviceLostCallback)
        m_deviceLostCallback(WGPUDeviceLostReason_Destroyed, ""_s);

    m_deviceLostCallback = WTF::move(callback);
    if (m_isLost)
        loseTheDevice(WGPUDeviceLostReason_Destroyed);
    else if (!m_adapter->isValid())
        loseTheDevice(WGPUDeviceLostReason_Undefined);
}

void Device::setUncapturedErrorCallback(Function<void(WGPUErrorType, String&&)>&& callback)
{
    if (m_uncapturedErrorCallback)
        m_uncapturedErrorCallback(WGPUErrorType_NoError, ""_s);
    m_uncapturedErrorCallback = WTF::move(callback);
}

void Device::setLabel(String&&)
{
    // Because MTLDevices are process-global, we can't set the label on it, because 2 contexts' labels would fight each other.
}

id<MTLBuffer> Device::dispatchCallBuffer()
{
    if (!m_device)
        return nil;

    if (!m_dispatchCallBuffer) {
        m_dispatchCallBuffer = [m_device newBufferWithLength:sizeof(MTLDispatchThreadgroupsIndirectArguments) options:MTLResourceStorageModePrivate];
        setOwnerWithIdentity(m_dispatchCallBuffer);
    }
    return m_dispatchCallBuffer;
}

id<MTLComputePipelineState> Device::dispatchCallPipelineState(id<MTLFunction> function)
{
    if (!m_device)
        return nil;

    if (!m_dispatchCallPipelineState) {
        NSError* error = nil;
        m_dispatchCallPipelineState = [m_device newComputePipelineStateWithFunction:function error:&error];
        if (error)
            WTFLogAlways("Metal code failure: %@", error);
    }
    return m_dispatchCallPipelineState;
}

id<MTLRenderPipelineState> Device::indexBufferClampPipeline(MTLIndexType indexType, NSUInteger rasterSampleCount)
{
    if (!m_device)
        return nil;

    bool isUint16 = indexType == MTLIndexTypeUInt16;
    id<MTLRenderPipelineState> result = isUint16 ? (rasterSampleCount > 1 ? m_indexBufferClampUshortPSOMS : m_indexBufferClampUshortPSO) : (rasterSampleCount > 1 ? m_indexBufferClampUintPSOMS : m_indexBufferClampUintPSO);
    if (result)
        return result;

    static id<MTLFunction> function = nil;
    static id<MTLFunction> functionUshort = nil;
    NSError *error = nil;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        /* NOLINT */ id<MTLLibrary> library = [m_device newLibraryWithSource:@R"(
#define vertexCount 0
#define primitiveRestart 1
#define indexCountMinusOne 2
    using namespace metal;
    )"  OBJC_STRINGIFY(WEBKIT_DRAW_INDEXED_INDIRECT_STRUCT_TYPE)   @R"(
    [[vertex]] void vsUshortIndexClamp(device const ushort* indexBuffer [[buffer(0)]], device WebKitMTLDrawIndexedPrimitivesIndirectArguments& wkindexedOutput [[buffer(1)]], const constant uint* data [[buffer(2)]], uint indexId [[vertex_id]])
    {
        device MTLDrawIndexedPrimitivesIndirectArguments& indexedOutput = wkindexedOutput.args;
        ushort indexBufferValue = indexBuffer[min(indexId, data[indexCountMinusOne])];
        uint vertexIndex = uint((ushort)(data[primitiveRestart]) + indexBufferValue);
        if (addsat(vertexIndex, indexedOutput.baseVertex) >= data[vertexCount] + data[primitiveRestart]) {
            indexedOutput.indexCount = 0u;
            indexedOutput.instanceCount = 0u;
            indexedOutput.indexStart = 0u;
            indexedOutput.baseVertex = 0u;
            indexedOutput.baseInstance = 0u;
            wkindexedOutput.lostOrOOBRead = 1;
        }
    }
    [[vertex]] void vsUintIndexClamp(device const uint* indexBuffer [[buffer(0)]], device WebKitMTLDrawIndexedPrimitivesIndirectArguments& wkindexedOutput [[buffer(1)]], const constant uint* data [[buffer(2)]], uint indexId [[vertex_id]])
    {
        device MTLDrawIndexedPrimitivesIndirectArguments& indexedOutput = wkindexedOutput.args;
        uint indexBufferValue = indexBuffer[min(indexId, data[indexCountMinusOne])];
        uint vertexIndex = data[primitiveRestart] + indexBufferValue;
        if (addsat(vertexIndex, indexedOutput.baseVertex) >= data[vertexCount] + data[primitiveRestart]) {
            indexedOutput.indexCount = 0u;
            indexedOutput.instanceCount = 0u;
            indexedOutput.indexStart = 0u;
            indexedOutput.baseVertex = 0u;
            indexedOutput.baseInstance = 0u;
            wkindexedOutput.lostOrOOBRead = 1;
        }
    })" /* NOLINT */ options:options error:&error];
        if (error)
            WTFLogAlways("%@", error);

        function = [library newFunctionWithName:@"vsUintIndexClamp"];
        functionUshort = [library newFunctionWithName:@"vsUshortIndexClamp"];
    });

    RELEASE_ASSERT(function && functionUshort);
    MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];
    mtlRenderPipelineDescriptor.vertexFunction = isUint16 ? functionUshort : function;
    mtlRenderPipelineDescriptor.rasterizationEnabled = false;
    mtlRenderPipelineDescriptor.rasterSampleCount = rasterSampleCount;
    mtlRenderPipelineDescriptor.fragmentFunction = nil;
    mtlRenderPipelineDescriptor.inputPrimitiveTopology = MTLPrimitiveTopologyClassPoint;

    if (isUint16) {
        if (rasterSampleCount > 1)
            result = m_indexBufferClampUshortPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
        else
            result = m_indexBufferClampUshortPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    } else {
        if (rasterSampleCount > 1)
            result = m_indexBufferClampUintPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
        else
            result = m_indexBufferClampUintPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    }

    if (error) {
        WTFLogAlways("%@", error);
        return nil;
    }
    return result;
}

id<MTLRenderPipelineState> Device::indexedIndirectBufferClampPipeline(NSUInteger rasterSampleCount)
{
    if (!m_device)
        return nil;

    id<MTLRenderPipelineState> result = rasterSampleCount > 1 ? m_indexedIndirectBufferClampPSOMS : m_indexedIndirectBufferClampPSO;
    if (result)
        return result;

    static id<MTLFunction> function = [&] {
        NSError *error = nil;
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        /* NOLINT */ id<MTLLibrary> library = [m_device newLibraryWithSource:[NSString stringWithFormat:@R"(
    using namespace metal;
    )"  OBJC_STRINGIFY(WEBKIT_DRAW_INDIRECT_STRUCT_TYPE)   @R"(
    )"  OBJC_STRINGIFY(WEBKIT_DRAW_INDEXED_INDIRECT_STRUCT_TYPE)   @R"(
    [[vertex]] void vsIndexedIndirect(device const MTLDrawIndexedPrimitivesIndirectArguments& input [[buffer(0)]], device WebKitMTLDrawIndexedPrimitivesIndirectArguments& wkindexedOutput [[buffer(1)]], device WebKitMTLDrawPrimitivesIndirectArguments& wkoutput [[buffer(2)]], const constant uint* indexBufferCount [[buffer(3)]])
    {
        device MTLDrawPrimitivesIndirectArguments& output = wkoutput.args;
        device MTLDrawIndexedPrimitivesIndirectArguments& indexedOutput = wkindexedOutput.args;
        bool lostCondition = input.indexCount > %u || input.instanceCount > %u || madsat(input.indexCount, input.instanceCount, 0u) > %u;
        bool condition = lostCondition
            || addsat(input.indexCount, input.indexStart) > indexBufferCount[0]
            || input.indexStart >= indexBufferCount[0]
            || addsat(input.instanceCount, input.baseInstance) > indexBufferCount[1]
            || input.baseInstance >= indexBufferCount[1];

        indexedOutput.indexCount = metal::select(input.indexCount, 0u, condition);
        indexedOutput.instanceCount = input.instanceCount;
        indexedOutput.indexStart = metal::select(input.indexStart, 0u, condition);
        indexedOutput.baseVertex = input.baseVertex;
        indexedOutput.baseInstance = input.baseInstance;

        output.vertexCount = metal::select(input.indexCount, 0u, condition);
        output.instanceCount = 1;
        output.vertexStart = input.indexStart;
        output.baseInstance = 0;
        if (lostCondition)
            wkoutput.lostOrOOBRead = 1;
    })", m_maxVerticesPerDrawCall, m_maxVerticesPerDrawCall, m_maxVerticesPerDrawCall] /* NOLINT */ options:options error:&error];
        if (error)
            WTFLogAlways("%@", error);

        return [library newFunctionWithName:@"vsIndexedIndirect"];
    }();

    RELEASE_ASSERT(function);
    MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];
    mtlRenderPipelineDescriptor.vertexFunction = function;
    mtlRenderPipelineDescriptor.rasterizationEnabled = false;
    mtlRenderPipelineDescriptor.rasterSampleCount = rasterSampleCount;
    mtlRenderPipelineDescriptor.fragmentFunction = nil;
    mtlRenderPipelineDescriptor.inputPrimitiveTopology = MTLPrimitiveTopologyClassPoint;

    NSError *error = nil;
    if (rasterSampleCount > 1)
        result = m_indexedIndirectBufferClampPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    else
        result = m_indexedIndirectBufferClampPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];

    if (error) {
        WTFLogAlways("%@", error);
        return nil;
    }
    return result;
}

id<MTLRenderPipelineState> Device::indirectBufferClampPipeline(NSUInteger rasterSampleCount)
{
    if (!m_device)
        return nil;

    id<MTLRenderPipelineState> result = rasterSampleCount > 1 ? m_indirectBufferClampPSOMS : m_indirectBufferClampPSO;
    if (result)
        return result;

    static id<MTLFunction> function = nil;
    NSError *error = nil;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        /* NOLINT */ id<MTLLibrary> library = [m_device newLibraryWithSource:[NSString stringWithFormat:@R"(
    using namespace metal;
    )"  OBJC_STRINGIFY(WEBKIT_DRAW_INDIRECT_STRUCT_TYPE)   @R"(
    [[vertex]] void vsIndirect(device const MTLDrawPrimitivesIndirectArguments& input [[buffer(0)]], device WebKitMTLDrawPrimitivesIndirectArguments& wkoutput [[buffer(1)]], const constant uint* minCounts [[buffer(2)]])
    {
        device MTLDrawPrimitivesIndirectArguments& output = wkoutput.args;
        bool lostCondition = input.vertexCount > %u || input.instanceCount > %u || madsat(input.vertexCount, input.instanceCount, 0u) > %u;
        bool vertexCondition = lostCondition
            || addsat(input.vertexCount, input.vertexStart) > minCounts[0]
            || input.vertexStart >= minCounts[0];
        bool instanceCondition = addsat(input.baseInstance, input.instanceCount) > minCounts[1] || input.baseInstance >= minCounts[1];
        auto minVertexCountMinusVertexStart = minCounts[0] > input.vertexStart ? (minCounts[0] - input.vertexStart) : 0u;
        output.vertexCount = metal::select(input.vertexCount, minVertexCountMinusVertexStart, vertexCondition);
        auto minInstanceCountMinusInstanceStart = minCounts[1] > input.baseInstance ? (minCounts[1] - input.baseInstance) : 0u;
        output.instanceCount = metal::select(input.instanceCount, minInstanceCountMinusInstanceStart, instanceCondition);
        output.vertexStart = input.vertexStart;
        output.baseInstance = input.baseInstance;
        if (lostCondition)
            wkoutput.lostOrOOBRead = 1;
    })", m_maxVerticesPerDrawCall, m_maxVerticesPerDrawCall, m_maxVerticesPerDrawCall] /* NOLINT */ options:options error:&error];
        if (error)
            WTFLogAlways("%@", error);

        function = [library newFunctionWithName:@"vsIndirect"];
    });

    RELEASE_ASSERT(function);
    MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];
    mtlRenderPipelineDescriptor.vertexFunction = function;
    mtlRenderPipelineDescriptor.rasterizationEnabled = false;
    mtlRenderPipelineDescriptor.rasterSampleCount = rasterSampleCount;
    mtlRenderPipelineDescriptor.fragmentFunction = nil;
    mtlRenderPipelineDescriptor.inputPrimitiveTopology = MTLPrimitiveTopologyClassPoint;

    if (rasterSampleCount > 1)
        result = m_indirectBufferClampPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    else
        result = m_indirectBufferClampPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];

    if (error) {
        WTFLogAlways("%@", error);
        return nil;
    }
    return result;
}

id<MTLRenderPipelineState> Device::icbCommandClampPipeline(MTLIndexType indexType, NSUInteger rasterSampleCount)
{
    if (!m_device)
        return nil;

    bool isUint16 = indexType == MTLIndexTypeUInt16;
    id<MTLRenderPipelineState> result = isUint16 ? (rasterSampleCount > 1 ? m_icbCommandClampUshortPSOMS : m_icbCommandClampUshortPSO) : (rasterSampleCount > 1 ? m_icbCommandClampUintPSOMS : m_icbCommandClampUintPSO);
    if (result)
        return result;

    NSError *error = nil;
    MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];
    mtlRenderPipelineDescriptor.vertexFunction = icbCommandClampFunction(indexType);
    mtlRenderPipelineDescriptor.rasterizationEnabled = false;
    mtlRenderPipelineDescriptor.rasterSampleCount = rasterSampleCount;
    mtlRenderPipelineDescriptor.fragmentFunction = nil;
    mtlRenderPipelineDescriptor.inputPrimitiveTopology = MTLPrimitiveTopologyClassPoint;

    if (isUint16) {
        if (rasterSampleCount > 1)
            result = m_icbCommandClampUshortPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
        else
            result = m_icbCommandClampUshortPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    } else {
        if (rasterSampleCount > 1)
            result = m_icbCommandClampUintPSOMS = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
        else
            result = m_icbCommandClampUintPSO = [m_device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    }

    if (error) {
        WTFLogAlways("%@", error);
        return nil;
    }
    return result;
}

int Device::bufferIndexForICBContainer() const
{
#define DEVICE_BUFFER_INDEX_FOR_ICB_CONTAINER 1
    return DEVICE_BUFFER_INDEX_FOR_ICB_CONTAINER;
}

id<MTLFunction> Device::icbCommandClampFunction(MTLIndexType indexType)
{
    static id<MTLFunction> function = nil;
    static id<MTLFunction> functionUshort = nil;
    NSError *error = nil;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        MTLCompileOptions* options = [MTLCompileOptions new];
        ALLOW_DEPRECATED_DECLARATIONS_BEGIN
        options.fastMathEnabled = YES;
        ALLOW_DEPRECATED_DECLARATIONS_END
        /* NOLINT */ id<MTLLibrary> library = [m_device newLibraryWithSource:[NSString stringWithFormat:@R"(
    using namespace metal;
    struct ICBContainer {
        device uint* outOfBoundsRead [[ id(0) ]];
        command_buffer commandBuffer [[ id(1) ]];
    };
    struct IndexDataUshort {
        uint64_t renderCommand { 0 };
        uint32_t minVertexCount { UINT_MAX };
        uint32_t minInstanceCount { UINT_MAX };
        device ushort* indexBuffer;
        uint32_t indexBufferElementCountMinusOne;
        uint32_t indexCount { 0 };
        uint32_t instanceCount { 0 };
        uint32_t firstIndex { 0 };
        uint32_t baseVertex { 0 };
        uint32_t baseInstance { 0 };
        primitive_type primitiveType { primitive_type::triangle };
    };
    struct IndexDataUint {
        uint64_t renderCommand { 0 };
        uint32_t minVertexCount { UINT_MAX };
        uint32_t minInstanceCount { UINT_MAX };
        device uint* indexBuffer;
        uint32_t indexBufferElementCountMinusOne;
        uint32_t indexCount { 0 };
        uint32_t instanceCount { 0 };
        uint32_t firstIndex { 0 };
        uint32_t baseVertex { 0 };
        uint32_t baseInstance { 0 };
        primitive_type primitiveType { primitive_type::triangle };
    };

    static_assert(sizeof(primitive_type) == sizeof(uint32_t), "API assumes primitive type is sizeof uint32_t");
    static_assert(sizeof(IndexDataUshort) == %lu, "sizeof(IndexDataUshort) in shader mismatches the API size");
    static_assert(sizeof(IndexDataUint) == %lu, "sizeof(IndexDataUint) in shader mismatches the API size");

    [[vertex]] void vsICB(device const IndexDataUint* indexData [[buffer(0)]],
        device ICBContainer *icb_container [[buffer()" OBJC_STRINGIFY(DEVICE_BUFFER_INDEX_FOR_ICB_CONTAINER) @R"()]],
        uint indexId [[vertex_id]])
    {
        device const IndexDataUint& data = *indexData;
        uint32_t k = (data.primitiveType == primitive_type::triangle_strip || data.primitiveType == primitive_type::line_strip) ? 1 : 0;
        uint32_t indexBufferValue = data.indexBuffer[min(data.indexBufferElementCountMinusOne, indexId + data.firstIndex)];
        uint32_t vertexIndex = indexBufferValue + k;
        if (addsat(vertexIndex, data.baseVertex) >= data.minVertexCount + k) {
            *icb_container->outOfBoundsRead = 1;
            render_command cmd(icb_container->commandBuffer, data.renderCommand);
            cmd.draw_indexed_primitives(data.primitiveType,
                0u,
                data.indexBuffer,
                data.instanceCount,
                data.baseVertex,
                data.baseInstance);
        }
    }

    [[vertex]] void vsUshortICB(device const IndexDataUshort* indexData [[buffer(0)]],
        device ICBContainer *icb_container [[buffer()" OBJC_STRINGIFY(DEVICE_BUFFER_INDEX_FOR_ICB_CONTAINER) @R"()]],
        uint indexId [[vertex_id]])
    {
        device const IndexDataUshort& data = *indexData;
        uint32_t k = (data.primitiveType == primitive_type::triangle_strip || data.primitiveType == primitive_type::line_strip) ? 1 : 0;
        ushort indexBufferValue = data.indexBuffer[min(data.indexBufferElementCountMinusOne, indexId + data.firstIndex)];
        uint32_t vertexIndex = uint(indexBufferValue) + k;
        if (addsat(vertexIndex, data.baseVertex) >= data.minVertexCount + k) {
            *icb_container->outOfBoundsRead = 1;
            render_command cmd(icb_container->commandBuffer, data.renderCommand);
            cmd.draw_indexed_primitives(data.primitiveType,
                0u,
                data.indexBuffer,
                data.instanceCount,
                data.baseVertex,
                data.baseInstance);
        }

    })", sizeof(IndexData), sizeof(IndexData)] /* NOLINT */ options:options error:&error];
        if (error)
            WTFLogAlways("%@", error);

        function = [library newFunctionWithName:@"vsICB"];
        functionUshort = [library newFunctionWithName:@"vsUshortICB"];
    });
#undef DEVICE_BUFFER_INDEX_FOR_ICB_CONTAINER
#undef OBJC_STRINGIFY
#undef OBJC_STRINGIFYHELPER

    RELEASE_ASSERT(function && functionUshort);
    return indexType == MTLIndexTypeUInt16 ? functionUshort : function;
}

void Device::pauseErrorReporting(bool pauseReporting)
{
    m_supressAllErrors = pauseReporting;
}

uint32_t Device::vertexBufferIndexForBindGroup(uint32_t groupIndex) const
{
    ASSERT(maxBuffersPlusVertexBuffersForVertexStage() > 0);
    return WGSL::vertexBufferIndexForBindGroup(groupIndex, maxBuffersPlusVertexBuffersForVertexStage() - 1);
}

id<MTLSharedEvent> Device::resolveTimestampsSharedEvent()
{
    if (!m_resolveTimestampsSharedEvent)
        m_resolveTimestampsSharedEvent = [m_device newSharedEvent];

    return m_resolveTimestampsSharedEvent;
}

void Device::trackTimestampsBuffer(id<MTLCommandBuffer> commandBuffer, id<MTLCounterSampleBuffer> counterSampleBuffer)
{
    NSMutableArray<id<MTLCounterSampleBuffer>>* sampleBufferArray = [m_sampleCounterBuffers objectForKey:commandBuffer];
    if (!sampleBufferArray) {
        sampleBufferArray = [NSMutableArray array];
        [m_sampleCounterBuffers setObject:sampleBufferArray forKey:commandBuffer];
    }
    [sampleBufferArray addObject:counterSampleBuffer];
}

void Device::makeSubmitInvalidClearingEncoders(TrackedResourceContainer& commandEncoders)
{
    auto encoders = std::exchange(commandEncoders, { });
    for (auto commandEncoder : encoders) {
        if (RefPtr ptr = commandEncoderFromIdentifier(commandEncoder))
            ptr->makeSubmitInvalid();
    }
}

} // namespace WebGPU

#pragma mark WGPU Stubs

void NODELETE wgpuDeviceReference(WGPUDevice device)
{
    WebGPU::fromAPI(device).ref();
}

void wgpuDeviceRelease(WGPUDevice device)
{
    WebGPU::fromAPI(device).deref();
}

WGPUBindGroup wgpuDeviceCreateBindGroup(WGPUDevice device, const WGPUBindGroupDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createBindGroup(*descriptor));
}

WGPUBindGroupLayout wgpuDeviceCreateBindGroupLayout(WGPUDevice device, const WGPUBindGroupLayoutDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createBindGroupLayout(*descriptor));
}

WGPUBuffer wgpuDeviceCreateBuffer(WGPUDevice device, const WGPUBufferDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createBuffer(*descriptor));
}

WGPUCommandEncoder wgpuDeviceCreateCommandEncoder(WGPUDevice device, const WGPUCommandEncoderDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createCommandEncoder(*descriptor));
}

WGPUComputePipeline wgpuDeviceCreateComputePipeline(WGPUDevice device, const WGPUComputePipelineDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createComputePipeline(*descriptor).first);
}

void wgpuDevicePauseErrorReporting(WGPUDevice device, WGPUBool pauseErrors)
{
    WebGPU::fromAPI(device).pauseErrorReporting(!!pauseErrors);
}

void wgpuDeviceScheduleWork(WGPUDevice device, WGPUWorkItem workItem)
{
    if (auto instance = WebGPU::fromAPI(device).instance(); instance.get())
        instance->scheduleWork(WebGPU::fromAPI(WTF::move(workItem)));
    else
        workItem();
}

void wgpuDeviceCreateComputePipelineAsync(WGPUDevice device, const WGPUComputePipelineDescriptor* descriptor, WGPUCreateComputePipelineAsyncCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(device))->createComputePipelineAsync(*descriptor, [callback, userdata](WGPUCreatePipelineAsyncStatus status, Ref<WebGPU::ComputePipeline>&& pipeline, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(pipeline)), WTF::move(message), userdata);
    });
}

void wgpuDeviceCreateComputePipelineAsyncWithBlock(WGPUDevice device, WGPUComputePipelineDescriptor const * descriptor, WGPUCreateComputePipelineAsyncBlockCallback callback)
{
    protect(WebGPU::fromAPI(device))->createComputePipelineAsync(*descriptor, [callback = WebGPU::fromAPI(WTF::move(callback))](WGPUCreatePipelineAsyncStatus status, Ref<WebGPU::ComputePipeline>&& pipeline, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(pipeline)), WTF::move(message));
    });
}

WGPUPipelineLayout wgpuDeviceCreatePipelineLayout(WGPUDevice device, const WGPUPipelineLayoutDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createPipelineLayout(*descriptor, !descriptor->bindGroupLayouts));
}

WGPUQuerySet wgpuDeviceCreateQuerySet(WGPUDevice device, const WGPUQuerySetDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createQuerySet(*descriptor));
}

WGPURenderBundleEncoder wgpuDeviceCreateRenderBundleEncoder(WGPUDevice device, const WGPURenderBundleEncoderDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createRenderBundleEncoder(*descriptor));
}

WGPURenderPipeline wgpuDeviceCreateRenderPipeline(WGPUDevice device, const WGPURenderPipelineDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createRenderPipeline(*descriptor).first);
}

void wgpuDeviceCreateRenderPipelineAsync(WGPUDevice device, const WGPURenderPipelineDescriptor* descriptor, WGPUCreateRenderPipelineAsyncCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(device))->createRenderPipelineAsync(*descriptor, [callback, userdata](WGPUCreatePipelineAsyncStatus status, Ref<WebGPU::RenderPipeline>&& pipeline, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(pipeline)), WTF::move(message), userdata);
    });
}

void wgpuDeviceCreateRenderPipelineAsyncWithBlock(WGPUDevice device, WGPURenderPipelineDescriptor const * descriptor, WGPUCreateRenderPipelineAsyncBlockCallback callback)
{
    protect(WebGPU::fromAPI(device))->createRenderPipelineAsync(*descriptor, [callback = WebGPU::fromAPI(WTF::move(callback))](WGPUCreatePipelineAsyncStatus status, Ref<WebGPU::RenderPipeline>&& pipeline, String&& message) {
        callback(status, WebGPU::releaseToAPI(WTF::move(pipeline)), WTF::move(message));
    });
}

WGPUSampler wgpuDeviceCreateSampler(WGPUDevice device, const WGPUSamplerDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createSampler(*descriptor));
}

WGPUShaderModule wgpuDeviceCreateShaderModule(WGPUDevice device, const WGPUShaderModuleDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createShaderModule(*descriptor));
}

WGPUTexture wgpuDeviceCreateTexture(WGPUDevice device, const WGPUTextureDescriptor* descriptor)
{
    return WebGPU::releaseToAPI(protect(WebGPU::fromAPI(device))->createTexture(*descriptor));
}

void wgpuDeviceDestroy(WGPUDevice device)
{
    protect(WebGPU::fromAPI(device))->destroy();
}

size_t wgpuDeviceEnumerateFeatures(WGPUDevice device, WGPUFeatureName* features)
{
    return protect(WebGPU::fromAPI(device))->enumerateFeatures(features);
}

WGPUBool wgpuDeviceGetLimits(WGPUDevice device, WGPUSupportedLimits* limits)
{
    return WebGPU::fromAPI(device).getLimits(*limits);
}

WGPUQueue wgpuDeviceGetQueue(WGPUDevice device)
{
    return &WebGPU::fromAPI(device).getQueueReference();
}

WGPUBool wgpuDeviceHasFeature(WGPUDevice device, WGPUFeatureName feature)
{
    return protect(WebGPU::fromAPI(device))->hasFeature(feature);
}

void wgpuDevicePopErrorScope(WGPUDevice device, WGPUErrorCallback callback, void* userdata)
{
    protect(WebGPU::fromAPI(device))->popErrorScope([callback, userdata](WGPUErrorType type, String&& message) {
        callback(type, message.utf8().data(), userdata);
    });
}

void wgpuDevicePopErrorScopeWithBlock(WGPUDevice device, WGPUErrorBlockCallback callback)
{
    protect(WebGPU::fromAPI(device))->popErrorScope([callback = WebGPU::fromAPI(WTF::move(callback))](WGPUErrorType type, String&& message) {
        callback(type, message.utf8().data());
    });
}

void wgpuDevicePushErrorScope(WGPUDevice device, WGPUErrorFilter filter)
{
    protect(WebGPU::fromAPI(device))->pushErrorScope(filter);
}

void wgpuDeviceClearDeviceLostCallback(WGPUDevice device)
{
    return protect(WebGPU::fromAPI(device))->setDeviceLostCallback(nullptr);
}
void wgpuDeviceClearUncapturedErrorCallback(WGPUDevice device)
{
    return protect(WebGPU::fromAPI(device))->setUncapturedErrorCallback(nullptr);
}

void wgpuDeviceSetDeviceLostCallback(WGPUDevice device, WGPUDeviceLostCallback callback, void* userdata)
{
    return protect(WebGPU::fromAPI(device))->setDeviceLostCallback([callback, userdata](WGPUDeviceLostReason reason, String&& message) {
        if (callback)
            callback(reason, message.utf8().data(), userdata);
    });
}

void wgpuDeviceSetDeviceLostCallbackWithBlock(WGPUDevice device, WGPUDeviceLostBlockCallback callback)
{
    return protect(WebGPU::fromAPI(device))->setDeviceLostCallback([callback = WebGPU::fromAPI(WTF::move(callback))](WGPUDeviceLostReason reason, String&& message) {
        if (callback)
            callback(reason, message.utf8().data());
    });
}

void wgpuDeviceSetUncapturedErrorCallback(WGPUDevice device, WGPUErrorCallback callback, void* userdata)
{
    return protect(WebGPU::fromAPI(device))->setUncapturedErrorCallback([callback, userdata](WGPUErrorType type, String&& message) {
        if (callback)
            callback(type, message.utf8().data(), userdata);
    });
}

void wgpuDeviceSetUncapturedErrorCallbackWithBlock(WGPUDevice device, WGPUErrorBlockCallback callback)
{
    return protect(WebGPU::fromAPI(device))->setUncapturedErrorCallback([callback = WebGPU::fromAPI(WTF::move(callback))](WGPUErrorType type, String&& message) {
        if (callback)
            callback(type, message.utf8().data());
    });
}

void wgpuDeviceSetLabel(WGPUDevice device, const char* label)
{
    WebGPU::fromAPI(device).setLabel(WebGPU::fromAPI(label));
}
