#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/Strong.h>
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

    // Snapshots the currently-active async context (the value AsyncLocalStorage
    // is running with) into `slot`, for AsyncContextFrameScope to restore later.
    // No-op when there is none, so `slot` never allocates a GC handle for it.
    //
    // `slot` must be a Strong: the value has to stay alive for as long as the
    // owner can still dispatch, and the owner's JS wrapper is not a reliable
    // root for that (a MessageChannel's ports have no wrapper until .port1 is
    // first read, and an AbortSignal.any() timeout source's wrapper can be
    // collected while its timer is still pending).
    static void captureCurrentContext(JSC::JSGlobalObject* globalObject, JSC::Strong<JSC::Unknown>& slot);

    // The following is JSC::call but
    // - it unwraps AsyncContextFrame
    // - does not take a CallData, because JSC::getCallData(AsyncContextFrame) -> not callable
    // static JSC::JSValue call(JSC::JSGlobalObject*, JSC::JSValue functionObject, const JSC::ArgList&, ASCIILiteral errorMessage);
    // static JSC::JSValue call(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&, ASCIILiteral errorMessage);
    static JSC::JSValue call(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&);
    static JSC::JSValue call(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&, NakedPtr<JSC::Exception>& returnedException);

    // Alias of call.
    static JSC::JSValue profiledCall(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&);

    // Alias of call.
    static JSC::JSValue profiledCall(JSC::JSGlobalObject*, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList&, NakedPtr<JSC::Exception>& returnedException);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    mutable JSC::WriteBarrier<JSC::Unknown> callback;
    mutable JSC::WriteBarrier<JSC::Unknown> context;

    /**
     * When you have a **specific** AsyncContextFrame to run the function in, use this
     *
     * Usually, you do not want to use this. Usually, you want to use `call` or `profiledCall`.
     */
    JSC::JSValue run(JSC::JSGlobalObject* globalObject, JSC::JSValue functionObject, JSC::JSValue thisValue, const JSC::ArgList& args);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<AsyncContextFrame, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForAsyncContextFrame.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForAsyncContextFrame = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForAsyncContextFrame.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForAsyncContextFrame = std::forward<decltype(space)>(space); });
    }

    AsyncContextFrame(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue callback_, JSC::JSValue context_)
        : JSNonFinalObject(vm, structure)
        , callback(callback_, JSC::WriteBarrierEarlyInit)
        , context(context_, JSC::WriteBarrierEarlyInit)
    {
    }
};

// RAII: installs `context` as the active async context (the value every
// AsyncLocalStorage.getStore() reads) and restores the previous one on exit.
//
// Use this around an event dispatch that happens asynchronously (from an
// event-loop task) on behalf of a resource created earlier, passing the
// snapshot AsyncContextFrame::captureCurrentContext() took when the resource
// was created. For a single callback, prefer withAsyncContextIfNeeded + call.
//
// A no-op when `context` is empty or undefined, mirroring
// withAsyncContextIfNeeded's "no async context, no snapshot".
class AsyncContextFrameScope {
    WTF_MAKE_NONCOPYABLE(AsyncContextFrameScope);

public:
    AsyncContextFrameScope(JSC::JSGlobalObject*, JSC::JSValue context);
    ~AsyncContextFrameScope();

private:
    JSC::JSGlobalObject* m_globalObject { nullptr };
    JSC::JSValue m_previousContext;
};
