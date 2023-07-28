/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
#include "MessagePortChannelProviderImpl.h"

#include "MessagePort.h"
#include <wtf/MainThread.h>
#include <wtf/RunLoop.h>

namespace WebCore {

MessagePortChannelProviderImpl::MessagePortChannelProviderImpl()
{
}

MessagePortChannelProviderImpl::~MessagePortChannelProviderImpl()
{
    ASSERT_NOT_REACHED();
}

void MessagePortChannelProviderImpl::createNewMessagePortChannel(const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
{
    ScriptExecutionContext::ensureOnMainThread([registry = &m_registry, local, remote](ScriptExecutionContext& context) mutable {
        registry->didCreateMessagePortChannel(local, remote);
    });
}

void MessagePortChannelProviderImpl::entangleLocalPortInThisProcessToRemote(const MessagePortIdentifier& local, const MessagePortIdentifier& remote)
{
    ScriptExecutionContext::ensureOnMainThread([registry = &m_registry, local, remote](ScriptExecutionContext& context) mutable {
        registry->didEntangleLocalToRemote(local, remote, ProcessIdent::identifier());
    });
}

void MessagePortChannelProviderImpl::messagePortDisentangled(const MessagePortIdentifier& local)
{
    ScriptExecutionContext::ensureOnMainThread([registry = &m_registry, local](ScriptExecutionContext& context) mutable {
        registry->didDisentangleMessagePort(local);
    });
}

void MessagePortChannelProviderImpl::messagePortClosed(const MessagePortIdentifier& local)
{
    ScriptExecutionContext::ensureOnMainThread([registry = &m_registry, local](ScriptExecutionContext& context) mutable {
        registry->didCloseMessagePort(local);
    });
}

void MessagePortChannelProviderImpl::postMessageToRemote(MessageWithMessagePorts&& message, const MessagePortIdentifier& remoteTarget)
{
    ScriptExecutionContext::ensureOnMainThread([message = WTFMove(message), registry = &m_registry, remoteTarget](ScriptExecutionContext& context) mutable {
        if (registry->didPostMessageToRemote(WTFMove(message), remoteTarget))
            MessagePort::notifyMessageAvailable(remoteTarget);
    });
}

void MessagePortChannelProviderImpl::takeAllMessagesForPort(const MessagePortIdentifier& port, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&& outerCallback)
{
    // It is the responsibility of outerCallback to get itself to the appropriate thread (e.g. WebWorker thread)
    auto callback = [outerCallback = WTFMove(outerCallback)](Vector<MessageWithMessagePorts>&& messages, CompletionHandler<void()>&& messageDeliveryCallback) mutable {
        ASSERT(isMainThread());
        outerCallback(WTFMove(messages), WTFMove(messageDeliveryCallback));
    };

    ScriptExecutionContext::ensureOnMainThread([registry = &m_registry, port, callback = WTFMove(callback)](ScriptExecutionContext& context) mutable {
        registry->takeAllMessagesForPort(port, WTFMove(callback));
    });
}

} // namespace WebCore
