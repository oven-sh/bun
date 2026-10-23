#pragma once

#include "root.h"
#include <wtf/Deque.h>
#include <wtf/Function.h>
#include <wtf/Lock.h>

namespace JSC {
class VM;
}

namespace Bun {

// Native work for a VM's thread, run at its next safepoint also in the middle of synchronous script
// (Node's Environment::RequestInterrupt). The work runs with the API lock held; it may collect and
// read the heap, it enters no script and throws nothing. Any thread enqueues through the VM's handle
// (Bun__VmHandle__requestInterrupt), which fires the NeedShellTimeoutCheck trap for running script
// and posts a loop task for an idle VM; the first to arrive runs the queue. One queue per VM.
class VMInterrupts {
    WTF_MAKE_NONCOPYABLE(VMInterrupts);

public:
    using Work = WTF::Function<void(JSC::VM&)>;

    VMInterrupts() = default;

    // Any thread, while the VM is alive (inside its handle's gate).
    void enqueue(std::unique_ptr<Work>);
    // VM thread.
    void service(JSC::VM&);

    // JSC's NeedShellTimeoutCheck handler for the whole process, installed by JSCInitialize().
    static void serviceTrap(JSC::VM&);

private:
    Lock m_lock;
    Deque<std::unique_ptr<Work>> m_queue WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace Bun
