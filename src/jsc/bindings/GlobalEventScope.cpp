#include "config.h"

#include "GlobalEventScope.h"
#include "BunClientData.h"
#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalEventScope);

void GlobalEventScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<GlobalEventScope&>(self);
        auto* context = global.scriptExecutionContext();
        // Only a worker has a parent that can post to its global scope; on the main thread this
        // listener can never fire, so it must not hold the event loop open.
        if (!context || !clientData(context->vm())->isWorkerVM())
            return;
        switch (kind) {
        case Add:
            global.m_messageEventCount++;
            break;
        case Remove:
            global.m_messageEventCount--;
            break;
        case Clear:
            global.m_messageEventCount = 0;
            break;
        }
        global.m_keepAlive.setActive(global.m_messageEventCount > 0);
    }
};

}
