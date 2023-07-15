/*
 * Copyright (C) 2008, 2010, 2016 Apple Inc. All Rights Reserved.
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

#include "AbstractWorker.h"
#include "ActiveDOMObject.h"
#include "ContentSecurityPolicyResponseHeaders.h"
#include "EventTarget.h"
#include "FetchRequestCredentials.h"
#include "MessagePort.h"
#include "WorkerOptions.h"
#include "WorkerScriptLoaderClient.h"
#include "WorkerType.h"
#include <JavaScriptCore/RuntimeFlags.h>
#include <wtf/Deque.h>
#include <wtf/MonotonicTime.h>
#include <wtf/text/AtomStringHash.h>

namespace JSC {
class CallFrame;
class JSObject;
class JSValue;
}

namespace WebCore {

class RTCRtpScriptTransform;
class RTCRtpScriptTransformer;
class ScriptExecutionContext;
class WorkerGlobalScopeProxy;
class WorkerScriptLoader;

struct StructuredSerializeOptions;
struct WorkerOptions;

class Worker final : public AbstractWorker, public ActiveDOMObject, private WorkerScriptLoaderClient {
    WTF_MAKE_ISO_ALLOCATED(Worker);
public:
    static ExceptionOr<Ref<Worker>> create(ScriptExecutionContext&, JSC::RuntimeFlags, const String& url, WorkerOptions&&);
    virtual ~Worker();

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);

    void terminate();
    bool wasTerminated() const { return m_wasTerminated; }

    String identifier() const { return m_identifier; }
    const String& name() const { return m_options.name; }

    ScriptExecutionContext* scriptExecutionContext() const final { return ActiveDOMObject::scriptExecutionContext(); }

    void dispatchEvent(Event&) final;

#if ENABLE(WEB_RTC)
    void createRTCRtpScriptTransformer(RTCRtpScriptTransform&, MessageWithMessagePorts&&);
#endif

    WorkerType type() const { return m_options.type; }

    void postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&&);

    static void forEachWorker(const Function<Function<void(ScriptExecutionContext&)>()>&);

private:
    Worker(ScriptExecutionContext&, JSC::RuntimeFlags, WorkerOptions&&);

    EventTargetInterface eventTargetInterface() const final { return WorkerEventTargetInterfaceType; }

    void didReceiveResponse(ResourceLoaderIdentifier, const ResourceResponse&) final;
    void notifyFinished() final;

    // ActiveDOMObject.
    void stop() final;
    void suspend(ReasonForSuspension) final;
    void resume() final;
    const char* activeDOMObjectName() const final;
    bool virtualHasPendingActivity() const final;

    static void networkStateChanged(bool isOnLine);

    RefPtr<WorkerScriptLoader> m_scriptLoader;
    const WorkerOptions m_options;
    String m_identifier;
    WorkerGlobalScopeProxy& m_contextProxy; // The proxy outlives the worker to perform thread shutdown.
    std::optional<ContentSecurityPolicyResponseHeaders> m_contentSecurityPolicyResponseHeaders;
    MonotonicTime m_workerCreationTime;
    bool m_shouldBypassMainWorldContentSecurityPolicy { false };
    bool m_isSuspendedForBackForwardCache { false };
    JSC::RuntimeFlags m_runtimeFlags;
    Deque<RefPtr<Event>> m_pendingEvents;
    bool m_wasTerminated { false };
    bool m_didStartWorkerGlobalScope { false };
    const ScriptExecutionContextIdentifier m_clientIdentifier;
};

} // namespace WebCore
