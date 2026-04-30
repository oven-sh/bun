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
#include <wtf/ThreadSafeWeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class MessagePortChannelRegistry;

// In WebKit this is RefCountedAndCanMakeWeakPtr because the registry is main-thread-only.
// Bun serializes registry/channel access with a Lock instead (MessagePortChannelRegistry::m_lock),
// so the refcount and weak control block must be atomic — RefPtrs can be released on any thread.
class MessagePortChannel : public ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr<MessagePortChannel> {
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

    Vector<MessageWithMessagePorts> takeAllMessagesForPort(const MessagePortIdentifier&);
    std::optional<MessageWithMessagePorts> tryTakeMessageForPort(const MessagePortIdentifier);

#if !LOG_DISABLED
    String logString() const
    {
        return makeString(m_ports[0].logString(), ":"_s, m_ports[1].logString());
    }
#endif

private:
    MessagePortChannel(MessagePortChannelRegistry&, const MessagePortIdentifier& port1, const MessagePortIdentifier& port2);

    MessagePortIdentifier m_ports[2];
    bool m_isClosed[2] { false, false };
    std::optional<ProcessIdentifier> m_processes[2];
    RefPtr<MessagePortChannel> m_entangledToProcessProtectors[2];
    Vector<MessageWithMessagePorts> m_pendingMessages[2];
    UncheckedKeyHashSet<RefPtr<MessagePortChannel>> m_pendingMessagePortTransfers[2];
    RefPtr<MessagePortChannel> m_pendingMessageProtectors[2];

    MessagePortChannelRegistry& m_registry;
};

} // namespace WebCore
