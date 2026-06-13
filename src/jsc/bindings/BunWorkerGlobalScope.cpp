#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "ScriptExecutionContext.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WorkerGlobalScope);

void WorkerGlobalScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<WorkerGlobalScope&>(self);
        auto* context = global.scriptExecutionContext();
        // Inside a worker, a `message` listener on the global scope keeps the
        // event loop alive so the worker can receive messages from its parent.
        // Outside a worker — the main thread, or a ShadowRealm (which gets its
        // own ScriptExecutionContext but is never the target of parent
        // messages) — there is nothing to wait for, so
        // `globalThis.onmessage = ...` / addEventListener("message", ...) must
        // not prevent the process from exiting.
        // https://github.com/oven-sh/bun/issues/24256
        if (!context || !context->isWorker)
            return;
        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0) {
                context->refEventLoop();
            }
            global.m_messageEventCount++;
            break;
        case Remove:
            global.m_messageEventCount--;
            if (global.m_messageEventCount == 0) {
                context->unrefEventLoop();
            }
            break;
        // I dont think clear in this context is ever called. If it is (search OnDidChangeListenerKind::Clear for the impl),
        // it may actually call once per event, in a way the Remove code above would suffice.
        case Clear:
            if (global.m_messageEventCount > 0) {
                context->unrefEventLoop();
            }
            global.m_messageEventCount = 0;
            break;
        }
    }
};

}
