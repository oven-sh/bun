#pragma once

#include "BunClientData.h"

namespace v8 {

namespace shim {

class ObjectTemplate;

class InternalFieldObject : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<InternalFieldObject, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForInternalFieldObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForInternalFieldObject = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForInternalFieldObject.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForInternalFieldObject = std::forward<decltype(space)>(space); });
    }

    // never changes size
    using FieldContainer = WTF::FixedVector<JSC::WriteBarrier<JSC::Unknown>>;

    FieldContainer* internalFields() { return &m_fields; }
    static InternalFieldObject* create(JSC::VM& vm, JSC::Structure* structure, int internalFieldCount);

    DECLARE_VISIT_CHILDREN;

protected:
    InternalFieldObject(JSC::VM& vm, JSC::Structure* structure, int internalFieldCount)
        : Base(vm, structure)
        , m_fields(internalFieldCount, JSC::WriteBarrier<JSC::Unknown>(vm, this, JSC::jsUndefined()))
    {
    }

private:
    FieldContainer m_fields;
};

} // namespace shim
} // namespace v8
