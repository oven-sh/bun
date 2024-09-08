#pragma once

#include "root.h"

#include "V8TaggedPointer.h"

namespace v8 {

template<class T>
class Local final {
public:
    Local()
        : location(nullptr)
    {
    }

    Local(TaggedPointer* slot)
        : location(slot)
    {
    }

    bool IsEmpty() const { return location == nullptr; }

    T* operator*() const { return reinterpret_cast<T*>(location); }
    T* operator->() const { return reinterpret_cast<T*>(location); }

    template<class U>
    Local<U> reinterpret() const
    {
        return Local<U>(location);
    }

    TaggedPointer tagged() const
    {
        return *location;
    }

private:
    TaggedPointer* location;
};

}
