#pragma once

#include "engine/support/Ref.h"

namespace WTF {

template<typename T, typename PtrTraits = RawPtrTraits<T>, typename RefDerefTraits = DefaultRefDerefTraits<T>>
RefPtr<T, PtrTraits, RefDerefTraits> adoptRef(T*);

// Holds a reference to an object, or is null.
template<typename T, typename PtrTraits, typename RefDerefTraits>
class TRIVIAL_ABI RefPtr {
    WTF_FORBID_HEAP_ALLOCATION_ALLOWING_PLACEMENT_NEW;

public:
    ALWAYS_INLINE constexpr RefPtr() = default;
    ALWAYS_INLINE constexpr RefPtr(std::nullptr_t) {}

    ALWAYS_INLINE RefPtr(T* object)
        : m_ptr(RefDerefTraits::refIfNotNull(object))
    {
    }

    ALWAYS_INLINE RefPtr(T& object)
        : m_ptr(&RefDerefTraits::ref(object))
    {
    }

    ALWAYS_INLINE RefPtr(const RefPtr& other)
        : m_ptr(RefDerefTraits::refIfNotNull(other.m_ptr))
    {
    }

    template<typename U>
    RefPtr(const RefPtr<U>& other)
        : m_ptr(RefDerefTraits::refIfNotNull(other.get()))
    {
    }

    ALWAYS_INLINE RefPtr(RefPtr&& other) noexcept
        : m_ptr(other.leakRef())
    {
    }

    template<typename U>
    RefPtr(RefPtr<U>&& other) noexcept
        : m_ptr(other.leakRef())
    {
    }

    template<typename U>
    RefPtr(Ref<U>&& other)
        : m_ptr(&other.leakRef())
    {
    }

    template<typename U, typename Impl>
        requires std::is_convertible_v<U*, T*>
    RefPtr(const WeakPtr<U, Impl>& other)
        : m_ptr(RefDerefTraits::refIfNotNull(other.get()))
    {
    }

    ALWAYS_INLINE ~RefPtr() { RefDerefTraits::derefIfNotNull(leakRef()); }

    RefPtr& operator=(T* object) { return adopt(RefDerefTraits::refIfNotNull(object)); }
    RefPtr& operator=(std::nullptr_t) { return adopt(nullptr); }
    RefPtr& operator=(const RefPtr& other) { return *this = other.m_ptr; }
    RefPtr& operator=(RefPtr&& other) { return adopt(other.leakRef()); }
    template<typename U> RefPtr& operator=(const RefPtr<U>& other) { return adopt(RefDerefTraits::refIfNotNull(other.get())); }
    template<typename U> RefPtr& operator=(RefPtr<U>&& other) { return adopt(other.leakRef()); }
    template<typename U> RefPtr& operator=(Ref<U>&& other) { return adopt(&other.leakRef()); }

    T* get() const LIFETIME_BOUND { return m_ptr; }
    operator T*() const LIFETIME_BOUND { return m_ptr; }
    ALWAYS_INLINE T& operator*() const LIFETIME_BOUND
    {
        ASSERT(m_ptr);
        return *m_ptr;
    }
    ALWAYS_INLINE T* operator->() const LIFETIME_BOUND
    {
        ASSERT(m_ptr);
        return m_ptr;
    }

    explicit operator bool() const { return m_ptr; }
    bool operator!() const { return !m_ptr; }

    [[nodiscard]] RefPtr copyRef() const& { return *this; }
    RefPtr copyRef() && = delete;

    [[nodiscard]] T* leakRef() { return std::exchange(m_ptr, nullptr); }

    Ref<T, PtrTraits, RefDerefTraits> releaseNonNull()
    {
        ASSERT(m_ptr);
        return adoptRef<T, PtrTraits, RefDerefTraits>(*leakRef());
    }

    void swap(RefPtr& other) { std::swap(m_ptr, other.m_ptr); }

private:
    friend RefPtr adoptRef<T, PtrTraits, RefDerefTraits>(T*);

    // The old object goes last: its destructor finds the new one in place.
    RefPtr& adopt(T* object)
    {
        RefDerefTraits::derefIfNotNull(std::exchange(m_ptr, object));
        return *this;
    }

    T* m_ptr { nullptr };
};

template<typename T> RefPtr(Ref<T>&&) -> RefPtr<T>;
template<typename T, typename Impl> RefPtr(const WeakPtr<T, Impl>&) -> RefPtr<T>;
template<typename T, typename Impl> RefPtr(WeakPtr<T, Impl>&) -> RefPtr<T>;

template<typename T, typename PtrTraits, typename RefDerefTraits>
inline RefPtr<T, PtrTraits, RefDerefTraits> adoptRef(T* object)
{
    RefPtr<T, PtrTraits, RefDerefTraits> result;
    result.m_ptr = object;
    return result;
}

template<typename T, typename U>
inline bool operator==(const RefPtr<T>& a, const RefPtr<U>& b)
{
    return a.get() == b.get();
}

template<typename T, typename U>
inline bool operator==(const RefPtr<T>& a, U* b)
{
    return a.get() == b;
}

template<typename T>
inline void swap(RefPtr<T>& a, RefPtr<T>& b)
{
    a.swap(b);
}

template<typename T, typename PtrTraits, typename RefDerefTraits>
struct GetPtrHelper<RefPtr<T, PtrTraits, RefDerefTraits>> {
    using PtrType = T*;
    using UnderlyingType = T;
    static T* getPtr(const RefPtr<T, PtrTraits, RefDerefTraits>& pointer) { return pointer.get(); }
};

}

using WTF::adoptRef;
using WTF::RefPtr;
