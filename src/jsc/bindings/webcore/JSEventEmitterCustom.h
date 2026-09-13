#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// For a `this` that is not a JSEventEmitter and has none in `this._events`:
enum class DefineEvents : bool {
    No, // run on a new emitter and leave `this` alone (the methods that only read `this._events` in Node)
    Yes, // store the new emitter as `this._events` (the methods that assign to `this` in Node)
};

JSEventEmitter* jsEventEmitterCastFast(VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue, DefineEvents);

template<>
class IDLOperation<JSEventEmitter> {
public:
    using ClassParameter = JSEventEmitter*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, DefineEvents defineEvents>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, ASCIILiteral operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        auto* thisObject = jsEventEmitterCastFast(vm, &lexicalGlobalObject, thisValue, defineEvents);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!thisObject) [[unlikely]] {
            return throwThisTypeError(lexicalGlobalObject, throwScope, "EventEmitter", operationName);
        }

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }
};

} // namespace WebCore
