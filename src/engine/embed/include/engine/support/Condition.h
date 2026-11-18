#pragma once

#include "engine/support/Lock.h"
#include "engine/support/Seconds.h"

extern "C" bool Support__Condition__wait(std::atomic<uint32_t>* sequence, uint32_t seen, double seconds);
extern "C" void Support__Condition__wakeAll(std::atomic<uint32_t>* sequence);

namespace WTF {

class Condition final {
    WTF_MAKE_NONCOPYABLE(Condition);
    WTF_MAKE_TZONE_ALLOCATED(Condition);

public:
    constexpr Condition() = default;

    void wait(Lock& lock) WTF_REQUIRES_LOCK(lock) { waitFor(lock, Seconds::infinity()); }

    // False if the time has run out.
    bool waitFor(Lock& lock, Seconds timeout) WTF_REQUIRES_LOCK(lock)
    {
        uint32_t seen = m_sequence.load(std::memory_order_relaxed);
        lock.unlock();
        bool wasNotified = Support__Condition__wait(&m_sequence, seen, timeout.value());
        lock.lock();
        return wasNotified;
    }

    void notifyAll()
    {
        m_sequence.fetch_add(1, std::memory_order_relaxed);
        Support__Condition__wakeAll(&m_sequence);
    }

private:
    std::atomic<uint32_t> m_sequence { 0 };
};

}

using WTF::Condition;
