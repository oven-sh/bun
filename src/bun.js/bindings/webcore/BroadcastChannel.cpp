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

#include "BroadcastChannelRegistry.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "Page.h"
#include "PartitionedSecurityOrigin.h"
#include "SecurityOrigin.h"
#include "SerializedScriptValue.h"
#include "WorkerGlobalScope.h"
#include "WorkerLoaderProxy.h"
#include "WorkerThread.h"
#include <wtf/CallbackAggregator.h>
#include <wtf/HashMap.h>
#include <wtf/IsoMallocInlines.h>
#include <wtf/MainThread.h>
#include <wtf/Scope.h>

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(BroadcastChannel);

static Lock allBroadcastChannelsLock;
static HashMap<BroadcastChannelIdentifier, BroadcastChannel*>& allBroadcastChannels() WTF_REQUIRES_LOCK(allBroadcastChannelsLock)
{
    static NeverDestroyed<HashMap<BroadcastChannelIdentifier, BroadcastChannel*>> map;
    return map;
}

static HashMap<BroadcastChannelIdentifier, ScriptExecutionContextIdentifier>& channelToContextIdentifier()
{
    ASSERT(isMainThread());
    static NeverDestroyed<HashMap<BroadcastChannelIdentifier, ScriptExecutionContextIdentifier>> map;
    return map;
}

static PartitionedSecurityOrigin partitionedSecurityOriginFromContext(ScriptExecutionContext& context)
{
    Ref securityOrigin { *context.securityOrigin() };
    Ref topOrigin { context.settingsValues().broadcastChannelOriginPartitioningEnabled ? context.topOrigin() : securityOrigin.get() };
    return { WTFMove(topOrigin), WTFMove(securityOrigin) };
}

class BroadcastChannel::MainThreadBridge : public ThreadSafeRefCounted<MainThreadBridge, WTF::DestructionThread::Main> {
public:
    static Ref<MainThreadBridge> create(BroadcastChannel& channel, const String& name)
    {
        return adoptRef(*new MainThreadBridge(channel, name));
    }

    void registerChannel();
    void unregisterChannel();
    void postMessage(Ref<SerializedScriptValue>&&);

    String name() const { return m_name.isolatedCopy(); }
    BroadcastChannelIdentifier identifier() const { return m_identifier; }

private:
    MainThreadBridge(BroadcastChannel&, const String& name);

    void ensureOnMainThread(Function<void(Page*)>&&);

    WeakPtr<BroadcastChannel, WeakPtrImplWithEventTargetData> m_broadcastChannel;
    const BroadcastChannelIdentifier m_identifier;
    const String m_name; // Main thread only.
    PartitionedSecurityOrigin m_origin; // Main thread only.
};

BroadcastChannel::MainThreadBridge::MainThreadBridge(BroadcastChannel& channel, const String& name)
    : m_broadcastChannel(channel)
    , m_identifier(BroadcastChannelIdentifier::generate())
    , m_name(name.isolatedCopy())
    , m_origin(partitionedSecurityOriginFromContext(*channel.scriptExecutionContext()).isolatedCopy())
{
}

void BroadcastChannel::MainThreadBridge::ensureOnMainThread(Function<void(Page*)>&& task)
{
    ASSERT(m_broadcastChannel);
    if (!m_broadcastChannel)
        return;

    auto* context = m_broadcastChannel->scriptExecutionContext();
    if (!context)
        return;
    ASSERT(context->isContextThread());

    Ref protectedThis { *this };
    if (auto* document = dynamicDowncast<Document>(*context)) {
        task(document->page());
        return;
    }

    downcast<WorkerGlobalScope>(*context).thread().workerLoaderProxy().postTaskToLoader([protectedThis = WTFMove(protectedThis), task = WTFMove(task)](auto& context) {
        task(downcast<Document>(context).page());
    });
}

void BroadcastChannel::MainThreadBridge::registerChannel()
{
    ensureOnMainThread([this, contextIdentifier = m_broadcastChannel->scriptExecutionContext()->identifier()](auto* page) mutable {
        if (page)
            page->broadcastChannelRegistry().registerChannel(m_origin, m_name, m_identifier);
        channelToContextIdentifier().add(m_identifier, contextIdentifier);
    });
}

void BroadcastChannel::MainThreadBridge::unregisterChannel()
{
    ensureOnMainThread([this](auto* page) {
        if (page)
            page->broadcastChannelRegistry().unregisterChannel(m_origin, m_name, m_identifier);
        channelToContextIdentifier().remove(m_identifier);
    });
}

void BroadcastChannel::MainThreadBridge::postMessage(Ref<SerializedScriptValue>&& message)
{
    ensureOnMainThread([this, message = WTFMove(message)](auto* page) mutable {
        if (!page)
            return;

        auto blobHandles = message->blobHandles();
        page->broadcastChannelRegistry().postMessage(m_origin, m_name, m_identifier, WTFMove(message), [blobHandles = WTFMove(blobHandles)] {
            // Keeps Blob data inside messageData alive until the message has been delivered.
        });
    });
}

BroadcastChannel::BroadcastChannel(ScriptExecutionContext& context, const String& name)
    : ActiveDOMObject(&context)
    , m_mainThreadBridge(MainThreadBridge::create(*this, name))
{
    {
        Locker locker { allBroadcastChannelsLock };
        allBroadcastChannels().add(m_mainThreadBridge->identifier(), this);
    }
    m_mainThreadBridge->registerChannel();
}

BroadcastChannel::~BroadcastChannel()
{
    close();
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

void BroadcastChannel::dispatchMessageTo(BroadcastChannelIdentifier channelIdentifier, Ref<SerializedScriptValue>&& message, CompletionHandler<void()>&& completionHandler)
{
    ASSERT(isMainThread());
    auto completionHandlerCallingScope = makeScopeExit([completionHandler = WTFMove(completionHandler)]() mutable {
        callOnMainThread(WTFMove(completionHandler));
    });

    auto contextIdentifier = channelToContextIdentifier().get(channelIdentifier);
    if (!contextIdentifier)
        return;

    ScriptExecutionContext::ensureOnContextThread(contextIdentifier, [channelIdentifier, message = WTFMove(message), completionHandlerCallingScope = WTFMove(completionHandlerCallingScope)](auto&) mutable {
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

    queueTaskKeepingObjectAlive(*this, TaskSource::PostedMessageQueue, [this, message = WTFMove(message)]() mutable {
        if (m_isClosed || !scriptExecutionContext())
            return;

        auto* globalObject = scriptExecutionContext()->globalObject();
        if (!globalObject)
            return;

        auto& vm = globalObject->vm();
        auto scope = DECLARE_CATCH_SCOPE(vm);
        auto event = MessageEvent::create(*globalObject, WTFMove(message), scriptExecutionContext()->securityOrigin()->toString());
        if (UNLIKELY(scope.exception())) {
            // Currently, we assume that the only way we can get here is if we have a termination.
            RELEASE_ASSERT(vm.hasPendingTerminationException());
            return;
        }

        dispatchEvent(event.event);
    });
}

const char* BroadcastChannel::activeDOMObjectName() const
{
    return "BroadcastChannel";
}

void BroadcastChannel::eventListenersDidChange()
{
    m_hasRelevantEventListener = hasEventListeners(eventNames().messageEvent);
}

bool BroadcastChannel::virtualHasPendingActivity() const
{
    return !m_isClosed && m_hasRelevantEventListener;
}

// https://html.spec.whatwg.org/#eligible-for-messaging
bool BroadcastChannel::isEligibleForMessaging() const
{
    auto* context = scriptExecutionContext();
    if (!context)
        return false;

    if (auto document = dynamicDowncast<Document>(*context))
        return document->isFullyActive();

    return !downcast<WorkerGlobalScope>(*context).isClosing();
}

} // namespace WebCore
