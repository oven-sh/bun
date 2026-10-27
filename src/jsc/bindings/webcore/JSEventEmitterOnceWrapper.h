#pragma once

#include "root.h"
#include "BunClientData.h"
#include "DOMStructureSlot.h"
#include "JSDOMWrapper.h"
#include <JavaScriptCore/JSFunction.h>

namespace WebCore {

class JSEventEmitter;

// node's onceWrapper for the native EventEmitter, what rawListeners() returns for a once() registration: https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L625-L641
class JSEventEmitterOnceWrapper final : public JSC::JSFunction {
public:
    using Base = JSC::JSFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    // `target` is the `this` of the listener. The wrapper removes itself from `eventName` of the emitter when it fires.
    static JSEventEmitterOnceWrapper* create(JSC::VM&, JSDOMGlobalObject&, JSEventEmitter&, JSC::JSObject* target, JSC::JSValue eventName, JSC::JSObject& listener);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSC::JSObject* createPrototype(JSC::VM&, JSDOMGlobalObject&);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::JSFunctionType, StructureFlags), info());
    }

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

    // The function once() was given. User code can rewrite the `listener` property, so readers use this.
    JSC::JSObject* listener() const { return m_listener.get(); }

    // `function` as listeners(), removeListener() and 'newListener' see it: node reads `function.listener ?? function`.
    static JSC::JSObject* unwrap(JSC::JSObject* function)
    {
        if (auto* wrapper = dynamicDowncast<JSEventEmitterOnceWrapper>(function))
            return wrapper->listener();
        return function;
    }

private:
    JSEventEmitterOnceWrapper(JSC::VM&, JSC::NativeExecutable*, JSC::JSGlobalObject*, JSC::Structure*);
    void finishCreation(JSC::VM&, JSEventEmitter&, JSC::JSObject* target, JSC::JSValue eventName, JSC::JSObject& listener);

    // Null after the wrapper fired. A fired wrapper that user code keeps does not retain the emitter.
    JSC::WriteBarrier<JSEventEmitter> m_emitter;
    JSC::WriteBarrier<JSC::JSObject> m_target;
    JSC::WriteBarrier<JSC::Unknown> m_eventName;
    JSC::WriteBarrier<JSC::JSObject> m_listener;
};
static_assert(sizeof(JSEventEmitterOnceWrapper) == sizeof(JSC::JSFunction) + 4 * sizeof(void*));

template<> struct DOMStructureSlotOf<JSEventEmitterOnceWrapper> {
    static constexpr DOMStructureSlot value = DOMStructureSlot::EventEmitterOnceWrapper;
};

} // namespace WebCore
