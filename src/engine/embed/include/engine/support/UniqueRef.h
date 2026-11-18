#pragma once

#include "engine/support/Forward.h"
#include "engine/support/StdLibExtras.h"

namespace WTF {

// Owns an object, unless it has been moved from.
template<typename T>
class UniqueRef {
public:
    explicit UniqueRef(T& object)
        : m_ptr(&object)
    {
    }

    template<typename U>
    UniqueRef(UniqueRef<U>&& other)
        : m_ptr(WTF::move(other.m_ptr))
    {
        ASSERT(m_ptr);
    }

    T* ptr() const LIFETIME_BOUND RETURNS_NONNULL
    {
        ASSERT(m_ptr);
        return m_ptr.get();
    }
    T& get() const LIFETIME_BOUND { return *ptr(); }
    T* operator->() const LIFETIME_BOUND { return ptr(); }
    operator T&() const LIFETIME_BOUND { return get(); }

private:
    template<typename> friend class UniqueRef;

    std::unique_ptr<T> m_ptr;
};

template<typename T, typename... Arguments>
[[nodiscard]] UniqueRef<T> makeUniqueRefWithoutFastMallocCheck(Arguments&&... arguments)
{
    return UniqueRef<T>(*new T(std::forward<Arguments>(arguments)...));
}

template<typename T, typename... Arguments>
[[nodiscard]] UniqueRef<T> makeUniqueRef(Arguments&&... arguments)
{
    static_assert(IsFastAllocated<T>, "T lacks WTF_MAKE_TZONE_ALLOCATED");
    static_assert(!IsRefCounted<T>, "Use adoptRef()");
    return makeUniqueRefWithoutFastMallocCheck<T>(std::forward<Arguments>(arguments)...);
}

}

using WTF::makeUniqueRef;
using WTF::makeUniqueRefWithoutFastMallocCheck;
using WTF::UniqueRef;
