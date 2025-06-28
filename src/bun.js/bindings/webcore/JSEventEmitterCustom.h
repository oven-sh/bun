#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// Wrapper type for JSEventEmitter's castedThis because JSDOMWindow and JSWorkerGlobalScope do not inherit JSEventEmitter.
class JSEventEmitterWrapper {
    WTF_MAKE_FAST_ALLOCATED;

public:
    JSEventEmitterWrapper(EventEmitter& wrapped, JSC::JSObject* wrapper)
        : m_wrapped(wrapped)
        , m_wrapper(wrapper)
    {
    }

    EventEmitter& wrapped() { return m_wrapped; }

    operator JSC::JSObject&() { return *m_wrapper; }

private:
    EventEmitter& m_wrapped;
    JSC::JSObject* m_wrapper;
};

std::unique_ptr<JSEventEmitterWrapper> jsEventEmitterCast(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue thisValue);
JSEventEmitter* jsEventEmitterCastFast(VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue);

template<>
class IDLOperation<JSEventEmitter> {
public:
    using ClassParameter = JSEventEmitter*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, CastedThisErrorBehavior = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, ASCIILiteral operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        auto* thisObject = jsEventEmitterCastFast(vm, &lexicalGlobalObject, thisValue);
        if (!thisObject) [[unlikely]] {
            return throwThisTypeError(lexicalGlobalObject, throwScope, "EventEmitter", operationName);
        }

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }
};

} // namespace WebCore
