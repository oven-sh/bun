#pragma once

#include "root.h"
#include "v8/TaggedPointer.h"
#include "v8/HandleScopeBuffer.h"

namespace v8 {

class Data {
public:
    HandleScopeBuffer::Handle* localToHandle()
    {
        return reinterpret_cast<HandleScopeBuffer::Handle*>(this);
    }

    JSC::JSCell* localToCell()
    {
        RELEASE_ASSERT(localToTagged().type() != TaggedPointer::Type::Smi);
        return localToHandle()->object;
    }

    template<typename T>
    T* localToObjectPointer()
    {
        return JSC::jsDynamicCast<T*>(localToCell());
    }

    const HandleScopeBuffer::Handle* localToHandle() const
    {
        return reinterpret_cast<const HandleScopeBuffer::Handle*>(this);
    }

    TaggedPointer localToTagged() const
    {
        auto* handle = localToHandle();
        if (handle->to_object.type() == TaggedPointer::Type::Smi) {
            return handle->to_object;
        } else {
            return TaggedPointer(handle->object);
        }
    }

    const JSC::JSCell* localToCell() const
    {
        RELEASE_ASSERT(localToTagged().type() != TaggedPointer::Type::Smi);
        return localToHandle()->object;
    }

    template<typename T>
    const T* localToObjectPointer() const
    {
        return JSC::jsDynamicCast<const T*>(localToCell());
    }

    // static TaggedPointer locationToTagged(const void* location)
    // {
    //     return *reinterpret_cast<const TaggedPointer*>(location);
    // }

    // template<typename T>
    // T* toObjectPointer()
    // {
    //     return JSC::jsDynamicCast<T*>(toTagged().getPtr());
    // }

    // template<typename T>
    // const T* toObjectPointer() const
    // {
    //     return JSC::jsDynamicCast<const T*>(toTagged().getPtr());
    // }

    // template<typename T>
    // static T* locationToObjectPointer(void* location)
    // {
    //     return JSC::jsDynamicCast<T*>(locationToTagged(location).getPtr());
    // }

    // template<typename T>
    // static const T* locationToObjectPointer(const void* location)
    // {
    //     return JSC::jsDynamicCast<const T*>(locationToTagged(location).getPtr());
    // }
};

}
