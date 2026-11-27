/*
 * Copyright (C) 2021 Apple Inc. All rights reserved.
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

#include "config.h"
#include "BroadcastChannel.h"

#include "BunBroadcastChannelRegistry.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "SerializedScriptValue.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BroadcastChannel);

BroadcastChannel::BroadcastChannel(ScriptExecutionContext& context, const String& name)
    : ActiveDOMObject(&context)
    , m_name(name.isolatedCopy())
    , m_contextId(context.identifier())
{
    EventTarget::initializeWeakPtrFactory();
    BunBroadcastChannelRegistry::singleton().subscribe(m_name, context, *this);
    jsRef();
}

BroadcastChannel::~BroadcastChannel()
{
    // As in Node, an open channel keeps the process alive whether or not script can reach it, until its context goes.
    if (m_keepAlive.isActive())
        scriptExecutionContext()->keepEventLoopAliveUntilStopped();
    close();
}

ExceptionOr<void> BroadcastChannel::postMessage(JSC::JSGlobalObject& globalObject, JSC::JSValue messageValue)
{
    // Made or kept by the script of a disposed Bun.ModuleGraph: like a MessagePort of one it says nothing,
    // to the script (the stop closes it a turn later) or to anyone listening on the name.
    if (auto* context = scriptExecutionContext(); context && context->isForModuleGraph() && context->isStopped())
        return {};
    if (isClosed())
        return Exception { InvalidStateError, "This BroadcastChannel is closed"_s };

    Vector<RefPtr<MessagePort>> dummyPorts;
    auto serialized = SerializedScriptValue::create(globalObject, messageValue, {}, dummyPorts, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException())
        return serialized.releaseException();
    ASSERT(dummyPorts.isEmpty());

    BunBroadcastChannelRegistry::singleton().post(m_name, *this, serialized.releaseReturnValue());
    return {};
}

void BroadcastChannel::dispatchMessage(Ref<SerializedScriptValue>&& message)
{
    if (isClosed())
        return;

    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return;
    ASSERT(context->isContextThread());

    auto* globalObject = context->jsGlobalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-postmessage (step 7's task,
    // sub-step 3): if deserializing throws, catch it and fire messageerror instead.
    Vector<RefPtr<MessagePort>> dummyPorts;
    auto event = MessageEvent::create(*globalObject, WTF::move(message), {}, {}, nullptr, WTF::move(dummyPorts));
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return;
        scope.clearException();
        dispatchEvent(MessageEvent::create(eventNames().messageerrorEvent, MessageEvent::Init { {}, jsNull() }, MessageEvent::IsTrusted::Yes));
        return;
    }
    dispatchEvent(event->event);
}

void BroadcastChannel::close()
{
    uint64_t prev = m_state.fetch_or(Closed, std::memory_order_acq_rel);
    if (prev & Closed)
        return;
    BunBroadcastChannelRegistry::singleton().unsubscribe(m_name, *this);
    jsUnref();
}

void BroadcastChannel::contextDestroyed()
{
    close();
    ContextDestructionObserver::contextDestroyed();
}

void BroadcastChannel::eventListenersDidChange()
{
    auto& names = eventNames();
    if (hasEventListeners(names.messageEvent) || hasEventListeners(names.messageerrorEvent))
        m_state.fetch_or(HasMessageOrMessageErrorListener, std::memory_order_acq_rel);
    else
        m_state.fetch_and(~uint64_t(HasMessageOrMessageErrorListener), std::memory_order_acq_rel);
}

bool BroadcastChannel::virtualHasPendingActivity() const
{
    // Called from the GC thread; a single atomic load covers everything.
    // An open channel with a `message` or `messageerror` listener stays alive:
    // https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts
    // A message in flight is not counted. The registry's task holds only a
    // ThreadSafeWeakPtr, and a channel with neither listener has nothing to
    // tell script.
    uint64_t s = m_state.load(std::memory_order_acquire);
    return !(s & Closed) && (s & HasMessageOrMessageErrorListener);
}

} // namespace WebCore
