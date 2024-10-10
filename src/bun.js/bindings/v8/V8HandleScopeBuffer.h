#pragma once

#include "v8.h"
#include "V8TaggedPointer.h"
#include "V8Map.h"
#include "V8Handle.h"

namespace v8 {

// An array used by HandleScope to store the items. Must keep pointer stability when resized, since
// v8::Locals point inside this array.
class HandleScopeBuffer : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static HandleScopeBuffer* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<HandleScopeBuffer, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); });
    }

    TaggedPointer* createHandle(JSC::JSCell* object, const Map* map, JSC::VM& vm);
    TaggedPointer* createRawHandle(void* ptr);
    TaggedPointer* createSmiHandle(int32_t smi);
    TaggedPointer* createDoubleHandle(double value);
    TaggedPointer* createHandleFromExistingHandle(TaggedPointer address);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    friend class EscapableHandleScopeBase;

private:
    WTF::Lock gc_lock;
    WTF::SegmentedVector<Handle, 16> storage;

    Handle& createEmptyHandle();

    HandleScopeBuffer(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

}
