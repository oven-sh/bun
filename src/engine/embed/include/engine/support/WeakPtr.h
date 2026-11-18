#pragma once

#include "engine/support/CanMakeWeakPtr.h"
#include "engine/support/RefPtr.h"

namespace WTF {

enum class EnableWeakPtrThreadingAssertions : bool { No,
    Yes };

// Becomes null when the object is destroyed. Only the thread of the object may follow it.
template<typename T, typename Impl>
class WeakPtr {
    WTF_MAKE_TZONE_ALLOCATED(WeakPtr);

public:
    WeakPtr() = default;
    WeakPtr(std::nullptr_t) {}

    WeakPtr(const T* object, [[maybe_unused]] EnableWeakPtrThreadingAssertions assertions = EnableWeakPtrThreadingAssertions::Yes)
        : m_impl(object ? &object->weakImpl() : nullptr)
#if ENABLE(SECURITY_ASSERTIONS)
        , m_allowsAnyThread(assertions == EnableWeakPtrThreadingAssertions::No)
#endif
    {
    }

    WeakPtr(const T& object)
        : m_impl(object.weakImpl())
    {
    }

    WeakPtr(const Ref<T>& object)
        : WeakPtr(object.get())
    {
    }

    WeakPtr& operator=(std::nullptr_t)
    {
        m_impl = nullptr;
        return *this;
    }

    T* get() const
    {
        ASSERT_WITH_SECURITY_IMPLICATION(!m_impl || m_allowsAnyThread || m_impl->isUsableOnCurrentThread());
        return m_impl ? static_cast<T*>(m_impl->template get<T>()) : nullptr;
    }
    operator T*() const { return get(); }

    T* operator->() const
    {
        T* object = get();
        RELEASE_ASSERT(object);
        return object;
    }
    T& operator*() const { return *operator->(); }

    explicit operator bool() const { return m_impl && *m_impl; }
    bool operator!() const { return !m_impl || !*m_impl; }

    void clear() { m_impl = nullptr; }

private:
    RefPtr<Impl> m_impl;
#if ENABLE(SECURITY_ASSERTIONS)
    bool m_allowsAnyThread { false };
#endif
};

template<typename T> WeakPtr(const T*, EnableWeakPtrThreadingAssertions = EnableWeakPtrThreadingAssertions::Yes) -> WeakPtr<T, typename T::WeakPtrImplType>;
template<typename T> WeakPtr(const T&) -> WeakPtr<T, typename T::WeakPtrImplType>;
template<typename T> WeakPtr(const Ref<T>&) -> WeakPtr<T, typename T::WeakPtrImplType>;

}

using WTF::EnableWeakPtrThreadingAssertions;
using WTF::WeakPtr;
