#pragma once

#include <atomic>

namespace Bun {

// `m_sigintReceived` is written by the SigintWatcher thread and read by the VM
// thread, so it has to be atomic.
class SigintReceiver {
public:
    SigintReceiver() = default;

    void setSigintReceived(bool value = true)
    {
        m_sigintReceived.store(value, std::memory_order_relaxed);
    }

    bool getSigintReceived() const
    {
        return m_sigintReceived.load(std::memory_order_relaxed);
    }

protected:
    std::atomic<bool> m_sigintReceived = false;
};

} // namespace Bun
