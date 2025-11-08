#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "MessagePortChannelProviderImpl.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WorkerGlobalScope);

MessagePortChannelProvider& WorkerGlobalScope::messagePortChannelProvider()
{
    return *reinterpret_cast<MessagePortChannelProvider*>(&MessagePortChannelProviderImpl::singleton());
}

void WorkerGlobalScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<WorkerGlobalScope&>(self);
        auto* context = global.scriptExecutionContext();
        // Only ref/unref the event loop if we're in a worker thread, not the main thread.
        // In the main thread, onmessage handlers shouldn't keep the process alive.
        bool shouldRefEventLoop = context && !context->isMainThread();

        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0 && shouldRefEventLoop) {
                context->refEventLoop();
            }
            global.m_messageEventCount++;
            break;
        case Remove:
            global.m_messageEventCount--;
            if (global.m_messageEventCount == 0 && shouldRefEventLoop) {
                context->unrefEventLoop();
            }
            break;
        // I dont think clear in this context is ever called. If it is (search OnDidChangeListenerKind::Clear for the impl),
        // it may actually call once per event, in a way the Remove code above would suffice.
        case Clear:
            if (global.m_messageEventCount > 0 && shouldRefEventLoop) {
                context->unrefEventLoop();
            }
            global.m_messageEventCount = 0;
            break;
        }
    }
};

}
