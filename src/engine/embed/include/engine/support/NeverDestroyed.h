#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"
#include "engine/support/Noncopyable.h"

namespace WTF {

// For a static whose destructor must not run at exit.
template<typename T>
class NeverDestroyed {
    WTF_MAKE_NONCOPYABLE(NeverDestroyed);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    template<typename... Arguments>
    NeverDestroyed(Arguments&&... arguments)
    {
        new (m_storage) T(std::forward<Arguments>(arguments)...);
    }

    NeverDestroyed(NeverDestroyed&& other)
        : NeverDestroyed(WTF::move(other.get()))
    {
    }

    T& get() { return *std::launder(reinterpret_cast<T*>(m_storage)); }
    const T& get() const { return *std::launder(reinterpret_cast<const T*>(m_storage)); }
    operator T&() { return get(); }
    operator const T&() const { return get(); }
    T* operator->() { return std::addressof(get()); }
    const T* operator->() const { return std::addressof(get()); }

private:
    alignas(T) std::byte m_storage[sizeof(T)];
};

template<typename T> NeverDestroyed(T) -> NeverDestroyed<T>;

// The same, constructed when its owner says so.
template<typename T>
class LazyNeverDestroyed {
    WTF_MAKE_NONCOPYABLE(LazyNeverDestroyed);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    LazyNeverDestroyed() = default;

    template<typename... Arguments>
    void construct(Arguments&&... arguments)
    {
#if ASSERT_ENABLED
        ASSERT(!m_isConstructed);
        m_isConstructed = true;
#endif
        new (m_storage) T(std::forward<Arguments>(arguments)...);
    }

    T& get() { return const_cast<T&>(std::as_const(*this).get()); }
    const T& get() const
    {
        ASSERT(m_isConstructed);
        return *std::launder(reinterpret_cast<const T*>(m_storage));
    }
    operator T&() { return get(); }
    operator const T&() const { return get(); }
    T* operator->() { return std::addressof(get()); }
    const T* operator->() const { return std::addressof(get()); }

private:
    // No initializers: a static is zero without any code having run.
#if ASSERT_ENABLED
    bool m_isConstructed;
#endif
    alignas(T) std::byte m_storage[sizeof(T)];
};

}

using WTF::LazyNeverDestroyed;
using WTF::NeverDestroyed;
