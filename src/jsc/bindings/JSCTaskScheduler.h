#pragma once

namespace WebCore {
class JSVMClientData;
}

#include <JavaScriptCore/DeferredWorkTimer.h>
#include "BunLoopKind.h"
#include <atomic>

namespace Bun {

// Bun's side of JSC's DeferredWorkTimer (the hook contract is described in
// DeferredWorkTimer.h): each task runs from the event loop that was current
// when its work was registered, and a pending ImminentlyScheduled ticket holds
// the event loop open.
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

    // Set once the owning VM's event loop has taken its last tick. After this,
    // onScheduleWorkSoon drops the task up front instead of posting it (~VM ->
    // WaiterListManager::unregister reaches it for every still-pending
    // Atomics.waitAsync ticket). An early-out, not a fence: a post that races
    // this is handled by the VM handle (released unrun by the teardown, or refused).
    void markShuttingDown() { m_isShuttingDown.store(true, std::memory_order_relaxed); }
    bool isShuttingDown() const { return m_isShuttingDown.load(std::memory_order_relaxed); }

private:
    JSC::VM& m_vm;
    std::atomic<bool> m_isShuttingDown { false };
};

}
