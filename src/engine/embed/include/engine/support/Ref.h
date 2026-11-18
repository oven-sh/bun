#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"
#include "engine/support/GetPtr.h"

namespace WTF {

template<typename T> struct RawPtrTraits {};

template<typename T> struct DefaultRefDerefTraits {
    static ALWAYS_INLINE T& ref(T& object)
    {
        object.ref();
        return object;
    }

    static ALWAYS_INLINE T* refIfNotNull(T* object)
    {
        if (object) [[likely]]
            object->ref();
        return object;
    }

    static ALWAYS_INLINE void derefIfNotNull(T* object)
    {
        if (object) [[likely]]
            object->deref();
    }
};

template<typename T, typename PtrTraits = RawPtrTraits<T>, typename RefDerefTraits = DefaultRefDerefTraits<T>>
Ref<T, PtrTraits, RefDerefTraits> adoptRef(T&);

// Holds a reference to an object, unless it has been moved from.
template<typename T, typename PtrTraits, typename RefDerefTraits>
class TRIVIAL_ABI Ref {
    WTF_FORBID_HEAP_ALLOCATION_ALLOWING_PLACEMENT_NEW;

public:
    static constexpr bool isRef = true;

    Ref(T& object)
        : m_ptr(&RefDerefTraits::ref(object))
    {
    }

    Ref(const Ref& other)
        : Ref(other.get())
    {
    }

    template<typename U>
    Ref(const Ref<U>& other)
        : m_ptr(&RefDerefTraits::ref(other.get()))
    {
    }

    Ref(Ref&& other) noexcept
        : m_ptr(&other.leakRef())
    {
    }

    template<typename U>
    Ref(Ref<U>&& other) noexcept
        : m_ptr(&other.leakRef())
    {
    }

    ~Ref() { RefDerefTraits::derefIfNotNull(std::exchange(m_ptr, nullptr)); }

    Ref& operator=(T& object) { return assign(Ref { object }); }
    Ref& operator=(const Ref& other) { return assign(Ref { other }); }
    Ref& operator=(Ref&& other) { return assign(WTF::move(other)); }
    template<typename U> Ref& operator=(const Ref<U>& other) { return assign(Ref { other }); }
    template<typename U> Ref& operator=(Ref<U>&& other) { return assign(Ref { WTF::move(other) }); }

    T* ptr() const LIFETIME_BOUND RETURNS_NONNULL
    {
        ASSERT(m_ptr);
        return m_ptr;
    }
    T& get() const LIFETIME_BOUND { return *ptr(); }
    T* operator->() const LIFETIME_BOUND { return ptr(); }
    operator T&() const LIFETIME_BOUND { return get(); }

    [[nodiscard]] Ref copyRef() const& { return *this; }
    Ref copyRef() && = delete;

    [[nodiscard]] T& leakRef()
    {
        ASSERT(m_ptr);
        return *std::exchange(m_ptr, nullptr);
    }

private:
    friend Ref adoptRef<T, PtrTraits, RefDerefTraits>(T&);

    enum AdoptTag { Adopt };
    Ref(T& object, AdoptTag)
        : m_ptr(&object)
    {
    }

    // The old object goes last: its destructor finds the new one in place.
    Ref& assign(Ref&& other)
    {
        T* object = &other.leakRef();
        RefDerefTraits::derefIfNotNull(std::exchange(m_ptr, object));
        return *this;
    }

    T* m_ptr;
};

template<typename T, typename PtrTraits, typename RefDerefTraits>
inline Ref<T, PtrTraits, RefDerefTraits> adoptRef(T& object)
{
    return { object, Ref<T, PtrTraits, RefDerefTraits>::Adopt };
}

template<typename T, typename U>
inline bool operator==(const Ref<T>& a, const Ref<U>& b)
{
    return a.ptr() == b.ptr();
}

template<typename Target, typename Source>
inline Ref<Target> unsafeRefDowncast(Ref<Source>&& source)
{
    static_assert(std::derived_from<Target, Source>);
    return adoptRef(static_cast<Target&>(source.leakRef()));
}

template<typename T, typename PtrTraits, typename RefDerefTraits>
struct GetPtrHelper<Ref<T, PtrTraits, RefDerefTraits>> {
    using PtrType = T*;
    using UnderlyingType = T;
    static T* getPtr(const Ref<T, PtrTraits, RefDerefTraits>& reference) { return reference.ptr(); }
};

}

using WTF::adoptRef;
using WTF::RawPtrTraits;
using WTF::Ref;
using WTF::unsafeRefDowncast;
