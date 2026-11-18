#pragma once

#include "engine/support/RefPtr.h"

#include <limits>

namespace WTF {

// What a table returns for an entry. Every value can be a key: emptyValue() only stands for an entry that is not there.
template<typename T> struct GenericHashTraits {
    using TraitType = T;
    static T emptyValue() { return T(); }

    using PeekType = T;
    template<typename U> static U&& peek(U&& value) { return std::forward<U>(value); }

    using TakeType = T;
    template<typename U> static TakeType take(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct HashTraits : GenericHashTraits<T> {};

template<typename T> struct UnsignedWithZeroKeyHashTraits : GenericHashTraits<T> {
    static T emptyValue() { return std::numeric_limits<T>::max(); }
};

template<typename Pointer, typename Taken = Pointer> struct SmartPtrHashTraits {
    using TraitType = Pointer;
    static std::nullptr_t emptyValue() { return nullptr; }

    using PeekType = typename GetPtrHelper<Pointer>::PtrType;
    static PeekType peek(const std::same_as<Pointer> auto& value) { return getPtr(value); }
    static PeekType peek(std::nullptr_t) { return nullptr; }

    using TakeType = Taken;
    template<typename U> static TakeType take(U&& value) { return std::forward<U>(value); }
};

template<typename T> struct HashTraits<Ref<T>> : SmartPtrHashTraits<Ref<T>, RefPtr<T>> {};
template<typename T, typename PtrTraits, typename RefDerefTraits> struct HashTraits<RefPtr<T, PtrTraits, RefDerefTraits>> : SmartPtrHashTraits<RefPtr<T, PtrTraits, RefDerefTraits>> {};

}

using WTF::HashTraits;
