#include "root.h"

using namespace JSC;

// An Error, or an object that Jest's isError() accepts: https://github.com/jestjs/jest/blob/v30.5.2/packages/expect-utils/src/utils.ts#L559-L568
extern "C" [[ZIG_EXPORT(check_slow)]] bool Expect__isError(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object)
        return false;
    if (object->type() == ErrorInstanceType)
        return true;

    // For any other object, Object.prototype.toString() can get these tags only from Symbol.toStringTag.
    JSValue tag = object->get(globalObject, vm.propertyNames->toStringTagSymbol);
    RETURN_IF_EXCEPTION(scope, false);
    if (tag.isString()) {
        auto tagView = asString(tag)->view(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        if (tagView == "Error"_s || tagView == "Exception"_s || tagView == "DOMException"_s)
            return true;
    }

    RELEASE_AND_RETURN(scope, JSObject::defaultHasInstance(globalObject, object, globalObject->errorPrototype()));
}
