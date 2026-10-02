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
#include "ExceptionOr.h"
#include "WorkerMessagingProxy.h"
#include <wtf/RefCounted.h>

namespace JSC {
class JSGlobalObject;
class JSValue;
}

namespace WebCore {

class ScriptExecutionContext;
struct StructuredSerializeOptions;
struct WorkerOptions;

// The script-visible Worker object. Lives entirely on the thread that constructed it; everything
// that involves the worker thread goes through m_contextProxy.
class Worker final : public RefCounted<Worker>, public EventTargetWithInlineData, public ActiveDOMObject {
    WTF_MAKE_TZONE_ALLOCATED(Worker);

public:
    static ExceptionOr<Ref<Worker>> create(ScriptExecutionContext&, const String& url, WorkerOptions&&);
    ~Worker();

    // ActiveDOMObject.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }
    USING_CAN_MAKE_WEAKPTR(EventTargetWithInlineData);

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);
    void terminate();
    // terminate() was called or the thread has gone; the object dispatches nothing further.
    bool wasTerminated() const { return m_wasTerminated || m_contextProxy->isClosingOrClosed(); }
    // The thread has exited (or never started). threadId reads -1 from here on, as in Node.
    bool hasExited() const { return m_contextProxy->isClosingOrClosed(); }
    bool isOnline() const { return m_contextProxy->isOnline(); }
    void setKeepAlive(bool);

    // Node worker_threads: 'message'/'error'/'messageerror' are not delivered once terminate() was
    // called; 'close' (which carries the exit code) always is.
    void dispatchEvent(Event&) final;
    void dispatchCloseEvent(Event&);

    const String& name() const { return m_name; }
    // Both identifiers are process-unique; threadId is derived from the worker's.
    ScriptExecutionContextIdentifier clientIdentifier() const { return m_contextProxy->workerContextIdentifier(); }
    WorkerMessagingProxy& contextProxy() { return m_contextProxy.get(); }

    ScriptExecutionContext* scriptExecutionContext() const final { return ActiveDOMObject::scriptExecutionContext(); }

private:
    Worker(ScriptExecutionContext&, WorkerOptions&&);

    EventTargetInterface eventTargetInterface() const final { return WorkerEventTargetInterfaceType; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {};

    // ActiveDOMObject.
    void stop() final;
    bool virtualHasPendingActivity() const final;

    const String m_name;
    const Ref<WorkerMessagingProxy> m_contextProxy;
    bool m_wasTerminated { false };
};

JSC::JSValue createNodeWorkerThreadsBinding(Zig::GlobalObject* globalObject);

JSC_DECLARE_HOST_FUNCTION(jsFunctionPostMessage);
JSC_DECLARE_HOST_FUNCTION(jsFunctionMarkAsUncloneable);

} // namespace WebCore
