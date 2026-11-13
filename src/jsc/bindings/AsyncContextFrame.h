#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <wtf/ForbidHeapAllocation.h>
#include <wtf/Noncopyable.h>

class AsyncContextFrame : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static AsyncContextFrame* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue callback, JSC::JSValue context);
    static AsyncContextFrame* create(JSC::JSGlobalObject* global, JSC::JSValue callback, JSC::JSValue context);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    // When given a JSFunction that you want to call later, wrap it with this function
    static JSC::JSValue withAsyncContextIfNeeded(JSC::JSGlobalObject* globalObject, JSC::JSValue callback);

    // For a handler script sets on something long-lived whose events arrive from the event loop (a
    // socket's ondata, a client's onconnect): it continues the Bun.ModuleGraph whose script set it,
    // and nothing else of that moment. Outside any graph the callback is returned as it is, so it
    // runs in nobody's async context, as node's does.
    static JSC::JSValue withGraphContextIfNeeded(JSC::JSGlobalObject* globalObject, JSC::JSValue callback);

    // The following is JSC::call but
    // - it unwraps AsyncContextFrame
    // - does not take a CallData, because JSC::getCallData(AsyncContextFrame) -> not callable
    static JSC::JSValue call(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&);

    // Alias of call.
    static JSC::JSValue profiledCall(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&);

    // The callback was stored inside a Bun.ModuleGraph that has since been disposed: it is not to be called.
    bool isOfStoppedModuleGraph(JSC::JSGlobalObject*) const;

    // Unwraps a stored callback and makes its async context current until the scope ends. A caller that reports the callback's throw as uncaught reports inside the scope (Bun::ErrorHandlerContextScope).
    class CallScope {
        WTF_MAKE_NONCOPYABLE(CallScope);
        WTF_FORBID_HEAP_ALLOCATION;

    public:
        ALWAYS_INLINE CallScope(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue& callee)
            : m_vm(vm)
        {
            auto* wrapper = dynamicDowncast<AsyncContextFrame>(callee);
            if (!wrapper)
                return;
            if (wrapper->isOfStoppedModuleGraph(globalObject)) [[unlikely]] {
                m_calleeIsOfStoppedModuleGraph = true;
                return;
            }
            callee = wrapper->callback.get();
            m_asyncContextData = globalObject->m_asyncContextData.get();
            m_previous = m_asyncContextData->getInternalField(0);
            m_asyncContextData->putInternalField(vm, 0, wrapper->context.get());
        }

        ALWAYS_INLINE ~CallScope() { restore(); }

        // The callee is not to be called (AsyncContextFrame::isOfStoppedModuleGraph). Nothing was entered.
        bool calleeIsOfStoppedModuleGraph() const { return m_calleeIsOfStoppedModuleGraph; }

        // Puts the previous async context back now instead of when the scope ends.
        ALWAYS_INLINE void restore()
        {
            if (m_asyncContextData) {
                m_asyncContextData->putInternalField(m_vm, 0, m_previous);
                m_asyncContextData = nullptr;
            }
        }

    private:
        JSC::VM& m_vm;
        JSC::InternalFieldTuple* m_asyncContextData { nullptr };
        JSC::JSValue m_previous;
        bool m_calleeIsOfStoppedModuleGraph { false };
    };

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    mutable JSC::WriteBarrier<JSC::Unknown> callback;
    mutable JSC::WriteBarrier<JSC::Unknown> context;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<AsyncContextFrame, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForAsyncContextFrame, m_subspaceForAsyncContextFrame));
    }

    AsyncContextFrame(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue callback_, JSC::JSValue context_)
        : JSNonFinalObject(vm, structure)
        , callback(callback_, JSC::WriteBarrierEarlyInit)
        , context(context_, JSC::WriteBarrierEarlyInit)
    {
    }
};

// Makes `snapshot` the current async context for the scope's lifetime. No-op if `snapshot` is empty, undefined or null.
class AsyncContextScope {
    WTF_MAKE_NONCOPYABLE(AsyncContextScope);

public:
    AsyncContextScope(JSC::JSGlobalObject*, JSC::JSValue snapshot);
    ~AsyncContextScope();

private:
    JSC::JSGlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previous;
};
