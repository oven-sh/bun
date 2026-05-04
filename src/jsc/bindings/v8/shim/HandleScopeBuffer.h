#pragma once

#include "../v8.h"
#include "../V8Isolate.h"
#include "TaggedPointer.h"
#include "Map.h"
#include "Handle.h"
#include <JavaScriptCore/JSCell.h>

namespace v8 {

class EscapableHandleScopeBase;

namespace shim {

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
    TaggedPointer* createSmiHandle(int32_t smi);
    TaggedPointer* createDoubleHandle(double value);

    // Given a tagged pointer from V8, create a handle around the same object or the same
    // numeric value
    //
    // address:     V8 object pointer or Smi
    // isolate:     received in any V8 method
    // reuseHandle: if nonnull, change this handle instead of creating a new one
    // returns the location of the new handle's V8 object pointer or Smi
    TaggedPointer* createHandleFromExistingObject(TaggedPointer address, Isolate* isolate, Handle* reuseHandle = nullptr);

    void clear();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    friend class ::v8::EscapableHandleScopeBase;

private:
    WTF::Lock m_gcLock;
    WTF::SegmentedVector<Handle, 16> m_storage;

    Handle& createEmptyHandle();

    HandleScopeBuffer(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace shim
} // namespace v8
