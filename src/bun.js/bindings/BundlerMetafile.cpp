/**
 * Lazy getter for BuildOutput.metafile that parses JSON on first access
 * and memoizes the result by replacing the getter with the parsed value.
 */

#include "root.h"
#include "ZigGlobalObject.h"
#include "BunBuiltinNames.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSONObject.h>

namespace Bun {

using namespace JSC;

static const auto metafilePropertyName = "metafile"_s;

JSC_DEFINE_CUSTOM_GETTER(bundlerMetafileLazyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject) {
        return JSValue::encode(jsUndefined());
    }

    // Get the raw JSON string from private property
    const auto& privateName = Bun::builtinNames(vm).dataPrivateName();
    JSValue metafileStringValue = thisObject->get(globalObject, privateName);
    RETURN_IF_EXCEPTION(scope, {});

    if (metafileStringValue.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }

    // Parse the JSON string
    JSValue parsedValue = JSONParse(globalObject, metafileStringValue.toWTFString(globalObject));
    RETURN_IF_EXCEPTION(scope, {});

    if (parsedValue.isUndefined()) {
        // JSON parse failed, return undefined
        return JSValue::encode(jsUndefined());
    }

    // Memoize: replace the getter with the parsed value using putDirect
    thisObject->putDirect(vm, Identifier::fromString(vm, metafilePropertyName), parsedValue, 0);

    // Delete the raw string property since we no longer need it
    thisObject->deleteProperty(globalObject, privateName);

    return JSValue::encode(parsedValue);
}

// Helper to set up the lazy metafile on a BuildOutput object
extern "C" void Bun__setupLazyMetafile(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue buildOutputEncoded, JSC::EncodedJSValue metafileStringEncoded)
{
    auto& vm = globalObject->vm();
    JSObject* buildOutput = jsDynamicCast<JSObject*>(JSValue::decode(buildOutputEncoded));
    JSValue metafileString = JSValue::decode(metafileStringEncoded);

    if (!buildOutput) {
        return;
    }

    // Store the raw JSON string in a private property
    const auto& privateName = Bun::builtinNames(vm).dataPrivateName();
    buildOutput->putDirect(vm, privateName, metafileString, 0);

    // Set up the lazy getter for metafile property
    buildOutput->putDirectCustomAccessor(
        vm,
        Identifier::fromString(vm, metafilePropertyName),
        CustomGetterSetter::create(vm, bundlerMetafileLazyGetter, nullptr),
        PropertyAttribute::CustomValue | 0);
}

} // namespace Bun
