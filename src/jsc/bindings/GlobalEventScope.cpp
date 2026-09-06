#include "config.h"

#include "GlobalEventScope.h"
#include "BunClientData.h"
#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalEventScope);

// A 'message' listener on the global scope holds the event loop open only in a worker, where the
// parent can still post to it. The main thread has no parent, so the listener can never fire.
void GlobalEventScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType != eventNames().messageEvent)
        return;
    auto& global = static_cast<GlobalEventScope&>(self);
    auto* context = global.scriptExecutionContext();
    if (!context || !WebCore::clientData(context->vm())->isWorkerVM())
        return;

    switch (kind) {
    case Add:
        if (global.m_messageEventCount == 0)
            context->refEventLoop();
        global.m_messageEventCount++;
        break;
    case Remove:
        global.m_messageEventCount--;
        if (global.m_messageEventCount == 0)
            context->unrefEventLoop();
        break;
    case Clear:
        if (global.m_messageEventCount > 0)
            context->unrefEventLoop();
        global.m_messageEventCount = 0;
        break;
    }
};

}
