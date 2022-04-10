/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
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
 *
 */

#pragma once

#include "ActiveDOMObject.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include "MessagePortChannel.h"
#include "MessagePortIdentifier.h"
#include "MessageWithMessagePorts.h"
#include <wtf/WeakPtr.h>

namespace JSC {
class CallFrame;
class JSObject;
class JSValue;
}

namespace WebCore {

class Frame;

struct StructuredSerializeOptions;

class MessagePort final : public ActiveDOMObject, public EventTargetWithInlineData {
    WTF_MAKE_NONCOPYABLE(MessagePort);
    WTF_MAKE_ISO_ALLOCATED(MessagePort);
public:
    static Ref<MessagePort> create(ScriptExecutionContext&, const MessagePortIdentifier& local, const MessagePortIdentifier& remote);
    virtual ~MessagePort();

    ExceptionOr<void> postMessage(JSC::JSGlobalObject&, JSC::JSValue message, StructuredSerializeOptions&&);

    void start();
    void close();
    void entangle();

    // Returns nullptr if the passed-in vector is empty.
    static ExceptionOr<Vector<TransferredMessagePort>> disentanglePorts(Vector<RefPtr<MessagePort>>&&);
    static Vector<RefPtr<MessagePort>> entanglePorts(ScriptExecutionContext&, Vector<TransferredMessagePort>&&);

    WEBCORE_EXPORT static bool isExistingMessagePortLocallyReachable(const MessagePortIdentifier&);
    WEBCORE_EXPORT static void notifyMessageAvailable(const MessagePortIdentifier&);

    WEBCORE_EXPORT void messageAvailable();
    bool started() const { return m_started; }
    bool closed() const { return m_closed; }

    void dispatchMessages();

    // Returns null if there is no entangled port, or if the entangled port is run by a different thread.
    // This is used solely to enable a GC optimization. Some platforms may not be able to determine ownership
    // of the remote port (since it may live cross-process) - those platforms may always return null.
    MessagePort* locallyEntangledPort() const;

    const MessagePortIdentifier& identifier() const { return m_identifier; }
    const MessagePortIdentifier& remoteIdentifier() const { return m_remoteIdentifier; }

    WEBCORE_EXPORT void ref() const;
    WEBCORE_EXPORT void deref() const;

    WEBCORE_EXPORT bool isLocallyReachable() const;

    // EventTargetWithInlineData.
    EventTargetInterface eventTargetInterface() const final { return MessagePortEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return ActiveDOMObject::scriptExecutionContext(); }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    void dispatchEvent(Event&) final;

    TransferredMessagePort disentangle();
    static Ref<MessagePort> entangle(ScriptExecutionContext&, TransferredMessagePort&&);

private:
    explicit MessagePort(ScriptExecutionContext&, const MessagePortIdentifier& local, const MessagePortIdentifier& remote);

    bool addEventListener(const AtomString& eventType, Ref<EventListener>&&, const AddEventListenerOptions&) final;
    bool removeEventListener(const AtomString& eventType, EventListener&, const EventListenerOptions&) final;

    // ActiveDOMObject
    const char* activeDOMObjectName() const final;
    void contextDestroyed() final;
    void stop() final { close(); }
    bool virtualHasPendingActivity() const final;

    void registerLocalActivity();

    // A port starts out its life entangled, and remains entangled until it is closed or is cloned.
    bool isEntangled() const { return !m_closed && m_entangled; }

    void updateActivity(MessagePortChannelProvider::HasActivity);

    bool m_started { false };
    bool m_closed { false };
    bool m_entangled { true };

    // Flags to manage querying the remote port for GC purposes
    mutable bool m_mightBeEligibleForGC { false };
    mutable bool m_hasHadLocalActivitySinceLastCheck { false };
    mutable bool m_isRemoteEligibleForGC { false };
    mutable bool m_isAskingRemoteAboutGC { false };
    bool m_hasMessageEventListener { false };

    MessagePortIdentifier m_identifier;
    MessagePortIdentifier m_remoteIdentifier;

    mutable std::atomic<unsigned> m_refCount { 1 };
};

} // namespace WebCore
