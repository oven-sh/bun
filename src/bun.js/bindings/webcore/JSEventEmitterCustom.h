#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// Wrapper type for JSEventEmitter's castedThis because JSDOMWindow and JSWorkerGlobalScope do not inherit JSEventEmitter.
class JSEventEmitterWrapper {
    WTF_MAKE_FAST_ALLOCATED;

public:
    JSEventEmitterWrapper(EventEmitter& wrapped, JSC::JSObject& wrapper)
        : m_wrapped(wrapped)
        , m_wrapper(wrapper)
    {
    }

    EventEmitter& wrapped() { return m_wrapped; }

    operator JSC::JSObject&() { return m_wrapper; }

private:
    EventEmitter& m_wrapped;
    JSC::JSObject& m_wrapper;
};

std::unique_ptr<JSEventEmitterWrapper> jsEventEmitterCast(JSC::VM&, JSC::JSValue thisValue);

template<> class IDLOperation<JSEventEmitter> {
public:
    using ClassParameter = JSEventEmitterWrapper*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, CastedThisErrorBehavior = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, const char* operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        auto thisObject = jsEventEmitterCast(vm, thisValue.isUndefinedOrNull() ? JSC::JSValue(&lexicalGlobalObject) : thisValue);
        if (UNLIKELY(!thisObject))
            return throwThisTypeError(lexicalGlobalObject, throwScope, "EventEmitter", operationName);

        auto& wrapped = thisObject->wrapped();

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject.get())));
    }
};

} // namespace WebCore
