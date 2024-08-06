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
        TaggedPointer tagged = localToTagged();
        RELEASE_ASSERT(tagged.type() != TaggedPointer::Type::Smi);
        return tagged.getPtr();
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
        TaggedPointer root = *reinterpret_cast<const TaggedPointer*>(this);
        if (root.type() == TaggedPointer::Type::Smi) {
            return root;
        } else {
            JSC::JSCell** v8_object = reinterpret_cast<JSC::JSCell**>(root.getPtr());
            return TaggedPointer(v8_object[1]);
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
};

}
