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

    // Whether this callback is not to be called: it was stored inside the context of a
    // Bun.ModuleGraph that has since been disposed.
    bool isOfStoppedModuleGraph(JSC::JSGlobalObject*) const;

    // One call of a callback that native code stored with withAsyncContextIfNeeded() or
    // withGraphContextIfNeeded(). Unwraps `callee` and makes the async context it was stored in
    // current until the scope ends. Does nothing for a callee that was stored as it is.
    //
    // A caller that reports what the callback throws as uncaught (a timer, EventLoop::run_callback)
    // reports BEFORE the scope ends. The process's error handlers run on top of the async context
    // that is current where the error is reported (Bun::ErrorHandlerContextScope), so that order
    // shows them the AsyncLocalStorage stores of the callback that failed, as node does. A caller
    // that leaves the exception pending restores first: the script that catches it is in its own
    // async context.
    class CallScope {
        WTF_MAKE_NONCOPYABLE(CallScope);
        WTF_FORBID_HEAP_ALLOCATION;

    public:
        // Skip: the caller's dispatcher has ruled out a callee that isOfStoppedModuleGraph().
        enum class StoppedModuleGraphTest : bool {
            Run,
            Skip,
        };

        ALWAYS_INLINE CallScope(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue& callee, StoppedModuleGraphTest test = StoppedModuleGraphTest::Run)
            : m_vm(vm)
        {
            auto* wrapper = dynamicDowncast<AsyncContextFrame>(callee);
            if (!wrapper)
                return;
            if (test == StoppedModuleGraphTest::Run && wrapper->isOfStoppedModuleGraph(globalObject)) [[unlikely]] {
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
