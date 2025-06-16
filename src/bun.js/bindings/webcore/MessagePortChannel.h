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

#pragma once

#include "MessagePortChannelProvider.h"
#include "MessagePortIdentifier.h"
#include "MessageWithMessagePorts.h"
#include "ProcessIdentifier.h"
#include <wtf/HashSet.h>
#include <wtf/RefCountedAndCanMakeWeakPtr.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class MessagePortChannelRegistry;

class MessagePortChannel : public RefCountedAndCanMakeWeakPtr<MessagePortChannel> {
public:
    static Ref<MessagePortChannel> create(MessagePortChannelRegistry&, const MessagePortIdentifier& port1, const MessagePortIdentifier& port2);

    ~MessagePortChannel();

    const MessagePortIdentifier& port1() const { return m_ports[0]; }
    const MessagePortIdentifier& port2() const { return m_ports[1]; }

    WEBCORE_EXPORT std::optional<ProcessIdentifier> processForPort(const MessagePortIdentifier&);
    bool includesPort(const MessagePortIdentifier&);
    void entanglePortWithProcess(const MessagePortIdentifier&, ProcessIdentifier);
    void disentanglePort(const MessagePortIdentifier&);
    void closePort(const MessagePortIdentifier&);
    bool postMessageToRemote(MessageWithMessagePorts&&, const MessagePortIdentifier& remoteTarget);

    void takeAllMessagesForPort(const MessagePortIdentifier&, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&&);
    void tryTakeMessageForPort(const MessagePortIdentifier, CompletionHandler<void(std::optional<MessageWithMessagePorts>&&)>&&);

    WEBCORE_EXPORT bool hasAnyMessagesPendingOrInFlight() const;

    uint64_t beingTransferredCount();

#if !LOG_DISABLED
    String logString() const { return makeString(m_ports[0].logString(), ':', m_ports[1].logString()); }
#endif

private:
    MessagePortChannel(MessagePortChannelRegistry&, const MessagePortIdentifier& port1, const MessagePortIdentifier& port2);

    CheckedRef<MessagePortChannelRegistry> checkedRegistry() const;

    std::array<MessagePortIdentifier, 2> m_ports;
    std::array<bool, 2> m_isClosed { false, false };
    std::array<std::optional<ProcessIdentifier>, 2> m_processes;
    std::array<RefPtr<MessagePortChannel>, 2> m_entangledToProcessProtectors;
    std::array<Vector<MessageWithMessagePorts>, 2> m_pendingMessages;
    std::array<UncheckedKeyHashSet<RefPtr<MessagePortChannel>>, 2> m_pendingMessagePortTransfers;
    std::array<RefPtr<MessagePortChannel>, 2> m_pendingMessageProtectors;
    uint64_t m_messageBatchesInFlight { 0 };

    CheckedRef<MessagePortChannelRegistry> m_registry;
};

} // namespace WebCore