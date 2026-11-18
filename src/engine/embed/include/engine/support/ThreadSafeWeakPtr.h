#pragma once

#include "engine/support/RefPtr.h"
#include "engine/support/ThreadSafeRefCounted.h"

namespace WTF {

namespace Detail {

// Counts the strong references to an object. The object and each weak pointer hold a reference to it.
class ThreadSafeWeakPtrControlBlock final : public ThreadSafeRefCounted<ThreadSafeWeakPtrControlBlock> {
public:
    void strongRef() { RELEASE_ASSERT((m_strongCount.fetch_add(1, std::memory_order_relaxed) & ~isDyingFlag) < countLimit); }

    // Whether the caller has to destroy the object.
    bool strongDeref()
    {
        if (m_strongCount.fetch_sub(1, std::memory_order_acq_rel) != 1) [[likely]]
            return false;
        // So that the destructor can take references and give them back.
        m_strongCount.store(isDyingFlag | 1, std::memory_order_relaxed);
        return true;
    }

    bool strongRefIfAlive()
    {
        uint32_t count = m_strongCount.load(std::memory_order_relaxed);
        do {
            if (!count || count & isDyingFlag)
                return false;
            RELEASE_ASSERT(count < countLimit);
        } while (!m_strongCount.compare_exchange_weak(count, count + 1, std::memory_order_acquire, std::memory_order_relaxed));
        return true;
    }

    uint32_t strongCount() const { return m_strongCount.load(std::memory_order_acquire) & ~isDyingFlag; }

private:
    static constexpr uint32_t isDyingFlag = 1u << 31;
    static constexpr uint32_t countLimit = 1u << 30;

    std::atomic<uint32_t> m_strongCount { 1 };
};

}

template<typename T>
class ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr {
    WTF_MAKE_NONCOPYABLE(ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr);
    WTF_MAKE_TZONE_ALLOCATED(ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr);

public:
    void ref() const { m_controlBlock->strongRef(); }

    void deref() const
    {
        if (m_controlBlock->strongDeref())
            delete static_cast<const T*>(this);
    }

    uint32_t refCount() const { return m_controlBlock->strongCount(); }
    bool hasOneRef() const { return refCount() == 1; }

protected:
    ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr() = default;
    ~ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr() { RELEASE_ASSERT(hasOneRef()); }

private:
    template<typename> friend class ThreadSafeWeakPtr;

    const Ref<Detail::ThreadSafeWeakPtrControlBlock> m_controlBlock { adoptRef(*new Detail::ThreadSafeWeakPtrControlBlock) };
};

// Any thread may ask for the object while another drops it. Assigning to one that other threads read takes a lock of the caller's.
template<typename T>
class ThreadSafeWeakPtr {
public:
    ThreadSafeWeakPtr() = default;
    ThreadSafeWeakPtr(std::nullptr_t) {}

    ThreadSafeWeakPtr(const T& object)
        : m_controlBlock(object.m_controlBlock.ptr())
        , m_object(const_cast<T*>(&object))
    {
    }

    RefPtr<T> get() const
    {
        if (!m_controlBlock || !m_controlBlock->strongRefIfAlive())
            return nullptr;
        return adoptRef(m_object);
    }

private:
    RefPtr<Detail::ThreadSafeWeakPtrControlBlock> m_controlBlock;
    T* m_object { nullptr };
};

}

using WTF::ThreadSafeRefCountedAndCanMakeThreadSafeWeakPtr;
using WTF::ThreadSafeWeakPtr;
