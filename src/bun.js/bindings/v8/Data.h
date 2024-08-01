#pragma once

#include "root.h"
#include "v8/TaggedPointer.h"

namespace v8 {

class Data {
public:
    TaggedPointer toTagged() const
    {
        return *reinterpret_cast<const TaggedPointer*>(this);
    }

    static TaggedPointer locationToTagged(const void* location)
    {
        return *reinterpret_cast<const TaggedPointer*>(location);
    }

    template<typename T>
    T* toObjectPointer()
    {
        return JSC::jsDynamicCast<T*>(toTagged().getPtr());
    }

    template<typename T>
    const T* toObjectPointer() const
    {
        return JSC::jsDynamicCast<const T*>(toTagged().getPtr());
    }

    template<typename T>
    static T* locationToObjectPointer(void* location)
    {
        return JSC::jsDynamicCast<T*>(locationToTagged(location).getPtr());
    }

    template<typename T>
    static const T* locationToObjectPointer(const void* location)
    {
        return JSC::jsDynamicCast<const T*>(locationToTagged(location).getPtr());
    }
};

}
