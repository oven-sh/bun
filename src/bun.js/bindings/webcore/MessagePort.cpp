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
#include "EventNames.h"
#include "MessageEvent.h"
#include "MessagePortPipe.h"
#include "MessageWithMessagePorts.h"
#include "StructuredSerializeOptions.h"
#include "WebCoreOpaqueRoot.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MessagePort);

Ref<MessagePort> MessagePort::create(ScriptExecutionContext& context, Ref<MessagePortPipe>&& pipe, uint8_t side)
{
    return adoptRef(*new MessagePort(context, WTF::move(pipe), side));
}

MessagePort::MessagePort(ScriptExecutionContext& context, Ref<MessagePortPipe>&& pipe, uint8_t side)
    : ContextDestructionObserver(&context)
    , m_pipe(WTF::move(pipe))
    , m_side(side)
{
    // The WeakPtrFactory must be initialized on the owning thread.
    initializeWeakPtrFactory();
}

MessagePort::~MessagePort()
{
    if (m_pipe && !m_isDetached)
        m_pipe->close(m_side);
}

ExceptionOr<void> MessagePort::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    Vector<RefPtr<MessagePort>> ports;
    auto messageData = SerializedScriptValue::create(state, messageValue, WTF::move(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (messageData.hasException())
        return messageData.releaseException();

    if (!isEntangled())
        return {};

    Vector<TransferredMessagePort> transferredPorts;
    if (!ports.isEmpty()) {
        // A port may not be posted through itself or its own entangled peer.
        for (auto& port : ports) {
            if (port->pipe() == m_pipe.get())
                return Exception { DataCloneError };
        }
        auto disentangled = MessagePort::disentanglePorts(WTF::move(ports));
        if (disentangled.hasException())
            return disentangled.releaseException();
        transferredPorts = disentangled.releaseReturnValue();
    }

    m_pipe->send(m_side, MessageWithMessagePorts { messageData.releaseReturnValue(), WTF::move(transferredPorts) });
    return {};
}

void MessagePort::start()
{
    if (m_started || !isEntangled())
        return;
    m_started = true;

    auto* context = scriptExecutionContext();
    ASSERT(context);
    // From the pipe's point of view "attached" means "ready to have drains
    // scheduled on my behalf" — that is exactly what start() promises.
    m_pipe->attach(m_side, context->identifier(), ThreadSafeWeakPtr<MessagePort> { *this });
}

void MessagePort::close()
{
    if (m_isDetached)
        return;
    m_isDetached = true;

    if (m_pipe)
        m_pipe->close(m_side);
    m_pipe = nullptr;

    removeAllEventListeners();
}

TransferredMessagePort MessagePort::disentangle()
{
    ASSERT(isEntangled());

    // Drop any message listeners (and the event-loop ref they carry) while
    // this port is still attached to its context; after observeContext(null)
    // there would be nothing to unref.
    removeAllEventListeners();
    m_hasMessageEventListener = false;

    // Release the pipe to its next owner. Messages that arrive while in
    // transit buffer in the pipe; the receiving context's entangle() call
    // re-attaches and flushes them.
    m_pipe->detach(m_side);
    auto pipe = std::exchange(m_pipe, nullptr);
    m_isDetached = true;
    m_started = false;

    if (auto* context = scriptExecutionContext())
        context->willDestroyDestructionObserver(*this);
    observeContext(nullptr);

    return TransferredMessagePort { WTF::move(pipe), m_side };
}

Ref<MessagePort> MessagePort::entangle(ScriptExecutionContext& context, TransferredMessagePort&& transferred)
{
    ASSERT(transferred.pipe);
    auto port = MessagePort::create(context, transferred.pipe.releaseNonNull(), transferred.side);
    // Only transferred ports ref the event loop on message-listener
    // add/remove; ports that were never transferred (both ends of a local
    // MessageChannel) don't hold the process open.
    port->onDidChangeListener = &MessagePort::onDidChangeListenerImpl;
    return port;
}

void MessagePort::dispatchOneMessage(ScriptExecutionContext& context, MessageWithMessagePorts&& message)
{
    if (m_isDetached || !context.globalObject())
        return;

    auto* globalObject = defaultGlobalObject(context.globalObject());
    Ref vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (Zig::GlobalObject::scriptExecutionStatus(globalObject, globalObject) != ScriptExecutionStatus::Running)
        return;

    auto ports = MessagePort::entanglePorts(context, WTF::move(message.transferredPorts));
    if (scope.exception()) [[unlikely]] {
        RELEASE_ASSERT(vm->hasPendingTerminationException());
        return;
    }

    auto event = MessageEvent::create(*context.jsGlobalObject(), message.message.releaseNonNull(), {}, {}, {}, WTF::move(ports));
    dispatchEvent(event.event);
}

JSValue MessagePort::tryTakeMessage(JSGlobalObject* lexicalGlobalObject)
{
    if (!isEntangled())
        return jsUndefined();

    auto* context = scriptExecutionContext();
    if (!context)
        return jsUndefined();

    auto message = m_pipe->takeOne(m_side);
    if (!message)
        return jsUndefined();

    auto ports = MessagePort::entanglePorts(*context, WTF::move(message->transferredPorts));
    return message->message.releaseNonNull()->deserialize(*lexicalGlobalObject, lexicalGlobalObject, WTF::move(ports), SerializationErrorMode::NonThrowing);
}

void MessagePort::dispatchEvent(Event& event)
{
    if (m_isDetached)
        return;
    EventTarget::dispatchEvent(event);
}

void MessagePort::contextDestroyed()
{
    close();
}

bool MessagePort::hasPendingActivity() const
{
    // Called from the GC thread; must be lockless.
    if (!scriptExecutionContext() || m_isDetached || !m_pipe)
        return false;
    if (!m_hasMessageEventListener)
        return false;

    uint64_t s = m_pipe->state(m_side);
    // Keep alive if there are messages already queued for us, or the peer
    // is still open and could send more.
    return MessagePortPipe::queuedCount(s) > 0 || m_pipe->isOtherSideOpen(m_side);
}

ExceptionOr<Vector<TransferredMessagePort>> MessagePort::disentanglePorts(Vector<RefPtr<MessagePort>>&& ports)
{
    if (ports.isEmpty())
        return Vector<TransferredMessagePort> {};

    HashSet<MessagePort*> seen;
    for (auto& port : ports) {
        if (!port || !port->isEntangled() || !seen.add(port.get()).isNewEntry)
            return Exception { DataCloneError };
    }

    return WTF::map(ports, [](auto& port) {
        return port->disentangle();
    });
}

Vector<RefPtr<MessagePort>> MessagePort::entanglePorts(ScriptExecutionContext& context, Vector<TransferredMessagePort>&& transferred)
{
    if (transferred.isEmpty())
        return {};

    return WTF::map(WTF::move(transferred), [&](TransferredMessagePort&& port) -> RefPtr<MessagePort> {
        return MessagePort::entangle(context, WTF::move(port));
    });
}

void MessagePort::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType != eventNames().messageEvent)
        return;

    auto& port = static_cast<MessagePort&>(self);
    auto* context = port.scriptExecutionContext();
    switch (kind) {
    case Add:
        if (port.m_messageEventCount == 0 && context)
            context->refEventLoop();
        port.m_messageEventCount++;
        break;
    case Remove:
        port.m_messageEventCount--;
        if (port.m_messageEventCount == 0 && context)
            context->unrefEventLoop();
        break;
    case Clear:
        if (port.m_messageEventCount > 0 && context)
            context->unrefEventLoop();
        port.m_messageEventCount = 0;
        break;
    }
}

bool MessagePort::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (eventType == eventNames().messageEvent) {
        start();
        m_hasMessageEventListener = true;
    }
    return EventTarget::addEventListener(eventType, WTF::move(listener), options);
}

bool MessagePort::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto result = EventTarget::removeEventListener(eventType, listener, options);
    if (!hasEventListeners(eventNames().messageEvent))
        m_hasMessageEventListener = false;
    return result;
}

WebCoreOpaqueRoot root(MessagePort* port)
{
    return WebCoreOpaqueRoot { port };
}

void MessagePort::jsRef(JSGlobalObject* lexicalGlobalObject)
{
    if (!m_hasRef) {
        m_hasRef = true;
        ref();
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, 1);
    }
}

void MessagePort::jsUnref(JSGlobalObject* lexicalGlobalObject)
{
    if (m_hasRef) {
        m_hasRef = false;
        deref();
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, -1);
    }
}

} // namespace WebCore
