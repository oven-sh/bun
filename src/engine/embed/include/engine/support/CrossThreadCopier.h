#pragma once

#include "engine/support/Vector.h"

namespace WTF {

template<typename T> struct CrossThreadCopier;

// Makes a value that shares nothing with the source that only one thread may touch.
template<bool isNumber, bool isThreadSafeRefCounted, typename T>
struct CrossThreadCopierBase {
    static T copy(const T& value) { return value.isolatedCopy(); }
    static T copy(T&& value) { return WTF::move(value).isolatedCopy(); }
};

template<typename T>
struct CrossThreadCopierBase<true, false, T> {
    static T copy(T value) { return value; }
};

template<typename T>
struct CrossThreadCopierBase<false, false, Vector<T>> {
    static Vector<T> copy(const Vector<T>& source)
    {
        if constexpr (std::is_arithmetic_v<T>)
            return source;
        else
            return source.map([](const T& element) { return CrossThreadCopier<T>::copy(element); });
    }
};

template<typename T>
struct CrossThreadCopier : CrossThreadCopierBase<std::is_arithmetic_v<T> || std::is_enum_v<T>, false, T> {};

template<typename T>
auto crossThreadCopy(T&& source)
{
    return CrossThreadCopier<std::remove_cvref_t<T>>::copy(std::forward<T>(source));
}

}

using WTF::crossThreadCopy;
