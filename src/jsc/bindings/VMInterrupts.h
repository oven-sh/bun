#pragma once

#include "root.h"
#include <wtf/Deque.h>
#include <wtf/Function.h>
#include <wtf/Lock.h>

namespace JSC {
class VM;
}

namespace Bun {

// Native work for a VM's thread that runs at its next safepoint, also in the middle of synchronous
// script: Node's Environment::RequestInterrupt. A safepoint is where JSC services a VM trap: a JIT or
// LLInt function entry or loop back edge, or a runtime exception check. The work runs with the API
// lock held. It is native only: it may collect and read the heap, it enters no script and throws
// nothing.
//
// Any thread enqueues through the VM's handle (Bun__VmHandle__requestInterrupt), which also fires
// the trap. A trap is serviced only by running script, so a caller that must also reach a VM idle
// in its loop posts a loop task that calls service() (WorkerMessagingProxy). Whichever arrives
// first runs the queue and the other finds it empty. Work still queued when the VM is destroyed is
// dropped unrun. One queue per VM (JSVMClientData::interrupts), so every user of the trap shares
// the process-wide callback slot without conflict.
class VMInterrupts {
    WTF_MAKE_NONCOPYABLE(VMInterrupts);

public:
    using Work = WTF::Function<void(JSC::VM&)>;

    VMInterrupts() = default;

    // Any thread, while the VM is alive (inside its handle's gate).
    void enqueue(std::unique_ptr<Work>);
    // VM thread. Drops the queue once the VM has been asked to stop. Inside a DeferGC scope it runs
    // nothing and asks for the trap again from a timer, so that a later safepoint services it.
    void service(JSC::VM&);

    // JSC's NeedShellTimeoutCheck handler for the whole process, installed by JSCInitialize().
    static void serviceTrap(JSC::VM&);

private:
    Lock m_lock;
    Deque<std::unique_ptr<Work>> m_queue WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace Bun
