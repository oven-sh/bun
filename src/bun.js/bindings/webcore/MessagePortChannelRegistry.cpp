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

#include <wtf/TZoneMallocInlines.h>
#include "MessagePortChannelRegistry.h"

// #include "Logging.h"
#include <wtf/CompletionHandler.h>
#include <wtf/Locker.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(MessagePortChannelRegistry);

MessagePortChannelRegistry::MessagePortChannelRegistry() = default;

MessagePortChannelRegistry::~MessagePortChannelRegistry()
{
    ASSERT(m_openChannels.isEmpty());
}

void MessagePortChannelRegistry::didCreateMessagePortChannel(const MessagePortIdentifier& port1, const MessagePortIdentifier& port2)
{
    // LOG(MessagePorts, "Registry: Creating MessagePortChannel %p linking %s and %s", this, port1.logString().utf8().data(), port2.logString().utf8().data());

    // No lock here: the channel constructor calls back into messagePortChannelCreated() which locks.
    MessagePortChannel::create(*this, port1, port2);
}

void MessagePortChannelRegistry::messagePortChannelCreated(MessagePortChannel& channel)
{
    Locker locker { m_lock };

    auto result = m_openChannels.add(channel.port1(), channel);
    ASSERT_UNUSED(result, result.isNewEntry);

    result = m_openChannels.add(channel.port2(), channel);
    ASSERT_UNUSED(result, result.isNewEntry);
}

void MessagePortChannelRegistry::messagePortChannelDestroyed(MessagePortChannel& channel)
{
    Locker locker { m_lock };

    m_openChannels.remove(channel.port1());
    m_openChannels.remove(channel.port2());

    // LOG(MessagePorts, "Registry: After removing channel %s there are %u channels left in the registry:", channel.logString().utf8().data(), m_openChannels.size());
}

void MessagePortChannelRegistry::didEntangleLocalToRemote(const MessagePortIdentifier& local, const MessagePortIdentifier& remote, ProcessIdentifier process)
{
    // The channel RefPtr must outlive the lock so its destructor (which re-enters
    // messagePortChannelDestroyed and locks) cannot deadlock.
    RefPtr<MessagePortChannel> channel;
    {
        Locker locker { m_lock };

        // The channel might be gone if the remote side was closed.
        channel = m_openChannels.get(local).get();
        if (!channel)
            return;

        ASSERT_UNUSED(remote, channel->includesPort(remote));

        channel->entanglePortWithProcess(local, process);
    }
}

void MessagePortChannelRegistry::didDisentangleMessagePort(const MessagePortIdentifier& port)
{
    RefPtr<MessagePortChannel> channel;
    {
        Locker locker { m_lock };

        // The channel might be gone if the remote side was closed.
        channel = m_openChannels.get(port).get();
        if (!channel)
            return;

        channel->disentanglePort(port);
    }
}

void MessagePortChannelRegistry::didCloseMessagePort(const MessagePortIdentifier& port)
{
    // LOG(MessagePorts, "Registry: MessagePort %s closed in registry", port.logString().utf8().data());

    RefPtr<MessagePortChannel> channel;
    {
        Locker locker { m_lock };

        channel = m_openChannels.get(port).get();
        if (!channel)
            return;

        channel->closePort(port);
    }

    // FIXME: When making message ports be multi-process, this should probably push a notification
    // to the remaining port to tell it this port closed.
}

bool MessagePortChannelRegistry::didPostMessageToRemote(MessageWithMessagePorts&& message, const MessagePortIdentifier& remoteTarget)
{
    // LOG(MessagePorts, "Registry: Posting message to MessagePort %s in registry", remoteTarget.logString().utf8().data());

    RefPtr<MessagePortChannel> channel;
    bool result;
    {
        Locker locker { m_lock };

        // The channel might be gone if the remote side was closed.
        channel = m_openChannels.get(remoteTarget).get();
        if (!channel) {
            // LOG(MessagePorts, "Registry: Could not find MessagePortChannel for port %s; It was probably closed. Message will be dropped.", remoteTarget.logString().utf8().data());
            return false;
        }

        result = channel->postMessageToRemote(WTF::move(message), remoteTarget);
    }
    return result;
}

void MessagePortChannelRegistry::takeAllMessagesForPort(const MessagePortIdentifier& port, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&& callback)
{
    RefPtr<MessagePortChannel> channel;
    Vector<MessageWithMessagePorts> messages;
    {
        Locker locker { m_lock };

        // The channel might be gone if the remote side was closed.
        channel = m_openChannels.get(port).get();
        if (channel)
            messages = channel->takeAllMessagesForPort(port);
    }

    // Invoked outside the lock: the callback re-enters the registry via MessagePort::entanglePorts.
    callback(WTF::move(messages), [] {});
}

std::optional<MessageWithMessagePorts> MessagePortChannelRegistry::tryTakeMessageForPort(const MessagePortIdentifier& port)
{
    // LOG(MessagePorts, "Registry: Trying to take a message for MessagePort %s", port.logString().utf8().data());

    RefPtr<MessagePortChannel> channel;
    std::optional<MessageWithMessagePorts> result;
    {
        Locker locker { m_lock };

        // The channel might be gone if the remote side was closed.
        channel = m_openChannels.get(port).get();
        if (!channel)
            return std::nullopt;

        result = channel->tryTakeMessageForPort(port);
    }
    return result;
}

} // namespace WebCore
