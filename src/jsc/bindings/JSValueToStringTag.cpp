#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSStringInlines.h>

// `Object.prototype.toString.call(value) === "[object Object]"`, through the function object: the always-inline JSC::objectPrototypeToString is 5 KB larger.
extern "C" [[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__toStringTagIsObject(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSFunction* toString = globalObject->objectProtoToStringFunction();
    JSC::JSValue tag = JSC::call(globalObject, toString, JSC::getCallData(toString), JSC::JSValue::decode(encodedValue), JSC::ArgList());
    RETURN_IF_EXCEPTION(scope, false);

    JSC::JSString* objectObject = vm.smallStrings.objectObjectString();
    if (tag == objectObject)
        return true;
    RELEASE_AND_RETURN(scope, asString(tag)->equal(globalObject, objectObject));
}
