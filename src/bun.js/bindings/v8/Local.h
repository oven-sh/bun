#pragma once

#include "root.h"

#include "v8/TaggedPointer.h"

namespace v8 {

template<class T>
class Local final {
public:
    Local()
        : location(nullptr)
    {
    }

    Local(TaggedPointer* slot)
        : location(reinterpret_cast<T*>(slot))
    {
    }

    bool IsEmpty() const { return location == nullptr; }

    T* operator*() const { return location; }
    T* operator->() const { return location; }

private:
    T* location;
};

}
