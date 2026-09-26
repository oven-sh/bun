#pragma once

#include "JSDOMBinding.h"
#include "JSDOMOperation.h"

namespace WebCore {

// For a `this` that is not a JSEventEmitter and has none in `this._events`:
enum class DefineEvents : bool {
    No, // the method gets nullptr and leaves `this` alone (the methods that only read `this._events` in Node)
    Yes, // the method gets a new emitter, stored as `this._events` (the methods that assign to `this` in Node)
};

// The emitter of a `this` that is not a JSEventEmitter: the one in `this._events`, else as DefineEvents says.
JSEventEmitter* jsEventEmitterCastFast(VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSObject* thisObject, DefineEvents);

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
        auto* emitter = dynamicDowncast<JSEventEmitter>(thisValue);
        if (!emitter) [[unlikely]] {
            if (!thisValue.isObject())
                return throwThisTypeError(lexicalGlobalObject, throwScope, "EventEmitter", operationName);
            emitter = jsEventEmitterCastFast(vm, &lexicalGlobalObject, asObject(thisValue), defineEvents);
            RETURN_IF_EXCEPTION(throwScope, {});
            ASSERT(emitter || defineEvents == DefineEvents::No);
        }

        // `this._events` can be the only reference to the emitter, and user code in `operation` can delete it.
        JSC::EnsureStillAliveScope keepEmitterAlive(emitter);
        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, emitter)));
    }
};

} // namespace WebCore
