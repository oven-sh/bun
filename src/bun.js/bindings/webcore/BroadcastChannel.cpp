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

#include "BunClientData.h"
#include "BroadcastChannelRegistry.h"
#include "BunBroadcastChannelRegistry.h"
#include "EventNames.h"
#include "EventTarget.h"
#include "MessageEvent.h"
// #include "Page.h"
// #include "PartitionedSecurityOrigin.h"
// #include "SecurityOrigin.h"
#include "SerializedScriptValue.h"
// #include "WorkerGlobalScope.h"
#include "BunWorkerGlobalScope.h"
// #include "WorkerLoaderProxy.h"
// #include "WorkerThread.h"
#include <wtf/CallbackAggregator.h>
#include <wtf/Identified.h>
#include <wtf/HashMap.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/MainThread.h>
#include <wtf/Scope.h>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BroadcastChannel);

static Lock allBroadcastChannelsLock;
static UncheckedKeyHashMap<BroadcastChannelIdentifier, BroadcastChannel*>& allBroadcastChannels() WTF_REQUIRES_LOCK(allBroadcastChannelsLock)
{
    static NeverDestroyed<UncheckedKeyHashMap<BroadcastChannelIdentifier, BroadcastChannel*>> map;
    return map;
}

static Lock channelToContextIdentifierLock;
static UncheckedKeyHashMap<BroadcastChannelIdentifier, ScriptExecutionContextIdentifier>& channelToContextIdentifier()
{
    static NeverDestroyed<UncheckedKeyHashMap<BroadcastChannelIdentifier, ScriptExecutionContextIdentifier>> map;
    return map;
}

// static PartitionedSecurityOrigin partitionedSecurityOriginFromContext(ScriptExecutionContext& context)
// {
//     Ref securityOrigin { *context.securityOrigin() };
//     Ref topOrigin { context.settingsValues().broadcastChannelOriginPartitioningEnabled ? context.topOrigin() : securityOrigin.get() };
//     return { WTFMove(topOrigin), WTFMove(securityOrigin) };
// }

class BroadcastChannel::MainThreadBridge : public ThreadSafeRefCounted<MainThreadBridge, WTF::DestructionThread::Main>, public Identified<BroadcastChannelIdentifier> {
public:
    static Ref<MainThreadBridge> create(BroadcastChannel& channel, const String& name, ScriptExecutionContext& context)
    {
        return adoptRef(*new MainThreadBridge(channel, name, context));
    }

    void registerChannel(ScriptExecutionContext&);
    void unregisterChannel();
    void postMessage(Ref<SerializedScriptValue>&&);
    void detach() { m_broadcastChannel = nullptr; };

    String name() const { return m_name.isolatedCopy(); }
    ScriptExecutionContextIdentifier contextId() const { return m_contextId; }

    virtual ~MainThreadBridge() = default;

private:
    MainThreadBridge(BroadcastChannel&, const String& name, ScriptExecutionContext&);

    void ensureOnMainThread(Function<void(void*)>&&);

    WeakPtr<BroadcastChannel, WeakPtrImplWithEventTargetData> m_broadcastChannel;
    const String m_name; // Main thread only.
    ScriptExecutionContextIdentifier m_contextId;
    // PartitionedSecurityOrigin m_origin; // Main thread only.
};

BroadcastChannel::MainThreadBridge::MainThreadBridge(BroadcastChannel& channel, const String& name, ScriptExecutionContext& context)
    : m_broadcastChannel(channel)
    , m_name(name.isolatedCopy())
    , m_contextId(context.identifier())
// , m_origin(partitionedSecurityOriginFromContext(*channel.scriptExecutionContext()).isolatedCopy())
{
}

void BroadcastChannel::MainThreadBridge::ensureOnMainThread(Function<void(void*)>&& task)
{
    ASSERT(m_broadcastChannel);
    if (!m_broadcastChannel)
        return;

    auto* context = m_broadcastChannel->scriptExecutionContext();
    if (!context)
        return;
    ASSERT(context->isContextThread());

    Ref protectedThis { *this };

    ScriptExecutionContext::ensureOnMainThread([protectedThis = WTFMove(protectedThis), task = WTFMove(task)](auto& context) {
        task(nullptr);
    });
}

void BroadcastChannel::MainThreadBridge::registerChannel(ScriptExecutionContext& context)
{
    Ref protectedThis { *this };

    ScriptExecutionContext::ensureOnMainThread([protectedThis = WTFMove(protectedThis), contextId = context.identifier()](auto& context) mutable {
        context.broadcastChannelRegistry().registerChannel(protectedThis->m_name, protectedThis->identifier());
        channelToContextIdentifier().add(protectedThis->identifier(), contextId);
    });
}

void BroadcastChannel::MainThreadBridge::unregisterChannel()
{
    Ref protectedThis { *this };

    ScriptExecutionContext::ensureOnMainThread([protectedThis = WTFMove(protectedThis)](auto& context) {
        context.broadcastChannelRegistry().unregisterChannel(protectedThis->m_name, protectedThis->identifier());
        channelToContextIdentifier().remove(protectedThis->identifier());
    });
}

void BroadcastChannel::MainThreadBridge::postMessage(Ref<SerializedScriptValue>&& message)
{
    Ref protectedThis { *this };

    ScriptExecutionContext::ensureOnMainThread([protectedThis = WTFMove(protectedThis), message = WTFMove(message)](auto& context) mutable {
        context.broadcastChannelRegistry().postMessage(protectedThis->m_name, protectedThis->identifier(), WTFMove(message));
    });
}

BroadcastChannel::BroadcastChannel(ScriptExecutionContext& context, const String& name)
    // : ActiveDOMObject(&context)
    : ContextDestructionObserver(&context)
    , m_mainThreadBridge(MainThreadBridge::create(*this, name, context))
    , m_contextId(context.identifier())
{
    {
        Locker locker { allBroadcastChannelsLock };
        allBroadcastChannels().add(m_mainThreadBridge->identifier(), this);
    }
    m_mainThreadBridge->registerChannel(context);
    jsRef(context.jsGlobalObject());
}

BroadcastChannel::~BroadcastChannel()
{
    close();
    m_mainThreadBridge->detach();
    {
        Locker locker { allBroadcastChannelsLock };
        allBroadcastChannels().remove(m_mainThreadBridge->identifier());
    }
}

BroadcastChannelIdentifier BroadcastChannel::identifier() const
{
    return m_mainThreadBridge->identifier();
}

String BroadcastChannel::name() const
{
    return m_mainThreadBridge->name();
}

ScriptExecutionContextIdentifier BroadcastChannel::contextIdForBroadcastChannelId(BroadcastChannelIdentifier identifier)
{
    Locker locker { channelToContextIdentifierLock };
    return channelToContextIdentifier().get(identifier);
}

ScriptExecutionContext* BroadcastChannel::scriptExecutionContext() const
{
    return ScriptExecutionContext::getScriptExecutionContext(m_mainThreadBridge->contextId());
}

ExceptionOr<void> BroadcastChannel::postMessage(JSC::JSGlobalObject& globalObject, JSC::JSValue message)
{
    if (!isEligibleForMessaging())
        return {};

    if (m_isClosed)
        return Exception { InvalidStateError, "This BroadcastChannel is closed"_s };

    Vector<RefPtr<MessagePort>> ports;
    auto messageData = SerializedScriptValue::create(globalObject, message, {}, ports, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (messageData.hasException())
        return messageData.releaseException();
    ASSERT(ports.isEmpty());

    m_mainThreadBridge->postMessage(messageData.releaseReturnValue());
    return {};
}

void BroadcastChannel::close()
{
    if (m_isClosed)
        return;

    m_isClosed = true;
    m_mainThreadBridge->unregisterChannel();
}

void BroadcastChannel::dispatchMessageTo(BroadcastChannelIdentifier channelIdentifier, Ref<SerializedScriptValue>&& message)
{
    ASSERT(isMainThread());

    auto contextIdentifier = channelToContextIdentifier().get(channelIdentifier);
    if (!contextIdentifier)
        return;

    ScriptExecutionContext::ensureOnContextThread(contextIdentifier, [channelIdentifier, message = WTFMove(message)](auto&) mutable {
        RefPtr<BroadcastChannel> channel;
        {
            Locker locker { allBroadcastChannelsLock };
            channel = allBroadcastChannels().get(channelIdentifier);
        }
        if (channel)
            channel->dispatchMessage(WTFMove(message));
    });
}

void BroadcastChannel::dispatchMessage(Ref<SerializedScriptValue>&& message)
{
    if (!isEligibleForMessaging())
        return;

    if (m_isClosed)
        return;

    ScriptExecutionContext::postTaskTo(contextIdForBroadcastChannelId(m_mainThreadBridge->identifier()), [this, message = WTFMove(message)](ScriptExecutionContext& context) mutable {
        if (m_isClosed)
            return;

        auto* globalObject = context.jsGlobalObject();
        if (!globalObject)
            return;

        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_CATCH_SCOPE(vm);
        Vector<RefPtr<MessagePort>> dummyPorts;
        auto event = MessageEvent::create(*globalObject, WTFMove(message), {}, {}, nullptr, WTFMove(dummyPorts));
        if (UNLIKELY(scope.exception())) {
            // Currently, we assume that the only way we can get here is if we have a termination.
            RELEASE_ASSERT(vm.hasPendingTerminationException());
            return;
        }

        dispatchEvent(event.event);
    });
}

// const char* BroadcastChannel::activeDOMObjectName() const
// {
//     return "BroadcastChannel";
// }

void BroadcastChannel::eventListenersDidChange()
{
    m_hasRelevantEventListener = hasEventListeners(eventNames().messageEvent);
}

// bool BroadcastChannel::virtualHasPendingActivity() const
// {
//     return !m_isClosed && m_hasRelevantEventListener;
// }

bool BroadcastChannel::hasPendingActivity() const
{
    return !m_isClosed && m_hasRelevantEventListener;
}

// https://html.spec.whatwg.org/#eligible-for-messaging
bool BroadcastChannel::isEligibleForMessaging() const
{
    auto* context = scriptExecutionContext();
    if (!context)
        return false;

    // if (auto document = dynamicDowncast<Document>(*context))
    //     return document->isFullyActive();

    return true;
    // return !downcast<GlobalScope>(*context).isClosing();
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
