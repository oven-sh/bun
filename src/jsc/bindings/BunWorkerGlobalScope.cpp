#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "webcore/Worker.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WorkerGlobalScope);

void WorkerGlobalScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<WorkerGlobalScope&>(self);
        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0) {
                global.scriptExecutionContext()->refEventLoop();
                // node:worker_threads parentPort: messages the parent posted while
                // there was no listener are held in the Worker's m_toWorker inbox
                // (drainToWorker leaves them there). First listener arriving
                // schedules the flush. No-op on the main thread and for Web Workers.
                scheduleParentPortDrainIfNode(global.scriptExecutionContext());
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
