#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include "BunLoopKind.h"

namespace Bun {

// Bun's side of JSC's DeferredWorkTimer (the hook contract is described in
// DeferredWorkTimer.h): each task runs from the event loop that was current
// when its work was registered, and a pending ImminentlyScheduled ticket holds
// the event loop open. The VM handle decides what becomes of a posted task
// (run, released unrun by the teardown, or refused once the VM has closed), so
// there is no state here.
class JSCTaskScheduler {
    WTF_MAKE_NONCOPYABLE(JSCTaskScheduler);

public:
    explicit JSCTaskScheduler(JSC::VM& vm)
        : m_vm(vm)
    {
    }

    JSC::VM& vm() const { return m_vm; }

    static void onAddPendingWork(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket& ticket);
    static void onScheduleWorkSoon(WebCore::JSVMClientData* clientData, Ref<JSC::DeferredWorkTimer::Ticket>&& ticket, JSC::DeferredWorkTimer::Task&& task);
    static void onCancelPendingWork(WebCore::JSVMClientData* clientData, JSC::DeferredWorkTimer::Ticket& ticket);

private:
    JSC::VM& m_vm;
};

}
