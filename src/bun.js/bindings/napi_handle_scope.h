#pragma once

#include "BunClientData.h"
#include "root.h"

namespace Bun {

// An array of write barriers (so that newly-added objects are not lost by GC) to JSValues. Unlike
// the V8 version, pointer stability is not required (because napi_values don't point into this
// structure) so we can use a regular WTF::Vector
class NapiHandleScopeImpl : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static NapiHandleScopeImpl* create(JSC::VM& vm, JSC::Structure* structure, NapiHandleScopeImpl* parent);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::CellType, StructureFlags), info(), 0, 0);
    }

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NapiHandleScopeImpl, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNapiHandleScopeImpl.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNapiHandleScopeImpl = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNapiHandleScopeImpl.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNapiHandleScopeImpl = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    void append(JSC::JSValue val);
    NapiHandleScopeImpl* parent() const { return m_parent; }

private:
    NapiHandleScopeImpl* m_parent;
    WTF::Vector<JSC::WriteBarrier<JSC::Unknown>, 16> m_storage;

    NapiHandleScopeImpl(JSC::VM& vm, JSC::Structure* structure, NapiHandleScopeImpl* parent)
        : Base(vm, structure)
        , m_parent(parent)
    {
    }
};

// Wrapper class used to push a new handle scope and pop it when this instance goes out of scope
class NapiHandleScope {
public:
    NapiHandleScope(Zig::GlobalObject* globalObject);
    ~NapiHandleScope();

    static NapiHandleScopeImpl* push(Zig::GlobalObject* globalObject);
    static void pop(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current);

private:
    NapiHandleScopeImpl* m_impl;
    Zig::GlobalObject* m_globalObject;
};

extern "C" NapiHandleScopeImpl* NapiHandleScope__push(Zig::GlobalObject* globalObject);
extern "C" void NapiHandleScope__pop(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current);
extern "C" void NapiHandleScope__append(Zig::GlobalObject* globalObject, JSC::EncodedJSValue value);

} // namespace Bun
