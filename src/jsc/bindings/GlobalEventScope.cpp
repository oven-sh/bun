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
