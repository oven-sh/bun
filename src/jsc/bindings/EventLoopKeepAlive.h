#pragma once

#include <wtf/Noncopyable.h>
#include <wtf/Threading.h>

extern "C" void Bun__eventLoop__setKeptAlive(bool);

namespace Bun {

// Keeps the event loop of this thread's VM alive while it is active. An inactive one can be destroyed on any thread.
class EventLoopKeepAlive {
    WTF_MAKE_NONCOPYABLE(EventLoopKeepAlive);

public:
    EventLoopKeepAlive() = default;
    ~EventLoopKeepAlive() { setActive(false); }

    bool isActive() const { return m_isActive; }
    void setActive(bool isActive)
    {
        if (m_isActive == isActive)
            return;
#if ASSERT_ENABLED
        uint32_t thread = Thread::currentSingleton().uid();
        ASSERT(isActive || m_thread == thread);
        m_thread = thread;
#endif
        m_isActive = isActive;
        Bun__eventLoop__setKeptAlive(isActive);
    }

private:
    bool m_isActive { false };
#if ASSERT_ENABLED
    uint32_t m_thread { 0 };
#endif
};

}
