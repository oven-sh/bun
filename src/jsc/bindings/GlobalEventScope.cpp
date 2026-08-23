#include "config.h"

#include "GlobalEventScope.h"
#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include "WorkerMessagingProxy.h"
#include "ZigGlobalObject.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

extern "C" WorkerMessagingProxy* WebWorker__getMessagingProxy(void* bunVM);

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalEventScope);

void GlobalEventScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<GlobalEventScope&>(self);
        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0) {
                global.scriptExecutionContext()->refEventLoop();
                // The first 'message' listener enables the implicit port's message queue (HTML's
                // onmessage setter does this): release messages the inbox drain parked while the
                // entry module was still evaluating.
                if (auto* jsGlobalObject = global.scriptExecutionContext()->globalObject()) {
                    if (auto* proxy = WebWorker__getMessagingProxy(defaultGlobalObject(jsGlobalObject)->bunVM()))
                        proxy->scheduleDrainToWorkerGlobalScope();
                }
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
