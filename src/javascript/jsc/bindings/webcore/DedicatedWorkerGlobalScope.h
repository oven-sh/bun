/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "MessagePort.h"
#include "WorkerGlobalScope.h"

namespace JSC {
class CallFrame;
class JSObject;
class JSValue;
}

namespace WebCore {

class ContentSecurityPolicyResponseHeaders;
class DedicatedWorkerThread;
class JSRTCRtpScriptTransformerConstructor;
class RTCRtpScriptTransformer;
class RequestAnimationFrameCallback;
class SerializedScriptValue;

struct StructuredSerializeOptions;

#if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
class WorkerAnimationController;

using CallbackId = int;
#endif

using TransferredMessagePort = std::pair<WebCore::MessagePortIdentifier, WebCore::MessagePortIdentifier>;

class DedicatedWorkerGlobalScope final : public WorkerGlobalScope {
    WTF_MAKE_ISO_ALLOCATED(DedicatedWorkerGlobalScope);

public:
    static Ref<DedicatedWorkerGlobalScope> create(const WorkerParameters&, Ref<SecurityOrigin>&&, DedicatedWorkerThread&, Ref<SecurityOrigin>&& topOrigin, IDBClient::IDBConnectionProxy*, SocketProvider*);
    virtual ~DedicatedWorkerGlobalScope();

    const String& name() const { return m_name; }

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);

    DedicatedWorkerThread& thread();

    // #if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
    //     CallbackId requestAnimationFrame(Ref<RequestAnimationFrameCallback>&&);
    //     void cancelAnimationFrame(CallbackId);
    // #endif

    // #if ENABLE(WEB_RTC)
    //     RefPtr<RTCRtpScriptTransformer> createRTCRtpScriptTransformer(MessageWithMessagePorts&&);
    // #endif

    FetchOptions::Destination destination() const final { return FetchOptions::Destination::Worker; }

private:
    using Base = WorkerGlobalScope;

    DedicatedWorkerGlobalScope(const WorkerParameters&, Ref<SecurityOrigin>&&, DedicatedWorkerThread&, Ref<SecurityOrigin>&& topOrigin, IDBClient::IDBConnectionProxy*, SocketProvider*);

    Type type() const final { return Type::DedicatedWorker; }

    ExceptionOr<void> importScripts(const FixedVector<String>& urls) final;
    EventTargetInterface eventTargetInterface() const final;

    void prepareForDestruction() final;

    String m_name;

    // #if ENABLE(OFFSCREEN_CANVAS_IN_WORKERS)
    //     RefPtr<WorkerAnimationController> m_workerAnimationController;
    // #endif
};

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::DedicatedWorkerGlobalScope)
static bool isType(const WebCore::ScriptExecutionContext& context) { return is<WebCore::WorkerGlobalScope>(context) && downcast<WebCore::WorkerGlobalScope>(context).type() == WebCore::WorkerGlobalScope::Type::DedicatedWorker; }
static bool isType(const WebCore::WorkerGlobalScope& context) { return context.type() == WebCore::WorkerGlobalScope::Type::DedicatedWorker; }
SPECIALIZE_TYPE_TRAITS_END()
