#include "root.h"

#include <JavaScriptCore/JSStringInlines.h>

namespace Bun {
JSC::JSString* objectPrototypeToStringOutOfLine(JSC::JSGlobalObject*, JSC::JSValue);
}

// Whether `Object.prototype.toString.call(value)` is "[object Object]" or "[object Module]".
extern "C" [[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__toStringTagIsObjectOrModule(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSString* tag = Bun::objectPrototypeToStringOutOfLine(globalObject, JSC::JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(scope, false);

    if (tag == vm.smallStrings.objectObjectString())
        return true;
    auto view = tag->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return view == "[object Object]"_s || view == "[object Module]"_s;
}
