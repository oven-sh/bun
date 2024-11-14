#pragma once

#include "BunClientData.h"
#include "root.h"

namespace Bun {

// An array of write barriers (so that newly-added objects are not lost by GC) to JSValues. Unlike
// the V8 version, pointer stability is not required (because napi_values don't point into this
// structure) so we can use a regular WTF::Vector
//
// Don't use this directly, use NapiHandleScope. Most NAPI functions won't even need to use that as
// a handle scope is created before calling a native function.
class NapiHandleScopeImpl : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static NapiHandleScopeImpl* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        NapiHandleScopeImpl* parent,
        bool escapable = false);

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

    // Store val in the handle scope
    void append(JSC::JSValue val);
    NapiHandleScopeImpl* parent() const { return m_parent; }
    // Returns false if this handle scope is not escapable or if it is but escape() has already
    // been called
    bool escape(JSC::JSValue val);

private:
    using Slot = JSC::WriteBarrier<JSC::Unknown>;

    NapiHandleScopeImpl* m_parent;
    WTF::Vector<Slot, 16> m_storage;
    Slot* m_escapeSlot;

    Slot* reserveSlot();

    NapiHandleScopeImpl(JSC::VM& vm, JSC::Structure* structure, NapiHandleScopeImpl* parent, bool escapable);
};

// Wrapper class used to open a new handle scope and close it when this instance goes out of scope
class NapiHandleScope {
public:
    NapiHandleScope(Zig::GlobalObject* globalObject);
    ~NapiHandleScope();

    // Create a new handle scope in the given environment
    static NapiHandleScopeImpl* open(Zig::GlobalObject* globalObject, bool escapable);

    // Closes the most recently created handle scope in the given environment and restores the old one.
    // Asserts that `current` is the active handle scope.
    static void close(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current);

private:
    NapiHandleScopeImpl* m_impl;
    Zig::GlobalObject* m_globalObject;
};

// Create a new handle scope in the given environment
extern "C" NapiHandleScopeImpl* NapiHandleScope__open(Zig::GlobalObject* globalObject, bool escapable);

// Pop the most recently created handle scope in the given environment and restore the old one.
// Asserts that `current` is the active handle scope.
extern "C" void NapiHandleScope__close(Zig::GlobalObject* globalObject, NapiHandleScopeImpl* current);

// Store a value in the active handle scope in the given environment
extern "C" void NapiHandleScope__append(Zig::GlobalObject* globalObject, JSC::EncodedJSValue value);

// Put a value from the current handle scope into its escape slot reserved in the outer handle
// scope. Returns false if the current handle scope is not escapable or if escape has already been
// called on it.
extern "C" bool NapiHandleScope__escape(NapiHandleScopeImpl* handle_scope, JSC::EncodedJSValue value);

} // namespace Bun
