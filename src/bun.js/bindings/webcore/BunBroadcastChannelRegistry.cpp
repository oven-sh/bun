#include "config.h"

#include "BunBroadcastChannelRegistry.h"
#include "webcore/BroadcastChannel.h"
#include "webcore/MessageWithMessagePorts.h"
#include <wtf/CallbackAggregator.h>

namespace WebCore {

void BunBroadcastChannelRegistry::registerChannel(const String& name, BroadcastChannelIdentifier identifier)
{
    auto& channels = m_channelsForName.ensure(name, [] { return Vector<BroadcastChannelIdentifier> {}; }).iterator->value;
    channels.append(identifier);
}

void BunBroadcastChannelRegistry::unregisterChannel(const String& name, BroadcastChannelIdentifier identifier)
{
    auto channels = m_channelsForName.find(name);
    if (channels == m_channelsForName.end())
        return;

    auto& channelIds = channels->value;
    channelIds.removeFirst(identifier);
}

void BunBroadcastChannelRegistry::postMessage(const String& name, BroadcastChannelIdentifier source, Ref<SerializedScriptValue>&& message)
{
    postMessageLocally(name, source, message.copyRef());
}

void BunBroadcastChannelRegistry::postMessageLocally(const String& name, BroadcastChannelIdentifier sourceInProcess, Ref<SerializedScriptValue>&& message)
{
    auto channels = m_channelsForName.find(name);
    if (channels == m_channelsForName.end())
        return;

    auto& channelIds = channels->value;
    for (auto& channelId : channelIds) {
        if (channelId == sourceInProcess)
            continue;

        BroadcastChannel::dispatchMessageTo(channelId, message.copyRef());
    }
}

void BunBroadcastChannelRegistry::postMessageToRemote(const String& name, MessageWithMessagePorts&& message)
{
    // auto callbackAggregator = CallbackAggregator::create(WTF::move(completionHandler));
    // PartitionedSecurityOrigin origin { clientOrigin.topOrigin.securityOrigin(), clientOrigin.clientOrigin.securityOrigin() };
    // postMessageLocally(origin, name, std::nullopt, *message.message, callbackAggregator.copyRef());
}
}
