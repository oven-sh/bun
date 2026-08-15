#pragma once

#include <atomic>

namespace JSC {
class VM;
}

namespace Bun {

// What SigintWatcher notifies of a SIGINT: a NodeVMRunTermination, for a breakOnSigint run. The watcher's
// signal thread records the SIGINT on the receiver and requests its VM's termination in one step, under
// the watcher's lock; the receiver reads m_sigintReceived on its own thread once it has unregistered.
class SigintReceiver {
public:
    explicit SigintReceiver(JSC::VM& vm)
        : m_sigintVM(vm)
    {
    }

    JSC::VM& sigintVM() const { return m_sigintVM; }
    void setSigintReceived() { m_sigintReceived = true; }

protected:
    JSC::VM& m_sigintVM;
    std::atomic<bool> m_sigintReceived = false;
};

} // namespace Bun
