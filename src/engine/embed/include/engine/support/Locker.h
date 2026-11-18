#pragma once

#include "engine/support/Lock.h"

namespace WTF {

enum NoLockingNecessaryTag { NoLockingNecessary };

// A parameter that shows that the caller holds a lock.
class AbstractLocker {
    WTF_MAKE_NONCOPYABLE(AbstractLocker);

protected:
    AbstractLocker() = default;
};

template<typename T>
class WTF_CAPABILITY_SCOPED_LOCK Locker : public AbstractLocker {
public:
    [[nodiscard]] explicit Locker(T& lock) WTF_ACQUIRES_LOCK(lock)
        : m_lock(&lock)
    {
        lock.lock();
    }

    ~Locker() WTF_RELEASES_LOCK()
    {
        if (m_lock)
            m_lock->unlock();
    }

    void unlockEarly() WTF_RELEASES_LOCK()
    {
        ASSERT(m_lock);
        std::exchange(m_lock, nullptr)->unlock();
    }

private:
    T* m_lock;
};

}

using WTF::AbstractLocker;
using WTF::Locker;
using WTF::NoLockingNecessary;
using WTF::NoLockingNecessaryTag;
