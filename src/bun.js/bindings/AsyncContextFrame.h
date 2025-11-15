#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/CallData.h>

class AsyncContextFrame : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static AsyncContextFrame* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSValue callback, JSC::JSValue context);
    static AsyncContextFrame* create(JSC::JSGlobalObject* global, JSC::JSValue callback, JSC::JSValue context);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    // When given a JSFunction that you want to call later, wrap it with this function
    static JSC::JSValue withAsyncContextIfNeeded(JSC::JSGlobalObject* globalObject, JSC::JSValue callback);

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
