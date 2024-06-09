#include "root.h"

#include "JavaScriptCore/ObjectConstructor.h"
#include <JavaScriptCore/JSGlobalObject.h>

#include <JavaScriptCore/JSString.h>
#include "ZigGlobalObject.h"

namespace Bun {
using namespace JSC;

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUTF16String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(false));
        }

        return JSValue::encode(jsBoolean(true));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsLatin1String,
    (JSGlobalObject * globalObject,
        CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = callframe->argument(0);
    if (value.isString()) {
        WTF::String string = value.toWTFString(globalObject);
        if (string.is8Bit()) {
            return JSValue::encode(jsBoolean(true));
        }

        return JSValue::encode(jsBoolean(false));
    }

    throwTypeError(globalObject, scope, "Expected a string"_s);
    return JSValue::encode(jsUndefined());
}

JSC::JSValue createJSCTestingHelpers(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSC::constructEmptyObject(globalObject);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isUTF16String"_s), 1,
        jsFunctionIsUTF16String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    object->putDirectNativeFunction(
        vm, globalObject, JSC::Identifier::fromString(vm, "isLatin1String"_s), 1,
        jsFunctionIsLatin1String, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    return object;
}

} // namespace Bun