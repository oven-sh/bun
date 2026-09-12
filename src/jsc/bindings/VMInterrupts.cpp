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
    // Asked to stop: nothing more is answered from this VM (Node's is_stopping). A worker's parent
    // rejects its requests once the thread is gone.
    if (clientData.isStoppingOrStopped(vm)) {
        Locker locker { m_lock };
        m_queue.clear();
        return;
    }
    // A trap is also serviced from the runtime's exception checks, which can sit inside a DeferGC
    // scope (a cell allocated but not yet reachable from a root). A collection there is the one
    // DeferGC exists to prevent, and a heap snapshot is a full collection. The request cannot be
    // made again from here (handleTraps loops while a trap bit is set), so a timer makes it.
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

// The VM's handle (src/jsc/VmHandle.rs) enqueues inside its gate, where the VM is alive, and drops
// what it refuses once the VM is closed.
extern "C" void Bun__VMInterrupts__enqueue(JSC::VM* vm, Bun::VMInterrupts::Work* work)
{
    WebCore::clientData(*vm)->interrupts.enqueue(std::unique_ptr<Bun::VMInterrupts::Work>(work));
}

extern "C" void Bun__VMInterrupts__drop(Bun::VMInterrupts::Work* work)
{
    delete work;
}

// The loop task the handle posts beside the trap: the way to a VM idle in its loop, where no script
// services the trap.
extern "C" WebCore::EventLoopTask* Bun__VMInterrupts__createServiceTask()
{
    return new WebCore::EventLoopTask([](WebCore::ScriptExecutionContext& context) {
        auto& vm = context.vm();
        // Once the queue is empty the trap has no script left to service it, and an unserviced trap
        // keeps JSC's signal sender suspending this thread every 1ms for as long as the VM holds its
        // API lock, which a worker does for its whole life. Cleared before the drain: a request that
        // lands after this sets it again and is either drained below or serviced later.
        vm.traps().clearTrap(JSC::VMTraps::NeedShellTimeoutCheck);
        WebCore::clientData(vm)->interrupts.service(vm);
    });
}
