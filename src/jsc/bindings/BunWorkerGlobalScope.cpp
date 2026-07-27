#include "config.h"

#include "BunWorkerGlobalScope.h"
#include "ZigGlobalObject.h"
#include "webcore/Worker.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" WebCore::Worker* WebWorker__getParentWorker(void* bunVM);

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(WorkerGlobalScope);

void WorkerGlobalScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<WorkerGlobalScope&>(self);
        switch (kind) {
        case Add:
            if (global.m_messageEventCount == 0) {
                auto* ctx = global.scriptExecutionContext();
                ctx->refEventLoop();
                // node parentPort only: the first 'message' listener starts the
                // parent→worker inbox so messages the parent posted before this
                // add are delivered instead of dispatched into the void. Web
                // workers start unconditionally in dispatchOnline (HTML spec:
                // the implicit port is enabled after entry eval regardless of
                // listeners), so a listener-less Web worker doesn't accumulate.
                if (auto* worker = WebWorker__getParentWorker(bunVM(ctx->jsGlobalObject()))) {
                    if (worker->options().kind == WorkerOptions::Kind::Node)
                        worker->startWorkerInbox();
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
