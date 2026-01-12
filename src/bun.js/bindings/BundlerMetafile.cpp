/**
 * Lazy getter for BuildOutput.metafile that parses JSON on first access.
 * Uses CustomValue so the parsed result replaces the getter.
 */

#include "root.h"
#include "BunBuiltinNames.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSONObject.h>

namespace Bun {

using namespace JSC;

JSC_DEFINE_CUSTOM_GETTER(bundlerMetafileLazyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName property))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* thisObject = JSValue::decode(thisValue).getObject();
    if (!thisObject) {
        return JSValue::encode(jsUndefined());
    }

    // Get the raw JSON string from private property
    const auto& privateName = Bun::builtinNames(vm).dataPrivateName();
    JSValue metafileStringValue = thisObject->getDirect(vm, privateName);
    ASSERT(metafileStringValue.isString());

    auto str = metafileStringValue.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto view = str->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    JSValue parsedValue = JSC::JSONParseWithException(globalObject, view);
    RETURN_IF_EXCEPTION(scope, {});

    // Replace the lazy getter with the parsed value (memoize for subsequent accesses)
    thisObject->putDirect(vm, property, parsedValue, 0);

    // Clear the raw JSON string so it can be GC'd
    thisObject->putDirect(vm, privateName, jsUndefined(), 0);

    return JSValue::encode(parsedValue);
}

// Helper to set up the lazy metafile on a BuildOutput object
extern "C" SYSV_ABI void Bun__setupLazyMetafile(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue buildOutputEncoded, JSC::EncodedJSValue metafileStringEncoded)
{
    auto& vm = JSC::getVM(globalObject);
    JSObject* buildOutput = JSValue::decode(buildOutputEncoded).getObject();
    ASSERT(buildOutput);

    // Store the raw JSON string in a private property
    const auto& privateName = Bun::builtinNames(vm).dataPrivateName();
    buildOutput->putDirect(vm, privateName, JSValue::decode(metafileStringEncoded), 0);

    // Set up the lazy getter
    buildOutput->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, "metafile"_s),
        CustomGetterSetter::create(vm, bundlerMetafileLazyGetter, nullptr),
        PropertyAttribute::CustomValue | 0);
}

} // namespace Bun
