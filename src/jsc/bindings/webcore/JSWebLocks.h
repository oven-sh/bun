// Web Locks API (https://w3c.github.io/web-locks/): the JS-facing LockManager
// and Lock classes behind `navigator.locks` / `worker_threads.locks`, matching
// Node's lib/internal/locks.js + src/node_locks.cc.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/locks.js
// https://github.com/nodejs/node/blob/v26.3.0/src/node_locks.cc
//
// Per-thread state (request records with their promise/callback/signal, the
// diagnostics_channel channels, the clientId) lives in WebLocksClient, a
// plain C++ object owned by each Zig::GlobalObject. The process-wide lock
// table is BunWebLocksRegistry; it reports decisions back through
// dispatchWebLockEvent() on each owning context's thread.

#pragma once

#include "root.h"

#include "BunClientData.h"
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/Strong.h>
#include <wtf/HashMap.h>
#include <wtf/RefCounted.h>
#include <wtf/text/WTFString.h>

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class JSWebLock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename MyClassT, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSWebLock.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSWebLock = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSWebLock.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSWebLock = std::forward<decltype(space)>(space); });
    }

    static JSWebLock* create(JSC::VM&, JSC::Structure*, JSC::JSString* name, bool exclusive);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::JSString* name() const { return m_name.get(); }
    bool exclusive() const { return m_exclusive; }

private:
    JSWebLock(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSString* name, bool exclusive);

    JSC::WriteBarrier<JSC::JSString> m_name;
    bool m_exclusive { true };
};

class JSWebLockPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsDefaultHasInstance;

    static JSWebLockPrototype* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

private:
    JSWebLockPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&);
};

// Calling or constructing Lock/LockManager throws ERR_ILLEGAL_CONSTRUCTOR,
// like Node.
class JSWebLockIllegalConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWebLockIllegalConstructor* create(JSC::VM&, JSC::Structure*, JSC::JSObject* prototype, WTF::ASCIILiteral name);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSWebLockIllegalConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }
    void finishCreation(JSC::VM&, JSC::JSObject* prototype, WTF::ASCIILiteral name);
};

class JSWebLockManager final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSWebLockManager* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

private:
    JSWebLockManager(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

class JSWebLockManagerPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsDefaultHasInstance;

    static JSWebLockManagerPrototype* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

private:
    JSWebLockManagerPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(JSC::VM&);
};

void setupJSWebLockClassStructure(JSC::LazyClassStructure::Initializer&);
void setupJSWebLockManagerClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace WebCore

namespace Bun {

// One outstanding lock request (or held lock) owned by this thread. The
// Strong handles are created and released on the owning thread only.
class WebLockRequest : public RefCounted<WebLockRequest> {
public:
    static Ref<WebLockRequest> create() { return adoptRef(*new WebLockRequest()); }

    uint64_t id { 0 };
    WTF::String name;
    bool exclusive { true };
    bool steal { false };
    bool ifAvailable { false };
    // The lock was granted (query() reports this entry as held).
    bool granted { false };
    // Another request stole the lock; the promise already rejected.
    bool stolen { false };
    // Node's `lockGranted`: the user callback was (or is about to be)
    // invoked, so a late abort no longer rejects the promise.
    bool callbackStarted { false };
    // The promise settled; used to make settling idempotent.
    bool settled { false };

    JSC::Strong<JSC::JSPromise> promise;
    JSC::Strong<JSC::JSObject> callback;
    JSC::Strong<JSC::JSObject> signal;
    JSC::Strong<JSC::JSObject> abortListener;

private:
    WebLockRequest() = default;
};

// Per-global Web Locks state, reachable from posted registry events via
// Zig::GlobalObject::webLocksClient(). Destroyed with the global (on its own
// thread, while the VM is still alive, so the Strong handles are safe).
class WebLocksClient {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(WebLocksClient);

public:
    WebLocksClient() = default;

    HashMap<uint64_t, Ref<WebLockRequest>> requests;
    WTF::String clientId;

    enum DCChannel : uint8_t {
        DCStart = 0,
        DCGrant = 1,
        DCMiss = 2,
        DCEnd = 3,
    };
    JSC::Strong<JSC::JSObject> dcChannels[4];
    bool dcChannelsInitialized { false };
};

// Called by BunWebLocksRegistry on the context's own thread. Returns false if
// an exception is pending and dispatching should stop.
bool dispatchWebLockEvent(Zig::GlobalObject*, int32_t type, uint64_t id);

JSC_DECLARE_HOST_FUNCTION(jsWebLockManagerRequest);
JSC_DECLARE_HOST_FUNCTION(jsWebLockManagerQuery);

} // namespace Bun
