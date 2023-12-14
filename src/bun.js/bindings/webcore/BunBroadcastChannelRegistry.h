#pragma once

#include "BroadcastChannelRegistry.h"
#include <wtf/CallbackAggregator.h>
#include <wtf/Vector.h>
#include <wtf/HashMap.h>

namespace WebCore {

struct MessageWithMessagePorts;

class BunBroadcastChannelRegistry final : public BroadcastChannelRegistry {
public:
    BunBroadcastChannelRegistry() = default;
    static Ref<BunBroadcastChannelRegistry> create()
    {
        return adoptRef(*new BunBroadcastChannelRegistry);
    }

    void registerChannel(const String& name, BroadcastChannelIdentifier) final;
    void unregisterChannel(const String& name, BroadcastChannelIdentifier) final;
    void postMessage(const String& name, BroadcastChannelIdentifier source, Ref<SerializedScriptValue>&&) final;

    // void didReceivedMessage(IPC::Connection&, IPC::Decoder&);

    HashMap<String, Vector<BroadcastChannelIdentifier>> m_channelsForName;

private:
    void postMessageToRemote(const String& name, MessageWithMessagePorts&&);
    void postMessageLocally(const String& name, BroadcastChannelIdentifier sourceInProgress, Ref<SerializedScriptValue>&&);
};

}
