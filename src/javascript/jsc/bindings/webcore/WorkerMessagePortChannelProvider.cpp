/*
 * Copyright (C) 2019 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "WorkerMessagePortChannelProvider.h"

#include "MessagePort.h"
#include "WorkerOrWorkletGlobalScope.h"
#include "WorkerThread.h"
#include <wtf/MainThread.h>
#include <wtf/RunLoop.h>

namespace WebCore {

WorkerMessagePortChannelProvider::WorkerMessagePortChannelProvider(WorkerOrWorkletGlobalScope& scope)
    : m_scope(scope)
{
}

WorkerMessagePortChannelProvider::~WorkerMessagePortChannelProvider()
{
    while (!m_takeAllMessagesCallbacks.isEmpty()) {
        auto first = m_takeAllMessagesCallbacks.begin();
        first->value({ }, [] { });
        m_takeAllMessagesCallbacks.remove(first);
    }
    while (!m_activityCallbacks.isEmpty()) {
        auto first = m_activityCallbacks.begin();
        first->value(HasActivity::No);
        m_activityCallbacks.remove(first);
    }
}

void WorkerMessagePortChannelProvider::createNewMessagePortChannel(const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
{
    callOnMainThread([local, remote] {
        MessagePortChannelProvider::singleton().createNewMessagePortChannel(local, remote);
    });
}

void WorkerMessagePortChannelProvider::entangleLocalPortInThisProcessToRemote(const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
{
    callOnMainThread([local, remote] {
        MessagePortChannelProvider::singleton().entangleLocalPortInThisProcessToRemote(local, remote);
    });
}

void WorkerMessagePortChannelProvider::messagePortDisentangled(const MessagePortIdentifier& local)
{
    callOnMainThread([local] {
        MessagePortChannelProvider::singleton().messagePortDisentangled(local);
    });
}

void WorkerMessagePortChannelProvider::messagePortClosed(const MessagePortIdentifier&)
{
    ASSERT_NOT_REACHED();
}

void WorkerMessagePortChannelProvider::postMessageToRemote(MessageWithMessagePorts&& message, const MessagePortIdentifier& remoteTarget)
{
    callOnMainThread([message = WTFMove(message), remoteTarget]() mutable {
        MessagePortChannelProvider::singleton().postMessageToRemote(WTFMove(message), remoteTarget);
    });
}

class MainThreadCompletionHandler {
public:
    explicit MainThreadCompletionHandler(CompletionHandler<void()>&& completionHandler)
        : m_completionHandler(WTFMove(completionHandler))
    {
    }
    MainThreadCompletionHandler(MainThreadCompletionHandler&&) = default;
    MainThreadCompletionHandler& operator=(MainThreadCompletionHandler&&) = default;

    ~MainThreadCompletionHandler()
    {
        if (m_completionHandler)
            complete();
    }

    void complete()
    {
        callOnMainThread(WTFMove(m_completionHandler));
    }

private:
    CompletionHandler<void()> m_completionHandler;
};

void WorkerMessagePortChannelProvider::takeAllMessagesForPort(const MessagePortIdentifier& identifier, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&& callback)
{
    uint64_t callbackIdentifier = ++m_lastCallbackIdentifier;
    m_takeAllMessagesCallbacks.add(callbackIdentifier, WTFMove(callback));

    callOnMainThread([this, workerThread = RefPtr { m_scope.workerOrWorkletThread() }, callbackIdentifier, identifier]() mutable {
        MessagePortChannelProvider::singleton().takeAllMessagesForPort(identifier, [this, workerThread = WTFMove(workerThread), callbackIdentifier](Vector<MessageWithMessagePorts>&& messages, Function<void()>&& completionHandler) {
            workerThread->runLoop().postTaskForMode([this, callbackIdentifier, messages = WTFMove(messages), completionHandler = MainThreadCompletionHandler(WTFMove(completionHandler))](auto&) mutable {
                m_takeAllMessagesCallbacks.take(callbackIdentifier)(WTFMove(messages), [completionHandler = WTFMove(completionHandler)]() mutable {
                    completionHandler.complete();
                });
            }, WorkerRunLoop::defaultMode());
        });
    });
}

void WorkerMessagePortChannelProvider::checkRemotePortForActivity(const MessagePortIdentifier& remoteTarget, CompletionHandler<void(HasActivity)>&& callback)
{
    uint64_t callbackIdentifier = ++m_lastCallbackIdentifier;
    m_activityCallbacks.add(callbackIdentifier, WTFMove(callback));

    callOnMainThread([this, workerThread = RefPtr { m_scope.workerOrWorkletThread() }, callbackIdentifier, remoteTarget]() mutable {
        MessagePortChannelProvider::singleton().checkRemotePortForActivity(remoteTarget, [this, workerThread = WTFMove(workerThread), callbackIdentifier](auto hasActivity) {
            workerThread->runLoop().postTaskForMode([this, callbackIdentifier, hasActivity](auto&) mutable {
                m_activityCallbacks.take(callbackIdentifier)(hasActivity);
            }, WorkerRunLoop::defaultMode());
        });
    });
}

} // namespace WebCore
