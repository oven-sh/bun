#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Noncopyable.h"

#include <atomic>

namespace WTF {

template<typename T>
class ThreadSafeRefCounted {
    WTF_MAKE_NONCOPYABLE(ThreadSafeRefCounted);
    WTF_MAKE_TZONE_ALLOCATED(ThreadSafeRefCounted);

public:
    // Half of the range is left for the threads that count on while this one crashes.
    void ref() const { RELEASE_ASSERT(static_cast<int32_t>(m_refCount.fetch_add(1, std::memory_order_relaxed) + 1) >= 0); }

    void deref() const
    {
        if (m_refCount.fetch_sub(1, std::memory_order_acq_rel) != 1) [[likely]]
            return;
        // So that the destructor can take references and give them back.
        m_refCount.store(1, std::memory_order_relaxed);
        delete static_cast<const T*>(this);
    }

    bool hasOneRef() const { return m_refCount.load(std::memory_order_acquire) == 1; }
    uint32_t refCount() const { return m_refCount.load(std::memory_order_relaxed); }

protected:
    ThreadSafeRefCounted() = default;
    ~ThreadSafeRefCounted() { RELEASE_ASSERT(refCount() == 1); }

private:
    mutable std::atomic<uint32_t> m_refCount { 1 };
};

}

using WTF::ThreadSafeRefCounted;
