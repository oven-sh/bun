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
#include <wtf/SetForScope.h>
#include <JavaScriptCore/JSArrayBuffer.h>

#include "BunClientData.h"
#include "EventNames.h"
#include "JSMessagePort.h"
#include "MessageEvent.h"
#include "MessagePortPipe.h"
#include "MessageWithMessagePorts.h"
#include "StructuredSerializeOptions.h"
#include "WebCoreOpaqueRoot.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__Process__emitWarning(Zig::GlobalObject*, JSC::EncodedJSValue warning, JSC::EncodedJSValue type, JSC::EncodedJSValue code, JSC::EncodedJSValue ctor);

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
    // Any port with a 'message' listener refs the event loop (matching node: a
    // listening port keeps its thread alive until closed or unref'd); otherwise a
    // buffered message could be lost if its listener is added late.
    onDidChangeListener = &MessagePort::onDidChangeListenerImpl;
}

MessagePort::~MessagePort()
{
    if (!m_isDetached)
        m_pipe->close(m_side, MessagePortPipe::CloseKind::Collected);
}

ExceptionOr<void> MessagePort::postMessage(JSC::JSGlobalObject& state, JSC::JSValue messageValue, StructuredSerializeOptions&& options)
{
    // Own a function-level scope: SerializedScriptValue::create() below leaves a
    // simulated throw on asan/debug that must be consumed before any nested scope.
    auto& vm = state.vm();
    auto warnScope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // Reject a bad port in the transfer list before serialization, so the post
    // aborts before any ArrayBuffer in the list is detached (transfer is atomic).
    // Node checks each entry in order: source port first, then detached.
    for (auto& transferable : options.transfer) {
        JSObject* obj = transferable.get();
        if (auto* jsPort = dynamicDowncast<JSMessagePort>(obj)) {
            if (&jsPort->wrapped() == this)
                return Exception { DataCloneError, "Transfer list contains source port"_s };
            if (jsPort->wrapped().isDetached() || jsPort->wrapped().isClosing())
                return Exception { DataCloneError, "MessagePort in transfer list is already detached"_s };
        } else if (!obj->inherits<JSC::JSArrayBuffer>()) {
            // MessagePort and ArrayBuffer are the only transferables bun serializes;
            // node reports anything else here, in order, with this exact message.
            return Exception { DataCloneError, "Found invalid value in transferList."_s };
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    auto messageData = SerializedScriptValue::create(state, messageValue, WTF::move(options.transfer), ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (messageData.hasException()) {
        // Satisfy the exception-check verifier for create()'s simulated throw
        // WITHOUT clearing the pending exception (propagateException needs it).
        (void)warnScope.exception();
        return messageData.releaseException();
    }
    RETURN_IF_EXCEPTION(warnScope, {});

    if (!isEntangled())
        return {};

    Vector<TransferredMessagePort> transferredPorts;
    if (!ports.isEmpty()) {
        // Posting a port's own entangled peer targets the message at itself.
        // (The source port itself was rejected before serialization above.)
        bool targetsEntangledPeer = false;
        for (auto& port : ports) {
            if (port->pipe() == m_pipe.ptr()) {
                targetsEntangledPeer = true;
                break;
            }
        }
        // Detach every transfer-list port up front: transfer is atomic in node, so a
        // third-party port must not stay usable even when the message is dropped below.
        auto disentangled = MessagePort::disentanglePorts(WTF::move(ports));
        if (disentangled.hasException())
            return disentangled.releaseException();
        transferredPorts = disentangled.releaseReturnValue();

        if (targetsEntangledPeer) {
            // Posting the port's own entangled peer: node warns and loses the channel
            // rather than throwing. Transferables were already detached above; drop the
            // message and close so the dead channel stops reffing the loop.
            Bun__Process__emitWarning(defaultGlobalObject(&state),
                JSC::JSValue::encode(JSC::jsString(vm, String("The target port was posted to itself, and the communication channel was lost"_s))),
                JSC::JSValue::encode(JSC::jsString(vm, String("Warning"_s))),
                JSC::JSValue::encode(JSC::jsUndefined()),
                JSC::JSValue::encode(JSC::jsUndefined()));
            CLEAR_IF_EXCEPTION(warnScope);
            close();
            return {};
        }
    }

    m_pipe->send(m_side, MessageWithMessagePorts { messageData.releaseReturnValue(), WTF::move(transferredPorts) });
    return {};
}

void MessagePort::start()
{
    if (!isEntangled())
        return;
    // Node's port state: start() is the sole "receiving" gate. Removing the last
    // 'message' listener flips m_started back to false (stop()); a later start()
    // must resume, so this is not a one-shot latch.
    m_started = true;

    auto* context = scriptExecutionContext();
    ASSERT(context);
    // From the pipe's point of view "attached" means "ready to have drains
    // scheduled on my behalf" — that is exactly what start() promises.
    m_pipe->attach(m_side, context->identifier(), ThreadSafeWeakPtr<MessagePort> { *this });
}

void MessagePort::flushQueuedMessagesBeforeClose()
{
    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return;
    // During worker teardown contextDestroyed() runs from ~ScriptExecutionContext
    // inside ~VM's lastChanceToFinalize, where allocating a MessageEvent wrapper
    // asserts (the heap is being finalized). markTerminating() precedes ~VM, and
    // the Rust-side scriptExecutionStatus still reports Running at that point.
    if (context->isTerminating())
        return;
    auto* globalObject = defaultGlobalObject(context->globalObject());
    // Only deliver while JS can run; during teardown the queue is left for
    // m_pipe->close() to drop (it unwinds nested port chains iteratively).
    if (Zig::GlobalObject::scriptExecutionStatus(globalObject, globalObject) != ScriptExecutionStatus::Running)
        return;

    // Cap iterations like drainAndDispatch() so a 'message' handler re-injecting
    // into this closing port (via its entangled peer) can't starve the loop.
    size_t limit = std::max<size_t>(MessagePortPipe::queuedCount(m_pipe->state(m_side)), 1000);
    for (size_t i = 0; i < limit; ++i) {
        // A handler (or a microtask it queued) may have transferred this port; the
        // remaining inbox now belongs to the new owner. drainAndDispatch()'s
        // per-iteration ctxId/port re-check guards the same case.
        if (m_isDetached)
            break;
        auto message = m_pipe->takeOne(m_side);
        if (!message)
            break;
        dispatchOneMessage(*context, WTF::move(*message));
        if (globalObject->drainMicrotasks())
            break; // termination pending
    }
}

void MessagePort::close()
{
    if (m_isDetached || m_isClosing)
        return;
    m_isClosing = true;

    // Only an in-flight drain finishes: node keeps delivering the rest of the batch
    // when a 'message' handler calls close(), but drops everything still queued when
    // close() runs outside a dispatch. Reentrant close() is short-circuited by
    // m_isClosing; later sends are rejected by the pipe's Closed check.
    if (m_isDispatching)
        flushQueuedMessagesBeforeClose();

    m_isDetached = true;

    // m_pipe is held for the port's whole lifetime (the GC thread reads
    // it in hasPendingActivity()); marking our side Closed is sufficient.
    m_pipe->close(m_side, MessagePortPipe::CloseKind::Explicit);

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

    // close() can run without a prior jsUnref() (warn-and-close, contextDestroyed());
    // clear the listener keepalive so a later listener add can't re-ref the loop.
    if (m_isRefd) {
        m_isRefd = false;
        updateListenerEventLoopRef();
    }

    // Defer 'close' to a task (node fires it at uv close-callback timing, i.e.
    // after sync code and microtasks), so a listener added after close() still
    // observes it and close(cb) interleaves with other listeners. Never while the
    // context is terminating: contextDestroyed() runs after the loop's queue was
    // drained for shutdown, so the task would never run and would outlive the VM.
    auto* context = scriptExecutionContext();
    if (context && !context->isTerminating()) {
        m_closeEventPending.store(true, std::memory_order_release);
        context->postTask([protectedThis = Ref { *this }](ScriptExecutionContext&) {
            protectedThis->dispatchCloseEvent();
            protectedThis->removeAllEventListeners();
            protectedThis->m_closeEventPending.store(false, std::memory_order_release);
        });
    } else {
        removeAllEventListeners();
    }
}

void MessagePort::dispatchCloseEvent()
{
    if (m_closeEventDispatched)
        return;
    m_closeEventDispatched = true;
    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return;
    // No JS may run during worker teardown (see flushQueuedMessagesBeforeClose).
    if (context->isTerminating())
        return;
    auto* globalObject = defaultGlobalObject(context->globalObject());
    // Bypass the m_isDetached guard in MessagePort::dispatchEvent — the deferred
    // close task runs after m_isDetached is set.
    if (Zig::GlobalObject::scriptExecutionStatus(globalObject, globalObject) == ScriptExecutionStatus::Running)
        EventTarget::dispatchEvent(Event::create(eventNames().closeEvent, Event::CanBubble::No, Event::IsCancelable::No));
}

void MessagePort::peerClosed()
{
    if (m_isDetached)
        return;
    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return;
    Ref protectedThis { *this };
    // Deliver whatever the peer sent before it closed, then fire 'close'. Node orders
    // them that way, and registerCloseContext()'s retroactive notify can land before any
    // drain is scheduled -- e.g. on('close') registered before on('message').
    if (m_started && m_hasMessageEventListener)
        flushQueuedMessagesBeforeClose();
    // Fire 'close' (guarded against a double dispatch) and release this side's loop refs
    // so the loop can idle, matching node.
    dispatchCloseEvent();
    // jsUnref() clears both the listener loop-ref (m_isRefd) and the onmessage/ref()
    // keepalive (m_hasRef), so a listening transferred port stops pinning the loop.
    auto* globalObject = defaultGlobalObject(context->globalObject());
    jsUnref(globalObject);
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

    // A transferred port is inert; clear the listener keepalive too so hasRef()
    // reports false (the disentangle analogue of the close() reset above).
    if (m_isRefd) {
        m_isRefd = false;
        updateListenerEventLoopRef();
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
    return port;
}

void MessagePort::dispatchOneMessage(ScriptExecutionContext& context, MessageWithMessagePorts&& message)
{
    if (m_isDetached || !context.globalObject())
        return;

    SetForScope dispatching { m_isDispatching, true };

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
    // close() sets m_isDetached before queueing the deferred close task, and a port
    // with only a 'close' listener has no message listener — so this must precede
    // both gates or the wrapper is collected before the task dispatches.
    if (m_closeEventPending.load(std::memory_order_acquire))
        return true;
    if (!scriptExecutionContext() || m_isDetached)
        return false;
    // A 'close' listener must outlive a GC until the event lands: notifyPeerClosed()
    // holds only a weak ref back here. This does pin both ends of an idle channel until
    // the context dies; node retains more — it never collects an entangled port at all.
    if (m_hasCloseEventListener.load(std::memory_order_acquire) && !m_closeEventDispatched)
        return true;
    if (!m_hasMessageEventListener)
        return false;

    // Keep alive while a drain task is pending or mid-dispatch. drainAndDispatch
    // pops each message (queued -> 0) before invoking listeners, so the in-hand
    // message is invisible to the queued count; without this bit a concurrent GC
    // running inside that window (queue empty, peer already closed) severs the
    // wrapper weak and the dispatch hits a dead JSEventListener wrapper (debug
    // ASSERT m_wrapper). DrainScheduled is set from schedule until the inbox is
    // observed empty, covering every dispatch.
    uint64_t s = m_pipe->state(m_side);
    if (s & MessagePortPipe::DrainScheduled)
        return true;

    // Keep alive if the peer is still open and could send more, or messages are
    // already queued for us. Order matters: the peer's last send() happens before
    // its close() (both release-stores from the same thread), so a GC that
    // observes the peer Closed is guaranteed to see that send in our inbox when
    // it loads our state *afterwards*. Reading our inbox first races: a 0-queued
    // load taken before the send, combined with a Closed load taken after the
    // close, collects the wrapper while a message is in flight.
    if (m_pipe->isOtherSideOpen(m_side))
        return true;
    return MessagePortPipe::queuedCount(m_pipe->state(m_side)) > 0;
}

ExceptionOr<Vector<TransferredMessagePort>> MessagePort::disentanglePorts(Vector<RefPtr<MessagePort>>&& ports)
{
    if (ports.isEmpty())
        return Vector<TransferredMessagePort> {};

    HashSet<MessagePort*> seen;
    for (auto& port : ports) {
        if (!port || !port->isEntangled() || port->isClosing() || !seen.add(port.get()).isNewEntry)
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

// Reconcile the message-listener loop-ref with (m_isRefd && m_messageEventCount > 0),
// so .unref() releases the listener ref and .ref() re-acquires it.
void MessagePort::updateListenerEventLoopRef()
{
    bool shouldHold = m_isRefd && m_messageEventCount > 0;
    if (shouldHold == m_listenerLoopRefActive)
        return;
    auto* context = scriptExecutionContext();
    if (!context)
        return;
    if (shouldHold)
        context->refEventLoop();
    else
        context->unrefEventLoop();
    m_listenerLoopRefActive = shouldHold;
}

void MessagePort::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType != eventNames().messageEvent)
        return;

    auto& port = static_cast<MessagePort&>(self);
    switch (kind) {
    case Add:
        port.m_messageEventCount++;
        break;
    case Remove:
        if (port.m_messageEventCount > 0)
            port.m_messageEventCount--;
        break;
    case Clear:
        port.m_messageEventCount = 0;
        break;
    }
    port.updateListenerEventLoopRef();
}

bool MessagePort::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (eventType == eventNames().messageEvent) {
        m_hasMessageEventListener = true;
        // start() re-attaches each time, so a listener added after a pause
        // re-schedules the drain for messages buffered meanwhile.
        start();
    } else if (eventType == eventNames().closeEvent) {
        m_hasCloseEventListener.store(true, std::memory_order_release);
        if (isEntangled()) {
            // Record our context with the pipe so the peer's close() can deliver a
            // 'close' event even if we never started (no 'message' listener).
            if (auto* context = scriptExecutionContext())
                m_pipe->registerCloseContext(m_side, context->identifier(), ThreadSafeWeakPtr<MessagePort> { *this });
        }
    }
    return EventTarget::addEventListener(eventType, WTF::move(listener), options);
}

bool MessagePort::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    auto result = EventTarget::removeEventListener(eventType, listener, options);
    if (eventType == eventNames().messageEvent && !hasEventListeners(eventNames().messageEvent)) {
        m_hasMessageEventListener = false;
        // Node stops the port when the last 'message' listener goes away; further
        // messages buffer for receiveMessageOnPort until start() (or a new listener).
        m_started = false;
    }
    if (!hasEventListeners(eventNames().closeEvent))
        m_hasCloseEventListener.store(false, std::memory_order_release);
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
    // ref taken afterwards. Same once the peer has closed: peerClosed() already
    // ran jsUnref(), and nothing releases a ref re-taken after it, so `.ref()`
    // or a late `onmessage =` would pin the loop forever. Node no-ops both.
    // Only an explicit peer close counts: node never closes a channel because a
    // port was collected, so keying on Closed alone made this GC-dependent.
    if (!isEntangled() || m_pipe->isOtherSideClosedByRequest(m_side))
        return;

    // Re-acquire the message-listener loop-ref (if a listener is present) that .unref() released.
    if (!m_isRefd) {
        m_isRefd = true;
        updateListenerEventLoopRef();
    }

    if (!m_hasRef) {
        m_hasRef = true;
        ref();
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, 1);
    }
}

void MessagePort::jsUnref(JSGlobalObject* lexicalGlobalObject)
{
    // Also release the listener loop-ref; otherwise an always-listening transferred
    // port (a postMessageToThread control port) would pin the event loop forever.
    if (m_isRefd) {
        m_isRefd = false;
        updateListenerEventLoopRef();
    }
    if (m_hasRef) {
        m_hasRef = false;
        deref();
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, -1);
    }
}

} // namespace WebCore
