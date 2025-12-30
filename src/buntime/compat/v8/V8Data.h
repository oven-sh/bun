#pragma once

#include "root.h"
#include "shim/TaggedPointer.h"
#include "shim/Handle.h"
#include "shim/GlobalInternals.h"

namespace v8 {

class Data {

public:
    // Functions beginning with "localTo" must only be used when "this" comes from a v8::Local (i.e.
    // in public V8 functions), as they make assumptions about how V8 lays out local handles. They
    // will segfault or worse otherwise.

    // Recover a JSCell pointer out of a v8::Local
    JSC::JSCell* localToCell()
    {
        TaggedPointer root = localToTagged();
        RELEASE_ASSERT(root.tag() != TaggedPointer::Tag::Smi);
        return root.getPtr<shim::ObjectLayout>()->asCell();
    }

    // Recover a pointer to a JSCell subclass out of a v8::Local
    template<typename T>
    T* localToObjectPointer()
    {
        static_assert(std::is_base_of<JSC::JSCell, T>::value, "localToObjectPointer can only be used when T is a JSCell subclass");
        return JSC::jsDynamicCast<T*>(localToCell());
    }

    // Get this as a JSValue when this is a v8::Local containing a boolean, null, or undefined
    JSC::JSValue localToOddball() const
    {
        TaggedPointer root = localToTagged();
        shim::Oddball* oddball = root.getPtr<shim::Oddball>();
        RELEASE_ASSERT(
            oddball->m_map.getPtr<const shim::Map>()->m_instanceType == shim::InstanceType::Oddball);
        return oddball->toJSValue();
    }

    // Get this as a JSValue when this is a v8::Local
    JSC::JSValue localToJSValue() const
    {
        TaggedPointer root = localToTagged();
        if (root.tag() == TaggedPointer::Tag::Smi) {
            return JSC::jsNumber(root.getSmiUnchecked());
        } else {
            using shim::InstanceType;
            auto* v8_object = root.getPtr<shim::ObjectLayout>();

            switch (v8_object->map()->m_instanceType) {
            case InstanceType::Oddball:
                return reinterpret_cast<shim::Oddball*>(v8_object)->toJSValue();
            case InstanceType::HeapNumber:
                // a number that doesn't fit in int32_t, always EncodeAsDouble
                return JSC::jsDoubleNumber(v8_object->asDouble());
            default:
                return v8_object->asCell();
            }
        }
    }

    // Recover a JSCell pointer out of a v8::Local
    const JSC::JSCell* localToCell() const
    {
        TaggedPointer root = localToTagged();
        RELEASE_ASSERT(root.tag() != TaggedPointer::Tag::Smi);
        return root.getPtr<shim::ObjectLayout>()->asCell();
    }

    // Recover a pointer to a JSCell subclass out of a v8::Local
    template<typename T>
    const T* localToObjectPointer() const
    {
        static_assert(std::is_base_of<JSC::JSCell, T>::value, "localToObjectPointer can only be used when T is a JSCell subclass");
        return JSC::jsDynamicCast<const T*>(localToCell());
    }

private:
    // Convert the local handle into either a smi or an ObjectLayout pointer.
    TaggedPointer localToTagged() const
    {
        return *reinterpret_cast<const TaggedPointer*>(this);
    }
};

} // namespace v8
