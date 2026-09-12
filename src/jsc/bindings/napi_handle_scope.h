#pragma once

#include "BunClientData.h"
#include "root.h"

typedef struct NapiEnv* napi_env;

namespace v8 {
class Isolate;
namespace shim {
class HandleScopeBuffer;
}
}

namespace Bun {

// One open handle scope, shared by Node-API and the V8 API. The innermost one is
// GlobalObject::m_currentHandleScopeImpl. It keeps alive the napi_values appended to it (a
// napi_value is the JSValue itself, so plain write barriers suffice) and the V8 handles created
// inside it (a HandleScopeBuffer, attached on first use). NapiHandleScope, napi_open_handle_scope
// and v8::HandleScope are all wrappers around open() and close().
class HandleScopeImpl : public JSC::JSCell {
public:
    using Base = JSC::JSCell;

    static HandleScopeImpl* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        HandleScopeImpl* parent,
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
        return WebCore::subspaceForImpl<HandleScopeImpl, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForHandleScopeImpl, m_subspaceForHandleScopeImpl),
            [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForHandleScopeImpl; });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr JSC::DestructionMode needsDestruction = JSC::DestructionMode::NeedsDestruction;
    static void destroy(JSC::JSCell* cell)
    {
        static_cast<HandleScopeImpl*>(cell)->~HandleScopeImpl();
    }
    ~HandleScopeImpl();

    // Returns null while the GC is sweeping (see the definition), which close() accepts.
    static HandleScopeImpl* open(Zig::GlobalObject* globalObject, bool escapable);
    // `current` must be the innermost open scope.
    static void close(Zig::GlobalObject* globalObject, HandleScopeImpl* current);

    // Keep a napi_value alive until this scope closes.
    void append(JSC::JSValue val);
    HandleScopeImpl* parent() const { return m_parent; }
    // Returns false if this handle scope is not escapable or if it is but escape() has already
    // been called
    bool escape(JSC::JSValue val);

    // Null until the first V8 call made inside this scope attaches one.
    v8::shim::HandleScopeBuffer* v8Handles() const { return m_v8Handles.get(); }
    v8::shim::HandleScopeBuffer& ensureV8Handles(v8::Isolate* isolate);

private:
    using Slot = JSC::WriteBarrier<JSC::Unknown>;

    HandleScopeImpl* m_parent;
    WTF::Vector<Slot, 16> m_storage;
    Slot* m_escapeSlot;
    std::unique_ptr<v8::shim::HandleScopeBuffer> m_v8Handles;

    Slot* reserveSlot();
    void releaseHandles();

    HandleScopeImpl(JSC::VM& vm, JSC::Structure* structure, HandleScopeImpl* parent, bool escapable);
};

// Opens a scope for the duration of a C++ block: around every Node-API callback Bun makes.
class NapiHandleScope {
public:
    NapiHandleScope(Zig::GlobalObject* globalObject);
    ~NapiHandleScope();

private:
    HandleScopeImpl* m_impl;
    Zig::GlobalObject* m_globalObject;
};

// The same for napi_open_handle_scope and friends (napi_body.rs) and for bun:ffi calls.
extern "C" HandleScopeImpl* NapiHandleScope__open(napi_env env, bool escapable);
extern "C" void NapiHandleScope__close(napi_env env, HandleScopeImpl* current);

// Store a value in the innermost open scope
extern "C" void NapiHandleScope__append(napi_env env, JSC::EncodedJSValue value);

// Put a value from the current handle scope into its escape slot reserved in the outer handle
// scope. Returns false if the current handle scope is not escapable or if escape has already been
// called on it.
extern "C" bool NapiHandleScope__escape(HandleScopeImpl* handle_scope, JSC::EncodedJSValue value);

} // namespace Bun
