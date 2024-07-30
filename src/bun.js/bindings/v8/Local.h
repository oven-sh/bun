#pragma once

#include "root.h"

namespace v8 {

template<class T>
class Local final {
public:
    Local()
        : ptr(nullptr)
    {
    }

    Local(T* ptr_)
        : ptr(ptr_)
    {
    }

    Local(JSC::JSValue jsv)
        : ptr(reinterpret_cast<T*>(JSC::JSValue::encode(jsv)))
    {
    }

    Local(JSC::EncodedJSValue encoded)
        : ptr(reinterpret_cast<T*>(encoded))
    {
    }

    bool IsEmpty() const { return ptr == nullptr; }

    T* operator*() const { return ptr; }

private:
    T* ptr;
};

}
