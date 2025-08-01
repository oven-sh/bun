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
#include "MessagePortChannel.h"

// #include "Logging.h"
#include "MessagePortChannelRegistry.h"
#include <wtf/CompletionHandler.h>
#include <wtf/MainThread.h>

namespace WebCore {

Ref<MessagePortChannel> MessagePortChannel::create(MessagePortChannelRegistry& registry, const MessagePortIdentifier& port1, const MessagePortIdentifier& port2)
{
    return adoptRef(*new MessagePortChannel(registry, port1, port2));
}

MessagePortChannel::MessagePortChannel(MessagePortChannelRegistry& registry, const MessagePortIdentifier& port1, const MessagePortIdentifier& port2)
    : m_ports { port1, port2 }
    , m_registry(registry)
{
    relaxAdoptionRequirement();

    m_processes[0] = port1.processIdentifier;
    m_entangledToProcessProtectors[0] = this;
    m_processes[1] = port2.processIdentifier;
    m_entangledToProcessProtectors[1] = this;

    m_registry.messagePortChannelCreated(*this);
}

MessagePortChannel::~MessagePortChannel()
{
    m_registry.messagePortChannelDestroyed(*this);
}

std::optional<ProcessIdentifier> MessagePortChannel::processForPort(const MessagePortIdentifier& port)
{
    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;
    return m_processes[i];
}

bool MessagePortChannel::includesPort(const MessagePortIdentifier& port)
{
    return m_ports[0] == port || m_ports[1] == port;
}

void MessagePortChannel::entanglePortWithProcess(const MessagePortIdentifier& port, ProcessIdentifier process)
{
    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;

    // LOG(MessagePorts, "MessagePortChannel %s (%p) entangling port %s (that port has %zu messages available)", logString().utf8().data(), this, port.logString().utf8().data(), m_pendingMessages[i].size());

    ASSERT(!m_processes[i] || *m_processes[i] == process);
    m_processes[i] = process;
    m_entangledToProcessProtectors[i] = this;
    m_pendingMessagePortTransfers[i].remove(this);
}

void MessagePortChannel::disentanglePort(const MessagePortIdentifier& port)
{
    // LOG(MessagePorts, "MessagePortChannel %s (%p) disentangling port %s", logString().utf8().data(), this, port.logString().utf8().data());

    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;

    ASSERT(m_processes[i] || m_isClosed[i]);
    m_processes[i] = std::nullopt;
    m_pendingMessagePortTransfers[i].add(this);

    // This set of steps is to guarantee that the lock is unlocked before the
    // last ref to this object is released.
    auto protectedThis = WTFMove(m_entangledToProcessProtectors[i]);
}

void MessagePortChannel::closePort(const MessagePortIdentifier& port)
{
    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;

    m_processes[i] = std::nullopt;
    m_isClosed[i] = true;

    // This set of steps is to guarantee that the lock is unlocked before the
    // last ref to this object is released.
    Ref protectedThis { *this };

    m_pendingMessages[i].clear();
    m_pendingMessagePortTransfers[i].clear();
    m_pendingMessageProtectors[i] = nullptr;
    m_entangledToProcessProtectors[i] = nullptr;
}

bool MessagePortChannel::postMessageToRemote(MessageWithMessagePorts&& message, const MessagePortIdentifier& remoteTarget)
{
    ASSERT(remoteTarget == m_ports[0] || remoteTarget == m_ports[1]);
    size_t i = remoteTarget == m_ports[0] ? 0 : 1;

    m_pendingMessages[i].append(WTFMove(message));
    // LOG(MessagePorts, "MessagePortChannel %s (%p) now has %zu messages pending on port %s", logString().utf8().data(), this, m_pendingMessages[i].size(), remoteTarget.logString().utf8().data());

    if (m_pendingMessages[i].size() == 1) {
        m_pendingMessageProtectors[i] = this;
        return true;
    }

    ASSERT(m_pendingMessageProtectors[i] == this);
    return false;
}

void MessagePortChannel::takeAllMessagesForPort(const MessagePortIdentifier& port, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&& callback)
{
    // LOG(MessagePorts, "MessagePortChannel %p taking all messages for port %s", this, port.logString().utf8().data());

    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;

    if (m_pendingMessages[i].isEmpty()) {
        callback({}, [] {});
        return;
    }

    ASSERT(m_pendingMessageProtectors[i]);

    Vector<MessageWithMessagePorts> result;
    result.swap(m_pendingMessages[i]);

    ++m_messageBatchesInFlight;

    // LOG(MessagePorts, "There are %zu messages to take for port %s. Taking them now, messages in flight is now %" PRIu64, result.size(), port.logString().utf8().data(), m_messageBatchesInFlight);

    callback(WTFMove(result), [this, port, protectedThis = WTFMove(m_pendingMessageProtectors[i])] {
        UNUSED_PARAM(port);
        --m_messageBatchesInFlight;
        // LOG(MessagePorts, "Message port channel %s was notified that a batch of %zu message port messages targeted for port %s just completed dispatch, in flight is now %" PRIu64, logString().utf8().data(), size, port.logString().utf8().data(), m_messageBatchesInFlight);
    });
}

std::optional<MessageWithMessagePorts> MessagePortChannel::tryTakeMessageForPort(const MessagePortIdentifier port)
{
    ASSERT(port == m_ports[0] || port == m_ports[1]);
    size_t i = port == m_ports[0] ? 0 : 1;

    if (m_pendingMessages[i].isEmpty())
        return std::nullopt;

    auto message = m_pendingMessages[i].first();
    m_pendingMessages[i].removeAt(0);
    return WTFMove(message);
}

} // namespace WebCore
