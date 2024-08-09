#pragma once

#include "v8.h"
#include "v8/TaggedPointer.h"
#include "v8/Map.h"
#include "v8/Handle.h"

namespace v8 {

// An array used by HandleScope to store the items. Must keep pointer stability when resized, since
// v8::Locals point inside this array.
class HandleScopeBuffer : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static HandleScopeBuffer* create(JSC::VM& vm, JSC::Structure* structure);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), 0, 0);
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

    TaggedPointer* createHandle(void* ptr, const Map* map);
    TaggedPointer* createSmiHandle(int32_t smi);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    friend class EscapableHandleScopeBase;

private:
    // TODO make resizable
    static constexpr int capacity = 64;

    Handle storage[capacity];
    int size = 0;

    Handle& createUninitializedHandle();

    HandleScopeBuffer(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

}
