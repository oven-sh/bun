#pragma once

#include <atomic>

namespace Bun {

// What SigintWatcher notifies of a SIGINT (a NodeVMRunTermination, for a breakOnSigint run).
class SigintReceiver {
public:
    SigintReceiver() = default;

    // From SigintWatcher's signal thread; the receiver reads m_sigintReceived on its own thread.
    void setSigintReceived()
    {
        m_sigintReceived = true;
    }

protected:
    std::atomic<bool> m_sigintReceived = false;
};

} // namespace Bun
