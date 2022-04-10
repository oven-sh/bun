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
#include "MessagePortChannelRegistry.h"

#include "Logging.h"
#include <wtf/CompletionHandler.h>
#include <wtf/MainThread.h>

namespace WebCore {

MessagePortChannelRegistry::MessagePortChannelRegistry(CheckProcessLocalPortForActivityCallback&& checkProcessLocalPortForActivityCallback)
    : m_checkProcessLocalPortForActivityCallback(WTFMove(checkProcessLocalPortForActivityCallback))
{
}

MessagePortChannelRegistry::~MessagePortChannelRegistry()
{
    ASSERT(m_openChannels.isEmpty());
}

void MessagePortChannelRegistry::didCreateMessagePortChannel(const MessagePortIdentifier& port1, const MessagePortIdentifier& port2)
{
    LOG(MessagePorts, "Registry: Creating MessagePortChannel %p linking %s and %s", this, port1.logString().utf8().data(), port2.logString().utf8().data());
    ASSERT(isMainThread());

    MessagePortChannel::create(*this, port1, port2);
}

void MessagePortChannelRegistry::messagePortChannelCreated(MessagePortChannel& channel)
{
    ASSERT(isMainThread());

    auto result = m_openChannels.ensure(channel.port1(), [channel = &channel] {
        return channel;
    });
    ASSERT(result.isNewEntry);

    result = m_openChannels.ensure(channel.port2(), [channel = &channel] {
        return channel;
    });
    ASSERT(result.isNewEntry);
}

void MessagePortChannelRegistry::messagePortChannelDestroyed(MessagePortChannel& channel)
{
    ASSERT(isMainThread());

    ASSERT(m_openChannels.get(channel.port1()) == &channel);
    ASSERT(m_openChannels.get(channel.port2()) == &channel);

    m_openChannels.remove(channel.port1());
    m_openChannels.remove(channel.port2());

    LOG(MessagePorts, "Registry: After removing channel %s there are %u channels left in the registry:", channel.logString().utf8().data(), m_openChannels.size());
}

void MessagePortChannelRegistry::didEntangleLocalToRemote(const MessagePortIdentifier& local, const MessagePortIdentifier& remote, ProcessIdentifier process)
{
    ASSERT(isMainThread());

    // The channel might be gone if the remote side was closed.
    auto* channel = m_openChannels.get(local);
    if (!channel)
        return;

    ASSERT_UNUSED(remote, channel->includesPort(remote));

    channel->entanglePortWithProcess(local, process);
}

void MessagePortChannelRegistry::didDisentangleMessagePort(const MessagePortIdentifier& port)
{
    ASSERT(isMainThread());

    // The channel might be gone if the remote side was closed.
    auto* channel = m_openChannels.get(port);
    if (!channel)
        return;

    channel->disentanglePort(port);
}

void MessagePortChannelRegistry::didCloseMessagePort(const MessagePortIdentifier& port)
{
    ASSERT(isMainThread());

    LOG(MessagePorts, "Registry: MessagePort %s closed in registry", port.logString().utf8().data());

    auto* channel = m_openChannels.get(port);
    if (!channel)
        return;

#ifndef NDEBUG
    if (channel && channel->hasAnyMessagesPendingOrInFlight())
        LOG(MessagePorts, "Registry: (Note) The channel closed for port %s had messages pending or in flight", port.logString().utf8().data());
#endif

    channel->closePort(port);

    // FIXME: When making message ports be multi-process, this should probably push a notification
    // to the remaining port to tell it this port closed.
}

bool MessagePortChannelRegistry::didPostMessageToRemote(MessageWithMessagePorts&& message, const MessagePortIdentifier& remoteTarget)
{
    ASSERT(isMainThread());

    LOG(MessagePorts, "Registry: Posting message to MessagePort %s in registry", remoteTarget.logString().utf8().data());

    // The channel might be gone if the remote side was closed.
    auto* channel = m_openChannels.get(remoteTarget);
    if (!channel) {
        LOG(MessagePorts, "Registry: Could not find MessagePortChannel for port %s; It was probably closed. Message will be dropped.", remoteTarget.logString().utf8().data());
        return false;
    }

    return channel->postMessageToRemote(WTFMove(message), remoteTarget);
}

void MessagePortChannelRegistry::takeAllMessagesForPort(const MessagePortIdentifier& port, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&& callback)
{
    ASSERT(isMainThread());

    LOG(MessagePorts, "Registry: Taking all messages for MessagePort %s", port.logString().utf8().data());

    // The channel might be gone if the remote side was closed.
    auto* channel = m_openChannels.get(port);
    if (!channel) {
        callback({ }, [] { });
        return;
    }

    channel->takeAllMessagesForPort(port, WTFMove(callback));
}

void MessagePortChannelRegistry::checkRemotePortForActivity(const MessagePortIdentifier& remoteTarget, CompletionHandler<void(MessagePortChannelProvider::HasActivity)>&& callback)
{
    ASSERT(isMainThread());

    // The channel might be gone if the remote side was closed.
    auto* channel = m_openChannels.get(remoteTarget);
    if (!channel) {
        callback(MessagePortChannelProvider::HasActivity::No);
        return;
    }

    channel->checkRemotePortForActivity(remoteTarget, WTFMove(callback));
}

MessagePortChannel* MessagePortChannelRegistry::existingChannelContainingPort(const MessagePortIdentifier& port)
{
    ASSERT(isMainThread());

    return m_openChannels.get(port);
}

void MessagePortChannelRegistry::checkProcessLocalPortForActivity(const MessagePortIdentifier& messagePortIdentifier, ProcessIdentifier processIdentifier, CompletionHandler<void(MessagePortChannelProvider::HasActivity)>&& callback)
{
    m_checkProcessLocalPortForActivityCallback(messagePortIdentifier, processIdentifier, WTFMove(callback));
}

} // namespace WebCore
