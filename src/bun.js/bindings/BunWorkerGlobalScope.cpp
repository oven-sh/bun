#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "MessagePortChannelProviderImpl.h"

namespace WebCore {

WTF_MAKE_ISO_ALLOCATED_IMPL(GlobalScope);

MessagePortChannelProvider& GlobalScope::messagePortChannelProvider()
{
    return *reinterpret_cast<MessagePortChannelProvider*>(&MessagePortChannelProviderImpl::singleton());
}

void GlobalScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<GlobalScope&>(self);
        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0) {
                global.scriptExecutionContext()->refEventLoop();
            }
            global.m_messageEventCount++;
            break;
        case Remove:
            global.m_messageEventCount--;
            if (global.m_messageEventCount == 0) {
                global.scriptExecutionContext()->unrefEventLoop();
            }
            break;
        // I dont think clear in this context is ever called. If it is (search OnDidChangeListenerKind::Clear for the impl),
        // it may actually call once per event, in a way the Remove code above would suffice.
        case Clear:
            if (global.m_messageEventCount > 0) {
                global.scriptExecutionContext()->unrefEventLoop();
            }
            global.m_messageEventCount = 0;
            break;
        }
    }
};

}