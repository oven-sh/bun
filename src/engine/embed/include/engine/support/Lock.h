#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"
#include "engine/support/Noncopyable.h"
#include "engine/support/ThreadSafetyAnalysis.h"

#include <atomic>

extern "C" void Support__Lock__lockSlow(std::atomic<uint32_t>*);
extern "C" void Support__Lock__wakeOne(std::atomic<uint32_t>*);

namespace WTF {

class WTF_CAPABILITY_LOCK Lock {
    WTF_MAKE_NONCOPYABLE(Lock);
    WTF_MAKE_TZONE_ALLOCATED(Lock);

public:
    constexpr Lock() = default;

    void lock() WTF_ACQUIRES_LOCK()
    {
        if (!tryLock()) [[unlikely]]
            Support__Lock__lockSlow(&m_state);
    }

    bool tryLock() WTF_ACQUIRES_LOCK_IF(true)
    {
        uint32_t expected = unlocked;
        return m_state.compare_exchange_strong(expected, locked, std::memory_order_acquire, std::memory_order_relaxed);
    }

    void unlock() WTF_RELEASES_LOCK()
    {
        ASSERT(isLocked());
        if (m_state.exchange(unlocked, std::memory_order_release) != locked) [[unlikely]]
            Support__Lock__wakeOne(&m_state);
    }

    bool isLocked() const { return m_state.load(std::memory_order_relaxed) != unlocked; }

private:
    // The states of support/lock.rs.
    static constexpr uint32_t unlocked = 0;
    static constexpr uint32_t locked = 1;

    std::atomic<uint32_t> m_state { unlocked };
};

}

using WTF::Lock;
