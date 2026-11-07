#include "root.h"
#include "VMInterrupts.h"
#include "BunClientData.h"
#include "EventLoopTask.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/Heap.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/VMTraps.h>

namespace Bun {

void VMInterrupts::enqueue(std::unique_ptr<Work> work)
{
    Locker locker { m_lock };
    m_queue.append(WTF::move(work));
}

void VMInterrupts::service(JSC::VM& vm)
{
    ASSERT(vm.currentThreadIsHoldingAPILock());
    auto& clientData = *WebCore::clientData(vm);
    // Asked to stop: nothing more is answered (Node's is_stopping).
    if (clientData.isStoppingOrStopped(vm)) {
        Locker locker { m_lock };
        m_queue.clear();
        return;
    }
    // A trap is also serviced from exception checks inside DeferGC scopes, where the work's full
    // collection is unsafe. handleTraps loops while a trap bit is set, so a timer asks again.
    if (vm.heap.isDeferred()) {
        JSC::VMTraps::queue().dispatchAfter(1_ms, [vmHandle = Bun__VmHandle__retainRef(clientData.vmHandle)] {
            Bun__VmHandle__requestInterrupt(vmHandle, nullptr);
            Bun__VmHandle__release(vmHandle);
        });
        return;
    }
    Deque<std::unique_ptr<Work>> queue;
    {
        Locker locker { m_lock };
        queue = std::exchange(m_queue, {});
    }
    for (auto& work : queue)
        (*work)(vm);
}

void VMInterrupts::serviceTrap(JSC::VM& vm)
{
    WebCore::clientData(vm)->interrupts.service(vm);
}

} // namespace Bun

// Called by the VM's handle (src/jsc/VmHandle.rs) inside its gate, where the VM is alive.
extern "C" void Bun__VMInterrupts__enqueue(JSC::VM* vm, Bun::VMInterrupts::Work* work)
{
    WebCore::clientData(*vm)->interrupts.enqueue(std::unique_ptr<Bun::VMInterrupts::Work>(work));
}

extern "C" void Bun__VMInterrupts__drop(Bun::VMInterrupts::Work* work)
{
    delete work;
}

// The loop task the handle posts beside the trap, for a VM idle in its loop.
extern "C" WebCore::EventLoopTask* Bun__VMInterrupts__createServiceTask()
{
    return new WebCore::EventLoopTask([](WebCore::ScriptExecutionContext& context) {
        auto& vm = context.vm();
        // An unserviced trap keeps JSC's signal sender suspending this thread every 1ms while it
        // holds the API lock, which a worker does for life. Cleared before the drain, so a request
        // that lands after this is still serviced.
        vm.traps().clearTrap(JSC::VMTraps::NeedShellTimeoutCheck);
        WebCore::clientData(vm)->interrupts.service(vm);
    });
}
