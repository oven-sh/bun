#pragma once

#include "BunClientData.h"

namespace v8 {

namespace shim {

class ObjectTemplate;

class InternalFieldObject : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    DECLARE_INFO;

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<InternalFieldObject*>(cell)->~InternalFieldObject();
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<InternalFieldObject, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForInternalFieldObject, m_subspaceForInternalFieldObject));
    }

    // never changes size
    using FieldContainer = WTF::FixedVector<JSC::WriteBarrier<JSC::Unknown>>;

    FieldContainer* internalFields() { return &m_fields; }
    void*& alignedPointerAt(int i) { return m_alignedPointers[i]; }
    size_t alignedPointerCount() const { return m_alignedPointers.size(); }
    // The ObjectTemplate that made this instance. FunctionTemplate::HasInstance
    // compares its constructor, as V8 compares the constructor of an object's map.
    ObjectTemplate* objectTemplate() const { return m_objectTemplate.get(); }
    static InternalFieldObject* create(JSC::VM& vm, JSC::Structure* structure, ObjectTemplate* objectTemplate, int internalFieldCount);

    DECLARE_VISIT_CHILDREN;

protected:
    InternalFieldObject(JSC::VM& vm, JSC::Structure* structure, ObjectTemplate* objectTemplate, int internalFieldCount)
        : Base(vm, structure)
        , m_objectTemplate(vm, this, objectTemplate)
        , m_fields(WTF::FillWith {}, internalFieldCount, JSC::WriteBarrier<JSC::Unknown>(vm, this, JSC::jsUndefined()))
        , m_alignedPointers(WTF::FillWith {}, internalFieldCount, static_cast<void*>(nullptr))
    {
    }

private:
    JSC::WriteBarrier<ObjectTemplate> m_objectTemplate;
    FieldContainer m_fields;
    WTF::FixedVector<void*> m_alignedPointers;
};

} // namespace shim
} // namespace v8
