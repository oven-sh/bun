#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSStringInlines.h>

// Whether `Object.prototype.toString.call(value)` is "[object Object]" or "[object Module]". Through the function object: the always-inline JSC::objectPrototypeToString is 5 KB larger.
extern "C" [[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__toStringTagIsObjectOrModule(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* toString = globalObject->objectProtoToStringFunction();
    JSC::JSValue tag = JSC::call(globalObject, toString, JSC::getCallData(toString), JSC::JSValue::decode(encodedValue), JSC::ArgList());
    RETURN_IF_EXCEPTION(scope, false);

    if (tag == vm.smallStrings.objectObjectString())
        return true;
    auto view = asString(tag)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return view == "[object Object]"_s || view == "[object Module]"_s;
}
