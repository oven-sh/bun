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

#include "MessagePortChannel.h"
#include "MessagePortChannelProvider.h"
#include "MessagePortIdentifier.h"
#include "ProcessIdentifier.h"
#include <wtf/HashMap.h>
#include <wtf/CheckedRef.h>

namespace WebCore {

class MessagePortChannelRegistry final : public CanMakeWeakPtr<MessagePortChannelRegistry>, public CanMakeCheckedPtr<MessagePortChannelRegistry> {
    WTF_MAKE_TZONE_ALLOCATED(MessagePortChannelRegistry);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(MessagePortChannelRegistry);

public:
    WEBCORE_EXPORT MessagePortChannelRegistry();

    WEBCORE_EXPORT ~MessagePortChannelRegistry();

    WEBCORE_EXPORT void didCreateMessagePortChannel(const MessagePortIdentifier& port1, const MessagePortIdentifier& port2);
    WEBCORE_EXPORT void didEntangleLocalToRemote(const MessagePortIdentifier& local, const MessagePortIdentifier& remote, ProcessIdentifier);
    WEBCORE_EXPORT void didDisentangleMessagePort(const MessagePortIdentifier& local);
    WEBCORE_EXPORT void didCloseMessagePort(const MessagePortIdentifier& local);
    WEBCORE_EXPORT bool didPostMessageToRemote(MessageWithMessagePorts&&, const MessagePortIdentifier& remoteTarget);
    WEBCORE_EXPORT void takeAllMessagesForPort(const MessagePortIdentifier&, CompletionHandler<void(Vector<MessageWithMessagePorts>&&, CompletionHandler<void()>&&)>&&);
    WEBCORE_EXPORT std::optional<MessageWithMessagePorts> tryTakeMessageForPort(const MessagePortIdentifier&);

    WEBCORE_EXPORT MessagePortChannel* existingChannelContainingPort(const MessagePortIdentifier&);

    WEBCORE_EXPORT void messagePortChannelCreated(MessagePortChannel&);
    WEBCORE_EXPORT void messagePortChannelDestroyed(MessagePortChannel&);

private:
    UncheckedKeyHashMap<MessagePortIdentifier, WeakRef<MessagePortChannel>> m_openChannels;
};

} // namespace WebCore
