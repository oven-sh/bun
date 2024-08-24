#pragma once

#include "root.h"
#include "V8TaggedPointer.h"
#include "V8Handle.h"
#include "V8GlobalInternals.h"

namespace v8 {

class Data {
public:
    // Functions beginning with "localTo" must only be used when "this" comes from a v8::Local (i.e.
    // in public V8 functions), as they make assumptions about how V8 lays out local handles. They
    // will segfault or worse otherwise.

    // Recover an opaque pointer out of a v8::Local which is not a number
    void* localToPointer()
    {
        TaggedPointer tagged = localToTagged();
        RELEASE_ASSERT(tagged.type() != TaggedPointer::Type::Smi);
        return tagged.getPtr<void>();
    }

    // Recover a JSCell pointer out of a v8::Local
    JSC::JSCell* localToCell()
    {
        return reinterpret_cast<JSC::JSCell*>(localToPointer());
    }

    // Recover a pointer to a JSCell subclass out of a v8::Local
    template<typename T>
    T* localToObjectPointer()
    {
        static_assert(std::is_base_of<JSC::JSCell, T>::value, "localToObjectPointer can only be used when T is a JSCell subclass");
        return JSC::jsDynamicCast<T*>(localToCell());
    }

    // Get this as a JSValue when this is a v8::Local
    JSC::JSValue localToJSValue(GlobalInternals* globalInternals) const
    {
        TaggedPointer root = *reinterpret_cast<const TaggedPointer*>(this);
        if (root.type() == TaggedPointer::Type::Smi) {
            return JSC::jsNumber(root.getSmiUnchecked());
        } else {
            void* raw_ptr = root.getPtr<void>();
            // check if this pointer is identical to the fixed locations where these primitive
            // values are stored
            if (raw_ptr == globalInternals->undefinedSlot()->getPtr<void>()) {
                return JSC::jsUndefined();
            } else if (raw_ptr == globalInternals->nullSlot()->getPtr<void>()) {
                return JSC::jsNull();
            } else if (raw_ptr == globalInternals->trueSlot()->getPtr<void>()) {
                return JSC::jsBoolean(true);
            } else if (raw_ptr == globalInternals->falseSlot()->getPtr<void>()) {
                return JSC::jsBoolean(false);
            }

            ObjectLayout* v8_object = reinterpret_cast<ObjectLayout*>(raw_ptr);
            if (v8_object->map()->instance_type == InstanceType::HeapNumber) {
                return JSC::jsDoubleNumber(v8_object->asDouble());
            } else {
                return JSC::JSValue(v8_object->asCell());
            }
        }
    }

    // Recover an opaque pointer out of a v8::Local which is not a number
    const void* localToPointer() const
    {
        TaggedPointer tagged = localToTagged();
        RELEASE_ASSERT(tagged.type() != TaggedPointer::Type::Smi);
        return tagged.getPtr<const void>();
    }

    // Recover a JSCell pointer out of a v8::Local
    const JSC::JSCell* localToCell() const
    {
        return reinterpret_cast<const JSC::JSCell*>(localToPointer());
    }

    // Recover a pointer to a JSCell subclass out of a v8::Local
    template<typename T>
    const T* localToObjectPointer() const
    {
        static_assert(std::is_base_of<JSC::JSCell, T>::value, "localToObjectPointer can only be used when T is a JSCell subclass");
        return JSC::jsDynamicCast<const T*>(localToCell());
    }

private:
    // Convert the local handle into either a smi or a pointer to some non-V8 type.
    TaggedPointer localToTagged() const
    {
        TaggedPointer root = *reinterpret_cast<const TaggedPointer*>(this);
        if (root.type() == TaggedPointer::Type::Smi) {
            return root;
        } else {
            // root points to the V8 object. The first field of the V8 object is the map, and the
            // second is a pointer to some object we have stored. So we ignore the map and recover
            // the object pointer.
            ObjectLayout* v8_object = root.getPtr<ObjectLayout>();
            return TaggedPointer(v8_object->asRaw());
        }
    }
};

}
