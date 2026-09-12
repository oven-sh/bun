#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// What a method does with a `this` that is not a JSEventEmitter and has no JSEventEmitter in `this._events`.
enum class DefineEvents : bool {
    // Run on a new, empty emitter and leave `this` alone. For the methods that only read
    // `this._events` in Node (listenerCount, emit, removeListener, ...).
    No,
    // Store the new emitter as `this._events`. For the methods that assign to `this` in Node
    // (the addListener family, setMaxListeners).
    Yes,
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
