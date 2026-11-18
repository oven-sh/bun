#pragma once

#include "engine/support/Forward.h"
#include "engine/support/StdLibExtras.h"

#include <cstring>
#include <optional>

namespace WTF {

template<bool isPlainData, typename T>
struct VectorTraitsBase {
    static constexpr bool needsInitialization = !isPlainData;
    static constexpr bool canInitializeWithMemset = isPlainData;
    // The bytes at another address are the object, and the old ones need no destructor.
    static constexpr bool canMoveWithMemcpy = isPlainData;
    static constexpr bool canCompareWithMemcmp = isPlainData;
};

template<typename T>
struct VectorTraits : VectorTraitsBase<std::is_standard_layout_v<T> && std::is_trivially_copyable_v<T> && std::is_trivially_default_constructible_v<T> && std::has_unique_object_representations_v<T>, T> {
    // Also holds for aggregates of types that have the attribute TRIVIAL_ABI.
    IGNORE_WARNINGS_BEGIN("deprecated-builtins")
    static constexpr bool canMoveWithMemcpy = __is_trivially_relocatable(T);
    IGNORE_WARNINGS_END
};

struct SimpleClassVectorTraits : VectorTraitsBase<false, void> {
    static constexpr bool canInitializeWithMemset = true;
    static constexpr bool canMoveWithMemcpy = true;
    static constexpr bool canCompareWithMemcmp = true;
};

struct MovableClassVectorTraits : VectorTraitsBase<false, void> {
    static constexpr bool canInitializeWithMemset = true;
    static constexpr bool canMoveWithMemcpy = true;
};

template<typename First, typename Second>
struct PairVectorTraits : VectorTraitsBase<false, void> {
    static constexpr bool needsInitialization = VectorTraits<First>::needsInitialization || VectorTraits<Second>::needsInitialization;
    static constexpr bool canInitializeWithMemset = VectorTraits<First>::canInitializeWithMemset && VectorTraits<Second>::canInitializeWithMemset;
    static constexpr bool canMoveWithMemcpy = VectorTraits<First>::canMoveWithMemcpy && VectorTraits<Second>::canMoveWithMemcpy;
};

template<typename T, typename PtrTraits, typename RefDerefTraits> struct VectorTraits<Ref<T, PtrTraits, RefDerefTraits>> : SimpleClassVectorTraits {};
template<typename T, typename PtrTraits, typename RefDerefTraits> struct VectorTraits<RefPtr<T, PtrTraits, RefDerefTraits>> : SimpleClassVectorTraits {};
template<typename T> struct VectorTraits<UniqueRef<T>> : SimpleClassVectorTraits {};
template<typename T> struct VectorTraits<std::unique_ptr<T>> : SimpleClassVectorTraits {};

template<typename T> struct VectorTraits<FixedVector<T>> : MovableClassVectorTraits {};
template<typename Signature> struct VectorTraits<Function<Signature>> : MovableClassVectorTraits {};
template<typename... Arguments> struct VectorTraits<HashMap<Arguments...>> : MovableClassVectorTraits {};
template<typename... Arguments> struct VectorTraits<HashSet<Arguments...>> : MovableClassVectorTraits {};
template<typename T, typename OverflowHandler, size_t minCapacity, typename Malloc> struct VectorTraits<Vector<T, 0, OverflowHandler, minCapacity, Malloc>> : MovableClassVectorTraits {};
template<typename T, typename Impl> struct VectorTraits<WeakPtr<T, Impl>> : MovableClassVectorTraits {};

template<typename First, typename Second> struct VectorTraits<std::pair<First, Second>> : PairVectorTraits<First, Second> {};
template<typename Key, typename Value> struct VectorTraits<KeyValuePair<Key, Value>> : PairVectorTraits<Key, Value> {
    static constexpr bool needsInitialization = true;
};

template<typename T> struct VectorTraits<std::optional<T>> : VectorTraitsBase<false, void> {
    static constexpr bool canMoveWithMemcpy = VectorTraits<T>::canMoveWithMemcpy;
};

namespace Detail {

// Ends the life of an object and continues it in memory that holds none.
template<typename T>
ALWAYS_INLINE void relocate(T* from, T* to)
{
    if constexpr (VectorTraits<T>::canMoveWithMemcpy)
        memcpy(static_cast<void*>(to), static_cast<const void*>(from), sizeof(T));
    else {
        ::new (NotNull, to) T(WTF::move(*from));
        from->~T();
    }
}

template<typename T>
inline void relocate(T* from, size_t count, T* to)
{
    if constexpr (VectorTraits<T>::canMoveWithMemcpy)
        memcpy(static_cast<void*>(to), static_cast<const void*>(from), count * sizeof(T));
    else {
        for (size_t i = 0; i < count; ++i)
            relocate(from + i, to + i);
    }
}

template<typename T>
inline void relocateOverlapping(T* from, size_t count, T* to)
{
    if constexpr (VectorTraits<T>::canMoveWithMemcpy)
        memmove(static_cast<void*>(to), static_cast<const void*>(from), count * sizeof(T));
    else if (to < from)
        relocate(from, count, to);
    else if (to > from) {
        for (size_t i = count; i--;)
            relocate(from + i, to + i);
    }
}

template<typename T>
inline void initializeUnlessPlainData(T* begin, size_t count)
{
    if constexpr (!VectorTraits<T>::needsInitialization)
        return;
    else if constexpr (VectorTraits<T>::canInitializeWithMemset) {
        if (count)
            memset(static_cast<void*>(begin), 0, count * sizeof(T));
    } else {
        for (size_t i = 0; i < count; ++i)
            new (NotNull, begin + i) T();
    }
}

template<typename T, typename U>
inline void uninitializedCopy(const U* from, size_t count, T* to)
{
    if constexpr (std::same_as<T, U> && std::is_trivially_copyable_v<T>) {
        if (count)
            memcpy(static_cast<void*>(to), static_cast<const void*>(from), count * sizeof(T));
    } else {
        for (size_t i = 0; i < count; ++i)
            new (NotNull, to + i) T(from[i]);
    }
}

template<typename T>
inline void uninitializedFill(T* begin, size_t count, const T& value)
{
    for (size_t i = 0; i < count; ++i)
        new (NotNull, begin + i) T(value);
}

// Takes an object out of a container, and destroys it when the container is consistent again.
// The object may have been moved from, so one that only its move constructor can move is destroyed where it is.
template<typename T>
class RemovedElement {
public:
    ALWAYS_INLINE explicit RemovedElement(T* element)
    {
        if constexpr (VectorTraits<T>::canMoveWithMemcpy)
            relocate(element, std::addressof(m_element));
        else
            element->~T();
    }

    ALWAYS_INLINE ~RemovedElement()
    {
        if constexpr (VectorTraits<T>::canMoveWithMemcpy)
            m_element.~T();
    }

private:
    union {
        T m_element;
    };
};

}

}

using WTF::SimpleClassVectorTraits;
using WTF::VectorTraits;
