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

#include "config.h"
#include "MessagePort.h"

#include "BunClientData.h"
// #include "Document.h"
#include "EventNames.h"
// #include "Logging.h"
#include "MessageEvent.h"
#include "BunWorkerGlobalScope.h"
#include "MessagePortChannelProvider.h"
#include "MessageWithMessagePorts.h"
#include "StructuredSerializeOptions.h"
#include "WebCoreOpaqueRoot.h"
// #include "WorkerGlobalScope.h"
// #include "WorkerThread.h"
#include "TaskSource.h"
#include <wtf/CompletionHandler.h>
#include <wtf/IsoMallocInlines.h>
#include <wtf/Lock.h>
#include <wtf/Scope.h>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(MessagePort);

static Lock allMessagePortsLock;
static HashMap<MessagePortIdentifier, MessagePort*>& allMessagePorts() WTF_REQUIRES_LOCK(allMessagePortsLock)
{
    static NeverDestroyed<HashMap<MessagePortIdentifier, MessagePort*>> map;
    return map;
}

static HashMap<MessagePortIdentifier, ScriptExecutionContextIdentifier>& portToContextIdentifier() WTF_REQUIRES_LOCK(allMessagePortsLock)
{
    static NeverDestroyed<HashMap<MessagePortIdentifier, ScriptExecutionContextIdentifier>> map;
    return map;
}

void MessagePort::ref() const
{
    ++m_refCount;
}

void MessagePort::deref() const
{
    // This custom deref() function ensures that as long as the lock to allMessagePortsLock is taken, no MessagePort will be destroyed.
    // This allows notifyMessageAvailable to easily query the map and manipulate MessagePort instances.

    if (!--m_refCount) {
        Locker locker { allMessagePortsLock };

        if (m_refCount)
            return;

        auto iterator = allMessagePorts().find(m_identifier);
        if (iterator != allMessagePorts().end() && iterator->value == this) {
            allMessagePorts().remove(iterator);
            portToContextIdentifier().remove(m_identifier);
        }

        delete this;
    }
}

bool MessagePort::hasPendingActivity() const
{
    return m_refCount > 0;
}

bool MessagePort::isMessagePortAliveForTesting(const MessagePortIdentifier& identifier)
{
    Locker locker { allMessagePortsLock };
    return allMessagePorts().contains(identifier);
}

ScriptExecutionContextIdentifier MessagePort::contextIdForMessagePortId(MessagePortIdentifier messagePortId)
{
    Locker locker { allMessagePortsLock };
    return portToContextIdentifier().get(messagePortId);
}

void MessagePort::notifyMessageAvailable(const MessagePortIdentifier& identifier)
{
    ScriptExecutionContextIdentifier scriptExecutionContextIdentifier;
    {
        Locker locker { allMessagePortsLock };
        scriptExecutionContextIdentifier = portToContextIdentifier().get(identifier);
    }
    if (!scriptExecutionContextIdentifier)
        return;

    ScriptExecutionContext::ensureOnContextThread(scriptExecutionContextIdentifier, [identifier](auto&) {
        RefPtr<MessagePort> port;
        {
            Locker locker { allMessagePortsLock };
            port = allMessagePorts().get(identifier);
        }
        if (port)
            port->messageAvailable();
    });
}

Ref<MessagePort> MessagePort::create(ScriptExecutionContext& scriptExecutionContext, const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
{
    auto messagePort = adoptRef(*new MessagePort(scriptExecutionContext, local, remote));
    // messagePort->suspendIfNeeded();
    return messagePort;
}

MessagePort::MessagePort(ScriptExecutionContext& scriptExecutionContext, const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
    // : ActiveDOMObject(&scriptExecutionContext)
    : ContextDestructionObserver(&scriptExecutionContext)
    , m_identifier(local)
    , m_remoteIdentifier(remote)
{
    // LOG(MessagePorts, "Created MessagePort %s (%p) in process %" PRIu64, m_identifier.logString().utf8().data(), this, ProcessIdent::identifier().toUInt64());

    Locker locker { allMessagePortsLock };
    allMessagePorts().set(m_identifier, this);
    portToContextIdentifier().set(m_identifier, scriptExecutionContext.identifier());

    // Make sure the WeakPtrFactory gets initialized eagerly on the thread the MessagePort gets constructed on for thread-safety reasons.
    initializeWeakPtrFactory();

    scriptExecutionContext.createdMessagePort(*this);

    // Don't need to call processMessageWithMessagePortsSoon() here, because the port will not be opened until start() is invoked.
}

MessagePort::~MessagePort()
{
    // LOG(MessagePorts, "Destroyed MessagePort %s (%p) in process %" PRIu64, m_identifier.logString().utf8().data(), this, ProcessIdent::identifier().toUInt64());

    ASSERT(allMessagePortsLock.isLocked());

    if (m_entangled)
        close();

    if (auto contextId = portToContextIdentifier().get(m_identifier))
        ScriptExecutionContext::getScriptExecutionContext(contextId)->destroyedMessagePort(*this);
}

void MessagePort::entangle()
{
    MessagePortChannelProvider::fromContext(*scriptExecutionContext()).entangleLocalPortInThisProcessToRemote(m_identifier, m_remoteIdentifier);
}

ExceptionOr<void> MessagePort::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    // LOG(MessagePorts, "Attempting to post message to port %s (to be received by port %s)", m_identifier.logString().utf8().data(), m_remoteIdentifier.logString().utf8().data());

    Vector<RefPtr<MessagePort>> ports;
    auto messageData = SerializedScriptValue::create(state, messageValue, WTFMove(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (messageData.hasException())
        return messageData.releaseException();

    if (!isEntangled())
        return {};
    ASSERT(scriptExecutionContext());

    Vector<TransferredMessagePort> transferredPorts;
    // Make sure we aren't connected to any of the passed-in ports.
    if (!ports.isEmpty()) {
        for (auto& port : ports) {
            if (port->identifier() == m_identifier || port->identifier() == m_remoteIdentifier)
                return Exception { DataCloneError };
        }

        auto disentangleResult = MessagePort::disentanglePorts(WTFMove(ports));
        if (disentangleResult.hasException())
            return disentangleResult.releaseException();
        transferredPorts = disentangleResult.releaseReturnValue();
    }

    MessageWithMessagePorts message { messageData.releaseReturnValue(), WTFMove(transferredPorts) };

    // LOG(MessagePorts, "Actually posting message to port %s (to be received by port %s)", m_identifier.logString().utf8().data(), m_remoteIdentifier.logString().utf8().data());

    ScriptExecutionContextIdentifier contextId = contextIdForMessagePortId(m_remoteIdentifier);

    MessagePortChannelProvider::fromContext(*ScriptExecutionContext::getScriptExecutionContext(contextId)).postMessageToRemote(WTFMove(message), m_remoteIdentifier);

    return {};
}

TransferredMessagePort MessagePort::disentangle()
{
    ASSERT(m_entangled);
    m_entangled = false;

    auto& context = *scriptExecutionContext();
    MessagePortChannelProvider::fromContext(context).messagePortDisentangled(m_identifier);

    // We can't receive any messages or generate any events after this, so remove ourselves from the list of active ports.
    context.destroyedMessagePort(*this);
    // context.willDestroyActiveDOMObject(*this);
    context.willDestroyDestructionObserver(*this);

    observeContext(nullptr);

    return { identifier(), remoteIdentifier() };
}

// Invoked to notify us that there are messages available for this port.
// This code may be called from another thread, and so should not call any non-threadsafe APIs (i.e. should not call into the entangled channel or access mutable variables).
void MessagePort::messageAvailable()
{
    // This MessagePort object might be disentangled because the port is being transferred,
    // in which case we'll notify it that messages are available once a new end point is created.
    auto* context = scriptExecutionContext();
    if (!context || context->activeDOMObjectsAreSuspended())
        return;

    context->processMessageWithMessagePortsSoon([pendingActivity = Ref { *this }] {});
}

void MessagePort::start()
{
    // Do nothing if we've been cloned or closed.
    if (!isEntangled())
        return;

    ASSERT(scriptExecutionContext());
    if (m_started)
        return;

    m_started = true;
    scriptExecutionContext()->processMessageWithMessagePortsSoon([pendingActivity = Ref { *this }] {});
}

void MessagePort::close()
{
    if (m_isDetached)
        return;
    m_isDetached = true;

    MessagePortChannelProvider::singleton().messagePortClosed(m_identifier);

    removeAllEventListeners();
}

void MessagePort::dispatchMessages()
{
    // Messages for contexts that are not fully active get dispatched too, but JSAbstractEventListener::handleEvent() doesn't call handlers for these.
    // The HTML5 spec specifies that any messages sent to a document that is not fully active should be dropped, so this behavior is OK.
    ASSERT(started());

    auto* context = scriptExecutionContext();
    if (!context || context->activeDOMObjectsAreSuspended() || !isEntangled())
        return;

    auto messagesTakenHandler = [this, protectedThis = Ref { *this }](Vector<MessageWithMessagePorts>&& messages, CompletionHandler<void()>&& completionCallback) mutable {
        auto scopeExit = makeScopeExit(WTFMove(completionCallback));

        // LOG(MessagePorts, "MessagePort %s (%p) dispatching %zu messages", m_identifier.logString().utf8().data(), this, messages.size());

        auto* context = scriptExecutionContext();
        if (!context || !context->jsGlobalObject())
            return;

        // ASSERT(context->isContextThread());

        // bool contextIsWorker = is<WorkerGlobalScope>(*context);
        for (auto& message : messages) {
            // close() in Worker onmessage handler should prevent next message from dispatching.
            // if (contextIsWorker && downcast<WorkerGlobalScope>(*context).isClosing())
            //     return;

            auto ports = MessagePort::entanglePorts(*context, WTFMove(message.transferredPorts));

            // Per specification, each MessagePort object has a task source called the port message queue.
            // queueTaskKeepingObjectAlive(context, *this, TaskSource::PostedMessageQueue, [this, event = WTFMove(event)] {
            //     dispatchEvent(event.event);
            // });

            ScriptExecutionContext::postTaskTo(contextIdForMessagePortId(m_identifier), [protectedThis = Ref { *this }, ports = WTFMove(ports), message = WTFMove(message)](ScriptExecutionContext& context) mutable {
                auto event = MessageEvent::create(*context.jsGlobalObject(), message.message.releaseNonNull(), {}, {}, {}, WTFMove(ports));
                protectedThis->dispatchEvent(event.event);
            });
        }
    };

    MessagePortChannelProvider::fromContext(*context).takeAllMessagesForPort(m_identifier, WTFMove(messagesTakenHandler));
}

JSValue MessagePort::tryTakeMessage(JSGlobalObject* lexicalGlobalObject)
{
    auto* context = scriptExecutionContext();
    if (!context || context->activeDOMObjectsAreSuspended() || !isEntangled())
        return jsUndefined();

    std::optional<MessageWithMessagePorts> messageWithPorts = MessagePortChannelProvider::fromContext(*context).tryTakeMessageForPort(m_identifier);

    if (!messageWithPorts)
        return jsUndefined();

    auto ports = MessagePort::entanglePorts(*context, WTFMove(messageWithPorts->transferredPorts));
    auto message = messageWithPorts->message.releaseNonNull();
    return message->deserialize(*lexicalGlobalObject, lexicalGlobalObject, WTFMove(ports), SerializationErrorMode::NonThrowing);
}

void MessagePort::dispatchEvent(Event& event)
{
    if (m_isDetached) {
        return;
    }

    // auto* context = scriptExecutionContext();
    // if (is<WebCore::GlobalScope>(*context) && downcast<WebCore::GlobalScope>(*context).isClosing())
    //     return;

    EventTarget::dispatchEvent(event);
}

// https://html.spec.whatwg.org/multipage/web-messaging.html#ports-and-garbage-collection
// bool MessagePort::virtualHasPendingActivity() const
// {
//     // If the ScriptExecutionContext has been shut down on this object close()'ed, we can GC.
//     auto* context = scriptExecutionContext();
//     if (!context || m_isDetached)
//         return false;

//     // If this MessagePort has no message event handler then there is no point in keeping it alive.
//     if (!m_hasMessageEventListener)
//         return false;

//     return m_entangled;
// }

MessagePort* MessagePort::locallyEntangledPort()
{
    // FIXME: As the header describes, this is an optional optimization.
    // Even in the new async model we should be able to get it right.
    return nullptr;
}

ExceptionOr<Vector<TransferredMessagePort>> MessagePort::disentanglePorts(Vector<RefPtr<MessagePort>>&& ports)
{
    if (ports.isEmpty())
        return Vector<TransferredMessagePort> {};

    // Walk the incoming array - if there are any duplicate ports, or null ports or cloned ports, throw an error (per section 8.3.3 of the HTML5 spec).
    HashSet<MessagePort*> portSet;
    for (auto& port : ports) {
        if (!port || !port->m_entangled || !portSet.add(port.get()).isNewEntry)
            return Exception { DataCloneError };
    }

    // Passed-in ports passed validity checks, so we can disentangle them.
    return WTF::map(ports, [](auto& port) {
        return port->disentangle();
    });
}

Vector<RefPtr<MessagePort>> MessagePort::entanglePorts(ScriptExecutionContext& context, Vector<TransferredMessagePort>&& transferredPorts)
{
    // LOG(MessagePorts, "Entangling %zu transferred ports to ScriptExecutionContext %s (%p)", transferredPorts.size(), context.url().string().utf8().data(), &context);

    if (transferredPorts.isEmpty())
        return {};

    return WTF::map(transferredPorts, [&](auto& port) -> RefPtr<MessagePort> {
        return MessagePort::entangle(context, WTFMove(port));
    });
}

void MessagePort::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& port = static_cast<MessagePort&>(self);
        switch (kind) {
        case Add:
            if (port.m_messageEventCount == 0) {
                port.scriptExecutionContext()->refEventLoop();
            }
            port.m_messageEventCount++;
            break;
        case Remove:
            port.m_messageEventCount--;
            if (port.m_messageEventCount == 0) {
                port.scriptExecutionContext()->unrefEventLoop();
            }
            break;
        case Clear:
            if (port.m_messageEventCount > 0) {
                port.scriptExecutionContext()->unrefEventLoop();
            }
            port.m_messageEventCount = 0;
            break;
        }
    }
};

Ref<MessagePort> MessagePort::entangle(ScriptExecutionContext& context, TransferredMessagePort&& transferredPort)
{
    auto port = MessagePort::create(context, transferredPort.first, transferredPort.second);
    port->entangle();
    port->onDidChangeListener = &MessagePort::onDidChangeListenerImpl;
    return port;
}

bool MessagePort::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (eventType == eventNames().messageEvent) {
        if (listener->isAttribute())
            start();
        m_hasMessageEventListener = true;
    }
    return EventTarget::addEventListener(eventType, WTFMove(listener), options);
}

bool MessagePort::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto result = EventTarget::removeEventListener(eventType, listener, options);

    if (!hasEventListeners(eventNames().messageEvent))
        m_hasMessageEventListener = false;

    return result;
}

// const char* MessagePort::activeDOMObjectName() const
// {
//     return "MessagePort";
// }

WebCoreOpaqueRoot root(MessagePort* port)
{
    return WebCoreOpaqueRoot { port };
}

void MessagePort::jsRef(JSGlobalObject* lexicalGlobalObject)
{
    if (!m_hasRef) {
        m_hasRef = true;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, 1);
    }
}

void MessagePort::jsUnref(JSGlobalObject* lexicalGlobalObject)
{
    if (m_hasRef) {
        m_hasRef = false;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, -1);
    }
}

} // namespace WebCore
