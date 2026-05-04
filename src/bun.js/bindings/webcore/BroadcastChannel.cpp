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
#include "BunClientData.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "SerializedScriptValue.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BroadcastChannel);

BroadcastChannel::BroadcastChannel(ScriptExecutionContext& context, const String& name)
    : ContextDestructionObserver(&context)
    , m_name(name.isolatedCopy())
    , m_contextId(context.identifier())
{
    initializeWeakPtrFactory();
    BunBroadcastChannelRegistry::singleton().subscribe(m_name, m_contextId, *this);
    jsRef(context.jsGlobalObject());
}

BroadcastChannel::~BroadcastChannel()
{
    close();
}

ExceptionOr<void> BroadcastChannel::postMessage(JSC::JSGlobalObject& globalObject, JSC::JSValue messageValue)
{
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

    Vector<RefPtr<MessagePort>> dummyPorts;
    auto event = MessageEvent::create(*globalObject, WTF::move(message), {}, {}, nullptr, WTF::move(dummyPorts));
    if (scope.exception()) [[unlikely]] {
        RELEASE_ASSERT(vm.hasPendingTerminationException());
        return;
    }
    dispatchEvent(event.event);
}

void BroadcastChannel::close()
{
    uint64_t prev = m_state.fetch_or(Closed, std::memory_order_acq_rel);
    if (prev & Closed)
        return;
    BunBroadcastChannelRegistry::singleton().unsubscribe(m_name, *this);
}

void BroadcastChannel::contextDestroyed()
{
    close();
    ContextDestructionObserver::contextDestroyed();
}

void BroadcastChannel::eventListenersDidChange()
{
    if (hasEventListeners(eventNames().messageEvent))
        m_state.fetch_or(HasMessageListener, std::memory_order_acq_rel);
    else
        m_state.fetch_and(~uint64_t(HasMessageListener), std::memory_order_acq_rel);
}

bool BroadcastChannel::hasPendingActivity() const
{
    // Called from the GC thread; a single atomic load covers everything.
    // Queued-but-undelivered messages are NOT counted as pending activity:
    // the registry's posted task holds only a ThreadSafeWeakPtr (to avoid
    // running ~BroadcastChannel on the posting thread), so a channel with
    // no message listener is free to be collected before delivery and the
    // task will simply no-op. This matches spec semantics — dispatchEvent
    // with no listener is a no-op anyway.
    uint64_t s = m_state.load(std::memory_order_acquire);
    return !(s & Closed) && (s & HasMessageListener);
}

void BroadcastChannel::jsRef(JSGlobalObject* lexicalGlobalObject)
{
    if (!m_hasRef) {
        m_hasRef = true;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, 1);
    }
}

void BroadcastChannel::jsUnref(JSGlobalObject* lexicalGlobalObject)
{
    if (m_hasRef) {
        m_hasRef = false;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, -1);
    }
}

} // namespace WebCore
