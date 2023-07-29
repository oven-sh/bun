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

#include "Connection.h"
#include <WebCore/BroadcastChannelRegistry.h>
#include <WebCore/ClientOrigin.h>
#include <WebCore/PartitionedSecurityOrigin.h>
#include <WebCore/SecurityOrigin.h>
#include <wtf/CallbackAggregator.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>

namespace WebCore {
struct MessageWithMessagePorts;
}

namespace WebKit {

class WebBroadcastChannelRegistry final : public WebCore::BroadcastChannelRegistry {
public:
    static Ref<WebBroadcastChannelRegistry> create()
    {
        return adoptRef(*new WebBroadcastChannelRegistry);
    }

    void registerChannel(const WebCore::PartitionedSecurityOrigin&, const String& name, WebCore::BroadcastChannelIdentifier) final;
    void unregisterChannel(const WebCore::PartitionedSecurityOrigin&, const String& name, WebCore::BroadcastChannelIdentifier) final;
    void postMessage(const WebCore::PartitionedSecurityOrigin&, const String& name, WebCore::BroadcastChannelIdentifier source, Ref<WebCore::SerializedScriptValue>&&, CompletionHandler<void()>&&) final;

    void networkProcessCrashed();

    void didReceiveMessage(IPC::Connection&, IPC::Decoder&);

private:
    WebBroadcastChannelRegistry() = default;

    void postMessageToRemote(const WebCore::ClientOrigin&, const String& name, WebCore::MessageWithMessagePorts&&, CompletionHandler<void()>&&);
    void postMessageLocally(const WebCore::PartitionedSecurityOrigin&, const String& name, std::optional<WebCore::BroadcastChannelIdentifier> sourceInProcess, Ref<WebCore::SerializedScriptValue>&&, Ref<WTF::CallbackAggregator>&&);

    HashMap<WebCore::PartitionedSecurityOrigin, HashMap<String, Vector<WebCore::BroadcastChannelIdentifier>>> m_channelsPerOrigin;
};

} // namespace WebKit
