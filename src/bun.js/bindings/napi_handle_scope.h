#pragma once

#include "BunClientData.h"
#include "root.h"

namespace Bun {

// An array of write barriers (so that newly-added objects are not lost by GC) to JSValues. Unlike
// the V8 version, pointer stability is not required (because napi_values don't point into this
// structure) so we can use a regular WTF::Vector
class NapiHandleScope : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static NapiHandleScope* create(JSC::VM& vm, JSC::Structure* structure, NapiHandleScope* parent);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NapiHandleScope, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForHandleScopeBuffer.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForHandleScopeBuffer = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void append(JSC::JSValue val);
    NapiHandleScope* parent() const { return m_parent; }

private:
    NapiHandleScope* m_parent;
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>, 16> m_storage;

    NapiHandleScope(JSC::VM& vm, JSC::Structure* structure, NapiHandleScope* parent)
        : Base(vm, structure)
        , m_parent(parent)
    {
    }
};

} // namespace Bun
