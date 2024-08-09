#pragma once

#include "root.h"
#include "v8/TaggedPointer.h"
#include "v8/Handle.h"
#include "v8/GlobalInternals.h"

namespace v8 {

class Data {
public:
    Handle* localToHandle()
    {
        return reinterpret_cast<Handle*>(this);
    }

    void* localToPointer()
    {
        TaggedPointer tagged = localToTagged();
        RELEASE_ASSERT(tagged.type() != TaggedPointer::Type::Smi);
        return tagged.getPtr<void>();
    }

    JSC::JSCell* localToCell()
    {
        return reinterpret_cast<JSC::JSCell*>(localToPointer());
    }

    template<typename T>
    T* localToObjectPointer()
    {
        return JSC::jsDynamicCast<T*>(localToCell());
    }

    const Handle* localToHandle() const
    {
        return reinterpret_cast<const Handle*>(this);
    }

    JSC::JSValue localToJSValue(GlobalInternals* globalInternals) const
    {
        TaggedPointer root = *reinterpret_cast<const TaggedPointer*>(this);
        if (root.type() == TaggedPointer::Type::Smi) {
            return JSC::jsNumber(root.getSmiUnchecked());
        } else {
            void* raw_ptr = root.getPtr<void>();
            if (raw_ptr == globalInternals->undefinedSlot()->getPtr<void>()) {
                return JSC::jsUndefined();
            } else if (raw_ptr == globalInternals->nullSlot()->getPtr<void>()) {
                return JSC::jsNull();
            } else if (raw_ptr == globalInternals->trueSlot()->getPtr<void>()) {
                return JSC::jsBoolean(true);
            } else if (raw_ptr == globalInternals->falseSlot()->getPtr<void>()) {
                return JSC::jsBoolean(false);
            }

            JSC::JSCell** v8_object = reinterpret_cast<JSC::JSCell**>(raw_ptr);
            return JSC::JSValue(v8_object[1]);
        }
    }

    const void* localToPointer() const
    {
        TaggedPointer tagged = localToTagged();
        RELEASE_ASSERT(tagged.type() != TaggedPointer::Type::Smi);
        return tagged.getPtr<const void>();
    }

    const JSC::JSCell* localToCell() const
    {
        return reinterpret_cast<const JSC::JSCell*>(localToPointer());
    }

    template<typename T>
    const T* localToObjectPointer() const
    {
        return JSC::jsDynamicCast<const T*>(localToCell());
    }

private:
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
};

}
