#pragma once

namespace Bun {

class SigintReceiver {
public:
    SigintReceiver() = default;

    void setSigintReceived(bool value = true)
    {
        m_sigintReceived = value;
    }

    bool getSigintReceived()
    {
        return m_sigintReceived;
    }

protected:
    bool m_sigintReceived = false;
};

} // namespace Bun
