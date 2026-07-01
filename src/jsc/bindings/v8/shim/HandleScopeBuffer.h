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

    // Reserve a slot whose value will be written directly by V8's inline CreateHandle code after
    // HandleScope::Extend returns it. The written value is either a Smi or a pointer to an
    // ObjectLayout owned by some other handle, so the handle backing this slot does not own (or
    // visit) anything itself (see Handle::isCell).
    TaggedPointer* createRawHandleSlot();

    // Free every handle created after the raw slot whose address + 1 equals `limit` (the
    // HandleScopeData::limit value V8's inline ~HandleScope just restored). Called from
    // HandleScope::DeleteExtensions so per-iteration inline v8::HandleScopes inside a single
    // native call reclaim their handles instead of accumulating until the enclosing Bun scope
    // closes.
    void deleteGrantsBack(const uintptr_t* limit);

    // Reserve an empty handle for an EscapableHandleScope's escape slot.
    // Called from the scope's constructor so the slot's storage index is below
    // every handle created inside the scope (deleteGrantsBack then can't sweep
    // it); EscapeSlot() fills it via createHandleFromExistingObject(reuseHandle).
    Handle* reserveEscapeHandle();

    // HandleScopeData::{next,limit} as they were when the owning Bun
    // HandleScope was pushed. ~HandleScope writes them back when it pops so
    // the isolate's HandleScopeData never dangles into this (cleared) buffer
    // — otherwise the next inline v8::HandleScope would snapshot a stale
    // limit and its DeleteExtensions would sweep a foreign buffer's grants.
    void saveHandleScopeData(uintptr_t* next, uintptr_t* limit)
    {
        m_savedNext = next;
        m_savedLimit = limit;
    }
    uintptr_t* savedNext() const { return m_savedNext; }
    uintptr_t* savedLimit() const { return m_savedLimit; }

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
    // (slot, index in m_storage) for every createRawHandleSlot grant, in creation order.
    // No inline capacity: in-cell inline Vector storage would leave stale ASAN
    // container annotations behind (this cell type is swept without running
    // C++ destructors), tripping container-overflow on cell reuse. The heap
    // buffer is released in clear().
    WTF::Vector<std::pair<TaggedPointer*, size_t>> m_rawGrants;
    uintptr_t* m_savedNext { nullptr };
    uintptr_t* m_savedLimit { nullptr };

    Handle& createEmptyHandle();

    HandleScopeBuffer(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

} // namespace shim
} // namespace v8
