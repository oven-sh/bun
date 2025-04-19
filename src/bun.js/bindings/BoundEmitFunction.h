#pragma once

#include "root.h"
#include "JSEventEmitter.h"

namespace Bun {

// Callable wrapper around an event emitter, an event name, and a value. Will fire the specified
// event when called. Used to implement Process::emitOnNextTick.
class BoundEmitFunction : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static BoundEmitFunction* create(JSC::VM& vm, Zig::GlobalObject* globalObject, WebCore::JSEventEmitter* target, WTF::ASCIILiteral eventName, JSC::JSValue event);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<BoundEmitFunction, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBoundEmitFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBoundEmitFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBoundEmitFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBoundEmitFunction = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

private:
    BoundEmitFunction(JSC::VM& vm, JSC::Structure* structure, WTF::ASCIILiteral eventName);
    void finishCreation(JSC::VM& vm, WebCore::JSEventEmitter* target, JSC::JSValue event);
    static JSC_DECLARE_HOST_FUNCTION(functionCall);

    JSC::WriteBarrier<WebCore::JSEventEmitter> m_target;
    WTF::ASCIILiteral m_eventName;
    JSC::WriteBarrier<JSC::Unknown> m_event;
};

} // namespace Bun
