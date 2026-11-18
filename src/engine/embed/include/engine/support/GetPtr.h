#pragma once

#include <memory>

namespace WTF {

// Specialized for each type of smart pointer.
template<typename T> struct GetPtrHelper {
    using PtrType = T*;
    static T* getPtr(T& object) { return std::addressof(object); }
};

template<typename T>
concept SmartPtr = requires { typename GetPtrHelper<T>::UnderlyingType; };

template<typename T> T* getPtr(T* pointer) { return pointer; }
template<typename T> typename GetPtrHelper<T>::PtrType getPtr(T& value) { return GetPtrHelper<T>::getPtr(value); }
template<typename T> typename GetPtrHelper<T>::PtrType getPtr(const T& value) { return GetPtrHelper<T>::getPtr(value); }

}
