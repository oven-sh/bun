#pragma once

#include <atomic>

namespace Bun {

class SigintReceiver {
public:
    SigintReceiver() = default;

    // Set from SigintWatcher's signal thread, read on the receiver's own thread.
    void setSigintReceived(bool value = true)
    {
        m_sigintReceived = value;
    }

    bool getSigintReceived()
    {
        return m_sigintReceived;
    }

protected:
    std::atomic<bool> m_sigintReceived = false;
};

} // namespace Bun
