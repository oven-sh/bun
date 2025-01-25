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

#include "ActiveDOMObject.h"
#include "EventTarget.h"
// #include "MessagePort.h"
#include "WorkerOptions.h"
// #include "WorkerScriptLoaderClient.h"
// #include "WorkerType.h"
#include <JavaScriptCore/RuntimeFlags.h>
#include <wtf/Deque.h>
#include <wtf/MonotonicTime.h>
#include <wtf/text/AtomStringHash.h>
#include "ContextDestructionObserver.h"
#include "Event.h"

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
// class WorkerScriptLoader;

struct StructuredSerializeOptions;
struct WorkerOptions;

class Worker final : public ThreadSafeRefCounted<Worker>, public EventTargetWithInlineData, private ContextDestructionObserver {
    WTF_MAKE_ISO_ALLOCATED_EXPORT(Worker, WEBCORE_EXPORT);

public:
    static ExceptionOr<Ref<Worker>> create(ScriptExecutionContext&, const String& url, WorkerOptions&&);
    ~Worker();

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);

    using ThreadSafeRefCounted::deref;
    using ThreadSafeRefCounted::ref;

    void terminate();
    bool wasTerminated() const { return m_terminationFlags & TerminatedFlag; }
    bool hasPendingActivity() const;
    bool updatePtr();

    String identifier() const { return m_identifier; }
    const String& name() const { return m_options.name; }

    void dispatchEvent(Event&);
    void dispatchCloseEvent(Event&);
    void setKeepAlive(bool);

#if ENABLE(WEB_RTC)
    void createRTCRtpScriptTransformer(RTCRtpScriptTransform&, MessageWithMessagePorts&&);
#endif

    // WorkerType type() const
    // {
    //     return m_options.type;
    // }

    void postTaskToWorkerGlobalScope(Function<void(ScriptExecutionContext&)>&&);

    static void forEachWorker(const Function<Function<void(ScriptExecutionContext&)>()>&);

    void drainEvents();
    void dispatchOnline(Zig::GlobalObject* workerGlobalObject);
    void dispatchError(WTF::String message);
    void dispatchExit(int32_t exitCode);
    ScriptExecutionContext* scriptExecutionContext() const final { return ContextDestructionObserver::scriptExecutionContext(); }
    ScriptExecutionContextIdentifier clientIdentifier() const { return m_clientIdentifier; }
    WorkerOptions& options() { return m_options; }

private:
    Worker(ScriptExecutionContext&, WorkerOptions&&);

    EventTargetInterface eventTargetInterface() const final { return WorkerEventTargetInterfaceType; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {};

    // void didReceiveResponse(ResourceLoaderIdentifier, const ResourceResponse&) final;
    // void notifyFinished() final;

    // ActiveDOMObject.
    // void stop() final;
    // void suspend(ReasonForSuspension) final;
    // void resume() final;
    // const char* activeDOMObjectName() const final;
    // bool virtualHasPendingActivity() const final;

    static void networkStateChanged(bool isOnLine);

    static constexpr uint8_t OnlineFlag = 1 << 0;
    static constexpr uint8_t ClosingFlag = 1 << 1;
    static constexpr uint8_t TerminateRequestedFlag = 1 << 0;
    static constexpr uint8_t TerminatedFlag = 1 << 1;

    // RefPtr<WorkerScriptLoader> m_scriptLoader;
    WorkerOptions m_options;
    String m_identifier;
    // WorkerGlobalScopeProxy& m_contextProxy; // The proxy outlives the worker to perform thread shutdown.
    // std::optional<ContentSecurityPolicyResponseHeaders> m_contentSecurityPolicyResponseHeaders;
    MonotonicTime m_workerCreationTime;
    // bool m_shouldBypassMainWorldContentSecurityPolicy { false };
    // bool m_isSuspendedForBackForwardCache { false };
    // JSC::RuntimeFlags m_runtimeFlags;
    Deque<RefPtr<Event>> m_pendingEvents;
    Lock m_pendingTasksMutex;
    Deque<Function<void(ScriptExecutionContext&)>> m_pendingTasks;
    bool m_didStartWorkerGlobalScope { false };
    // Tracks OnlineFlag and ClosingFlag
    std::atomic<uint8_t> m_onlineClosingFlags { 0 };
    // Tracks TerminateRequestedFlag and TerminatedFlag
    std::atomic<uint8_t> m_terminationFlags { 0 };
    const ScriptExecutionContextIdentifier m_clientIdentifier;
    void* impl_ { nullptr };
};

JSValue createNodeWorkerThreadsBinding(Zig::GlobalObject* globalObject);

JSC_DECLARE_HOST_FUNCTION(jsFunctionPostMessage);

} // namespace WebCore
