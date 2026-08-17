/*
 * Copyright (C) 2021-2025 Apple Inc. All rights reserved.
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

#include "ActiveDOMObject.h"
#include "EventTarget.h"
#include "EventTargetInterfaces.h"
#include "GPUBindGroupEntry.h"
#include "GPUComputePipeline.h"
#include "GPUDeviceLostInfo.h"
#include "GPUError.h"
#include "GPUErrorFilter.h"
#include "GPURenderPipeline.h"
#include "GPUQueue.h"
#include "JSDOMPromiseDeferredForward.h"
#include "ScriptExecutionContext.h"
#include "WebGPUDevice.h"
#include <optional>
#include <wtf/CurrentThread.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/Ref.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/WeakHashMap.h>
#include <wtf/WeakHashSet.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class GPUAdapterInfo;
class GPUBindGroup;
struct GPUBindGroupDescriptor;
class GPUBindGroupLayout;
struct GPUBindGroupLayoutDescriptor;
class GPUBuffer;
struct GPUBufferDescriptor;
class GPUCommandEncoder;
struct GPUCommandEncoderDescriptor;
class GPUComputePipeline;
struct GPUComputePipelineDescriptor;
class GPUExternalTexture;
struct GPUExternalTextureDescriptor;
class GPURenderPipeline;
struct GPURenderPipelineDescriptor;
class GPUPipelineLayout;
struct GPUPipelineLayoutDescriptor;
class GPUPresentationContext;
class GPUQuerySet;
struct GPUQuerySetDescriptor;
class GPURenderBundleEncoder;
struct GPURenderBundleEncoderDescriptor;
class GPURenderPipeline;
struct GPURenderPipelineDescriptor;
class GPUSampler;
struct GPUSamplerDescriptor;
class GPUShaderModule;
struct GPUShaderModuleDescriptor;
class GPUSupportedFeatures;
class GPUSupportedLimits;
class GPUTexture;
struct GPUTextureDescriptor;
class HTMLVideoElement;
class WebXRSession;
class XRGPUBinding;
template<typename T> struct UniquelyAnnotatedDescriptor;

namespace WebGPU {
class XRBinding;
}

class GPUDevice : public RefCounted<GPUDevice>, public ActiveDOMObject, public EventTarget {
    WTF_MAKE_TZONE_ALLOCATED(GPUDevice);
public:
    static Ref<GPUDevice> create(ScriptExecutionContext*, Ref<WebGPU::Device>&&, String&& queueLabel, GPUAdapterInfo&);

    static HashSet<GPUDevice*>& NODELETE instances() WTF_REQUIRES_LOCK(instancesLock());
    static Lock& NODELETE instancesLock() WTF_RETURNS_LOCK(s_instancesLock);

    virtual ~GPUDevice();

    bool isContextThread() const { return m_owningThreadUID == currentThreadID(); }

    // ContextDestructionObserver.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    void contextDestroyed() final;
    USING_CAN_MAKE_WEAKPTR(EventTarget);

    String NODELETE label() const;
    void setLabel(String&&);

    Ref<GPUSupportedFeatures> NODELETE features() const;
    Ref<GPUSupportedLimits> NODELETE limits() const;

    Ref<GPUQueue> NODELETE queue() const;

    void destroy(ScriptExecutionContext&);

    RefPtr<WebGPU::XRBinding> createXRBinding(const WebXRSession&);
    ExceptionOr<Ref<GPUBuffer>> createBuffer(GPUBufferDescriptor&&);
    ExceptionOr<Ref<GPUTexture>> createTexture(GPUTextureDescriptor&&);
    std::optional<String> errorValidatingSupportedFormat(GPUTextureFormat) const;
    ExceptionOr<Ref<GPUSampler>> createSampler(std::optional<GPUSamplerDescriptor>&&);
    ExceptionOr<Ref<GPUExternalTexture>> importExternalTexture(GPUExternalTextureDescriptor&&);

    ExceptionOr<Ref<GPUBindGroupLayout>> createBindGroupLayout(GPUBindGroupLayoutDescriptor&&);
    ExceptionOr<Ref<GPUPipelineLayout>> createPipelineLayout(GPUPipelineLayoutDescriptor&&);
    ExceptionOr<Ref<GPUBindGroup>> createBindGroup(GPUBindGroupDescriptor&&);

    ExceptionOr<Ref<GPUShaderModule>> createShaderModule(GPUShaderModuleDescriptor&&);
    ExceptionOr<Ref<GPUComputePipeline>> createComputePipeline(UniquelyAnnotatedDescriptor<GPUComputePipelineDescriptor>&&);
    ExceptionOr<Ref<GPURenderPipeline>> createRenderPipeline(UniquelyAnnotatedDescriptor<GPURenderPipelineDescriptor>&&);
    using CreateComputePipelineAsyncPromise = DOMPromiseDeferred<IDLInterface<GPUComputePipeline>>;
    void createComputePipelineAsync(UniquelyAnnotatedDescriptor<GPUComputePipelineDescriptor>&&, CreateComputePipelineAsyncPromise&&);
    using CreateRenderPipelineAsyncPromise = DOMPromiseDeferred<IDLInterface<GPURenderPipeline>>;
    ExceptionOr<void> createRenderPipelineAsync(UniquelyAnnotatedDescriptor<GPURenderPipelineDescriptor>&&, CreateRenderPipelineAsyncPromise&&);

    ExceptionOr<Ref<GPUCommandEncoder>> createCommandEncoder(std::optional<GPUCommandEncoderDescriptor>&&);
    ExceptionOr<Ref<GPURenderBundleEncoder>> createRenderBundleEncoder(GPURenderBundleEncoderDescriptor&&);

    ExceptionOr<Ref<GPUQuerySet>> createQuerySet(GPUQuerySetDescriptor&&);

    void pushErrorScope(GPUErrorFilter);
    using ErrorScopePromise = DOMPromiseDeferred<IDLNullable<IDLUnion<IDLInterface<GPUOutOfMemoryError>, IDLInterface<GPUValidationError>, IDLInterface<GPUInternalError>>>>;
    void popErrorScope(ErrorScopePromise&&);

    bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) override;
    using EventTarget::addEventListener;
    void listenForUncapturedErrors();

    using LostPromise = DOMPromiseProxy<IDLInterface<GPUDeviceLostInfo>>;
    LostPromise& lost() LIFETIME_BOUND;

    ScriptExecutionContext* NODELETE scriptExecutionContext() const final;

    WebGPU::Device& backing() { return m_backing; }
    const WebGPU::Device& backing() const { return m_backing; }
    void removeBufferToUnmap(GPUBuffer&);
    void addBufferToUnmap(GPUBuffer&);
    Ref<GPUAdapterInfo> NODELETE adapterInfo() const;

#if ENABLE(VIDEO)
    WeakPtr<GPUExternalTexture> takeExternalTextureForVideoElement(const HTMLVideoElement&);
#endif

    bool hasActiveInspectorCanvasCallTracer() const { return m_hasActiveInspectorCanvasCallTracer; }
    void setHasActiveInspectorCanvasCallTracer(bool active) { m_hasActiveInspectorCanvasCallTracer = active; }

private:
    GPUDevice(ScriptExecutionContext*, Ref<WebGPU::Device>&&, String&& queueLabel, GPUAdapterInfo&);

    // FIXME: We probably need to override more methods to make this work properly.
    RefPtr<GPUPipelineLayout> createAutoPipelineLayout();

    // EventTarget.
    enum EventTargetInterfaceType eventTargetInterface() const final { return EventTargetInterfaceType::GPUDevice; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    static Lock s_instancesLock;

    const UniqueRef<LostPromise> m_lostPromise;
    const Ref<WebGPU::Device> m_backing;
    const Ref<GPUQueue> m_queue;
    RefPtr<GPUPipelineLayout> m_autoPipelineLayout;
    WeakHashSet<GPUBuffer> m_buffersToUnmap;

#if ENABLE(VIDEO)
    GPUExternalTexture* externalTextureForDescriptor(const GPUExternalTextureDescriptor&);

    WeakHashMap<HTMLVideoElement, WeakPtr<GPUExternalTexture>> m_videoElementToExternalTextureMap;
    std::pair<RefPtr<HTMLVideoElement>, RefPtr<GPUExternalTexture>> m_previouslyImportedExternalTexture;
    std::pair<Vector<GPUBindGroupEntry>, RefPtr<GPUBindGroup>> m_lastCreatedExternalTextureBindGroup;
#endif
    const Ref<GPUSupportedFeatures> m_features;
    const Ref<GPUSupportedLimits> m_limits;
    const Ref<GPUAdapterInfo> m_adapterInfo;
    const uint32_t m_owningThreadUID;

    bool m_waitingForDeviceLostPromise { false };
    bool m_listeningForUncapturedErrors { false };
    bool m_hasActiveInspectorCanvasCallTracer { false };
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_EVENTTARGET(GPUDevice)
