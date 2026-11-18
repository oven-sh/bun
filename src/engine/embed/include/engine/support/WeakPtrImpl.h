#pragma once

#include "engine/support/RefCounted.h"
#include "engine/support/Thread.h"
#include "engine/support/ThreadSafeRefCounted.h"

namespace WTF {

namespace Detail {

// What an object shares with the weak pointers to it. It outlives the object.
class WeakReferent {
public:
    template<typename T> typename T::WeakValueType* get() const { return static_cast<typename T::WeakValueType*>(m_object); }
    explicit operator bool() const { return m_object; }
    void clear() { m_object = nullptr; }

#if ENABLE(SECURITY_ASSERTIONS)
    bool isUsableOnCurrentThread() const { return !m_object || m_thread == currentThreadID() || Thread::mayBeGCThread(); }
#endif

protected:
    template<typename T>
    explicit WeakReferent(T* object)
        : m_object(static_cast<typename T::WeakValueType*>(object))
    {
    }

private:
    void* m_object;
#if ENABLE(SECURITY_ASSERTIONS)
    uint32_t m_thread { currentThreadID() };
#endif
};

}

// Any thread may copy and drop the weak pointers.
class DefaultWeakPtrImpl final : public ThreadSafeRefCounted<DefaultWeakPtrImpl>, public Detail::WeakReferent {
public:
    template<typename T>
    explicit DefaultWeakPtrImpl(T* object)
        : WeakReferent(object)
    {
    }
};

template<typename Derived>
class WeakPtrImplBaseSingleThread : public RefCounted<Derived>, public Detail::WeakReferent {
public:
    template<typename T>
    explicit WeakPtrImplBaseSingleThread(T* object)
        : WeakReferent(object)
    {
    }
};

}
