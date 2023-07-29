#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "MessagePortChannelProviderImpl.h"

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(GlobalScope);

MessagePortChannelProvider& GlobalScope::messagePortChannelProvider()
{
    return *reinterpret_cast<MessagePortChannelProvider*>(&MessagePortChannelProviderImpl::singleton());
}
}