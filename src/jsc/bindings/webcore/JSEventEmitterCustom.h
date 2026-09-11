#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

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
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!thisObject) [[unlikely]] {
            return throwThisTypeError(lexicalGlobalObject, throwScope, "EventEmitter", operationName);
        }

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }
};

} // namespace WebCore
