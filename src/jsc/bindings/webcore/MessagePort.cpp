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
#include "Event.h"
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
    if (!m_isDetached)
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
            if (port->pipe() == m_pipe.ptr())
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

    // m_pipe is held for the port's whole lifetime (the GC thread reads it in
    // hasPendingActivity()); marking our side Closed is sufficient. Record
    // whether this is an explicit script close() so the peer only fires its
    // 'close' for that, not for a GC/teardown/drop close (which would make
    // non-script death observable from JS).
    bool byScript = canRunScript();
    m_pipe->close(m_side, byScript);

    // Wake the entangled peer so it can fire its own 'close' event after
    // draining any queued messages — only for a real close() from script.
    // contextDestroyed() during teardown and ~MessagePort (which calls the pipe
    // directly, bypassing this method) leave it un-woken, so the peer is
    // neither woken nor pinned waiting for a close that will never come.
    if (byScript)
        m_pipe->wakePeerForClose(m_side);

    // Fire our own 'close' event asynchronously (Node + HTML semantics), then
    // tear down listeners. If JS can't run (context teardown) tear down
    // synchronously as before. scheduleCloseEvent() takes its own strong ref,
    // so it is safe to run before releasing m_hasRef.
    bool scheduledClose = scheduleCloseEvent();

    // Release the self-reference taken by jsRef() (set when .onmessage is
    // assigned or .ref() is called from JS). The JS .close() binding calls
    // jsUnref() first, so m_hasRef is already false on that path; we only
    // reach this branch when close() runs without a preceding jsUnref() —
    // most importantly from contextDestroyed() during Worker teardown.
    // Without this, the self-ref pins the MessagePort past the JS wrapper
    // sweep and it leaks forever.
    if (m_hasRef) {
        m_hasRef = false;
        if (auto* context = scriptExecutionContext())
            context->unrefEventLoop();
        deref();
    }

    if (!scheduledClose) {
        // No 'close' task could be posted (context teardown / postTaskTo
        // failed), so no 'close' event will ever fire for this port. Mark the
        // close consumed and tear down now, so a close listener added after
        // close() cannot pin the already-closed wrapper via hasPendingActivity().
        m_closeEventDispatched = true;
        removeAllEventListeners();
    }
}

void MessagePort::startForClose()
{
    // Attach to the pipe so the peer can wake this port to dispatch 'close'
    // (the wake comes from the peer's close() via wakePeerForClose(), or from
    // this attach() itself if the peer has already script-closed). Unlike
    // start(), this does not set m_started, so a later 'message' listener still
    // runs start() and re-attaches to flush any buffered messages. attach() is
    // idempotent, so calling it again from start() is harmless.
    if (!isEntangled())
        return;
    auto* context = scriptExecutionContext();
    if (!context)
        return;
    m_pipe->attach(m_side, context->identifier(), ThreadSafeWeakPtr<MessagePort> { *this });
}

bool MessagePort::canRunScript() const
{
    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return false;
    auto* globalObject = defaultGlobalObject(context->globalObject());
    return Zig::GlobalObject::scriptExecutionStatus(globalObject, globalObject) == ScriptExecutionStatus::Running;
}

void MessagePort::dispatchCloseEvent()
{
    if (m_closeEventDispatched)
        return;
    m_closeEventDispatched = true;

    if (!canRunScript())
        return;

    // Bypass MessagePort::dispatchEvent()'s detached guard: by the time the
    // close task runs the port is already detached, but the 'close' event must
    // still reach its listener.
    EventTarget::dispatchEvent(Event::create(eventNames().closeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void MessagePort::dispatchCloseEventSelf()
{
    dispatchCloseEvent();
    removeAllEventListeners();
    m_hasMessageEventListener = false;
    m_hasCloseEventListener = false;
}

bool MessagePort::scheduleCloseEvent()
{
    if (m_closeEventDispatched)
        return false;

    // Post unconditionally when JS can run, even without a close listener yet:
    // Node and the HTML spec queue the close task on close(), so a listener
    // added synchronously afterwards (port.close(); port.on('close', cb)) still
    // fires. dispatchCloseEventSelf() is a no-op dispatch when no listener
    // exists and then tears the port down, so the wrapper still gets collected.
    if (!canRunScript())
        return false;

    auto* context = scriptExecutionContext();
    return ScriptExecutionContext::postTaskTo(context->identifier(), [protectedThis = Ref { *this }](ScriptExecutionContext&) {
        protectedThis->dispatchCloseEventSelf();
    });
}

void MessagePort::dispatchCloseEventFromPeer()
{
    if (m_isDetached || m_closeEventDispatched || !m_hasCloseEventListener)
        return;

    // Runs JS (the close handler), which may drop the last external ref. The
    // caller (the drain) holds a RefPtr and we take our own Ref here, so the
    // C++ object survives; the JS wrapper is rooted for the handler by the
    // event's target on the JS stack (same GC tolerance as the message path).
    Ref protectedThis { *this };
    // Stop message delivery and make a re-entrant close() a no-op.
    m_isDetached = true;

    dispatchCloseEvent();

    m_pipe->close(m_side);
    removeAllEventListeners();
    m_hasMessageEventListener = false;
    m_hasCloseEventListener = false;

    if (m_hasRef) {
        m_hasRef = false;
        if (auto* context = scriptExecutionContext())
            context->unrefEventLoop();
        deref();
    }
}

TransferredMessagePort MessagePort::disentangle()
{
    ASSERT(isEntangled());

    // Drop any message listeners (and the event-loop ref they carry) while
    // this port is still attached to its context; after observeContext(null)
    // there would be nothing to unref.
    removeAllEventListeners();
    m_hasMessageEventListener = false;

    // Release the self-reference taken by jsRef() on the sending side. After
    // transfer this object is inert (the receiving side gets a fresh
    // MessagePort for the same pipe endpoint) and is no longer a destruction
    // observer, so nothing else will ever release a ref taken here.
    // The caller (disentanglePorts) holds a RefPtr, so deref() is safe.
    if (m_hasRef) {
        m_hasRef = false;
        if (auto* context = scriptExecutionContext())
            context->unrefEventLoop();
        deref();
    }

    // Hand the pipe endpoint to its next owner. Messages that arrive while
    // in transit buffer in the pipe; the receiving context's entangle()
    // re-attaches and flushes them. We keep our own ref to the pipe so the
    // GC thread can always dereference it — our side is detached, so all
    // further operations on it are no-ops.
    m_pipe->detach(m_side);
    m_isDetached = true;
    m_started = false;

    if (auto* context = scriptExecutionContext())
        context->willDestroyDestructionObserver(*this);
    observeContext(nullptr);

    return TransferredMessagePort { m_pipe.copyRef(), m_side };
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
    // close() releases the jsRef() self-reference, which may be the last
    // strong ref if the JS wrapper was already swept. Protect across the
    // call so we can cleanly detach from the dying ScriptExecutionContext
    // first — otherwise ~ContextDestructionObserver() would call back into
    // it while it is mid-destruction.
    Ref protectedThis { *this };
    close();
    ContextDestructionObserver::contextDestroyed();
}

bool MessagePort::hasPendingActivity() const
{
    // Called from the GC thread concurrently with the mutator; must be
    // lockless. m_pipe is a Ref<> held for the port's whole lifetime, so
    // the dereference is always safe; state() and isOtherSideOpen() are
    // atomic loads. The plain bool reads can observe stale values but
    // cannot crash — at worst the wrapper is collected one cycle early
    // or late, which is the same tolerance as before this refactor.
    if (!scriptExecutionContext())
        return false;

    uint64_t s = m_pipe->state(m_side);

    // Keep the wrapper (and its 'close' listener) alive until a pending close
    // event is dispatched. A close is pending, and will actually fire, when a
    // close listener is registered, it has not been dispatched yet, and either:
    //   - this side has closed: the closing port's own 'close' task (posted by
    //     close() while JS can run) will fire it, or close() already set
    //     m_closeEventDispatched when it couldn't post (teardown); or
    //   - the peer has closed AND a drain is scheduled on this side: that drain
    //     is the only thing that calls dispatchCloseEventFromPeer(), so the pin
    //     is tied to its existence. A peer closed via ~MessagePort /
    //     ~TransferredMessagePort / teardown never wakes us (no drain), so such
    //     a port is not pinned and stays collectable.
    // The !m_closeEventDispatched guard lets an already-closed port be
    // collected once its close has fired (or was marked consumed), so a close
    // listener added afterwards cannot pin the wrapper forever.
    if (m_hasCloseEventListener && !m_closeEventDispatched
        && ((s & MessagePortPipe::Closed)
            || ((s & MessagePortPipe::DrainScheduled) && !m_pipe->isOtherSideOpen(m_side))))
        return true;

    if (m_isDetached)
        return false;
    if (!m_hasMessageEventListener)
        return false;

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
    } else if (eventType == eventNames().closeEvent) {
        startForClose();
        m_hasCloseEventListener = true;
    }
    return EventTarget::addEventListener(eventType, WTF::move(listener), options);
}

bool MessagePort::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto result = EventTarget::removeEventListener(eventType, listener, options);
    if (!hasEventListeners(eventNames().messageEvent))
        m_hasMessageEventListener = false;
    if (!hasEventListeners(eventNames().closeEvent))
        m_hasCloseEventListener = false;
    return result;
}

WebCoreOpaqueRoot root(MessagePort* port)
{
    return WebCoreOpaqueRoot { port };
}

void MessagePort::jsRef(JSGlobalObject* lexicalGlobalObject)
{
    // A closed or transferred-away port can never receive messages again, so
    // taking a self-ref (and an event-loop ref) here would only leak:
    // close()/disentangle() have already run and nothing will ever release a
    // ref taken afterwards.
    if (!isEntangled())
        return;

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
